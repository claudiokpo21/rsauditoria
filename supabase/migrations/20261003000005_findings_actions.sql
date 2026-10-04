-- =====================================================================
-- HSE Audit Manager · 0005 · Hallazgos, no conformidades y planes de acción
-- =====================================================================

create table public.hse_findings (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  audit_id           uuid not null,
  response_id        uuid,
  item_id            uuid,
  company_id         uuid,
  location_id        uuid,
  code               text,
  title              text not null check (length(btrim(title)) between 3 and 300),
  description        text check (description is null or length(description) <= 8000),
  finding_type       public.hse_finding_type not null default 'nc_menor',
  severity           public.hse_severity not null default 'media',
  status             public.hse_finding_status not null default 'abierto',
  root_cause         text,
  immediate_action   text,
  legal_reference    text,
  detected_at        timestamptz not null default now(),
  due_date           date,
  closed_at          timestamptz,
  closed_by          uuid references auth.users(id) on delete set null,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  unique (organization_id, code),
  foreign key (organization_id, audit_id)    references public.hse_audits (organization_id, id) on delete cascade,
  foreign key (organization_id, response_id) references public.hse_audit_responses (organization_id, id) on delete set null (response_id),
  foreign key (organization_id, item_id)     references public.hse_template_items (organization_id, id),
  foreign key (organization_id, company_id)  references public.hse_companies (organization_id, id),
  foreign key (organization_id, location_id) references public.hse_locations (organization_id, id)
);
create index hse_findings_sync_idx     on public.hse_findings (organization_id, updated_at);
create index hse_findings_status_idx   on public.hse_findings (organization_id, status) where deleted_at is null;
create index hse_findings_audit_idx    on public.hse_findings (audit_id);
create index hse_findings_company_idx  on public.hse_findings (company_id) where company_id is not null;
create index hse_findings_response_idx on public.hse_findings (response_id) where response_id is not null;
create index hse_findings_item_idx     on public.hse_findings (item_id) where item_id is not null;
create index hse_findings_location_idx on public.hse_findings (location_id) where location_id is not null;
create trigger hse_findings_touch before insert or update on public.hse_findings
  for each row execute function public.hse_touch_row();

create table public.hse_actions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.hse_organizations(id) on delete cascade,
  finding_id              uuid not null,
  description             text not null check (length(btrim(description)) between 3 and 4000),
  action_type             public.hse_action_type not null default 'correctiva',
  responsible_user_id     uuid references auth.users(id) on delete set null,
  responsible_name        text,
  responsible_company_id  uuid,
  due_date                date not null,
  status                  public.hse_action_status not null default 'pendiente',
  progress_notes          text,
  completed_at            timestamptz,
  verified_by             uuid references auth.users(id) on delete set null,
  verified_at             timestamptz,
  verification_notes      text,
  effectiveness           text check (effectiveness in ('eficaz','no_eficaz')),
  created_by              uuid references auth.users(id) on delete set null default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  client_updated_at       timestamptz,
  deleted_at              timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, finding_id) references public.hse_findings (organization_id, id) on delete cascade,
  foreign key (organization_id, responsible_company_id) references public.hse_companies (organization_id, id)
);
create index hse_actions_sync_idx     on public.hse_actions (organization_id, updated_at);
create index hse_actions_finding_idx  on public.hse_actions (finding_id);
create index hse_actions_due_idx      on public.hse_actions (organization_id, due_date) where status in ('pendiente','en_curso');
create index hse_actions_resp_idx     on public.hse_actions (responsible_user_id) where responsible_user_id is not null;
create index hse_actions_company_idx  on public.hse_actions (responsible_company_id) where responsible_company_id is not null;
create trigger hse_actions_touch before insert or update on public.hse_actions
  for each row execute function public.hse_touch_row();

