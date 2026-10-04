import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LABELS } from '../../types';
import { evidenceDataUrl } from '../evidences/evidenceService';
import { isSituacionConfig } from '../../scoring/engine';
import { rcaText, type AuditReport } from './reportData';
import { SHEET, bandFor, bandRange, bandStyle } from '../../scoring/bands';

type RGB = [number, number, number];
export const rgb = (hex: string): RGB => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** Estilo de celda con el color de la banda (o undefined si no hay banda). */
/** Celdas "Anterior" y "Variación" (▲ mejora en verde, ▼ empeora en rojo). */
function prevCells(now: number | null, before: number | null | undefined) {
  if (before === null || before === undefined) return ['—', '—'];
  if (now === null) return [n(before), '—'];
  const dd = Math.round((now - before) * 100) / 100;
  return [n(before), { content: `${dd > 0 ? '+' : ''}${n(dd)}`, styles: { textColor: dd > 0 ? rgb('#2f7d32') : dd < 0 ? rgb('#b42318') : rgb('#67747d'), fontStyle: 'bold' as const } }];
}
export const bandCell = (band: string | null | undefined) => { const st = bandStyle(band); return st ? { fillColor: rgb(st.bg), textColor: rgb(st.fg), fontStyle: 'bold' as const } : undefined; };

// Las fuentes estándar de PDF usan Windows-1252: se normalizan los caracteres fuera de ese juego.
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
function pdfText(s?: string | null): string {
  return (s ?? '').replace(//g, '•').replace(/≤/g, '<=').replace(/≥/g, '>=').replace(/×/g, 'x')
    .split('').filter(ch => ch.charCodeAt(0) < 256 || CP1252_EXTRA.includes(ch) || ch === '\n').join('');
}
const d = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('es-AR') : '—');
const n = (v?: number | null, dec = 2) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec }));

