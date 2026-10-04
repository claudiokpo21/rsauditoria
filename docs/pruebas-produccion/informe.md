# Informe de pruebas previas a producción

Fecha: 2026-10-03 · Versión: migraciones 0001–0023 · Proyecto de pruebas: Supabase *Inventario Clear* (`hhwfhearafhmougtfssu`)

## Veredicto

**No apto todavía para producción.** No se conocen errores críticos de seguridad ni casos de pérdida de datos, y las
evaluaciones no tienen diferencias sin resolver. El veredicto no es favorable porque faltan pruebas que no se pueden
hacer desde este entorno, y una de ellas es un requisito explícito: **probar sin conexión en un dispositivo real**.

| Criterio para habilitar | Estado |
|---|---|
| Errores críticos de seguridad | **Ninguno conocido.** 231/231 casos de autorización y aislamiento en el proyecto real. El hallazgo menor de 0023 (sondeo de membresías ajenas) está corregido |
| Pérdida de datos | **Ninguna observada** en corte de conexión, reenvío, conflicto, cierre del navegador ni restauración. Ver §4 y §6 |
| Diferencias en los resultados de evaluación | **Ninguna.** 37 casos servidor vs. motor del cliente, diferencia máxima 5,2·10⁻¹⁴. Excel H&P = servidor (6,27116… → "Bueno") |
| Prueba en celular/tablet real (Android + iOS) | **Pendiente.** Hay que completar la planilla de `docs/prueba-en-dispositivo.md` |
| Respaldo de archivos y borrado por la API real de Storage | **Pendiente.** Sólo se probó con un adaptador local |
| *Leaked password protection* en Supabase Auth | **Desactivado.** Hay que activarlo en el panel |
| Proyecto dedicado de producción | **Pendiente.** El proyecto de pruebas es compartido con otras aplicaciones (ver limitaciones) |

Para habilitar producción hay que completar los cuatro pendientes y anotar sus resultados en este informe.

## 1. Pruebas ejecutadas (resumen)

| # | Prueba exigida | Dónde | Resultado |
|---|---|---|---|
| 1 | Importación del Excel | `import_hp_parity.sql` (servidor) · parser H&P (cliente, Vitest) | Servidor OK: caso de validación igual al Excel, publicación bloqueada sin validar, metodología inmutable. El parser no se volvió a ejecutar en esta etapa porque el .xlsx no está en el entorno; su última ejecución (etapa de importación) dio OK |
| 2 | Fórmulas de evaluación | `scoring_parity.sql` (37 casos) + `tests/engine.test.ts` | 0 diferencias entre servidor y cliente; 13 pruebas unitarias OK |
| 3 | Pérdida de conectividad | `offline_e2e.py` (Chromium real, backend simulado) | 26/26 |
| 4 | Sincronización repetida | `offline_e2e.py` 4.2, 4.4, 5.1 · `sync_push_protocol.sql` | Sin duplicados, operaciones idempotentes |
| 5 | Conflictos entre usuarios | `offline_e2e.py` 6.x · `sync_push_protocol.sql` | El conflicto en un mismo campo se detecta sin sobrescribir; los cambios en campos distintos se fusionan |
| 6 | Permisos y aislamiento multiempresa | `authorization_matrix.sql` · `findings_lifecycle.sql` | **231/231** y **62/62** en el proyecto real, después de 0023 |
| 7 | Recuperación de base y evidencias | `scripts/backup/test-backup-restore.sh` (PostgreSQL 16 local) | La huella de la base queda idéntica y se restauran 3/3 archivos; se detectan alteraciones (ver §6) |
| 8 | Generación de informes | `findings_reports_mobile_e2e.py` 4.x | Se validó el contenido de PDF y Excel (de auditoría y de gestión) con pypdf/openpyxl |
| 9 | Uso en dispositivos móviles | `findings_reports_mobile_e2e.py` (emulación Pixel 7 / iPhone 13) | 32/32, sin desplazamiento horizontal. **Falta la prueba en un dispositivo físico** |

