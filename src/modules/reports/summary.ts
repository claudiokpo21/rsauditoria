/**
 * Indicadores de gestión. Con conexión se piden al servidor (hse_report_summary, bajo RLS:
 * cada usuario ve sólo lo que su rol permite). Sin conexión se calculan con los mismos
 * criterios sobre los datos ya sincronizados en el dispositivo, y se indica el origen.
 * En ningún caso se recalcula el puntaje: se usan los resultados oficiales guardados por
 * el servidor al completar cada auditoría (score, compliance_pct, result_band, section_results).
 */
import { db, getMeta } from '../../db/db';
import { supabase } from '../../lib/supabase';
import type { Action, Audit, Company, Finding, Template, TemplateCategory, TemplateItem, TemplateVersion } from '../../types';

export interface ReportSummary {
  generated_at: string; from: string | null; to: string | null; company_id: string | null;
  audits: { total: number; by_status: Record<string, number>; overdue_planned: number; pending_review: number; ready_to_close: number; critical_failures: number };
  results: { avg_compliance: number | null; bands: Record<string, number> };
  by_template_category: { category: TemplateCategory; audits: number; avg_compliance: number | null; findings: number }[];
  by_section: { template_id: string; template_name: string; title: string; scoring_method: string; audits: number; avg_score: number | null; raw: number; target: number }[];
  findings: { total: number; open: number; pending_verification: number; overdue: number; recurrent: number; effective: number; not_effective: number; avg_days_to_close: number | null;
    by_type: Record<string, number>; by_severity: Record<string, number>; by_status: Record<string, number>; by_category: Record<string, number> };
  actions: { total: number; overdue: number; due_7_days: number; completed_on_time: number; completed: number; effective: number; not_effective: number; by_status: Record<string, number>; by_type: Record<string, number> };
  by_company: { id: string; name: string; audits: number; avg_compliance: number | null; open_findings: number; recurrent_findings: number; overdue_actions: number }[];
  monthly: { month: string; audits: number; avg_compliance: number | null }[];
  findings_monthly: { month: string; detected: number; closed: number }[];
  recurrent: { recurrence_key: string; occurrences: number; audits: number; last_detected: string; company: string | null; item_code: string | null; item_number: string | null; question: string | null;
    findings: { id: string; code: string | null; status: string; detected_at: string }[] }[];
}
export interface SummaryResult { data: ReportSummary; source: 'servidor' | 'dispositivo'; lastSync: string | null }

const live = <T extends { deleted_at?: string | null }>(r: T[]) => r.filter(x => !x.deleted_at);
const count = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
  const m: Record<string, number> = {};
  for (const r of rows) { const k = key(r) ?? 'sin_categoria'; m[k] = (m[k] ?? 0) + 1; }
  return m;
};
const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x !== null && x !== undefined).map(Number); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; };
const day = (s?: string | null) => (s ?? '').slice(0, 10);

