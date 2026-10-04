-- =====================================================================
-- HSE Audit Manager · 0022 · Informes, resultados por categoría y seguimiento
--
--  * hse_evaluate_answers (método 'ponderado'): agrega el desglose por sección
--    (mismo criterio que el total: cumple/sí = peso; no cumple/no = 0; N/A y sin
--    responder fuera del máximo). El total no cambia. Además ignora ítems de
--    secciones eliminadas, igual que el motor del cliente (antes sólo el cliente
--    lo hacía). El método 'situacion_promedio_secciones' (H&P) no se modifica.
--  * hse_report_summary: indicadores con datos reales del servidor, respetando RLS
--    (SECURITY INVOKER: cada usuario ve sólo lo que su rol le permite).
--  * hse_audit_history: historial completo de una auditoría y sus registros.
--  * hse_dashboard: corrige el promedio por empresa (antes se ponderaba por la
--    cantidad de hallazgos por el JOIN).
-- =====================================================================

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
  secs    jsonb;
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
      'critical_failures', (select count(*) from hse_template_items i join hse_template_sections s on s.id = i.section_id
                            where i.version_id = p_version and i.deleted_at is null and s.deleted_at is null and i.is_critical
                              and p_answers ->> i.id::text = 'nc'),
      'band', case when final is null then null else coalesce(band, 'sin_clasificar') end,
      'sections', coalesce(res, '[]'::jsonb));
  end if;

  -- Método 'ponderado': cumple/sí = peso; no cumple/no = 0; N/A y sin responder quedan fuera del máximo.
  with r as (
    select i.response_type, i.weight, i.is_critical, i.section_id, s.title, s.sort_order,
           p_answers ->> i.id::text as answer
    from hse_template_items i join hse_template_sections s on s.id = i.section_id
    where i.version_id = p_version and i.deleted_at is null and s.deleted_at is null
      and i.response_type in ('cumplimiento','si_no')
  ), sec as (
    select section_id, min(title) title, min(sort_order) so,
           coalesce(sum(case when answer in ('cumple','si') then weight else 0 end), 0) raw,
           coalesce(sum(case when answer in ('cumple','si','no_cumple','no') then weight else 0 end), 0) target,
           count(*) items,
           count(*) filter (where answer is not null and answer <> '') answered,
           count(*) filter (where answer in ('no_aplica','na')) na
    from r group by section_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'section_id', section_id, 'title', title, 'raw', raw, 'target', target,
           'score', case when target > 0 then round(100 * raw / target, 4) end,
           'items', items, 'answered', answered, 'na', na) order by so), '[]'::jsonb)
    into secs from sec;

  with r as (
    select i.response_type, i.weight, i.is_critical, p_answers ->> i.id::text as answer
    from hse_template_items i join hse_template_sections s on s.id = i.section_id
    where i.version_id = p_version and i.deleted_at is null and s.deleted_at is null
  ), agg as (
    select
      coalesce(sum(case when response_type in ('cumplimiento','si_no') and answer in ('cumple','si') then weight else 0 end), 0) s,
      coalesce(sum(case when response_type in ('cumplimiento','si_no') and answer in ('cumple','si','no_cumple','no') then weight else 0 end), 0) m,
      count(*) filter (where is_critical and response_type in ('cumplimiento','si_no') and answer in ('no_cumple','no')) c
    from r
  )
  select jsonb_build_object('method', 'ponderado', 'score', s, 'max_score', m,
           'compliance_pct', case when m > 0 then round(100 * s / m, 2) end,
           'final', case when m > 0 then 100 * s / m end,
           'critical_failures', c, 'band', null, 'sections', secs)
    into res from agg;
  return res;
