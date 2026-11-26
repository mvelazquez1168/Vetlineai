# Vetline Clinic 07 — Expediente clínico del paciente

## Contexto

El expediente es el corazón de Vetline Clinic: el paciente es el eje (guía rectora, sección 3) y de
la atención derivan servicios, vacunas, recetas, cargos y movimientos de inventario. Este prompt
construye el expediente completo: la historia del paciente en todas sus dimensiones y el registro
de la atención que genera cargos.

**Reemplaza** a la versión anterior de `vetline-clinic-07-atencion-expediente.md`, que queda
descartada.

Se apoya en lo ya construido y en decisiones tomadas:

- La **ficha del paciente** del prompt 01 (datos, número de expediente propio, cronología, edición).
- Las tablas existentes: `atenciones` (una por cita), `cuidados_preventivos`, `recetas` y
  `receta_items`, `casos`, `citas`, `archivos`, y el modal `RegistroAtencionModal`.
- El **modelo longitudinal ya acordado para Vetline Ai**: el paciente es el eje, la cita es la
  visita con su registro de atención, el caso es el episodio diagnóstico que puede abarcar varias
  visitas, y los cuidados preventivos son del paciente. La cita registra, el caso razona. Al abrir
  un caso, el médico marca qué visitas previas pertenecen al episodio, con las recientes premarcadas.
- El **documento de predisposiciones raciales** de la base de conocimiento de Vetline Ai, y las
  tablas `razas` y `razas_alias_documento`, que ya vinculan razas con secciones del documento.
- El **catálogo de servicios y productos** y el **punto único de movimientos** del inventario
  (prompt 06), y la **entrada única de cargos** de la caja (prompt 08).

**Antes de diseñar, relevá qué hace hoy el registro de atención** (`RegistroAtencionModal`, las
rutas de `/api/atenciones`, la vinculación de atenciones con casos, la cronología del caso) y cómo
está estructurado el documento de predisposiciones y su vínculo con las razas. El expediente
**extiende** lo existente; no se pierde ninguna funcionalidad.

Construí en rama nueva desde la última rama de trabajo terminada, sin pedir confirmación. Parás
solo ante una contradicción con el código, una decisión irreversible sobre datos existentes o un
trabajo mucho mayor al supuesto. No se toca producción ni salen correos reales.

### Dos bloques, por dependencias

- **Bloque A — El expediente** (secciones 1 a 8): no depende de la caja. Se construye primero.
- **Bloque B — La atención que genera cargos** (sección 9): necesita la entrada única de cargos del
  prompt 08. Si el 08 no está terminado al llegar acá, se construye el bloque A completo, se
  reporta, y el bloque B queda para cuando el 08 exista.

---

## 1. Principios del expediente

- **Una sola fuente por dato.** El expediente muestra lo que ya existe (citas, atenciones,
  preventivos, recetas, casos, archivos, comprobantes); no copia datos en tablas paralelas.
- **Datos del paciente y del cliente: una sola lógica, distintos niveles de completitud.** Vetline
  Ai y Vetline Clinic usan los mismos endpoints y las mismas reglas (nombre, especie y raza
  coherentes, duplicados, número de expediente). Vetline Ai pide lo mínimo para un caso; Vetline
  Clinic ofrece el formulario completo. Los datos se exigen cuando una acción los necesita, no al
  crear el registro, y el alta de cliente y mascota es un único componente usado desde ambos lados.
  El registro de clientes y pacientes es núcleo: no depende de ningún módulo.
- **Integridad del registro médico.** Una atención cerrada queda firmada por el médico que la
  registró. A partir de ahí no se edita: se le agregan **adendas** con autor, fecha y motivo, y la
  versión original se conserva. Es lo que se espera de un registro médico confiable y lo que
  permite defenderlo ante un reclamo.
- **Lo clínico es del médico.** Solo un médico escribe contenido clínico. El groomer registra solo
  grooming. La recepción ve el resumen, los preventivos y las alertas, pero no edita lo clínico.

## 2. Encabezado y resumen clínico

Siempre visible en el expediente, para entender al paciente de un vistazo:

- Identificación: nombre, foto opcional, especie, raza, sexo y estado reproductivo, edad (marcando
  si es estimada), peso actual, número de expediente, microchip, cliente y co-responsables.
- **Franja de alertas:** alergias y reacciones adversas, alerta de manejo, enfermedades crónicas,
  preventivos vencidos, y saldo pendiente del cliente (solo para quien tiene permiso de verlo).
