import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useNameMap, useOrgRows, useRecord, usePendingSet, useProfiles } from '../../db/hooks';
import { patchRecord, responseId, saveRecord } from '../../db/repo';
import { getMeta } from '../../db/db';
import { downloadAuditForOffline } from '../../sync/engine';
import { setPinned } from '../../sync/retention';
import { useAuth } from '../auth/AuthProvider';
import { auditAccess, canWrite, useParticipants } from '../auth/access';
import { ParticipantsCard, ReadinessCard, useAuditLifecycle, useLocalReadiness } from './AuditLifecycle';
import { RecordHistory } from '../../components/RecordHistory';
import { BandChip, ResultSheet, type SheetData } from '../../components/ResultSheet';
import { uiBandStyle } from '../../scoring/bands';
import { usePreviousAudit } from './previousAudit';
import { ClosingMeetingCard } from './ClosingMeeting';
import { answerOptions, deviationFindingType, evaluate } from '../../scoring/engine';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, TextArea, displayText, fmtDate, fmtNum, useToast } from '../../components/ui';
import { EvidenceStrip } from '../evidences/EvidenceStrip';
import { FindingForm } from '../findings/FindingForm';
import { statusTone } from './AuditsPage';
import { LABELS, type Audit, type AuditResponse, type Company, type Finding, type Location, type TemplateItem, type TemplateSection, type TemplateVersion } from '../../types';