-- FKs de evidencias hacia hallazgos/acciones
alter table public.hse_evidences
  add constraint hse_evidences_finding_fk foreign key (organization_id, finding_id)
    references public.hse_findings (organization_id, id) on delete set null (finding_id),
  add constraint hse_evidences_action_fk foreign key (organization_id, action_id)
    references public.hse_actions (organization_id, id) on delete set null (action_id);
create index hse_evidences_finding_idx on public.hse_evidences (finding_id) where finding_id is not null;
create index hse_evidences_action_idx  on public.hse_evidences (action_id) where action_id is not null;

-- ---------- Reglas de negocio ----------
create or replace function public.hse_guard_finding()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.code is null then new.code := public.hse_next_code(new.organization_id, 'HAL'); end if;
    -- hereda empresa/ubicación de la auditoría si no se indica
    if new.company_id is null or new.location_id is null then
      select coalesce(new.company_id, a.company_id), coalesce(new.location_id, a.location_id)
        into new.company_id, new.location_id
      from public.hse_audits a where a.id = new.audit_id;
    end if;
  else
    if new.code is distinct from old.code then new.code := old.code; end if;
    if new.audit_id <> old.audit_id then
      raise exception 'No se puede mover un hallazgo a otra auditoría' using errcode = '42501';
    end if;
  end if;
  if new.status in ('cerrado','verificado') and (tg_op = 'INSERT' or old.status not in ('cerrado','verificado')) then
    if exists (select 1 from public.hse_actions x
               where x.finding_id = new.id and x.deleted_at is null
                 and x.status not in ('completada','verificada','cancelada')) then
      raise exception 'No se puede cerrar el hallazgo: tiene acciones pendientes' using errcode = 'HS422';
    end if;
    new.closed_at := now();
    new.closed_by := auth.uid();
  elsif new.status in ('abierto','en_tratamiento') then
    new.closed_at := null; new.closed_by := null;
  end if;
  if new.status = 'verificado' and not public.hse_has_role(new.organization_id, '{owner,admin,supervisor,auditor}') then
    raise exception 'Sólo auditores o supervisores verifican hallazgos' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hse_findings_guard before insert or update on public.hse_findings
  for each row execute function public.hse_guard_finding();

create or replace function public.hse_guard_action()
returns trigger language plpgsql as $$
declare v_role public.hse_role := public.hse_current_role(new.organization_id);
begin
  if tg_op = 'UPDATE' then
    if new.finding_id <> old.finding_id then
      raise exception 'No se puede mover una acción a otro hallazgo' using errcode = '42501';
    end if;
    -- El contratista sólo informa avance: estado (hasta completada) y notas
    if v_role = 'contractor' then
      if new.description is distinct from old.description
         or new.due_date is distinct from old.due_date
         or new.action_type is distinct from old.action_type
         or new.responsible_user_id is distinct from old.responsible_user_id
         or new.responsible_company_id is distinct from old.responsible_company_id
         or new.deleted_at is distinct from old.deleted_at
         or new.status not in ('pendiente','en_curso','completada') then
        raise exception 'El contratista sólo puede informar avance y completar la acción' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.status in ('completada','verificada') and (tg_op = 'INSERT' or old.status not in ('completada','verificada')) then
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  if new.status = 'verificada' and (tg_op = 'INSERT' or old.status <> 'verificada') then
    if v_role is null or v_role not in ('owner','admin','supervisor','auditor') then
      raise exception 'Sólo auditores o supervisores verifican acciones' using errcode = '42501';
    end if;
    new.verified_by := auth.uid(); new.verified_at := now();
  end if;
  if new.status in ('pendiente','en_curso') then new.completed_at := null; end if;
  -- pasa el hallazgo a "en tratamiento" cuando aparece la primera acción
  if tg_op = 'INSERT' then
    update public.hse_findings set status = 'en_tratamiento'
    where id = new.finding_id and status = 'abierto';
  end if;
  return new;
end $$;
create trigger hse_actions_guard before insert or update on public.hse_actions
  for each row execute function public.hse_guard_action();
