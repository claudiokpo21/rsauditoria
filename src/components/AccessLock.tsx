import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { EXPIRE_DAYS, OFFLINE_GRACE_DAYS } from '../sync/retention';
import { Button } from './ui';

/** Bloqueo por falta de revalidación: la autorización offline no es definitiva. */
export function AccessLock({ state, onRetry }: { state: 'bloqueado' | 'vencido'; onRetry: () => Promise<void> }) {
  const pending = useLiveQuery(() => db.outbox.count(), []) ?? 0;
  return (
    <div className="auth-wrap">
      <div className="card auth-card stack">
        <h1>Se requiere conexión</h1>
        <p>{state === 'vencido'
          ? `Pasaron más de ${EXPIRE_DAYS} días sin validar su acceso con el servidor. Por seguridad se eliminaron de este dispositivo los datos ya sincronizados.`
          : `Pasaron más de ${OFFLINE_GRACE_DAYS} días sin validar su acceso con el servidor. Conéctese para confirmar que sus permisos siguen vigentes.`}</p>
        {pending ? <div className="alert alert-warn">Sus <strong>{pending}</strong> cambios pendientes se conservan y se enviarán al reconectar.</div> : null}
        <Button onClick={() => void onRetry()} disabled={!navigator.onLine}>{navigator.onLine ? 'Revalidar ahora' : 'Sin conexión'}</Button>
      </div>
    </div>
  );
}
