-- =====================================================================
-- HSE Audit Manager · 0017 · Modelo de autorización y aislamiento
--
--  * Acceso por AUDITORÍA (no sólo por organización): cada auditoría tiene
--    organización propietaria, empresa contratista y participantes asignados.
--    hse_audit_role() devuelve el permiso efectivo del usuario sobre ella:
--      gestion    Administrador / Coordinador HSE
--      escritura  Auditor asignado (líder o auditor participante)
--      lectura    Auditor observador, Usuario de consulta, Responsable del contratista auditado
--      null       sin acceso (otro auditor no asignado, responsable de acciones, otra organización)
--  * Hallazgos y acciones heredan el permiso de su auditoría; el Responsable de
--    acciones y el Responsable de contratista obtienen "avance" sobre sus acciones.
--  * Nunca se confía en ids enviados por el cliente: user_id/lead/responsable se
--    validan como miembros activos de la MISMA organización; empresas y registros
--    relacionados por FK compuesta (organization_id, id); autor/fechas/estado de
--    verificación los fija el servidor.
-- =====================================================================

-- ---------------------------------------------------------------- utilidades
-- ¿el usuario es miembro activo de la organización? (opcionalmente con alguno de los roles)
create or replace function public.hse_is_org_user(p_org uuid, p_user uuid, p_roles public.hse_role[] default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hse_memberships m where m.organization_id = p_org and m.user_id = p_user and m.active
                 and (p_roles is null or m.role = any (p_roles)));
$$;
revoke all on function public.hse_is_org_user(uuid, uuid, public.hse_role[]) from public, anon;
grant execute on function public.hse_is_org_user(uuid, uuid, public.hse_role[]) to authenticated;

-- ---------------------------------------------------------------- participantes
create table public.hse_audit_participants (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  audit_id           uuid not null,
  user_id            uuid not null references auth.users(id) on delete cascade,
  participant_role   text not null check (participant_role in ('lider','auditor','observador')),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  row_version        bigint not null default 1,
  unique (organization_id, id),
  unique (audit_id, user_id),
  foreign key (organization_id, audit_id) references public.hse_audits (organization_id, id) on delete cascade
);
create index hse_audit_participants_user_idx on public.hse_audit_participants (user_id) where deleted_at is null;
create index hse_audit_participants_sync_idx on public.hse_audit_participants (organization_id, updated_at);
create trigger hse_audit_participants_touch before insert or update on public.hse_audit_participants
  for each row execute function public.hse_touch_row();

create or replace function public.hse_guard_participant()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (new.audit_id <> old.audit_id or new.user_id <> old.user_id) then
    raise exception 'No se puede reasignar un participante' using errcode = '42501';
  end if;
  if new.participant_role in ('lider','auditor') then
    if not hse_is_org_user(new.organization_id, new.user_id, '{owner,admin,supervisor,auditor}') then
      raise exception 'El participante debe ser auditor, coordinador o administrador activo de la organización' using errcode = '23514';
    end if;
  elsif not hse_is_org_user(new.organization_id, new.user_id, '{owner,admin,supervisor,auditor,viewer}') then
    raise exception 'El observador debe ser un miembro interno activo de la organización' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger hse_audit_participants_guard before insert or update on public.hse_audit_participants
  for each row execute function public.hse_guard_participant();

