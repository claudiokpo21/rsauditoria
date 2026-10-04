-- =====================================================================
-- HSE Audit Manager · 0009 · Metodologías de puntuación versionadas,
-- procesos, importación de plantillas y validación previa a la publicación
--
-- Principios:
--  * Las reglas de puntuación viven en la versión de plantilla
--    (scoring_method + scoring_config) y quedan congeladas al publicar.
--  * Una versión importada nace con validation_status = 'pendiente'.
--    No puede publicarse hasta que: (a) no queden incidencias bloqueantes
--    pendientes, (b) todos los casos de validación reproduzcan el resultado
--    de origen y (c) un supervisor/admin la marque como validada.
--  * Un solo motor de cálculo (hse_evaluate_answers) sirve para auditorías
--    y para los casos de validación.
-- =====================================================================

-- ---------- Catálogo de procesos auditables ----------
create table public.hse_processes (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  name               text not null check (length(btrim(name)) between 1 and 120),
  sort_order         int not null default 0,
  active             boolean not null default true,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id)
);
create unique index hse_processes_name_uq on public.hse_processes (organization_id, lower(name)) where deleted_at is null;
create index hse_processes_sync_idx on public.hse_processes (organization_id, updated_at);
create trigger hse_processes_touch before insert or update on public.hse_processes
  for each row execute function public.hse_touch_row();

-- ---------- Metodología en la versión ----------
alter table public.hse_template_versions
  add column scoring_method    text not null default 'ponderado'
                               check (scoring_method in ('ponderado','situacion_promedio_secciones')),
  add column scoring_config    jsonb not null default '{}'::jsonb,
  add column validation_status text not null default 'no_requerida'
                               check (validation_status in ('no_requerida','pendiente','validada','rechazada')),
  add column validated_by      uuid references auth.users(id) on delete set null,
  add column validated_at      timestamptz,
  add column validation_notes  text,
  add column source_file_name  text,
  add column source_sha256     text check (source_sha256 is null or source_sha256 ~ '^[0-9a-f]{64}$'),
  add column import_report     jsonb;

alter table public.hse_template_sections
  add column code       text check (code is null or length(code) <= 30),
  add column source_ref text;

alter table public.hse_template_items
  add column process_id       uuid,
  add column original_number  text,           -- numeración tal cual figura en el origen
  add column source_ref       text,           -- p.ej. 'Table 1'!E16
  add column review_flags     text[] not null default '{}',
  add constraint hse_template_items_process_fk
    foreign key (organization_id, process_id) references public.hse_processes (organization_id, id);
create index hse_template_items_process_idx on public.hse_template_items (process_id) where process_id is not null;

-- (las opciones NC/OBS/OPM/OK/N/A se habilitan en hse_audit_responses en 0010)

alter table public.hse_audits
  add column section_results  jsonb,
  add column result_band      text,
  add column scoring_snapshot jsonb;

-- La metodología y su validación se congelan junto con el contenido
create or replace function public.hse_guard_version_methodology()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    -- toda metodología distinta de la ponderada estándar exige validación
    if new.scoring_method <> 'ponderado' or new.source_sha256 is not null then
      new.validation_status := 'pendiente';
    elsif new.validation_status not in ('no_requerida','pendiente') then
      new.validation_status := 'no_requerida';
    end if;
    new.validated_at := null; new.validated_by := null;
    return new;
  end if;
  if new.source_sha256 is distinct from old.source_sha256 or new.source_file_name is distinct from old.source_file_name then
    raise exception 'El origen de una versión importada no puede modificarse' using errcode = '42501';
  end if;
  if new.validation_status = 'no_requerida' and old.validation_status <> 'no_requerida' then
    raise exception 'No se puede eximir de validación a esta versión' using errcode = '42501';
  end if;
  if old.validation_status = 'no_requerida' and new.scoring_method <> 'ponderado' then
    new.validation_status := 'pendiente';
  end if;
  if old.status <> 'borrador' and (new.scoring_method is distinct from old.scoring_method
       or new.scoring_config is distinct from old.scoring_config
       or new.validation_status is distinct from old.validation_status) then
    raise exception 'La metodología de una versión publicada es inmutable' using errcode = '42501';
  end if;
  -- cambiar la metodología invalida una validación previa
  if old.status = 'borrador' and old.validation_status = 'validada'
     and (new.scoring_method is distinct from old.scoring_method or new.scoring_config is distinct from old.scoring_config)
     and new.validation_status = 'validada' then
    new.validation_status := 'pendiente'; new.validated_at := null; new.validated_by := null;
  end if;
  -- sólo hse_validate_template_version puede marcar 'validada'
  if new.validation_status = 'validada' and old.validation_status <> 'validada'
     and coalesce(current_setting('hse.validating', true), '') <> 'on' then
    raise exception 'Use hse_validate_template_version para validar' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger hse_template_versions_methodology before insert or update on public.hse_template_versions
  for each row execute function public.hse_guard_version_methodology();

