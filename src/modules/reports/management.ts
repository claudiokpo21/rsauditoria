/**
 * Informe de gestión (organización / período / empresa): resultados por categoría y por
 * sección, hallazgos, planes de acción, recurrencias y seguimiento de auditorías.
 * Indicadores: hse_report_summary (servidor) o cálculo equivalente en el dispositivo.
 * Listados de detalle: datos sincronizados en el dispositivo (se informa la fecha).
 */
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { db } from '../../db/db';
import { LABELS, type Action, type Audit, type Finding, type TemplateCategory } from '../../types';
import type { SummaryResult } from './summary';
import { addFindingSheets } from './excel';

export interface MgmtFilters { from: string | null; to: string | null; company: string | null; companyName?: string }
const live = <T extends { deleted_at?: string | null }>(r: T[]) => r.filter(x => !x.deleted_at);
const CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const t = (s?: string | null) => (s ?? '').replace(/≤/g, '<=').replace(/≥/g, '>=').split('').filter(c => c.charCodeAt(0) < 256 || CP1252.includes(c) || c === '\n').join('');
const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-AR') : '—');
const n = (v?: number | null, dec = 1) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const pct = (a: number, b: number) => (b ? `${n((100 * a) / b, 0)} %` : '—');
const label = (map: Record<string, string>, k: string) => map[k] ?? (k === 'sin_categoria' ? 'Sin categoría' : k);

export interface MgmtDetail { audits: Audit[]; findings: Finding[]; actions: Action[]; names: { company: (id?: string | null) => string; person: (id?: string | null) => string; audit: (id: string) => string } }

export async function loadMgmtDetail(orgId: string, f: MgmtFilters): Promise<MgmtDetail> {
  const [audits, findings, actions, companies, profiles] = await Promise.all([
    db.hse_audits.where('organization_id').equals(orgId).toArray(), db.hse_findings.where('organization_id').equals(orgId).toArray(),
    db.hse_actions.where('organization_id').equals(orgId).toArray(), db.hse_companies.where('organization_id').equals(orgId).toArray(), db.profiles.toArray()]);
  const A = live(audits).filter(a => { const x = (a.scheduled_date ?? a.created_at ?? '').slice(0, 10); return (!f.from || x >= f.from) && (!f.to || x <= f.to) && (!f.company || a.company_id === f.company); });
  const ids = new Set(A.map(a => a.id)); const F = live(findings).filter(x => ids.has(x.audit_id)); const fids = new Set(F.map(x => x.id));
  const cn = new Map(companies.map(c => [c.id, c.name])); const pn = new Map(profiles.map(p => [p.id, p.full_name || p.email])); const an = new Map(audits.map(a => [a.id, a.code ?? a.title]));
  return { audits: A, findings: F, actions: live(actions).filter(x => fids.has(x.finding_id)),
    names: { company: id => (id ? cn.get(id) ?? '—' : '—'), person: id => (id ? pn.get(id) ?? 'Usuario de la organización' : '—'), audit: id => an.get(id) ?? '—' } };
}

const filtersText = (f: MgmtFilters) => `Período: ${f.from ? d(f.from) : 'inicio'} – ${f.to ? d(f.to) : 'hoy'} · Empresa: ${f.companyName ?? 'todas'}`;
const sourceText = (s: SummaryResult) => s.source === 'servidor'
  ? `Indicadores calculados por el servidor (${new Date(s.data.generated_at).toLocaleString('es-AR')}) con los permisos del usuario.`
  : `SIN CONEXIÓN: indicadores calculados en el dispositivo con lo sincronizado${s.lastSync ? ` al ${new Date(s.lastSync).toLocaleString('es-AR')}` : ''}.`;

