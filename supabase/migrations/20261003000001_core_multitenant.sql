-- =====================================================================
-- HSE Audit Manager · 0001 · Núcleo multiempresa
-- Tipos, organizaciones, perfiles, membresías, invitaciones, contadores
-- y funciones auxiliares de autorización (usadas por las políticas RLS).
-- Todos los objetos llevan prefijo hse_ para convivir con otros esquemas.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- Tipos enumerados ----------
create type public.hse_role as enum ('owner','admin','supervisor','auditor','viewer','contractor');
create type public.hse_company_type as enum ('propia','cliente','contratista','subcontratista');
create type public.hse_template_category as enum ('seguridad_higiene','salud_ocupacional','medio_ambiente','csms','integral');
create type public.hse_version_status as enum ('borrador','publicada','archivada');
create type public.hse_response_type as enum ('cumplimiento','si_no','puntaje','numerico','texto');
create type public.hse_audit_status as enum ('planificada','en_curso','completada','cerrada','cancelada');
create type public.hse_finding_type as enum ('nc_mayor','nc_menor','observacion','oportunidad_mejora');
create type public.hse_severity as enum ('baja','media','alta','critica');
create type public.hse_finding_status as enum ('abierto','en_tratamiento','cerrado','verificado');
create type public.hse_action_type as enum ('contencion','correctiva','preventiva');
create type public.hse_action_status as enum ('pendiente','en_curso','completada','verificada','cancelada');

-- ---------- Función genérica de sellado de filas ----------
-- updated_at lo fija SIEMPRE el servidor (cursor de sincronización).
-- client_updated_at lo envía el cliente; si llega una escritura más vieja
-- que la almacenada se rechaza (resolución de conflictos last-write-wins).
create or replace function public.hse_touch_row()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'No se puede mover un registro a otra organización' using errcode = '42501';
    end if;
    if new.client_updated_at is not null and old.client_updated_at is not null
       and new.client_updated_at < old.client_updated_at then
      raise exception 'stale_write' using errcode = 'HS409',
        detail = 'El servidor tiene una versión más reciente de este registro';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  else
    -- el autor lo determina el JWT, nunca el cliente
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end $$;

-- Sellado simple para tablas sin organization_id/client_updated_at
create or replace function public.hse_touch_simple()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- Organizaciones ----------
create table public.hse_organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(btrim(name)) between 2 and 200),
  tax_id      text check (tax_id is null or length(tax_id) <= 20),
  settings    jsonb not null default '{}'::jsonb,
  created_by  uuid references auth.users(id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger hse_organizations_touch before update on public.hse_organizations
  for each row execute function public.hse_touch_simple();

-- ---------- Perfiles ----------
create table public.hse_profiles (
  id                       uuid primary key references auth.users(id) on delete cascade,
  email                    text not null,
  full_name                text check (full_name is null or length(full_name) <= 200),
  phone                    text check (phone is null or length(phone) <= 40),
  job_title                text check (job_title is null or length(job_title) <= 120),
  default_organization_id  uuid references public.hse_organizations(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index hse_profiles_email_idx on public.hse_profiles (lower(email));
create index hse_profiles_default_org_idx on public.hse_profiles (default_organization_id) where default_organization_id is not null;
create trigger hse_profiles_touch before update on public.hse_profiles
  for each row execute function public.hse_touch_simple();

-- ---------- Membresías ----------
create table public.hse_memberships (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  role             public.hse_role not null default 'viewer',
  company_id       uuid,  -- FK compuesta agregada en 0002 (rol contratista)
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);
create index hse_memberships_user_idx on public.hse_memberships (user_id) where active;
create trigger hse_memberships_touch before update on public.hse_memberships
  for each row execute function public.hse_touch_simple();

-- ---------- Invitaciones ----------
create table public.hse_invitations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  email            text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role             public.hse_role not null default 'auditor' check (role <> 'owner'),
  company_id       uuid,
  invited_by       uuid references auth.users(id) on delete set null default auth.uid(),
  accepted_at      timestamptz,
  accepted_by      uuid references auth.users(id) on delete set null,
  expires_at       timestamptz not null default now() + interval '14 days',
  created_at       timestamptz not null default now()
);
create unique index hse_invitations_pending_uq
  on public.hse_invitations (organization_id, lower(email)) where accepted_at is null;
create index hse_invitations_email_idx on public.hse_invitations (lower(email)) where accepted_at is null;

-- ---------- Contadores de numeración (AUD-2026-0001, HAL-2026-0001) ----------
create table public.hse_counters (
  organization_id uuid not null references public.hse_organizations(id) on delete cascade,
  key   text not null,
  year  int  not null,
  value int  not null default 0,
  primary key (organization_id, key, year)
);

create or replace function public.hse_next_code(p_org uuid, p_key text)
returns text language plpgsql security definer set search_path = public as $$
declare v int; y int := extract(year from now())::int;
begin
  -- se invoca desde triggers con los permisos del usuario: sólo para su organización
  if not exists (select 1 from hse_memberships m
                 where m.organization_id = p_org and m.user_id = auth.uid() and m.active) then
    raise exception 'Sin acceso a la organización' using errcode = '42501';
  end if;
  insert into hse_counters (organization_id, key, year, value) values (p_org, p_key, y, 1)
  on conflict (organization_id, key, year) do update set value = hse_counters.value + 1
  returning value into v;
  return p_key || '-' || y || '-' || lpad(v::text, 4, '0');
end $$;
revoke all on function public.hse_next_code(uuid, text) from public, anon;
grant execute on function public.hse_next_code(uuid, text) to authenticated;

-- ---------- Funciones de autorización (SECURITY DEFINER, sin recursión RLS) ----------
create or replace function public.hse_is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hse_memberships m
                 where m.organization_id = p_org and m.user_id = auth.uid() and m.active);
$$;

create or replace function public.hse_has_role(p_org uuid, p_roles public.hse_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hse_memberships m
                 where m.organization_id = p_org and m.user_id = auth.uid()
                   and m.active and m.role = any (p_roles));
$$;

create or replace function public.hse_current_role(p_org uuid)
returns public.hse_role language sql stable security definer set search_path = public as $$
  select m.role from hse_memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.active limit 1;
$$;

create or replace function public.hse_try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin return p::uuid; exception when others then return null; end $$;

revoke all on function public.hse_is_member(uuid) from public, anon;
revoke all on function public.hse_has_role(uuid, public.hse_role[]) from public, anon;
revoke all on function public.hse_current_role(uuid) from public, anon;
grant execute on function public.hse_is_member(uuid) to authenticated;
grant execute on function public.hse_has_role(uuid, public.hse_role[]) to authenticated;
grant execute on function public.hse_current_role(uuid) to authenticated;
