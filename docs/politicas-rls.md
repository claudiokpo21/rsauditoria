# Autorización y políticas RLS

Estado: migraciones 0001–0023 aplicadas en el proyecto *Inventario Clear* (`hhwfhearafhmougtfssu`).
El anexo al final se generó desde `pg_policies` de una base con las mismas migraciones; no se escribió a mano.

## 1. Principios

1. **La base de datos decide.** Toda tabla `hse_*` tiene RLS habilitado **y forzado** (`FORCE ROW LEVEL SECURITY`).
   El rol `anon` no tiene privilegios sobre tablas, funciones ni el bucket. La interfaz sólo oculta botones; si se
   saltea la interfaz, la base rechaza igual.
2. **No se confía en ids del cliente.** Responsable, líder, participantes, empresa y registros relacionados se validan
   como pertenecientes a la **misma organización** (claves foráneas compuestas `(organization_id, id)` + triggers que
   verifican membresía activa). Autor, fechas, numeración, puntaje, recurrencia y estado de revisión los fija el servidor.
3. **Acceso por auditoría, no sólo por organización.** `hse_audit_role()` devuelve el permiso efectivo:
   `gestion` · `escritura` · `lectura` · *sin acceso*. Hallazgos, respuestas, evidencias y acciones lo heredan.
4. **Operaciones sensibles sólo por RPC** con verificación de rol y motivo: publicar plantilla, reabrir auditoría
   o hallazgo, revisar auditoría, invitar miembros. Las RPC fijan una marca de sesión (`hse.publishing`,
   `hse.reopening`, `hse.reviewing`) que los triggers exigen; un `UPDATE` directo equivalente es rechazado.
5. **Sin secretos en el navegador.** El frontend usa sólo la clave publicable; `src/lib/env.ts` impide arrancar con
   una clave `service_role`/`sb_secret_` y `npm run check:secrets` revisa el build. Las herramientas que necesitan la
   clave de servicio (respaldo de archivos) corren en un equipo de administración.
6. **Funciones `SECURITY DEFINER`** con `search_path` fijo, `EXECUTE` revocado a `public`/`anon`; las funciones de
   trigger no son invocables por API (0019). Desde 0023 `hse_is_org_user` sólo responde sobre organizaciones del
   propio usuario (antes permitía sondear membresías ajenas conociendo los UUID).

## 2. Roles

| Rol (`hse_role`) | Nombre en la interfaz | Alcance |
|---|---|---|
| `owner` | Administrador (propietario) | Todo en su organización; no puede quedar sin propietario |
| `admin` | Administrador | Todo en su organización; **único** que reabre auditorías cerradas o canceladas (con `owner`) |
| `supervisor` | Coordinador HSE | Gestión de todas las auditorías: planificar, asignar, **revisar**, cerrar, verificar eficacia, reabrir hallazgos verificados, plantillas |
| `auditor` | Auditor | Sólo auditorías donde participa: líder/auditor = escritura; observador = lectura |
| `action_owner` | Responsable de acciones correctivas | Sólo las acciones y hallazgos de los que es responsable: informa avance |
| `viewer` | Usuario de consulta | Lectura de toda la organización; no modifica nada |
| `contractor` | Responsable de contratista | Lectura de las auditorías de **su empresa y subcontratistas**; informa avance de sus acciones |

## 3. Matriz de permisos

Verificada por `authorization_matrix.sql` (231 casos) y `findings_lifecycle.sql` (62), salvo las filas marcadas con ²,
que se comprobaron por lectura del código (`0017`, `0020`) sin caso automático propio.

