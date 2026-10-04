import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, errorMessage } from '../../lib/supabase';
import { db, getMeta, setMeta, wipeLocalData } from '../../db/db';
import { purgeOrganization } from '../../sync/engine';
import { startSync, stopSync } from '../../sync/scheduler';
import { accessState, expireSyncedData, markServerValidation } from '../../sync/retention';
import type { Membership, ProfileRow, Role } from '../../types';

interface Ctx {
  loading: boolean; session: Session | null; profile: ProfileRow | null; memberships: Membership[];
  current: Membership | null; role: Role | null; orgId: string; userId: string;
  selectOrg: (id: string) => Promise<void>; refresh: () => Promise<void>; signOut: (force?: boolean) => Promise<{ pending: number } | void>;
  bootstrapError: string | null;
  access: 'ok' | 'bloqueado' | 'vencido';
}
const AuthCtx = createContext<Ctx | null>(null);
export const useAuth = () => { const c = useContext(AuthCtx); if (!c) throw new Error('AuthProvider ausente'); return c; };

interface Bootstrap { profile: ProfileRow; memberships: Membership[] }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [access, setAccess] = useState<'ok' | 'bloqueado' | 'vencido'>('ok');

  const loadBootstrap = useCallback(async (s: Session | null) => {
    if (!s) { setBoot(null); setOrgId(null); return; }
    const cachedUser = await getMeta<string>('bootstrap_user');
    if (cachedUser && cachedUser !== s.user.id) await wipeLocalData();      // otro usuario en el mismo dispositivo
    let b: Bootstrap | undefined;
    try {
      const { data, error } = await supabase.rpc('hse_bootstrap');
      if (error) throw error;
      b = data as Bootstrap;
      await setMeta('bootstrap', b); await setMeta('bootstrap_user', s.user.id);
      await markServerValidation();                                        // sesión y permisos revalidados
      setBootstrapError(null); setAccess('ok');
      // organizaciones a las que ya no pertenece: se borran del dispositivo
      const known = (await getMeta<string[]>('known_orgs')) ?? [];
      const now = b.memberships.map(m => m.organization_id);
      for (const o of known) if (!now.includes(o)) await purgeOrganization(o);
      await setMeta('known_orgs', now);
    } catch (e) {
      b = await getMeta<Bootstrap>('bootstrap');                           // sin conexión: última copia
      if (!b) setBootstrapError(errorMessage(e));
      const a = await accessState();
      if (a.state === 'vencido') { await expireSyncedData(); setAccess('vencido'); }
      else setAccess(a.state);
    }
    if (!b) { setBoot(null); return; }
    setBoot(b);
    const saved = await getMeta<string>('current_org');
    const pick = b.memberships.find(m => m.organization_id === saved)
      ?? b.memberships.find(m => m.organization_id === b!.profile?.default_organization_id) ?? b.memberships[0];
    setOrgId(pick?.organization_id ?? null);
  }, []);

  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return;
      setSession(data.session);
      await loadBootstrap(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, s) => {
      setSession(s);
      if (evt === 'SIGNED_IN' || evt === 'USER_UPDATED') void loadBootstrap(s);
      if (evt === 'SIGNED_OUT') { setBoot(null); setOrgId(null); }
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, [loadBootstrap]);

  useEffect(() => {
    if (orgId) { void setMeta('current_org', orgId); startSync(orgId); } else stopSync();
  }, [orgId]);

  const current = boot?.memberships.find(m => m.organization_id === orgId) ?? null;

  const value = useMemo<Ctx>(() => ({
    loading, session, profile: boot?.profile ?? null, memberships: boot?.memberships ?? [], current, role: current?.role ?? null,
    orgId: orgId ?? '', userId: session?.user.id ?? '', bootstrapError, access,
    selectOrg: async (id) => { setOrgId(id); },
    refresh: async () => { await loadBootstrap(session); },
    signOut: async (force) => {
      const pending = await db.outbox.count();
      if (pending && !force) return { pending };
      await supabase.auth.signOut();
      await wipeLocalData();                                                // no quedan datos en el dispositivo
      stopSync();
    },
  }), [loading, session, boot, current, orgId, bootstrapError, access, loadBootstrap]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export type UiAction = 'admin' | 'master' | 'templates' | 'audit' | 'manage_audit' | 'review' | 'reopen_closed' | 'reopen_finding'
  | 'verify' | 'progress' | 'history' | 'read';

/** Permisos de interfaz por rol (sólo para mostrar/ocultar; el servidor aplica RLS igualmente). Ver docs/politicas-rls.md. */
export function can(role: Role | null, action: UiAction) {
  if (!role) return false;
  const m: Record<UiAction, Role[]> = {
    admin: ['owner', 'admin'],
    master: ['owner', 'admin', 'supervisor'],
    templates: ['owner', 'admin', 'supervisor'],
    audit: ['owner', 'admin', 'supervisor', 'auditor'],             // crear auditorías (el auditor sólo las que lidera)
    manage_audit: ['owner', 'admin', 'supervisor'],                  // asignar equipo, empresa, líder; cancelar
    review: ['owner', 'admin', 'supervisor'],                        // revisión previa al cierre
    reopen_closed: ['owner', 'admin'],                               // reabrir auditoría cerrada (autorización especial)
    reopen_finding: ['owner', 'admin', 'supervisor'],                // reabrir hallazgo verificado
    verify: ['owner', 'admin', 'supervisor', 'auditor'],
    progress: ['contractor', 'action_owner'],
    history: ['owner', 'admin', 'supervisor'],
    read: ['owner', 'admin', 'supervisor', 'auditor', 'action_owner', 'viewer', 'contractor'],
  };
  return m[action].includes(role);
}
