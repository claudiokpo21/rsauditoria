import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrgRows, useNameMap, usePendingSet, useProfiles } from '../../db/hooks';
import { MANAGERS, auditAccess, useParticipants } from '../auth/access';
import { newId, responseId, saveRecord } from '../../db/repo';
import { db } from '../../db/db';
import { useAuth, can } from '../auth/AuthProvider';
import { bandStyle } from '../../scoring/bands';
import { Badge, Button, Empty, Field, Input, Modal, PageHeader, Select, TextArea, fmtDate, fmtNum, today, useToast } from '../../components/ui';
import { LABELS, type Audit, type AuditStatus, type Company, type Location, type MemberRow, type Template, type TemplateVersion, type ValidationCaseRow, type AuditResponse } from '../../types';

export const statusTone = (s: AuditStatus) => (s === 'completada' || s === 'cerrada' ? 'ok' : s === 'en_curso' ? 'info' : s === 'cancelada' ? 'bad' : 'neutral');

export function AuditsPage() {
  const { orgId, role, userId, current } = useAuth();
  const participants = useParticipants(orgId);
  const members = useOrgRows<MemberRow>('hse_memberships') ?? [];
  const people = useProfiles();
  const isManager = !!role && MANAGERS.includes(role);
  const leads = members.filter(m => m.active && ['owner', 'admin', 'supervisor', 'auditor'].includes(m.role));
  const [mine, setMine] = useState(false);
  const nav = useNavigate();
  const toast = useToast();
  const audits = useOrgRows<Audit>('hse_audits') ?? [];
  const templates = useOrgRows<Template>('hse_templates') ?? [];
  const versions = useOrgRows<TemplateVersion>('hse_template_versions') ?? [];
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const locations = useOrgRows<Location>('hse_locations') ?? [];
  const cName = useNameMap('hse_companies'); const lName = useNameMap('hse_locations');
  const pending = usePendingSet('hse_audits');
  const [q, setQ] = useState(''); const [st, setSt] = useState(''); const [co, setCo] = useState('');
  const [form, setForm] = useState<Partial<Audit> | null>(null);
  // respuestas de la planilla importada (caso de validación de la versión) para precargar la auditoría
  const cases = useOrgRows<ValidationCaseRow>('hse_template_validation_cases') ?? [];
  const [useSheet, setUseSheet] = useState(true);
  const sheetCase = form?.template_version_id ? cases.find(c => c.version_id === form.template_version_id && Object.keys(c.answers ?? {}).length) : undefined;

  const published = versions.filter(v => v.status === 'publicada');
  const tName = new Map(templates.map(t => [t.id, t.name]));
  const vLabel = new Map(versions.map(v => [v.id, `${tName.get(v.template_id) ?? 'Plantilla'} · v${v.version_number}`]));

  const list = useMemo(() => audits.filter(a =>
    (!st || (st === 'atrasadas' ? a.status === 'planificada' && !!a.scheduled_date && a.scheduled_date < today() : a.status === st)) && (!co || a.company_id === co) &&
    (!mine || a.lead_auditor_id === userId || participants.some(p => p.audit_id === a.id && p.user_id === userId)) &&
    auditAccess(a, role, userId, participants, current?.company_id) !== null &&
    (!q || `${a.code ?? ''} ${a.title} ${cName.get(a.company_id ?? '') ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => (b.scheduled_date ?? b.created_at ?? '').localeCompare(a.scheduled_date ?? a.created_at ?? '')), [audits, st, co, q, cName, mine, participants, userId, role, current]);

  const create = async () => {
    if (!form?.template_version_id || !form.title || form.title.trim().length < 3) { toast('Elija la plantilla e indique un título', 'bad'); return; }
    const withSheet = !!sheetCase && useSheet;
    const a = await saveRecord<Audit>('hse_audits', {
      id: newId(), organization_id: orgId, template_version_id: form.template_version_id, company_id: form.company_id || null,
      location_id: form.location_id || null, title: form.title.trim(), audit_type: form.audit_type ?? 'interna', status: withSheet ? 'en_curso' : 'planificada',
      scheduled_date: form.scheduled_date || today(), lead_auditor_id: isManager ? (form.lead_auditor_id || userId) : userId, audit_team: form.audit_team || null, scope: form.scope || null,
    } as Audit);
    if (withSheet && sheetCase) {
      const valid = new Set((await db.hse_template_items.where('version_id').equals(form.template_version_id).toArray()).map(i => i.id));
      let n = 0;
      for (const [itemId, answer] of Object.entries(sheetCase.answers)) {
        if (!valid.has(itemId) || !answer) continue;
        await saveRecord<AuditResponse>('hse_audit_responses', { id: responseId(a.id, itemId), organization_id: orgId, audit_id: a.id, item_id: itemId, answer,
          comment: null, rating: null, numeric_value: null, text_value: null } as AuditResponse);
        n++;
      }
      toast(`Auditoría creada con ${n} respuestas de la planilla. Revísela y toque "Completar".`);
    }
    setForm(null); nav(`/auditorias/${a.id}`);
  };

  return (
    <div>
      <PageHeader title="Auditorías" subtitle="Se crean y ejecutan sin conexión; el código se asigna al sincronizar."
        actions={can(role, 'audit') ? <Button onClick={() => setForm({ audit_type: 'interna', scheduled_date: today() })} disabled={!published.length} title={!published.length ? 'Publique una plantilla primero' : undefined}>Nueva auditoría</Button> : null} />
      <div className="row gap wrap" style={{ marginBottom: '1rem' }}>
        <Input placeholder="Buscar por código, título o empresa" value={q} onChange={e => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <Select placeholder="Todos los estados" value={st} onChange={e => setSt(e.target.value)} options={[...Object.entries(LABELS.auditStatus).map(([value, label]) => ({ value, label })), { value: 'atrasadas', label: 'Planificadas atrasadas' }]} style={{ maxWidth: 220 }} />
        <label className="row gap small"><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Sólo donde participo</label>
        <Select placeholder="Todas las empresas" value={co} onChange={e => setCo(e.target.value)} options={companies.map(c => ({ value: c.id, label: c.name }))} style={{ maxWidth: 240 }} />
      </div>
      {list.length === 0 ? <Empty>{audits.length ? 'Sin resultados para el filtro.' : 'Todavía no hay auditorías.'}</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Código</th><th>Auditoría</th><th>Empresa / ubicación</th><th>Líder</th><th>Fecha</th><th>Estado</th><th style={{ textAlign: "center" }}>Resultado</th></tr></thead>
          <tbody>{list.map(a => (
            <tr key={a.id} className="clickable" onClick={() => nav(`/auditorias/${a.id}`)}>
              <td className="mono">{a.code ?? <span className="muted">(al sincronizar)</span>}</td>
              <td><strong>{a.title}</strong><div className="muted small">{vLabel.get(a.template_version_id)}</div></td>
              <td>{a.company_id ? cName.get(a.company_id) : '—'}<div className="muted small">{a.location_id ? lName.get(a.location_id) : ''}</div></td>
              <td className="small">{a.lead_auditor_id ? people.get(a.lead_auditor_id) ?? '—' : '—'}</td>
              <td>{fmtDate(a.scheduled_date)}{a.status === 'planificada' && a.scheduled_date && a.scheduled_date < today() ? <div><Badge tone="warn">Atrasada</Badge></div> : null}</td>
              <td><Badge tone={statusTone(a.status)}>{LABELS.auditStatus[a.status]}</Badge> {pending.has(a.id) ? <Badge tone="warn">Pendiente</Badge> : null}</td>
              {(() => { const st = bandStyle(a.result_band); return (
                <td className="result-cell" style={st ? { background: st.bg, color: st.fg, fontWeight: 700 } : undefined}>
                  {a.result_band ? <>{fmtNum(a.score)}<div className="small" style={{ fontWeight: 600 }}>{a.result_band}</div></> : a.compliance_pct !== null ? `${fmtNum(a.compliance_pct, 1)} %` : '—'}
                </td>); })()}
            </tr>))}</tbody>
        </table></div>
      )}
      <Modal open={!!form} title="Nueva auditoría" onClose={() => setForm(null)}
        footer={<><Button variant="secondary" onClick={() => setForm(null)}>Cancelar</Button><Button onClick={create}>Crear</Button></>}>
        {form ? <>
          <Field label="Plantilla (versión publicada)" required><Select placeholder="Elegir…" value={form.template_version_id ?? ''} onChange={e => setForm({ ...form, template_version_id: e.target.value })} options={published.map(v => ({ value: v.id, label: vLabel.get(v.id)! }))} /></Field>
          {sheetCase ? (
            <label className="switch-row sheet-opt">
              <input type="checkbox" checked={useSheet} onChange={e => setUseSheet(e.target.checked)} />
              <span><strong>Cargar las respuestas de la planilla importada</strong><br /><span className="small muted">{Object.keys(sheetCase.answers).length} respuestas del Excel ({sheetCase.name.replace(/^Resultados de prueba del Excel ?/, '').replace(/[()]/g, '') || 'planilla'}). La auditoría queda en curso para revisarla y completarla.</span></span>
            </label>) : null}
          <Field label="Título" required><Input value={form.title ?? ''} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="Ej.: Auditoría CSMS segunda parte – Equipo de perforación" /></Field>
          <div className="grid grid-2">
            <Field label="Empresa / contratista"><Select placeholder="—" value={form.company_id ?? ''} onChange={e => setForm({ ...form, company_id: e.target.value })} options={companies.filter(c => c.active).map(c => ({ value: c.id, label: c.name }))} /></Field>
            <Field label="Ubicación"><Select placeholder="—" value={form.location_id ?? ''} onChange={e => setForm({ ...form, location_id: e.target.value })} options={locations.filter(l => !form.company_id || !l.company_id || l.company_id === form.company_id).map(l => ({ value: l.id, label: l.name }))} /></Field>
            <Field label="Tipo"><Select value={form.audit_type} onChange={e => setForm({ ...form, audit_type: e.target.value as Audit['audit_type'] })} options={Object.entries(LABELS.auditType).map(([value, label]) => ({ value, label }))} /></Field>
            <Field label="Fecha programada"><Input type="date" value={form.scheduled_date ?? ''} onChange={e => setForm({ ...form, scheduled_date: e.target.value })} /></Field>
          </div>
          {isManager ? <Field label="Auditor líder" hint="Queda asignado como participante; puede sumar más auditores desde la auditoría."><Select value={form.lead_auditor_id ?? userId} onChange={e => setForm({ ...form, lead_auditor_id: e.target.value })} options={leads.map(m => ({ value: m.user_id, label: `${people.get(m.user_id) ?? m.user_id.slice(0, 8)} · ${LABELS.role[m.role]}` }))} /></Field>
            : <p className="muted small">Usted queda como auditor líder.</p>}
          <Field label="Equipo auditor (texto libre)"><Input value={form.audit_team ?? ''} onChange={e => setForm({ ...form, audit_team: e.target.value })} /></Field>
          <Field label="Alcance"><TextArea value={form.scope ?? ''} onChange={e => setForm({ ...form, scope: e.target.value })} /></Field>
        </> : null}
      </Modal>
    </div>
  );
}
