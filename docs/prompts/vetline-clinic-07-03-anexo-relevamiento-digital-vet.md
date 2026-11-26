# Vetline Clinic — Anexo a los prompts 07 (expediente) y 03 (base del CRM)

Este anexo **se suma** a `vetline-clinic-07-expediente-clinico.md` y a `vetline-clinic-03-base-crm.md`. No los reemplaza. Se rige por `vetline-clinic-00-guia-rectora.md`.

Origen: el relevamiento funcional de Digital Vet (`docs/relevamientos/digital-vet-relevamiento-funcional.md`), que identificó capacidades que Medicavet usa hoy y que el expediente y el CRM deben cubrir. Ese documento describe capacidades, no una interfaz a copiar. Todo se diseña con el sistema de diseño de Vetline Clinic.

**Dónde entra cada parte:**
- La parte A se incorpora al **07**: lo de datos y catálogos en el bloque A; el examen físico, el ingreso y la salida, la receta y el autoguardado en el bloque B, junto con la atención con cargos.
- La parte B se incorpora al **03**.
- Si el bloque A del 07 ya está cerrado cuando llegue este anexo, lo que le toca se agrega como una entrega adicional antes del bloque B, sin rehacer lo terminado.

---

## Parte A — Expediente (07)

### A1. Examen físico por sistemas

Existe una plantilla de **examen físico estructurado**. Es la predeterminada en la nota de la atención de consulta general y queda disponible para cualquier otro tipo de atención.

**Signos y parámetros**, cada uno con su unidad y validación de rango:
- **Peso** (kg). Ya existe; se reutiliza.
- **Temperatura** (°C), **frecuencia cardiaca** (lpm), **frecuencia respiratoria** (rpm).
- **Tiempo de llenado capilar** (segundos).
- **Condición corporal** en escala 1 a 9. La escala 1 a 5 queda como configuración de la clínica.
- **Mucosas**, de un catálogo: rosadas, pálidas, ictéricas, cianóticas, congestivas.
- **Hidratación**, de un catálogo: normal, deshidratación leve, moderada, severa.
- **Actitud**, de un catálogo: alerta, deprimido, letárgico, estuporoso.
- **Dolor**, en una escala opcional.

Los catálogos son por clínica, con valores iniciales.

**Revisión por sistemas.** La lista de sistemas es configurable por clínica, con estos valores iniciales: apariencia general, cardiovascular, respiratorio, digestivo, urinario, reproductor, nervioso, locomotor, dermatológico, ocular, ótico, linfático y hematológico. Cada sistema tiene tres estados:
- **Normal**, con un clic;
- **No evaluado**;
- **Anormal**, que **exige un detalle**.

**Comportamiento:**
- Un botón **"Todo normal"** marca como Normal todos los sistemas que no se han tocado. El médico solo escribe lo anormal.
- En la vista del expediente y en el PDF, la revisión se resume así: primero los hallazgos anormales; después "resto sin alteraciones", con los sistemas normales; y los no evaluados aparte.
- Los signos alimentan las **tendencias del paciente** (peso, temperatura, condición corporal) en la cabecera del expediente. Se usa el mismo componente de gráficos y el mismo patrón que los laboratorios.
- El examen queda dentro de la atención y se firma con ella. Una vez firmada, solo admite adendas.

### A2. Ingreso y salida en la atención

- La atención registra la **hora de ingreso** del paciente a la clínica y, opcionalmente, la **hora de salida**.
- La hora de ingreso se toma del check-in de la cita cuando existe.
- Una atención puede marcarse como **"estancia"**: el paciente queda en la clínica más de la consulta (observación, preparación quirúrgica, grooming largo).
- Con esto se puede consultar quién está en la clínica en este momento y su tiempo de estancia. Es una lista simple en la Agenda o en el inicio.
- **No se construye un módulo de hospitalización** (hoja de tratamiento, jaulas, rondas). Solo se dejan el dato y el modelo preparados para que ese módulo pueda colgarse después. La propuesta de modelo queda en el informe.

### A3. Catálogos de receta

- Existen catálogos por clínica de **vías de administración**, **frecuencias** (cada 8 h, cada 12 h, cada 24 h, dosis única, etc.) y **unidades de dosis**, con valores iniciales.
- La **duración** se registra como cantidad más unidad (días, semanas).
- Cada producto del catálogo de inventario puede tener una **posología sugerida**: dosis por kg o dosis fija, vía, frecuencia y duración. Al agregarlo a una receta se precarga y el médico la ajusta.
- La validación de dosis por peso que ya define el 07 usa estos datos.
- La línea de receta se arma en un clic con los valores sugeridos, y el texto legible para el propietario se genera solo: "1 tableta cada 12 horas por 7 días, vía oral".

### A4. Autoguardado

- La nota de la atención, el examen físico y los documentos largos (consentimientos con texto editable, informes) **se autoguardan** como borrador en el servidor: cada pocos segundos mientras hay cambios, y al salir del campo.
- Un indicador muestra "Guardado hace X s" o "Guardando…".
- Un borrador autoguardado **no es la atención firmada**. La firma sigue siendo un acto explícito, y lo firmado no se autoguarda porque ya no se edita.
- Si la misma atención se abre en dos sesiones, la segunda se abre en modo lectura y avisa quién la tiene abierta. No se pisan cambios.
- Si se pierde la conexión, el borrador se conserva localmente y se sincroniza al volver, avisando al usuario.

### A5. Datos opcionales del paciente

