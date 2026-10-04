import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../lib/supabase';
import { fmtDateTime } from './ui';

interface Row { changed_at: string; action: string; changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; user_name: string }

const FIELD: Record<string, string> = {
  status: 'Estado', title: 'Título', description: 'Descripción', root_cause: 'Causa raíz', rca_method: 'Método de análisis', rca_data: 'Análisis de causa raíz',
  due_date: 'Vencimiento', responsible_user_id: 'Responsable', responsible_company_id: 'Empresa responsable', responsible_name: 'Responsable (nombre)',
  severity: 'Severidad', finding_type: 'Tipo', requirement: 'Requisito', category: 'Categoría', process_id: 'Proceso', immediate_action: 'Acción inmediata',
  verification_notes: 'Notas de verificación', effectiveness: 'Eficacia', effectiveness_criteria: 'Criterio de eficacia', progress_notes: 'Avance',
  action_type: 'Tipo de acción', answer: 'Respuesta', comment: 'Comentario', summary: 'Conclusiones', scope: 'Alcance', lead_auditor_id: 'Auditor líder',
  company_id: 'Empresa', location_id: 'Ubicación', scheduled_date: 'Fecha', reviewed_at: 'Revisión', closed_at: 'Cierre', verified_at: 'Verificación',
  deleted_at: 'Eliminación', score: 'Puntaje', compliance_pct: 'Cumplimiento %', legal_reference: 'Referencia legal',
};
const ACTION: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Modificación', DELETE: 'Eliminación', SOFT_DELETE: 'Eliminación' };
const HIDDEN = new Set(['verified_by', 'closed_by', 'reviewed_by', 'created_by', 'answered_at', 'answered_by', 'completed_at', 'started_at', 'section_results', 'scoring_snapshot', 'recurrence_key']);
const show = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v).slice(0, 200);

/** Historial de cambios de un registro (quién, cuándo, qué cambió). Requiere conexión: el historial vive en el servidor. */
export function RecordHistory({ table, id }: { table: 'hse_audits' | 'hse_findings' | 'hse_actions' | 'hse_audit_responses' | 'hse_evidences'; id: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (!navigator.onLine) { setError('El historial se consulta con conexión.'); return; }
    let alive = true;
    void supabase.rpc('hse_record_history', { p_table: table, p_id: id }).then(({ data, error: e }) => {
      if (!alive) return;
      if (e) setError(errorMessage(e)); else setRows((data ?? []) as Row[]);
    });
    return () => { alive = false; };
  }, [open, table, id]);
  return (
    <details className="history" onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Historial de cambios</summary>
      {error ? <p className="muted small">{error}</p> : rows === null ? <p className="muted small">Cargando…</p> : rows.length === 0 ? <p className="muted small">Sin cambios registrados en el servidor (los cambios sin sincronizar aparecen al enviarse).</p> : (
        <ol className="timeline">{rows.map((r, i) => {
          const fields = (r.action === 'INSERT' ? [] : r.changed_fields ?? []).filter(f => !HIDDEN.has(f) && f !== 'row_version' && f !== 'updated_at');
          return (
            <li key={i}>
              <div className="small"><strong>{ACTION[r.action] ?? r.action}</strong> · {r.user_name} · <span className="muted">{fmtDateTime(r.changed_at)}</span></div>
              {fields.length ? <ul className="small muted">{fields.map(f => <li key={f}>{FIELD[f] ?? f}: {show(r.old_data?.[f])} → <strong>{show(r.new_data?.[f])}</strong></li>)}</ul> : null}
            </li>);
        })}</ol>
      )}
    </details>
  );
}
