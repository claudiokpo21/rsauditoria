-- =====================================================================
-- HSE Audit Manager · 0026 · Panel de administración de usuarios
-- Lista de miembros con correo, último ingreso y carga asignada, sólo para
-- propietarios y administradores de la organización. No modifica datos:
-- altas, cambios de rol y bajas siguen por hse_invite_member y RLS.
-- =====================================================================

create or replace function public.hse_admin_members(p_org uuid)
returns table (
  membership_id uuid, user_id uuid, email text, full_name text, job_title text, phone text,
  role public.hse_role, company_id uuid, active boolean, member_since timestamptz,
  last_sign_in_at timestamptz, email_confirmed boolean, audits_assigned integer, actions_open integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_org is null or not hse_has_role(p_org, '{owner,admin}') then
    raise exception 'Sólo propietarios y administradores ven el panel de usuarios' using errcode = '42501';
  end if;
  return query
  select m.id, m.user_id, coalesce(p.email, u.email)::text, p.full_name, p.job_title, p.phone,
         m.role, m.company_id, m.active, m.created_at,
         u.last_sign_in_at, (u.email_confirmed_at is not null),
         (select count(*)::int from hse_audit_participants ap join hse_audits a on a.id = ap.audit_id
           where ap.user_id = m.user_id and ap.organization_id = p_org and ap.deleted_at is null
             and a.deleted_at is null and a.status in ('planificada', 'en_curso')),
         (select count(*)::int from hse_actions x
           where x.organization_id = p_org and x.responsible_user_id = m.user_id and x.deleted_at is null
             and x.status in ('pendiente', 'en_curso'))
  from hse_memberships m
  left join hse_profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.organization_id = p_org
  order by m.active desc, lower(coalesce(p.full_name, p.email, u.email));
end $$;

revoke all on function public.hse_admin_members(uuid) from public, anon;
grant execute on function public.hse_admin_members(uuid) to authenticated;

comment on function public.hse_admin_members(uuid) is
  'Panel de administración: miembros de la organización con correo, último ingreso y carga asignada (sólo owner/admin).';
