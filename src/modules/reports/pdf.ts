import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LABELS } from '../../types';
import { evidenceDataUrl } from '../evidences/evidenceService';
import { isSituacionConfig } from '../../scoring/engine';
import { rcaText, type AuditReport } from './reportData';

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
  const brand: [number, number, number] = [31, 77, 58];
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

  // ---- resultado
  const res = r.result;
  const finalTxt = sit ? `${n(r.official ? a.score : res.final)} / ${n(res.max_score, 0)}  ·  ${r.official ? a.result_band ?? res.band : res.band ?? '—'}`
    : `${n(r.official ? a.compliance_pct : res.compliance_pct, 1)} %  (${n(r.official ? a.score : res.score)} de ${n(r.official ? a.max_score : res.max_score)})`;
  let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Resultado', 14, y);
  doc.setFontSize(18); doc.setTextColor(...brand); doc.text(pdfText(finalTxt), 14, y + 9); doc.setTextColor(30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text(pdfText(r.official ? 'Resultado oficial calculado por el servidor al completar la auditoría.' : 'Resultado preliminar (auditoría no completada).'), 14, y + 14);
  y += 18;
  if (r.sectionsResult.length) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(pdfText(`Resultados por sección${r.official ? ' (oficiales)' : ' (vista previa)'}`), 14, y + 2); y += 4;
    autoTable(doc, {
      startY: y, head: [['Sección', 'Obtenido', 'Objetivo', sit ? 'Nota' : '%', 'Respondidos']], headStyles: { fillColor: brand },
      styles: { fontSize: 8.5 }, columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
      body: r.sectionsResult.map(s => [pdfText(String(s.title).trim()), n(Number(s.raw), 0), n(Number(s.target), 0), n(s.score === null ? null : Number(s.score)), `${s.answered}/${s.items}`]),
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }
  if (sit && isSituacionConfig(r.version.scoring_config)) {
    const c = r.version.scoring_config;
    doc.setFontSize(7.5); doc.setTextColor(90);
    const lines = doc.splitTextToSize(pdfText(`Metodología (v${r.version.version_number}): ${c.options.map(o => `${o.label}=${o.points ?? '-'}`).join(', ')}. ${c.section_formula}. Final: ${c.final_formula}. Criterio: ${c.bands.map(b => `${b.label} ${b.min ?? 0}–${b.max}`).join('; ')}.`), W - 28);
    doc.text(lines, 14, y + 3); y += lines.length * 3.4 + 4; doc.setTextColor(30);
  }
  if (a.summary) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Conclusiones', 14, y + 4);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    const lines = doc.splitTextToSize(pdfText(a.summary), W - 28); doc.text(lines, 14, y + 10); y += lines.length * 4 + 12;
  }

  // ---- checklist
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text('Checklist', 14, 16);
  const body: (string | { content: string; colSpan: number; styles: Record<string, unknown> })[][] = [];
  for (const s of r.sections) {
    body.push([{ content: pdfText(s.title.trim()), colSpan: 5, styles: { fillColor: [227, 238, 232], fontStyle: 'bold' } }]);
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
    doc.text(pdfText(`${a.code ?? ''} · Generado ${new Date().toLocaleString('es-AR')} · HSE Audit Manager`), 14, 290);
    doc.text(`${p} / ${pages}`, W - 14, 290, { align: 'right' });
  }
  return doc.output('blob');
}
