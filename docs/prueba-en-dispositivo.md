# Protocolo de prueba en dispositivo real (pendiente de ejecutar)

Hasta completar esta planilla con resultado OK **no debe afirmarse** que la aplicación funciona sin conexión en campo.
Las pruebas automáticas (`docs/offline-first.md` §6) usaron un navegador real pero un servidor simulado.

## Preparación

1. Publicar el build con HTTPS (Vercel/Netlify/Cloudflare Pages) con las variables del proyecto real
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`). El Service Worker **sólo funciona con HTTPS** (o `localhost`).
2. En Supabase › Authentication › URL Configuration: agregar el dominio publicado a *Site URL* y *Redirect URLs*.
3. Dispositivos: **un celular Android (Chrome)** y **un iPhone/iPad (Safari)** como mínimo; idealmente el modelo que
   usan los auditores. Usuario A (auditor) en un equipo y usuario B (auditor) en otro.
4. Crear en la organización una plantilla publicada, una empresa y una auditoría de prueba asignada.

## Planilla

| # | Paso | Resultado esperado | Android | iOS |
|---|---|---|---|---|
| 1 | Con conexión: ingresar, instalar la app ("Agregar a pantalla de inicio") y abrir la auditoría → **Descargar para usar sin conexión** | Botón "✓ Disponible sin conexión"; indicador "Sincronizado" con fecha | | |
| 2 | Activar **modo avión** (corte físico, no sólo desactivar Wi-Fi) | Indicador "Sin conexión" | | |
| 3 | Cerrar la app por completo y volver a abrirla desde el ícono | Abre sin red; se ve la auditoría descargada | | |
| 4 | Responder 10 ítems, escribir comentarios, sacar **3 fotos con la cámara** (una de máxima resolución) y adjuntar un PDF > 6 MB | Cada ítem "Pendiente de sincronizar"; cada foto "sin subir"; contador de pendientes | | |
| 5 | Registrar un hallazgo y una acción | Aparecen en sus listas, sin código (se asigna al sincronizar) | | |
| 6 | Reiniciar el teléfono (sin conexión) y reabrir | Respuestas, fotos y cola intactas | | |
| 7 | Intentar cerrar sesión | Aviso con la cantidad de cambios que se perderían; cancelar | | |
| 8 | Desactivar modo avión **con señal débil** (o activar/desactivar varias veces durante la subida) | "Sincronizando… Subiendo evidencia NN %"; al terminar "Sincronizado" | | |
| 9 | En Supabase (Table Editor / Storage) verificar | 10 respuestas, 1 hallazgo, 1 acción, 4 evidencias **y 4 archivos (sin duplicados)** | | |
| 10 | Pulsar **Sincronizar ahora** 3 veces | Nada cambia en el servidor ni en la cola | | |
| 11 | Usuarios A y B, ambos en modo avión, cambian **el mismo ítem** con respuestas distintas; B además comenta otro ítem | | | |
| 12 | Reconectar A y luego B | A "Sincronizado"; B "Error" con 1 conflicto; el comentario de B sí se aplica | | |
| 13 | En B: *Sincronización › Resolver* → elegir una versión | Tabla legible en el celular; tras elegir, "Sincronizado" | | |
| 14 | Un administrador desactiva a B mientras B está sin conexión y B modifica algo; B reconecta | La operación queda "Rechazada" con el motivo; no se escribe en el servidor | | |
| 15 | Anotar tiempos: subida de las fotos, duración total, consumo de datos | Registrar valores | | |

Registrar para cada dispositivo: modelo, versión del sistema, navegador, versión de la app (pantalla *Sincronización*),
fecha y quién ejecutó. Adjuntar capturas de los pasos 4, 8, 12 y 13.

## Particularidades conocidas a observar

- **iOS/Safari**: puede borrar el almacenamiento de sitios no usados por 7 días si la app **no** está instalada en la
  pantalla de inicio; instalada como PWA el almacenamiento se conserva. En *Sincronización* use "Solicitar"
  almacenamiento persistente.
- **iOS**: la subida no continúa con la app en segundo plano; debe quedar abierta hasta "Sincronizado".
- **Android**: algunos modos de ahorro de batería pausan la pestaña; mantener la app al frente durante la subida.
- La sesión de Supabase dura lo que esté configurado en el proyecto; con el token vencido la app sigue funcionando
  sin conexión y pide iniciar sesión al reconectar sin perder la cola.