-- ---------------------------------------------------------------- permiso efectivo por auditoría
create or replace function public.hse_audit_role_row(p_org uuid, p_audit uuid, p_company uuid, p_lead uuid, p_creator uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when m.role in ('owner','admin','supervisor') then 'gestion'
    when m.role = 'auditor' and (p_lead = auth.uid() or p_creator = auth.uid() or exists (
           select 1 from hse_audit_participants p where p.audit_id = p_audit and p.user_id = auth.uid()
             and p.deleted_at is null and p.participant_role in ('lider','auditor'))) then 'escritura'
    when m.role = 'auditor' and exists (
           select 1 from hse_audit_participants p where p.audit_id = p_audit and p.user_id = auth.uid()
             and p.deleted_at is null and p.participant_role = 'observador') then 'lectura'
    when m.role = 'viewer' then 'lectura'
    when m.role = 'contractor' and hse_can_access_company(p_org, p_company) and p_company is not null then 'lectura'
    else null end
  from hse_memberships m
  where m.organization_id = p_org and m.user_id = auth.uid() and m.active;
$$;

create or replace function public.hse_audit_role(p_audit uuid)
returns text language sql stable security definer set search_path = public as $$
  select hse_audit_role_row(a.organization_id, a.id, a.company_id, a.lead_auditor_id, a.created_by)
  from hse_audits a where a.id = p_audit;
$$;

-- hallazgo: el de su auditoría; "avance" para quien tiene acciones asignadas en él;
-- "lectura" para el contratista de la empresa del hallazgo
create or replace function public.hse_finding_role(p_finding uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare f record; r text;
begin
  select * into f from hse_findings where id = p_finding;
  if f.id is null or not hse_is_member(f.organization_id) then return null; end if;
  r := hse_audit_role(f.audit_id);
  if r in ('gestion','escritura') then return r; end if;
  if exists (select 1 from hse_actions x where x.finding_id = f.id and x.deleted_at is null and x.responsible_user_id = auth.uid()) then return 'avance'; end if;
  if hse_has_role(f.organization_id, '{contractor}') and (hse_can_access_company(f.organization_id, f.company_id) and f.company_id is not null
       or exists (select 1 from hse_actions x where x.finding_id = f.id and x.deleted_at is null and x.responsible_company_id is not null
                  and hse_can_access_company(f.organization_id, x.responsible_company_id))) then
    return coalesce(r, 'lectura');
  end if;
  return r;
end $$;

-- acción: la de su hallazgo; "avance" para el responsable asignado y el contratista responsable
create or replace function public.hse_action_role_row(p_org uuid, p_finding uuid, p_responsible uuid, p_company uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if not hse_is_member(p_org) then return null; end if;
  r := hse_finding_role(p_finding);
  if r in ('gestion','escritura') then return r; end if;
  if p_responsible = auth.uid() then return 'avance'; end if;
  if p_company is not null and hse_has_role(p_org, '{contractor}') and hse_can_access_company(p_org, p_company) then return 'avance'; end if;
  return case when r = 'lectura' then 'lectura' end;
end $$;

create or replace function public.hse_action_role(p_action uuid)
returns text language sql stable security definer set search_path = public as $$
  select hse_action_role_row(x.organization_id, x.finding_id, x.responsible_user_id, x.responsible_company_id)
  from hse_actions x where x.id = p_action;
$$;

-- ¿puede subir un archivo a la carpeta de esta auditoría? (Storage)
create or replace function public.hse_can_upload_evidence(p_org uuid, p_audit uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from hse_audits a where a.id = p_audit and a.organization_id = p_org)
     and (hse_audit_role(p_audit) in ('gestion','escritura')
          or exists (select 1 from hse_actions x join hse_findings f on f.id = x.finding_id
                     where f.audit_id = p_audit and x.deleted_at is null
                       and hse_action_role_row(x.organization_id, x.finding_id, x.responsible_user_id, x.responsible_company_id) = 'avance'));
$$;

do $$
declare f text;
begin
  foreach f in array array['hse_audit_role_row(uuid,uuid,uuid,uuid,uuid)','hse_audit_role(uuid)','hse_finding_role(uuid)',
                           'hse_action_role_row(uuid,uuid,uuid,uuid)','hse_action_role(uuid)','hse_can_upload_evidence(uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- columnas nuevas
alter table public.hse_audits add column closed_by uuid references auth.users(id) on delete set null;
alter table public.hse_findings
  add column verification_notes text check (verification_notes is null or length(verification_notes) <= 4000),
  add column effectiveness text check (effectiveness in ('eficaz','no_eficaz')),
  add column verified_by uuid references auth.users(id) on delete set null,
  add column verified_at timestamptz;
create index hse_audits_closed_by_idx on public.hse_audits (closed_by) where closed_by is not null;
create index hse_findings_verified_by_idx on public.hse_findings (verified_by) where verified_by is not null;

-- ---------------------------------------------------------------- registro de reaperturas
create table public.hse_reopen_log (
  id               bigint generated always as identity primary key,
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  entity           text not null check (entity in ('auditoria','hallazgo')),
  entity_id        uuid not null,
  previous_status  text not null,
  new_status       text not null,
  reason           text not null check (length(btrim(reason)) >= 20),
  reopened_by      uuid not null references auth.users(id) on delete restrict,
  reopened_at      timestamptz not null default now()
);
create index hse_reopen_log_org_idx on public.hse_reopen_log (organization_id, reopened_at desc);
create index hse_reopen_log_entity_idx on public.hse_reopen_log (entity_id);
create index hse_reopen_log_user_idx on public.hse_reopen_log (reopened_by);
alter table public.hse_reopen_log enable row level security;
alter table public.hse_reopen_log force row level security;
revoke all on public.hse_reopen_log from anon;
create policy hse_reopen_log_select on public.hse_reopen_log for select to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
-- sin políticas de escritura: sólo las RPC de reapertura (SECURITY DEFINER) insertan

-- ---------------------------------------------------------------- reglas de auditoría
create or replace function public.hse_guard_audit()
returns trigger language plpgsql set search_path = public as $$
declare v_gestion boolean := hse_has_role(new.organization_id, '{owner,admin,supervisor}');
        v_reopen boolean := coalesce(current_setting('hse.reopening', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from hse_template_versions v where v.id = new.template_version_id and v.status = 'publicada') then
      raise exception 'Sólo se pueden auditar versiones publicadas' using errcode = '42501';
    end if;
    if new.status not in ('planificada','en_curso') then
      raise exception 'Una auditoría se crea planificada o en curso' using errcode = '42501';
    end if;
    new.lead_auditor_id := coalesce(new.lead_auditor_id, auth.uid());
    if not v_gestion and new.lead_auditor_id is distinct from auth.uid() then
      raise exception 'Un auditor sólo puede crear auditorías que lidera' using errcode = '42501';
    end if;
    if not hse_is_org_user(new.organization_id, new.lead_auditor_id, '{owner,admin,supervisor,auditor}') then
      raise exception 'El auditor líder debe ser auditor activo de la organización' using errcode = '23514';
    end if;
    if new.code is null then new.code := hse_next_code(new.organization_id, 'AUD'); end if;
    new.started_at := case when new.status = 'en_curso' then now() end;
    new.completed_at := null; new.closed_at := null; new.closed_by := null;
    return new;
  end if;

  -- cerrada / cancelada: inmutable salvo reapertura autorizada (hse_reopen_audit)
  if old.status in ('cerrada','cancelada') and not v_reopen then
    raise exception 'La auditoría está % y no admite cambios; requiere reapertura autorizada', old.status using errcode = '42501';
  end if;
  if new.code is distinct from old.code then new.code := old.code; end if;
  if (new.template_version_id <> old.template_version_id or new.company_id is distinct from old.company_id
      or new.lead_auditor_id is distinct from old.lead_auditor_id) and not v_gestion then
    raise exception 'Sólo coordinación o administración cambia plantilla, empresa o auditor líder' using errcode = '42501';
  end if;
  if new.template_version_id <> old.template_version_id and old.status <> 'planificada' then
    raise exception 'No se puede cambiar la plantilla de una auditoría iniciada' using errcode = '42501';
  end if;
  if new.lead_auditor_id is distinct from old.lead_auditor_id
     and not hse_is_org_user(new.organization_id, new.lead_auditor_id, '{owner,admin,supervisor,auditor}') then
    raise exception 'El auditor líder debe ser auditor activo de la organización' using errcode = '23514';
  end if;
  if new.status <> old.status and not v_reopen then
    if old.status = 'completada' and new.status in ('planificada','en_curso') and not v_gestion then
      raise exception 'Sólo coordinación o administración reabre una auditoría completada' using errcode = '42501';
    end if;
    if new.status = 'cerrada' and (old.status <> 'completada' or not v_gestion) then
      raise exception 'Sólo coordinación o administración cierra, y sólo una auditoría completada' using errcode = '42501';
    end if;
    if new.status = 'cancelada' and not v_gestion then
      raise exception 'Sólo coordinación o administración cancela auditorías' using errcode = '42501';
    end if;
    if new.status = 'planificada' and old.status <> 'completada' then
      raise exception 'Transición de estado no permitida' using errcode = '42501';
    end if;
  end if;
  -- fechas y responsables de estado: siempre del servidor
  new.started_at := case when new.status = 'planificada' then null else coalesce(old.started_at, case when new.status <> 'planificada' then now() end) end;
  new.completed_at := case when new.status in ('completada','cerrada') then coalesce(case when old.status in ('completada','cerrada') then old.completed_at end, now()) end;
  if new.status = 'cerrada' and old.status <> 'cerrada' then new.closed_at := now(); new.closed_by := auth.uid();
  elsif new.status <> 'cerrada' then new.closed_at := null; new.closed_by := null;
  else new.closed_at := old.closed_at; new.closed_by := old.closed_by; end if;
  return new;
end $$;

-- el líder queda como participante "lider" automáticamente
create or replace function public.hse_audit_add_lead()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_auditor_id is not null and (tg_op = 'INSERT' or new.lead_auditor_id is distinct from old.lead_auditor_id) then
    insert into hse_audit_participants (organization_id, audit_id, user_id, participant_role)
    values (new.organization_id, new.id, new.lead_auditor_id, 'lider')
    on conflict (audit_id, user_id) do update set participant_role = 'lider', deleted_at = null;
  end if;
  return new;
end $$;
create trigger hse_audits_add_lead after insert or update of lead_auditor_id on public.hse_audits
  for each row execute function public.hse_audit_add_lead();
revoke all on function public.hse_audit_add_lead() from public, anon, authenticated;

-- respuestas: además de las reglas previas, el autor lo fija el servidor (0004)
-- evidencias: coherencia de relaciones y bloqueo sobre auditorías cerradas
create or replace function public.hse_guard_evidence()
returns trigger language plpgsql set search_path = public as $$
declare a record;
begin
  select status into a from hse_audits where id = new.audit_id;
  if new.response_id is not null and not exists (select 1 from hse_audit_responses r where r.id = new.response_id and r.audit_id = new.audit_id) then
    raise exception 'La respuesta no pertenece a la auditoría' using errcode = '23503';
  end if;
  if new.finding_id is not null and not exists (select 1 from hse_findings f where f.id = new.finding_id and f.audit_id = new.audit_id) then
    raise exception 'El hallazgo no pertenece a la auditoría' using errcode = '23503';
  end if;
  if new.action_id is not null and not exists (select 1 from hse_actions x join hse_findings f on f.id = x.finding_id where x.id = new.action_id and f.audit_id = new.audit_id) then
    raise exception 'La acción no pertenece a la auditoría' using errcode = '23503';
  end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := auth.uid();
    if new.action_id is null and a.status in ('completada','cerrada','cancelada') then
      raise exception 'La auditoría está % y no admite nuevas evidencias de checklist', a.status using errcode = '42501';
    end if;
  else
    new.uploaded_by := old.uploaded_by;
    if new.storage_path <> old.storage_path or new.audit_id <> old.audit_id then
      raise exception 'No se puede cambiar el archivo ni la auditoría de una evidencia' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger hse_evidences_guard before insert or update on public.hse_evidences
  for each row execute function public.hse_guard_evidence();

-- ---------------------------------------------------------------- hallazgos: verificación obligatoria
create or replace function public.hse_guard_finding()
returns trigger language plpgsql set search_path = public as $$
declare v_role text; v_reopen boolean := coalesce(current_setting('hse.reopening', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if new.status <> 'abierto' then raise exception 'Un hallazgo se registra abierto' using errcode = '42501'; end if;
    if new.code is null then new.code := hse_next_code(new.organization_id, 'HAL'); end if;
    if new.company_id is null or new.location_id is null then
      select coalesce(new.company_id, a.company_id), coalesce(new.location_id, a.location_id) into new.company_id, new.location_id
      from hse_audits a where a.id = new.audit_id;
    end if;
    new.closed_at := null; new.closed_by := null; new.verified_at := null; new.verified_by := null;
    return new;
  end if;

  if old.status = 'verificado' and not v_reopen then
    raise exception 'Hallazgo verificado: cierre definitivo; requiere reapertura autorizada' using errcode = '42501';
  end if;
  if new.code is distinct from old.code then new.code := old.code; end if;
  if new.audit_id <> old.audit_id then raise exception 'No se puede mover un hallazgo a otra auditoría' using errcode = '42501'; end if;

  if new.status <> old.status and not v_reopen then
    if new.status in ('cerrado','verificado') and exists (select 1 from hse_actions x where x.finding_id = new.id and x.deleted_at is null
         and x.status not in ('completada','verificada','cancelada')) then
      raise exception 'No se puede cerrar el hallazgo: tiene acciones pendientes' using errcode = 'HS422';
    end if;
    if new.status = 'verificado' then
      v_role := hse_audit_role(new.audit_id);
      if old.status <> 'cerrado' then
        raise exception 'Sólo se verifica un hallazgo cerrado (pendiente de verificación)' using errcode = 'HS422';
      end if;
      if v_role is null or v_role not in ('gestion','escritura') or not hse_has_role(new.organization_id, '{owner,admin,supervisor,auditor}') then
        raise exception 'Sólo coordinación, administración o un auditor asignado verifican hallazgos' using errcode = '42501';
      end if;
      if coalesce(btrim(new.verification_notes), '') = '' or new.effectiveness is null then
        raise exception 'La verificación requiere evidencia/notas y resultado de eficacia' using errcode = 'HS422';
      end if;
      if exists (select 1 from hse_actions x where x.finding_id = new.id and x.deleted_at is null and x.status not in ('verificada','cancelada')) then
        raise exception 'Todas las acciones deben estar verificadas antes del cierre definitivo' using errcode = 'HS422';
      end if;
      if new.finding_type not in ('observacion','oportunidad_mejora')
         and not exists (select 1 from hse_actions x where x.finding_id = new.id and x.deleted_at is null and x.status = 'verificada') then
        raise exception 'Una no conformidad requiere al menos una acción verificada' using errcode = 'HS422';
      end if;
      if exists (select 1 from hse_actions x where x.finding_id = new.id and x.deleted_at is null and x.responsible_user_id = auth.uid()) then
        raise exception 'Quien es responsable de una acción no puede verificar el hallazgo (independencia)' using errcode = '42501';
      end if;
      new.verified_by := auth.uid(); new.verified_at := now();
    end if;
  end if;
  -- campos que fija el servidor
  if new.status in ('cerrado','verificado') then
    new.closed_at := coalesce(case when old.status in ('cerrado','verificado') then old.closed_at end, now());
    new.closed_by := coalesce(case when old.status in ('cerrado','verificado') then old.closed_by end, auth.uid());
  else
    new.closed_at := null; new.closed_by := null;
  end if;
  if new.status <> 'verificado' then new.verified_by := null; new.verified_at := null;
  elsif old.status = 'verificado' then new.verified_by := old.verified_by; new.verified_at := old.verified_at; end if;
  return new;
end $$;

-- ---------------------------------------------------------------- acciones
create or replace function public.hse_guard_action()
returns trigger language plpgsql set search_path = public as $$
declare v_writer boolean;
begin
  v_writer := hse_finding_role(new.finding_id) in ('gestion','escritura');
  if new.responsible_user_id is not null and (tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id)
     and not hse_is_org_user(new.organization_id, new.responsible_user_id) then
    raise exception 'El responsable debe ser un usuario activo de la organización' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if not v_writer then raise exception 'Sin permiso para crear acciones en este hallazgo' using errcode = '42501'; end if;
    if new.status not in ('pendiente','en_curso') then raise exception 'Una acción se crea pendiente o en curso' using errcode = '42501'; end if;
    update hse_findings set status = 'en_tratamiento' where id = new.finding_id and status = 'abierto';
  else
    if new.finding_id <> old.finding_id then raise exception 'No se puede mover una acción a otro hallazgo' using errcode = '42501'; end if;
    if not v_writer then
      -- responsable asignado o contratista: sólo informa avance
      if new.description is distinct from old.description or new.due_date is distinct from old.due_date
         or new.action_type is distinct from old.action_type or new.responsible_user_id is distinct from old.responsible_user_id
         or new.responsible_company_id is distinct from old.responsible_company_id or new.responsible_name is distinct from old.responsible_name
         or new.deleted_at is distinct from old.deleted_at or new.verification_notes is distinct from old.verification_notes
         or new.effectiveness is distinct from old.effectiveness
         or new.status not in ('pendiente','en_curso','completada') or old.status in ('verificada','cancelada') then
        raise exception 'El responsable sólo puede informar avance y completar la acción' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.status = 'verificada' and (tg_op = 'INSERT' or old.status <> 'verificada') then
    if not v_writer or not hse_has_role(new.organization_id, '{owner,admin,supervisor,auditor}') then
      raise exception 'Sólo coordinación, administración o un auditor asignado verifican acciones' using errcode = '42501';
    end if;
    if new.responsible_user_id = auth.uid() then
      raise exception 'El responsable de la acción no puede verificarla (independencia)' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and old.status <> 'completada' then
      raise exception 'Sólo se verifica una acción completada' using errcode = 'HS422';
    end if;
    if new.effectiveness is null then raise exception 'Indique la eficacia al verificar' using errcode = 'HS422'; end if;
    new.verified_by := auth.uid(); new.verified_at := now();
  elsif new.status <> 'verificada' then
    new.verified_by := null; new.verified_at := null;
  else
    new.verified_by := old.verified_by; new.verified_at := old.verified_at;
  end if;
  new.completed_at := case when new.status in ('completada','verificada')
                           then coalesce(case when tg_op = 'UPDATE' and old.status in ('completada','verificada') then old.completed_at end, now()) end;
  return new;
end $$;

-- ---------------------------------------------------------------- plantillas: publicación y criterios
create or replace function public.hse_guard_version_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'borrador' and exists (select 1 from hse_organizations where id = old.organization_id) then
    raise exception 'Una versión publicada o archivada no se elimina' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger hse_template_versions_no_delete before delete on public.hse_template_versions
  for each row execute function public.hse_guard_version_delete();

-- ---------------------------------------------------------------- RLS: auditorías y dependientes
alter policy hse_audits_select on public.hse_audits to authenticated
  using (public.hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) is not null);
alter policy hse_audits_insert on public.hse_audits to authenticated
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}')
              or (public.hse_has_role(organization_id, '{auditor}') and lead_auditor_id = auth.uid()));
alter policy hse_audits_update on public.hse_audits to authenticated
  using (public.hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) in ('gestion','escritura'))
  with check (public.hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) in ('gestion','escritura'));
alter policy hse_audits_delete on public.hse_audits to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}') and status = 'planificada');

create policy hse_participants_select on public.hse_audit_participants for select to authenticated
  using (public.hse_audit_role(audit_id) is not null);
create policy hse_participants_insert on public.hse_audit_participants for insert to authenticated
  with check (public.hse_audit_role(audit_id) = 'gestion');
create policy hse_participants_update on public.hse_audit_participants for update to authenticated
  using (public.hse_audit_role(audit_id) = 'gestion') with check (public.hse_audit_role(audit_id) = 'gestion');
create policy hse_participants_delete on public.hse_audit_participants for delete to authenticated
  using (public.hse_audit_role(audit_id) = 'gestion');
alter table public.hse_audit_participants enable row level security;
alter table public.hse_audit_participants force row level security;
revoke all on public.hse_audit_participants from anon;

alter policy hse_responses_select on public.hse_audit_responses to authenticated
  using (public.hse_audit_role(audit_id) is not null);
alter policy hse_responses_insert on public.hse_audit_responses to authenticated
  with check (public.hse_audit_role(audit_id) in ('gestion','escritura'));
alter policy hse_responses_update on public.hse_audit_responses to authenticated
  using (public.hse_audit_role(audit_id) in ('gestion','escritura')) with check (public.hse_audit_role(audit_id) in ('gestion','escritura'));
alter policy hse_responses_delete on public.hse_audit_responses to authenticated
  using (public.hse_audit_role(audit_id) = 'gestion');

alter policy hse_findings_select on public.hse_findings to authenticated
  using (public.hse_finding_role(id) is not null);
alter policy hse_findings_insert on public.hse_findings to authenticated
  with check (public.hse_audit_role(audit_id) in ('gestion','escritura'));
alter policy hse_findings_update on public.hse_findings to authenticated
  using (public.hse_audit_role(audit_id) in ('gestion','escritura')) with check (public.hse_audit_role(audit_id) in ('gestion','escritura'));
alter policy hse_findings_delete on public.hse_findings to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}') and status = 'abierto');

