-- =====================================================================
-- Ciclo de vida de hallazgos, acciones, cierre validado, recurrencia,
-- notificaciones, historial e informes (migraciones 0020-0022). Se revierte sola.
-- Requiere las funciones pg_temp.* de authorization_matrix.sql (se incluyen).
-- =====================================================================
create or replace function pg_temp.as_(u uuid, r text default 'authenticated') returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', r)::text, true); end $$;
create or replace function pg_temp.x(q text) returns text language plpgsql as $$
declare n bigint;
begin execute q; get diagnostics n = row_count; return 'ok:' || n;
exception when others then return 'err:' || sqlstate || ':' || left(sqlerrm, 160);
end $$;
create or replace function pg_temp.e(caso text, esperado text, obtenido text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('caso', caso, 'esperado', esperado, 'obtenido', obtenido,
    'ok', case when esperado = 'permitido' then obtenido ~ '^ok:[1-9]'
               when esperado = 'denegado' then obtenido = 'ok:0' or (obtenido like 'err:%' and obtenido not like 'err:23505%')
               else obtenido like esperado end));
$$;

do $$
declare
  adm uuid := gen_random_uuid(); coo uuid := gen_random_uuid(); aud uuid := gen_random_uuid();
  act uuid := gen_random_uuid(); ob uuid := gen_random_uuid(); u uuid;
  oa uuid; ob_org uuid; cx uuid; t uuid; v uuid; s uuid; i1 uuid; i2 uuid; i3 uuid; vb uuid; tb uuid; sb uuid; ib uuid;
  au uuid; au2 uuid; r1 uuid := gen_random_uuid(); r2 uuid := gen_random_uuid(); f1 uuid := gen_random_uuid(); f2 uuid := gen_random_uuid();
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); path text;
  res jsonb := '[]'::jsonb; j jsonb; tmp text; tot int; bad int;
