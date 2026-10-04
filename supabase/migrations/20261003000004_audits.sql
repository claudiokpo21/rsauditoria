-- =====================================================================
-- HSE Audit Manager · 0004 · Auditorías, respuestas del checklist y evidencias
-- =====================================================================

create table public.hse_audits (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null references public.hse_organizations(id) on delete cascade,
  template_version_id  uuid not null,
  company_id           uuid,
  location_id          uuid,
  code                 text,
  title                text not null check (length(btrim(title)) between 3 and 300),
  audit_type           text not null default 'interna'
                       check (audit_type in ('interna','externa','csms','seguimiento','legal')),
  status               public.hse_audit_status not null default 'planificada',
  scheduled_date       date,
  started_at           timestamptz,
  completed_at         timestamptz,
  closed_at            timestamptz,
  lead_auditor_id      uuid references auth.users(id) on delete set null,
  audit_team           text,
  scope                text,
  summary              text,
  score                numeric(10,2),
  max_score            numeric(10,2),
  compliance_pct       numeric(5,2) check (compliance_pct is null or compliance_pct between 0 and 100),
  critical_failures    int not null default 0,
  latitude             numeric(9,6),
  longitude            numeric(9,6),
  created_by           uuid references auth.users(id) on delete set null default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  client_updated_at    timestamptz,
  deleted_at           timestamptz,
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, template_version_id) references public.hse_template_versions (organization_id, id),
  foreign key (organization_id, company_id) references public.hse_companies (organization_id, id),
  foreign key (organization_id, location_id) references public.hse_locations (organization_id, id)
);
create index hse_audits_sync_idx     on public.hse_audits (organization_id, updated_at);
create index hse_audits_status_idx   on public.hse_audits (organization_id, status) where deleted_at is null;
create index hse_audits_date_idx     on public.hse_audits (organization_id, scheduled_date);
create index hse_audits_company_idx  on public.hse_audits (company_id) where company_id is not null;
create index hse_audits_location_idx on public.hse_audits (location_id) where location_id is not null;
create index hse_audits_version_idx  on public.hse_audits (template_version_id);
create index hse_audits_lead_idx     on public.hse_audits (lead_auditor_id) where lead_auditor_id is not null;
create trigger hse_audits_touch before insert or update on public.hse_audits
  for each row execute function public.hse_touch_row();

create table public.hse_audit_responses (
  id                 uuid primary key,  -- determinístico en el cliente: uuidv5(audit_id:item_id)
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  audit_id           uuid not null,
  item_id            uuid not null,
  answer             text check (answer in ('cumple','no_cumple','no_aplica','si','no')),
  rating             smallint check (rating between 0 and 5),
  numeric_value      numeric,
  text_value         text check (text_value is null or length(text_value) <= 4000),
  comment            text check (comment is null or length(comment) <= 4000),
  answered_by        uuid references auth.users(id) on delete set null default auth.uid(),
  answered_at        timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  unique (audit_id, item_id),
  foreign key (organization_id, audit_id) references public.hse_audits (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.hse_template_items (organization_id, id)
);
create index hse_audit_responses_sync_idx on public.hse_audit_responses (organization_id, updated_at);
create index hse_audit_responses_item_idx on public.hse_audit_responses (item_id);
create trigger hse_audit_responses_touch before insert or update on public.hse_audit_responses
  for each row execute function public.hse_touch_row();

create table public.hse_evidences (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  audit_id           uuid not null,
  response_id        uuid,
  finding_id         uuid,   -- FK en 0005
  action_id          uuid,   -- FK en 0005
  storage_path       text not null unique,
  file_name          text,
  mime_type          text not null check (mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes         bigint not null check (size_bytes > 0 and size_bytes <= 15728640),
  caption            text check (caption is null or length(caption) <= 1000),
  taken_at           timestamptz,
  latitude           numeric(9,6),
  longitude          numeric(9,6),
  uploaded_by        uuid references auth.users(id) on delete set null default auth.uid(),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  check (split_part(storage_path, '/', 1) = organization_id::text),
  foreign key (organization_id, audit_id) references public.hse_audits (organization_id, id) on delete cascade,
  foreign key (organization_id, response_id) references public.hse_audit_responses (organization_id, id) on delete set null (response_id)
);
create index hse_evidences_sync_idx     on public.hse_evidences (organization_id, updated_at);
create index hse_evidences_audit_idx    on public.hse_evidences (audit_id);
create index hse_evidences_response_idx on public.hse_evidences (response_id) where response_id is not null;
create trigger hse_evidences_touch before insert or update on public.hse_evidences
  for each row execute function public.hse_touch_row();

-- ---------- Reglas de negocio de auditoría ----------
create or replace function public.hse_guard_audit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.hse_template_versions v
                   where v.id = new.template_version_id and v.status = 'publicada') then
      raise exception 'Sólo se pueden auditar versiones publicadas' using errcode = '42501';
    end if;
    if new.code is null then
      new.code := public.hse_next_code(new.organization_id, 'AUD');
    end if;
  else
    if new.template_version_id <> old.template_version_id and old.status <> 'planificada' then
      raise exception 'No se puede cambiar la plantilla de una auditoría iniciada' using errcode = '42501';
    end if;
    if new.code is distinct from old.code then new.code := old.code; end if;
    if old.status in ('cerrada','cancelada') and new.deleted_at is not distinct from old.deleted_at
       and new.status = old.status then
      raise exception 'La auditoría está % y no admite cambios', old.status using errcode = '42501';
    end if;
    if new.status = 'en_curso' and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'completada' and old.status <> 'completada' then
      new.completed_at := coalesce(new.completed_at, now());
    end if;
    if new.status = 'cerrada' and old.status <> 'cerrada' then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
create trigger hse_audits_guard before insert or update on public.hse_audits
  for each row execute function public.hse_guard_audit();

create or replace function public.hse_guard_response()
returns trigger language plpgsql as $$
declare a record;
begin
  select status, template_version_id into a from public.hse_audits where id = new.audit_id;
  if a.status in ('cerrada','cancelada','completada') then
    raise exception 'La auditoría está % y no admite cambios en el checklist', a.status using errcode = '42501';
  end if;
  if not exists (select 1 from public.hse_template_items i
                 where i.id = new.item_id and i.version_id = a.template_version_id) then
    raise exception 'El ítem no pertenece a la versión de plantilla de esta auditoría' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and (new.audit_id <> old.audit_id or new.item_id <> old.item_id) then
    raise exception 'No se puede reasignar una respuesta' using errcode = '42501';
  end if;
  new.answered_at := now();
  new.answered_by := coalesce(auth.uid(), new.answered_by);
  return new;
end $$;
create trigger hse_audit_responses_guard before insert or update on public.hse_audit_responses
  for each row execute function public.hse_guard_response();

-- ---------- Cálculo de puntaje ----------
-- Marcadores: el motor real (hse_evaluate_answers) se define en 0009, donde
-- la metodología pasa a residir en cada versión de plantilla.
create or replace function public.hse_compute_audit_score(p_audit uuid)
returns table (score numeric, max_score numeric, compliance_pct numeric, critical_failures int)
language sql stable as $$
  select 0::numeric, 0::numeric, null::numeric, 0;
$$;

create or replace function public.hse_apply_audit_score()
returns trigger language plpgsql as $$
begin
  return new;
end $$;
create trigger hse_audits_score before update on public.hse_audits
  for each row execute function public.hse_apply_audit_score();
