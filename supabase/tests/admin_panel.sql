-- =====================================================================
-- Panel de administración (0026): quién ve la lista de miembros y qué
-- devuelve. Se revierte sola (termina con una excepción que trae el resultado).
-- =====================================================================
create or replace function pg_temp.as_(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.x(q text) returns text language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 120);
end $$;
create or replace function pg_temp.e(caso text, esperado text, obtenido text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('caso', caso, 'obtenido', obtenido, 'ok', obtenido like esperado));
$$;
do $$
declare
  own uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); coo uuid := gen_random_uuid(); aud uuid := gen_random_uuid();
  oth uuid := gen_random_uuid(); u uuid; oa uuid; ob uuid; mid uuid;
  res jsonb := '[]'::jsonb; tot int; bad int; mail text;
begin
  foreach u in array array[own, adm, coo, aud, oth] loop
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at, last_sign_in_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ap_' || replace(u::text, '-', '') || '@example.com', now(), '{}', now(), now(),
            case when u = aud then null else now() - interval '2 days' end);
  end loop;
  execute 'set local role authenticated';
  foreach u in array array[own, adm, coo, aud, oth] loop perform pg_temp.as_(u); perform hse_bootstrap(); end loop;
  perform pg_temp.as_(oth); ob := hse_create_organization('Org B panel', null);
  perform pg_temp.as_(own); oa := hse_create_organization('Org A panel', null);
  mail := 'ap_' || replace(adm::text, '-', '') || '@example.com'; perform hse_invite_member(oa, mail, 'admin', null);
  mail := 'ap_' || replace(coo::text, '-', '') || '@example.com'; perform hse_invite_member(oa, mail, 'supervisor', null);
  mail := 'ap_' || replace(aud::text, '-', '') || '@example.com'; perform hse_invite_member(oa, mail, 'auditor', null);
  perform hse_invite_member(oa, 'nuevo.usuario@example.com', 'viewer', null);

  res := res || pg_temp.e('propietario ve los 4 miembros', '4', (select count(*)::text from hse_admin_members(oa)));
  res := res || pg_temp.e('trae correo y último ingreso', 'true', (select (bool_and(email like 'ap_%') and count(last_sign_in_at) = 3)::text from hse_admin_members(oa)));
  res := res || pg_temp.e('auditor sin ingresar: último ingreso vacío', 'true', (select (last_sign_in_at is null)::text from hse_admin_members(oa) where user_id = aud));
  res := res || pg_temp.e('la invitación pendiente no es miembro', '0', (select count(*)::text from hse_admin_members(oa) where email = 'nuevo.usuario@example.com'));
  perform pg_temp.as_(adm);
  res := res || pg_temp.e('administrador ve el panel', '4', (select count(*)::text from hse_admin_members(oa)));
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('coordinador HSE no ve el panel', 'err:42501%', pg_temp.x(format('select * from hse_admin_members(%L)', oa)));
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('auditor no ve el panel', 'err:42501%', pg_temp.x(format('select * from hse_admin_members(%L)', oa)));
  perform pg_temp.as_(oth);
  res := res || pg_temp.e('propietario de otra organización no ve el panel ajeno', 'err:42501%', pg_temp.x(format('select * from hse_admin_members(%L)', oa)));
  res := res || pg_temp.e('organización nula', 'err:42501%', pg_temp.x('select * from hse_admin_members(null)'));

  -- cambios por RLS (lo que hace el panel)
  perform pg_temp.as_(adm);
  select id into mid from hse_memberships where organization_id = oa and user_id = aud;
  res := res || pg_temp.e('administrador cambia el rol de un auditor', 'ok:1', pg_temp.x(format('update hse_memberships set role = ''supervisor'' where id = %L', mid)));
  res := res || pg_temp.e('administrador desactiva un miembro', 'ok:1', pg_temp.x(format('update hse_memberships set active = false where id = %L', mid)));
  res := res || pg_temp.e('el panel muestra al miembro inactivo', 'false', (select active::text from hse_admin_members(oa) where user_id = aud));
  select id into mid from hse_memberships where organization_id = oa and user_id = own;
  res := res || pg_temp.e('administrador no puede tocar al propietario', 'ok:0', pg_temp.x(format('update hse_memberships set role = ''viewer'' where id = %L', mid)));
  perform pg_temp.as_(own);
  res := res || pg_temp.e('el único propietario no puede quitarse el rol', 'err:HS422%', pg_temp.x(format('update hse_memberships set role = ''admin'' where id = %L', mid)));
  perform pg_temp.as_(coo);
  select id into mid from hse_memberships where organization_id = oa and user_id = aud;
  res := res || pg_temp.e('coordinador no cambia roles', 'ok:0', pg_temp.x(format('update hse_memberships set role = ''admin'' where id = %L', mid)));
  res := res || pg_temp.e('coordinador no invita', 'err:42501%', pg_temp.x(format('select hse_invite_member(%L, ''x@example.com'', ''auditor'', null)', oa)));
  perform pg_temp.as_(adm);
  res := res || pg_temp.e('reenviar invitación renueva el vencimiento', 'ok:%', pg_temp.x(format('select hse_invite_member(%L, ''nuevo.usuario@example.com'', ''auditor'', null)', oa)));
  res := res || pg_temp.e('reenvío actualiza el rol de la invitación', 'auditor', (select role::text from hse_invitations where organization_id = oa and email = 'nuevo.usuario@example.com' and accepted_at is null));

  select count(*), count(*) filter (where not (e ->> 'ok')::boolean) into tot, bad from jsonb_array_elements(res) e;
  raise exception 'RESULTADO_PANEL %', jsonb_build_object('total', tot, 'fallas', bad,
    'detalle_fallas', coalesce((select jsonb_agg(e) from jsonb_array_elements(res) e where not (e ->> 'ok')::boolean), '[]'));
end $$;
