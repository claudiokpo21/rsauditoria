import { db } from '../../db/db';
import { evaluate, isSituacionConfig, type EvalResult, type SectionResult } from '../../scoring/engine';
import { supabase } from '../../lib/supabase';
import { LABELS, type RcaData } from '../../types';
import type { Action, Audit, AuditResponse, Evidence, Finding, Template, TemplateItem, TemplateSection, TemplateVersion } from '../../types';

export interface AuditReport {
  orgName: string; audit: Audit; version: TemplateVersion; template: Template | undefined;
  sections: TemplateSection[]; items: TemplateItem[]; responses: Map<string, AuditResponse>;
  findings: Finding[]; actions: Action[]; evidences: Evidence[];
  names: { company: (id?: string | null) => string; location: (id?: string | null) => string; process: (id?: string | null) => string; person: (id?: string | null) => string };
  result: EvalResult; optionLabel: (code?: string | null) => string; official: boolean;
  /** Resultado por sección: el OFICIAL guardado por el servidor si la auditoría está completada; si no, vista previa. */
  sectionsResult: SectionResult[];
  history: HistoryRow[] | null;
}
export interface HistoryRow { changed_at: string; table_name: string; record_label: string; action: string; changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; user_name: string }

/** Texto del análisis de causa raíz (5 porqués / Ishikawa) para informes. */
export function rcaText(method: string | null, data: RcaData | null, conclusion: string | null): string {
  const parts: string[] = [];
  if (method) parts.push(`Método: ${LABELS.rcaMethod[method as keyof typeof LABELS.rcaMethod] ?? method}`);
  (data?.whys ?? []).filter(w => w?.trim()).forEach((w, i) => parts.push(`¿Por qué? ${i + 1}: ${w.trim()}`));
  for (const [k, v] of Object.entries(data?.ishikawa ?? {})) if (v?.trim()) parts.push(`${LABELS.ishikawa[k as keyof typeof LABELS.ishikawa] ?? k}: ${v.trim()}`);
  if (data?.notes?.trim()) parts.push(`Notas: ${data.notes.trim()}`);
  if (conclusion?.trim()) parts.push(`Causa raíz: ${conclusion.trim()}`);
  return parts.join('\n') || '—';
}

/** Historial completo de la auditoría (servidor; requiere conexión). */
export async function loadAuditHistory(auditId: string): Promise<HistoryRow[] | null> {
  if (!navigator.onLine) return null;
  const { data, error } = await supabase.rpc('hse_audit_history', { p_audit: auditId });
  return error ? null : (data as HistoryRow[]);
}

const live = <T extends { deleted_at?: string | null }>(r: T[]) => r.filter(x => !x.deleted_at);

export async function loadAuditReport(auditId: string, orgName: string, opts: { history?: boolean } = {}): Promise<AuditReport> {
  const audit = await db.hse_audits.get(auditId);
  if (!audit) throw new Error('Auditoría no encontrada');
  const version = await db.hse_template_versions.get(audit.template_version_id);
  if (!version) throw new Error('La versión de plantilla no está en el dispositivo');
  const template = await db.hse_templates.get(version.template_id);
  const sections = live(await db.hse_template_sections.where('version_id').equals(version.id).toArray()).sort((a, b) => a.sort_order - b.sort_order);
  const items = live(await db.hse_template_items.where('version_id').equals(version.id).toArray()).sort((a, b) => a.sort_order - b.sort_order);
  const resp = live(await db.hse_audit_responses.where('audit_id').equals(auditId).toArray());
  const findings = live(await db.hse_findings.where('audit_id').equals(auditId).toArray());
  const fIds = new Set(findings.map(f => f.id));
  const actions = live(await db.hse_actions.where('organization_id').equals(audit.organization_id).toArray()).filter(a => fIds.has(a.finding_id));
  const evidences = live(await db.hse_evidences.where('audit_id').equals(auditId).toArray());
  const [companies, locations, processes, profiles] = await Promise.all([db.hse_companies.toArray(), db.hse_locations.toArray(), db.hse_processes.toArray(), db.profiles.toArray()]);
  const m = <T extends { id: string }>(rows: T[], f: (r: T) => string) => { const mm = new Map(rows.map(r => [r.id, f(r)])); return (id?: string | null) => (id ? mm.get(id) ?? '—' : '—'); };
  const answers = Object.fromEntries(resp.filter(r => r.answer).map(r => [r.item_id, r.answer!]));
  const labels: Record<string, string> = { cumple: 'Cumple', no_cumple: 'No cumple', no_aplica: 'N/A', si: 'Sí', no: 'No' };
  if (isSituacionConfig(version.scoring_config)) for (const o of version.scoring_config.options) labels[o.code] = o.label;
  const result = evaluate(version, sections, items, answers);
  const official = audit.status === 'completada' || audit.status === 'cerrada';
  const serverSections = Array.isArray(audit.section_results) ? audit.section_results as SectionResult[] : null;
  return {
    orgName, audit, version, template, sections, items, responses: new Map(resp.map(r => [r.item_id, r])), findings, actions, evidences,
    names: { company: m(companies, c => c.name), location: m(locations, l => l.name), process: m(processes, p => p.name), person: m(profiles, p => p.full_name || p.email) },
    result,
    optionLabel: c => (c ? labels[c] ?? c : '—'),
    official,
    sectionsResult: official && serverSections ? serverSections : result.sections,
    history: opts.history ? await loadAuditHistory(auditId) : null,
  };
}
