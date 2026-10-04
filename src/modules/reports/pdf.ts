import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData } from 'jspdf-autotable';
import { LABELS } from '../../types';
import { evidenceDataUrl } from '../evidences/evidenceService';
import { isSituacionConfig } from '../../scoring/engine';
import { rcaText, type AuditReport } from './reportData';
import { BAND_STYLES, SHEET, bandFor, bandRange, bandStyle } from '../../scoring/bands';
import { AUDIT_FIRM } from '../../config/brand';

type RGB = [number, number, number];
export const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** Estilo de celda con el color de la banda (o undefined si no hay banda). */
export const bandCell = (band: string | null | undefined) => { const st = bandStyle(band); return st ? { fillColor: rgb(st.bg), textColor: rgb(st.fg), fontStyle: 'bold' as const } : undefined; };

// Las fuentes estándar de PDF usan Windows-1252: se normalizan los caracteres fuera de ese juego.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(s?: string | null): string {
  return (s ?? '').replace(/\uF0B7/g, '•').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/×/g, 'x').replace(/[▲▼]/g, '')
    .split('').filter(ch => ch.charCodeAt(0) < 256 || CP1252_EXTRA.includes(ch) || ch === '\n').join('');
}
const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-AR') : '—');
const n = (v?: number | null, dec = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));

/** Celdas "Anterior" y "Variación" (mejora en verde, empeora en rojo). */
function prevCells(now: number | null, before: number | null | undefined) {
  if (before === null || before === undefined) return ['—', '—'];
  if (now === null) return [n(before), '—'];
  const dd = Math.round((now - before) * 100) / 100;
  return [n(before), { content: `${dd > 0 ? '+' : ''}${n(dd)}`, styles: { textColor: dd > 0 ? rgb('#2f7d32') : dd < 0 ? rgb('#b42318') : rgb('#67747d'), fontStyle: 'bold' as const } }];
}

const INK: RGB = rgb('#17232c');
const MUTED: RGB = rgb('#67747d');
const RAIL: RGB = rgb('#1c2b36');
const TOP = 24;          // margen superior de las páginas de contenido (debajo del encabezado)
const BOTTOM = 18;

/**
 * Informe de auditoría en PDF: carátula, índice, datos generales, resumen ejecutivo, resultados
 * por requisito (planilla con los colores de la metodología), hallazgos y plan de acción,
 * lista de verificación, registro fotográfico y acta de cierre con firmas.
 */
