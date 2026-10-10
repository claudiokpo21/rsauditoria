import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth, can } from '../modules/auth/AuthProvider';
import { useSyncState, runSync } from '../sync/scheduler';
import { LABELS } from '../types';
import { Select } from './ui';
import { useMyNotifications, useSystemNotifications } from '../modules/notifications/NotificationsPage';
import { Icon } from './Icon';
import { useOrgRows, useProfiles } from '../db/hooks';
import { AUDIT_FIRM } from '../config/brand';
import type { Finding } from '../types';

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
  const { memberships, current, selectOrg, role, userId } = useAuth();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const notes = useMyNotifications();
  useSystemNotifications();
  const people = useProfiles();
  const unread = notes.filter(n => !n.read_at).length;
  const openFindings = useOrgRows<Finding>('hse_findings')?.filter(f => f.status === 'abierto' || f.status === 'en_tratamiento').length ?? 0;
  const me = userId ? people.get(userId) : null;
  const L = (to: string, label: string, icon: string, extra?: React.ReactNode) =>
    <NavLink to={to} onClick={close} end={to === '/'}><Icon name={icon} />{label}{extra}</NavLink>;
  const T = (to: string, label: string, icon: string, extra?: React.ReactNode) =>
    <NavLink to={to} end={to === '/'} onClick={close} className="tabbar-item"><Icon name={icon} size={22} /><span>{label}</span>{extra}</NavLink>;
  return (
    <div className="shell">
      <aside className={`side ${open ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark" aria-hidden><i /><i /><i /><i /></span>
          <span className="brand-text"><span className="brand-firm">{AUDIT_FIRM.name.toUpperCase()}</span><span className="brand-app">Auditorías HSE</span></span></div>
        <nav className="nav" aria-label="Menú principal">
          {L('/', 'Dashboard', 'panel')}
          {L('/planes', 'Planes de auditoría', 'plan')}
          {L('/auditorias', 'Auditorías', 'audits')}
          {L('/hallazgos', 'Hallazgos', 'findings', openFindings ? <span className="nav-count">{openFindings}</span> : null)}
          {L('/acciones', 'Planes de acción', 'actions')}
          {L('/avisos', 'Avisos', 'bell', unread ? <span className="nav-count nav-count-bad">{unread}</span> : null)}
          {L('/informes', 'Informes', 'reports')}
          <div className="nav-sep">Configuración</div>
          {L('/plantillas', 'Plantillas', 'templates')}
          {L('/maestros', 'Empresas y ubicaciones', 'companies')}
          {can(role, 'admin') ? L('/admin/miembros', 'Usuarios y permisos', 'users') : null}
          {can(role, 'master') ? L('/admin/historial', 'Historial de cambios', 'history') : null}
          {L('/admin/sync', 'Sincronización', 'sync')}
        </nav>
        <NavLink to="/perfil" onClick={close} className="side-user">
          <span className="avatar" aria-hidden>{(me ?? '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('')}</span>
          <span><strong>{me ?? 'Mi perfil'}</strong><span>{role ? LABELS.role[role] : ''}</span></span>
        </NavLink>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn btn-ghost menu-btn" onClick={() => setOpen(o => !o)} aria-label="Menú"><Icon name="more" /></button>
          {memberships.length > 1 ? (
            <Select aria-label="Organización" className="topbar-org" value={current?.organization_id ?? ''} style={{ maxWidth: 280 }}
              onChange={e => void selectOrg(e.target.value)}
              options={memberships.map(m => ({ value: m.organization_id, label: m.organization_name }))} />
          ) : <strong className="topbar-org" title={current?.organization_name}>{current?.organization_name}</strong>}
          {role ? <span className="badge badge-neutral hide-sm">{LABELS.role[role]}</span> : null}
          <div className="grow" />
          {unread ? <NavLink to="/avisos" className="btn btn-ghost btn-sm bell-btn" aria-label={`${unread} avisos sin leer`}><Icon name="bell" size={18} /> {unread}</NavLink> : null}
          <SyncPill />
        </header>
        <main className="content" onClick={close}><Outlet /></main>
      </div>
      <nav className="tabbar" aria-label="Accesos rápidos">
        {T('/', 'Inicio', 'home')}
        {T('/auditorias', 'Auditorías', 'audits')}
        {T('/hallazgos', 'Hallazgos', 'findings', openFindings ? <span className="tab-dot">{openFindings}</span> : null)}
        {T('/acciones', 'Acciones', 'actions')}
        <button type="button" className="tabbar-item" onClick={() => setOpen(true)}><Icon name="more" size={22} /><span>Más</span></button>
      </nav>
    </div>
  );
}
