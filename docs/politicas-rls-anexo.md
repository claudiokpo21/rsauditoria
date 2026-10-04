# Anexo: políticas RLS vigentes

Generado desde `pg_policies` (migraciones 0001–0023). Todas aplican al rol `authenticated`; `anon` no tiene privilegios.

`USING` filtra las filas que se ven/modifican; `WITH CHECK` valida la fila resultante.


## `storage.objects`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_evid_obj_delete | DELETE | `((bucket_id = 'hse-evidencias'::text) AND hse_has_role(hse_try_uuid((storage.foldername(name))[1]), '{owner,admin}'::hse_role[]))` | — |
| hse_evid_obj_insert | INSERT | — | `((bucket_id = 'hse-evidencias'::text) AND (hse_try_uuid((storage.foldername(name))[1]) IS NOT NULL) AND (hse_try_uuid((storage.foldername(name))[2]) IS NOT NULL) AND hse_can_upload_evidence(hse_try_uuid((storage.foldername(name))[1]), hse_try_uuid((storage.foldername(name))[2])))` |
| hse_evid_obj_select | SELECT | `((bucket_id = 'hse-evidencias'::text) AND hse_is_member(hse_try_uuid((storage.foldername(name))[1])) AND (EXISTS ( SELECT 1 FROM hse_evidences e WHERE (e.storage_path = objects.name))))` | — |
| hse_evid_obj_update | UPDATE | `false` | `((bucket_id = 'hse-evidencias'::text) AND hse_is_member(hse_try_uuid((storage.foldername(name))[1])))` |

## `hse_actions`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_actions_delete | DELETE | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | — |
| hse_actions_insert | INSERT | — | `(hse_finding_role(finding_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |
| hse_actions_select | SELECT | `(hse_action_role_row(organization_id, finding_id, responsible_user_id, responsible_company_id) IS NOT NULL)` | — |
| hse_actions_update | UPDATE | `(hse_action_role_row(organization_id, finding_id, responsible_user_id, responsible_company_id) = ANY (ARRAY['gestion'::text, 'escritura'::text, 'avance'::text]))` | `hse_is_member(organization_id)` |

## `hse_audit_participants`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_participants_delete | DELETE | `(hse_audit_role(audit_id) = 'gestion'::text)` | — |
| hse_participants_insert | INSERT | — | `(hse_audit_role(audit_id) = 'gestion'::text)` |
| hse_participants_select | SELECT | `(hse_audit_role(audit_id) IS NOT NULL)` | — |
| hse_participants_update | UPDATE | `(hse_audit_role(audit_id) = 'gestion'::text)` | `(hse_audit_role(audit_id) = 'gestion'::text)` |

## `hse_audit_responses`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_responses_delete | DELETE | `(hse_audit_role(audit_id) = 'gestion'::text)` | — |
| hse_responses_insert | INSERT | — | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |
| hse_responses_select | SELECT | `(hse_audit_role(audit_id) IS NOT NULL)` | — |
| hse_responses_update | UPDATE | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |

## `hse_audits`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_audits_delete | DELETE | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND (status = 'planificada'::hse_audit_status))` | — |
| hse_audits_insert | INSERT | — | `(hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[]) OR (hse_has_role(organization_id, '{auditor}'::hse_role[]) AND (lead_auditor_id = auth.uid())))` |
| hse_audits_select | SELECT | `(hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) IS NOT NULL)` | — |
| hse_audits_update | UPDATE | `(hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` | `(hse_audit_role_row(organization_id, id, company_id, lead_auditor_id, created_by) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |

## `hse_change_log`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_change_log_select | SELECT | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | — |

## `hse_companies`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_companies_delete | DELETE | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | — |
| hse_companies_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_companies_select | SELECT | `hse_can_access_company(organization_id, id)` | — |
| hse_companies_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_evidences`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_evidences_delete | DELETE | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | — |
| hse_evidences_insert | INSERT | — | `((hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text])) OR ((action_id IS NOT NULL) AND (hse_action_role(action_id) = 'avance'::text)))` |
| hse_evidences_select | SELECT | `((hse_audit_role(audit_id) IS NOT NULL) OR ((action_id IS NOT NULL) AND (hse_action_role(action_id) IS NOT NULL)) OR ((finding_id IS NOT NULL) AND (hse_finding_role(finding_id) IS NOT NULL)))` | — |
| hse_evidences_update | UPDATE | `(((uploaded_by = auth.uid()) AND ((hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text])) OR ((action_id IS NOT NULL) AND (hse_action_role(action_id) = 'avance'::text)))) OR (hse_audit_role(audit_id) = 'gestion'::text))` | `(((uploaded_by = auth.uid()) AND ((hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text])) OR ((action_id IS NOT NULL) AND (hse_action_role(action_id) = 'avance'::text)))) OR (hse_audit_role(audit_id) = 'gestion'::text))` |

