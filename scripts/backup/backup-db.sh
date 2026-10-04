#!/usr/bin/env bash
# =====================================================================
# Respaldo lógico de la base (datos de la aplicación + usuarios). Los ARCHIVOS de evidencias se
# respaldan aparte con storage-tool.mjs (los metadatos de Storage los recrea la API al restaurar).
# El ESQUEMA no se respalda aquí: su fuente de verdad son las migraciones versionadas
# (supabase/migrations). Ejecutar en un equipo de administración, NUNCA en el navegador.
#
#   DB_URL="postgresql://postgres.<ref>:<clave>@aws-0-<región>.pooler.supabase.com:5432/postgres" \
#     scripts/backup/backup-db.sh respaldos/2026-10-03
#
# Produce: datos.dump (formato custom de pg_dump), huella.tsv (filas y MD5 por tabla), manifest.txt
# =====================================================================
set -euo pipefail
OUT="${1:?carpeta de salida}"; : "${DB_URL:?Defina DB_URL (cadena de conexión con el rol postgres)}"
mkdir -p "$OUT"
HERE="$(cd "$(dirname "$0")" && pwd)"
pg_dump "$DB_URL" --data-only --format=custom --no-owner --no-privileges \
  --table='public.hse_*' --table='auth.users' --table='auth.identities' \
  --file="$OUT/datos.dump"
psql "$DB_URL" -X -A -t -F $'\t' -f "$HERE/checksums.sql" > "$OUT/huella.tsv"
{
  echo "fecha: $(date -u +%FT%TZ)"
  echo "migraciones: $(ls "$HERE/../../supabase/migrations" | tail -1)"
  echo "datos.dump sha256: $(sha256sum "$OUT/datos.dump" | cut -d' ' -f1)"
} > "$OUT/manifest.txt"
echo "Respaldo de base listo en $OUT ($(du -h "$OUT/datos.dump" | cut -f1))."
