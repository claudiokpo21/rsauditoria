import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import type { Audit, TemplateVersion } from '../../types';

/** Resultado oficial de la auditoría anterior comparable (misma empresa y misma plantilla). */
export interface PreviousResult {
  audit: Audit;
  final: number | null;          // nota (H&P) o % de cumplimiento (ponderada)
  band: string | null;
  sections: Map<string, number | null>;   // título normalizado → evaluación de la sección
  versionNumber: number | null;
}

export const normTitle = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const dateKey = (a: Pick<Audit, 'scheduled_date' | 'completed_at' | 'created_at'>) => a.scheduled_date ?? a.completed_at?.slice(0, 10) ?? a.created_at?.slice(0, 10) ?? '';

/**
 * Busca, entre las auditorías sincronizadas en el dispositivo, la última COMPLETADA o CERRADA
 * de la misma empresa con la misma plantilla (cualquier versión) y fecha anterior.
 * Sólo usa resultados oficiales del servidor; nunca recalcula.
 */
export async function findPreviousAudit(audit: Audit, version: TemplateVersion): Promise<PreviousResult | null> {
  if (!audit.company_id) return null;
  const versions = (await db.hse_template_versions.where('template_id').equals(version.template_id).toArray()).filter(v => !v.deleted_at);
  const vNum = new Map(versions.map(v => [v.id, v.version_number]));
  const me = dateKey(audit) || new Date().toISOString().slice(0, 10);
  const cands = (await db.hse_audits.where('company_id').equals(audit.company_id).toArray())
    .filter(a => a.id !== audit.id && !a.deleted_at && vNum.has(a.template_version_id) && ['completada', 'cerrada'].includes(a.status)
      && (a.score !== null || a.compliance_pct !== null) && dateKey(a) <= me
      && !(dateKey(a) === me && (a.created_at ?? '') >= (audit.created_at ?? '')))
    .sort((a, b) => dateKey(b).localeCompare(dateKey(a)) || (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const p = cands[0];
  if (!p) return null;
  const situ = version.scoring_method === 'situacion_promedio_secciones';
  const sections = new Map<string, number | null>();
  for (const s of (Array.isArray(p.section_results) ? p.section_results : []) as { title: string; score: number | null }[])
    sections.set(normTitle(String(s.title)), s.score === null || s.score === undefined ? null : Number(s.score));
  return {
    audit: p, band: p.result_band ?? null, sections, versionNumber: vNum.get(p.template_version_id) ?? null,
    final: situ ? (p.score === null ? null : Number(p.score)) : (p.compliance_pct === null ? null : Number(p.compliance_pct)),
  };
}

export function usePreviousAudit(audit: Audit | null | undefined, version: TemplateVersion | null | undefined) {
  return useLiveQuery(async () => (audit && version ? findPreviousAudit(audit, version) : null), [audit?.id, audit?.updated_at, version?.id]) ?? null;
}
