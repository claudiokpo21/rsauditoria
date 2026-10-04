/**
 * Analizador de la "Lista de verificación de Auditoría a Segundas Partes" (formato H&P).
 *
 * Funciona en el navegador y en Node (mismo código para la UI de importación y
 * para el script de reporte). No inventa reglas: todo lo que construye sale de
 * celdas, fórmulas, formato condicional o listas del libro, y lo que no puede
 * determinarse con certeza se registra como incidencia para revisión manual.
 *
 * Separación plantilla / ejecución:
 *   - Plantilla: categorías (col. B), numeración (D), requisito (E), proceso (G),
 *     columnas de situación (I..L + H), fórmulas de resultado (F/N/O), criterio de evaluación.
 *   - Ejecución (EXCLUIDA): encabezado (empresa, contratista, fecha, personas),
 *     evidencias/comentarios (F), descripción de hallazgos (M) y valores de situación.
 *     Estos últimos sólo se usan, como códigos, en un caso de validación aislado
 *     para comprobar que el motor reproduce los resultados del Excel.
 */
import ExcelJS from 'exceljs';
import { evaluate, type SituacionConfig, type Band, type EvalResult } from '../../../scoring/engine';

// ---------------------------------------------------------------- tipos
export type Severity = 'info' | 'advertencia' | 'bloqueante';
export interface ImportIssue {
  issue_type: string; severity: Severity; source_ref?: string; message: string;
  item_key?: string; details?: Record<string, unknown>;
}
export interface FormulaInfo { sheet: string; cell: string; formula: string; result: unknown; role: string }
export interface SheetDiagnosis {
  name: string; dimension: string; rows: number; columns: number; merges: number;
  formulas: number; conditionalFormats: number; dataValidations: number; role: string; notes: string[];
}
export interface ParsedItem {
  key: string; row: number; original_number: string | null; code: string | null;
  question: string; process: string | null; source_ref: string; sort_order: number;
  response_type: 'situacion'; review_flags: string[];
}
export interface ParsedSection {
  key: string; row: number; title: string; sort_order: number; source_ref: string;
  items: ParsedItem[]; totalsRow: number; resultCell: string; scoreCell: string;
}
export interface CellMapEntry { source: string; target: string; rule: string; imported: boolean }
export interface ValidationCase {
  name: string; source_ref: string;
  answers: Record<string, string>;                         // item_key -> código
  expected: { sections: Record<string, { raw: number; target: number; score: number }>; final: number };
}
export interface ParseResult {
  fileName: string; sha256: string;
  diagnosis: SheetDiagnosis[];
  formulas: FormulaInfo[];
  cellMap: CellMapEntry[];
  sections: ParsedSection[];
  processes: string[];
  scoringConfig: SituacionConfig;
  issues: ImportIssue[];
  validationCase: ValidationCase | null;
  comparison: {
    local: EvalResult | null;
    rows: { label: string; expected: number | null; computed: number | null; diff: number | null; ok: boolean }[];
    allMatch: boolean;
  };
  alternativeFinal: { label: string; value: number; source: string } | null;
  excludedExecutionData: { field: string; cells: string[]; count: number }[];
  stats: Record<string, number>;
  template: { name: string; category: 'csms'; description: string };
}

// ---------------------------------------------------------------- utilidades
const colLetter = (n: number) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const colNumber = (l: string) => l.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0);
const parseAddr = (a: string) => { const m = /^\$?([A-Z]+)\$?(\d+)$/.exec(a.toUpperCase()); if (!m) throw new Error('Celda inválida ' + a); return { col: colNumber(m[1]), row: Number(m[2]) }; };
const ref = (sheet: string, addr: string) => `'${sheet}'!${addr}`;

