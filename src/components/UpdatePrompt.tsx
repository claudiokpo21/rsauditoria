import { useRegisterSW } from 'virtual:pwa-register/react';
import { Button } from './ui';

/** Aviso de nueva versión disponible (el service worker no se actualiza solo a mitad de una auditoría). */
export function UpdatePrompt() {
  const { needRefresh: [needRefresh, setNeedRefresh], offlineReady: [offlineReady, setOfflineReady], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => { void reg.update(); }, 60 * 60 * 1000); },
  });
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toasts" style={{ left: '1rem', right: 'auto' }}>
      <div className="card row gap wrap" role="status">
        <span className="small">{needRefresh ? 'Hay una nueva versión de la aplicación.' : 'La aplicación ya funciona sin conexión.'}</span>
        {needRefresh ? <Button className="btn-sm" onClick={() => void updateServiceWorker(true)}>Actualizar</Button> : null}
        <Button variant="ghost" className="btn-sm" onClick={() => { setNeedRefresh(false); setOfflineReady(false); }}>Cerrar</Button>
      </div>
    </div>
  );
}
