/**
 * PDF del plan de auditoría y del informe final con el formato de los modelos de RS Consultora:
 * encabezado con el logo y el título en cada página, un recuadro continuo con franjas verdes por
 * sección, tablas de oportunidades de mejora, observaciones y no conformidades agrupadas por
 * requisito, evaluación con los colores de la planilla, anexo, registro fotográfico y
 * declaración del auditor con su firma.
 */
import { jsPDF } from 'jspdf';
import autoTable, { type CellHookData, type Styles } from 'jspdf-autotable';
import { isSituacionConfig } from '../../scoring/engine';
import { bandFor, bandRange, bandStyle, SHEET } from '../../scoring/bands';
import { evidenceDataUrl } from '../evidences/evidenceService';
import { photoNumbers } from '../evidences/photoNumbers';
import { RS_LOGO_PNG, RS_LOGO_RATIO } from '../../config/logo';
import { LABELS, type Evidence, type Finding } from '../../types';
import type { AuditReport } from './reportData';
import { boldSegments, planGroups, resolveReport, textBlocks, type ReportData } from './finalReport';

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
const GREEN = rgb('#DAF2D0');
const GREY = rgb('#D9D9D9');
const INK: RGB = [17, 17, 17];
const LINE = 0.25;
const L = 20, R = 190, CW = R - L;
const HEAD_Y = 10, HEAD_H = 26;
const TOP = HEAD_Y + HEAD_H + 6;
const BOTTOM = 16;
const FS = 10;

