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
import { answerOptions, deviationFindingType, evaluate } from '../../scoring/engine';
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, Select, Stat, TextArea, displayText, fmtDate, fmtNum, useToast } from '../../components/ui';
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

      <div className="grid grid-4">
        <Stat label="Avance" value={`${answered}/${scorable.length}`} sub={<div className="progress" style={{ marginTop: '.35rem' }}><span style={{ width: `${scorable.length ? (100 * answered) / scorable.length : 0}%` }} /></div>} />
        {version.scoring_method === 'situacion_promedio_secciones'
          ? <Stat label="Nota (0–10)" value={fmtNum(result?.final ?? null)} sub={result?.band ?? '—'} tone={result?.band === 'Crítico' ? 'bad' : result?.band === 'Regular' ? 'warn' : result?.band ? 'ok' : undefined} />
          : <Stat label="Cumplimiento" value={result?.compliance_pct !== null && result?.compliance_pct !== undefined ? `${fmtNum(result.compliance_pct, 1)} %` : '—'} sub={`${fmtNum(result?.score ?? null)} de ${fmtNum(result?.max_score ?? null)}`} />}
        <Stat label="Hallazgos" value={findings.length} sub={`${findings.filter(f => f.status === 'abierto' || f.status === 'en_tratamiento').length} abiertos`} />
        <Stat label="Críticos con desvío" value={result?.critical_failures ?? 0} tone={result?.critical_failures ? 'bad' : undefined} />
      </div>
      {audit.status === 'completada' || audit.status === 'cerrada'
        ? <div className="alert alert-info small"><strong>Resultado oficial</strong> (calculado por el servidor con la metodología de la versión v{version.version_number}): {audit.compliance_pct !== null || audit.result_band ? `${version.scoring_method === 'situacion_promedio_secciones' ? `nota ${fmtNum(audit.score)}` : `${fmtNum(audit.score)} / ${fmtNum(audit.max_score, 0)} (${fmtNum(audit.compliance_pct, 1)} %)`}${audit.result_band ? ` · ${audit.result_band}` : ''}` : 'pendiente de sincronización'}.</div>
        : <div className="muted small">Vista previa: se calcula en el dispositivo con las mismas reglas versionadas de la plantilla (v{version.version_number}) para orientar al auditor; no es el resultado oficial. El resultado oficial lo calcula el servidor al completar.</div>}
      {life.reviewInfo}
      {['planificada', 'en_curso'].includes(audit.status) && writer ? <ReadinessCard local={local} /> : null}

      {result?.sections.length ? (
        <Card title={audit.section_results && ['completada', 'cerrada'].includes(audit.status) ? 'Resultado por sección (vista previa; ver informe para el oficial)' : 'Resultado por sección (vista previa)'}>
          <div className="table-wrap"><table className="t"><thead><tr><th>Sección</th><th className="num">Obtenido</th><th className="num">Objetivo</th><th className="num">Nota</th><th className="num">Respondidos</th></tr></thead>
            <tbody>{result.sections.map(s => <tr key={s.section_id}><td>{displayText(s.title)}</td><td className="num">{s.raw}</td><td className="num">{s.target}</td><td className="num">{fmtNum(s.score)}</td><td className="num">{s.answered}/{s.items}</td></tr>)}</tbody></table></div>
          {version.scoring_method === 'situacion_promedio_secciones' ? <p className="muted small">Según la metodología de la plantilla, los requisitos sin responder suman 0 y cuentan en el objetivo.</p> : null}
        </Card>
      ) : null}

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
          <div key={sec.id} className="section-block">
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
                <div key={item.id} className="item">
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
