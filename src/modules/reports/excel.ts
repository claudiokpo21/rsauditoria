import ExcelJS from 'exceljs';
import { db } from '../../db/db';
import { LABELS, type Action, type Audit, type Finding } from '../../types';
import { rcaText, type AuditReport } from './reportData';

const HEADER: Partial<ExcelJS.Fill> = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4D3A' } };
function sheet(wb: ExcelJS.Workbook, name: string, cols: { header: string; key: string; width: number }[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols;
  ws.getRow(1).eachCell(c => { c.fill = HEADER as ExcelJS.Fill; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.alignment = { vertical: 'middle', wrapText: true }; });
  return ws;
}
const wrap = (ws: ExcelJS.Worksheet) => ws.eachRow((r, i) => { if (i > 1) r.alignment = { vertical: 'top', wrapText: true }; });
const dt = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s) : null);

export async function buildAuditXlsx(r: AuditReport): Promise<Blob> {
  const wb = new ExcelJS.Workbook(); wb.creator = 'HSE Audit Manager'; wb.created = new Date();
  const a = r.audit;
  const sum = sheet(wb, 'Resumen', [{ header: 'Campo', key: 'k', width: 28 }, { header: 'Valor', key: 'v', width: 80 }]);
  sum.addRows([
    { k: 'Organización', v: r.orgName }, { k: 'Código', v: a.code ?? '' }, { k: 'Auditoría', v: a.title },
    { k: 'Plantilla', v: `${r.template?.name ?? ''} v${r.version.version_number}` }, { k: 'Tipo', v: LABELS.auditType[a.audit_type] },
    { k: 'Estado', v: LABELS.auditStatus[a.status] }, { k: 'Empresa', v: r.names.company(a.company_id) }, { k: 'Ubicación', v: r.names.location(a.location_id) },
    { k: 'Fecha', v: dt(a.scheduled_date) }, { k: 'Auditor líder', v: r.names.person(a.lead_auditor_id) }, { k: 'Alcance', v: a.scope ?? '' },
    { k: 'Resultado', v: r.official ? a.score : r.result.score }, { k: 'Máximo', v: r.official ? a.max_score : r.result.max_score },
    { k: 'Cumplimiento %', v: r.official ? a.compliance_pct : r.result.compliance_pct }, { k: 'Calificación', v: (r.official ? a.result_band : r.result.band) ?? '' },
    { k: 'Origen del resultado', v: r.official ? 'Oficial (servidor)' : 'Preliminar (auditoría no completada)' }, { k: 'Conclusiones', v: a.summary ?? '' },
  ]);
  wrap(sum);
  if (r.sectionsResult.length) {
    const s = sheet(wb, r.official ? 'Secciones (oficial)' : 'Secciones (preliminar)', [{ header: 'Sección', key: 's', width: 60 }, { header: 'Obtenido', key: 'r', width: 12 }, { header: 'Objetivo', key: 't', width: 12 }, { header: r.version.scoring_method === 'ponderado' ? '%' : 'Nota', key: 'n', width: 12 }, { header: 'Respondidos', key: 'a', width: 14 }, { header: 'N/A', key: 'na', width: 8 }]);
    for (const x of r.sectionsResult) s.addRow({ s: String(x.title).trim(), r: Number(x.raw), t: Number(x.target), n: x.score === null ? null : Number(Number(x.score).toFixed(4)), a: `${x.answered}/${x.items}`, na: x.na });
  }
  const ck = sheet(wb, 'Checklist', [
    { header: 'Sección', key: 'sec', width: 30 }, { header: 'N.º', key: 'num', width: 7 }, { header: 'Requisito', key: 'q', width: 70 }, { header: 'Proceso', key: 'p', width: 18 },
    { header: 'Respuesta', key: 'ans', width: 11 }, { header: 'Evidencias / comentarios', key: 'c', width: 60 }, { header: 'Fotos', key: 'ph', width: 8 }]);
  const photos = new Map<string, number>(); for (const e of r.evidences) if (e.response_id) photos.set(e.response_id, (photos.get(e.response_id) ?? 0) + 1);
  for (const s of r.sections) for (const i of r.items.filter(x => x.section_id === s.id)) {
    const resp = r.responses.get(i.id);
    ck.addRow({ sec: s.title.trim(), num: i.original_number ?? i.code ?? '', q: i.question, p: r.names.process(i.process_id), ans: r.optionLabel(resp?.answer), c: resp?.comment ?? resp?.text_value ?? '', ph: resp ? photos.get(resp.id) ?? 0 : 0 });
  }
  wrap(ck); ck.autoFilter = { from: 'A1', to: 'G1' };
  addFindingSheets(wb, r.findings, r.actions, id => r.names.company(id), id => r.names.person(id), undefined, new Map(r.items.map(i => [i.id, `${i.original_number ?? i.code ?? ''} ${i.question}`.trim()])));
  if (r.history?.length) {
    const h = sheet(wb, 'Historial', [{ header: 'Fecha', key: 'd', width: 20 }, { header: 'Usuario', key: 'u', width: 26 }, { header: 'Registro', key: 'r', width: 28 }, { header: 'Tabla', key: 't', width: 20 }, { header: 'Operación', key: 'o', width: 13 }, { header: 'Campo', key: 'c', width: 22 }, { header: 'Antes', key: 'b', width: 40 }, { header: 'Después', key: 'a', width: 40 }]);
    const v = (x: unknown) => x === null || x === undefined ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x);
    for (const x of r.history) {
      const fields = (x.changed_fields ?? []).filter(c => !['row_version', 'updated_at', 'client_updated_at'].includes(c));
      if (!fields.length) h.addRow({ d: new Date(x.changed_at), u: x.user_name, r: x.record_label, t: x.table_name, o: x.action });
      for (const c of fields) h.addRow({ d: new Date(x.changed_at), u: x.user_name, r: x.record_label, t: x.table_name, o: x.action, c, b: v(x.old_data?.[c]).slice(0, 500), a: v(x.new_data?.[c]).slice(0, 500) });
    }
    wrap(h); h.autoFilter = { from: 'A1', to: 'H1' };
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function addFindingSheets(wb: ExcelJS.Workbook, findings: Finding[], actions: Action[], company: (id?: string | null) => string, person: (id?: string | null) => string, auditCode?: (id: string) => string, itemText?: Map<string, string>) {
  const today = new Date().toISOString().slice(0, 10);
  const fs = sheet(wb, 'Hallazgos', [
    ...(auditCode ? [{ header: 'Auditoría', key: 'au', width: 16 }] : []),
    { header: 'Código', key: 'code', width: 15 }, { header: 'Título', key: 't', width: 45 }, { header: 'Pregunta', key: 'q', width: 45 }, { header: 'Requisito', key: 'rq', width: 30 },
    { header: 'Tipo', key: 'ty', width: 22 }, { header: 'Severidad', key: 'sv', width: 11 }, { header: 'Categoría', key: 'cat', width: 20 },
    { header: 'Estado', key: 'st', width: 15 }, { header: 'Empresa', key: 'co', width: 24 }, { header: 'Responsable', key: 'resp', width: 24 },
    { header: 'Detectado', key: 'de', width: 12 }, { header: 'Vence', key: 'du', width: 12 }, { header: 'Vencido', key: 'ov', width: 9 },
    { header: 'Recurrente', key: 'rec', width: 11 }, { header: 'Descripción objetiva', key: 'ds', width: 60 }, { header: 'Análisis de causa raíz', key: 'rc', width: 60 },
    { header: 'Cerrado', key: 'cl', width: 12 }, { header: 'Eficacia', key: 'ef', width: 11 }, { header: 'Verificación', key: 'vn', width: 40 }]);
  for (const f of findings) fs.addRow({ au: auditCode?.(f.audit_id), code: f.code ?? '', t: f.title, q: f.item_id ? itemText?.get(f.item_id) ?? '' : 'General', rq: f.requirement ?? f.legal_reference ?? '',
    ty: LABELS.findingType[f.finding_type], sv: LABELS.severity[f.severity], cat: f.category ? LABELS.category[f.category] : '', st: LABELS.findingStatus[f.status], co: company(f.company_id),
    resp: f.responsible_user_id ? person(f.responsible_user_id) : '', de: dt(f.detected_at), du: dt(f.due_date),
    ov: f.due_date && f.due_date < today && ['abierto', 'en_tratamiento'].includes(f.status) ? 'Sí' : '', rec: f.recurrence_count > 0 ? `${f.recurrence_count + 1}.ª vez` : '',
    ds: f.description ?? '', rc: rcaText(f.rca_method, f.rca_data, f.root_cause), cl: dt(f.closed_at),
    ef: f.effectiveness === 'eficaz' ? 'Eficaz' : f.effectiveness === 'no_eficaz' ? 'No eficaz' : '', vn: f.verification_notes ?? '' });
  wrap(fs); fs.autoFilter = { from: 'A1', to: { row: 1, column: fs.columnCount } };
  const fc = new Map(findings.map(f => [f.id, f.code ?? f.title]));
  const as = sheet(wb, 'Plan de acción', [{ header: 'Hallazgo', key: 'f', width: 16 }, { header: 'Acción', key: 'd', width: 55 }, { header: 'Tipo', key: 'ty', width: 13 }, { header: 'Responsable', key: 'r', width: 26 }, { header: 'Empresa', key: 'co', width: 22 }, { header: 'Vence', key: 'du', width: 12 }, { header: 'Estado', key: 'st', width: 13 }, { header: 'Vencida', key: 'ov', width: 9 }, { header: 'Completada', key: 'cp', width: 12 }, { header: 'Criterio de eficacia', key: 'cr', width: 40 }, { header: 'Eficacia', key: 'ef', width: 11 }, { header: 'Verificación', key: 'vn', width: 36 }, { header: 'Avance', key: 'pg', width: 40 }]);
  for (const x of actions) as.addRow({ f: fc.get(x.finding_id) ?? '', d: x.description, ty: LABELS.actionType[x.action_type], r: x.responsible_user_id ? person(x.responsible_user_id) : x.responsible_name ?? '', co: company(x.responsible_company_id), du: dt(x.due_date), st: LABELS.actionStatus[x.status],
    ov: ['pendiente', 'en_curso'].includes(x.status) && x.due_date < today ? 'Sí' : '', cp: dt(x.completed_at), cr: x.effectiveness_criteria ?? '',
    ef: x.effectiveness === 'eficaz' ? 'Eficaz' : x.effectiveness === 'no_eficaz' ? 'No eficaz' : '', vn: x.verification_notes ?? '', pg: x.progress_notes ?? '' });
  wrap(as); as.autoFilter = { from: 'A1', to: { row: 1, column: as.columnCount } };
}

/** Exportación consolidada de la organización (lo que hay en el dispositivo). */
export async function buildOrgXlsx(orgId: string, orgName: string): Promise<Blob> {
  const live = <T extends { deleted_at?: string | null }>(x: T[]) => x.filter(r => !r.deleted_at);
  const [audits, findings, actions, companies, locations, profiles, versions, templates] = await Promise.all([
    db.hse_audits.where('organization_id').equals(orgId).toArray(), db.hse_findings.where('organization_id').equals(orgId).toArray(),
    db.hse_actions.where('organization_id').equals(orgId).toArray(), db.hse_companies.where('organization_id').equals(orgId).toArray(),
    db.hse_locations.where('organization_id').equals(orgId).toArray(), db.profiles.toArray(),
    db.hse_template_versions.where('organization_id').equals(orgId).toArray(), db.hse_templates.where('organization_id').equals(orgId).toArray()]);
  const cn = new Map(companies.map(c => [c.id, c.name])), ln = new Map(locations.map(l => [l.id, l.name])), pn = new Map(profiles.map(p => [p.id, p.full_name || p.email]));
  const tn = new Map(templates.map(t => [t.id, t.name])); const vn = new Map(versions.map(v => [v.id, `${tn.get(v.template_id) ?? ''} v${v.version_number}`]));
  const wb = new ExcelJS.Workbook(); wb.creator = 'HSE Audit Manager'; wb.title = `HSE ${orgName}`;
  const au = sheet(wb, 'Auditorías', [{ header: 'Código', key: 'c', width: 15 }, { header: 'Título', key: 't', width: 45 }, { header: 'Plantilla', key: 'p', width: 36 }, { header: 'Empresa', key: 'co', width: 24 }, { header: 'Ubicación', key: 'l', width: 22 }, { header: 'Fecha', key: 'd', width: 12 }, { header: 'Estado', key: 's', width: 13 }, { header: 'Resultado', key: 'r', width: 11 }, { header: 'Máximo', key: 'm', width: 10 }, { header: 'Cumplimiento %', key: 'pc', width: 14 }, { header: 'Calificación', key: 'b', width: 13 }, { header: 'Auditor', key: 'a', width: 24 }]);
  for (const a of live(audits as Audit[])) au.addRow({ c: a.code ?? '', t: a.title, p: vn.get(a.template_version_id), co: cn.get(a.company_id ?? '') ?? '', l: ln.get(a.location_id ?? '') ?? '', d: dt(a.scheduled_date), s: LABELS.auditStatus[a.status], r: a.score, m: a.max_score, pc: a.compliance_pct, b: a.result_band ?? '', a: pn.get(a.lead_auditor_id ?? '') ?? '' });
  au.autoFilter = { from: 'A1', to: 'L1' };
  const acode = new Map(audits.map(a => [a.id, a.code ?? a.title]));
  addFindingSheets(wb, live(findings), live(actions), id => (id ? cn.get(id) ?? '' : ''), id => (id ? pn.get(id) ?? '' : ''), id => acode.get(id) ?? '');
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function downloadBlob(blob: Blob, name: string) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
