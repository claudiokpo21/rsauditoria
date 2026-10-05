# Manual de usuario · HSE Audit Manager

Aplicación para planificar y ejecutar auditorías de Seguridad e Higiene, Salud Ocupacional, Medio Ambiente y CSMS,
registrar hallazgos, tratar sus causas y seguir las acciones hasta verificar su eficacia. Funciona en computadora,
tablet y celular, también sin señal.

## 1. Primeros pasos

1. Abrir la dirección de la aplicación en el navegador (Chrome en Android, Safari en iPhone/iPad).
2. **Instalar** (recomendado en campo): Android › menú ⋮ › *Instalar aplicación*; iPhone › Compartir › *Agregar a
   inicio*. Queda como una app más y abre sin conexión.
3. Ingresar con el correo y la contraseña. Quien recibió una invitación debe registrarse **con el mismo correo**.
4. Arriba a la derecha se ve la **organización** activa, el rol y el indicador de sincronización:

| Indicador | Significa |
|---|---|
| ✓ Sincronizado (fecha) | Todo lo cargado está en el servidor; muestra la última confirmación |
| ↑ N pendientes | Hay cambios guardados en el equipo que todavía no llegaron al servidor |
| Sin conexión | Se trabaja con la copia local; se enviará al volver la señal |
| Error / conflicto | Algo requiere atención: tocar el indicador abre *Sincronización* |

5. 🔔 **Avisos** muestra vencimientos y verificaciones pendientes que le corresponden.

## 2. Qué puede hacer cada rol

| Rol | Puede |
|---|---|
| **Administrador** | Todo, más: invitar usuarios y cambiar roles, **reabrir auditorías cerradas o canceladas** (con motivo) |
| **Coordinador HSE** | Planificar auditorías y asignar líder y equipo, revisar y cerrar auditorías, verificar eficacia, reabrir hallazgos verificados, gestionar plantillas y empresas |
| **Auditor** | Ejecutar las auditorías donde fue asignado (líder o auditor), registrar hallazgos, causas y planes de acción, completar la auditoría. Como *observador* sólo lee |
| **Responsable de acciones correctivas** | Ver sus acciones y el hallazgo al que pertenecen; informar avance, adjuntar evidencia y marcarlas completadas |
| **Usuario de consulta** | Ver auditorías, hallazgos, informes y dashboard; no modifica |
| **Responsable de contratista** | Ver las auditorías de su empresa; informar avance de las acciones asignadas a su empresa |

Los botones que no corresponden a su rol no aparecen; aunque se intentara por otra vía, el servidor lo rechaza.

## 3. Auditorías (Coordinación / Auditor)

### 3.1 Planificar
*Auditorías › Nueva auditoría*: plantilla (sólo versiones publicadas), empresa/contratista, ubicación, proceso,
fecha programada, alcance y **Auditor líder** (Coordinación lo elige; un auditor queda como líder de las que crea).
En la ficha, la tarjeta *Equipo asignado › Asignar* agrega auditores u observadores (el campo *Equipo auditor* es
sólo texto libre para el informe).

Filtros útiles: *Planificadas atrasadas*, *Sólo donde participo*. La marca **Atrasada** indica fecha programada vencida.

### 3.2 Preparar para trabajar sin señal
Con conexión, abrir la auditoría y tocar **Descargar para usar sin conexión** hasta ver **✓ Disponible sin conexión**.
Desde ese momento se puede responder, sacar fotos y registrar hallazgos en modo avión.

### 3.3 Ejecutar
1. **Iniciar**.
2. Para cada pregunta elegir la respuesta (cumple / no cumple / N/A o la escala de la plantilla), comentario y
   **📷 Evidencia** (las fotos se comprimen y guardan cifradas en el equipo hasta subirse).
3. Preguntas marcadas como **obligatorias** deben responderse; las **críticas** con incumplimiento exigen un hallazgo;
   las que piden evidencia ante un incumplimiento exigen al menos una foto o archivo.
4. **Registrar hallazgo** en la pregunta (queda vinculado a la pregunta y su requisito) o **Hallazgo general** si no
   corresponde a una pregunta.
5. El puntaje que se ve mientras se trabaja dice **"Vista previa"**: el resultado oficial lo calcula el servidor al
   completar, con las reglas de la versión de la plantilla.