export async function computeLocalSummary(orgId: string, from: string | null, to: string | null, company: string | null): Promise<ReportSummary> {
  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const [audits0, findings0, actions0, companies, versions, templates, items] = await Promise.all([
    db.hse_audits.where('organization_id').equals(orgId).toArray(), db.hse_findings.where('organization_id').equals(orgId).toArray(),
    db.hse_actions.where('organization_id').equals(orgId).toArray(), db.hse_companies.where('organization_id').equals(orgId).toArray(),
    db.hse_template_versions.where('organization_id').equals(orgId).toArray(), db.hse_templates.where('organization_id').equals(orgId).toArray(),
    db.hse_template_items.where('organization_id').equals(orgId).toArray()]);
  const vById = new Map((versions as TemplateVersion[]).map(v => [v.id, v]));
  const tById = new Map((templates as Template[]).map(t => [t.id, t]));
  const iById = new Map((items as TemplateItem[]).map(i => [i.id, i]));
  const A = live(audits0 as Audit[]).filter(a => {
    const d = day(a.scheduled_date ?? a.created_at);
    return (!from || d >= from) && (!to || d <= to) && (!company || a.company_id === company);
  });
  const aIds = new Set(A.map(a => a.id));
  const done = A.filter(a => a.status === 'completada' || a.status === 'cerrada');
  const tmpl = (a: Audit) => tById.get(vById.get(a.template_version_id)?.template_id ?? '');
  const F = live(findings0 as Finding[]).filter(f => aIds.has(f.audit_id));
  const fIds = new Set(F.map(f => f.id));
  const X = live(actions0 as Action[]).filter(x => fIds.has(x.finding_id));
  const open = (f: Finding) => f.status === 'abierto' || f.status === 'en_tratamiento';
  const pend = (x: Action) => x.status === 'pendiente' || x.status === 'en_curso';
  const closedDays = F.filter(f => f.closed_at).map(f => (Date.parse(f.closed_at!) - Date.parse(f.detected_at)) / 864e5);

  const catMap = new Map<string, Audit[]>();
  for (const a of done) { const c = tmpl(a)?.category ?? 'integral'; catMap.set(c, [...(catMap.get(c) ?? []), a]); }
  const secMap = new Map<string, ReportSummary['by_section'][number] & { scores: number[]; so: number }>();
  for (const a of done) {
    const t = tmpl(a); const v = vById.get(a.template_version_id);
    ((a.section_results as unknown as { title: string; score: number | null; raw: number; target: number }[] | null) ?? []).forEach((s, i) => {
      const k = `${t?.id}|${s.title}`;
      const cur = secMap.get(k) ?? { template_id: t?.id ?? '', template_name: t?.name ?? '', title: s.title, scoring_method: v?.scoring_method ?? '', audits: 0, avg_score: null, raw: 0, target: 0, scores: [], so: i };
      cur.audits++; cur.raw += Number(s.raw); cur.target += Number(s.target); if (s.score !== null) cur.scores.push(Number(s.score));
      secMap.set(k, cur);
    });
  }
  const companiesInA = (companies as Company[]).filter(c => A.some(a => a.company_id === c.id));
  const month = (s: string) => s.slice(0, 7);
  const monthsA = new Map<string, Audit[]>(); for (const a of done) { const m = month(a.completed_at ?? a.scheduled_date ?? a.created_at ?? ''); monthsA.set(m, [...(monthsA.get(m) ?? []), a]); }
  const monthsF = new Map<string, Finding[]>(); for (const f of F) { const m = month(f.detected_at); monthsF.set(m, [...(monthsF.get(m) ?? []), f]); }

  // recurrencia: grupos con hallazgos en 2+ auditorías (sobre todo lo sincronizado de la organización)
  const groups = new Map<string, Finding[]>();
  for (const f of live(findings0 as Finding[])) if (f.recurrence_key && (!company || f.company_id === company)) groups.set(f.recurrence_key, [...(groups.get(f.recurrence_key) ?? []), f]);
  const recurrent = [...groups].filter(([, fs]) => new Set(fs.map(f => f.audit_id)).size >= 2)
    .filter(([, fs]) => (!from || fs.some(f => day(f.detected_at) >= from)) && (!to || fs.some(f => day(f.detected_at) <= to)))
    .map(([key, fs]) => {
      const s = [...fs].sort((a, b) => a.detected_at.localeCompare(b.detected_at)); const it = iById.get(s[0].item_id ?? '');
      return { recurrence_key: key, occurrences: fs.length, audits: new Set(fs.map(f => f.audit_id)).size, last_detected: s[s.length - 1].detected_at,
        company: (companies as Company[]).find(c => c.id === s[0].company_id)?.name ?? null, item_code: it?.code ?? null, item_number: it?.original_number ?? null,
        question: it?.question?.slice(0, 200) ?? null, findings: s.map(f => ({ id: f.id, code: f.code, status: f.status, detected_at: f.detected_at })) };
    }).sort((a, b) => b.occurrences - a.occurrences || b.last_detected.localeCompare(a.last_detected)).slice(0, 50);

  return {
    generated_at: new Date().toISOString(), from, to, company_id: company,
    audits: { total: A.length, by_status: count(A, a => a.status), overdue_planned: A.filter(a => a.status === 'planificada' && !!a.scheduled_date && a.scheduled_date < today).length,
      pending_review: A.filter(a => a.status === 'completada' && !a.reviewed_at).length, ready_to_close: A.filter(a => a.status === 'completada' && !!a.reviewed_at).length,
      critical_failures: done.reduce((s, a) => s + (a.critical_failures ?? 0), 0) },
    results: { avg_compliance: avg(done.map(a => a.compliance_pct)), bands: count(done.filter(a => a.result_band), a => a.result_band) },
    by_template_category: [...catMap].map(([category, as]) => ({ category: category as TemplateCategory, audits: as.length, avg_compliance: avg(as.map(a => a.compliance_pct)), findings: F.filter(f => as.some(a => a.id === f.audit_id)).length })).sort((a, b) => a.category.localeCompare(b.category)),
    by_section: [...secMap.values()].sort((a, b) => a.template_name.localeCompare(b.template_name) || a.so - b.so)
      .map(({ scores, so: _so, ...r }) => ({ ...r, avg_score: scores.length ? Math.round((scores.reduce((x, y) => x + y, 0) / scores.length) * 10000) / 10000 : null })),
    findings: { total: F.length, open: F.filter(open).length, pending_verification: F.filter(f => f.status === 'cerrado').length,
      overdue: F.filter(f => open(f) && !!f.due_date && f.due_date < today).length, recurrent: F.filter(f => f.recurrence_count > 0).length,
      effective: F.filter(f => f.status === 'verificado' && f.effectiveness === 'eficaz').length, not_effective: F.filter(f => f.effectiveness === 'no_eficaz').length,
      avg_days_to_close: closedDays.length ? Math.round((closedDays.reduce((a, b) => a + b, 0) / closedDays.length) * 10) / 10 : null,
      by_type: count(F, f => f.finding_type), by_severity: count(F, f => f.severity), by_status: count(F, f => f.status), by_category: count(F, f => f.category) },
    actions: { total: X.length, overdue: X.filter(x => pend(x) && x.due_date < today).length, due_7_days: X.filter(x => pend(x) && x.due_date >= today && x.due_date <= in7).length,
      completed_on_time: X.filter(x => (x.status === 'completada' || x.status === 'verificada') && !!x.completed_at && day(x.completed_at) <= x.due_date).length,
      completed: X.filter(x => x.status === 'completada' || x.status === 'verificada').length, effective: X.filter(x => x.effectiveness === 'eficaz').length,
      not_effective: X.filter(x => x.effectiveness === 'no_eficaz').length, by_status: count(X, x => x.status), by_type: count(X, x => x.action_type) },
    by_company: companiesInA.map(c => ({ id: c.id, name: c.name, audits: A.filter(a => a.company_id === c.id).length, avg_compliance: avg(done.filter(a => a.company_id === c.id).map(a => a.compliance_pct)),
      open_findings: F.filter(f => f.company_id === c.id && open(f)).length, recurrent_findings: F.filter(f => f.company_id === c.id && f.recurrence_count > 0).length,
      overdue_actions: X.filter(x => pend(x) && x.due_date < today && F.find(f => f.id === x.finding_id)?.company_id === c.id).length }))
      .sort((a, b) => b.audits - a.audits || a.name.localeCompare(b.name)),
    monthly: [...monthsA].sort(([a], [b]) => a.localeCompare(b)).map(([m, as]) => ({ month: m, audits: as.length, avg_compliance: avg(as.map(a => a.compliance_pct)) })),
    findings_monthly: [...monthsF].sort(([a], [b]) => a.localeCompare(b)).map(([m, fs]) => ({ month: m, detected: fs.length, closed: fs.filter(f => f.closed_at).length })),
    recurrent,
  };
}

/** Servidor si hay conexión (fuente de verdad); si no, el dispositivo. */
export async function loadSummary(orgId: string, from: string | null, to: string | null, company: string | null): Promise<SummaryResult> {
  const lastSync = (await getMeta<string>(`last_sync_confirmed:${orgId}`)) ?? null;
  if (navigator.onLine) {
    const { data, error } = await supabase.rpc('hse_report_summary', { p_org: orgId, p_from: from, p_to: to, p_company: company });
    if (!error && data) return { data: data as ReportSummary, source: 'servidor', lastSync };
  }
  return { data: await computeLocalSummary(orgId, from, to, company), source: 'dispositivo', lastSync };
}
