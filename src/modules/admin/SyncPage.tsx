import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, wipeLocalData, type OutboxOp } from '../../db/db';
import { supabase } from '../../lib/supabase';
import { discardOp, resetCursors, resolveConflict, retryOp } from '../../sync/engine';
import { runSync, useSyncState } from '../../sync/scheduler';
import { EXPIRE_DAYS, LOCAL_RETENTION_DAYS, OFFLINE_GRACE_DAYS, pruneLocal } from '../../sync/retention';
import { useAuth, can } from '../auth/AuthProvider';
import { Badge, Button, Card, Empty, Modal, PageHeader, Stat, fmtDateTime, useToast } from '../../components/ui';
import { env } from '../../lib/env';

const TABLE: Record<string, string> = { hse_audits: 'Auditoría', hse_audit_responses: 'Respuesta', hse_findings: 'Hallazgo', hse_actions: 'Acción', hse_evidences: 'Evidencia', hse_companies: 'Empresa', hse_locations: 'Ubicación', hse_processes: 'Proceso', hse_templates: 'Plantilla', hse_template_versions: 'Versión', hse_template_sections: 'Sección', hse_template_items: 'Ítem', hse_template_import_issues: 'Incidencia' };
const STATUS: Record<OutboxOp['status'], { label: string; tone: 'warn' | 'info' | 'bad' }> = {
  pendiente: { label: 'Pendiente', tone: 'warn' }, enviando: { label: 'Enviando', tone: 'info' },
  error: { label: 'Error (reintento automático)', tone: 'bad' }, rechazado: { label: 'Rechazado', tone: 'bad' }, conflicto: { label: 'Conflicto', tone: 'bad' },
};
const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function SyncPage() {
  const { orgId, role, signOut } = useAuth();
  const s = useSyncState();
  const toast = useToast();
  const ops = useLiveQuery(() => db.outbox.where('organization_id').equals(orgId).sortBy('seq'), [orgId]) ?? [];
  const log = useLiveQuery(() => db.sync_log.where('organization_id').equals(orgId).reverse().limit(15).toArray(), [orgId]) ?? [];
  const confirmed = useLiveQuery(() => db.op_log.where('organization_id').equals(orgId).reverse().limit(30).toArray(), [orgId]) ?? [];
  const blobs = useLiveQuery(() => db.blobs.count(), []) ?? 0;
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [server, setServer] = useState<{ device_id: string; pushed: number; pulled: number; failed: number; conflicts: number; created_at: string; app_version: string | null }[]>([]);
  const [discard, setDiscard] = useState<number | null>(null);
  const [conflict, setConflict] = useState<OutboxOp | null>(null);
  const [wipe, setWipe] = useState(false);

  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      setStorage({ usage: est?.usage, quota: est?.quota, persisted: await navigator.storage?.persisted?.() });
    })();
    if (navigator.onLine && can(role, 'admin')) void supabase.from('hse_sync_events').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }).limit(20).then(({ data }) => setServer((data ?? []) as never));
  }, [orgId, role, s.lastAt]);

  const mb = (b?: number) => (b === undefined ? '—' : `${(b / 1048576).toFixed(1)} MB`);
  const local = conflict ? (conflict.payload as Record<string, unknown>) : {};

  return (
    <div className="stack-lg">
      <PageHeader title="Sincronización" subtitle={`Versión ${env.appVersion} · entorno ${env.mode}`}
        actions={<>
          <Button variant="secondary" disabled={!s.online} onClick={async () => { await resetCursors(orgId); await runSync(); toast('Descarga completa realizada'); }}>Descargar todo de nuevo</Button>
          <Button busy={s.running} disabled={!s.online} onClick={() => void runSync()}>Sincronizar ahora</Button>
        </>} />
      <div className="grid grid-4">
        <Stat label="Estado" value={<span style={{ fontSize: '1.05rem' }} data-testid="sync-phase">{{ sin_conexion: 'Sin conexión', pendiente: 'Pendiente de sincronizar', sincronizando: 'Sincronizando', sincronizado: 'Sincronizado', error: 'Error' }[s.phase]}</span>} tone={s.phase === 'sincronizado' ? 'ok' : s.phase === 'error' ? 'bad' : 'warn'} sub={s.progress ?? undefined} />
        <Stat label="Pendientes de envío" value={s.pending} tone={s.pending ? 'warn' : 'ok'} />
        <Stat label="Conflictos / rechazos / errores" value={`${s.conflicts} / ${s.rejected} / ${s.errors}`} tone={s.conflicts + s.rejected + s.errors ? 'bad' : 'ok'} />
        <Stat label="Última sincronización confirmada" value={<span style={{ fontSize: '1rem' }} data-testid="last-confirmed">{fmtDateTime(s.lastConfirmed)}</span>} sub={s.lastResult?.error ?? (s.lastResult ? `Último intento ${fmtDateTime(s.lastAt)}: ↑${s.lastResult.pushed} ↓${s.lastResult.pulled}` : undefined)} />
      </div>
      <p className="muted small">"Confirmada" significa que el servidor devolvió el recibo de cada cambio pendiente y la descarga terminó sin errores. Cada operación lleva una clave de idempotencia: reenviarla nunca duplica datos.</p>

      <Card title={`Cola de operaciones (${ops.length})`}>
        {ops.length === 0 ? <p className="muted small">No hay cambios pendientes: el servidor confirmó todo.</p> : (
          <div className="table-wrap"><table className="t" data-testid="outbox">
            <thead><tr><th>#</th><th>Entidad</th><th>Cambio</th><th>Creado</th><th>Estado</th><th /></tr></thead>
            <tbody>{ops.map(o => (
              <tr key={o.seq} data-status={o.status}>
                <td className="mono">{o.seq}</td><td>{TABLE[o.table] ?? o.table}<div className="muted small mono">{o.record_id.slice(0, 8)}</div></td>
                <td className="small">{o.base ? `Modifica: ${Object.keys(o.payload).filter(k => !['id', 'organization_id', 'client_updated_at'].includes(k)).join(', ')}` : 'Alta'}{o.kind === 'upload' ? ` · archivo ${o.file_state === 'subido' ? 'recibido' : 'pendiente'}` : ''}</td>
                <td className="small">{fmtDateTime(o.created_at)}{o.attempts ? <div className="muted">{o.attempts} intentos</div> : null}</td>
                <td><Badge tone={STATUS[o.status].tone}>{STATUS[o.status].label}</Badge>{o.last_error ? <div className="small" style={{ color: 'var(--bad)' }}>{o.last_error}</div> : null}{o.status === 'error' && o.next_attempt_at ? <div className="small muted">Próximo intento {fmtDateTime(o.next_attempt_at)}</div> : null}</td>
                <td className="num"><div className="row gap">
                  {o.status === 'conflicto' ? <Button className="btn-sm" onClick={() => setConflict(o)}>Resolver</Button> : null}
                  {['error', 'rechazado'].includes(o.status) ? <Button variant="secondary" className="btn-sm" onClick={async () => { await retryOp(o.seq!); void runSync(); }}>Reintentar</Button> : null}
                  {o.status !== 'enviando' && o.status !== 'pendiente' ? <Button variant="ghost" className="btn-sm" onClick={() => setDiscard(o.seq!)}>Descartar</Button> : null}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Card>

      <div className="grid grid-2">
        <Card title="Intentos de sincronización">
          {log.length === 0 ? <p className="muted small">Sin registros.</p> : (
            <table className="t"><tbody>{log.map(l => <tr key={l.id}><td className="small">{fmtDateTime(l.at)}</td><td className="small">↑{l.pushed} ↓{l.pulled}{l.failed ? ` · ${l.failed} err.` : ''}{l.conflicts ? ` · ${l.conflicts} confl.` : ''}</td><td>{l.confirmed ? <Badge tone="ok">Confirmada</Badge> : l.error ? <Badge tone="bad">Error</Badge> : <Badge tone="warn">Parcial</Badge>}</td><td className="small muted">{l.error ?? `${l.duration_ms} ms`}</td></tr>)}</tbody></table>
          )}
        </Card>
        <Card title="Recibos del servidor (últimos)">
          {confirmed.length === 0 ? <p className="muted small">Sin recibos todavía.</p> : (
            <table className="t"><tbody>{confirmed.map(c => <tr key={c.id}><td className="small">{fmtDateTime(c.at)}</td><td className="small">{TABLE[c.table] ?? c.table}</td><td className="small">{c.result}{c.row_version ? ` · v${c.row_version}` : ''}</td><td className="mono small muted">{c.op_id.slice(0, 8)}</td></tr>)}</tbody></table>
          )}
        </Card>
      </div>

      <Card title="Almacenamiento y seguridad del dispositivo">
        <div className="stack small">
          <div>Uso: <strong>{mb(storage.usage)}</strong> de {mb(storage.quota)} · {blobs} archivos de evidencia guardados (cifrados con AES-GCM, clave no exportable).</div>
          <div>Almacenamiento persistente: {storage.persisted ? <Badge tone="ok">Sí</Badge> : <><Badge tone="warn">No</Badge> <Button variant="ghost" className="btn-sm" onClick={async () => { const ok = await navigator.storage?.persist?.(); setStorage(x => ({ ...x, persisted: ok })); toast(ok ? 'El navegador conservará los datos' : 'El navegador no lo otorgó (instale la app o úsela con frecuencia)', ok ? 'ok' : 'bad'); }}>Solicitar</Button></>}</div>
          <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
            <li>Los permisos se revalidan en el servidor en cada sincronización; lo que se ve sin conexión es una copia.</li>
            <li>Sin revalidar la sesión por más de {OFFLINE_GRACE_DAYS} días, la app se bloquea hasta reconectar. A los {EXPIRE_DAYS} días se eliminan los datos ya sincronizados.</li>
            <li>Auditorías cerradas con más de {LOCAL_RETENTION_DAYS} días se quitan del dispositivo, salvo las marcadas "disponible sin conexión".</li>
            <li>Cerrar sesión borra todos los datos locales y destruye la clave de cifrado.</li>
          </ul>
          <div className="row gap wrap">
            <Button variant="secondary" className="btn-sm" onClick={async () => toast(`${await pruneLocal(orgId)} auditorías antiguas quitadas del dispositivo`)}>Aplicar retención ahora</Button>
            <Button variant="danger" className="btn-sm" onClick={() => setWipe(true)}>Borrar datos de este dispositivo</Button>
          </div>
        </div>
      </Card>

      {can(role, 'admin') ? <Card title="Dispositivos (registro del servidor)">
        {server.length === 0 ? <Empty>Sin registros.</Empty> : <div className="table-wrap"><table className="t"><thead><tr><th>Fecha</th><th>Dispositivo</th><th className="num">Enviados</th><th className="num">Recibidos</th><th className="num">Errores</th><th className="num">Conflictos</th><th>Versión</th></tr></thead>
          <tbody>{server.map((e, i) => <tr key={i}><td className="small">{fmtDateTime(e.created_at)}</td><td className="mono small">{e.device_id.slice(0, 8)}</td><td className="num">{e.pushed}</td><td className="num">{e.pulled}</td><td className="num">{e.failed}</td><td className="num">{e.conflicts}</td><td className="small">{e.app_version}</td></tr>)}</tbody></table></div>}
      </Card> : null}

      <Modal wide open={!!conflict} title="Resolver conflicto" onClose={() => setConflict(null)}
        footer={<><Button variant="secondary" onClick={() => setConflict(null)}>Cancelar</Button>
          <Button variant="secondary" onClick={async () => { await resolveConflict(conflict!.seq!, 'servidor'); setConflict(null); toast('Se adoptó la versión del servidor'); }}>Usar la del servidor</Button>
          <Button onClick={async () => { await resolveConflict(conflict!.seq!, 'mio'); setConflict(null); void runSync(); toast('Se reenviará su versión'); }}>Mantener la mía</Button></>}>
        {conflict ? <>
          <div className="alert alert-warn small">{conflict.last_error}. Nada se sobrescribió: elija qué versión conservar para cada caso.</div>
          <div className="table-wrap"><table className="t t-stack" data-testid="conflict-table"><thead><tr><th>Campo</th><th>Valor al editar</th><th>Su cambio</th><th>Servidor (otro usuario)</th></tr></thead>
            <tbody>{Object.keys(local).filter(k => !['id', 'organization_id', 'client_updated_at'].includes(k)).map(k => (
              <tr key={k} style={conflict.conflict?.fields.includes(k) ? { background: 'var(--warn-soft)' } : undefined}>
                <td className="mono" data-label="Campo">{k}</td><td className="small" data-label="Valor al editar">{show(conflict.base?.[k])}</td><td className="small" data-label="Su cambio"><strong>{show(local[k])}</strong></td><td className="small" data-label="Servidor (otro usuario)"><strong>{show(conflict.conflict?.server_row[k])}</strong></td>
              </tr>))}</tbody></table></div>
        </> : null}
      </Modal>
      <Modal open={discard !== null} title="Descartar cambio" onClose={() => setDiscard(null)} footer={<><Button variant="secondary" onClick={() => setDiscard(null)}>Cancelar</Button><Button variant="danger" onClick={async () => { await discardOp(discard!); setDiscard(null); toast('Cambio descartado'); }}>Descartar</Button></>}>
        <p>El cambio no se enviará y el registro volverá a la versión del servidor. No se puede deshacer.</p>
      </Modal>
      <Modal open={wipe} title="Borrar datos de este dispositivo" onClose={() => setWipe(false)}
        footer={<><Button variant="secondary" onClick={() => setWipe(false)}>Cancelar</Button><Button variant="danger" onClick={async () => { await wipeLocalData(); await signOut(true); }}>{ops.length ? `Borrar y perder ${ops.length} cambios` : 'Borrar y cerrar sesión'}</Button></>}>
        {ops.length ? <div className="alert alert-bad">Hay <strong>{ops.length}</strong> cambios que el servidor todavía no confirmó. Si borra ahora se perderán definitivamente. Conéctese y sincronice antes.</div> : <p>Se eliminarán las auditorías, evidencias y la clave de cifrado de este dispositivo, y se cerrará la sesión. Los datos del servidor no se modifican.</p>}
      </Modal>
    </div>
  );
}
