/**
 * PDF del plan de auditoría y del informe final (modelo RS Consultora, versión profesional).
 *
 * Estructura del modelo: datos generales, objetivo, criterios, plan, desarrollo, conclusiones,
 * fortalezas, oportunidades de mejora, observaciones, no conformidades, evaluación, anexo,
 * registro fotográfico y declaración del auditor. Diseño: portada con el resultado, encabezado
 * con el logo y pie con la numeración en cada página, secciones numeradas, tablas livianas,
 * hallazgos con distintivo por tipo, evaluación con los colores exactos de la planilla y
 * tipografía Source Sans 3 embebida.
 */
import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData, type Styles } from 'jspdf-autotable';
import { isSituacionConfig } from '../../scoring/engine';
import { bandFor, bandRange, bandStyle, SHEET } from '../../scoring/bands';
import { evidenceDataUrl } from '../evidences/evidenceService';
import { photoNumbers } from '../evidences/photoNumbers';
import { RS_LOGO_PNG, RS_LOGO_RATIO } from '../../config/logo';
import { registerPdfFonts } from '../../config/pdfFonts';
import { AUDIT_FIRM } from '../../config/brand';
import { LABELS, type Evidence, type Finding } from '../../types';
import type { AuditReport } from './reportData';
import { boldSegments, planGroups, resolveReport, textBlocks, type ReportData } from './finalReport';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

// ---------------------------------------------------------------- identidad (verde del logo de RS)
const BRAND = rgb('#3F7A4A');
const BRAND_DARK = rgb('#1F3D27');
const BRAND_TINT = rgb('#EEF5EF');
const BRAND_LINE = rgb('#CFE2D3');
const INK = rgb('#1D2939');
const INK2 = rgb('#344054');
const MUTED = rgb('#667085');
const LINE = rgb('#E4E7EC');
const ZEBRA = rgb('#F9FAFB');
const WHITE: RGB = [255, 255, 255];
const TAG: Record<'nc' | 'obs' | 'opm' | 'fort', { ink: RGB; bg: RGB; label: string }> = {
  nc: { ink: rgb('#B42318'), bg: rgb('#FEE4E2'), label: 'No conformidad' },
  obs: { ink: rgb('#B54708'), bg: rgb('#FEF0C7'), label: 'Observación' },
  opm: { ink: rgb('#175CD3'), bg: rgb('#E0EAFF'), label: 'Oportunidad de mejora' },
  fort: { ink: BRAND, bg: BRAND_TINT, label: 'Fortaleza' },
};

const F = 'SS';          // familia: normal, bold, italic, bolditalic
const FSEMI = 'SSsemi';  // seminegrita
const ML = 18, MR = 18;
const PW = 210, PH = 297;
const CW = PW - ML - MR;
const TOP = 32;
const BOTTOM = 20;
const FS = 9.6;

