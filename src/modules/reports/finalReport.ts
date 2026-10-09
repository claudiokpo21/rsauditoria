/**
 * Informe final de auditoría (modelo RS Consultora, "Informe final auditoría de segunda parte").
 *
 * Lo que sale de la lista de verificación (resultado, hallazgos, fotos, firmas) se toma de la
 * auditoría; lo que se redacta (datos generales, objetivo, criterios, plan, desarrollo,
 * conclusiones, fortalecimiento, declaración) se guarda en hse_audits.report_data.
 * Los textos admiten: una línea en blanco separa párrafos, "- " al inicio arma una viñeta y
 * **texto** va en negrita.
 */
import type { Audit } from '../../types';

/** Fila del cronograma; highlight = hito resaltado en verde (traslados, fin del día, reunión de cierre). */
export interface PlanRow { date: string; time: string; process: string; auditees: string; topics: string; highlight?: boolean }
export interface Conformity { section: string; text: string }
/** Fortalecimiento: una fortaleza del contratista (área + descripción). */
export interface Strength { area: string; text: string }

/** Aceptación del plan por el cliente: la auditoría se inicia recién con el plan aceptado. */
export interface PlanApproval {
  status: 'borrador' | 'enviado' | 'aprobado';
  sent_at?: string | null; sent_to?: string | null;
  approved_by?: string | null; approved_at?: string | null; notes?: string | null;
  /** huella del plan aceptado: si después se cambia, se avisa que difiere de lo aceptado */
  plan_hash?: string | null;
}

export interface ReportData {
  plan_title?: string;
  plan_approval?: PlanApproval;
  title?: string;
  requesting_company?: string;
  contractor?: string;
  contract?: string;
  lead_auditor?: string;
  dates_text?: string;
  places?: string;
  objectives?: string;
  criteria?: string;
  plan?: PlanRow[];
  development?: string;
  conclusions?: string;
  conformities?: Conformity[];
  strengths?: Strength[];
  recommendation?: string;
  statement?: string;
}

export const DEFAULT_TITLE = 'INFORME FINAL AUDITORIA DE SEGUNDA PARTE';
export const DEFAULT_PLAN_TITLE = 'PLAN DE AUDITORIA DE SEGUNDA PARTE';
export const DEFAULT_OBJECTIVES = [
  '- Verificar el grado de conformidad, cumplimiento y eficacia del Sistema de Gestión del Contratista respecto de los criterios de auditoría y de la adecuación a los requerimientos del Cliente.',
  '- Evaluar la capacidad del sistema de Gestión del Contratista para asegurar el cumplimiento de los requisitos legales y contractuales establecidos para el presente servicio.',
  '- Identificar oportunidades de mejora al Sistema de Gestión del Contratista.',
].join('\n');
export const DEFAULT_CRITERIA = [
  '- Sistema de Gestión integrado del Contratista',
  '- Requisitos Legales o Regulatorios',
  '- Requisitos Contractuales',
  '- ISO 45001:2018 Gestión de SST',
  '- ISO 14001:2015 Gestión Ambiental',
].join('\n');
export const DEFAULT_RECOMMENDATION = 'Se recomienda la implementación de acciones correctivas para las Observaciones y No Conformidades detectadas.';
export const DEFAULT_STATEMENT = 'El presente informe refleja los hallazgos observados durante la auditoría realizada en las fechas indicadas. Las conclusiones se basan en la evidencia disponible al momento de la evaluación y no constituyen una garantía absoluta del desempeño del Contratista.';

export interface ReportContext { company: string; location: string; leadAuditor: string; sections: string[] }

const fmtDate = (s?: string | null) => (s ? new Date(s + 'T12:00:00').toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '-') : '');

