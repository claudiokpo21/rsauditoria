import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, can } from '../modules/auth/AuthProvider';
import { useSyncState, runSync } from '../sync/scheduler';
import { LABELS } from '../types';
import { Select } from './ui';
import { useMyNotifications, useSystemNotifications } from '../modules/notifications/NotificationsPage';

const PHASE: Record<string, { label: string; dot: string }> = {
  sin_conexion: { label: 'Sin conexión', dot: 'dot-off' },
  pendiente: { label: 'Pendiente de sincronizar', dot: 'dot-warn' },
  sincronizando: { label: 'Sincronizando…', dot: 'dot-info' },
  sincronizado: { label: 'Sincronizado', dot: '' },
  error: { label: 'Error de sincronización', dot: 'dot-bad' },
};

/** Indicador permanente del estado de sincronización (los cinco estados exigidos). */
export function SyncPill() {
  const s = useSyncState();
  const nav = useNavigate();
  const p = PHASE[s.phase];
  const extra = s.phase === 'sin_conexion' ? (s.pending ? ` · ${s.pending} pendientes` : '')
    : s.phase === 'pendiente' ? ` (${s.pending})`
    : s.phase === 'sincronizando' ? (s.progress ? ` ${s.progress}` : '')
    : s.phase === 'error' ? ` (${s.errors + s.conflicts + s.rejected})` : '';
  const when = s.lastConfirmed ? new Date(s.lastConfirmed).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca';
  return (
    <button className="sync-pill" data-sync-phase={s.phase} data-sync-running={s.running ? '1' : '0'} data-last-sync={s.lastAt ?? ''} onClick={() => { if (s.online) void runSync(); nav('/admin/sync'); }}
      title={`Última sincronización confirmada: ${when}`} aria-live="polite">
      <span className={`dot ${p.dot}`} />{p.label}{extra}
      <span className="muted small hide-sm">· {when}</span>
    </button>
  );
}

export function Layout() {
  const { memberships, current, selectOrg, role } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const notes = useMyNotifications();
  useSystemNotifications();
  const unread = notes.filter(n => !n.read_at).length;
  const L = (to: string, label: string) => <NavLink to={to} onClick={close} end={to === '/'}>{label}</NavLink>;
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark" aria-hidden><i /><i /><i /><i /></span><span>Auditorías HSE</span></div>
        <nav className="nav">
          {L('/', 'Dashboard')}
          {L('/auditorias', 'Auditorías')}
          {L('/hallazgos', 'Hallazgos')}
          {L('/acciones', 'Planes de acción')}
          <NavLink to="/avisos" onClick={close}>Avisos{unread ? <span className="badge badge-bad" style={{ marginLeft: '.4rem' }}>{unread}</span> : null}</NavLink>
          {L('/informes', 'Informes')}
          <div className="nav-sep">Configuración</div>
          {L('/plantillas', 'Plantillas')}
          {L('/maestros', 'Empresas y ubicaciones')}
          {can(role, 'admin') ? L('/admin/miembros', 'Usuarios y organización') : null}
          {can(role, 'master') ? L('/admin/historial', 'Historial de cambios') : null}
          {L('/admin/sync', 'Sincronización')}
          {L('/perfil', 'Mi perfil')}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menú">☰</button>
          {memberships.length > 1 ? (
            <Select aria-label="Organización" className="topbar-org" value={current?.organization_id ?? ''} style={{ maxWidth: 280 }}
              onChange={e => void selectOrg(e.target.value)}
              options={memberships.map(m => ({ value: m.organization_id, label: m.organization_name }))} />
          ) : <strong className="topbar-org" title={current?.organization_name}>{current?.organization_name}</strong>}
          {role ? <span className="badge badge-neutral hide-sm">{LABELS.role[role]}</span> : null}
          <div className="grow" />
          {unread ? <NavLink to="/avisos" className="btn btn-ghost btn-sm" aria-label={`${unread} avisos sin leer`}>🔔 {unread}</NavLink> : null}
          <SyncPill />
        </header>
        <main className="content" onClick={close}><Outlet /></main>
      </div>
    </div>
  );
}
