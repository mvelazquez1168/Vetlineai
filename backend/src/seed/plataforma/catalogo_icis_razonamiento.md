ICIS-ARCH-001

Clinical Components Catalog v2.0 (adaptado de ICIS)

NOTA DE ALCANCE DE ESTA ADAPTACION (ICIS-ARCH-001)

Este catalogo es una adaptacion de la version v2.0 de GCIS, generalizada para ICIS. Se excluyeron deliberadamente CC-206 (Gastrointestinal Biomarkers Intelligence), CC-230 (Endoscopy Intelligence) y CC-231 (Histopathology Intelligence) por ser componentes de procedimientos especializados de gastroenterologia, fuera del alcance de un sistema de atencion primaria/triage.

Componentes mencionados como integraciones en este documento pero AUN NO DEFINIDOS en ninguna version verificada: CC-101 (Clinical History), CC-103 (Signalment Analysis), CC-250 (Clinical Evidence Graph), CC-301 a CC-304 (Farmacoterapia -- ver "Pharmacotherapy Components Addendum" en el indice del Operational Manual), y CC-401 (Differential Diagnosis Engine, posiblemente superseded por CC-240 Diagnostic Correlation Engine). Cualquier motor que dependa de estos componentes debe declarar explicitamente esa dependencia como pendiente, nunca asumir su comportamiento.

La capa de Derivacion (CC-260 a CC-263) que cierra este documento SI esta completa y verificada.


CC-001 – Executive Case Summary

2. Propósito Clínico

El Executive Case Summary constituye la representación clínica condensada del estado actual del paciente.

Su objetivo es permitir que un médico veterinario comprenda un caso complejo en menos de un minuto, identificando rápidamente:

-   Problema principal.

-   Estado clínico.

-   Hallazgos relevantes.

-   Evolución.

-   Hipótesis diagnósticas.

-   Riesgos actuales.

-   Próximos pasos.

Este componente será utilizado como punto de entrada para cualquier interacción con el expediente clínico.

3. Objetivos

El componente deberá:

-   Resumir automáticamente todo el expediente clínico.

-   Actualizarse con cada nueva consulta.

-   Reflejar únicamente el estado actual del caso.

-   Mantener consistencia con el resto del expediente.

-   Reducir el tiempo necesario para comprender un caso.

-   Servir como portada del Dashboard.

-   Servir como resumen ejecutivo del Reporte Clínico.

-   Servir como resumen indexado para la Base de Conocimiento.

4. Alcance

Incluye

✓ Información clínica relevante.

✓ Hallazgos positivos.

✓ Hallazgos negativos relevantes.

✓ Evolución.

✓ Estado clínico.

✓ Nivel de confianza diagnóstica.

✓ Diagnósticos diferenciales activos.

✓ Riesgos.

✓ Tratamiento activo.

✓ Próximos pasos.

No incluye

Historial completo.

Resultados completos de laboratorio.

Interpretación detallada.

Notas médicas completas.

Medicación histórica.

Anexos.

5. Flujo Clínico

Nuevo Caso

↓

Historia Clínica

↓

Laboratorio

↓

Imagenología

↓

Tratamientos

↓

Seguimiento

↓

Clinical Intelligence Engine

↓

Executive Case Summary

↓

Dashboard

↓

Clinical Report

↓

Knowledge Base

8. Clinical Intelligence

Claude deberá:

Analizar

Todo el expediente.

Detectar

Problema predominante.

Priorizar

Información clínicamente relevante.

Eliminar

Información redundante.

Resumir

Utilizando lenguaje clínico profesional.

Correlacionar

Historia

-   

Laboratorio

-   

Imagen

-   

Seguimiento

Identificar

Cambios importantes desde la consulta anterior.

Destacar

Información nueva.

Explicar

Por qué el caso cambió.

9. Clinical Rules

CR-001

Nunca ocultar un hallazgo crítico.

CR-002

Nunca resumir eliminando información diagnósticamente relevante.

CR-003

Priorizar información reciente.

CR-004

Si existen datos contradictorios deberá indicarlo.

CR-005

No asumir diagnósticos.

CR-006

Expresar incertidumbre.

CR-007

Actualizar automáticamente el resumen después de cada seguimiento.

10. Validation Rules

Debe existir:

✔ Paciente.

✔ Motivo de consulta.

✔ Historia clínica.

Si faltan:

Mostrar advertencia.

14. AI Behaviour

Claude deberá responder automáticamente:

¿Qué tiene el paciente?

¿Por qué consulta?

¿Cuál es el problema principal?

¿Qué evidencia existe?

¿Qué información falta?

¿Qué ha cambiado?

¿Cuál es el estado actual?

¿Qué debe hacerse ahora?

Nunca deberá:

Inventar.

Asumir.

Omitir incertidumbre.

CC-002 Patient Profile

CC-003 Case Metadata

CC-004 Clinical Timeline

CC-005 Active Problems Registry

CC-101 Clinical History

CC-201 Laboratory Results

CC-301 Medication Manager

CC-240 Diagnosis correlation Panel

CC-401 Differential Diagnosis Engine

Es consumido por:

Dashboard.

Report Composer.

Knowledge Base.

Clinical Search.

Second Opinion.

Teaching Mode.

17. Prompt Contract ⭐⭐⭐⭐⭐

Este apartado define el comportamiento obligatorio del agente de IA cuando interactúa con el componente.

Al crear un nuevo caso

Si la información es insuficiente para construir un Executive Case Summary confiable, Claude deberá solicitar de forma estructurada los datos faltantes antes de generar el resumen.

Durante el seguimiento

Actualizará el resumen utilizando toda la información acumulada en el expediente, resaltando únicamente los cambios clínicamente relevantes desde la consulta anterior.

Durante el análisis diagnóstico

El Executive Case Summary será el contexto principal para el razonamiento clínico. Claude deberá utilizarlo como punto de partida para correlacionar hallazgos, priorizar diagnósticos diferenciales y evaluar la evolución del caso.

CC-002 — Patient Profile

2. Propósito Clínico

El Patient Profile representa la identidad clínica permanente del paciente y constituye la entidad maestra del expediente.

Toda la información clínica generada por el ICIS estará asociada a este componente.

Su propósito es mantener una representación única, consistente y longitudinal del paciente durante toda su vida clínica.

A diferencia del Case Metadata, que pertenece a un episodio clínico específico, el Patient Profile describe atributos relativamente estables del paciente.

3. Objetivos

El componente deberá:

-   Mantener una identidad única del paciente.

-   Centralizar los datos demográficos.

-   Evitar duplicidad de pacientes.

-   Facilitar el análisis longitudinal.

-   Servir como contexto para todos los motores de IA.

-   Alimentar automáticamente el Dashboard y los Reportes.

-   Permitir la comparación entre casos del mismo paciente.

4. Alcance

Incluye

-   Identificación.

-   Especie.

-   Raza.

-   Sexo.

-   Estado reproductivo.

-   Fecha de nacimiento (o edad).

-   Peso actual.

-   Body Condition Score.

-   Microchip (opcional).

-   Tutor.

-   Información de contacto.

-   Fotografía (opcional).

No incluye

Motivo de consulta.

Diagnóstico.

Tratamientos.

Resultados de laboratorio.

Notas clínicas.

Estos pertenecen a otros componentes.

5. Clinical Workflow

Registro del Paciente

│

▼

Validación de Identidad

│

▼

Creación del Patient Profile

│

▼

Asociación con Casos Clínicos

│

▼

Actualización Longitudinal

│

▼

Dashboard

│

▼

Knowledge Base

8. Clinical Intelligence

Claude deberá analizar:

-   Predisposiciones raciales.

-   Riesgos por edad.

-   Riesgos por sexo.

-   Riesgos asociados al estado reproductivo.

-   Cambios longitudinales del peso.

-   Cambios del BCS.

Ejemplo:

Un Yorkshire Terrier geriátrico con pérdida progresiva de peso tiene un contexto clínico diferente a un Labrador joven con el mismo signo clínico.

9. Clinical Rules

CR-001

Todo caso debe estar asociado a un único Patient Profile.

CR-002

Un paciente puede tener múltiples casos clínicos.

CR-003

No modificar datos históricos.

CR-004

El peso deberá registrarse como una serie temporal.

CR-005

El BCS deberá registrarse como una serie temporal.

CR-006

La edad nunca se almacenará como texto fijo; se calculará dinámicamente cuando exista fecha de nacimiento.

10. Validation Rules

Obligatorios:

-   Nombre

-   Especie

-   Sexo

-   Edad o fecha de nacimiento

Recomendados:

-   Raza

-   Peso

-   BCS

-   Estado reproductivo

Si falta información crítica, Claude deberá solicitarla antes de continuar con el análisis.

14. AI Behaviour

Claude deberá utilizar este componente como contexto permanente.

Siempre deberá:

-   Ajustar la interpretación clínica según especie.

-   Considerar predisposiciones raciales.

-   Adaptar el razonamiento según la edad.

-   Considerar diferencias fisiológicas entre sexos.

-   Detectar inconsistencias (por ejemplo, un BCS de 2/9 con un peso creciente).

Nunca deberá:

-   Asumir la raza si no fue indicada.

-   Inferir la edad exacta sin datos.

-   Modificar retrospectivamente datos demográficos históricos.

17. Prompt Contract

Al registrar un nuevo paciente

Claude deberá solicitar únicamente los datos faltantes para completar el perfil.

No deberá repetir preguntas cuya respuesta ya exista en el expediente.

Durante el seguimiento

Actualizará únicamente los atributos variables (peso, BCS, datos del tutor si cambian), preservando el historial cuando corresponda.

Durante el análisis clínico

Utilizará el perfil del paciente para contextualizar todos los hallazgos, ajustando el razonamiento según especie, raza, edad y estado reproductivo.

CC-003 — Case Metadata

2. Propósito Clínico

El Case Metadata representa el episodio clínico que está siendo atendido.

Mientras que el Patient Profile identifica al paciente, este componente identifica el caso específico.

Un mismo paciente puede presentar múltiples episodios clínicos a lo largo de su vida, y cada uno deberá mantenerse independiente para preservar la trazabilidad clínica.

3. Objetivos

El componente deberá:

-   Identificar unívocamente cada caso clínico.

-   Asociar el caso a un único paciente.

-   Registrar el contexto administrativo y clínico del episodio.

-   Permitir el seguimiento longitudinal del caso.

-   Facilitar auditoría y trazabilidad.

-   Servir como entidad principal del expediente clínico.

4. Alcance

Incluye

-   Identificador del caso.

-   Fecha de apertura.

-   Estado del caso.

-   Veterinario responsable.

-   Especialidad.

-   Hospital o clínica.

-   Motivo principal de consulta.

-   Prioridad.

-   Estado clínico.

-   Fecha de cierre.

