# Pruebas SQL

Cada archivo simula usuarios reales (`set local role authenticated` + `request.jwt.claims` con su `sub`), ejecuta los
casos y termina con `raise exception '<RESULTADO> {json}'`: **toda la transacción se revierte** y el resultado aparece
en el mensaje de error. No deja datos. Ejecutar en el SQL Editor de Supabase o con `psql -f`.

También corren en un PostgreSQL 15+ común: aplicar `supabase/local/supabase_stubs.sql` (roles, `auth.*`, `storage.*`
mínimos) y luego `supabase/migrations/*.sql` en orden.

| Archivo | Qué verifica | Última ejecución (2026-10-03) |
|---|---|---|
| `authorization_matrix.sql` | 12 usuarios con los 7 roles en dos organizaciones: visibilidad y escritura por auditoría, participantes, respuestas, hallazgos, acciones, Storage, verificación con independencia, cierre/revisión/reapertura, plantillas, historial, escalamiento de privilegios, **aislamiento total org B → org A**, claims manipulados, anónimo | **231/231** en el proyecto (con 0023) y local |
| `findings_lifecycle.sql` | Validación para completar (obligatorias, evidencias con archivo, críticos), vínculo hallazgo↔pregunta, responsable de la misma organización, categoría y recurrencia del servidor, revisión y cierre, causa raíz y correctiva para cerrar NC, notificaciones idempotentes, historial, informes (por categoría/sección/recurrentes) y su aislamiento, sondeo de membresías (0023) | **62/62** en el proyecto y local |
| `scoring_parity.sql` | 37 casos: el servidor (`hse_evaluate_answers`) contra los valores del motor del cliente, generados con `npm run test:parity:gen` | 0 diferencias (máx. 5,2·10⁻¹⁴) en el proyecto y local |
| `import_hp_parity.sql` | Importa la lista H&P (payload de `npm run import:hp`), caso de validación del servidor = Excel (6,2711… "Bueno"), publicación bloqueada sin validar, metodología inmutable | OK local después de 0022 (difmax 6,7·10⁻¹⁶); OK en el proyecto en la etapa de importación |
| `sync_push_protocol.sql` | `hse_sync_push`/`hse_sync_confirm`: alta, reenvío idempotente, conflicto por campo sin sobrescribir, fusión, evidencia sin archivo, cascada, contratista, lector, otra organización, columnas protegidas, recibos, usuario dado de baja | 15/15 en el proyecto (antes de 0023) y local (después) |
| `signatures.sql` | Acta de cierre y firmas (0025): captura por auditor, hora del dispositivo, firma inmutable, baja sin restauración, visibilidad (observador, contratista, otra organización), cola de sincronización, historial, cierre bloquea acta y firmas | **24/24** en el proyecto y local |
| `demo_organization.sql` | Organización de ejemplo (0024, requiere psql): 6,27 Bueno con las secciones de la planilla, Muy Bueno, Crítico, Regular, recurrencias, avisos | OK local (0024 no aplicada en el proyecto) |
| `sync_semantics.sql` | Upsert con ids del dispositivo, rutas de Storage de otra organización, `uploaded_by` lo fija el servidor, lectura condicionada al metadato | OK local |

`rls_isolation.sql` (primera versión, 21 casos, roles anteriores a 0016) se eliminó: su contenido quedó cubierto y
ampliado por `authorization_matrix.sql`.

El informe consolidado está en `docs/pruebas-produccion/informe.md`; el detalle caso por caso de la matriz en
`docs/pruebas-produccion/matriz-autorizacion-resultados.json`.
