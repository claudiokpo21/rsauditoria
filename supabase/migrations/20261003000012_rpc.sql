-- =====================================================================
-- HSE Audit Manager · 0012 · Funciones RPC
-- Las operaciones que cruzan varias tablas o requieren privilegios se
-- exponen como funciones transaccionales que validan el rol del llamador.
-- =====================================================================

-- ---------- Arranque de sesión: perfil + aceptación de invitaciones ----------
create or replace function public.hse_bootstrap()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text; v_confirmed timestamptz; v_name text;
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  select u.email, u.email_confirmed_at, u.raw_user_meta_data ->> 'full_name'
    into v_email, v_confirmed, v_name from auth.users u where u.id = v_uid;

  insert into hse_profiles (id, email, full_name) values (v_uid, coalesce(v_email, ''), v_name)
  on conflict (id) do update set email = excluded.email;

  -- sólo se aceptan invitaciones para correos verificados
  if v_confirmed is not null and v_email is not null then
    insert into hse_memberships (organization_id, user_id, role, company_id)
    select i.organization_id, v_uid, i.role, i.company_id
    from hse_invitations i
    where lower(i.email) = lower(v_email) and i.accepted_at is null and i.expires_at > now()
    on conflict (organization_id, user_id) do nothing;

    update hse_invitations set accepted_at = now(), accepted_by = v_uid
    where lower(email) = lower(v_email) and accepted_at is null and expires_at > now();
  end if;

  return jsonb_build_object(
    'profile', (select to_jsonb(p) from hse_profiles p where p.id = v_uid),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
               'organization_id', m.organization_id, 'organization_name', o.name,
               'role', m.role, 'company_id', m.company_id) order by o.name)
      from hse_memberships m join hse_organizations o on o.id = m.organization_id
      where m.user_id = v_uid and m.active), '[]'::jsonb));
end $$;