-   Diagnóstico final.

No incluye

Laboratorios.

Medicamentos.

Notas médicas.

Imagenología.

Problemas activos.

Estos pertenecen a componentes especializados.

5. Clinical Workflow

Paciente

↓

Nuevo Caso

↓

Case Metadata

↓

Historia Clínica

↓

Diagnóstico

↓

Tratamiento

↓

Seguimientos

↓

Cierre del Caso

↓

Knowledge Base

8. Clinical Intelligence

Claude analizará:

-   Complejidad del caso.

-   Velocidad de evolución.

-   Tiempo diagnóstico.

-   Duración del tratamiento.

-   Riesgo de pérdida de seguimiento.

-   Tiempo desde el último control.

-   Estado operativo del caso.

Además detectará casos que requieren atención por falta de seguimiento.

9. Clinical Rules

CR-001

Todo caso pertenece a un único paciente.

CR-002

Un paciente puede tener múltiples casos.

CR-003

Un caso solo puede tener un estado activo.

CR-004

Un caso cerrado no puede modificarse sin registrar una nueva versión.

CR-005

Todo seguimiento pertenece al mismo Case ID.

CR-006

La fecha de cierre nunca puede ser anterior a la fecha de apertura.

CR-007

El diagnóstico final solo podrá registrarse al cerrar el caso.

10. Validation Rules

Obligatorios:

-   Case ID

-   Patient ID

-   Fecha de apertura

-   Veterinario responsable

-   Motivo de consulta

Advertencias:

-   Caso sin seguimiento > 90 días.

-   Caso abierto sin diagnóstico > 180 días.

-   Caso sin estado.

14. AI Behaviour

Claude utilizará este componente para comprender el contexto temporal del caso.

Deberá:

-   Diferenciar entre primera consulta y seguimiento.

-   Detectar retrasos diagnósticos.

-   Identificar pérdidas de seguimiento.

-   Adaptar el análisis según el estado del caso.

Nunca deberá:

-   Reabrir un caso cerrado sin indicación del usuario.

-   Mezclar información de casos distintos del mismo paciente.

-   Asumir que un seguimiento pertenece a otro episodio clínico.

17. Prompt Contract

Al iniciar un nuevo caso

Claude deberá crear un nuevo contexto clínico asociado al paciente, asignando el estado inicial "Nuevo" y solicitando toda la información necesaria para completar el expediente.

Durante el seguimiento

Mantendrá el mismo Case ID, actualizará el estado cuando corresponda y preservará la trazabilidad cronológica de todas las consultas.

Durante el análisis clínico

Utilizará el estado del caso para contextualizar sus recomendaciones. Por ejemplo, un caso en "En estudio" requerirá un enfoque diferente a uno en "Seguimiento" o "Remisión".

CC-004 — Clinical Timeline

2. Propósito Clínico

El Clinical Timeline constituye el eje cronológico del expediente clínico.

Su objetivo es representar, en una única secuencia temporal, todos los eventos relevantes del caso para facilitar la comprensión de la evolución del paciente.

Más que un listado de consultas, el Timeline debe convertirse en la "historia clínica visual" del caso.

3. Objetivos

El componente deberá:

-   Organizar cronológicamente toda la información clínica.

-   Mostrar la evolución del paciente.

-   Relacionar consultas, exámenes, tratamientos e imágenes.

-   Identificar eventos críticos.

-   Facilitar el análisis retrospectivo.

-   Servir como base para los motores de IA.

4. Alcance

Incluye

-   Apertura del caso.

-   Consultas.

-   Notas médicas.

-   Cambios clínicos.

-   Diagnósticos.

-   Laboratorios.

-   Imagenología.

-   Procedimientos.

-   Cambios terapéuticos.

-   Hospitalizaciones.

-   Complicaciones.

-   Alta médica.

-   Cierre del caso.

No incluye

Interpretación clínica detallada.

Esa pertenece a los componentes especializados.

5. Clinical Workflow

Apertura del Caso

│

▼

Consulta Inicial

│

▼

Laboratorios

│

▼

Imagenología

│

▼

Tratamientos

│

▼

Seguimientos

│

▼

Cambios Clínicos

│

▼

Resolución / Cierre

8. Clinical Intelligence

Claude deberá analizar automáticamente:

Evolución temporal

¿Mejora?

¿Empeora?

¿Permanece estable?

Frecuencia

¿Las consultas son cada vez más frecuentes?

Eventos relevantes

¿Qué ocurrió antes del deterioro?

Correlaciones

Por ejemplo:

Cambio de dieta

↓

Disminución del vómito

↓

Normalización del peso

Retrasos

Detectar:

-   retraso diagnóstico,

-   retraso terapéutico,

-   pérdida de seguimiento.

9. Clinical Rules

CR-001

Todo evento debe tener fecha.

CR-002

Un evento pertenece a un único caso.

CR-003

Nunca modificar eventos históricos.

CR-004

Los eventos deben conservar el orden cronológico.

CR-005

Si existen eventos simultáneos deberán agruparse visualmente.

CR-006

Toda modificación deberá generar una nueva versión.

10. Validation Rules

No permitir:

-   eventos sin fecha,

-   eventos sin tipo,

-   eventos huérfanos,

-   eventos fuera del rango del caso.

14. AI Behaviour

Claude utilizará el Timeline para responder preguntas como:

¿Qué ocurrió primero?

¿Cuándo inició el deterioro?

¿Cuándo comenzó la mejoría?

¿Qué ocurrió inmediatamente antes?

¿Qué tratamiento coincidió con la mejoría?

¿Cuánto tardó en responder?

Nunca deberá:

Cambiar la cronología.

Inventar eventos.

Suponer fechas.

17. Prompt Contract

Durante la apertura del caso

Claude creará automáticamente el primer evento del Timeline correspondiente a la consulta inicial.

Durante cada seguimiento

Cada interacción del usuario deberá registrarse como un nuevo evento cronológico.

No se reemplazarán eventos anteriores; únicamente se añadirán nuevos eventos.

Durante el análisis clínico

Claude utilizará el Timeline como la principal fuente para analizar la evolución del paciente, correlacionando consultas, laboratorios, imágenes y tratamientos.

CC-005 — Active Problems Registry

2. Propósito Clínico

El Active Problems Registry mantiene una lista dinámica y estructurada de todos los problemas clínicos identificados durante la evolución del caso.

Un problema no es necesariamente un diagnóstico. Puede ser un signo clínico, un hallazgo de laboratorio, una alteración ecográfica, un síndrome o un diagnóstico confirmado.

Este componente representa el modelo Problem-Oriented Medical Record (POMR) adaptado a gastroenterología veterinaria.

Es el eje sobre el cual Claude organizará su razonamiento clínico.

3. Objetivos

El componente deberá:

-   Mantener la lista de problemas activos.

-   Registrar la evolución de cada problema.

-   Asociar evidencia clínica a cada problema.

-   Relacionar tratamientos con problemas específicos.

-   Facilitar el seguimiento longitudinal.

-   Priorizar problemas según gravedad.

-   Permitir cerrar un problema sin eliminar su historial.

4. Alcance

Incluye

-   Signos clínicos.

-   Síndromes.

-   Hallazgos físicos.

-   Alteraciones laboratoriales.

-   Hallazgos ecográficos.

-   Hallazgos endoscópicos.

-   Diagnósticos presuntivos.

-   Diagnósticos confirmados.

-   Complicaciones.

-   Eventos adversos.

No incluye

Narrativa completa de la consulta.

Resultados íntegros de laboratorio.

Tratamientos completos.

Estos pertenecen a sus respectivos componentes.

5. Clinical Workflow

Historia Clínica

│

▼

Identificación de Problemas

│

▼

Registro del Problema

│

▼

Priorización

│

▼

Seguimiento

│

▼

Resolución / Persistencia

│

▼

Knowledge Base

8. Clinical Intelligence

Claude deberá analizar:

Relaciones

Por ejemplo:

Vómito

↓

Pérdida de peso

↓

Hipoalbuminemia

↓

Enteropatía perdedora de proteínas

Persistencia

¿Qué problemas permanecen?

Resolución

¿Qué problemas desaparecieron?

Recaídas

¿Qué problemas reaparecieron?

Correlaciones

¿Qué tratamiento mejoró cada problema?

Jerarquización

¿Cuál es el problema principal?

¿Cuáles son secundarios?

9. Clinical Rules

CR-001

Un problema nunca se elimina.

Solo cambia de estado.

CR-002

Todo problema debe tener evidencia.

CR-003

Un problema puede estar asociado a múltiples consultas.

CR-004

Un diagnóstico confirmado puede resolver un diagnóstico presuntivo.

CR-005

Un mismo problema no deberá duplicarse.

CR-006

Todo problema resuelto conservará su historial.

10. Validation Rules

No permitir:

-   Problemas sin descripción.

-   Problemas sin estado.

-   Problemas sin fecha.

-   Problemas sin evidencia.

Advertencias:

-   Problema activo sin seguimiento.

-   Problema recurrente.

-   Problema con evidencia contradictoria.

14. AI Behaviour

Claude utilizará este componente como el eje central de su razonamiento clínico.

Deberá responder:

-   ¿Cuáles son los problemas activos?

-   ¿Cuál requiere atención inmediata?

-   ¿Qué evidencia sustenta cada problema?

-   ¿Qué problemas se resolvieron?

-   ¿Qué problemas persisten?

-   ¿Qué problemas aparecieron recientemente?

-   ¿Qué tratamiento ha impactado positivamente cada problema?

Nunca deberá:

-   Eliminar problemas históricos.

-   Marcar un problema como resuelto sin evidencia.

-   Fusionar problemas diferentes sin justificación clínica.

-   Ignorar problemas de alta prioridad por la presencia de un diagnóstico confirmado.

17. Prompt Contract

Durante la apertura del caso

Claude identificará automáticamente todos los problemas clínicos presentes en la historia inicial y construirá el registro inicial, diferenciando entre signos clínicos, hallazgos y diagnósticos.

Durante cada seguimiento

El registro será actualizado dinámicamente:

-   Incorporando nuevos problemas.

-   Actualizando el estado de los existentes.

-   Marcando como resueltos aquellos con evidencia suficiente.

-   Identificando recurrencias o empeoramientos.

Nunca eliminará problemas previamente registrados.

Durante el análisis clínico

El Active Problems Registry será la base para priorizar los diagnósticos diferenciales, organizar la discusión clínica y evaluar la respuesta al tratamiento.

CC-102 — Presenting Complaint

2. Propósito Clínico

El Presenting Complaint representa el motivo principal por el cual el paciente es llevado a consulta.

No se limita a registrar una frase del tutor; Claude deberá identificar el verdadero problema clínico que origina la visita, estructurarlo y convertirlo en la base del razonamiento diagnóstico.

El componente distingue claramente entre:

