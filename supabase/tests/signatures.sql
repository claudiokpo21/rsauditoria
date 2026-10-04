-- =====================================================================
-- Acta de cierre y firmas en campo (0025). Se revierte sola.
-- =====================================================================
create or replace function pg_temp.as_(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); end $$;
create or replace function pg_temp.x(q text) returns text language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 120);
end $$;
create or replace function pg_temp.e(caso text, esperado text, obtenido text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('caso', caso, 'obtenido', obtenido,
    'ok', case when esperado = 'permitido' then obtenido ~ '^ok:[1-9]'
               when esperado = 'denegado' then obtenido = 'ok:0' or obtenido like 'err:%'
               else obtenido like esperado end));
$$;
do $$
declare
  adm uuid := gen_random_uuid(); coo uuid := gen_random_uuid(); aud uuid := gen_random_uuid(); obs uuid := gen_random_uuid();
  con uuid := gen_random_uuid(); ob uuid := gen_random_uuid(); u uuid;
  oa uuid; ob_org uuid; cx uuid; t uuid; v uuid; s uuid; i1 uuid; au uuid; sg uuid := gen_random_uuid(); sg2 uuid := gen_random_uuid();
  png text := 'data:image/png;base64,' || repeat('A', 400);
  res jsonb := '[]'::jsonb; tot int; bad int;
