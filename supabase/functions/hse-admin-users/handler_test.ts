// Prueba de la Edge Function contra un Supabase simulado (Auth admin + PostgREST con reglas como RLS).
// Ejecutar: deno test --allow-net --allow-env supabase/functions/hse-admin-users/handler_test.ts
import { handle } from './handler.ts';

const ORG1 = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const ORGX = '33333333-3333-4333-8333-333333333333';   // el administrador lo es, pero la base rechaza la membresía
const U = { owner: 'aaaaaaaa-0000-4000-8000-000000000001', admin: 'aaaaaaaa-0000-4000-8000-000000000002', coord: 'aaaaaaaa-0000-4000-8000-000000000003',
  aud: 'aaaaaaaa-0000-4000-8000-000000000004', multi: 'aaaaaaaa-0000-4000-8000-000000000005', outsider: 'aaaaaaaa-0000-4000-8000-000000000006' };
const TOK: Record<string, string> = { 'tok-owner': U.owner, 'tok-admin': U.admin, 'tok-coord': U.coord };

type Mem = { organization_id: string; user_id: string; role: string };
let users: Map<string, { id: string; email: string; password: string; user_metadata: Record<string, unknown> }>;
let mems: Mem[];
let deleted: string[];
function reset() {
  users = new Map(Object.entries(U).map(([k, id]) => [id, { id, email: `${k}@x.com`, password: 'orig', user_metadata: { full_name: k } }]));
  mems = [
    { organization_id: ORG1, user_id: U.owner, role: 'owner' }, { organization_id: ORG1, user_id: U.admin, role: 'admin' },
    { organization_id: ORG1, user_id: U.coord, role: 'supervisor' }, { organization_id: ORG1, user_id: U.aud, role: 'auditor' },
    { organization_id: ORG1, user_id: U.multi, role: 'auditor' }, { organization_id: ORG2, user_id: U.multi, role: 'owner' },
    { organization_id: ORGX, user_id: U.admin, role: 'admin' },
  ];
  deleted = [];
}
const has = (uid: string, org: string, roles: string[]) => mems.some(m => m.user_id === uid && m.organization_id === org && roles.includes(m.role));
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

