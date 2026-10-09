import Dexie, { type Table } from 'dexie';
import type { AuditSignature,
  Company, Location, Process, Template, TemplateVersion, TemplateSection, TemplateItem, ImportIssue,
  ValidationCaseRow, Audit, AuditResponse, Evidence, Finding, Action, MemberRow, ProfileRow, AuditParticipant, NotificationRow,
} from '../types';

/**
 * Estados de una operación de la cola:
 *  pendiente  → esperando envío (o reintento programado: next_attempt_at)
 *  enviando   → enviada y sin respuesta todavía; si el navegador se cierra en este
 *               estado, al reabrir se consulta el recibo del servidor (hse_sync_confirm)
 *  error      → falla transitoria (red, archivo no recibido…): se reintenta sola con espera creciente
 *  rechazado  → el servidor la rechazó (permiso/validación): requiere revisión manual
 *  conflicto  → otro usuario cambió los mismos campos: requiere resolución manual
 * Las operaciones confirmadas por el servidor se eliminan de la cola y quedan en op_log.
 */
export type OpStatus = 'pendiente' | 'enviando' | 'error' | 'rechazado' | 'conflicto';
export interface OutboxOp {
  seq?: number;                       // autoincremental: orden FIFO
  op_id: string;                      // clave de idempotencia (uuid generado en el dispositivo)
  organization_id: string;
  table: SyncTable;
  kind: 'upsert' | 'upload';
  record_id: string;
  base: Record<string, unknown> | null;   // valores que el dispositivo veía de los campos modificados (null = alta)
  payload: Record<string, unknown>;       // id, organization_id y SÓLO los campos modificados
  created_at: string;
  attempts: number;
  next_attempt_at: string | null;
  status: OpStatus;
  last_error: string | null;
  last_code: string | null;
  file_state?: 'pendiente' | 'subido';
  conflict?: { fields: string[]; server_row: Record<string, unknown> } | null;
  sent_at?: string | null;
}
/** Archivo de evidencia guardado en el dispositivo, cifrado (ver lib/localCrypto). */
export interface BlobRow { evidence_id: string; organization_id: string; enc: { iv: Uint8Array; data: ArrayBuffer; type: string; size: number }; mime_type: string; created_at: string; source: 'captura' | 'descarga' }
export interface MetaRow { key: string; value: unknown }
export interface SyncLogRow { id?: number; organization_id: string; at: string; pushed: number; pulled: number; failed: number; conflicts: number; duration_ms: number; error: string | null; confirmed: boolean }
export interface OpLogRow { id?: number; op_id: string; organization_id: string; table: string; record_id: string; result: string; row_version: number | null; at: string }
export interface KeyRow { id: string; key: CryptoKey; created_at: string }
export interface TusRow { fingerprint: string; url: string; created_at: string }

export const SYNC_TABLES = [
  'hse_companies', 'hse_locations', 'hse_processes',
  'hse_templates', 'hse_template_versions', 'hse_template_sections', 'hse_template_items',
  'hse_template_import_issues', 'hse_template_validation_cases',
  'hse_audits', 'hse_audit_participants', 'hse_audit_responses', 'hse_findings', 'hse_actions', 'hse_evidences',
  'hse_audit_signatures', 'hse_memberships', 'hse_notifications',
] as const;
export type SyncTable = typeof SYNC_TABLES[number];

/** Tablas que el cliente escribe por la cola (el resto sólo se descarga). */
export const WRITABLE_TABLES: SyncTable[] = [
  'hse_companies', 'hse_locations', 'hse_processes', 'hse_templates', 'hse_template_versions',
  'hse_template_sections', 'hse_template_items', 'hse_template_import_issues',
  'hse_audits', 'hse_audit_participants', 'hse_audit_responses', 'hse_findings', 'hse_actions', 'hse_evidences',
  'hse_audit_signatures',
];

/** Tablas cuyo acceso depende de la asignación a la auditoría (se re-descargan si cambia la asignación). */
export const AUDIT_SCOPED_TABLES: SyncTable[] = ['hse_audits', 'hse_audit_participants', 'hse_audit_responses', 'hse_findings', 'hse_actions', 'hse_evidences', 'hse_audit_signatures'];

