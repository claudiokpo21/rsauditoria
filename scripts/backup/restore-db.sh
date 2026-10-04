#!/usr/bin/env bash
# =====================================================================
# Restauración en una base NUEVA (proyecto Supabase vacío o PostgreSQL de prueba).
#  1. Aplica las migraciones (esquema, funciones, RLS, Storage) en orden.
#  2. Carga los datos del respaldo con los triggers desactivados (session_replication_role = replica):
#     así no se re-ejecutan reglas de negocio ni se regeneran códigos, fechas o historial.
#  3. Compara la huella del destino con la del respaldo. Termina con error si difiere.
#
#   DB_URL=... scripts/backup/restore-db.sh respaldos/2026-10-03 [--sin-migraciones]
# =====================================================================
set -euo pipefail
IN="${1:?carpeta del respaldo}"; : "${DB_URL:?Defina DB_URL del destino}"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
sha_ok=$(grep 'datos.dump sha256' "$IN/manifest.txt" | cut -d' ' -f3)
[ "$sha_ok" = "$(sha256sum "$IN/datos.dump" | cut -d' ' -f1)" ] || { echo "El archivo del respaldo está alterado (sha256)"; exit 2; }
if [ "${2:-}" != "--sin-migraciones" ]; then
  for f in "$ROOT"/supabase/migrations/*.sql; do psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$f" > /dev/null; done
fi
# las migraciones crean el bucket y datos iniciales: se vacían las tablas de la app antes de cargar
psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 <<'SQL'
set session_replication_role = replica;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'hse\_%' loop
    execute format('truncate table public.%I cascade', t);
  end loop;
end $$;
SQL
# triggers desactivados durante la carga (requiere poder fijar session_replication_role; en Supabase lo puede el rol postgres)
PGOPTIONS='-c session_replication_role=replica' pg_restore --data-only --no-owner --no-privileges --single-transaction \
  --dbname="$DB_URL" "$IN/datos.dump"
psql "$DB_URL" -X -A -t -F $'\t' -f "$HERE/checksums.sql" > "$IN/huella-restaurada.tsv"
if diff -u "$IN/huella.tsv" "$IN/huella-restaurada.tsv"; then echo "Restauración verificada: huella idéntica."; else echo "LA HUELLA DIFIERE"; exit 3; fi