alter policy hse_actions_select on public.hse_actions to authenticated
  using (public.hse_action_role_row(organization_id, finding_id, responsible_user_id, responsible_company_id) is not null);
alter policy hse_actions_insert on public.hse_actions to authenticated
  with check (public.hse_finding_role(finding_id) in ('gestion','escritura'));
alter policy hse_actions_update on public.hse_actions to authenticated
  using (public.hse_action_role_row(organization_id, finding_id, responsible_user_id, responsible_company_id) in ('gestion','escritura','avance'))
  with check (public.hse_is_member(organization_id));          -- el trigger restringe los campos según el permiso
alter policy hse_actions_delete on public.hse_actions to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

alter policy hse_evidences_select on public.hse_evidences to authenticated
  using (public.hse_audit_role(audit_id) is not null
         or (action_id is not null and public.hse_action_role(action_id) is not null)
         or (finding_id is not null and public.hse_finding_role(finding_id) is not null));
alter policy hse_evidences_insert on public.hse_evidences to authenticated
  with check (public.hse_audit_role(audit_id) in ('gestion','escritura')
              or (action_id is not null and public.hse_action_role(action_id) = 'avance'));
alter policy hse_evidences_update on public.hse_evidences to authenticated
  using ((uploaded_by = auth.uid() and (public.hse_audit_role(audit_id) in ('gestion','escritura')
            or (action_id is not null and public.hse_action_role(action_id) = 'avance')))
         or public.hse_audit_role(audit_id) = 'gestion')
  with check (public.hse_is_member(organization_id));
