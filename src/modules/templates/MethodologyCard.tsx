import { Card } from '../../components/ui';
import { isSituacionConfig } from '../../scoring/engine';
import type { TemplateVersion } from '../../types';

/** Muestra las reglas de puntuación registradas en la versión (y su origen). */
export function MethodologyCard({ version }: { version: TemplateVersion }) {
  const c = version.scoring_config;
  if (version.scoring_method !== 'situacion_promedio_secciones' || !isSituacionConfig(c)) {
    return (
      <Card title={`Metodología de puntuación · v${version.version_number}`}>
        <p className="small">Ponderada: <strong>Cumple / Sí</strong> suma el peso del ítem; <strong>No cumple / No</strong> suma 0; <strong>N/A</strong> y los ítems sin responder quedan fuera del máximo. Cumplimiento = obtenido / máximo × 100. Los ítems marcados como críticos con desvío se informan aparte.</p>
      </Card>
    );
  }
  return (
    <Card title={`Metodología de puntuación · v${version.version_number}`}>
      <div className="grid grid-2">
        <div>
          <table className="t"><thead><tr><th>Opción</th><th className="num">Puntos</th><th>Origen</th></tr></thead>
            <tbody>{c.options.map(o => <tr key={o.code}><td><strong>{o.label}</strong></td><td className="num">{o.points ?? '—'}</td><td className="small muted">{o.source}</td></tr>)}</tbody></table>
        </div>
        <div className="stack small">
          <div><strong>Nota de sección:</strong> {c.section_formula}</div>
          <div><strong>Resultado final:</strong> {c.final_formula}</div>
          <div><strong>N/A:</strong> {c.na_mode === 'contar_cero' ? 'suma 0 y cuenta en el objetivo (comportamiento literal del origen)' : 'se excluye del objetivo'}</div>
          <div><strong>Sin responder:</strong> {c.unanswered_mode === 'contar_cero' ? 'suma 0 y cuenta en el objetivo' : 'se excluye del objetivo'}</div>
          <table className="t"><thead><tr><th>Calificación</th><th className="num">Desde</th><th className="num">Hasta</th></tr></thead>
            <tbody>{c.bands.map(b => <tr key={b.label}><td>{b.label}</td><td className="num">{b.min ?? '—'}</td><td className="num">{b.max ?? '—'}</td></tr>)}</tbody></table>
          <p className="muted">Límites sin redondeo, tal como en el origen. Una nota fuera de toda banda se informa como "sin clasificar".</p>
        </div>
      </div>
    </Card>
  );
}
