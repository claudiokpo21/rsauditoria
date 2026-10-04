/**
 * Planificador de sincronización y estado visible para la interfaz.
 * Dispara la sincronización al reconectar, al volver la pestaña al frente, cada 60 s,
 * poco después de cada cambio local y cuando vence un reintento. Web Locks evita que
 * dos pestañas sincronicen a la vez.
 */
import { useSyncExternalStore } from 'react';
import { db, getMeta } from '../db/db';
import { syncOnce, type SyncResult } from './engine';
import { pruneLocal } from './retention';

/** Estados que ve el usuario. */
export type SyncPhase = 'sin_conexion' | 'pendiente' | 'sincronizando' | 'sincronizado' | 'error';
export interface SyncState {
  orgId: string | null; online: boolean; reachable: boolean; running: boolean; progress: string | null;
  pending: number; errors: number; conflicts: number; rejected: number;
  lastResult: SyncResult | null; lastAt: string | null; lastConfirmed: string | null; phase: SyncPhase;
}
let state: SyncState = { orgId: null, online: typeof navigator === 'undefined' ? true : navigator.onLine, reachable: true, running: false, progress: null, pending: 0, errors: 0, conflicts: 0, rejected: 0, lastResult: null, lastAt: null, lastConfirmed: null, phase: 'sincronizado' };
const listeners = new Set<() => void>();
function phaseOf(s: SyncState): SyncPhase {
  if (s.running) return 'sincronizando';
  if (!s.online || !s.reachable) return 'sin_conexion';
  if (s.conflicts || s.rejected || s.errors || s.lastResult?.error) return 'error';
  if (s.pending) return 'pendiente';
  return 'sincronizado';
}
const set = (p: Partial<SyncState>) => { state = { ...state, ...p }; state.phase = phaseOf(state); listeners.forEach(l => l()); };
export const getSyncState = () => state;

export function useSyncState(): SyncState {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state);
}

export async function refreshCounts() {
  if (!state.orgId) return;
  const ops = await db.outbox.where('organization_id').equals(state.orgId).toArray();
  set({
    pending: ops.filter(o => o.status === 'pendiente' || o.status === 'enviando').length,
    errors: ops.filter(o => o.status === 'error').length,
    conflicts: ops.filter(o => o.status === 'conflicto').length,
    rejected: ops.filter(o => o.status === 'rechazado').length,
    lastConfirmed: (await getMeta<string>(`last_sync_confirmed:${state.orgId}`)) ?? null,
  });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;

let rerun = false;   // se pidió sincronizar mientras otra sincronización estaba en curso

export async function runSync(): Promise<SyncResult | null> {
  const org = state.orgId;
  if (state.running) rerun = true;                 // no se pierde: se repite al terminar la actual
  if (!org || !navigator.onLine || state.running) { await refreshCounts(); return null; }
  set({ running: true, progress: 'Preparando…' });
  const exec = async () => syncOnce(org, msg => set({ progress: msg }));
  try {
    const res = 'locks' in navigator
      ? await navigator.locks.request('hse-sync', { ifAvailable: true }, async lock => (lock ? exec() : null))
      : await exec();
    if (res) {
      const netFail = !!res.error && /conexión|fetch|network/i.test(res.error);
      set({ lastResult: res, lastAt: new Date().toISOString(), reachable: !netFail });
      if (!res.error) void pruneLocal(org);
    }
    return res;
  } finally {
    set({ running: false, progress: null });
    await refreshCounts();
    if (rerun) { rerun = false; requestSync(300); } else void scheduleRetry();
  }
}

/** Programa la próxima ejecución cuando vence el reintento más cercano. */
async function scheduleRetry() {
  if (!state.orgId) return;
  const next = (await db.outbox.where('organization_id').equals(state.orgId).filter(o => o.status === 'error' && !!o.next_attempt_at).toArray())
    .map(o => new Date(o.next_attempt_at!).getTime()).sort((a, b) => a - b)[0];
  if (next) requestSync(Math.max(1000, next - Date.now() + 500));
  else if (!state.reachable && state.pending) requestSync(20_000);
}

/** Pide una sincronización en breve (agrupa cambios seguidos). */
export function requestSync(delayMs = 1500) {
  void refreshCounts();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void runSync(); }, delayMs);
}

function beforeUnload(e: BeforeUnloadEvent) {
  if (state.pending || state.running) { e.preventDefault(); e.returnValue = 'Hay cambios sin sincronizar. Se conservan en este dispositivo y se enviarán al reconectar.'; }
}

export function startSync(orgId: string) {
  set({ orgId });
  void refreshCounts();
  if (!interval) {
    window.addEventListener('online', () => { set({ online: true, reachable: true }); requestSync(300); });
    window.addEventListener('offline', () => set({ online: false }));
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(300); });
    interval = setInterval(() => { if (document.visibilityState === 'visible') void runSync(); }, 60_000);
  }
  requestSync(100);
}

export function stopSync() {
  set({ orgId: null, pending: 0, errors: 0, conflicts: 0, rejected: 0, lastResult: null, lastConfirmed: null });
}
