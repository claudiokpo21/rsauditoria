/**
 * Genera supabase/tests/scoring_parity.sql: compara el motor del cliente (src/scoring/engine.ts)
 * con public.hse_evaluate_answers del servidor sobre:
 *   - la metodología H&P importada (situación / promedio de secciones), incluido el caso de prueba
 *     del Excel (resultado esperado 6,271164021164021 → "Bueno"), y casos aleatorios reproducibles;
 *   - el método ponderado con pesos, críticos, N/A, sin responder, tipos no puntuables y una
 *     sección eliminada.
 * Los valores esperados los calcula el motor TS; el SQL los recalcula en el servidor y reporta
 * cualquier diferencia > 1e-9 (o de banda / conteos). Uso: npx tsx scripts/gen-scoring-parity.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { evaluate, type ItemLike, type SectionLike, type Answers } from '../src/scoring/engine';

const payload = JSON.parse(readFileSync('docs/importacion-hp/payload-importacion.json', 'utf8'));
const uuid = (seed: string) => { const h = createHash('md5').update(seed).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`; };
const r12 = (x: number | null) => (x === null ? null : Number(x.toPrecision(15)));
let s = 20261003; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };

// ---------------------------------------------------------------- H&P
const hpCfg = payload.version.scoring_config;
const hpSections: SectionLike[] = payload.sections.map((x: { key: string; title: string; sort_order: number }) => ({ id: uuid(`hp-s-${x.sort_order}`), title: x.title, sort_order: x.sort_order }));
const hpItems: (ItemLike & { key: string; idx: number })[] = [];
payload.sections.forEach((x: { key: string; sort_order: number; items: { key: string; is_critical: boolean }[] }) =>
  x.items.forEach(i => hpItems.push({ id: uuid(`hp-i-${hpItems.length}`), section_id: uuid(`hp-s-${x.sort_order}`), response_type: "situacion", weight: 1, is_critical: !!i.is_critical || hpItems.length % 7 === 0, key: i.key, idx: hpItems.length })));
const HP_CODES: Record<string, string> = { n: 'nc', o: 'obs', p: 'opm', k: 'ok', a: 'na' };
const hpChars = Object.keys(HP_CODES);

// ---------------------------------------------------------------- ponderado
const pSecDefs = [{ t: 'Gestión documental', n: 7 }, { t: 'Equipos y EPP', n: 9 }, { t: 'Sección eliminada', n: 3, deleted: true }, { t: 'Ambiente', n: 6 }];
const pSections: (SectionLike & { deleted_at?: string | null })[] = pSecDefs.map((d, k) => ({ id: uuid(`p-s-${k}`), title: d.t, sort_order: k, deleted_at: d.deleted ? '2026-10-01T00:00:00Z' : null }));
const types = ['cumplimiento', 'cumplimiento', 'si_no', 'cumplimiento', 'texto', 'si_no', 'numerico', 'cumplimiento', 'cumplimiento'];
const pItems: (ItemLike & { idx: number })[] = [];
pSecDefs.forEach((d, k) => { for (let j = 0; j < d.n; j++) pItems.push({ id: uuid(`p-i-${k}-${j}`), section_id: uuid(`p-s-${k}`), response_type: types[(j + k) % types.length], weight: 1 + ((j * 3 + k) % 5), is_critical: (j + k) % 4 === 0, idx: pItems.length }); });
const P_CODES: Record<string, string> = { c: 'cumple', x: 'no_cumple', s: 'si', n: 'no', a: 'no_aplica' };

function hpAnswers(str: string): Answers { const a: Answers = {}; [...str].forEach((ch, i) => { if (ch !== '-') a[hpItems[i].id] = HP_CODES[ch]; }); return a; }
function pAnswers(str: string): Answers { const a: Answers = {}; [...str].forEach((ch, i) => { if (ch !== '-') a[pItems[i].id] = P_CODES[ch]; }); return a; }

const cases: { m: 'hp' | 'p'; name: string; ans: string; excel?: number }[] = [];
// caso del Excel
const excel = payload.validation_cases[0];
cases.push({ m: 'hp', name: 'Caso de prueba del Excel H&P', ans: hpItems.map(i => { const c = excel.answers[i.key]; return c ? Object.entries(HP_CODES).find(([, v]) => v === c)![0] : '-'; }).join(''), excel: excel.expected.final });
cases.push({ m: 'hp', name: 'H&P: todo sin responder', ans: '-'.repeat(hpItems.length) });
cases.push({ m: 'hp', name: 'H&P: todo OK', ans: 'k'.repeat(hpItems.length) });
cases.push({ m: 'hp', name: 'H&P: todo N/A', ans: 'a'.repeat(hpItems.length) });
cases.push({ m: 'hp', name: 'H&P: todo NC', ans: 'n'.repeat(hpItems.length) });
for (let c = 0; c < 30; c++) {
  const blank = rnd() * 0.3;
  cases.push({ m: 'hp', name: `H&P aleatorio ${c + 1}`, ans: hpItems.map(() => (rnd() < blank ? '-' : hpChars[Math.floor(rnd() * hpChars.length)])).join('') });
}
cases.push({ m: 'p', name: 'Ponderado: sin respuestas', ans: '-'.repeat(pItems.length) });
cases.push({ m: 'p', name: 'Ponderado: todo N/A', ans: 'a'.repeat(pItems.length) });
for (let c = 0; c < 30; c++) {
  cases.push({ m: 'p', name: `Ponderado aleatorio ${c + 1}`, ans: pItems.map(i => {
    const r = rnd(); if (r < 0.15) return '-'; if (r < 0.25) return 'a';
    return i.response_type === 'si_no' ? (rnd() < 0.7 ? 's' : 'n') : (rnd() < 0.7 ? 'c' : 'x');
  }).join('') });
}

const q = (x: string) => x.replace(/'/g, "''");
// sólo los campos que intervienen en el cálculo (sin textos de procedencia)
const calcCfg = { options: hpCfg.options.map((o: { code: string; label: string; points: number | null; finding_type?: string }) => ({ code: o.code, label: o.label, points: o.points, ...(o.finding_type ? { finding_type: o.finding_type } : {}) })),
  max_points_per_item: hpCfg.max_points_per_item, scale_max: hpCfg.scale_max, na_mode: hpCfg.na_mode, unanswered_mode: hpCfg.unanswered_mode,
  bands: hpCfg.bands.map((b: { label: string; min: number | null; max: number | null }) => ({ label: b.label, min: b.min, max: b.max })), band_rounding: hpCfg.band_rounding ?? null };
const hpVersion = { scoring_method: 'situacion_promedio_secciones', scoring_config: hpCfg };
const pVersion = { scoring_method: 'ponderado', scoring_config: {} };
// Se ejecuta un subconjunto (límite de tamaño de la consulta en la herramienta de ejecución):
// el caso del Excel, 4 extremos y 10 aleatorios H&P; 2 extremos y 20 aleatorios ponderados.
const subset = [...cases.filter(c => c.m === 'hp').slice(0, 15), ...cases.filter(c => c.m === 'p').slice(0, 22)];
const out = subset.map(c => {
  const r = c.m === 'hp' ? evaluate(hpVersion, hpSections, hpItems, hpAnswers(c.ans)) : evaluate(pVersion, pSections, pItems, pAnswers(c.ans));
  if (c.excel !== undefined && Math.abs((r.final ?? NaN) - c.excel) > 1e-12) throw new Error(`El motor TS no reproduce el Excel: ${r.final} vs ${c.excel}`);
  return { m: c.m, name: c.name, ans: c.ans, excel: c.excel ?? null,
    e: { final: r12(r.final), score: r.score, max: r.max_score, pct: r.compliance_pct, crit: r.critical_failures, band: r.band,
      sec: r.sections.map(x => [x.raw, x.target, r12(x.score), x.items, x.answered, x.na]) } };
});

const sql = `-- =====================================================================
-- Paridad de fórmulas de evaluación: motor del cliente (TS) vs servidor (hse_evaluate_answers).
-- GENERADO por scripts/gen-scoring-parity.ts — no editar a mano. Se revierte solo.
-- ${subset.length} casos: caso del Excel H&P + aleatorios reproducibles (H&P y ponderado).
-- =====================================================================
do $$
declare
  org uuid; t uuid; t2 uuid; vhp uuid; vp uuid; hp_items uuid[]; p_items uuid[]; c jsonb; a jsonb; r jsonb; i int; ch text;
  bad jsonb := '[]'::jsonb; n int := 0; maxdiff numeric := 0; d numeric; k int; es jsonb; ss jsonb; excel_final numeric; excel_band text;
  j int; hp_sizes int[] := array[${payload.sections.map((x: { items: unknown[] }) => x.items.length).join(',')}];
  hp_titles text[] := array[${hpSections.map(x => `'${q(x.title)}'`).join(',')}];
  hp_crit boolean[] := array[${hpItems.map(i => i.is_critical).join(',')}];
  p_sizes int[] := array[${pSecDefs.map(d => d.n).join(',')}]; p_titles text[] := array[${pSecDefs.map(d => `'${q(d.t)}'`).join(',')}];
  p_types text[] := array[${types.map(x => `'${x}'`).join(',')}];
  hp_map jsonb := '{"n":"nc","o":"obs","p":"opm","k":"ok","a":"na"}'; p_map jsonb := '{"c":"cumple","x":"no_cumple","s":"si","n":"no","a":"no_aplica"}';
begin
  insert into hse_organizations (name) values ('Paridad de fórmulas (prueba)') returning id into org;
  insert into hse_templates (organization_id, name, category) values (org, 'H&P', 'csms') returning id into t;
  insert into hse_template_versions (organization_id, template_id, version_number, scoring_method, scoring_config)
    values (org, t, 1, 'situacion_promedio_secciones', '${q(JSON.stringify(calcCfg))}'::jsonb) returning id into vhp;
  -- estructura idéntica a la del generador (ids md5 determinísticos)
  k := 0;
  for i in 1 .. array_length(hp_sizes, 1) loop
    insert into hse_template_sections (id, organization_id, version_id, title, sort_order) values (md5('hp-s-' || (i - 1))::uuid, org, vhp, hp_titles[i], i - 1);
    for j in 1 .. hp_sizes[i] loop
      insert into hse_template_items (id, organization_id, version_id, section_id, question, response_type, weight, is_critical, sort_order)
      values (md5('hp-i-' || k)::uuid, org, vhp, md5('hp-s-' || (i - 1))::uuid, 'R ' || k, 'situacion', 1, hp_crit[k + 1], k);
      k := k + 1;
    end loop;
  end loop;
  insert into hse_templates (organization_id, name, category) values (org, 'Ponderada', 'seguridad_higiene') returning id into t2;
  insert into hse_template_versions (organization_id, template_id, version_number, scoring_method, scoring_config)
    values (org, t2, 1, 'ponderado', '{}'::jsonb) returning id into vp;
  k := 0;
  for i in 0 .. array_length(p_sizes, 1) - 1 loop
    insert into hse_template_sections (id, organization_id, version_id, title, sort_order) values (md5('p-s-' || i)::uuid, org, vp, p_titles[i + 1], i);
    for j in 0 .. p_sizes[i + 1] - 1 loop
      insert into hse_template_items (id, organization_id, version_id, section_id, question, response_type, weight, is_critical, sort_order)
      values (md5('p-i-' || i || '-' || j)::uuid, org, vp, md5('p-s-' || i)::uuid, 'P ' || k, p_types[((j + i) % 9) + 1]::hse_response_type, 1 + ((j * 3 + i) % 5), (j + i) % 4 = 0, k);
      k := k + 1;
    end loop;
  end loop;
  update hse_template_sections set deleted_at = now() where id = md5('p-s-2')::uuid;
  hp_items := array(select md5('hp-i-' || g)::uuid from generate_series(0, ${hpItems.length - 1}) g);
  p_items := array(select i.id from hse_template_items i where i.version_id = vp order by i.sort_order);

  for c in select value from jsonb_array_elements('${q(JSON.stringify(out))}'::jsonb) loop
    n := n + 1; a := '{}'::jsonb;
    for i in 1 .. length(c ->> 'ans') loop
      ch := substr(c ->> 'ans', i, 1);
      if ch <> '-' then
        if c ->> 'm' = 'hp' then a := a || jsonb_build_object(hp_items[i]::text, hp_map ->> ch);
        else a := a || jsonb_build_object(p_items[i]::text, p_map ->> ch); end if;
      end if;
    end loop;
    r := hse_evaluate_answers(case when c ->> 'm' = 'hp' then vhp else vp end, a);
    es := c -> 'e';
    if (r ->> 'final') is distinct from null or (es ->> 'final') is distinct from null then
      d := abs(coalesce((r ->> 'final')::numeric, -999) - coalesce((es ->> 'final')::numeric, -999)); maxdiff := greatest(maxdiff, d);
      if d > 1e-9 then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'final', 'ts', es -> 'final', 'sql', r -> 'final'); end if;
    end if;
    if abs(coalesce((r ->> 'score')::numeric, -999) - coalesce((es ->> 'score')::numeric, -999)) > 1e-9 then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'score', 'ts', es -> 'score', 'sql', r -> 'score'); end if;
    if abs(coalesce((r ->> 'max_score')::numeric, -999) - coalesce((es ->> 'max')::numeric, -999)) > 1e-9 then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'max_score', 'ts', es -> 'max', 'sql', r -> 'max_score'); end if;
    if abs(coalesce((r ->> 'compliance_pct')::numeric, -999) - coalesce((es ->> 'pct')::numeric, -999)) > 1e-9 then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'compliance_pct', 'ts', es -> 'pct', 'sql', r -> 'compliance_pct'); end if;
    if (r ->> 'critical_failures')::int is distinct from (es ->> 'crit')::int then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'critical_failures', 'ts', es -> 'crit', 'sql', r -> 'critical_failures'); end if;
    if (r ->> 'band') is distinct from (es ->> 'band') then bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'band', 'ts', es -> 'band', 'sql', r -> 'band'); end if;
    if jsonb_array_length(r -> 'sections') <> jsonb_array_length(es -> 'sec') then
      bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'secciones', 'ts', jsonb_array_length(es -> 'sec'), 'sql', jsonb_array_length(r -> 'sections'));
    else
      for k in 0 .. jsonb_array_length(r -> 'sections') - 1 loop
        ss := r -> 'sections' -> k;
        if abs((ss ->> 'raw')::numeric - (es -> 'sec' -> k ->> 0)::numeric) > 1e-9 or abs((ss ->> 'target')::numeric - (es -> 'sec' -> k ->> 1)::numeric) > 1e-9
           or abs(coalesce((ss ->> 'score')::numeric, -999) - coalesce((es -> 'sec' -> k ->> 2)::numeric, -999)) > 1e-9
           or (ss ->> 'items')::int <> (es -> 'sec' -> k ->> 3)::int or (ss ->> 'answered')::int <> (es -> 'sec' -> k ->> 4)::int or (ss ->> 'na')::int <> (es -> 'sec' -> k ->> 5)::int then
          bad := bad || jsonb_build_object('caso', c ->> 'name', 'campo', 'sección ' || k, 'ts', es -> 'sec' -> k, 'sql', ss);
        end if;
      end loop;
    end if;
    if c ->> 'excel' is not null then excel_final := (r ->> 'final')::numeric; excel_band := r ->> 'band'; end if;
  end loop;
  raise exception 'RESULTADO_PARIDAD %', jsonb_build_object('casos', n, 'diferencias', jsonb_array_length(bad), 'max_diff_final', maxdiff,
    'excel_final_servidor', excel_final, 'excel_final_esperado', ${excel.expected.final}, 'excel_banda', excel_band, 'detalle', bad);
end $$;
`;
writeFileSync('supabase/tests/scoring_parity.sql', sql);
console.log(`scoring_parity.sql: ${subset.length} casos, ${(sql.length / 1024).toFixed(1)} KB`);