end $$;
revoke all on function public.hse_evaluate_answers(uuid, jsonb) from public, anon;
grant execute on function public.hse_evaluate_answers(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- indicadores (datos reales, bajo RLS)
create or replace function public.hse_report_summary(p_org uuid, p_from date default null, p_to date default null, p_company uuid default null)
returns jsonb language sql stable security invoker set search_path = public as $$
  with a as (
    select * from hse_audits
    where organization_id = p_org and deleted_at is null
      and (p_from is null or coalesce(scheduled_date, created_at::date) >= p_from)
      and (p_to is null or coalesce(scheduled_date, created_at::date) <= p_to)
      and (p_company is null or company_id = p_company)
  ), t as (
    select a.id audit_id, tp.id template_id, tp.name template_name, tp.category, tv.scoring_method, tv.version_number
    from a join hse_template_versions tv on tv.id = a.template_version_id join hse_templates tp on tp.id = tv.template_id
  ), done as (
    select a.*, t.category, t.template_id, t.template_name, t.scoring_method
    from a join t on t.audit_id = a.id where a.status in ('completada','cerrada')
  ), f as (
    select f.* from hse_findings f join a on a.id = f.audit_id where f.deleted_at is null
  ), x as (
    select x.* from hse_actions x join f on f.id = x.finding_id where x.deleted_at is null
  )
  select jsonb_build_object(
    'generated_at', now(), 'from', p_from, 'to', p_to, 'company_id', p_company,
    'audits', jsonb_build_object(
      'total', (select count(*) from a),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from a group by status) s), '{}'),
      'overdue_planned', (select count(*) from a where status = 'planificada' and scheduled_date < current_date),
      'pending_review', (select count(*) from a where status = 'completada' and reviewed_at is null),
      'ready_to_close', (select count(*) from a where status = 'completada' and reviewed_at is not null),
      'critical_failures', (select coalesce(sum(critical_failures), 0) from done)),
    'results', jsonb_build_object(
      'avg_compliance', (select round(avg(compliance_pct), 2) from done),
      'bands', coalesce((select jsonb_object_agg(result_band, n) from (select result_band, count(*) n from done where result_band is not null group by result_band) s), '{}')),
    'by_template_category', coalesce((select jsonb_agg(r order by r.category) from (
        select category, count(*) audits, round(avg(compliance_pct), 2) avg_compliance,
               (select count(*) from f join done d2 on d2.id = f.audit_id where d2.category = d.category) findings
        from done d group by category) r), '[]'),
    'by_section', coalesce((select jsonb_agg(r order by r.template_name, r.so) from (
        select d.template_id, min(d.template_name) template_name, s ->> 'title' title, min(d.scoring_method) scoring_method,
               min(ord) so, count(*) audits,
               round(avg((s ->> 'score')::numeric), 4) avg_score,
               sum((s ->> 'raw')::numeric) raw, sum((s ->> 'target')::numeric) target
        from done d cross join lateral jsonb_array_elements(coalesce(d.section_results, '[]'::jsonb)) with ordinality as e(s, ord)
        group by d.template_id, s ->> 'title') r), '[]'),
    'findings', jsonb_build_object(
      'total', (select count(*) from f),
      'open', (select count(*) from f where status in ('abierto','en_tratamiento')),
      'pending_verification', (select count(*) from f where status = 'cerrado'),
      'overdue', (select count(*) from f where status in ('abierto','en_tratamiento') and due_date < current_date),
      'recurrent', (select count(*) from f where recurrence_count > 0),
      'effective', (select count(*) from f where status = 'verificado' and effectiveness = 'eficaz'),
      'not_effective', (select count(*) from f where effectiveness = 'no_eficaz'),
      'avg_days_to_close', (select round(avg(extract(epoch from (closed_at - detected_at)) / 86400)::numeric, 1) from f where closed_at is not null),
      'by_type', coalesce((select jsonb_object_agg(finding_type, n) from (select finding_type, count(*) n from f group by finding_type) s), '{}'),
      'by_severity', coalesce((select jsonb_object_agg(severity, n) from (select severity, count(*) n from f group by severity) s), '{}'),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from f group by status) s), '{}'),
      'by_category', coalesce((select jsonb_object_agg(coalesce(category::text, 'sin_categoria'), n) from (select category, count(*) n from f group by category) s), '{}')),
    'actions', jsonb_build_object(
      'total', (select count(*) from x),
      'overdue', (select count(*) from x where status in ('pendiente','en_curso') and due_date < current_date),
      'due_7_days', (select count(*) from x where status in ('pendiente','en_curso') and due_date between current_date and current_date + 7),
      'completed_on_time', (select count(*) from x where status in ('completada','verificada') and completed_at::date <= due_date),
      'completed', (select count(*) from x where status in ('completada','verificada')),
      'effective', (select count(*) from x where effectiveness = 'eficaz'),
      'not_effective', (select count(*) from x where effectiveness = 'no_eficaz'),
      'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from x group by status) s), '{}'),
      'by_type', coalesce((select jsonb_object_agg(action_type, n) from (select action_type, count(*) n from x group by action_type) s), '{}')),
    'by_company', coalesce((select jsonb_agg(r order by r.audits desc, r.name) from (
        select c.id, c.name,
               (select count(*) from a where a.company_id = c.id) audits,
               (select round(avg(compliance_pct), 2) from done where done.company_id = c.id) avg_compliance,
               (select count(*) from f where f.company_id = c.id and f.status in ('abierto','en_tratamiento')) open_findings,
               (select count(*) from f where f.company_id = c.id and f.recurrence_count > 0) recurrent_findings,
               (select count(*) from x join f on f.id = x.finding_id where f.company_id = c.id and x.status in ('pendiente','en_curso') and x.due_date < current_date) overdue_actions
        from hse_companies c
        where c.organization_id = p_org and exists (select 1 from a where a.company_id = c.id)) r), '[]'),
    'monthly', coalesce((select jsonb_agg(r order by r.month) from (
        select to_char(date_trunc('month', coalesce(completed_at, scheduled_date::timestamptz, created_at)), 'YYYY-MM') as month,
               count(*) audits, round(avg(compliance_pct), 2) avg_compliance
        from done group by 1) r), '[]'),
    'findings_monthly', coalesce((select jsonb_agg(r order by r.month) from (
        select to_char(date_trunc('month', detected_at), 'YYYY-MM') as month, count(*) detected,
               count(*) filter (where closed_at is not null) closed
        from f group by 1) r), '[]'),
    'recurrent', coalesce((select jsonb_agg(r order by r.occurrences desc, r.last_detected desc) from (
        select g.recurrence_key, count(*) occurrences, count(distinct g.audit_id) audits, max(g.detected_at) last_detected,
               min(c.name) company, min(i.code) item_code, min(i.original_number) item_number, left(min(i.question), 200) question,
               jsonb_agg(jsonb_build_object('id', g.id, 'code', g.code, 'status', g.status, 'detected_at', g.detected_at) order by g.detected_at) findings
        from hse_findings g
        left join hse_companies c on c.id = g.company_id
        left join hse_template_items i on i.id = g.item_id
        where g.organization_id = p_org and g.deleted_at is null and g.recurrence_key is not null
          and (p_company is null or g.company_id = p_company)
        group by g.recurrence_key
        having count(distinct g.audit_id) >= 2
           and (p_from is null or max(g.detected_at)::date >= p_from)
           and (p_to is null or min(g.detected_at)::date <= p_to)
        limit 50) r), '[]')
  );
