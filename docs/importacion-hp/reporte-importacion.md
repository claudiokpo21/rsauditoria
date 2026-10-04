# Reporte de importación — Formulario lista de verificación de Auditoría a Segundas Partes - H&P.xlsx

SHA-256: `606f9065f1894fb427bfe37bc4a71fca28e8bcccd6d738318a0bb96a6cf064b5`

## Resumen

| Indicador | Cantidad |
|---|---:|
| Hojas analizadas | 3 |
| Categorías (requisitos del sistema de gestión) | 6 |
| Preguntas / requisitos importados | 83 |
| — con numeración | 81 |
| — sin numeración | 2 |
| Procesos en catálogo | 8 |
| Procesos usados | 7 |
| Fórmulas encontradas | 66 |
| Fórmulas con rol identificado | 66 |
| Números duplicados | 3 |
| Saltos de numeración | 5 |
| Opciones de situación | 5 |
| Bandas de evaluación | 4 |
| Incidencias bloqueantes | 0 |
| Incidencias que requieren revisión (advertencia) | 20 |
| Incidencias informativas | 8 |

**Reproducción de resultados:** el motor reproduce exactamente todos los resultados de prueba del Excel.

## 1. Diagnóstico de hojas

| Hoja | Rango | Filas | Celdas combinadas | Fórmulas | Formato condicional | Validaciones | Rol |
|---|---|---:|---:|---:|---:|---:|---|
| Table 1 | B2:O110 | 106 | 47 | 45 | 1 | 1 | Checklist (plantilla + ejecución de ejemplo) |
| Hoja1 | B7:K21 | 12 | 17 | 21 | 2 | 0 | Resumen de resultados por requisito (referencias a Table 1) |
| Hoja2 | A2:A9 | 8 | 0 | 0 | 0 | 0 | Catálogo de procesos (lista desplegable de la columna Procesos) |

### Fórmulas

