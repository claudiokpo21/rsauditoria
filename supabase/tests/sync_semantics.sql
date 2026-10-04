-- Ver README. Se revierte sola (termina con RAISE EXCEPTION).
do $$
declare ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); oa uuid; ob uuid; t uuid; v uuid; s uuid; i1 uuid; au uuid; rid uuid := gen_random_uuid(); ev uuid := gen_random_uuid(); rep text := ''; n int; st text;
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
   (ua, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sa@example.com', now(), '{}', now(), now()),
   (ub, '00000000-0000-0000-0000-000000000000','authenticated','authenticated','sb@example.com', now(), '{}', now(), now());
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  perform hse_bootstrap(); ob := hse_create_organization('Org B', null);
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role','authenticated')::text, true);
  perform hse_bootstrap(); oa := hse_create_organization('Org A', null);
  t := gen_random_uuid(); v := gen_random_uuid(); s := gen_random_uuid(); i1 := gen_random_uuid(); au := gen_random_uuid();
  insert into hse_templates (id, organization_id, name, category, client_updated_at) values (t, oa, 'Plantilla', 'csms', now()) on conflict (id) do update set name = excluded.name;
  insert into hse_template_versions (id, organization_id, template_id, version_number, client_updated_at) values (v, oa, t, 1, now()) on conflict (id) do update set change_notes = excluded.change_notes;
  insert into hse_template_sections (id, organization_id, version_id, title) values (s, oa, v, 'S') on conflict (id) do nothing;
  insert into hse_template_items (id, organization_id, version_id, section_id, question) values (i1, oa, v, s, 'Pregunta') on conflict (id) do nothing;
  perform hse_publish_template_version(v);
  insert into hse_audits (id, organization_id, template_version_id, title, client_updated_at) values (au, oa, v, 'Auditoría', now() - interval '1 hour')
    on conflict (id) do update set title = excluded.title, client_updated_at = excluded.client_updated_at;
  insert into hse_audits (id, organization_id, template_version_id, title, client_updated_at) values (au, oa, v, 'Auditoría', now() - interval '1 hour')
    on conflict (id) do update set title = excluded.title, client_updated_at = excluded.client_updated_at;
  select count(*) into n from hse_audits where id = au; rep := rep || 'reintento idempotente filas=' || n || '; ';
  -- Desde 0014/0015 la detección de escrituras viejas y conflictos es por campo en hse_sync_push
  -- (ver sync_push_protocol.sql); el upsert directo ya no es la vía de sincronización del cliente.
  insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer) values (rid, oa, au, i1, 'no_cumple') on conflict (id) do update set answer = excluded.answer;
  begin
    insert into hse_evidences (id, organization_id, audit_id, response_id, storage_path, mime_type, size_bytes, uploaded_by)
      values (gen_random_uuid(), oa, au, rid, ob::text || '/' || au::text || '/x.jpg', 'image/jpeg', 1000, ua);
    rep := rep || 'FALLA evidencia con ruta de otra org; ';
  exception when others then rep := rep || 'OK ruta de otra org rechazada; '; end;
  -- desde 0017 el servidor fija uploaded_by con el usuario del JWT (no se rechaza: se ignora el valor del cliente)
  insert into hse_evidences (id, organization_id, audit_id, response_id, storage_path, mime_type, size_bytes, uploaded_by)
    values (gen_random_uuid(), oa, au, rid, oa::text || '/' || au::text || '/y.jpg', 'image/jpeg', 1000, ub);
  select case when uploaded_by = ua then 'OK uploaded_by suplantado reemplazado por el del JWT; ' else 'FALLA uploaded_by suplantado; ' end into st
    from hse_evidences where storage_path = oa::text || '/' || au::text || '/y.jpg';
  rep := rep || st;
  insert into hse_evidences (id, organization_id, audit_id, response_id, storage_path, mime_type, size_bytes, uploaded_by)
    values (ev, oa, au, rid, oa::text || '/' || au::text || '/' || ev::text || '.jpg', 'image/jpeg', 1000, ua);
  insert into storage.objects (bucket_id, name, owner_id) values ('hse-evidencias', oa::text || '/' || au::text || '/' || ev::text || '.jpg', ua::text);
  select count(*) into n from storage.objects where bucket_id = 'hse-evidencias' and name like oa::text || '/%'; rep := rep || 'A ve sus objetos=' || n || '; ';
  begin
    insert into storage.objects (bucket_id, name, owner_id) values ('hse-evidencias', ob::text || '/' || au::text || '/z.jpg', ua::text);
    rep := rep || 'FALLA subió a carpeta de otra org; ';
  exception when others then rep := rep || 'OK no sube a carpeta de otra org; '; end;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role','authenticated')::text, true);
  select count(*) into n from storage.objects where bucket_id = 'hse-evidencias' and name like oa::text || '/%'; rep := rep || 'B ve objetos de A=' || n || ' (esperado 0); ';
  select count(*) into n from hse_evidences where organization_id = oa; rep := rep || 'B ve evidencias de A=' || n || ' (esperado 0); ';
  raise exception 'RESULTADO_SYNC: %', rep;
end $$;