$$;
revoke all on function public.hse_report_summary(uuid, date, date, uuid) from public, anon;
grant execute on function public.hse_report_summary(uuid, date, date, uuid) to authenticated;

-- ---------------------------------------------------------------- historial completo de una auditoría
create or replace function public.hse_audit_history(p_audit uuid)
returns table (changed_at timestamptz, table_name text, record_id uuid, record_label text, action text,
               changed_fields text[], old_data jsonb, new_data jsonb, user_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if hse_audit_role(p_audit) is null then raise exception 'Sin acceso a la auditoría' using errcode = '42501'; end if;
  return query
    with recs as (
      select 'hse_audits'::text t, a.id, coalesce(a.code, a.title) lbl from hse_audits a where a.id = p_audit
      union all select 'hse_audit_participants', p.id, 'Participante' from hse_audit_participants p where p.audit_id = p_audit
      union all select 'hse_audit_responses', r.id, coalesce('Ítem ' || coalesce(i.original_number, i.code), 'Respuesta')
        from hse_audit_responses r left join hse_template_items i on i.id = r.item_id where r.audit_id = p_audit
      union all select 'hse_findings', f.id, coalesce(f.code, f.title) from hse_findings f where f.audit_id = p_audit
      union all select 'hse_actions', x.id, 'Acción de ' || coalesce(f.code, f.title) from hse_actions x join hse_findings f on f.id = x.finding_id where f.audit_id = p_audit
      union all select 'hse_evidences', e.id, coalesce(e.file_name, 'Evidencia') from hse_evidences e where e.audit_id = p_audit
    )
    select l.changed_at, l.table_name, l.record_id, recs.lbl, l.action, l.changed_fields,
           l.old_data - array['row_version','updated_at','client_updated_at'],
           l.new_data - array['row_version','updated_at','client_updated_at'],
           case when l.user_id is null then 'Sistema'
                when hse_profile_visible(l.user_id) then coalesce(p.full_name, p.email)
                else 'Usuario de la organización' end
    from recs join hse_change_log l on l.table_name = recs.t and l.record_id = recs.id
    left join hse_profiles p on p.id = l.user_id
    order by l.changed_at, l.id;
end $$;
revoke all on function public.hse_audit_history(uuid) from public, anon;
grant execute on function public.hse_audit_history(uuid) to authenticated;

-- ---------------------------------------------------------------- dashboard: promedio por empresa sin duplicar
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
        select c.id, c.name, (select count(*) from a where a.company_id = c.id) audits,
               (select round(avg(compliance_pct), 2) from a where a.company_id = c.id and a.status in ('completada','cerrada')) avg_compliance,
               (select count(*) from f where f.company_id = c.id and f.status in ('abierto','en_tratamiento')) open_findings
        from hse_companies c where c.organization_id = p_org and exists (select 1 from a where a.company_id = c.id)
        limit 15) r), '[]'),
    'monthly', coalesce((select jsonb_agg(r order by r.month) from (
        select to_char(date_trunc('month', coalesce(completed_at, scheduled_date::timestamptz, created_at)), 'YYYY-MM') as month,
               count(*) audits, round(avg(compliance_pct), 2) avg_compliance
        from a group by 1) r), '[]')
  );
$$;
