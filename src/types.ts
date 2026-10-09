/** Tipos de las entidades sincronizadas (espejo de las tablas hse_* de PostgreSQL). */

export type Role = 'owner' | 'admin' | 'supervisor' | 'auditor' | 'action_owner' | 'viewer' | 'contractor';

export interface SyncMeta {
  organization_id: string;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;           // fijado por el servidor
  client_updated_at?: string | null;
  deleted_at?: string | null;
}

export interface Membership {
  organization_id: string; organization_name: string; role: Role; company_id: string | null;
}

export interface Company extends SyncMeta {
  id: string; name: string; tax_id: string | null; company_type: 'propia' | 'cliente' | 'contratista' | 'subcontratista';
  parent_company_id: string | null; contact_name: string | null; contact_email: string | null; contact_phone: string | null;
  csms_status: 'no_evaluada' | 'aprobada' | 'condicional' | 'rechazada'; csms_valid_until: string | null; active: boolean;
}
export interface Location extends SyncMeta {
  id: string; company_id: string | null; parent_location_id: string | null; name: string;
  location_type: 'planta' | 'yacimiento' | 'pozo' | 'base' | 'obra' | 'oficina' | 'deposito' | 'otro';
  address: string | null; latitude: number | null; longitude: number | null; active: boolean;
}
export interface Process extends SyncMeta { id: string; name: string; sort_order: number; active: boolean }

export type TemplateCategory = 'seguridad_higiene' | 'salud_ocupacional' | 'medio_ambiente' | 'csms' | 'integral';
export interface Template extends SyncMeta { id: string; name: string; category: TemplateCategory; description: string | null; active: boolean }
export interface TemplateVersion extends SyncMeta {
  id: string; template_id: string; version_number: number; status: 'borrador' | 'publicada' | 'archivada';
  change_notes: string | null; published_at: string | null; published_by: string | null;
  scoring_method: 'ponderado' | 'situacion_promedio_secciones'; scoring_config: unknown;
  validation_status: 'no_requerida' | 'pendiente' | 'validada' | 'rechazada';
  validated_by: string | null; validated_at: string | null; validation_notes: string | null;
  source_file_name: string | null; source_sha256: string | null; import_report: unknown;
}
export interface TemplateSection extends SyncMeta {
  id: string; version_id: string; title: string; description: string | null; sort_order: number; code: string | null; source_ref: string | null;
}
export type ResponseType = 'cumplimiento' | 'si_no' | 'puntaje' | 'numerico' | 'texto' | 'situacion';
export interface TemplateItem extends SyncMeta {
  id: string; version_id: string; section_id: string; code: string | null; question: string; guidance: string | null;
  response_type: ResponseType; weight: number; is_critical: boolean; evidence_required_on_fail: boolean;
  legal_reference: string | null; sort_order: number; process_id: string | null; original_number: string | null;
  source_ref: string | null; review_flags: string[]; is_required: boolean;
}
export interface ImportIssue extends SyncMeta {
  id: string; version_id: string; item_id: string | null; issue_type: string; severity: 'info' | 'advertencia' | 'bloqueante';
  source_ref: string | null; message: string; details: unknown; status: 'pendiente' | 'aceptada' | 'corregida' | 'descartada';
  resolution_note: string | null; resolved_by: string | null; resolved_at: string | null;
}
export interface ValidationCaseRow extends SyncMeta {
  id: string; version_id: string; name: string; source_ref: string | null; answers: Record<string, string>;
  expected: unknown; computed: unknown; matches: boolean | null; max_abs_diff: number | null; last_run_at: string | null;
}

