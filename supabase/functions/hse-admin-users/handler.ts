// =====================================================================
// HSE Audit Manager · Edge Function "hse-admin-users"
// Alta de usuarios con contraseña temporal y reinicio de contraseña, hecho
// por un propietario o administrador de la organización.
//
// Seguridad:
//  - La clave de servicio sólo existe acá (variable del servidor de Supabase);
//    nunca llega al navegador.
//  - El llamador se identifica con su propio token y se verifica su rol con
//    hse_has_role bajo SU sesión (RLS). La membresía se inserta con SU sesión,
//    así las políticas de la base deciden igual que en el resto de la app.
//  - Reiniciar contraseña: sólo a miembros cuyas organizaciones administra
//    TODAS el llamador (no se puede tomar una cuenta que también pertenece a
//    otra organización), nunca a sí mismo, y a un propietario sólo otro propietario.
//  - La contraseña temporal se genera en el servidor, se devuelve una vez y el
//    usuario debe cambiarla al primer ingreso (user_metadata.must_change_password).
// =====================================================================
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-application-name, x-region',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const ROLES = ['admin', 'supervisor', 'auditor', 'action_owner', 'viewer', 'contractor'];
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (status: number, code: string, message: string) => json(status, { error: code, message });

/** Contraseña temporal legible: 3 grupos de 4 (sin caracteres ambiguos) + 2 dígitos, ~70 bits. */
export function tempPassword(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const r = new Uint32Array(14); crypto.getRandomValues(r);
  const c = (i: number) => A[r[i] % A.length];
  const g = (o: number) => c(o) + c(o + 1) + c(o + 2) + c(o + 3);
  return `${g(0)}-${g(4)}-${g(8)}-${(r[12] % 90) + 10}`;
}

async function isOrgAdmin(user: SupabaseClient, org: string): Promise<boolean> {
  const { data, error } = await user.rpc('hse_has_role', { p_org: org, p_roles: ['owner', 'admin'] });
  return !error && data === true;
}
async function isOrgOwner(user: SupabaseClient, org: string): Promise<boolean> {
  const { data, error } = await user.rpc('hse_has_role', { p_org: org, p_roles: ['owner'] });
  return !error && data === true;
}

export async function handle(req: Request, env: (k: string) => string | undefined): Promise<Response> {
  // preflight: se aceptan los encabezados que pida el navegador (la app agrega x-application-name, etc.)
  if (req.method === 'OPTIONS') {
    const asked = req.headers.get('Access-Control-Request-Headers');
    return new Response('ok', { headers: { ...CORS, ...(asked ? { 'Access-Control-Allow-Headers': asked } : {}), 'Access-Control-Max-Age': '600' } });
  }
  if (req.method !== 'POST') return fail(405, 'metodo', 'Método no permitido');
  const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anon || !service) return fail(500, 'config', 'Función sin configurar');
  const authz = req.headers.get('Authorization') ?? '';
  if (!authz.startsWith('Bearer ')) return fail(401, 'sesion', 'Inicie sesión');

  const user = createClient(url, anon, { global: { headers: { Authorization: authz } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: who, error: whoErr } = await user.auth.getUser(authz.slice(7));
  if (whoErr || !who?.user) return fail(401, 'sesion', 'Sesión vencida: vuelva a ingresar');
  const caller = who.user;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, 'datos', 'Datos inválidos'); }
  const action = String(body.action ?? '');
  const org = String(body.org ?? '');
  if (!UUID.test(org)) return fail(400, 'datos', 'Organización inválida');
  if (!(await isOrgAdmin(user, org))) return fail(403, 'permiso', 'Sólo propietarios y administradores gestionan usuarios');
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // ------------------------------------------------------------ alta
  if (action === 'create') {
    const email = String(body.email ?? '').trim().toLowerCase();
    const fullName = String(body.full_name ?? '').trim().slice(0, 200);
    const role = String(body.role ?? '');
    const company = body.company_id ? String(body.company_id) : null;
    if (!EMAIL.test(email) || email.length > 254) return fail(400, 'datos', 'Correo inválido');
    if (fullName.length < 3) return fail(400, 'datos', 'Escriba nombre y apellido');
    if (!ROLES.includes(role)) return fail(400, 'datos', 'Rol inválido (el propietario se designa desde la ficha de un usuario existente)');
    if (role === 'contractor' && !company) return fail(400, 'datos', 'El rol contratista requiere una empresa');
    if (company && !UUID.test(company)) return fail(400, 'datos', 'Empresa inválida');

    const password = tempPassword();
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: fullName, must_change_password: true, created_by_admin: caller.id },
    });
    if (cErr || !created?.user) {
      const msg = cErr?.message ?? '';
      if (/already|registered|exists/i.test(msg)) return json(409, { error: 'existe', message: 'Ese correo ya tiene cuenta: se agrega a la organización sin cambiar su contraseña.' });
      return fail(400, 'alta', msg || 'No se pudo crear el usuario');
    }
    const uid = created.user.id;
    // perfil (lo completa hse_bootstrap al ingresar; se crea ya para que figure con su nombre)
    await admin.from('hse_profiles').upsert({ id: uid, email, full_name: fullName }, { onConflict: 'id' });
    // membresía con la sesión del administrador: la decide RLS
    const { error: mErr } = await user.from('hse_memberships').insert({ organization_id: org, user_id: uid, role, company_id: role === 'contractor' ? company : null });
    if (mErr) {
      await admin.auth.admin.deleteUser(uid);   // sin membresía no se deja una cuenta suelta
      return fail(400, 'membresia', mErr.message);
    }
    return json(200, { status: 'creado', user_id: uid, email, password });
  }

  // ------------------------------------------------------------ nueva contraseña temporal
  if (action === 'reset') {
    const target = String(body.user_id ?? '');
    if (!UUID.test(target)) return fail(400, 'datos', 'Usuario inválido');
    if (target === caller.id) return fail(400, 'propio', 'Para su propia contraseña use Mi perfil');
    const { data: mems, error: memErr } = await admin.from('hse_memberships').select('organization_id, role').eq('user_id', target);
    if (memErr) return fail(500, 'consulta', memErr.message);
    const here = (mems ?? []).find(m => m.organization_id === org);
    if (!here) return fail(404, 'miembro', 'El usuario no pertenece a esta organización');
    for (const m of mems ?? []) {
      if (!(await isOrgAdmin(user, m.organization_id))) {
        return fail(403, 'otra_org', 'El usuario también pertenece a otra organización: debe restablecer su contraseña él mismo desde "Olvidé mi contraseña".');
      }
      if (m.role === 'owner' && !(await isOrgOwner(user, m.organization_id))) {
        return fail(403, 'propietario', 'Sólo un propietario puede restablecer la contraseña de otro propietario');
      }
    }
    const { data: tu, error: gErr } = await admin.auth.admin.getUserById(target);
    if (gErr || !tu?.user) return fail(404, 'miembro', 'Usuario inexistente');
    const password = tempPassword();
    const { error: uErr } = await admin.auth.admin.updateUserById(target, {
      password, user_metadata: { ...(tu.user.user_metadata ?? {}), must_change_password: true },
    });
    if (uErr) return fail(400, 'reinicio', uErr.message);
    return json(200, { status: 'reiniciado', user_id: target, email: tu.user.email, password });
  }

  return fail(400, 'accion', 'Acción desconocida');
}


