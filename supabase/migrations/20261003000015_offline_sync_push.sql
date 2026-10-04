-- =====================================================================
-- HSE Audit Manager · 0015 · Receptor de lotes de sincronización (ver 0014)
-- =====================================================================

-- ---------- receptor de lotes ----------
-- p_ops: [{ op_id, table, base: {campo: valor_que_veía_el_dispositivo, ...} | null, payload: {id, organization_id, campos_modificados...} }]
--   base = null  -> alta de un registro creado en el dispositivo.
--   Fusión a nivel de campo (three-way): cada campo modificado se aplica sólo si en
--   el servidor sigue valiendo lo que el dispositivo vio (base) o ya vale lo mismo
--   que se envía. Si otro usuario cambió ese mismo campo -> CONFLICTO, no se escribe
--   nada y se devuelve la fila del servidor para resolver.
-- Respuesta por operación: aplicado | duplicado | conflicto | rechazado | omitido | error
create or replace function public.hse_sync_push(p_ops jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  op jsonb; v_out jsonb := '[]'::jsonb; v_op uuid; v_t text; v_id uuid; v_base jsonb;
  v_payload jsonb; v_allowed text[]; v_cols text[]; v_list text; v_set text; v_exists boolean;
  v_n int; v_org uuid; v_row jsonb; v_failed text[] := '{}'; v_rv bigint; c text;
  v_same_base boolean; v_same_mine boolean; v_conf text[];
begin
  if auth.uid() is null then raise exception 'No autenticado' using errcode = '28000'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then
    raise exception 'Lote inválido (máximo 200 operaciones)' using errcode = '22023';
  end if;

  for op in select value from jsonb_array_elements(p_ops) loop
    v_op := nullif(op ->> 'op_id', '')::uuid;
    v_t := op ->> 'table';
    v_payload := op -> 'payload';
    v_base := case when jsonb_typeof(op -> 'base') = 'object' then op -> 'base' end;
    v_id := nullif(v_payload ->> 'id', '')::uuid;
    v_org := nullif(v_payload ->> 'organization_id', '')::uuid;
    begin
      if v_op is null or v_id is null then raise exception 'Operación sin op_id o id' using errcode = '22023'; end if;

      -- 1) idempotencia: si ya se recibió, se devuelve el recibo y no se reaplica
      select row_version into v_rv from hse_sync_receipts where op_id = v_op;
      if found then
        v_out := v_out || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'duplicado', 'row_version', v_rv));
        continue;
      end if;
      if v_id::text = any (v_failed) then
        v_out := v_out || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'omitido',
                   'message', 'Una operación anterior del mismo registro no se aplicó en este lote'));
        continue;
      end if;

      -- 2) permisos y columnas validados en el servidor
      v_allowed := hse_sync_writable_columns(v_t);
      if v_allowed is null then raise exception 'Tabla no sincronizable: %', v_t using errcode = '42501'; end if;
      if v_org is null or not hse_is_member(v_org) then raise exception 'Sin acceso a la organización' using errcode = '42501'; end if;
      select array_agg(k order by k) into v_cols from jsonb_object_keys(v_payload) k
        where k = any (v_allowed) and k not in ('id', 'organization_id');
      v_cols := coalesce(v_cols, '{}');

      execute format('select true from public.%I where id = $1', v_t) into v_exists using v_id;
      if v_exists is null then
        if v_base is not null then
          raise exception 'El registro no existe en el servidor o ya no tiene acceso' using errcode = 'HS404';
        end if;
        v_list := (select string_agg(quote_ident(x), ',') from unnest(array['id','organization_id'] || v_cols) x);
        begin
          execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', v_t, v_list, v_list, v_t)
            using v_payload;
        exception when unique_violation then
          raise exception 'Otro dispositivo creó este registro al mismo tiempo; vuelva a sincronizar' using errcode = 'HS409';
        end;
      else
        -- alta de un registro que ya existe (p. ej. la misma respuesta desde dos dispositivos):
        -- se trata como modificación cuyo valor anterior era "vacío"
        if v_base is null then
          v_base := (select coalesce(jsonb_object_agg(x, null), '{}'::jsonb) from unnest(v_cols) x);
        end if;
        v_conf := '{}';
        foreach c in array v_cols loop
          continue when c = 'client_updated_at';
          if not (v_base ? c) then v_conf := v_conf || c; continue; end if;        -- sin valor de referencia: no se arriesga
          execute format('select x.%1$I is not distinct from b.%1$I, x.%1$I is not distinct from m.%1$I
                            from public.%2$I x, jsonb_populate_record(null::public.%2$I, $1) b, jsonb_populate_record(null::public.%2$I, $2) m
                           where x.id = $3', c, v_t)
            into v_same_base, v_same_mine using v_base, v_payload, v_id;
          if not v_same_base and not v_same_mine then v_conf := v_conf || c; end if;
        end loop;
        if array_length(v_conf, 1) > 0 then
          execute format('select to_jsonb(x) from public.%I x where id = $1', v_t) into v_row using v_id;
          v_failed := v_failed || v_id::text;
          v_out := v_out || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'conflicto', 'code', 'HS409',
                     'message', 'Otro usuario modificó en el servidor: ' || array_to_string(v_conf, ', '),
                     'fields', to_jsonb(v_conf), 'row_version', v_row -> 'row_version', 'server_row', v_row));
          continue;
        end if;
        v_set := (select string_agg(format('%I = r.%I', x, x), ', ') from unnest(v_cols) x);
        if v_set is not null then
          execute format('update public.%I x set %s from jsonb_populate_record(null::public.%I, $1) r where x.id = $2', v_t, v_set, v_t)
            using v_payload, v_id;
          get diagnostics v_n = row_count;
          if v_n = 0 then raise exception 'Sin permiso para modificar este registro' using errcode = '42501'; end if;
        end if;
      end if;

      -- 3) evidencias: el archivo tiene que estar recibido antes que su metadato
      if v_t = 'hse_evidences' and (v_payload ->> 'storage_path') is not null and not exists (
           select 1 from storage.objects o where o.bucket_id = 'hse-evidencias' and o.name = v_payload ->> 'storage_path') then
        raise exception 'El archivo de la evidencia todavía no está en el servidor' using errcode = 'HS424';
      end if;

      -- 4) recibo, en la misma subtransacción que el cambio (o se aplicó todo o nada)
      execute format('select row_version, to_jsonb(x) from public.%I x where id = $1', v_t) into v_rv, v_row using v_id;
      insert into hse_sync_receipts (op_id, organization_id, table_name, record_id, row_version) values (v_op, v_org, v_t, v_id, v_rv);
      v_out := v_out || jsonb_build_array(jsonb_build_object('op_id', v_op, 'status', 'aplicado', 'row_version', v_rv, 'server_row', v_row));
    exception when others then
      v_failed := v_failed || coalesce(v_id::text, '?');
      v_out := v_out || jsonb_build_array(jsonb_build_object('op_id', v_op,
        'status', case when sqlstate = 'HS409' then 'conflicto' when sqlstate in ('HS424', '40001', '40P01', '55P03') then 'error' else 'rechazado' end,
        'code', sqlstate, 'message', sqlerrm));
    end;
  end loop;
  return v_out;
end $$;
revoke all on function public.hse_sync_push(jsonb) from public, anon;
grant execute on function public.hse_sync_push(jsonb) to authenticated;
revoke all on function public.hse_sync_writable_columns(text) from public, anon;
grant execute on function public.hse_sync_writable_columns(text) to authenticated;

-- Confirmación explícita: ¿qué operaciones de este usuario recibió el servidor?
create or replace function public.hse_sync_confirm(p_op_ids uuid[])
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('op_id', op_id, 'row_version', row_version, 'received_at', received_at)), '[]'::jsonb)
  from hse_sync_receipts where op_id = any (p_op_ids) and user_id = auth.uid();
$$;
revoke all on function public.hse_sync_confirm(uuid[]) from public, anon;
grant execute on function public.hse_sync_confirm(uuid[]) to authenticated;
