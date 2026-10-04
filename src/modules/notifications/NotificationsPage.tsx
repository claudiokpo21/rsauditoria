/**
 * Avisos de vencimiento. Los genera el servidor (hse_build_notifications: acciones por vencer
 * en 7 días o vencidas, verificaciones de eficacia pendientes y hallazgos vencidos), se
 * descargan al sincronizar y quedan disponibles sin conexión. Opcionalmente se muestran
 * como notificaciones del sistema mientras la aplicación está abierta.
 */
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getMeta, setMeta } from '../../db/db';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthProvider';
import { Badge, Button, Card, Empty, PageHeader, fmtDate, fmtDateTime, useToast } from '../../components/ui';
import { LABELS, type NotificationRow } from '../../types';

const link = (n: NotificationRow) => n.entity_table === 'hse_findings' ? `/hallazgos/${n.entity_id}` : `/acciones?accion=${n.entity_id}`;
const tone = (k: NotificationRow['kind']) => (k === 'accion_vencida' || k === 'hallazgo_vencido' ? 'bad' : k === 'verificacion_pendiente' ? 'info' : 'warn');

export function useMyNotifications() {
  const { orgId, userId } = useAuth();
  return useLiveQuery(async () => orgId
    ? (await db.hse_notifications.where('organization_id').equals(orgId).toArray())
        .filter(n => n.user_id === userId && !n.resolved_at)
        .sort((a, b) => a.due_date.localeCompare(b.due_date))
    : [], [orgId, userId]) ?? [];
}

export async function markRead(ids: string[]) {
  if (!ids.length) return;
  const now = new Date().toISOString();
  await db.hse_notifications.where('id').anyOf(ids).modify({ read_at: now });
  if (navigator.onLine) await supabase.from('hse_notifications').update({ read_at: now }).in('id', ids);
}

/** Muestra como notificación del sistema los avisos nuevos (una sola vez cada uno). */
export function useSystemNotifications() {
  const list = useMyNotifications();
  const nav = useNavigate();
  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    void (async () => {
      const shown = new Set((await getMeta<string[]>('notif_shown')) ?? []);
      const fresh = list.filter(n => !n.read_at && !shown.has(n.id));
      for (const n of fresh.slice(0, 5)) {
        const sys = new Notification(n.title, { body: `${n.body ?? ''}\nVence: ${fmtDate(n.due_date)}`, tag: n.id });
        sys.onclick = () => { window.focus(); nav(link(n)); };
        shown.add(n.id);
      }
      if (fresh.length) await setMeta('notif_shown', [...shown].slice(-500));
    })();
  }, [list, nav]);
}

export function NotificationsPage() {
  const list = useMyNotifications();
  const toast = useToast();
  const unread = list.filter(n => !n.read_at);
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  return (
    <div className="stack-lg">
      <PageHeader title="Avisos de vencimiento" subtitle="Generados por el servidor al sincronizar y una vez por día; disponibles sin conexión."
        actions={<>
          {perm === 'default' ? <Button variant="secondary" onClick={async () => { const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Avisos del sistema activados' : 'Permiso no concedido', r === 'granted' ? 'ok' : 'bad'); }}>Activar avisos del sistema</Button> : null}
          {unread.length ? <Button variant="secondary" onClick={() => void markRead(unread.map(n => n.id))}>Marcar todo como leído</Button> : null}
        </>} />
      {perm === 'denied' ? <div className="alert alert-info small">Las notificaciones del sistema están bloqueadas en este navegador; los avisos siguen visibles aquí.</div> : null}
      {list.length === 0 ? <Empty>No tiene avisos pendientes.</Empty> : (
        <Card>
          <div className="table-wrap"><table className="t t-stack">
            <thead><tr><th>Aviso</th><th>Detalle</th><th>Vence</th><th>Recibido</th><th /></tr></thead>
            <tbody>{list.map(n => (
              <tr key={n.id} className={n.read_at ? '' : 'notif-unread'}>
                <td data-label="Aviso"><Badge tone={tone(n.kind)}>{LABELS.notificationKind[n.kind]}</Badge><div>{n.title}</div></td>
                <td data-label="Detalle" className="small">{n.body}</td>
                <td data-label="Vence">{fmtDate(n.due_date)}</td>
                <td data-label="Recibido" className="small muted">{fmtDateTime(n.created_at)}</td>
                <td className="num"><Link className="btn btn-ghost btn-sm" to={link(n)} onClick={() => void markRead([n.id])}>Abrir</Link></td>
              </tr>))}</tbody>
          </table></div>
        </Card>
      )}
      <p className="muted small">Reglas: acción pendiente que vence en 7 días o menos (responsable y contratista responsable); acción vencida (además líder de la auditoría y coordinación); acción completada sin verificar (líder y coordinación); hallazgo vencido sin cerrar (responsable y líder). El aviso desaparece cuando deja de aplicar.</p>
    </div>
  );
}
