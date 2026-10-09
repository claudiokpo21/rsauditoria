/**
 * Ciclo de vida de una auditoría: equipo asignado, preparación para completar/cerrar,
 * revisión de coordinación, cierre, cancelación y reapertura autorizada.
 *
 * Todas las reglas las vuelve a validar el servidor (hse_guard_audit, hse_audits_readiness,
 * hse_review_audit, hse_reopen_audit). Aquí sólo se anticipan para guiar al usuario.
 */
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { planAccepted } from '../reports/finalReport';
import { db } from '../../db/db';
import { newId, patchRecord, saveRecord } from '../../db/repo';
import { useProfiles } from '../../db/hooks';
import { supabase, errorMessage } from '../../lib/supabase';
import { runSync } from '../../sync/scheduler';
import { Badge, Button, Card, Field, Modal, Select, TextArea, fmtDateTime, useToast } from '../../components/ui';
import { LABELS, type Audit, type AuditParticipant, type AuditResponse, type MemberRow, type TemplateItem } from '../../types';
import type { AuditAccess } from '../auth/access';
import { useAuth } from '../auth/AuthProvider';

export interface ReadinessIssue { code: string; message: string; item_id?: string; evidence_id?: string; finding_id?: string; ref?: string }
const FAIL = ['no_cumple', 'no', 'nc'];

/** Comprobaciones locales (funcionan sin conexión). El servidor repite las suyas al recibir el cambio de estado. */
export function useLocalReadiness(audit: Audit | null | undefined, items: TemplateItem[], responses: AuditResponse[]) {
  return useLiveQuery(async () => {
    if (!audit) return null;
    const issues: ReadinessIssue[] = [];
    const byItem = new Map(responses.map(r => [r.item_id, r]));
    const evid = (await db.hse_evidences.where('audit_id').equals(audit.id).toArray()).filter(e => !e.deleted_at);
    const findings = (await db.hse_findings.where('audit_id').equals(audit.id).toArray()).filter(f => !f.deleted_at);
    for (const i of items) {
      const r = byItem.get(i.id);
      const answered = !!r && (r.answer != null || r.rating != null || r.numeric_value != null || !!r.text_value?.trim());
      if (i.is_required !== false && !answered) issues.push({ code: 'sin_responder', item_id: i.id, ref: i.original_number ?? i.code ?? '', message: `Pregunta obligatoria sin responder: ${i.question.slice(0, 120)}` });
      if (r?.answer && FAIL.includes(r.answer) && i.evidence_required_on_fail && !evid.some(e => e.response_id === r.id))
        issues.push({ code: 'evidencia_faltante', item_id: i.id, ref: i.original_number ?? i.code ?? '', message: `Falta evidencia del incumplimiento: ${i.question.slice(0, 120)}` });
      if (r?.answer && FAIL.includes(r.answer) && i.is_critical && !findings.some(f => f.response_id === r.id || f.item_id === i.id))
        issues.push({ code: 'critico_sin_hallazgo', item_id: i.id, ref: i.original_number ?? i.code ?? '', message: `Ítem crítico incumplido sin hallazgo: ${i.question.slice(0, 120)}` });
    }
    // lo que todavía no llegó al servidor
    const ops = (await db.outbox.where('organization_id').equals(audit.organization_id).toArray())
      .filter(o => o.record_id === audit.id || o.payload.audit_id === audit.id || findings.some(f => f.id === o.record_id || o.payload.finding_id === f.id));
    const files = ops.filter(o => o.kind === 'upload' && o.file_state !== 'subido').length;
    const stuck = ops.filter(o => ['error', 'conflicto', 'rechazado'].includes(o.status)).length;
    return { issues, pendingOps: ops.length, pendingFiles: files, stuck };
  }, [audit?.id, audit?.organization_id, items, responses]);
}

