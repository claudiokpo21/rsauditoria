# Limitaciones conocidas

Actualizado 2026-10-03, con las migraciones 0001–0023.

Cada fila indica cómo se clasificó la limitación:
- **Bloquea prod.**: hay que resolverla antes de habilitar producción.
- **Aceptable**: se puede convivir con ella si se la conoce.

## A. Bloquean la habilitación en producción

| # | Limitación | Qué hacer |
|---|---|---|
| A1 | **El trabajo sin conexión no se probó en un dispositivo físico.** Las pruebas usaron Chromium con emulación de Pixel 7 e iPhone 13 y un servidor simulado. En particular, no se verificó Safari/iOS real (Service Worker, IndexedDB, cámara, cuotas de almacenamiento). | Completar la planilla de `docs/prueba-en-dispositivo.md` en un Android y un iPhone/iPad, con el build publicado por HTTPS y el proyecto real |
| A2 | **Respaldo de archivos y borrado por la API real de Supabase Storage sin probar.** `storage-tool.mjs` se probó con un adaptador de carpeta local. | Hacer un simulacro con la clave de servicio en un proyecto de pruebas y restaurar en un proyecto nuevo (`docs/respaldo-y-recuperacion.md` §6) |
| A3 | **Leaked password protection desactivado** en Supabase Auth. Lo informa el *Security Advisor*. | Activarlo en Authentication › Policies. También configurar SMTP propio, Site URL y Redirect URLs |
| A4 | **Proyecto Supabase compartido.** *Inventario Clear* aloja otras aplicaciones (tablas `rs_*`, funciones de inventario) que tienen funciones `SECURITY DEFINER` ejecutables por `anon`. No afectan a las tablas `hse_*`, que tienen RLS propio. Sin embargo, comparten usuarios de Auth, límites, respaldos y superficie de ataque. | Crear un proyecto exclusivo para producción y aplicar `supabase/migrations` (0001–0023) |

## B. Funcionales

| # | Limitación | Clasificación |
|---|---|---|
| B1 | **Notificaciones sólo dentro de la app y del navegador.** No hay correo electrónico ni push con la app cerrada. Las notificaciones del sistema se muestran sólo con la app abierta (o en segundo plano reciente) y con permiso concedido. | Aceptable. El correo requiere una Edge Function más un proveedor SMTP |
| B2 | **La generación de avisos depende de que alguien sincronice.** `pg_cron` no está instalado en el proyecto de pruebas, por lo que los avisos se recalculan cuando un miembro sincroniza. Si nadie usa la app, un vencimiento no genera aviso ese día. | Para producción: habilitar `pg_cron` y volver a ejecutar el bloque final de la migración 0020 (programación diaria de `hse_refresh_all_notifications`) |
| B3 | **Sin conexión, revisar y reabrir no están disponibles.** Son operaciones que el servidor debe autorizar en el momento. | Aceptable (por diseño) |
| B4 | **Completar sin conexión queda condicionado.** El dispositivo valida lo que tiene, pero la validación definitiva la hace el servidor al sincronizar. Si el servidor detecta un pendiente (p. ej., otro usuario borró una evidencia), la operación queda rechazada en *Sincronización* y hay que corregir y reintentar. | Aceptable |
| B5 | **Los informes se generan en el dispositivo.** Los PDF y Excel salen de los datos sincronizados en ese equipo. Un informe de gestión de un período muy largo con muchas fotos puede tardar o agotar memoria en celulares de gama baja. Mitigación: el informe de gestión no incluye fotos, y el de auditoría permite excluirlas. | Aceptable |
| B6 | **Informes en un único formato.** Logo y encabezado son genéricos; no hay plantillas de informe configurables por organización. | Aceptable / mejora |
| B7 | **Recurrencia estrecha.** Sólo se detecta por mismo requisito (pregunta) y misma empresa. No se detectan hallazgos similares redactados distinto ni hallazgos generales sin pregunta. | Aceptable |
| B8 | **Al reabrir no se recalcula el resultado oficial.** El resultado oficial se recalcula al volver a completar; mientras la auditoría está reabierta se muestra la vista previa. | Aceptable (por diseño) |
| B9 | **Importador limitado a la lista H&P.** Sólo reconoce la estructura de la lista *Auditoría a Segundas Partes*. Otros libros Excel requieren adaptar `hpChecklistParser.ts`. La prueba unitaria del parser no se volvió a ejecutar en esta etapa porque el .xlsx no estaba disponible (`HP_XLSX=… npm test`); la paridad del servidor sí se ejecutó. | Aceptable. Repetir la prueba con el libro antes de producción |

## C. Seguridad (riesgos residuales aceptados)

| # | Riesgo | Mitigación vigente |
|---|---|---|
| C1 | **Datos locales sólo parcialmente cifrados.** Las fotos se cifran con AES-GCM y una clave no exportable, pero las respuestas y los textos están en IndexedDB sin cifrar. Quien tenga el equipo desbloqueado y acceso al perfil del navegador puede leerlos. | Bloqueo a los 7 días, borrado a los 30 días y borrado al cerrar sesión. Recomendar bloqueo de pantalla y, si se usan dispositivos de la empresa, MDM |
| C2 | **Usuario dado de baja con el equipo sin conexión.** Puede seguir **viendo** su copia local hasta reconectar o hasta que se cumplan 7 días. No puede enviar cambios: el servidor lo rechaza. | Tiempo de bloqueo configurable en `src/sync/` |
| C3 | **Funciones `SECURITY DEFINER` ejecutables por usuarios autenticados.** El *Security Advisor* las informa. Son RPC y funciones auxiliares intencionales: todas verifican la membresía o el rol internamente, y 0023 corrigió la única que respondía sobre organizaciones ajenas. | Revisar en cada migración nueva que no queden expuestas a `anon` |
| C4 | **Borrado de archivos.** Supabase bloquea el borrado SQL directo en Storage: la depuración de huérfanos se hace por la API. La política permite a un Administrador borrar **cualquier** archivo de su organización, incluso el de una evidencia vigente (no se restringe a evidencias dadas de baja). | Sólo Administración; el respaldo diario de archivos permite recuperarlo; `storage-tool --esperados` detecta evidencias sin archivo. Mejora posible: restringir la política a rutas sin evidencia vigente |
| C5 | **Los JWT siguen válidos hasta su vencimiento** (1 h por defecto) después de desactivar a un usuario. Las políticas consultan la membresía en cada operación, de modo que la desactivación tiene efecto inmediato en el servidor. | Aceptable |

## D. Operativas

| # | Limitación |
|---|---|
| D1 | No hay monitoreo ni alertas configurados (errores del frontend, fallas de sincronización a nivel servidor). Se recomienda Sentry o similar y revisar los logs de Supabase |
| D2 | Las pruebas SQL se ejecutan manualmente (SQL Editor o `psql`); no hay CI configurado |
| D3 | Los respaldos programados y su custodia dependen de que Sistemas configure la tarea en un equipo de administración |
| D4 | Sólo hay interfaz en español (Argentina); fechas y números en formato es-AR |