begin
  foreach u in array array[adm, coo, aud, obs, con, ob] loop
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sg_' || replace(u::text, '-', '') || '@example.com', now(), '{}', now(), now());
  end loop;
  execute 'set local role authenticated';
  foreach u in array array[adm, coo, aud, obs, con, ob] loop perform pg_temp.as_(u); perform hse_bootstrap(); end loop;
  perform pg_temp.as_(ob); ob_org := hse_create_organization('Org B firmas', null);
  perform pg_temp.as_(adm);
  oa := hse_create_organization('Org A firmas', null);
  insert into hse_companies (organization_id, name) values (oa, 'Contratista X') returning id into cx;
  insert into hse_templates (organization_id, name, category) values (oa, 'Plantilla firmas', 'seguridad_higiene') returning id into t;
  insert into hse_template_versions (organization_id, template_id, version_number) values (oa, t, 1) returning id into v;
  insert into hse_template_sections (organization_id, version_id, title) values (oa, v, 'S') returning id into s;
  insert into hse_template_items (organization_id, version_id, section_id, question, evidence_required_on_fail) values (oa, v, s, '¿Extintores vigentes?', false) returning id into i1;
  perform hse_publish_template_version(v);
  perform hse_invite_member(oa, 'sg_' || replace(coo::text, '-', '') || '@example.com', 'supervisor', null);
  perform hse_invite_member(oa, 'sg_' || replace(aud::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'sg_' || replace(obs::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'sg_' || replace(con::text, '-', '') || '@example.com', 'contractor', cx);
  perform pg_temp.as_(coo);
  insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id, status) values (oa, v, cx, 'Auditoría firmas', aud, 'en_curso') returning id into au;
  insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role) values (oa, au, obs, 'observador');

  perform pg_temp.as_(aud);
  res := res || pg_temp.e('auditor registra el acta (fecha, asistentes, acuerdos)', 'permitido', pg_temp.x(format(
    'update hse_audits set closing_meeting_at = current_date, closing_attendees = ''J. Pérez (contratista)'', closing_agreements = ''Plan en 15 días'' where id = %L', au)));
  res := res || pg_temp.e('auditor captura la firma del representante del contratista', 'permitido', pg_temp.x(format(
    'insert into hse_audit_signatures (id, organization_id, audit_id, signer_role, signer_name, signer_company, signature_png, signed_at) values (%L,%L,%L,''representante_contratista'',''Juan Pérez'',''Contratista X'',%L, now() - interval ''2 hours'')', sg, oa, au, png)));
  res := res || pg_temp.e('quién capturó la firma lo fija el servidor', aud::text, (select created_by::text from hse_audit_signatures where id = sg));
  res := res || pg_temp.e('hora de firma del dispositivo (sin conexión) se conserva', 'true', ((select signed_at from hse_audit_signatures where id = sg) < now() - interval '1 hour')::text);
  res := res || pg_temp.e('firma con fecha futura se corrige a la del servidor', 'permitido', pg_temp.x(format(
    'insert into hse_audit_signatures (id, organization_id, audit_id, signer_role, signer_name, signature_png, signed_at) values (%L,%L,%L,''auditor_lider'',''Auditor'',%L, now() + interval ''3 days'')', sg2, oa, au, png)));
  res := res || pg_temp.e('… y queda en la hora actual', 'true', ((select signed_at from hse_audit_signatures where id = sg2) <= now() + interval '1 minute')::text);
  res := res || pg_temp.e('con observaciones exige el texto', 'err:23514%', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, agreement, signature_png) values (%L,%L,''otro'',''X Y'',''con_observaciones'',%L)', oa, au, png)));
  res := res || pg_temp.e('rechaza firma que no es imagen PNG', 'err:23514%', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, signature_png) values (%L,%L,''otro'',''X Y'',''<svg>'')', oa, au)));
  res := res || pg_temp.e('una firma no se modifica', 'err:42501%', pg_temp.x(format('update hse_audit_signatures set signer_name = ''Otro'' where id = %L', sg)));
  res := res || pg_temp.e('una firma se da de baja', 'permitido', pg_temp.x(format('update hse_audit_signatures set deleted_at = now() where id = %L', sg2)));
  res := res || pg_temp.e('una firma dada de baja no se restaura', 'err:42501%', pg_temp.x(format('update hse_audit_signatures set deleted_at = null where id = %L', sg2)));
  res := res || pg_temp.e('no se borra físicamente', 'denegado', pg_temp.x(format('delete from hse_audit_signatures where id = %L', sg)));

  perform pg_temp.as_(obs);
  res := res || pg_temp.e('observador ve las firmas', '2', (select count(*)::text from hse_audit_signatures where audit_id = au));
  res := res || pg_temp.e('observador no firma', 'denegado', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, signature_png) values (%L,%L,''otro'',''X Y'',%L)', oa, au, png)));
  perform pg_temp.as_(con);
  res := res || pg_temp.e('contratista de la empresa auditada ve las firmas', '2', (select count(*)::text from hse_audit_signatures where audit_id = au));
  res := res || pg_temp.e('contratista no inserta firmas', 'denegado', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, signature_png) values (%L,%L,''otro'',''X Y'',%L)', oa, au, png)));
  perform pg_temp.as_(ob);
  res := res || pg_temp.e('otra organización no ve firmas', '0', (select count(*)::text from hse_audit_signatures where audit_id = au));
  res := res || pg_temp.e('otra organización no firma', 'denegado', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, signature_png) values (%L,%L,''otro'',''X Y'',%L)', oa, au, png)));
  res := res || pg_temp.e('sync_push de otra organización no aplica', '0', (select count(*)::text from jsonb_array_elements(hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table', 'hse_audit_signatures',
     'payload', jsonb_build_object('id', gen_random_uuid(), 'organization_id', oa, 'audit_id', au, 'signer_role', 'otro', 'signer_name', 'Intruso', 'signature_png', png))))) e where e ->> 'status' = 'aplicado'));

  perform pg_temp.as_(aud);
  res := res || pg_temp.e('firma por la cola de sincronización (como el dispositivo)', '1', (select count(*)::text from jsonb_array_elements(hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table', 'hse_audit_signatures',
     'payload', jsonb_build_object('id', gen_random_uuid(), 'organization_id', oa, 'audit_id', au, 'signer_role', 'auditor', 'signer_name', 'Auditor de campo', 'signature_png', png, 'created_by', adm))))) e where e ->> 'status' = 'aplicado'));
  res := res || pg_temp.e('historial registra la firma', 'true', (exists (select 1 from hse_record_history('hse_audit_signatures', sg)))::text);

  -- cierre: completa, revisa, cierra; luego no se agregan firmas
  insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (gen_random_uuid(), oa, au, i1, 'cumple');
  update hse_audits set status = 'completada' where id = au;
  perform pg_temp.as_(coo);
  perform hse_review_audit(au, 'ok');
  update hse_audits set status = 'cerrada', summary = 'Resumen' where id = au;
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('auditoría cerrada: no se agregan firmas', 'err:42501%', pg_temp.x(format(
    'insert into hse_audit_signatures (organization_id, audit_id, signer_role, signer_name, signature_png) values (%L,%L,''otro'',''X Y'',%L)', oa, au, png)));
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('auditoría cerrada: no se dan de baja firmas', 'denegado', pg_temp.x(format('update hse_audit_signatures set deleted_at = now() where id = %L', sg)));
  res := res || pg_temp.e('auditoría cerrada: el acta no cambia', 'err:42501%', pg_temp.x(format('update hse_audits set closing_agreements = ''x'' where id = %L', au)));

  select count(*), count(*) filter (where not (e ->> 'ok')::boolean) into tot, bad from jsonb_array_elements(res) e;
  raise exception 'RESULTADO_FIRMAS %', jsonb_build_object('total', tot, 'fallas', bad,
    'detalle_fallas', coalesce((select jsonb_agg(e) from jsonb_array_elements(res) e where not (e ->> 'ok')::boolean), '[]'));
end $$;