const server = Deno.serve({ port: 0, onListen: () => {} }, async req => {
  const u = new URL(req.url); const p = u.pathname;
  const bearer = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
  const caller = TOK[bearer];
  if (p === '/auth/v1/user') return caller ? J({ id: caller, email: users.get(caller)!.email, aud: 'authenticated', user_metadata: {} }) : J({ msg: 'invalid JWT' }, 401);
  if (p === '/rest/v1/rpc/hse_has_role') { const b = await req.json(); return J(!!caller && has(caller, b.p_org, b.p_roles)); }
  if (p === '/auth/v1/admin/users' && req.method === 'POST') {
    if (bearer !== 'service') return J({ msg: 'forbidden' }, 403);
    const b = await req.json();
    if ([...users.values()].some(x => x.email === b.email)) return J({ code: 'email_exists', msg: 'A user with this email address has already been registered' }, 422);
    const id = crypto.randomUUID(); users.set(id, { id, email: b.email, password: b.password, user_metadata: b.user_metadata });
    return J({ id, email: b.email, email_confirmed_at: b.email_confirm ? new Date().toISOString() : null, user_metadata: b.user_metadata, aud: 'authenticated' });
  }
  const m = p.match(/^\/auth\/v1\/admin\/users\/(.+)$/);
  if (m) {
    if (bearer !== 'service') return J({ msg: 'forbidden' }, 403);
    const x = users.get(m[1]); if (!x) return J({ msg: 'User not found' }, 404);
    if (req.method === 'GET') return J({ ...x, aud: 'authenticated' });
    if (req.method === 'DELETE') { users.delete(m[1]); deleted.push(m[1]); return J({}); }
    if (req.method === 'PUT') { const b = await req.json(); if (b.password) x.password = b.password; if (b.user_metadata) x.user_metadata = b.user_metadata; return J({ ...x, aud: 'authenticated' }); }
  }
  if (p === '/rest/v1/hse_profiles') { await req.text(); return new Response(null, { status: 201 }); }
  if (p === '/rest/v1/hse_memberships' && req.method === 'POST') {
    const b = await req.json(); const row = Array.isArray(b) ? b[0] : b;
    if (!caller || !has(caller, row.organization_id, ['owner', 'admin']) || row.organization_id === ORGX || row.role === 'owner')
      return J({ code: '42501', message: 'new row violates row-level security policy for table "hse_memberships"' }, 403);
    mems.push(row); return new Response(null, { status: 201 });
  }
  if (p === '/rest/v1/hse_memberships' && req.method === 'GET') {
    if (bearer !== 'service') return J([]);
    const uid = (u.searchParams.get('user_id') ?? '').replace('eq.', '');
    return J(mems.filter(x => x.user_id === uid).map(x => ({ organization_id: x.organization_id, role: x.role })));
  }
  return J({ message: 'no simulado ' + req.method + ' ' + p }, 404);
});
const BASE = `http://localhost:${(server.addr as Deno.NetAddr).port}`;
const env = (k: string) => ({ SUPABASE_URL: BASE, SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' } as Record<string, string>)[k];
async function call(token: string | null, body: unknown) {
  const r = await handle(new Request('http://f/hse-admin-users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), env);
  return { status: r.status, body: await r.json() };
}
function assert(c: unknown, msg: string) { if (!c) throw new Error(msg); }

Deno.test('alta con contraseña temporal por un administrador', async () => {
  reset();
  const r = await call('tok-admin', { action: 'create', org: ORG1, email: 'Nuevo.Auditor@Empresa.com ', full_name: 'Nuevo Auditor', role: 'auditor' });
  assert(r.status === 200, JSON.stringify(r));
  assert(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-\d{2}$/.test(r.body.password), 'formato de contraseña ' + r.body.password);
  const nu = users.get(r.body.user_id)!;
  assert(nu.email === 'nuevo.auditor@empresa.com' && nu.password === r.body.password, 'usuario creado con la contraseña devuelta');
  assert(nu.user_metadata.must_change_password === true, 'debe cambiar la contraseña al ingresar');
  assert(mems.some(m => m.user_id === r.body.user_id && m.organization_id === ORG1 && m.role === 'auditor'), 'membresía creada');
});
Deno.test('dos contraseñas temporales no se repiten', async () => {
  reset();
  const a = await call('tok-admin', { action: 'create', org: ORG1, email: 'a1@e.com', full_name: 'Uno Uno', role: 'viewer' });
  const b = await call('tok-admin', { action: 'create', org: ORG1, email: 'a2@e.com', full_name: 'Dos Dos', role: 'viewer' });
  assert(a.body.password !== b.body.password, 'distintas');
});
Deno.test('sin sesión: 401', async () => { reset(); const r = await call(null, { action: 'create', org: ORG1 }); assert(r.status === 401, String(r.status)); });
Deno.test('token falso: 401', async () => { reset(); const r = await call('tok-falso', { action: 'create', org: ORG1 }); assert(r.status === 401, String(r.status)); });
Deno.test('coordinador HSE no crea usuarios: 403', async () => {
  reset(); const r = await call('tok-coord', { action: 'create', org: ORG1, email: 'x@e.com', full_name: 'X Y', role: 'auditor' });
  assert(r.status === 403 && users.size === 6, JSON.stringify(r));
});
Deno.test('administrador de otra organización: 403', async () => {
  reset(); const r = await call('tok-admin', { action: 'create', org: ORG2, email: 'x@e.com', full_name: 'X Y', role: 'auditor' });
  assert(r.status === 403 && users.size === 6, JSON.stringify(r));
});
Deno.test('no se crea un propietario', async () => {
  reset(); const r = await call('tok-owner', { action: 'create', org: ORG1, email: 'x@e.com', full_name: 'X Y', role: 'owner' });
  assert(r.status === 400 && users.size === 6, JSON.stringify(r));
});
Deno.test('contratista sin empresa: 400', async () => {
  reset(); const r = await call('tok-admin', { action: 'create', org: ORG1, email: 'x@e.com', full_name: 'X Y', role: 'contractor' });
  assert(r.status === 400, JSON.stringify(r));
});
Deno.test('correo existente: 409 y no cambia su contraseña', async () => {
  reset(); const r = await call('tok-admin', { action: 'create', org: ORG1, email: 'outsider@x.com', full_name: 'Ya Existe', role: 'auditor' });
  assert(r.status === 409 && r.body.error === 'existe' && users.get(U.outsider)!.password === 'orig', JSON.stringify(r));
});
Deno.test('si la base rechaza la membresía, la cuenta se borra', async () => {
  reset(); const r = await call('tok-admin', { action: 'create', org: ORGX, email: 'rech@e.com', full_name: 'Rech Azado', role: 'auditor' });
  assert(r.status === 400 && deleted.length === 1 && ![...users.values()].some(x => x.email === 'rech@e.com'), JSON.stringify(r));
});
Deno.test('nueva contraseña temporal para un auditor de la organización', async () => {
  reset(); const r = await call('tok-admin', { action: 'reset', org: ORG1, user_id: U.aud });
  const x = users.get(U.aud)!;
  assert(r.status === 200 && x.password === r.body.password && x.password !== 'orig' && x.user_metadata.must_change_password === true && x.user_metadata.full_name === 'aud', JSON.stringify(r));
});
Deno.test('no se reinicia a quien pertenece a otra organización', async () => {
  reset(); const r = await call('tok-admin', { action: 'reset', org: ORG1, user_id: U.multi });
  assert(r.status === 403 && r.body.error === 'otra_org' && users.get(U.multi)!.password === 'orig', JSON.stringify(r));
});
Deno.test('el administrador no reinicia al propietario', async () => {
  reset(); const r = await call('tok-admin', { action: 'reset', org: ORG1, user_id: U.owner });
  assert(r.status === 403 && users.get(U.owner)!.password === 'orig', JSON.stringify(r));
});
Deno.test('el propietario sí reinicia a un administrador', async () => {
  reset(); const r = await call('tok-owner', { action: 'reset', org: ORG1, user_id: U.coord });
  assert(r.status === 200, JSON.stringify(r));
});
Deno.test('no se reinicia la propia contraseña', async () => {
  reset(); const r = await call('tok-admin', { action: 'reset', org: ORG1, user_id: U.admin });
  assert(r.status === 400, JSON.stringify(r));
});
Deno.test('usuario ajeno a la organización: 404', async () => {
  reset(); const r = await call('tok-admin', { action: 'reset', org: ORG1, user_id: U.outsider });
  assert(r.status === 404 && users.get(U.outsider)!.password === 'orig', JSON.stringify(r));
});
Deno.test('coordinador no reinicia contraseñas', async () => {
  reset(); const r = await call('tok-coord', { action: 'reset', org: ORG1, user_id: U.aud });
  assert(r.status === 403 && users.get(U.aud)!.password === 'orig', JSON.stringify(r));
});
Deno.test('preflight del navegador acepta los encabezados de la app', async () => {
  const r = await handle(new Request('http://f/hse-admin-users', { method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'authorization, x-application-name, x-client-info, apikey, content-type' } }), env);
  const h = r.headers.get('Access-Control-Allow-Headers') ?? '';
  assert(r.status === 200 && h.includes('x-application-name') && r.headers.get('Access-Control-Allow-Origin') === '*', h);
  const r2 = await handle(new Request('http://f/hse-admin-users', { method: 'OPTIONS' }), env);
  assert((r2.headers.get('Access-Control-Allow-Headers') ?? '').includes('x-application-name'), 'lista fija');
});
Deno.test({ name: 'cierre del servidor simulado', sanitizeResources: false, sanitizeOps: false, fn: async () => { await server.shutdown(); } });
