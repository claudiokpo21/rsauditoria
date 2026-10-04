import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseHpChecklist } from '../src/modules/templates/import/hpChecklistParser';

// El libro de origen contiene datos de una auditoría real: no se versiona.
// Ejecutar con: HP_XLSX=/ruta/al/archivo.xlsx npm test
const file = process.env.HP_XLSX;
describe.skipIf(!file || !existsSync(file))('importador H&P sobre el libro real', () => {
  it('reconstruye la plantilla y reproduce los resultados del Excel', async () => {
    const b = readFileSync(file!);
    const r = await parseHpChecklist(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, 'hp.xlsx');
    expect(r.stats).toMatchObject({ categorias: 6, preguntas: 83, procesos_catalogo: 8, numeros_duplicados: 3, saltos_numeracion: 5, incidencias_bloqueantes: 0 });
    expect(r.comparison.allMatch).toBe(true);
    expect(r.comparison.local?.final).toBeCloseTo(6.271164021164021, 12);
    expect(r.comparison.local?.band).toBe('Bueno');
    const all = JSON.stringify(r.sections) + JSON.stringify(r.scoringConfig);
    for (const w of ['Claudio', 'Hernandez', 'Pedro', 'Orlando', 'Seguin', 'Keith', 'JJ LOPEZ', 'ENERGIA LIMPIA', 'Pampa']) expect(all).not.toContain(w);
  });
});
