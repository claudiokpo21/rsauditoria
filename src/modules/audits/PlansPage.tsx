import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useOrgRows, useNameMap } from '../../db/hooks';
import { MANAGERS, auditAccess, useParticipants } from '../auth/access';
import { newId, saveRecord } from '../../db/repo';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, fmtDate, today, useToast } from '../../components/ui';
import { LABELS, type Audit, type Company, type Location, type Template, type TemplateVersion } from '../../types';
import type { ReportData } from '../reports/finalReport';

type PlanState = 'borrador' | 'enviado' | 'aprobado';
const STATE_LABEL: Record<PlanState, string> = { borrador: 'Borrador', enviado: 'Enviado al cliente', aprobado: 'Aceptado por el cliente' };
const STATE_TONE: Record<PlanState, 'neutral' | 'info' | 'ok'> = { borrador: 'neutral', enviado: 'info', aprobado: 'ok' };
const planState = (a: Audit): PlanState => ((a.report_data as ReportData | null | undefined)?.plan_approval?.status ?? 'borrador') as PlanState;

/**
 * Planes de auditoría: el primer paso. Se arma el plan, se envía al cliente y, con su
 * aceptación registrada, la auditoría queda habilitada para ejecutarse.
 */
export function PlansPage() {
  const { orgId, role, userId, current } = useAuth();
  const participants = useParticipants(orgId);
  const nav = useNavigate();
  const toast = useToast();
  const audits = useOrgRows<Audit>('hse_audits') ?? [];
  const templates = useOrgRows<Template>('hse_templates') ?? [];
  const versions = useOrgRows<TemplateVersion>('hse_template_versions') ?? [];
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const locations = useOrgRows<Location>('hse_locations') ?? [];
  const cName = useNameMap('hse_companies');
  const [tab, setTab] = useState<'pendientes' | 'aceptados' | 'todos'>('pendientes');
  const [form, setForm] = useState<Partial<Audit> | null>(null);
  const isManager = !!role && MANAGERS.includes(role);

  const published = versions.filter(v => v.status === 'publicada').sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''));
  const tName = new Map(templates.map(t => [t.id, t.name]));

  const visible = useMemo(() => audits.filter(a => a.status !== 'cancelada' && auditAccess(a, role, userId, participants, current?.company_id) !== null), [audits, role, userId, participants, current]);
  const pend = visible.filter(a => a.status === 'planificada' && planState(a) !== 'aprobado');
  const acc = visible.filter(a => planState(a) === 'aprobado');
  const list = (tab === 'pendientes' ? pend : tab === 'aceptados' ? acc : visible)
    .sort((a, b) => (b.scheduled_date ?? b.created_at ?? '').localeCompare(a.scheduled_date ?? a.created_at ?? ''));

  const create = async () => {
    if (!form?.template_version_id) { toast('Elija la lista de verificación (plantilla)', 'bad'); return; }
    if (!form.company_id) { toast('Elija la empresa contratista', 'bad'); return; }
    const company = cName.get(form.company_id) ?? '';
    const a = await saveRecord<Audit>('hse_audits', {
      id: newId(), organization_id: orgId, template_version_id: form.template_version_id, company_id: form.company_id,
      location_id: form.location_id || null, title: (form.title?.trim() || `Auditoría de segunda parte – ${company}`).slice(0, 300),
      audit_type: form.audit_type ?? 'csms', status: 'planificada', scheduled_date: form.scheduled_date || today(),
      lead_auditor_id: userId, audit_team: null, scope: null,
    } as Audit);
    setForm(null);
    toast('Plan creado: completá los datos y el cronograma');
    nav(`/auditorias/${a.id}/plan`);
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Planes de auditoría"
        subtitle="Primer paso de cada auditoría: armás el plan, lo enviás al cliente y, con su aceptación, se habilita la auditoría."
        actions={can(role, 'audit') ? <Button onClick={() => setForm({ audit_type: 'csms', scheduled_date: today(), template_version_id: published[0]?.id })}
          disabled={!published.length} title={!published.length ? 'Publique una plantilla primero' : undefined}>Nuevo plan de auditoría</Button> : null} />

      <ol className="plan-steps" aria-label="Cómo funciona">
        <li><strong>Armar el plan</strong><span>Datos generales, objetivo, criterios y cronograma.</span></li>
        <li><strong>Enviarlo al cliente</strong><span>Descargás el PDF y lo marcás como enviado.</span></li>
        <li><strong>Registrar la aceptación</strong><span>Quién lo aceptó y cuándo. Se habilita la auditoría.</span></li>
      </ol>

      <div className="seg-tabs" role="tablist">
        {([['pendientes', `Pendientes de aceptación (${pend.length})`], ['aceptados', `Aceptados (${acc.length})`], ['todos', `Todos (${visible.length})`]] as const).map(([k, l]) =>
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {!list.length ? (
        <Empty>{tab === 'pendientes' ? <>No hay planes pendientes. Tocá <strong>Nuevo plan de auditoría</strong> para armar el próximo.</> : 'No hay planes en esta lista.'}</Empty>
      ) : (
        <div className="plan-list">
          {list.map(a => {
            const rd = (a.report_data ?? {}) as ReportData; const s = planState(a);
            return (
              <Link key={a.id} to={`/auditorias/${a.id}/plan`} className="plan-item">
                <span className="grow">
                  <strong>{rd.contractor || cName.get(a.company_id ?? '') || a.title}</strong>
                  <span className="small muted">{[a.code, rd.contract, rd.requesting_company].filter(Boolean).join(' · ') || a.title}</span>
                </span>
                <span className="plan-item-date small">{rd.dates_text || fmtDate(a.scheduled_date)}<span className="muted">{(rd.plan ?? []).length} actividades</span></span>
                <Badge tone={STATE_TONE[s]}>{STATE_LABEL[s]}</Badge>
                <span className="small muted plan-item-status">{LABELS.auditStatus[a.status]}</span>
                <span className="plan-item-cta">Abrir plan ›</span>
              </Link>);
          })}
        </div>
      )}

      <Modal open={!!form} title="Nuevo plan de auditoría" onClose={() => setForm(null)}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={() => void create()}>Crear y completar el plan</Button></>}>
        {form ? <div className="stack">
          <Field label="Empresa contratista" required><Select placeholder="Elegir…" value={form.company_id ?? ''} onChange={e => setForm({ ...form, company_id: e.target.value })}
            options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
          <Field label="Lista de verificación (plantilla)" required><Select placeholder="Elegir…" value={form.template_version_id ?? ''} onChange={e => setForm({ ...form, template_version_id: e.target.value })}
            options={published.map(v => ({ value: v.id, label: `${tName.get(v.template_id) ?? 'Plantilla'} · v${v.version_number}` }))} /></Field>
          <div className="grid grid-2">
            <Field label="Ubicación / equipo"><Select placeholder="—" value={form.location_id ?? ''} onChange={e => setForm({ ...form, location_id: e.target.value })}
              options={locations.filter(l => !form.company_id || !l.company_id || l.company_id === form.company_id).map(l => ({ value: l.id, label: l.name }))} /></Field>
            <Field label="Fecha prevista"><Input type="date" value={form.scheduled_date ?? ''} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
          </div>
          <Field label="Tipo"><Select value={form.audit_type ?? 'csms'} onChange={e => setForm({ ...form, audit_type: e.target.value as Audit['audit_type'] })}
            options={Object.entries(LABELS.auditType).map(([value, label]) => ({ value, label }))} /></Field>
          <p className="muted small">Después completás compañía solicitante, contrato, lugares, objetivo, criterios y el cronograma.{!isManager ? ' Quedás como auditor responsable.' : ''}</p>
          {!companies.length ? <p className="small">Todavía no hay empresas cargadas: <Link to="/maestros">agregalas en Empresas y ubicaciones</Link>.</p> : null}
        </div> : null}
      </Modal>
    </div>
  );
}
