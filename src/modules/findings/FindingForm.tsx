import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { newId, saveRecord } from '../../db/repo';
import { useAuth } from '../auth/AuthProvider';
import { useOrgRows, useProfiles } from '../../db/hooks';
import { Button, Field, Input, Modal, Select, TextArea, useToast } from '../../components/ui';
import { LABELS, type Company, type Finding, type Location, type MemberRow, type Process } from '../../types';

const opt = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));
export const NC_TYPES: Finding['finding_type'][] = ['no_conformidad', 'nc_mayor', 'nc_menor'];
export const isNc = (t?: Finding['finding_type'] | null) => !!t && NC_TYPES.includes(t);

/**
 * Alta / edición de un hallazgo. Vínculos obligatorios: auditoría y, si surge del checklist,
 * la pregunta (el servidor valida que la respuesta y la pregunta pertenezcan a la auditoría).
 * Una no conformidad exige responsable y vencimiento.
 */
export function FindingForm({ initial, onClose, navigateOnCreate = true }: { initial: Partial<Finding>; onClose: () => void; navigateOnCreate?: boolean }) {
  const { orgId } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const locations = useOrgRows<Location>('hse_locations') ?? [];
  const processes = useOrgRows<Process>('hse_processes') ?? [];
  const members = (useOrgRows<MemberRow>('hse_memberships') ?? []).filter(m => m.active);
  const people = useProfiles();
  const [f, setF] = useState<Partial<Finding>>({ finding_type: 'nc_menor', severity: 'media', status: 'abierto', ...initial });
  const [err, setErr] = useState<Record<string, string>>({});

  const save = async () => {
    const e: Record<string, string> = {};
    if (!f.title || f.title.trim().length < 3) e.title = 'Indique un título (3 caracteres o más)';
    if (!f.description || f.description.trim().length < 10) e.description = 'Describa el hecho observado y la evidencia objetiva';
    if (isNc(f.finding_type) && !f.responsible_user_id) e.responsible_user_id = 'Una no conformidad requiere responsable';
    if (isNc(f.finding_type) && !f.due_date) e.due_date = 'Una no conformidad requiere fecha límite';
    if (!f.audit_id) e.title = 'El hallazgo debe pertenecer a una auditoría';
    setErr(e);
    if (Object.keys(e).length) { toast('Revise los campos marcados', 'bad'); return; }
    const rec = await saveRecord<Finding>('hse_findings', {
      ...(f as Finding),
      id: f.id ?? newId(), organization_id: orgId, audit_id: f.audit_id!, response_id: f.response_id ?? null, item_id: f.item_id ?? null,
      company_id: f.company_id || null, location_id: f.location_id || null, process_id: f.process_id || null,
      title: f.title!.trim(), description: f.description!.trim(), requirement: f.requirement?.trim() || null, rationale: f.rationale?.trim() || null,
      finding_type: f.finding_type!, severity: f.severity!, category: f.category ?? null, status: f.status ?? 'abierto',
      responsible_user_id: f.responsible_user_id || null, root_cause: f.root_cause || null, rca_method: f.rca_method ?? null, rca_data: f.rca_data ?? null,
      immediate_action: f.immediate_action || null, legal_reference: f.legal_reference || null,
      detected_at: f.detected_at ?? new Date().toISOString(), due_date: f.due_date || null,
      recurrence_count: f.recurrence_count ?? 0, recurrence_key: f.recurrence_key ?? null, recurrence_of: f.recurrence_of ?? null,
      verification_notes: f.verification_notes ?? null, effectiveness: f.effectiveness ?? null,
    });
    toast(f.id ? 'Hallazgo actualizado' : 'Hallazgo registrado');
    onClose();
    if (!f.id && navigateOnCreate) nav(`/hallazgos/${rec.id}`);
  };
  const nc = isNc(f.finding_type);
  return (
    <Modal open wide title={f.id ? `Hallazgo ${f.code ?? ''}` : 'Registrar hallazgo'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={save}>Guardar</Button></>}>
      {f.item_id ? <p className="small muted">Vinculado a la pregunta del checklist.</p> : <p className="small muted">Hallazgo general (no vinculado a una pregunta).</p>}
      <Field label="Título" required error={err.title}><Input value={f.title ?? ''} onChange={e => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Descripción objetiva" required error={err.description} hint="Qué se observó, dónde, cuándo y con qué evidencia. Sin opiniones ni nombres de personas."><TextArea rows={5} value={f.description ?? ''} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Referencia / requisito" hint="Cláusula o requisito: «ISO 45001 5.4 Participación y consulta», «Anexo C CSMS». Sale en el informe final."><Input value={f.requirement ?? ''} onChange={e => setF({ ...f, requirement: e.target.value })} /></Field>
      {f.finding_type === 'oportunidad_mejora' ? <Field label="Fundamento" hint="Por qué conviene la mejora. Sale en la columna «Fundamento» del informe final."><TextArea rows={3} value={f.rationale ?? ''} onChange={e => setF({ ...f, rationale: e.target.value })} /></Field> : null}
      <div className="grid grid-2">
        <Field label="Clasificación"><Select value={f.finding_type} onChange={e => setF({ ...f, finding_type: e.target.value as Finding['finding_type'] })} options={opt(LABELS.findingType)} /></Field>
        <Field label="Severidad"><Select value={f.severity} onChange={e => setF({ ...f, severity: e.target.value as Finding['severity'] })} options={opt(LABELS.severity)} /></Field>
        <Field label="Categoría" hint="Si se deja vacía, el servidor toma la de la plantilla"><Select placeholder="(de la plantilla)" value={f.category ?? ''} onChange={e => setF({ ...f, category: (e.target.value || null) as Finding['category'] })} options={opt(LABELS.category)} /></Field>
        <Field label="Proceso"><Select placeholder="—" value={f.process_id ?? ''} onChange={e => setF({ ...f, process_id: e.target.value || null })} options={processes.map(p => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Responsable del tratamiento" required={nc} error={err.responsible_user_id}><Select placeholder="—" value={f.responsible_user_id ?? ''} onChange={e => setF({ ...f, responsible_user_id: e.target.value || null })}
          options={members.map(m => ({ value: m.user_id, label: `${people.get(m.user_id) ?? m.user_id.slice(0, 8)} · ${LABELS.role[m.role]}` }))} /></Field>
        <Field label="Fecha límite de tratamiento" required={nc} error={err.due_date}><Input type="date" value={f.due_date ?? ''} onChange={e => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Empresa"><Select placeholder="—" value={f.company_id ?? ''} onChange={e => setF({ ...f, company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Ubicación"><Select placeholder="—" value={f.location_id ?? ''} onChange={e => setF({ ...f, location_id: e.target.value })} options={locations.map(l => ({ value: l.id, label: l.name }))} /></Field>
      </div>
      <Field label="Referencia legal"><Input value={f.legal_reference ?? ''} onChange={e => setF({ ...f, legal_reference: e.target.value })} /></Field>
      <Field label="Acción inmediata / contención"><TextArea value={f.immediate_action ?? ''} onChange={e => setF({ ...f, immediate_action: e.target.value })} /></Field>
      <p className="small muted">El análisis de causa raíz y el plan de acción se registran en la ficha del hallazgo.</p>
    </Modal>
  );
}
