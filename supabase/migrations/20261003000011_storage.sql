-- =====================================================================
-- HSE Audit Manager · 0011 · Supabase Storage (bucket privado de evidencias)
-- Ruta obligatoria: {organization_id}/{audit_id}/{evidence_id}.{ext}
-- La lectura se hace con URLs firmadas de corta duración.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hse-evidencias', 'hse-evidencias', false, 15728640,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy hse_evid_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'hse-evidencias'
         and public.hse_is_member(public.hse_try_uuid((storage.foldername(name))[1]))
         -- el archivo sólo es legible si su metadato es visible bajo RLS
         -- (así un contratista no lee evidencias de otras empresas)
         and exists (select 1 from public.hse_evidences e where e.storage_path = storage.objects.name));

create policy hse_evid_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hse-evidencias'
              and public.hse_has_role(public.hse_try_uuid((storage.foldername(name))[1]),
                                      '{owner,admin,supervisor,auditor,contractor}')
              and public.hse_try_uuid((storage.foldername(name))[2]) is not null);

create policy hse_evid_obj_update on storage.objects for update to authenticated
  using (bucket_id = 'hse-evidencias' and owner_id = auth.uid()::text)
  with check (bucket_id = 'hse-evidencias'
              and public.hse_is_member(public.hse_try_uuid((storage.foldername(name))[1])));

create policy hse_evid_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hse-evidencias' and (
         owner_id = auth.uid()::text
         or public.hse_has_role(public.hse_try_uuid((storage.foldername(name))[1]), '{owner,admin}')));