-   Motivo expresado por el tutor.

-   Problema clínico principal.

-   Problemas secundarios asociados.

3. Objetivos

El componente deberá:

-   Registrar el motivo de consulta original.

-   Identificar el problema principal.

-   Detectar problemas secundarios.

-   Clasificar el tipo de presentación clínica.

-   Medir la evolución temporal.

-   Priorizar automáticamente la urgencia clínica.

-   Alimentar el motor de diagnósticos diferenciales.

4. Alcance

Incluye

-   Motivo de consulta textual.

-   Motivo estructurado.

-   Signo predominante.

-   Sistema afectado.

-   Duración.

-   Intensidad.

-   Frecuencia.

-   Factores agravantes.

-   Factores que alivian.

-   Cambios recientes.

-   Impacto funcional.

No incluye

Diagnósticos.

Resultados de laboratorio.

Examen físico.

Tratamientos.

5. Clinical Workflow

Tutor describe el problema

│

▼

Captura narrativa

│

▼

Extracción mediante IA

│

▼

Clasificación clínica

│

▼

Jerarquización

│

▼

Motor diagnóstico

8. Clinical Intelligence

Claude deberá identificar:

-   El verdadero problema principal.

-   Problemas ocultos.

-   Presentaciones atípicas.

-   Factores desencadenantes.

-   Síndromes asociados.

-   Patrones de evolución.

Ejemplo:

El tutor refiere:

"Mi perro dejó de comer."

Claude deberá identificar que el verdadero problema puede ser:

-   vómito crónico,

-   dolor abdominal,

-   pancreatitis,

-   enfermedad intestinal,

-   enfermedad sistémica.

La anorexia puede ser únicamente una consecuencia.

9. Clinical Rules

-   Mantener siempre el motivo original.

-   Nunca sustituir la narrativa del tutor.

-   Registrar por separado la interpretación clínica.

-   Un caso tendrá un único motivo principal.

-   Podrán existir múltiples motivos secundarios.

10. Validation Rules

Antes del razonamiento diagnóstico deberá existir:

-   Motivo de consulta.

-   Tiempo de evolución.

-   Especie.

-   Edad.

Si alguno falta:

Claude deberá preguntarlo.

14. AI Behaviour

Claude deberá:

-   Comprender el motivo real de la consulta.

-   Diferenciar síntomas primarios de secundarios.

-   Detectar información ambigua.

-   Solicitar aclaraciones.

-   Priorizar urgencias.

Nunca deberá:

-   Dar por hecho un diagnóstico.

-   Cambiar el motivo expresado por el tutor.

-   Ignorar síntomas menores que puedan ser clínicamente relevantes.

17. Prompt Contract

Durante la apertura del caso

Claude solicitará al veterinario el motivo de consulta utilizando una pregunta abierta. A partir de la respuesta, estructurará automáticamente la información, identificará el problema principal y clasificará la presentación clínica.

Durante el seguimiento

El componente registrará cualquier cambio en el motivo inicial, identificando la aparición de nuevos síntomas o la resolución de los existentes, sin modificar la narrativa histórica.

Durante el análisis clínico

El motivo de consulta será utilizado como punto de partida para la generación de diagnósticos diferenciales y la priorización de estudios complementarios.

2. Propósito Clínico

El Clinical Signs Registry es un registro longitudinal e inteligente de todos los signos clínicos observados durante el caso.

Su objetivo no es únicamente almacenar síntomas, sino documentar su comportamiento en el tiempo, permitiendo comprender la evolución de la enfermedad y la respuesta al tratamiento.

Cada signo clínico será tratado como una entidad independiente con su propio ciclo de vida.

3. Objetivos

El componente deberá:

-   Registrar todos los signos clínicos.

-   Registrar cuándo aparece cada signo.

-   Registrar cuándo desaparece.

-   Medir la evolución.

-   Medir la intensidad.

-   Medir la frecuencia.

-   Detectar recaídas.

-   Relacionar signos entre sí.

-   Relacionar signos con tratamientos.

-   Relacionar signos con laboratorios.

-   Relacionar signos con diagnósticos.

4. Alcance

Incluye

Gastrointestinales

-   Vómito

-   Regurgitación

-   Náuseas

-   Diarrea

-   Hematoquecia

-   Melena

-   Disquecia

-   Tenesmo

-   Flatulencia

-   Dolor abdominal

-   Distensión abdominal

-   Borborigmos

-   Hipersalivación

Sistémicos

-   Letargia

-   Fiebre

-   Deshidratación

-   Debilidad

Nutricionales

-   Anorexia

-   Hiporexia

-   Polifagia

-   Pérdida de peso

Otros

Cualquier signo adicional reportado por el veterinario.

5. Clinical Workflow

Historia Clínica

│

▼

Identificación de Signos

│

▼

Registro Inicial

│

▼

Seguimiento

│

▼

Cambio de Intensidad

│

▼

Resolución / Recaída

│

▼

Knowledge Base

8. Clinical Intelligence

Aquí comienza realmente la inteligencia clínica.

Claude deberá detectar automáticamente:

Tendencias

Ejemplo:

Vómito

██████████

██████

████

██

0

Correlaciones

Ejemplo:

Inicio Dieta Hidrolizada

↓

Disminuye vómito

↓

Aumenta peso

↓

Disminuye diarrea

Patrones

Ejemplo:

Vómito

↓

Solo después del desayuno.

Relación temporal

Ejemplo:

La diarrea aparece 48 horas después de iniciar determinado medicamento.

Signos dominantes

Determinar cuál signo explica mejor el cuadro clínico.

Agrupación Sindromática

Claude deberá detectar automáticamente síndromes como:

-   Gastroenteritis aguda

-   Enteropatía crónica

-   Síndrome emético

-   Síndrome diarreico

-   Síndrome de malabsorción

sin asumir diagnósticos definitivos.

9. Clinical Rules

Cada signo es independiente.

Nunca eliminar signos.

Registrar recaídas.

Registrar resolución.

Permitir múltiples signos simultáneamente.

Registrar cambios únicamente mediante nuevos eventos.

10. Validation Rules

Todo signo deberá tener:

-   Fecha.

-   Estado.

-   Evidencia.

-   Fuente.

Advertencias:

-   Signo activo sin seguimiento.

-   Intensidad contradictoria.

-   Resolución sin evidencia.

14. AI Behaviour

Claude utilizará este componente como la principal fuente para analizar la evolución clínica.

Responderá automáticamente:

¿Qué signo apareció primero?

¿Cuál empeoró?

¿Cuál desapareció?

¿Cuál reapareció?

¿Qué tratamiento modificó este signo?

¿Qué laboratorio cambió al mismo tiempo?

¿Qué signos forman un mismo síndrome?

Nunca deberá:

Inventar signos.

Eliminar signos.

Confundir signos con diagnósticos.

17. Prompt Contract

Durante la apertura del caso

Claude identificará todos los signos clínicos presentes en la anamnesis y creará un registro independiente para cada uno, clasificándolos por categoría, intensidad, frecuencia y duración.

Durante cada seguimiento

Actualizará el estado de cada signo clínico existente, registrará cambios en su intensidad y frecuencia, identificará nuevos signos y documentará la resolución o recurrencia de los ya conocidos, manteniendo siempre la trazabilidad histórica.

Durante el análisis clínico

El registro de signos será uno de los principales insumos del motor de razonamiento clínico. Claude utilizará las tendencias temporales, las correlaciones entre signos y la respuesta a los tratamientos para refinar los diagnósticos diferenciales y priorizar las hipótesis más probables.

CC-104 — Physical Examination

2. Propósito Clínico

El Physical Examination documenta de forma estructurada todos los hallazgos obtenidos durante el examen físico del paciente.

No se limita a registrar observaciones; cada hallazgo constituye un dato clínico analizable que podrá compararse longitudinalmente, correlacionarse con laboratorios e imagenología y alimentar el motor de razonamiento clínico.

Cada examen físico representa una instantánea objetiva del estado del paciente en un momento determinado.

3. Objetivos

El componente deberá:

-   Registrar el examen físico completo.

-   Estandarizar los hallazgos.

-   Diferenciar hallazgos normales y anormales.

-   Comparar automáticamente exámenes sucesivos.

-   Detectar cambios clínicamente relevantes.

-   Correlacionar hallazgos con diagnósticos y tratamientos.

-   Servir como evidencia objetiva para la evolución del caso.

4. Alcance

Estado General

-   Nivel de alerta.

-   Actitud.

-   Postura.

-   Marcha.

-   Condición corporal.

-   Estado nutricional.

Signos Vitales

-   Temperatura.

-   Frecuencia cardíaca.

-   Frecuencia respiratoria.

-   Presión arterial (si disponible).

-   Tiempo de llenado capilar.

-   Calidad del pulso.

Hidratación

-   Normal.

-   Leve.

-   Moderada.

-   Severa.

Mucosas

-   Color.

-   Humedad.

-   Tiempo de llenado capilar.

Cavidad Oral

-   Encías.

-   Dentición.

-   Halitosis.

-   Lesiones.

-   Úlceras.

Abdomen

-   Dolor.

-   Distensión.

-   Organomegalias.

-   Ascitis.

-   Masas.

-   Borborigmos.

-   Tensión abdominal.

Linfonodos

Piel

Pelaje

Sistema Respiratorio

Sistema Cardiovascular

Sistema Neurológico (evaluación básica)

Otros Hallazgos

Texto libre.

5. Clinical Workflow

Consulta

↓

Examen físico

↓

Registro estructurado

↓

Comparación con consultas previas

↓

Detección de cambios

↓

Motor de IA

↓

Dashboard

↓

Reporte

8. Clinical Intelligence

Aquí aparece una funcionalidad que pocos sistemas poseen.

Claude deberá comparar automáticamente TODOS los exámenes físicos realizados durante el caso.

Ejemplo:

Consulta 1

Dolor abdominal severo

↓

Consulta 2

Dolor moderado

↓

Consulta 3

Dolor leve

↓

Consulta 4

Sin dolor

Generará automáticamente:

Existe una mejoría progresiva del dolor abdominal compatible con respuesta favorable al tratamiento instaurado.

Otro ejemplo

Consulta 1

Temperatura

39.3

↓

Consulta 2

39.8

↓

Consulta 3

40.2

↓

Consulta 4

39.5

Claude detectará:

-   tendencia

-   pico

-   mejoría

sin necesidad de que el veterinario lo solicite.

9. Clinical Rules

Todo examen pertenece a una consulta.

Nunca modificar exámenes históricos.

Registrar únicamente nuevos exámenes.

No eliminar hallazgos.

Registrar explícitamente cuando un sistema fue evaluado como normal.

10. Validation Rules

Antes de cerrar una consulta deberá existir como mínimo:

-   Estado general.

-   Peso.

-   Temperatura.

