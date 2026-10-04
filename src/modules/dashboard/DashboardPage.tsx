import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { useOrgRows } from '../../db/hooks';
import { useAuth } from '../auth/AuthProvider';
import { useSyncState } from '../../sync/scheduler';
import { Badge, Card, Empty, Input, PageHeader, Select, Stat, fmtDateTime, fmtNum } from '../../components/ui';
import { loadSummary, type SummaryResult } from '../reports/summary';
import { LABELS, type Company, type TemplateCategory } from '../../types';

function Bars({ data, max, fmt = (v: number) => String(v), color }: { data: { label: string; value: number }[]; max?: number; fmt?: (v: number) => string; color?: string }) {
  const m = max ?? Math.max(1, ...data.map(d => d.value));
  if (!data.length) return <p className="muted small">Sin datos.</p>;
  return (
    <div className="bars">{data.map(d => (
      <div className="bar-row" key={d.label}>
        <span className="small" title={d.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</span>
        <span className="bar-track"><span className="bar-fill" style={{ width: `${(100 * d.value) / m}%`, background: color }} /></span>
        <span className="num small">{fmt(d.value)}</span>
      </div>))}
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
  return (
    <div className="stack-lg">
      <PageHeader title="Dashboard" subtitle={res ? (res.source === 'servidor' ? `Datos del servidor · ${fmtDateTime(res.data.generated_at)}` : `Sin conexión: datos del dispositivo${res.lastSync ? ` (sincronizado ${fmtDateTime(res.lastSync)})` : ''}`) : 'Cargando…'}
        actions={<>
          <label className="small muted">Desde</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 150 }} />
          <label className="small muted">Hasta</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 150 }} />
          <Select placeholder="Todas las empresas" value={company} onChange={e => setCompany(e.target.value)} options={companies.map(c => ({ value: c.id, label: c.name }))} style={{ maxWidth: 220 }} />
        </>} />
      {error ? <div className="alert alert-bad">{error}</div> : null}
      {anyAudit === false ? <Empty>Todavía no hay auditorías. Empiece por <Link to="/plantillas">publicar una plantilla</Link> y <Link to="/auditorias">crear una auditoría</Link>.</Empty> : !S ? null : <>
        <div className="grid grid-4">
          <Stat label="Auditorías" value={S.audits.total} sub={`${(S.audits.by_status.completada ?? 0) + (S.audits.by_status.cerrada ?? 0)} completadas · ${S.audits.overdue_planned} atrasadas`} tone={S.audits.overdue_planned ? 'warn' : undefined} />
          <Stat label="Cumplimiento promedio" value={S.results.avg_compliance === null ? '—' : `${fmtNum(S.results.avg_compliance, 1)} %`} sub="resultados oficiales" tone={S.results.avg_compliance === null ? undefined : S.results.avg_compliance >= 80 ? 'ok' : S.results.avg_compliance >= 60 ? 'warn' : 'bad'} />
          <Stat label="Hallazgos abiertos" value={S.findings.open} sub={`${S.findings.overdue} vencidos · ${S.findings.recurrent} recurrentes`} tone={S.findings.overdue ? 'bad' : S.findings.open ? 'warn' : 'ok'} />
          <Stat label="Acciones vencidas" value={S.actions.overdue} sub={`${S.actions.due_7_days} vencen en 7 días · ${S.actions.completed ? fmtNum((100 * S.actions.completed_on_time) / S.actions.completed, 0) : '—'} % en plazo`} tone={S.actions.overdue ? 'bad' : 'ok'} />
        </div>
        <div className="grid grid-4">
          <Stat label="Pendientes de revisión" value={S.audits.pending_review} sub={`${S.audits.ready_to_close} listas para cerrar`} />
          <Stat label="Por verificar eficacia" value={S.findings.pending_verification} />
          <Stat label="Eficacia verificada" value={`${S.findings.effective} / ${S.findings.effective + S.findings.not_effective}`} sub="hallazgos eficaces / verificados" tone={S.findings.not_effective ? 'warn' : undefined} />
          <Stat label="Días promedio al cierre" value={S.findings.avg_days_to_close === null ? '—' : fmtNum(S.findings.avg_days_to_close, 1)} />
        </div>
        <div className="grid grid-2">
          <Card title="Cumplimiento por categoría de plantilla"><Bars data={S.by_template_category.filter(c => c.avg_compliance !== null).map(c => ({ label: `${LABELS.category[c.category as TemplateCategory] ?? c.category} (${c.audits})`, value: Number(c.avg_compliance) }))} max={100} fmt={v => `${fmtNum(v, 1)} %`} /></Card>
          <Card title="Hallazgos por categoría"><Bars data={entries(S.findings.by_category, LABELS.category)} color="var(--accent)" /></Card>
          <Card title="Hallazgos por tipo"><Bars data={entries(S.findings.by_type, LABELS.findingType)} color="var(--accent)" /></Card>
          <Card title="Hallazgos por severidad"><Bars data={entries(S.findings.by_severity, LABELS.severity)} color="var(--bad)" /></Card>
          <Card title="Acciones por estado"><Bars data={entries(S.actions.by_status, LABELS.actionStatus)} /></Card>
          <Card title="Calificación (bandas de la metodología)"><Bars data={entries(S.results.bands, {})} /></Card>
          <Card title="Cumplimiento promedio por mes (%)"><Bars data={S.monthly.filter(m => m.avg_compliance !== null).slice(-12).map(m => ({ label: m.month, value: Number(m.avg_compliance) }))} max={100} fmt={v => fmtNum(v, 1)} /></Card>
          <Card title="Resultado promedio por sección">
            {S.by_section.length === 0 ? <p className="muted small">Sin auditorías completadas en el período.</p> : (
              <div className="table-wrap"><table className="t"><thead><tr><th>Sección</th><th className="num">Auditorías</th><th className="num">Promedio</th></tr></thead>
                <tbody>{S.by_section.slice(0, 20).map(x => <tr key={`${x.template_id}-${x.title}`}><td className="small">{x.title.trim()}<div className="muted">{x.template_name}</div></td><td className="num">{x.audits}</td><td className="num">{fmtNum(x.avg_score, 2)}{x.scoring_method === 'ponderado' ? ' %' : ' /10'}</td></tr>)}</tbody></table></div>
            )}
          </Card>
        </div>
        <Card title="Empresas y contratistas">
          {S.by_company.length === 0 ? <p className="muted small">Sin auditorías asociadas a empresas.</p> : (
            <div className="table-wrap"><table className="t t-stack"><thead><tr><th>Empresa</th><th className="num">Auditorías</th><th className="num">Cumplimiento</th><th className="num">Hallazgos abiertos</th><th className="num">Recurrentes</th><th className="num">Acciones vencidas</th></tr></thead>
              <tbody>{S.by_company.map(r => <tr key={r.id}><td data-label="Empresa">{r.name}</td><td data-label="Auditorías" className="num">{r.audits}</td><td data-label="Cumplimiento" className="num">{r.avg_compliance === null ? '—' : `${fmtNum(r.avg_compliance, 1)} %`}</td><td data-label="Abiertos" className="num">{r.open_findings}</td><td data-label="Recurrentes" className="num">{r.recurrent_findings ? <Badge tone="warn">{r.recurrent_findings}</Badge> : 0}</td><td data-label="Vencidas" className="num">{r.overdue_actions ? <Badge tone="bad">{r.overdue_actions}</Badge> : 0}</td></tr>)}</tbody></table></div>
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
