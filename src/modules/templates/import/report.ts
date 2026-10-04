import type { ParseResult } from './hpChecklistParser';

const fmt = (n: number | null | undefined, d = 4) => (n === null || n === undefined ? '—' : String(Number(Number(n).toFixed(d))));
const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** Reporte de importación en Markdown (mismo contenido que muestra la pantalla de importación). */
export function renderReportMarkdown(r: ParseResult): string {
  const L: string[] = [];
  const s = r.stats;
  L.push(`# Reporte de importación — ${r.fileName}`, '');
  L.push(`SHA-256: \`${r.sha256}\``, '');
  L.push('## Resumen', '');
  L.push('| Indicador | Cantidad |', '|---|---:|');
  const rows: [string, number][] = [
    ['Hojas analizadas', s.hojas], ['Categorías (requisitos del sistema de gestión)', s.categorias],
    ['Preguntas / requisitos importados', s.preguntas], ['— con numeración', s.preguntas_numeradas], ['— sin numeración', s.preguntas_sin_numero],
    ['Procesos en catálogo', s.procesos_catalogo], ['Procesos usados', s.procesos_usados],
    ['Fórmulas encontradas', s.formulas_total], ['Fórmulas con rol identificado', s.formulas_identificadas],
    ['Números duplicados', s.numeros_duplicados], ['Saltos de numeración', s.saltos_numeracion],
    ['Opciones de situación', s.opciones_situacion], ['Bandas de evaluación', s.bandas_evaluacion],
    ['Incidencias bloqueantes', s.incidencias_bloqueantes], ['Incidencias que requieren revisión (advertencia)', s.incidencias_advertencia],
    ['Incidencias informativas', s.incidencias_info],
  ];
  for (const [k, v] of rows) L.push(`| ${k} | ${v} |`);
  L.push('', `**Reproducción de resultados:** ${r.comparison.allMatch ? 'el motor reproduce exactamente todos los resultados de prueba del Excel' : 'HAY DIFERENCIAS — ver comparación'}.`, '');

  L.push('## 1. Diagnóstico de hojas', '');
  L.push('| Hoja | Rango | Filas | Celdas combinadas | Fórmulas | Formato condicional | Validaciones | Rol |', '|---|---|---:|---:|---:|---:|---:|---|');
  for (const d of r.diagnosis) L.push(`| ${d.name} | ${d.dimension} | ${d.rows} | ${d.merges} | ${d.formulas} | ${d.conditionalFormats} | ${d.dataValidations} | ${d.role || '—'} |`);

  L.push('', '### Fórmulas', '');
  L.push('| Hoja | Celda | Fórmula | Valor en Excel | Rol |', '|---|---|---|---:|---|');
  for (const f of r.formulas) L.push(`| ${f.sheet} | ${f.cell} | \`${esc(f.formula)}\` | ${typeof f.result === 'number' ? fmt(f.result) : f.result === null || f.result === undefined ? '0 / vacío' : esc(String(f.result))} | ${f.role || '**sin identificar**'} |`);

  L.push('', '## 2. Mapeo de celdas de origen a entidades', '');
  L.push('| Origen | Destino | Regla | Importado |', '|---|---|---|---|');
  for (const m of r.cellMap) L.push(`| ${esc(m.source)} | ${m.target} | ${esc(m.rule)} | ${m.imported ? 'Sí' : 'No'} |`);

  L.push('', '## 3. Categorías y preguntas', '');
  for (const sec of r.sections) {
    L.push(`### ${sec.title.trim()}  (${sec.items.length} requisitos · ${sec.source_ref})`, '');
    L.push('| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |', '|---|---|---:|---|---|');
    for (const i of sec.items) L.push(`| ${i.original_number ?? '**s/n**'} | ${i.process ?? '**—**'} | ${i.row} | ${esc(i.question)} | ${i.review_flags.join(', ')} |`);
    L.push('');
  }
  L.push('**Procesos (catálogo):** ' + r.processes.join(' · '), '');

  L.push('## 4. Metodología de puntuación reconstruida', '');
  const c = r.scoringConfig;
  L.push('| Opción | Puntos | Origen |', '|---|---:|---|');
  for (const o of c.options) L.push(`| ${o.label} | ${o.points ?? '—'} | ${esc(o.source ?? '')} |`);
  L.push('', `- Nota de sección: ${c.section_formula}`, `- Resultado final: ${c.final_formula}`,
    `- N/A: ${c.na_mode === 'contar_cero' ? 'suma 0 y cuenta en el objetivo (literal del Excel)' : 'se excluye del objetivo'}`,
    `- Sin responder: ${c.unanswered_mode === 'contar_cero' ? 'suma 0 y cuenta en el objetivo (literal del Excel)' : 'se excluye'}`, '');
  L.push('| Calificación | Desde | Hasta | Origen |', '|---|---:|---:|---|');
  for (const b of c.bands) L.push(`| ${b.label} | ${b.min ?? '—'} | ${b.max ?? '—'} | ${esc(b.source ?? '')} |`);

  L.push('', '## 5. Comparación con los resultados de prueba del Excel', '');
  L.push('| Concepto | Excel | Calculado | Diferencia | Coincide |', '|---|---:|---:|---:|---|');
  for (const x of r.comparison.rows) L.push(`| ${esc(x.label)} | ${fmt(x.expected, 6)} | ${fmt(x.computed, 6)} | ${x.diff === null ? '—' : x.diff.toExponential(1)} | ${x.ok ? 'Sí' : '**NO**'} |`);
  if (r.alternativeFinal) L.push('', `> Referencia: ${r.alternativeFinal.label} = ${r.alternativeFinal.value.toFixed(4)} (${r.alternativeFinal.source}). No es el criterio del libro; se informa para la validación.`);

  L.push('', '## 6. Elementos que requieren revisión', '');
  const order = { bloqueante: 0, advertencia: 1, info: 2 } as const;
  const sorted = [...r.issues].sort((a, b) => order[a.severity] - order[b.severity]);
  L.push('| # | Severidad | Tipo | Origen | Detalle |', '|---:|---|---|---|---|');
  sorted.forEach((i, n) => L.push(`| ${n + 1} | ${i.severity} | ${i.issue_type} | ${esc(i.source_ref ?? '—')} | ${esc(i.message)} |`));

  L.push('', '## 7. Datos excluidos de la plantilla operativa', '');
  L.push('| Dato | Celdas | Cantidad |', '|---|---|---:|');
  for (const e of r.excludedExecutionData) L.push(`| ${e.field} | ${e.cells.length > 12 ? e.cells.slice(0, 12).join(', ') + ' …' : e.cells.join(', ')} | ${e.count} |`);
  L.push('', 'No se copian nombres de personas, empresas, comentarios, hallazgos ni evidencias. Las situaciones del ejemplo sólo se guardan como códigos en un caso de validación aislado.', '');
  L.push('## 8. Publicación', '',
    'La versión queda en **borrador con validación pendiente**. Para publicarla: (1) revisar y resolver cada incidencia de advertencia/bloqueante con una nota, (2) ejecutar los casos de validación (deben coincidir), (3) validar con fundamento, (4) publicar. El servidor impide publicar si alguno de estos pasos falta.');
  return L.join('\n') + '\n';
}