export type AuditStatus = 'planificada' | 'en_curso' | 'completada' | 'cerrada' | 'cancelada';
export interface Audit extends SyncMeta {
  id: string; template_version_id: string; company_id: string | null; location_id: string | null; code: string | null;
  title: string; audit_type: 'interna' | 'externa' | 'csms' | 'seguimiento' | 'legal'; status: AuditStatus;
  scheduled_date: string | null; started_at: string | null; completed_at: string | null; closed_at: string | null;
  lead_auditor_id: string | null; audit_team: string | null; scope: string | null; summary: string | null;
  score: number | null; max_score: number | null; compliance_pct: number | null; critical_failures: number;
  section_results: unknown; result_band: string | null; scoring_snapshot: unknown;
  closing_meeting_at?: string | null; closing_attendees?: string | null; closing_agreements?: string | null;
  /** Contenido redactado del informe final (ver modules/reports/finalReport.ts). */
  report_data?: import('./modules/reports/finalReport').ReportData | null;
  latitude: number | null; longitude: number | null;
  reviewed_by: string | null; reviewed_at: string | null; review_notes: string | null; closed_by: string | null;
}
export type SignerRole = 'auditor_lider' | 'auditor' | 'representante_contratista' | 'representante_cliente' | 'otro';
export interface AuditSignature extends SyncMeta {
  id: string; audit_id: string; signer_role: SignerRole; signer_name: string; signer_position: string | null; signer_company: string | null;
  agreement: 'conforme' | 'con_observaciones'; observations: string | null; signature_png: string; signed_at: string; created_by?: string | null;
}
export interface AuditParticipant extends SyncMeta {
  id: string; audit_id: string; user_id: string; participant_role: 'lider' | 'auditor' | 'observador';
}
export interface AuditResponse extends SyncMeta {
  id: string; audit_id: string; item_id: string; answer: string | null; rating: number | null; numeric_value: number | null;
  text_value: string | null; comment: string | null; answered_by: string | null; answered_at: string | null;
}
export interface Evidence extends SyncMeta {
  id: string; audit_id: string; response_id: string | null; finding_id: string | null; action_id: string | null;
  storage_path: string; file_name: string | null; mime_type: string; size_bytes: number; caption: string | null;
  taken_at: string | null; latitude: number | null; longitude: number | null; uploaded_by: string | null;
}
export type FindingType = 'no_conformidad' | 'nc_mayor' | 'nc_menor' | 'observacion' | 'oportunidad_mejora';
export interface Finding extends SyncMeta {
  id: string; audit_id: string; response_id: string | null; item_id: string | null; company_id: string | null; location_id: string | null;
  code: string | null; title: string; description: string | null; finding_type: FindingType; severity: 'baja' | 'media' | 'alta' | 'critica';
  status: 'abierto' | 'en_tratamiento' | 'cerrado' | 'verificado'; root_cause: string | null; immediate_action: string | null;
  legal_reference: string | null; detected_at: string; due_date: string | null; closed_at: string | null; closed_by: string | null;
  requirement: string | null; rationale?: string | null; category: TemplateCategory | null; process_id: string | null; responsible_user_id: string | null;
  rca_method: 'cinco_porques' | 'ishikawa' | 'otro' | null; rca_data: RcaData | null;
  recurrence_key: string | null; recurrence_of: string | null; recurrence_count: number;
  verification_notes: string | null; effectiveness: 'eficaz' | 'no_eficaz' | null; verified_by: string | null; verified_at: string | null;
}
/** Análisis de causa raíz: 5 porqués o diagrama de Ishikawa (6M). */
export interface RcaData { whys?: string[]; ishikawa?: Partial<Record<IshikawaCat, string>>; notes?: string }
export type IshikawaCat = 'metodo' | 'mano_obra' | 'maquinaria' | 'materiales' | 'medio_ambiente' | 'medicion';
export interface Action extends SyncMeta {
  id: string; finding_id: string; description: string; action_type: 'contencion' | 'correctiva' | 'preventiva';
  responsible_user_id: string | null; responsible_name: string | null; responsible_company_id: string | null;
  due_date: string; status: 'pendiente' | 'en_curso' | 'completada' | 'verificada' | 'cancelada';
  progress_notes: string | null; completed_at: string | null; verified_by: string | null; verified_at: string | null;
  verification_notes: string | null; effectiveness: 'eficaz' | 'no_eficaz' | null; effectiveness_criteria: string | null;
}
export interface NotificationRow {
  id: string; organization_id: string; user_id: string; kind: 'accion_por_vencer' | 'accion_vencida' | 'verificacion_pendiente' | 'hallazgo_vencido';
  entity_table: 'hse_actions' | 'hse_findings'; entity_id: string; due_date: string; title: string; body: string | null;
  created_at: string; updated_at: string; read_at: string | null; resolved_at: string | null; deleted_at?: null;
}
export interface MemberRow extends SyncMeta {
  id: string; user_id: string; role: Role; company_id: string | null; active: boolean;
}
export interface ProfileRow { id: string; email: string; full_name: string | null; phone: string | null; job_title: string | null; default_organization_id: string | null; updated_at?: string }