Otras verificaciones:
- `npm run typecheck`: OK.
- `npm run build`: OK.
- `npm run check:secrets`: no hay claves secretas en `dist/`.
- *Security Advisor* de Supabase: ninguna función `hse_*` es ejecutable por `anon`.

## 2. Aislamiento entre organizaciones (informe previo a habilitar producción)

**Método.** Se simulan JWT reales (`set local role authenticated` + `request.jwt.claims`) contra la base del proyecto.
Se crean dos organizaciones (A y B), 12 usuarios con todos los roles y dos contratistas. Cada caso se ejecuta como ese
usuario y la transacción se revierte al final. Se verificó después que no quedaron usuarios ni organizaciones de prueba.

**Resultado en el proyecto real (2026-10-03, con 0001–0023):** `authorization_matrix.sql` **231/231**,
`findings_lifecycle.sql` **62/62**. Detalle caso por caso: `matriz-autorizacion-resultados.json`.

Qué intentó el **administrador de la organización B** sobre A, conociendo todos los UUID, y qué respondió la base:

| Intento | Resultado |
|---|---|
| Leer filas de A en 13 tablas, perfiles, historial y reaperturas | 0 filas |
| Leer o listar archivos de A en Storage | 0 objetos |
| Modificar una auditoría o borrar un hallazgo de A por id | 0 filas afectadas |
| Subir un archivo a la carpeta de A, o con su organización y una auditoría de A | Rechazado por RLS de Storage |
| Crear hallazgo, acción o evidencia en B que apunte a registros de A | Rechazado (FK compuesta / RLS) |
| Mover su auditoría o empresa a la organización A | Rechazado ("No se puede mover un registro a otra organización") |
| Agregarse como participante, insertarse una membresía o invitar en A | Rechazado |
| Publicar, editar o versionar plantillas de A | Rechazado |
| Reabrir una auditoría de A por RPC | Rechazado |
| Usar el contador de códigos, el dashboard o las notificaciones de A | Rechazado / vacío |
| Leer el informe de gestión o el historial de una auditoría de A | Informe vacío / rechazado |
| `hse_sync_push` con una operación sobre A | No aplicada; el título de A no cambió |
| Sondear si un usuario pertenece a A (`hse_is_org_user`) | `false` (corregido en 0023) |
| JWT con `role=supabase_admin` o `service_role` en el claim | Sin efecto: la conexión sigue siendo `authenticated` |
| Usuario anónimo: leer tablas, Storage o llamar RPC | `permission denied` |

Aislamiento **dentro** de la organización (contratistas y roles):
- El responsable del contratista Y no ve auditorías, respuestas, hallazgos, acciones ni archivos de la empresa X.
- Un auditor no asignado no ve ni modifica auditorías ajenas.
- El responsable de acciones ve sólo sus acciones y el hallazgo correspondiente.
- Un usuario desactivado pierde el acceso inmediatamente, y también el que tenía como participante.

**Hallazgo corregido durante esta revisión.** `hse_is_org_user` (`SECURITY DEFINER`, invocable por usuarios
autenticados) respondía si **cualquier** usuario pertenecía a **cualquier** organización, siempre que se conocieran
ambos UUID. Exponía membresías, no datos. Con la migración 0023 sólo responde sobre organizaciones del propio usuario.
Se aplicó en el proyecto y lo cubren dos casos nuevos en `findings_lifecycle.sql`. Severidad: baja, porque para
explotarlo hay que conocer UUID no adivinables.

## 3. Evaluación (puntuación)

- El **resultado oficial** lo calcula el servidor al completar la auditoría (`hse_evaluate_answers`) con la
  metodología y los pesos **de la versión publicada**, que es inmutable. Se guarda en `score`, `compliance_pct`,
  `result_band` y `section_results`.
- La interfaz muestra el cálculo del dispositivo sólo como **"Vista previa"**. Los informes de auditorías completadas
  usan el resultado oficial e indican la fuente ("oficial" / "preliminar").