-- ---------- Alta de organización ----------
create or replace function public.hse_create_organization(p_name text, p_tax_id text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if (select count(*) from hse_memberships where user_id = v_uid and role = 'owner') >= 10 then
    raise exception 'Límite de organizaciones propias alcanzado' using errcode = 'HS422';
  end if;
  insert into hse_organizations (name, tax_id, created_by) values (btrim(p_name), nullif(btrim(p_tax_id), ''), v_uid)
  returning id into v_org;
  insert into hse_memberships (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  update hse_profiles set default_organization_id = coalesce(default_organization_id, v_org) where id = v_uid;
  return v_org;
end $$;

-- ---------- Invitación de miembros ----------
create or replace function public.hse_invite_member(p_org uuid, p_email text, p_role public.hse_role, p_company uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_user uuid; v_email text := lower(btrim(p_email));
begin
  if not hse_has_role(p_org, '{owner,admin}') then
    raise exception 'Sólo administradores invitan miembros' using errcode = '42501';
  end if;
  if p_role = 'owner' and not hse_has_role(p_org, '{owner}') then
    raise exception 'Sólo un propietario puede designar propietarios' using errcode = '42501';
  end if;
  if p_role = 'contractor' and p_company is null then
    raise exception 'El rol contratista requiere una empresa' using errcode = '23502';
  end if;
  if p_company is not null and not exists (select 1 from hse_companies where id = p_company and organization_id = p_org) then
    raise exception 'Empresa inexistente en la organización' using errcode = '23503';
  end if;

  select id into v_user from auth.users where lower(email) = v_email and email_confirmed_at is not null;
  if v_user is not null then
    insert into hse_memberships (organization_id, user_id, role, company_id)
    values (p_org, v_user, p_role, p_company)
    on conflict (organization_id, user_id) do update set role = excluded.role, company_id = excluded.company_id, active = true;
    return jsonb_build_object('status', 'agregado', 'user_id', v_user);
  end if;

  if p_role = 'owner' then
    raise exception 'Invite primero como administrador; el rol propietario se asigna a usuarios existentes' using errcode = 'HS422';
  end if;
  insert into hse_invitations (organization_id, email, role, company_id)
  values (p_org, v_email, p_role, p_company)
  on conflict (organization_id, lower(email)) where accepted_at is null
  do update set role = excluded.role, company_id = excluded.company_id, expires_at = now() + interval '14 days';
  return jsonb_build_object('status', 'invitado', 'email', v_email);
end $$;

-- ---------- Casos de validación ----------
create or replace function public.hse_run_validation_cases(p_version uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid; c record; r jsonb; v_diff numeric; v_match boolean; v_out jsonb := '[]'::jsonb;
begin
  select organization_id into v_org from hse_template_versions where id = p_version;
  if v_org is null or not hse_has_role(v_org, '{owner,admin,supervisor}') then
    raise exception 'Sin permiso sobre la versión' using errcode = '42501';
  end if;
  for c in select * from hse_template_validation_cases where version_id = p_version and deleted_at is null loop
    r := hse_evaluate_answers(p_version, c.answers);
    -- diferencia máxima entre esperado y calculado (secciones: raw, target, score; y final)
    select max(d) into v_diff from (
      select abs(coalesce((e.value ->> 'raw')::numeric, 0) - coalesce((s ->> 'raw')::numeric, 1e9)) d
        from jsonb_each(c.expected -> 'sections') e
        left join lateral (select x from jsonb_array_elements(r -> 'sections') x where x ->> 'section_id' = e.key) z(s) on true
      union all
      select abs(coalesce((e.value ->> 'target')::numeric, 0) - coalesce((s ->> 'target')::numeric, 1e9))
        from jsonb_each(c.expected -> 'sections') e
        left join lateral (select x from jsonb_array_elements(r -> 'sections') x where x ->> 'section_id' = e.key) z(s) on true
      union all
      select abs(coalesce((e.value ->> 'score')::numeric, 0) - coalesce((s ->> 'score')::numeric, 1e9))
        from jsonb_each(c.expected -> 'sections') e
        left join lateral (select x from jsonb_array_elements(r -> 'sections') x where x ->> 'section_id' = e.key) z(s) on true
      union all
      select abs((c.expected ->> 'final')::numeric - coalesce((r ->> 'final')::numeric, 1e9))
        where c.expected ? 'final'
    ) q;
    v_match := v_diff is not null and v_diff <= c.tolerance
               and jsonb_array_length(r -> 'sections') = (select count(*) from jsonb_object_keys(c.expected -> 'sections'));
    update hse_template_validation_cases
       set computed = r, matches = v_match, max_abs_diff = v_diff, last_run_at = now()
     where id = c.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('case_id', c.id, 'name', c.name, 'matches', v_match,
                                                       'max_abs_diff', v_diff, 'computed', r, 'expected', c.expected));
  end loop;
  return v_out;
end $$;

-- ---------- Validación de una versión ----------
create or replace function public.hse_validate_template_version(p_version uuid, p_notes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; v_runs jsonb; v_pending int; v_failed int;
begin
  select * into v from hse_template_versions where id = p_version for update;
  if v.id is null or not hse_has_role(v.organization_id, '{owner,admin,supervisor}') then
    raise exception 'Sin permiso sobre la versión' using errcode = '42501';
  end if;
  if v.status <> 'borrador' then raise exception 'Sólo se valida un borrador' using errcode = 'HS422'; end if;
  if coalesce(btrim(p_notes), '') = '' then
    raise exception 'Indique el fundamento de la validación' using errcode = 'HS422';
  end if;
  select count(*) into v_pending from hse_template_import_issues
   where version_id = p_version and deleted_at is null and status = 'pendiente' and severity in ('bloqueante','advertencia');
  if v_pending > 0 then
    raise exception 'Quedan % incidencias de importación sin revisar', v_pending using errcode = 'HS422';
  end if;
  v_runs := hse_run_validation_cases(p_version);
  if v.scoring_method <> 'ponderado' and jsonb_array_length(v_runs) = 0 then
    raise exception 'La metodología requiere al menos un caso de validación' using errcode = 'HS422';
  end if;
  select count(*) into v_failed from jsonb_array_elements(v_runs) x where not coalesce((x ->> 'matches')::boolean, false);
  if v_failed > 0 then
    raise exception '% caso(s) de validación no reproducen el resultado de origen', v_failed using errcode = 'HS422';
  end if;
  perform set_config('hse.validating', 'on', true);
  update hse_template_versions
     set validation_status = 'validada', validated_by = auth.uid(), validated_at = now(), validation_notes = btrim(p_notes)
   where id = p_version;
  perform set_config('hse.validating', 'off', true);
  return jsonb_build_object('validated', true, 'cases', v_runs);
end $$;

-- ---------- Publicación ----------
create or replace function public.hse_publish_template_version(p_version uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select * into v from hse_template_versions where id = p_version for update;
  if v.id is null or not hse_has_role(v.organization_id, '{owner,admin,supervisor}') then
    raise exception 'Sin permiso para publicar' using errcode = '42501';
  end if;
  if v.status <> 'borrador' then raise exception 'La versión no está en borrador' using errcode = 'HS422'; end if;
  if v.validation_status not in ('no_requerida','validada') then
    raise exception 'La versión debe validarse antes de publicarse (estado: %)', v.validation_status using errcode = 'HS422';
  end if;
  if exists (select 1 from hse_template_import_issues where version_id = p_version and deleted_at is null
             and status = 'pendiente' and severity = 'bloqueante') then
    raise exception 'Hay incidencias bloqueantes pendientes' using errcode = 'HS422';
  end if;
  if not exists (select 1 from hse_template_items where version_id = p_version and deleted_at is null) then
    raise exception 'La versión no tiene ítems' using errcode = 'HS422';
  end if;
  update hse_template_versions set status = 'archivada'
   where template_id = v.template_id and status = 'publicada' and id <> p_version;
  perform set_config('hse.publishing', 'on', true);
  update hse_template_versions set status = 'publicada', published_at = now(), published_by = auth.uid()
   where id = p_version;
  perform set_config('hse.publishing', 'off', true);
end $$;

-- ---------- Nueva versión a partir de otra ----------
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
          weight, is_critical, evidence_required_on_fail, legal_reference, sort_order, process_id, original_number, source_ref, review_flags)
        values (t.organization_id, v_new, v_sec, i.code, i.question, i.guidance, i.response_type, i.weight, i.is_critical,
          i.evidence_required_on_fail, i.legal_reference, i.sort_order, i.process_id, i.original_number, i.source_ref, i.review_flags)
        returning id into v_item;
        m := m || jsonb_build_object(i.id::text, v_item);
      end loop;
    end loop;
    -- los casos de validación se trasladan re-mapeando ítems y secciones
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

-- ---------- Importación de plantilla (atómica) ----------
-- Recibe la estructura ya analizada por el importador del cliente. El servidor
-- vuelve a validar la forma, crea procesos, secciones, ítems, incidencias y
-- casos de validación, y deja la versión en borrador con validación pendiente.
create or replace function public.hse_import_template(p_org uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_tpl uuid := nullif(p_payload #>> '{template,id}', '')::uuid;
  v_ver uuid; v_sec uuid; v_item uuid; v_proc uuid;
  s jsonb; it jsonb; iss jsonb; vc jsonb; pname text;
  keymap jsonb := '{}'::jsonb; secmap jsonb := '{}'::jsonb; procmap jsonb := '{}'::jsonb;
  n_items int := 0; n_secs int := 0; n_issues int := 0; n_cases int := 0;
  v_runs jsonb;
begin
  if not hse_has_role(p_org, '{owner,admin,supervisor}') then
    raise exception 'Sin permiso para importar plantillas' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload -> 'sections') <> 'array' or jsonb_array_length(p_payload -> 'sections') = 0 then
    raise exception 'La importación no contiene secciones' using errcode = '22023';
  end if;
  if (p_payload #>> '{version,scoring_method}') not in ('ponderado','situacion_promedio_secciones') then
    raise exception 'Método de puntuación desconocido' using errcode = '22023';
  end if;

  if v_tpl is null then
    insert into hse_templates (organization_id, name, category, description)
    values (p_org, p_payload #>> '{template,name}', (p_payload #>> '{template,category}')::hse_template_category,
            p_payload #>> '{template,description}')
    returning id into v_tpl;
  elsif not exists (select 1 from hse_templates where id = v_tpl and organization_id = p_org) then
    raise exception 'Plantilla inexistente en la organización' using errcode = '23503';
  end if;
  if exists (select 1 from hse_template_versions where template_id = v_tpl and status = 'borrador' and deleted_at is null) then
    raise exception 'La plantilla ya tiene un borrador; publíquelo o descártelo antes de importar' using errcode = 'HS422';
  end if;

  insert into hse_template_versions (organization_id, template_id, version_number, change_notes, scoring_method,
                                     scoring_config, validation_status, source_file_name, source_sha256, import_report)
  values (p_org, v_tpl,
          coalesce((select max(version_number) from hse_template_versions where template_id = v_tpl), 0) + 1,
          p_payload #>> '{version,change_notes}', p_payload #>> '{version,scoring_method}',
          coalesce(p_payload #> '{version,scoring_config}', '{}'::jsonb), 'pendiente',
          p_payload #>> '{version,source_file_name}', p_payload #>> '{version,source_sha256}',
          p_payload #> '{version,import_report}')
  returning id into v_ver;

  -- procesos (catálogo de la organización; se reutilizan por nombre)
  for pname in select jsonb_array_elements_text(coalesce(p_payload -> 'processes', '[]'::jsonb)) loop
    select id into v_proc from hse_processes
     where organization_id = p_org and lower(name) = lower(btrim(pname)) and deleted_at is null;
    if v_proc is null then
      insert into hse_processes (organization_id, name, sort_order)
      values (p_org, btrim(pname), (select count(*) from hse_processes where organization_id = p_org))
      returning id into v_proc;
    end if;
    procmap := procmap || jsonb_build_object(lower(btrim(pname)), v_proc);
  end loop;

  for s in select * from jsonb_array_elements(p_payload -> 'sections') loop
    insert into hse_template_sections (organization_id, version_id, title, description, sort_order, code, source_ref)
    values (p_org, v_ver, s ->> 'title', s ->> 'description', coalesce((s ->> 'sort_order')::int, n_secs), s ->> 'code', s ->> 'source_ref')
    returning id into v_sec;
    secmap := secmap || jsonb_build_object(s ->> 'key', v_sec);
    n_secs := n_secs + 1;
    for it in select * from jsonb_array_elements(coalesce(s -> 'items', '[]'::jsonb)) loop
      insert into hse_template_items (organization_id, version_id, section_id, code, question, guidance, response_type,
        weight, is_critical, evidence_required_on_fail, legal_reference, sort_order, process_id, original_number, source_ref, review_flags)
      values (p_org, v_ver, v_sec, it ->> 'code', it ->> 'question', it ->> 'guidance',
        coalesce(it ->> 'response_type', 'cumplimiento')::hse_response_type,
        coalesce((it ->> 'weight')::numeric, 1), coalesce((it ->> 'is_critical')::boolean, false),
        coalesce((it ->> 'evidence_required_on_fail')::boolean, true), it ->> 'legal_reference',
        coalesce((it ->> 'sort_order')::int, n_items),
        case when it ->> 'process' is not null then (procmap ->> lower(btrim(it ->> 'process')))::uuid end,
        it ->> 'original_number', it ->> 'source_ref',
        coalesce((select array_agg(x) from jsonb_array_elements_text(it -> 'review_flags') x), '{}'))
      returning id into v_item;
      keymap := keymap || jsonb_build_object(it ->> 'key', v_item);
      n_items := n_items + 1;
    end loop;
  end loop;

  for iss in select * from jsonb_array_elements(coalesce(p_payload -> 'issues', '[]'::jsonb)) loop
    insert into hse_template_import_issues (organization_id, version_id, item_id, issue_type, severity, source_ref, message, details)
    values (p_org, v_ver, (keymap ->> (iss ->> 'item_key'))::uuid, iss ->> 'issue_type', iss ->> 'severity',
            iss ->> 'source_ref', iss ->> 'message', iss -> 'details');
    n_issues := n_issues + 1;
  end loop;

  for vc in select * from jsonb_array_elements(coalesce(p_payload -> 'validation_cases', '[]'::jsonb)) loop
    -- sólo se aceptan códigos de opción; nunca texto libre del origen
    if exists (select 1 from jsonb_each(vc -> 'answers') a
               where jsonb_typeof(a.value) <> 'string' or a.value #>> '{}' not in ('nc','obs','opm','ok','na')) then
      raise exception 'Caso de validación con valores no permitidos' using errcode = '22023';
    end if;
    insert into hse_template_validation_cases (organization_id, version_id, name, source_ref, answers, expected)
    values (p_org, v_ver, vc ->> 'name', vc ->> 'source_ref',
      coalesce((select jsonb_object_agg(keymap ->> a.key, a.value) from jsonb_each(vc -> 'answers') a where keymap ? a.key), '{}'::jsonb),
      jsonb_build_object('final', vc #> '{expected,final}',
        'sections', coalesce((select jsonb_object_agg(secmap ->> e.key, e.value) from jsonb_each(vc #> '{expected,sections}') e where secmap ? e.key), '{}'::jsonb)));
    n_cases := n_cases + 1;
  end loop;

  v_runs := hse_run_validation_cases(v_ver);

  return jsonb_build_object('template_id', v_tpl, 'version_id', v_ver, 'sections', n_secs, 'items', n_items,
                            'issues', n_issues, 'validation_cases', n_cases, 'validation_runs', v_runs);
end $$;

-- ---------- Dashboard (SECURITY INVOKER: respeta RLS del usuario) ----------
create or replace function public.hse_dashboard(p_org uuid, p_from date default null, p_to date default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with a as (
    select * from hse_audits
    where organization_id = p_org and deleted_at is null
      and (p_from is null or coalesce(scheduled_date, created_at::date) >= p_from)
      and (p_to is null or coalesce(scheduled_date, created_at::date) <= p_to)
  ), f as (
    select f.* from hse_findings f join a on a.id = f.audit_id where f.deleted_at is null
  ), x as (
    select x.* from hse_actions x join f on f.id = x.finding_id where x.deleted_at is null
  )
  select jsonb_build_object(
    'audits_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from a group by status) s), '{}'),
    'avg_compliance', (select round(avg(compliance_pct), 2) from a where status in ('completada','cerrada')),
    'bands', coalesce((select jsonb_object_agg(result_band, n) from (select result_band, count(*) n from a where result_band is not null group by result_band) s), '{}'),
    'findings_by_type', coalesce((select jsonb_object_agg(finding_type, n) from (select finding_type, count(*) n from f group by finding_type) s), '{}'),
    'findings_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from f group by status) s), '{}'),
    'findings_by_severity', coalesce((select jsonb_object_agg(severity, n) from (select severity, count(*) n from f group by severity) s), '{}'),
    'actions_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from x group by status) s), '{}'),
    'actions_overdue', (select count(*) from x where status in ('pendiente','en_curso') and due_date < current_date),
    'by_company', coalesce((select jsonb_agg(r order by r.audits desc) from (
        select c.id, c.name, count(distinct a.id) audits, round(avg(a.compliance_pct), 2) avg_compliance,
               count(f.id) filter (where f.status in ('abierto','en_tratamiento')) open_findings
        from a join hse_companies c on c.id = a.company_id left join f on f.audit_id = a.id
        group by c.id, c.name order by count(distinct a.id) desc limit 15) r), '[]'),
    'monthly', coalesce((select jsonb_agg(r order by r.month) from (
        select to_char(date_trunc('month', coalesce(completed_at, scheduled_date::timestamptz, created_at)), 'YYYY-MM') as month,
               count(*) audits, round(avg(compliance_pct), 2) avg_compliance
        from a group by 1) r), '[]')
  );
$$;

-- ---------- Permisos de ejecución ----------
do $$
declare f text;
begin
  foreach f in array array[
    'hse_bootstrap()', 'hse_create_organization(text, text)', 'hse_invite_member(uuid, text, public.hse_role, uuid)',
    'hse_run_validation_cases(uuid)', 'hse_validate_template_version(uuid, text)', 'hse_publish_template_version(uuid)',
    'hse_new_template_version(uuid, uuid)', 'hse_import_template(uuid, jsonb)', 'hse_dashboard(uuid, date, date)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Funciones internas de trigger: nadie las invoca por API
revoke all on function public.hse_audit_answers(uuid) from public, anon;
grant execute on function public.hse_audit_answers(uuid) to authenticated;
