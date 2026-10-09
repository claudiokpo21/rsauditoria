-- =====================================================================
-- Matriz de autorización por rol + aislamiento entre organizaciones
-- Se ejecuta contra la base real con JWT simulados y SE REVIERTE SOLA
-- (el bloque termina con RAISE EXCEPTION que contiene el informe JSON).
--
--   obtenido = ok:N        la sentencia se ejecutó y afectó/leyó N filas
--            = err:CODE:…  la base la rechazó (42501 permiso, 23503 FK, 23514 regla, HS422 regla de negocio)
--   Un caso "denegado" es correcto con ok:0 (RLS filtra) o con un error distinto de 23505.
--   Un caso "permitido" es correcto con ok:N, N > 0.
-- =====================================================================
create or replace function pg_temp.as_(u uuid, r text default 'authenticated') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', r)::text, true); end $$;

create or replace function pg_temp.x(q text) returns text language plpgsql as $$
declare n bigint;
begin
  execute q; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 110);
end $$;

create or replace function pg_temp.n(q text) returns text language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || q || ') s' into n; return n::text;
exception when others then return 'err:' || sqlstate;
end $$;

-- caso de permiso
create or replace function pg_temp.e(rol text, caso text, esperado text, obtenido text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('rol', rol, 'caso', caso, 'esperado', esperado, 'obtenido', obtenido,
    'ok', case when esperado = 'permitido' then obtenido ~ '^ok:[1-9]'
               else obtenido = 'ok:0' or (obtenido like 'err:%' and obtenido not like 'err:23505%') end));
$$;
-- caso de valor exacto
create or replace function pg_temp.v(rol text, caso text, esperado text, obtenido text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('rol', rol, 'caso', caso, 'esperado', esperado, 'obtenido', obtenido,
    'ok', esperado is not distinct from obtenido));
$$;

do $$
declare
  -- usuarios
  own uuid := gen_random_uuid(); adm uuid := gen_random_uuid(); coo uuid := gen_random_uuid();
  aud1 uuid := gen_random_uuid(); aud2 uuid := gen_random_uuid(); aud3 uuid := gen_random_uuid();
  con uuid := gen_random_uuid(); con2 uuid := gen_random_uuid(); act uuid := gen_random_uuid();
  vie uuid := gen_random_uuid(); baj uuid := gen_random_uuid(); ob uuid := gen_random_uuid();
  u uuid; em text;
  -- datos
  oa uuid; org_b uuid; cx uuid; cy uuid; bx uuid; t uuid; v uuid; s uuid; i1 uuid; i2 uuid; i3 uuid;
  tb uuid; vb uuid; sb uuid; ib uuid; ax uuid; az uuid; ab uuid; f1 uuid; f3 uuid; a1 uuid; a2 uuid; a3 uuid;
  v2 uuid; it2 uuid; rx uuid; path_x text; path_dummy text;
  r jsonb := '[]'::jsonb; tmp text; tot int; bad int;
