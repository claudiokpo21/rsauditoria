-- =====================================================================
-- HSE Audit Manager · 0006 · Historial de cambios y registro de sincronización
-- El historial se escribe sólo desde triggers (SECURITY DEFINER);
-- ningún usuario puede insertarlo, modificarlo ni borrarlo directamente.
-- =====================================================================

create table public.hse_change_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  table_name       text not null,
  record_id        uuid not null,
  action           text not null check (action in ('INSERT','UPDATE','DELETE','SOFT_DELETE')),
  changed_fields   text[],
  old_data         jsonb,
  new_data         jsonb,
  user_id          uuid references auth.users(id) on delete set null,
  changed_at       timestamptz not null default now()
);
create index hse_change_log_org_idx    on public.hse_change_log (organization_id, changed_at desc);
create index hse_change_log_record_idx on public.hse_change_log (record_id, changed_at desc);
create index hse_change_log_user_idx   on public.hse_change_log (user_id) where user_id is not null;

create or replace function public.hse_log_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old jsonb; v_new jsonb; v_fields text[]; v_action text := tg_op;
  v_ignore text[] := array['updated_at','client_updated_at'];
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    select array_agg(k) into v_fields
    from jsonb_object_keys(v_new) k
    where not (k = any (v_ignore)) and v_new -> k is distinct from v_old -> k;
    if v_fields is null then return new; end if;  -- sin cambios reales
    if (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'SOFT_DELETE';
    end if;
  end if;
  -- borrado en cascada de una organización: no hay dónde registrar
  if not exists (select 1 from hse_organizations o
                 where o.id = coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid)) then
    return coalesce(new, old);
  end if;
  insert into hse_change_log (organization_id, table_name, record_id, action, changed_fields, old_data, new_data, user_id)
  values (coalesce((v_new ->> 'organization_id')::uuid, (v_old ->> 'organization_id')::uuid),
          tg_table_name, coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
          v_action, v_fields, v_old, v_new, auth.uid());
  return coalesce(new, old);
end $$;
revoke all on function public.hse_log_change() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['hse_companies','hse_locations','hse_templates','hse_template_versions',
                           'hse_audits','hse_findings','hse_actions','hse_evidences','hse_memberships']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I
                    for each row execute function public.hse_log_change()', t || '_log', t);
  end loop;
end $$;

-- Las respuestas del checklist cambian mucho: se registran sólo las modificaciones
create trigger hse_audit_responses_log after update or delete on public.hse_audit_responses
  for each row execute function public.hse_log_change();

-- ---------- Registro de sesiones de sincronización por dispositivo ----------
create table public.hse_sync_events (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  device_id        text not null check (length(device_id) <= 100),
  pushed           int not null default 0 check (pushed >= 0),
  pulled           int not null default 0 check (pulled >= 0),
  failed           int not null default 0 check (failed >= 0),
  conflicts        int not null default 0 check (conflicts >= 0),
  duration_ms      int,
  app_version      text,
  error_summary    text check (error_summary is null or length(error_summary) <= 2000),
  created_at       timestamptz not null default now()
);
create index hse_sync_events_org_idx  on public.hse_sync_events (organization_id, created_at desc);
create index hse_sync_events_user_idx on public.hse_sync_events (user_id);
