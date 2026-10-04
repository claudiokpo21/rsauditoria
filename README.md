# HSE Audit Manager

Plataforma web multiempresa para auditorías de **Seguridad e Higiene, Salud Ocupacional, Medio Ambiente y CSMS**
(empresas industriales, petroleras, contratistas y subcontratistas). PWA instalable que funciona sin conexión.

- **Frontend:** React 18 · TypeScript · Vite 8 · vite-plugin-pwa (Workbox) · Dexie (IndexedDB)
- **Backend:** Supabase — PostgreSQL 17 con RLS, Supabase Auth, Storage privado
- **Informes:** jsPDF + autotable (PDF), ExcelJS (XLSX), generados en el dispositivo

> **Estado (2026-10-03): no habilitado para producción.** No hay errores críticos de seguridad, pérdida de datos ni
> diferencias de evaluación conocidas; quedan pendientes la prueba en dispositivo real, el simulacro de respaldo con
> Supabase Storage real, activar *Leaked password protection* y un proyecto exclusivo. Ver
> `docs/pruebas-produccion/informe.md` y `docs/limitaciones.md`.

## Documentación

| Documento | Contenido |
|---|---|
| `docs/manual-usuario.md` | Manual de usuario por rol |
| `docs/politicas-rls.md` (+ `politicas-rls-anexo.md`) | Modelo de autorización, matriz por rol, políticas RLS y Storage |
| `docs/pruebas-produccion/informe.md` | Informe de pruebas previas a producción, aislamiento entre organizaciones y veredicto |
| `docs/respaldo-y-recuperacion.md` | Procedimiento de respaldo, restauración y simulacros |
| `docs/limitaciones.md` | Limitaciones conocidas |
| `docs/offline-first.md` · `docs/prueba-en-dispositivo.md` | Arquitectura sin conexión · planilla de prueba en campo (pendiente) |
| `docs/importacion-hp/reporte-importacion.md` | Reporte de importación de la lista H&P |
| `supabase/tests/README.md` | Pruebas SQL y últimos resultados |

---

## 1. Estructura

```
supabase/
  migrations/                 23 migraciones versionadas (prefijo hse_)
  tests/                      pruebas SQL: autorización, ciclo de hallazgos, paridad de puntaje, importación, sincronización
  local/supabase_stubs.sql    mínimos de Supabase para probar las migraciones en PostgreSQL común
src/
  lib/            env (rechaza claves secretas), cliente Supabase, mensajes de error
  db/             esquema Dexie, repositorio (escritura local + cola en una transacción), hooks
  sync/           motor push/pull, planificador (online, foco, 60 s, Web Locks)
  scoring/        motor de puntuación (espejo de hse_evaluate_answers)
  components/     UI base, layout, aviso de actualización del service worker
  modules/
    auth/           1. inicio de sesión, perfiles, permisos de interfaz
    organizations/  2. organizaciones, empresas/contratistas, ubicaciones, procesos
    templates/      3. plantillas, versiones, metodología, validación e importación Excel
    audits/         4. planificación, equipo, ejecución del checklist, completar/revisar/cerrar/reabrir
    evidences/      5. evidencias y fotografías (compresión, GPS, cola de subida)
    findings/       6. hallazgos, causa raíz (5 porqués / Ishikawa), recurrencia
    actions/        7. planes de acción (contención/correctiva/preventiva) y verificación de eficacia
    notifications/     avisos de vencimiento (servidor) y notificaciones del navegador
    reports/        8. informes de auditoría y de gestión, PDF y Excel
    dashboard/      9. indicadores (servidor con conexión; dispositivo sin conexión, indicando la fuente)
    admin/         10. usuarios, historial de cambios, sincronización
scripts/
  import-hp-report.ts         diagnóstico/reporte de importación por línea de comandos
  gen-scoring-parity.ts       genera supabase/tests/scoring_parity.sql desde el motor del cliente
  scan-secrets.mjs            verifica que el build no contenga claves secretas
  backup/                     respaldo/restauración de base y archivos + prueba completa
tests/                        Vitest (motor, cola offline, importador H&P) y e2e/ (Playwright + Supabase simulado)
```

## 2. Modelo de datos

Todas las tablas viven en `public` con prefijo `hse_` (conviven con otras apps del mismo proyecto).

| Dominio | Tablas |
|---|---|
| Núcleo | `hse_organizations`, `hse_profiles`, `hse_memberships` (rol por organización), `hse_invitations`, `hse_counters` |
| Maestros | `hse_companies` (propia/cliente/contratista/subcontratista, CSMS), `hse_locations` (jerárquicas, GPS), `hse_processes` |
| Plantillas | `hse_templates` → `hse_template_versions` (metodología `scoring_method` + `scoring_config`, estado de validación, origen y SHA-256) → `hse_template_sections` → `hse_template_items` |
| Importación | `hse_template_import_issues` (revisión manual), `hse_template_validation_cases` (resultados de prueba del origen) |
| Ejecución | `hse_audits` (atada a una versión publicada), `hse_audit_responses`, `hse_evidences` |
| Equipo | `hse_audit_participants` (líder / auditor / observador) |
| Tratamiento | `hse_findings` (pregunta, requisito, clasificación, responsable, vencimiento, causa raíz, recurrencia), `hse_actions` (tipo, criterio y resultado de eficacia) |
| Avisos | `hse_notifications` (generadas por el servidor) |
| Trazabilidad | `hse_change_log` (trigger, inalterable), `hse_reopen_log`, `hse_sync_events`, `hse_sync_receipts` |

