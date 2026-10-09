-- =====================================================================
-- HSE Audit Manager · 0027 · Informe final (modelo RS Consultora)
--
--  * hse_audits.report_data: contenido redactado del informe final que no sale de la lista
--    de verificación: compañía solicitante, contrato, lugares, objetivo, criterios, plan de
--    auditoría, desarrollo, conclusiones y conformidades por requisito, fortalecimiento
--    (fortalezas), recomendación final y declaración del auditor. Se edita también sin
--    conexión (cola de sincronización) y queda en el historial de cambios.
--  * Plan de auditoría: también vive en report_data (datos generales, objetivo, criterios y
--    cronograma) junto con su aceptación por el cliente (report_data.plan_approval). Una
--    auditoría planificada no pasa a "en curso" hasta que el plan esté aceptado.
--  * hse_findings.rationale: "Fundamento" de las oportunidades de mejora.
-- =====================================================================

alter table public.hse_audits
  add column if not exists report_data jsonb;
alter table public.hse_audits
  add constraint hse_audits_report_data_chk
  check (report_data is null or (jsonb_typeof(report_data) = 'object' and length(report_data::text) <= 200000));

alter table public.hse_findings
  add column if not exists rationale text check (rationale is null or length(rationale) <= 4000);

-- columnas que el cliente puede enviar por la cola de sincronización
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
    when 'hse_audits' then array['id','organization_id','template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','lead_auditor_id','audit_team','scope','summary','latitude','longitude','closing_meeting_at','closing_attendees','closing_agreements','report_data','deleted_at','client_updated_at']
    when 'hse_audit_participants' then array['id','organization_id','audit_id','user_id','participant_role','deleted_at','client_updated_at']
    when 'hse_audit_responses' then array['id','organization_id','audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at']
    when 'hse_findings' then array['id','organization_id','audit_id','response_id','item_id','company_id','location_id','title','description','requirement','rationale','finding_type','severity','category','process_id','responsible_user_id','status','root_cause','rca_method','rca_data','immediate_action','legal_reference','detected_at','due_date','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_actions' then array['id','organization_id','finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','effectiveness_criteria','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_evidences' then array['id','organization_id','audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','deleted_at','client_updated_at']
    when 'hse_audit_signatures' then array['id','organization_id','audit_id','signer_role','signer_name','signer_position','signer_company','agreement','observations','signature_png','signed_at','deleted_at','client_updated_at']
    else null end;
$$;

-- ---------------------------------------------------------------- guarda de auditoría (0017 + plan aceptado)
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
  -- 0027: una auditoría planificada se inicia sólo con el plan aceptado por el cliente
  if old.status = 'planificada' and new.status = 'en_curso' and not v_reopen
     and coalesce(new.report_data #>> '{plan_approval,status}', '') <> 'aprobado' then
    raise exception 'El plan de auditoría tiene que estar aceptado por el cliente antes de iniciar la auditoría' using errcode = '23514';
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