-   Hidratación.

-   Abdomen.

Si falta alguno:

Claude sugerirá completarlo.

14. AI Behaviour

Claude deberá:

-   Diferenciar hallazgos normales de anormales.

-   Detectar cambios clínicamente significativos.

-   Correlacionar hallazgos físicos con laboratorios e imagenología.

-   Identificar inconsistencias (por ejemplo, deshidratación severa con hematocrito normal).

-   Destacar hallazgos que modifiquen el diagnóstico diferencial.

Nunca deberá:

-   Inferir hallazgos no documentados.

-   Eliminar hallazgos históricos.

-   Confundir un hallazgo físico con un diagnóstico definitivo.

17. Prompt Contract

Durante la apertura del caso

Claude solicitará de forma estructurada todos los hallazgos del examen físico, organizándolos por sistemas corporales y diferenciando explícitamente entre hallazgos normales y anormales.

Durante cada seguimiento

Comparará automáticamente el examen físico actual con los anteriores, resaltando las mejorías, empeoramientos y nuevos hallazgos. Mantendrá un historial completo sin sobrescribir registros previos.

Durante el análisis clínico

El examen físico será integrado con la historia clínica, los signos clínicos, los laboratorios y la imagenología para refinar los diagnósticos diferenciales y valorar la respuesta al tratamiento.

CC-105 — Nutritional Assessment

AI Intelligence Level: Level 3 – Predictive Intelligence

2. Propósito Clínico

La evaluación nutricional constituye uno de los pilares del manejo gastroenterológico.

Este componente permitirá documentar, analizar y correlacionar todos los aspectos nutricionales del paciente.

No será simplemente una dieta registrada.

Será un Nutrition Intelligence Engine.

Claude deberá poder responder preguntas como:

-   ¿Está mejorando nutricionalmente?

-   ¿La pérdida de peso continúa?

-   ¿La dieta produjo cambios?

-   ¿Cuál dieta funcionó mejor?

-   ¿Existe riesgo nutricional?

3. Objetivos

Registrar:

-   Estado nutricional.

-   Peso.

-   Body Condition Score.

-   Muscle Condition Score.

-   Dieta.

-   Cambios dietéticos.

-   Ingesta calórica.

-   Suplementos.

-   Apetito.

-   Hidratación nutricional.

-   Respuesta clínica a la dieta.

4. Alcance

Antropometría

Peso.

BCS.

MCS.

Alimentación

Marca.

Tipo.

Composición.

Frecuencia.

Cantidad.

Premios.

Snacks.

Suplementos.

Apetito

Normal.

Hiporexia.

Anorexia.

Polifagia.

Selectividad.

Evolución

Ganancia de peso.

Pérdida.

Estabilidad.

Evaluación Clínica

Estado nutricional.

Caquexia.

Obesidad.

Sarcopenia.

5. Workflow

Historia

↓

Evaluación Nutricional

↓

Registro

↓

Seguimiento

↓

Cambio Dietético

↓

Respuesta Clínica

↓

Motor IA

8. Clinical Intelligence

Aquí aparece uno de los algoritmos más interesantes.

Claude deberá detectar automáticamente:

Ejemplo:

Peso

24.1

↓

23.4

↓

22.7

↓

22.2

↓

21.8

↓

Detectará

Pérdida progresiva.

Luego

Inicio Dieta Hidrolizada

↓

22.0

↓

22.5

↓

23.2

↓

Generará

Existe una recuperación ponderal coincidente con el cambio dietético.

Además detectará:

-   respuesta parcial,

-   ausencia de respuesta,

-   recaídas nutricionales,

-   incumplimiento probable.

9. Clinical Rules

Nunca sobrescribir pesos.

Registrar todos.

Toda dieta debe tener fecha.

Registrar cambios dietéticos.

Registrar suplementos.

Registrar causa del cambio.

10. Validation Rules

Antes de cerrar consulta:

Peso.

BCS.

Apetito.

Dieta.

14. AI Behaviour

Claude deberá:

-   Correlacionar el estado nutricional con la evolución clínica.

-   Detectar pérdidas de peso clínicamente significativas.

-   Identificar respuestas positivas o negativas a cambios dietéticos.

-   Relacionar la evolución nutricional con laboratorios (ej. albúmina, proteínas totales, cobalamina) y signos clínicos.

-   Alertar cuando el deterioro nutricional pueda modificar el pronóstico.

Nunca deberá:

-   Recomendar marcas comerciales como tratamiento definitivo.

-   Asumir adherencia a la dieta sin evidencia.

-   Ignorar cambios pequeños pero sostenidos del peso.

17. Prompt Contract

Durante la apertura del caso

Claude solicitará el peso, el Body Condition Score, el Muscle Condition Score, la dieta actual, el apetito y cualquier cambio dietético reciente. Organizará esta información en un perfil nutricional inicial.

Durante cada seguimiento

Registrará los nuevos valores antropométricos, actualizará las curvas de evolución y evaluará automáticamente si existe mejoría, deterioro o estabilidad del estado nutricional. También documentará cualquier modificación en la dieta y su respuesta clínica.

Durante el análisis clínico

Integrará la información nutricional con los signos clínicos, el examen físico, los laboratorios y la evolución del caso para valorar el impacto del estado nutricional sobre el diagnóstico y el pronóstico.

CC-106 — Clinical Scores Framework

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

El Clinical Scores Framework (CSF) es un motor genérico diseñado para gestionar cualquier sistema de puntuación clínica utilizado en gastroenterología veterinaria.

En lugar de implementar cada escala como un componente independiente, el CSF proporciona una arquitectura común para definir, calcular, visualizar e interpretar índices clínicos.

Esto permitirá incorporar nuevas escalas sin modificar el núcleo del sistema.

3. Objetivos

El Framework deberá:

-   Gestionar múltiples escalas clínicas.

-   Calcular automáticamente puntuaciones.

-   Detectar cambios longitudinales.

-   Comparar resultados entre consultas.

-   Generar tendencias.

-   Clasificar severidad.

-   Generar alertas.

-   Integrarse con el Dashboard.

-   Integrarse con Report Composer.

-   Integrarse con la Base de Conocimiento.

4. Alcance

El Framework soportará inicialmente:

Gastroenterología

-   CIBDAI

-   CCECAI

-   Canine Chronic Enteropathy Activity Index

-   Feline Chronic Enteropathy Score

Nutrición

-   BCS

-   MCS

Calidad de Vida

-   QoL Score

Riesgo

-   Malnutrition Risk

-   Dehydration Risk

-   Hospitalization Risk

Scores propietarios de ICIS

En versiones futuras se incorporarán:

-   ICIS Severity Index (GSI)

-   Clinical Recovery Index (CRI)

-   Response to Therapy Index (RTI)

-   Nutritional Recovery Score (NRS)

-   Prognostic Confidence Score (PCS)

8. Clinical Intelligence

Aquí aparece una de las mayores fortalezas del ICIS.

Claude no solo calculará el score.

Lo interpretará.

Ejemplo:

CCECAI

14

↓

10

↓

8

↓

5

↓

2

Interpretación automática:

Se observa una disminución progresiva del índice CCECAI compatible con una respuesta favorable y sostenida al tratamiento instaurado.

Otro ejemplo

BCS

6

↓

5

↓

4

↓

4

Mientras

CCECAI

3

↓

2

↓

2

Claude detectará automáticamente:

Aunque la actividad clínica intestinal ha disminuido, el estado nutricional continúa deteriorándose, lo que sugiere una recuperación incompleta o una enfermedad concomitante.

Esta capacidad de correlacionar escalas es una de las principales innovaciones del framework.

9. Clinical Rules

-   Ningún score podrá sobrescribirse.

-   Cada cálculo quedará asociado a una consulta.

-   Los algoritmos utilizados deberán ser trazables.

-   Las modificaciones futuras de una escala no alterarán los cálculos históricos.

10. Validation Rules

Antes de calcular un score, Claude verificará que todas las variables requeridas estén disponibles. Si falta información:

-   Informará qué datos son necesarios.

-   Evitará calcular puntuaciones incompletas.

-   Indicará el impacto de la información faltante sobre la confiabilidad del resultado.

14. AI Behaviour

Claude deberá:

-   Calcular únicamente escalas validadas.

-   Explicar el significado clínico de cada puntuación.

-   Comparar automáticamente con consultas previas.

-   Correlacionar los diferentes scores.

-   Detectar discrepancias entre escalas.

-   Destacar cambios clínicamente relevantes.

Nunca deberá:

-   Calcular un score con información incompleta sin advertirlo.

-   Interpretar una puntuación fuera de su contexto clínico.

-   Utilizar escalas no validadas sin identificarlas claramente como experimentales.

17. Prompt Contract

Durante la apertura del caso

Claude identificará automáticamente qué escalas clínicas son aplicables según la especie, el cuadro clínico y la información disponible. Si los datos son suficientes, calculará las puntuaciones iniciales; de lo contrario, solicitará únicamente las variables faltantes.

Durante cada seguimiento

Recalculará todas las escalas pertinentes, comparará los resultados con las consultas anteriores y resaltará las variaciones clínicamente significativas, incorporándolas al análisis evolutivo.

Durante el análisis clínico

Integrará los índices clínicos con la historia, el examen físico, los laboratorios y la imagenología para apoyar el razonamiento diagnóstico, valorar la respuesta terapéutica y estimar el pronóstico.

CC-107 — Risk Factors Registry

AI Intelligence Level: Level 3 – Predictive Intelligence

2. Propósito Clínico

El Risk Factors Registry centraliza todos los factores que aumentan la probabilidad de desarrollar una enfermedad gastrointestinal o que modifican el pronóstico del paciente.

Su objetivo es transformar antecedentes dispersos en un perfil de riesgo clínico estructurado, permitiendo al motor de IA ponderar mejor los diagnósticos diferenciales y priorizar las hipótesis más probables.

No diagnostica enfermedades; identifica elementos que incrementan o disminuyen su probabilidad.

3. Objetivos

El componente deberá:

-   Registrar factores predisponentes.

-   Clasificarlos por categoría.

-   Valorar su impacto clínico.

-   Detectar combinaciones de riesgo.

-   Actualizar el perfil de riesgo a lo largo del caso.

-   Incorporar automáticamente nuevos factores identificados durante el seguimiento.

4. Alcance

Factores del paciente

-   Edad.

-   Especie.

-   Raza.

-   Sexo.

-   Estado reproductivo.

-   Condición corporal.

Factores dietéticos

-   Cambios bruscos de dieta.

-   Dietas caseras.

-   Dietas crudas (BARF).

-   Ingesta de cuerpos extraños.

-   Basura.

-   Alimentos tóxicos.

Factores ambientales

-   Viajes.

-   Contacto con otros animales.

-   Guarderías.

-   Refugios.

