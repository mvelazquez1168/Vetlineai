# Vetline Clinic — Ajustes de la revisión en el navegador (27 de noviembre de 2026)

Rama: `fix/revision-2026-11-27`, que parte del último punto que contenga todo lo construido hasta hoy, incluida la rama `fix/firmas-y-documentos`. Se rige por `vetline-clinic-00-guia-rectora.md`, sección 12: verificar en el navegador, mantener actualizado el manual de usuario en `docs/ayuda/` y no fusionar a `main` sin revisión.

## Por qué existe

Miguel revisó el sistema en el navegador con `demo.medico` y encontró defectos y faltantes. Algunos impiden usar el sistema. Este prompt los reúne en una sola entrega, ordenados por prioridad.

**Forma de trabajar para cada punto:**
1. **Reproducirlo primero en el navegador**, con `demo.medico`, y anotar en el informe lo que se vio (pantalla, consola, red).
2. Encontrar la causa y corregirla en su origen, no en el síntoma.
3. **Agregar una prueba de regresión** a los verificadores: de extremo a extremo para los flujos, para que un cambio en otro módulo no vuelva a romperlos sin que se note.
4. Verificar de nuevo en el navegador y contrastar contra la base.
5. Actualizar el manual en `docs/ayuda/` donde corresponda.

Si un punto ya quedó resuelto en `fix/firmas-y-documentos` o en otra rama, solo se verifica y se informa como tal.

---

## Prioridad 1 · Bloqueantes

### 1.1 No se puede registrar una atención

Desde hace un buen rato, al pulsar **"Registrar atención"** en la ficha del paciente, la pantalla de la atención no se despliega.

- **Sospechosos, en orden:**
  - el commit `75ca2a9` del 05, que mueve toda escritura en `citas` a `agenda/citas.ts` y agrega el motor de disponibilidad (abrir una atención crea su cita por `crearCita`);
  - las migraciones 166 y 167 con el backend sin reiniciar;
  - un error en el frontend de la atención.
- **La prueba de regresión** abre una atención desde la ficha del paciente, sin cita y con cita, y llega hasta el cierre.
- **Corregir también la hora de la cita de la atención sin turno.** En `expediente/atencion.ts`, la fecha y la hora se calculan con `toISOString()`, que es UTC, en lugar de la zona horaria de la clínica (America/Costa_Rica). Después de las 6 p. m., la cita queda con la fecha del día siguiente.
- **Buscar el mismo patrón en todo el backend:** cualquier `toISOString().slice(...)` usado como fecha u hora local. Corregirlo con la utilidad de zona horaria de la clínica que ya existe e informar dónde estaba.

### 1.2 Vacunas y desparasitaciones guardadas que no aparecen en la lista

Miguel registró una vacuna y una desparasitación. El mensaje dijo que se guardaron, pero **no aparecen** en las pestañas Vacunas y Desparasitaciones, ni en la línea de tiempo.

- Reproducir por los tres caminos:
  - desde la atención, con las acciones Vacuna y Desparasitación del 07c;
  - con "Registrar histórico" en la pestaña;
  - cerrando la atención.
- Si por diseño algo solo aparece al cerrar la atención, la pantalla tiene que decirlo **en el momento de guardar**, por ejemplo: "Quedará en el historial al cerrar la atención". Un mensaje de "guardado" que no se refleja en ningún lado es un defecto, aunque el dato exista.
- Revisar que el registro escriba donde lo leen la pestaña, la línea de tiempo y el trabajo diario de notificaciones (`cuidados_preventivos`), según la regla de notificaciones de la sección 7 de la guía.
- Confirmar si es la misma causa que el punto 1.1 o una distinta.

### 1.3 La firma de los consentimientos (verificar)

Si `fix/firmas-y-documentos` ya lo resolvió, solo se verifica. Que se cumpla:
- **firma real dibujada** con el dedo o el mouse, con rechazo de imágenes vacías o de relleno;
- evidencia del firmante (nombre, identificación y relación con el paciente), testigo, fecha del servidor y dispositivo;
- hash de integridad;
- PDF enviado al cliente;
- firma a distancia con enlace y código;
- los consentimientos viejos marcados como "sin firma válida".

---

## Prioridad 2 · Faltantes que impiden el uso normal

### 2.1 Imágenes y documentos: poder agregarlos en su pestaña (verificar o completar)

Si `fix/firmas-y-documentos` ya lo resolvió, solo se verifica. Que se cumpla:
- botón "Agregar imagen o documento" con carga múltiple y cámara en teléfono o tablet;
- tipo, fecha, descripción y atención opcional;
- galería con miniaturas, zoom y visor de PDF;
- filtros y origen visible de cada elemento;
- permisos por rol;
- botón "Adjuntar" en la atención en curso.

