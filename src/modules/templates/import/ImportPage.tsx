import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, errorMessage } from '../../../lib/supabase';
import { runSync } from '../../../sync/scheduler';
import { useAuth, can } from '../../auth/AuthProvider';
import { useOrgRows } from '../../../db/hooks';
import { Badge, Button, Card, Empty, Field, Input, PageHeader, Select, Stat, TextArea, displayText, fmtNum, useToast } from '../../../components/ui';
import { parseHpChecklist, toImportPayload, type ParseResult } from './hpChecklistParser';
import { renderReportMarkdown } from './report';
import type { Template } from '../../../types';

const sevTone = { bloqueante: 'bad', advertencia: 'warn', info: 'info' } as const;

export function ImportPage() {
  const { orgId, role } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const templates = useOrgRows<Template>('hse_templates') ?? [];
  const [res, setRes] = useState<ParseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [target, setTarget] = useState('');            // '' = plantilla nueva; id = nueva versión de una existente

  if (!can(role, 'templates')) return <Empty>Sólo supervisores y administradores importan plantillas.</Empty>;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setRes(null); setBusy(true);
    try {
      if (f.size > 20 * 1024 * 1024) throw new Error('El archivo supera 20 MB.');
      const r = await parseHpChecklist(await f.arrayBuffer(), f.name);
      setRes(r); setName(r.template.name); setDesc(r.template.description);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const download = () => {
    if (!res) return;
    const blob = new Blob([renderReportMarkdown(res)], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `reporte-importacion-${res.fileName.replace(/\.[^.]+$/, '')}.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const doImport = async () => {
    if (!res) return;
    setBusy(true);
    try {
      const payload = toImportPayload(res, { name, description: desc, templateId: target || undefined, report: {
        stats: res.stats, diagnosis: res.diagnosis, formulas: res.formulas, cellMap: res.cellMap,
        comparison: res.comparison.rows, alternativeFinal: res.alternativeFinal,
        excluded: res.excludedExecutionData.map(e => ({ field: e.field, count: e.count })), markdown: renderReportMarkdown(res),
      } });
      const { data, error } = await supabase.rpc('hse_import_template', { p_org: orgId, p_payload: payload });
      if (error) throw error;
      const r = data as { template_id: string; validation_runs: { matches: boolean }[] };
      await runSync();
      toast(r.validation_runs.every(x => x.matches) ? 'Importada como borrador. El servidor reproduce los resultados del Excel.' : 'Importada como borrador, pero el servidor NO reproduce los resultados: revise.', r.validation_runs.every(x => x.matches) ? 'ok' : 'bad');
      nav(`/plantillas/${r.template_id}`);
    } catch (e) { toast(errorMessage(e), 'bad'); } finally { setBusy(false); }
  };

  const s = res?.stats;
  return (
    <div className="stack-lg">
      <PageHeader title="Importar lista de verificación (Excel)" subtitle="Formato: Lista de verificación de Auditoría a Segundas Partes (H&P). El análisis se hace en este dispositivo; los datos de la auditoría de ejemplo no se importan." />
      <Card>
        <div className="row gap wrap">
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={e => void onFile(e.target.files?.[0])} disabled={busy} />
          {busy && !res ? <span className="muted">Analizando…</span> : null}
        </div>
        {err ? <div className="alert alert-bad" style={{ marginTop: '.75rem' }}>{err}</div> : null}
      </Card>

      {res && s ? <>
        <div className="grid grid-4">
          <Stat label="Categorías" value={s.categorias} />
          <Stat label="Requisitos" value={s.preguntas} sub={`${s.preguntas_sin_numero} sin número`} />
          <Stat label="Procesos" value={s.procesos_catalogo} sub={`${s.procesos_usados} en uso`} />
          <Stat label="Fórmulas" value={`${s.formulas_identificadas}/${s.formulas_total}`} sub="identificadas" />
          <Stat label="Duplicados / saltos" value={`${s.numeros_duplicados} / ${s.saltos_numeracion}`} tone={s.numeros_duplicados + s.saltos_numeracion ? 'warn' : undefined} />
          <Stat label="Requieren revisión" value={s.incidencias_advertencia} tone={s.incidencias_advertencia ? 'warn' : 'ok'} sub={`${s.incidencias_bloqueantes} bloqueantes`} />
          <Stat label="Reproduce el Excel" value={res.comparison.allMatch ? 'Sí' : 'No'} tone={res.comparison.allMatch ? 'ok' : 'bad'} sub={`Final ${fmtNum(res.comparison.local?.final, 4)} · ${res.comparison.local?.band ?? '—'}`} />
        </div>

        <Card title="Diagnóstico de hojas">
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Hoja</th><th>Rango</th><th className="num">Fórmulas</th><th className="num">Combinadas</th><th className="num">Formato cond.</th><th>Rol</th></tr></thead>
            <tbody>{res.diagnosis.map(d => <tr key={d.name}><td><strong>{d.name}</strong></td><td className="mono">{d.dimension}</td><td className="num">{d.formulas}</td><td className="num">{d.merges}</td><td className="num">{d.conditionalFormats}</td><td>{d.role}</td></tr>)}</tbody>
          </table></div>
        </Card>

        <Card title="Comparación con los resultados del Excel">
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Concepto</th><th className="num">Excel</th><th className="num">Calculado</th><th>Coincide</th></tr></thead>
            <tbody>{res.comparison.rows.map(r => <tr key={r.label}><td>{r.label}</td><td className="num">{fmtNum(r.expected, 4)}</td><td className="num">{fmtNum(r.computed, 4)}</td><td>{r.ok ? <Badge tone="ok">Sí</Badge> : <Badge tone="bad">No</Badge>}</td></tr>)}</tbody>
          </table></div>
          {res.alternativeFinal ? <p className="muted small">Referencia: {res.alternativeFinal.label} = {fmtNum(res.alternativeFinal.value, 4)} ({res.alternativeFinal.source}). No es el criterio del libro.</p> : null}
        </Card>

        <Card title={`Elementos que requieren revisión (${res.issues.filter(i => i.severity !== 'info').length})`}>
          <div className="table-wrap"><table className="t">
            <thead><tr><th>Severidad</th><th>Tipo</th><th>Origen</th><th>Detalle</th></tr></thead>
            <tbody>{[...res.issues].sort((a, b) => ({ bloqueante: 0, advertencia: 1, info: 2 }[a.severity] - { bloqueante: 0, advertencia: 1, info: 2 }[b.severity])).map((i, n) => (
              <tr key={n}><td><Badge tone={sevTone[i.severity]}>{i.severity}</Badge></td><td className="small">{i.issue_type.replace(/_/g, ' ')}</td><td className="small mono">{i.source_ref ?? '—'}</td><td className="small">{i.message}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>

        <Card title="Vista previa de la plantilla">
          <div className="stack">
            {res.sections.map(sec => (
              <details key={sec.key} className="section-block">
                <summary className="section-head"><h3>{sec.title.trim()}</h3><span className="muted small">{sec.items.length} requisitos</span></summary>
                {sec.items.map(i => (
                  <div className="item" key={i.key}><div className="item-q"><span className="item-num">{i.original_number ?? 's/n'}</span>
                    <div className="grow"><div className="pre">{displayText(i.question)}</div>
                      <div className="row gap small muted wrap">{i.process ? <Badge>{i.process}</Badge> : <Badge tone="warn">sin proceso</Badge>}{i.review_flags.map(f => <Badge key={f} tone="warn">{f.replace(/_/g, ' ')}</Badge>)}<span className="mono">{i.source_ref}</span></div>
                    </div></div></div>
                ))}
              </details>
            ))}
          </div>
        </Card>

        <Card title="Datos excluidos (no se importan)">
          <ul className="small">{res.excludedExecutionData.map(e => <li key={e.field}>{e.field}: <strong>{e.count}</strong> celdas</li>)}</ul>
        </Card>

        <Card title="Importar como borrador">
          <div className="stack">
            <Field label="Destino"><Select value={target} onChange={e => setTarget(e.target.value)} options={[{ value: '', label: 'Plantilla nueva' }, ...templates.map(t => ({ value: t.id, label: `Nueva versión de: ${t.name}` }))]} /></Field>
            {!target ? <>
              <Field label="Nombre de la plantilla"><Input value={name} onChange={e => setName(e.target.value)} /></Field>
              <Field label="Descripción"><TextArea value={desc} onChange={e => setDesc(e.target.value)} /></Field>
            </> : null}
            <div className="alert alert-info small">La versión se crea en <strong>borrador con validación pendiente</strong>, con la metodología, las incidencias y el caso de validación. El servidor vuelve a calcular el caso; no podrá publicarse hasta revisar las incidencias y validarla.</div>
            <div className="row gap wrap">
              <Button busy={busy} disabled={!navigator.onLine || s.incidencias_bloqueantes > 0} onClick={doImport}>Importar</Button>
              <Button variant="secondary" onClick={download}>Descargar reporte (.md)</Button>
              {!navigator.onLine ? <span className="muted small">Requiere conexión.</span> : null}
              {s.incidencias_bloqueantes > 0 ? <span className="muted small">Hay incidencias bloqueantes: el archivo no puede importarse con certeza.</span> : null}
            </div>
          </div>
        </Card>
      </> : null}
    </div>
  );
}