export async function buildAuditPdf(r: AuditReport, opts: { includePhotos: boolean }): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const a = r.audit;
  const cfg = isSituacionConfig(r.version.scoring_config) ? r.version.scoring_config : null;
  const sit = !!cfg;
  const res = r.result;
  const finalVal = sit ? (r.official ? a.score : res.final) : (r.official ? a.compliance_pct : res.compliance_pct);
  const band = r.official ? (a.result_band ?? null) : (res.band ?? null);
  const company = r.names.company(a.company_id);
  const auditTitle = LABELS.auditType[a.audit_type];
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const toc: { num: string; title: string; page: number }[] = [];
  let y = TOP;

  const bandMark = (x: number, yy: number, s: number) => {
    const cols = [BAND_STYLES['muy bueno'].bg, BAND_STYLES.bueno.bg, BAND_STYLES.regular.bg, BAND_STYLES['crítico'].bg];
    cols.forEach((c, i) => { doc.setFillColor(...rgb(c)); doc.rect(x + (i % 2) * s, yy + Math.floor(i / 2) * s, s, s, 'F'); });
  };
  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = (h: number) => { if (y + h > H - BOTTOM) newPage(); };
  const section = (num: string, title: string, o: { newPage?: boolean } = {}) => {
    if (o.newPage) newPage(); else ensure(26);
    toc.push({ num, title, page: doc.getNumberOfPages() });
    doc.setFillColor(...rgb(SHEET.header)); doc.rect(14, y, 2.2, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...INK);
    doc.text(pdfText(`${num}. ${title}`), 19.5, y + 6.2);
    y += 13;
  };
  const sub = (title: string) => {
    ensure(14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK); doc.text(pdfText(title), 14, y + 4); y += 7;
  };
  const para = (text: string, size = 9.5, color: RGB = INK) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
    const lines = doc.splitTextToSize(pdfText(text), W - 28) as string[];
    for (const ln of lines) { ensure(5); doc.text(ln, 14, y + 3.5); y += size * 0.47; }
    y += 2;
  };
  const tableOpts = { margin: { top: TOP, bottom: BOTTOM, left: 14, right: 14 } };

  // ================================================================== carátula
  doc.setFillColor(...RAIL); doc.rect(0, 0, W, 118, 'F');
  bandMark(18, 18, 7);
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(17);
  doc.text(pdfText(AUDIT_FIRM.name.toUpperCase()), 38, 25.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(200, 210, 216);
  doc.text(pdfText(AUDIT_FIRM.tagline), 38, 31);
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(30);
  doc.text(pdfText('Informe de auditoría'), 18, 70);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(13); doc.setTextColor(...rgb(SHEET.header));
  doc.text(pdfText(auditTitle), 18, 80);
  doc.setFontSize(9.5); doc.setTextColor(200, 210, 216);
  doc.text(doc.splitTextToSize(pdfText(`${r.template?.name ?? ''} · versión ${r.version.version_number}`), W - 36) as string[], 18, 88);
  // franja con los colores del criterio de evaluación
  const bcols = [BAND_STYLES['muy bueno'].bg, BAND_STYLES.bueno.bg, BAND_STYLES.regular.bg, BAND_STYLES['crítico'].bg];
  bcols.forEach((c, i) => { doc.setFillColor(...rgb(c)); doc.rect((W / 4) * i, 118, W / 4, 3.2, 'F'); });

  doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text('Empresa auditada', 18, 136);
  doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(19);
  const compLines = (doc.splitTextToSize(pdfText(company), W - 36) as string[]).slice(0, 2);
  doc.text(compLines, 18, 145);
  let cy = 145 + compLines.length * 7.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(...rgb('#44525c'));
  doc.text((doc.splitTextToSize(pdfText(a.title), W - 36) as string[]).slice(0, 2), 18, cy); cy += 14;

  const info: [string, string][] = [
    ['Organización', r.orgName], ['Ubicación', r.names.location(a.location_id)],
    ['Fecha de la auditoría', d(a.scheduled_date ?? a.completed_at)], ['Código', a.code ?? '—'],
    ['Auditor líder', r.names.person(a.lead_auditor_id)], ['Firma auditora', AUDIT_FIRM.name],
  ];
  info.forEach(([k, v], i) => {
    const x = 18 + (i % 2) * 90, yy = cy + Math.floor(i / 2) * 12;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED); doc.text(pdfText(k), x, yy);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...INK);
    doc.text((doc.splitTextToSize(pdfText(v), 84) as string[])[0], x, yy + 5);
  });

  // resultado
  const ry = 222;
  const st = bandStyle(band);
  doc.setFillColor(...(st ? rgb(st.bg) : rgb('#eef1f3'))); doc.setDrawColor(...(st ? rgb(st.border) : rgb('#c3ccd2')));
  doc.roundedRect(18, ry, 78, 40, 3, 3, 'FD');
  doc.setTextColor(...(st ? rgb(st.fg) : INK));
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(r.official ? 'Resultado oficial' : 'Resultado preliminar', 24, ry + 8);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(32); doc.text(pdfText(sit ? n(finalVal) : `${n(finalVal, 1)} %`), 24, ry + 24);
  doc.setFontSize(14); doc.text(pdfText(band ?? (sit ? 'Sin calificación' : 'Cumplimiento')), 24, ry + 33);
  if (cfg) {
    autoTable(doc, { startY: ry, margin: { left: 108 }, tableWidth: 84, theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.6, halign: 'center', lineColor: [190, 196, 200], textColor: INK },
      head: [[{ content: 'Criterio de evaluación', colSpan: 2 }]], headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk) },
      body: cfg.bands.map(b => [pdfText(bandRange(b)), { content: pdfText(b.label), styles: bandCell(b.label) ?? {} }]) });
  }
  doc.setDrawColor(...rgb('#d9dfe3')); doc.line(18, 274, W - 18, 274);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
  doc.text(pdfText(`Documento confidencial preparado por ${AUDIT_FIRM.name} para ${r.orgName}.`), 18, 279);
  doc.text(pdfText(`Emitido el ${new Date().toLocaleDateString('es-AR')}`), W - 18, 279, { align: 'right' });

  // ================================================================== índice (se completa al final)
  doc.addPage();
  const tocPage = doc.getNumberOfPages();

  // ================================================================== 1. datos generales
  newPage();
  section('1', 'Datos generales de la auditoría');
  autoTable(doc, { ...tableOpts, startY: y, theme: 'plain', styles: { fontSize: 9.5, cellPadding: 1.6, textColor: INK },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 46, textColor: rgb('#44525c') } },
    body: [
      ['Firma auditora', AUDIT_FIRM.name], ['Organización', pdfText(r.orgName)], ['Empresa auditada', pdfText(company)],
      ['Auditoría', pdfText(a.title)], ['Código', a.code ?? '—'], ['Tipo', auditTitle], ['Estado', LABELS.auditStatus[a.status]],
      ['Ubicación', pdfText(r.names.location(a.location_id))], ['Fecha programada', d(a.scheduled_date)], ['Fecha de finalización', d(a.completed_at)],
      ['Auditor líder', pdfText(r.names.person(a.lead_auditor_id))], ['Equipo auditor', pdfText(a.audit_team ?? '—')],
      ['Lista de verificación', pdfText(`${r.template?.name ?? ''} (versión ${r.version.version_number})`)],
    ] });
  y = last() + 5;
  sub('Objetivo');
  para(`Evaluar el grado de cumplimiento de los requisitos del sistema de gestión de Seguridad, Salud Ocupacional y Medio Ambiente de ${company}, conforme a la lista de verificación "${r.template?.name ?? ''}", e identificar no conformidades, observaciones y oportunidades de mejora.`);
  sub('Alcance');
  para(a.scope || 'No especificado.');
  sub('Metodología');
  para(cfg
    ? `Cada requisito se califica como ${cfg.options.map(o => `${o.label} (${o.points ?? 0} pt.)`).join(', ')}. ${cfg.section_formula ?? ''}. Resultado final: ${cfg.final_formula ?? ''}. La calificación se asigna según el criterio de evaluación de la sección 3. El resultado oficial lo calcula el sistema con las reglas de la versión publicada de la lista.`
    : 'Cada requisito se califica como Cumple / No cumple / No aplica; el cumplimiento es el puntaje obtenido sobre el puntaje aplicable, ponderado por el peso de cada requisito. El resultado oficial lo calcula el sistema con las reglas de la versión publicada de la lista.');

  // ================================================================== 2. resumen ejecutivo
  section('2', 'Resumen ejecutivo');
  const fCount = (t: string[]) => r.findings.filter(f => t.includes(f.finding_type)).length;
  const nc = fCount(['nc_mayor', 'nc_menor', 'no_conformidad']), obs = fCount(['observacion']), opm = fCount(['oportunidad_mejora']);
  const openActs = r.actions.filter(x => ['pendiente', 'en_curso'].includes(x.status)).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdue = r.actions.filter(x => ['pendiente', 'en_curso'].includes(x.status) && x.due_date < today).length;
  const kpis: [string, string, boolean][] = [
    [sit ? 'Resultado' : 'Cumplimiento', sit ? n(finalVal) : `${n(finalVal, 1)} %`, true],
    ['No conformidades', String(nc), false], ['Observaciones', String(obs), false], ['Oport. de mejora', String(opm), false],
    ['Acciones abiertas', `${openActs}${overdue ? ` (${overdue} venc.)` : ''}`, false],
  ];
  ensure(24);
  const kw = (W - 28 - 4 * 3) / 5;
  kpis.forEach(([k, v, colored], i) => {
    const x = 14 + i * (kw + 3);
    const fill = colored && st ? rgb(st.bg) : rgb('#f6f8f9'), ink = colored && st ? rgb(st.fg) : INK;
    doc.setFillColor(...fill); doc.setDrawColor(...rgb('#d9dfe3')); doc.roundedRect(x, y, kw, 19, 2, 2, 'FD');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...(colored && st ? ink : MUTED)); doc.text(pdfText(k), x + 3, y + 5.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...ink); doc.text(pdfText(v), x + 3, y + 14.5);
  });
  y += 25;
  const secs = r.sectionsResult.filter(s => s.score !== null && s.score !== undefined);
  const best = [...secs].sort((p, q) => Number(q.score) - Number(p.score))[0];
  const worst = [...secs].sort((p, q) => Number(p.score) - Number(q.score))[0];
  const fmtSec = (s: typeof best) => `${String(s.title).trim()} (${sit ? n(Number(s.score)) : `${n(Number(s.score), 1)} %`})`;
  let summary = `La auditoría ${r.official ? 'obtuvo un resultado oficial' : 'tiene un resultado preliminar'} de ${sit ? n(finalVal) : `${n(finalVal, 1)} %`}${band ? `, calificación ${band}` : ''}. `;
  summary += `Se registraron ${r.findings.length} hallazgos: ${nc} no conformidades, ${obs} observaciones y ${opm} oportunidades de mejora. `;
  if (best && worst && best !== worst) summary += `El requisito con mejor desempeño es ${fmtSec(best)} y el de menor desempeño, ${fmtSec(worst)}. `;
  if (r.previous && r.previous.final !== null && finalVal !== null && finalVal !== undefined) {
    const dd = Number(finalVal) - r.previous.final;
    summary += `Respecto de la auditoría anterior (${r.previous.audit.code ?? ''}, ${d(r.previous.audit.scheduled_date)}: ${sit ? n(r.previous.final) : `${n(r.previous.final, 1)} %`}${r.previous.band ? `, ${r.previous.band}` : ''}), el resultado ${Math.abs(dd) < 0.005 ? 'se mantuvo' : dd > 0 ? `mejoró ${n(dd)} puntos` : `bajó ${n(-dd)} puntos`}. `;
  }
  const recurrent = r.findings.filter(f => f.recurrence_count > 0).length;
  if (recurrent) summary += `${recurrent} hallazgo${recurrent > 1 ? 's son recurrentes' : ' es recurrente'} (ya detectado en auditorías anteriores de la empresa). `;
  if (openActs) summary += `Quedan ${openActs} acciones del plan abiertas${overdue ? `, ${overdue} de ellas vencidas` : ''}.`;
  para(summary);
  if (a.summary) { sub('Conclusiones del auditor'); para(a.summary); }

  // ================================================================== 3. resultados por requisito
  section('3', 'Resultados por requisito', { newPage: true });
  if (r.sectionsResult.length) {
    const raw = r.sectionsResult.reduce((t, x) => t + Number(x.raw || 0), 0);
    const target = r.sectionsResult.reduce((t, x) => t + Number(x.target || 0), 0);
    autoTable(doc, { ...tableOpts, startY: y, theme: 'grid',
      head: [[sit ? 'Requisitos del sistema de gestión' : 'Sección', 'Puntaje alcanzado', 'Puntaje objetivo', sit ? 'Evaluación' : 'Cumplimiento', ...(r.previous ? ['Anterior', 'Variación'] : [])]],
      headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), fontStyle: 'bold', halign: 'center', lineColor: [150, 150, 150] },
      styles: { fontSize: 8.5, lineColor: [170, 170, 170], textColor: INK },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: r.previous ? 70 : 98 }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
      body: [
        ...r.sectionsResult.map(s => {
          const v = s.score === null || s.score === undefined ? null : Number(s.score);
          return [pdfText(sit ? String(s.title).trim().toUpperCase() : String(s.title).trim()), n(Number(s.raw), sit ? 0 : 2), n(Number(s.target), sit ? 0 : 2),
            sit ? { content: n(v), styles: bandCell(bandFor(v, cfg?.bands)) ?? {} } : `${n(v, 1)} %`,
            ...(r.previous ? prevCells(v, r.prevOf(String(s.title))) : [])];
        }),
        [{ content: pdfText(sit ? 'RESULTADO FINAL' : 'TOTAL'), styles: { fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk), fontStyle: 'bold' } },
         { content: n(raw, sit ? 0 : 2), styles: { fontStyle: 'bold' } }, { content: n(target, sit ? 0 : 2), styles: { fontStyle: 'bold' } },
         sit ? { content: n(finalVal), styles: { ...(bandCell(band) ?? {}), fontStyle: 'bold' } } : { content: `${n(finalVal, 1)} %`, styles: { fontStyle: 'bold' } },
         ...(r.previous ? prevCells(finalVal === null || finalVal === undefined ? null : Number(finalVal), r.previous.final) : [])],
      ] });
    y = last() + 4;
    para(`Resultados por sección ${r.official ? 'oficiales' : '(preliminares)'}.${r.previous ? ` Comparado con ${r.previous.audit.code ?? r.previous.audit.title} del ${d(r.previous.audit.scheduled_date)}: misma empresa y lista de verificación.` : ''}`, 8, MUTED);
  }
  if (cfg) {
    ensure(40);
    autoTable(doc, { ...tableOpts, startY: y, tableWidth: 90, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.6, halign: 'center', lineColor: [170, 170, 170], textColor: INK },
      head: [[{ content: 'Criterio de evaluación', colSpan: 2 }]], headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk) },
      body: cfg.bands.map(b => [pdfText(bandRange(b)), { content: pdfText(b.label), styles: bandCell(b.label) ?? {} }]) });
    y = last() + 6;
  }

  // ================================================================== 4. hallazgos y plan de acción
  section('4', 'Hallazgos y plan de acción', { newPage: true });
  if (!r.findings.length) para('No se registraron hallazgos.');
  else {
    autoTable(doc, { ...tableOpts, startY: y, theme: 'grid', styles: { fontSize: 8, valign: 'top', textColor: INK, lineColor: [200, 205, 208] },
      headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk) },
      head: [['Código', 'Hallazgo', 'Tipo', 'Severidad', 'Vence', 'Estado']],
      body: r.findings.map(f => [f.code ?? '—', pdfText(f.title), LABELS.findingType[f.finding_type], LABELS.severity[f.severity], d(f.due_date), LABELS.findingStatus[f.status]]),
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 70 } } });
    y = last() + 7;
    const itemOf = new Map(r.items.map(i => [i.id, i]));
    for (const f of r.findings) {
      const it = f.item_id ? itemOf.get(f.item_id) : undefined;
      ensure(40);
      autoTable(doc, { ...tableOpts, startY: y, theme: 'grid', styles: { fontSize: 8, valign: 'top', textColor: INK, lineColor: [200, 205, 208] },
        headStyles: { fillColor: RAIL, textColor: [255, 255, 255] },
        head: [[{ content: pdfText(`${f.code ?? ''}  ${f.title}`), colSpan: 2 }]],
        body: [
          ['Clasificación', pdfText(`${LABELS.findingType[f.finding_type]} · Severidad ${LABELS.severity[f.severity].toLowerCase()}${f.category ? ` · ${LABELS.category[f.category]}` : ''} · ${LABELS.findingStatus[f.status]}${f.recurrence_count > 0 ? ` · RECURRENTE (${f.recurrence_count + 1}.ª vez)` : ''}`)],
          ['Pregunta', pdfText(it ? `${it.original_number ?? it.code ?? ''} ${it.question}`.trim() : 'Hallazgo general')],
          ['Requisito', pdfText(f.requirement ?? f.legal_reference ?? '—')],
          ['Descripción objetiva', pdfText(f.description ?? '—')],
          ['Responsable / vence', pdfText(`${f.responsible_user_id ? r.names.person(f.responsible_user_id) : '—'} · ${d(f.due_date)}`)],
          ['Acción inmediata', pdfText(f.immediate_action ?? '—')],
          ['Análisis de causa raíz', pdfText(rcaText(f.rca_method, f.rca_data, f.root_cause))],
          ['Evidencias', String(r.evidences.filter(e => e.finding_id === f.id).length)],
          ...(f.status === 'verificado' || f.verification_notes ? [['Verificación de eficacia', pdfText(`${f.effectiveness === 'eficaz' ? 'Eficaz' : f.effectiveness === 'no_eficaz' ? 'No eficaz' : '—'} · ${d(f.verified_at)} · ${r.names.person(f.verified_by)}\n${f.verification_notes ?? ''}`)]] : []),
        ],
        columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold', textColor: rgb('#44525c') } } });
      y = last() + 1;
      const acts = r.actions.filter(x => x.finding_id === f.id);
      if (acts.length) {
        autoTable(doc, { ...tableOpts, startY: y, styles: { fontSize: 7.5, valign: 'top', textColor: INK }, headStyles: { fillColor: rgb('#e9edf0'), textColor: INK },
          head: [['Plan de acción', 'Tipo', 'Responsable', 'Vence', 'Estado', 'Eficacia']],
          body: acts.map(x => [pdfText(`${x.description}${x.effectiveness_criteria ? `\nCriterio de eficacia: ${x.effectiveness_criteria}` : ''}${x.progress_notes ? `\nAvance: ${x.progress_notes}` : ''}`),
            LABELS.actionType[x.action_type], pdfText(x.responsible_user_id ? r.names.person(x.responsible_user_id) : x.responsible_name ?? r.names.company(x.responsible_company_id)), d(x.due_date), LABELS.actionStatus[x.status],
            x.effectiveness === 'eficaz' ? 'Eficaz' : x.effectiveness === 'no_eficaz' ? 'No eficaz' : '—']),
          columnStyles: { 0: { cellWidth: 74 } } });
        y = last();
      }
      y += 7;
    }
  }

  // ================================================================== 5. lista de verificación
  section('5', 'Lista de verificación', { newPage: true });
  const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
  for (const s of r.sections) {
    body.push([{ content: pdfText(s.title.trim()), colSpan: 5, styles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), fontStyle: 'bold' } }]);
    for (const i of r.items.filter(x => x.section_id === s.id)) {
      const resp = r.responses.get(i.id);
      body.push([pdfText(i.original_number ?? i.code ?? ''), pdfText(i.question), pdfText(r.names.process(i.process_id)), r.optionLabel(resp?.answer),
        pdfText(resp?.comment ?? resp?.text_value ?? (resp?.numeric_value !== null && resp?.numeric_value !== undefined ? String(resp.numeric_value) : ''))]);
    }
  }
  const ANS: Record<string, [RGB, RGB]> = {
    nc: [rgb('#fbe4e1'), rgb('#b42318')], no_cumple: [rgb('#fbe4e1'), rgb('#b42318')], no: [rgb('#fbe4e1'), rgb('#b42318')],
    obs: [rgb('#fbf1d3'), rgb('#8a5a00')], opm: [rgb('#e1ebf4'), rgb('#1f4e79')],
    ok: [rgb('#e4f2df'), rgb('#2f7d32')], cumple: [rgb('#e4f2df'), rgb('#2f7d32')], si: [rgb('#e4f2df'), rgb('#2f7d32')],
  };
  const ansByRow: (string | null)[] = [];
  for (const s of r.sections) { ansByRow.push(null); for (const i of r.items.filter(x => x.section_id === s.id)) ansByRow.push(r.responses.get(i.id)?.answer ?? null); }
  autoTable(doc, { ...tableOpts, startY: y, head: [['N.º', 'Requisito', 'Proceso', 'Resp.', 'Evidencias / comentarios']], headStyles: { fillColor: RAIL, textColor: [255, 255, 255] },
    didParseCell: (c: CellHookData) => {
      if (c.section !== 'body' || c.column.index !== 3) return;
      const k = ansByRow[c.row.index]; const col = k ? ANS[k] : undefined;
      if (col) Object.assign(c.cell.styles, { fillColor: col[0], textColor: col[1], halign: 'center' });
    },
    styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'top', textColor: INK },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 78 }, 2: { cellWidth: 22 }, 3: { cellWidth: 14, fontStyle: 'bold' } }, body });
  y = last() + 6;

  // ================================================================== 6. registro fotográfico
  let num = 6;
  const imgs = opts.includePhotos ? r.evidences.filter(e => e.mime_type.startsWith('image/')) : [];
  if (imgs.length) {
    section(String(num++), 'Registro fotográfico', { newPage: true });
    let x = 14; const w = 58, h = 44;
    const itemById = new Map(r.items.map(i => [i.id, i]));
    const respById = new Map([...r.responses.values()].map(rr => [rr.id, rr]));
    for (const e of imgs) {
      const url = await evidenceDataUrl(e.id, e.storage_path);
      if (!url) continue;
      if (y + h + 10 > H - BOTTOM) { newPage(); x = 14; }
      try { doc.addImage(url, 'JPEG', x, y, w, h, undefined, 'FAST'); } catch { continue; }
      const it = e.response_id ? itemById.get(respById.get(e.response_id)?.item_id ?? '') : undefined;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
      doc.text(doc.splitTextToSize(pdfText(`${it ? `Req. ${it.original_number ?? it.code ?? ''} · ` : ''}${e.caption ?? ''} ${e.taken_at ? d(e.taken_at) : ''}`), w) as string[], x, y + h + 3);
      x += w + 4; if (x + w > W - 10) { x = 14; y += h + 12; }
    }
    y += h + 14;
  }

  // ================================================================== 7. acta de cierre y firmas
  if (a.closing_meeting_at || a.closing_attendees || a.closing_agreements || r.signatures.length) {
    section(String(num++), 'Acta de reunión de cierre', { newPage: true });
    autoTable(doc, { ...tableOpts, startY: y, theme: 'plain', styles: { fontSize: 9.5, cellPadding: 1.6, textColor: INK },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 46, textColor: rgb('#44525c') } },
      body: [['Fecha', d(a.closing_meeting_at)], ['Asistentes', pdfText(a.closing_attendees ?? '—')], ['Acuerdos y compromisos', pdfText(a.closing_agreements ?? '—')]] });
    y = last() + 6;
    if (r.signatures.length) {
      sub('Firmas');
      const bw = 58, bh = 42; let x = 14;
      for (const s of r.signatures) {
        if (x + bw > W - 10) { x = 14; y += bh + 6; }
        if (y + bh > H - BOTTOM) { newPage(); x = 14; }
        doc.setDrawColor(...rgb('#c3ccd2')); doc.roundedRect(x, y, bw, bh, 1.5, 1.5, 'S');
        try { doc.addImage(s.signature_png, 'PNG', x + 2, y + 1.5, bw - 4, 17); } catch { /* firma ilegible: se omite la imagen */ }
        doc.setDrawColor(150); doc.line(x + 4, y + 19.5, x + bw - 4, y + 19.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK);
        doc.text((doc.splitTextToSize(pdfText(s.signer_name), bw - 6) as string[])[0], x + 3, y + 24);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(...MUTED);
        doc.text((doc.splitTextToSize(pdfText([LABELS.signerRole[s.signer_role], s.signer_position, s.signer_company].filter(Boolean).join(' · ')), bw - 6) as string[]).slice(0, 2), x + 3, y + 28);
        doc.text(pdfText(`${new Date(s.signed_at).toLocaleString('es-AR')} · ${LABELS.agreement[s.agreement]}`), x + 3, y + 35);
        if (s.observations) doc.text((doc.splitTextToSize(pdfText(`Obs.: ${s.observations}`), bw - 6) as string[]).slice(0, 1), x + 3, y + 38.5);
        x += bw + 4;
      }
      y += bh + 6;
    }
  }

  // ================================================================== índice
  doc.setPage(tocPage);
  doc.setFillColor(...rgb(SHEET.header)); doc.rect(14, 30, 2.2, 10, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.setTextColor(...INK); doc.text(pdfText('Índice'), 19.5, 38);
  let ty = 56;
  for (const t of toc) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...INK);
    doc.text(pdfText(`${t.num}.`), 18, ty);
    doc.setFont('helvetica', 'normal');
    const label = pdfText(t.title);
    doc.text(label, 27, ty);
    const lw = doc.getTextWidth(label);
    doc.setTextColor(...rgb('#b0b8be'));
    let dx = 27 + lw + 2; const end = W - 26;
    while (dx < end) { doc.text('.', dx, ty); dx += 1.6; }
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.text(String(t.page), W - 18, ty, { align: 'right' });
    doc.link(18, ty - 5, W - 36, 7, { pageNumber: t.page });
    ty += 11;
  }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...MUTED);
  doc.text(doc.splitTextToSize(pdfText(`Informe elaborado por ${AUDIT_FIRM.name}. Los resultados son los ${r.official ? 'oficiales calculados por el sistema al completar la auditoría' : 'preliminares de una auditoría no completada'}, con las reglas de la versión ${r.version.version_number} de la lista de verificación.`), W - 36) as string[], 18, ty + 6);

  // ================================================================== encabezado y pie (todas menos la carátula)
  const pages = doc.getNumberOfPages();
  for (let p = 2; p <= pages; p++) {
    doc.setPage(p);
    bandMark(14, 8, 2.6);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...INK); doc.text(pdfText(AUDIT_FIRM.name), 21.5, 12.2);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...MUTED);
    doc.text(pdfText(`Informe de auditoría ${a.code ?? ''} · ${company}`.slice(0, 95)), W - 14, 12.2, { align: 'right' });
    doc.setDrawColor(...rgb('#d9dfe3')); doc.line(14, 16, W - 14, 16);
    doc.line(14, H - 13, W - 14, H - 13);
    doc.setFontSize(7); doc.text(pdfText(`Documento confidencial · ${AUDIT_FIRM.name} · Emitido el ${new Date().toLocaleDateString('es-AR')}`), 14, H - 8.5);
    doc.text(`Página ${p} de ${pages}`, W - 14, H - 8.5, { align: 'right' });
  }
  return doc.output('blob');
}