export async function buildMgmtPdf(orgName: string, f: MgmtFilters, s: SummaryResult, det: MgmtDetail): Promise<Blob> {
  const S = s.data; const doc = new jsPDF({ unit: 'mm', format: 'a4' }); const W = doc.internal.pageSize.getWidth();
  const brand: [number, number, number] = [31, 77, 58];
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const h2 = (txt: string, y: number) => { if (y > 260) { doc.addPage(); y = 16; } doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30); doc.text(t(txt), 14, y); return y + 3; };
  const table = (y: number, head: string[], body: (string | number)[][], opts: Record<string, unknown> = {}) => {
    autoTable(doc, { startY: y, head: [head], body: body.length ? body.map(r => r.map(c => t(String(c)))) : [[{ content: 'Sin datos', colSpan: head.length }] as never], headStyles: { fillColor: brand }, styles: { fontSize: 8, valign: 'top' }, ...opts });
    return last() + 7;
  };
  doc.setFillColor(...brand); doc.rect(0, 0, W, 24, 'F'); doc.setTextColor(255);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Informe de gestión HSE', 14, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(t(`${orgName} · ${filtersText(f)}`), 14, 18);
  doc.setTextColor(90); doc.setFontSize(7.5); doc.text(t(sourceText(s)), 14, 29);

  let y = h2('Resumen', 36);
  y = table(y, ['Indicador', 'Valor'], [
    ['Auditorías del período', S.audits.total], ['Cumplimiento promedio (resultados oficiales)', S.results.avg_compliance === null ? '—' : `${n(S.results.avg_compliance)} %`],
    ['Planificadas atrasadas', S.audits.overdue_planned], ['Completadas pendientes de revisión', S.audits.pending_review], ['Listas para cerrar', S.audits.ready_to_close],
    ['Ítems críticos incumplidos', S.audits.critical_failures],
    ['Hallazgos (abiertos / total)', `${S.findings.open} / ${S.findings.total}`], ['Hallazgos vencidos', S.findings.overdue], ['Pendientes de verificación', S.findings.pending_verification],
    ['Hallazgos recurrentes', S.findings.recurrent], ['Verificados eficaces / no eficaces', `${S.findings.effective} / ${S.findings.not_effective}`],
    ['Días promedio hasta el cierre', S.findings.avg_days_to_close === null ? '—' : n(S.findings.avg_days_to_close)],
    ['Acciones (vencidas / total)', `${S.actions.overdue} / ${S.actions.total}`], ['Acciones que vencen en 7 días', S.actions.due_7_days],
    ['Acciones cumplidas en plazo', `${S.actions.completed_on_time} de ${S.actions.completed} (${pct(S.actions.completed_on_time, S.actions.completed)})`],
  ], { columnStyles: { 0: { cellWidth: 100 } } });

  y = h2('Resultados por categoría de plantilla', y);
  y = table(y, ['Categoría', 'Auditorías completadas', 'Cumplimiento promedio', 'Hallazgos'], S.by_template_category.map(c => [LABELS.category[c.category as TemplateCategory] ?? c.category, c.audits, c.avg_compliance === null ? '—' : `${n(c.avg_compliance)} %`, c.findings]));
  if (Object.keys(S.results.bands).length) { y = h2('Calificación (bandas de la metodología)', y); y = table(y, ['Calificación', 'Auditorías'], Object.entries(S.results.bands).map(([k, v]) => [k, v])); }
  y = h2('Resultados por sección (promedio de resultados oficiales)', y);
  y = table(y, ['Plantilla', 'Sección', 'Auditorías', 'Promedio', 'Escala'], S.by_section.map(x => [x.template_name, x.title.trim(), x.audits, n(x.avg_score, 2), x.scoring_method === 'ponderado' ? '% cumplimiento' : 'nota 0–10']),
    { columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 80 } } });
  y = h2('Hallazgos por categoría, tipo y severidad', y);
  const rows: (string | number)[][] = [
    ...Object.entries(S.findings.by_category).map(([k, v]) => ['Categoría', label(LABELS.category, k), v]),
    ...Object.entries(S.findings.by_type).map(([k, v]) => ['Tipo', label(LABELS.findingType, k), v]),
    ...Object.entries(S.findings.by_severity).map(([k, v]) => ['Severidad', label(LABELS.severity, k), v]),
    ...Object.entries(S.findings.by_status).map(([k, v]) => ['Estado', label(LABELS.findingStatus, k), v]),
  ];
  y = table(y, ['Agrupación', 'Valor', 'Cantidad'], rows);
  y = h2('Planes de acción', y);
  y = table(y, ['Agrupación', 'Valor', 'Cantidad'], [
    ...Object.entries(S.actions.by_type).map(([k, v]) => ['Tipo', label(LABELS.actionType, k), v]),
    ...Object.entries(S.actions.by_status).map(([k, v]) => ['Estado', label(LABELS.actionStatus, k), v]),
    ['Eficacia', 'Eficaz', S.actions.effective], ['Eficacia', 'No eficaz', S.actions.not_effective]]);
  y = h2('Empresas y contratistas', y);
  y = table(y, ['Empresa', 'Auditorías', 'Cumplimiento', 'Hallazgos abiertos', 'Recurrentes', 'Acciones vencidas'], S.by_company.map(c => [c.name, c.audits, c.avg_compliance === null ? '—' : `${n(c.avg_compliance)} %`, c.open_findings, c.recurrent_findings, c.overdue_actions]));
  y = h2('Hallazgos recurrentes (mismo requisito, misma empresa, 2+ auditorías)', y);
  y = table(y, ['Empresa', 'Requisito', 'Veces', 'Auditorías', 'Último', 'Hallazgos'], S.recurrent.map(r => [r.company ?? '—', `${r.item_number ?? r.item_code ?? ''} ${r.question ?? ''}`.trim(), r.occurrences, r.audits, d(r.last_detected), r.findings.map(x => x.code ?? '').join(', ')]),
    { columnStyles: { 1: { cellWidth: 80 } } });
  y = h2('Evolución mensual', y);
  const months = [...new Set([...S.monthly.map(m => m.month), ...S.findings_monthly.map(m => m.month)])].sort();
  y = table(y, ['Mes', 'Auditorías completadas', 'Cumplimiento promedio', 'Hallazgos detectados', 'Hallazgos cerrados'], months.map(m => {
    const a = S.monthly.find(x => x.month === m); const fm = S.findings_monthly.find(x => x.month === m);
    return [m, a?.audits ?? 0, a?.avg_compliance === null || a?.avg_compliance === undefined ? '—' : `${n(a.avg_compliance)} %`, fm?.detected ?? 0, fm?.closed ?? 0];
  }));

  const today = new Date().toISOString().slice(0, 10);
  doc.addPage(); y = h2('Seguimiento: acciones vencidas o por vencer (datos del dispositivo)', 16);
  const due = det.actions.filter(x => ['pendiente', 'en_curso'].includes(x.status)).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const fById = new Map(det.findings.map(x => [x.id, x]));
  y = table(y, ['Vence', 'Hallazgo', 'Acción', 'Responsable', 'Estado'], due.map(x => [`${d(x.due_date)}${x.due_date < today ? ' (VENCIDA)' : ''}`, fById.get(x.finding_id)?.code ?? '—', x.description, x.responsible_user_id ? det.names.person(x.responsible_user_id) : x.responsible_name ?? det.names.company(x.responsible_company_id), LABELS.actionStatus[x.status]]),
    { columnStyles: { 2: { cellWidth: 80 } } });
  y = h2('Seguimiento: hallazgos abiertos', y);
  y = table(y, ['Código', 'Hallazgo', 'Tipo', 'Empresa', 'Responsable', 'Vence', 'Estado'], det.findings.filter(x => x.status !== 'verificado').sort((a, b) => (a.due_date ?? '9').localeCompare(b.due_date ?? '9'))
    .map(x => [x.code ?? '—', x.title, LABELS.findingType[x.finding_type], det.names.company(x.company_id), det.names.person(x.responsible_user_id), d(x.due_date), LABELS.findingStatus[x.status]]), { columnStyles: { 1: { cellWidth: 60 } } });
  y = h2('Seguimiento de auditorías', y);
  table(y, ['Auditoría', 'Empresa', 'Fecha', 'Estado', 'Seguimiento'], det.audits.filter(a => a.status !== 'cerrada' && a.status !== 'cancelada').sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''))
    .map(a => [a.code ?? a.title, det.names.company(a.company_id), d(a.scheduled_date), LABELS.auditStatus[a.status],
      a.status === 'planificada' && a.scheduled_date && a.scheduled_date < today ? 'Atrasada' : a.status === 'completada' ? (a.reviewed_at ? 'Lista para cerrar' : 'Pendiente de revisión') : '']));

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) { doc.setPage(p); doc.setFontSize(7); doc.setTextColor(120); doc.text(t(`${orgName} · Informe de gestión · generado ${new Date().toLocaleString('es-AR')}`), 14, 290); doc.text(`${p} / ${pages}`, W - 14, 290, { align: 'right' }); }
  return doc.output('blob');
}

