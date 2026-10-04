# Procedimiento de respaldo y recuperación

Se respaldan tres cosas, cada una con su fuente de verdad:

| Qué | Fuente de verdad | Cómo se respalda |
|---|---|---|
| Esquema (tablas, funciones, RLS, bucket) | `supabase/migrations/*.sql` (versionadas, en el repositorio) | Control de versiones (git) + copia del repositorio |
| Datos de la aplicación y usuarios | Base PostgreSQL de Supabase | 1) Respaldos automáticos de Supabase (diarios / PITR) · 2) `scripts/backup/backup-db.sh` (respaldo lógico propio, verificable) |
| Archivos de evidencias | Bucket privado `hse-evidencias` | `scripts/backup/storage-tool.mjs backup` (**los respaldos automáticos de Supabase NO incluyen los archivos de Storage**) |

> Los datos pendientes en los dispositivos (trabajo sin conexión) **no** forman parte del respaldo hasta que se
> sincronizan. Antes de una restauración, pedir a los auditores que sincronicen y verificar en *Administración ›
> Sincronización* que no queden pendientes.

## 1. Requisitos

- Plan de Supabase con respaldos diarios (Pro o superior); **recomendado PITR** (recuperación a un punto en el tiempo)
  para limitar la pérdida a minutos.
- Un **equipo de administración** (no el navegador de los usuarios) con PostgreSQL client 15+ (`pg_dump`,
  `pg_restore`, `psql`), Node 20+ y el repositorio.
- Credenciales que **nunca** se guardan en el repositorio ni en el frontend:
  - `DB_URL`: cadena de conexión con el rol `postgres` (Supabase › Project Settings › Database › Connection string,
    modo *Session*, puerto 5432).
  - `SUPABASE_SERVICE_ROLE_KEY`: clave de servicio (Project Settings › API Keys).
- Destino de respaldos cifrado y fuera de Supabase (p. ej. bucket de otro proveedor con versionado y bloqueo de
  borrado, o disco cifrado), con acceso restringido al responsable de sistemas.

## 2. Frecuencia y retención recomendadas

| Respaldo | Frecuencia | Retención |
|---|---|---|
| Automático de Supabase (o PITR) | Continuo / diario | Según plan (7 días Pro; PITR configurable) |
| `backup-db.sh` (lógico) | Diario, fuera del horario de trabajo | 30 diarios + 12 mensuales |
| `storage-tool.mjs backup` (archivos) | Diario, a continuación del anterior (copia completa del bucket en cada ejecución; con volúmenes grandes conviene deduplicar en el destino, p. ej. con `restic`/`borg`) | Igual que la base del mismo día |
| **Simulacro de restauración** | Trimestral y antes de cada cambio mayor de esquema | Registro del resultado |

## 3. Respaldo

```bash
F=respaldos/$(date +%F)
# 3.1 base (datos de public.hse_* + auth.users + auth.identities) con huella y manifiesto
DB_URL="postgresql://postgres.<ref>:<clave>@aws-0-<región>.pooler.supabase.com:5432/postgres" \
  scripts/backup/backup-db.sh "$F"

# 3.2 lista de archivos que la base considera vigentes (para detectar faltantes y huérfanos)
psql "$DB_URL" -At -c "select storage_path from public.hse_evidences where deleted_at is null" > "$F/rutas.txt"

# 3.3 archivos de evidencias, cada uno con su SHA-256
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clave> \
  node scripts/backup/storage-tool.mjs backup "$F/archivos" --esperados "$F/rutas.txt"
```

Resultado en `$F`: `datos.dump`, `huella.tsv` (filas y MD5 por tabla), `manifest.txt` (fecha, última migración,
SHA-256 del dump) y `archivos/` con su índice. **Revisar** el informe de `storage-tool`:
`evidencias_sin_archivo` debe estar vacío (si no, hay evidencias cuyo archivo nunca llegó al servidor) y
`archivos_huerfanos` lista archivos sin registro (subidas interrumpidas; se pueden depurar).

