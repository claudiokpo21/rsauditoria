#!/usr/bin/env bash
# =====================================================================
# Prueba completa de respaldo y recuperación en PostgreSQL local (sin tocar el proyecto real):
#   origen con datos reales de prueba → respaldo (base + archivos) → "desastre" → restauración
#   en una base y un bucket NUEVOS → verificación de huella, archivos (SHA-256), RLS y reglas.
# Requiere PostgreSQL 15+ con pg_dump/pg_restore. Uso: PGHOST=/tmp PGPORT=55432 PGUSER=postgres scripts/backup/test-backup-restore.sh
# =====================================================================
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$HERE/../.."
WORK="${WORK:-$(mktemp -d)}"; mkdir -p "$WORK"
P="psql -X -q -v ON_ERROR_STOP=1"
SRC="${PGHOST:+host=$PGHOST} port=${PGPORT:-5432} user=${PGUSER:-postgres} dbname=hse_respaldo_src"
DST="${PGHOST:+host=$PGHOST} port=${PGPORT:-5432} user=${PGUSER:-postgres} dbname=hse_respaldo_dst"
psql -X -q -d postgres -c 'drop database if exists hse_respaldo_src' -c 'drop database if exists hse_respaldo_dst' -c 'create database hse_respaldo_src' -c 'create database hse_respaldo_dst'
res() { echo "$1" | tee -a "$WORK/resultado.txt"; }
: > "$WORK/resultado.txt"

# 1. origen: esquema + datos (ciclo de vida completo y matriz de permisos, confirmados en vez de revertidos)
$P "$SRC" -f "$ROOT/supabase/local/supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do $P "$SRC" -f "$f" > /dev/null; done
for t in findings_lifecycle authorization_matrix import_hp_parity; do
  sed -E "s/raise exception '(RESULTADO_[A-Z]+)/raise notice '\1/" "$ROOT/supabase/tests/$t.sql" | $P "$SRC" > /dev/null 2>&1
done
# archivos del bucket simulado: uno por objeto registrado (contenido aleatorio)
BUCKET_SRC="$WORK/bucket-origen"; mkdir -p "$BUCKET_SRC"
psql -X -A -t "$SRC" -c "select name from storage.objects where bucket_id = 'hse-evidencias'" | while read -r p; do
  [ -n "$p" ] || continue; mkdir -p "$BUCKET_SRC/$(dirname "$p")"; head -c $((2000 + RANDOM)) /dev/urandom > "$BUCKET_SRC/$p"; done
NFILES=$(find "$BUCKET_SRC" -type f | wc -l)
NROWS=$(psql -X -A -t "$SRC" -c "select sum(n) from (select count(*) n from hse_audits union all select count(*) from hse_findings union all select count(*) from hse_actions union all select count(*) from hse_evidences union all select count(*) from hse_audit_responses union all select count(*) from hse_change_log) x")
res "origen: $NROWS filas principales, $NFILES archivos"

# 2. respaldo
DB_URL="$SRC" "$HERE/backup-db.sh" "$WORK/respaldo" > /dev/null
psql -X -A -t "$SRC" -c "select storage_path from hse_evidences where deleted_at is null" > "$WORK/esperados.txt"
STORAGE_LOCAL_DIR="$BUCKET_SRC" node "$HERE/storage-tool.mjs" backup "$WORK/respaldo/archivos" --esperados "$WORK/esperados.txt" > "$WORK/storage-backup.json" || true
res "respaldo archivos: $(cat "$WORK/storage-backup.json")"

# 3. desastre: se pierde todo el origen
psql -X -q -d postgres -c 'drop database hse_respaldo_src'; rm -rf "$BUCKET_SRC"
res "desastre simulado: base de origen eliminada y bucket borrado"

# 4. restauración en base y bucket nuevos
$P "$DST" -f "$ROOT/supabase/local/supabase_stubs.sql"
if DB_URL="$DST" "$HERE/restore-db.sh" "$WORK/respaldo" > "$WORK/restore.log" 2>&1; then res "base: $(tail -1 "$WORK/restore.log")"; else res "FALLA base: $(tail -5 "$WORK/restore.log")"; exit 1; fi
BUCKET_DST="$WORK/bucket-nuevo"; mkdir -p "$BUCKET_DST"
res "archivos: $(STORAGE_LOCAL_DIR="$BUCKET_DST" node "$HERE/storage-tool.mjs" restore "$WORK/respaldo/archivos")"
res "verificación archivos: $(STORAGE_LOCAL_DIR="$BUCKET_DST" node "$HERE/storage-tool.mjs" verify "$WORK/respaldo/archivos")"
# re-ejecutar la restauración de archivos no duplica ni sobrescribe
res "restauración repetida: $(STORAGE_LOCAL_DIR="$BUCKET_DST" node "$HERE/storage-tool.mjs" restore "$WORK/respaldo/archivos")"

# 5. la base restaurada sigue aplicando permisos y reglas
NOTICE=$(psql -X "$DST" 2>&1 <<'SQL' | grep -o 'CHK.*'
do $$
declare u uuid; o uuid; n int; m int; rep text := '';
begin
  select m2.user_id, m2.organization_id into u, o from hse_memberships m2 where m2.role = 'auditor' and m2.active limit 1;
  select count(*) into m from hse_audits where organization_id <> o;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  select count(*) into n from hse_audits where organization_id <> o;
  rep := rep || 'auditor restaurado ve auditorías de otras organizaciones=' || n || ' (existen ' || m || '); ';
  update hse_audits set status = 'cerrada' where status = 'completada'; get diagnostics n = row_count;
  rep := rep || 'cierre directo por un auditor: filas=' || n || ' (esperado 0); ';
  select count(*) into n from hse_audits where code is null; rep := rep || 'auditorías sin código=' || n || '; ';
  raise notice 'CHK %', rep;
end $$;
SQL
)
res "base restaurada: $NOTICE"
NOTICE2=$(psql -X "$DST" 2>&1 <<'SQL' | grep -o 'CHK.*'
do $$
declare u uuid; o uuid; v uuid; c text; dup int;
begin
  select m.user_id, m.organization_id, tv.id into u, o, v from hse_memberships m join hse_template_versions tv on tv.organization_id = m.organization_id and tv.status = 'publicada'
   where m.role = 'owner' and m.active limit 1;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  insert into hse_audits (organization_id, template_version_id, title) values (o, v, 'Auditoría posterior a la restauración') returning code into c;
  select count(*) into dup from hse_audits where code = c;
  raise notice 'CHK nueva auditoría tras restaurar recibe código % (repetido=%)', c, dup > 1;
end $$;
SQL
)
res "numeración: $NOTICE2"

# 6. respaldo alterado: se detecta
cp -r "$WORK/respaldo" "$WORK/respaldo-alterado"; printf 'x' >> "$WORK/respaldo-alterado/datos.dump"
if DB_URL="$DST" "$HERE/restore-db.sh" "$WORK/respaldo-alterado" --sin-migraciones > /dev/null 2>&1; then res "FALLA respaldo alterado aceptado"; else res "respaldo de base alterado: rechazado (sha256)"; fi
f=$(find "$WORK/respaldo-alterado/archivos/archivos" -type f | head -1); printf 'x' >> "$f"
res "archivo de respaldo alterado: $(STORAGE_LOCAL_DIR="$WORK/bucket-vacio" node "$HERE/storage-tool.mjs" verify "$WORK/respaldo-alterado/archivos" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("corruptos detectados=%d" % len(d["corruptos_en_respaldo"]))')"
echo "Resultados en $WORK/resultado.txt"
