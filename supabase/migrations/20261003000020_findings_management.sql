-- =====================================================================
-- HSE Audit Manager · 0020 · Gestión integral de hallazgos, acciones y cierre
--
--  * Hallazgo: vínculo validado con auditoría y pregunta (la respuesta debe ser
--    de la misma auditoría y la pregunta de su versión de plantilla), requisito
--    incumplido, clasificación (tipo, gravedad, categoría, proceso), responsable,
--    vencimiento y análisis de causa raíz (5 porqués / Ishikawa / otro).
--  * Recurrencia: la calcula el servidor (misma pregunta de la misma plantilla en
--    la misma empresa, en otra auditoría).
--  * Una no conformidad no se cierra sin causa raíz y sin acción correctiva.
--  * Acciones: criterio de eficacia (sólo lo define quien gestiona el hallazgo).
--  * Cierre de auditoría validado en el servidor (hse_audit_readiness):
--      completar: preguntas obligatorias respondidas, evidencias exigidas por la
--                 plantilla presentes y con su archivo en Storage, ítems críticos
--                 incumplidos con hallazgo registrado;
--      cerrar:    revisión de coordinación hecha por alguien distinto del líder,
--                 cada no conformidad con plan de acción, resumen redactado.
--  * Notificaciones de vencimiento (en la aplicación; idempotentes; pg_cron opcional).
--  * Historial por registro con control de acceso (hse_record_history).
-- =====================================================================

-- ---------------------------------------------------------------- plantillas: obligatoriedad
alter table public.hse_template_items add column if not exists is_required boolean not null default true;
comment on column public.hse_template_items.is_required is 'La pregunta debe responderse para completar la auditoría';

-- ---------------------------------------------------------------- hallazgos: columnas
alter table public.hse_findings
  add column if not exists requirement          text check (requirement is null or length(requirement) <= 2000),
  add column if not exists category             public.hse_template_category,
  add column if not exists process_id           uuid,
  add column if not exists responsible_user_id  uuid references auth.users(id) on delete set null,
  add column if not exists rca_method           text check (rca_method in ('cinco_porques','ishikawa','otro')),
  add column if not exists rca_data             jsonb,
  add column if not exists recurrence_key       text,
  add column if not exists recurrence_of        uuid,
  add column if not exists recurrence_count     int not null default 0;
alter table public.hse_findings
  add constraint hse_findings_process_fk foreign key (organization_id, process_id)
    references public.hse_processes (organization_id, id),
  add constraint hse_findings_recurrence_fk foreign key (organization_id, recurrence_of)
    references public.hse_findings (organization_id, id) on delete set null (recurrence_of),
  add constraint hse_findings_rca_data_chk check (rca_data is null or (jsonb_typeof(rca_data) = 'object' and length(rca_data::text) <= 20000));
create index if not exists hse_findings_process_idx     on public.hse_findings (process_id) where process_id is not null;
create index if not exists hse_findings_resp_idx        on public.hse_findings (responsible_user_id) where responsible_user_id is not null;
create index if not exists hse_findings_recurrence_idx  on public.hse_findings (organization_id, recurrence_key) where recurrence_key is not null and deleted_at is null;
create index if not exists hse_findings_recur_of_idx    on public.hse_findings (recurrence_of) where recurrence_of is not null;
create index if not exists hse_findings_due_idx         on public.hse_findings (organization_id, due_date) where status in ('abierto','en_tratamiento');

-- ---------------------------------------------------------------- acciones: criterio de eficacia
alter table public.hse_actions
  add column if not exists effectiveness_criteria text check (effectiveness_criteria is null or length(effectiveness_criteria) <= 2000);

-- ---------------------------------------------------------------- auditorías: revisión
alter table public.hse_audits
  add column if not exists reviewed_by  uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_notes text check (review_notes is null or length(review_notes) <= 4000);
create index if not exists hse_audits_reviewed_by_idx on public.hse_audits (reviewed_by) where reviewed_by is not null;

