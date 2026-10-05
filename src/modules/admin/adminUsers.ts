import { supabase } from '../../lib/supabase';
import { AUDIT_FIRM } from '../../config/brand';

export interface Credentials { status: 'creado' | 'reiniciado'; user_id: string; email: string; password: string }
export class AdminUsersError extends Error { constructor(public code: string, message: string) { super(message); } }

/** Llama a la función del servidor que crea usuarios o renueva contraseñas (la clave de servicio no sale del servidor). */
export async function adminUsers(body: { action: 'create'; org: string; email: string; full_name: string; role: string; company_id?: string | null }
  | { action: 'reset'; org: string; user_id: string }): Promise<Credentials> {
  if (!navigator.onLine) throw new AdminUsersError('sin_conexion', 'Se necesita conexión.');
  const { data, error } = await supabase.functions.invoke('hse-admin-users', { body });
  if (error) {
    let code = 'error', message = error.message;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try { const j = await ctx.json(); code = j.error ?? code; message = j.message ?? message; } catch { /* respuesta sin JSON */ }
      if (ctx.status === 404 && code === 'error') { code = 'sin_funcion'; message = 'Falta publicar la función hse-admin-users en Supabase.'; }
    }
    throw new AdminUsersError(code, message);
  }
  return data as Credentials;
}

/** Mensaje con usuario y contraseña temporal para mandar por WhatsApp o correo. */
export function credentialsMessage(c: { email: string; password: string }, org: string, name?: string | null) {
  return `Hola${name ? ` ${name.split(' ')[0]}` : ''}. Te creé un usuario en la aplicación de auditorías HSE de ${AUDIT_FIRM.name} (${org}).\n\n` +
    `Entrá a ${window.location.origin}\nUsuario: ${c.email}\nContraseña temporal: ${c.password}\n\n` +
    `Al ingresar te va a pedir que elijas tu propia contraseña.`;
}