/** Sólo caracteres incluidos en la fuente embebida. */
const ALLOWED = /[ -~ -ÿŒœŠšŸ‐-‧‰-›€™←-↓−≤≥●✓-✕\n]/;
const pdfText = (s?: string | null) => (s ?? '').replace(//g, '•').replace(/\r/g, '').split('').filter(ch => ALLOWED.test(ch)).join('');
const n = (v?: number | null, dec = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const two = (k: number) => String(k).padStart(2, '0');

interface RichCell {
  content: string; colSpan?: number; rowSpan?: number; styles?: Partial<Styles>;
  _mask?: boolean[]; _just?: boolean; _cursor?: number; _check?: boolean; _badge?: { text: string; ink: RGB; bg: RGB };
}
function rich(text: string, o: { colSpan?: number; rowSpan?: number; styles?: Partial<Styles>; justify?: boolean } = {}): RichCell {
  const segs = boldSegments(pdfText(text));
  let content = ''; const mask: boolean[] = [];
  for (const sg of segs) { content += sg.text; for (let i = 0; i < sg.text.length; i++) mask.push(sg.bold); }
  return { content, colSpan: o.colSpan, rowSpan: o.rowSpan, styles: o.styles, _mask: mask, _just: !!o.justify };
}

function findingText(f: Finding): string {
  const desc = (f.description ?? '').trim();
  const title = f.title.trim().replace(/…$/, '');
  if (!desc) return `**${title}**`;
  const flat = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  if (flat(desc).startsWith(flat(title))) return desc;
  return `**${title}:** ${desc}`;
}

export async function buildFinalReportPdf(r: AuditReport, kind: 'plan' | 'final', opts: { includePhotos: boolean } = { includePhotos: true }): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  registerPdfFonts(doc);
  doc.setFont(F, 'normal');
  doc.setLineHeightFactor(1.3);
  const k = doc.internal.scaleFactor;
  const a = r.audit;
  const rep = resolveReport(a, {
    company: r.names.company(a.company_id), location: r.names.location(a.location_id),
    leadAuditor: r.names.person(a.lead_auditor_id), sections: r.sections.map(s => s.title.trim()),
  });
  const title = kind === 'plan' ? rep.plan_title : rep.title;
  const kindTitle = title.replace(/^INFORME FINAL\s*/i, '').replace(/^PLAN DE\s*/i, '').trim();
  const subtitle = kindTitle ? kindTitle.charAt(0) + kindTitle.slice(1).toLowerCase() : '';
  const docName = kind === 'plan' ? 'Plan de auditoría' : 'Informe final';
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = TOP;
  let secNo = 0;
  const coverPages = new Set<number>();

  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = (h: number) => { if (y + h > PH - BOTTOM) newPage(); };
  const setText = (size: number, color: RGB = INK, family = F, style = 'normal') => { doc.setFont(family, style); doc.setFontSize(size); doc.setTextColor(...color); };

  // ---------------------------------------------------------------- celdas con negrita, justificado y distintivos
  const drawRich = (c: CellHookData, lines: string[]) => {
    const raw = c.cell.raw as RichCell;
    const fs = Number(c.cell.styles.fontSize) || FS;
    const fsU = fs / k;
    const lh = fsU * doc.getLineHeightFactor();
    const x0 = c.cell.x + c.cell.padding('left');
    const avail = c.cell.width - c.cell.padding('horizontal');
    let yy = c.cell.y + c.cell.padding('top') + fsU * (2 - 1.15);
    const plain = raw.content; const mask = raw._mask ?? [];
    doc.setFontSize(fs); doc.setTextColor(...((c.cell.styles.textColor as RGB) ?? INK));
    const italic = String(c.cell.styles.fontStyle).includes('italic');
    const baseStyle = italic ? 'italic' : 'normal';
    const boldStyle = italic ? 'bolditalic' : 'bold';
    const runs = (txt: string, from: number, cb: (part: string, bold: boolean) => void) => {
      let i = 0;
      while (i < txt.length) { const b = !!mask[from + i]; let j = i; while (j < txt.length && !!mask[from + j] === b) j++; cb(txt.slice(i, j), b); i = j; }
    };
    const widthOf = (txt: string, from: number) => { let w = 0; runs(txt, from, (p, b) => { doc.setFont(F, b ? boldStyle : baseStyle); w += doc.getTextWidth(p); }); return w; };
    for (const ln0 of lines) {
      const ln = ln0.replace(/\s+$/, '');
      if (!ln) { yy += lh; continue; }
      let idx = plain.indexOf(ln, raw._cursor ?? 0);
      if (idx < 0) idx = plain.indexOf(ln);
      if (idx < 0) { doc.setFont(F, baseStyle); doc.text(ln, x0, yy); yy += lh; continue; }
      raw._cursor = idx + ln.length;
      const rest = plain.slice(idx + ln.length);
      const lastOfPara = rest.trim() === '' || /^ *\n/.test(rest);
      const words: { t: string; at: number }[] = [];
      { const re = /\S+/g; let m: RegExpExecArray | null; while ((m = re.exec(ln))) words.push({ t: m[0], at: idx + m.index }); }
      doc.setFont(F, baseStyle); const sp = doc.getTextWidth(' ');
      const ws = words.map(w => widthOf(w.t, w.at));
      const total = ws.reduce((p, q) => p + q, 0);
      let gap = sp;
      if (raw._just && !lastOfPara && words.length > 1) { const g = (avail - total) / (words.length - 1); if (g > sp && g < sp * 4) gap = g; }
      let xx = x0;
      words.forEach((w, i) => {
        let wx = xx;
        runs(w.t, w.at, (p, b) => { doc.setFont(F, b ? boldStyle : baseStyle); doc.text(p, wx, yy); wx += doc.getTextWidth(p); });
        if (i < words.length - 1) { doc.setFont(F, baseStyle); doc.text(' ', xx + ws[i], yy); }
        xx += ws[i] + gap;
      });
      yy += lh;
    }
  };
  const drawCheck = (cx: number, cy: number, color: RGB = BRAND) => {
    doc.setFillColor(...BRAND_TINT); doc.circle(cx, cy, 2.3, 'F');
    doc.setDrawColor(...color); doc.setLineWidth(0.45);
    doc.line(cx - 1.1, cy + 0.05, cx - 0.3, cy + 0.85); doc.line(cx - 0.3, cy + 0.85, cx + 1.2, cy - 0.8);
    doc.setLineWidth(0.2);
  };
  const drawBadge = (c: CellHookData, b: { text: string; ink: RGB; bg: RGB }) => {
    const cx = c.cell.x + c.cell.width / 2, cy = c.cell.y + 5.2;
    doc.setFillColor(...b.bg); doc.circle(cx, cy, 3.4, 'F');
    setText(8.5, b.ink, FSEMI); doc.text(b.text, cx, cy + 1.05, { align: 'center' });
  };
  const hooks = {
    didParseCell: (c: CellHookData) => {
      const raw = c.cell.raw as RichCell | undefined;
      if (raw && typeof raw === 'object' && raw._mask?.some(Boolean)) c.cell.styles.fontStyle = String(c.cell.styles.fontStyle).includes('italic') ? 'bolditalic' : 'bold';
    },
    willDrawCell: (c: CellHookData) => {
      const raw = c.cell.raw as RichCell | undefined;
      if (raw && typeof raw === 'object' && ((raw._mask && (raw._mask.some(Boolean) || raw._just)) || raw._badge)) {
        (c.cell as unknown as { _lines: string[] })._lines = raw._badge ? [] : [...(c.cell.text as string[])];
        c.cell.text = [];
      }
    },
    didDrawCell: (c: CellHookData) => {
      const raw = c.cell.raw as RichCell | undefined;
      const lines = (c.cell as unknown as { _lines?: string[] })._lines;
      if (lines?.length) drawRich(c, lines);
      if (raw && typeof raw === 'object' && c.section === 'body') {
        if (raw._check) drawCheck(c.cell.x + c.cell.width / 2, c.cell.y + 4.6);
        if (raw._badge) drawBadge(c, raw._badge);
      }
    },
  };
  /** Tabla liviana: líneas horizontales, encabezado en verde claro. */
  const base = {
    margin: { top: TOP, bottom: BOTTOM, left: ML, right: MR },
    tableWidth: CW,
    theme: 'plain' as const,
    styles: { font: F, fontSize: FS, textColor: INK, cellPadding: { top: 2.1, bottom: 2.1, left: 2.4, right: 2.4 }, valign: 'top' as const, overflow: 'linebreak' as const,
      lineColor: LINE, lineWidth: { bottom: 0.2, top: 0, left: 0, right: 0 } },
    headStyles: { font: FSEMI, fontStyle: 'normal' as const, fillColor: BRAND_TINT, textColor: BRAND_DARK, fontSize: 8, lineColor: BRAND_LINE, lineWidth: { bottom: 0.35, top: 0, left: 0, right: 0 } },
    rowPageBreak: 'avoid' as const,
    ...hooks,
  };

  // ---------------------------------------------------------------- piezas de diseño
  const section = (t: string) => {
    ensure(48);   // el título va con el comienzo de su contenido
    secNo++;
    y += secNo === 1 ? 0 : 4;
    setText(9, BRAND, FSEMI); doc.text(two(secNo), ML, y + 5);
    setText(13, INK, FSEMI); doc.text(pdfText(t.toUpperCase()), ML + 9, y + 5.2, { charSpace: 0.15 });
    doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(ML, y + 8.2, ML + 9 - 2, y + 8.2);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(ML + 9 - 2, y + 8.2, PW - MR, y + 8.2);
    y += 12.5;
  };
  const subTitle = (t: string) => { ensure(14); setText(10.5, BRAND_DARK, FSEMI); doc.text(pdfText(t), ML, y + 4); y += 7; };
  type Row = (RichCell | string)[];
  const NOLINE = { lineWidth: 0 } as Partial<Styles>;
  const textRows = (s: string): Row[] => {
    const rows: Row[] = [];
    for (const b of textBlocks(s)) {
      if (b.kind === 'li') rows.push([{ content: '', styles: NOLINE }, { content: '•', styles: { ...NOLINE, textColor: BRAND, fontStyle: 'bold', halign: 'right' } }, rich(b.text, { justify: true, styles: NOLINE })]);
      else rows.push([rich(b.text, { colSpan: 3, justify: true, styles: { ...NOLINE, cellPadding: { top: 1.3, bottom: 1.9, left: 0, right: 0 } } })]);
    }
    return rows;
  };
  const flow = (rows: Row[]) => {
    if (!rows.length) return;
    autoTable(doc, { ...base, startY: y, body: rows, rowPageBreak: 'auto',
      styles: { ...base.styles, lineWidth: 0, cellPadding: { top: 1.1, bottom: 1.1, left: 0, right: 0 }, fontSize: 10 },
      columnStyles: { 0: { cellWidth: 2 }, 1: { cellWidth: 5, cellPadding: { top: 1.1, bottom: 1.1, left: 0, right: 2 } } } });
    y = last() + 2;
  };
  const keyValues = (rows: [string, string][]) => {
    const body = rows.map(([label, v]) => [{ content: pdfText(label.toUpperCase()), styles: { font: FSEMI, fontSize: 7.6, textColor: MUTED, cellPadding: { top: 2.8, bottom: 2.2, left: 2.4, right: 2 } } }, rich(v || '—')]);
    autoTable(doc, { ...base, startY: y, body, columnStyles: { 0: { cellWidth: 52 } },
      didParseCell: (c: CellHookData) => { hooks.didParseCell(c); if (c.section === 'body' && c.row.index % 2 === 0) c.cell.styles.fillColor = ZEBRA; } });
    y = last() + 3;
  };
  const tint = (h: number, color: RGB = BRAND_TINT) => { doc.setFillColor(...color); doc.roundedRect(ML, y, CW, h, 2, 2, 'F'); };

  // ================================================================== portada (informe) o bloque de título (plan)
  const cfg = isSituacionConfig(r.version.scoring_config) ? r.version.scoring_config : null;
  const sit = !!cfg;
  const finalVal = sit ? (r.official ? a.score : r.result.final) : (r.official ? a.compliance_pct : r.result.compliance_pct);
  const fband = r.official ? (a.result_band ?? null) : (r.result.band ?? null);
  const isNc = (f: Finding) => ['no_conformidad', 'nc_mayor', 'nc_menor'].includes(f.finding_type);
  const strengths = rep.strengths.filter(s => s.text.trim() || s.area.trim());
  const counts = { nc: r.findings.filter(isNc).length, obs: r.findings.filter(f => f.finding_type === 'observacion').length, opm: r.findings.filter(f => f.finding_type === 'oportunidad_mejora').length, fort: strengths.length };
  const approval = rep.plan_approval ?? { status: 'borrador' as const };

  if (kind === 'final') {
    coverPages.add(1);
    // franja superior
    doc.setFillColor(...BRAND_DARK); doc.rect(0, 0, PW, 6, 'F');
    const lw = 36, lh = lw / RS_LOGO_RATIO;
    doc.addImage(RS_LOGO_PNG, 'PNG', ML - 1, 16, lw, lh);
    setText(8.5, MUTED); doc.text(pdfText(AUDIT_FIRM.name.toUpperCase()), PW - MR, 24, { align: 'right', charSpace: 0.4 });
    doc.text(pdfText(new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })), PW - MR, 29, { align: 'right' });

    let cy = 72;
    setText(10, BRAND, FSEMI); doc.text(pdfText(subtitle.toUpperCase()), ML, cy, { charSpace: 0.5 });
    cy += 13;
    setText(34, INK, FSEMI); doc.text('Informe final', ML, cy);
    cy += 9;
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.1); doc.line(ML, cy, ML + 22, cy); doc.setLineWidth(0.2);
    cy += 14;
    setText(9, MUTED, FSEMI); doc.text('EMPRESA CONTRATISTA', ML, cy); cy += 8;
    setText(22, INK, F, 'bold');
    const cl = (doc.splitTextToSize(pdfText(rep.contractor || '—'), CW) as string[]).slice(0, 2);
    doc.text(cl, ML, cy); cy += cl.length * 9;
    if (rep.contract) { setText(12, INK2); doc.text((doc.splitTextToSize(pdfText(`Contrato ${rep.contract.replace(/^contrato\s*/i, '')}`), CW) as string[]).slice(0, 2), ML, cy); cy += 7; }

    // tarjeta de resultado
    cy = Math.max(cy + 10, 150);
    const st = bandStyle(fband);
    const cardW = 78, cardH = 46;
    doc.setFillColor(...(st ? rgb(st.bg) : BRAND_TINT)); doc.roundedRect(ML, cy, cardW, cardH, 3, 3, 'F');
    const ink = st ? rgb(st.fg) : BRAND_DARK;
    setText(8.5, ink, FSEMI); doc.text(r.official ? 'RESULTADO DE LA EVALUACIÓN' : 'RESULTADO PRELIMINAR', ML + 7, cy + 10, { charSpace: 0.3 });
    const valText = pdfText(finalVal === null || finalVal === undefined ? '—' : sit ? n(finalVal) : `${n(finalVal, 1)} %`);
    setText(34, ink, F, 'bold'); doc.text(valText, ML + 7, cy + 28); const valW = doc.getTextWidth(valText);
    if (sit) { setText(10, ink); doc.text('/ 10', ML + 9 + valW, cy + 28); }
    setText(15, ink, FSEMI); doc.text(pdfText(fband ?? (sit ? 'Sin calificación' : 'Cumplimiento')), ML + 7, cy + 38);
    // contadores
    const kx = ML + cardW + 6, kw = (CW - cardW - 6 - 6) / 2, kh = (cardH - 4) / 2;
    ([['nc', counts.nc], ['obs', counts.obs], ['opm', counts.opm], ['fort', counts.fort]] as const).forEach(([key, v], i) => {
      const x = kx + (i % 2) * (kw + 6), yy = cy + Math.floor(i / 2) * (kh + 4);
      doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.roundedRect(x, yy, kw, kh, 2, 2, 'FD');
      doc.setFillColor(...TAG[key].ink); doc.roundedRect(x, yy, 1.4, kh, 0.7, 0.7, 'F');
      setText(20, TAG[key].ink, F, 'bold'); doc.text(String(v), x + 6, yy + 13.4); const vw = doc.getTextWidth(String(v));
      setText(8.4, INK2, FSEMI); doc.text(pdfText(key === 'fort' ? 'Fortalezas' : key === 'opm' ? 'Oport. de mejora' : key === 'obs' ? 'Observaciones' : 'No conformidades'), x + 8.5 + vw, yy + 12.8);
    });

    // datos
    cy += cardH + 14;
    const facts: [string, string][] = [
      ['Compañía solicitante', rep.requesting_company], ['Auditor responsable', rep.lead_auditor],
      ['Fecha de realización', rep.dates_text], ['Lugares auditados', rep.places],
    ];
    facts.forEach(([kk, v], i) => {
      const x = ML + (i % 2) * (CW / 2 + 2), yy = cy + Math.floor(i / 2) * 17;
      setText(7.6, MUTED, FSEMI); doc.text(pdfText(kk.toUpperCase()), x, yy, { charSpace: 0.3 });
      setText(10.5, INK); doc.text((doc.splitTextToSize(pdfText(v || '—'), CW / 2 - 6) as string[]).slice(0, 2), x, yy + 5.5);
    });
    // pie de portada
    doc.setFillColor(...BRAND_DARK); doc.rect(0, PH - 22, PW, 22, 'F');
    setText(9.5, WHITE, FSEMI); doc.text(pdfText(AUDIT_FIRM.name), ML, PH - 12.5);
    setText(7.8, rgb('#B7CCBB')); doc.text(pdfText(AUDIT_FIRM.tagline), ML, PH - 8);
    setText(8, rgb('#B7CCBB')); doc.text(pdfText(`${a.code ?? ''}  ·  Documento confidencial`), PW - MR, PH - 12, { align: 'right' });
    newPage();
  } else {
    // bloque de título del plan
    setText(9.5, BRAND, FSEMI); doc.text(pdfText(subtitle.toUpperCase()), ML, y + 4, { charSpace: 0.5 });
    setText(26, INK, FSEMI); doc.text('Plan de auditoría', ML, y + 16);
    if (approval.status === 'aprobado') {
      const t = pdfText(`✓ Aceptado por el cliente · ${approval.approved_at ? new Date(approval.approved_at + 'T12:00:00').toLocaleDateString('es-AR') : ''}`);
      setText(8.5, BRAND, FSEMI); const tw = doc.getTextWidth(t) + 8;
      doc.setFillColor(...BRAND_TINT); doc.roundedRect(PW - MR - tw, y + 9.5, tw, 7.5, 3.75, 3.75, 'F'); doc.text(t, PW - MR - tw + 4, y + 14.4);
    } else {
      const t = approval.status === 'enviado' ? 'Enviado al cliente para su aceptación' : 'Borrador para aceptación del cliente';
      setText(8.5, MUTED, FSEMI); const tw = doc.getTextWidth(t) + 8;
      doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.roundedRect(PW - MR - tw, y + 9.5, tw, 7.5, 3.75, 3.75, 'FD'); doc.text(t, PW - MR - tw + 4, y + 14.4);
    }
    y += 22;
    doc.setDrawColor(...BRAND); doc.setLineWidth(1.1); doc.line(ML, y, ML + 22, y); doc.setLineWidth(0.2);
    y += 9;
  }

  // ================================================================== datos generales, objetivo, criterios, plan
  section('Datos generales');
  keyValues([
    ['Compañía solicitante', rep.requesting_company], ['Empresa contratista', rep.contractor], ['Contrato', rep.contract],
    ['Auditor responsable', rep.lead_auditor], ['Fecha de realización', rep.dates_text], ['Lugares a auditar', rep.places],
  ]);
  section('Objetivo de la auditoría'); flow(textRows(rep.objectives));
  section('Criterios de auditoría'); flow(textRows(rep.criteria));
  section('Plan de auditoría');
  const planBody: Row[] = [];
  for (const g of planGroups(rep.plan)) {
    g.rows.forEach((p, i) => {
      const row: Row = [];
      if (i === 0) row.push({ content: pdfText(g.date), rowSpan: g.rows.length, styles: { font: FSEMI, textColor: BRAND_DARK, fillColor: WHITE } });
      row.push({ content: pdfText(p.time), styles: { font: FSEMI, textColor: INK2 } });
      if (p.highlight) row.push(rich(p.process, { colSpan: 3, styles: { fillColor: BRAND_TINT, textColor: BRAND_DARK, fontStyle: 'italic' } }));
      else row.push(rich(p.process), rich(p.auditees, { styles: { textColor: INK2, fontSize: 9 } }), rich(p.topics));
      planBody.push(row);
    });
  }
  if (!planBody.length) planBody.push([{ content: 'Cronograma a definir.', colSpan: 5, styles: { textColor: MUTED, fontStyle: 'italic' } }]);
  autoTable(doc, { ...base, startY: y, head: [['FECHA', 'HORA', 'PROCESO A AUDITAR', 'AUDITADOS DISPONIBLES', 'TEMAS']], body: planBody,
    columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 15 }, 2: { cellWidth: 48 }, 3: { cellWidth: 40 } } });
  y = last() + 4;

  if (kind === 'plan') {
    // aceptación del cliente
    ensure(48);
    section('Aceptación del plan');
    if (approval.status === 'aprobado') {
      flow(textRows(`Plan aceptado por **${approval.approved_by ?? ''}** el ${approval.approved_at ? new Date(approval.approved_at + 'T12:00:00').toLocaleDateString('es-AR') : ''}${approval.notes ? ` (${approval.notes})` : ''}.`));
    } else {
      flow(textRows('La auditoría se realizará conforme al presente plan una vez aceptado por la compañía solicitante. Cualquier cambio de fechas, horarios o auditados se coordinará con anticipación.'));
      y += 14;
      const bw = (CW - 20) / 2;
      [['Por RS Consultora', rep.lead_auditor], ['Por la compañía solicitante', rep.requesting_company]].forEach(([t, v], i) => {
        const x = ML + i * (bw + 20);
        doc.setDrawColor(...INK2); doc.setLineWidth(0.3); doc.line(x, y, x + bw, y);
        setText(9, INK, FSEMI); doc.text(pdfText(t), x, y + 5);
        setText(8.5, MUTED); doc.text((doc.splitTextToSize(pdfText(v || ''), bw) as string[]).slice(0, 1), x, y + 9.5);
        doc.text('Firma y aclaración · Fecha', x, y + 14);
      });
      y += 18;
    }
  }

  if (kind === 'final') {
    // ================================================================== desarrollo y conclusiones
    section('Desarrollo de la auditoría'); flow(textRows(rep.development || 'Sin redactar.'));
    section('Conclusiones de la auditoría');
    flow(textRows(rep.conclusions || ''));
    const confs = rep.conformities.filter(c => c.text.trim());
    if (confs.length) {
      ensure(20);
      subTitle('Conformidades verificadas por requisito');
      const rows: Row[] = [];
      for (const cf of confs) {
        const blocks = textBlocks(cf.text);
        const first = blocks[0]?.kind === 'p' ? blocks.shift()!.text : '';
        rows.push([{ content: '', _check: true, styles: { lineWidth: 0 } } as RichCell, rich(`**${cf.section}**${first ? `: ${first}` : ''}`, { justify: true, styles: { lineWidth: 0 } })]);
        for (const b of blocks) rows.push([{ content: '', styles: { lineWidth: 0 } }, rich(`${b.kind === 'li' ? '•  ' : ''}${b.text}`, { justify: true, styles: { lineWidth: 0, cellPadding: { top: 0.6, bottom: 0.9, left: 6, right: 0 } } })]);
        rows.push([{ content: '', colSpan: 2, styles: { lineWidth: { bottom: 0.2 }, lineColor: LINE, cellPadding: 0, minCellHeight: 1.6 } }]);
      }
      autoTable(doc, { ...base, startY: y, body: rows, rowPageBreak: 'auto', styles: { ...base.styles, lineWidth: 0, fontSize: 9.8, cellPadding: { top: 1.6, bottom: 0.8, left: 0, right: 0 } },
        columnStyles: { 0: { cellWidth: 9 } } });
      y = last() + 2;
    }

    // ================================================================== fortalezas
    if (strengths.length) {
      section('Fortalezas');
      autoTable(doc, { ...base, startY: y, columnStyles: { 0: { cellWidth: 13 } },
        body: strengths.map((s, i) => [{ content: '', _badge: { text: two(i + 1), ...TAG.fort } } as RichCell,
          rich(`${s.area.trim() ? `**${s.area.trim().toUpperCase()}:** ` : ''}${s.text}`, { justify: true })]) });
      y = last() + 2;
    }

    // ================================================================== hallazgos
    const itemOf = new Map(r.items.map(i => [i.id, i]));
    const secOrder = new Map(r.sections.map((s, i) => [s.id, i]));
    const secTitle = new Map(r.sections.map(s => [s.id, s.title.trim()]));
    const sorted = (fs: Finding[]) => [...fs].sort((p, q) => {
      const ip = p.item_id ? itemOf.get(p.item_id) : undefined, iq = q.item_id ? itemOf.get(q.item_id) : undefined;
      const sp = ip ? secOrder.get(ip.section_id) ?? 99 : 99, sq = iq ? secOrder.get(iq.section_id) ?? 99 : 99;
      return sp - sq || (ip?.sort_order ?? 1e9) - (iq?.sort_order ?? 1e9) || (p.code ?? '').localeCompare(q.code ?? '');
    });
    const opm = sorted(r.findings.filter(f => f.finding_type === 'oportunidad_mejora'));
    const obs = sorted(r.findings.filter(f => f.finding_type === 'observacion'));
    const ncs = sorted(r.findings.filter(isNc));
    const numOf = new Map<string, { label: string; tag: keyof typeof TAG }>();
    opm.forEach((f, i) => numOf.set(f.id, { label: `Oportunidad de mejora N° ${i + 1}`, tag: 'opm' }));
    obs.forEach((f, i) => numOf.set(f.id, { label: `Observación N° ${i + 1}`, tag: 'obs' }));
    ncs.forEach((f, i) => numOf.set(f.id, { label: `No Conformidad N° ${i + 1}`, tag: 'nc' }));

    const pnum = photoNumbers(r.evidences);
    const respIdOf = new Map([...r.responses.values()].map(rr => [rr.item_id, rr.id]));
    const findingEvs = (f: Finding) => {
      const acts = new Set(r.actions.filter(x => x.finding_id === f.id).map(x => x.id));
      const rid = f.response_id ?? (f.item_id ? respIdOf.get(f.item_id) : undefined);
      return r.evidences.filter(e => pnum.has(e.id) && (e.finding_id === f.id || (rid && e.response_id === rid) || (e.action_id && acts.has(e.action_id))));
    };
    const photoNote = (f: Finding) => {
      if (!opts.includePhotos) return '';
      const ns = [...new Set(findingEvs(f).map(e => pnum.get(e.id)!))].sort((p, q) => p - q);
      return ns.length ? `\nVer registro fotográfico (${ns.length === 1 ? `foto ${ns[0]}` : `fotos ${ns.join(', ')}`}).` : '';
    };
    const ref = (f: Finding) => f.requirement?.trim() || f.legal_reference?.trim() || (f.item_id ? itemOf.get(f.item_id)?.legal_reference?.trim() : '') || '';
    const groupRow = (t: string): Row => [{ content: pdfText(t.toUpperCase()), colSpan: 3, styles: { font: FSEMI, fontSize: 7.8, textColor: MUTED, fillColor: ZEBRA, cellPadding: { top: 1.8, bottom: 1.6, left: 2.4, right: 2 } } }];

    const register = (t: string, list: Finding[], tag: keyof typeof TAG, third: 'ref' | 'rationale') => {
      if (!list.length) return;
      section(t);
      const body: Row[] = [];
      let cur: string | null = null;
      list.forEach((f, i) => {
        const it = f.item_id ? itemOf.get(f.item_id) : undefined;
        const stt = it ? secTitle.get(it.section_id) ?? 'General' : 'General';
        if (third === 'ref' && stt !== cur) { cur = stt; body.push(groupRow(stt)); }
        body.push([{ content: '', _badge: { text: two(i + 1), ...TAG[tag] } } as RichCell, rich(findingText(f) + photoNote(f), { justify: true }),
          rich(third === 'ref' ? ref(f) : (f.rationale ?? ''), { styles: { textColor: INK2, fontSize: 9 } })]);
      });
      autoTable(doc, { ...base, startY: y, head: [['N°', 'DESCRIPCIÓN', third === 'ref' ? 'REFERENCIA / REQUISITO' : 'FUNDAMENTO']], body,
        columnStyles: { 0: { cellWidth: 13 }, 2: { cellWidth: 50 } },
        didParseCell: (c: CellHookData) => { hooks.didParseCell(c); if (c.section === 'head' && c.column.index === 0) c.cell.styles.halign = 'center'; } });
      y = last() + 2;
    };
    register('Oportunidades de mejora', opm, 'opm', 'rationale');
    register('Registro de observaciones', obs, 'obs', 'ref');
    register('Registro de no conformidades', ncs, 'nc', 'ref');

    // ================================================================== evaluación (colores exactos de la planilla)
    const bandCell = (b: string | null | undefined) => { const st = bandStyle(b); return st ? { fillColor: rgb(st.bg), textColor: rgb(st.fg), font: FSEMI } : {}; };
    const evalH = 70 + r.sectionsResult.length * 7 + (cfg ? cfg.bands.length * 6 + 10 : 0);
    if (y + evalH > PH - BOTTOM) newPage();
    section('Evaluación del contratista por la consultora');
    flow(textRows(`En función de las evidencias analizadas y de la evaluación interna que realiza esta consultoría, el Contratista presenta el siguiente nivel de cumplimiento${r.official ? '' : ' (resultado preliminar: la auditoría todavía no se completó)'}:`));
    if (r.sectionsResult.length) {
      const raw = r.sectionsResult.reduce((t, x) => t + Number(x.raw || 0), 0);
      const target = r.sectionsResult.reduce((t, x) => t + Number(x.target || 0), 0);
      autoTable(doc, { ...base, startY: y + 1,
        head: [[sit ? 'REQUISITOS DEL SISTEMA DE GESTIÓN' : 'SECCIÓN', 'ALCANZADO', 'OBJETIVO', sit ? 'EVALUACIÓN' : 'CUMPLIMIENTO']],
        headStyles: { ...base.headStyles, fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), lineColor: rgb(SHEET.header) },
        columnStyles: { 0: { font: FSEMI, fontSize: 8.6 }, 1: { cellWidth: 22, halign: 'center' }, 2: { cellWidth: 22, halign: 'center' }, 3: { cellWidth: 26, halign: 'center' } },
        didParseCell: (c: CellHookData) => { if (c.section === 'head' && c.column.index > 0) c.cell.styles.halign = 'center'; },
        body: [
          ...r.sectionsResult.map(s => {
            const v = s.score === null || s.score === undefined ? null : Number(s.score);
            return [pdfText(String(s.title).trim().toUpperCase()), n(Number(s.raw), sit ? 0 : 2), n(Number(s.target), sit ? 0 : 2),
              sit ? { content: n(v), styles: bandCell(bandFor(v, cfg?.bands)) } : `${n(v, 1)} %`];
          }),
          [{ content: pdfText(sit ? 'RESULTADO FINAL AUDITORÍA A PROVEEDOR' : 'CUMPLIMIENTO FINAL'), styles: { font: FSEMI, fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk) } },
            { content: n(raw, sit ? 0 : 2), styles: { font: FSEMI, fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk), halign: 'center' } },
            { content: n(target, sit ? 0 : 2), styles: { font: FSEMI, fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk), halign: 'center' } },
            sit ? { content: n(finalVal), styles: { ...bandCell(fband), fontSize: 11 } } : { content: `${n(finalVal, 1)} %`, styles: { font: FSEMI } }],
        ] });
      y = last() + 6;
    }
    if (cfg) {
      ensure(10 + cfg.bands.length * 7);
      setText(7.8, MUTED, FSEMI); doc.text('CRITERIO DE EVALUACIÓN', ML, y + 3, { charSpace: 0.3 });
      const w = CW / cfg.bands.length;
      [...cfg.bands].sort((p, q) => (q.min ?? 0) - (p.min ?? 0)).forEach((b, i) => {
        const st = bandStyle(b.label); const x = ML + i * w;
        doc.setFillColor(...(st ? rgb(st.bg) : ZEBRA)); doc.rect(x, y + 6, w - 1.2, 11, 'F');
        setText(9.5, st ? rgb(st.fg) : INK, FSEMI); doc.text(pdfText(b.label), x + 3, y + 11.2);
        setText(8, st ? rgb(st.fg) : MUTED); doc.text(pdfText(bandRange(b)), x + 3, y + 15.2);
      });
      y += 22;
    }
    flow(textRows(rep.recommendation));

    // ================================================================== anexo
    const hasActa = !!(a.closing_meeting_at || a.closing_attendees || a.closing_agreements || r.signatures.length);
    const generalPhotos = opts.includePhotos ? r.evidences.filter(e => pnum.has(e.id) && !e.response_id && !e.finding_id && !e.action_id) : [];
    if (hasActa || generalPhotos.length) {
      if (y + 70 > PH - BOTTOM) newPage();
      section('Anexo');
      if (hasActa) {
        const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-AR') : '—');
        const acta: [string, string][] = [];
        if (a.closing_meeting_at) acta.push(['Fecha de la reunión de cierre', d(a.closing_meeting_at)]);
        if (a.closing_attendees?.trim()) acta.push(['Asistentes', a.closing_attendees]);
        if (a.closing_agreements?.trim()) acta.push(['Acuerdos y compromisos', a.closing_agreements]);
        subTitle('Acta de la reunión de cierre');
        if (acta.length) keyValues(acta);
        if (r.signatures.length) {
          const bw = (CW - 8) / 3, bh = 34;
          let x = ML; ensure(bh + 4);
          for (const s of r.signatures) {
            if (x + bw > PW - MR + 0.1) { x = ML; y += bh + 4; }
            if (y + bh > PH - BOTTOM) { newPage(); x = ML; }
            doc.setDrawColor(...LINE); doc.setFillColor(...WHITE); doc.roundedRect(x, y, bw, bh, 2, 2, 'FD');
            try { doc.addImage(s.signature_png, 'PNG', x + 4, y + 2, bw - 8, 14); } catch { /* firma ilegible */ }
            doc.setDrawColor(...MUTED); doc.line(x + 4, y + 17.5, x + bw - 4, y + 17.5);
            setText(9, INK, FSEMI); doc.text((doc.splitTextToSize(pdfText(s.signer_name), bw - 8) as string[])[0], x + 4, y + 22.5);
            setText(7.6, MUTED);
            doc.text((doc.splitTextToSize(pdfText([LABELS.signerRole[s.signer_role], s.signer_company].filter(Boolean).join(' · ')), bw - 8) as string[]).slice(0, 1), x + 4, y + 26.5);
            doc.text(pdfText(`${LABELS.agreement[s.agreement]} · ${new Date(s.signed_at).toLocaleDateString('es-AR')}`), x + 4, y + 30.5);
            x += bw + 4;
          }
          y += bh + 6;
        }
      }
      if (generalPhotos.length) { subTitle('Fotos y documentos de la auditoría'); await photoGrid(generalPhotos); }
    }

    // ================================================================== registro fotográfico
    if (opts.includePhotos) {
      const used = new Set(generalPhotos.map(e => e.id));
      const groups: { title: string; tag?: keyof typeof TAG; sub?: string; evs: Evidence[] }[] = [];
      for (const f of [...opm, ...obs, ...ncs]) {
        const evs = findingEvs(f).filter(e => !used.has(e.id)).sort((p, q) => pnum.get(p.id)! - pnum.get(q.id)!);
        evs.forEach(e => used.add(e.id));
        if (evs.length) groups.push({ title: numOf.get(f.id)!.label, tag: numOf.get(f.id)!.tag, sub: f.title, evs });
      }
      for (const s of r.sections) for (const it of r.items.filter(x => x.section_id === s.id)) {
        const rid = respIdOf.get(it.id); if (!rid) continue;
        const evs = r.evidences.filter(e => pnum.has(e.id) && !used.has(e.id) && e.response_id === rid).sort((p, q) => pnum.get(p.id)! - pnum.get(q.id)!);
        evs.forEach(e => used.add(e.id));
        if (evs.length) groups.push({ title: `Requisito ${it.original_number ?? it.code ?? ''}`.trim(), sub: it.question, evs });
      }
      const rest = r.evidences.filter(e => pnum.has(e.id) && !used.has(e.id));
      if (rest.length) groups.push({ title: 'Otras fotos', evs: rest });
      if (groups.length) {
        if (y + 30 + 62 > PH - BOTTOM) newPage();
        section('Registro fotográfico');
        for (const g of groups) {
          ensure(12 + 64);
          const tg = g.tag ? TAG[g.tag] : { ink: INK2, bg: ZEBRA };
          setText(8.6, tg.ink, FSEMI); const tw = doc.getTextWidth(pdfText(g.title)) + 7;
          doc.setFillColor(...tg.bg); doc.roundedRect(ML, y, tw, 6.4, 3.2, 3.2, 'F'); doc.text(pdfText(g.title), ML + 3.5, y + 4.4);
          if (g.sub) {
            setText(8.4, MUTED); let t = pdfText(g.sub.replace(/\s+/g, ' ').trim()); const maxW = CW - tw - 4;
            if (doc.getTextWidth(t) > maxW) { while (t.length > 4 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1); t += '…'; }
            doc.text(t, ML + tw + 3, y + 4.4);
          }
          y += 9.5;
          await photoGrid(g.evs);
        }
      }
    }

    // ================================================================== declaración del auditor
    if (y + 75 > PH - BOTTOM) newPage();
    section('Declaración del auditor');
    setText(10, INK2);
    const lines = doc.splitTextToSize(pdfText(rep.statement.replace(/\*\*/g, '')), CW - 12) as string[];
    const boxH = lines.length * (10 / k) * 1.3 + 9;
    tint(boxH);
    doc.setFillColor(...BRAND); doc.rect(ML, y, 1.2, boxH, 'F');
    flowInBox(rep.statement, boxH);
    y += boxH + 12;
    const sig = [...r.signatures].reverse().find(s => s.signer_role === 'auditor_lider');
    const sw = 66, sx = PW - MR - sw;
    if (sig) { try { doc.addImage(sig.signature_png, 'PNG', sx + 4, y, sw - 8, 22); } catch { /* firma ilegible */ } }
    doc.setDrawColor(...INK2); doc.setLineWidth(0.3); doc.line(sx, y + 23, sx + sw, y + 23);
    setText(10, INK, FSEMI); doc.text(pdfText(sig?.signer_name ?? rep.lead_auditor ?? ''), sx, y + 28.5);
    setText(8.4, MUTED); doc.text(pdfText(`Auditor responsable · ${AUDIT_FIRM.name}`), sx, y + 33);
    y += 36;
  }

  // ---------------------------------------------------------------- texto dentro del recuadro de la declaración
  function flowInBox(text: string, h: number) {
    const startY = y;
    autoTable(doc, { ...base, startY: startY + 3, margin: { ...base.margin, left: ML + 6, right: MR + 6 }, tableWidth: CW - 12,
      styles: { ...base.styles, lineWidth: 0, fontSize: 10, cellPadding: { top: 0.6, bottom: 0.6, left: 0, right: 0 }, textColor: INK2 },
      body: textBlocks(text).map(b => [rich(b.text, { justify: true })]) });
    y = startY; void h;
  }

  // ---------------------------------------------------------------- grilla de fotos (2 por fila, con epígrafe)
  async function photoGrid(evs: Evidence[]) {
    const pn = photoNumbers(r.evidences);
    const gap = 6, pw = (CW - gap) / 2, ph = 58, capH = 9;
    for (let i = 0; i < evs.length; i += 2) {
      const row = evs.slice(i, i + 2);
      if (y + ph + capH > PH - BOTTOM) newPage();
      for (let j = 0; j < row.length; j++) {
        const e = row[j]; const x = ML + j * (pw + gap);
        doc.setFillColor(...ZEBRA); doc.setDrawColor(...LINE); doc.roundedRect(x, y, pw, ph, 2, 2, 'FD');
        const url = await evidenceDataUrl(e.id, e.storage_path);
        if (url) {
          try {
            const pr = doc.getImageProperties(url);
            const kk = Math.min((pw - 4) / pr.width, (ph - 4) / pr.height); const iw = pr.width * kk, ih = pr.height * kk;
            doc.addImage(url, url.startsWith('data:image/png') ? 'PNG' : 'JPEG', x + (pw - iw) / 2, y + (ph - ih) / 2, iw, ih, undefined, 'FAST');
          } catch { /* imagen ilegible */ }
        } else { setText(8, MUTED); doc.text('Imagen no disponible', x + pw / 2, y + ph / 2, { align: 'center' }); }
        setText(8.2, INK2, FSEMI); const tag = `Foto ${pn.get(e.id) ?? ''}`; doc.text(tag, x, y + ph + 4.6);
        if (e.caption) {
          const tw = doc.getTextWidth(tag + '  ');
          setText(8.2, MUTED); let t = pdfText(e.caption);
          while (t.length > 4 && doc.getTextWidth(t) > pw - tw) t = t.slice(0, -2) + '…';
          doc.text(t, x + tw, y + ph + 4.6);
        }
      }
      y += ph + capH;
    }
    y += 2;
  }

  // ---------------------------------------------------------------- encabezado y pie en todas las páginas
  const pages = doc.getNumberOfPages();
  const metaLine = pdfText([a.code, rep.contractor, rep.dates_text].filter(Boolean).join('  ·  '));
  for (let p = 1; p <= pages; p++) {
    if (coverPages.has(p)) continue;
    doc.setPage(p);
    const lw = 21, lh = lw / RS_LOGO_RATIO;
    doc.addImage(RS_LOGO_PNG, 'PNG', ML - 0.5, 8.5, lw, lh);
    setText(9, BRAND_DARK, FSEMI); doc.text(pdfText(title), PW - MR, 13.2, { align: 'right', charSpace: 0.2 });
    setText(8, MUTED); doc.text(metaLine, PW - MR, 18, { align: 'right' });
    doc.setDrawColor(...BRAND); doc.setLineWidth(0.5); doc.line(ML, 23, PW - MR, 23);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(ML, PH - 13, PW - MR, PH - 13);
    setText(7.6, MUTED);
    doc.text(pdfText(AUDIT_FIRM.name), ML, PH - 8.5);
    doc.text(pdfText(`${docName} · Documento confidencial`), PW / 2, PH - 8.5, { align: 'center' });
    setText(7.6, INK2, FSEMI); doc.text(`Página ${p} de ${pages}`, PW - MR, PH - 8.5, { align: 'right' });
  }
  return doc.output('blob');
}

export type { ReportData };