export function ParticipantsCard({ audit, access }: { audit: Audit; access: AuditAccess }) {
  const { orgId } = useAuth();
  const toast = useToast();
  const people = useProfiles();
  const parts = useLiveQuery(async () => (await db.hse_audit_participants.where('audit_id').equals(audit.id).toArray()).filter(p => !p.deleted_at), [audit.id]) ?? [];
  const members = useLiveQuery(async () => (await db.hse_memberships.where('organization_id').equals(orgId).toArray()).filter(m => m.active && !m.deleted_at), [orgId]) ?? [];
  const [add, setAdd] = useState<{ user_id: string; participant_role: AuditParticipant['participant_role'] } | null>(null);
  const manage = access === 'gestion' && !['cerrada', 'cancelada'].includes(audit.status);
  const eligible = (pr: AuditParticipant['participant_role']) => members.filter((m: MemberRow) =>
    (pr === 'observador' ? ['owner', 'admin', 'supervisor', 'auditor', 'viewer'] : ['owner', 'admin', 'supervisor', 'auditor']).includes(m.role)
    && !parts.some(p => p.user_id === m.user_id));

  const save = async () => {
    if (!add?.user_id) return;
    const existing = (await db.hse_audit_participants.where('audit_id').equals(audit.id).toArray()).find(p => p.user_id === add.user_id);
    await saveRecord<AuditParticipant>('hse_audit_participants', {
      ...(existing ?? {}), id: existing?.id ?? newId(), organization_id: audit.organization_id, audit_id: audit.id,
      user_id: add.user_id, participant_role: add.participant_role, deleted_at: null,
    } as AuditParticipant);
    setAdd(null); toast('Participante asignado');
  };
  return (
    <Card title="Equipo asignado" actions={manage ? <Button className="btn-sm" variant="secondary" onClick={() => setAdd({ user_id: '', participant_role: 'auditor' })}>Asignar</Button> : null}>
      {parts.length === 0 ? <p className="muted small">Sin participantes registrados.</p> : (
        <ul className="plain">
          {parts.sort((a, b) => (a.participant_role === 'lider' ? -1 : b.participant_role === 'lider' ? 1 : 0)).map(p => (
            <li key={p.id} className="row gap between">
              <span>{people.get(p.user_id) ?? 'Usuario'} <Badge tone={p.participant_role === 'lider' ? 'info' : 'neutral'}>{LABELS.participantRole[p.participant_role]}</Badge></span>
              {manage && p.participant_role !== 'lider'
                ? <Button variant="ghost" className="btn-sm" onClick={async () => { await patchRecord<AuditParticipant>('hse_audit_participants', p.id, { deleted_at: new Date().toISOString() }); toast('Participante quitado'); }}>Quitar</Button>
                : null}
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">Sólo el líder y los auditores asignados registran respuestas, hallazgos y evidencias. Los observadores tienen acceso de lectura.</p>
      <Modal open={!!add} title="Asignar participante" onClose={() => setAdd(null)}
        footer={<><Button variant="secondary" onClick={() => setAdd(null)}>Cancelar</Button><Button disabled={!add?.user_id} onClick={save}>Asignar</Button></>}>
        {add ? <>
          <Field label="Función">
            <Select value={add.participant_role} onChange={e => setAdd({ user_id: '', participant_role: e.target.value as AuditParticipant['participant_role'] })}
              options={[{ value: 'auditor', label: 'Auditor (escribe)' }, { value: 'observador', label: 'Observador (sólo lectura)' }]} />
          </Field>
          <Field label="Usuario" hint="Sólo miembros activos con un rol compatible">
            <Select placeholder="Elegir…" value={add.user_id} onChange={e => setAdd({ ...add, user_id: e.target.value })}
              options={eligible(add.participant_role).map(m => ({ value: m.user_id, label: `${people.get(m.user_id) ?? m.user_id} · ${LABELS.role[m.role]}` }))} />
          </Field>
        </> : null}
      </Modal>
    </Card>
  );
}

type Dialog = null | 'completar' | 'revisar' | 'cerrar' | 'reabrir_cerrada' | 'cancelar';

export function useAuditLifecycle(audit: Audit, access: AuditAccess, local: ReturnType<typeof useLocalReadiness>) {
  const { role, userId } = useAuth();
  const toast = useToast();
  const people = useProfiles();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [server, setServer] = useState<{ ok: boolean; issues: ReadinessIssue[]; checked_at: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [notes, setNotes] = useState('');
  const [summary, setSummary] = useState(audit.summary ?? '');
  const [busy, setBusy] = useState(false);
  const isManager = access === 'gestion';
  const isAdmin = role === 'owner' || role === 'admin';

  const checkServer = async (target: 'completada' | 'cerrada') => {
    setServer(null);
    if (!navigator.onLine) return;
    setChecking(true);
    try {
      const { data, error } = await supabase.rpc('hse_audit_readiness', { p_audit: audit.id, p_target: target });
      if (error) throw error;
      setServer(data as typeof server);
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setChecking(false); }
  };
  const open = (d: Dialog) => {
    setDialog(d); setNotes(''); setSummary(audit.summary ?? '');
    if (d === 'completar') void checkServer('completada');
    if (d === 'cerrar') void checkServer('cerrada');
  };
  const rpc = async (fn: string, args: Record<string, unknown>, ok: string) => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc(fn, args);
      if (error) throw error;
      toast(ok); setDialog(null); await runSync();
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };
  const setStatus = async (status: Audit['status'], extra: Partial<Audit> = {}, ok = `Auditoría ${LABELS.auditStatus[status].toLowerCase()}`) => {
    await patchRecord<Audit>('hse_audits', audit.id, { status, ...extra });
    toast(navigator.onLine ? ok : `${ok} (se confirmará al sincronizar)`); setDialog(null);
  };

  const buttons = <>
    {access && ['gestion', 'escritura'].includes(access) && audit.status === 'planificada'
      && planAccepted(audit) ? <Button onClick={() => void setStatus('en_curso')}>Iniciar</Button> : null}
    {access && ['gestion', 'escritura'].includes(access) && audit.status === 'en_curso' ? <Button onClick={() => open('completar')}>Completar</Button> : null}
    {isManager && audit.status === 'completada' && !audit.reviewed_at && audit.lead_auditor_id !== userId ? <Button variant="secondary" onClick={() => open('revisar')}>Revisar</Button> : null}
    {isManager && audit.status === 'completada' ? <Button variant="secondary" onClick={() => void setStatus('en_curso', {}, 'Auditoría devuelta a ejecución (la revisión se descarta)')}>Devolver a ejecución</Button> : null}
    {isManager && audit.status === 'completada' ? <Button onClick={() => open('cerrar')}>Cerrar auditoría</Button> : null}
    {isManager && ['planificada', 'en_curso', 'completada'].includes(audit.status) ? <Button variant="ghost" onClick={() => open('cancelar')}>Cancelar auditoría</Button> : null}
    {isAdmin && ['cerrada', 'cancelada'].includes(audit.status) ? <Button variant="secondary" onClick={() => open('reabrir_cerrada')}>Reabrir (autorización especial)</Button> : null}
  </>;

  const issuesList = (list: ReadinessIssue[], title: string) => list.length ? (
    <div className="alert alert-warn"><strong>{title} ({list.length})</strong>
      <ul className="small" style={{ margin: '.35rem 0 0', paddingLeft: '1.1rem' }}>
        {list.slice(0, 12).map((i, k) => <li key={k}>{i.ref ? <span className="mono">{i.ref} · </span> : null}{i.message}</li>)}
        {list.length > 12 ? <li>… y {list.length - 12} más</li> : null}
      </ul>
    </div>) : null;

  const reviewInfo = audit.reviewed_at
    ? <div className="alert alert-info small">Revisada por {people.get(audit.reviewed_by ?? '') ?? 'coordinación'} el {fmtDateTime(audit.reviewed_at)}{audit.review_notes ? ` — ${audit.review_notes}` : ''}.</div>
    : audit.status === 'completada' ? <div className="alert alert-warn small">Pendiente de revisión de Coordinación HSE o Administración (distinta del auditor líder) antes del cierre.</div> : null;

  const offlineNote = !navigator.onLine ? <div className="alert alert-info small">Sin conexión: se muestran sólo las comprobaciones del dispositivo. El servidor las repite al recibir el cambio y lo rechaza si falta algo.</div> : null;

  const modals = <>
    <Modal open={dialog === 'completar'} title="Completar auditoría" wide onClose={() => setDialog(null)}
      footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Volver</Button>
        <Button disabled={!!local?.issues.length || !!server?.issues.length} onClick={() => void setStatus('completada')}>Completar</Button></>}>
      <p>Al completarla se bloquea el checklist y el servidor calcula el resultado oficial con la metodología versionada de la plantilla.</p>
      {offlineNote}
      {issuesList(local?.issues ?? [], 'Pendientes detectados en este dispositivo')}
      {checking ? <p className="muted small">Consultando al servidor…</p> : server ? issuesList(server.issues.filter(i => !(local?.issues ?? []).some(l => l.code === i.code && l.item_id === i.item_id)), 'Pendientes según el servidor') : null}
      {local && local.pendingOps ? <div className="alert alert-info small">Hay {local.pendingOps} cambio(s){local.pendingFiles ? ` y ${local.pendingFiles} archivo(s)` : ''} de esta auditoría sin sincronizar. El cambio de estado se enviará <strong>después</strong> de ellos; si alguno falla, la auditoría no se completa.</div> : null}
      {local?.stuck ? <div className="alert alert-bad small">{local.stuck} operación(es) de esta auditoría con error o conflicto: resuélvalas en Sincronización antes de completar.</div> : null}
      {!local?.issues.length && !server?.issues.length ? <div className="alert alert-ok small">Sin pendientes.</div> : null}
    </Modal>

    <Modal open={dialog === 'revisar'} title="Revisión de la auditoría" onClose={() => setDialog(null)}
      footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button>
        <Button busy={busy} disabled={!navigator.onLine} onClick={() => void rpc('hse_review_audit', { p_audit: audit.id, p_notes: notes || null }, 'Revisión registrada')}>Registrar revisión</Button></>}>
      <p>Confirma que revisó respuestas, evidencias, clasificación de hallazgos y resultado. Queda registrado con su usuario y fecha. Requiere conexión.</p>
      <Field label="Observaciones de la revisión"><TextArea rows={4} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </Modal>

    <Modal open={dialog === 'cerrar'} title="Cerrar auditoría" wide onClose={() => setDialog(null)}
      footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Volver</Button>
        <Button disabled={!summary.trim() || !!server?.issues.filter(i => i.code !== 'sin_resumen').length || !audit.reviewed_at}
          onClick={() => void setStatus('cerrada', { summary: summary.trim() })}>Cerrar</Button></>}>
      <p>Una auditoría cerrada no admite cambios. Para reabrirla se requiere un Administrador y un motivo registrado.</p>
      {reviewInfo}{offlineNote}
      {checking ? <p className="muted small">Consultando al servidor…</p> : server ? issuesList(server.issues.filter(i => i.code !== 'sin_resumen'), 'Pendientes según el servidor') : null}
      <Field label="Resumen y conclusiones" required><TextArea rows={5} value={summary} onChange={e => setSummary(e.target.value)} /></Field>
    </Modal>

    <Modal open={dialog === 'cancelar'} title="Cancelar auditoría" onClose={() => setDialog(null)}
      footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Volver</Button>
        <Button variant="danger" disabled={notes.trim().length < 10} onClick={() => void setStatus('cancelada', { summary: `[Cancelada] ${notes.trim()}${audit.summary ? `\n\n${audit.summary}` : ''}` })}>Cancelar auditoría</Button></>}>
      <p>La auditoría queda cancelada y no admite cambios. Indique el motivo (queda en el resumen y en el historial).</p>
      <Field label="Motivo" required><TextArea value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </Modal>

    <Modal open={dialog === 'reabrir_cerrada'} title="Reabrir auditoría cerrada" onClose={() => setDialog(null)}
      footer={<><Button variant="secondary" onClick={() => setDialog(null)}>Cancelar</Button>
        <Button variant="danger" busy={busy} disabled={notes.trim().length < 20 || !navigator.onLine}
          onClick={() => void rpc('hse_reopen_audit', { p_audit: audit.id, p_reason: notes.trim() }, 'Auditoría reabierta')}>Reabrir</Button></>}>
      <p>Reabrir una auditoría {audit.status} es una <strong>autorización especial</strong> del Administrador. Vuelve a “En curso”, se descarta la revisión y el motivo queda en el registro de reaperturas. Requiere conexión.</p>
      <Field label="Motivo (mínimo 20 caracteres)" required><TextArea rows={4} value={notes} onChange={e => setNotes(e.target.value)} /></Field>
    </Modal>
  </>;

  return { buttons, modals, reviewInfo };
}

/** Panel compacto con el estado de preparación (siempre visible mientras la auditoría está abierta). */
export function ReadinessCard({ local }: { local: ReturnType<typeof useLocalReadiness> }) {
  const groups = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of local?.issues ?? []) m.set(i.code, (m.get(i.code) ?? 0) + 1);
    return m;
  }, [local]);
  if (!local) return null;
  const label: Record<string, string> = { sin_responder: 'obligatorias sin responder', evidencia_faltante: 'desvíos sin la evidencia exigida', critico_sin_hallazgo: 'críticos incumplidos sin hallazgo' };
  return (
    <div className={`alert ${local.issues.length || local.stuck ? 'alert-warn' : 'alert-ok'} small`}>
      <strong>Para completar:</strong>{' '}
      {local.issues.length ? [...groups].map(([k, n]) => `${n} ${label[k] ?? k}`).join(' · ') : 'sin pendientes en el dispositivo'}
      {local.pendingOps ? ` · ${local.pendingOps} cambio(s) por sincronizar${local.pendingFiles ? ` (${local.pendingFiles} archivo/s)` : ''}` : ''}
      {local.stuck ? ` · ${local.stuck} con error/conflicto` : ''}
    </div>
  );
}
