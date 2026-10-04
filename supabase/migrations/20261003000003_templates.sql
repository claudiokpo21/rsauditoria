-- =====================================================================
-- HSE Audit Manager · 0003 · Plantillas y versiones de auditoría
-- Una versión publicada es inmutable: las auditorías quedan atadas a la
-- versión exacta con la que se ejecutaron.
-- =====================================================================

create table public.hse_templates (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  name               text not null check (length(btrim(name)) between 2 and 200),
  category           public.hse_template_category not null,
  description        text,
  active             boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id)
);
create index hse_templates_sync_idx on public.hse_templates (organization_id, updated_at);
create trigger hse_templates_touch before insert or update on public.hse_templates
  for each row execute function public.hse_touch_row();

create table public.hse_template_versions (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  template_id        uuid not null,
  version_number     int  not null check (version_number > 0),
  status             public.hse_version_status not null default 'borrador',
  change_notes       text,
  published_at       timestamptz,
  published_by       uuid references auth.users(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  unique (template_id, version_number),
  foreign key (organization_id, template_id) references public.hse_templates (organization_id, id) on delete cascade
);
create index hse_template_versions_sync_idx on public.hse_template_versions (organization_id, updated_at);
create unique index hse_template_versions_one_draft
  on public.hse_template_versions (template_id) where status = 'borrador' and deleted_at is null;
create trigger hse_template_versions_touch before insert or update on public.hse_template_versions
  for each row execute function public.hse_touch_row();

create table public.hse_template_sections (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  version_id         uuid not null,
  title              text not null check (length(btrim(title)) between 1 and 300),
  description        text,
  sort_order         int not null default 0,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, version_id) references public.hse_template_versions (organization_id, id) on delete cascade
);
create index hse_template_sections_version_idx on public.hse_template_sections (version_id, sort_order);
create index hse_template_sections_sync_idx on public.hse_template_sections (organization_id, updated_at);
create trigger hse_template_sections_touch before insert or update on public.hse_template_sections
  for each row execute function public.hse_touch_row();

create table public.hse_template_items (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null references public.hse_organizations(id) on delete cascade,
  version_id                uuid not null,
  section_id                uuid not null,
  code                      text check (code is null or length(code) <= 30),
  question                  text not null check (length(btrim(question)) between 3 and 2000),
  guidance                  text,
  response_type             public.hse_response_type not null default 'cumplimiento',
  weight                    numeric(6,2) not null default 1 check (weight >= 0 and weight <= 100),
  is_critical               boolean not null default false,
  evidence_required_on_fail boolean not null default true,
  legal_reference           text,
  sort_order                int not null default 0,
  created_by                uuid references auth.users(id) on delete set null default auth.uid(),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  client_updated_at         timestamptz,
  deleted_at                timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, version_id) references public.hse_template_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, section_id) references public.hse_template_sections (organization_id, id) on delete cascade
);
create index hse_template_items_version_idx on public.hse_template_items (version_id);
create index hse_template_items_section_idx on public.hse_template_items (section_id, sort_order);
create index hse_template_items_sync_idx on public.hse_template_items (organization_id, updated_at);
create trigger hse_template_items_touch before insert or update on public.hse_template_items
  for each row execute function public.hse_touch_row();

-- ---------- Inmutabilidad de versiones publicadas ----------
create or replace function public.hse_guard_version_content()
returns trigger language plpgsql as $$
declare v_status public.hse_version_status; v_version uuid;
begin
  v_version := case when tg_op = 'DELETE' then old.version_id else new.version_id end;
  select status into v_status from public.hse_template_versions where id = v_version;
  -- borrado en cascada (la versión ya no existe): permitido
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
  if v_status is distinct from 'borrador' then
    raise exception 'La versión % no está en borrador; su contenido es inmutable', v_version
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.version_id <> old.version_id then
    raise exception 'No se puede mover contenido entre versiones' using errcode = '42501';
  end if;
  if tg_table_name = 'hse_template_items' and tg_op <> 'DELETE' then
    if not exists (select 1 from public.hse_template_sections s
                   where s.id = new.section_id and s.version_id = new.version_id) then
      raise exception 'La sección no pertenece a la versión indicada' using errcode = '23503';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

create trigger hse_template_sections_guard before insert or update or delete on public.hse_template_sections
  for each row execute function public.hse_guard_version_content();
create trigger hse_template_items_guard before insert or update or delete on public.hse_template_items
  for each row execute function public.hse_guard_version_content();

create or replace function public.hse_guard_version_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.status <> 'borrador' then
    raise exception 'Las versiones nuevas se crean en borrador' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'archivada' and new.status <> 'archivada' then
      raise exception 'Una versión archivada no puede reactivarse' using errcode = '42501';
    end if;
    if old.status = 'publicada' and new.status = 'borrador' then
      raise exception 'Una versión publicada no puede volver a borrador' using errcode = '42501';
    end if;
    if old.status <> 'borrador' and (new.version_number <> old.version_number or new.template_id <> old.template_id) then
      raise exception 'Versión publicada inmutable' using errcode = '42501';
    end if;
    -- publicar sólo vía hse_publish_template_version (fija published_at)
    if old.status = 'borrador' and new.status = 'publicada' and new.published_at is null then
      raise exception 'Use hse_publish_template_version para publicar' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger hse_template_versions_guard before insert or update on public.hse_template_versions
  for each row execute function public.hse_guard_version_status();