alter policy hse_evidences_delete on public.hse_evidences to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));

-- ---------------------------------------------------------------- RLS: miembros y perfiles (minimización)
alter policy hse_memberships_select on public.hse_memberships to authenticated
  using (user_id = auth.uid() or public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor,viewer}'));

alter policy hse_profiles_select on public.hse_profiles to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.hse_memberships mine join public.hse_memberships theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.active and theirs.user_id = hse_profiles.id and theirs.active
      and (mine.role in ('owner','admin','supervisor','auditor','viewer')                 -- interno: ve a todos
           or theirs.role in ('owner','admin','supervisor','auditor'))));                -- externo: sólo al equipo HSE

-- ---------------------------------------------------------------- RLS: plantillas (sólo administración borra)
alter policy hse_templates_delete on public.hse_templates to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin}'));
alter policy hse_template_versions_delete on public.hse_template_versions to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}') and status = 'borrador');

-- ---------------------------------------------------------------- Storage equivalente
alter policy hse_evid_obj_insert on storage.objects to authenticated
  with check (bucket_id = 'hse-evidencias'
              and public.hse_try_uuid((storage.foldername(name))[1]) is not null
              and public.hse_try_uuid((storage.foldername(name))[2]) is not null
              and public.hse_can_upload_evidence(public.hse_try_uuid((storage.foldername(name))[1]),
                                                 public.hse_try_uuid((storage.foldername(name))[2])));
