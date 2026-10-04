/**
 * Permiso efectivo sobre auditorías, hallazgos y acciones — espejo de las funciones
 * hse_audit_role_row / hse_finding_role_row / hse_action_role_row del servidor.
 * Sólo decide qué mostrar en la interfaz: la base de datos vuelve a validarlo todo (RLS).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Action, Audit, AuditParticipant, Finding, Role } from '../../types';

export type AuditAccess = 'gestion' | 'escritura' | 'lectura' | null;
export type ItemAccess = AuditAccess | 'avance';

export const INTERNAL: Role[] = ['owner', 'admin', 'supervisor', 'auditor', 'viewer'];
export const MANAGERS: Role[] = ['owner', 'admin', 'supervisor'];

export function auditAccess(audit: Pick<Audit, 'id' | 'company_id' | 'lead_auditor_id' | 'created_by'> | null | undefined,
  role: Role | null, userId: string, participants: AuditParticipant[], myCompanyId?: string | null): AuditAccess {
  if (!audit || !role) return null;
  if (MANAGERS.includes(role)) return 'gestion';
  const mine = participants.filter(p => p.audit_id === audit.id && p.user_id === userId && !p.deleted_at);
  if (role === 'auditor') {
    if (audit.lead_auditor_id === userId || audit.created_by === userId || mine.some(p => p.participant_role !== 'observador')) return 'escritura';
    if (mine.some(p => p.participant_role === 'observador')) return 'lectura';
    return null;
  }
  if (role === 'viewer') return 'lectura';
  if (role === 'contractor') return audit.company_id && audit.company_id === myCompanyId ? 'lectura' : null;
  return null;
}

export function findingAccess(f: Finding, audit: AuditAccess, userId: string, actions: Action[], role: Role | null): ItemAccess {
  if (audit === 'gestion' || audit === 'escritura') return audit;
  if (f.responsible_user_id === userId || actions.some(a => a.finding_id === f.id && a.responsible_user_id === userId && !a.deleted_at)) return 'avance';
  if (role === 'contractor') return audit ?? 'lectura';
  return audit;
}

export function actionAccess(a: Action, finding: ItemAccess, userId: string, role: Role | null, myCompanyId?: string | null): ItemAccess {
  if (finding === 'gestion' || finding === 'escritura') return finding;
  if (a.responsible_user_id === userId) return 'avance';
  if (role === 'contractor' && a.responsible_company_id && a.responsible_company_id === myCompanyId) return 'avance';
  return finding === 'lectura' ? 'lectura' : null;
}

export const canWrite = (x: ItemAccess) => x === 'gestion' || x === 'escritura';

/** Participantes vivos de todas las auditorías de la organización (reactivo). */
export function useParticipants(orgId: string): AuditParticipant[] {
  return useLiveQuery(async () => orgId ? (await db.hse_audit_participants.where('organization_id').equals(orgId).toArray()).filter(p => !p.deleted_at) : [], [orgId]) ?? [];
}
