# Arquitectura offline-first — HSE Audit Manager

Objetivo: que un auditor complete en un yacimiento, pozo o planta **sin conectividad** una auditoría descargada
previamente, y que todo llegue al servidor sin pérdidas ni duplicados al recuperar señal.

## 1. Capas

| Capa | Tecnología | Qué guarda / hace |
|---|---|---|
| Recursos de la app | Service Worker (Workbox, `vite-plugin-pwa`) | Precache de HTML, JS, CSS, íconos. `navigateFallback` → la app abre sin red. La API de Supabase **nunca** se cachea. Actualización con aviso (no se recarga sola a mitad de una auditoría). |
| Datos estructurados | IndexedDB + Dexie (`src/db/db.ts`) | Auditoría, versión de plantilla, secciones, ítems, respuestas, comentarios, estado, hallazgos, acciones, **metadatos de evidencias** y referencia al archivo pendiente. |
| Archivos | IndexedDB (`blobs`) cifrado AES-GCM | Fotografías y PDF capturados sin conexión, comprimidos (≤1920 px) y cifrados con clave no exportable. |
| Cola persistente | IndexedDB (`outbox`) | Una operación por cambio: `op_id` (clave de idempotencia), tabla, registro, **campos modificados** (`payload`) y **valor que se veía al editar** (`base`), estado, intentos, próximo reintento, último error. |
| Recibos | `op_log` local + `hse_sync_receipts` en el servidor | Trazabilidad de qué confirmó el servidor y con qué versión de fila. |

Identificadores: **UUID v4 generados en el dispositivo** (`crypto.randomUUID`) para todo registro nuevo; las
respuestas usan **UUID v5(auditoría:ítem)**, así dos dispositivos que responden el mismo ítem hablan del mismo registro.

## 2. Escritura local

`saveRecord()` calcula el diff contra la copia local y, **en una única transacción de IndexedDB**, guarda el registro
y agrega la operación a la cola. Si el navegador se cierra o se corta la energía un instante después, o están las
dos cosas o ninguna. La cola sobrevive a recargas, cierre del navegador y reinicio del equipo (probado: 3.1, 3.2).

## 3. Protocolo de sincronización

```
dispositivo                                         Supabase (PostgreSQL)
───────────                                         ─────────────────────
0. recuperar "enviando" ──── hse_sync_confirm ────▶ ¿hay recibo para op_id?  sí → confirmada / no → reenviar
1. archivos pendientes ───── PUT / TUS por partes ─▶ Storage privado (ruta fija, x-upsert=false)
2. lote ≤ 50 operaciones ─── hse_sync_push ───────▶ por operación, en su propia subtransacción:
                                                      · ¿op_id ya recibido?           → duplicado (no reaplica)
                                                      · permisos y columnas (RLS)     → rechazado
                                                      · fusión por campo con `base`   → conflicto (no escribe)
                                                      · evidencia sin archivo         → error (reintenta)
                                                      · cambio + recibo atómicos      → aplicado, row_version
3. por cada recibo:  aplicado/duplicado → se borra de la cola, se adopta la fila del servidor
                     conflicto          → queda retenida con la fila del servidor (resolución manual)
                     rechazado          → queda retenida con el motivo (permiso/validación)
                     error              → reintento automático (15 s, 30 s, 1 min… hasta 30 min)
4. descarga incremental por `updated_at` (solape 2 min), sin pisar registros con cambios pendientes
5. "sincronización confirmada" = cola vacía + descarga terminada → se guarda y se muestra la fecha
```

- **Lotes**: hasta 50 operaciones por llamada; el servidor acepta hasta 200.
- **Idempotencia**: el recibo y el cambio se graban juntos. Si la respuesta se pierde (corte de red después de
  aplicar), el reenvío con el mismo `op_id` devuelve `duplicado` (probado: 4.2 en navegador y caso 2 en el servidor real).
- **Estado "enviando" persistido**: si el navegador se cierra con un lote en vuelo, al volver se consulta
  `hse_sync_confirm` antes de reenviar.
- **Control de versiones y conflictos**: cada fila tiene `row_version` (servidor). La detección no depende del
  reloj del dispositivo: el cliente envía sólo los campos que cambió y el valor que veía; si otro usuario cambió **ese
  mismo campo**, el servidor responde `conflicto` y **no escribe nada**. Cambios de dos usuarios en **campos distintos**
  se fusionan (caso 5 del servidor real; 6.3 en navegador).
- **Orden causal**: una operación retenida (conflicto/rechazo/espera) bloquea las posteriores del mismo registro.
- **Archivos sin duplicar**: ruta determinística `{org}/{auditoría}/{evidencia}.ext` sin sobrescritura; si el servidor
  ya lo tiene se toma como recibido. El metadato sólo se acepta si el archivo ya está en Storage.