/** Columnas que el cliente puede enviar por tabla (todo lo demás lo fija el servidor). */
/** Columnas que el cliente puede enviar por tabla (todo lo demás lo fija el servidor). Espejo de hse_sync_writable_columns (0027). */
export const WRITABLE_COLUMNS: Record<string, string[]> = {
  hse_companies: ['id', 'organization_id', 'name', 'tax_id', 'company_type', 'parent_company_id', 'contact_name', 'contact_email', 'contact_phone', 'csms_status', 'csms_valid_until', 'active', 'deleted_at', 'client_updated_at'],
  hse_locations: ['id', 'organization_id', 'company_id', 'parent_location_id', 'name', 'location_type', 'address', 'latitude', 'longitude', 'active', 'deleted_at', 'client_updated_at'],
  hse_processes: ['id', 'organization_id', 'name', 'sort_order', 'active', 'deleted_at', 'client_updated_at'],
  hse_templates: ['id', 'organization_id', 'name', 'category', 'description', 'active', 'deleted_at', 'client_updated_at'],
  hse_template_versions: ['id', 'organization_id', 'template_id', 'version_number', 'change_notes', 'scoring_method', 'scoring_config', 'deleted_at', 'client_updated_at'],
  hse_template_sections: ['id', 'organization_id', 'version_id', 'title', 'description', 'sort_order', 'code', 'deleted_at', 'client_updated_at'],
  hse_template_items: ['id', 'organization_id', 'version_id', 'section_id', 'code', 'question', 'guidance', 'response_type', 'weight', 'is_critical', 'evidence_required_on_fail', 'is_required', 'legal_reference', 'sort_order', 'process_id', 'deleted_at', 'client_updated_at'],
  hse_template_import_issues: ['id', 'organization_id', 'status', 'resolution_note', 'client_updated_at'],
  hse_audits: ['id', 'organization_id', 'template_version_id', 'company_id', 'location_id', 'title', 'audit_type', 'status', 'scheduled_date', 'lead_auditor_id', 'audit_team', 'scope', 'summary', 'latitude', 'longitude', 'closing_meeting_at', 'closing_attendees', 'closing_agreements', 'report_data', 'deleted_at', 'client_updated_at'],
  hse_audit_participants: ['id', 'organization_id', 'audit_id', 'user_id', 'participant_role', 'deleted_at', 'client_updated_at'],
  hse_audit_responses: ['id', 'organization_id', 'audit_id', 'item_id', 'answer', 'rating', 'numeric_value', 'text_value', 'comment', 'deleted_at', 'client_updated_at'],
  hse_findings: ['id', 'organization_id', 'audit_id', 'response_id', 'item_id', 'company_id', 'location_id', 'title', 'description', 'requirement', 'rationale', 'finding_type', 'severity', 'category', 'process_id', 'responsible_user_id', 'status', 'root_cause', 'rca_method', 'rca_data', 'immediate_action', 'legal_reference', 'detected_at', 'due_date', 'verification_notes', 'effectiveness', 'deleted_at', 'client_updated_at'],
  hse_actions: ['id', 'organization_id', 'finding_id', 'description', 'action_type', 'responsible_user_id', 'responsible_name', 'responsible_company_id', 'due_date', 'status', 'progress_notes', 'effectiveness_criteria', 'verification_notes', 'effectiveness', 'deleted_at', 'client_updated_at'],
  hse_evidences: ['id', 'organization_id', 'audit_id', 'response_id', 'finding_id', 'action_id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'caption', 'taken_at', 'latitude', 'longitude', 'deleted_at', 'client_updated_at'],
  hse_audit_signatures: ['id', 'organization_id', 'audit_id', 'signer_role', 'signer_name', 'signer_position', 'signer_company', 'agreement', 'observations', 'signature_png', 'signed_at', 'deleted_at', 'client_updated_at'],
};

class HseDB extends Dexie {
  hse_companies!: Table<Company, string>;
  hse_locations!: Table<Location, string>;
  hse_processes!: Table<Process, string>;
  hse_templates!: Table<Template, string>;
  hse_template_versions!: Table<TemplateVersion, string>;
  hse_template_sections!: Table<TemplateSection, string>;
  hse_template_items!: Table<TemplateItem, string>;
  hse_template_import_issues!: Table<ImportIssue, string>;
  hse_template_validation_cases!: Table<ValidationCaseRow, string>;
  hse_audits!: Table<Audit, string>;
  hse_audit_participants!: Table<AuditParticipant, string>;
  hse_audit_signatures!: Table<AuditSignature, string>;
  hse_notifications!: Table<NotificationRow, string>;
  hse_audit_responses!: Table<AuditResponse, string>;
  hse_findings!: Table<Finding, string>;
  hse_actions!: Table<Action, string>;
  hse_evidences!: Table<Evidence, string>;
  hse_memberships!: Table<MemberRow, string>;
  profiles!: Table<ProfileRow, string>;
  outbox!: Table<OutboxOp, number>;
  blobs!: Table<BlobRow, string>;
  meta!: Table<MetaRow, string>;
  sync_log!: Table<SyncLogRow, number>;
  op_log!: Table<OpLogRow, number>;
  keys!: Table<KeyRow, string>;
  tus_uploads!: Table<TusRow, string>;

  constructor() {
    super('hse-audit-manager');
    this.version(1).stores({
      hse_companies: 'id, organization_id, name, updated_at',
      hse_locations: 'id, organization_id, company_id, updated_at',
      hse_processes: 'id, organization_id, updated_at',
      hse_templates: 'id, organization_id, updated_at',
      hse_template_versions: 'id, organization_id, template_id, status, updated_at',
      hse_template_sections: 'id, organization_id, version_id, updated_at',
      hse_template_items: 'id, organization_id, version_id, section_id, updated_at',
      hse_template_import_issues: 'id, organization_id, version_id, item_id, status, updated_at',
      hse_template_validation_cases: 'id, organization_id, version_id, updated_at',
      hse_audits: 'id, organization_id, status, company_id, template_version_id, scheduled_date, updated_at',
      hse_audit_responses: 'id, organization_id, audit_id, item_id, [audit_id+item_id], updated_at',
      hse_findings: 'id, organization_id, audit_id, status, company_id, response_id, updated_at',
      hse_actions: 'id, organization_id, finding_id, status, due_date, responsible_company_id, updated_at',
      hse_evidences: 'id, organization_id, audit_id, response_id, finding_id, action_id, updated_at',
      hse_memberships: 'id, organization_id, user_id, updated_at',
      profiles: 'id',
      outbox: '++seq, op_id, organization_id, table, record_id, status',
      blobs: 'evidence_id, organization_id',
      meta: 'key',
      sync_log: '++id, organization_id, at',
    });
    // v2: protocolo con recibos, fusión por campo, archivos cifrados y cargas reanudables
    this.version(2).stores({
      outbox: '++seq, op_id, organization_id, table, record_id, status',
      blobs: 'evidence_id, organization_id',
      op_log: '++id, op_id, organization_id, at',
      keys: 'id',
      tus_uploads: 'fingerprint',
    }).upgrade(async tx => {
      // operaciones del formato anterior: se reenvían como altas/cambios completos
      await tx.table('outbox').toCollection().modify((o: Record<string, unknown>) => {
        o.base = o.base ?? null; o.next_attempt_at = null; o.last_code = null;
        if (o.status !== 'pendiente') o.status = 'error';
      });
      await tx.table('blobs').clear(); // los archivos sin cifrar de v1 no se conservan
    });
    // v3: participantes de auditoría y notificaciones de vencimiento (migraciones 0017/0020)
    this.version(3).stores({
      hse_audit_participants: 'id, organization_id, audit_id, user_id, updated_at',
      hse_notifications: 'id, organization_id, user_id, entity_id, updated_at',
      hse_findings: 'id, organization_id, audit_id, status, company_id, response_id, recurrence_key, updated_at',
    }).upgrade(async tx => {
      // columnas nuevas en hallazgos/auditorías: se fuerza una descarga completa
      const keys = (await tx.table('meta').toArray()).map((m: MetaRow) => m.key).filter((k: string) => k.startsWith('cursor:'));
      await tx.table('meta').bulkDelete(keys);
    });
    // v4: firmas en campo y acta de reunión de cierre (migración 0025)
    this.version(4).stores({
      hse_audit_signatures: 'id, organization_id, audit_id, updated_at',
    }).upgrade(async tx => {
      const keys = (await tx.table('meta').toArray()).map((m: MetaRow) => m.key).filter((k: string) => k.startsWith('cursor:') && k.includes('hse_audits'));
      await tx.table('meta').bulkDelete(keys);
    });
  }
}

export const db = new HseDB();

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined;
}
export async function setMeta(key: string, value: unknown) {
  await db.meta.put({ key, value });
}

/**
 * Borrado seguro de todos los datos locales: primero se destruye la clave de cifrado
 * (los archivos que pudieran quedar en disco son ilegibles), luego se vacían las tablas.
 */
export async function wipeLocalData() {
  await db.keys.clear();
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map(t => t.clear()));
  });
}
