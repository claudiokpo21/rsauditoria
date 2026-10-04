import { useEffect, useState } from 'react';
import { supabase, errorMessage } from '../../lib/supabase';
import { useAuth, can } from '../auth/AuthProvider';
import { useProfiles } from '../../db/hooks';
import { Badge, Button, Empty, Input, Modal, PageHeader, Select, fmtDateTime } from '../../components/ui';

interface LogRow { id: number; table_name: string; record_id: string; action: string; changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; user_id: string | null; changed_at: string }
const TABLES: Record<string, string> = {
  hse_audits: 'Auditorías', hse_audit_responses: 'Respuestas', hse_findings: 'Hallazgos', hse_actions: 'Acciones', hse_evidences: 'Evidencias',
  hse_templates: 'Plantillas', hse_template_versions: 'Versiones', hse_companies: 'Empresas', hse_locations: 'Ubicaciones',
  hse_processes: 'Procesos', hse_memberships: 'Miembros', hse_template_import_issues: 'Incidencias de importación',
};
const ACT: Record<string, string> = { INSERT: 'Alta', UPDATE: 'Modificación', DELETE: 'Baja', SOFT_DELETE: 'Eliminación' };
const PAGE = 50;

/** Historial de cambios (auditoría de la base, sólo lectura, requiere conexión). */
export function HistoryPage() {
  const { orgId, role } = useAuth();
  const people = useProfiles();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [page, setPage] = useState(0);
  const [table, setTable] = useState('');
  const [day, setDay] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<LogRow | null>(null);
  useEffect(() => {
    if (!navigator.onLine || !can(role, 'master')) return;
    let q = supabase.from('hse_change_log').select('*').eq('organization_id', orgId).order('changed_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    if (table) q = q.eq('table_name', table);
    if (day) q = q.gte('changed_at', `${day}T00:00:00`).lte('changed_at', `${day}T23:59:59`);
    q.then(({ data, error }) => { if (error) setErr(errorMessage(error)); else { setErr(null); setRows((data ?? []) as LogRow[]); } });
  }, [orgId, page, table, day, role]);
  if (!can(role, 'master')) return <Empty>El historial es visible para supervisores y administradores.</Empty>;
  if (!navigator.onLine) return <Empty>El historial se consulta con conexión.</Empty>;
  const label = (r: LogRow) => String((r.new_data ?? r.old_data)?.['code'] ?? (r.new_data ?? r.old_data)?.['title'] ?? (r.new_data ?? r.old_data)?.['name'] ?? r.record_id.slice(0, 8));
  return (
    <div>
      <PageHeader title="Historial de cambios" subtitle="Registro inalterable generado por la base de datos (quién, qué y cuándo)." />
      <div className="row gap wrap" style={{ marginBottom: '1rem' }}>
        <Select placeholder="Todas las entidades" value={table} onChange={e => { setTable(e.target.value); setPage(0); }} options={Object.entries(TABLES).map(([value, l]) => ({ value, label: l }))} style={{ maxWidth: 240 }} />
        <Input type="date" value={day} onChange={e => { setDay(e.target.value); setPage(0); }} style={{ maxWidth: 180 }} />
      </div>
      {err ? <div className="alert alert-bad">{err}</div> : null}
      {rows.length === 0 ? <Empty>Sin registros.</Empty> : (
        <div className="table-wrap"><table className="t">
          <thead><tr><th>Fecha</th><th>Usuario</th><th>Entidad</th><th>Registro</th><th>Acción</th><th>Campos</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className="clickable" onClick={() => setSel(r)}>
              <td className="small">{fmtDateTime(r.changed_at)}</td><td>{r.user_id ? people.get(r.user_id) ?? r.user_id.slice(0, 8) : 'sistema'}</td>
              <td>{TABLES[r.table_name] ?? r.table_name}</td><td className="small">{label(r)}</td>
              <td><Badge tone={r.action === 'INSERT' ? 'ok' : r.action.includes('DELETE') ? 'bad' : 'info'}>{ACT[r.action] ?? r.action}</Badge></td>
              <td className="small muted">{r.changed_fields?.filter(f => f !== 'updated_at').join(', ')}</td>
            </tr>))}</tbody>
        </table></div>
      )}
      <div className="row gap" style={{ marginTop: '1rem' }}>
        <Button variant="secondary" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
        <span className="muted small">Página {page + 1}</span>
        <Button variant="secondary" disabled={rows.length < PAGE} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
      </div>
      <Modal wide open={!!sel} title="Detalle del cambio" onClose={() => setSel(null)}>
        {sel ? <div className="table-wrap"><table className="t"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead>
          <tbody>{(sel.changed_fields ?? Object.keys(sel.new_data ?? sel.old_data ?? {})).filter(f => !['updated_at', 'client_updated_at'].includes(f)).map(f => (
            <tr key={f}><td className="mono">{f}</td><td className="small pre">{JSON.stringify(sel.old_data?.[f] ?? null)}</td><td className="small pre">{JSON.stringify(sel.new_data?.[f] ?? null)}</td></tr>
          ))}</tbody></table></div> : null}
      </Modal>
    </div>
  );
}