begin
  -- ------------------------------------------------------------- usuarios de prueba
  foreach u in array array[own, adm, coo, aud1, aud2, aud3, con, con2, act, vie, baj, ob] loop
    em := 'authz_' || replace(u::text, '-', '') || '@example.com';
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', em, now(), '{}', now(), now());
  end loop;

  execute 'set local role authenticated';
  foreach u in array array[own, adm, coo, aud1, aud2, aud3, con, con2, act, vie, baj, ob] loop
    perform pg_temp.as_(u); perform hse_bootstrap();
  end loop;

  -- ------------------------------------------------------------- organización B (otro cliente)
  perform pg_temp.as_(ob);
  org_b := hse_create_organization('Org B authz', null);
  insert into hse_companies (organization_id, name) values (org_b, 'Empresa B') returning id into bx;
  insert into hse_templates (organization_id, name, category) values (org_b, 'Plantilla B', 'csms') returning id into tb;
  insert into hse_template_versions (organization_id, template_id, version_number) values (org_b, tb, 1) returning id into vb;
  insert into hse_template_sections (organization_id, version_id, title) values (org_b, vb, 'S1') returning id into sb;
  insert into hse_template_items (organization_id, version_id, section_id, question) values (org_b, vb, sb, 'Pregunta B') returning id into ib;
  perform hse_publish_template_version(vb);
  insert into hse_audits (organization_id, template_version_id, company_id, title) values (org_b, vb, bx, 'Auditoría B') returning id into ab;

  -- ------------------------------------------------------------- organización A
  perform pg_temp.as_(own);
  oa := hse_create_organization('Org A authz', null);
  insert into hse_companies (organization_id, name) values (oa, 'Contratista X') returning id into cx;
  insert into hse_companies (organization_id, name) values (oa, 'Contratista Y') returning id into cy;
  insert into hse_templates (organization_id, name, category) values (oa, 'Plantilla A', 'csms') returning id into t;
  insert into hse_template_versions (organization_id, template_id, version_number) values (oa, t, 1) returning id into v;
  insert into hse_template_sections (organization_id, version_id, title) values (oa, v, 'S1') returning id into s;
  insert into hse_template_items (organization_id, version_id, section_id, question) values (oa, v, s, 'Pregunta 1') returning id into i1;
  insert into hse_template_items (organization_id, version_id, section_id, question, evidence_required_on_fail) values (oa, v, s, 'Pregunta 2', false) returning id into i2;
  insert into hse_template_items (organization_id, version_id, section_id, question, is_required) values (oa, v, s, 'Pregunta 3', false) returning id into i3;
  perform hse_publish_template_version(v);
  perform hse_invite_member(oa, 'authz_' || replace(adm::text, '-', '') || '@example.com', 'admin', null);
  perform hse_invite_member(oa, 'authz_' || replace(coo::text, '-', '') || '@example.com', 'supervisor', null);
  perform hse_invite_member(oa, 'authz_' || replace(aud1::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'authz_' || replace(aud2::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'authz_' || replace(aud3::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'authz_' || replace(baj::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'authz_' || replace(con::text, '-', '') || '@example.com', 'contractor', cx);
  perform hse_invite_member(oa, 'authz_' || replace(con2::text, '-', '') || '@example.com', 'contractor', cy);
  perform hse_invite_member(oa, 'authz_' || replace(act::text, '-', '') || '@example.com', 'action_owner', null);
  perform hse_invite_member(oa, 'authz_' || replace(vie::text, '-', '') || '@example.com', 'viewer', null);

  -- ============================================================= 1. creación de auditorías
  perform pg_temp.as_(coo);
  insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id)
  values (oa, v, cx, 'Auditoría X', aud1) returning id into ax;
  r := r || pg_temp.v('Coordinador HSE', 'crea auditoría X y asigna líder (auditor 1)', 'true', (ax is not null)::text);
  r := r || pg_temp.e('Coordinador HSE', 'agrega auditor 3 como observador', 'permitido', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''observador'')', oa, ax, aud3)));
  r := r || pg_temp.e('Coordinador HSE', 'agrega auditor "baja" como auditor', 'permitido', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''auditor'')', oa, ax, baj)));
  r := r || pg_temp.e('Coordinador HSE', 'agrega contratista como auditor de la auditoría', 'denegado', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''auditor'')', oa, ax, con)));
  r := r || pg_temp.e('Coordinador HSE', 'agrega usuario de otra organización como observador', 'denegado', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''observador'')', oa, ax, ob)));
  r := r || pg_temp.e('Coordinador HSE', 'crea auditoría con líder de otra organización', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id) values (%L,%L,%L,''x'',%L)', oa, v, cx, ob)));
  r := r || pg_temp.e('Coordinador HSE', 'crea auditoría con empresa de otra organización (company_id ajeno)', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, company_id, title) values (%L,%L,%L,''x'')', oa, v, bx)));
  r := r || pg_temp.e('Coordinador HSE', 'crea auditoría directamente cerrada', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, company_id, title, status) values (%L,%L,%L,''x'',''cerrada'')', oa, v, cx)));

  perform pg_temp.as_(aud2);
  insert into hse_audits (organization_id, template_version_id, company_id, title) values (oa, v, cy, 'Auditoría Z') returning id into az;
  r := r || pg_temp.v('Auditor', 'crea su propia auditoría Z (queda como líder)', 'true',
    ((select lead_auditor_id from hse_audits where id = az) = aud2)::text);
  r := r || pg_temp.e('Auditor', 'crea auditoría con otro auditor como líder', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id) values (%L,%L,%L,''x'',%L)', oa, v, cx, aud1)));
  r := r || pg_temp.e('Auditor', 'crea auditoría en otra organización (organization_id ajeno)', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, title) values (%L,%L,''x'')', org_b, vb)));
  r := r || pg_temp.e('Auditor', 'crea auditoría con plantilla de otra organización', 'denegado', pg_temp.x(format(
    'insert into hse_audits (organization_id, template_version_id, title) values (%L,%L,''x'')', oa, vb)));
  foreach u in array array[con, act, vie] loop
    perform pg_temp.as_(u);
    r := r || pg_temp.e(case u when con then 'Resp. contratista' when act then 'Resp. acciones' else 'Consulta' end,
      'crea auditoría', 'denegado', pg_temp.x(format(
      'insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id) values (%L,%L,%L,''x'',%L)', oa, v, cx, u)));
  end loop;

  -- ============================================================= 2. visibilidad de auditorías
  perform pg_temp.as_(own);  r := r || pg_temp.v('Administrador (propietario)', 'auditorías visibles de la org', '2', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(adm);  r := r || pg_temp.v('Administrador', 'auditorías visibles de la org', '2', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(coo);  r := r || pg_temp.v('Coordinador HSE', 'auditorías visibles de la org', '2', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(aud1); r := r || pg_temp.v('Auditor (líder X)', 'sólo ve las auditorías asignadas', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(aud2); r := r || pg_temp.v('Auditor (líder Z)', 'sólo ve las auditorías asignadas', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(aud2); r := r || pg_temp.v('Auditor (líder Z)', 'lee auditoría X por id (no asignado)', '0', pg_temp.n(format('select 1 from hse_audits where id = %L', ax)));
  perform pg_temp.as_(aud3); r := r || pg_temp.v('Auditor observador', 've la auditoría donde observa', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(con);  r := r || pg_temp.v('Resp. contratista X', 'sólo ve auditorías de su empresa', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L and company_id = %L', oa, cx)));
  perform pg_temp.as_(con);  r := r || pg_temp.v('Resp. contratista X', 'lee auditoría Z (otra empresa) por id', '0', pg_temp.n(format('select 1 from hse_audits where id = %L', az)));
  perform pg_temp.as_(con);  r := r || pg_temp.v('Resp. contratista X', 'empresas visibles', '1', pg_temp.n(format('select 1 from hse_companies where organization_id = %L', oa)));
  perform pg_temp.as_(con2); r := r || pg_temp.v('Resp. contratista Y', 'sólo ve auditorías de su empresa', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(act);  r := r || pg_temp.v('Resp. acciones', 'no ve auditorías', '0', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(vie);  r := r || pg_temp.v('Consulta', 've todas las auditorías (lectura)', '2', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));

  -- ============================================================= 3. participantes
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'agrega participantes a su auditoría', 'denegado', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''auditor'')', oa, ax, aud2)));
  r := r || pg_temp.e('Auditor (líder X)', 'quita al observador', 'denegado', pg_temp.x(format(
    'delete from hse_audit_participants where audit_id = %L and user_id = %L', ax, aud3)));
  perform pg_temp.as_(ob);
  r := r || pg_temp.e('Admin org B', 'se agrega como participante de X (organization_id de A)', 'denegado', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''auditor'')', oa, ax, ob)));
  r := r || pg_temp.e('Admin org B', 'se agrega como participante de X (organization_id de B)', 'denegado', pg_temp.x(format(
    'insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (%L,%L,%L,''auditor'')', org_b, ax, ob)));

  -- ============================================================= 4. respuestas del checklist
  perform pg_temp.as_(aud1);
  rx := gen_random_uuid();
  r := r || pg_temp.e('Auditor (líder X)', 'responde ítem de su auditoría', 'permitido', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer, created_by) values (%L,%L,%L,%L,''cumple'',%L)', rx, oa, ax, i1, own)));
  r := r || pg_temp.v('Auditor (líder X)', 'created_by falsificado se reemplaza por el del JWT', aud1::text,
    (select created_by::text from hse_audit_responses where id = rx));
  r := r || pg_temp.e('Auditor (líder X)', 'modifica su respuesta', 'permitido', pg_temp.x(format(
    'update hse_audit_responses set comment = ''ajuste'' where id = %L', rx)));
  r := r || pg_temp.e('Auditor (líder X)', 'borra una respuesta (sólo coordinación)', 'denegado', pg_temp.x(format(
    'delete from hse_audit_responses where id = %L', rx)));
  r := r || pg_temp.e('Auditor (líder X)', 'responde con organization_id de otra org', 'denegado', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''cumple'')', org_b, ax, i3)));
  r := r || pg_temp.e('Auditor (líder X)', 'responde en auditoría de otra org (audit_id ajeno)', 'denegado', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''cumple'')', org_b, ab, ib)));
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'responde ítem de cualquier auditoría', 'permitido', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''no_cumple'')', oa, ax, i2)));
  foreach u in array array[aud2, aud3, con, act, vie, ob] loop
    perform pg_temp.as_(u);
    tmp := case u when aud2 then 'Auditor no asignado' when aud3 then 'Auditor observador' when con then 'Resp. contratista X'
                  when act then 'Resp. acciones' when vie then 'Consulta' else 'Admin org B' end;
    r := r || pg_temp.e(tmp, 'responde ítem de la auditoría X', 'denegado', pg_temp.x(format(
      'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''cumple'')', oa, ax, i3)));
    r := r || pg_temp.e(tmp, 'modifica respuesta de la auditoría X', 'denegado', pg_temp.x(format(
      'update hse_audit_responses set answer = ''no_cumple'' where id = %L', rx)));
  end loop;
  perform pg_temp.as_(con);  r := r || pg_temp.v('Resp. contratista X', 'lee respuestas de auditoría de su empresa', '2', pg_temp.n(format('select 1 from hse_audit_responses where audit_id = %L', ax)));
  perform pg_temp.as_(con2); r := r || pg_temp.v('Resp. contratista Y', 'lee respuestas de auditoría de otra empresa', '0', pg_temp.n(format('select 1 from hse_audit_responses where audit_id = %L', ax)));

  -- ============================================================= 5. cambios de cabecera de auditoría
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'edita título/alcance', 'permitido', pg_temp.x(format('update hse_audits set scope = ''alcance'' where id = %L', ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'cambia la empresa auditada', 'denegado', pg_temp.x(format('update hse_audits set company_id = %L where id = %L', cy, ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'se reasigna el líder', 'denegado', pg_temp.x(format('update hse_audits set lead_auditor_id = %L where id = %L', aud2, ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'mueve la auditoría a otra organización', 'denegado', pg_temp.x(format('update hse_audits set organization_id = %L where id = %L', org_b, ax)));
  -- 0027: sin el plan aceptado por el cliente no se inicia
  r := r || pg_temp.e('Auditor (líder X)', 'inicia sin plan aceptado (0027)', 'denegado', pg_temp.x(format('update hse_audits set status = ''en_curso'' where id = %L', ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'registra la aceptación del plan por el cliente (0027)', 'permitido', pg_temp.x(format('update hse_audits set report_data = ''{"plan_approval":{"status":"aprobado","approved_by":"Cliente","approved_at":"2026-05-20"}}'' where id = %L', ax)));
  perform pg_temp.x(format('update hse_audits set status = ''en_curso'', started_at = ''2000-01-01'' where id = %L', ax));
  r := r || pg_temp.v('Auditor (líder X)', 'started_at falsificado lo fija el servidor', 'false',
    ((select started_at from hse_audits where id = ax) < '2001-01-01')::text);
  foreach u in array array[aud2, aud3, con, act, vie, ob] loop
    perform pg_temp.as_(u);
    tmp := case u when aud2 then 'Auditor no asignado' when aud3 then 'Auditor observador' when con then 'Resp. contratista X'
                  when act then 'Resp. acciones' when vie then 'Consulta' else 'Admin org B' end;
    r := r || pg_temp.e(tmp, 'modifica la auditoría X', 'denegado', pg_temp.x(format('update hse_audits set title = ''alterada'' where id = %L', ax)));
  end loop;

  -- ============================================================= 6. hallazgos y acciones
  perform pg_temp.as_(aud1);
  f1 := gen_random_uuid(); f3 := gen_random_uuid(); a1 := gen_random_uuid(); a2 := gen_random_uuid(); a3 := gen_random_uuid();
  r := r || pg_temp.e('Auditor (líder X)', 'registra hallazgo 1 (INSERT … RETURNING, como el cliente)', 'permitido', pg_temp.x(format(
    'insert into hse_findings (id, organization_id, audit_id, title, finding_type) values (%L,%L,%L,''Hallazgo 1'',''nc_menor'') returning id', f1, oa, ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'registra hallazgo 3 (NC mayor)', 'permitido', pg_temp.x(format(
    'insert into hse_findings (id, organization_id, audit_id, title, finding_type) values (%L,%L,%L,''Hallazgo 3 NC sin acciones'',''nc_mayor'')', f3, oa, ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'registra hallazgo ya verificado', 'denegado', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, title, status) values (%L,%L,''x'',''verificado'')', oa, ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'registra hallazgo en auditoría de otra org', 'denegado', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, title) values (%L,%L,''x'')', oa, ab)));
  r := r || pg_temp.e('Auditor (líder X)', 'acción con responsable de otra organización', 'denegado', pg_temp.x(format(
    'insert into hse_actions (organization_id, finding_id, description, due_date, responsible_user_id) values (%L,%L,''x'',current_date+5,%L)', oa, f1, ob)));
  r := r || pg_temp.e('Auditor (líder X)', 'crea acción 1 (responsable: resp. de acciones)', 'permitido', pg_temp.x(format(
    'insert into hse_actions (id, organization_id, finding_id, description, due_date, responsible_user_id) values (%L,%L,%L,''Acción 1'',current_date+10,%L) returning id', a1, oa, f1, act)));
  r := r || pg_temp.e('Auditor (líder X)', 'crea acción 2 (responsable: contratista X)', 'permitido', pg_temp.x(format(
    'insert into hse_actions (id, organization_id, finding_id, description, due_date, responsible_company_id) values (%L,%L,%L,''Acción 2'',current_date+10,%L)', a2, oa, f1, cx)));
  r := r || pg_temp.e('Auditor (líder X)', 'crea acción 3 (responsable: él mismo)', 'permitido', pg_temp.x(format(
    'insert into hse_actions (id, organization_id, finding_id, description, due_date, responsible_user_id) values (%L,%L,%L,''Acción 3'',current_date+10,%L)', a3, oa, f1, aud1)));
  r := r || pg_temp.e('Auditor (líder X)', 'registra la causa raíz del hallazgo 1', 'permitido', pg_temp.x(format(
    'update hse_findings set root_cause = ''Falta de control de vencimientos'', rca_method = ''cinco_porques'' where id = %L', f1)));

  foreach u in array array[aud2, aud3, con, act, vie, ob] loop
    perform pg_temp.as_(u);
    tmp := case u when aud2 then 'Auditor no asignado' when aud3 then 'Auditor observador' when con then 'Resp. contratista X'
                  when act then 'Resp. acciones' when vie then 'Consulta' else 'Admin org B' end;
    r := r || pg_temp.e(tmp, 'registra hallazgo en X', 'denegado', pg_temp.x(format(
      'insert into hse_findings (organization_id, audit_id, title) values (%L,%L,''intruso'')', oa, ax)));
    r := r || pg_temp.e(tmp, 'crea acción en hallazgo 1', 'denegado', pg_temp.x(format(
      'insert into hse_actions (organization_id, finding_id, description, due_date) values (%L,%L,''x'',current_date+5)', oa, f1)));
  end loop;

  perform pg_temp.as_(act);
  r := r || pg_temp.v('Resp. acciones', 've el hallazgo con acción asignada', '1', pg_temp.n(format('select 1 from hse_findings where id = %L', f1)));
  r := r || pg_temp.v('Resp. acciones', 've sólo sus acciones', '1', pg_temp.n(format('select 1 from hse_actions where finding_id = %L', f1)));
  r := r || pg_temp.v('Resp. acciones', 've otros hallazgos de la auditoría', '0', pg_temp.n(format('select 1 from hse_findings where id = %L', f3)));
  r := r || pg_temp.e('Resp. acciones', 'cambia vencimiento de su acción', 'denegado', pg_temp.x(format('update hse_actions set due_date = current_date + 90 where id = %L', a1)));
  r := r || pg_temp.e('Resp. acciones', 'se reasigna la acción a otro', 'denegado', pg_temp.x(format('update hse_actions set responsible_user_id = %L where id = %L', vie, a1)));
  r := r || pg_temp.e('Resp. acciones', 'informa avance y completa su acción', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''completada'', progress_notes = ''hecho'' where id = %L', a1)));
  r := r || pg_temp.e('Resp. acciones', 'verifica su propia acción', 'denegado', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a1)));
  r := r || pg_temp.e('Resp. acciones', 'modifica acción de otro', 'denegado', pg_temp.x(format('update hse_actions set progress_notes = ''x'' where id = %L', a2)));
  r := r || pg_temp.e('Resp. acciones', 'modifica el hallazgo', 'denegado', pg_temp.x(format('update hse_findings set title = ''x'' where id = %L', f1)));

  perform pg_temp.as_(con);
  r := r || pg_temp.v('Resp. contratista X', 've hallazgos de su empresa', '2', pg_temp.n(format('select 1 from hse_findings where audit_id = %L', ax)));
  r := r || pg_temp.e('Resp. contratista X', 'completa la acción de su empresa', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''completada'', progress_notes = ''listo'' where id = %L', a2)));
  r := r || pg_temp.e('Resp. contratista X', 'modifica acción asignada a otro usuario', 'denegado', pg_temp.x(format('update hse_actions set progress_notes = ''x'' where id = %L', a1)));
  r := r || pg_temp.e('Resp. contratista X', 'cierra el hallazgo', 'denegado', pg_temp.x(format('update hse_findings set status = ''cerrado'' where id = %L', f1)));
  perform pg_temp.as_(con2);
  r := r || pg_temp.v('Resp. contratista Y', 've hallazgos/acciones de otra empresa', '0', pg_temp.n(format(
    'select id from hse_findings where audit_id = %L union all select id from hse_actions where finding_id = %L', ax, f1)));
  perform pg_temp.as_(vie);
  r := r || pg_temp.e('Consulta', 'completa una acción', 'denegado', pg_temp.x(format('update hse_actions set status = ''completada'' where id = %L', a3)));

  -- ============================================================= 7. evidencias y Storage
  path_x := oa || '/' || ax || '/' || gen_random_uuid() || '.jpg';
  perform pg_temp.as_(act);
  r := r || pg_temp.e('Resp. acciones', 'sube archivo a la carpeta de la auditoría (acción propia)', 'permitido', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', path_x, act)));
  r := r || pg_temp.e('Resp. acciones', 'registra evidencia de su acción (uploaded_by falsificado)', 'permitido', pg_temp.x(format(
    'insert into hse_evidences (organization_id, audit_id, action_id, storage_path, mime_type, size_bytes, uploaded_by) values (%L,%L,%L,%L,''image/jpeg'',100,%L)', oa, ax, a1, path_x, own)));
  r := r || pg_temp.v('Resp. acciones', 'uploaded_by lo fija el servidor', act::text, (select uploaded_by::text from hse_evidences where storage_path = path_x));
  r := r || pg_temp.v('Resp. acciones', 'lee el archivo de su evidencia', '1', pg_temp.n(format('select 1 from storage.objects where name = %L', path_x)));
  r := r || pg_temp.e('Resp. acciones', 'evidencia de checklist (sin acción)', 'denegado', pg_temp.x(format(
    'insert into hse_evidences (organization_id, audit_id, storage_path, mime_type, size_bytes) values (%L,%L,%L,''image/jpeg'',100)', oa, ax, oa || '/' || ax || '/z1.jpg')));
  r := r || pg_temp.e('Resp. acciones', 'evidencia de su acción declarando otra auditoría', 'denegado', pg_temp.x(format(
    'insert into hse_evidences (organization_id, audit_id, action_id, storage_path, mime_type, size_bytes) values (%L,%L,%L,%L,''image/jpeg'',100)', oa, az, a1, oa || '/' || az || '/z2.jpg')));
  r := r || pg_temp.e('Resp. acciones', 'reemplaza un archivo (update en Storage)', 'denegado', pg_temp.x(format(
    'update storage.objects set metadata = ''{}'' where name = %L', path_x)));
  r := r || pg_temp.e('Resp. acciones', 'borra un archivo', 'denegado', pg_temp.x(format('delete from storage.objects where name = %L', path_x)));

  perform pg_temp.as_(con2);
  r := r || pg_temp.e('Resp. contratista Y', 'sube archivo a auditoría de otra empresa', 'denegado', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', oa || '/' || ax || '/c2.jpg', con2)));
  r := r || pg_temp.v('Resp. contratista Y', 'lee archivos de auditoría de otra empresa', '0', pg_temp.n(format('select 1 from storage.objects where name = %L', path_x)));
  perform pg_temp.as_(aud2);
  r := r || pg_temp.e('Auditor no asignado', 'sube archivo a auditoría ajena', 'denegado', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', oa || '/' || ax || '/a2.jpg', aud2)));
  r := r || pg_temp.v('Auditor no asignado', 'lee archivos de auditoría ajena', '0', pg_temp.n(format('select 1 from storage.objects where name = %L', path_x)));
  perform pg_temp.as_(ob);
  r := r || pg_temp.e('Admin org B', 'sube archivo a carpeta de org A', 'denegado', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', oa || '/' || ax || '/b.jpg', ob)));
  r := r || pg_temp.e('Admin org B', 'sube archivo con su org y una auditoría de A', 'denegado', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', org_b || '/' || ax || '/b.jpg', ob)));
  r := r || pg_temp.v('Admin org B', 'lee archivos de org A', '0', pg_temp.n(format('select 1 from storage.objects where name like %L', oa || '/%')));
  r := r || pg_temp.e('Admin org B', 'borra archivos de org A', 'denegado', pg_temp.x(format('delete from storage.objects where name = %L', path_x)));
  perform pg_temp.as_(aud1);
  path_dummy := oa || '/' || ax || '/' || gen_random_uuid() || '.jpg';
  r := r || pg_temp.e('Auditor (líder X)', 'sube archivo a su auditoría', 'permitido', pg_temp.x(format(
    'insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', path_dummy, aud1)));
  r := r || pg_temp.e('Auditor (líder X)', 'borra un archivo (sólo administración)', 'denegado', pg_temp.x(format('delete from storage.objects where name = %L', path_dummy)));
  -- flujo de depuración: el auditor registra la evidencia del archivo y luego la da de baja (borrado lógico);
  -- recién entonces Administración elimina el archivo. Un archivo de una evidencia VIGENTE no se debe borrar:
  -- la auditoría no podría completarse (hse_audit_readiness lo detecta como "Evidencia sin archivo").
  r := r || pg_temp.e('Auditor (líder X)', 'registra la evidencia del archivo subido', 'permitido', pg_temp.x(format(
    'insert into hse_evidences (organization_id, audit_id, response_id, storage_path, mime_type, size_bytes) values (%L,%L,%L,%L,''image/jpeg'',10)', oa, ax, rx, path_dummy)));
  r := r || pg_temp.e('Auditor (líder X)', 'da de baja su evidencia (borrado lógico)', 'permitido', pg_temp.x(format(
    'update hse_evidences set deleted_at = now() where storage_path = %L', path_dummy)));
  perform pg_temp.x(format('insert into storage.objects (bucket_id, name, owner) values (''hse-evidencias'',%L,%L)', oa || '/' || ax || '/huerfano.jpg', aud1));
  perform pg_temp.as_(adm);
  -- Supabase bloquea TODO DELETE SQL directo sobre storage.objects (trigger storage.protect_delete, se dispara
  -- antes de evaluar filas) y exige su API, que aplica las mismas políticas. Por eso se verifica la política
  -- en sí: el Administrador ve el archivo y la condición de borrado le es verdadera; en un PostgreSQL sin ese
  -- trigger (supabase/local) el DELETE efectivamente borra 1 fila.
  r := r || pg_temp.v('Administrador', 've el archivo de la evidencia dada de baja', '1', pg_temp.n(format('select 1 from storage.objects where name = %L', path_dummy)));
  r := r || pg_temp.v('Administrador', 'la política de borrado de archivos lo habilita', 'true',
    (select public.hse_has_role(public.hse_try_uuid((storage.foldername(path_dummy))[1]), '{owner,admin}'))::text);
  tmp := pg_temp.x(format('delete from storage.objects where name = %L', path_dummy));
  r := r || pg_temp.v('Administrador', 'borra el archivo (local: borrado efectivo; Supabase: exige la API)', 'permitido',
    case when tmp = 'ok:1' or tmp like '%Direct deletion%' then 'permitido' else tmp end);
  r := r || pg_temp.v('Administrador', 'archivo huérfano (sin evidencia registrada): no visible por la API', '0',
    pg_temp.n(format('select 1 from storage.objects where name = %L', oa || '/' || ax || '/huerfano.jpg')));

  -- ============================================================= 8. verificación de acciones y hallazgos
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'verifica acción 1 sin indicar eficacia', 'denegado', pg_temp.x(format(
    'update hse_actions set status = ''verificada'' where id = %L', a1)));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica acción 1 (eficaz)', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'', verification_notes = ''ok'' where id = %L', a1)));
  r := r || pg_temp.v('Auditor (líder X)', 'verified_by de la acción lo fija el servidor', aud1::text, (select verified_by::text from hse_actions where id = a1));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica acción 2 (eficaz)', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a2)));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica acción 3 que no está completada', 'denegado', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a3)));
  perform pg_temp.x(format('update hse_actions set status = ''completada'' where id = %L', a3));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica su propia acción (independencia)', 'denegado', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a3)));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica hallazgo que no está cerrado', 'denegado', pg_temp.x(format(
    'update hse_findings set status = ''verificado'', verification_notes = ''x'', effectiveness = ''eficaz'' where id = %L', f1)));
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'verifica acción 3', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a3)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'cierra hallazgo 1 (pendiente de verificación)', 'permitido', pg_temp.x(format(
    'update hse_findings set status = ''cerrado'' where id = %L', f1)));
  r := r || pg_temp.e('Auditor (líder X)', 'verifica hallazgo donde es responsable de una acción', 'denegado', pg_temp.x(format(
    'update hse_findings set status = ''verificado'', verification_notes = ''revisado en campo'', effectiveness = ''eficaz'' where id = %L', f1)));
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'verifica hallazgo sin notas ni eficacia', 'denegado', pg_temp.x(format(
    'update hse_findings set status = ''verificado'' where id = %L', f1)));
  r := r || pg_temp.e('Coordinador HSE', 'verifica hallazgo 1 con notas y eficacia', 'permitido', pg_temp.x(format(
    'update hse_findings set status = ''verificado'', verification_notes = ''revisado en campo'', effectiveness = ''eficaz'', verified_by = %L where id = %L', own, f1)));
  r := r || pg_temp.v('Coordinador HSE', 'verified_by falsificado lo fija el servidor', coo::text, (select verified_by::text from hse_findings where id = f1));
  r := r || pg_temp.e('Coordinador HSE', 'modifica hallazgo verificado', 'denegado', pg_temp.x(format('update hse_findings set title = ''x'' where id = %L', f1)));
  r := r || pg_temp.e('Coordinador HSE', 'devuelve hallazgo verificado a abierto por UPDATE', 'denegado', pg_temp.x(format('update hse_findings set status = ''abierto'' where id = %L', f1)));
  -- NC 3: causa raíz y acción correctiva completada pero NO verificada (0020 exige ambas para cerrar)
  perform pg_temp.x(format('update hse_findings set root_cause = ''Falta de procedimiento'' where id = %L', f3));
  perform pg_temp.x(format('insert into hse_actions (organization_id, finding_id, description, action_type, due_date) values (%L,%L,''Redactar procedimiento'',''correctiva'',current_date+5)', oa, f3));
  perform pg_temp.x(format('update hse_actions set status = ''completada'' where finding_id = %L', f3));
  r := r || pg_temp.e('Coordinador HSE', 'cierra NC 3 con causa raíz y acción correctiva completada', 'permitido', pg_temp.x(format('update hse_findings set status = ''cerrado'' where id = %L', f3)));
  r := r || pg_temp.e('Coordinador HSE', 'verifica NC sin ninguna acción verificada', 'denegado', pg_temp.x(format(
    'update hse_findings set status = ''verificado'', verification_notes = ''x'', effectiveness = ''eficaz'' where id = %L', f3)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'reabre hallazgo verificado', 'denegado', pg_temp.x(format('select hse_reopen_finding(%L, ''motivo suficientemente largo para reabrir'')', f1)));
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'reabre hallazgo sin motivo suficiente', 'denegado', pg_temp.x(format('select hse_reopen_finding(%L, ''porque sí'')', f1)));
  r := r || pg_temp.e('Coordinador HSE', 'reabre hallazgo verificado con motivo', 'permitido', pg_temp.x(format('select hse_reopen_finding(%L, ''Nueva inspección detectó recurrencia del desvío'')', f1)));
  r := r || pg_temp.v('Coordinador HSE', 'estado tras reabrir', 'en_tratamiento', (select status::text from hse_findings where id = f1));

  -- ============================================================= 9. cierre y reapertura de auditorías
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'completa su auditoría', 'permitido', pg_temp.x(format('update hse_audits set status = ''completada'' where id = %L', ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'cierra la auditoría', 'denegado', pg_temp.x(format('update hse_audits set status = ''cerrada'' where id = %L', ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'reabre la auditoría completada', 'denegado', pg_temp.x(format('update hse_audits set status = ''en_curso'' where id = %L', ax)));
  r := r || pg_temp.e('Auditor (líder X)', 'responde en auditoría completada', 'denegado', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''cumple'')', oa, ax, i3)));
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'cierra sin revisión (0020)', 'denegado', pg_temp.x(format('update hse_audits set status = ''cerrada'', summary = ''Resumen'' where id = %L', ax)));
  r := r || pg_temp.e('Coordinador HSE', 'revisa la auditoría completada (no es el líder)', 'permitido', pg_temp.x(format('select hse_review_audit(%L, ''Revisión del informe'')', ax)));
  r := r || pg_temp.e('Coordinador HSE', 'cierra la auditoría completada y revisada', 'permitido', pg_temp.x(format('update hse_audits set status = ''cerrada'', summary = ''Resumen de la auditoría'' where id = %L', ax)));
  r := r || pg_temp.v('Coordinador HSE', 'closed_by lo fija el servidor', coo::text, (select closed_by::text from hse_audits where id = ax));
  r := r || pg_temp.e('Coordinador HSE', 'modifica auditoría cerrada', 'denegado', pg_temp.x(format('update hse_audits set summary = ''x'' where id = %L', ax)));
  r := r || pg_temp.e('Coordinador HSE', 'reabre auditoría cerrada por UPDATE', 'denegado', pg_temp.x(format('update hse_audits set status = ''en_curso'' where id = %L', ax)));
  r := r || pg_temp.e('Coordinador HSE', 'reabre auditoría cerrada por RPC (requiere Administrador)', 'denegado', pg_temp.x(format('select hse_reopen_audit(%L, ''Motivo suficientemente largo para reabrir'')', ax)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor (líder X)', 'modifica auditoría cerrada', 'denegado', pg_temp.x(format('update hse_audits set summary = ''x'' where id = %L', ax)));
  perform pg_temp.as_(ob);
  r := r || pg_temp.e('Admin org B', 'reabre auditoría de org A por RPC', 'denegado', pg_temp.x(format('select hse_reopen_audit(%L, ''Motivo suficientemente largo para reabrir'')', ax)));
  perform pg_temp.as_(adm);
  r := r || pg_temp.e('Administrador', 'reabre sin motivo suficiente', 'denegado', pg_temp.x(format('select hse_reopen_audit(%L, ''corto'')', ax)));
  r := r || pg_temp.e('Administrador', 'reabre auditoría cerrada con motivo', 'permitido', pg_temp.x(format('select hse_reopen_audit(%L, ''Error de carga en ítem 2 detectado por el cliente'')', ax)));
  r := r || pg_temp.v('Administrador', 'estado tras reabrir', 'en_curso', (select status::text from hse_audits where id = ax));
  r := r || pg_temp.v('Administrador', 'registro de reaperturas (auditoría + hallazgo)', '2', pg_temp.n(format('select 1 from hse_reopen_log where organization_id = %L', oa)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.v('Auditor (líder X)', 'lee el registro de reaperturas', '0', pg_temp.n(format('select 1 from hse_reopen_log where organization_id = %L', oa)));
  r := r || pg_temp.e('Auditor (líder X)', 'escribe en el registro de reaperturas', 'denegado', pg_temp.x(format(
    'insert into hse_reopen_log (organization_id, entity, entity_id, previous_status, new_status, reason, reopened_by) values (%L,''auditoria'',%L,''x'',''y'',''motivo suficientemente largo'',%L)', oa, ax, aud1)));

  -- ============================================================= 10. plantillas y criterios
  foreach u in array array[aud1, con, act, vie] loop
    perform pg_temp.as_(u);
    tmp := case u when aud1 then 'Auditor' when con then 'Resp. contratista X' when act then 'Resp. acciones' else 'Consulta' end;
    r := r || pg_temp.e(tmp, 'crea plantilla', 'denegado', pg_temp.x(format(
      'insert into hse_templates (organization_id, name, category) values (%L,''x'',''csms'')', oa)));
    r := r || pg_temp.e(tmp, 'publica versión', 'denegado', pg_temp.x(format('select hse_publish_template_version(%L)', v)));
    r := r || pg_temp.e(tmp, 'cambia criterio de puntuación', 'denegado', pg_temp.x(format(
      'update hse_template_items set weight = 99 where id = %L', i1)));
  end loop;
  perform pg_temp.as_(coo);
  r := r || pg_temp.e('Coordinador HSE', 'cambia peso de ítem publicado', 'denegado', pg_temp.x(format('update hse_template_items set weight = 99 where id = %L', i1)));
  r := r || pg_temp.e('Coordinador HSE', 'cambia metodología de versión publicada', 'denegado', pg_temp.x(format(
    'update hse_template_versions set scoring_config = ''{"x":1}'' where id = %L', v)));
  v2 := hse_new_template_version(t, v);
  r := r || pg_temp.v('Coordinador HSE', 'crea nueva versión borrador', 'true', (v2 is not null)::text);
  r := r || pg_temp.e('Coordinador HSE', 'publica por UPDATE directo (sin RPC)', 'denegado', pg_temp.x(format(
    'update hse_template_versions set status = ''publicada'', published_at = now() where id = %L', v2)));
  select id into it2 from hse_template_items where version_id = v2 limit 1;
  r := r || pg_temp.e('Coordinador HSE', 'cambia peso en el borrador', 'permitido', pg_temp.x(format('update hse_template_items set weight = 3 where id = %L', it2)));
  r := r || pg_temp.e('Coordinador HSE', 'elimina versión publicada', 'denegado', pg_temp.x(format('delete from hse_template_versions where id = %L', v)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor', 'cambia peso en el borrador', 'denegado', pg_temp.x(format('update hse_template_items set weight = 7 where id = %L', it2)));
  perform pg_temp.as_(adm);
  r := r || pg_temp.e('Administrador', 'elimina versión publicada', 'denegado', pg_temp.x(format('delete from hse_template_versions where id = %L', v)));
  perform pg_temp.as_(ob);
  r := r || pg_temp.e('Admin org B', 'publica borrador de org A', 'denegado', pg_temp.x(format('select hse_publish_template_version(%L)', v2)));
  r := r || pg_temp.e('Admin org B', 'edita ítem de org A', 'denegado', pg_temp.x(format('update hse_template_items set weight = 9 where id = %L', it2)));
  r := r || pg_temp.e('Admin org B', 'crea versión de plantilla de org A', 'denegado', pg_temp.x(format('select hse_new_template_version(%L, %L)', t, v)));

  -- ============================================================= 11. historial (quién cambió qué)
  perform pg_temp.as_(coo);
  r := r || pg_temp.v('Coordinador HSE', 'historial: alta de respuesta registrada con autor auditor 1', 'true', (exists (
    select 1 from hse_change_log where record_id = rx and action = 'INSERT' and user_id = aud1))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: modificación de respuesta con autor', 'true', (exists (
    select 1 from hse_change_log where record_id = rx and action = 'UPDATE' and user_id = aud1))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: cierre de auditoría con autor coordinador', 'true', (exists (
    select 1 from hse_change_log where record_id = ax and new_data ->> 'status' = 'cerrada' and user_id = coo))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: reapertura con autor administrador', 'true', (exists (
    select 1 from hse_change_log where record_id = ax and old_data ->> 'status' = 'cerrada' and new_data ->> 'status' = 'en_curso' and user_id = adm))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: verificación de hallazgo', 'true', (exists (
    select 1 from hse_change_log where record_id = f1 and new_data ->> 'status' = 'verificado' and user_id = coo))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: evidencia registrada', 'true', (exists (
    select 1 from hse_change_log where table_name = 'hse_evidences' and new_data ->> 'storage_path' = path_x and user_id = act))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: cambio de criterio (peso) en borrador', 'true', (exists (
    select 1 from hse_change_log where record_id = it2 and 'weight' = any(changed_fields) and user_id = coo))::text);
  r := r || pg_temp.v('Coordinador HSE', 'historial: participantes', 'true', (exists (
    select 1 from hse_change_log where table_name = 'hse_audit_participants' and new_data ->> 'user_id' = aud3::text))::text);
  r := r || pg_temp.e('Coordinador HSE', 'altera el historial', 'denegado', pg_temp.x(format('update hse_change_log set user_id = null where organization_id = %L', oa)));
  r := r || pg_temp.e('Coordinador HSE', 'borra el historial', 'denegado', pg_temp.x(format('delete from hse_change_log where organization_id = %L', oa)));
  perform pg_temp.as_(aud1);
  r := r || pg_temp.v('Auditor', 'lee el historial', '0', pg_temp.n(format('select 1 from hse_change_log where organization_id = %L', oa)));

  -- ============================================================= 12. miembros, perfiles y escalamiento
  perform pg_temp.as_(aud1);
  r := r || pg_temp.e('Auditor', 'se asciende a administrador', 'denegado', pg_temp.x(format(
    'update hse_memberships set role = ''admin'' where organization_id = %L and user_id = %L', oa, aud1)));
  r := r || pg_temp.e('Auditor', 'se agrega como admin de org B', 'denegado', pg_temp.x(format(
    'insert into hse_memberships (organization_id, user_id, role) values (%L,%L,''admin'')', org_b, aud1)));
  r := r || pg_temp.e('Auditor', 'invita miembros', 'denegado', pg_temp.x(format('select hse_invite_member(%L, ''nuevo@example.com'', ''admin'', null)', oa)));
  perform pg_temp.as_(con);
  r := r || pg_temp.e('Resp. contratista X', 'cambia su empresa a Y', 'denegado', pg_temp.x(format(
    'update hse_memberships set company_id = %L where organization_id = %L and user_id = %L', cy, oa, con)));
  r := r || pg_temp.v('Resp. contratista X', 'membresías visibles (sólo la propia)', '1', pg_temp.n(format('select 1 from hse_memberships where organization_id = %L', oa)));
  r := r || pg_temp.v('Resp. contratista X', 'perfiles de otros externos visibles', '0', pg_temp.n(format('select 1 from hse_profiles where id in (%L,%L,%L)', con2, act, vie)));
  r := r || pg_temp.v('Resp. contratista X', 'perfiles del equipo HSE visibles', '3', pg_temp.n(format('select 1 from hse_profiles where id in (%L,%L,%L)', own, coo, aud1)));
  perform pg_temp.as_(act);
  r := r || pg_temp.v('Resp. acciones', 'membresías visibles (sólo la propia)', '1', pg_temp.n(format('select 1 from hse_memberships where organization_id = %L', oa)));
  perform pg_temp.as_(adm);
  r := r || pg_temp.e('Administrador', 'se designa propietario', 'denegado', pg_temp.x(format(
    'update hse_memberships set role = ''owner'' where organization_id = %L and user_id = %L', oa, adm)));
  r := r || pg_temp.e('Administrador', 'desactiva a un auditor', 'permitido', pg_temp.x(format(
    'update hse_memberships set active = false where organization_id = %L and user_id = %L', oa, baj)));
  perform pg_temp.as_(baj);
  r := r || pg_temp.v('Auditor desactivado', 've auditorías donde era participante', '0', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  r := r || pg_temp.e('Auditor desactivado', 'responde en auditoría donde era participante', 'denegado', pg_temp.x(format(
    'insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(),%L,%L,%L,''cumple'')', oa, ax, i3)));

  -- ============================================================= 13. aislamiento total org B → org A
  perform pg_temp.as_(ob);
  r := r || pg_temp.v('Admin org B', 'filas de org A visibles (13 tablas)', '0', pg_temp.n(format($q$
    select id from hse_organizations where id = %1$L union all select id from hse_companies where organization_id = %1$L
    union all select id from hse_locations where organization_id = %1$L union all select id from hse_templates where organization_id = %1$L
    union all select id from hse_template_versions where organization_id = %1$L union all select id from hse_template_items where organization_id = %1$L
    union all select id from hse_audits where organization_id = %1$L union all select id from hse_audit_participants where organization_id = %1$L
    union all select id from hse_audit_responses where organization_id = %1$L union all select id from hse_findings where organization_id = %1$L
    union all select id from hse_actions where organization_id = %1$L union all select id from hse_evidences where organization_id = %1$L
    union all select user_id from hse_memberships where organization_id = %1$L$q$, oa)));
  r := r || pg_temp.v('Admin org B', 'perfiles de usuarios de org A visibles', '0', pg_temp.n(format('select 1 from hse_profiles where id in (%L,%L,%L,%L)', own, aud1, con, act)));
  r := r || pg_temp.v('Admin org B', 'historial y reaperturas de org A', '0', pg_temp.n(format(
    'select id from hse_change_log where organization_id = %1$L union all select id from hse_reopen_log where organization_id = %1$L', oa)));
  r := r || pg_temp.e('Admin org B', 'modifica auditoría de A por id', 'denegado', pg_temp.x(format('update hse_audits set title = ''x'' where id = %L', ax)));
  r := r || pg_temp.e('Admin org B', 'borra hallazgo de A por id', 'denegado', pg_temp.x(format('delete from hse_findings where id = %L', f3)));
  r := r || pg_temp.e('Admin org B', 'mueve su auditoría a org A', 'denegado', pg_temp.x(format('update hse_audits set organization_id = %L where id = %L', oa, ab)));
  r := r || pg_temp.e('Admin org B', 'mueve su empresa a org A', 'denegado', pg_temp.x(format('update hse_companies set organization_id = %L where id = %L', oa, bx)));
  r := r || pg_temp.e('Admin org B', 'hallazgo en su org apuntando a auditoría de A', 'denegado', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, title) values (%L,%L,''x'')', org_b, ax)));
  r := r || pg_temp.e('Admin org B', 'acción en su org apuntando a hallazgo de A', 'denegado', pg_temp.x(format(
    'insert into hse_actions (organization_id, finding_id, description, due_date) values (%L,%L,''x'',current_date)', org_b, f1)));
  r := r || pg_temp.e('Admin org B', 'evidencia en su org apuntando a auditoría de A', 'denegado', pg_temp.x(format(
    'insert into hse_evidences (organization_id, audit_id, storage_path, mime_type, size_bytes) values (%L,%L,%L,''image/jpeg'',1)', org_b, ax, org_b || '/' || ax || '/e.jpg')));
  r := r || pg_temp.e('Admin org B', 'se inserta membresía en org A', 'denegado', pg_temp.x(format(
    'insert into hse_memberships (organization_id, user_id, role) values (%L,%L,''owner'')', oa, ob)));
  r := r || pg_temp.e('Admin org B', 'invita en org A', 'denegado', pg_temp.x(format('select hse_invite_member(%L, ''x@example.com'', ''admin'', null)', oa)));
  r := r || pg_temp.e('Admin org B', 'usa el contador de códigos de A', 'denegado', pg_temp.x(format('select hse_next_code(%L, ''AUD'')', oa)));
  r := r || pg_temp.v('Admin org B', 'dashboard de org A', '{}', coalesce(hse_dashboard(oa) ->> 'audits_by_status', '{}'));
  r := r || pg_temp.e('Admin org B', 'sync_push con operación sobre org A', 'denegado', pg_temp.x(format(
    $q$select 1 from jsonb_array_elements(hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table', 'hse_audits', 'payload', jsonb_build_object('id', %L::uuid, 'organization_id', %L::uuid, 'title','hackeada'), 'base', jsonb_build_object('title','Auditoría X'))))) e where e ->> 'status' = 'aplicado'$q$, ax, oa)));
  perform pg_temp.as_(own);
  r := r || pg_temp.v('Admin org B', 'título de X tras intento por sync_push (leído por el propietario de A)', 'Auditoría X', (select title from hse_audits where id = ax));

  -- JWT con claim "role" manipulado: la base sigue usando el rol de conexión authenticated
  perform pg_temp.as_(aud2, 'service_role');
  r := r || pg_temp.v('Auditor con claim role=service_role', 'auditorías visibles (igual que sin manipular)', '1', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));
  perform pg_temp.as_(ob, 'supabase_admin');
  r := r || pg_temp.v('Admin org B con claim role=supabase_admin', 'filas de org A visibles', '0', pg_temp.n(format('select 1 from hse_audits where organization_id = %L', oa)));

  -- anónimo
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  r := r || pg_temp.e('Anónimo', 'lee auditorías', 'denegado', pg_temp.x('select 1 from hse_audits'));
  r := r || pg_temp.e('Anónimo', 'lee archivos de evidencias', 'denegado', pg_temp.x(format('select 1 from storage.objects where bucket_id = ''hse-evidencias''')));
  r := r || pg_temp.e('Anónimo', 'llama a una RPC', 'denegado', pg_temp.x(format('select hse_reopen_audit(%L, ''Motivo suficientemente largo para reabrir'')', ax)));

  select count(*), count(*) filter (where not (e ->> 'ok')::boolean) into tot, bad from jsonb_array_elements(r) e;
  raise exception 'RESULTADO_MATRIZ %', jsonb_build_object('total', tot, 'fallas', bad,
    'detalle_fallas', coalesce((select jsonb_agg(e) from jsonb_array_elements(r) e where not (e ->> 'ok')::boolean), '[]'),
    'casos', (select jsonb_agg(concat(case when (e ->> 'ok')::boolean then 'OK' else 'FALLA' end, ' | ', e ->> 'rol', ' | ', e ->> 'caso',
                                      ' | ', e ->> 'esperado', ' | ', left(e ->> 'obtenido', 70))) from jsonb_array_elements(r) e));
end $$;