### 3.4 Completar
Antes de **Completar**, la ficha muestra *Para completar:* con las preguntas obligatorias sin responder, evidencias
faltantes y críticos sin hallazgo; mientras existan, el botón queda bloqueado. Al confirmar, la ventana separa
*Pendientes detectados en este dispositivo* y *Pendientes según el servidor*, y advierte si hay "cambio(s) por
sincronizar". El servidor vuelve a validar todo al recibir la operación. Sin conexión, la auditoría se marca completada
en el equipo "(se confirmará al sincronizar)"; si el servidor encuentra un pendiente, la operación queda rechazada en
*Sincronización* con el motivo, para corregirlo y reintentar.

Al completarse aparece el **Resultado oficial** (puntaje, % de cumplimiento, banda y resultado por sección).

### 3.5 Revisar, cerrar, cancelar, reabrir
- **Revisar** (Coordinación, distinta del líder; requiere conexión): *Registrar revisión* con observaciones.
- **Devolver a ejecución** (Coordinación): vuelve a *en curso* para corregir; borra la revisión.
- **Cerrar auditoría** (Coordinación): exige revisión registrada, **Resumen y conclusiones**, y que cada no
  conformidad tenga plan de acción. Una auditoría cerrada no admite cambios.
- **Cancelar auditoría** (Coordinación/Administración): motivo de al menos 10 caracteres, que queda en el resumen.
- **Reabrir (autorización especial)** (sólo Administrador, con conexión; auditorías cerradas o canceladas): motivo de
  al menos 20 caracteres; queda registrado quién, cuándo y por qué, y se borra la revisión anterior.

## 4. Hallazgos

### 4.1 Registrar
Campos: **Título**, **Descripción objetiva** (qué se observó, dónde, cuándo, evidencia — sin opiniones),
**Requisito incumplido** y **Referencia legal**, **Clasificación** (NC mayor, NC menor, Observación, Oportunidad de
mejora), **Severidad**, **Categoría** (se hereda de la plantilla), **Proceso**, **Responsable del tratamiento** y
**Fecha límite de tratamiento**, **Acción inmediata / contención**, evidencias.

El servidor completa la pregunta a partir de la respuesta y detecta **recurrencias**: si el mismo requisito ya tuvo un
hallazgo en otra auditoría de la misma empresa, se marca "2.ª vez", "3.ª vez"… con enlace al anterior.

### 4.2 Análisis de causa raíz
En la ficha del hallazgo, *Análisis de causa raíz*: método **5 porqués**, **Ishikawa (6M)** u otro; completar el
análisis y la **Causa raíz identificada** › *Guardar análisis*. Una no conformidad no puede cerrarse sin causa raíz.