| Hoja | Celda | Fórmula | Valor en Excel | Rol |
|---|---|---|---:|---|
| Table 1 | N16 | `=SUM(I24:L24)` | 16 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O16 | `=N16/(F24*3)*10` | 6.6667 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F24 | `=COUNTA(F16:F23)+COUNTBLANK(F16:F23)` | 8 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | H24 | `=SUMIF(H16:H23,"X")` | 0 / vacío | Suma de N/A (sin efecto, ver incidencias) |
| Table 1 | I24 | `=SUM(I16:I23)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J24 | `=SUM(J16:J23)` | 2 | Suma de puntos de la columna OBS |
| Table 1 | K24 | `=SUM(K16:K23)` | 2 | Suma de puntos de la columna OPM |
| Table 1 | L24 | `=SUM(L16:L23)` | 12 | Suma de puntos de la columna OK |
| Table 1 | N25 | `=SUM(I55:L55)` | 63 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O25 | `=N25/(F55*3)*10` | 7 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F55 | `=COUNTA(F25:F54)+COUNTBLANK(F25:F54)` | 30 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | I55 | `=SUM(I25:I54)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J55 | `=SUM(J25:J54)` | 6 | Suma de puntos de la columna OBS |
| Table 1 | K55 | `=SUM(K25:K54)` | 6 | Suma de puntos de la columna OPM |
| Table 1 | L55 | `=SUM(L25:L54)` | 51 | Suma de puntos de la columna OK |
| Table 1 | N56 | `=SUM(I84:L84)` | 65 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O56 | `=N56/(F84*3)*10` | 7.7381 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F84 | `=COUNTA(F56:F83)+COUNTBLANK(F56:F83)` | 28 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | I84 | `=SUM(I56:I83)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J84 | `=SUM(J56:J83)` | 3 | Suma de puntos de la columna OBS |
| Table 1 | K84 | `=SUM(K56:K83)` | 2 | Suma de puntos de la columna OPM |
| Table 1 | L84 | `=SUM(L56:L83)` | 60 | Suma de puntos de la columna OK |
| Table 1 | N85 | `=SUM(I89:L89)` | 4 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O85 | `=N85/(F89*3)*10` | 3.3333 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F89 | `=COUNTA(F85:F88)+COUNTBLANK(F85:F88)` | 4 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | I89 | `=SUM(I85:I88)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J89 | `=SUM(J85:J88)` | 1 | Suma de puntos de la columna OBS |
| Table 1 | K89 | `=SUM(K85:K88)` | 0 / vacío | Suma de puntos de la columna OPM |
| Table 1 | L89 | `=SUM(L85:L88)` | 3 | Suma de puntos de la columna OK |
| Table 1 | N90 | `=SUM(I93:L93)` | 5 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O90 | `=N90/(F93*3)*10` | 5.5556 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F93 | `=COUNTA(F90:F92)+COUNTBLANK(F90:F92)` | 3 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | I93 | `=SUM(I90:I92)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J93 | `=SUM(J90:J92)` | 1 | Suma de puntos de la columna OBS |
| Table 1 | K93 | `=J93` | 4 | Suma de puntos de la columna OPM |
| Table 1 | L93 | `=J93` | 0 / vacío | Suma de puntos de la columna OK |
| Table 1 | N94 | `=SUM(I104:L104)` | 22 | Puntaje obtenido de la sección (suma de situaciones) |
| Table 1 | O94 | `=N94/(F104*3)*10` | 7.3333 | Nota de la sección 0–10 = obtenido / (ítems × 3) × 10 |
| Table 1 | F104 | `=COUNTA(F94:F103)+COUNTBLANK(F94:F103)` | 10 | Cantidad de filas de la sección (todas, respondidas o no) |
| Table 1 | I104 | `=SUM(I94:I103)` | 0 / vacío | Suma de puntos de la columna NC |
| Table 1 | J104 | `=SUM(J94:J103)` | 1 | Suma de puntos de la columna OBS |
| Table 1 | K104 | `=SUM(K94:K103)` | 0 / vacío | Suma de puntos de la columna OPM |
| Table 1 | L104 | `=SUM(L94:L103)` | 21 | Suma de puntos de la columna OK |
| Table 1 | N105 | `=SUM(N16+N25+N56+N85+N90+N94)` | 175 | Total de puntos obtenidos (informativo, no interviene en la nota final) |
| Table 1 | O105 | `=AVERAGE(O16,O25,O56,O85,O90,O94)` | 6.2712 | Resultado final = promedio simple de las notas de sección |
| Hoja1 | I8 | `='Table 1'!N16` | 16 | Puntaje alcanzado (referencia) |
| Hoja1 | J8 | `='Table 1'!F24*3` | 24 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K8 | `='Table 1'!O16` | 6.6667 | Evaluación (referencia a la nota) |
| Hoja1 | I9 | `='Table 1'!N25` | 63 | Puntaje alcanzado (referencia) |
| Hoja1 | J9 | `='Table 1'!F55*3` | 90 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K9 | `='Table 1'!O25` | 7 | Evaluación (referencia a la nota) |
| Hoja1 | I10 | `='Table 1'!N56` | 65 | Puntaje alcanzado (referencia) |
| Hoja1 | J10 | `='Table 1'!F84*3` | 84 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K10 | `='Table 1'!O56` | 7.7381 | Evaluación (referencia a la nota) |
| Hoja1 | I11 | `='Table 1'!N85` | 4 | Puntaje alcanzado (referencia) |
| Hoja1 | J11 | `='Table 1'!F89*3` | 12 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K11 | `='Table 1'!O85` | 3.3333 | Evaluación (referencia a la nota) |
| Hoja1 | I12 | `='Table 1'!N90` | 5 | Puntaje alcanzado (referencia) |
| Hoja1 | J12 | `='Table 1'!F93*3` | 9 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K12 | `='Table 1'!O90` | 5.5556 | Evaluación (referencia a la nota) |
| Hoja1 | I13 | `='Table 1'!N94` | 22 | Puntaje alcanzado (referencia) |
| Hoja1 | J13 | `='Table 1'!F104*3` | 30 | Puntaje objetivo de la sección (ítems × máximo) |
| Hoja1 | K13 | `='Table 1'!O94` | 7.3333 | Evaluación (referencia a la nota) |
| Hoja1 | I15 | `=SUM(I8:I13)` | 175 | Total de la columna |
| Hoja1 | J15 | `=SUM(J8:J13)` | 249 | Total de la columna |
| Hoja1 | K15 | `='Table 1'!O105` | 6.2712 | Evaluación (referencia a la nota) |

## 2. Mapeo de celdas de origen a entidades

| Origen | Destino | Regla | Importado |
|---|---|---|---|
| 'Table 1'!B16… | hse_template_sections.title | Celda combinada de la columna "Requisitos" = categoría/requisito del sistema de gestión (texto exacto). | Sí |
| 'Table 1'!Dn | hse_template_items.original_number / code | Numeración tal cual figura (sin renumerar). | Sí |
| 'Table 1'!En | hse_template_items.question | Texto completo del requisito, sin recortar. | Sí |
| 'Table 1'!Gn | hse_template_items.process_id → hse_processes | Proceso a auditar (lista de Hoja2). | Sí |
| 'Table 1'!I/J/K/L15 | scoring_config.options | Opciones de situación NC/OBS/OPM/OK. | Sí |
| 'Table 1'!H14 | scoring_config.options[na] | Columna "N/A marcar X". | Sí |
| 'Table 1'!Fn | — (excluido) | Evidencias/comentarios de una auditoría ejecutada. | No |
| 'Table 1'!Mn | — (excluido) | Descripción de hallazgos de una auditoría ejecutada. | No |
| 'Table 1'!I/J/K/Ln | hse_template_validation_cases.answers (sólo códigos) | Resultado histórico: sólo como caso de validación aislado; nunca como valor por defecto. | No |
| Hoja2!$A$2:$A$9 (validación de lista en G16:G23 G25:G54 G56:G83 G90:G92 G85:G88 G94:G103) | hse_processes | Catálogo de procesos auditables. | Sí |

## 3. Categorías y preguntas

### Liderazgo, Compromiso y Enfoque al Cliente  (8 requisitos · 'Table 1'!B16)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 1 | Dirección / Gerencia | 16 | El Contratista posee un organigrama de su organizacion definido y aprobado por la Direccion y/o Gerencias?  |  |
| 2 | Dirección / Gerencia | 17 | El Contratista posee Política  CSMS (Calidad, Seguridad,  Medio Ambiente y Calidad);  Politica de Alcohol  y  Drogas,  Autoridad  para detener,  Politica Vehicular,  entre  otras?.  |  |
| 3 | OPER/HSE | 18 | Se han realizado campañas de difusión de las Políticas del Contratista y del Cliente?. |  |
| 4 | Dirección / Gerencia | 19 | La Direccion del Contratista ha realizado un analisis de contexto determinando las cuestiones externas e internas pertinentes para el proposito de la Empresa y pueden afectar su capacidad para alcanzar los resultados previstos? Este analisis tiene prevista revisiones constantes? |  |
| 5 | Dirección / Gerencia | 20 | Como demuestra la Gerencia del Contratista en forma visible su compromiso en temas de CSMS ante su personal propio y de terceros?  Posee un programa sistematico de Visitas Gerenciales? Posee un plan de reuniones sobre temas de CSMS? Como Analiza y gestiona la Gerencia los requerimientos del Cliente? Ej: Roger / Pase / Sistema de Gestion de acciones?  |  |
| 6 | Dirección / Gerencia | 21 | Como trata la Direccion y Gerencias del Contratista los temas de CSMS? Realizan  revisiones sistematicas y periodicas? Que temas tratan?  Tienen en  cuenta  las  auditorias anteriores, las inspecciones de campo, observaciones preventivas de los trabajadores, ordenes de servicios, quejas e informes? |  |
| 7 | Dirección / Gerencia | 22 | Como realiza el Contratista el tratamiento y seguimiento de las OOSS, quejas, reclamos y otras comunicaciones enviadas por El cliente? Ver ejemplos |  |
| 8 | Licitaciones | 23 | Como realiza el Contratista el tratamiento y seguimiento de las licitaciones a las que se presentan? Como son analizadas las mismas? Como se aseguran los recursos para el cumplimiento de los requisitos de CSMS del Cliente ? IMPORTANTE |  |

### Planificación, Organización y Recursos  (30 requisitos · 'Table 1'!B25)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 9 | HSE | 25 | El Contratista cuenta con un Organigrama CSMS? Se ajusta al requerimiento normativo de Higiene y Seguridad? |  |
| 10 | HSE | 26 | Cual es la distribucion del personal de SMS para asistir a las operaciones de campo? Con que frecuencia asisten? |  |
| 11 | HSE | 27 | Tienen definidas las actividades del personal de SMS en forma sistematica? Cual es el tratamiento de los resultados de observaciones realizadas por el personal de SMS? Como analizan cuantitativa y cualitativamente la participacion del personl de SMS en las actividades de campo? VERIFICAR EN CAMPO |  |
| 12 | OPER/HSE | 28 | Como tiene definido el Contratista la participacion y consulta de los trabajadores no directivos? VERIFICAR EN CAMPO |  |
| 13 | OPER/HSE | 29 | El Contratista tiene implementado un sistema de observaciones preventivas? Cual es la metodologia para analizar y definir acciones? VERIFICAR EN CAMPO |  |
| 14 | OPER/HSE | 30 | Como se asegura el Contratista la comunicación al personal operativo de los resultados de las observaciones preventivas de seguridad? |  |
| 15 | OPER/HSE | 31 | El Contratista tiene implementado uno o más sistemas de identificacion de peligros/aspectos ambientales y evaluacion de riesgos/impactos ambientales? Analizar metodologia, criterios y VERFICAR EN CAMPO |  |
| 16 | OPER/HSE | 32 | El personal operativo involucrado participa de la identificacion de peligros/aspectos ambientales y evaluacion de riesgos/impactos ambientales? Evidenciar.VERFICAR EN CAMPO Como se asegura la Contratista la comunicación al personal operativo? Que medidas de control tienen definidas? |  |
| 17 | HSE | 33 | La identificacion de peligros/aspectos ambientales y evaluacion de riesgos/impactos ambientales fue presentada al Cliente? |  |
| 18 | OPER/HSE | 34 | Sobre las evaluaciones de riesgos / Impactos definidas, como establecen las medidas de control para eliminar o mitigar los mismos? Eliminar, sustituir, utilizar controles de ingenieria, administrativos, formacion, uso de EPP.  ATS - Procedimientos - instructivos |  |
| 19 | HSE | 35 | El Contratista cuenta con una matriz legal actualizada?. Cual es la metodologia de actualizacion? Como se aseguran el cumplimiento de los requisitos legales? Fue presentada al Cliente? |  |
| 20 | HSE | 36 | El  Contratista cuenta con Planes de SMS? Estan aprobados por la Direccion o Gerencia? Son coherentes con los objetivos, las Politicas, evaluaciones de riesgos e impactos, contexto y requerimientos legales? |  |
| 21 | HSE | 37 | De que manera y cada cuanto se realiza el control y seguimiento de dichos planes? |  |
| 22 | OPER/HSE | 38 | Son comunicados al personal? De que manera? VERIFICAR EN CAMPO |  |
| 23 | OPER/HSE | 39 | El Contratista realiza programas de toma de conciencia al personal? Campañas de concientizacion sobre riesgos significativos, politicas de trabajo, seguridad vial, seguridad basada en el comportamiento, etc. Como miden la eficacia? VERIFICAR EN CAMPO |  |
| 24 | OPER/RRHH | 40 | El Contratista tiene implementado  un  esquema  de  reuniones  internas  de SMS  y  un sistema de seguimiento de las acciones correctivas acordada? VERIFICAR EN CAMPO |  |
| 25 | OPER/HSE | 41 | El Contratista tiene definida las actividades de SMS para la supervisión de línea (operaciones)?  - Inspecciones SMS; Observaciones preventivas; cacerias de riesgos, etc VERFICAR EN CAMPO  |  |
| 26 | OPER/HSE | 42 | La Contratista tiene implementado un mecanismo de Dialogos Diarios en SMS? Fue presentado al Cliente? VERIFICAR EN CAMPO |  |
| 27 | OPER/HSE | 43 | Tiene el Contratista un sistema de recepcion y difusion de alertas y/o lecciones aprendidas y está documentado? Como se aseguran la difusión y aplicación de ser necesario por parte del personal? VERIFICAR EN CAMPO |  |
| 28 | OPER/RRHH | 44 | Tiene el Contratista una metodologia de selección de personal ingresante? Tienen definido los perfiles de puesto? Cual es el metodo? |  |
| 29 | OPER/HSE | 45 | El Contratista cuenta con una metodologia para empleados nuevos o en mayor funcion? |  |
| 30 | OPER/RRHH | 46 | Cuenta el Contratista con roles, responsabilidad y autoridad definidos para los perfiles de puesto? Analizarlos. Se han comunicado a los empleados de la empresa?  |  |
| 31 | OPER/RRHH | 47 | Tiene  el  Contratista  un  programa  de  capacitación y entrenamiento  en SMS por puesto de trabajo?  Fue presentado al Cliente?. (Gestion del conocimiento)  |  |
| 32 | OPER/RRHH | 48 | Tiene el Contratista un programa de inducción en SMS. Como se documenta? Como se aseguran que sus contratistas lo reciban?. Como determinan la necesidades de capacitacion? |  |
| 33 | OPER/HSE | 49 | Todo el personal del Contratista afectado a las operaciones del Cliente ha recibido la capacitación sobre las 10 Reglas de Oro, Políticas y procedimientos obligatorios del Cliente? Programa ROGER y PASE? |  |
| 34 | OPER/RRHH | 50 | Cuenta   el   Contratista   con   mecanismos   de   evaluación   de   desempeño   de   sus empleados. Incluyen pruebas de conocimientos y habilidades en el trabajo. Como miden la eficacia? |  |
| 35 | OPER/HSE | 51 | La contratista cuenta  con un sistema o mecanismo de  control de certificaciones de Operadores   y   Equipamiento   para   actividades   críticas.   (Operador   manipulador hidráulico, manlift, hidrogrúa, trabajo en altura, well control, equipo de izaje, etc.) VERIFICAR EN CAMPO |  |
| 36 | OPER/SALUD | 52 | La Contratista cuenta con un sistema de examenes medicos de acuerdo a los peligros y riesgos asociados a las distintas actividades de sus empleados? VERIFICAR CON EMPLEADOS DEL CAMPO. Cerrar tema con RRHH | numeracion_duplicada |
| 36 | **—** | 53 | El Contratista tiene algun sistema de seguimiento de los exámenes médicos de los subcontratistas? | numeracion_duplicada, proceso_faltante |
| 37 | OPER/HSE | 54 | El Contratista cuenta con procedimientos para la ejecución de los trabajos objeto del contrato. Fueron presentados al referente del Cliente? VERIFICAR EN CAMPO.Como se aseguran el entrenamiento de sus trabajadores sobre los mismos? Los trabajadores los conocen? |  |

### Operación y control operacional  (28 requisitos · 'Table 1'!B56)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 38 | OPER/HSE | 56 | El Contratista ha implementado  un  programa  de  inspecciones focalizado en  las  tareas  críticas  de su proceso?. Con que frecuencia?  Como realiza el  seguimiento   de   las   acciones   de   mejora sobre las observaciones o incumplimientos detectados?. VERIFICAR EN CAMPO |  |
| 39 | OPER/HSE | 57 | Cuenta el Contratista con un sistema de verificación  de  puesta  en  marcha de sus equipos  instalados,  montados  o  modificados.  Se  realiza  y  registra  este  chequeo  antes  del arranque de las operaciones en cada sitio o locacion? |  |
| 40 | OPER/HSE | 58 | Hay evidencia documentada de que los supervisores o responsables operativos entrenan a los empleados para controlar los riesgos de las actividades? Reuniones pretareas, reuniones de seguridad periódicas in situ, etc |  |
| 41 | OPER/HSE | 59 | Tiene el Contratista implementado un proceso de Gestion para el control de los  cambios  temporales y/o permanentes? Ver aplicación práctica |  |
| 42 | OPER/RRHH | 60 | Trabajo en Altura: - Cuenta con las Habilitaciones y/o Certificaciones necesarias?. - Se realizan los Exámenes médicos correspondientes al personal que realiza trabajos en altura?.                                                                                                             Si utiliza el procedimiento del Cliente ha capacitado a su personal en el mismo?  |  |
| 43 | OPER/RRHH | 61 | Trabajo en Altura: -Cuenta el Contratista con  Medición y seguimiento de vida útil de elementos de trabajos en altura?. - Cuenta la Contratista con Procedimientos e instructivos alineados.                                                     - Los EPP de altura son provistos en forma personal a los trabajadores afectados a la tarea?                                                                                                                                                               - Los EPP son chequeados antes de su uso? Queda registro? |  |
| 44 | OPER/RRHH | 62 | Izaje de Cargas  - Cuenta con Certificaciones: del equipo, los accesorios, el señalero, el eslingador y el operador del equipo de izaje? - Se realizan los Exámenes médicos correspondientes al personal que realiza estas tareas?                                                                                                                           Si utiliza el procedimiento del Cliente ha capacitado a su personal en el mismo?  |  |
| 45 | OPER/RRHH | 63 | Izaje de Cargas  - El Supervisor de Izaje está calificado? -  Cuenta la Contratista con Procedimientos e instructivos alineados |  |
| 46 | OPER/RRHH | 64 | Espacios Confinados:                                                                                                                                                         - Se cuenta con una identficacion de los espacios confinados? - Cuenta con las habilitaciones o certificaciones correspondientes? - El sistema implementado contempla tiempo de trabajo y descanso o relevo?                                                                                                                                                             Si utiliza el procedimiento del Cliente ha capacitado a su personal en el mismo?  |  |
| 47 | OPER/RRHH | 65 | Espacios Confinados:: - Se encuentran provistos los Elementos de Protección Personal necesarios para la tarea?. - Se cuenta con un Plan de emergencia para Espacios confinados? |  |
| 48 | OPER/HSE | 66 | Well Control:                                                                                                                                                        - El personal afectado a la operación cuenta con capacitacion y certificación en Control de pozo? - Se cuenta con el equipamiento adecuado y certificado? |  |
| 49 | OPER/HSE | 67 | Sistemas de Bloqueos y Etiquetados: - Se cuenta con un Inventario de dispositivos según tipo de energía. Etiquetas. - Cuentan con Procedimientos e instructivos.  - Verificaciones, registros. - Capacitaciones del personal sobre Procedimientos e instructivos del Cliente. |  |
| 50 | **—** | 68 | Sistema de Permisos de trabajo:                                                                                                                                                                 - Se cuenta con procedimiento propio y se implementa el del cliente? - Cuentan con las capacitaciones y habilitaciones correspondientes del personal segun su jerarquia de participacion en los Permisos de trabajo? Solicitante, Analista de gases, Aprobador, etc VERIFICAR EN CAMPO SU APLICACION | proceso_faltante |
| 51 | OPER/HSE | 69 | Equipos de criticos de seguridad: el contratista tiene implementada alguna metodologia de control de los equipamientos criticos de seguridad? Posee una identificacion de los mismos? Ej: equipos de monogases; multigases, equipos de respiracion autónoma. VERIFICAR EN CAMPO  Fue presentado al Cliente? |  |
| 52 | OPER/HSE | 70 | El Contratista tiene implementada alguna campaña o documentacion sobre orden y limpieza en sus instalaciones?  Como realiza las verificaciones del estado de orden y limpieza en área de trabajo?. Fue presentado al Cliente? |  |
| 53 | OPER/HSE | 71 | Gestión Vehícular: - El  Contratista tiene implementado algun sistema de control de performance de conduccion vehicular? Explicar proceso. - Que documentacion y con que frecuencia al Cliente? - Tienen implementado un sistema de Parque cerrado?. - Tienen implementado algun sistema de Gerenciamiento de viajes? VERIFICAR EN CAMPO |  |
| 54 | OPER/HSE | 72 | Gestión Vehicular equipos pesados: - el Contratista tiene implementado algun sistema de manejo y control de cargas? VERIFICAR EN CAMPO |  |
| 55 | OPER/HSE | 73 | El Contratista mantiene medidas de control  sobre   el  manejo   de  productos  químicos  - Inventario,  elementos  de  protección  personal,  procedimientos  de  transporte,  uso  y disposición, hojas de seguridad, etc. Fue presentado al Cliente? |  |
| 56 | OPER/HSE | 74 | Como implementa el Contratista la Gestión  de Residuos? Tiene procedimiento que contemple los  tipos  de  residuos  generados  en  su  proceso  y  registre  la  trazabilidad  de  los mismos?. Mantiene la gestion del Cliente? Capacitó a su personal en ambos procedimientos? |  |
| 57 | OPER/HSE | 75 | El Contratista mantiene un programa de Caída de Objetos. Verificar su implementacion.  Registros. Fue presentado al Cliente? |  |
| 58 | OPER/HSE | 76 | El Contratista tiene mediciones de Iluminación según Res. 84/2012, Existe plan con acciones de mejora sobre los resultados de las mediciones? |  |
| 59 | OPER/HSE | 77 | El Contratista tiene mediciones de Ruido según Res. 85/2012. Existe plan con acciones de mejora sobre los resultados de las mediciones? |  |
| 60 | OPER/HSE | 78 | El Contratista ha realizado el estudio de ergonomia según Res. 886/2015 sobre protocolo de ergonomia. |  |
| 62 | OPER/HSE | 79 | Bacteriológico y fisicoquímico del agua de uso humano |  |
| 63 | OPER/HSE | 80 | El Contratista mantiene mediciones de puesta a Tierra según Res. 900/2015. Existe plan con acciones de mejora sobre los resultados de las mediciones? | numeracion_duplicada |
| **s/n** | OPER/HSE | 81 | Sistema de suministro de Gas oil | sin_numeracion |
| **s/n** | **—** | 82 | Mochilas lavaojos | sin_numeracion, proceso_faltante |
| 64 | OPER/HSE | 83 | Tiene  el  Contratista  documentado   el  programa  de  mantenimiento  preventivo  e inspección  de  los  equipos  que  utiliza  para  el  contrato  (equipo  pesado,  grúas, vehículos, herramientas y equipos). | numeracion_duplicada |

### Gestión de Proveedores  (4 requisitos · 'Table 1'!B85)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 63 | Compras/Contrat. | 85 | El Contratista tiene definido un sistema para la difusión de las Políticas, Objetivos y Procedimientos de SMS propios y del cliente a sus subcontratistas? ¿Cómo se asegura el control de estos documentos? Fue presentado al Cliente?  VERIFICAR EN CAMPO | numeracion_duplicada |
| 64 | Compras/Contrat. | 86 | El Contratista mantiene un proceso de calificación y selección de proveedores? Se realiza una evaluacion periodica de desempeño de proveedores?  En dicha evaluación se contempla el cumplimiento de los requerimientos de SMS tano propios com de los Clientes? | numeracion_duplicada |
| 66 | Compras/Contrat. | 87 | Como evalua el Contratista en forma periodica el desempeño  de  sus proveedores?,  Incluye el  monitoreo  de  los  requerimientos SMS?. Ejemplo: Estadísticas de siniestralidad, conductas de manejo, etc |  |
| 67 | Compras/Contrat. | 88 | El Contratista mantiene un  programa  de  Auditorías  y  /  o  Inspecciones  a  los  sub-contratistas?  ¿Se verifican los requerimientos de SMS? |  |

### Preparación y respuesta ante emergencias  (3 requisitos · 'Table 1'!B90)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 68 | OPER/HSE | 90 | El Contratista ha identificado los posibles escenarios de emergencias de su actividad y ha definido su planes de respuesta específicos? Ej: - Atención de lesiones a personas y evacuación - Incendio - Derrame de produtos químicos, crudo, agua residual, combustibles, etc. - Control de pozos - Incidentes de tránsito - Presencia de Sulfhidrico , etc.                                                                                                                 Los escenarios definidos y los planes de respuestas específicos estan alineados a los del Cliente?                                                                                                                                                            Se han presentado al representante del Cliente? |  |
| 69 | OPER/HSE | 91 | El Contratista cuenta  con  los  recursos necesarios para  cumplir los distintos planes de respuesta?  Ej:  atención  de  lesionados  en  el  sitio  de trabajo, Sistemas de extinción de incendios, detectores, equipos autonomos, kits para contingencias ambientales, etc. |  |
| 70 | OPER/HSE | 92 | El Contratista tiene implementado un cronograma de simulacros? contempla todos los escenarios definidos?  Se adecua al cronograma propuesto por el cliente? Se identifican oportunidades de mejora y sedefinen planes de acción?.                                          Se verifica el cumplimiento y cierre de las acciones de mejora identificadas.? |  |

### Seguimiento, Medición, Evaluación de desempeño y Mejora Contínua  (10 requisitos · 'Table 1'!B94)

| N.º original | Proceso | Fila | Requisito (texto completo) | Marcas |
|---|---|---:|---|---|
| 71 | HSE | 94 | El Contratista tiene implementado procesos para el seguimiento, medicion, analisis y evaluación de desempeño? Ej: Indicadores de la gestión de SMS, KPI´s de cumplimiento de objetivos,  desempeño del Sistema de SMS, Etc.                                                                               |  |
| 72 | HSE | 95 | Como se analizan y se tratan los desvíos?. con que frecuencia? se generan planes de accion o modifican algun plan vigente?                                                                                                                     Se evidencia una mejora en las estadisticas de SMS? (indique el % de reducción o aumento   de   las   tasas   de   accidentes   con   días   perdidos,   totales,   vehiculares, industriales y ambientales). Como son comunicados al personal los resultados? |  |
| 73 | HSE | 96 | El Contratista ha presentado y presenta la siguiente información del último año:  Cantidad HH trabajadas.  Número de accidentados con y sin días perdidos  Índice de frecuencia de accidentados con días perdidos  Índice de frecuencia de accidentados sin días perdidos  Índice de gravedad  Número de accidentados in itinere.  Número de casos de enfermedades ocupacionales  Número de Accidentes con los subcontratados  Número de Accidentes Ambientales.                                                                          Como aeguran la inclusion en estas estadisticas de los datos de los subcontratistas? | caracter_simbolo_privado |
| 74 | HSE | 97 | El Contratista tiene implementado un proceso para evaluar el cumplimiento de requisitos legales y otros requisitos de SMS. Como se analizan y se tratan los desvíos? |  |
| 75 | HSE | 98 | El Contratista cuenta con un sistema para la realización de auditorias internas de su sistema SMS? Cuenta con un plan de auditorías internas? (mensual, bimensual, trimestral, etc). Fue presentado al Cliente? Se realizan las auditorias en los tiempos planificados? VERIFICAR CUMPLIMIENTO |  |
| 78 | HSE | 99 | Tiene el Contatista un procedimiento para reportar incidentes y casi incidentes? Es compatible con el del Cliente? Tiene definido los niveles comites de investigacion de incidentes según potencialidad o severidad? VER CASOS DE INCIDENTES  Fue Presentado al Cliente? |  |
| 79 | HSE | 100 | Ha capacitado el Contratista a la línea de Gerencia y Supervisión sobre investigación de incidentes para integrar los comités?. |  |
| 80 | HSE | 101 | Tiene  un sistema de seguimiento  para las acciones resultantes de investigación  de incidentes? Como mide la eficacia de las acciones? VER CASOS DE INCIDENTES  |  |
| 82 | HSE | 102 | Tiene el Contratista un proceso para gestionar las no conformidades? VER CASOS  Las quejas o reclamos del Cliente son tratadas bajo el proceso de no conformidades? Fue presentado al Cliente? |  |
| 83 | HSE | 103 | Una vez tratadas las NC, desvios y recomendaciones, se verifica el cumplimiento y eficacia? |  |

**Procesos (catálogo):** Dirección / Gerencia · Licitaciones · HSE · OPER/HSE · OPER/RRHH · OPER/SALUD · Compras/Contrat. · OPER/MANT

## 4. Metodología de puntuación reconstruida

| Opción | Puntos | Origen |
|---|---:|---|
| NC | 0 | 'Table 1'!I15 · puntaje inferido de los valores cargados |
| OBS | 1 | 'Table 1'!J15 · puntaje inferido de los valores cargados |
| OPM | 2 | 'Table 1'!K15 · puntaje inferido de los valores cargados |
| OK | 3 | 'Table 1'!L15 · puntaje inferido de los valores cargados |
| N/A | 0 | 'Table 1'!H14 · suma 0 (SUMIF sin efecto) y cuenta en el objetivo |

- Nota de sección: nota = obtenido / (filas_de_la_sección × 3) × 10
- Resultado final: promedio simple de las notas de sección
- N/A: suma 0 y cuenta en el objetivo (literal del Excel)
- Sin responder: suma 0 y cuenta en el objetivo (literal del Excel)

| Calificación | Desde | Hasta | Origen |
|---|---:|---:|---|
| Muy Bueno | 8.01 | 10 | Formato condicional O105: entre 8.01 y 10 |
| Bueno | 6.01 | 8 | Formato condicional O105: entre 6.01 y 8 |
| Regular | 4.01 | 6 | Formato condicional O105: entre 4.01 y 6 |
| Crítico | — | 4 | Formato condicional O105: ≤ 4 |

## 5. Comparación con los resultados de prueba del Excel

| Concepto | Excel | Calculado | Diferencia | Coincide |
|---|---:|---:|---:|---|
| Liderazgo, Compromiso y Enfoque al Cliente · obtenido | 16 | 16 | 0.0e+0 | Sí |
| Liderazgo, Compromiso y Enfoque al Cliente · objetivo | 24 | 24 | 0.0e+0 | Sí |
| Liderazgo, Compromiso y Enfoque al Cliente · nota | 6.666667 | 6.666667 | 0.0e+0 | Sí |
| Planificación, Organización y Recursos · obtenido | 63 | 63 | 0.0e+0 | Sí |
| Planificación, Organización y Recursos · objetivo | 90 | 90 | 0.0e+0 | Sí |
| Planificación, Organización y Recursos · nota | 7 | 7 | 0.0e+0 | Sí |
| Operación y control operacional · obtenido | 65 | 65 | 0.0e+0 | Sí |
| Operación y control operacional · objetivo | 84 | 84 | 0.0e+0 | Sí |
| Operación y control operacional · nota | 7.738095 | 7.738095 | 0.0e+0 | Sí |
| Gestión de Proveedores · obtenido | 4 | 4 | 0.0e+0 | Sí |
| Gestión de Proveedores · objetivo | 12 | 12 | 0.0e+0 | Sí |
| Gestión de Proveedores · nota | 3.333333 | 3.333333 | 0.0e+0 | Sí |
| Preparación y respuesta ante emergencias · obtenido | 5 | 5 | 0.0e+0 | Sí |
| Preparación y respuesta ante emergencias · objetivo | 9 | 9 | 0.0e+0 | Sí |
| Preparación y respuesta ante emergencias · nota | 5.555556 | 5.555556 | 0.0e+0 | Sí |
| Seguimiento, Medición, Evaluación de desempeño y Mejora Contínua · obtenido | 22 | 22 | 0.0e+0 | Sí |
| Seguimiento, Medición, Evaluación de desempeño y Mejora Contínua · objetivo | 30 | 30 | 0.0e+0 | Sí |
| Seguimiento, Medición, Evaluación de desempeño y Mejora Contínua · nota | 7.333333 | 7.333333 | 0.0e+0 | Sí |
| Resultado final | 6.271164 | 6.271164 | 0.0e+0 | Sí |
| Calificación (Bueno) | — | — | — | Sí |

> Referencia: Nota global ponderada (alcanzado total / objetivo total) = 7.0281 ('Hoja1'!I15/J15). No es el criterio del libro; se informa para la validación.

## 6. Elementos que requieren revisión

| # | Severidad | Tipo | Origen | Detalle |
|---:|---|---|---|---|
| 1 | advertencia | sin_numeracion | 'Table 1'!D81 | El requisito de la fila 81 ("Sistema de suministro de Gas oil") no tiene número. Está dentro del rango de la fórmula, por lo que cuenta en el denominador de "Operación y control operacional". Confirmar si es parte de la plantilla o fue agregado durante la ejecución. |
| 2 | advertencia | sin_numeracion | 'Table 1'!D82 | El requisito de la fila 82 ("Mochilas lavaojos") no tiene número. Está dentro del rango de la fórmula, por lo que cuenta en el denominador de "Operación y control operacional". Confirmar si es parte de la plantilla o fue agregado durante la ejecución. |
| 3 | advertencia | numeracion_duplicada | 'Table 1'!D52, 'Table 1'!D53 | El número 36 se repite en las filas 52 y 53 ("Planificación, Organización y Recursos"). Se conserva la numeración original. |
| 4 | advertencia | numeracion_duplicada | 'Table 1'!D80, 'Table 1'!D85 | El número 63 se repite en las filas 80 y 85 ("Operación y control operacional" / "Gestión de Proveedores"). Se conserva la numeración original. |
| 5 | advertencia | numeracion_duplicada | 'Table 1'!D83, 'Table 1'!D86 | El número 64 se repite en las filas 83 y 86 ("Operación y control operacional" / "Gestión de Proveedores"). Se conserva la numeración original. |
| 6 | advertencia | numeracion_salto | 'Table 1'!D78 | Falta el número 61 en la secuencia (después de la fila 78). Verificar si hay un requisito omitido en el original. |
| 7 | advertencia | numeracion_salto | 'Table 1'!D86 | Falta el número 65 en la secuencia (después de la fila 86). Verificar si hay un requisito omitido en el original. |
| 8 | advertencia | numeracion_salto | 'Table 1'!D98 | Falta el número 76 en la secuencia (después de la fila 98). Verificar si hay un requisito omitido en el original. |
| 9 | advertencia | numeracion_salto | 'Table 1'!D98 | Falta el número 77 en la secuencia (después de la fila 98). Verificar si hay un requisito omitido en el original. |
| 10 | advertencia | numeracion_salto | 'Table 1'!D101 | Falta el número 81 en la secuencia (después de la fila 101). Verificar si hay un requisito omitido en el original. |
| 11 | advertencia | proceso_faltante | 'Table 1'!G53 | El requisito 36 no tiene proceso asignado. |
| 12 | advertencia | proceso_faltante | 'Table 1'!G68 | El requisito 50 no tiene proceso asignado. |
| 13 | advertencia | proceso_faltante | 'Table 1'!G82 | El requisito (fila 82) no tiene proceso asignado. |
| 14 | advertencia | regla_inferida | 'Table 1'!I/J/K/L15 | El puntaje de cada situación no está en ninguna fórmula: el auditor escribe el número en la columna elegida y las fórmulas sólo suman. Se infirió de los valores cargados: NC = 0, OBS = 1, OPM = 2, OK = 3. Es coherente con el máximo ×3 de las fórmulas, pero requiere confirmación. |
| 15 | advertencia | formula_sin_efecto | 'Table 1'!H24 | La columna "N/A marcar X" se totaliza con =SUMIF(H16:H23,"X"): SUMIF sin rango de suma suma los propios textos "X", por lo que siempre da 0, y ninguna fórmula de resultado usa ese total. Además, el denominador cuenta TODAS las filas (COUNTA+COUNTBLANK). Consecuencia literal: un requisito marcado N/A suma 0 puntos y sigue contando en el objetivo (igual que una NC). Se importa ese comportamiento sin cambios ("na_mode = contar_cero"); validar si el criterio real es excluir los N/A del denominador. |
| 16 | advertencia | regla_inferida | — | Un requisito sin situación marcada suma 0 y cuenta en el objetivo (el conteo incluye celdas vacías con COUNTBLANK). Se reproduce tal cual ("unanswered_mode = contar_cero"). Confirmar el criterio. |
| 17 | advertencia | formula_ambigua | 'Hoja1'!I15:J15 | "Hoja1" muestra el total alcanzado (175) y el objetivo total (249), que darían una nota ponderada de 7.03, pero la "Evaluación" final de esa misma hoja toma el promedio simple de Table 1 (6.27). Se importa el promedio simple, que es el resultado oficial del libro; confirmar que es el criterio deseado. |
| 18 | advertencia | limite_evaluacion | 'Table 1'!O105 | Entre 4 y 4.01 no hay banda: una nota como 4.005 (sin redondear) no recibe calificación en el Excel. Se conservan los límites sin alterarlos; la aplicación la mostrará como "sin clasificar". Definir si corresponde redondear a 2 decimales antes de clasificar. |
| 19 | advertencia | limite_evaluacion | 'Table 1'!O105 | Entre 6 y 6.01 no hay banda: una nota como 6.005 (sin redondear) no recibe calificación en el Excel. Se conservan los límites sin alterarlos; la aplicación la mostrará como "sin clasificar". Definir si corresponde redondear a 2 decimales antes de clasificar. |
| 20 | advertencia | limite_evaluacion | 'Table 1'!O105 | Entre 8 y 8.01 no hay banda: una nota como 8.005 (sin redondear) no recibe calificación en el Excel. Se conservan los límites sin alterarlos; la aplicación la mostrará como "sin clasificar". Definir si corresponde redondear a 2 decimales antes de clasificar. |
| 21 | info | dato_personal_excluido | 'Table 1'!A1:O13 | Se excluyeron 14 celdas del encabezado (rótulos y valores) con datos de una auditoría ejecutada: compania solicitante, solicitado por, cargo / funcion, contratista, referente, fecha de realizacion, auditor, normas certificadas. Incluyen nombres de personas y empresas; no forman parte de la plantilla y no se muestran en este reporte. |
| 22 | info | texto_formato | 'Table 1'!B16 | El título de la categoría tiene espacios al inicio o final; se conserva tal cual: "Liderazgo, Compromiso y Enfoque al Cliente ". |
| 23 | info | texto_formato | 'Table 1'!E96 | El texto contiene viñetas de la fuente Symbol (U+F0B7). Se conserva el texto original; la aplicación las muestra como "•". |
| 24 | info | proceso_no_utilizado | 'Hoja2' | El proceso "OPER/MANT" figura en el catálogo pero ningún requisito lo usa. Se importa al catálogo. |
| 25 | info | regla_inferida | 'Table 1'!O105 | El resultado final es el promedio simple de las notas de sección: cada sección pesa lo mismo sin importar su cantidad de requisitos (p.ej. 3 ítems pesan igual que 30). Se reproduce sin cambios. |
| 26 | info | limite_evaluacion | 'Table 1'!E110 | La leyenda dice "0 - 4" y el formato condicional aplica "≤ 4". Equivalentes para notas 0–10. |
| 27 | info | dato_ejecucion_excluido | — | Se excluyeron de la plantilla 80 comentarios de evidencia, 30 descripciones de hallazgos y 83 situaciones registradas de una auditoría ejecutada. Las situaciones se guardan sólo como códigos (NC/OBS/OPM/OK/N/A) en un caso de validación separado; ninguna se usa como valor por defecto en auditorías nuevas. |
| 28 | info | otro | — | En la ejecución de ejemplo, 4 requisitos con NC/OBS/OPM no tienen descripción de hallazgo (filas 38, 72, 91, 103). No afecta la plantilla; en la aplicación esas situaciones proponen registrar un hallazgo. |

## 7. Datos excluidos de la plantilla operativa

| Dato | Celdas | Cantidad |
|---|---|---:|
| Encabezado de la auditoría (empresa, contratista, fecha, ubicación, personas y cargos) | B8, E8, F8, H8, B9, E9, F9, H9, B10, E10, F10, B11 … | 14 |
| Evidencias / comentarios por requisito | F16, F17, F18, F19, F20, F21, F22, F23, F25, F26, F27, F28 … | 80 |
| Descripción de hallazgos | M18, M20, M21, M23, M28, M29, M30, M32, M33, M42, M45, M47 … | 30 |
| Situación registrada (resultado histórico) — sólo como caso de validación | I16:L16, I17:L17, I18:L18, I19:L19, I20:L20, I21:L21, I22:L22, I23:L23, I25:L25, I26:L26, I27:L27, I28:L28 … | 83 |

No se copian nombres de personas, empresas, comentarios, hallazgos ni evidencias. Las situaciones del ejemplo sólo se guardan como códigos en un caso de validación aislado.

## 8. Publicación

La versión queda en **borrador con validación pendiente**. Para publicarla: (1) revisar y resolver cada incidencia de advertencia/bloqueante con una nota, (2) ejecutar los casos de validación (deben coincidir), (3) validar con fundamento, (4) publicar. El servidor impide publicar si alguno de estos pasos falta.
