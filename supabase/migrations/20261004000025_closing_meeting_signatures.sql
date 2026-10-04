-- =====================================================================
-- HSE Audit Manager · 0025 · Acta de reunión de cierre y firmas en campo
--
--  * hse_audits: fecha, asistentes y acuerdos de la reunión de cierre (acta).
--  * hse_audit_signatures: firmas manuscritas capturadas en el dispositivo (también sin
--    conexión) del auditor y de los representantes del contratista / cliente, con su
--    conformidad ("conforme" o "con observaciones").
--  * Una firma no se modifica: si hubo un error se da de baja (borrado lógico) y se firma
--    de nuevo. Con la auditoría cerrada o cancelada no se agregan ni se quitan firmas.
--  * Visibles para quien ve la auditoría; registran quién las capturó (servidor) y entran
--    en el historial de cambios.
-- =====================================================================

alter table public.hse_audits
  add column if not exists closing_meeting_at   date,
  add column if not exists closing_attendees    text check (closing_attendees is null or length(closing_attendees) <= 2000),
  add column if not exists closing_agreements   text check (closing_agreements is null or length(closing_agreements) <= 8000);

create table public.hse_audit_signatures (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.hse_organizations(id) on delete cascade,
  audit_id           uuid not null,
  signer_role        text not null check (signer_role in ('auditor_lider','auditor','representante_contratista','representante_cliente','otro')),
  signer_name        text not null check (length(btrim(signer_name)) between 2 and 120),
  signer_position    text check (signer_position is null or length(signer_position) <= 120),
  signer_company     text check (signer_company is null or length(signer_company) <= 160),
  agreement          text not null default 'conforme' check (agreement in ('conforme','con_observaciones')),
  observations       text check (observations is null or length(observations) <= 2000),
  signature_png      text not null check (signature_png like 'data:image/png;base64,%' and length(signature_png) <= 350000),
  signed_at          timestamptz not null default now(),
  created_by         uuid references auth.users(id) on delete set null default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  client_updated_at  timestamptz,
  deleted_at         timestamptz,
  row_version        bigint not null default 1,
  unique (organization_id, id),
  foreign key (organization_id, audit_id) references public.hse_audits (organization_id, id) on delete cascade,
  check (agreement = 'conforme' or length(btrim(coalesce(observations, ''))) >= 3)
);
create index hse_audit_signatures_audit_idx on public.hse_audit_signatures (audit_id);
create index hse_audit_signatures_sync_idx on public.hse_audit_signatures (organization_id, updated_at);
create trigger hse_audit_signatures_touch before insert or update on public.hse_audit_signatures
  for each row execute function public.hse_touch_row();

create or replace function public.hse_guard_signature()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  select status into v_status from hse_audits where id = new.audit_id;
  if v_status in ('cerrada', 'cancelada') then
    raise exception 'La auditoría está %: no se agregan ni se quitan firmas', v_status using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    -- la hora de firma puede venir del dispositivo (firma sin conexión) pero no del futuro
    if new.signed_at > now() + interval '10 minutes' then new.signed_at := now(); end if;
    if new.signed_at < now() - interval '60 days' then
      raise exception 'Fecha de firma fuera de rango' using errcode = 'HS422';
    end if;
  else
    -- inmutable: sólo se admite darla de baja
    if (new.signer_role, new.signer_name, new.signer_position, new.signer_company, new.agreement, new.observations, new.signature_png, new.signed_at, new.audit_id)
       is distinct from
       (old.signer_role, old.signer_name, old.signer_position, old.signer_company, old.agreement, old.observations, old.signature_png, old.signed_at, old.audit_id) then
      raise exception 'Una firma no se modifica: dela de baja y firme nuevamente' using errcode = '42501';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then
      raise exception 'Una firma dada de baja no se restaura' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.hse_guard_signature() from public, anon, authenticated;
create trigger hse_audit_signatures_guard before insert or update on public.hse_audit_signatures
  for each row execute function public.hse_guard_signature();
create trigger hse_audit_signatures_log after insert or update or delete on public.hse_audit_signatures
  for each row execute function public.hse_log_change();

