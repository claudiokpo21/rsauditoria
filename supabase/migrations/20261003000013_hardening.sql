-- =====================================================================
-- HSE Audit Manager · 0013 · Endurecimiento según Supabase advisors
--  * search_path fijo en todas las funciones HSE
--  * funciones de trigger SECURITY DEFINER no invocables por API
-- (las RPC expuestas a authenticated son intencionales y validan el rol)
-- =====================================================================

alter function public.hse_touch_row()                     set search_path = public;
alter function public.hse_touch_simple()                  set search_path = public;
alter function public.hse_try_uuid(text)                  set search_path = public;
alter function public.hse_guard_version_content()         set search_path = public;
alter function public.hse_guard_audit()                   set search_path = public;
alter function public.hse_guard_response()                set search_path = public;
alter function public.hse_compute_audit_score(uuid)       set search_path = public;
alter function public.hse_guard_finding()                 set search_path = public;
alter function public.hse_guard_version_status()          set search_path = public;
alter function public.hse_guard_action()                  set search_path = public;
alter function public.hse_guard_version_methodology()     set search_path = public;
alter function public.hse_guard_import_issue()            set search_path = public;

-- Las funciones de trigger no necesitan EXECUTE para dispararse
revoke all on function public.hse_guard_last_owner()             from public, anon, authenticated;
revoke all on function public.hse_invalidate_on_content_change() from public, anon, authenticated;
revoke all on function public.hse_log_change()                   from public, anon, authenticated;
revoke all on function public.hse_compute_audit_score(uuid)      from public, anon, authenticated;
