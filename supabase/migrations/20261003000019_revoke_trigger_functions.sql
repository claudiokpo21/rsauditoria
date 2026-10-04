-- =====================================================================
-- HSE Audit Manager · 0019 · Mínimo privilegio en funciones de trigger
-- Las funciones de trigger no se invocan por RPC; PostgreSQL sólo verifica
-- EXECUTE al crear el trigger, no al dispararlo. Se retira EXECUTE a todos los
-- roles de la API (aviso 0028/0029 del asesor de seguridad de Supabase).
-- hse_try_uuid lo usan las políticas de Storage: queda sólo para authenticated.
-- =====================================================================
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'hse\_%' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
revoke all on function public.hse_try_uuid(text) from public, anon;
grant execute on function public.hse_try_uuid(text) to authenticated;