type CellVal = ExcelJS.CellValue;
function formulaOf(v: CellVal): string | null {
  if (v && typeof v === 'object') {
    const o = v as { formula?: string; sharedFormula?: string };
    if (o.formula) return o.formula;
    if (o.sharedFormula) return o.sharedFormula;
  }
  return null;
}
function resultOf(v: CellVal): unknown {
  if (v && typeof v === 'object' && ('formula' in (v as object) || 'sharedFormula' in (v as object))) {
    return (v as { result?: unknown }).result ?? null;
  }
  return v;
}
/** Texto exacto de la celda (sin recortar ni normalizar). */
function textOf(v: CellVal): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  const o = v as { richText?: { text: string }[]; text?: string; result?: unknown };
  if (o.richText) return o.richText.map(r => r.text).join('');
  if (typeof o.text === 'string') return o.text;
  if ('result' in o && o.result !== undefined && o.result !== null) return String(o.result);
  return null;
}
const numOf = (v: CellVal): number | null => {
  const r = resultOf(v);
  if (typeof r === 'number') return r;
  if (typeof r === 'string' && r.trim() !== '' && !Number.isNaN(Number(r))) return Number(r);
  return null;
};
/** Las celdas "esclavas" de un rango combinado devuelven el valor de la maestra en ExcelJS: se ignoran. */
const isSlave = (c: ExcelJS.Cell) => c.isMerged && c.master.address !== c.address;
const norm = (s: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await globalThis.crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Lee validaciones de datos de la extensión x14 (listas que apuntan a otra hoja), que ExcelJS no interpreta. */
async function readX14Validations(buf: ArrayBuffer): Promise<{ sheetIndex: number; formula: string; sqref: string }[]> {
  try {
    // ExcelJS incluye JSZip; se carga de forma diferida para no inflar el bundle principal.
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(buf);
    const out: { sheetIndex: number; formula: string; sqref: string }[] = [];
    for (const name of Object.keys(zip.files)) {
      const m = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(name);
      if (!m) continue;
      const xml = await zip.files[name].async('string');
      const re = /<x14:dataValidation\b[^>]*type="list"[^>]*>[\s\S]*?<xm:f>([^<]+)<\/xm:f>[\s\S]*?<xm:sqref>([^<]+)<\/xm:sqref>/g;
      let r: RegExpExecArray | null;
      while ((r = re.exec(xml))) out.push({ sheetIndex: Number(m[1]), formula: r[1], sqref: r[2] });
    }
    return out;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- análisis principal
export async function parseHpChecklist(buf: ArrayBuffer, fileName: string): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const sha256 = await sha256Hex(buf);
  const issues: ImportIssue[] = [];
  const formulas: FormulaInfo[] = [];
  const cellMap: CellMapEntry[] = [];
  const diagnosis: SheetDiagnosis[] = [];
  const x14 = await readX14Validations(buf);

  // --- 1. Diagnóstico de todas las hojas y fórmulas
  wb.worksheets.forEach((ws, idx) => {
    let nf = 0;
    ws.eachRow({ includeEmpty: false }, row => row.eachCell({ includeEmpty: false }, cell => {
      if (isSlave(cell)) return;
      const f = formulaOf(cell.value);
      if (f) { nf++; formulas.push({ sheet: ws.name, cell: cell.address, formula: '=' + f, result: resultOf(cell.value), role: '' }); }
    }));
    const merges = ((ws.model as unknown as { merges?: string[] }).merges ?? []);
    const cf = ((ws as unknown as { conditionalFormattings?: unknown[] }).conditionalFormattings ?? []);
    const dvBuiltin = Object.keys(((ws as unknown as { dataValidations?: { model?: Record<string, unknown> } }).dataValidations?.model) ?? {}).length;
    diagnosis.push({
      name: ws.name, dimension: ws.dimensions ? String(ws.dimensions) : '', rows: ws.actualRowCount, columns: ws.actualColumnCount,
      merges: merges.length, formulas: nf, conditionalFormats: cf.length,
      dataValidations: dvBuiltin + x14.filter(v => v.sheetIndex === idx + 1).length, role: '', notes: [],
    });
  });

  // --- 2. Localizar la hoja de checklist y su encabezado
  const ws = wb.worksheets.find(w => {
    let found = false;
    w.eachRow((row) => { row.eachCell(c => { if (!isSlave(c) && norm(textOf(c.value)).includes('REQUISITOS CSMS A AUDITAR')) found = true; }); });
    return found;
  });
  if (!ws) throw new Error('No se encontró la hoja con el encabezado "REQUISITOS CSMS A AUDITAR".');
  const S = ws.name;
  diagnosis.find(d => d.name === S)!.role = 'Checklist (plantilla + ejecución de ejemplo)';

  let headerRow = 0; const col: Record<string, number> = {};
  ws.eachRow((row, r) => {
    if (headerRow) return;
    row.eachCell((c, cn) => {
      if (isSlave(c)) return;
      const t = norm(textOf(c.value));
      if (t === 'REQUISITOS CSMS A AUDITAR') { headerRow = r; col.req = cn; }
    });
  });
  const hdr = ws.getRow(headerRow), sub = ws.getRow(headerRow + 1);
  hdr.eachCell((c, cn) => {
    if (isSlave(c)) return;
    const t = norm(textOf(c.value));
    if (t.startsWith('REQUISITOS') && cn !== col.req) col.section = cn;
    if (t === 'ITEM') col.num = cn;
    if (t.startsWith('EVIDENCIAS')) col.evid = cn;
    if (t.startsWith('PROCESOS')) col.proc = cn;
    if (t.startsWith('N/A')) col.na = cn;
    if (t.startsWith('DESCRIPCION DEL HALLAZGO')) col.finding = cn;
    if (t.startsWith('RESULTADOS POR ITEM')) col.result = cn;
    if (t.startsWith('PORCENTAJE DE CUMPLIMIENTO')) col.pct = cn;
  });
  const situCols: { code: string; label: string; col: number }[] = [];
  sub.eachCell((c, cn) => {
    if (isSlave(c)) return;
    const t = norm(textOf(c.value));
    const map: Record<string, string> = { NC: 'nc', OBS: 'obs', OPM: 'opm', OK: 'ok' };
    if (map[t]) situCols.push({ code: map[t], label: textOf(c.value)!.trim(), col: cn });
  });
  for (const k of ['section', 'num', 'evid', 'proc', 'na', 'finding', 'result', 'pct'] as const) {
    if (!col[k]) issues.push({ issue_type: 'otro', severity: 'bloqueante', message: `No se encontró la columna esperada "${k}" en la fila ${headerRow}.` });
  }
  if (situCols.length !== 4) {
    issues.push({ issue_type: 'otro', severity: 'bloqueante', source_ref: ref(S, `A${headerRow + 1}`),
      message: `Se esperaban las columnas de situación NC, OBS, OPM y OK; se encontraron ${situCols.map(s => s.label).join(', ') || 'ninguna'}.` });
  }
  const L = (c: number) => colLetter(c);
  const cv = (addr: string): CellVal => { const c = ws.getCell(addr); return isSlave(c) ? null : c.value; };
  const lastRow = ws.rowCount;

  cellMap.push(
    { source: ref(S, `${L(col.section)}${headerRow + 2}…`), target: 'hse_template_sections.title', rule: 'Celda combinada de la columna "Requisitos" = categoría/requisito del sistema de gestión (texto exacto).', imported: true },
    { source: ref(S, `${L(col.num)}n`), target: 'hse_template_items.original_number / code', rule: 'Numeración tal cual figura (sin renumerar).', imported: true },
    { source: ref(S, `${L(col.req)}n`), target: 'hse_template_items.question', rule: 'Texto completo del requisito, sin recortar.', imported: true },
    { source: ref(S, `${L(col.proc)}n`), target: 'hse_template_items.process_id → hse_processes', rule: 'Proceso a auditar (lista de Hoja2).', imported: true },
    { source: ref(S, `${situCols.map(s => L(s.col)).join('/')}${headerRow + 1}`), target: 'scoring_config.options', rule: 'Opciones de situación NC/OBS/OPM/OK.', imported: true },
    { source: ref(S, `${L(col.na)}${headerRow}`), target: 'scoring_config.options[na]', rule: 'Columna "N/A marcar X".', imported: true },
    { source: ref(S, `${L(col.evid)}n`), target: '— (excluido)', rule: 'Evidencias/comentarios de una auditoría ejecutada.', imported: false },
    { source: ref(S, `${L(col.finding)}n`), target: '— (excluido)', rule: 'Descripción de hallazgos de una auditoría ejecutada.', imported: false },
    { source: ref(S, `${situCols.map(s => L(s.col)).join('/')}n`), target: 'hse_template_validation_cases.answers (sólo códigos)', rule: 'Resultado histórico: sólo como caso de validación aislado; nunca como valor por defecto.', imported: false },
  );

  // --- 3. Encabezado de ejecución (datos personales / de la auditoría) — se excluye
  const excludedExecutionData: ParseResult['excludedExecutionData'] = [];
  const headerLabels = ['COMPANIA SOLICITANTE', 'CONTRATISTA', 'FECHA DE REALIZACION', 'AUDITOR', 'NORMAS CERTIFICADAS', 'SOLICITADO POR', 'REFERENTE', 'CARGO / FUNCION'];
  const headerCells: string[] = []; const headerFields = new Set<string>();
  for (let r = 1; r < headerRow; r++) {
    ws.getRow(r).eachCell((c) => {
      if (isSlave(c)) return;
      const t = norm(textOf(c.value));
      if (!t) return;
      headerCells.push(c.address);   // rótulos y valores: todo el bloque es de la ejecución
      const lab = headerLabels.find(h => t.startsWith(h)); if (lab) headerFields.add(lab.toLowerCase());
    });
  }
  if (headerCells.length) {
    excludedExecutionData.push({ field: 'Encabezado de la auditoría (empresa, contratista, fecha, ubicación, personas y cargos)', cells: headerCells, count: headerCells.length });
    issues.push({ issue_type: 'dato_personal_excluido', severity: 'info', source_ref: ref(S, `A1:${L(col.pct)}${headerRow - 1}`),
      message: `Se excluyeron ${headerCells.length} celdas del encabezado (rótulos y valores) con datos de una auditoría ejecutada: ${[...headerFields].join(', ')}. Incluyen nombres de personas y empresas; no forman parte de la plantilla y no se muestran en este reporte.`,
      details: { cells: headerCells } });
  }

  // --- 4. Secciones a partir de las fórmulas de resultado (N = SUM(Itot:Ltot), O = N/(Ftot*3)*10)
  const merges: string[] = ((ws.model as unknown as { merges?: string[] }).merges ?? []);
  const sectionMerges = merges.map(m => m.split(':')).filter(([a]) => parseAddr(a).col === col.section && parseAddr(a).row > headerRow + 1)
    .map(([a, b]) => ({ top: parseAddr(a).row, bottom: parseAddr(b).row })).sort((x, y) => x.top - y.top);

  const sections: ParsedSection[] = [];
  const sectionFormulaRows: number[] = [];
  let maxPointsFromFormula: number | null = null, scaleFromFormula: number | null = null;
  for (let r = headerRow + 2; r <= lastRow; r++) {
    const nf = formulaOf(cv(`${L(col.result)}${r}`));
    if (!nf) continue;
    const m = /^SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i.exec(nf.replace(/\s/g, ''));
    if (!m) continue;
    const totalsRow = Number(m[2]);
    const pf = formulaOf(cv(`${L(col.pct)}${r}`)) ?? '';
    const pm = new RegExp(`^${L(col.result)}${r}/\\(${L(col.evid)}(\\d+)\\*(\\d+(?:\\.\\d+)?)\\)\\*(\\d+(?:\\.\\d+)?)$`, 'i').exec(pf.replace(/\s/g, ''));
    if (!pm || Number(pm[1]) !== totalsRow) {
      issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', source_ref: ref(S, `${L(col.pct)}${r}`),
        message: `La fórmula de porcentaje "=${pf}" no tiene la forma esperada N/(Ftotal*k)*escala; no se puede reproducir con certeza.` });
      continue;
    }
    const k = Number(pm[2]), scale = Number(pm[3]);
    if (maxPointsFromFormula === null) { maxPointsFromFormula = k; scaleFromFormula = scale; }
    else if (k !== maxPointsFromFormula || scale !== scaleFromFormula) {
      issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', source_ref: ref(S, `${L(col.pct)}${r}`),
        message: `La sección usa máximo ${k}/escala ${scale}, distinto del resto (${maxPointsFromFormula}/${scaleFromFormula}).` });
    }
    const cf = formulaOf(cv(`${L(col.evid)}${totalsRow}`)) ?? '';
    const cm = /^COUNTA\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)\+COUNTBLANK\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$/i.exec(cf.replace(/\s/g, ''));
    if (!cm || cm[2] !== cm[6] || cm[4] !== cm[8]) {
      issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', source_ref: ref(S, `${L(col.evid)}${totalsRow}`),
        message: `El conteo de ítems "=${cf}" no tiene la forma COUNTA(rango)+COUNTBLANK(rango).` });
      continue;
    }
    const first = Number(cm[2]), last = Number(cm[4]);
    sectionFormulaRows.push(r);
    formulas.filter(f => f.sheet === S && f.cell === `${L(col.result)}${r}`).forEach(f => f.role = 'Puntaje obtenido de la sección (suma de situaciones)');
    formulas.filter(f => f.sheet === S && f.cell === `${L(col.pct)}${r}`).forEach(f => f.role = `Nota de la sección 0–${scale} = obtenido / (ítems × ${k}) × ${scale}`);
    formulas.filter(f => f.sheet === S && f.cell === `${L(col.evid)}${totalsRow}`).forEach(f => f.role = 'Cantidad de filas de la sección (todas, respondidas o no)');
    for (const sc of situCols) formulas.filter(f => f.sheet === S && f.cell === `${L(sc.col)}${totalsRow}`).forEach(f => f.role = `Suma de puntos de la columna ${sc.label}`);
    formulas.filter(f => f.sheet === S && f.cell === `${L(col.na)}${totalsRow}`).forEach(f => f.role = 'Suma de N/A (sin efecto, ver incidencias)');

    const merge = sectionMerges.find(mg => mg.top <= first && mg.bottom >= last);
    const titleRow = merge ? merge.top : first;
    const title = textOf(cv(`${L(col.section)}${titleRow}`)) ?? `Sección ${sections.length + 1}`;
    const sec: ParsedSection = { key: `S${titleRow}`, row: titleRow, title, sort_order: sections.length,
      source_ref: ref(S, `${L(col.section)}${titleRow}`), items: [], totalsRow,
      resultCell: `${L(col.result)}${r}`, scoreCell: `${L(col.pct)}${r}` };
    if (title !== title.trim()) issues.push({ issue_type: 'texto_formato', severity: 'info', source_ref: sec.source_ref,
      message: `El título de la categoría tiene espacios al inicio o final; se conserva tal cual: "${title}".` });

    for (let ir = first; ir <= last; ir++) {
      const q = textOf(cv(`${L(col.req)}${ir}`));
      const numRaw = cv(`${L(col.num)}${ir}`);
      const num = numRaw === null || numRaw === undefined ? null : textOf(numRaw);
      const procRaw = textOf(cv(`${L(col.proc)}${ir}`));
      const key = `R${ir}`;
      if (!q || !q.trim()) {
        issues.push({ issue_type: 'otro', severity: 'bloqueante', source_ref: ref(S, `${L(col.req)}${ir}`),
          message: `La fila ${ir} está dentro del rango contado por la fórmula (=${cf}) pero no tiene requisito. Afecta el denominador de la sección.` });
        continue;
      }
      const flags: string[] = [];
      if (/[-]/.test(q)) {
        flags.push('caracter_simbolo_privado');
        issues.push({ issue_type: 'texto_formato', severity: 'info', item_key: key, source_ref: ref(S, `${L(col.req)}${ir}`),
          message: 'El texto contiene viñetas de la fuente Symbol (U+F0B7). Se conserva el texto original; la aplicación las muestra como "•".' });
      }
      sec.items.push({ key, row: ir, original_number: num, code: num, question: q, process: procRaw ? procRaw : null,
        source_ref: ref(S, `${L(col.req)}${ir}`), sort_order: sec.items.length, response_type: 'situacion', review_flags: flags });
    }
    sections.push(sec);
  }
  if (!sections.length) throw new Error('No se encontraron secciones con fórmulas de resultado reconocibles.');

  // --- 5. Numeración: duplicados, saltos y filas sin número (no se corrigen)
  const allItems = sections.flatMap(s => s.items.map(i => ({ ...i, section: s })));
  const byNum = new Map<string, typeof allItems>();
  for (const it of allItems) {
    if (it.original_number === null) {
      it.review_flags.push('sin_numeracion');
      issues.push({ issue_type: 'sin_numeracion', severity: 'advertencia', item_key: it.key, source_ref: ref(S, `${L(col.num)}${it.row}`),
        message: `El requisito de la fila ${it.row} ("${it.question.trim().slice(0, 60)}") no tiene número. Está dentro del rango de la fórmula, por lo que cuenta en el denominador de "${it.section.title.trim()}". Confirmar si es parte de la plantilla o fue agregado durante la ejecución.` });
      continue;
    }
    const arr = byNum.get(it.original_number) ?? []; arr.push(it); byNum.set(it.original_number, arr);
  }
  const duplicates: { number: string; rows: number[] }[] = [];
  for (const [n, arr] of byNum) if (arr.length > 1) {
    duplicates.push({ number: n, rows: arr.map(a => a.row) });
    arr.forEach(a => a.review_flags.push('numeracion_duplicada'));
    issues.push({ issue_type: 'numeracion_duplicada', severity: 'advertencia', item_key: arr[1].key,
      source_ref: arr.map(a => ref(S, `${L(col.num)}${a.row}`)).join(', '),
      message: `El número ${n} se repite en las filas ${arr.map(a => a.row).join(' y ')} (${[...new Set(arr.map(a => `"${a.section.title.trim()}"`))].join(' / ')}). Se conserva la numeración original.`,
      details: { number: n, rows: arr.map(a => a.row) } });
  }
  const nums = [...byNum.keys()].map(Number).filter(n => Number.isInteger(n)).sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let n = nums[0]; n <= nums[nums.length - 1]; n++) if (!byNum.has(String(n))) gaps.push(n);
  for (const g of gaps) {
    const prev = allItems.filter(i => i.original_number !== null && Number(i.original_number) < g).pop();
    issues.push({ issue_type: 'numeracion_salto', severity: 'advertencia', item_key: prev?.key,
      source_ref: prev ? ref(S, `${L(col.num)}${prev.row}`) : undefined,
      message: `Falta el número ${g} en la secuencia${prev ? ` (después de la fila ${prev.row})` : ''}. Verificar si hay un requisito omitido en el original.`,
      details: { missing: g } });
  }
  // Numeración que retrocede (orden no creciente)
  let lastNum = -Infinity;
  for (const it of allItems) {
    if (it.original_number === null) continue;
    const n = Number(it.original_number);
    if (n < lastNum && !duplicates.some(d => d.number === it.original_number)) {
      issues.push({ issue_type: 'numeracion_salto', severity: 'advertencia', item_key: it.key, source_ref: ref(S, `${L(col.num)}${it.row}`),
        message: `La numeración retrocede en la fila ${it.row} (${n} después de ${lastNum}).` });
    }
    lastNum = Math.max(lastNum, n);
  }

  // --- 6. Procesos (Hoja con la lista + validación de datos)
  const procCellsUsed = new Set(allItems.map(i => i.process).filter(Boolean) as string[]);
  let processes: string[] = [];
  let processSheet: string | null = null;
  const dvToList = x14.find(v => v.sqref.includes(`${L(col.proc)}`));
  if (dvToList) {
    const m = /^'?([^'!]+)'?!\$?([A-Z]+)\$?(\d+):\$?([A-Z]+)\$?(\d+)$/.exec(dvToList.formula);
    if (m) {
      processSheet = m[1];
      const pws = wb.getWorksheet(m[1]);
      if (pws) for (let r = Number(m[3]); r <= Number(m[5]); r++) {
        const t = textOf(pws.getCell(`${m[2]}${r}`).value); if (t && t.trim()) processes.push(t.trim());
      }
      cellMap.push({ source: `${dvToList.formula} (validación de lista en ${dvToList.sqref})`, target: 'hse_processes', rule: 'Catálogo de procesos auditables.', imported: true });
    }
  }
  if (!processes.length) {
    // sin validación legible: hoja de una sola columna cuyos valores coincidan con los procesos usados
    for (const w of wb.worksheets) {
      if (w.name === S) continue;
      const vals: string[] = []; w.eachRow(r => { if (isSlave(r.getCell(1))) return; const t = textOf(r.getCell(1).value); if (t && t.trim()) vals.push(t.trim()); });
      if (vals.length && [...procCellsUsed].every(p => vals.includes(p.trim()))) { processes = vals; processSheet = w.name; break; }
    }
    issues.push({ issue_type: 'otro', severity: 'info', message: 'No se pudo leer la validación de datos de procesos; el catálogo se tomó de la hoja cuyos valores coinciden con los procesos usados.' });
  }
  if (processSheet) {
    const d = diagnosis.find(x => x.name === processSheet); if (d) d.role = 'Catálogo de procesos (lista desplegable de la columna Procesos)';
  }
  for (const p of procCellsUsed) if (!processes.includes(p.trim())) {
    processes.push(p.trim());
    issues.push({ issue_type: 'otro', severity: 'advertencia', message: `El proceso "${p}" se usa en el checklist pero no está en la lista de procesos; se agregó al catálogo.` });
  }
  for (const p of processes) if (![...procCellsUsed].some(u => u.trim() === p)) {
    issues.push({ issue_type: 'proceso_no_utilizado', severity: 'info', source_ref: processSheet ? `'${processSheet}'` : undefined,
      message: `El proceso "${p}" figura en el catálogo pero ningún requisito lo usa. Se importa al catálogo.` });
  }
  for (const it of allItems) if (!it.process) {
    it.review_flags.push('proceso_faltante');
    issues.push({ issue_type: 'proceso_faltante', severity: 'advertencia', item_key: it.key, source_ref: ref(S, `${L(col.proc)}${it.row}`),
      message: `El requisito ${it.original_number ?? `(fila ${it.row})`} no tiene proceso asignado.` });
  }

  // --- 7. Puntos por situación: NO están en fórmulas; se infieren de los valores cargados
  const pointsByCode: Record<string, number | null> = {};
  for (const sc of situCols) {
    const vals = new Set<number>(); let nonNumeric = 0;
    for (const it of allItems) {
      const v = cv(`${L(sc.col)}${it.row}`); if (v === null || v === undefined || v === '') continue;
      const n = numOf(v); if (n === null) nonNumeric++; else vals.add(n);
    }
    if (vals.size === 1 && nonNumeric === 0) {
      pointsByCode[sc.code] = [...vals][0];
    } else {
      pointsByCode[sc.code] = null;
      issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', source_ref: ref(S, `${L(sc.col)}${headerRow + 1}`),
        message: `La columna ${sc.label} tiene valores ${[...vals].join(', ') || 'vacíos'}${nonNumeric ? ` y ${nonNumeric} no numéricos` : ''}; no se puede determinar un puntaje único.` });
    }
  }
  const inferred = situCols.filter(s => pointsByCode[s.code] !== null);
  if (inferred.length) {
    issues.push({ issue_type: 'regla_inferida', severity: 'advertencia', source_ref: ref(S, `${situCols.map(s => L(s.col)).join('/')}${headerRow + 1}`),
      message: `El puntaje de cada situación no está en ninguna fórmula: el auditor escribe el número en la columna elegida y las fórmulas sólo suman. Se infirió de los valores cargados: ${inferred.map(s => `${s.label} = ${pointsByCode[s.code]}`).join(', ')}. Es coherente con el máximo ×${maxPointsFromFormula} de las fórmulas, pero requiere confirmación.`,
      details: { points: pointsByCode } });
  }
  if (maxPointsFromFormula !== null) {
    const maxInferred = Math.max(...Object.values(pointsByCode).filter((x): x is number => x !== null));
    if (maxInferred !== maxPointsFromFormula) issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante',
      message: `El puntaje máximo inferido (${maxInferred}) no coincide con el multiplicador de las fórmulas (${maxPointsFromFormula}).` });
  }
  // Filas con más de una situación (Excel las sumaría; la app admite una sola)
  for (const it of allItems) {
    const marked = situCols.filter(s => { const v = cv(`${L(s.col)}${it.row}`); return v !== null && v !== undefined && v !== ''; });
    const na = norm(textOf(cv(`${L(col.na)}${it.row}`))) === 'X';
    if (marked.length + (na ? 1 : 0) > 1) issues.push({ issue_type: 'formula_ambigua', severity: 'advertencia', item_key: it.key,
      source_ref: ref(S, `${L(col.na)}${it.row}:${L(situCols[situCols.length - 1].col)}${it.row}`),
      message: `La fila ${it.row} tiene más de una situación marcada. El Excel sumaría ambas; la aplicación admite una sola respuesta por requisito.` });
  }

  // --- 8. N/A: fórmula SUMIF(H..,"X") sin rango de suma y sin uso en resultados
  const naFormulas = sections.map(s => ({ s, f: formulaOf(cv(`${L(col.na)}${s.totalsRow}`)) }));
  const naReferenced = formulas.some(f => sections.some(s => new RegExp(`\\b${L(col.na)}${s.totalsRow}\\b`).test(f.formula)));
  const naSample = naFormulas.find(x => x.f)?.f ?? null;
  issues.push({ issue_type: 'formula_sin_efecto', severity: 'advertencia', source_ref: naFormulas.filter(x => x.f).map(x => ref(S, `${L(col.na)}${x.s.totalsRow}`)).join(', '),
    message: `La columna "N/A marcar X" se totaliza con =${naSample ?? '(sin fórmula)'}: SUMIF sin rango de suma suma los propios textos "X", por lo que siempre da 0, y ${naReferenced ? 'se usa' : 'ninguna fórmula de resultado usa ese total'}. Además, el denominador cuenta TODAS las filas (COUNTA+COUNTBLANK). Consecuencia literal: un requisito marcado N/A suma 0 puntos y sigue contando en el objetivo (igual que una NC). Se importa ese comportamiento sin cambios ("na_mode = contar_cero"); validar si el criterio real es excluir los N/A del denominador.`,
    details: { formula: naSample, referenced: naReferenced } });
  issues.push({ issue_type: 'regla_inferida', severity: 'advertencia',
    message: 'Un requisito sin situación marcada suma 0 y cuenta en el objetivo (el conteo incluye celdas vacías con COUNTBLANK). Se reproduce tal cual ("unanswered_mode = contar_cero"). Confirmar el criterio.' });

  // --- 9. Resultado final y Hoja1
  let finalCell: string | null = null, finalFormula: string | null = null, finalExpected: number | null = null;
  ws.eachRow((row, r) => {
    if (isSlave(row.getCell(col.pct))) return;
    const f = formulaOf(row.getCell(col.pct).value);
    if (f && /^AVERAGE\(/i.test(f.replace(/\s/g, ''))) { finalCell = `${L(col.pct)}${r}`; finalFormula = f; finalExpected = numOf(row.getCell(col.pct).value); }
  });
  if (!finalCell) {
    issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', message: 'No se encontró la fórmula del resultado final (AVERAGE de las notas de sección).' });
  } else {
    const refs = (finalFormula! as string).replace(/^AVERAGE\(|\)$/gi, '').split(',').map(x => x.trim().toUpperCase());
    const expectedRefs = sections.map(s => s.scoreCell.toUpperCase());
    formulas.filter(f => f.sheet === S && f.cell === finalCell).forEach(f => f.role = 'Resultado final = promedio simple de las notas de sección');
    if (refs.sort().join() !== [...expectedRefs].sort().join()) {
      issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', source_ref: ref(S, finalCell),
        message: `El promedio final usa ${refs.join(', ')} pero las secciones detectadas son ${expectedRefs.join(', ')}.` });
    }
    issues.push({ issue_type: 'regla_inferida', severity: 'info', source_ref: ref(S, finalCell),
      message: 'El resultado final es el promedio simple de las notas de sección: cada sección pesa lo mismo sin importar su cantidad de requisitos (p.ej. 3 ítems pesan igual que 30). Se reproduce sin cambios.' });
  }
  const totalFormulaRow = formulas.find(f => f.sheet === S && /^=SUM\(.+\+.+\)$/i.test(f.formula.replace(/\s/g, '')) && f.cell.startsWith(L(col.result)));
  if (totalFormulaRow) totalFormulaRow.role = 'Total de puntos obtenidos (informativo, no interviene en la nota final)';

  // Hoja de resumen
  let alternativeFinal: ParseResult['alternativeFinal'] = null;
  for (const w of wb.worksheets) {
    if (w.name === S) continue;
    const fs = formulas.filter(f => f.sheet === w.name);
    if (!fs.length) continue;
    const d = diagnosis.find(x => x.name === w.name)!;
    d.role = 'Resumen de resultados por requisito (referencias a ' + S + ')';
    for (const f of fs) {
      if (new RegExp(`'${S}'!${L(col.evid)}\\d+\\*\\d+`).test(f.formula)) f.role = 'Puntaje objetivo de la sección (ítems × máximo)';
      else if (new RegExp(`'${S}'!${L(col.result)}\\d+$`).test(f.formula)) f.role = 'Puntaje alcanzado (referencia)';
      else if (new RegExp(`'${S}'!${L(col.pct)}\\d+$`).test(f.formula)) f.role = 'Evaluación (referencia a la nota)';
      else if (/^=SUM\(/i.test(f.formula)) f.role = 'Total de la columna';
    }
    // Totales alcanzado/objetivo -> nota global ponderada (NO es la que usa el Excel)
    const sums = fs.filter(f => /^=SUM\([A-Z]+\d+:[A-Z]+\d+\)$/i.test(f.formula));
    if (sums.length >= 2 && typeof sums[0].result === 'number' && typeof sums[1].result === 'number' && (sums[1].result as number) > 0) {
      const v = (sums[0].result as number) / (sums[1].result as number) * (scaleFromFormula ?? 10);
      alternativeFinal = { label: 'Nota global ponderada (alcanzado total / objetivo total)', value: v, source: `'${w.name}'!${sums[0].cell}/${sums[1].cell}` };
      issues.push({ issue_type: 'formula_ambigua', severity: 'advertencia', source_ref: `'${w.name}'!${sums[0].cell}:${sums[1].cell}`,
        message: `"${w.name}" muestra el total alcanzado (${sums[0].result}) y el objetivo total (${sums[1].result}), que darían una nota ponderada de ${v.toFixed(2)}, pero la "Evaluación" final de esa misma hoja toma el promedio simple de ${S} (${finalExpected !== null ? (finalExpected as number).toFixed(2) : '—'}). Se importa el promedio simple, que es el resultado oficial del libro; confirmar que es el criterio deseado.`,
        details: { weighted: v, average: finalExpected } });
    }
  }
  for (const w of wb.worksheets) {
    const d = diagnosis.find(x => x.name === w.name)!;
    if (!d.role) d.role = d.formulas === 0 && w.name !== processSheet ? 'Sin uso detectado' : d.role;
  }

  // --- 10. Criterio de evaluación: texto + formato condicional
  const textBands: { label: string; text: string; row: number }[] = [];
  let critRow = 0;
  ws.eachRow((row, r) => row.eachCell(c => { if (!critRow && !isSlave(c) && norm(textOf(c.value)) === 'CRITERIO DE EVALUACION') critRow = r; }));
  if (critRow) for (let r = critRow; r < critRow + 8; r++) {
    const row = ws.getRow(r); let range: string | null = null; let label: string | null = null;
    row.eachCell(c => { if (isSlave(c)) return; const t = textOf(c.value); if (!t) return;
      if (/^\s*\d+([.,]\d+)?\s*-\s*\d+([.,]\d+)?\s*$/.test(t)) range = t.trim();
      else if (norm(t) !== 'CRITERIO DE EVALUACION') label = t.trim(); });
    if (range && label) textBands.push({ label, text: range, row: r });
  }
  const cfs = ((ws as unknown as { conditionalFormattings?: { ref: string; rules: { type: string; operator?: string; formulae?: (string | number)[] }[] }[] }).conditionalFormattings ?? []);
  const finalCf = cfs.find(c => finalCell && c.ref.split(/\s+/).some(rf => rf.split(':')[0] === finalCell));
  const bands: Band[] = [];
  if (finalCf) {
    finalCf.rules.forEach((rule, i) => {
      const f = (rule.formulae ?? []).map(x => Number(String(x).replace(',', '.')));
      const label = textBands[i]?.label ?? `Banda ${i + 1}`;
      if (rule.operator === 'between') bands.push({ label, min: f[0], max: f[1], source: `Formato condicional ${finalCell}: entre ${f[0]} y ${f[1]}` });
      else if (rule.operator === 'lessThanOrEqual') bands.push({ label, min: null, max: f[0], source: `Formato condicional ${finalCell}: ≤ ${f[0]}` });
      else if (rule.operator === 'greaterThanOrEqual') bands.push({ label, min: f[0], max: null, source: `Formato condicional ${finalCell}: ≥ ${f[0]}` });
      else issues.push({ issue_type: 'limite_evaluacion', severity: 'bloqueante', source_ref: ref(S, finalCell!), message: `Regla de formato condicional no soportada: ${rule.operator}.` });
    });
    // comparación texto vs formato
    bands.forEach((b, i) => {
      const t = textBands[i];
      if (!t) return;
      const [a, z] = t.text.split('-').map(x => Number(x.trim().replace(',', '.')));
      if (b.max !== z || (b.min !== null && b.min !== a)) issues.push({ issue_type: 'limite_evaluacion', severity: 'advertencia', source_ref: ref(S, `E${t.row}`),
        message: `La leyenda "${t.text} ${t.label}" no coincide con el formato condicional (${b.source}).` });
      if (b.min === null && a === 0) issues.push({ issue_type: 'limite_evaluacion', severity: 'info', source_ref: ref(S, `E${t.row}`),
        message: `La leyenda dice "${t.text}" y el formato condicional aplica "≤ ${b.max}". Equivalentes para notas 0–${scaleFromFormula}.` });
    });
  } else {
    issues.push({ issue_type: 'limite_evaluacion', severity: 'bloqueante', message: 'No se encontró el formato condicional del resultado final; los límites de evaluación no pueden confirmarse.' });
  }
  // huecos entre bandas
  const sortedB = [...bands].sort((a, b) => (a.max ?? 1e9) - (b.max ?? 1e9));
  for (let i = 0; i < sortedB.length - 1; i++) {
    const hi = sortedB[i].max, lo = sortedB[i + 1].min;
    if (hi !== null && lo !== null && lo > hi) issues.push({ issue_type: 'limite_evaluacion', severity: 'advertencia', source_ref: finalCell ? ref(S, finalCell) : undefined,
      message: `Entre ${hi} y ${lo} no hay banda: una nota como ${(hi + (lo - hi) / 2).toFixed(3)} (sin redondear) no recibe calificación en el Excel. Se conservan los límites sin alterarlos; la aplicación la mostrará como "sin clasificar". Definir si corresponde redondear a 2 decimales antes de clasificar.`,
      details: { from: hi, to: lo } });
  }
  // Las demás hojas con el mismo criterio
  for (const w of wb.worksheets) {
    if (w.name === S) continue;
    const ocfs = ((w as unknown as { conditionalFormattings?: { ref: string; rules: { operator?: string; formulae?: unknown[] }[] }[] }).conditionalFormattings ?? []);
    for (const c of ocfs) {
      const sig = c.rules.map(r => `${r.operator}:${(r.formulae ?? []).join('/')}`).join('|');
      const mine = finalCf?.rules.map(r => `${r.operator}:${(r.formulae ?? []).join('/')}`).join('|');
      if (mine && sig !== mine) issues.push({ issue_type: 'limite_evaluacion', severity: 'advertencia', source_ref: `'${w.name}'!${c.ref}`,
        message: `El formato condicional de ${w.name}!${c.ref} usa límites distintos a los de ${S}.` });
    }
  }

  // --- 11. Configuración de puntuación (versión identificable)
  const optionDefs = [
    ...situCols.map(sc => ({ code: sc.code, label: sc.label, points: pointsByCode[sc.code] ?? null,
      finding_type: sc.code === 'nc' ? 'no_conformidad' : sc.code === 'obs' ? 'observacion' : sc.code === 'opm' ? 'oportunidad_mejora' : undefined,
      source: `${ref(S, `${L(sc.col)}${headerRow + 1}`)} · puntaje inferido de los valores cargados` })),
    { code: 'na', label: 'N/A', points: 0, source: `${ref(S, `${L(col.na)}${headerRow}`)} · suma 0 (SUMIF sin efecto) y cuenta en el objetivo` },
  ];
  const scoringConfig: SituacionConfig = {
    options: optionDefs,
    max_points_per_item: maxPointsFromFormula ?? 3,
    scale_max: scaleFromFormula ?? 10,
    na_mode: 'contar_cero',
    unanswered_mode: 'contar_cero',
    section_formula: `nota = obtenido / (filas_de_la_sección × ${maxPointsFromFormula}) × ${scaleFromFormula}`,
    final_formula: 'promedio simple de las notas de sección',
    bands,
    band_rounding: null,
    provenance: {
      file: fileName, sha256, sheet: S,
      section_formulas: sections.map(s => ({ section: s.title.trim(), result: s.resultCell, score: s.scoreCell, totals_row: s.totalsRow })),
      final_cell: finalCell, final_formula: finalFormula ? '=' + finalFormula : null,
    },
  };
  if (maxPointsFromFormula === null) issues.push({ issue_type: 'formula_ambigua', severity: 'bloqueante', message: 'No se pudo determinar el puntaje máximo por ítem desde las fórmulas.' });

  // --- 12. Caso de validación (sólo códigos; nada de texto de la ejecución)
  let validationCase: ValidationCase | null = null;
  const answersByKey: Record<string, string> = {};
  for (const it of allItems) {
    const na = norm(textOf(cv(`${L(col.na)}${it.row}`))) === 'X';
    const marked = situCols.filter(s => { const v = cv(`${L(s.col)}${it.row}`); return v !== null && v !== undefined && v !== ''; });
    if (na) answersByKey[it.key] = 'na';
    else if (marked.length === 1) answersByKey[it.key] = marked[0].code;
  }
  const expectedSections: ValidationCase['expected']['sections'] = {};
  let expectedOk = true;
  for (const s of sections) {
    const raw = numOf(cv(s.resultCell)), score = numOf(cv(s.scoreCell)), rows = numOf(cv(`${L(col.evid)}${s.totalsRow}`));
    if (raw === null || score === null || rows === null) { expectedOk = false; continue; }
    expectedSections[s.key] = { raw, target: rows * (maxPointsFromFormula ?? 3), score };
    if (rows !== s.items.length) issues.push({ issue_type: 'diferencia_resultado', severity: 'bloqueante', source_ref: ref(S, `${L(col.evid)}${s.totalsRow}`),
      message: `La fórmula cuenta ${rows} filas en "${s.title.trim()}" pero hay ${s.items.length} requisitos importados.` });
  }
  if (expectedOk && finalExpected !== null) {
    validationCase = { name: `Resultados de prueba del Excel (${fileName})`, source_ref: ref(S, finalCell!), answers: answersByKey,
      expected: { sections: expectedSections, final: finalExpected } };
  } else {
    issues.push({ issue_type: 'diferencia_resultado', severity: 'bloqueante', message: 'El libro no tiene resultados calculados (valores en caché) para comparar; abrirlo y guardarlo en Excel antes de importar.' });
  }

  // --- 13. Comparación local motor vs Excel
  const comparisonRows: ParseResult['comparison']['rows'] = [];
  let local: EvalResult | null = null;
  if (validationCase) {
    const answersById: Record<string, string> = {};
    for (const [k, v] of Object.entries(answersByKey)) answersById[k] = v;
    local = evaluate({ scoring_method: 'situacion_promedio_secciones', scoring_config: scoringConfig },
      sections.map(s => ({ id: s.key, title: s.title, sort_order: s.sort_order })),
      allItems.map(i => ({ id: i.key, section_id: i.section.key, response_type: 'situacion', weight: 1, is_critical: false })),
      answersById);
    const tol = 1e-6;
    for (const s of sections) {
      const e = expectedSections[s.key]; const c = local.sections.find(x => x.section_id === s.key);
      if (!e) continue;
      for (const [label, ev, cvv] of [['obtenido', e.raw, c?.raw], ['objetivo', e.target, c?.target], ['nota', e.score, c?.score]] as const) {
        const comp = cvv ?? null; const diff = comp === null ? null : Math.abs(ev - comp);
        comparisonRows.push({ label: `${s.title.trim()} · ${label}`, expected: ev, computed: comp, diff, ok: diff !== null && diff <= tol });
      }
    }
    const diff = local.final === null ? null : Math.abs((finalExpected as unknown as number) - local.final);
    comparisonRows.push({ label: 'Resultado final', expected: finalExpected, computed: local.final, diff, ok: diff !== null && diff <= tol });
    const eb = local.band;
    comparisonRows.push({ label: `Calificación (${eb ?? '—'})`, expected: null, computed: null, diff: null, ok: eb !== null && eb !== 'sin_clasificar' });
    for (const r of comparisonRows.filter(r => !r.ok && r.expected !== null)) {
      issues.push({ issue_type: 'diferencia_resultado', severity: 'bloqueante', message: `El motor no reproduce "${r.label}": Excel ${r.expected}, calculado ${r.computed}.` });
    }
  }

  // --- 14. Datos de ejecución excluidos (sólo cantidades y celdas, no valores)
  const cellsWith = (c: number) => allItems.filter(i => { const v = cv(`${L(c)}${i.row}`); return v !== null && v !== undefined && v !== '' && textOf(v)?.trim(); }).map(i => `${L(c)}${i.row}`);
  const ev = cellsWith(col.evid), fd = cellsWith(col.finding);
  const sv = allItems.filter(i => situCols.some(s => { const v = cv(`${L(s.col)}${i.row}`); return v !== null && v !== undefined && v !== ''; })).map(i => `${L(situCols[0].col)}${i.row}:${L(situCols[situCols.length - 1].col)}${i.row}`);
  excludedExecutionData.push(
    { field: 'Evidencias / comentarios por requisito', cells: ev, count: ev.length },
    { field: 'Descripción de hallazgos', cells: fd, count: fd.length },
    { field: 'Situación registrada (resultado histórico) — sólo como caso de validación', cells: sv, count: sv.length },
  );
  issues.push({ issue_type: 'dato_ejecucion_excluido', severity: 'info',
    message: `Se excluyeron de la plantilla ${ev.length} comentarios de evidencia, ${fd.length} descripciones de hallazgos y ${sv.length} situaciones registradas de una auditoría ejecutada. Las situaciones se guardan sólo como códigos (NC/OBS/OPM/OK/N/A) en un caso de validación separado; ninguna se usa como valor por defecto en auditorías nuevas.` });
  const situNoFinding = allItems.filter(i => ['nc', 'obs', 'opm'].includes(answersByKey[i.key] ?? '') && !textOf(cv(`${L(col.finding)}${i.row}`))?.trim());
  if (situNoFinding.length) issues.push({ issue_type: 'otro', severity: 'info',
    message: `En la ejecución de ejemplo, ${situNoFinding.length} requisitos con NC/OBS/OPM no tienen descripción de hallazgo (filas ${situNoFinding.map(i => i.row).join(', ')}). No afecta la plantilla; en la aplicación esas situaciones proponen registrar un hallazgo.` });

  // --- 15. Estadísticas
  const stats = {
    hojas: wb.worksheets.length,
    categorias: sections.length,
    preguntas: allItems.length,
    preguntas_numeradas: allItems.filter(i => i.original_number !== null).length,
    preguntas_sin_numero: allItems.filter(i => i.original_number === null).length,
    procesos_catalogo: processes.length,
    procesos_usados: procCellsUsed.size,
    formulas_total: formulas.length,
    formulas_identificadas: formulas.filter(f => f.role).length,
    numeros_duplicados: duplicates.length,
    saltos_numeracion: gaps.length,
    opciones_situacion: optionDefs.length,
    bandas_evaluacion: bands.length,
    incidencias: issues.length,
    incidencias_bloqueantes: issues.filter(i => i.severity === 'bloqueante').length,
    incidencias_advertencia: issues.filter(i => i.severity === 'advertencia').length,
    incidencias_info: issues.filter(i => i.severity === 'info').length,
  };

  return {
    fileName, sha256, diagnosis, formulas, cellMap, sections, processes, scoringConfig, issues, validationCase,
    comparison: { local, rows: comparisonRows, allMatch: comparisonRows.filter(r => r.expected !== null).every(r => r.ok) },
    alternativeFinal, excludedExecutionData, stats,
    template: {
      name: 'Lista de verificación – Auditoría a Segundas Partes (CSMS)',
      category: 'csms',
      description: `Importada de "${fileName}". Requisitos CSMS por categoría del sistema de gestión, escala NC/OBS/OPM/OK/N/A.`,
    },
  };
}

