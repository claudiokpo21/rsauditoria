-- =====================================================================
-- Stubs mínimos de Supabase para aplicar las migraciones en un PostgreSQL local
-- (pruebas de restauración y de políticas sin depender del proyecto en la nube).
-- Reproduce: roles anon/authenticated/service_role, auth.users, auth.uid(),
-- storage.buckets/objects y storage.foldername(). NO usar en producción.
-- =====================================================================
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (
  id uuid primary key, instance_id uuid, aud text, role text, email text, email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}', created_at timestamptz default now(), updated_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' $$;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text,
  metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema auth, storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
grant select on storage.buckets to authenticated;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