Se agregan a la ficha del paciente, como **opcionales**, siguiendo la regla de una misma lógica con distintos niveles de completitud:

- **Pelaje** o tipo de manto. Es complementario al color, que ya existe.
- **Carácter**, de un catálogo: dócil, nervioso, temeroso, agresivo, etc. Cuando el carácter implica riesgo, se sugiere activar la **alerta de manejo** que ya existe, sin duplicar el dato.
- **Hábitat**: interior, exterior o mixto.
- **Alimentación**: tipo de dieta y marca o descripción libre.
- **Pedigrí**: sí o no, con número de registro opcional.
- **Partos**: cantidad, solo para hembras.
- **Baja del paciente**: estado (fallecido, extraviado, transferido, otro), fecha y motivo. Se verifica contra el estado que ya tenga el paciente y no se duplica.

Las "patologías permanentes" y los "tratamientos permanentes" que maneja Digital Vet ya están cubiertos por la **lista de problemas** y la **medicación activa** del 07. No se crean campos de texto aparte; se anota en el informe que la equivalencia está cubierta.

---

## Parte B — CRM (03)

### B1. Unificar clientes y pacientes duplicados

**Detección:**
- Una pantalla de **posibles duplicados** (Administración o CRM) sugiere pares por misma identificación, mismo teléfono, mismo correo o nombre muy parecido (pg_trgm ya está instalado), con el puntaje de cada criterio.
- Al crear un cliente, si hay coincidencias fuertes se avisa antes de guardar: "Ya existe un cliente con este teléfono".

**Unificación:**
- Se elige el registro que sobrevive y, campo por campo, qué valor conservar. Por defecto se conserva el valor no vacío más reciente.
- Se trasladan al sobreviviente: pacientes, perfiles de facturación, cuentas y saldos, citas, recordatorios, interacciones de la línea de tiempo, consentimientos y archivos.
- Los comprobantes electrónicos emitidos **no se modifican**: conservan su snapshot del receptor. Solo se reapunta la referencia al cliente.
- **Consentimientos:** por cada canal y propósito se conserva la manifestación explícita más reciente. Si hay conflicto, **gana la negativa** (baja o no consiente). El cambio queda en el historial de consentimientos.
- El registro absorbido no se borra físicamente: queda marcado como unificado, apunta al sobreviviente y deja de aparecer en búsquedas.
- Queda un registro de auditoría de la unificación: quién, cuándo, qué se movió y qué valores se eligieron.
- Es una operación **irreversible en la práctica**, así que solo la hace el rol administrador, con una confirmación que muestra el resumen de lo que se va a mover. Toda la unificación es una sola transacción.

La misma herramienta existe para **pacientes duplicados** del mismo propietario: se unifican sus atenciones, vacunas, documentos y recordatorios. El número de expediente que sobrevive es el del registro elegido, y el otro queda como alias buscable.

### B2. Autocompletar por número de identificación

- Al escribir una cédula física, una cédula jurídica o un DIMEX en el alta de cliente o de perfil de facturación, el sistema consulta la **consulta pública de contribuyentes de Hacienda**, según su documentación oficial. Con eso completa el nombre o la razón social y, para los perfiles de facturación, la actividad económica y la situación tributaria.
- Se implementa detrás de un **proveedor intercambiable**, con un **proveedor simulado** por defecto en desarrollo. El real se activa por configuración, con caché, límite de frecuencia y tiempo de espera corto. Si el servicio no responde, el formulario sigue manual sin bloquear.
- **TSE (padrón electoral):** no se descarga ni se almacena el padrón completo. El informe documenta qué opciones oficiales existen y qué implicaría cada una frente a la Ley 8968 de protección de datos, para decidir después.
- Lo autocompletado se puede editar, y queda marcado con su fuente.

### B3. Fuente de referencia

- Un catálogo por clínica de **cómo llegó el cliente**, con valores iniciales: redes sociales, Google o búsqueda, referido por un cliente, referido por un veterinario, pasó por el local, campaña, otro.
- Cuando la fuente es **"referido por un cliente"**, se puede elegir qué cliente lo refirió (un enlace, no texto). Así queda lista la base para premiar referidos en la fidelización (7.1 de la guía), que **no se construye ahora**.
- El dato es opcional en el alta. Se registra en la línea de tiempo como el primer evento del cliente.

### B4. Forma de contacto preferida

- El cliente tiene un **canal preferido** entre WhatsApp, correo, llamada y SMS (este último solo si existe como canal).
- `puedeEnviar()` sigue mandando: el canal preferido **nunca habilita** un envío sin consentimiento. Solo ordena la elección entre los canales consentidos. Si el preferido no está consentido para ese propósito, se usa el siguiente consentido, y la ficha lo advierte.
- Se muestra en la ficha del cliente y en el detalle de la cita.

---

## Verificación y entrega

Según la sección 12 de la guía, cada flujo se recorre en el navegador:

- registrar una atención con "Todo normal" más dos sistemas anormales, firmarla y ver el resumen y el PDF;
- ver las tendencias de signos en la cabecera;
- armar una receta con posología sugerida;
- cortar la red durante el autoguardado y recuperar el borrador;
- abrir la misma atención en dos sesiones;
- unificar dos clientes con consentimientos en conflicto y confirmar que gana la negativa;
- autocompletar con el proveedor simulado;
- registrar un cliente referido por otro.

El informe incluye las pantallas nuevas con su camino de clics, las migraciones creadas, las equivalencias declaradas (patologías y tratamientos permanentes, estado de baja) y la propuesta de modelo para hospitalización.
