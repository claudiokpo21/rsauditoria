/**
 * Variables de entorno públicas. Sólo se admite la clave publicable/anon:
 * la aplicación se niega a arrancar si detecta una clave de servicio.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;

function decodeJwtRole(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch { return null; }
}

export const envError: string | null = (() => {
  if (!url || !key) return 'Faltan VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY. Copie .env.example a .env.development.local.';
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(url)) return 'VITE_SUPABASE_URL debe usar HTTPS.';
  if (key.startsWith('sb_secret_') || decodeJwtRole(key) === 'service_role') {
    return 'Se configuró una clave secreta (service_role) en el frontend. Use sólo la clave publicable.';
  }
  return null;
})();

export const env = {
  supabaseUrl: url ?? '',
  supabaseKey: key ?? '',
  appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '1.0.0',
  mode: import.meta.env.MODE,
};
