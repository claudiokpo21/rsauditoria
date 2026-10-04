/**
 * Motor de puntuación del cliente.
 *
 * Es el espejo exacto de `public.hse_evaluate_answers` (migraciones 0009 y 0022): se usa
 * para mostrar resultados en vivo sin conexión y para validar importaciones
 * antes de enviarlas. La fuente de verdad sigue siendo el servidor, que recalcula
 * al completar la auditoría y al ejecutar los casos de validación.
 */

export type ScoringMethod = 'ponderado' | 'situacion_promedio_secciones';
export type CountMode = 'contar_cero' | 'excluir';

export interface SituacionOption {
  code: string;            // nc | obs | opm | ok | na
  label: string;           // NC | OBS | OPM | OK | N/A
  points: number | null;   // null para N/A
  description?: string;
  finding_type?: string;   // tipo de hallazgo sugerido al responder esta opción
  source?: string;         // de dónde se obtuvo la regla
}

export interface Band {
  label: string;
  min: number | null;      // inclusive; null = sin límite inferior
  max: number | null;      // inclusive; null = sin límite superior
  source?: string;
}

export interface SituacionConfig {
  options: SituacionOption[];
  max_points_per_item: number;
  scale_max: number;
  na_mode: CountMode;
  unanswered_mode: CountMode;
  section_formula?: string;
  final_formula?: string;
  bands: Band[];
  band_rounding?: null | number;
  provenance?: Record<string, unknown>;
}

export interface VersionLike {
  scoring_method: ScoringMethod | string;
  scoring_config: unknown;
}
export interface SectionLike { id: string; title: string; sort_order: number; deleted_at?: string | null }
export interface ItemLike {
  id: string; section_id: string; response_type: string; weight: number | string;
  is_critical: boolean; deleted_at?: string | null;
}
export type Answers = Record<string, string | null | undefined>;

export interface SectionResult {
  section_id: string; title: string; raw: number; target: number; score: number | null;
  items: number; answered: number; na: number;
}
export interface EvalResult {
  method: string;
  final: number | null;
  score: number | null;
  max_score: number | null;
  compliance_pct: number | null;
  critical_failures: number;
  band: string | null;
  sections: SectionResult[];
}

const round = (n: number, d: number) => {
  const f = 10 ** d;
  return Math.round((n + Number.EPSILON) * f) / f;
};

export function isSituacionConfig(c: unknown): c is SituacionConfig {
  const x = c as SituacionConfig;
  return !!x && Array.isArray(x.options) && typeof x.max_points_per_item === 'number'
    && typeof x.scale_max === 'number' && !!x.na_mode && !!x.unanswered_mode && Array.isArray(x.bands);
}

export function classifyBand(value: number | null, bands: Band[]): string | null {
  if (value === null || Number.isNaN(value)) return null;
  const b = bands.find(b => (b.min === null || value >= b.min) && (b.max === null || value <= b.max));
  return b ? b.label : 'sin_clasificar';
}

export function evaluate(version: VersionLike, sections: SectionLike[], items: ItemLike[], answers: Answers): EvalResult {
  const liveSections = sections.filter(s => !s.deleted_at);
  const liveIds = new Set(liveSections.map(s => s.id));
  const liveItems = items.filter(i => !i.deleted_at && liveIds.has(i.section_id));

  if (version.scoring_method === 'situacion_promedio_secciones') {
    const cfg = version.scoring_config;
    if (!isSituacionConfig(cfg)) throw new Error('scoring_config incompleta para situacion_promedio_secciones');
    const pointsOf = (code: string) => cfg.options.find(o => o.code === code)?.points ?? 0;
    const ordered = [...liveSections].sort((a, b) => a.sort_order - b.sort_order);
    const res: SectionResult[] = [];
    for (const s of ordered) {
      const its = liveItems.filter(i => i.section_id === s.id);
      if (its.length === 0) continue; // igual que el GROUP BY del servidor
      let raw = 0, counted = 0, answered = 0, na = 0;
      for (const it of its) {
        const ans = answers[it.id] || null;
        if (ans) answered++;
        if (ans === 'na') na++;
        const isCounted = ans === null ? cfg.unanswered_mode === 'contar_cero'
          : ans === 'na' ? cfg.na_mode === 'contar_cero' : true;
        if (isCounted) { counted++; raw += ans ? pointsOf(ans) : 0; }
      }
      const target = counted * cfg.max_points_per_item;
      res.push({ section_id: s.id, title: s.title, raw, target,
        score: target > 0 ? (raw / target) * cfg.scale_max : null, items: its.length, answered, na });
    }
    const scored = res.filter(r => r.score !== null).map(r => r.score as number);
    const final = scored.length ? scored.reduce((a, b) => a + b, 0) / scored.length : null;
    return {
      method: version.scoring_method,
      final,
      score: final === null ? null : round(final, 2),
      max_score: cfg.scale_max,
      compliance_pct: final === null ? null : round((final / cfg.scale_max) * 100, 2),
      critical_failures: liveItems.filter(i => i.is_critical && answers[i.id] === 'nc').length,
      band: classifyBand(final, cfg.bands),
      sections: res,
    };
  }

  // ponderado (0022: con desglose por sección, mismo criterio que el total)
  let s = 0, m = 0, c = 0;
  const secRes: SectionResult[] = [];
  for (const sec of [...liveSections].sort((a, b) => a.sort_order - b.sort_order)) {
    const its = liveItems.filter(i => i.section_id === sec.id && ['cumplimiento', 'si_no'].includes(i.response_type));
    if (!its.length) continue;
    let raw = 0, target = 0, answered = 0, na = 0;
    for (const it of its) {
      const a = answers[it.id];
      const w = Number(it.weight);
      if (a) answered++;
      if (a === 'no_aplica' || a === 'na') na++;
      if (a === 'cumple' || a === 'si') { raw += w; target += w; }
      else if (a === 'no_cumple' || a === 'no') { target += w; if (it.is_critical) c++; }
    }
    s += raw; m += target;
    secRes.push({ section_id: sec.id, title: sec.title, raw, target, score: target > 0 ? round((100 * raw) / target, 4) : null, items: its.length, answered, na });
  }
  return {
    method: 'ponderado', final: m > 0 ? (100 * s) / m : null, score: s, max_score: m,
    compliance_pct: m > 0 ? round((100 * s) / m, 2) : null, critical_failures: c, band: null, sections: secRes,
  };
}

/** Opciones de respuesta disponibles para un ítem según la metodología de su versión. */
export function answerOptions(version: VersionLike, responseType: string): { code: string; label: string }[] {
  if (responseType === 'situacion' && isSituacionConfig(version.scoring_config)) {
    return version.scoring_config.options.map(o => ({ code: o.code, label: o.label }));
  }
  if (responseType === 'si_no') return [{ code: 'si', label: 'Sí' }, { code: 'no', label: 'No' }, { code: 'no_aplica', label: 'N/A' }];
  if (responseType === 'cumplimiento') return [{ code: 'cumple', label: 'Cumple' }, { code: 'no_cumple', label: 'No cumple' }, { code: 'no_aplica', label: 'N/A' }];
  return [];
}

/** ¿La respuesta indica un desvío que normalmente genera hallazgo? */
export function deviationFindingType(version: VersionLike, answer: string | null | undefined): string | null {
  if (!answer) return null;
  if (isSituacionConfig(version.scoring_config)) {
    const o = version.scoring_config.options.find(x => x.code === answer);
    return o?.finding_type ?? null;
  }
  return answer === 'no_cumple' || answer === 'no' ? 'nc_menor' : null;
}
