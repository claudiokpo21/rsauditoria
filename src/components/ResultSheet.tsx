import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { bandFor, bandRange, bandStyle } from '../scoring/bands';
import { isSituacionConfig, type SectionResult } from '../scoring/engine';
import { normTitle, type PreviousResult } from '../modules/audits/previousAudit';
import { displayText, fmtNum } from './ui';

export interface SheetData {
  method: string;
  sections: Pick<SectionResult, 'title' | 'raw' | 'target' | 'score' | 'answered' | 'items'>[];
  final: number | null;          // nota final (H&P) o % de cumplimiento (ponderado)
  band: string | null;
  official: boolean;
}

export function BandChip({ label }: { label?: string | null }) {
  const st = bandStyle(label);
  if (!label) return <span className="muted">—</span>;
  return <span className="band-chip" style={st ? { background: st.bg, color: st.fg, borderColor: st.border } : undefined}>{label}</span>;
}

/** Celda de evaluación coloreada según la banda (como la columna "Evaluación" de la planilla). */
function EvalCell({ value, band, digits = 2, suffix = '' }: { value: number | null; band: string | null; digits?: number; suffix?: string }) {
  const st = bandStyle(band);
  return <td className="eval" style={st ? { background: st.bg, color: st.fg } : undefined} title={band ?? undefined}>{fmtNum(value, digits)}{value !== null ? suffix : ''}</td>;
}

/** Variación respecto de la auditoría anterior: ▲ mejora (verde), ▼ empeora (rojo). */
export function Delta({ now, before, situ }: { now: number | null; before: number | null | undefined; situ: boolean }) {
  if (now === null || before === null || before === undefined) return <span className="muted">—</span>;
  const d = Math.round((now - before) * 100) / 100;
  const txt = `${d > 0 ? '+' : ''}${fmtNum(d, situ ? 2 : 1)}${situ ? '' : ' pp'}`;
  if (d === 0) return <span className="delta delta-eq" title="Sin cambios">= {fmtNum(0, situ ? 2 : 1)}</span>;
  return <span className={`delta ${d > 0 ? 'delta-up' : 'delta-down'}`} title={d > 0 ? 'Mejoró' : 'Empeoró'}>{d > 0 ? '▲' : '▼'} {txt}</span>;
}

/** Cuadro "Criterio de evaluación" con los rangos de la metodología de la versión. */
export function Criteria({ config }: { config: unknown }) {
  if (!isSituacionConfig(config)) return null;
  return (
    <div className="stack" style={{ gap: '.35rem' }}>
      <div className="small muted">Criterio de evaluación</div>
      <div className="criteria" role="table" aria-label="Criterio de evaluación">
        {config.bands.map(b => {
          const st = bandStyle(b.label);
          return [<span key={b.label + 'r'} className="rng">{bandRange(b)}</span>,
                  <span key={b.label + 'l'} className="lbl" style={st ? { background: st.bg, color: st.fg } : undefined}>{b.label}</span>];
        })}
      </div>
    </div>
  );
}

/**
 * Planilla de resultado: requisitos (secciones) con puntaje alcanzado, objetivo y evaluación
 * coloreada, fila de resultado final y criterio de evaluación. Los valores provienen del
 * resultado oficial del servidor (o de la vista previa, indicado como tal).
 */
