-- =====================================================================
-- HSE Audit Manager · 0002 · Empresas, contratistas y ubicaciones
-- Claves foráneas compuestas (organization_id, id) garantizan que una
-- referencia nunca apunte a un registro de otra organización.
-- =====================================================================

create table public.hse_companies (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  name               text not null check (length(btrim(name)) between 2 and 200),
  tax_id             text check (tax_id is null or length(tax_id) <= 20),
  company_type       public.hse_company_type not null default 'contratista',
  parent_company_id  uuid,
  contact_name       text,
  contact_email      text,
  contact_phone      text,
  csms_status        text not null default 'no_evaluada'
                     check (csms_status in ('no_evaluada','aprobada','condicional','rechazada')),
  csms_valid_until   date,
  active             boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, parent_company_id) references public.hse_companies (organization_id, id),
  check (parent_company_id is null or parent_company_id <> id)
);
create unique index hse_companies_name_uq on public.hse_companies (organization_id, lower(name)) where deleted_at is null;
create index hse_companies_sync_idx on public.hse_companies (organization_id, updated_at);
create index hse_companies_parent_idx on public.hse_companies (parent_company_id) where parent_company_id is not null;
create trigger hse_companies_touch before insert or update on public.hse_companies
  for each row execute function public.hse_touch_row();

-- Usuarios con rol contratista quedan vinculados a una empresa
alter table public.hse_memberships
  add constraint hse_memberships_company_fk
  foreign key (organization_id, company_id) references public.hse_companies (organization_id, id);
alter table public.hse_invitations
  add constraint hse_invitations_company_fk
  foreign key (organization_id, company_id) references public.hse_companies (organization_id, id);
create index hse_memberships_company_idx on public.hse_memberships (company_id) where company_id is not null;

create table public.hse_locations (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.hse_organizations(id) on delete cascade,
  company_id          uuid,
  parent_location_id  uuid,
  name                text not null check (length(btrim(name)) between 2 and 200),
  location_type       text not null default 'planta'
                      check (location_type in ('planta','yacimiento','pozo','base','obra','oficina','deposito','otro')),
  address             text,
  latitude            numeric(9,6) check (latitude between -90 and 90),
  longitude           numeric(9,6) check (longitude between -180 and 180),
  active              boolean not null default true,
  created_by          uuid references auth.users(id) on delete set null default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  client_updated_at   timestamptz,
  deleted_at          timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, company_id) references public.hse_companies (organization_id, id),
  foreign key (organization_id, parent_location_id) references public.hse_locations (organization_id, id)
);
create index hse_locations_sync_idx on public.hse_locations (organization_id, updated_at);
create index hse_locations_company_idx on public.hse_locations (company_id) where company_id is not null;
create index hse_locations_parent_idx on public.hse_locations (parent_location_id) where parent_location_id is not null;
create trigger hse_locations_touch before insert or update on public.hse_locations
  for each row execute function public.hse_touch_row();

-- Un contratista sólo ve su empresa y sus subcontratistas; el resto de roles ve todo.
create or replace function public.hse_can_access_company(p_org uuid, p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from hse_memberships m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.active
      and (
        m.role <> 'contractor'
        or (p_company is not null and m.company_id is not null and (
              p_company = m.company_id
              or exists (select 1 from hse_companies c
                         where c.id = p_company and c.organization_id = p_org
                           and c.parent_company_id = m.company_id)))
      )
  );
$$;
revoke all on function public.hse_can_access_company(uuid, uuid) from public, anon;
grant execute on function public.hse_can_access_company(uuid, uuid) to authenticated;
