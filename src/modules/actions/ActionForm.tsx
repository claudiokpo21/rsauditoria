import { useState } from 'react';
import { newId, saveRecord } from '../../db/repo';
import { useAuth, can } from '../auth/AuthProvider';
import { actionAccess, canWrite, type ItemAccess } from '../auth/access';
import { useOrgRows, useProfiles } from '../../db/hooks';
import { Button, Field, Input, Modal, Select, TextArea, useToast } from '../../components/ui';
import { RecordHistory } from '../../components/RecordHistory';
import { EvidenceStrip } from '../evidences/EvidenceStrip';
import { LABELS, type Action, type Company, type Finding, type MemberRow } from '../../types';

const opt = (o: Record<string, string>) => Object.entries(o).map(([value, label]) => ({ value, label }));

/**
 * Acción del plan. Quien gestiona el hallazgo define todo; el responsable (usuario o
 * contratista de la empresa responsable) sólo informa avance y la completa; la verificación
 * de eficacia la hace un auditor o coordinador que NO sea el responsable.
 */
export function ActionForm({ initial, finding, findingAccess, onClose }: { initial: Partial<Action>; finding: Finding; findingAccess: ItemAccess; onClose: () => void }) {
  const { orgId, role, userId, current } = useAuth();
  const toast = useToast();
  const companies = useOrgRows<Company>('hse_companies') ?? [];
  const members = (useOrgRows<MemberRow>('hse_memberships') ?? []).filter(m => m.active);
  const people = useProfiles();
  const [a, setA] = useState<Partial<Action>>({ action_type: 'correctiva', status: 'pendiente', responsible_company_id: finding.company_id, ...initial });
  const isNew = !a.id;
  const acc = isNew ? findingAccess : actionAccess(a as Action, findingAccess, userId, role, current?.company_id);
  const full = canWrite(acc);
  const progressOnly = acc === 'avance';
  const locked = !full && !progressOnly;
  const finalState = initial.status === 'verificada' || initial.status === 'cancelada';
  const canVerify = full && can(role, 'verify') && initial.status === 'completada' && a.responsible_user_id !== userId;

  const save = async () => {
    if (!a.description || a.description.trim().length < 3) { toast('Describa la acción', 'bad'); return; }
    if (!a.due_date) { toast('Indique la fecha de vencimiento', 'bad'); return; }
    if (!a.responsible_user_id && !a.responsible_name?.trim() && !a.responsible_company_id) { toast('Indique un responsable', 'bad'); return; }
    if (a.status === 'verificada' && (!a.effectiveness || !(a.verification_notes ?? '').trim())) { toast('Indique la eficacia y la evidencia de verificación', 'bad'); return; }
    if (a.status === 'completada' && !(a.progress_notes ?? '').trim()) { toast('Describa lo realizado antes de completar', 'bad'); return; }
    await saveRecord<Action>('hse_actions', {
      ...(a as Action),
      id: a.id ?? newId(), organization_id: orgId, finding_id: finding.id, description: a.description.trim(),
      action_type: a.action_type!, responsible_user_id: a.responsible_user_id || null, responsible_name: a.responsible_name?.trim() || null,
      responsible_company_id: a.responsible_company_id || null, due_date: a.due_date, status: a.status ?? 'pendiente',
      progress_notes: a.progress_notes?.trim() || null, effectiveness_criteria: a.effectiveness_criteria?.trim() || null,
      verification_notes: a.verification_notes?.trim() || null, effectiveness: a.effectiveness ?? null,
    });
    if (isNew && finding.status === 'abierto') {
      // el servidor hace lo mismo; se refleja localmente para trabajar sin conexión
      await saveRecord<Finding>('hse_findings', { ...finding, status: 'en_tratamiento' });
    }
    toast('Acción guardada'); onClose();
  };
  const statusOptions = opt(LABELS.actionStatus).filter(o =>
    o.value === initial.status || (progressOnly ? ['pendiente', 'en_curso', 'completada'].includes(o.value)
      : o.value === 'verificada' ? canVerify : true));

  return (
    <Modal open wide title={isNew ? 'Nueva acción' : 'Acción del plan'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{locked || finalState ? 'Cerrar' : 'Cancelar'}</Button>{!locked && !finalState ? <Button onClick={save}>Guardar</Button> : null}</>}>
      {progressOnly ? <div className="alert alert-info small">Usted es responsable de esta acción: puede informar el avance, adjuntar evidencias y completarla. La verificación de eficacia la realiza el equipo auditor.</div> : null}
      <Field label="Acción" required><TextArea rows={3} disabled={!full || finalState} value={a.description ?? ''} onChange={e => setA({ ...a, description: e.target.value })} /></Field>
      <div className="grid grid-2">
        <Field label="Tipo"><Select disabled={!full || finalState} value={a.action_type} onChange={e => setA({ ...a, action_type: e.target.value as Action['action_type'] })} options={opt(LABELS.actionType)} /></Field>
        <Field label="Vencimiento" required><Input type="date" disabled={!full || finalState} value={a.due_date ?? ''} onChange={e => setA({ ...a, due_date: e.target.value })} /></Field>
        <Field label="Responsable (usuario)"><Select disabled={!full || finalState} placeholder="—" value={a.responsible_user_id ?? ''} onChange={e => setA({ ...a, responsible_user_id: e.target.value })}
          options={members.map(m => ({ value: m.user_id, label: `${people.get(m.user_id) ?? m.user_id.slice(0, 8)} · ${LABELS.role[m.role]}` }))} /></Field>
        <Field label="Responsable (nombre, si no es usuario)"><Input disabled={!full || finalState} value={a.responsible_name ?? ''} onChange={e => setA({ ...a, responsible_name: e.target.value })} /></Field>
        <Field label="Empresa responsable"><Select disabled={!full || finalState} placeholder="—" value={a.responsible_company_id ?? ''} onChange={e => setA({ ...a, responsible_company_id: e.target.value })} options={companies.map(c => ({ value: c.id, label: c.name }))} /></Field>
        <Field label="Estado"><Select disabled={locked || finalState} value={a.status} onChange={e => setA({ ...a, status: e.target.value as Action['status'] })} options={statusOptions} /></Field>
      </div>
      <Field label="Criterio de eficacia" hint="Cómo se comprobará que la acción eliminó la causa (indicador, inspección, plazo)"><TextArea rows={2} disabled={!full || finalState} value={a.effectiveness_criteria ?? ''} onChange={e => setA({ ...a, effectiveness_criteria: e.target.value })} /></Field>
      <Field label="Avance / evidencia de implementación"><TextArea disabled={locked || finalState} value={a.progress_notes ?? ''} onChange={e => setA({ ...a, progress_notes: e.target.value })} /></Field>
      {(canVerify && a.status === 'verificada') || initial.status === 'verificada' ? <div className="grid grid-2">
        <Field label="Eficacia" required><Select disabled={finalState} placeholder="—" value={a.effectiveness ?? ''} onChange={e => setA({ ...a, effectiveness: (e.target.value || null) as Action['effectiveness'] })} options={[{ value: 'eficaz', label: 'Eficaz' }, { value: 'no_eficaz', label: 'No eficaz' }]} /></Field>
        <Field label="Evidencia de la verificación" required><TextArea disabled={finalState} value={a.verification_notes ?? ''} onChange={e => setA({ ...a, verification_notes: e.target.value })} /></Field>
      </div> : null}
      {full && initial.status === 'completada' && a.responsible_user_id === userId ? <p className="small muted">Usted es el responsable: la verificación debe hacerla otra persona.</p> : null}
      {a.id ? <Field label="Evidencias de implementación"><EvidenceStrip readOnly={locked || finalState} target={{ organization_id: orgId, audit_id: finding.audit_id, action_id: a.id, finding_id: finding.id }} filter={{ action_id: a.id }} /></Field>
        : <p className="muted small">Guarde la acción para adjuntar evidencias.</p>}
      {a.id ? <RecordHistory table="hse_actions" id={a.id} /> : null}
    </Modal>
  );
}