export function ResultSheet({ data, config, title, meta, extra, previous }: { data: SheetData; config: unknown; title?: string; meta?: ReactNode; extra?: ReactNode; previous?: PreviousResult | null }) {
  const situ = data.method === 'situacion_promedio_secciones';
  const bands = isSituacionConfig(config) ? config.bands : undefined;
  const st = bandStyle(data.band);
  const raw = data.sections.reduce((s, x) => s + Number(x.raw || 0), 0);
  const target = data.sections.reduce((s, x) => s + Number(x.target || 0), 0);
  return (
    <section className="sheet" aria-label="Resultado de la evaluación">
      <div className="sheet-top">
        <div className="verdict" style={st ? { background: st.bg, color: st.fg, borderColor: st.border } : undefined}>
          <span className="verdict-num">{data.final === null ? '—' : situ ? fmtNum(data.final) : `${fmtNum(data.final, 1)} %`}</span>
          <span className="verdict-band">{data.band ?? (situ ? 'Sin resultado' : 'Cumplimiento')}</span>
          <span className="verdict-note">{data.official ? 'Resultado oficial' : 'Vista previa'}</span>
        </div>
        <div className="sheet-meta">
          <h3>{title ?? (situ ? 'Resultado final de la auditoría' : 'Cumplimiento ponderado')}</h3>
          {meta}
          {situ ? <Criteria config={config} /> : null}
        </div>
      </div>
      {data.sections.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="sheet-table">
            <thead><tr>
              <th scope="col">{situ ? 'Requisitos del sistema de gestión' : 'Sección'}</th>
              <th scope="col">Puntaje alcanzado</th>
              <th scope="col">Puntaje objetivo</th>
              <th scope="col">{situ ? 'Evaluación' : 'Cumplimiento'}</th>
              {previous ? <><th scope="col" className="hide-xs">Anterior</th><th scope="col">Variación</th></> : null}
              <th scope="col" className="hide-xs">Respondidos</th>
            </tr></thead>
            <tbody>
              {data.sections.map((s, i) => {
                const v = s.score === null || s.score === undefined ? null : Number(s.score);
                return (
                  <tr key={i}>
                    <td>{displayText(String(s.title)).trim()}</td>
                    <td>{fmtNum(Number(s.raw), situ ? 0 : 2)}</td>
                    <td>{fmtNum(Number(s.target), situ ? 0 : 2)}</td>
                    {situ ? <EvalCell value={v} band={bandFor(v, bands)} /> : <td className="eval">{v === null ? '—' : `${fmtNum(v, 1)} %`}</td>}
                    {previous ? (() => { const pv = previous.sections.get(normTitle(String(s.title))); const pst = situ ? bandStyle(bandFor(pv ?? null, bands)) : null;
                      return <><td className="hide-xs prev" style={pst ? { boxShadow: `inset 4px 0 0 ${pst.bg}` } : undefined}>{pv === undefined || pv === null ? '—' : situ ? fmtNum(pv) : `${fmtNum(pv, 1)} %`}</td>
                        <td><Delta now={v} before={pv} situ={situ} /></td></>; })() : null}
                    <td className="hide-xs muted">{s.answered}/{s.items}</td>
                  </tr>
                );
              })}
              <tr className="total">
                <td>{situ ? 'Resultado final' : 'Total'}</td>
                <td>{fmtNum(raw, situ ? 0 : 2)}</td>
                <td>{fmtNum(target, situ ? 0 : 2)}</td>
                {situ ? <EvalCell value={data.final} band={data.band} /> : <td className="eval">{data.final === null ? '—' : `${fmtNum(data.final, 1)} %`}</td>}
                {previous ? <><td className="hide-xs">{previous.final === null ? '—' : situ ? fmtNum(previous.final) : `${fmtNum(previous.final, 1)} %`}</td>
                  <td><Delta now={data.final} before={previous.final} situ={situ} /></td></> : null}
                <td className="hide-xs" />
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}
      {previous ? (
        <div className="sheet-foot small">
          <span>Comparado con <Link to={`/auditorias/${previous.audit.id}`}>{previous.audit.code ?? previous.audit.title}</Link> del {previous.audit.scheduled_date ? new Date(previous.audit.scheduled_date + 'T12:00:00').toLocaleDateString('es-AR') : '—'}
            {previous.band ? <> · <BandChip label={previous.band} /></> : null}
            {previous.final !== null ? <> · {situ ? fmtNum(previous.final) : `${fmtNum(previous.final, 1)} %`}</> : null}</span>
          <span className="muted">Misma empresa y plantilla; resultados oficiales.</span>
        </div>
      ) : null}
      {extra ? <div className="sheet-foot">{extra}</div> : null}
    </section>
  );
}