- **Indicador de completitud** del expediente, con lo que falta ("faltan alergias y estado
  reproductivo") y un acceso para completarlo.
- **Lista de problemas** (al estilo de la lista maestra de problemas de los sistemas líderes):
  problemas activos, crónicos y resueltos, con fecha de inicio, estado, y vínculo a las atenciones
  y casos donde se trataron.
- **Medicación activa:** lo recetado cuya duración no terminó y los tratamientos crónicos, con dosis
  y fecha de fin.
- **Resumen de la historia generado por IA**, a pedido: un párrafo con condiciones crónicas,
  medicación activa, hallazgos relevantes y lo último que pasó, citando de qué registro sale cada
  dato. Pasa por la compuerta de crédito de IA existente y es apoyo, no diagnóstico. Si la clínica
  no tiene crédito o no tiene el módulo de IA, el botón no aparece.

## 3. Historia del paciente — una línea de tiempo y pestañas por tipo

- **Línea de tiempo unificada** con todo lo que le pasó al paciente, de lo más reciente a lo más
  antiguo, con filtros por tipo, período y médico, y **búsqueda por palabra** dentro de toda la
  historia (por ejemplo, "vómito" o "carprofeno").
- **Pestañas por tipo**, cada una con su vista propia:
  - **Visitas:** cada atención con fecha, médico, motivo, resumen SOAP y lo realizado.
  - **Vacunas:** producto, lote, fecha, próxima dosis y quién la aplicó; estado por enfermedad (al
    día, por vencer, vencida, sin registro), distinguiendo "sin registro" de "no vacunado".
  - **Desparasitaciones:** interna y externa, producto, fecha, próxima.
  - **Laboratorio** (sección 4).
  - **Imágenes y documentos** (sección 5).
  - **Prescripciones:** todas las recetas con sus ítems, dosis, duración, si se dispensó en la
    clínica o se compró afuera, y el historial farmacológico que ya existe (con repetidos
    señalados).
  - **Grooming** (sección 6).
  - **Casos de Vetline Ai** (sección 7).
  - **Consentimientos** (sección 8).
- **Gráficos de evolución:** curva de peso y condición corporal en el tiempo, y signos vitales
  (temperatura, frecuencias) comparados entre visitas, con el sistema de diseño ampliado.

## 4. Laboratorio

- **Resultados estructurados:** estudio (hemograma, química, urianálisis, coproparasitológico,
  otros), fecha, laboratorio interno o externo, y por cada analito su valor, unidad y **rango de
  referencia por especie**, con bandera de alto o bajo.
- **Carga de resultados externos:** adjuntar el PDF del laboratorio y, opcionalmente, capturar los
  valores clave para que entren en las tendencias.
- **Tendencias por analito:** un gráfico de la evolución de un valor (por ejemplo, creatinina o ALT)
  a lo largo de las visitas, con el rango de referencia marcado.
- **Órdenes de laboratorio** desde la atención, con estado (solicitado, muestra enviada, resultado
  recibido) y aviso al médico cuando llega el resultado.
- La integración automática con equipos de laboratorio queda fuera de este prompt.

## 5. Imágenes y documentos

- Adjuntar radiografías, ecografías, fotos clínicas, informes y documentos externos (por ejemplo,
  la historia de otra clínica), con tipo, fecha, descripción y la atención o caso al que
  pertenecen. Los documentos externos se distinguen de lo generado en la clínica.
- Reusar el almacenamiento de archivos que ya existe, con sus reglas de acceso.
- Un visor DICOM queda fuera de este prompt.

## 6. Grooming

- Registro de cada servicio de grooming: fecha, groomer, servicios (baño, corte, uñas, oídos,
  glándulas), productos usados, tipo de corte, comportamiento del paciente, fotos de antes y
  después, y observaciones.
- **Hallazgos para el médico:** si el groomer encuentra algo (un bulto, una herida, parásitos,
  otitis), lo marca como hallazgo, queda en la franja de alertas y genera un aviso al médico. Es un
  canal que los sistemas sin grooming integrado pierden.
- El grooming genera sus cargos y descarga sus insumos igual que cualquier servicio (en el bloque
  B).

## 7. Casos de Vetline Ai

- Cuando la clínica tiene agentes de Vetline Ai habilitados, la pestaña muestra los casos del
  paciente: número de caso, agente, motivo, estado, severidad, diagnóstico final y desenlace si
  está cerrado, y un enlace que abre el caso.
- **Abrir un caso desde el expediente o desde una atención**, respetando lo acordado: el médico
  marca qué visitas previas pertenecen al episodio (las recientes premarcadas), y los cuidados
  preventivos del paciente llegan al caso leídos en vivo, no copiados.
- Si la clínica no tiene Vetline Ai habilitado, la pestaña no aparece. Si lo tuvo y ya no, los casos
  existentes se ven en modo lectura.

## 8. Predisposiciones raciales, consentimientos y certificados

- **Ficha técnica de predisposiciones raciales:** según la raza del paciente, una tarjeta con las
  predisposiciones documentadas en la base de conocimiento de Vetline Ai, organizadas por sistema
  (por ejemplo, ortopédicas, cardíacas, dermatológicas, oculares), tomadas del documento existente
  a través de `razas_alias_documento`, nunca reescritas a mano. Si la raza no tiene cobertura en el
  documento, la tarjeta lo dice con claridad; si una sección agrupa varias razas, se indica. En
  mestizos o raza desconocida no se muestra nada inventado.
- Desde la ficha racial, un acceso a los **chequeos preventivos sugeridos** para esas
  predisposiciones, como recomendación al médico, nunca automática.
- **Consentimientos digitales:** plantillas por la clínica (anestesia, cirugía, hospitalización,
  eutanasia, otras), completadas con los datos del paciente y del cliente, firmadas en pantalla por
  el cliente (en una tablet o el celular), guardadas como PDF en el expediente y ligadas a la
  atención.
- **Certificado o carné de vacunación** en PDF, listo para imprimir o enviar.
- **Historia clínica exportable** en PDF, con filtros (todo, o un período, o solo vacunas), para
  enviar a otra clínica o a un especialista en una derivación.

## 9. La atención que genera cargos (bloque B)

El registro de la visita, siguiendo el diseño validado con Medicavet (pantalla "Atención en el
expediente" del flujo):

- **Formato SOAP** con plantillas por tipo de consulta (consulta general, vacunación, control,
  urgencia, cirugía, dermatología…), configurables por la clínica, y guardado automático.
  - *Subjetivo:* motivo de consulta y anamnesis.
  - *Objetivo:* signos (peso, temperatura, frecuencias, condición corporal) y examen físico por
    sistemas, con marcado rápido de normal o anormal y nota en lo anormal.
  - *Evaluación:* diagnósticos presuntivos y definitivos, que pueden agregarse a la lista de
    problemas.
  - *Plan:* tratamiento, indicaciones al cliente y controles recomendados con fecha.
- **Lo realizado, elegido del catálogo**, nunca en texto libre: servicios (con línea de negocio,
  especialidad y médico), vacunas y desparasitaciones con su lote (sugerido por primer
  vencimiento), productos aplicados, órdenes de laboratorio e imagen, y la receta con productos del
  inventario (dispensado en la clínica o para comprar afuera).
- **Alertas al recetar:** si el paciente tiene una alergia o reacción adversa registrada al fármaco
  o a su grupo, se avisa antes de confirmar. Las validaciones de dosis por especie y peso que ya
  existen se mantienen.
- **Cuenta en vivo** al costado, calculada por el mismo motor que usa la caja.
- **Cierre de la atención**, en una sola operación coherente: los cargos pasan a la cuenta del
  cliente por la entrada única de cargos (sin duplicarse), el inventario se descarga por el punto
  único de movimientos con origen "atención" y vínculo al paciente (incluida la receta de insumos de
  cada servicio), se programan los recordatorios de preventivos y controles, la cita pasa a
  completada, la atención queda firmada y la caja recibe el aviso de que hay una cuenta para cobrar.
  Si algo falla (por ejemplo, falta stock), no queda nada a medias.
- **Atención sin cita previa:** el sistema crea la cita en el momento, sin pasos extra para el
  médico.
- Atajos de teclado para agregar servicio, producto y receta, en el registro único de atajos.

## 10. Interfaz

La ficha del paciente es la pantalla central de la clínica. Con el sistema de diseño ampliado y los
patrones de Vetline Ai: encabezado y franja de alertas fijos arriba; pestañas (Resumen, Atención
actual, Línea de tiempo, Visitas, Vacunas, Desparasitaciones, Laboratorio, Imágenes y documentos,
Prescripciones, Grooming, Casos, Consentimientos); acciones rápidas siempre a mano (nueva cita,
registrar atención, registrar grooming, vender, abrir caso). Responsive y usable en tablet, porque
el médico la usa en el consultorio. Exportación a PDF de cada vista.

---

## Verificación

- Un paciente con historia completa de demostración (visitas, vacunas, desparasitaciones,
  laboratorio con tendencias, imágenes, recetas, grooming con un hallazgo, un caso de Vetline Ai y
  un consentimiento firmado) se ve correctamente en cada pestaña y en la línea de tiempo.
- La búsqueda dentro de la historia encuentra un término en notas, recetas y resultados.
- La ficha racial de un golden retriever muestra sus predisposiciones desde el documento; una raza
  sin cobertura lo dice; un mestizo no muestra nada inventado.
- La tendencia de un analito muestra los valores con su rango de referencia por especie.
- Un hallazgo de grooming aparece en las alertas y avisa al médico.
- Una atención cerrada no se puede editar; una adenda queda registrada con autor y motivo, y la
  versión original se conserva.
- Recetar un fármaco al que el paciente es alérgico muestra el aviso.
- Sin Vetline Ai habilitado, la pestaña de casos no aparece; con casos previos y el módulo apagado,
  se ven en modo lectura.
- Bloque B: el flujo de Toby de punta a punta (consulta, examen, vacuna con lote, desparasitación y
  receta dispensada) deja la cuenta en caja con sus cargos, el inventario descargado por lote con
  origen atención y paciente, tres recordatorios programados y la cita completada; si falta stock,
  no queda nada a medias; un cargo no llega dos veces.
- Todo lo que hacía el registro de atención antes sigue funcionando.
- La auditoría de RLS pasa limpia y los verificadores existentes siguen en verde.

## Reporte

En `docs/reportes/`: el relevamiento previo (registro de atención actual y documento de
predisposiciones), lo construido por bloque, lo verificado, lo que no se pudo y por qué, y las
decisiones que tomaste solo. Al terminar, sembrá un paciente de demostración con historia completa y
pasá las URL.