export async function buildMgmtXlsx(orgName: string, f: MgmtFilters, s: SummaryResult, det: MgmtDetail): Promise<Blob> {
  const S = s.data; const wb = new ExcelJS.Workbook(); wb.creator = 'HSE Audit Manager'; wb.title = `Informe de gestión ${orgName}`;
  const head = (ws: ExcelJS.Worksheet) => ws.getRow(1).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4D3A' } }; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; });
  const add = (name: string, cols: { header: string; key: string; width: number }[], rows: Record<string, unknown>[]) => {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] }); ws.columns = cols; head(ws); ws.addRows(rows); ws.autoFilter = { from: 'A1', to: { row: 1, column: cols.length } }; return ws;
  };
  add('Resumen', [{ header: 'Indicador', key: 'k', width: 46 }, { header: 'Valor', key: 'v', width: 40 }], [
    { k: 'Organización', v: orgName }, { k: 'Filtros', v: filtersText(f) }, { k: 'Origen', v: sourceText(s) },
    { k: 'Auditorías', v: S.audits.total }, { k: 'Cumplimiento promedio %', v: S.results.avg_compliance }, { k: 'Planificadas atrasadas', v: S.audits.overdue_planned },
    { k: 'Pendientes de revisión', v: S.audits.pending_review }, { k: 'Listas para cerrar', v: S.audits.ready_to_close }, { k: 'Ítems críticos incumplidos', v: S.audits.critical_failures },
    { k: 'Hallazgos', v: S.findings.total }, { k: 'Hallazgos abiertos', v: S.findings.open }, { k: 'Hallazgos vencidos', v: S.findings.overdue },
    { k: 'Pendientes de verificación', v: S.findings.pending_verification }, { k: 'Recurrentes', v: S.findings.recurrent },
    { k: 'Verificados eficaces', v: S.findings.effective }, { k: 'No eficaces', v: S.findings.not_effective }, { k: 'Días promedio al cierre', v: S.findings.avg_days_to_close },
    { k: 'Acciones', v: S.actions.total }, { k: 'Acciones vencidas', v: S.actions.overdue }, { k: 'Vencen en 7 días', v: S.actions.due_7_days },
    { k: 'Cumplidas en plazo', v: S.actions.completed_on_time }, { k: 'Cumplidas', v: S.actions.completed },
  ]);
  add('Por categoría', [{ header: 'Categoría', key: 'c', width: 26 }, { header: 'Auditorías completadas', key: 'a', width: 22 }, { header: 'Cumplimiento promedio %', key: 'p', width: 24 }, { header: 'Hallazgos', key: 'f', width: 12 }],
    S.by_template_category.map(c => ({ c: LABELS.category[c.category as TemplateCategory] ?? c.category, a: c.audits, p: c.avg_compliance, f: c.findings })));
  add('Por sección', [{ header: 'Plantilla', key: 't', width: 36 }, { header: 'Sección', key: 's', width: 60 }, { header: 'Auditorías', key: 'a', width: 11 }, { header: 'Promedio', key: 'p', width: 11 }, { header: 'Escala', key: 'e', width: 16 }, { header: 'Obtenido', key: 'r', width: 11 }, { header: 'Objetivo', key: 'g', width: 11 }],
    S.by_section.map(x => ({ t: x.template_name, s: x.title.trim(), a: x.audits, p: x.avg_score, e: x.scoring_method === 'ponderado' ? '% cumplimiento' : 'nota 0–10', r: x.raw, g: x.target })));
  add('Por empresa', [{ header: 'Empresa', key: 'n', width: 32 }, { header: 'Auditorías', key: 'a', width: 11 }, { header: 'Cumplimiento %', key: 'p', width: 15 }, { header: 'Hallazgos abiertos', key: 'o', width: 17 }, { header: 'Recurrentes', key: 'r', width: 12 }, { header: 'Acciones vencidas', key: 'v', width: 17 }],
    S.by_company.map(c => ({ n: c.name, a: c.audits, p: c.avg_compliance, o: c.open_findings, r: c.recurrent_findings, v: c.overdue_actions })));
  const dist: Record<string, unknown>[] = [];
  for (const [g, m, lab] of [['Categoría', S.findings.by_category, LABELS.category], ['Tipo', S.findings.by_type, LABELS.findingType], ['Severidad', S.findings.by_severity, LABELS.severity], ['Estado', S.findings.by_status, LABELS.findingStatus]] as const)
    for (const [k, v] of Object.entries(m)) dist.push({ g, k: label(lab as Record<string, string>, k), v });
  add('Distribución hallazgos', [{ header: 'Agrupación', key: 'g', width: 14 }, { header: 'Valor', key: 'k', width: 30 }, { header: 'Cantidad', key: 'v', width: 10 }], dist);
  add('Recurrentes', [{ header: 'Empresa', key: 'c', width: 26 }, { header: 'N.º', key: 'n', width: 8 }, { header: 'Requisito', key: 'q', width: 70 }, { header: 'Veces', key: 'o', width: 8 }, { header: 'Auditorías', key: 'a', width: 10 }, { header: 'Último', key: 'l', width: 12 }, { header: 'Hallazgos', key: 'f', width: 40 }],
    S.recurrent.map(r => ({ c: r.company, n: r.item_number ?? r.item_code, q: r.question, o: r.occurrences, a: r.audits, l: new Date(r.last_detected), f: r.findings.map(x => `${x.code ?? '?'} (${LABELS.findingStatus[x.status as Finding['status']] ?? x.status})`).join(', ') })));
  const months = [...new Set([...S.monthly.map(m => m.month), ...S.findings_monthly.map(m => m.month)])].sort();
  add('Mensual', [{ header: 'Mes', key: 'm', width: 10 }, { header: 'Auditorías completadas', key: 'a', width: 22 }, { header: 'Cumplimiento %', key: 'p', width: 15 }, { header: 'Hallazgos detectados', key: 'd', width: 20 }, { header: 'Hallazgos cerrados', key: 'c', width: 18 }],
    months.map(m => { const a = S.monthly.find(x => x.month === m); const fm = S.findings_monthly.find(x => x.month === m); return { m, a: a?.audits ?? 0, p: a?.avg_compliance ?? null, d: fm?.detected ?? 0, c: fm?.closed ?? 0 }; }));
  const today = new Date().toISOString().slice(0, 10);
  add('Seguimiento auditorías', [{ header: 'Auditoría', key: 'a', width: 18 }, { header: 'Título', key: 't', width: 40 }, { header: 'Empresa', key: 'c', width: 26 }, { header: 'Fecha', key: 'f', width: 12 }, { header: 'Estado', key: 's', width: 14 }, { header: 'Revisión', key: 'r', width: 14 }, { header: 'Seguimiento', key: 'g', width: 22 }, { header: 'Cumplimiento %', key: 'p', width: 14 }, { header: 'Calificación', key: 'b', width: 14 }],
    det.audits.map(a => ({ a: a.code ?? '', t: a.title, c: det.names.company(a.company_id), f: a.scheduled_date ? new Date(a.scheduled_date + 'T12:00:00') : null, s: LABELS.auditStatus[a.status], r: a.reviewed_at ? new Date(a.reviewed_at) : null,
      g: a.status === 'planificada' && a.scheduled_date && a.scheduled_date < today ? 'Atrasada' : a.status === 'completada' ? (a.reviewed_at ? 'Lista para cerrar' : 'Pendiente de revisión') : '', p: a.compliance_pct, b: a.result_band })));
  addFindingSheets(wb, det.findings, det.actions, det.names.company, det.names.person, det.names.audit);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