Nota: `auth.users` incluye a **todos** los usuarios del proyecto. En un proyecto compartido con otras aplicaciones
(como el de pruebas) el respaldo contiene también sus usuarios; en producción el proyecto debe ser exclusivo.

## 4. Recuperación

### 4.1 Error puntual (un registro borrado o alterado por error)

No restaurar todo. Usar el **historial de cambios** (`hse_change_log`, inalterable): *Administración › Historial*
muestra el valor anterior de cada campo con autor y fecha. Corregir desde la aplicación (o reabrir con la RPC si el
registro está cerrado/verificado; queda registrado con motivo).

### 4.2 Pérdida o corrupción de la base

1. Preferir el respaldo automático/PITR de Supabase (Database › Backups) **a un proyecto nuevo** o al mismo proyecto.
   Los archivos de Storage no se ven afectados por esta restauración.
2. Si no está disponible, restaurar el respaldo lógico en un **proyecto nuevo y vacío**:

```bash
DB_URL="<cadena del proyecto NUEVO>" scripts/backup/restore-db.sh respaldos/2026-10-03
```

   El script: (1) verifica el SHA-256 del dump contra el manifiesto (rechaza un respaldo alterado); (2) aplica las
   migraciones en orden; (3) vacía las tablas de la aplicación que crean las migraciones; (4) carga los datos con
   triggers desactivados (`session_replication_role = replica`) para no regenerar códigos, fechas ni historial;
   (5) compara la huella del destino con la del respaldo y **termina con error si difiere**.
3. Restaurar los archivos (paso 4.3) si el proyecto es nuevo.
4. Configurar en el proyecto nuevo: Auth (Site URL, Redirect URLs, SMTP, *Leaked password protection*) y, si se usa,
   `pg_cron`. Actualizar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` y volver a publicar el frontend.
5. Verificación (§5).

### 4.3 Pérdida de archivos de evidencias

```bash
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clave> \
  node scripts/backup/storage-tool.mjs restore respaldos/2026-10-03/archivos
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<clave> \
  node scripts/backup/storage-tool.mjs verify respaldos/2026-10-03/archivos
```

`restore` **nunca sobrescribe**: sube sólo lo que falta; si un archivo existe con distinto contenido lo informa en
`diferentes` para revisión manual; los archivos del respaldo cuyo SHA-256 no coincide se informan en
`corruptos_en_respaldo` y no se suben. Se puede repetir sin efectos (idempotente).

## 5. Verificación después de restaurar

1. Huella idéntica (lo hace `restore-db.sh`) y `verify` de archivos sin diferencias.
2. Ejecutar `supabase/tests/authorization_matrix.sql` y `findings_lifecycle.sql` en el proyecto restaurado: 0 fallas.
3. Ingresar con un usuario de cada rol y abrir una auditoría cerrada con fotos; generar su PDF.
4. Crear una auditoría de prueba y comprobar que su código continúa la numeración (no repite).
5. Registrar el resultado (fecha, respaldo usado, tiempo total, responsable) en el registro de simulacros.

## 6. Simulacro sin tocar producción

`scripts/backup/test-backup-restore.sh` ejecuta el ciclo completo en PostgreSQL local (origen con datos → respaldo →
desastre → restauración → verificación de huella, archivos, RLS, reglas y numeración; también prueba un respaldo
alterado y un archivo corrupto). Resultado de la última ejecución: `docs/pruebas-produccion/respaldo-restauracion.txt`.

**Pendiente:** ejecutar un simulacro con el adaptador real de Supabase Storage y restaurando en un proyecto Supabase
nuevo (hasta ahora el adaptador de archivos se probó contra una carpeta local).

## 7. Responsabilidades

| Tarea | Responsable sugerido |
|---|---|
| Respaldo diario y revisión del informe de archivos | Sistemas (tarea programada en el equipo de administración) |
| Custodia de `DB_URL` y clave de servicio | Sistemas (gestor de secretos, rotación ante baja de personal) |
| Simulacro trimestral | Sistemas + Coordinación HSE (valida el contenido) |
| Decisión de restaurar y comunicación a usuarios | Administrador de la organización |