begin
  foreach u in array array[adm, coo, aud, act, ob] loop
    insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
    values (u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'lc_' || replace(u::text, '-', '') || '@example.com', now(), '{}', now(), now());
  end loop;
  execute 'set local role authenticated';
  foreach u in array array[adm, coo, aud, act, ob] loop perform pg_temp.as_(u); perform hse_bootstrap(); end loop;

  perform pg_temp.as_(ob);
  ob_org := hse_create_organization('Org B ciclo', null);
  insert into hse_templates (organization_id, name, category) values (ob_org, 'TB', 'csms') returning id into tb;
  insert into hse_template_versions (organization_id, template_id, version_number) values (ob_org, tb, 1) returning id into vb;
  insert into hse_template_sections (organization_id, version_id, title) values (ob_org, vb, 'S') returning id into sb;
  insert into hse_template_items (organization_id, version_id, section_id, question) values (ob_org, vb, sb, 'Q B') returning id into ib;

  perform pg_temp.as_(adm);
  oa := hse_create_organization('Org A ciclo', null);
  insert into hse_companies (organization_id, name) values (oa, 'Contratista X') returning id into cx;
  insert into hse_templates (organization_id, name, category) values (oa, 'Plantilla seguridad', 'seguridad_higiene') returning id into t;
  insert into hse_template_versions (organization_id, template_id, version_number) values (oa, t, 1) returning id into v;
  insert into hse_template_sections (organization_id, version_id, title) values (oa, v, 'Orden y limpieza') returning id into s;
  insert into hse_template_items (organization_id, version_id, section_id, code, question, is_critical, evidence_required_on_fail)
    values (oa, v, s, '1.1', 'Extintores vigentes', true, true) returning id into i1;
  insert into hse_template_items (organization_id, version_id, section_id, code, question, evidence_required_on_fail)
    values (oa, v, s, '1.2', 'Señalización visible', false) returning id into i2;
  insert into hse_template_items (organization_id, version_id, section_id, code, question, is_required)
    values (oa, v, s, '1.3', 'Observaciones generales', false) returning id into i3;
  perform hse_publish_template_version(v);
  perform hse_invite_member(oa, 'lc_' || replace(coo::text, '-', '') || '@example.com', 'supervisor', null);
  perform hse_invite_member(oa, 'lc_' || replace(aud::text, '-', '') || '@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'lc_' || replace(act::text, '-', '') || '@example.com', 'action_owner', null);

  -- 0023: sondeo de membresía de otra organización
  perform pg_temp.as_(ob);
  res := res || pg_temp.e('0023: otra organización no puede sondear membresías ajenas (hse_is_org_user)', 'false', hse_is_org_user(oa, adm, null)::text);
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('0023: un miembro sí consulta su propia organización', 'true', hse_is_org_user(oa, aud, null)::text);

  perform pg_temp.as_(coo);
  insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id, status)
    values (oa, v, cx, 'Auditoría 1', aud, 'en_curso') returning id into au;

  -- ---------------------------------------------------------- completar: validaciones
  perform pg_temp.as_(aud);
  perform pg_temp.x(format('insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (%L,%L,%L,%L,''no_cumple'')', r1, oa, au, i1));
  j := hse_audit_readiness(au, 'completada');
  res := res || pg_temp.e('preparación: detecta obligatoria sin responder (1.2), falta evidencia (1.1) y crítico sin hallazgo (1.1)',
    'sin_responder,evidencia_faltante,critico_sin_hallazgo',
    (select string_agg(x ->> 'code', ',' order by x ->> 'code' desc) from jsonb_array_elements(j -> 'issues') x));
  res := res || pg_temp.e('preparación: la pregunta opcional 1.3 no se exige', 'false',
    (j::text like '%Observaciones generales%')::text);
  res := res || pg_temp.e('completar con pendientes es rechazado por el servidor', 'err:HS422%',
    pg_temp.x(format('update hse_audits set status = ''completada'' where id = %L', au)));

  perform pg_temp.x(format('insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (%L,%L,%L,%L,''cumple'')', r2, oa, au, i2));
  path := oa || '/' || au || '/' || ev || '.jpg';
  perform pg_temp.x(format('insert into storage.objects (bucket_id, name, owner_id) values (''hse-evidencias'',%L,%L)', path, aud));
  res := res || pg_temp.e('evidencia del incumplimiento con archivo', 'permitido', pg_temp.x(format(
    'insert into hse_evidences (id, organization_id, audit_id, response_id, storage_path, mime_type, size_bytes) values (%L,%L,%L,%L,%L,''image/jpeg'',10)', ev, oa, au, r1, path)));

  -- hallazgo vinculado a la pregunta por la respuesta
  res := res || pg_temp.e('hallazgo con respuesta de otra auditoría', 'err:23503%', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, response_id, title) values (%L,%L,gen_random_uuid(),''x'')', oa, au)));
  res := res || pg_temp.e('hallazgo con pregunta de otra plantilla', 'err:23503%', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, item_id, title) values (%L,%L,%L,''x'')', oa, au, ib)));
  res := res || pg_temp.e('hallazgo con responsable de otra organización', 'err:23514%', pg_temp.x(format(
    'insert into hse_findings (organization_id, audit_id, title, responsible_user_id) values (%L,%L,''x'',%L)', oa, au, ob)));
  res := res || pg_temp.e('registra hallazgo NC vinculado a la respuesta, con responsable y vencimiento', 'permitido', pg_temp.x(format(
    'insert into hse_findings (id, organization_id, audit_id, response_id, title, description, requirement, finding_type, severity, responsible_user_id, due_date, recurrence_count)
     values (%L,%L,%L,%L,''Extintor vencido'',''Extintor del sector A con carga vencida en 05/2026'',''Dec. 351/79 art. 176'',''nc_menor'',''alta'',%L,current_date + 30, 99)',
     f1, oa, au, r1, act)));
  res := res || pg_temp.e('el servidor completa la pregunta desde la respuesta', i1::text, (select item_id::text from hse_findings where id = f1));
  res := res || pg_temp.e('categoría heredada de la plantilla', 'seguridad_higiene', (select category::text from hse_findings where id = f1));
  res := res || pg_temp.e('recurrencia falsificada por el cliente se ignora (primera vez = 0)', '0', (select recurrence_count::text from hse_findings where id = f1));

  j := hse_audit_readiness(au, 'completada');
  res := res || pg_temp.e('preparación sin pendientes', 'true', (j ->> 'ok'));
  res := res || pg_temp.e('completa la auditoría', 'permitido', pg_temp.x(format('update hse_audits set status = ''completada'' where id = %L', au)));
  res := res || pg_temp.e('puntaje calculado por el servidor desde la versión (1 cumple / 1 no cumple = 50 %)', '50.00',
    (select compliance_pct::text from hse_audits where id = au));

  -- ---------------------------------------------------------- cerrar: revisión, plan, resumen
  perform pg_temp.as_(coo);
  j := hse_audit_readiness(au, 'cerrada');
  res := res || pg_temp.e('preparación para cerrar: sin revisión, sin resumen, NC sin plan', 'sin_revision,sin_resumen,nc_sin_plan',
    (select string_agg(x ->> 'code', ',') from jsonb_array_elements(j -> 'issues') x));
  res := res || pg_temp.e('cerrar sin revisión es rechazado', 'err:HS422%', pg_temp.x(format(
    'update hse_audits set status = ''cerrada'', summary = ''Resumen'' where id = %L', au)));
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('el auditor no puede revisar', 'err:42501%', pg_temp.x(format('select hse_review_audit(%L, ''ok'')', au)));
  res := res || pg_temp.e('el auditor no puede fijar la revisión por UPDATE', '%', pg_temp.x(format(
    'update hse_audits set reviewed_at = now(), reviewed_by = %L where id = %L', aud, au)));
  res := res || pg_temp.e('… y el valor no queda grabado', 'true', ((select reviewed_at from hse_audits where id = au) is null)::text);
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('coordinación revisa', 'ok:1', pg_temp.x(format('select hse_review_audit(%L, ''Revisado el informe'')', au)));

  perform pg_temp.as_(aud);
  res := res || pg_temp.e('crea acción preventiva para la NC', 'permitido', pg_temp.x(format(
    'insert into hse_actions (id, organization_id, finding_id, description, action_type, due_date, responsible_user_id, effectiveness_criteria)
     values (%L,%L,%L,''Capacitar al pañolero'',''preventiva'',current_date - 1,%L,''Sin extintores vencidos en 3 inspecciones'')', a2, oa, f1, act)));
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('cierra con resumen en la misma operación', 'permitido', pg_temp.x(format(
    'update hse_audits set status = ''cerrada'', summary = ''Se detectó 1 NC menor'' where id = %L', au)));

  -- ---------------------------------------------------------- reglas de cierre del hallazgo
  perform pg_temp.as_(act);
  res := res || pg_temp.e('responsable de acciones ve el hallazgo del que es responsable', '1',
    (select count(*)::text from hse_findings where id = f1));
  res := res || pg_temp.e('responsable no cambia el criterio de eficacia', 'err:42501%', pg_temp.x(format(
    'update hse_actions set effectiveness_criteria = ''otro'' where id = %L', a2)));
  res := res || pg_temp.e('responsable completa su acción', 'permitido', pg_temp.x(format(
    'update hse_actions set status = ''completada'', progress_notes = ''Capacitación dada'' where id = %L', a2)));
  perform pg_temp.as_(coo);
  perform pg_temp.x(format('update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a2));
  res := res || pg_temp.e('NC sin causa raíz no se cierra', 'err:HS422%causa raíz%', pg_temp.x(format(
    'update hse_findings set status = ''cerrado'' where id = %L', f1)));
  res := res || pg_temp.e('registra análisis de causa raíz (5 porqués)', 'permitido', pg_temp.x(format(
    $q$update hse_findings set root_cause = 'Sin control de vencimientos', rca_method = 'cinco_porques',
       rca_data = '{"whys":["Extintor vencido","No se recargó","Nadie controla","Sin responsable asignado","Sin procedimiento"]}' where id = %L$q$, f1)));
  res := res || pg_temp.e('NC sólo con acción preventiva no se cierra', 'err:HS422%correctiva%', pg_temp.x(format(
    'update hse_findings set status = ''cerrado'' where id = %L', f1)));
  res := res || pg_temp.e('crea acción correctiva', 'permitido', pg_temp.x(format(
    'insert into hse_actions (id, organization_id, finding_id, description, action_type, due_date, responsible_user_id) values (%L,%L,%L,''Recargar extintor'',''correctiva'',current_date - 2,%L)', a1, oa, f1, act)));

  -- ---------------------------------------------------------- notificaciones
  perform pg_temp.as_(act);
  perform hse_refresh_notifications(oa);
  res := res || pg_temp.e('notificación de acción vencida al responsable', '1',
    (select count(*)::text from hse_notifications where entity_id = a1 and kind = 'accion_vencida'));
  perform hse_refresh_notifications(oa);
  res := res || pg_temp.e('repetir la generación no duplica', '1',
    (select count(*)::text from hse_notifications where entity_id = a1 and kind = 'accion_vencida'));
  res := res || pg_temp.e('marca como leída', 'permitido', pg_temp.x(format('update hse_notifications set read_at = now() where entity_id = %L', a1)));
  res := res || pg_temp.e('no puede alterar el texto de la notificación', 'err:42501%', pg_temp.x(format('update hse_notifications set title = ''x'' where entity_id = %L', a1)));
  res := res || pg_temp.e('no puede crear notificaciones', 'err:42501%', pg_temp.x(format(
    'insert into hse_notifications (organization_id, user_id, kind, entity_table, entity_id, due_date, title) values (%L,%L,''accion_vencida'',''hse_actions'',%L,current_date,''x'')', oa, act, a1)));
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('el líder recibe la acción vencida', '1',
    (select count(*)::text from hse_notifications where entity_id = a1 and kind = 'accion_vencida'));
  perform pg_temp.as_(coo);
  res := res || pg_temp.e('coordinación recibe la acción vencida', '1',
    (select count(*)::text from hse_notifications where entity_id = a1 and kind = 'accion_vencida'));
  perform pg_temp.as_(ob);
  res := res || pg_temp.e('otra organización no ve notificaciones ni puede generarlas', 'err:42501%', pg_temp.x(format('select hse_refresh_notifications(%L)', oa)));
  res := res || pg_temp.e('… ni leerlas', '0', (select count(*)::text from hse_notifications where organization_id = oa));

  perform pg_temp.as_(act);
  perform pg_temp.x(format('update hse_actions set status = ''completada'' where id = %L', a1));
  perform pg_temp.as_(aud);
  perform hse_refresh_notifications(oa);
  res := res || pg_temp.e('al completarse, el líder recibe "verificar eficacia"', '1',
    (select count(*)::text from hse_notifications where entity_id = a1 and kind = 'verificacion_pendiente'));
  res := res || pg_temp.e('la notificación de vencida queda resuelta', 'true',
    (select bool_and(resolved_at is not null)::text from hse_notifications where entity_id = a1 and kind = 'accion_vencida'));
  perform pg_temp.as_(coo);
  perform pg_temp.x(format('update hse_actions set status = ''verificada'', effectiveness = ''eficaz'' where id = %L', a1));
  res := res || pg_temp.e('NC con causa raíz y correctiva verificada se cierra', 'permitido', pg_temp.x(format(
    'update hse_findings set status = ''cerrado'' where id = %L', f1)));
  res := res || pg_temp.e('verificación de eficacia del hallazgo', 'permitido', pg_temp.x(format(
    'update hse_findings set status = ''verificado'', verification_notes = ''Inspección 10/2026 sin desvíos'', effectiveness = ''eficaz'' where id = %L', f1)));

  -- ---------------------------------------------------------- recurrencia
  insert into hse_audits (organization_id, template_version_id, company_id, title, lead_auditor_id, status)
    values (oa, v, cx, 'Auditoría 2', aud, 'en_curso') returning id into au2;
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('mismo incumplimiento en otra auditoría de la misma empresa', 'permitido', pg_temp.x(format(
    'insert into hse_findings (id, organization_id, audit_id, item_id, title) values (%L,%L,%L,%L,''Extintor vencido otra vez'')', f2, oa, au2, i1)));
  res := res || pg_temp.e('recurrencia detectada (1 anterior)', '1', (select recurrence_count::text from hse_findings where id = f2));
  res := res || pg_temp.e('apunta al hallazgo anterior', f1::text, (select recurrence_of::text from hse_findings where id = f2));
  perform pg_temp.x(format('update hse_findings set recurrence_count = 0, title = ''Extintor vencido (reincidencia)'' where id = %L', f2));
  res := res || pg_temp.e('el cliente no puede borrar la recurrencia', '1', (select recurrence_count::text from hse_findings where id = f2));

  -- ---------------------------------------------------------- historial
  perform pg_temp.as_(aud);
  res := res || pg_temp.e('historial del hallazgo para el auditor asignado', 'true',
    ((select count(*) from hse_record_history('hse_findings', f1)) >= 4)::text);
  res := res || pg_temp.e('el historial registra quién verificó', 'true', (exists (
    select 1 from hse_record_history('hse_findings', f1) h where h.new_data ->> 'status' = 'verificado' and h.user_name is not null))::text);
  perform pg_temp.as_(act);
  res := res || pg_temp.e('historial de su acción para el responsable', 'true',
    ((select count(*) from hse_record_history('hse_actions', a1)) >= 2)::text);
  perform pg_temp.as_(ob);
  res := res || pg_temp.e('otra organización no lee el historial', 'err:42501%', pg_temp.x(format('select * from hse_record_history(''hse_findings'', %L)', f1)));

  -- ---------------------------------------------------------- informes (0022)
  perform pg_temp.as_(coo);
  j := hse_report_summary(oa, null, null, null);
  res := res || pg_temp.e('informe: resultado por sección (ponderado) tomado del resultado oficial', '50.0000',
    (select x ->> 'avg_score' from jsonb_array_elements(j -> 'by_section') x limit 1));
  res := res || pg_temp.e('informe: recurrencia agrupada (2 hallazgos, 2 auditorías)', '2', (j -> 'recurrent' -> 0 ->> 'occurrences'));
  res := res || pg_temp.e('informe: resultados por categoría de plantilla', 'seguridad_higiene', (j -> 'by_template_category' -> 0 ->> 'category'));
  res := res || pg_temp.e('informe: hallazgos por categoría', '2', (j -> 'findings' -> 'by_category' ->> 'seguridad_higiene'));
  res := res || pg_temp.e('historial completo de la auditoría (auditoría, respuestas, hallazgos, acciones, evidencias)', 'true',
    ((select count(distinct table_name) from hse_audit_history(au)) >= 5)::text);
  perform pg_temp.as_(act);
  j := hse_report_summary(oa, null, null, null);
  res := res || pg_temp.e('resp. de acciones: el informe no expone auditorías ajenas', '0', (j -> 'audits' ->> 'total'));
  perform pg_temp.as_(ob);
  j := hse_report_summary(oa, null, null, null);
  res := res || pg_temp.e('otra organización: informe vacío', '0', (j -> 'audits' ->> 'total'));
  res := res || pg_temp.e('otra organización: sin recurrencias de A', '0', jsonb_array_length(j -> 'recurrent')::text);
  res := res || pg_temp.e('otra organización no lee el historial de la auditoría', 'err:42501%', pg_temp.x(format('select * from hse_audit_history(%L)', au)));

  -- ---------------------------------------------------------- reapertura limpia la revisión
  perform pg_temp.as_(adm);
  perform hse_reopen_audit(au, 'Reapertura de prueba con motivo suficientemente largo');
  res := res || pg_temp.e('reabrir borra la revisión anterior', 'true', ((select reviewed_at from hse_audits where id = au) is null)::text);

  select count(*), count(*) filter (where not (e ->> 'ok')::boolean) into tot, bad from jsonb_array_elements(res) e;
  raise exception 'RESULTADO_CICLO %', jsonb_build_object('total', tot, 'fallas', bad,
    'detalle_fallas', coalesce((select jsonb_agg(e) from jsonb_array_elements(res) e where not (e ->> 'ok')::boolean), '[]'),
    'casos', (select jsonb_agg(concat(case when (e ->> 'ok')::boolean then 'OK' else 'FALLA' end, ' | ', e ->> 'caso', ' | ', left(e ->> 'obtenido', 80)))
              from jsonb_array_elements(res) e));
end $$;
