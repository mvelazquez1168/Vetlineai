# Vetline Clinic — Ajustes de la revisión del 27 de noviembre (noche)

> Prompt para Claude Code. Hallazgos de la revisión en el navegador del 27 de noviembre por la noche. Va **después del paquete de la tarde** (flujo atención→caja, certificado, gráficas, chips, voseo) y **antes de la consolidación**. Respeta la guía rectora: textos de usted, permisos desde la base, `useCambiosSinGuardar`, manual de usuario actualizado.

## 1. Menú y acceso por rol

Probé la invitación con rol Recepción: la usuaria (Juanita) entra correctamente y no puede invitar. Pero su menú muestra más de lo que le corresponde: Administración › Personas, Catálogos y cumplimiento, Calidad de datos, e Inteligencia › Casos clínicos y Casos sin actividad.

- Revisa el menú y el acceso a rutas de **cada rol nuevo** (recepción, caja, farmacia, estética, asistente técnico, contador) contra la matriz de permisos del 04. Cada opción del menú y cada ruta se muestra o se permite solo si el rol tiene el permiso, en el frontend **y** en el backend.
- Por defecto: recepción sin acceso a los casos clínicos con IA ni a la administración, salvo lo que la matriz le dé explícitamente (por ejemplo, la parte de Calidad de datos que toca clientes); contador sin acceso a lo clínico; caja y farmacia solo a lo suyo.
- Si un rol entra por URL a una ruta sin permiso, ve el aviso de "sin acceso" dentro de la aplicación, con botón a su inicio.
- **Prueba automática:** por cada rol, recorre el menú y las rutas y verifica que coinciden con la matriz.

## 2. Rutas sin autenticación

A raíz del router de citas que quedó sin `authenticate`: agrega una prueba automática que recorra **todas** las rutas registradas en Express y falle si alguna responde sin sesión, salvo una lista explícita de rutas públicas (páginas por token, verificación del QR del certificado, aceptación de invitaciones, salud del servicio, webhooks). Si aparece otra ruta abierta, ciérrala y anótala en la bitácora. La prueba entra al conjunto que corre antes de cada despliegue.

## 3. Robustez del servidor

Al aceptar una invitación hubo un `ERR_EMPTY_RESPONSE`; los logs muestran que coincidió con un reinicio del contenedor, no con una caída. Aun así, verifica que exista un manejador global de errores y de promesas rechazadas, de modo que **ninguna petición pueda tumbar el proceso**, y que el alta por invitación mantenga la compensación en Keycloak si falla a mitad.

## 4. Textos a usted (casos concretos encontrados)

Sumar al barrido de voseo y tuteo del paquete de la tarde:

- Administración › Personas: "Podés ver el equipo…" → "Usted puede ver el equipo…"; la etiqueta "(vos)" junto al usuario actual → "(usted)".
- Pantalla de aceptación de invitación: "Completá tu alta" → "Complete su alta"; "Sumate como médico veterinario" → "Súmese como médico veterinario"; "te invitó" → "le invitó"; "Completá tu registro para empezar…" → "Complete su registro para empezar…".
- Busca también en los textos de los logs y mensajes que ve el usuario (no hace falta en logs internos del servidor).

## 5. Pantalla de equipos (Administración › Clínica › Salas y equipos)

- El primer campo del modal "Nuevo equipo" no tiene etiqueta: agregar **"Nombre del equipo"**.
- El campo **Categoría** tiene como texto de ejemplo "Imagen", que se confunde con una solicitud de imagen. Convertirlo en una **lista para elegir** (Diagnóstico por imagen, Laboratorio, Cirugía, Anestesia, Odontología, Otro) con la opción de agregar categorías propias de la clínica; si se mantiene texto libre, el ejemplo debe decir "Ej.: Diagnóstico por imagen".

## 6. Equipos en la cita (agenda)

Hoy el equipo se reserva solo a través del tipo de cita (un tipo puede exigir una sala o un equipo). Eso no cubre la consulta en la que la necesidad surge en el momento, y en la cita no se ve qué equipo quedó tomado.

- En **Nueva cita** y **Editar cita**, un campo **Equipos** junto a Sala: se llena solo con los que exige el tipo de cita (con indicación "requerido por el tipo") y permite agregar otros a mano (selección múltiple de los equipos activos).
- **Disponibilidad al elegir:** si un equipo (o la sala) está ocupado en ese horario, considerando su cantidad, se avisa en el momento y se sugiere el próximo horario libre con sala y equipos disponibles. El motor de disponibilidad del 05 usa los equipos agregados a mano igual que los del tipo.
- El **panel de detalle de la cita** muestra la sala y los equipos reservados.
- En la vista de agenda, el filtro por sala se complementa con un filtro por equipo, para ver la ocupación del ultrasonido, por ejemplo.
- Tests: dos citas que piden el único equipo a la misma hora → la segunda no se ofrece; con cantidad 2, sí; equipo agregado a mano bloquea igual que uno del tipo.

## 7. Modal de Nueva cita

- **Encabezado desacomodado:** por encima del título "Nueva Cita" asoma un campo ("Sin especificar"); el contenido se desplaza por encima del encabezado. El encabezado (título y cerrar) y el pie (Cancelar y Guardar) quedan fijos; solo el cuerpo se desplaza. Revisa el mismo patrón en el componente común de modales para que no ocurra en ningún otro.
- **Fecha en el pasado:** la cita propuso el 24/11/2026, ya pasado. Una cita nueva con fecha y hora pasadas no se permite, salvo con la opción explícita "Registrar una cita ya ocurrida" (con permiso), y la fecha por defecto es la del espacio elegido en el calendario o, si no, el próximo horario libre.
- **Fuera de la franja de atención:** si la hora elegida queda fuera del horario configurado de la clínica o del médico (por ejemplo, 07:30), se avisa al agendar y se pide confirmación con permiso.

## Verificación y entrega

- Tests de los puntos 1, 2 y 6, más los del modal (fecha pasada bloqueada, aviso fuera de franja).
- Capturas en la bitácora: menú de cada rol, modal de equipo, nueva cita con equipos y aviso de ocupado, panel de detalle, modal sin el defecto del encabezado.
- Manual de usuario actualizado (agenda y salas y equipos) con cómo reservar un equipo.
- Nada a producción; nada a `main` sin revisión.