alter policy hse_evid_obj_update on storage.objects to authenticated
  using (false);                                            -- los archivos no se reemplazan (upsert=false)
alter policy hse_evid_obj_delete on storage.objects to authenticated
  using (bucket_id = 'hse-evidencias'
         and public.hse_has_role(public.hse_try_uuid((storage.foldername(name))[1]), '{owner,admin}'));
-- lectura: sin cambios (0011) — el archivo es legible sólo si su metadato es visible bajo RLS

-- ---------------------------------------------------------------- historial: quién cambió qué
-- 0006 ya registra UPDATE/DELETE de respuestas; se agrega el alta
create trigger hse_audit_responses_log_insert after insert on public.hse_audit_responses
  for each row execute function public.hse_log_change();
create trigger hse_template_sections_log after insert or update or delete on public.hse_template_sections
  for each row execute function public.hse_log_change();
create trigger hse_template_items_log after insert or update or delete on public.hse_template_items
  for each row execute function public.hse_log_change();
create trigger hse_audit_participants_log after insert or update or delete on public.hse_audit_participants
  for each row execute function public.hse_log_change();

-- ---------------------------------------------------------------- RPC de reapertura (autorización especial)
create or replace function public.hse_reopen_audit(p_audit uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from hse_audits where id = p_audit for update;
  if a.id is null or not hse_has_role(a.organization_id, '{owner,admin}') then
    raise exception 'Reabrir una auditoría cerrada requiere rol de Administrador' using errcode = '42501';
  end if;
  if a.status not in ('cerrada','cancelada') then raise exception 'La auditoría no está cerrada ni cancelada' using errcode = 'HS422'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then raise exception 'Indique el motivo de la reapertura (mínimo 20 caracteres)' using errcode = 'HS422'; end if;
  insert into hse_reopen_log (organization_id, entity, entity_id, previous_status, new_status, reason, reopened_by)
  values (a.organization_id, 'auditoria', a.id, a.status, 'en_curso', btrim(p_reason), auth.uid());
  perform set_config('hse.reopening', 'on', true);
  update hse_audits set status = 'en_curso' where id = p_audit;
  perform set_config('hse.reopening', 'off', true);
end $$;

create or replace function public.hse_reopen_finding(p_finding uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare f record;
begin
  select * into f from hse_findings where id = p_finding for update;
  if f.id is null or not hse_has_role(f.organization_id, '{owner,admin,supervisor}') then
    raise exception 'Reabrir un hallazgo verificado requiere Coordinación HSE o Administración' using errcode = '42501';
  end if;
  if f.status <> 'verificado' then raise exception 'El hallazgo no está verificado' using errcode = 'HS422'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 20 then raise exception 'Indique el motivo de la reapertura (mínimo 20 caracteres)' using errcode = 'HS422'; end if;
  insert into hse_reopen_log (organization_id, entity, entity_id, previous_status, new_status, reason, reopened_by)
  values (f.organization_id, 'hallazgo', f.id, f.status, 'en_tratamiento', btrim(p_reason), auth.uid());
  perform set_config('hse.reopening', 'on', true);
  update hse_findings set status = 'en_tratamiento' where id = p_finding;
  perform set_config('hse.reopening', 'off', true);
end $$;
revoke all on function public.hse_reopen_audit(uuid, text) from public, anon;
revoke all on function public.hse_reopen_finding(uuid, text) from public, anon;
grant execute on function public.hse_reopen_audit(uuid, text) to authenticated;
grant execute on function public.hse_reopen_finding(uuid, text) to authenticated;

-- ---------------------------------------------------------------- invitaciones y sincronización
create or replace function public.hse_sync_writable_columns(p_table text)
returns text[] language sql immutable set search_path = public as $$
  select case p_table
    when 'hse_companies' then array['id','organization_id','name','tax_id','company_type','parent_company_id','contact_name','contact_email','contact_phone','csms_status','csms_valid_until','active','deleted_at','client_updated_at']
    when 'hse_locations' then array['id','organization_id','company_id','parent_location_id','name','location_type','address','latitude','longitude','active','deleted_at','client_updated_at']
    when 'hse_processes' then array['id','organization_id','name','sort_order','active','deleted_at','client_updated_at']
    when 'hse_templates' then array['id','organization_id','name','category','description','active','deleted_at','client_updated_at']
    when 'hse_template_versions' then array['id','organization_id','template_id','version_number','change_notes','scoring_method','scoring_config','deleted_at','client_updated_at']
    when 'hse_template_sections' then array['id','organization_id','version_id','title','description','sort_order','code','deleted_at','client_updated_at']
    when 'hse_template_items' then array['id','organization_id','version_id','section_id','code','question','guidance','response_type','weight','is_critical','evidence_required_on_fail','legal_reference','sort_order','process_id','deleted_at','client_updated_at']
    when 'hse_template_import_issues' then array['id','organization_id','status','resolution_note','client_updated_at']
    when 'hse_audits' then array['id','organization_id','template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','lead_auditor_id','audit_team','scope','summary','latitude','longitude','deleted_at','client_updated_at']
    when 'hse_audit_participants' then array['id','organization_id','audit_id','user_id','participant_role','deleted_at','client_updated_at']
    when 'hse_audit_responses' then array['id','organization_id','audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at']
    when 'hse_findings' then array['id','organization_id','audit_id','response_id','item_id','company_id','location_id','title','description','finding_type','severity','status','root_cause','immediate_action','legal_reference','detected_at','due_date','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_actions' then array['id','organization_id','finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_evidences' then array['id','organization_id','audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','deleted_at','client_updated_at']
    else null end;
$$;