### 2.2 Salas y equipos: dónde se crean

Miguel no encontró dónde se crean los recursos que controla la agenda: salas como el quirófano y equipos como el endoscopio. El backend tiene la API de salas, y la migración 166 del 05 agregó los equipos como recurso, pero **ninguna pantalla permite crearlos**. La agenda muestra "Sin salas configuradas".

- Si el 05 o el 04 ya dejaron la pantalla, se verifica que **se llegue desde el menú** (Administración › Clínica y usuarios › Salas y equipos).
- Si no, se construye según la sección 3 del prompt 04 (`vetline-clinic-04-administracion-base.md`, "Salas y recursos"):
  - salas y equipos con nombre, tipo, color, capacidad y horario;
  - los recursos que exige cada tipo de cita;
  - la agenda impide reservar dos veces el mismo recurso, salvo con un permiso registrado;
  - desactivar sin borrar la historia.
- En la agenda, el texto "Sin salas configuradas" lleva un enlace a esa pantalla.

### 2.3 Toda pantalla tiene una forma clara de volver atrás

**Regla para todo el sistema:** ninguna pantalla deja al usuario sin una salida visible. Hay dos tipos de pantalla:

- **Pantallas hijas** (ficha de un producto, detalle de un comprobante, ficha del paciente, una atención, el detalle de una cita, la lista del drill-down de un dashboard, cualquier formulario de alta o edición): llevan en su encabezado un enlace **"← [nombre de la pantalla padre]"**, por ejemplo "← Pacientes" o "← Catálogo", además de la miga de pan.
  - Si se llegó desde otro lugar (por ejemplo, a la ficha de un paciente desde la Agenda o desde un dashboard), el enlace dice **de dónde se vino** ("← Agenda") y vuelve ahí, **conservando los filtros y la posición** de la lista.
- **Pantallas de primer nivel** (las que están en el menú): la salida es el menú y la miga de pan. Dentro de un módulo con pestañas, las pestañas son la navegación.
- **Formularios con cambios sin guardar:** al intentar volver, preguntan antes de descartar.
- **En móvil (PWA):** el botón atrás del sistema operativo y el del navegador hacen lo mismo que el enlace. Una pantalla abierta en un modal se cierra con atrás en lugar de salir de la página.

Se recorren **todas** las pantallas de la lista de control del 01c (`docs/diseno/relevamiento-marco.md`) y se marca en esa lista que cada una cumple la regla. Las de la lista que solo se habían verificado por diferencia se abren ahora en el navegador. Esto cierra el pendiente del 01c.

### 2.4 Inventario: el indicador "Vencen en 60 días"

El indicador muestra 0 mientras la tabla muestra el Alcohol etílico 70 % con vencimiento el 25 de diciembre de 2026, a menos de 60 días. Encontrar la causa (fecha del producto frente a fecha del lote, filtro de existencia, zona horaria), dejar la tabla y el indicador sobre la misma fuente (el diccionario de métricas del 12, si ya lo cubre) y agregar el caso a la verificación.

---

## Prioridad 3 · Pulido visual pendiente del 01c y el 07c

- **Pestañas debajo de la franja:** en las pantallas con pestañas de sección (Inventario, Caja, Agenda y las demás), el orden es franja con título, acciones e indicadores, y debajo las pestañas. Se corrige en el componente del encabezado y se verifica en todas.
- **Selector de paciente en tarjetas** en el modal de cita: tarjetas con el ícono de la especie, el nombre y los datos, y la elegida marcada. Hoy sigue siendo una lista.
- **Estados del examen por sistemas con color** (07c): verificar que la opción elegida va rellena con su color semántico, que la fila toma un fondo suave con ícono, que lo anormal abre su detalle obligatorio, que no se repite el texto "Sin evaluar" y que hay un resumen en vivo con "Todo normal".
- **Estados vacíos para usuarios no médicos** en el expediente: verificar que explican que solo un médico registra contenido clínico y que, para un médico, el estado vacío de Atención actual trae "Abrir atención".

---

## Verificación y entrega

**El informe incluye, por cada punto:**
- lo que se reprodujo;
- la causa encontrada;
- la corrección;
- la prueba de regresión agregada;
- la verificación en el navegador;
- si estaba resuelto en otra rama.

**Además:**
- La lista de control del 01c, completa con la regla de volver atrás.
- La lista de lugares donde se calculaba una fecha local con UTC.
- Una sección corta **"cómo probarlo"** para Miguel: los clics exactos para comprobar cada punto con `demo.medico`.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