-   Exposición a parásitos.

-   Estrés ambiental.

Factores médicos

-   Uso reciente de antibióticos.

-   Uso de AINEs.

-   Corticoides.

-   Inmunosupresores.

-   Enfermedades endocrinas.

-   Enfermedad renal.

-   Hepatopatías.

-   Pancreatitis previa.

-   Cirugías digestivas.

Factores infecciosos

-   Desparasitación incompleta.

-   Vacunación incompleta.

-   Contacto con animales enfermos.

Factores genéticos

-   Predisposición racial.

-   Enfermedades hereditarias.

-   Historia familiar relevante.

5. Clinical Workflow

Historia clínica

│

▼

Identificación de factores

│

▼

Clasificación

│

▼

Valoración del impacto

│

▼

Perfil de riesgo

│

▼

Motor diagnóstico

8. Clinical Intelligence

Claude deberá detectar automáticamente relaciones como:

Ejemplo:

Pastor Alemán

↓

Enteropatía crónica

↓

Hipoproteinemia

↓

Interpretación:

La raza constituye un factor predisponente reconocido para determinadas enteropatías crónicas y deberá considerarse al priorizar los diagnósticos diferenciales.

Otro ejemplo:

Antibióticos

↓

Diarrea

↓

Disbiosis

↓

Interpretación:

Existe una relación temporal compatible con diarrea asociada al uso reciente de antimicrobianos.

9. Clinical Rules

-   Todo factor deberá tener una fuente documentada.

-   Los factores históricos no deberán eliminarse.

-   Los factores modificables deberán diferenciarse de los permanentes.

-   Un mismo factor no deberá registrarse dos veces.

10. Validation Rules

Claude verificará:

-   Existencia de factores dietéticos.

-   Medicación reciente.

-   Antecedentes digestivos.

-   Factores ambientales.

Si alguno no ha sido explorado, sugerirá obtener esa información.

14. AI Behaviour

Claude deberá:

-   Identificar automáticamente factores de riesgo relevantes.

-   Distinguir entre factores predisponentes y desencadenantes.

-   Explicar el peso clínico de cada factor.

-   Incorporar los factores al razonamiento diagnóstico sin sobreestimarlos.

-   Revisar el perfil de riesgo en cada nueva consulta.

Nunca deberá:

-   Considerar un factor de riesgo como diagnóstico.

-   Ignorar factores protectores.

-   Exagerar el impacto de un único antecedente aislado.

17. Prompt Contract

Durante la apertura del caso

Claude explorará sistemáticamente los factores de riesgo relacionados con el paciente, la dieta, el ambiente, la medicación y los antecedentes médicos, construyendo un perfil inicial de riesgo.

Durante cada seguimiento

Actualizará el perfil de riesgo cuando aparezcan nuevos antecedentes o cambien las condiciones del paciente, manteniendo la trazabilidad de todos los factores registrados.

Durante el análisis clínico

Utilizará el perfil de riesgo para ajustar la probabilidad de los diagnósticos diferenciales y explicar cómo cada factor influye en el razonamiento clínico.

CC-201 — Complete Blood Count Intelligence (CBC)

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

Este componente analiza todos los hemogramas del paciente de forma longitudinal.

No interpreta únicamente un hemograma aislado.

Construye una evolución hematológica completa.

Su objetivo es identificar patrones compatibles con enfermedades gastrointestinales, inflamatorias, infecciosas, inmunomediadas, hemorrágicas o neoplásicas.

3. Objetivos

El componente deberá:

-   Registrar todos los CBC.

-   Analizar cada parámetro individualmente.

-   Comparar automáticamente todos los CBC previos.

-   Detectar tendencias.

-   Detectar cambios bruscos.

-   Detectar respuestas al tratamiento.

-   Correlacionar hallazgos con signos clínicos.

4. Alcance

Serie Roja

-   Eritrocitos

-   Hemoglobina

-   Hematocrito

-   VCM

-   HCM

-   CHCM

-   RDW

-   Reticulocitos

Serie Blanca

-   Leucocitos

-   Neutrófilos

-   Bandas

-   Linfocitos

-   Monocitos

-   Eosinófilos

-   Basófilos

Plaquetas

-   Recuento

-   MPV

-   PDW

Morfología

-   Anisocitosis

-   Policromasia

-   Esquistocitos

-   Esferocitos

-   Toxicidad neutrofílica

-   Otros hallazgos microscópicos

5. Workflow

Carga del CBC

↓

Validación

↓

Extracción automática

↓

Análisis individual

↓

Comparación longitudinal

↓

Correlaciones clínicas

↓

Motor IA

↓

Dashboard

↓

Reporte

8. Clinical Intelligence

Aquí aparece uno de los motores más sofisticados del ICIS.

Claude analizará cada parámetro de forma independiente y también evaluará su comportamiento conjunto.

Ejemplo:

Hematocrito

38

35

31

28

Mientras:

Reticulocitos

Normales

Altos

Altos

Altos

Interpretación:

Evolución compatible con anemia regenerativa progresiva.

Otro ejemplo:

Neutrófilos

Normal

↑

↑↑

↓↓

Coincidiendo con:

Inicio de antibióticos

↓

Interpretación:

Respuesta hematológica favorable al tratamiento instaurado.

Otro ejemplo:

Eosinófilos

↑↑

↓

↓

Normal

Después de:

Desparasitación

↓

Interpretación:

Evolución compatible con resolución del proceso asociado a eosinofilia.

9. Clinical Rules

-   Nunca modificar valores originales.

-   Conservar siempre los rangos de referencia del laboratorio.

-   Analizar tendencias antes que valores aislados.

-   Identificar cambios clínicamente significativos.

-   Distinguir variaciones biológicas de cambios patológicos.

10. Validation Rules

Claude verificará:

-   Que todos los parámetros esenciales estén presentes.

-   Si existen diferencias importantes entre laboratorios (por ejemplo, cambios en los rangos de referencia).

-   Si la calidad de la muestra puede afectar la interpretación.

-   Si hay datos inconsistentes que requieran confirmación.

14. AI Behaviour

Claude deberá:

-   Analizar primero la evolución y luego los valores aislados.

-   Explicar el significado clínico de cada alteración relevante.

-   Correlacionar los hallazgos con los signos clínicos, el examen físico y la bioquímica.

-   Identificar patrones hematológicos compatibles con enfermedades gastrointestinales.

-   Destacar hallazgos que modifiquen la probabilidad de los diagnósticos diferenciales.

Nunca deberá:

-   Basar un diagnóstico únicamente en el hemograma.

-   Ignorar los rangos de referencia específicos del laboratorio.

-   Sobreinterpretar alteraciones leves sin contexto clínico.

17. Prompt Contract

Durante la apertura del caso

Si el usuario proporciona un hemograma, Claude lo estructurará automáticamente, conservará los valores originales y analizará cada parámetro utilizando los rangos de referencia del laboratorio.

Durante cada seguimiento

Comparará el nuevo hemograma con todos los anteriores, generará gráficos de evolución y destacará los cambios con relevancia clínica, relacionándolos con la evolución del paciente y las intervenciones realizadas.

Durante el análisis clínico

El componente integrará los hallazgos hematológicos con la historia clínica, el examen físico, la nutrición y los demás estudios diagnósticos para fortalecer o descartar hipótesis diagnósticas.

CC-202 — Serum Biochemistry Intelligence

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

El Serum Biochemistry Intelligence Engine analiza longitudinalmente todos los perfiles bioquímicos del paciente para evaluar la función de órganos, el estado metabólico y los patrones compatibles con enfermedades gastrointestinales y sistémicas.

No interpreta analitos de forma aislada. Su objetivo es identificar relaciones entre múltiples parámetros, detectar tendencias y correlacionarlas con la evolución clínica.

3. Objetivos

El componente deberá:

-   Registrar todos los perfiles bioquímicos.

-   Conservar los rangos de referencia originales.

-   Analizar cada analito individualmente.

-   Correlacionar analitos relacionados.

-   Comparar perfiles sucesivos.

-   Detectar patrones compatibles con enfermedades.

-   Evaluar la respuesta al tratamiento.

-   Generar alertas tempranas sobre deterioro o mejoría.

4. Alcance

Proteínas

-   Proteínas totales.

-   Albúmina.

-   Globulinas.

-   Relación A:G.

Función Hepática

-   ALT.

-   AST.

-   ALP.

-   GGT.

-   Bilirrubina total.

-   Bilirrubina directa (si disponible).

-   Ácidos biliares (cuando se disponga).

Función Renal

-   Urea.

-   Creatinina.

-   SDMA (si disponible).

Metabolismo

-   Glucosa.

-   Colesterol.

-   Triglicéridos.

Minerales

-   Calcio total.

-   Calcio ionizado.

-   Fósforo.

-   Magnesio.

Enzimas Musculares

-   CK.

Inflamación

-   Proteína C reactiva (PCR), cuando esté disponible.

-   Otros biomarcadores inflamatorios.

Otros Analitos

El componente deberá permitir incorporar nuevos parámetros sin modificar la estructura general.

5. Clinical Workflow

Perfil bioquímico

↓

Validación

↓

Extracción estructurada

↓

Análisis individual

↓

Correlación de analitos

↓

Comparación longitudinal

↓

Motor de IA

↓

Dashboard

↓

Reporte

8. Clinical Intelligence

Aquí reside la mayor parte del valor clínico del componente.

Claude analizará patrones, no únicamente analitos.

Patrón 1 — Enteropatía perdedora de proteínas (PLE)

Albúmina ↓

+

Proteínas ↓

+

Colesterol ↓

+

Pérdida de peso

+

Diarrea crónica

Interpretación:

Patrón altamente compatible con enteropatía perdedora de proteínas. Se recomienda correlacionar con ecografía intestinal, biopsias y concentración sérica de cobalamina.

Patrón 2 — Colestasis

ALP ↑

+

GGT ↑

+

Bilirrubina ↑

Interpretación:

Patrón compatible con colestasis. Correlacionar con ecografía hepatobiliar y evaluación pancreática.

Patrón 3 — Hepatocelular

ALT ↑

+

AST ↑

Interpretación:

Lesión hepatocelular predominante. Valorar magnitud, persistencia y evolución.

Patrón 4 — Deshidratación

Proteínas ↑

+

Hematocrito ↑

+

Urea ↑

Interpretación:

Hallazgos compatibles con hemoconcentración secundaria a deshidratación.

Patrón 5 — Respuesta al tratamiento

Albúmina

↓

↓

↓

↑

↑

Después del inicio de la terapia.

Interpretación:

Recuperación progresiva de la albúmina compatible con respuesta favorable.

9. Clinical Rules

-   Mantener los valores originales.

-   Conservar los rangos del laboratorio.

-   Priorizar el análisis longitudinal.

-   Interpretar los analitos en conjunto.