-- ---------------------------------------------------------------- recurrencia
create or replace function public.hse_finding_recurrence_key(p_company uuid, p_item uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(p_company::text, '-') || ':' || v.template_id::text || ':' ||
         lower(coalesce(nullif(btrim(i.code), ''), nullif(btrim(i.original_number), ''), md5(lower(btrim(i.question)))))
  from hse_template_items i join hse_template_versions v on v.id = i.version_id
  where i.id = p_item;
$$;

-- ---------------------------------------------------------------- reglas de hallazgo (complementan hse_guard_finding)
create or replace function public.hse_findings_rules()
returns trigger language plpgsql set search_path = public as $$
declare a record; r record; v_reopen boolean := coalesce(current_setting('hse.reopening', true), '') = 'on';
begin
  select id, template_version_id into a from hse_audits where id = new.audit_id;

  if new.response_id is not null and (tg_op = 'INSERT' or new.response_id is distinct from old.response_id) then
    select id, audit_id, item_id into r from hse_audit_responses where id = new.response_id;
    if r.id is null or r.audit_id <> new.audit_id then
      raise exception 'La respuesta no pertenece a la auditoría del hallazgo' using errcode = '23503';
    end if;
    if new.item_id is null then new.item_id := r.item_id;
    elsif new.item_id <> r.item_id then
      raise exception 'La pregunta no coincide con la respuesta indicada' using errcode = '23514';
    end if;
  end if;
  if new.item_id is not null and (tg_op = 'INSERT' or new.item_id is distinct from old.item_id)
     and not exists (select 1 from hse_template_items i where i.id = new.item_id and i.version_id = a.template_version_id) then
    raise exception 'La pregunta no pertenece a la plantilla de la auditoría' using errcode = '23503';
  end if;
  if new.responsible_user_id is not null and (tg_op = 'INSERT' or new.responsible_user_id is distinct from old.responsible_user_id)
     and not hse_is_org_user(new.organization_id, new.responsible_user_id) then
    raise exception 'El responsable debe ser un usuario activo de la organización' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and new.category is null then
    select t.category into new.category
    from hse_template_versions v join hse_templates t on t.id = v.template_id where v.id = a.template_version_id;
  end if;

  -- recurrencia: la calcula siempre el servidor
  if tg_op = 'INSERT' or new.item_id is distinct from old.item_id or new.company_id is distinct from old.company_id then
    new.recurrence_key := case when new.item_id is not null then hse_finding_recurrence_key(new.company_id, new.item_id) end;
    if new.recurrence_key is null then
      new.recurrence_of := null; new.recurrence_count := 0;
    else
      select f.id into new.recurrence_of from hse_findings f
       where f.organization_id = new.organization_id and f.recurrence_key = new.recurrence_key
         and f.audit_id <> new.audit_id and f.id <> new.id and f.deleted_at is null and f.detected_at <= new.detected_at
       order by f.detected_at desc limit 1;
      select count(*) into new.recurrence_count from hse_findings f
       where f.organization_id = new.organization_id and f.recurrence_key = new.recurrence_key
         and f.audit_id <> new.audit_id and f.id <> new.id and f.deleted_at is null and f.detected_at <= new.detected_at;
    end if;
  else
    new.recurrence_key := old.recurrence_key; new.recurrence_of := old.recurrence_of; new.recurrence_count := old.recurrence_count;
  end if;

  -- cierre de una no conformidad
  if tg_op = 'UPDATE' and new.status = 'cerrado' and old.status <> 'cerrado' and not v_reopen
     and new.finding_type in ('no_conformidad','nc_mayor','nc_menor') then
    if coalesce(btrim(new.root_cause), '') = '' then
      raise exception 'Una no conformidad requiere análisis de causa raíz antes del cierre' using errcode = 'HS422';
    end if;
    if not exists (select 1 from hse_actions x where x.finding_id = new.id and x.deleted_at is null
                   and x.action_type = 'correctiva' and x.status <> 'cancelada') then
      raise exception 'Una no conformidad requiere al menos una acción correctiva' using errcode = 'HS422';
    end if;
  end if;
  return new;
end $$;
create trigger hse_findings_rules before insert or update on public.hse_findings
  for each row execute function public.hse_findings_rules();

-- ---------------------------------------------------------------- reglas de acción (complementan hse_guard_action)
create or replace function public.hse_actions_rules()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.effectiveness_criteria is distinct from old.effectiveness_criteria
     and hse_finding_role(new.finding_id) not in ('gestion','escritura') then
    raise exception 'Sólo quien gestiona el hallazgo define el criterio de eficacia' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hse_actions_rules before insert or update on public.hse_actions
  for each row execute function public.hse_actions_rules();

-- el responsable de un hallazgo puede verlo aunque no tenga acciones asignadas
create or replace function public.hse_finding_role_row(p_org uuid, p_finding uuid, p_audit uuid, p_company uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare r text;
begin
  if not hse_is_member(p_org) then return null; end if;
  r := hse_audit_role(p_audit);
  if r in ('gestion','escritura') then return r; end if;
  if exists (select 1 from hse_actions x where x.finding_id = p_finding and x.deleted_at is null
             and x.responsible_user_id = auth.uid())
     or exists (select 1 from hse_findings f where f.id = p_finding and f.responsible_user_id = auth.uid()) then
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

-- ---------------------------------------------------------------- preparación para completar / cerrar
create or replace function public.hse_audit_readiness(p_audit uuid, p_target text default 'completada')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  a record; v jsonb := '[]'::jsonb; v_fail text[] := array['no_cumple','no','nc'];
begin
  select * into a from hse_audits where id = p_audit;
  if a.id is null then raise exception 'Auditoría inexistente' using errcode = 'P0002'; end if;
  if auth.uid() is not null and hse_audit_role(p_audit) is null then
    raise exception 'Sin acceso a la auditoría' using errcode = '42501';
  end if;
  if p_target not in ('completada','cerrada') then raise exception 'Destino inválido' using errcode = '22023'; end if;

  if p_target = 'completada' then
    -- 1. preguntas obligatorias sin responder
    select v || coalesce(jsonb_agg(jsonb_build_object('code','sin_responder','item_id',i.id,
             'ref', coalesce(i.code, i.original_number), 'message', 'Pregunta obligatoria sin responder: ' || left(i.question, 140))
             order by s.sort_order, i.sort_order), '[]'::jsonb) into v
    from hse_template_items i
    join hse_template_sections s on s.id = i.section_id
    left join hse_audit_responses r on r.audit_id = a.id and r.item_id = i.id and r.deleted_at is null
    where i.version_id = a.template_version_id and i.deleted_at is null and s.deleted_at is null and i.is_required
      and (r.id is null or (r.answer is null and r.rating is null and r.numeric_value is null
                            and coalesce(btrim(r.text_value), '') = ''));
    -- 2. incumplimientos que la plantilla exige respaldar con evidencia (con archivo recibido)
    select v || coalesce(jsonb_agg(jsonb_build_object('code','evidencia_faltante','item_id',i.id,
             'ref', coalesce(i.code, i.original_number), 'message', 'Falta evidencia del incumplimiento: ' || left(i.question, 140))), '[]'::jsonb) into v
    from hse_audit_responses r join hse_template_items i on i.id = r.item_id
    where r.audit_id = a.id and r.deleted_at is null and r.answer = any (v_fail) and i.evidence_required_on_fail
      and not exists (select 1 from hse_evidences e join storage.objects o on o.bucket_id = 'hse-evidencias' and o.name = e.storage_path
                      where e.response_id = r.id and e.deleted_at is null);
    -- 3. evidencias registradas cuyo archivo no está en Storage
    select v || coalesce(jsonb_agg(jsonb_build_object('code','archivo_faltante','evidence_id',e.id,
             'message', 'Evidencia sin archivo en el servidor: ' || coalesce(e.file_name, e.id::text))), '[]'::jsonb) into v
    from hse_evidences e
    where e.audit_id = a.id and e.deleted_at is null
      and not exists (select 1 from storage.objects o where o.bucket_id = 'hse-evidencias' and o.name = e.storage_path);
    -- 4. ítems críticos incumplidos sin hallazgo
    select v || coalesce(jsonb_agg(jsonb_build_object('code','critico_sin_hallazgo','item_id',i.id,
             'ref', coalesce(i.code, i.original_number), 'message', 'Ítem crítico incumplido sin hallazgo: ' || left(i.question, 140))), '[]'::jsonb) into v
    from hse_audit_responses r join hse_template_items i on i.id = r.item_id
    where r.audit_id = a.id and r.deleted_at is null and r.answer = any (v_fail) and i.is_critical
      and not exists (select 1 from hse_findings f where f.audit_id = a.id and f.deleted_at is null
                      and (f.response_id = r.id or f.item_id = i.id));
  else
    if a.status <> 'completada' then
      v := v || jsonb_build_array(jsonb_build_object('code','no_completada','message','La auditoría debe estar completada'));
    end if;
    if a.reviewed_at is null then
      v := v || jsonb_build_array(jsonb_build_object('code','sin_revision',
             'message','Falta la revisión de Coordinación HSE o Administración (distinta del auditor líder)'));
    end if;
    if coalesce(btrim(a.summary), '') = '' then
      v := v || jsonb_build_array(jsonb_build_object('code','sin_resumen','message','Falta el resumen / conclusión de la auditoría'));
    end if;
    select v || coalesce(jsonb_agg(jsonb_build_object('code','nc_sin_plan','finding_id',f.id,
             'message', 'No conformidad sin plan de acción: ' || coalesce(f.code || ' · ', '') || left(f.title, 120))), '[]'::jsonb) into v
    from hse_findings f
    where f.audit_id = a.id and f.deleted_at is null and f.finding_type in ('no_conformidad','nc_mayor','nc_menor')
      and not exists (select 1 from hse_actions x where x.finding_id = f.id and x.deleted_at is null and x.status <> 'cancelada');
  end if;

  return jsonb_build_object('audit_id', a.id, 'target', p_target, 'ok', jsonb_array_length(v) = 0,
                            'issues', v, 'checked_at', now());
end $$;

create or replace function public.hse_audits_readiness()
returns trigger language plpgsql set search_path = public as $$
declare r jsonb; v_issues jsonb; v_msg text;
begin
  if coalesce(current_setting('hse.reopening', true), '') = 'on' then return new; end if;
  -- la revisión sólo la fija hse_review_audit; se pierde si la auditoría vuelve a ejecución
  if coalesce(current_setting('hse.reviewing', true), '') <> 'on' then
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_notes := old.review_notes;
  end if;
  if new.status in ('planificada','en_curso') and old.status not in ('planificada','en_curso') then
    new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null;
  end if;
  if new.status is distinct from old.status and new.status in ('completada','cerrada') then
    r := hse_audit_readiness(new.id, new.status::text);
    v_issues := r -> 'issues';
    if new.status = 'cerrada' and coalesce(btrim(new.summary), '') <> '' then      -- el resumen puede venir en la misma operación
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_issues from jsonb_array_elements(v_issues) x where x ->> 'code' <> 'sin_resumen';
    end if;
    if new.status = 'cerrada' then
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_issues from jsonb_array_elements(v_issues) x where x ->> 'code' <> 'no_completada';
    end if;
    if jsonb_array_length(v_issues) > 0 then
      select string_agg(x ->> 'message', ' | ') into v_msg from (select x from jsonb_array_elements(v_issues) x limit 5) q;
      raise exception 'No se puede marcar como %: % (% pendiente/s)', new.status, v_msg, jsonb_array_length(v_issues)
        using errcode = 'HS422', detail = v_issues::text;
    end if;
  end if;
  return new;
end $$;
create trigger hse_audits_readiness before update on public.hse_audits
  for each row execute function public.hse_audits_readiness();

-- revisión de la auditoría completada (independiente del auditor líder)
create or replace function public.hse_review_audit(p_audit uuid, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare a record;
begin
  select * into a from hse_audits where id = p_audit for update;
  if a.id is null or not hse_has_role(a.organization_id, '{owner,admin,supervisor}') then
    raise exception 'La revisión corresponde a Coordinación HSE o Administración' using errcode = '42501';
  end if;
  if a.status <> 'completada' then raise exception 'Sólo se revisa una auditoría completada' using errcode = 'HS422'; end if;
  if a.lead_auditor_id = auth.uid() then
    raise exception 'La revisión debe hacerla alguien distinto del auditor líder' using errcode = '42501';
  end if;
  perform set_config('hse.reviewing', 'on', true);
  update hse_audits set reviewed_by = auth.uid(), reviewed_at = now(), review_notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_audit;
  perform set_config('hse.reviewing', 'off', true);
end $$;

-- ---------------------------------------------------------------- notificaciones de vencimiento
create table if not exists public.hse_notifications (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  user_id          uuid not null references auth.users(id) on delete cascade,
  kind             text not null check (kind in ('accion_por_vencer','accion_vencida','verificacion_pendiente','hallazgo_vencido')),
  entity_table     text not null check (entity_table in ('hse_actions','hse_findings')),
  entity_id        uuid not null,
  due_date         date not null,
  title            text not null,
  body             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  read_at          timestamptz,
  resolved_at      timestamptz,
  unique (user_id, kind, entity_id, due_date)
);
create index if not exists hse_notifications_user_idx on public.hse_notifications (user_id, created_at desc);
create index if not exists hse_notifications_org_idx on public.hse_notifications (organization_id, updated_at);
create index if not exists hse_notifications_entity_idx on public.hse_notifications (entity_id);
alter table public.hse_notifications enable row level security;
alter table public.hse_notifications force row level security;
revoke all on public.hse_notifications from anon, authenticated;
grant select on public.hse_notifications to authenticated;
grant update (read_at) on public.hse_notifications to authenticated;
create policy hse_notifications_select on public.hse_notifications for select to authenticated
  using (user_id = auth.uid() and public.hse_is_member(organization_id));
create policy hse_notifications_update on public.hse_notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create or replace function public.hse_notifications_touch()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger hse_notifications_touch before update on public.hse_notifications
  for each row execute function public.hse_notifications_touch();

create or replace function public.hse_build_notifications(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; k int;
begin
  -- resolver las que ya no aplican
  update hse_notifications nt set resolved_at = now()
   where nt.organization_id = p_org and nt.resolved_at is null and (
     (nt.kind in ('accion_por_vencer','accion_vencida') and not exists (
        select 1 from hse_actions x where x.id = nt.entity_id and x.deleted_at is null and x.status in ('pendiente','en_curso')))
     or (nt.kind = 'verificacion_pendiente' and not exists (
        select 1 from hse_actions x where x.id = nt.entity_id and x.deleted_at is null and x.status = 'completada'))
     or (nt.kind = 'hallazgo_vencido' and not exists (
        select 1 from hse_findings f where f.id = nt.entity_id and f.deleted_at is null and f.status in ('abierto','en_tratamiento'))));

  -- acciones por vencer (7 días) y vencidas
  with src as (
    select x.organization_id, x.id, x.due_date, x.description, x.responsible_user_id, x.responsible_company_id,
           f.code fcode, a.lead_auditor_id,
           case when x.due_date < current_date then 'accion_vencida' else 'accion_por_vencer' end kind
    from hse_actions x join hse_findings f on f.id = x.finding_id join hse_audits a on a.id = f.audit_id
    where x.organization_id = p_org and x.deleted_at is null and f.deleted_at is null
      and x.status in ('pendiente','en_curso') and x.due_date <= current_date + 7
  ), rc as (
    select s.*, u.user_id from src s cross join lateral (
      select s.responsible_user_id as user_id
      union select m.user_id from hse_memberships m
        where m.organization_id = s.organization_id and m.active and m.role = 'contractor'
          and s.responsible_company_id is not null and m.company_id = s.responsible_company_id
      union select s.lead_auditor_id where s.kind = 'accion_vencida'
      union select m.user_id from hse_memberships m
        where m.organization_id = s.organization_id and m.active and m.role = 'supervisor' and s.kind = 'accion_vencida'
    ) u
  )
  insert into hse_notifications (organization_id, user_id, kind, entity_table, entity_id, due_date, title, body)
  select organization_id, user_id, kind, 'hse_actions', id, due_date,
         (case kind when 'accion_vencida' then 'Acción vencida' else 'Acción por vencer' end) || coalesce(' · ' || fcode, ''),
         left(description, 300)
  from rc where user_id is not null and hse_is_org_user(organization_id, user_id)
  on conflict (user_id, kind, entity_id, due_date) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- acciones completadas que esperan verificación de eficacia: líder y coordinación
  with src as (
    select x.organization_id, x.id, coalesce(x.completed_at, x.updated_at)::date d, x.description, f.code fcode, a.lead_auditor_id
    from hse_actions x join hse_findings f on f.id = x.finding_id join hse_audits a on a.id = f.audit_id
    where x.organization_id = p_org and x.deleted_at is null and x.status = 'completada'
  ), rc as (
    select s.*, u.user_id from src s cross join lateral (
      select s.lead_auditor_id as user_id
      union select m.user_id from hse_memberships m where m.organization_id = s.organization_id and m.active and m.role = 'supervisor'
    ) u
  )
  insert into hse_notifications (organization_id, user_id, kind, entity_table, entity_id, due_date, title, body)
  select organization_id, user_id, 'verificacion_pendiente', 'hse_actions', id, d,
         'Verificar eficacia' || coalesce(' · ' || fcode, ''), left(description, 300)
  from rc where user_id is not null and hse_is_org_user(organization_id, user_id)
  on conflict (user_id, kind, entity_id, due_date) do nothing;
  get diagnostics k = row_count; n := n + k;

  -- hallazgos vencidos sin cerrar: responsable y líder
  with src as (
    select f.organization_id, f.id, f.due_date, f.code, f.title, f.responsible_user_id, a.lead_auditor_id
    from hse_findings f join hse_audits a on a.id = f.audit_id
    where f.organization_id = p_org and f.deleted_at is null and f.status in ('abierto','en_tratamiento')
      and f.due_date is not null and f.due_date < current_date
  ), rc as (
    select s.*, u.user_id from src s cross join lateral (
      select s.responsible_user_id as user_id union select s.lead_auditor_id) u
  )
  insert into hse_notifications (organization_id, user_id, kind, entity_table, entity_id, due_date, title, body)
  select organization_id, user_id, 'hallazgo_vencido', 'hse_findings', id, due_date,
         'Hallazgo vencido' || coalesce(' · ' || code, ''), left(title, 300)
  from rc where user_id is not null and hse_is_org_user(organization_id, user_id)
  on conflict (user_id, kind, entity_id, due_date) do nothing;
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;

-- cualquier miembro puede pedir que se actualicen (idempotente); el cliente lo hace al sincronizar
create or replace function public.hse_refresh_notifications(p_org uuid)
returns int language plpgsql security definer set search_path = public as $$
begin
  if not hse_is_member(p_org) then raise exception 'Sin acceso a la organización' using errcode = '42501'; end if;
  return hse_build_notifications(p_org);
end $$;

-- ejecución diaria para todas las organizaciones (sólo servidor / pg_cron)
create or replace function public.hse_refresh_all_notifications()
returns int language plpgsql security definer set search_path = public as $$
declare o record; n int := 0;
begin
  for o in select id from hse_organizations loop n := n + hse_build_notifications(o.id); end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- historial por registro
create or replace function public.hse_record_history(p_table text, p_id uuid)
returns table (changed_at timestamptz, action text, changed_fields text[], old_data jsonb, new_data jsonb, user_name text)
language plpgsql stable security definer set search_path = public as $$
declare v_ok boolean;
begin
  v_ok := case p_table
    when 'hse_audits' then hse_audit_role(p_id) is not null
    when 'hse_findings' then hse_finding_role(p_id) is not null
    when 'hse_actions' then hse_action_role(p_id) is not null
    when 'hse_audit_responses' then (select hse_audit_role(r.audit_id) from hse_audit_responses r where r.id = p_id) is not null
    when 'hse_evidences' then (select hse_audit_role(e.audit_id) is not null
                                      or (e.action_id is not null and hse_action_role(e.action_id) is not null)
                               from hse_evidences e where e.id = p_id)
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Sin acceso al registro' using errcode = '42501'; end if;
  return query
    select l.changed_at, l.action, l.changed_fields,
           l.old_data - array['row_version','updated_at','client_updated_at'],
           l.new_data - array['row_version','updated_at','client_updated_at'],
           case when l.user_id is null then 'Sistema'
                when hse_profile_visible(l.user_id) then coalesce(p.full_name, p.email)
                else 'Usuario de la organización' end
    from hse_change_log l left join hse_profiles p on p.id = l.user_id
    where l.table_name = p_table and l.record_id = p_id
    order by l.changed_at, l.id;
end $$;

-- ---------------------------------------------------------------- nueva versión: conserva la obligatoriedad
create or replace function public.hse_new_template_version(p_template uuid, p_from_version uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t record; src record; v_new uuid; s record; v_sec uuid; m jsonb := '{}'::jsonb; ms jsonb := '{}'::jsonb; i record; v_item uuid;
begin
  select * into t from hse_templates where id = p_template;
  if t.id is null or not hse_has_role(t.organization_id, '{owner,admin,supervisor}') then
    raise exception 'Sin permiso sobre la plantilla' using errcode = '42501';
  end if;
  if exists (select 1 from hse_template_versions where template_id = p_template and status = 'borrador' and deleted_at is null) then
    raise exception 'Ya existe un borrador para esta plantilla' using errcode = 'HS422';
  end if;
  select * into src from hse_template_versions
   where template_id = p_template and (p_from_version is null or id = p_from_version) and deleted_at is null
   order by version_number desc limit 1;

  insert into hse_template_versions (organization_id, template_id, version_number, change_notes,
                                     scoring_method, scoring_config, validation_status, source_file_name, source_sha256, import_report)
  values (t.organization_id, p_template,
          coalesce((select max(version_number) from hse_template_versions where template_id = p_template), 0) + 1,
          case when src.id is not null then 'Basada en la versión ' || src.version_number end,
          coalesce(src.scoring_method, 'ponderado'), coalesce(src.scoring_config, '{}'::jsonb),
          case when coalesce(src.scoring_method, 'ponderado') = 'ponderado' then 'no_requerida' else 'pendiente' end,
          src.source_file_name, src.source_sha256, src.import_report)
  returning id into v_new;

  if src.id is not null then
    for s in select * from hse_template_sections where version_id = src.id and deleted_at is null order by sort_order loop
      insert into hse_template_sections (organization_id, version_id, title, description, sort_order, code, source_ref)
      values (t.organization_id, v_new, s.title, s.description, s.sort_order, s.code, s.source_ref) returning id into v_sec;
      ms := ms || jsonb_build_object(s.id::text, v_sec);
      for i in select * from hse_template_items where section_id = s.id and deleted_at is null order by sort_order loop
        insert into hse_template_items (organization_id, version_id, section_id, code, question, guidance, response_type,
          weight, is_critical, evidence_required_on_fail, is_required, legal_reference, sort_order, process_id, original_number, source_ref, review_flags)
        values (t.organization_id, v_new, v_sec, i.code, i.question, i.guidance, i.response_type, i.weight, i.is_critical,
          i.evidence_required_on_fail, i.is_required, i.legal_reference, i.sort_order, i.process_id, i.original_number, i.source_ref, i.review_flags)
        returning id into v_item;
        m := m || jsonb_build_object(i.id::text, v_item);
      end loop;
    end loop;
    insert into hse_template_validation_cases (organization_id, version_id, name, source_ref, answers, expected, tolerance)
    select t.organization_id, v_new, c.name, c.source_ref,
           coalesce((select jsonb_object_agg(m ->> a.key, a.value) from jsonb_each(c.answers) a where m ? a.key), '{}'::jsonb),
           jsonb_build_object('final', c.expected -> 'final',
             'sections', coalesce((select jsonb_object_agg(ms ->> e.key, e.value) from jsonb_each(c.expected -> 'sections') e where ms ? e.key), '{}'::jsonb)),
           c.tolerance
    from hse_template_validation_cases c where c.version_id = src.id and c.deleted_at is null;
  end if;
  return v_new;
end $$;

-- ---------------------------------------------------------------- columnas escribibles por sincronización
create or replace function public.hse_sync_writable_columns(p_table text)
returns text[] language sql immutable set search_path = public as $$
  select case p_table
    when 'hse_companies' then array['id','organization_id','name','tax_id','company_type','parent_company_id','contact_name','contact_email','contact_phone','csms_status','csms_valid_until','active','deleted_at','client_updated_at']
    when 'hse_locations' then array['id','organization_id','company_id','parent_location_id','name','location_type','address','latitude','longitude','active','deleted_at','client_updated_at']
    when 'hse_processes' then array['id','organization_id','name','sort_order','active','deleted_at','client_updated_at']
    when 'hse_templates' then array['id','organization_id','name','category','description','active','deleted_at','client_updated_at']
    when 'hse_template_versions' then array['id','organization_id','template_id','version_number','change_notes','scoring_method','scoring_config','deleted_at','client_updated_at']
    when 'hse_template_sections' then array['id','organization_id','version_id','title','description','sort_order','code','deleted_at','client_updated_at']
    when 'hse_template_items' then array['id','organization_id','version_id','section_id','code','question','guidance','response_type','weight','is_critical','evidence_required_on_fail','is_required','legal_reference','sort_order','process_id','deleted_at','client_updated_at']
    when 'hse_template_import_issues' then array['id','organization_id','status','resolution_note','client_updated_at']
    when 'hse_audits' then array['id','organization_id','template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','lead_auditor_id','audit_team','scope','summary','latitude','longitude','deleted_at','client_updated_at']
    when 'hse_audit_participants' then array['id','organization_id','audit_id','user_id','participant_role','deleted_at','client_updated_at']
    when 'hse_audit_responses' then array['id','organization_id','audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at']
    when 'hse_findings' then array['id','organization_id','audit_id','response_id','item_id','company_id','location_id','title','description','requirement','finding_type','severity','category','process_id','responsible_user_id','status','root_cause','rca_method','rca_data','immediate_action','legal_reference','detected_at','due_date','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_actions' then array['id','organization_id','finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','effectiveness_criteria','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_evidences' then array['id','organization_id','audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','deleted_at','client_updated_at']
    else null end;
$$;

-- ---------------------------------------------------------------- permisos de ejecución
do $$
declare f text;
begin
  foreach f in array array['hse_audit_readiness(uuid,text)','hse_review_audit(uuid,text)','hse_refresh_notifications(uuid)',
                           'hse_record_history(text,uuid)','hse_finding_recurrence_key(uuid,uuid)','hse_finding_role_row(uuid,uuid,uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['hse_build_notifications(uuid)','hse_refresh_all_notifications()',
                           'hse_findings_rules()','hse_actions_rules()','hse_audits_readiness()','hse_notifications_touch()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------- ejecución diaria (si pg_cron está instalado)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('hse-notificaciones-diarias', '15 9 * * *', 'select public.hse_refresh_all_notifications()');
  end if;
end $$;