alter table public.hse_audit_signatures enable row level security;
alter table public.hse_audit_signatures force row level security;
revoke all on public.hse_audit_signatures from anon;
grant select, insert, update on public.hse_audit_signatures to authenticated;
create policy hse_signatures_select on public.hse_audit_signatures for select to authenticated
  using (public.hse_audit_role(audit_id) is not null);
create policy hse_signatures_insert on public.hse_audit_signatures for insert to authenticated
  with check (public.hse_audit_role(audit_id) in ('gestion', 'escritura'));
create policy hse_signatures_update on public.hse_audit_signatures for update to authenticated
  using (public.hse_audit_role(audit_id) in ('gestion', 'escritura'))
  with check (public.hse_audit_role(audit_id) in ('gestion', 'escritura'));
-- sin política de DELETE: las firmas sólo se dan de baja (deleted_at)

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
    when 'hse_audits' then array['id','organization_id','template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','lead_auditor_id','audit_team','scope','summary','latitude','longitude','closing_meeting_at','closing_attendees','closing_agreements','deleted_at','client_updated_at']
    when 'hse_audit_participants' then array['id','organization_id','audit_id','user_id','participant_role','deleted_at','client_updated_at']
    when 'hse_audit_responses' then array['id','organization_id','audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at']
    when 'hse_findings' then array['id','organization_id','audit_id','response_id','item_id','company_id','location_id','title','description','requirement','finding_type','severity','category','process_id','responsible_user_id','status','root_cause','rca_method','rca_data','immediate_action','legal_reference','detected_at','due_date','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_actions' then array['id','organization_id','finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','effectiveness_criteria','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_evidences' then array['id','organization_id','audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','deleted_at','client_updated_at']
    when 'hse_audit_signatures' then array['id','organization_id','audit_id','signer_role','signer_name','signer_position','signer_company','agreement','observations','signature_png','signed_at','deleted_at','client_updated_at']
    else null end;
$$;

-- historial de un registro: incluye firmas (la imagen no se repite en el historial)
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
    when 'hse_audit_signatures' then (select hse_audit_role(s.audit_id) from hse_audit_signatures s where s.id = p_id) is not null
    else false end;
  if not coalesce(v_ok, false) then raise exception 'Sin acceso al registro' using errcode = '42501'; end if;
  return query
    select l.changed_at, l.action, l.changed_fields,
           l.old_data - array['row_version','updated_at','client_updated_at','signature_png'],
           l.new_data - array['row_version','updated_at','client_updated_at','signature_png'],
           case when l.user_id is null then 'Sistema'
                when hse_profile_visible(l.user_id) then coalesce(p.full_name, p.email)
                else 'Usuario de la organización' end
    from hse_change_log l left join hse_profiles p on p.id = l.user_id
    where l.table_name = p_table and l.record_id = p_id
    order by l.changed_at, l.id;
end $$;

-- historial completo de la auditoría: incluye firmas
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
      union all select 'hse_audit_signatures', s.id, 'Firma de ' || s.signer_name from hse_audit_signatures s where s.audit_id = p_audit
    )
    select l.changed_at, l.table_name, l.record_id, recs.lbl, l.action, l.changed_fields,
           l.old_data - array['row_version','updated_at','client_updated_at','signature_png'],
           l.new_data - array['row_version','updated_at','client_updated_at','signature_png'],
           case when l.user_id is null then 'Sistema'
                when hse_profile_visible(l.user_id) then coalesce(p.full_name, p.email)
                else 'Usuario de la organización' end
    from recs join hse_change_log l on l.table_name = recs.t and l.record_id = recs.id
    left join hse_profiles p on p.id = l.user_id
    order by l.changed_at, l.id;
end $$;
revoke all on function public.hse_record_history(text, uuid) from public, anon;
grant execute on function public.hse_record_history(text, uuid) to authenticated;
revoke all on function public.hse_audit_history(uuid) from public, anon;
grant execute on function public.hse_audit_history(uuid) to authenticated;