-- Publicar sólo es posible desde hse_publish_template_version (que verifica
-- la validación); reemplaza la verificación de 0003 basada en published_at.
create or replace function public.hse_guard_version_status()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' and new.status <> 'borrador' then
    raise exception 'Las versiones nuevas se crean en borrador' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status = 'archivada' and new.status <> 'archivada' then
      raise exception 'Una versión archivada no puede reactivarse' using errcode = '42501';
    end if;
    if old.status = 'publicada' and new.status = 'borrador' then
      raise exception 'Una versión publicada no puede volver a borrador' using errcode = '42501';
    end if;
    if old.status <> 'borrador' and (new.version_number <> old.version_number or new.template_id <> old.template_id) then
      raise exception 'Versión publicada inmutable' using errcode = '42501';
    end if;
    if old.status = 'borrador' and new.status = 'publicada'
       and coalesce(current_setting('hse.publishing', true), '') <> 'on' then
      raise exception 'Use hse_publish_template_version para publicar' using errcode = '42501';
    end if;
    if old.status = 'borrador' and new.status = 'archivada' then
      raise exception 'Un borrador se descarta con borrado lógico, no se archiva' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- Editar contenido de un borrador validado vuelve a dejarlo pendiente
create or replace function public.hse_invalidate_on_content_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.version_id, old.version_id);
begin
  update hse_template_versions set validation_status = 'pendiente', validated_at = null, validated_by = null
  where id = v and status = 'borrador' and validation_status = 'validada';
  return coalesce(new, old);
end $$;
create trigger hse_template_items_invalidate after insert or update or delete on public.hse_template_items
  for each row execute function public.hse_invalidate_on_content_change();
create trigger hse_template_sections_invalidate after insert or update or delete on public.hse_template_sections
  for each row execute function public.hse_invalidate_on_content_change();

-- ---------- Incidencias de importación (revisión manual) ----------
create table public.hse_template_import_issues (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  version_id         uuid not null,
  item_id            uuid,
  issue_type         text not null check (issue_type in (
                       'numeracion_duplicada','numeracion_salto','sin_numeracion','proceso_faltante',
                       'proceso_no_utilizado','regla_inferida','formula_ambigua','formula_sin_efecto',
                       'limite_evaluacion','dato_ejecucion_excluido','dato_personal_excluido',
                       'texto_formato','diferencia_resultado','otro')),
  severity           text not null check (severity in ('info','advertencia','bloqueante')),
  source_ref         text,
  message            text not null,
  details            jsonb,
  status             text not null default 'pendiente' check (status in ('pendiente','aceptada','corregida','descartada')),
  resolution_note    text,
  resolved_by        uuid references auth.users(id) on delete set null,
  resolved_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, version_id) references public.hse_template_versions (organization_id, id) on delete cascade,
  foreign key (organization_id, item_id) references public.hse_template_items (organization_id, id) on delete set null (item_id),
  check (status = 'pendiente' or resolution_note is not null)
);
create index hse_import_issues_version_idx on public.hse_template_import_issues (version_id, status);
create index hse_import_issues_item_idx on public.hse_template_import_issues (item_id) where item_id is not null;
create index hse_import_issues_sync_idx on public.hse_template_import_issues (organization_id, updated_at);
create trigger hse_import_issues_touch before insert or update on public.hse_template_import_issues
  for each row execute function public.hse_touch_row();

create or replace function public.hse_guard_import_issue()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if new.version_id <> old.version_id or new.issue_type <> old.issue_type or new.message <> old.message then
      raise exception 'Sólo puede cambiarse el estado y la resolución de una incidencia' using errcode = '42501';
    end if;
    if new.status <> old.status then
      if new.status = 'pendiente' then
        new.resolved_by := null; new.resolved_at := null;
      else
        new.resolved_by := auth.uid(); new.resolved_at := now();
      end if;
      update public.hse_template_versions set validation_status = 'pendiente', validated_at = null, validated_by = null
      where id = new.version_id and status = 'borrador' and validation_status = 'validada';
    end if;
  end if;
  return new;
end $$;
create trigger hse_import_issues_guard before update on public.hse_template_import_issues
  for each row execute function public.hse_guard_import_issue();