- **Carga reanudable**: archivos > 6 MB usan TUS en trozos de 6 MB; la URL de la carga se guarda en IndexedDB y
  continúa desde el último trozo confirmado tras un corte o una recarga (probado: 4.3 con PDF de 14,7 MB y 4 cortes).

## 4. Seguridad

- **La autorización offline no es definitiva.** El dispositivo sólo muestra una copia; cada operación se
  autoriza de nuevo en el servidor (`hse_sync_push` es `SECURITY INVOKER`: aplica RLS del usuario). Probado en el
  servidor real: lector, otra organización, organización falsificada, columna protegida y **usuario dado de baja
  mientras trabajaba sin conexión** → `rechazado`.
- **Revalidación periódica**: cada inicio con conexión revalida sesión y membresías. Más de **7 días** sin revalidar
  → la app se bloquea (conserva datos y pendientes). Más de **30 días** → borrado seguro de lo ya sincronizado;
  sólo se conservan los cambios pendientes (probado: 8.1, 8.2, 8.3).
- **Cifrado de archivos**: AES-GCM 256 con `CryptoKey` no exportable guardada en IndexedDB. Borrado seguro por
  destrucción de la clave al cerrar sesión o borrar datos (crypto-shredding).
- **Minimización**: perfiles sólo con nombre/correo/cargo de los miembros; respuestas y evidencias sólo dentro de la
  ventana de 90 días; las auditorías cerradas antiguas se quitan del dispositivo salvo las marcadas
  "disponible sin conexión"; al perder acceso a una organización sus datos se purgan.
- **Alcance real del cifrado**: protege frente a acceso accidental o copia del perfil del navegador. No protege
  frente a quien use el equipo con la sesión abierta. Los datos estructurados (texto) en IndexedDB no se cifran:
  los protegen el aislamiento por origen del navegador, la expiración y el borrado al cerrar sesión. Para equipos
  compartidos se recomienda el bloqueo de pantalla del sistema y perfiles de navegador por usuario.

## 5. Estados visibles

El indicador de la barra superior (`data-sync-phase`) muestra siempre uno de estos estados y la **fecha de la última
sincronización confirmada**:

| Estado | Cuándo |
|---|---|
| **Sin conexión** | el navegador está offline o el servidor no responde (indica cuántos cambios esperan) |
| **Pendiente de sincronizar** | hay cambios en la cola y hay conexión |
| **Sincronizando…** | envío o descarga en curso (con avance de subidas de archivos) |
| **Sincronizado** | cola vacía y última descarga correcta |
| **Error** | hay operaciones en conflicto, rechazadas o con error; se revisan en *Sincronización* |

Cada respuesta del checklist muestra "Pendiente de sincronizar" y cada foto "sin subir" hasta su confirmación.
Advertencias: al cerrar sesión o borrar datos locales con pendientes (diálogo con la cantidad de cambios que se
perderían) y aviso nativo del navegador al cerrar o salir de la pestaña.

## 6. Pruebas realizadas y su alcance

| Prueba | Dónde | Resultado |
|---|---|---|
| Protocolo del servidor (15 casos: idempotencia, fusión, conflictos, permisos, archivo requerido, baja de usuario) | **Supabase real** (`supabase/tests/sync_push_protocol.sql`) | 15/15 según lo esperado |
| Confirmación de recibos por usuario | Supabase real | OK |
| RLS, Storage y semántica de upsert | Supabase real | 21/21 + OK |
| 26 escenarios de uso (cortes, recargas, foto de 16,5 MB, PDF de 14,7 MB reanudable, sincronización repetida, dos usuarios simultáneos, advertencias, expiración) | Chromium headless real, viewport de celular; **backend simulado** | 26/26 en 4 corridas consecutivas |
| Unitarias (motor de puntuación, cola, importador) | Node | 13/13 |

**Lo que todavía no está demostrado.** Las pruebas de navegador usan un Chromium real (IndexedDB, Service Worker,
WebCrypto y modo offline del navegador son los auténticos), pero corren en un servidor de pruebas sin acceso a
internet: Supabase se reemplazó por un simulador (`tests/e2e/fake_supabase.py`) que reproduce el protocolo, y las
fotos se inyectan como archivos en lugar de usar la cámara. Por eso **no se afirma que la aplicación funcione offline
en campo** hasta completar el protocolo de `docs/prueba-en-dispositivo.md` en un celular o tablet real, contra el
proyecto Supabase real y con un corte de red físico.