const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = (s?: string | null) => (s ?? '').replace(//g, '•').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/×/g, 'x').replace(/[▲▼✓✔]/g, '')
  .split('').filter(ch => ch.charCodeAt(0) < 256 || CP1252_EXTRA.includes(ch) || ch === '\n').join('');
const n = (v?: number | null, dec = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const two = (k: number) => String(k).padStart(2, '0');

/** Celda con negritas (**texto**) y justificado opcional, dibujada a mano sobre el lugar que reserva la tabla. */
interface RichCell {
  content: string; colSpan?: number; rowSpan?: number; styles?: Partial<Styles>;
  _mask?: boolean[]; _just?: boolean; _cursor?: number; _check?: boolean;
}
function rich(text: string, o: { colSpan?: number; rowSpan?: number; styles?: Partial<Styles>; justify?: boolean } = {}): RichCell {
  const segs = boldSegments(pdfText(text));
  let content = ''; const mask: boolean[] = [];
  for (const sg of segs) { content += sg.text; for (let i = 0; i < sg.text.length; i++) mask.push(sg.bold); }
  return { content, colSpan: o.colSpan, rowSpan: o.rowSpan, styles: o.styles, _mask: mask, _just: !!o.justify };
}

/** Descripción de un hallazgo: el título va en negrita adelante salvo que ya sea el comienzo del texto. */
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
  const H = doc.internal.pageSize.getHeight();
  const k = doc.internal.scaleFactor;
  const a = r.audit;
  const rep = resolveReport(a, {
    company: r.names.company(a.company_id), location: r.names.location(a.location_id),
    leadAuditor: r.names.person(a.lead_auditor_id), sections: r.sections.map(s => s.title.trim()),
  });
  const title = kind === 'plan' ? rep.plan_title : rep.title;
  const last = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  let y = TOP;

  // ---------------------------------------------------------------- marco continuo por página
  const ext = new Map<number, { min: number; max: number }>();
  const mark = (page: number, y0: number, y1: number) => {
    const e = ext.get(page); if (!e) ext.set(page, { min: y0, max: y1 }); else { e.min = Math.min(e.min, y0); e.max = Math.max(e.max, y1); }
  };
  const page = () => doc.getCurrentPageInfo().pageNumber;
  const newPage = () => { doc.addPage(); y = TOP; };
  const ensure = (h: number) => { if (y + h > H - BOTTOM) newPage(); };

  // ---------------------------------------------------------------- celdas con negrita / justificado / tilde
  const drawRich = (c: CellHookData, lines: string[]) => {
    const raw = c.cell.raw as RichCell;
    const fs = Number(c.cell.styles.fontSize) || FS;
    const fsU = fs / k;
    const lh = fsU * doc.getLineHeightFactor();
    const x0 = c.cell.x + c.cell.padding('left');
    const avail = c.cell.width - c.cell.padding('horizontal');
    let yy = c.cell.y + c.cell.padding('top') + fsU * (2 - 1.15);
    const plain = raw.content; const mask = raw._mask ?? [];
    doc.setFontSize(fs); doc.setTextColor(...(c.cell.styles.textColor as RGB ?? INK));
    const baseStyle = c.cell.styles.fontStyle === 'italic' ? 'italic' : 'normal';
    const boldStyle = baseStyle === 'italic' ? 'bolditalic' : 'bold';
    const widthOf = (txt: string, from: number) => {
      let w = 0; let i = 0;
      while (i < txt.length) {
        const b = !!mask[from + i]; let j = i; while (j < txt.length && !!mask[from + j] === b) j++;
        doc.setFont('helvetica', b ? boldStyle : baseStyle); w += doc.getTextWidth(txt.slice(i, j)); i = j;
      }
      return w;
    };
    const drawRun = (txt: string, from: number, x: number) => {
      let i = 0; let xx = x;
      while (i < txt.length) {
        const b = !!mask[from + i]; let j = i; while (j < txt.length && !!mask[from + j] === b) j++;
        doc.setFont('helvetica', b ? boldStyle : baseStyle); const part = txt.slice(i, j); doc.text(part, xx, yy); xx += doc.getTextWidth(part); i = j;
      }
    };
    for (const ln0 of lines) {
      const ln = ln0.replace(/\s+$/, '');
      let idx = plain.indexOf(ln, raw._cursor ?? 0);
      if (idx < 0) idx = plain.indexOf(ln);
      if (!ln) { yy += lh; continue; }
      if (idx < 0) { doc.setFont('helvetica', baseStyle); doc.text(ln, x0, yy); yy += lh; continue; }
      raw._cursor = idx + ln.length;
      const after = plain.slice(idx + ln.length).replace(/^ +/, '');
      const lastOfPara = after === '' || after.startsWith('\n') || plain[idx + ln.length] === '\n';
      const words: { t: string; at: number }[] = [];
      { const re = /\S+/g; let m: RegExpExecArray | null; while ((m = re.exec(ln))) words.push({ t: m[0], at: idx + m.index }); }
      doc.setFont('helvetica', baseStyle); const sp = doc.getTextWidth(' ');
      const ws = words.map(w => widthOf(w.t, w.at));
      const total = ws.reduce((p, q) => p + q, 0);
      let gap = sp;
      if (raw._just && !lastOfPara && words.length > 1) { const g = (avail - total) / (words.length - 1); if (g > sp && g < sp * 4) gap = g; }
      let xx = x0;
      words.forEach((w, i) => {
        drawRun(w.t, w.at, xx);
        // espacio real entre palabras (invisible): el texto del PDF se puede copiar y buscar
        if (i < words.length - 1) { doc.setFont('helvetica', baseStyle); doc.text(' ', xx + ws[i], yy); }
        xx += ws[i] + gap;
      });
      yy += lh;
    }
  };
  const drawCheck = (c: CellHookData) => {
    const cx = c.cell.x + c.cell.width / 2, cy = c.cell.y + c.cell.padding('top') + 2.2;
    doc.setDrawColor(...INK); doc.setLineWidth(0.35);
    doc.line(cx - 1.5, cy, cx - 0.4, cy + 1.2); doc.line(cx - 0.4, cy + 1.2, cx + 1.7, cy - 1.4);
    doc.setLineWidth(LINE);
  };
  const hooks = {
    didParseCell: (c: CellHookData) => {
      const raw = c.cell.raw as RichCell | undefined;
      if (raw && typeof raw === 'object' && raw._mask?.some(Boolean)) c.cell.styles.fontStyle = c.cell.styles.fontStyle === 'italic' ? 'bolditalic' : 'bold';
    },
    willDrawCell: (c: CellHookData) => {
      const raw = c.cell.raw as RichCell | undefined;
      if (raw && typeof raw === 'object' && raw._mask && (raw._mask.some(Boolean) || raw._just)) {
        (c.cell as unknown as { _lines: string[] })._lines = [...(c.cell.text as string[])];
        c.cell.text = [];
      }
    },
    didDrawCell: (c: CellHookData) => {
      mark(page(), c.cell.y, c.cell.y + c.cell.height);
      const lines = (c.cell as unknown as { _lines?: string[] })._lines;
      if (lines) drawRich(c, lines);
      const raw = c.cell.raw as RichCell | undefined;
      if (raw && typeof raw === 'object' && raw._check && c.section === 'body') drawCheck(c);
    },
  };
  const base = {
    margin: { top: TOP, bottom: BOTTOM, left: L, right: 210 - R },
    tableWidth: CW,
    theme: 'grid' as const,
    styles: { font: 'helvetica', fontSize: FS, textColor: INK, lineColor: INK, lineWidth: LINE, cellPadding: { top: 1.4, bottom: 1.4, left: 2, right: 2 }, valign: 'top' as const, overflow: 'linebreak' as const },
    headStyles: { fillColor: [255, 255, 255] as RGB, textColor: INK, fontStyle: 'bold' as const, lineColor: INK, lineWidth: LINE },
    rowPageBreak: 'auto' as const,
    ...hooks,
  };

  /** Franja verde con el título de la sección. */
  const band = (t: string, o: { size?: number } = {}) => {
    ensure(34);   // la franja va con al menos el comienzo de su contenido
    autoTable(doc, { ...base, startY: y, body: [[{ content: pdfText(t), styles: { fillColor: GREEN, fontStyle: 'bold', halign: 'center', fontSize: o.size ?? 11, cellPadding: 2.6 } }]] });
    y = last();
  };
  /** Texto redactado dentro del recuadro (párrafos, viñetas y negritas). */
  const SIDE = { left: LINE, right: 0, top: 0, bottom: 0 }, SIDE_R = { left: 0, right: LINE, top: 0, bottom: 0 }, SIDES = { left: LINE, right: LINE, top: 0, bottom: 0 };
  type Row = (RichCell | string)[];
  const textRows = (s: string, o: { indent?: boolean } = {}): Row[] => {
    const rows: Row[] = [];
    for (const b of textBlocks(s)) {
      if (b.kind === 'li') rows.push([{ content: '', styles: { lineWidth: SIDE } }, { content: '•', styles: { lineWidth: 0, halign: 'right' } }, rich(b.text, { justify: true, styles: { lineWidth: SIDE_R } })]);
      else rows.push([rich(b.text, { colSpan: 3, justify: true, styles: { lineWidth: SIDES, cellPadding: { top: 1.4, bottom: 1.4, left: o.indent ? 12 : 4, right: 3 } } })]);
    }
    return rows;
  };
  const flow = (rows: Row[], pad = true) => {
    if (!rows.length) return;
    const body = pad ? [[{ content: '', colSpan: 3, styles: { lineWidth: SIDES, minCellHeight: 1.2, cellPadding: 0 } }], ...rows, [{ content: '', colSpan: 3, styles: { lineWidth: SIDES, minCellHeight: 1.2, cellPadding: 0 } }]] : rows;
    autoTable(doc, { ...base, startY: y, body, columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 6, cellPadding: { top: 1.4, bottom: 1.4, left: 0, right: 1.2 } } } });
    y = last();
  };
  const closeFrame = () => { doc.setDrawColor(...INK); doc.setLineWidth(LINE); doc.line(L, y, R, y); mark(page(), y, y); };

  // ================================================================== datos generales
  const kindTitle = title.replace(/^INFORME FINAL\s*/i, '').replace(/^PLAN DE\s*/i, '').trim();
  band(kind === 'plan' ? 'DATOS GENERALES' : `DATOS GENERALES – ${kindTitle}`);
  const dataRows: [string, string][] = [
    ['COMPAÑÍA SOLICITANTE', rep.requesting_company], ['EMPRESA CONTRATISTA', rep.contractor], ['CONTRATO', rep.contract],
    ['AUDITOR RESPONSABLE', rep.lead_auditor], ['FECHA DE REALIZACION', rep.dates_text], ['LUGARES A AUDITAR', rep.places],
  ];
  autoTable(doc, { ...base, startY: y, body: dataRows.map(([lbl, v]) => [rich(`**${lbl}:** ${v || ''}`)]) });
  y = last();

  // ================================================================== objetivo y criterios
  band('OBJETIVO DE LA AUDITORIA'); flow(textRows(rep.objectives), false);
  band('CRITERIOS DE AUDITORIA'); flow(textRows(rep.criteria), false);

  // ================================================================== plan
  band('PLAN DE AUDITORIA');
  const planBody: (RichCell | string)[][] = [];
  for (const g of planGroups(rep.plan)) {
    g.rows.forEach((p, i) => {
      const row: (RichCell | string)[] = [];
      if (i === 0) row.push({ content: pdfText(g.date), rowSpan: g.rows.length });
      row.push(pdfText(p.time));
      if (p.highlight) row.push(rich(p.process, { colSpan: 3, styles: { fillColor: GREEN } }));
      else row.push(rich(p.process), rich(p.auditees), rich(p.topics));
      planBody.push(row);
    });
  }
  if (!planBody.length) planBody.push([{ content: 'Cronograma a definir.', colSpan: 5, styles: { textColor: rgb('#666666') } }]);
  autoTable(doc, { ...base, startY: y, head: [['Fecha', 'Hora', 'Proceso a auditar', 'Auditados disponibles', 'Temas']], body: planBody,
    columnStyles: { 0: { cellWidth: 19 }, 1: { cellWidth: 15 }, 2: { cellWidth: 48 }, 3: { cellWidth: 38 } } });
  y = last();

  if (kind === 'final') {
    // ================================================================== desarrollo y conclusiones
    band('DESARROLLO DE LA AUDITORIA'); flow(textRows(rep.development || 'Sin redactar.'));
    band('CONCLUSIONES DE LA AUDITORIA');
    const conc: Row[] = textRows(rep.conclusions || '');
    for (const cf of rep.conformities.filter(c => c.text.trim())) {
      const blocks = textBlocks(cf.text);
      const first = blocks[0]?.kind === 'p' ? blocks.shift()!.text : '';
      conc.push([{ content: '', styles: { lineWidth: SIDE } }, { content: '', styles: { lineWidth: 0 }, _check: true } as RichCell,
        rich(`**${cf.section}**:${first ? ` ${first}` : ''}`, { justify: true, styles: { lineWidth: SIDE_R } })]);
      for (const b of blocks) conc.push([{ content: '', styles: { lineWidth: SIDE } }, { content: '', styles: { lineWidth: 0 } },
        rich(`${b.kind === 'li' ? '•  ' : ''}${b.text}`, { justify: true, styles: { lineWidth: SIDE_R, cellPadding: { top: 1.2, bottom: 1.2, left: 7, right: 3 } } })]);
    }
    flow(conc);

    // ================================================================== fortalezas (fortalecimiento)
    const strengths = rep.strengths.filter(s => s.text.trim() || s.area.trim());
    if (strengths.length) {
      band('FORTALEZAS');
      autoTable(doc, { ...base, startY: y, columnStyles: { 0: { cellWidth: 11, halign: 'center', valign: 'middle' } },
        body: strengths.map((s, i) => [two(i + 1), rich(`${s.area.trim() ? `**${s.area.trim().toUpperCase()}:** ` : ''}${s.text}`, { justify: true })]) });
      y = last();
    }

    // ================================================================== hallazgos por tipo
    const itemOf = new Map(r.items.map(i => [i.id, i]));
    const secOrder = new Map(r.sections.map((s, i) => [s.id, i]));
    const secTitle = new Map(r.sections.map(s => [s.id, s.title.trim()]));
    const sorted = (fs: Finding[]) => [...fs].sort((p, q) => {
      const ip = p.item_id ? itemOf.get(p.item_id) : undefined, iq = q.item_id ? itemOf.get(q.item_id) : undefined;
      const sp = ip ? secOrder.get(ip.section_id) ?? 99 : 99, sq = iq ? secOrder.get(iq.section_id) ?? 99 : 99;
      return sp - sq || (ip?.sort_order ?? 1e9) - (iq?.sort_order ?? 1e9) || (p.code ?? '').localeCompare(q.code ?? '');
    });
    const isNc = (f: Finding) => ['no_conformidad', 'nc_mayor', 'nc_menor'].includes(f.finding_type);
    const opm = sorted(r.findings.filter(f => f.finding_type === 'oportunidad_mejora'));
    const obs = sorted(r.findings.filter(f => f.finding_type === 'observacion'));
    const ncs = sorted(r.findings.filter(isNc));
    const numOf = new Map<string, string>();
    opm.forEach((f, i) => numOf.set(f.id, `Oportunidad de mejora N° ${i + 1}`));
    obs.forEach((f, i) => numOf.set(f.id, `Observación N° ${i + 1}`));
    ncs.forEach((f, i) => numOf.set(f.id, `No Conformidad N° ${i + 1}`));

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

    if (opm.length) {
      band('OPORTUNIDADES DE MEJORAS');
      autoTable(doc, { ...base, startY: y, head: [[{ content: '', styles: { cellWidth: 11 } }, { content: 'Descripción', styles: { halign: 'center' } }, { content: 'Fundamento', styles: { halign: 'center' } }]],
        columnStyles: { 0: { cellWidth: 11, halign: 'center', valign: 'middle' }, 2: { cellWidth: 52 } },
        body: opm.map((f, i) => [two(i + 1), rich(findingText(f) + photoNote(f), { justify: true }), rich(f.rationale ?? '', { justify: true })]) });
      y = last();
    }
    const register = (t: string, list: Finding[]) => {
      if (!list.length) return;
      band(t);
      const body: (RichCell | string)[][] = [];
      let cur: string | null = null;
      list.forEach((f, i) => {
        const it = f.item_id ? itemOf.get(f.item_id) : undefined;
        const st = it ? secTitle.get(it.section_id) ?? 'GENERAL' : 'GENERAL';
        if (st !== cur) { cur = st; body.push([{ content: pdfText(st.toUpperCase()), colSpan: 3, styles: { fillColor: GREY, fontStyle: 'bolditalic', halign: 'center', fontSize: 9, cellPadding: 0.9 } }]); }
        body.push([two(i + 1), rich(findingText(f) + photoNote(f), { justify: true }), rich(ref(f))]);
      });
      autoTable(doc, { ...base, startY: y, head: [['N', { content: 'DESCRIPCIÓN', styles: { halign: 'center' } }, { content: 'REFERENCIA / REQUISITO', styles: { halign: 'center' } }]],
        headStyles: { ...base.headStyles, fontSize: 9 },
        columnStyles: { 0: { cellWidth: 11, halign: 'center', valign: 'middle' }, 2: { cellWidth: 52 } }, body });
      y = last();
    };
    register('REGISTRO DE OBSERVACIONES', obs);
    register('REGISTRO DE NO CONFORMIDADES', ncs);

    // ================================================================== evaluación
    const cfg = isSituacionConfig(r.version.scoring_config) ? r.version.scoring_config : null;
    const sit = !!cfg;
    const finalVal = sit ? (r.official ? a.score : r.result.final) : (r.official ? a.compliance_pct : r.result.compliance_pct);
    const fband = r.official ? (a.result_band ?? null) : (r.result.band ?? null);
    const bandCell = (b: string | null | undefined) => { const st = bandStyle(b); return st ? { fillColor: rgb(st.bg), textColor: rgb(st.fg), fontStyle: 'bold' as const } : {}; };
    const evalH = 40 + r.sectionsResult.length * 6 + (cfg ? cfg.bands.length * 5 + 12 : 0);
    if (y + evalH + 22 > H - BOTTOM) { closeFrame(); newPage(); }
    band('EVALUACION DE CONTRATISTA POR LA CONSULTORA');
    const evalTop = y;
    flow(textRows(`En función de las evidencias analizadas y de la evaluación interna que realiza esta consultoría, el Contratista presenta el siguiente nivel de cumplimiento${r.official ? '' : ' (resultado preliminar: la auditoría todavía no se completó)'}:`), false);
    y += 3;
    const inner = { ...base, margin: { ...base.margin, left: L + 7 }, tableWidth: CW - 14, styles: { ...base.styles, fontSize: 7.6, cellPadding: 1.1, lineColor: [60, 60, 60] as RGB } };
    if (r.sectionsResult.length) {
      const raw = r.sectionsResult.reduce((t, x) => t + Number(x.raw || 0), 0);
      const target = r.sectionsResult.reduce((t, x) => t + Number(x.target || 0), 0);
      autoTable(doc, { ...inner, startY: y,
        head: [[sit ? 'REQUISITOS DEL SISTEMA DE GESTION' : 'SECCIÓN', 'Puntaje alcanzado', 'Puntaje objetivo', sit ? 'Evaluación' : 'Cumplimiento']],
        headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), fontStyle: 'bold', halign: 'center', lineWidth: 0, fontSize: 7.4 },
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 22, halign: 'center' } },
        body: r.sectionsResult.map(s => {
          const v = s.score === null || s.score === undefined ? null : Number(s.score);
          return [pdfText(String(s.title).trim().toUpperCase()), n(Number(s.raw), sit ? 0 : 2), n(Number(s.target), sit ? 0 : 2),
            sit ? { content: n(v), styles: bandCell(bandFor(v, cfg?.bands)) } : `${n(v, 1)} %`];
        }) });
      y = last() + 3;
      autoTable(doc, { ...inner, startY: y, columnStyles: { 0: { fontStyle: 'bold', fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk) }, 1: { cellWidth: 20, halign: 'center' }, 2: { cellWidth: 20, halign: 'center' }, 3: { cellWidth: 22, halign: 'center' } },
        body: [[pdfText(sit ? 'RESULTADO FINAL AUDITORIA A PROVEEDOR:' : 'CUMPLIMIENTO FINAL:'), n(raw, sit ? 0 : 2), n(target, sit ? 0 : 2),
          sit ? { content: n(finalVal), styles: bandCell(fband) } : { content: `${n(finalVal, 1)} %`, styles: { fontStyle: 'bold' } }]] });
      y = last() + 5;
    }
    if (cfg) {
      autoTable(doc, { ...inner, startY: y, margin: { ...inner.margin, left: L + 7 }, tableWidth: 112,
        styles: { ...inner.styles, halign: 'center', fontSize: 7 },
        columnStyles: { 0: { cellWidth: 38, valign: 'middle', fontStyle: 'bold' }, 1: { cellWidth: 26 } },
        body: cfg.bands.map((b, i) => [
          ...(i === 0 ? [{ content: 'CRITERIO DE EVALUACION', rowSpan: cfg.bands.length }] : []),
          pdfText(bandRange(b)), { content: pdfText(b.label), styles: bandCell(b.label) },
        ]) });
      y = last() + 3;
    }
    flow(textRows(rep.recommendation), false);
    // laterales del recuadro en la zona de las tablas internas
    doc.setDrawColor(...INK); doc.setLineWidth(LINE); doc.line(L, evalTop, L, y); doc.line(R, evalTop, R, y); mark(page(), evalTop, y);

    // ================================================================== anexo
    const hasActa = !!(a.closing_meeting_at || a.closing_attendees || a.closing_agreements || r.signatures.length);
    const generalPhotos = opts.includePhotos ? r.evidences.filter(e => pnum.has(e.id) && !e.response_id && !e.finding_id && !e.action_id) : [];
    if (hasActa || generalPhotos.length) {
      if (y + 22 + 50 > H - BOTTOM) { closeFrame(); newPage(); }
      band('ANEXO');
      if (hasActa) {
        const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-AR') : '—');
        const actaRows: [string, string][] = [];
        if (a.closing_meeting_at) actaRows.push(['Fecha', d(a.closing_meeting_at)]);
        if (a.closing_attendees?.trim()) actaRows.push(['Asistentes', pdfText(a.closing_attendees)]);
        if (a.closing_agreements?.trim()) actaRows.push(['Acuerdos y compromisos', pdfText(a.closing_agreements)]);
        autoTable(doc, { ...base, startY: y, columnStyles: actaRows.length ? { 0: { cellWidth: 48, fontStyle: 'bold' } } : {},
          body: [
            // (con una sola columna no se usa colSpan: autoTable no termina si una celda abarca columnas que no existen)
            [{ content: actaRows.length ? 'ACTA DE REUNIÓN DE CIERRE' : 'FIRMAS DE LA REUNIÓN DE CIERRE', colSpan: actaRows.length ? 2 : 1, styles: { fontStyle: 'bold', halign: 'center' } }],
            ...actaRows,
          ] });
        y = last();
        if (r.signatures.length) {
          const bw = 52, bh = 34, gap = 4;
          let x = L + 3; ensure(bh + 8); const top0 = y; y += 3;
          for (const s of r.signatures) {
            if (x + bw > R - 2) { x = L + 3; y += bh + 4; }
            if (y + bh > H - BOTTOM) { doc.line(L, top0, L, y); doc.line(R, top0, R, y); newPage(); x = L + 3; }
            try { doc.addImage(s.signature_png, 'PNG', x + 2, y + 1, bw - 4, 15); } catch { /* firma ilegible */ }
            doc.setDrawColor(120); doc.line(x + 4, y + 17, x + bw - 4, y + 17);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...INK);
            doc.text((doc.splitTextToSize(pdfText(s.signer_name), bw - 4) as string[])[0], x + bw / 2, y + 21, { align: 'center' });
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
            doc.text((doc.splitTextToSize(pdfText([LABELS.signerRole[s.signer_role], s.signer_position, s.signer_company].filter(Boolean).join(' · ')), bw - 4) as string[]).slice(0, 2), x + bw / 2, y + 25, { align: 'center' });
            doc.text(pdfText(LABELS.agreement[s.agreement]), x + bw / 2, y + 31, { align: 'center' });
            x += bw + gap;
          }
          y += bh + 3;
          doc.setDrawColor(...INK); doc.setLineWidth(LINE); doc.line(L, top0, L, y); doc.line(R, top0, R, y); mark(page(), top0, y);
        }
      }
      if (generalPhotos.length) await photoGroup('Fotos y documentos de la auditoría', generalPhotos);
    }

    // ================================================================== registro fotográfico
    if (opts.includePhotos) {
      const used = new Set(generalPhotos.map(e => e.id));
      const groups: { title: string; evs: Evidence[] }[] = [];
      for (const f of [...opm, ...obs, ...ncs]) {
        const evs = findingEvs(f).filter(e => !used.has(e.id)).sort((p, q) => pnum.get(p.id)! - pnum.get(q.id)!);
        evs.forEach(e => used.add(e.id));
        if (evs.length) groups.push({ title: numOf.get(f.id)!, evs });
      }
      for (const s of r.sections) for (const it of r.items.filter(x => x.section_id === s.id)) {
        const rid = respIdOf.get(it.id); if (!rid) continue;
        const evs = r.evidences.filter(e => pnum.has(e.id) && !used.has(e.id) && e.response_id === rid).sort((p, q) => pnum.get(p.id)! - pnum.get(q.id)!);
        evs.forEach(e => used.add(e.id));
        if (evs.length) groups.push({ title: `Requisito ${it.original_number ?? it.code ?? ''}`.trim(), evs });
      }
      const rest = r.evidences.filter(e => pnum.has(e.id) && !used.has(e.id));
      if (rest.length) groups.push({ title: 'Otras fotos', evs: rest });
      if (groups.length) {
        if (y + 22 + 8 + 58 + 8 > H - BOTTOM) { closeFrame(); newPage(); }   // la franja no queda sola al pie
        band('REGISTRO FOTOGRAFICO');
        for (const g of groups) await photoGroup(g.title, g.evs);
      }
    }

    // ================================================================== declaración del auditor
    ensure(70);
    band('DECLARACION DEL AUDITOR');
    flow(textRows(rep.statement), false);
    closeFrame();
    const sig = [...r.signatures].reverse().find(s => s.signer_role === 'auditor_lider');
    const sx = 122, sw = 58;
    y += 10;
    if (sig) { try { doc.addImage(sig.signature_png, 'PNG', sx, y, sw, 22); } catch { /* firma ilegible */ } }
    doc.setDrawColor(...INK); doc.setLineWidth(0.3); doc.line(sx, y + 23, sx + sw, y + 23);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...INK);
    doc.text(pdfText(sig?.signer_name ?? rep.lead_auditor ?? ''), sx + sw / 2, y + 28, { align: 'center' });
    doc.setFontSize(8); doc.text('Auditor responsable', sx + sw / 2, y + 32, { align: 'center' });
    y += 34;
  } else {
    closeFrame();
  }

  // ---------------------------------------------------------------- un grupo de fotos en un recuadro (título + hasta 3 por fila)
  async function photoGroup(t: string, evs: Evidence[]) {
    const pnum = photoNumbers(r.evidences);
    const pw = 52, ph = 58, gap = 4, titleH = 8, capH = 4;
    const perRow = 3;
    const rows: Evidence[][] = [];
    for (let i = 0; i < evs.length; i += perRow) rows.push(evs.slice(i, i + perRow));
    let first = true;
    for (const row of rows) {
      const need = (first ? titleH : 0) + ph + capH + 4;
      if (y + need > H - BOTTOM) { newPage(); first = true; }
      const top = y;
      if (first) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...INK);
        doc.text(pdfText(t), (L + R) / 2, y + 5.5, { align: 'center' }); y += titleH; first = false;
      }
      const totalW = row.length * pw + (row.length - 1) * gap;
      let x = (L + R) / 2 - totalW / 2;
      for (const e of row) {
        const url = await evidenceDataUrl(e.id, e.storage_path);
        if (url) {
          try {
            const pr = doc.getImageProperties(url);
            const kk = Math.min(pw / pr.width, ph / pr.height); const iw = pr.width * kk, ih = pr.height * kk;
            doc.addImage(url, url.startsWith('data:image/png') ? 'PNG' : 'JPEG', x + (pw - iw) / 2, y + (ph - ih) / 2, iw, ih, undefined, 'FAST');
          } catch { /* imagen ilegible */ }
        } else {
          doc.setDrawColor(200); doc.rect(x, y, pw, ph);
          doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(120); doc.text('Imagen no disponible', x + pw / 2, y + ph / 2, { align: 'center' });
        }
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(90);
        doc.text(pdfText(`Foto ${pnum.get(e.id) ?? ''}${e.caption ? ` · ${e.caption}` : ''}`).slice(0, 60), x + pw / 2, y + ph + 3, { align: 'center' });
        x += pw + gap;
      }
      y += ph + capH + 3;
      doc.setDrawColor(...INK); doc.setLineWidth(LINE);
      doc.line(L, top, L, y); doc.line(R, top, R, y); doc.line(L, y, R, y); mark(page(), top, y);
    }
  }

  // ---------------------------------------------------------------- marco, encabezado y número de página
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    const e = ext.get(p);
    doc.setDrawColor(...INK); doc.setLineWidth(LINE);
    if (e) { doc.line(L, e.min, R, e.min); doc.line(L, e.max, R, e.max); }
    doc.rect(L, HEAD_Y, CW, HEAD_H);
    doc.line(L + 46, HEAD_Y, L + 46, HEAD_Y + HEAD_H);
    const lw = 36, lh = lw / RS_LOGO_RATIO;
    try { doc.addImage(RS_LOGO_PNG, 'PNG', L + (46 - lw) / 2, HEAD_Y + (HEAD_H - lh) / 2, lw, lh); } catch { /* sin logo */ }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...INK);
    const tl = doc.splitTextToSize(pdfText(title), CW - 54) as string[];
    doc.text(tl, L + 46 + (CW - 46) / 2, HEAD_Y + HEAD_H / 2 + 1.5 - (tl.length - 1) * 2.6, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(110);
    doc.text(`Página ${p} de ${pages}`, R, H - 7, { align: 'right' });
    doc.text(pdfText(`${a.code ?? ''} · ${rep.contractor}`).slice(0, 90), L, H - 7);
  }
  return doc.output('blob');
}

export type { ReportData };