### 4.3 Plan de acción
*Agregar acción*: **Tipo** (contención, correctiva, preventiva), descripción, responsable (usuario o empresa
contratista), vencimiento y **Criterio de eficacia** (cómo se comprobará que funcionó, p. ej. "sin extintores
vencidos en 3 inspecciones"). Una NC necesita al menos una acción **correctiva**.

### 4.4 Cierre y verificación de eficacia
1. El hallazgo pasa a **Cerrado** cuando tiene causa raíz (si es NC), acción correctiva y **todas las acciones
   completadas o verificadas**.
2. **Verificar eficacia** de cada acción y luego del hallazgo: resultado (eficaz / no eficaz) y evidencia de la
   verificación. Quien es responsable de una acción no puede verificarla (independencia).
3. Un hallazgo **Verificado** es cierre definitivo; sólo Coordinación/Administración lo reabre con motivo.

Si la verificación resulta "no eficaz", el hallazgo igual queda *Verificado* con ese resultado: para tratarlo de
nuevo, Coordinación o Administración lo reabre (motivo de al menos 20 caracteres) y se agregan nuevas acciones.

## 5. Planes de acción (Responsables)

*Planes de acción* lista lo que le corresponde, con filtros *Vencidas*, *Vencen en 7 días*, *Abiertas*,
*Verificadas*. En cada acción: **Avance / evidencia de implementación**, adjuntar fotos o documentos y cambiar el
estado a *En curso* o *Completada*. El responsable no puede cambiar el vencimiento, el responsable ni el criterio de
eficacia: si necesita una prórroga, la solicita a quien coordina la auditoría.

## 6. Avisos de vencimiento

Se generan en el servidor y aparecen en *Avisos* (y como notificación del navegador si se habilita):

| Aviso | Para |
|---|---|
| Acción por vencer (≤ 7 días) | Responsable y contratista responsable |
| Acción vencida | Responsable, contratista responsable, líder de la auditoría y Coordinación |
| Verificación de eficacia pendiente (acción completada) | Líder y Coordinación |
| Hallazgo vencido sin cerrar | Responsable y líder |

El aviso desaparece solo cuando deja de aplicar. Tocarlo abre la acción o el hallazgo.

## 7. Informes y dashboard

- **Dashboard**: indicadores con filtros desde/hasta/empresa. Indica si los datos vienen **del servidor** o **del
  dispositivo** (sin conexión, con la fecha de la última sincronización). Incluye cumplimiento promedio, auditorías
  por estado y atrasadas, resultados por categoría y sección, hallazgos por tipo/severidad/estado, acciones vencidas,
  ranking por empresa y hallazgos recurrentes.
- **Informes › Informe de auditoría**: PDF (con registro fotográfico e historial opcionales) o Excel con resultado
  oficial y por sección, checklist, hallazgos con causa raíz y plan de acción, historial.
- **Informes › Informe de gestión**: PDF o Excel del período y empresa elegidos: resultados por categoría, sección y
  empresa, distribución de hallazgos, recurrentes, evolución mensual, seguimiento de auditorías y plan de acción.
- **Descargar consolidado (.xlsx)**: todas las auditorías, hallazgos y acciones visibles.

Cada usuario sólo obtiene en los informes lo que su rol le permite ver.

## 8. Trabajo sin conexión — reglas de oro

1. **Descargar** la auditoría antes de salir a campo y verificar *✓ Disponible sin conexión*.
2. No cerrar sesión ni borrar datos del navegador con cambios pendientes (la app avisa).
3. Al volver la señal, abrir la app y esperar **✓ Sincronizado**; no hace falta reenviar nada.
4. Si aparece **conflicto** (otra persona cambió el mismo dato), ir a *Sincronización* y elegir qué versión queda.
5. Pasados **7 días** sin conectarse la app se bloquea hasta revalidar (los datos se conservan); a los **30 días** se
   borra lo ya sincronizado del equipo (lo pendiente se conserva).

## 9. Administración

- **Usuarios y organización**: invitar por correo con rol (el responsable de contratista se asocia a su empresa),
  cambiar rol, desactivar (el acceso se corta en el próximo uso con conexión).
- **Empresas y ubicaciones**: contratistas y subcontratistas (estado CSMS y vigencia), yacimientos, bases, plantas.
- **Plantillas**: crear o importar (lista H&P en Excel), revisar incidencias, ejecutar casos de validación, validar y
  **publicar**. Una versión publicada no se modifica: para cambiar criterios se crea una versión nueva; las
  auditorías existentes conservan la versión con que se hicieron.
- **Historial de cambios**: quién cambió qué, cuándo, con el valor anterior y el nuevo.

## 10. Preguntas frecuentes

**No puedo completar la auditoría.** Revise la lista *Para completar*; si se advierten "cambio(s) por sincronizar",
conecte y espere ✓ Sincronizado.
**No puedo cerrar.** Falta la revisión de Coordinación, el resumen, o una NC sin plan de acción.
**El puntaje del celular no coincide con el informe.** El del celular es una vista previa; vale el oficial.
**No veo una auditoría.** Sólo se ven las asignadas (auditores) o las de su empresa (contratistas).

## 11. Organización de ejemplo

Para conocer la aplicación o capacitar al equipo sin tocar datos reales: *Crear organización de ejemplo* (en el primer
ingreso, en el Dashboard vacío o en *Usuarios y organización*). Se crea una organización aparte con contratistas,
auditorías en todos los estados, hallazgos con causa raíz, acciones vencidas y por vencer, y hallazgos recurrentes.
Para volver a su organización, elíjala en la barra superior. Requiere conexión.

## 12. Cómo leer el resultado

En cada auditoría, la planilla de resultado muestra, como la planilla H&P: los requisitos del sistema de gestión con
puntaje alcanzado, puntaje objetivo y evaluación (0 a 10) coloreada según el criterio de evaluación — **Muy Bueno**
(8,01 a 10, celeste), **Bueno** (6,01 a 8, verde), **Regular** (4,01 a 6, amarillo) y **Crítico** (0 a 4, naranja) —,
y la fila de resultado final (promedio de las secciones). El recuadro grande indica si es el **resultado oficial**
(calculado por el servidor al completar) o una **vista previa** mientras se trabaja.

## 13. Reunión de cierre y firmas

Al terminar la auditoría, en la tarjeta *Reunión de cierre y firmas*: cargue la fecha, los asistentes y los acuerdos
(*Guardar acta*) y toque **Agregar firma**. Elija quién firma (auditor líder, representante del contratista, etc.),
el nombre, y si firma **conforme** o **con observaciones** (en ese caso escriba las observaciones). La persona firma con
el dedo en el recuadro. Funciona sin señal: las firmas se envían al sincronizar. Si una firma quedó mal, **Dar de baja**
y firmar de nuevo (queda registrado). Con la auditoría cerrada, el acta y las firmas ya no cambian. El informe PDF
incluye el acta con las firmas.

## 14. Comparación con la auditoría anterior

Si la empresa ya tuvo una auditoría completada con la misma plantilla, la planilla de resultado muestra la nota
**anterior** de cada requisito y la **variación**: ▲ en verde si mejoró, ▼ en rojo si empeoró. Debajo se indica con qué
auditoría se compara. Lo mismo sale en el PDF y el Excel.

## 15. Marcar sobre la foto

Al sacar o elegir una foto como evidencia se abre *Marcar sobre la foto*: elija **Flecha**, **Círculo** o **Trazo** y el
color, y arrastre sobre la imagen para señalar el desvío (*Deshacer* quita la última marca). **Guardar con marcas**
guarda la foto marcada; **Guardar sin marcas** guarda la original. Escriba también la **Descripción de la foto**
(ej.: "extintor del sector de carga con carga vencida"); se puede corregir después tocando la miniatura.

### Cómo se identifica cada foto

- Cada foto recibe un **número dentro de la auditoría** (*Foto 1*, *Foto 2*…), visible en la miniatura y en el
  visor. El número es el mismo en la pantalla, el PDF y el Excel, y no cambia al sincronizar.
- La foto queda asociada al **requisito** donde se tomó (o al hallazgo / acción donde se adjuntó).
- En el **PDF**: la lista de verificación dice "» Foto 3" en el requisito y cada hallazgo indica
  "Evidencias: Fotos 3, 4"; tocando esa celda se va a la foto. El *Registro fotográfico* está agrupado por requisito
  (número, texto del requisito y respuesta) y luego por hallazgo; cada imagen lleva el rótulo "Foto N" y debajo
  número, descripción y fecha.
- En el **Excel**, la hoja *Checklist* tiene la columna **Fotos N.º** con los números de foto de cada requisito.

## 16. Informe de auditoría (PDF)

*Informes › Informe de una auditoría › Descargar PDF* genera el informe de **RS Consultora**: carátula con la empresa
auditada y el resultado coloreado, índice con números de página (se puede tocar para ir a cada sección), 1. Datos
generales (objetivo, alcance y metodología), 2. Resumen ejecutivo, 3. Resultados por requisito con el criterio de
evaluación (y la comparación con la auditoría anterior, si existe), 4. Hallazgos y plan de acción, 5. Lista de
verificación con las respuestas en color, 6. Registro fotográfico (opcional) y 7. Acta de reunión de cierre con las
firmas. El nombre de la firma auditora se cambia en `src/config/brand.ts`.

## 17. Dictado por voz

Todos los campos de texto largos (comentarios de la lista de verificación, descripción del hallazgo, acción inmediata,
causa raíz, avance de acciones, acta de cierre…) tienen un botón de **micrófono**. Tóquelo, hable y vuelva a tocarlo
(■) para terminar; lo dictado se agrega al final del texto. La primera vez el navegador pide permiso para el micrófono.

- Comandos: **"punto"**, **"coma"**, **"punto y aparte"** (nuevo párrafo), **"nueva línea"**, **"dos puntos"**,
  **"punto y coma"**, **"abrir / cerrar paréntesis"**. "Punto de encuentro" o "punto 3" se escriben como palabras.
- En la lista de verificación el comentario dictado se guarda solo al terminar; en los formularios, con *Guardar*.
- **Conexión:** en Chrome (Android y PC) y Safari (iPhone) el reconocimiento lo hace el servicio del navegador y
  **necesita conexión**. Sin señal, use el **micrófono del teclado del celular** (Gboard o el teclado del iPhone):
  en muchos equipos funciona sin conexión si está descargado el idioma español.
- Firefox no tiene reconocimiento de voz: el botón no aparece y el campo se usa escribiendo.
- Puede hacer pausas: el micrófono sigue escuchando hasta que toca ■ (o tras unos 30 segundos de silencio).
- Revise siempre el texto antes de guardar: el reconocimiento puede confundir nombres propios y siglas.

## 18. Usuarios y permisos (panel de administración)

*Configuración › Usuarios y permisos* (sólo propietarios y administradores, con conexión):

- **Usuarios:** lista con correo, rol, empresa (contratistas), último ingreso, auditorías y acciones asignadas y estado.
  Se puede buscar por nombre o correo y filtrar por rol. Tocando un usuario se abre su ficha para:
  cambiar el **rol** (cada opción explica qué permite), elegir la empresa si es contratista, **habilitar o quitar el
  acceso** (se conserva su historial y sus firmas), **asignarle auditorías** planificadas o en curso, o **quitarlo de la
  organización**.
- **Agregar usuario › Crear con contraseña temporal** (recomendado): nombre, correo y rol. El servidor crea la
  cuenta (ya confirmada, sin esperar mails) y muestra **una sola vez** el usuario y una **contraseña temporal** para
  mandarle por WhatsApp o correo. Al primer ingreso la app le pide **elegir su propia contraseña** (mínimo 10
  caracteres) antes de entrar. Si el correo ya tenía cuenta, sólo se agrega a la organización y su contraseña no cambia.
- **Nueva contraseña temporal** (ficha del usuario): para quien no puede entrar; la anterior deja de funcionar y
  deberá elegir una propia al ingresar. No se puede para uno mismo, para un propietario (salvo otro propietario) ni
  para quien también pertenece a otra organización (ése usa "Olvidé mi contraseña").
- **Agregar usuario › Enviar invitación:** uno o varios correos a la vez con el rol elegido. Como todavía no hay envío automático de
  correos, la aplicación arma el **mensaje para el invitado** con el enlace: se copia o se manda por **WhatsApp** o
  **correo** con un toque. El enlace abre *Crear cuenta* con el correo ya cargado; al confirmar el correo e ingresar,
  queda en la organización. Si la persona ya tenía cuenta, queda agregada en el momento.
- **Invitaciones:** pendientes con su vencimiento (14 días), **Renovar** y **Revocar**.
- **Permisos por rol:** tabla de qué puede hacer cada rol. Los permisos los aplica el servidor; para cambiar lo que
  alguien puede hacer, se le cambia el rol. Siempre debe quedar al menos un propietario.

## 19. Pantallas renovadas

- **Dashboard:** saludo, tarjeta *Continuar auditoría* con el avance de la que tiene en curso, indicador tipo
  velocímetro con el resultado promedio y los colores de la metodología, indicadores clave, **mapa de requisitos por
  empresa** (última auditoría de cada empresa, cada requisito con su color), próximas auditorías y acciones que
  requieren atención. Debajo siguen todos los indicadores anteriores.
- **Celular:** barra inferior con Inicio, Auditorías, Hallazgos, Acciones y Más (menú completo).
- **Lista de verificación:** barra fija con el avance, el resultado parcial y el botón **Siguiente sin responder**;
  requisitos en pestañas con su avance; botones de respuesta grandes.
- **Al completar:** franja del color de la calificación con el resultado oficial, la variación contra la auditoría
  anterior y accesos a *Reunión de cierre y firmas* y *Descargar informe*.

## 20. Cargar una auditoría desde la planilla Excel

Al importar una planilla ya completada, sus respuestas quedan como **caso de validación** de la plantilla (sirven para
comprobar que la app calcula igual que el Excel), no como auditoría. Para pasarlas a una auditoría:

1. Publique la versión de la plantilla (Plantillas › la plantilla › **Publicar**).
2. En **Auditorías › Nueva auditoría**, elija la plantilla: aparece marcada la opción **Cargar las respuestas de la
   planilla importada** (también está el botón *Crear auditoría con las respuestas de la planilla* en la plantilla,
   en la versión publicada, sección *Casos de validación*).
3. Indique título, empresa, ubicación, fecha y tipo. Se crea la auditoría *En curso* con todas las respuestas cargadas.
4. Revísela, agregue comentarios, fotos y hallazgos, y toque **Completar**: el servidor calcula el resultado oficial y
   aparece en el dashboard.
