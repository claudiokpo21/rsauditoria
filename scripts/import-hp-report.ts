/**
 * Genera el diagnóstico y el reporte de importación de la lista H&P sin escribir
 * en la base de datos. Uso:  npm run import:hp -- <archivo.xlsx> [carpeta_salida]
 * Salida: import-report.md (legible), import-payload.json (para hse_import_template).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseHpChecklist, toImportPayload } from '../src/modules/templates/import/hpChecklistParser';
import { renderReportMarkdown } from '../src/modules/templates/import/report';

const file = process.argv[2];
const out = process.argv[3] ?? 'import-output';
if (!file) { console.error('Uso: npm run import:hp -- <archivo.xlsx> [salida]'); process.exit(1); }
const buf = readFileSync(file);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
const name = basename(file).replace(/^[0-9a-f]{8}-/, '');
const r = await parseHpChecklist(ab, name);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'import-report.md'), renderReportMarkdown(r));
writeFileSync(join(out, 'import-payload.json'), JSON.stringify(toImportPayload(r), null, 2));
console.log(JSON.stringify({ stats: r.stats, allMatch: r.comparison.allMatch, final: r.comparison.local?.final, band: r.comparison.local?.band }, null, 2));
