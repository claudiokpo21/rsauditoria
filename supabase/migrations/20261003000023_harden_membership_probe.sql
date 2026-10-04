-- =====================================================================
-- HSE Audit Manager · 0023 · hse_is_org_user no responde sobre organizaciones ajenas
-- La función es invocable por cualquier usuario autenticado (la usan políticas y
-- triggers). Antes respondía si CUALQUIER usuario pertenece a CUALQUIER organización
-- conociendo los UUID; ahora sólo lo hace para organizaciones del propio usuario.
-- Los procesos del servidor sin usuario (pg_cron, auth.uid() nulo) siguen funcionando.
-- =====================================================================
create or replace function public.hse_is_org_user(p_org uuid, p_user uuid, p_roles public.hse_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select (auth.uid() is null or hse_is_member(p_org))
     and exists (select 1 from hse_memberships m where m.organization_id = p_org and m.user_id = p_user and m.active
                 and (p_roles is null or m.role = any (p_roles)));
$$;
revoke all on function public.hse_is_org_user(uuid, uuid, public.hse_role[]) from public, anon;
grant execute on function public.hse_is_org_user(uuid, uuid, public.hse_role[]) to authenticated;
