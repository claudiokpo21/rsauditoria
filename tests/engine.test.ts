import { describe, expect, it } from 'vitest';
import { evaluate, classifyBand, type SituacionConfig } from '../src/scoring/engine';

const cfg: SituacionConfig = {
  options: [{ code: 'nc', label: 'NC', points: 0 }, { code: 'obs', label: 'OBS', points: 1 }, { code: 'opm', label: 'OPM', points: 2 }, { code: 'ok', label: 'OK', points: 3 }, { code: 'na', label: 'N/A', points: 0 }],
  max_points_per_item: 3, scale_max: 10, na_mode: 'contar_cero', unanswered_mode: 'contar_cero',
  bands: [{ label: 'Muy Bueno', min: 8.01, max: 10 }, { label: 'Bueno', min: 6.01, max: 8 }, { label: 'Regular', min: 4.01, max: 6 }, { label: 'Crítico', min: null, max: 4 }],
};
const V = { scoring_method: 'situacion_promedio_secciones', scoring_config: cfg };
const S = [{ id: 's1', title: 'A', sort_order: 0 }, { id: 's2', title: 'B', sort_order: 1 }];
const mk = (id: string, s: string) => ({ id, section_id: s, response_type: 'situacion', weight: 1, is_critical: false });

describe('metodología situación / promedio de secciones (H&P)', () => {
  it('reproduce la fórmula N/(filas×3)×10 y el promedio simple', () => {
    // Sección 1 del Excel H&P: OK,OK,OBS,OK,OBS,OPM,OK,NC → 16/24 → 6,6667
    const items = ['ok', 'ok', 'obs', 'ok', 'obs', 'opm', 'ok', 'nc'].map((_, i) => mk(`a${i}`, 's1'));
    const ans = Object.fromEntries(['ok', 'ok', 'obs', 'ok', 'obs', 'opm', 'ok', 'nc'].map((a, i) => [`a${i}`, a]));
    // Sección "Gestión de Proveedores": NC,NC,OBS,OK → 4/12 → 3,3333
    const items2 = ['nc', 'nc', 'obs', 'ok'].map((_, i) => mk(`b${i}`, 's2'));
    Object.assign(ans, Object.fromEntries(['nc', 'nc', 'obs', 'ok'].map((a, i) => [`b${i}`, a])));
    const r = evaluate(V, S, [...items, ...items2], ans);
    expect(r.sections[0]).toMatchObject({ raw: 16, target: 24 });
    expect(r.sections[0].score).toBeCloseTo(6.666666666666666, 12);
    expect(r.sections[1].score).toBeCloseTo(3.333333333333333, 12);
    expect(r.final).toBeCloseTo((6.666666666666666 + 3.333333333333333) / 2, 12);
  });
  it('N/A y sin responder suman 0 y cuentan en el objetivo (literal del Excel)', () => {
    const r = evaluate(V, [S[0]], [mk('x', 's1'), mk('y', 's1'), mk('z', 's1')], { x: 'ok', y: 'na' });
    expect(r.sections[0]).toMatchObject({ raw: 3, target: 9, answered: 2, na: 1 });
  });
  it('con na_mode=excluir el N/A sale del objetivo', () => {
    const r = evaluate({ ...V, scoring_config: { ...cfg, na_mode: 'excluir' } }, [S[0]], [mk('x', 's1'), mk('y', 's1')], { x: 'ok', y: 'na' });
    expect(r.sections[0]).toMatchObject({ raw: 3, target: 3 });
    expect(r.final).toBe(10);
  });
  it('bandas sin redondeo: los huecos quedan sin clasificar', () => {
    expect(classifyBand(8.01, cfg.bands)).toBe('Muy Bueno');
    expect(classifyBand(8, cfg.bands)).toBe('Bueno');
    expect(classifyBand(8.005, cfg.bands)).toBe('sin_clasificar');
    expect(classifyBand(6.2711640211640211, cfg.bands)).toBe('Bueno');
    expect(classifyBand(4, cfg.bands)).toBe('Crítico');
    expect(classifyBand(0, cfg.bands)).toBe('Crítico');
    expect(classifyBand(4.005, cfg.bands)).toBe('sin_clasificar');
  });
});

describe('metodología ponderada', () => {
  it('cumple suma peso, no cumple 0, N/A fuera del máximo', () => {
    const items = [{ id: 'a', section_id: 's1', response_type: 'cumplimiento', weight: 2, is_critical: true }, { id: 'b', section_id: 's1', response_type: 'cumplimiento', weight: 1, is_critical: false }, { id: 'c', section_id: 's1', response_type: 'cumplimiento', weight: 5, is_critical: false }];
    const r = evaluate({ scoring_method: 'ponderado', scoring_config: {} }, [S[0]], items, { a: 'no_cumple', b: 'cumple', c: 'no_aplica' });
    expect(r).toMatchObject({ score: 1, max_score: 3, critical_failures: 1 });
    expect(r.compliance_pct).toBeCloseTo(33.33, 2);
  });
  it('desglose por sección (0022) y secciones eliminadas fuera del cálculo', () => {
    const secs = [{ id: 's1', title: 'Documentación', sort_order: 0 }, { id: 's2', title: 'Eliminada', sort_order: 1, deleted_at: '2026-01-01' }, { id: 's3', title: 'EPP', sort_order: 2 }];
    const items = [
      { id: 'a', section_id: 's1', response_type: 'cumplimiento', weight: 2, is_critical: false },
      { id: 'b', section_id: 's1', response_type: 'texto', weight: 9, is_critical: false },
      { id: 'c', section_id: 's2', response_type: 'cumplimiento', weight: 5, is_critical: true },
      { id: 'd', section_id: 's3', response_type: 'si_no', weight: 3, is_critical: true },
      { id: 'e', section_id: 's3', response_type: 'cumplimiento', weight: 1, is_critical: false },
    ];
    const r = evaluate({ scoring_method: 'ponderado', scoring_config: {} }, secs, items, { a: 'cumple', b: 'x', c: 'no_cumple', d: 'no', e: 'no_aplica' });
    expect(r).toMatchObject({ score: 2, max_score: 5, compliance_pct: 40, critical_failures: 1 });
    expect(r.sections.map(x => [x.title, x.raw, x.target, x.score, x.items, x.answered, x.na])).toEqual([
      ['Documentación', 2, 2, 100, 1, 1, 0],
      ['EPP', 0, 3, 0, 2, 2, 1],
    ]);
  });
});