/** Arma el payload para public.hse_import_template. */
export function toImportPayload(r: ParseResult, opts: { name?: string; description?: string; templateId?: string; report?: unknown } = {}) {
  return {
    template: { id: opts.templateId ?? null, name: opts.name ?? r.template.name, category: r.template.category, description: opts.description ?? r.template.description },
    version: {
      change_notes: `Importación desde ${r.fileName}`,
      scoring_method: 'situacion_promedio_secciones',
      scoring_config: r.scoringConfig,
      source_file_name: r.fileName,
      source_sha256: r.sha256,
      import_report: opts.report ?? { stats: r.stats, diagnosis: r.diagnosis, cellMap: r.cellMap, comparison: r.comparison.rows, alternativeFinal: r.alternativeFinal },
    },
    processes: r.processes,
    sections: r.sections.map(s => ({
      key: s.key, title: s.title, sort_order: s.sort_order, source_ref: s.source_ref,
      items: s.items.map(i => ({ key: i.key, code: i.code, original_number: i.original_number, question: i.question,
        process: i.process, response_type: i.response_type, weight: 1, is_critical: false, evidence_required_on_fail: false,
        sort_order: i.sort_order, source_ref: i.source_ref, review_flags: i.review_flags })),
    })),
    issues: r.issues,
    validation_cases: r.validationCase ? [r.validationCase] : [],
  };
}
