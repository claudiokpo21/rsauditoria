-- =====================================================================
-- HSE Audit Manager · 0018 · Correcciones detectadas por la matriz de permisos
--
--  1. INSERT … RETURNING en hse_findings fallaba: la política SELECT llamaba a
--     hse_finding_role(id), que busca la fila por id y todavía no la ve dentro de
--     la misma sentencia. Se evalúa ahora con los valores de la fila
--     (hse_finding_role_row), igual que hse_audit_role_row.
--  2. Perfiles: la política consultaba hse_memberships bajo RLS; desde 0017 un
--     externo sólo ve su propia membresía y por eso no veía al equipo HSE.
--     Se evalúa en una función SECURITY DEFINER con la misma regla.
--  3. Evidencias: el WITH CHECK del UPDATE exige el mismo permiso que el USING
--     (antes bastaba ser miembro de la organización).
-- =====================================================================

create or replace function public.hse_finding_role_row(p_org uuid, p_finding uuid, p_audit uuid, p_company uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if not hse_is_member(p_org) then return null; end if;
  r := hse_audit_role(p_audit);
  if r in ('gestion','escritura') then return r; end if;
  if exists (select 1 from hse_actions x where x.finding_id = p_finding and x.deleted_at is null
             and x.responsible_user_id = auth.uid()) then
    return 'avance';
  end if;
  if hse_has_role(p_org, '{contractor}') and (
       (p_company is not null and hse_can_access_company(p_org, p_company))
       or exists (select 1 from hse_actions x where x.finding_id = p_finding and x.deleted_at is null
                  and x.responsible_company_id is not null and hse_can_access_company(p_org, x.responsible_company_id))) then
    return coalesce(r, 'lectura');
  end if;
  return r;
end $$;

create or replace function public.hse_finding_role(p_finding uuid)
returns text language sql stable security definer set search_path = public as $$
  select hse_finding_role_row(f.organization_id, f.id, f.audit_id, f.company_id)
  from hse_findings f where f.id = p_finding;
$$;

create or replace function public.hse_profile_visible(p_profile uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_profile = auth.uid() or exists (
    select 1 from hse_memberships mine
    join hse_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = p_profile and theirs.active
      and (mine.role in ('owner','admin','supervisor','auditor','viewer')       -- interno: ve a todos
           or theirs.role in ('owner','admin','supervisor','auditor')));       -- externo: sólo al equipo HSE
$$;

revoke all on function public.hse_finding_role_row(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.hse_finding_role(uuid) from public, anon;
revoke all on function public.hse_profile_visible(uuid) from public, anon;
grant execute on function public.hse_finding_role_row(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.hse_finding_role(uuid) to authenticated;
grant execute on function public.hse_profile_visible(uuid) to authenticated;

alter policy hse_findings_select on public.hse_findings to authenticated
  using (public.hse_finding_role_row(organization_id, id, audit_id, company_id) is not null);

alter policy hse_profiles_select on public.hse_profiles to authenticated
  using (public.hse_profile_visible(id));

alter policy hse_evidences_update on public.hse_evidences to authenticated
  using ((uploaded_by = auth.uid() and (public.hse_audit_role(audit_id) in ('gestion','escritura')
            or (action_id is not null and public.hse_action_role(action_id) = 'avance')))
         or public.hse_audit_role(audit_id) = 'gestion')
  with check ((uploaded_by = auth.uid() and (public.hse_audit_role(audit_id) in ('gestion','escritura')
            or (action_id is not null and public.hse_action_role(action_id) = 'avance')))
         or public.hse_audit_role(audit_id) = 'gestion');