export const LABELS = {
  role: { owner: 'Administrador (propietario)', admin: 'Administrador', supervisor: 'Coordinador HSE', auditor: 'Auditor', action_owner: 'Responsable de acciones correctivas', viewer: 'Usuario de consulta', contractor: 'Responsable de contratista' } as Record<Role, string>,
  participantRole: { lider: 'Auditor líder', auditor: 'Auditor', observador: 'Observador' },
  signerRole: { auditor_lider: 'Auditor líder', auditor: 'Auditor', representante_contratista: 'Representante del contratista', representante_cliente: 'Representante del cliente', otro: 'Otro' } as Record<SignerRole, string>,
  agreement: { conforme: 'Conforme', con_observaciones: 'Con observaciones' },
  rcaMethod: { cinco_porques: '5 porqués', ishikawa: 'Ishikawa (6M)', otro: 'Otro método' },
  ishikawa: { metodo: 'Método', mano_obra: 'Mano de obra', maquinaria: 'Maquinaria / equipos', materiales: 'Materiales', medio_ambiente: 'Medio ambiente / entorno', medicion: 'Medición / control' } as Record<IshikawaCat, string>,
  notificationKind: { accion_por_vencer: 'Acción por vencer', accion_vencida: 'Acción vencida', verificacion_pendiente: 'Verificación de eficacia pendiente', hallazgo_vencido: 'Hallazgo vencido' },
  category: { seguridad_higiene: 'Seguridad e Higiene', salud_ocupacional: 'Salud Ocupacional', medio_ambiente: 'Medio Ambiente', csms: 'CSMS', integral: 'Integral' } as Record<TemplateCategory, string>,
  auditStatus: { planificada: 'Planificada', en_curso: 'En curso', completada: 'Completada', cerrada: 'Cerrada', cancelada: 'Cancelada' } as Record<AuditStatus, string>,
  findingType: { no_conformidad: 'No conformidad (NC)', nc_mayor: 'NC mayor', nc_menor: 'NC menor', observacion: 'Observación (OBS)', oportunidad_mejora: 'Oportunidad de mejora (OPM)' } as Record<FindingType, string>,
  severity: { baja: 'Baja', media: 'Media', alta: 'Alta', critica: 'Crítica' },
  findingStatus: { abierto: 'Abierto', en_tratamiento: 'En tratamiento', cerrado: 'Cerrado', verificado: 'Verificado' },
  actionStatus: { pendiente: 'Pendiente', en_curso: 'En curso', completada: 'Completada', verificada: 'Verificada', cancelada: 'Cancelada' },
  actionType: { contencion: 'Contención', correctiva: 'Correctiva', preventiva: 'Preventiva' },
  companyType: { propia: 'Propia', cliente: 'Cliente', contratista: 'Contratista', subcontratista: 'Subcontratista' },
  csms: { no_evaluada: 'No evaluada', aprobada: 'Aprobada', condicional: 'Condicional', rechazada: 'Rechazada' },
  locationType: { planta: 'Planta', yacimiento: 'Yacimiento', pozo: 'Pozo', base: 'Base', obra: 'Obra', oficina: 'Oficina', deposito: 'Depósito', otro: 'Otro' },
  auditType: { interna: 'Interna', externa: 'Externa', csms: 'CSMS / segunda parte', seguimiento: 'Seguimiento', legal: 'Legal' },
  versionStatus: { borrador: 'Borrador', publicada: 'Publicada', archivada: 'Archivada' },
  validationStatus: { no_requerida: 'No requiere', pendiente: 'Validación pendiente', validada: 'Validada', rechazada: 'Rechazada' },
  issueStatus: { pendiente: 'Pendiente', aceptada: 'Aceptada', corregida: 'Corregida', descartada: 'Descartada' },
  responseType: { cumplimiento: 'Cumple / No cumple / N/A', si_no: 'Sí / No / N/A', puntaje: 'Puntaje 0–5 (no puntúa)', numerico: 'Numérico (no puntúa)', texto: 'Texto (no puntúa)', situacion: 'NC / OBS / OPM / OK / N/A' } as Record<ResponseType, string>,
};