Integridad multiempresa: **claves foráneas compuestas `(organization_id, id)`** en todas las relaciones, de modo que
una fila nunca puede apuntar a datos de otra organización aunque se conozca el UUID. Índices por
`(organization_id, updated_at)` para la sincronización incremental y por cada clave foránea.

Reglas en la base (triggers): versión publicada inmutable (contenido y metodología), publicación sólo vía RPC y
sólo si está validada, auditoría completada/cerrada no admite respuestas, hallazgo no se cierra con acciones
abiertas, contratista sólo informa avance, numeración AUD-/HAL-año-n.º, último propietario protegido,
`created_by` siempre del JWT, `updated_at` siempre del servidor.

## 3. Seguridad

- **RLS forzado** en todas las tablas `hse_*`; anon sin privilegios. Funciones de autorización `SECURITY DEFINER`
  con `search_path` fijo (`hse_is_member`, `hse_has_role`, `hse_can_access_company`).
- Roles: Administrador (`owner`/`admin`), Coordinador HSE (`supervisor`), Auditor (`auditor`; acceso sólo a auditorías
  asignadas), Responsable de acciones (`action_owner`), Usuario de consulta (`viewer`), Responsable de contratista
  (`contractor`, sólo su empresa y subcontratistas). Matriz completa: `docs/politicas-rls.md`.
- Operaciones sensibles sólo por RPC con rol y motivo: publicar plantilla, revisar, reabrir auditoría cerrada o cancelada (Administrador)
  y hallazgo verificado; validaciones de completar/cerrar en el servidor (`hse_audit_readiness`).
- **Storage** `hse-evidencias` privado; ruta `{org}/{auditoría}/{evidencia}.ext`; el archivo sólo es legible si su
  metadato es visible bajo RLS; lectura con URLs firmadas de 10 minutos.
- El frontend sólo recibe la **clave publicable**; `env.ts` impide arrancar con una `service_role`/`sb_secret_`.
- Cabeceras de seguridad (CSP, HSTS, X-Frame-Options…) en `vercel.json` y `public/_headers`.
- Al cerrar sesión se borran los datos locales (se advierte si hay cambios sin enviar). Si un usuario pierde
  acceso a una organización, sus datos se purgan del dispositivo en el siguiente inicio.

Pruebas ejecutadas contra el proyecto (`supabase/tests`): **231/231** de autorización y aislamiento multiempresa,
**62/62** del ciclo de hallazgos/acciones/informes, paridad de puntaje (37 casos, 0 diferencias), importación H&P y
protocolo de sincronización.

## 4. Funcionamiento sin conexión

Arquitectura completa, protocolo, seguridad y resultados de pruebas: **`docs/offline-first.md`**.
Prueba pendiente en celular/tablet real: **`docs/prueba-en-dispositivo.md`**.

Resumen: Service Worker (Workbox) para la app; IndexedDB/Dexie para datos; cola persistente con clave de
idempotencia por operación; UUID generados en el dispositivo; envío por lotes a `hse_sync_push`, que aplica cada
operación con los permisos del usuario, fusiona por campo y devuelve `conflicto` sin sobrescribir cuando otro usuario
cambió el mismo dato; recibos confirmados; fotos comprimidas, cifradas y subidas por partes (TUS) sin duplicar;
bloqueo a los 7 días y borrado seguro a los 30 días sin revalidar.

Pruebas: protocolo y permisos contra Supabase real; 26 escenarios en Chromium real con backend simulado
(`python3 tests/e2e/offline_e2e.py http://localhost:4177` sobre `vite build --mode development` + `vite preview`).

## 5. Importación de la lista H&P (Auditoría a Segundas Partes)

*Plantillas › Importar Excel* analiza el libro **en el dispositivo** (`hpChecklistParser.ts`) y muestra:
diagnóstico de hojas y fórmulas, mapeo celda→entidad, plantilla reconstruida, metodología, comparación con los
resultados del Excel, incidencias y datos excluidos. Al importar, `hse_import_template` crea la versión en
**borrador / validación pendiente** y recalcula el caso de validación en el servidor.

Para publicar: resolver cada incidencia de advertencia/bloqueante con una nota → ejecutar casos de validación
(deben coincidir) → validar con fundamento → publicar. El servidor impide saltear pasos.

Reporte completo del libro entregado: `docs/importacion-hp/reporte-importacion.md`.
Para regenerarlo: `npm run import:hp -- "archivo.xlsx" salida/`.

