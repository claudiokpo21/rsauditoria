import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useOrgRows } from '../../db/hooks';
import { useAuth } from '../auth/AuthProvider';
import { useSyncState } from '../../sync/scheduler';
import { Badge, Card, Empty, Input, Select, Stat, fmtDate, fmtDateTime, fmtNum } from '../../components/ui';
import { useProfiles } from '../../db/hooks';
import { loadSummary, type SummaryResult } from '../reports/summary';
import { LABELS, type Action, type Audit, type Company, type Finding, type TemplateCategory, type TemplateVersion } from '../../types';
import { BandChip } from '../../components/ResultSheet';
import { bandFor, bandStyle } from '../../scoring/bands';
import { evaluate, isSituacionConfig } from '../../scoring/engine';
import { can } from '../auth/AuthProvider';
import { DemoButton } from '../demo/DemoButton';

function Bars({ data, max, fmt = (v: number) => String(v), color }: { data: { label: string; value: number; color?: string }[]; max?: number; fmt?: (v: number) => string; color?: string }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value));
  if (!data.length) return <p className="muted small">Sin datos.</p>;
  return (
    <div className="bars">{data.map(d => (
      <div className="bar-row" key={d.label}>
        <span className="small" title={d.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
        <span className="bar-track"><span className="bar-fill" style={{ width: `${(100 * d.value) / m}%`, background: d.color ?? color }} /></span>
        <span className="num small">{fmt(d.value)}</span>
      </div>))}
    </div>
  );
}
const BAND_ORDER = ['Muy Bueno', 'Bueno', 'Regular', 'Crítico'];