-   Documentar siempre las correlaciones relevantes.

10. Validation Rules

Claude verificará:

-   Integridad del perfil.

-   Coherencia entre analitos.

-   Compatibilidad de unidades.

-   Cambios de laboratorio.

-   Calidad de la muestra (hemólisis, lipemia, ictericia) cuando se reporte.

Si detecta inconsistencias, las señalará antes de interpretar el perfil.

14. AI Behaviour

Claude deberá:

-   Priorizar el análisis por patrones.

-   Relacionar los analitos con la historia clínica.

-   Explicar el significado fisiopatológico de las alteraciones.

-   Correlacionar la bioquímica con el hemograma, la nutrición y los hallazgos de imagen.

-   Identificar cambios con implicaciones pronósticas.

Nunca deberá:

-   Diagnosticar enfermedades únicamente por la bioquímica.

-   Ignorar las tendencias longitudinales.

-   Sobreinterpretar alteraciones leves sin contexto clínico.

17. Prompt Contract

Durante la apertura del caso

Claude estructurará automáticamente el perfil bioquímico, conservará todos los valores originales, los rangos de referencia y clasificará cada analito según su estado y relevancia clínica.

Durante cada seguimiento

Comparará todos los perfiles bioquímicos previos, generará tendencias, identificará cambios significativos y los correlacionará con la evolución clínica, los tratamientos y las modificaciones nutricionales.

Durante el análisis clínico

El componente utilizará patrones bioquímicos, más que analitos individuales, para fortalecer o debilitar los diagnósticos diferenciales, integrando la información con el resto de la evidencia diagnóstica.

CC-203 — Electrolyte & Acid-Base Intelligence

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

Este componente interpreta los trastornos hidroelectrolíticos y ácido-base mediante el análisis integrado de los electrolitos, el estado de hidratación, la perfusión tisular, la función renal, la bioquímica y la evolución clínica.

Su finalidad es reconocer patrones fisiopatológicos y generar hipótesis que apoyen el razonamiento diagnóstico, especialmente en pacientes con vómito, diarrea, insuficiencia renal, pancreatitis, enteropatías, obstrucciones gastrointestinales y enfermedades endocrinas.

3. Objetivos

El componente deberá:

-   Registrar todos los paneles de electrolitos.

-   Analizar tendencias longitudinales.

-   Evaluar el equilibrio ácido-base.

-   Detectar patrones compatibles con pérdidas gastrointestinales.

-   Correlacionar los hallazgos con fluidoterapia y evolución clínica.

-   Identificar alteraciones potencialmente críticas.

-   Integrar la interpretación con los demás componentes diagnósticos.

4. Alcance

Electrolitos principales

-   Sodio (Na)

-   Potasio (K)

-   Cloro (Cl)

Electrolitos secundarios

-   Calcio total

-   Calcio ionizado

-   Magnesio

-   Fósforo

Variables ácido-base

-   pH

-   Bicarbonato (HCO₃⁻)

-   TCO₂

-   Exceso de bases (Base Excess)

-   Anion Gap

-   Lactato

Contexto clínico asociado

-   Vómito

-   Diarrea

-   Fluidoterapia

-   Deshidratación

-   Hipoperfusión

-   Insuficiencia renal

-   Enfermedad adrenal

-   Obstrucción gastrointestinal

5. Clinical Workflow

Panel de electrolitos

│

▼

Validación

│

▼

Normalización de unidades

│

▼

Análisis individual

│

▼

Análisis ácido-base

│

▼

Correlación clínica

│

▼

Comparación longitudinal

│

▼

Motor IA

│

▼

Dashboard

│

▼

Reporte

8. Clinical Intelligence

Aquí aparece la verdadera inteligencia del componente.

Claude nunca interpretará un electrolito aislado.

Siempre analizará patrones.

Patrón 1

Na ↓

K ↑

↓

Paciente con vómito

Interpretación:

Patrón compatible con enfermedad adrenal como diagnóstico diferencial. Correlacionar con signos clínicos y pruebas endocrinas.

Patrón 2

Cl ↓

+

HCO₃ ↑

+

Vómito persistente

Interpretación:

Hallazgos compatibles con alcalosis metabólica secundaria a pérdida gástrica.

Patrón 3

HCO₃ ↓

+

Lactato ↑

Interpretación:

Compatible con acidosis metabólica asociada a hipoperfusión.

Patrón 4

Na normal

K normal

Cl normal

↓

Deshidratación severa

Interpretación:

Los electrolitos normales no excluyen alteraciones del estado de hidratación. La interpretación debe integrarse con el examen físico y el hemograma.

Patrón 5

Na ↓

↓

↓

K ↓

↓

↓

Después de fluidoterapia

Interpretación:

Evolución compatible con corrección progresiva del desequilibrio hidroelectrolítico.

9. Clinical Rules

-   Nunca interpretar electrolitos fuera del contexto clínico.

-   Mantener los valores originales.

-   Calcular tendencias automáticamente.

-   Documentar todas las intervenciones terapéuticas relacionadas.

-   Diferenciar alteraciones primarias de cambios secundarios al tratamiento.

10. Validation Rules

Claude verificará:

-   Integridad del panel.

-   Coherencia entre electrolitos y ácido-base.

-   Compatibilidad de unidades.

-   Disponibilidad de datos sobre fluidoterapia.

-   Calidad de la muestra.

Cuando falten datos clave, indicará cómo afectan la interpretación.

14. AI Behaviour

Claude deberá:

-   Interpretar los electrolitos como un sistema integrado.

-   Relacionar las alteraciones con la fisiopatología gastrointestinal.

-   Correlacionar los hallazgos con hemograma, bioquímica, examen físico y tratamiento.

-   Detectar patrones compatibles con enfermedades endocrinas, renales o gastrointestinales.

-   Priorizar las tendencias sobre los valores aislados.

Nunca deberá:

-   Diagnosticar únicamente por un electrolito alterado.

-   Ignorar el contexto terapéutico.

-   Interpretar el equilibrio ácido-base cuando la información sea insuficiente.

17. Prompt Contract

Durante la apertura del caso

Claude estructurará automáticamente los resultados del panel de electrolitos, registrará los valores originales, los rangos de referencia y evaluará el contexto clínico disponible antes de emitir cualquier interpretación.

Durante cada seguimiento

Comparará todos los paneles previos, analizará la evolución del equilibrio hidroelectrolítico y ácido-base, y correlacionará los cambios con la evolución clínica y las intervenciones terapéuticas.

Durante el análisis clínico

El componente integrará los electrolitos con el examen físico, la bioquímica, el hemograma y la historia clínica para identificar patrones fisiopatológicos y fortalecer o debilitar los diagnósticos diferenciales.

CC-204 — Urinalysis Intelligence

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

El Urinalysis Intelligence Engine analiza de manera estructurada todos los exámenes de orina del paciente, integrándolos con la historia clínica, el examen físico, la bioquímica y el hemograma para valorar la función renal, el estado de hidratación y la presencia de alteraciones urinarias con impacto sobre el diagnóstico gastroenterológico.

Aunque el urianálisis no es un examen gastrointestinal, constituye una pieza esencial para interpretar correctamente trastornos metabólicos, deshidratación, enfermedades sistémicas y el estado general del paciente.

3. Objetivos

El componente deberá:

-   Registrar todos los urianálisis.

-   Analizar parámetros físicos, químicos y microscópicos.

-   Comparar estudios longitudinalmente.

-   Correlacionar los hallazgos con bioquímica y electrolitos.

-   Detectar patrones compatibles con enfermedad renal o sistémica.

-   Identificar cambios relacionados con fluidoterapia o tratamiento.

4. Alcance

Evaluación Física

-   Color.

-   Aspecto.

-   Olor (si se reporta).

-   Densidad urinaria.

Evaluación Química

-   pH.

-   Proteínas.

-   Glucosa.

-   Cetonas.

-   Bilirrubina.

-   Urobilinógeno.

-   Sangre oculta.

-   Nitritos (si disponibles).

-   Esterasa leucocitaria (si disponible).

Sedimento

-   Eritrocitos.

-   Leucocitos.

-   Células epiteliales.

-   Cilindros.

-   Cristales.

-   Bacterias.

-   Levaduras.

-   Moco.

-   Espermatozoides (cuando aplique).

Estudios Complementarios

-   Relación proteína/creatinina urinaria (UPC).

-   Microalbuminuria.

-   Cultivo urinario.

-   Sensibilidad antimicrobiana.

5. Clinical Workflow

Recepción del urianálisis

│

▼

Validación

│

▼

Extracción estructurada

│

▼

Análisis físico

│

▼

Análisis químico

│

▼

Análisis del sedimento

│

▼

Correlación con bioquímica y electrolitos

│

▼

Motor IA

│

▼

Dashboard

│

▼

Reporte

8. Clinical Intelligence

Claude analizará patrones completos.

Patrón 1

Densidad urinaria ↓

+

Creatinina ↑

+

Urea ↑

Interpretación:

Hallazgos compatibles con disminución de la capacidad de concentración renal. Correlacionar con enfermedad renal aguda o crónica y estado de hidratación.

Patrón 2

Proteinuria

+

Hipoalbuminemia

Interpretación:

La proteinuria puede contribuir a la hipoalbuminemia observada. Se recomienda valorar la relación proteína/creatinina urinaria y correlacionar con enteropatía perdedora de proteínas.

Patrón 3

Bilirrubinuria

+

ALT ↑

+

ALP ↑

Interpretación:

Hallazgos compatibles con compromiso hepatobiliar o colestasis. Correlacionar con ecografía abdominal.

Patrón 4

Cristales de oxalato

+

Vómito

+

Azotemia

Interpretación:

Evaluar enfermedad renal, intoxicaciones o alteraciones metabólicas según el contexto clínico.

Patrón 5

Bacteriuria

+

Piuria

Interpretación:

Hallazgos compatibles con infección urinaria. Confirmar con cultivo cuando sea clínicamente pertinente.

9. Clinical Rules

-   Mantener siempre los valores originales.

-   Registrar el método de obtención de la muestra.

-   Diferenciar contaminación de infección cuando sea posible.

-   Interpretar la densidad urinaria junto con la hidratación y la bioquímica.

-   Conservar todos los estudios históricos.

10. Validation Rules

Claude verificará:

-   Método de obtención.

-   Integridad del examen.

-   Compatibilidad de unidades.

-   Calidad de la muestra.

-   Datos suficientes para interpretar el sedimento.

14. AI Behaviour

Claude deberá:

-   Analizar el urianálisis dentro del contexto clínico completo.

-   Diferenciar hallazgos incidentales de alteraciones clínicamente relevantes.

-   Correlacionar el examen con bioquímica, electrolitos y estado de hidratación.

-   Identificar patrones compatibles con enfermedad renal, urinaria o sistémica.

