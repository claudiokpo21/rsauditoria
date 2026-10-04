import { createClient } from '@supabase/supabase-js';
import { env } from './env';

/**
 * Cliente único. La sesión de Supabase Auth se guarda en el almacenamiento del
 * navegador que gestiona supabase-js (sólo el token de sesión): los datos de la
 * aplicación viven en IndexedDB (Dexie), nunca en localStorage.
 */
export const supabase = createClient(env.supabaseUrl || 'http://localhost', env.supabaseKey || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  global: { headers: { 'x-application-name': 'hse-audit-manager' } },
});

export const EVIDENCE_BUCKET = 'hse-evidencias';

/** Traduce errores de PostgREST / Postgres a mensajes en español. */
export function errorMessage(e: unknown): string {
  const err = e as { message?: string; code?: string; details?: string; hint?: string };
  if (!err) return 'Error desconocido';
  const code = err.code ?? '';
  if (code === '42501') return err.message?.includes('row-level security') ? 'No tiene permiso para esta operación.' : (err.message ?? 'Sin permiso.');
  if (code === 'HS409') return 'Otro usuario guardó una versión más reciente; se recuperó la versión del servidor.';
  if (code === '23505') return 'Ya existe un registro con esos datos.';
  if (code === '23503') return 'El registro hace referencia a datos inexistentes o de otra organización.';
  if (code === '23514') return 'Algún dato no cumple las reglas de validación.';
  if (code === 'PGRST301' || code === '28000') return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(err.message ?? '')) return 'Sin conexión con el servidor.';
  return err.message ?? String(e);
}

export function isNetworkError(e: unknown): boolean {
  const m = (e as { message?: string })?.message ?? '';
  return /Failed to fetch|NetworkError|Load failed|network|ECONN|timeout/i.test(m) || (e as { status?: number })?.status === 0;
}
