-- =====================================================================
-- HSE Audit Manager · 0007 · Seguridad a nivel de fila (RLS)
-- Regla base: ningún dato es visible fuera de la organización a la que
-- pertenece el usuario. Los roles definen qué puede escribir cada uno.
--   owner/admin ........ administración completa
--   supervisor ......... maestros, plantillas, auditorías, hallazgos
--   auditor ............ ejecución de auditorías, hallazgos y acciones
--   viewer ............. sólo lectura
--   contractor ......... sólo su empresa: ver hallazgos/acciones propias,
--                        informar avance y subir evidencias de cierre
-- =====================================================================

-- Sin acceso anónimo a ninguna tabla HSE
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'hse\_%'
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------- Organizaciones ----------
create policy hse_org_select on public.hse_organizations for select to authenticated
  using (public.hse_is_member(id));
create policy hse_org_update on public.hse_organizations for update to authenticated
  using (public.hse_has_role(id, '{owner,admin}')) with check (public.hse_has_role(id, '{owner,admin}'));
create policy hse_org_delete on public.hse_organizations for delete to authenticated
  using (public.hse_has_role(id, '{owner}'));
-- INSERT sólo vía RPC hse_create_organization (SECURITY DEFINER)

-- ---------- Perfiles ----------
create policy hse_profiles_select on public.hse_profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.hse_memberships mine
    join public.hse_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = hse_profiles.id));
create policy hse_profiles_insert on public.hse_profiles for insert to authenticated
  with check (id = auth.uid());
create policy hse_profiles_update on public.hse_profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and (default_organization_id is null or public.hse_is_member(default_organization_id)));

-- ---------- Membresías ----------
create policy hse_memberships_select on public.hse_memberships for select to authenticated
  using (user_id = auth.uid() or public.hse_is_member(organization_id));
create policy hse_memberships_insert on public.hse_memberships for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin}')
              and (role <> 'owner' or public.hse_has_role(organization_id, '{owner}')));
create policy hse_memberships_update on public.hse_memberships for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}')
         and (role <> 'owner' or public.hse_has_role(organization_id, '{owner}')))
  with check (public.hse_has_role(organization_id, '{owner,admin}')
              and (role <> 'owner' or public.hse_has_role(organization_id, '{owner}')));
create policy hse_memberships_delete on public.hse_memberships for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}')
         and (role <> 'owner' or public.hse_has_role(organization_id, '{owner}')));

-- Siempre debe quedar al menos un owner activo
create or replace function public.hse_guard_last_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_org uuid := coalesce(old.organization_id, new.organization_id);
begin
  if old.role = 'owner' and old.active
     and (tg_op = 'DELETE' or new.role <> 'owner' or not new.active)
     and exists (select 1 from hse_organizations where id = v_org)
     and not exists (select 1 from hse_memberships m where m.organization_id = v_org
                     and m.role = 'owner' and m.active and m.id <> old.id) then
    raise exception 'La organización debe conservar al menos un propietario' using errcode = 'HS422';
  end if;
  if tg_op = 'UPDATE' and new.role = 'contractor' and new.company_id is null then
    raise exception 'El rol contratista requiere una empresa asociada' using errcode = '23502';
  end if;
  return coalesce(new, old);
end $$;
create trigger hse_memberships_last_owner before update or delete on public.hse_memberships
  for each row execute function public.hse_guard_last_owner();

