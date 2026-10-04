-- Organización de ejemplo (0024). Ejecutar con psql desde la raíz del repo (lee el payload H&P). Se revierte sola.
-- psql "$DB_URL" -f supabase/tests/demo_organization.sql
-- Esperado: 6,27 Bueno con secciones 16/24 63/90 65/84 4/12 5/9 22/30; Muy Bueno, Crítico, Regular; 3 recurrentes; segundo intento rechazado.
\set payload `cat src/modules/demo/hp-payload.json`
begin;
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'demo_test@example.com', now(), '{"full_name":"Usuario Demo"}', now(), now());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
select hse_bootstrap() is not null as boot;
select hse_load_demo(:'payload'::jsonb) as org \gset
select a.title, a.status, a.score, a.compliance_pct, a.result_band from hse_audits a where organization_id = :'org' order by scheduled_date;
select (select string_agg(s->>'raw' || '/' || (s->>'target') || '=' || round((s->>'score')::numeric,2), '  ') from jsonb_array_elements(section_results) s) from hse_audits where organization_id = :'org' and title like 'CSMS a segundas partes – Servicios%';
select f.status, f.finding_type, f.recurrence_count, left(f.title,50), (select string_agg(x.status::text||':'||x.due_date, ',') from hse_actions x where x.finding_id=f.id) from hse_findings f where organization_id=:'org' order by f.created_at;
select kind, count(*) from hse_notifications where organization_id=:'org' group by 1;
select count(*) as respuestas, count(distinct audit_id) from hse_audit_responses where organization_id=:'org';
select hse_load_demo(:'payload'::jsonb);
rollback;