- `scoring_parity.sql` (generado por `npm run test:parity:gen`) compara 37 casos: método H&P (incluido el caso del
  Excel), ponderado con N/A, críticos y secciones eliminadas. Resultado: **0 diferencias**, diferencia máxima
  5,24·10⁻¹⁴ (redondeo de coma flotante).

## 4. Sin conexión y sincronización

26 escenarios en Chromium real con un backend simulado (`offline-e2e-resultados.json`):
- descarga inicial;
- trabajo offline con cola persistente;
- fotos comprimidas y cifradas;
- recarga y reapertura sin red;
- reconexión automática;
- respuesta perdida y reenvío sin duplicar;
- PDF de 14,7 MB subido por partes con cortes;
- sincronización repetida;
- conflicto entre dos usuarios;
- advertencias antes de perder datos;
- bloqueo a los 7 días y borrado a los 30.

El protocolo del servidor (`sync_push_protocol.sql`, 15 pasos) se probó en el proyecto real antes de 0023 y
localmente después de 0023, con resultado OK en ambos casos.

**Alcance:** el servidor fue simulado y el navegador fue Chromium de escritorio. La validez en campo depende de la
prueba en dispositivo (`docs/prueba-en-dispositivo.md`).

## 5. Hallazgos, acciones, informes y móvil

`hallazgos-informes-movil-resultados.json` registra 32/32 escenarios. Las capturas están en `capturas/` y los
informes generados en `informes-generados/`. Se cubre:
- el hallazgo vinculado a auditoría y pregunta, con descripción objetiva, clasificación, responsable y vencimiento;
- la recurrencia detectada por el servidor;
- el análisis de causa raíz (5 porqués);
- el plan de acción con su criterio de eficacia;
- el historial de cambios;
- el bloqueo de cierre con acciones abiertas;
- los avisos de vencimiento;
- el bloqueo de "Completar" cuando faltan preguntas obligatorias;
- la revisión de coordinación obligatoria antes del cierre;
- el resultado oficial;
- los PDF y Excel de auditoría y de gestión, con resultados por categoría y sección, recurrentes y seguimiento;
- el dashboard con datos sincronizados;
- el uso en iPhone emulado por el responsable de acciones.

## 6. Respaldo y recuperación

`respaldo-restauracion.txt` es el registro de `scripts/backup/test-backup-restore.sh` sobre PostgreSQL 16 local con
las 23 migraciones:
- El origen tenía 269 filas principales y 3 archivos. Se hizo el respaldo y se simuló un desastre: se eliminaron la
  base y el bucket.
- La base se restauró en una base nueva y la **huella** (filas y MD5 por tabla) quedó **idéntica**.
- Se restauraron 3/3 archivos con su SHA-256. Una segunda restauración no cambia nada.
- Después de restaurar, el RLS sigue aislando, un auditor no puede cerrar directamente y la numeración continúa
  (AUD-2026-0003).
- Un respaldo de base alterado se rechaza, un archivo alterado se detecta y un archivo huérfano se informa.

**Falta probar** el adaptador real de Supabase Storage (API con la clave de servicio) y la restauración en un proyecto
Supabase nuevo. El procedimiento está en `docs/respaldo-y-recuperacion.md`.

## 7. Cómo reproducir

```bash
# SQL contra el proyecto (SQL Editor o psql): cada archivo se revierte solo y el resultado aparece en el error final
supabase/tests/authorization_matrix.sql   supabase/tests/findings_lifecycle.sql
supabase/tests/scoring_parity.sql         supabase/tests/sync_push_protocol.sql
supabase/tests/import_hp_parity.sql       supabase/tests/sync_semantics.sql
# Base local con las mismas migraciones: supabase/local/supabase_stubs.sql + supabase/migrations/*.sql
npm test && npm run typecheck && npm run build && npm run check:secrets
npx vite build --mode development && npx vite preview --port 4177 &
npm run test:e2e:offline && npm run test:e2e:informes
PGHOST=/tmp PGPORT=55432 PGUSER=postgres scripts/backup/test-backup-restore.sh
```