-- ---------- Invitaciones ----------
create policy hse_invitations_all on public.hse_invitations for all to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'))
  with check (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Empresas y ubicaciones ----------
create policy hse_companies_select on public.hse_companies for select to authenticated
  using (public.hse_can_access_company(organization_id, id));
create policy hse_companies_insert on public.hse_companies for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
create policy hse_companies_update on public.hse_companies for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
create policy hse_companies_delete on public.hse_companies for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

create policy hse_locations_select on public.hse_locations for select to authenticated
  using (public.hse_is_member(organization_id));
create policy hse_locations_insert on public.hse_locations for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
create policy hse_locations_update on public.hse_locations for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
create policy hse_locations_delete on public.hse_locations for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Plantillas (cabecera, versiones, secciones, ítems) ----------
do $$
declare t text;
begin
  foreach t in array array['hse_templates','hse_template_versions','hse_template_sections','hse_template_items']
  loop
    execute format('create policy %I on public.%I for select to authenticated
                    using (public.hse_is_member(organization_id))', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated
                    with check (public.hse_has_role(organization_id, ''{owner,admin,supervisor}''))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated
                    using (public.hse_has_role(organization_id, ''{owner,admin,supervisor}''))
                    with check (public.hse_has_role(organization_id, ''{owner,admin,supervisor}''))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated
                    using (public.hse_has_role(organization_id, ''{owner,admin,supervisor}''))', t || '_delete', t);
  end loop;
end $$;

-- ---------- Auditorías ----------
create policy hse_audits_select on public.hse_audits for select to authenticated
  using (public.hse_can_access_company(organization_id, company_id));
create policy hse_audits_insert on public.hse_audits for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_audits_update on public.hse_audits for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}')
              -- cerrar o reabrir una auditoría cerrada requiere supervisor o superior
              and (status <> 'cerrada' or public.hse_has_role(organization_id, '{owner,admin,supervisor}')));
create policy hse_audits_delete on public.hse_audits for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Respuestas del checklist ----------
create policy hse_responses_select on public.hse_audit_responses for select to authenticated
  using (exists (select 1 from public.hse_audits a where a.id = audit_id));
create policy hse_responses_insert on public.hse_audit_responses for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}')
              and exists (select 1 from public.hse_audits a where a.id = audit_id and a.organization_id = hse_audit_responses.organization_id));
create policy hse_responses_update on public.hse_audit_responses for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_responses_delete on public.hse_audit_responses for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));

-- ---------- Hallazgos ----------
create policy hse_findings_select on public.hse_findings for select to authenticated
  using (public.hse_can_access_company(organization_id, company_id));
create policy hse_findings_insert on public.hse_findings for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_findings_update on public.hse_findings for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_findings_delete on public.hse_findings for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Acciones ----------
create policy hse_actions_select on public.hse_actions for select to authenticated
  using (public.hse_is_member(organization_id) and (
         exists (select 1 from public.hse_findings f where f.id = finding_id)
         or public.hse_can_access_company(organization_id, responsible_company_id)));
create policy hse_actions_insert on public.hse_actions for insert to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_actions_update on public.hse_actions for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}')
         or (public.hse_has_role(organization_id, '{contractor}')
             and public.hse_can_access_company(organization_id, responsible_company_id)))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}')
         or (public.hse_has_role(organization_id, '{contractor}')
             and public.hse_can_access_company(organization_id, responsible_company_id)));
create policy hse_actions_delete on public.hse_actions for delete to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Evidencias ----------
create policy hse_evidences_select on public.hse_evidences for select to authenticated
  using (exists (select 1 from public.hse_audits a where a.id = audit_id)
         or (action_id is not null and exists (select 1 from public.hse_actions x where x.id = action_id)));
create policy hse_evidences_insert on public.hse_evidences for insert to authenticated
  with check (uploaded_by = auth.uid() and (
    public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}')
    or (public.hse_has_role(organization_id, '{contractor}') and action_id is not null
        and exists (select 1 from public.hse_actions x where x.id = action_id
                    and public.hse_can_access_company(x.organization_id, x.responsible_company_id)))));
create policy hse_evidences_update on public.hse_evidences for update to authenticated
  using (uploaded_by = auth.uid() or public.hse_has_role(organization_id, '{owner,admin,supervisor}'))
  with check (public.hse_is_member(organization_id));
create policy hse_evidences_delete on public.hse_evidences for delete to authenticated
  using (uploaded_by = auth.uid() or public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------- Historial y sincronización ----------
create policy hse_change_log_select on public.hse_change_log for select to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
-- sin políticas de escritura: sólo el trigger SECURITY DEFINER inserta

create policy hse_sync_events_insert on public.hse_sync_events for insert to authenticated
  with check (user_id = auth.uid() and public.hse_is_member(organization_id));
create policy hse_sync_events_select on public.hse_sync_events for select to authenticated
  using (user_id = auth.uid() or public.hse_has_role(organization_id, '{owner,admin}'));

-- hse_counters: RLS activo y sin políticas → inaccesible salvo funciones definer.