/** Valores sugeridos cuando un campo todavía no se completó. */
export function reportDefaults(a: Audit, ctx: ReportContext): Required<ReportData> {
  return {
    plan_title: DEFAULT_PLAN_TITLE,
    plan_approval: { status: 'borrador' },
    title: DEFAULT_TITLE,
    requesting_company: '',
    contractor: ctx.company === '—' ? '' : ctx.company,
    contract: ctx.location === '—' ? '' : ctx.location,
    lead_auditor: a.audit_team?.trim() || (ctx.leadAuditor === '—' ? '' : ctx.leadAuditor),
    dates_text: fmtDate(a.scheduled_date),
    places: ctx.location === '—' ? '' : ctx.location,
    objectives: DEFAULT_OBJECTIVES,
    criteria: DEFAULT_CRITERIA,
    plan: [],
    development: a.scope ?? '',
    conclusions: a.summary ?? '',
    conformities: ctx.sections.map(section => ({ section, text: '' })),
    strengths: [],
    recommendation: DEFAULT_RECOMMENDATION,
    statement: DEFAULT_STATEMENT,
  };
}

/** Lo guardado sobre los valores sugeridos (un campo vacío guardado se respeta como vacío salvo título y textos fijos). */
export function resolveReport(a: Audit, ctx: ReportContext): Required<ReportData> {
  const def = reportDefaults(a, ctx);
  const saved = (a.report_data ?? {}) as ReportData;
  const out = { ...def } as Required<ReportData>;
  for (const k of Object.keys(def) as (keyof ReportData)[]) {
    const v = saved[k];
    if (v !== undefined && v !== null) (out as unknown as Record<string, unknown>)[k] = v;
  }
  if (!out.title.trim()) out.title = DEFAULT_TITLE;
  if (!out.plan_title.trim()) out.plan_title = DEFAULT_PLAN_TITLE;
  // conformidades: una por requisito de la plantilla, conservando lo escrito
  const byTitle = new Map((out.conformities ?? []).map(c => [norm(c.section), c.text]));
  const extra = (out.conformities ?? []).filter(c => !ctx.sections.some(s => norm(s) === norm(c.section)) && c.text.trim());
  out.conformities = [...ctx.sections.map(section => ({ section, text: byTitle.get(norm(section)) ?? '' })), ...extra];
  return out;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Bloques de un texto redactado: párrafos y viñetas (para el PDF). */
export type TextBlock = { kind: 'p' | 'li'; text: string };
export function textBlocks(s: string): TextBlock[] {
  const out: TextBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: 'p', text: para.join(' ') }); para = []; };
  for (const raw of (s ?? '').split('\n')) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const m = /^([-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (m && !line.startsWith('**')) { flush(); out.push({ kind: 'li', text: m[2] }); continue; }
    para.push(line);
  }
  flush();
  return out;
}

/** Segmentos con negrita a partir de **texto**. */
export function boldSegments(s: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), bold: false });
  return out.filter(x => x.text);
}

export const stripBold = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1');

/** Agrupa filas consecutivas del plan con la misma fecha (para combinar la celda Fecha). */
export function planGroups(rows: PlanRow[]): { date: string; rows: PlanRow[] }[] {
  const out: { date: string; rows: PlanRow[] }[] = [];
  for (const r of rows) {
    const d = r.date.trim();
    const g = out[out.length - 1];
    if (g && (d === '' || d === g.date)) g.rows.push(r); else out.push({ date: d, rows: [r] });
  }
  return out;
}

/** Campos que forman el plan (si cambian después de aceptado, el plan difiere de lo aceptado). */
export function planHash(r: ReportData): string {
  const src = JSON.stringify([r.requesting_company, r.contractor, r.contract, r.lead_auditor, r.dates_text, r.places, r.objectives, r.criteria,
    (r.plan ?? []).map(p => [p.date, p.time, p.process, p.auditees, p.topics, !!p.highlight])]);
  let h = 5381;
  for (let i = 0; i < src.length; i++) h = ((h * 33) ^ src.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export const planAccepted = (a: Audit) => (a.report_data as ReportData | null | undefined)?.plan_approval?.status === 'aprobado';