-- ---------- Casos de validación ----------
-- Contienen SÓLO el vector de situaciones por ítem y los resultados esperados
-- del archivo de origen. No tienen relación con auditorías ni se usan como
-- valores predeterminados; sirven para demostrar que el motor reproduce
-- las fórmulas originales.
create table public.hse_template_validation_cases (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  version_id         uuid not null,
  name               text not null,
  source_ref         text,
  answers            jsonb not null,   -- { "<item_id>": "ok" | "obs" | ... }
  expected           jsonb not null,   -- { sections: { "<section_id>": {raw,target,score} }, final: n }
  computed           jsonb,
  matches            boolean,
  max_abs_diff       numeric,
  tolerance          numeric not null default 0.000001,
  last_run_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  unique (organization_id, id),
  foreign key (organization_id, version_id) references public.hse_template_versions (organization_id, id) on delete cascade,
  check (jsonb_typeof(answers) = 'object' and jsonb_typeof(expected) = 'object')
);
create index hse_validation_cases_version_idx on public.hse_template_validation_cases (version_id);
create index hse_validation_cases_sync_idx on public.hse_template_validation_cases (organization_id, updated_at);
create trigger hse_validation_cases_touch before insert or update on public.hse_template_validation_cases
  for each row execute function public.hse_touch_row();