/** Anillo de progreso con el valor en el centro (color de la banda). */
function Ring({ value, max, color, text, sub }: { value: number; max: number; color: string; text: string; sub: string }) {
  const r = 70, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, value / (max || 1)));
  return (
    <svg className="ring" viewBox="0 0 168 168" role="img" aria-label={`${text} ${sub}`}>
      <circle cx="84" cy="84" r={r} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="16" />
      <circle cx="84" cy="84" r={r} fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${(f * c).toFixed(1)} ${c.toFixed(1)}`} transform="rotate(-90 84 84)" />
      <text x="84" y="90" textAnchor="middle" className="ring-val">{text}</text>
      <text x="84" y="114" textAnchor="middle" className="ring-sub">{sub}</text>
    </svg>
  );
}

/** Distribución de calificaciones como barra apilada con los colores de la planilla. */
function BandStrip({ bands, compact }: { bands: Record<string, number>; compact?: boolean }) {
  const rows = Object.entries(bands).sort((a, b) => (BAND_ORDER.indexOf(a[0]) + 99 * +(BAND_ORDER.indexOf(a[0]) < 0)) - (BAND_ORDER.indexOf(b[0]) + 99 * +(BAND_ORDER.indexOf(b[0]) < 0)));
  const total = rows.reduce((t, [, v]) => t + v, 0);
  if (!total) return <p className="muted small">Sin auditorías calificadas en el período.</p>;
  return (
    <div className="stack">
      <div className="row" style={{ height: compact ? 10 : 28, borderRadius: compact ? 99 : 6, overflow: 'hidden', border: compact ? 0 : '1px solid var(--line-2)' }} role="img" aria-label={rows.map(([k, v]) => `${k}: ${v}`).join(', ')}>
        {rows.map(([k, v]) => { const st = bandStyle(k); return <span key={k} title={`${k}: ${v}`} style={{ width: `${(100 * v) / total}%`, height: '100%', background: st?.bg ?? 'var(--line-2)' }} />; })}
      </div>
      <div className={`row gap wrap ${compact ? 'band-legend' : ''}`}>{rows.map(([k, v]) => <span key={k} className="row gap small"><BandChip label={k} /> <strong>{v}</strong></span>)}</div>
    </div>
  );
}

const entries = (o: Record<string, number>, lab: Record<string, string>) => Object.entries(o).map(([k, v]) => ({ label: lab[k] ?? (k === 'sin_categoria' ? 'Sin categoría' : k), value: v })).sort((a, b) => b.value - a.value);

/**
 * Indicadores con datos reales: con conexión los calcula el servidor (hse_report_summary, bajo los
 * permisos del usuario); sin conexión, el dispositivo con lo sincronizado. Los resultados de auditoría
 * son siempre los oficiales calculados por el servidor al completar.
 */
export function DashboardPage() {
  const { orgId } = useAuth();
  const sync = useSyncState();
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const anyAudit = useLiveQuery(async () => orgId ? (await db.hse_audits.where('organization_id').equals(orgId).count()) > 0 : false, [orgId]);
  const [from, setFrom] = useState(new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [company, setCompany] = useState('');
  const [res, setRes] = useState<SummaryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadSummary(orgId, from || null, to || null, company || null)
      .then(r => { if (alive) { setRes(r); setError(null); } })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, [orgId, from, to, company, sync.lastAt, sync.online]);

  const S = res?.data;
  const { role } = useAuth();
  const versions = useOrgRows<TemplateVersion>('hse_template_versions') ?? [];
  const audits = useOrgRows<Audit>('hse_audits') ?? [];
  const actions = useOrgRows<Action>('hse_actions') ?? [];
  const findings = useOrgRows<Finding>('hse_findings') ?? [];
  const people = useProfiles();
  const { current, userId } = useAuth();
  const profileName = userId ? people.get(userId) : null;
  const inProgress = useLiveQuery(async () => {
    if (!orgId || !userId) return null;
    const mine = new Set((await db.hse_audit_participants.where('user_id').equals(userId).toArray()).filter(p => !p.deleted_at).map(p => p.audit_id));
    const a = (await db.hse_audits.where('organization_id').equals(orgId).toArray())
      .filter(x => !x.deleted_at && x.status === 'en_curso' && (x.lead_auditor_id === userId || mine.has(x.id)))
      .sort((x, y) => (y.started_at ?? y.scheduled_date ?? '').localeCompare(x.started_at ?? x.scheduled_date ?? ''))[0] as Audit | undefined;
    if (!a) return null;
    const total = await db.hse_template_items.where('version_id').equals(a.template_version_id).count();
    const answered = (await db.hse_audit_responses.where('audit_id').equals(a.id).toArray()).filter(r => !r.deleted_at && (r.answer || r.text_value || r.numeric_value !== null || r.rating !== null)).length;
    // resultado parcial con las reglas de la versión (el oficial lo calcula el servidor al completar)
    const version = await db.hse_template_versions.get(a.template_version_id);
    let partial: { value: number | null; band: string | null; situ: boolean; cfg: unknown; sections: { title: string; score: number | null }[] } | null = null;
    if (version) {
      const secs = await db.hse_template_sections.where('version_id').equals(a.template_version_id).toArray();
      const its = await db.hse_template_items.where('version_id').equals(a.template_version_id).toArray();
      const resp = (await db.hse_audit_responses.where('audit_id').equals(a.id).toArray()).filter(r => !r.deleted_at);
      const answers = Object.fromEntries(resp.filter(r => r.answer).map(r => [r.item_id, r.answer as string]));
      const situ = version.scoring_method === 'situacion_promedio_secciones';
      const res = evaluate(version, secs.filter(x => !x.deleted_at), its.filter(x => !x.deleted_at), answers);
      partial = { value: situ ? res.final ?? null : res.compliance_pct ?? null, band: situ ? res.band ?? null : null, situ, cfg: version.scoring_config,
        sections: res.sections.map(x => ({ title: String((secs.find(z => z.id === x.section_id)?.title ?? '')).trim(), score: x.score === null || x.score === undefined ? null : Number(x.score) })) };
    }
    return { audit: a, total, answered: Math.min(answered, total), partial };
  }, [orgId, userId]);
  const cName = new Map(companies.map(c => [c.id, c.name]));
  const vById = new Map(versions.map(v => [v.id, v]));
  const bandsOfTemplate = (templateId: string) => {
    const v = versions.filter(x => x.template_id === templateId && x.status !== 'borrador').sort((a, b) => b.version_number - a.version_number)[0];
    return v && isSituacionConfig(v.scoring_config) ? v.scoring_config.bands : undefined;
  };
  const latest = audits.filter(a => !a.deleted_at && ['completada', 'cerrada'].includes(a.status) && (a.score !== null || a.compliance_pct !== null))
    .filter(a => !company || a.company_id === company)
    .sort((a, b) => (b.completed_at ?? b.scheduled_date ?? '').localeCompare(a.completed_at ?? a.scheduled_date ?? '')).slice(0, 8);
  const lastBand = new Map<string, Audit>();
  for (const a of audits.filter(x => !x.deleted_at && x.result_band && x.company_id && ['completada', 'cerrada'].includes(x.status))
    .sort((x, y) => (x.completed_at ?? '').localeCompare(y.completed_at ?? ''))) lastBand.set(a.company_id!, a);
  const firstName = (profileName ?? '').split(' ')[0];
  const hour = new Date().getHours();
  const hello = hour < 13 ? 'Buen día' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = audits.filter(a => !a.deleted_at && a.status === 'planificada' && (!company || a.company_id === company))
    .sort((a, b) => (a.scheduled_date ?? '9999').localeCompare(b.scheduled_date ?? '9999')).slice(0, 5);
  const attention = actions.filter(x => !x.deleted_at && ['pendiente', 'en_curso'].includes(x.status))
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const findingById = new Map(findings.map(f => [f.id, f]));
  const heat = heatmap(audits, vById, company);
  // tarjeta principal: último resultado oficial o, si no hay, la auditoría en curso (parcial)
  const lastDone = latest[0];
  const subj = lastDone ? (() => {
    const v = vById.get(lastDone.template_version_id); const sc = v?.scoring_config; const sit = v?.scoring_method === 'situacion_promedio_secciones';
    return { audit: lastDone, partial: false, situ: sit, value: sit ? Number(lastDone.score) : Number(lastDone.compliance_pct), band: lastDone.result_band,
      max: sit && sc && isSituacionConfig(sc) ? sc.scale_max : 100, bands: sc && isSituacionConfig(sc) ? sc.bands : undefined,
      sections: ((lastDone.section_results as { title: string; score: number | null }[] | null) ?? []).map(x => ({ title: String(x.title).trim(), score: x.score === null ? null : Number(x.score) })) };
  })() : inProgress?.partial && inProgress.partial.value !== null ? (() => {
    const sc = inProgress.partial.cfg;
    return { audit: inProgress.audit, partial: true, situ: inProgress.partial.situ, value: inProgress.partial.value, band: inProgress.partial.band,
      max: inProgress.partial.situ && isSituacionConfig(sc) ? sc.scale_max : 100, bands: isSituacionConfig(sc) ? sc.bands : undefined, sections: inProgress.partial.sections };
  })() : null;
  const subjSections = subj ? subj.sections.filter(x => x.score !== null) : [];
  const weakest = subjSections.length ? [...subjSections].sort((a, b) => Number(a.score) - Number(b.score))[0] : null;
  const openFindings = findings.filter(f => !f.deleted_at && (f.status === 'abierto' || f.status === 'en_tratamiento'))
    .sort((a, b) => (a.finding_type.startsWith('n') ? 0 : 1) - (b.finding_type.startsWith('n') ? 0 : 1) || (b.detected_at ?? '').localeCompare(a.detected_at ?? ''));
  const ftLabel = (t: string) => t === 'observacion' ? 'OBS' : t === 'oportunidad_mejora' ? 'OPM' : 'NC';

  return (
    <div className="stack-lg">
      <header className="dash-head">
        <div className="dash-hello">
          <span className="small muted">{current?.organization_name} · {res ? (res.source === 'servidor' ? `Datos del servidor · ${fmtDateTime(res.data.generated_at)}` : `Sin conexión: datos del dispositivo${res.lastSync ? ` (sincronizado ${fmtDateTime(res.lastSync)})` : ''}`) : 'Cargando…'}</span>
          <h1>{hello}{firstName ? `, ${firstName}` : ''}</h1>
        </div>
        {can(role, 'audit') ? <Link className="btn btn-accent" to="/auditorias">+ Nueva auditoría</Link> : null}
      </header>
      <details className="dash-filters" open={!!company}>
        <summary>Período y empresa · {fmtDate(from)} a {fmtDate(to)}{company ? ` · ${cName.get(company) ?? ''}` : ''}</summary>
        <div className="row gap wrap">
          <label className="small muted">Desde</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 160 }} />
          <label className="small muted">Hasta</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 160 }} />
          <Select placeholder="Todas las empresas" value={company} onChange={e => setCompany(e.target.value)} options={companies.map(c => ({ value: c.id, label: c.name }))} style={{ maxWidth: 260 }} />
        </div>
      </details>
      {error ? <div className="alert alert-bad">{error}</div> : null}
      {anyAudit === false ? <Empty>
          <div className="stack" style={{ alignItems: 'center' }}>
            <strong>Todavía no hay auditorías en esta organización.</strong>
            <span>Empiece por <Link to="/plantillas">publicar una plantilla</Link> y <Link to="/auditorias">crear una auditoría</Link>, o explore la aplicación con datos ficticios en una organización aparte.</span>
            {can(role, 'admin') ? <DemoButton /> : null}
          </div>
        </Empty> : !S ? null : <>
        <section className="bento">
          <div className="tile tile-dark hero-tile">
            <div className="row between gap"><span className="tile-kicker">{subj ? (subj.partial ? 'En curso · resultado parcial' : 'Último resultado') : 'Resultado'}</span>
              {subj?.audit.code ? <span className="pill pill-glass">{subj.audit.code}</span> : null}</div>
            {subj ? (<>
              <div className="hero-body">
                <Ring value={subj.value} max={subj.max} color={bandStyle(subj.band)?.bg ?? '#92D050'} text={subj.situ ? fmtNum(subj.value) : `${fmtNum(subj.value, 0)}%`} sub={subj.situ ? `de ${fmtNum(subj.max, 0)}` : 'cumplimiento'} />
                <div className="hero-info">
                  {subj.band ? <BandChip label={subj.band} /> : null}
                  <strong>{subj.audit.company_id ? cName.get(subj.audit.company_id) : subj.audit.title}</strong>
                  <span>{subj.audit.title}<br />{fmtDate(subj.audit.scheduled_date ?? subj.audit.completed_at)}</span>
                </div>
              </div>
              {subj.bands ? <div className="band-scale" aria-hidden>{[...subj.bands].sort((x, y) => (x.min ?? 0) - (y.min ?? 0)).map(b => <span key={b.label} style={{ flex: ((b.max ?? subj.max) - (b.min ?? 0)) || 1, background: bandStyle(b.label)?.bg }} />)}</div> : null}
              {subj.partial ? <Link className="btn btn-accent" to={`/auditorias/${subj.audit.id}`}>{inProgress && inProgress.answered >= inProgress.total ? 'Revisar y completar' : 'Continuar auditoría'}</Link>
                : <Link className="btn btn-glass" to={`/auditorias/${subj.audit.id}`}>Ver auditoría</Link>}
            </>) : <p className="tile-muted">Todavía no hay auditorías completadas en el período.</p>}
          </div>
          <div className="tile req-tile">
            <div className="row between wrap gap"><h2 className="tile-title">Por requisito</h2><span className="small muted">{subj ? `${subj.audit.code ?? ''} · colores de la planilla` : ''}</span></div>
            {subjSections.length ? subjSections.map(x => {
              const b = subj!.situ ? bandFor(x.score, subj!.bands) : null; const st = bandStyle(b);
              return (
                <div key={x.title} className="req-bar" title={b ?? undefined}>
                  <span className="req-name">{x.title}</span>
                  <span className="req-track"><span style={{ width: `${Math.max(2, (100 * Number(x.score)) / (subj!.max || 100))}%`, background: st?.bg ?? 'var(--primary)' }} /></span>
                  <span className="num-font req-val">{subj!.situ ? fmtNum(x.score) : `${fmtNum(x.score, 0)}%`}</span>
                </div>);
            }) : <p className="muted small">Aparece cuando hay una auditoría con resultados por requisito.</p>}
            {weakest && subjSections.length > 1 ? <p className="small muted" style={{ margin: '.4rem 0 0' }}>Punto más débil: <strong>{weakest.title}</strong>.</p> : null}
          </div>
        </section>

        <section className="kpis kpis-v2">
          <Stat label="Hallazgos abiertos" value={S.findings.open} sub={`${openFindings.filter(f => !['observacion', 'oportunidad_mejora'].includes(f.finding_type)).length} NC · ${S.findings.overdue} vencidos · ${S.findings.recurrent} recurrentes`} tone={S.findings.overdue ? 'bad' : S.findings.open ? 'warn' : 'ok'} />
          <Stat label="Acciones vencidas" value={S.actions.overdue} sub={`${S.actions.due_7_days} vencen en 7 días`} tone={S.actions.overdue ? 'bad' : 'ok'} />
          <Stat label="Auditorías" value={S.audits.total} sub={`${(S.audits.by_status.completada ?? 0) + (S.audits.by_status.cerrada ?? 0)} completadas · ${S.audits.overdue_planned} atrasadas`} tone={S.audits.overdue_planned ? 'warn' : undefined} />
          <Stat label="Cumplimiento promedio" value={S.results.avg_compliance === null ? '—' : `${fmtNum(S.results.avg_compliance, 1)} %`} sub="resultados oficiales" tone={S.results.avg_compliance === null ? undefined : S.results.avg_compliance >= 80 ? 'ok' : S.results.avg_compliance >= 60 ? 'warn' : 'bad'} />
          <Stat label="Pendientes de revisión" value={S.audits.pending_review} sub={`${S.audits.ready_to_close} listas para cerrar`} />
          <Stat label="Eficacia verificada" value={`${S.findings.effective} / ${S.findings.effective + S.findings.not_effective}`} sub={`${S.findings.pending_verification} por verificar`} tone={S.findings.not_effective ? 'warn' : undefined} />
        </section>

        <section className="bento">
          <div className="tile feed-tile">
            <div className="row between wrap gap"><h2 className="tile-title">Hallazgos abiertos</h2><Link className="small" to="/hallazgos" style={{ fontWeight: 600 }}>Ver los {openFindings.length}</Link></div>
            {openFindings.length === 0 ? <p className="muted small">No hay hallazgos abiertos.</p> : (
              <ul className="plain feed">{openFindings.slice(0, 5).map(f => (
                <li key={f.id}><Link to={`/hallazgos/${f.id}`} className="feed-item">
                  <span className={`pill pill-${ftLabel(f.finding_type).toLowerCase()}`}>{ftLabel(f.finding_type)}</span>
                  <span className="grow"><strong>{f.title}</strong><span className="small muted">{f.code ?? ''}{f.company_id ? ` · ${cName.get(f.company_id) ?? ''}` : ''} · {f.responsible_user_id ? people.get(f.responsible_user_id) : 'sin responsable'}</span></span>
                  <span className="feed-cta">{f.responsible_user_id ? 'Ver' : 'Asignar'}</span>
                </Link></li>))}
              </ul>)}
          </div>
          {inProgress ? (
            <div className="tile steps-tile">
              <h2 className="tile-title">Siguiente paso</h2>
              <ol className="steps">
                <li className={inProgress.answered >= inProgress.total ? 'now' : ''}><strong>{inProgress.answered >= inProgress.total ? `Completar ${inProgress.audit.code ?? 'la auditoría'}` : `Responder ${inProgress.total - inProgress.answered} requisitos`}</strong><span>{inProgress.answered}/{inProgress.total} respondidas{inProgress.answered >= inProgress.total ? ': falta confirmar el resultado oficial' : ''}.</span></li>
                <li><strong>Reunión de cierre y firmas</strong><span>Acta con el referente de la empresa auditada.</span></li>
                <li><strong>Enviar informe y pedir plan de acción</strong><span>{findings.filter(f => !f.deleted_at && f.audit_id === inProgress.audit.id).length} hallazgos para asignar.</span></li>
              </ol>
              <Link className="btn btn-accent" to={`/auditorias/${inProgress.audit.id}`}>{inProgress.answered >= inProgress.total ? 'Revisar y completar' : 'Continuar auditoría'}</Link>
            </div>
          ) : (
            <Card title="Próximas auditorías" actions={<Link className="btn btn-ghost btn-sm" to="/auditorias">Ver todas</Link>}>
              {upcoming.length === 0 ? <p className="muted small">No hay auditorías planificadas.</p> : (
                <ul className="plain date-list">{upcoming.map(a => { const d = a.scheduled_date ? new Date(a.scheduled_date + 'T12:00:00') : null; const late = !!a.scheduled_date && a.scheduled_date < today; return (
                  <li key={a.id}><Link to={`/auditorias/${a.id}`} className="date-item">
                    <span className={`date-box ${late ? 'late' : ''}`}><strong className="num-font">{d ? String(d.getDate()).padStart(2, '0') : '—'}</strong><span>{d ? d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '').toUpperCase() : ''}</span></span>
                    <span><strong>{a.title}</strong><span className="small muted">{a.company_id ? cName.get(a.company_id) : ''}{late ? ' · atrasada' : ''}</span></span>
                  </Link></li>); })}
                </ul>)}
            </Card>
          )}
        </section>

        <section className="dash-row">
          <Card title="Mapa de requisitos por empresa" className="dash-wide">
            {!heat ? <p className="muted small">Aparece cuando hay auditorías completadas de más de una empresa, para compararlas por requisito.</p> : (<>
              <div className="heat-wrap"><table className="heat">
                <thead><tr><th>Empresa</th>{heat.cols.map(c => <th key={c} title={c}>{c}</th>)}<th>Final</th></tr></thead>
                <tbody>{heat.rows.map(r => (
                  <tr key={r.audit.id}><td><Link to={`/auditorias/${r.audit.id}`}>{cName.get(r.audit.company_id ?? '') ?? r.audit.title}</Link><span className="small muted"> · {fmtDate(r.audit.scheduled_date ?? r.audit.completed_at)}</span></td>
                    {r.cells.map((c, i) => { const st = bandStyle(c.band); return <td key={i} className="num-font" style={st ? { background: st.bg, color: st.fg } : undefined} title={c.band ?? undefined}>{c.value === null ? '—' : fmtNum(c.value)}</td>; })}
                    {(() => { const st = bandStyle(r.audit.result_band); return <td className="num-font heat-final" style={st ? { background: st.bg, color: st.fg } : undefined}>{fmtNum(r.audit.score)}</td>; })()}</tr>))}
                </tbody>
              </table></div>
              {heat.weakest ? <p className="small muted" style={{ margin: '.6rem 0 0' }}>Requisito más débil: <strong>{heat.weakest.title}</strong> (promedio {fmtNum(heat.weakest.avg)}){heat.weakest.count > 1 ? `, bajo en ${heat.weakest.count} empresas` : ''}.</p> : null}
            </>)}
          </Card>
          <Card title="Próximas auditorías" actions={<Link className="btn btn-ghost btn-sm" to="/auditorias">Ver todas</Link>}>
            {upcoming.length === 0 ? <p className="muted small">No hay auditorías planificadas.</p> : (
              <ul className="plain date-list">{upcoming.map(a => { const d = a.scheduled_date ? new Date(a.scheduled_date + 'T12:00:00') : null; const late = !!a.scheduled_date && a.scheduled_date < today; return (
                <li key={a.id}><Link to={`/auditorias/${a.id}`} className="date-item">
                  <span className={`date-box ${late ? 'late' : ''}`}><strong className="num-font">{d ? String(d.getDate()).padStart(2, '0') : '—'}</strong><span>{d ? d.toLocaleDateString('es-AR', { month: 'short' }).replace('.', '').toUpperCase() : ''}</span></span>
                  <span><strong>{a.title}</strong><span className="small muted">{a.company_id ? cName.get(a.company_id) : ''}{late ? ' · atrasada' : ''}</span></span>
                </Link></li>); })}
              </ul>)}
          </Card>
        </section>

        <section className="dash-row">
          <Card title="Acciones que requieren atención" actions={<Link className="btn btn-ghost btn-sm" to="/acciones">Plan de acción</Link>}>
            {attention.length === 0 ? <p className="muted small">No hay acciones abiertas.</p> : (
              <ul className="plain person-list">{attention.map(x => {
                const who = x.responsible_user_id ? people.get(x.responsible_user_id) ?? 'Responsable' : x.responsible_name ?? (x.responsible_company_id ? cName.get(x.responsible_company_id) : null) ?? 'Sin responsable';
                const days = Math.round((new Date(x.due_date + 'T12:00:00').getTime() - Date.now()) / 864e5);
                const tone = days < 0 ? 'bad' : days <= 7 ? 'warn' : 'neutral';
                const f = findingById.get(x.finding_id);
                return (
                  <li key={x.id}><Link to={`/hallazgos/${x.finding_id}`} className="person-item">
                    <span className={`avatar avatar-${tone}`} aria-hidden>{who.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase()).join('')}</span>
                    <span className="grow"><strong>{x.description}</strong><span className="small muted">{who}{f?.company_id ? ` · ${cName.get(f.company_id) ?? ''}` : ''}</span></span>
                    <Badge tone={tone}>{days < 0 ? `Vencida ${-days} d` : days === 0 ? 'Vence hoy' : `En ${days} d`}</Badge>
                  </Link></li>);
              })}</ul>)}
          </Card>
          <section className="sheet">
            <div className="sheet-top" style={{ gridTemplateColumns: '1fr' }}>
              <div className="row between wrap gap"><h3>Últimos resultados</h3><Link className="btn btn-ghost btn-sm" to="/auditorias">Ver auditorías</Link></div>
              {latest.length === 0 ? <p className="muted small">Todavía no hay auditorías completadas.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="sheet-table">
                    <thead><tr><th>Auditoría</th><th className="hide-xs">Empresa</th><th>Resultado</th><th>Calificación</th></tr></thead>
                    <tbody>{latest.map(a => {
                      const v = vById.get(a.template_version_id);
                      const situ = v?.scoring_method === 'situacion_promedio_secciones';
                      const st = bandStyle(a.result_band);
                      return (
                        <tr key={a.id}>
                          <td><Link to={`/auditorias/${a.id}`}>{a.code ?? a.title}</Link><div className="small muted" style={{ fontWeight: 400 }}>{a.title}</div></td>
                          <td className="hide-xs small">{a.company_id ? cName.get(a.company_id) : '—'}</td>
                          <td className="eval" style={st ? { background: st.bg, color: st.fg } : undefined}>{situ ? fmtNum(a.score) : `${fmtNum(a.compliance_pct, 1)} %`}</td>
                          <td>{a.result_band ? <BandChip label={a.result_band} /> : <span className="muted small">Sin bandas</span>}</td>
                        </tr>);
                    })}</tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </section>
        <h2 className="dash-sub">Más indicadores</h2>
        <div className="grid grid-4">
          <Stat label="Por verificar eficacia" value={S.findings.pending_verification} />
          <Stat label="Días promedio al cierre" value={S.findings.avg_days_to_close === null ? '—' : fmtNum(S.findings.avg_days_to_close, 1)} />
        </div>
        <div className="grid grid-2">
          <Card title="Cumplimiento por categoría de plantilla"><Bars data={S.by_template_category.filter(c => c.avg_compliance !== null).map(c => ({ label: `${LABELS.category[c.category as TemplateCategory] ?? c.category} (${c.audits})`, value: Number(c.avg_compliance) }))} max={100} fmt={v => `${fmtNum(v, 1)} %`} /></Card>
          <Card title="Hallazgos por categoría"><Bars data={entries(S.findings.by_category, LABELS.category)} color="var(--accent)" /></Card>
          <Card title="Hallazgos por tipo"><Bars data={entries(S.findings.by_type, LABELS.findingType)} color="var(--accent)" /></Card>
          <Card title="Hallazgos por severidad"><Bars data={entries(S.findings.by_severity, LABELS.severity)} color="var(--bad)" /></Card>
          <Card title="Acciones por estado"><Bars data={entries(S.actions.by_status, LABELS.actionStatus)} /></Card>
          <Card title="Calificación de las auditorías"><BandStrip bands={S.results.bands} /></Card>
          <Card title="Cumplimiento promedio por mes (%)"><Bars data={S.monthly.filter(m => m.avg_compliance !== null).slice(-12).map(m => ({ label: m.month, value: Number(m.avg_compliance) }))} max={100} fmt={v => fmtNum(v, 1)} /></Card>
          <Card title="Resultado promedio por sección" className="span-all">
            {S.by_section.length === 0 ? <p className="muted small">Sin auditorías completadas en el período.</p> : (
              <div style={{ overflowX: 'auto' }}><table className="sheet-table"><thead><tr><th>Requisito / sección</th><th>Auditorías</th><th>Alcanzado (suma)</th><th>Objetivo (suma)</th><th>Evaluación promedio</th></tr></thead>
                <tbody>{S.by_section.slice(0, 30).map(x => <tr key={`${x.template_id}-${x.title}`}><td>{x.title.trim()}{new Set(S.by_section.map(z => z.template_id)).size > 1 ? <div className="small muted" style={{ fontWeight: 400 }}>{x.template_name}</div> : null}</td><td>{x.audits}</td><td>{fmtNum(x.raw, 0)}</td><td>{fmtNum(x.target, 0)}</td>{(() => { const b = x.scoring_method === 'ponderado' ? null : bandFor(x.avg_score, bandsOfTemplate(x.template_id)); const st = bandStyle(b);
                    return <td className="eval" style={st ? { background: st.bg, color: st.fg } : undefined} title={b ?? undefined}>{fmtNum(x.avg_score, 2)}{x.scoring_method === 'ponderado' ? ' %' : ''}</td>; })()}</tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
        <Card title="Empresas y contratistas">
          {S.by_company.length === 0 ? <p className="muted small">Sin auditorías asociadas a empresas.</p> : (
            <div className="table-wrap"><table className="t t-stack"><thead><tr><th>Empresa</th><th className="num">Auditorías</th><th className="num">Cumplimiento</th><th>Última calificación</th><th className="num">Hallazgos abiertos</th><th className="num">Recurrentes</th><th className="num">Acciones vencidas</th></tr></thead>
              <tbody>{S.by_company.map(r => <tr key={r.id}><td data-label="Empresa">{r.name}</td><td data-label="Auditorías" className="num">{r.audits}</td><td data-label="Cumplimiento" className="num">{r.avg_compliance === null ? '—' : `${fmtNum(r.avg_compliance, 1)} %`}</td><td data-label="Última calificación">{lastBand.get(r.id) ? <BandChip label={lastBand.get(r.id)!.result_band} /> : <span className="muted">—</span>}</td><td data-label="Abiertos" className="num">{r.open_findings}</td><td data-label="Recurrentes" className="num">{r.recurrent_findings ? <Badge tone="warn">{r.recurrent_findings}</Badge> : 0}</td><td data-label="Vencidas" className="num">{r.overdue_actions ? <Badge tone="bad">{r.overdue_actions}</Badge> : 0}</td></tr>)}</tbody></table></div>
          )}
        </Card>
        <Card title={`Hallazgos recurrentes (${S.recurrent.length})`} actions={<Link className="btn btn-ghost btn-sm" to="/hallazgos">Ver hallazgos</Link>}>
          {S.recurrent.length === 0 ? <p className="muted small">No hay requisitos incumplidos en dos o más auditorías de la misma empresa.</p> : (
            <div className="table-wrap"><table className="t t-stack"><thead><tr><th>Empresa</th><th>Requisito</th><th className="num">Veces</th><th>Hallazgos</th></tr></thead>
              <tbody>{S.recurrent.slice(0, 15).map(r => <tr key={r.recurrence_key}><td data-label="Empresa">{r.company ?? '—'}</td><td data-label="Requisito" className="small">{r.item_number ?? r.item_code ?? ''} {r.question}</td><td data-label="Veces" className="num">{r.occurrences}</td>
                <td data-label="Hallazgos" className="small">{r.findings.map(f => <Link key={f.id} to={`/hallazgos/${f.id}`} style={{ marginRight: '.4rem' }}>{f.code ?? '·'}</Link>)}</td></tr>)}</tbody></table></div>
          )}
        </Card>
      </>}
    </div>
  );
}

/** Mapa de requisitos: última auditoría con calificación por empresa, una columna por requisito (sección). */
function heatmap(audits: Audit[], vById: Map<string, TemplateVersion>, company: string) {
  const done = audits.filter(a => !a.deleted_at && ['completada', 'cerrada'].includes(a.status) && a.company_id && a.score !== null
    && vById.get(a.template_version_id)?.scoring_method === 'situacion_promedio_secciones' && Array.isArray(a.section_results) && (!company || a.company_id === company));
  if (!done.length) return null;
  // la plantilla más usada define las columnas
  const byTpl = new Map<string, number>();
  for (const a of done) { const t = vById.get(a.template_version_id)!.template_id; byTpl.set(t, (byTpl.get(t) ?? 0) + 1); }
  const tpl = [...byTpl.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const last = new Map<string, Audit>();
  for (const a of done.filter(a => vById.get(a.template_version_id)!.template_id === tpl)
    .sort((x, y) => (x.completed_at ?? x.scheduled_date ?? '').localeCompare(y.completed_at ?? y.scheduled_date ?? ''))) last.set(a.company_id!, a);
  const list = [...last.values()].sort((a, b) => Number(b.score) - Number(a.score));
  const secs = (a: Audit) => a.section_results as { title: string; score: number | null }[];
  const full = secs(list[0]).map(s => s.title.trim());
  const short = (t: string) => { const w = t.replace(/[,;].*$/, '').split(/\s+/).filter(x => x.length > 3); return (w[0] ?? t).replace(/^./, c => c.toUpperCase()).slice(0, 14); };
  const rows = list.map(a => {
    const cfg = vById.get(a.template_version_id)!.scoring_config;
    const bands = isSituacionConfig(cfg) ? cfg.bands : undefined;
    const m = new Map(secs(a).map(s => [s.title.trim(), s.score === null ? null : Number(s.score)]));
    return { audit: a, cells: full.map(t => { const v = m.get(t) ?? null; return { value: v, band: bandFor(v, bands) }; }) };
  });
  const avgs = full.map((t, i) => { const vs = rows.map(r => r.cells[i].value).filter((v): v is number => v !== null); return { title: t, avg: vs.length ? vs.reduce((x, y) => x + y, 0) / vs.length : 99, count: rows.filter(r => ['Crítico', 'Regular'].includes(r.cells[i].band ?? '')).length }; });
  const weakest = [...avgs].sort((a, b) => a.avg - b.avg)[0];
  return { cols: full.map(short), rows, weakest: weakest && weakest.avg < 99 ? weakest : null };
}