export async function buildAuditPdf(r: AuditReport, opts: { includePhotos: boolean }): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const brand: RGB = rgb('#1c2b36');
  const a = r.audit;
  const sit = isSituacionConfig(r.version.scoring_config);

  // ---- encabezado
  doc.setFillColor(...brand); doc.rect(0, 0, W, 24, 'F');
  doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text(pdfText('Informe de auditoría'), 14, 11);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(pdfText(`${r.orgName} · ${a.code ?? 'sin código'} · ${r.template?.name ?? ''} v${r.version.version_number}`), 14, 18);
  doc.setTextColor(30);

  autoTable(doc, {
    startY: 30, theme: 'plain', styles: { fontSize: 9, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 } },
    body: [
      ['Auditoría', pdfText(a.title)], ['Tipo', LABELS.auditType[a.audit_type]], ['Estado', LABELS.auditStatus[a.status]],
      ['Empresa', pdfText(r.names.company(a.company_id))], ['Ubicación', pdfText(r.names.location(a.location_id))],
      ['Fecha', d(a.scheduled_date)], ['Auditor líder', pdfText(r.names.person(a.lead_auditor_id))], ['Equipo', pdfText(a.audit_team ?? '—')],
      ['Alcance', pdfText(a.scope ?? '—')],
    ],
  });

  // ---- resultado (con los colores de la planilla H&P)
  const res = r.result;
  const cfg = isSituacionConfig(r.version.scoring_config) ? r.version.scoring_config : null;
  const finalVal = sit ? (r.official ? a.score : res.final) : (r.official ? a.compliance_pct : res.compliance_pct);
  const band = r.official ? (a.result_band ?? null) : (res.band ?? null);
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Resultado', 14, y);
  const st = bandStyle(band);
  doc.setFillColor(...(st ? rgb(st.bg) : rgb('#eef1f3'))); doc.setDrawColor(...(st ? rgb(st.border) : rgb('#c3ccd2')));
  doc.roundedRect(14, y + 3, 52, 20, 2, 2, 'FD');
  doc.setTextColor(...(st ? rgb(st.fg) : rgb('#17232c')));
  doc.setFontSize(20); doc.text(pdfText(sit ? n(finalVal) : `${n(finalVal, 1)} %`), 40, y + 13.5, { align: 'center' });
  doc.setFontSize(10); doc.text(pdfText(band ?? (sit ? 'Sin resultado' : 'Cumplimiento')), 40, y + 19.5, { align: 'center' });
  doc.setTextColor(30); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(doc.splitTextToSize(pdfText(r.official ? 'Resultado oficial calculado por el servidor al completar la auditoría, con la metodología de la versión de la plantilla.' : 'Resultado preliminar (auditoría no completada).'), 70), 72, y + 8);
  if (!sit) doc.text(pdfText(`Puntaje: ${n(r.official ? a.score : res.score)} de ${n(r.official ? a.max_score : res.max_score)}`), 72, y + 18);
  if (cfg) {
    autoTable(doc, { startY: y + 3, margin: { left: 150 }, tableWidth: 46, theme: 'grid', styles: { fontSize: 7, cellPadding: 0.9, halign: 'center', lineColor: [160, 160, 160] },
      head: [[{ content: 'Criterio de evaluación', colSpan: 2 }]], headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk) },
      body: cfg.bands.map(b => [pdfText(bandRange(b)), { content: pdfText(b.label), styles: bandCell(b.label) ?? {} }]) });
  }
  y += 28;
  if (r.sectionsResult.length) {
    const raw = r.sectionsResult.reduce((t, x) => t + Number(x.raw || 0), 0);
    const target = r.sectionsResult.reduce((t, x) => t + Number(x.target || 0), 0);
    autoTable(doc, {
      startY: y, theme: 'grid',
      head: [[sit ? 'Requisitos del sistema de gestión' : 'Sección', 'Puntaje alcanzado', 'Puntaje objetivo', sit ? 'Evaluación' : 'Cumplimiento', ...(r.previous ? ['Anterior', 'Variación'] : [])]],
      headStyles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), fontStyle: 'bold', halign: 'center', lineColor: [150, 150, 150] },
      styles: { fontSize: 8.5, lineColor: [170, 170, 170] }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: r.previous ? 70 : 98 }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'center' }, 5: { halign: 'center' } },
      body: [
        ...r.sectionsResult.map(s => {
          const v = s.score === null || s.score === undefined ? null : Number(s.score);
          return [pdfText(sit ? String(s.title).trim().toUpperCase() : String(s.title).trim()), n(Number(s.raw), sit ? 0 : 2), n(Number(s.target), sit ? 0 : 2),
            sit ? { content: n(v), styles: bandCell(bandFor(v, cfg?.bands)) ?? {} } : `${n(v, 1)} %`,
            ...(r.previous ? prevCells(v, r.prevOf(String(s.title))) : [])];
        }),
        [{ content: pdfText(sit ? 'RESULTADO FINAL' : 'TOTAL'), styles: { fillColor: rgb(SHEET.total), textColor: rgb(SHEET.totalInk), fontStyle: 'bold' } },
         { content: n(raw, sit ? 0 : 2), styles: { fillColor: [255, 255, 255], fontStyle: 'bold' } },
         { content: n(target, sit ? 0 : 2), styles: { fillColor: [255, 255, 255], fontStyle: 'bold' } },
         sit ? { content: n(finalVal), styles: { ...(bandCell(band) ?? {}), fontStyle: 'bold' } } : { content: `${n(finalVal, 1)} %`, styles: { fontStyle: 'bold' } },
         ...(r.previous ? prevCells(finalVal === null || finalVal === undefined ? null : Number(finalVal), r.previous.final) : [])],
      ],
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
    doc.setFontSize(7.5); doc.setTextColor(90);
    doc.text(pdfText(`Resultados por sección ${r.official ? 'oficiales' : '(vista previa)'}.${r.previous ? ` Comparado con ${r.previous.audit.code ?? r.previous.audit.title} del ${d(r.previous.audit.scheduled_date)}${r.previous.band ? ` (${r.previous.band})` : ''}: misma empresa y plantilla, resultados oficiales.` : ''}`), 14, y + 1); doc.setTextColor(30); y += 3;
  }
  if (cfg) {
    const c = cfg;
    doc.setFontSize(7.5); doc.setTextColor(90);
    const lines = doc.splitTextToSize(pdfText(`Metodología (v${r.version.version_number}): ${c.options.map(o => `${o.label}=${o.points ?? '-'}`).join(', ')}. ${c.section_formula}. Final: ${c.final_formula}.`), W - 28);
    doc.text(lines, 14, y + 3); y += lines.length * 3.4 + 4; doc.setTextColor(30);
  }
  if (a.summary) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Conclusiones', 14, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(pdfText(a.summary), W - 28); doc.text(lines, 14, y + 10); y += lines.length * 4 + 12;
  }

  // ---- acta de reunión de cierre y firmas
  if (a.closing_meeting_at || a.closing_attendees || a.closing_agreements || r.signatures.length) {
    if (y > 200) { doc.addPage(); y = 10; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Acta de reunión de cierre', 14, y + 6);
    autoTable(doc, { startY: y + 8, theme: 'plain', styles: { fontSize: 8.5, cellPadding: 1.2 }, columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 } },
      body: [['Fecha', d(a.closing_meeting_at)], ['Asistentes', pdfText(a.closing_attendees ?? '—')], ['Acuerdos y compromisos', pdfText(a.closing_agreements ?? '—')]] });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3;
    const bw = 58, bh = 40; let x = 14;
    for (const s of r.signatures) {
      if (x + bw > W - 10) { x = 14; y += bh + 6; }
      if (y + bh > doc.internal.pageSize.getHeight() - 14) { doc.addPage(); y = 14; x = 14; }
      doc.setDrawColor(190); doc.roundedRect(x, y, bw, bh, 1.5, 1.5, 'S');
      try { doc.addImage(s.signature_png, 'PNG', x + 2, y + 1.5, bw - 4, 17); } catch { /* firma ilegible: se omite la imagen */ }
      doc.setDrawColor(150); doc.line(x + 4, y + 19.5, x + bw - 4, y + 19.5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(30);
      doc.text(doc.splitTextToSize(pdfText(s.signer_name), bw - 6)[0], x + 3, y + 23.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); doc.setTextColor(70);
      const lines = doc.splitTextToSize(pdfText([LABELS.signerRole[s.signer_role], s.signer_position, s.signer_company].filter(Boolean).join(' · ')), bw - 6).slice(0, 2);
      doc.text(lines, x + 3, y + 27);
      doc.text(pdfText(`${new Date(s.signed_at).toLocaleString('es-AR')} · ${LABELS.agreement[s.agreement]}`), x + 3, y + 33.5);
      if (s.observations) doc.text(doc.splitTextToSize(pdfText(`Obs.: ${s.observations}`), bw - 6).slice(0, 1), x + 3, y + 37);
      x += bw + 4;
    }
    doc.setTextColor(30);
  }

  // ---- checklist
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Checklist', 14, 16);
  const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
  for (const s of r.sections) {
    body.push([{ content: pdfText(s.title.trim()), colSpan: 5, styles: { fillColor: rgb(SHEET.header), textColor: rgb(SHEET.headerInk), fontStyle: 'bold' } }]);
    for (const i of r.items.filter(x => x.section_id === s.id)) {
      const resp = r.responses.get(i.id);
      body.push([pdfText(i.original_number ?? i.code ?? ''), pdfText(i.question), pdfText(r.names.process(i.process_id)), r.optionLabel(resp?.answer),
        pdfText(resp?.comment ?? resp?.text_value ?? (resp?.numeric_value !== null && resp?.numeric_value !== undefined ? String(resp.numeric_value) : ''))]);
    }
  }
  autoTable(doc, { startY: 20, head: [['N.º', 'Requisito', 'Proceso', 'Resp.', 'Evidencias / comentarios']], headStyles: { fillColor: brand }, styles: { fontSize: 7.5, cellPadding: 1.5, valign: 'top' },
    columnStyles: { 0: { cellWidth: 10 }, 1: { cellWidth: 78 }, 2: { cellWidth: 22 }, 3: { cellWidth: 14, fontStyle: 'bold' } }, body });

  // ---- hallazgos y acciones
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Hallazgos y plan de acción', 14, 16);
  if (!r.findings.length) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text('Sin hallazgos registrados.', 14, 24); }
  let fy = 20;
  const itemOf = new Map(r.items.map(i => [i.id, i]));
  for (const f of r.findings) {
    const it = f.item_id ? itemOf.get(f.item_id) : undefined;
    if (fy > 250) { doc.addPage(); fy = 16; }
    autoTable(doc, { startY: fy, theme: 'grid', styles: { fontSize: 8, valign: 'top' }, headStyles: { fillColor: brand },
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
      columnStyles: { 0: { cellWidth: 38, fontStyle: 'bold' } } });
    fy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 1;
    const acts = r.actions.filter(x => x.finding_id === f.id);
    if (acts.length) {
      autoTable(doc, { startY: fy, styles: { fontSize: 7.5, valign: 'top' }, headStyles: { fillColor: [120, 120, 120] },
        head: [['Plan de acción', 'Tipo', 'Responsable', 'Vence', 'Estado', 'Eficacia']],
        body: acts.map(x => [pdfText(`${x.description}${x.effectiveness_criteria ? `\nCriterio de eficacia: ${x.effectiveness_criteria}` : ''}${x.progress_notes ? `\nAvance: ${x.progress_notes}` : ''}`),
          LABELS.actionType[x.action_type], pdfText(x.responsible_user_id ? r.names.person(x.responsible_user_id) : x.responsible_name ?? r.names.company(x.responsible_company_id)), d(x.due_date), LABELS.actionStatus[x.status],
          x.effectiveness === 'eficaz' ? 'Eficaz' : x.effectiveness === 'no_eficaz' ? 'No eficaz' : '—']),
        columnStyles: { 0: { cellWidth: 74 } } });
      fy = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
    }
    fy += 6;
  }

  // ---- fotografías
  if (opts.includePhotos) {
    const imgs = r.evidences.filter(e => e.mime_type.startsWith('image/'));
    if (imgs.length) {
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Registro fotográfico', 14, 16);
      let x = 14, py = 22; const w = 58, h = 44;
      const itemById = new Map(r.items.map(i => [i.id, i]));
      const respById = new Map([...r.responses.values()].map(rr => [rr.id, rr]));
      for (const e of imgs) {
        const url = await evidenceDataUrl(e.id, e.storage_path);
        if (!url) continue;
        if (py + h + 10 > doc.internal.pageSize.getHeight() - 10) { doc.addPage(); py = 16; }
        try { doc.addImage(url, 'JPEG', x, py, w, h, undefined, 'FAST'); } catch { continue; }
        const it = e.response_id ? itemById.get(respById.get(e.response_id)?.item_id ?? '') : undefined;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
        doc.text(doc.splitTextToSize(pdfText(`${it ? `Req. ${it.original_number ?? it.code ?? ''} · ` : ''}${e.caption ?? ''} ${e.taken_at ? d(e.taken_at) : ''}`), w), x, py + h + 3);
        x += w + 4; if (x + w > W - 10) { x = 14; py += h + 12; }
      }
    }
  }

  // ---- historial de cambios (si se obtuvo del servidor)
  if (r.history?.length) {
    doc.addPage();
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Historial de cambios', 14, 16);
    autoTable(doc, { startY: 20, styles: { fontSize: 6.8, valign: 'top' }, headStyles: { fillColor: brand },
      head: [['Fecha', 'Usuario', 'Registro', 'Operación', 'Campos']],
      body: r.history.map(h => [new Date(h.changed_at).toLocaleString('es-AR'), pdfText(h.user_name), pdfText(h.record_label),
        ({ INSERT: 'Alta', UPDATE: 'Modificación', DELETE: 'Eliminación', SOFT_DELETE: 'Eliminación' } as Record<string, string>)[h.action] ?? h.action,
        pdfText((h.changed_fields ?? []).filter(c => !['row_version', 'updated_at', 'client_updated_at'].includes(c)).map(c => `${c}: ${String(h.old_data?.[c] ?? '—').slice(0, 40)} → ${String(h.new_data?.[c] ?? '—').slice(0, 40)}`).join('\n'))]),
      columnStyles: { 0: { cellWidth: 26 }, 1: { cellWidth: 30 }, 2: { cellWidth: 30 }, 3: { cellWidth: 20 } } });
  }

  // ---- pie
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); doc.setTextColor(120);
    doc.text(pdfText(`${a.code ?? ''} · Generado ${new Date().toLocaleString('es-AR')} · Auditorías HSE`), 14, 290);
    doc.text(`${p} / ${pages}`, W - 14, 290, { align: 'right' });
  }
  return doc.output('blob');
}