-- ---------- Motor de cálculo único ----------
-- p_answers: { item_id: answer_code }  (ítems ausentes = sin responder)
-- Devuelve: { method, score, max_score, compliance_pct, critical_failures,
--             final, band, sections: [ {section_id, title, raw, target, score, items, answered, na} ] }
create or replace function public.hse_evaluate_answers(p_version uuid, p_answers jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v       record;
  cfg     jsonb;
  maxpts  numeric;
  scale   numeric;
  na_mode text;
  un_mode text;
  res     jsonb;
  final   numeric;
  band    text;
begin
  select tv.scoring_method, tv.scoring_config into v from hse_template_versions tv where tv.id = p_version;
  if not found then raise exception 'Versión inexistente' using errcode = 'P0002'; end if;
  cfg := coalesce(v.scoring_config, '{}'::jsonb);

  if v.scoring_method = 'situacion_promedio_secciones' then
    maxpts  := (cfg ->> 'max_points_per_item')::numeric;
    scale   := (cfg ->> 'scale_max')::numeric;
    na_mode := cfg ->> 'na_mode';
    un_mode := cfg ->> 'unanswered_mode';
    if maxpts is null or maxpts <= 0 or scale is null or na_mode is null or un_mode is null
       or jsonb_typeof(cfg -> 'options') <> 'array' then
      raise exception 'scoring_config incompleta para situacion_promedio_secciones' using errcode = '22023';
    end if;

    with it as (
      select i.id, i.section_id, s.title, s.sort_order, nullif(p_answers ->> i.id::text, '') as ans
      from hse_template_items i join hse_template_sections s on s.id = i.section_id
      where i.version_id = p_version and i.deleted_at is null and s.deleted_at is null
    ), pts as (
      select it.*,
             (select (o ->> 'points')::numeric from jsonb_array_elements(cfg -> 'options') o where o ->> 'code' = it.ans) as points,
             case
               when it.ans is null then un_mode = 'contar_cero'
               when it.ans = 'na'  then na_mode = 'contar_cero'
               else true end as counted
      from it
    ), sec as (
      select section_id, min(title) title, min(sort_order) so,
             coalesce(sum(case when counted then coalesce(points,0) else 0 end), 0) raw,
             count(*) filter (where counted) * maxpts target,
             count(*) items,
             count(*) filter (where ans is not null) answered,
             count(*) filter (where ans = 'na') na
      from pts group by section_id
    )
    select jsonb_agg(jsonb_build_object(
             'section_id', section_id, 'title', title, 'raw', raw, 'target', target,
             'score', case when target > 0 then raw / target * scale end,
             'items', items, 'answered', answered, 'na', na) order by so),
           avg(case when target > 0 then raw / target * scale end)
      into res, final
    from sec;

    -- banda: primera cuyo [min,max] contenga el valor, SIN redondear (como el formato condicional)
    select b ->> 'label' into band
    from jsonb_array_elements(cfg -> 'bands') with ordinality as t(b, ord)
    where final is not null
      and (b ->> 'min' is null or final >= (b ->> 'min')::numeric)
      and (b ->> 'max' is null or final <= (b ->> 'max')::numeric)
    order by ord limit 1;

    return jsonb_build_object(
      'method', v.scoring_method,
      'final', final,
      'score', round(final, 2),
      'max_score', scale,
      'compliance_pct', case when final is not null then round(final / scale * 100, 2) end,
      'critical_failures', (select count(*) from hse_template_items i
                            where i.version_id = p_version and i.deleted_at is null and i.is_critical
                              and p_answers ->> i.id::text = 'nc'),
      'band', case when final is null then null else coalesce(band, 'sin_clasificar') end,
      'sections', coalesce(res, '[]'::jsonb));
  end if;

  -- Método 'ponderado' (genérico de la plataforma): cumple/si = peso; no_cumple/no = 0;
  -- no_aplica y sin responder quedan fuera del máximo. Otros tipos no puntúan.
  with r as (
    select i.response_type, i.weight, i.is_critical, i.section_id,
           p_answers ->> i.id::text as answer
    from hse_template_items i where i.version_id = p_version and i.deleted_at is null
  ), agg as (
    select
      coalesce(sum(case when response_type in ('cumplimiento','si_no') and answer in ('cumple','si') then weight else 0 end), 0) s,
      coalesce(sum(case when response_type in ('cumplimiento','si_no') and answer in ('cumple','si','no_cumple','no') then weight else 0 end), 0) m,
      count(*) filter (where is_critical and answer in ('no_cumple','no')) c
    from r
  )
  select jsonb_build_object('method', 'ponderado', 'score', s, 'max_score', m,
           'compliance_pct', case when m > 0 then round(100 * s / m, 2) end,
           'final', case when m > 0 then 100 * s / m end,
           'critical_failures', c, 'band', null, 'sections', '[]'::jsonb)
    into res from agg;
  return res;
end $$;
revoke all on function public.hse_evaluate_answers(uuid, jsonb) from public, anon;
grant execute on function public.hse_evaluate_answers(uuid, jsonb) to authenticated;

create or replace function public.hse_audit_answers(p_audit uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(x.item_id::text, x.answer), '{}'::jsonb)
  from hse_audit_responses x where x.audit_id = p_audit and x.deleted_at is null and x.answer is not null;
$$;

-- Reemplaza el cálculo provisorio de 0004 por el motor único.
-- hse_compute_audit_score queda obsoleta (sin uso) y se conserva por compatibilidad.
comment on function public.hse_compute_audit_score(uuid) is 'Obsoleta: usar hse_evaluate_answers';

create or replace function public.hse_apply_audit_score()
returns trigger language plpgsql set search_path = public as $$
declare r jsonb;
begin
  if new.status in ('completada','cerrada') and (tg_op = 'INSERT' or old.status not in ('completada','cerrada')) then
    r := hse_evaluate_answers(new.template_version_id, hse_audit_answers(new.id));
    new.score := (r ->> 'score')::numeric;
    new.max_score := (r ->> 'max_score')::numeric;
    new.compliance_pct := (r ->> 'compliance_pct')::numeric;
    new.critical_failures := coalesce((r ->> 'critical_failures')::int, 0);
    new.section_results := r -> 'sections';
    new.result_band := r ->> 'band';
    new.scoring_snapshot := (select jsonb_build_object('method', tv.scoring_method, 'config', tv.scoring_config,
                                    'version_id', tv.id, 'version_number', tv.version_number, 'computed_at', now())
                             from hse_template_versions tv where tv.id = new.template_version_id);
  end if;
  return new;
end $$;
-- (el trigger hse_audits_score de 0004 ya apunta a esta función)

-- ---------- RLS de las tablas nuevas ----------
alter table public.hse_processes enable row level security;
alter table public.hse_processes force row level security;
alter table public.hse_template_import_issues enable row level security;
alter table public.hse_template_import_issues force row level security;
alter table public.hse_template_validation_cases enable row level security;
alter table public.hse_template_validation_cases force row level security;
revoke all on public.hse_processes, public.hse_template_import_issues, public.hse_template_validation_cases from anon;

create policy hse_processes_select on public.hse_processes for select to authenticated
  using (public.hse_is_member(organization_id));
create policy hse_processes_write on public.hse_processes for all to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));

create policy hse_import_issues_select on public.hse_template_import_issues for select to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'));
create policy hse_import_issues_update on public.hse_template_import_issues for update to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'))
  with check (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
-- inserción sólo vía hse_import_template (SECURITY DEFINER)

create policy hse_validation_cases_select on public.hse_template_validation_cases for select to authenticated
  using (public.hse_has_role(organization_id, '{owner,admin,supervisor}'));
-- escritura sólo vía RPC

create trigger hse_processes_log after insert or update or delete on public.hse_processes
  for each row execute function public.hse_log_change();
create trigger hse_import_issues_log after update on public.hse_template_import_issues
  for each row execute function public.hse_log_change();
