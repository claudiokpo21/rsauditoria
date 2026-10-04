-- Huella de los datos de la aplicación: filas y MD5 por tabla (orden canónico por texto de fila).
-- Se usa para comprobar que un respaldo restaurado es idéntico al origen.
select t.tablename as tabla,
       (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.tablename), false, false, '')))[1]::text::bigint as filas,
       (xpath('/row/h/text()', query_to_xml(format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) as h from public.%I x', '|', '', t.tablename), false, false, '')))[1]::text as md5
from pg_tables t where t.schemaname = 'public' and t.tablename like 'hse\_%'
union all
select 'auth.users', count(*), md5(coalesce(string_agg(u.id::text || u.email, '|' order by u.id), '')) from auth.users u
order by 1;
