-- =====================================================================
-- HSE Audit Manager · 0021 · La reapertura autorizada también borra la revisión
-- (detectado por supabase/tests/findings_lifecycle.sql: hse_reopen_audit activa
--  hse.reopening y el trigger salía antes de limpiar reviewed_*).
-- =====================================================================
create or replace function public.hse_audits_readiness()
returns trigger language plpgsql set search_path = public as $$
declare r jsonb; v_issues jsonb; v_msg text;
begin
  -- la revisión sólo la fija hse_review_audit; se pierde si la auditoría vuelve a ejecución
  if coalesce(current_setting('hse.reviewing', true), '') <> 'on' then
    new.reviewed_by := old.reviewed_by; new.reviewed_at := old.reviewed_at; new.review_notes := old.review_notes;
  end if;
  if new.status in ('planificada','en_curso') and old.status not in ('planificada','en_curso') then
    new.reviewed_by := null; new.reviewed_at := null; new.review_notes := null;
  end if;
  if coalesce(current_setting('hse.reopening', true), '') = 'on' then return new; end if;
  if new.status is distinct from old.status and new.status in ('completada','cerrada') then
    r := hse_audit_readiness(new.id, new.status::text);
    v_issues := r -> 'issues';
    if new.status = 'cerrada' and coalesce(btrim(new.summary), '') <> '' then
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
revoke all on function public.hse_audits_readiness() from public, anon, authenticated;