> Si en la revisión se decide **eliminar** requisitos (p. ej. las filas 81–82 sin número), el caso de validación
> del Excel deja de coincidir y la versión no podrá validarse contra ese libro: corresponde importar un libro
> corregido o crear una nueva versión de la plantilla a partir de la publicada.

## 6. Puesta en marcha

```bash
npm install
cp .env.example .env.development.local   # completar URL y clave publicable
npm run dev                              # http://localhost:5173
npm test                                 # HP_XLSX=/ruta/libro.xlsx npm test para incluir el importador
npm run build                            # dist/ listo para hosting estático HTTPS
```

**Base de datos:** las migraciones ya están aplicadas en el proyecto de desarrollo (*Inventario Clear*). Para otro
proyecto (recomendado para producción): `supabase link --project-ref <ref> && supabase db push`.

**Supabase Auth (panel):** *Site URL* y *Redirect URLs* con el dominio de producción; confirmar correo activado;
activar *Leaked password protection*.

**Avisos diarios:** habilitar la extensión `pg_cron` y ejecutar el bloque final de la migración 0020 para programar
`hse_refresh_all_notifications` (sin `pg_cron` los avisos se recalculan cuando un usuario sincroniza).

**Respaldo:** configurar la tarea diaria según `docs/respaldo-y-recuperacion.md` antes de cargar datos reales.

**Hosting:** Vercel (`vercel.json`), Netlify o Cloudflare Pages (`public/_headers`, `public/_redirects`). Definir
`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` y `VITE_APP_VERSION` como variables del entorno de producción.

## 7. Primer uso

1. Crear cuenta → confirmar correo → crear la organización (queda como propietario).
2. *Empresas y ubicaciones*: cargar contratistas, subcontratistas, yacimientos/bases.
3. *Plantillas*: importar la lista H&P (o crear una ponderada) → revisar → validar → publicar.
4. *Usuarios*: invitar auditores, supervisores y contratistas (estos últimos asociados a su empresa).
5. *Auditorías*: crear, ejecutar en campo (también sin señal), registrar hallazgos, completar.
6. *Hallazgos / Planes de acción*: tratamiento, evidencia de cierre, verificación de eficacia.
7. *Informes*: PDF por auditoría con registro fotográfico; Excel por auditoría o consolidado.

## 8. Hallazgos, acciones, puntuación e informes

- **Hallazgo**: vinculado a auditoría y (si corresponde) a la pregunta/requisito; descripción objetiva, clasificación
  (NC mayor/menor, OBS, OPM), severidad, categoría, responsable, vencimiento, evidencias, acción inmediata, causa raíz
  (5 porqués, Ishikawa 6M u otro) y recurrencia calculada por el servidor (misma pregunta y empresa).
- **Plan de acción**: acciones de contención, correctivas y preventivas con responsable (usuario o contratista),
  vencimiento y criterio de eficacia; avance del responsable; verificación de eficacia independiente.
- **Reglas de cierre** (servidor): una NC no se cierra sin causa raíz y acción correctiva ni con acciones abiertas; se
  verifica sólo con todas las acciones verificadas; verificado = cierre definitivo (reapertura con motivo).
- **Auditoría**: completar exige preguntas obligatorias respondidas, evidencias requeridas con archivo en el servidor
  y críticos incumplidos con hallazgo; cerrar exige revisión de Coordinación, resumen y plan para cada NC.
- **Puntuación**: el resultado oficial (`score`, `compliance_pct`, `result_band`, `section_results`) lo calcula el
  servidor con la metodología de la versión publicada (inmutable). El motor del cliente (`src/scoring/engine.ts`) es
  sólo vista previa y se contrasta con el servidor en `scoring_parity.sql`.
- **Avisos**: acción por vencer (≤ 7 días), vencida, verificación pendiente, hallazgo vencido (`hse_notifications`).
- **Historial**: `hse_change_log` por trigger; `hse_record_history` y `hse_audit_history` con nombre del autor.
- **Informes**: de auditoría (PDF con fotos e historial, Excel) y de gestión (PDF/Excel por período y empresa: por
  categoría, sección y empresa, recurrentes, mensual, seguimiento de auditorías, plan de acción); resumen en el
  servidor con `hse_report_summary` (respeta RLS) o en el dispositivo sin conexión.

## 9. Pruebas

```bash
npm test                    # Vitest (HP_XLSX=/ruta/libro.xlsx para incluir el importador)
npm run typecheck && npm run build && npm run check:secrets
npm run test:parity:gen     # regenera supabase/tests/scoring_parity.sql
npx vite build --mode development && npx vite preview --port 4177 &
npm run test:e2e:offline    # 26 escenarios sin conexión (Chromium + Supabase simulado)
npm run test:e2e:informes   # 32 escenarios de hallazgos, informes y móvil
PGHOST=/tmp PGPORT=55432 PGUSER=postgres scripts/backup/test-backup-restore.sh
```

Pruebas SQL: `supabase/tests/README.md`. Resultados: `docs/pruebas-produccion/`.