## `hse_findings`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_findings_delete | DELETE | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND (status = 'abierto'::hse_finding_status))` | — |
| hse_findings_insert | INSERT | — | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |
| hse_findings_select | SELECT | `(hse_finding_role_row(organization_id, id, audit_id, company_id) IS NOT NULL)` | — |
| hse_findings_update | UPDATE | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` | `(hse_audit_role(audit_id) = ANY (ARRAY['gestion'::text, 'escritura'::text]))` |

## `hse_invitations`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_invitations_all | ALL | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` |

## `hse_locations`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_locations_delete | DELETE | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | — |
| hse_locations_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_locations_select | SELECT | `hse_is_member(organization_id)` | — |
| hse_locations_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_memberships`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_memberships_delete | DELETE | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND ((role <> 'owner'::hse_role) OR hse_has_role(organization_id, '{owner}'::hse_role[])))` | — |
| hse_memberships_insert | INSERT | — | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND ((role <> 'owner'::hse_role) OR hse_has_role(organization_id, '{owner}'::hse_role[])))` |
| hse_memberships_select | SELECT | `((user_id = auth.uid()) OR hse_has_role(organization_id, '{owner,admin,supervisor,auditor,viewer}'::hse_role[]))` | — |
| hse_memberships_update | UPDATE | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND ((role <> 'owner'::hse_role) OR hse_has_role(organization_id, '{owner}'::hse_role[])))` | `(hse_has_role(organization_id, '{owner,admin}'::hse_role[]) AND ((role <> 'owner'::hse_role) OR hse_has_role(organization_id, '{owner}'::hse_role[])))` |

## `hse_notifications`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_notifications_select | SELECT | `((user_id = auth.uid()) AND hse_is_member(organization_id))` | — |
| hse_notifications_update | UPDATE | `(user_id = auth.uid())` | `(user_id = auth.uid())` |

## `hse_organizations`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_org_delete | DELETE | `hse_has_role(id, '{owner}'::hse_role[])` | — |
| hse_org_select | SELECT | `hse_is_member(id)` | — |
| hse_org_update | UPDATE | `hse_has_role(id, '{owner,admin}'::hse_role[])` | `hse_has_role(id, '{owner,admin}'::hse_role[])` |

## `hse_processes`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_processes_write | ALL | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_processes_select | SELECT | `hse_is_member(organization_id)` | — |

## `hse_profiles`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_profiles_insert | INSERT | — | `(id = auth.uid())` |
| hse_profiles_select | SELECT | `hse_profile_visible(id)` | — |
| hse_profiles_update | UPDATE | `(id = auth.uid())` | `((id = auth.uid()) AND ((default_organization_id IS NULL) OR hse_is_member(default_organization_id)))` |

## `hse_reopen_log`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_reopen_log_select | SELECT | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | — |

## `hse_sync_events`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_sync_events_insert | INSERT | — | `((user_id = auth.uid()) AND hse_is_member(organization_id))` |
| hse_sync_events_select | SELECT | `((user_id = auth.uid()) OR hse_has_role(organization_id, '{owner,admin}'::hse_role[]))` | — |

## `hse_sync_receipts`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_sync_receipts_insert | INSERT | — | `((user_id = auth.uid()) AND hse_is_member(organization_id))` |
| hse_sync_receipts_select | SELECT | `((user_id = auth.uid()) OR hse_has_role(organization_id, '{owner,admin}'::hse_role[]))` | — |

## `hse_template_import_issues`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_import_issues_select | SELECT | `hse_has_role(organization_id, '{owner,admin,supervisor,auditor}'::hse_role[])` | — |
| hse_import_issues_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_template_items`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_template_items_delete | DELETE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | — |
| hse_template_items_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_template_items_select | SELECT | `hse_is_member(organization_id)` | — |
| hse_template_items_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_template_sections`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_template_sections_delete | DELETE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | — |
| hse_template_sections_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_template_sections_select | SELECT | `hse_is_member(organization_id)` | — |
| hse_template_sections_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_template_validation_cases`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_validation_cases_select | SELECT | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | — |

## `hse_template_versions`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_template_versions_delete | DELETE | `(hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[]) AND (status = 'borrador'::hse_version_status))` | — |
| hse_template_versions_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_template_versions_select | SELECT | `hse_is_member(organization_id)` | — |
| hse_template_versions_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## `hse_templates`

| Política | Operación | USING | WITH CHECK |
|---|---|---|---|
| hse_templates_delete | DELETE | `hse_has_role(organization_id, '{owner,admin}'::hse_role[])` | — |
| hse_templates_insert | INSERT | — | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |
| hse_templates_select | SELECT | `hse_is_member(organization_id)` | — |
| hse_templates_update | UPDATE | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` | `hse_has_role(organization_id, '{owner,admin,supervisor}'::hse_role[])` |

## Tablas con RLS sin políticas (acceso sólo por funciones del servidor)

- `hse_counters` — numeración AUD-/HAL-; sólo `hse_next_code` (verifica membresía).
