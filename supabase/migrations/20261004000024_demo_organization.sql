-- =====================================================================
-- HSE Audit Manager · 0024 · Organización de ejemplo
--
-- hse_load_demo(p_payload) crea, para el usuario que la invoca, una organización
-- NUEVA llamada "Organización de ejemplo" (queda como propietario) con datos
-- ficticios para conocer la aplicación sin mezclar datos reales:
--   * plantilla H&P importada con el payload del Excel y publicada por el camino
--     normal (incidencias revisadas → casos de validación → validación → publicación);
--   * plantilla ponderada de inspección de seguridad e higiene;
--   * 3 contratistas, 3 ubicaciones, 8 auditorías en distintos estados, hallazgos
--     con causa raíz, planes de acción en distintos estados, una recurrencia.
-- Una de las auditorías usa EXACTAMENTE las respuestas del Excel: el servidor
-- debe obtener 6,27 "Bueno" con las secciones 16/24, 63/90, 65/84, 4/12, 5/9, 22/30.
--
-- SECURITY INVOKER: todo se inserta con los permisos del usuario (RLS y triggers
-- de negocio aplican igual que desde la aplicación). Nada se fuerza ni se saltea:
-- los puntajes los calcula el servidor al completar y las auditorías quedan
-- "completadas" esperando la revisión de otra persona (la revisión exige que la
-- haga alguien distinto del auditor líder).
-- =====================================================================

-- UUID v5 (RFC 4122, SHA-1): igual que uuid.v5 del cliente, para que la respuesta
-- de una pregunta tenga el mismo id en el servidor y en el dispositivo.
create or replace function public.hse_uuid_v5(p_ns uuid, p_name text)
returns uuid language sql immutable strict set search_path = public, extensions as $$
  select encode(set_byte(set_byte(h, 6, (get_byte(h, 6) & 15) | 80), 8, (get_byte(h, 8) & 63) | 128), 'hex')::uuid
  from (select substring(digest(uuid_send(p_ns) || convert_to(p_name, 'UTF8'), 'sha1') from 1 for 16) as h) x;
$$;
revoke all on function public.hse_uuid_v5(uuid, text) from public, anon;
grant execute on function public.hse_uuid_v5(uuid, text) to authenticated;

-- id determinístico de respuesta (mismo espacio de nombres que src/db/repo.ts)
create or replace function public.hse_response_uuid(p_audit uuid, p_item uuid)
returns uuid language sql immutable strict set search_path = public, extensions as $$
  select public.hse_uuid_v5('6f1c0d5e-2b7a-4f0e-9a61-3c2d8e4b7a10'::uuid, p_audit::text || ':' || p_item::text);
$$;
revoke all on function public.hse_response_uuid(uuid, uuid) from public, anon;
grant execute on function public.hse_response_uuid(uuid, uuid) to authenticated;

-- Respuestas de ejemplo con un perfil de desempeño (determinístico, sin azar):
-- k = (n.º de pregunta × 7 + semilla) mod 10 se reparte en OK / OPM / OBS / NC.
create or replace function public.hse_demo_answer(p_profile text, p_rn int, p_seed int)
returns text language sql immutable set search_path = public as $$
  select case p_profile
    when 'muy_bueno' then case when k < 7 then 'ok' when k < 9 then 'opm' else 'obs' end
    when 'regular'   then case when k < 4 then 'ok' when k < 5 then 'opm' when k < 7 then 'obs' else 'nc' end
    when 'critico'   then case when k < 2 then 'ok' when k < 3 then 'opm' when k < 5 then 'obs' else 'nc' end
    else 'ok' end
  from (select ((p_rn * 7 + p_seed) % 10) as k) x;
$$;
revoke all on function public.hse_demo_answer(text, int, int) from public, anon;
grant execute on function public.hse_demo_answer(text, int, int) to authenticated;