-   Explicar el impacto del urianálisis sobre los diagnósticos diferenciales.

Nunca deberá:

-   Diagnosticar una enfermedad únicamente por el urianálisis.

-   Asumir infección urinaria sin evidencia suficiente.

-   Ignorar el método de obtención de la muestra.

17. Prompt Contract

Durante la apertura del caso

Claude estructurará automáticamente el urianálisis, registrando el método de obtención, los parámetros físicos, químicos y microscópicos, preservando los valores originales y los rangos de referencia.

Durante cada seguimiento

Comparará el examen actual con todos los urianálisis previos, identificará tendencias y evaluará cambios relacionados con la evolución clínica, la hidratación y el tratamiento.

Durante el análisis clínico

El componente integrará los hallazgos urinarios con el hemograma, la bioquímica, los electrolitos y el examen físico para valorar su impacto en los diagnósticos diferenciales y en el estado sistémico del paciente.

CC-205 — Fecal Diagnostics Intelligence

AI Intelligence Level: Level 4 – Clinical Decision Support

2. Propósito Clínico

El Fecal Diagnostics Intelligence Engine centraliza, interpreta y correlaciona toda la información obtenida a partir de estudios fecales, integrándola con la historia clínica, los signos gastrointestinales, la nutrición, la bioquímica y la evolución del paciente.

Su objetivo es transformar los resultados fecales en evidencia diagnóstica estructurada, identificando patrones compatibles con enfermedades infecciosas, parasitarias, inflamatorias, digestivas y malabsortivas.

No interpreta únicamente un coprológico; integra múltiples fuentes de evidencia fecal en un único razonamiento clínico.

3. Objetivos

El componente deberá:

-   Registrar todos los estudios fecales.

-   Analizar resultados individuales y longitudinales.

-   Correlacionar hallazgos entre diferentes técnicas diagnósticas.

-   Identificar patrones compatibles con enfermedades gastrointestinales.

-   Evaluar la respuesta al tratamiento.

-   Detectar persistencia o recurrencia de alteraciones.

-   Integrar los hallazgos con el resto de la evidencia clínica.

4. Alcance

Examen Macroscópico

-   Color.

-   Consistencia.

-   Volumen.

-   Frecuencia.

-   Olor.

-   Moco.

-   Sangre fresca.

-   Melena.

-   Material extraño.

-   Parásitos visibles.

Coproparasitología

-   Flotación.

-   Sedimentación.

-   Frotis directo.

-   McMaster.

-   Baermann.

-   Giardia.

-   Coccidias.

-   Nematodos.

-   Cestodos.

-   Trematodos.

Citología Fecal

-   Leucocitos.

-   Eosinófilos.

-   Flora bacteriana.

-   Esporas.

-   Levaduras.

-   Clostridium spp.

-   Campylobacter spp.

-   Otras bacterias relevantes.

Digestibilidad

-   Grasa fecal.

-   Fibras musculares.

-   Almidón.

-   Restos vegetales.

-   Digestión incompleta.

Pruebas Especiales

-   Sangre oculta.

-   Alfa-1 proteinasa inhibidora fecal.

-   Elastasa fecal (si aplica).

-   Calprotectina (si aplica).

-   Lactoferrina (si disponible).

-   Otros biomarcadores fecales.

Estudios Moleculares

-   PCR.

-   Paneles gastrointestinales.

-   Secuenciación microbiológica.

-   Microbioma (futuras versiones).

5. Clinical Workflow

Recepción del estudio fecal

│

▼

Validación

│

▼

Clasificación del tipo de estudio

│

▼

Extracción estructurada

│

▼

Análisis individual

│

▼

Correlación entre estudios fecales

│

▼

Correlación clínica

│

▼

Motor IA

│

▼

Dashboard

│

▼

Reporte

8. Clinical Intelligence

Aquí reside el verdadero valor del componente.

Patrón 1

Giardia positiva

+

Diarrea intermitente

+

Pérdida de peso

Interpretación:

Hallazgos compatibles con giardiasis clínicamente significativa. Correlacionar con respuesta terapéutica y evaluar reinfección en caso de recurrencia.

Patrón 2

Grasa fecal ↑

+

Cobalamina ↓

+

Pérdida de peso

Interpretación:

Patrón compatible con síndrome de malabsorción. Considerar enteropatía crónica, insuficiencia pancreática exocrina o enfermedad del intestino delgado.

Patrón 3

Sangre oculta positiva

+

Anemia regenerativa

Interpretación:

Compatible con hemorragia gastrointestinal crónica. Correlacionar con endoscopia e imagenología.

Patrón 4

Citología inflamatoria

+

PCR elevada

+

Hipoalbuminemia

Interpretación:

Hallazgos compatibles con enfermedad inflamatoria intestinal activa.

Patrón 5

Coprológico negativo

↓

Persistencia de diarrea

Interpretación:

La ausencia de parásitos no descarta enfermedad gastrointestinal. Considerar causas inflamatorias, alimentarias, pancreáticas o funcionales.

9. Clinical Rules

-   Registrar siempre la técnica diagnóstica utilizada.

-   Diferenciar ausencia de evidencia de evidencia negativa.

-   Documentar tratamientos antiparasitarios recientes.

-   Conservar todos los estudios históricos.

-   Analizar resultados en conjunto, nunca de forma aislada.

10. Validation Rules

Claude verificará:

-   Calidad de la muestra.

-   Tiempo hasta el procesamiento.

-   Técnica diagnóstica utilizada.

-   Necesidad de muestras seriadas.

-   Compatibilidad entre estudios realizados.

14. AI Behaviour

Claude deberá:

-   Interpretar todos los estudios fecales como un conjunto.

-   Correlacionar los hallazgos con la historia clínica y la nutrición.

-   Explicar el significado clínico de cada alteración.

-   Diferenciar colonización de enfermedad activa cuando sea posible.

-   Identificar patrones compatibles con enteropatías infecciosas, inflamatorias o malabsortivas.

Nunca deberá:

-   Asumir que un resultado negativo descarta una enfermedad.

-   Diagnosticar una enfermedad únicamente con un examen fecal.

-   Ignorar la sensibilidad y limitaciones de la técnica utilizada.

17. Prompt Contract

Durante la apertura del caso

Claude estructurará automáticamente todos los estudios fecales disponibles, identificará la técnica utilizada, preservará los resultados originales y clasificará cada hallazgo según su relevancia clínica.

Durante cada seguimiento

Comparará los estudios fecales con evaluaciones previas, analizará la evolución de los hallazgos y correlacionará los cambios con tratamientos antiparasitarios, modificaciones dietéticas y evolución clínica.

Durante el análisis clínico

El componente integrará la evidencia fecal con la historia clínica, la nutrición, el hemograma, la bioquímica y los signos clínicos para fortalecer o descartar diagnósticos diferenciales.

CC-220 — Imaging Intelligence

AI Intelligence Level: Level 5 – Multimodal Clinical Reasoning

2. Propósito Clínico

El Imaging Intelligence Engine centraliza, estructura e interpreta todos los estudios de imagen del paciente, integrándolos con la historia clínica, el examen físico, los resultados de laboratorio y la evolución temporal.

Su propósito es convertir la imagenología en evidencia diagnóstica correlacionada, permitiendo detectar progresión de enfermedad, valorar la respuesta al tratamiento y fortalecer el razonamiento clínico mediante una visión anatómica y funcional del aparato digestivo.

3. Objetivos

El componente deberá:

-   Registrar todos los estudios de imagen.

-   Organizar múltiples modalidades diagnósticas.

-   Comparar estudios longitudinalmente.

-   Correlacionar hallazgos anatómicos con evidencia clínica.

-   Identificar progresión o regresión de lesiones.

-   Integrar informes escritos e imágenes cuando estén disponibles.

-   Preparar la arquitectura para análisis asistido por IA en versiones futuras.

4. Alcance

Radiografía

-   Abdomen.

-   Tórax.

-   Estudios con contraste.

Ultrasonografía

-   Abdomen completo.

-   Hígado.

-   Vesícula biliar.

-   Páncreas.

-   Estómago.

-   Intestino delgado.

-   Colon.

-   Linfonodos.

-   Bazo.

Tomografía Computarizada (CT)

-   Abdomen.

-   Tórax.

-   Contraste intravenoso.

-   Estudios multifásicos.

Resonancia Magnética (MRI)

-   Abdomen.

-   Sistema nervioso cuando exista correlación gastrointestinal.

Fluoroscopia

-   Motilidad.

-   Deglución.

-   Tránsito gastrointestinal.

Estudios Especiales

-   Ecografía Doppler.

-   Elastografía hepática.

-   Ecografía contrastada.

-   Futuras modalidades.

5. Clinical Workflow

Recepción del estudio

│

▼

Clasificación de modalidad

│

▼

Extracción estructurada del informe

│

▼

Registro de imágenes

│

▼

Clasificación anatómica

│

▼

Correlación clínica

│

▼

Comparación longitudinal

│

▼

Motor IA

│

▼

Dashboard

│

▼

Reporte

8. Clinical Intelligence

Patrón 1

Engrosamiento difuso del intestino delgado

+

Hipoalbuminemia

+

Cobalamina baja

Interpretación:

Hallazgos compatibles con una enteropatía crónica. Correlacionar con biopsias intestinales y biomarcadores gastrointestinales para establecer la etiología.

Patrón 2

Páncreas hipoecoico

+

cPLI elevada

+

Dolor abdominal

Interpretación:

Patrón altamente compatible con pancreatitis activa. Integrar con evolución clínica y respuesta al tratamiento.

Patrón 3

Linfonodos mesentéricos aumentados

+

Pérdida de peso

+

Citología inflamatoria

Interpretación:

Compatible con enfermedad inflamatoria o infiltrativa. Valorar aspirado o biopsia según el contexto clínico.

Patrón 4

Masa intestinal focal

+

Anemia

+

Sangre oculta positiva

Interpretación:

Hallazgos sugestivos de lesión ocupante de espacio con potencial sangrado gastrointestinal. Priorizar caracterización histopatológica.

Patrón 5

Ecografía normal

+

Diarrea crónica persistente

Interpretación:

Un estudio ecográfico normal no excluye enfermedad gastrointestinal funcional o microscópica. Correlacionar con endoscopia, biopsia y biomarcadores.

9. Clinical Rules

-   Conservar el informe radiológico original.

-   Registrar la modalidad diagnóstica.

-   Mantener todas las imágenes disponibles.

-   Comparar estudios seriados.

-   Diferenciar hallazgos incidentales de hallazgos clínicamente relevantes.

-   Documentar limitaciones técnicas del estudio.

10. Validation Rules

Claude verificará:

-   Calidad diagnóstica.

-   Modalidad correcta.

-   Región anatómica.

-   Disponibilidad de imágenes.