export function AuditExecutePage() {
  const { id } = useParams();
  const { orgId, role, userId, current } = useAuth();
  const participants = useParticipants(orgId);
  const toast = useToast();
  const audit = useRecord<Audit>('hse_audits', id);
  const version = useRecord<TemplateVersion>('hse_template_versions', audit?.template_version_id);
  const sections = useLiveQuery(async () => audit ? (await db.hse_template_sections.where('version_id').equals(audit.template_version_id).toArray()).filter(s => !s.deleted_at).sort((a, b) => a.sort_order - b.sort_order) : [], [audit?.template_version_id]) ?? [];
  const items = useLiveQuery(async () => audit ? (await db.hse_template_items.where('version_id').equals(audit.template_version_id).toArray()).filter(i => !i.deleted_at) : [], [audit?.template_version_id]) ?? [];
  const responses = useLiveQuery(async () => id ? (await db.hse_audit_responses.where('audit_id').equals(id).toArray()).filter(r => !r.deleted_at) : [], [id]) ?? [];
  const findings = useLiveQuery(async () => id ? (await db.hse_findings.where('audit_id').equals(id).toArray()).filter(f => !f.deleted_at) : [], [id]) ?? [];
  const evidCount = useLiveQuery(async () => {
    if (!id) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const e of await db.hse_evidences.where('audit_id').equals(id).toArray()) if (!e.deleted_at && e.response_id) m.set(e.response_id, (m.get(e.response_id) ?? 0) + 1);
    return m;
  }, [id]) ?? new Map<string, number>();
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const locations = useOrgRows<Location>('hse_locations') ?? [];
  const cName = useNameMap('hse_companies'); const lName = useNameMap('hse_locations'); const pName = useNameMap('hse_processes');
  const people = useProfiles();
  const pendingResp = usePendingSet('hse_audit_responses');
  const opState = useLiveQuery(async () => {
    const m = new Map<string, string>();
    for (const o of await db.outbox.where('table').anyOf('hse_audit_responses', 'hse_audits').toArray()) if (o.status !== 'pendiente' && o.status !== 'enviando') m.set(o.record_id, o.status);
    return m;
  }, []) ?? new Map<string, string>();
  const pinnedAt = useLiveQuery(async () => id && (await getMeta<string[]>(`pinned:${orgId}`))?.includes(id) ? ((await getMeta<string>(`pinned_at:${id}`)) ?? '') : null, [id, orgId]);
  const [downloading, setDownloading] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [onlyPending, setOnlyPending] = useState(false);
  const [findingFor, setFindingFor] = useState<Partial<Finding> | null>(null);
  const [edit, setEdit] = useState<Partial<Audit> | null>(null);

  const respByItem = useMemo(() => new Map(responses.map(r => [r.item_id, r])), [responses]);
  const answers = useMemo(() => Object.fromEntries(responses.filter(r => r.answer).map(r => [r.item_id, r.answer!])), [responses]);
  const result = useMemo(() => version ? evaluate(version, sections, items, answers) : null, [version, sections, items, answers]);
  const findingByResponse = useMemo(() => new Map(findings.filter(f => f.response_id).map(f => [f.response_id!, f])), [findings]);
  const local = useLocalReadiness(audit, items, responses);
  const access = auditAccess(audit, role, userId, participants, current?.company_id);
  const life = useAuditLifecycle(audit ?? ({} as Audit), access, local);
  const previous = usePreviousAudit(audit, version);

  if (audit === undefined) return null;
  if (audit === null) return <Empty>Auditoría no encontrada en este dispositivo.</Empty>;
  if (!version) return <Empty>La versión de plantilla de esta auditoría todavía no se descargó. Sincronice con conexión.</Empty>;

  const writer = canWrite(access);
  const locked = ['completada', 'cerrada', 'cancelada'].includes(audit.status) || !writer;
  const scorable = items.filter(i => ['cumplimiento', 'si_no', 'situacion'].includes(i.response_type));
  const answered = scorable.filter(i => respByItem.get(i.id)?.answer).length;

  const setAnswer = async (item: TemplateItem, patch: Partial<AuditResponse>) => {
    if (locked) return;
    const rid = responseId(audit.id, item.id);
    const prev = respByItem.get(item.id);
    await saveRecord<AuditResponse>('hse_audit_responses', {
      ...(prev ?? {}), id: rid, organization_id: orgId, audit_id: audit.id, item_id: item.id,
      answer: prev?.answer ?? null, comment: prev?.comment ?? null, rating: prev?.rating ?? null, numeric_value: prev?.numeric_value ?? null, text_value: prev?.text_value ?? null,
      ...patch,
    } as AuditResponse);
    if (audit.status === 'planificada') await patchRecord<Audit>('hse_audits', audit.id, { status: 'en_curso' });
  };

  const saveDetails = async () => {
    if (!edit) return;
    await patchRecord<Audit>('hse_audits', audit.id, { title: edit.title, company_id: edit.company_id || null, location_id: edit.location_id || null, scheduled_date: edit.scheduled_date || null, audit_team: edit.audit_team || null, scope: edit.scope || null, summary: edit.summary || null, audit_type: edit.audit_type });
    setEdit(null);
  };

  return (
    <div className="stack-lg">
      <PageHeader title={audit.title}
        subtitle={<>{audit.code ?? 'Código al sincronizar'} · {audit.company_id ? cName.get(audit.company_id) : 'Sin empresa'} · {audit.location_id ? lName.get(audit.location_id) : 'Sin ubicación'} · {fmtDate(audit.scheduled_date)}{audit.lead_auditor_id ? ` · Auditor: ${people.get(audit.lead_auditor_id) ?? ''}` : ''}</>}
        actions={<>
          <Badge tone={statusTone(audit.status)}>{LABELS.auditStatus[audit.status]}</Badge>
          <Link className="btn btn-secondary" to={`/informes?audit=${audit.id}`}>Informe</Link>
          {pinnedAt !== null && pinnedAt !== undefined
            ? <Button variant="ghost" title={`Descargada ${new Date(pinnedAt || Date.now()).toLocaleString('es-AR')}`} onClick={() => void setPinned(orgId, audit.id, false)}>✓ Disponible sin conexión</Button>
            : <Button variant="secondary" busy={downloading} disabled={!navigator.onLine} onClick={async () => {
                setDownloading(true);
                try { const r = await downloadAuditForOffline(orgId, audit.id, true); toast(`Lista para trabajar sin conexión (${r.rows} registros, ${r.photos} fotos)`); }
                catch (e) { toast(e instanceof Error ? e.message : String(e), 'bad'); } finally { setDownloading(false); }
              }}>Descargar para usar sin conexión</Button>}
          {writer && !['cerrada', 'cancelada'].includes(audit.status) ? <Button variant="secondary" onClick={() => setEdit(audit)}>Datos</Button> : null}
          {life.buttons}
        </>} />

      {(() => {
        // resultado al terminar: franja del color de la calificación, comparación y próximos pasos
        const done = ['completada', 'cerrada'].includes(audit.status) && (audit.score !== null || audit.compliance_pct !== null);
        if (!done) return null;
        const situ = version.scoring_method === 'situacion_promedio_secciones';
        const val = situ ? Number(audit.score) : Number(audit.compliance_pct);
        const st = uiBandStyle(audit.result_band);
        const d = previous && previous.final !== null ? Math.round((val - previous.final) * 100) / 100 : null;
        return (
          <section className="result-hero" style={st ? { background: st.bg, color: st.fg } : undefined}>
            <div className="result-hero-main">
              <span className="small">{audit.status === 'cerrada' ? 'Auditoría cerrada' : 'Auditoría completada'} · resultado oficial</span>
              <span className="result-hero-val"><span className="num-font">{situ ? fmtNum(val) : `${fmtNum(val, 1)} %`}</span>{audit.result_band ? <strong>{audit.result_band}</strong> : null}</span>
              {d !== null ? <span className="result-delta">{d > 0 ? '▲ +' : d < 0 ? '▼ ' : '= '}{fmtNum(d)} respecto de la anterior ({fmtNum(previous!.final)})</span> : null}
            </div>
            <div className="result-hero-actions">
              <a className="btn btn-primary" href="#acta" onClick={e => { e.preventDefault(); document.getElementById('acta')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Reunión de cierre y firmas</a>
              <Link className="btn btn-secondary" to={`/informes?audit=${audit.id}`}>Descargar informe</Link>
            </div>
          </section>
        );
      })()}

      {(() => {
        const official = ['completada', 'cerrada'].includes(audit.status) && Array.isArray(audit.section_results) && (audit.score !== null || audit.compliance_pct !== null);
        const situ = version.scoring_method === 'situacion_promedio_secciones';
        const data: SheetData = official
          ? { method: version.scoring_method, official: true, band: audit.result_band ?? null,
              sections: audit.section_results as unknown as SheetData['sections'],
              final: situ ? (audit.score === null ? null : Number(audit.score)) : (audit.compliance_pct === null ? null : Number(audit.compliance_pct)) }
          : { method: version.scoring_method, official: false, band: result?.band ?? null, sections: result?.sections ?? [],
              final: situ ? (result?.final ?? null) : (result?.compliance_pct ?? null) };
        return (
          <ResultSheet data={data} config={version.scoring_config} previous={previous}
            meta={<>
              <p className="small muted" style={{ margin: 0 }}>{official
                ? `Calculado por el servidor al completar, con la metodología de la versión v${version.version_number} de la plantilla.`
                : `Se calcula en el dispositivo con las reglas de la versión v${version.version_number} para orientar al auditor; el resultado oficial lo calcula el servidor al completar.`}</p>
              {!situ && data.sections.length ? <p className="small muted" style={{ margin: 0 }}>Puntaje: {fmtNum(official ? audit.score : result?.score ?? null)} de {fmtNum(official ? audit.max_score : result?.max_score ?? null)}</p> : null}
            </>}
            extra={<div className="row gap-lg wrap small">
              <span><strong>{answered}</strong>/{scorable.length} respondidas</span>
              <span><strong>{findings.length}</strong> hallazgos ({findings.filter(f => f.status === 'abierto' || f.status === 'en_tratamiento').length} abiertos{findings.some(f => f.recurrence_count > 0) ? `, ${findings.filter(f => f.recurrence_count > 0).length} recurrentes` : ''})</span>
              <span style={result?.critical_failures ? { color: 'var(--bad)' } : undefined}><strong>{result?.critical_failures ?? 0}</strong> críticos con desvío</span>
              <div className="progress grow" style={{ minWidth: 120 }}><span style={{ width: `${scorable.length ? (100 * answered) / scorable.length : 0}%` }} /></div>
            </div>} />
        );
      })()}
      {life.reviewInfo}
      {['planificada', 'en_curso'].includes(audit.status) && writer ? <ReadinessCard local={local} /> : null}

      {!locked ? (() => {
        const pct = scorable.length ? answered / scorable.length : 0;
        const situ = version.scoring_method === 'situacion_promedio_secciones';
        const partial = situ ? result?.final ?? null : result?.compliance_pct ?? null;
        const pband = situ ? result?.band ?? null : null;
        const C = 2 * Math.PI * 18;
        const nextPending = () => {
          const order = sections.flatMap(sec => items.filter(i => i.section_id === sec.id).sort((a, b) => a.sort_order - b.sort_order));
          const it = order.find(i => scorable.includes(i) && !respByItem.get(i.id)?.answer);
          if (!it) { toast('No quedan requisitos sin responder'); return; }
          setOpen(o => ({ ...o, [it.section_id]: true }));
          setTimeout(() => document.getElementById(`item-${it.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60);
        };
        return (
          <div className="audit-bar" role="region" aria-label="Avance de la auditoría">
            <svg width="44" height="44" viewBox="0 0 44 44" role="img" aria-label={`${answered} de ${scorable.length} respondidas`}>
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--line)" strokeWidth="5" />
              <circle cx="22" cy="22" r="18" fill="none" stroke="var(--band-b)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`} transform="rotate(-90 22 22)" />
              <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="IBM Plex Mono, monospace">{Math.round(pct * 100)}%</text>
            </svg>
            <span className="audit-bar-txt"><strong className="num-font">{answered}/{scorable.length}</strong><span className="small muted">respondidas</span></span>
            {partial !== null ? <span className="audit-bar-txt"><strong className="num-font">{situ ? fmtNum(partial) : `${fmtNum(partial, 1)} %`}</strong><span className="small muted">parcial</span></span> : null}
            {pband ? <BandChip label={pband} /> : null}
            <span className="grow" />
            <Button className="btn-sm" onClick={nextPending} aria-label="Siguiente sin responder">Siguiente<span className="hide-sm">&nbsp;sin responder</span>&nbsp;›</Button>
          </div>
        );
      })() : null}

      {sections.length > 1 ? (
        <nav className="sec-chips" aria-label="Requisitos">
          {sections.map((sec, i) => {
            const total = items.filter(x => x.section_id === sec.id).length;
            const done = items.filter(x => x.section_id === sec.id && respByItem.get(x.id)?.answer).length;
            return <button key={sec.id} type="button" className={`sec-chip ${done === total && total ? 'done' : ''}`}
              onClick={() => { setOpen(o => ({ ...o, [sec.id]: true })); setTimeout(() => document.getElementById(`sec-${sec.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }}>
              <span className="sec-chip-n">{i + 1}</span>{displayText(sec.title).trim().split(/[\s,]+/).find(w => w.length > 3) ?? displayText(sec.title)}<span className="num-font small">{done}/{total}</span></button>;
          })}
        </nav>) : null}

      <div className="row gap wrap between">
        <label className="row gap small"><input type="checkbox" checked={onlyPending} onChange={e => setOnlyPending(e.target.checked)} /> Mostrar sólo sin responder</label>
        <div className="row gap"><Button variant="ghost" className="btn-sm" onClick={() => setOpen(Object.fromEntries(sections.map(s => [s.id, true])))}>Expandir todo</Button><Button variant="ghost" className="btn-sm" onClick={() => setOpen({})}>Contraer</Button></div>
      </div>

      {sections.map((sec: TemplateSection) => {
        const its = items.filter(i => i.section_id === sec.id).sort((a, b) => a.sort_order - b.sort_order).filter(i => !onlyPending || !respByItem.get(i.id)?.answer);
        const total = items.filter(i => i.section_id === sec.id).length;
        const done = items.filter(i => i.section_id === sec.id && respByItem.get(i.id)?.answer).length;
        const isOpen = open[sec.id] ?? sections.length <= 2;
        return (
          <div key={sec.id} id={`sec-${sec.id}`} className="section-block">
            <button className="section-head" onClick={() => setOpen({ ...open, [sec.id]: !isOpen })} aria-expanded={isOpen}>
              <h3>{displayText(sec.title)}</h3><span className="muted small">{done}/{total}</span><span aria-hidden>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen ? its.map(item => {
              const r = respByItem.get(item.id);
              const rid = responseId(audit.id, item.id);
              const fType = deviationFindingType(version, r?.answer);
              const linked = findingByResponse.get(rid);
              const options = answerOptions(version, item.response_type);
              return (
                <div key={item.id} id={`item-${item.id}`} className={`item ${r?.answer ? 'answered' : ''}`}>
                  <div className="item-q">
                    <span className="item-num">{item.original_number ?? item.code ?? ''}</span>
                    <div className="grow">
                      <div className="pre">{displayText(item.question)}</div>
                      <div className="row gap wrap small muted">
                        {item.process_id ? <Badge>{pName.get(item.process_id)}</Badge> : null}
                        {item.is_critical ? <Badge tone="bad">Crítico</Badge> : null}
                        {item.legal_reference ? <span>{item.legal_reference}</span> : null}
                        {opState.get(rid) === 'conflicto' ? <Link to="/admin/sync"><Badge tone="bad">Conflicto: resolver</Badge></Link>
                          : opState.get(rid) ? <Link to="/admin/sync"><Badge tone="bad">Error al sincronizar</Badge></Link>
                          : pendingResp.has(rid) ? <Badge tone="warn">Pendiente de sincronizar</Badge> : null}
                      </div>
                      {item.guidance ? <details className="small muted"><summary>Guía</summary><div className="pre">{item.guidance}</div></details> : null}
                    </div>
                  </div>
                  {options.length ? (
                    <div className="opts" role="radiogroup" aria-label="Respuesta">
                      {options.map(o => (
                        <button key={o.code} type="button" role="radio" aria-checked={r?.answer === o.code} disabled={locked}
                          className={`opt ${r?.answer === o.code ? `sel-${o.code}` : ''}`}
                          onClick={() => void setAnswer(item, { answer: r?.answer === o.code ? null : o.code })}>{o.label}</button>
                      ))}
                    </div>
                  ) : item.response_type === 'numerico' ? (
                    <Input type="number" disabled={locked} defaultValue={r?.numeric_value ?? ''} style={{ maxWidth: 200 }} onBlur={e => void setAnswer(item, { numeric_value: e.target.value === '' ? null : Number(e.target.value) })} />
                  ) : item.response_type === 'puntaje' ? (
                    <div className="opts">{[0, 1, 2, 3, 4, 5].map(n => <button key={n} type="button" disabled={locked} className={`opt ${r?.rating === n ? 'sel-ok' : ''}`} onClick={() => void setAnswer(item, { rating: n })}>{n}</button>)}</div>
                  ) : null}
                  <TextArea rows={2} placeholder={item.response_type === 'texto' ? 'Respuesta' : 'Evidencias / comentarios'} disabled={locked}
                    defaultValue={(item.response_type === 'texto' ? r?.text_value : r?.comment) ?? ''} key={`${rid}-${r?.updated_at ?? ''}`}
                    onBlur={e => { const v = e.target.value.trim() || null; const cur = item.response_type === 'texto' ? r?.text_value : r?.comment; if ((cur ?? null) !== v) void setAnswer(item, item.response_type === 'texto' ? { text_value: v } : { comment: v }); }} />
                  <div className="row gap wrap between">
                    <EvidenceStrip readOnly={locked && audit.status !== 'completada'} target={{ organization_id: orgId, audit_id: audit.id, response_id: rid }} filter={{ response_id: rid }}
                      beforeAdd={async () => { if (!r) await setAnswer(item, {}); }} />
                    {fType && writer && audit.status !== 'cerrada' ? (linked
                      ? <Link className="btn btn-ghost btn-sm" to={`/hallazgos/${linked.id}`}>Hallazgo {linked.code ?? ''} →</Link>
                      : <Button variant="secondary" className="btn-sm" onClick={() => setFindingFor({ audit_id: audit.id, response_id: rid, item_id: item.id, finding_type: fType as Finding['finding_type'], title: displayText(item.question).replace(/\s+/g, ' ').trim().slice(0, 200), description: r?.comment ?? '', company_id: audit.company_id, location_id: audit.location_id })}>Registrar hallazgo</Button>) : null}
                  </div>
                  {item.evidence_required_on_fail && fType && !evidCount.get(rid) ? <div className="small" style={{ color: 'var(--warn)' }}>Este requisito exige evidencia ante un desvío.</div> : null}
                </div>
              );
            }) : null}
          </div>
        );
      })}

      <div id="acta" className="anchor-target" />
      <ClosingMeetingCard audit={audit} writer={writer} companyName={audit.company_id ? cName.get(audit.company_id) ?? '' : ''} leadName={audit.lead_auditor_id ? people.get(audit.lead_auditor_id) ?? '' : ''} />

      <div className="grid grid-2">
        <ParticipantsCard audit={audit} access={access} />
        <Card title="Historial de la auditoría"><RecordHistory table="hse_audits" id={audit.id} /></Card>
      </div>

      <Card title={`Hallazgos de la auditoría (${findings.length})`} actions={writer && !['cerrada', 'cancelada'].includes(audit.status) ? <Button className="btn-sm" variant="secondary" onClick={() => setFindingFor({ audit_id: audit.id, company_id: audit.company_id, location_id: audit.location_id })}>Hallazgo general</Button> : null}>
        {findings.length === 0 ? <p className="muted small">Sin hallazgos.</p> : (
          <div className="table-wrap"><table className="t"><tbody>{findings.map(f => (
            <tr key={f.id}><td className="mono">{f.code ?? '—'}</td><td><Link to={`/hallazgos/${f.id}`}>{f.title}</Link></td><td>{LABELS.findingType[f.finding_type]}</td><td><Badge tone={f.status === 'abierto' ? 'warn' : f.status === 'en_tratamiento' ? 'info' : 'ok'}>{LABELS.findingStatus[f.status]}</Badge></td></tr>
          ))}</tbody></table></div>
        )}
      </Card>

      {findingFor ? <FindingForm initial={findingFor} onClose={() => setFindingFor(null)} /> : null}

      {life.modals}

      <Modal open={!!edit} title="Datos de la auditoría" onClose={() => setEdit(null)} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancelar</Button><Button onClick={saveDetails}>Guardar</Button></>}>
        {edit ? <>
          <Field label="Título"><Input value={edit.title ?? ''} onChange={e => setEdit({ ...edit, title: e.target.value })} /></Field>
          <div className="grid grid-2">
            <Field label="Empresa"><Select placeholder="—" value={edit.company_id ?? ''} onChange={e => setEdit({ ...edit, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Ubicación"><Select placeholder="—" value={edit.location_id ?? ''} onChange={e => setEdit({ ...edit, location_id: e.target.value })} options={locations.map(l => ({ value: l.id, label: l.name }))} /></Field>
            <Field label="Fecha"><Input type="date" value={edit.scheduled_date ?? ''} onChange={e => setEdit({ ...edit, scheduled_date: e.target.value })} /></Field>
            <Field label="Tipo"><Select value={edit.audit_type} onChange={e => setEdit({ ...edit, audit_type: e.target.value as Audit['audit_type'] })} options={Object.entries(LABELS.auditType).map(([value, label]) => ({ value, label }))} /></Field>
          </div>
          <Field label="Equipo auditor"><Input value={edit.audit_team ?? ''} onChange={e => setEdit({ ...edit, audit_team: e.target.value })} /></Field>
          <Field label="Alcance"><TextArea value={edit.scope ?? ''} onChange={e => setEdit({ ...edit, scope: e.target.value })} /></Field>
          <Field label="Conclusiones"><TextArea rows={4} value={edit.summary ?? ''} onChange={e => setEdit({ ...edit, summary: e.target.value })} /></Field>
        </> : null}
      </Modal>
    </div>
  );
}