-- hallazgos de la auditoría con las respuestas del Excel (parte de hse_load_demo)
create or replace function public.hse_demo_findings_main(org uuid, uid uuid, a1 uuid, vh uuid, c1 uuid, l2 uuid, excel jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare f uuid; x record; it record;
begin
  for x in select * from (values
      (33, 'Matriz de peligros y aspectos ambientales no presentada al cliente',
       'La matriz de identificación de peligros y evaluación de riesgos del servicio de pulling existe en borrador (rev. 0, sin aprobación) y no fue entregada al cliente.',
       'nc_menor', 'alta', 'cinco_porques',
       '{"whys":["La matriz no fue entregada al cliente","Quedó en borrador sin aprobación","No hay responsable asignado para aprobarla","El procedimiento de gestión de riesgos no define aprobaciones","El procedimiento no se actualizó al iniciar el contrato"]}',
       'El procedimiento de gestión de riesgos no define quién aprueba la matriz ni cuándo se entrega al cliente.',
       'verificado'),
      (47, 'Programa de capacitación SMS sin definición por puesto',
       'El programa anual de capacitación 2026 lista cursos generales; no identifica la capacitación requerida para cada puesto (operador de pulling, chofer, supervisor).',
       'nc_menor', 'media', 'ishikawa',
       '{"ishikawa":{"metodo":"No existe matriz de competencias por puesto","mano_obra":"Responsable de RRHH sin formación en SMS","medicion":"No se mide la eficacia de las capacitaciones"}}',
       'No existe una matriz de competencias por puesto que alimente el programa de capacitación.',
       'cerrado'),
      (74, 'Gestión de residuos sin procedimiento ni registros de disposición',
       'En la locación se observaron residuos especiales (trapos con hidrocarburos) mezclados con residuos asimilables a domiciliarios. No hay manifiestos de transporte de los últimos 3 meses.',
       'no_conformidad', 'alta', 'cinco_porques',
       '{"whys":["Residuos especiales mezclados con domiciliarios","No hay contenedores diferenciados en la locación","No se solicitaron al iniciar el servicio","No existe procedimiento de gestión de residuos","No se identificó el requisito legal aplicable"]}',
       'No se identificaron los requisitos legales de residuos peligrosos (Ley 24.051) aplicables al servicio.',
       'en_tratamiento'),
      (86, 'Sin evaluación de desempeño de proveedores críticos',
       'No se presentó registro de calificación ni evaluación periódica de los subcontratistas (incluye a Montajes Industriales del Sur).',
       'nc_menor', 'media', null, null, null, 'abierto'),
      (103, 'No se verifica la eficacia de las acciones tomadas',
       'De 6 no conformidades internas cerradas en 2026, ninguna tiene registro de verificación de eficacia.',
       'nc_menor', 'media', null, null, null, 'abierto')
    ) as t(rownum, title, descr, ftype, sev, rca, rca_data, root, final_status) loop
    select i.id, i.question into it from hse_template_items i where i.version_id = vh and i.source_ref = '''Table 1''!E' || x.rownum;
    f := gen_random_uuid();
    insert into hse_findings (id, organization_id, audit_id, response_id, title, description, requirement, finding_type, severity,
                              responsible_user_id, due_date, immediate_action, company_id, location_id)
      values (f, org, a1, hse_response_uuid(a1, it.id), x.title, x.descr, btrim(it.question), x.ftype::hse_finding_type, x.sev::hse_severity,
              uid, current_date + case x.final_status when 'abierto' then 10 else 30 end,
              case when x.rownum = 74 then 'Se segregaron los residuos especiales en contenedor identificado el mismo día.' end, c1, l2);
    if x.rca is not null then
      update hse_findings set root_cause = x.root, rca_method = x.rca, rca_data = x.rca_data::jsonb where id = f;
    end if;
    if x.final_status = 'verificado' then
      insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date)
        values (org, f, 'Aprobar la matriz de peligros rev. 1 y entregarla al cliente; definir en el procedimiento quién la aprueba y cuándo se revisa.', 'correctiva', c1, current_date - 100);
      update hse_actions set status = 'completada', progress_notes = 'Matriz rev. 1 aprobada por Gerencia y enviada por nota.' where finding_id = f;
      update hse_actions set status = 'verificada', effectiveness = 'eficaz', verification_notes = 'Se verificó la matriz aprobada y su uso en el permiso de trabajo.' where finding_id = f;
      update hse_findings set status = 'cerrado' where id = f;
      update hse_findings set status = 'verificado', effectiveness = 'eficaz', verification_notes = 'Matriz vigente y difundida; sin desvíos en la auditoría de seguimiento.' where id = f;
    elsif x.final_status = 'cerrado' then
      insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date, effectiveness_criteria)
        values (org, f, 'Elaborar la matriz de competencias por puesto y rehacer el programa de capacitación 2026.', 'correctiva', c1, current_date - 40,
                'El 100 % de los puestos operativos tiene capacitación asignada y registrada.');
      update hse_actions set status = 'completada', progress_notes = 'Matriz de competencias aprobada; programa reemitido.' where finding_id = f;
      update hse_findings set status = 'cerrado' where id = f;
    elsif x.final_status = 'en_tratamiento' then
      insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date, effectiveness_criteria) values
        (org, f, 'Redactar el procedimiento de gestión de residuos y contratar transportista habilitado de residuos peligrosos.', 'correctiva', c1, current_date - 7,
         'Manifiestos de transporte disponibles para el 100 % de los retiros.'),
        (org, f, 'Incorporar la identificación de requisitos legales ambientales al inicio de cada contrato.', 'preventiva', c1, current_date + 20, null);
      update hse_actions set status = 'en_curso', progress_notes = 'Procedimiento en revisión; transportista en proceso de alta.' where finding_id = f and action_type = 'correctiva';
      update hse_findings set status = 'en_tratamiento' where id = f;
    else
      -- responsable: el propio usuario, para que reciba los avisos de vencimiento
      insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, responsible_user_id, due_date)
        values (org, f, case when x.rownum = 86 then 'Implementar la calificación y evaluación anual de subcontratistas.'
                             else 'Incorporar la verificación de eficacia al procedimiento de no conformidades.' end,
                'correctiva', c1, uid, current_date + case when x.rownum = 86 then 5 else 25 end);
    end if;
  end loop;

  -- observación con oportunidad de mejora (preventiva)
  select i.id, i.question into it from hse_template_items i
   where i.version_id = vh and (excel ->> i.id::text) = 'obs' order by i.sort_order limit 1;
  insert into hse_findings (id, organization_id, audit_id, response_id, title, description, requirement, finding_type, severity, responsible_user_id, due_date, company_id, location_id)
    values (gen_random_uuid(), org, a1, hse_response_uuid(a1, it.id), 'Registro incompleto del requisito', 'El registro existe pero está incompleto o desactualizado.',
            btrim(it.question), 'observacion', 'baja', uid, current_date + 45, c1, l2) returning id into f;
  insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date)
    values (org, f, 'Actualizar el registro y definir frecuencia de revisión.', 'preventiva', c1, current_date + 30);

  -- ------------------------------------------------------------ hallazgos de las auditorías 2, 3 y 4
end $$;
revoke all on function public.hse_demo_findings_main(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.hse_demo_findings_main(uuid, uuid, uuid, uuid, uuid, uuid, jsonb) to authenticated;

-- hallazgos de las demás auditorías de ejemplo (parte de hse_load_demo)
create or replace function public.hse_demo_findings_more(org uuid, uid uuid, a1 uuid, a2 uuid, a3 uuid, a4 uuid, a5 uuid, vp uuid,
                                                         c1 uuid, c2 uuid, c3 uuid, l1 uuid, l2 uuid, l3 uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare f uuid; x record; it record; n int;
  nc_comment constant text := 'Se solicitó la evidencia del requisito y no fue presentada durante la auditoría.';
begin
  for x in select * from (values (a2, c2, l1, 'opm', 2), (a3, c3, l3, 'nc', 4), (a4, c1, l2, 'nc', 3)) as t(aud, comp, loc, ans, lim) loop
    n := 0;
    for it in
      select i.id, i.question, exists (select 1 from hse_findings ff where ff.audit_id = a1 and ff.item_id = i.id and x.aud = a4) as repeated
        from hse_audit_responses rr join hse_template_items i on i.id = rr.item_id
       where rr.audit_id = x.aud and rr.answer = x.ans
       order by exists (select 1 from hse_findings ff where ff.audit_id = a1 and ff.item_id = i.id and x.aud = a4) desc, i.sort_order
       limit x.lim loop
      n := n + 1; f := gen_random_uuid();
      insert into hse_findings (id, organization_id, audit_id, response_id, title, description, requirement, finding_type, severity,
                                responsible_user_id, due_date, company_id, location_id)
        values (f, org, x.aud, hse_response_uuid(x.aud, it.id),
                left(regexp_replace(btrim(it.question), '\s+', ' ', 'g'), 110),
                case when x.ans = 'opm' then 'Se cumple el requisito; se identifica una mejora posible en la sistematización de los registros.'
                     when it.repeated then 'El desvío ya había sido detectado en la auditoría CSMS anterior y persiste.'
                     else nc_comment end,
                btrim(it.question),
                case x.ans when 'opm' then 'oportunidad_mejora' else 'no_conformidad' end::hse_finding_type,
                case when x.ans = 'opm' then 'baja' when it.repeated or n = 1 then 'alta' else 'media' end::hse_severity,
                uid, current_date + case when x.aud = a3 then -5 else 30 end, x.comp, x.loc);
      insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date)
        values (org, f,
                case when x.ans = 'opm' then 'Digitalizar el registro y revisarlo en la reunión mensual de SMS.'
                     else 'Presentar el plan de implementación del requisito con responsables y fechas, y la evidencia de cumplimiento.' end,
                case when x.ans = 'opm' then 'preventiva' else 'correctiva' end::hse_action_type, x.comp,
                current_date + case when x.aud = a3 then -10 + n * 4 else 25 end);
    end loop;
  end loop;

  -- hallazgos de la inspección ponderada: uno cerrado y verificado, otro en tratamiento
  for it in select i.id, i.question, i.sort_order from hse_template_items i where i.version_id = vp and i.sort_order in (5, 10) loop
    f := gen_random_uuid();
    insert into hse_findings (id, organization_id, audit_id, response_id, title, description, requirement, finding_type, severity,
                              responsible_user_id, due_date, root_cause, company_id, location_id, legal_reference)
      values (f, org, a5, hse_response_uuid(a5, it.id), case it.sort_order when 5 then 'Entrega de EPP sin registro firmado' else 'Extintor con carga vencida' end,
              case it.sort_order when 5 then 'Tres choferes ingresados en el mes no tienen firmada la planilla de entrega de EPP.'
                                 else 'El extintor ABC de 10 kg del sector de carga tiene vencimiento 05/2026.' end,
              btrim(it.question), 'nc_menor', case it.sort_order when 10 then 'alta' else 'media' end::hse_severity, uid, current_date + 15,
              case it.sort_order when 5 then 'El alta de personal no incluye la entrega de EPP como paso obligatorio.'
                                 else 'El control de vencimientos de extintores depende de una planilla sin responsable.' end,
              c2, l1, case it.sort_order when 5 then 'Res. SRT 299/11' else 'Dec. 351/79 art. 176' end);
    insert into hse_actions (organization_id, finding_id, description, action_type, responsible_company_id, due_date) values
      (org, f, case it.sort_order when 5 then 'Completar las planillas pendientes e incluir la entrega de EPP en el alta de personal.'
                                  else 'Recargar el extintor y asignar responsable del control mensual de extintores.' end, 'correctiva', c2, current_date - 2);
    if it.sort_order = 10 then
      update hse_actions set status = 'completada', progress_notes = 'Extintor recargado (remito adjunto en carpeta).' where finding_id = f;
      update hse_actions set status = 'verificada', effectiveness = 'eficaz', verification_notes = 'Se verificó la tarjeta de control y la carga vigente.' where finding_id = f;
      update hse_findings set status = 'cerrado' where id = f;
      update hse_findings set status = 'verificado', effectiveness = 'eficaz', verification_notes = 'Control mensual con responsable asignado; sin vencidos en la recorrida.' where id = f;
    end if;
  end loop;

  -- ------------------------------------------------------------ completar (el servidor valida y calcula el puntaje oficial)
end $$;
revoke all on function public.hse_demo_findings_more(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function public.hse_demo_findings_more(uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

create or replace function public.hse_load_demo(p_payload jsonb)
returns uuid language plpgsql security invoker set search_path = public as $$
declare
  uid uuid := auth.uid();
  org uuid; r jsonb;
  vh uuid; tp uuid; vp uuid; s uuid;
  c1 uuid; c2 uuid; c3 uuid; l1 uuid; l2 uuid; l3 uuid;
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); a4 uuid := gen_random_uuid();
  a5 uuid := gen_random_uuid(); a6 uuid := gen_random_uuid(); a7 uuid := gen_random_uuid(); a8 uuid := gen_random_uuid();
  excel jsonb; f uuid; x record; n int; m int; it record; prev_sec int := 0;
  nc_comment constant text := 'Se solicitó la evidencia del requisito y no fue presentada durante la auditoría.';
begin
  if uid is null then raise exception 'Debe iniciar sesión' using errcode = '42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload -> 'sections') <> 'array' then
    raise exception 'Falta la plantilla H&P de ejemplo' using errcode = '22023';
  end if;
  if exists (select 1 from hse_memberships m join hse_organizations o on o.id = m.organization_id
             where m.user_id = uid and m.active and o.name = 'Organización de ejemplo') then
    raise exception 'Ya tiene una organización de ejemplo' using errcode = 'HS422';
  end if;

  org := hse_create_organization('Organización de ejemplo', null);

  -- ------------------------------------------------------------ empresas y ubicaciones (ficticias)
  insert into hse_companies (organization_id, name, company_type, csms_status, csms_valid_until, contact_name)
    values (org, 'Servicios Petroleros del Comahue S.A. (ejemplo)', 'contratista', 'condicional', current_date + 120, 'Jefatura HSE')
    returning id into c1;
  insert into hse_companies (organization_id, name, company_type, csms_status, csms_valid_until, contact_name)
    values (org, 'Transportes Cuenca Neuquina S.R.L. (ejemplo)', 'contratista', 'aprobada', current_date + 300, 'Responsable de flota')
    returning id into c2;
  insert into hse_companies (organization_id, name, company_type, parent_company_id, csms_status, contact_name)
    values (org, 'Montajes Industriales del Sur (ejemplo)', 'subcontratista', c1, 'rechazada', 'Supervisor de obra')
    returning id into c3;
  insert into hse_locations (organization_id, name, location_type, address) values (org, 'Base operativa Añelo', 'base', 'Añelo, Neuquén') returning id into l1;
  insert into hse_locations (organization_id, name, location_type, address) values (org, 'Yacimiento Sierra Blanca – PAD 14', 'yacimiento', 'Neuquén') returning id into l2;
  insert into hse_locations (organization_id, name, location_type, address) values (org, 'Taller de mantenimiento Plottier', 'planta', 'Plottier, Neuquén') returning id into l3;

  -- ------------------------------------------------------------ plantilla H&P (camino normal de publicación)
  r := hse_import_template(org, p_payload);
  vh := (r ->> 'version_id')::uuid;
  update hse_template_import_issues set status = 'aceptada', resolution_note = 'Revisada al crear la organización de ejemplo.'
   where version_id = vh and status = 'pendiente';
  perform hse_validate_template_version(vh, 'Organización de ejemplo: el caso de validación reproduce el resultado del Excel (6,27 – Bueno).');
  perform hse_publish_template_version(vh);
  select answers into excel from hse_template_validation_cases where version_id = vh and deleted_at is null order by created_at limit 1;

  -- ------------------------------------------------------------ plantilla ponderada
  insert into hse_templates (organization_id, name, category, description)
    values (org, 'Inspección de seguridad e higiene en obra', 'seguridad_higiene', 'Recorrida de campo: orden, EPP, trabajos de riesgo y emergencias. Puntaje ponderado (cumple / no cumple).')
    returning id into tp;
  insert into hse_template_versions (organization_id, template_id, version_number, change_notes)
    values (org, tp, 1, 'Versión inicial (ejemplo)') returning id into vp;
  n := 0;
  for x in select * from (values
      (1, 'Orden y limpieza', 'Sectores de trabajo ordenados, libres de obstáculos y con residuos segregados', 1, false, 'Res. SRT 295/03'),
      (1, 'Orden y limpieza', 'Vías de circulación y salidas de emergencia señalizadas y despejadas', 2, false, 'Dec. 351/79 art. 172'),
      (1, 'Orden y limpieza', 'Productos químicos rotulados y almacenados con su hoja de seguridad', 2, false, 'Res. SRT 801/15'),
      (2, 'Equipos de protección personal', 'Todo el personal usa el EPP indicado en el análisis de riesgo del puesto', 3, true, 'Res. SRT 299/11'),
      (2, 'Equipos de protección personal', 'Registro de entrega de EPP firmado y actualizado', 1, false, 'Res. SRT 299/11'),
      (2, 'Equipos de protección personal', 'Arneses y elementos de altura inspeccionados y en buen estado', 3, false, 'Res. SRT 61/23'),
      (3, 'Trabajos de riesgo', 'Permiso de trabajo vigente y firmado para tareas en caliente, altura o espacios confinados', 3, false, null),
      (3, 'Trabajos de riesgo', 'Bloqueo y etiquetado de energías aplicado en intervenciones de mantenimiento', 3, false, null),
      (3, 'Trabajos de riesgo', 'Herramientas eléctricas con protección diferencial y cables en buen estado', 2, false, 'Dec. 351/79 Anexo VI'),
      (4, 'Emergencias', 'Extintores con carga vigente, señalizados y accesibles', 2, false, 'Dec. 351/79 art. 176'),
      (4, 'Emergencias', 'Botiquín completo y personal capacitado en primeros auxilios', 1, false, null),
      (4, 'Emergencias', 'Plan de respuesta a emergencias difundido y simulacro en los últimos 12 meses', 2, false, null)
    ) as t(sec, title, question, weight, critical, legal) loop
    select id into s from hse_template_sections where version_id = vp and title = x.title and deleted_at is null;
    if s is null then
      insert into hse_template_sections (organization_id, version_id, title, sort_order) values (org, vp, x.title, x.sec) returning id into s;
    end if;
    n := n + 1;
    m := case when x.sec = prev_sec then m + 1 else 1 end; prev_sec := x.sec;
    insert into hse_template_items (organization_id, version_id, section_id, code, question, response_type, weight, is_critical,
                                    evidence_required_on_fail, legal_reference, sort_order)
      values (org, vp, s, x.sec || '.' || m, x.question, 'cumplimiento', x.weight, x.critical, false, x.legal, n);
    s := null;
  end loop;
  perform hse_publish_template_version(vp);

  -- ------------------------------------------------------------ auditorías
  insert into hse_audits (id, organization_id, template_version_id, company_id, location_id, title, audit_type, status, scheduled_date, audit_team, scope) values
    (a1, org, vh, c1, l2, 'CSMS a segundas partes – Servicios Petroleros del Comahue', 'csms', 'en_curso', current_date - 150,
     'Auditor líder y referente HSE del cliente', 'Sistema de gestión SMS del contratista para el servicio de pulling en Sierra Blanca.'),
    (a2, org, vh, c2, l1, 'CSMS a segundas partes – Transportes Cuenca Neuquina', 'csms', 'en_curso', current_date - 95,
     'Auditor líder', 'Gestión de flota pesada y liviana afectada al contrato de transporte de fluidos.'),
    (a3, org, vh, c3, l3, 'CSMS a segundas partes – Montajes Industriales del Sur', 'csms', 'en_curso', current_date - 60,
     'Auditor líder', 'Montaje y mantenimiento mecánico en taller y locación.'),
    (a4, org, vh, c1, l2, 'Seguimiento CSMS – Servicios Petroleros del Comahue', 'seguimiento', 'en_curso', current_date - 20,
     'Auditor líder', 'Verificación del plan de acción de la auditoría CSMS anterior.'),
    (a5, org, vp, c2, l1, 'Inspección de seguridad e higiene – Base Añelo', 'interna', 'en_curso', current_date - 30,
     'Auditor líder', 'Recorrida por playa de camiones, taller y depósito.'),
    (a6, org, vh, c2, l1, 'CSMS de renovación – Transportes Cuenca Neuquina', 'csms', 'planificada', current_date - 5, null, null),
    (a7, org, vp, c3, l3, 'Inspección de seguridad e higiene – Taller Plottier', 'interna', 'planificada', current_date + 15, null, null),
    (a8, org, vh, c3, l3, 'CSMS de seguimiento – Montajes Industriales del Sur', 'seguimiento', 'en_curso', current_date - 1,
     'Auditor líder', 'Verificación del plan de acción (en ejecución).');

  -- respuestas: A1 = respuestas del Excel; el resto con perfiles de desempeño
  insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer, comment)
    select hse_response_uuid(a1, e.key::uuid), org, a1, e.key::uuid, e.value #>> '{}',
           case when e.value #>> '{}' = 'nc' then nc_comment end
      from jsonb_each(excel) e;
  for x in select * from (values (a2, 'muy_bueno', 3, 999), (a3, 'critico', 5, 999), (a4, 'regular', 1, 999), (a8, 'regular', 2, 40)) as t(aud, prof, seed, lim) loop
    insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer, comment)
      select hse_response_uuid(x.aud, q.id), org, x.aud, q.id, hse_demo_answer(x.prof, q.rn::int, x.seed),
             case when hse_demo_answer(x.prof, q.rn::int, x.seed) = 'nc' then nc_comment end
        from (select i.id, row_number() over (order by sec.sort_order, i.sort_order) rn
                from hse_template_items i join hse_template_sections sec on sec.id = i.section_id
               where i.version_id = vh and i.deleted_at is null and sec.deleted_at is null) q
       where q.rn <= x.lim;
  end loop;
  -- la auditoría de seguimiento repite dos desvíos de la primera (residuos y verificación de eficacia):
  -- el servidor los marcará como recurrentes
  update hse_audit_responses rr set answer = 'nc', comment = 'El desvío detectado en la auditoría anterior persiste.'
    from hse_template_items i
   where rr.audit_id = a4 and i.id = rr.item_id and i.source_ref in ('''Table 1''!E74', '''Table 1''!E103');
  insert into hse_audit_responses (id, organization_id, audit_id, item_id, answer, comment)
    select hse_response_uuid(a5, i.id), org, a5, i.id,
           case when i.sort_order in (5, 10) then 'no_cumple' else 'cumple' end,
           case i.sort_order when 5 then 'Faltan firmas de entrega de EPP de 3 choferes ingresados en el mes.'
                             when 10 then 'Extintor del sector de carga con vencimiento 05/2026.' end
      from hse_template_items i where i.version_id = vp and i.deleted_at is null;

  -- ------------------------------------------------------------ hallazgos de la auditoría 1 (Excel)
  -- R33: identificación de peligros → verificado (ciclo completo)
  perform hse_demo_findings_main(org, uid, a1, vh, c1, l2, excel);
  perform hse_demo_findings_more(org, uid, a1, a2, a3, a4, a5, vp, c1, c2, c3, l1, l2, l3);

  update hse_audits set summary = 'Desempeño Bueno (6,27). Se detectaron 13 NC, 14 OBS y 7 OPM; las NC prioritarias son residuos, gestión de riesgos y verificación de eficacia.' where id = a1;
  update hse_audits set summary = 'Desempeño Muy Bueno. Sistema de gestión maduro; oportunidades de mejora en la digitalización de registros.' where id = a2;
  update hse_audits set summary = 'Desempeño Crítico. El subcontratista no tiene implementados los requisitos básicos del sistema de gestión SMS.' where id = a3;
  update hse_audits set summary = 'Persisten desvíos de la auditoría anterior; ver hallazgos recurrentes.' where id = a4;
  update hse_audits set summary = 'Instalaciones en general ordenadas. Dos desvíos: registro de EPP y extintor vencido.' where id = a5;
  update hse_audits set status = 'completada' where id in (a1, a2, a3, a4, a5);

  perform hse_refresh_notifications(org);
  return org;
end $$;
revoke all on function public.hse_load_demo(jsonb) from public, anon;
grant execute on function public.hse_load_demo(jsonb) to authenticated;
