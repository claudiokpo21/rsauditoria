-- =====================================================================
-- HSE Audit Manager · 0014 · Protocolo de sincronización offline-first
--
--  * row_version: versión por fila que fija el servidor (1 al crear, +1 en
--    cada cambio); permite al cliente saber qué versión tiene.
--  * Conflictos por fusión a nivel de campo: el dispositivo envía sólo los
--    campos que modificó y el valor que veía; si otro usuario cambió esos
--    mismos campos hay CONFLICTO y no se sobrescribe nada.
--  * hse_sync_receipts: recibo por clave de idempotencia (op_id). Reenviar la
--    misma operación devuelve "duplicado" sin volver a aplicarla.
--  * hse_sync_push(lote): aplica cada operación en su propia subtransacción
--    (cambio + recibo son atómicos), con RLS del usuario (SECURITY INVOKER):
--    los permisos se revalidan al sincronizar, no se confía en el dispositivo.
--  * Evidencias: el metadato sólo se acepta si el archivo ya está en Storage.
-- =====================================================================

-- ---------- versión por fila ----------
do $$
declare t text;
begin
  foreach t in array array['hse_companies','hse_locations','hse_processes','hse_templates','hse_template_versions',
                           'hse_template_sections','hse_template_items','hse_template_import_issues','hse_template_validation_cases',
                           'hse_audits','hse_audit_responses','hse_evidences','hse_findings','hse_actions']
  loop
    execute format('alter table public.%I add column if not exists row_version bigint not null default 1', t);
  end loop;
end $$;

-- La fusión por campos reemplaza la comparación por reloj del cliente (sensible a relojes
-- desfasados entre dispositivos): ya no se usa client_updated_at para decidir.
create or replace function public.hse_touch_row()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id then
      raise exception 'No se puede mover un registro a otra organización' using errcode = '42501';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.row_version := old.row_version + 1;
  else
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.row_version := 1;
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- recibos de idempotencia ----------
create table public.hse_sync_receipts (
  op_id            uuid primary key,
  organization_id  uuid not null references public.hse_organizations(id) on delete cascade,
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  table_name       text not null,
  record_id        uuid not null,
  row_version      bigint not null,
  received_at      timestamptz not null default now()
);
create index hse_sync_receipts_user_idx on public.hse_sync_receipts (user_id, received_at desc);
create index hse_sync_receipts_org_idx on public.hse_sync_receipts (organization_id, received_at desc);
create index hse_sync_receipts_record_idx on public.hse_sync_receipts (record_id);
alter table public.hse_sync_receipts enable row level security;
alter table public.hse_sync_receipts force row level security;
revoke all on public.hse_sync_receipts from anon;
create policy hse_sync_receipts_select on public.hse_sync_receipts for select to authenticated
  using (user_id = auth.uid() or public.hse_has_role(organization_id, '{owner,admin}'));
create policy hse_sync_receipts_insert on public.hse_sync_receipts for insert to authenticated
  with check (user_id = auth.uid() and public.hse_is_member(organization_id));

-- ---------- columnas que el cliente puede escribir (el resto lo fija el servidor) ----------
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
    when 'hse_audits' then array['id','organization_id','template_version_id','company_id','location_id','title','audit_type','status','scheduled_date','started_at','completed_at','lead_auditor_id','audit_team','scope','summary','latitude','longitude','deleted_at','client_updated_at']
    when 'hse_audit_responses' then array['id','organization_id','audit_id','item_id','answer','rating','numeric_value','text_value','comment','deleted_at','client_updated_at']
    when 'hse_findings' then array['id','organization_id','audit_id','response_id','item_id','company_id','location_id','title','description','finding_type','severity','status','root_cause','immediate_action','legal_reference','detected_at','due_date','deleted_at','client_updated_at']
    when 'hse_actions' then array['id','organization_id','finding_id','description','action_type','responsible_user_id','responsible_name','responsible_company_id','due_date','status','progress_notes','verification_notes','effectiveness','deleted_at','client_updated_at']
    when 'hse_evidences' then array['id','organization_id','audit_id','response_id','finding_id','action_id','storage_path','file_name','mime_type','size_bytes','caption','taken_at','latitude','longitude','uploaded_by','deleted_at','client_updated_at']
    else null end;
$$;