| Operación | Adm. | Coord. | Auditor asignado | Observador | Resp. acciones | Consulta | Contratista | Otra org. |
|---|---|---|---|---|---|---|---|---|
| Ver auditoría | ✔ | ✔ | ✔ | ✔ | — | ✔ | su empresa | — |
| Crear / planificar auditoría, asignar líder | ✔ | ✔ | — | — | — | — | — | — |
| Responder checklist, subir evidencias | ✔ | ✔ | ✔ | — | — | — | — | — |
| Registrar hallazgo, plan de acción, causa raíz | ✔ | ✔ | ✔ | — | — | — | — | — |
| Completar auditoría (con validación del servidor) | ✔ | ✔ | ✔ | — | — | — | — | — |
| Devolver una auditoría completada a ejecución | ✔ | ✔ | — | — | — | — | — | — |
| Revisar auditoría (`hse_review_audit`) | ✔ (si no es el líder) ² | ✔ (si no es el líder) | — | — | — | — | — | — |
| Cerrar auditoría (requiere revisión + resumen) | ✔ | ✔ | — | — | — | — | — | — |
| Cancelar auditoría ² | ✔ | ✔ | — | — | — | — | — | — |
| Reabrir auditoría **cerrada o cancelada** (RPC, motivo ≥ 20) | ✔ | — | — | — | — | — | — | — |
| Reabrir hallazgo **verificado** (RPC, motivo ≥ 20) | ✔ | ✔ | — | — | — | — | — | — |
| Informar avance / completar acción | ✔ | ✔ | ✔ | — | sus acciones | — | acciones de su empresa | — |
| Cambiar vencimiento, responsable o criterio de eficacia | ✔ | ✔ | ✔ | — | — | — | — | — |
| Verificar eficacia de acción / hallazgo ¹ | ✔ | ✔ | ✔ | — | — | — | — | — |
| Crear plantilla, publicar versión (sólo validada, por RPC) | ✔ | ✔ | — | — | — | — | — | — |
| Invitar miembros / cambiar roles | ✔ | — | — | — | — | — | — | — |
| Historial completo y registro de reaperturas | ✔ | ✔ | — | — | — | — | — | — |
| Historial de un registro que puede ver (`hse_record_history`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | — |
| Historial completo de una auditoría que puede ver (`hse_audit_history`) | ✔ | ✔ | ✔ | ✔ | — | ✔ | su empresa | — |

¹ **Independencia**: quien es responsable de una acción no puede verificarla, ni verificar el hallazgo al que
pertenece. La verificación exige notas/evidencia y resultado de eficacia; un hallazgo sólo se verifica cerrado y con
todas sus acciones verificadas. Un hallazgo verificado es cierre definitivo: sólo se modifica reabriéndolo.

"Otra org." incluye a un **administrador** de otra organización: no ve, no modifica, no referencia (FK compuesta)
ni mueve registros a la organización ajena, aunque conozca los UUID.

## 4. Reglas en triggers (no son políticas, pero también autorizan)

| Trigger | Regla |
|---|---|
| `hse_audits_guard` / `hse_audits_readiness` | Transiciones de estado válidas; completar exige preguntas obligatorias respondidas, evidencias requeridas **con archivo en Storage**, ítems críticos incumplidos con hallazgo; cerrar exige revisión, resumen y plan para cada NC |
| `hse_findings_rules` | Pregunta derivada de la respuesta; responsable miembro activo; recurrencia calculada por el servidor; NC no se cierra sin causa raíz y acción correctiva; no se cierra con acciones abiertas |
| `hse_actions_rules` | Responsable de acciones/contratista sólo cambia avance y estado propio; criterio de eficacia sólo por roles de escritura |
| `hse_guard_participant` | Participantes deben ser miembros activos con rol habilitado; no se reasignan |
| Plantillas | Versión publicada inmutable (contenido y metodología); publicación sólo vía RPC y sólo si está validada |
| `hse_change_log` | Historial inalterable (sin políticas de escritura) |
| Notificaciones | Las genera el servidor; el usuario sólo marca `read_at` |

## 5. Storage (`hse-evidencias`, privado)

- Ruta obligatoria `{organización}/{auditoría}/{evidencia}.ext`.
- **Subir**: sólo si `hse_can_upload_evidence(org, auditoría)` (escritura sobre esa auditoría).
- **Leer**: sólo si existe un registro `hse_evidences` visible bajo RLS para esa ruta (un archivo huérfano es invisible).
  La app usa URLs firmadas de 10 minutos.
- **Sobrescribir**: no permitido (rutas determinísticas, sin `upsert`).
- **Borrar**: la política lo permite **sólo a Administración** (`owner`/`admin`) sobre cualquier archivo de la carpeta
  de su organización. Supabase además bloquea el borrado SQL directo (`storage.protect_delete`): sólo se borra por la
  API de Storage. Las evidencias se dan de baja lógica (`deleted_at`); el procedimiento es borrar únicamente archivos
  de evidencias dadas de baja o huérfanos (si se borrara el archivo de una evidencia vigente, la auditoría no podría
  completarse: `hse_audit_readiness` lo informa como evidencia sin archivo).

## 6. Pruebas

Ver `docs/pruebas-produccion/informe.md` §2 (aislamiento multiempresa) y `supabase/tests/README.md`.

## Anexo A. Políticas vigentes (generado)

Ver `docs/politicas-rls-anexo.md`.