-   Concordancia entre conclusión e informe.

-   Comparación con estudios previos.

14. AI Behaviour

Claude deberá:

-   Integrar el informe de imagen con toda la evidencia clínica disponible.

-   Identificar concordancias y discrepancias entre imagenología y laboratorio.

-   Explicar el significado clínico de cada hallazgo.

-   Priorizar la evolución temporal sobre un único estudio aislado.

-   Expresar claramente el grado de certeza cuando los hallazgos sean inespecíficos.

Nunca deberá:

-   Sustituir la interpretación del especialista en diagnóstico por imágenes.

-   Emitir diagnósticos definitivos únicamente a partir de la imagen.

-   Ignorar limitaciones técnicas o ausencia de correlación clínica.

17. Prompt Contract

Durante la apertura del caso

Claude estructurará automáticamente todos los estudios de imagen, preservando el informe original, clasificando la modalidad diagnóstica y organizando los hallazgos por órgano y región anatómica.

Durante cada seguimiento

Comparará longitudinalmente los estudios de imagen, identificará cambios anatómicos y correlacionará la evolución con el tratamiento, los biomarcadores y la evolución clínica.

Durante el análisis clínico

El componente integrará la evidencia imagenológica con la historia clínica, el examen físico, el laboratorio y los biomarcadores para fortalecer el razonamiento diagnóstico y la priorización de diagnósticos diferenciales.

CC-240 — Diagnostic Correlation Engine (DCE)

AI Intelligence Level: Level 6 – Expert Clinical Reasoning Engine

2. Propósito Clínico

El Diagnostic Correlation Engine (DCE) es el motor central de razonamiento del ICIS.

Su función es integrar toda la evidencia clínica disponible para construir, priorizar y justificar los diagnósticos diferenciales del paciente.

El DCE no reemplaza el juicio del veterinario; actúa como un sistema experto que organiza la evidencia, identifica patrones complejos, detecta inconsistencias y explica de forma transparente cómo llegó a cada hipótesis diagnóstica.

3. Objetivos

El componente deberá:

-   Integrar todas las fuentes de evidencia.

-   Generar diagnósticos diferenciales priorizados.

-   Calcular un nivel de confianza para cada hipótesis.

-   Detectar contradicciones entre evidencias.

-   Explicar el razonamiento clínico.

-   Identificar vacíos diagnósticos.

-   Recomendar estudios adicionales cuando la evidencia sea insuficiente.

-   Aprender de diagnósticos confirmados para mejorar futuros análisis.

4. Evidencia Consumida

Historia Clínica

-   Anamnesis.

-   Antecedentes.

-   Evolución.

Examen Clínico

-   Signos.

-   Hallazgos físicos.

-   Constantes fisiológicas.

Laboratorio

-   Hemograma.

-   Bioquímica.

-   Electrolitos.

-   Urinálisis.

-   Coprológicos.

-   Biomarcadores gastrointestinales.

Imagenología

-   Ecografía.

-   Radiografía.

-   TAC.

-   Resonancia.

Endoscopia

-   Lesiones.

-   Fotografías.

-   Videos.

Histopatología

-   Diagnóstico definitivo.

-   Severidad.

-   Clasificación.

Evolución Clínica

-   Respuesta terapéutica.

-   Controles.

-   Seguimiento.

5. Clinical Workflow

Recepción del caso

│

▼

Integración de toda la evidencia

│

▼

Normalización

│

▼

Correlación clínica

│

▼

Detección de patrones

│

▼

Generación de hipótesis

│

▼

Ranking de diagnósticos

│

▼

Análisis de contradicciones

│

▼

Cálculo de confianza

│

▼

Recomendaciones

│

▼

Dashboard

│

▼

Clinical Report

│

▼

Knowledge Base

8. Motor de Correlación de Evidencia

Cada pieza de información recibirá un peso dinámico.

  -----------------------------------------------------------------------
  Tipo de evidencia                          Peso inicial
  ------------------------------------------ ----------------------------
  Histopatología                             100

  Citología                                  95

  Endoscopia                                 90

  Ecografía                                  85

  Biomarcadores GI                           80

  Bioquímica                                 75

  Hemograma                                  70

  Coprológico                                65

  Historia clínica                           60

  Signos clínicos                            60
  -----------------------------------------------------------------------

Nota de diseño: Estos pesos son valores iniciales configurables. El motor deberá permitir su ajuste por reglas clínicas, evidencia científica o futuras versiones del sistema, evitando tratarlos como valores fijos.

9. Clinical Intelligence

Ejemplo 1

Histopatología:

Enteritis linfoplasmocítica

+

Endoscopia:

Inflamación duodenal

+

Cobalamina baja

+

Albúmina baja

Resultado:

Diagnóstico Prioritario

Enteropatía Inflamatoria Crónica.

Nivel de confianza:

98 %

Ejemplo 2

Ecografía normal

+

Diarrea crónica

+

Biopsia positiva

Resultado:

La biopsia prevalece sobre la ecografía.

Ejemplo 3

Pancreatitis ecográfica

+

cPLI normal

Resultado:

Evidencia contradictoria.

Recomendar reevaluación clínica.

Ejemplo 4

Histopatología negativa

↓

Ecografía positiva

↓

Paciente asintomático

Resultado:

Hallazgo incidental probable.

10. Contradiction Engine

El sistema detectará automáticamente:

-   Evidencias incompatibles.

-   Diagnósticos mutuamente excluyentes.

-   Exámenes repetidos inconsistentes.

-   Resultados atípicos.

-   Hallazgos aislados sin correlación.

Cada contradicción deberá:

-   Explicarse.

-   Priorizarse.

-   Incluir posibles causas.

11. Missing Evidence Engine

El sistema identificará automáticamente:

Información necesaria para confirmar una hipótesis.

Ejemplo:

Hipótesis:

Enteropatía Crónica

Falta:

Biopsia intestinal.

El Dashboard deberá mostrar:

Missing Critical Evidence

15. AI Behaviour

Claude deberá:

-   Integrar toda la evidencia antes de priorizar diagnósticos.

-   Explicar siempre por qué una hipótesis ocupa una posición determinada.

-   Mostrar claramente el grado de incertidumbre cuando la evidencia sea insuficiente.

-   Recalcular el razonamiento automáticamente ante cualquier nueva información.

-   Distinguir entre hipótesis confirmadas, probables y descartadas.

Nunca deberá:

-   Presentar una hipótesis como diagnóstico definitivo sin indicar el nivel de evidencia que la respalda.

-   Ignorar evidencia contradictoria.

-   Ocultar la existencia de incertidumbre diagnóstica.

18. Prompt Contract

Durante la apertura del caso

El DCE integrará automáticamente toda la información disponible, normalizará la evidencia y construirá un conjunto inicial de hipótesis diagnósticas priorizadas.

Durante cada seguimiento

Cada nuevo dato clínico, examen o procedimiento desencadenará un nuevo ciclo de razonamiento, recalculando diagnósticos, niveles de confianza y contradicciones sin perder el historial de decisiones previas.

Durante el análisis clínico

El componente evaluará la consistencia de toda la evidencia, resolverá conflictos entre fuentes, identificará vacíos diagnósticos y explicará de forma transparente por qué una hipótesis es más sólida que otra.

CC-260 — Referral Threshold Engine

Proposito: determinar si un caso es manejable en atencion primaria, requiere derivacion no urgente, requiere derivacion urgente, o si hay informacion insuficiente para clasificar.

Entradas: Differential Diagnosis Matrix (CC-240), Breed Knowledge Object si esta disponible (ICIS-KD-001), resultado de CC-262 (banderas rojas activadas), Signalment Analysis (CC-103).

Reglas:
- Nunca resuelve por defecto hacia "manejable en atencion primaria" cuando la informacion es insuficiente -- en ese caso, solicita la informacion faltante antes de clasificar (Referral Engine Specification, ICIS-REF-001, Seccion 3).
- Una bandera roja activada por CC-262 nunca se pondera contra evidencia tranquilizadora para "promediar" el resultado -- una bandera roja de nivel urgente siempre produce clasificacion de derivacion urgente, sin excepcion.
- El riesgo racial (ICIS-KD-001, Seccion 5.18) actua unicamente como modificador de sensibilidad, nunca como criterio suficiente por si solo para derivar.

CC-261 — Specialty Routing Engine

Proposito: determinar a que especialidad corresponde derivar, y en que orden si hay mas de un sistema comprometido.

Entradas: CC-240, CC-260, Organ-Specific Risk Profile (ICIS-KD-001, Seccion 9.9) cuando este disponible.

Salidas: especialidad de destino + justificacion + pregunta clinica especifica que el especialista debe resolver.

CC-262 — Red Flag Matching Engine

Proposito: comparar los hallazgos del caso contra los documentos de banderas rojas por sistema disponibles en la Base de Conocimiento (por ejemplo, el ya existente para el sistema gastrointestinal).

Regla: si el sistema comprometido no tiene todavia un documento de banderas rojas propio, este componente debe declararlo explicitamente en vez de generar criterios no documentados (Project Instructions, Seccion 5.3).

CC-263 — Referral Outcome Tracker

Proposito: registrar si una derivacion fue seguida por el reporte del especialista, y si estuvo disponible, comparar el desenlace real contra la especialidad y urgencia recomendadas -- alimentando CC-257 para mejorar la calibracion futura de CC-260 y CC-261.

Nota: este componente puede operar con informacion incompleta de forma indefinida (muchos casos derivados nunca reportan su cierre) -- su ausencia de dato no invalida el resto del caso (Knowledge Base Standard, Seccion 20, sobre el puntaje de calidad de casos derivados).

10. Contrato de Consumo

Todo motor o especificacion que consuma un Clinical Component debera:
- Referenciarlo por su codigo (CC-xxx), nunca reimplementar su logica localmente.
- Respetar las reglas especiales marcadas para Referral Report en CC-201 y CC-220.
- Registrar en el Clinical Evidence Graph (CC-250) cualquier inferencia derivada de un componente de la capa de Derivacion (CC-26x), con el mismo estandar de explicabilidad que cualquier otra inferencia (AI Reasoning Standard, Seccion 8).

11. Architecture Decisions

AD-031 — Referral as a First-Class Layer. La capa CC-26x no es una extension opcional del catalogo -- es una capa arquitectonica al mismo nivel que la Correlacion Diagnostica (CC-24x), no subordinada a ella. Un sistema de especialidad podria prescindir por completo de esta capa; ICIS no puede, porque es la que resuelve la pregunta que define su rol.

AD-032 — No Duplicate Logic. Ningun componente CC-2xx o CC-24x puede tomar decisiones de derivacion por su cuenta -- esa responsabilidad pertenece exclusivamente a CC-260/261/262. Esto evita que la logica de derivacion quede dispersa e inconsistente entre distintas partes del sistema.