-- Prueba del protocolo hse_sync_push (idempotencia, fusión por campo, conflictos,
-- permisos revalidados, archivo requerido). Se revierte sola.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); uc uuid := gen_random_uuid(); ud uuid := gen_random_uuid(); ue uuid := gen_random_uuid();
  oa uuid; oe uuid; cx uuid; t uuid := gen_random_uuid(); v uuid := gen_random_uuid(); s uuid := gen_random_uuid(); i1 uuid := gen_random_uuid();
  au uuid := gen_random_uuid(); rid uuid := gen_random_uuid(); fi uuid; ac uuid; ev uuid := gen_random_uuid();
  op1 uuid := gen_random_uuid(); r jsonb; rep text := ''; x text; n int;
  claims text;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  select u, '00000000-0000-0000-0000-000000000000','authenticated','authenticated', e, now(), '{}', now(), now()
  from (values (ua,'pa@example.com'),(ub,'pb@example.com'),(uc,'pc@example.com'),(ud,'pd@example.com'),(ue,'pe@example.com')) q(u,e);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role','authenticated')::text, true);
  perform hse_bootstrap(); oe := hse_create_organization('Org E', null);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  perform hse_bootstrap(); oa := hse_create_organization('Org A', null);
  insert into hse_companies (organization_id, name) values (oa, 'Contratista X') returning id into cx;
  perform hse_invite_member(oa, 'pb@example.com', 'auditor', null);
  perform hse_invite_member(oa, 'pc@example.com', 'contractor', cx);
  perform hse_invite_member(oa, 'pd@example.com', 'viewer', null);
  insert into hse_templates (id, organization_id, name, category) values (t, oa, 'Plantilla', 'csms');
  insert into hse_template_versions (id, organization_id, template_id, version_number) values (v, oa, t, 1);
  insert into hse_template_sections (id, organization_id, version_id, title) values (s, oa, v, 'S');
  insert into hse_template_items (id, organization_id, version_id, section_id, question) values (i1, oa, v, s, 'Pregunta');
  perform hse_publish_template_version(v);

  -- 1) alta desde el dispositivo de A (propietario), asignando a B (auditor) como líder (desde 0017 sólo
  --    los auditores asignados escriben en la auditoría)
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', op1, 'table','hse_audits', 'base', null,
        'payload', jsonb_build_object('id', au, 'organization_id', oa, 'template_version_id', v, 'company_id', cx, 'title', 'Auditoría', 'status','en_curso', 'lead_auditor_id', ub))));
  rep := concat(rep, '1 alta=', (r->0->>'status'), ' v', (r->0->>'row_version'), '; ');
  -- 2) reenvío de la misma operación (respuesta perdida por corte de red)
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', op1, 'table','hse_audits', 'base', null,
        'payload', jsonb_build_object('id', au, 'organization_id', oa, 'template_version_id', v, 'title', 'Auditoría'))));
  select count(*) into n from hse_audits where id = au;
  rep := concat(rep, '2 reenvío=', (r->0->>'status'), ' filas=', n, '; ');
  -- 3) A cambia el título
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('title','Auditoría'), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'title', 'Título de A'))));
  rep := concat(rep, '3 A edita título=', (r->0->>'status'), '; ');

  -- ===== B, offline, había visto 'Auditoría' =====
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  perform hse_bootstrap();
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('title','Auditoría'), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'title', 'Título de B'))));
  select title into x from hse_audits where id = au;
  rep := concat(rep, '4 B mismo campo=', (r->0->>'status'), ' [', (r->0->>'message'), '] vigente="', x, '"; ');
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('scope', null), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'scope', 'Alcance de B'))));
  select title || ' / ' || scope into x from hse_audits where id = au;
  rep := concat(rep, '5 B otro campo=', (r->0->>'status'), ' fusión="', x, '"; ');

  -- 6) mismo ítem respondido en dos dispositivos (id determinístico)
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audit_responses', 'base', null,
        'payload', jsonb_build_object('id', rid, 'organization_id', oa, 'audit_id', au, 'item_id', i1, 'answer', 'cumple'))));
  rep := concat(rep, '6a A responde=', (r->0->>'status'), '; ');
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audit_responses', 'base', null,
        'payload', jsonb_build_object('id', rid, 'organization_id', oa, 'audit_id', au, 'item_id', i1, 'answer', 'no_cumple'))));
  rep := concat(rep, '6b B responde distinto=', (r->0->>'status'), '; ');
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audit_responses', 'base', null,
        'payload', jsonb_build_object('id', rid, 'organization_id', oa, 'audit_id', au, 'item_id', i1, 'answer', 'cumple', 'comment', 'coincide'))));
  rep := concat(rep, '6c B responde igual + comentario=', (r->0->>'status'), '; ');

  -- 7) evidencia sin archivo -> error sin recibo; con archivo -> aplicado con la MISMA clave
  op1 := gen_random_uuid();
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', op1, 'table','hse_evidences', 'base', null,
        'payload', jsonb_build_object('id', ev, 'organization_id', oa, 'audit_id', au, 'response_id', rid, 'storage_path', oa||'/'||au||'/'||ev||'.jpg', 'mime_type','image/jpeg', 'size_bytes', 2048, 'uploaded_by', ub))));
  select count(*) into n from hse_sync_receipts where op_id = op1;
  rep := concat(rep, '7a sin archivo=', (r->0->>'status'), ' recibos=', n, '; ');
  insert into storage.objects (bucket_id, name, owner_id) values ('hse-evidencias', oa||'/'||au||'/'||ev||'.jpg', ub::text);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', op1, 'table','hse_evidences', 'base', null,
        'payload', jsonb_build_object('id', ev, 'organization_id', oa, 'audit_id', au, 'response_id', rid, 'storage_path', oa||'/'||au||'/'||ev||'.jpg', 'mime_type','image/jpeg', 'size_bytes', 2048, 'uploaded_by', ub))));
  rep := concat(rep, '7b con archivo=', (r->0->>'status'), '; ');

  -- 8) cascada del servidor: crear acción pasa el hallazgo a "en tratamiento"; luego editar otro campo no da conflicto falso
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  insert into hse_findings (organization_id, audit_id, title) values (oa, au, 'Hallazgo') returning id into fi;
  ac := gen_random_uuid();
  r := hse_sync_push(jsonb_build_array(
        jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_actions', 'base', null,
          'payload', jsonb_build_object('id', ac, 'organization_id', oa, 'finding_id', fi, 'description', 'Acción', 'due_date', current_date + 5, 'responsible_company_id', cx)),
        jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_findings',
          'base', jsonb_build_object('root_cause', null), 'payload', jsonb_build_object('id', fi, 'organization_id', oa, 'root_cause', 'Falta de procedimiento'))));
  select status::text into x from hse_findings where id = fi;
  rep := concat(rep, '8 lote acción+hallazgo=', (r->0->>'status'), '/', (r->1->>'status'), ' estado=', x, '; ');

  -- 9) contratista: informa avance (sólo UPDATE permitido) y no puede cambiar el vencimiento
  perform set_config('request.jwt.claims', json_build_object('sub', uc, 'role','authenticated')::text, true);
  perform hse_bootstrap();
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_actions',
        'base', jsonb_build_object('status','pendiente','progress_notes', null), 'payload', jsonb_build_object('id', ac, 'organization_id', oa, 'status', 'completada', 'progress_notes', 'Hecho'))));
  rep := concat(rep, '9a contratista avance=', (r->0->>'status'), '; ');
  r := hse_sync_push(jsonb_build_array(
        jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_actions', 'base', jsonb_build_object('due_date', current_date + 5),
          'payload', jsonb_build_object('id', ac, 'organization_id', oa, 'due_date', current_date + 90)),
        jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_actions', 'base', jsonb_build_object('progress_notes','Hecho'),
          'payload', jsonb_build_object('id', ac, 'organization_id', oa, 'progress_notes', 'Hecho y más'))));
  rep := concat(rep, '9b vencimiento=', (r->0->>'status'), ' / siguiente del mismo registro=', (r->1->>'status'), '; ');

  -- 10) lector intenta escribir / 11) usuario de otra organización
  perform set_config('request.jwt.claims', json_build_object('sub', ud, 'role','authenticated')::text, true);
  perform hse_bootstrap();
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('summary', null), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'summary', 'del lector'))));
  rep := concat(rep, '10 lector=', (r->0->>'status'), '; ');
  perform set_config('request.jwt.claims', json_build_object('sub', ue, 'role','authenticated')::text, true);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('summary', null), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'summary', 'intruso'))));
  rep := concat(rep, '11 otra org=', (r->0->>'status'), '; ');
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('summary', null), 'payload', jsonb_build_object('id', au, 'organization_id', oe, 'summary', 'org falsa'))));
  rep := concat(rep, '12 org falsificada=', (r->0->>'status'), '; ');
  -- 13) columna protegida (score) enviada por el cliente: se ignora
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audits',
        'base', jsonb_build_object('summary', null, 'score', null), 'payload', jsonb_build_object('id', au, 'organization_id', oa, 'summary', 'ok', 'score', 999))));
  select coalesce(score::text,'null') into x from hse_audits where id = au;
  rep := concat(rep, '13 score inyectado -> ', x, '; ');
  select count(*) into n from jsonb_array_elements(hse_sync_confirm(array[op1]));
  rep := concat(rep, '14 recibo de B visto por A=', n, ' (esperado 0)');
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  select count(*) into n from jsonb_array_elements(hse_sync_confirm(array[op1]));
  rep := concat(rep, ' / visto por B=', n, ' (esperado 1); ');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  -- 15) autorización offline no definitiva: se desactiva a B mientras trabaja sin conexión
  update hse_memberships set active = false where organization_id = oa and user_id = ub;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  r := hse_sync_push(jsonb_build_array(jsonb_build_object('op_id', gen_random_uuid(), 'table','hse_audit_responses',
        'base', jsonb_build_object('comment', 'coincide'), 'payload', jsonb_build_object('id', rid, 'organization_id', oa, 'comment', 'escrito sin conexión tras la baja'))));
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  select coalesce(comment,'') into x from hse_audit_responses where id = rid;   -- leído por A (B ya no tiene acceso)
  rep := concat(rep, '15 usuario dado de baja=', (r->0->>'status'), ' comentario vigente="', x, '"');
  raise exception 'RESULTADO_PUSH: %', rep;
end $$;
