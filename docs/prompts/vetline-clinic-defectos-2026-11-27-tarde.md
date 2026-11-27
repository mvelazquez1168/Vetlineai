# Vetline Clinic — Defectos y mejoras de la revisión en el navegador (27 de noviembre de 2026, tarde)

Rama: `fix/defectos-2026-11-27-tarde`, que parte de `fix/revision-2026-11-27`. Si los ajustes de esa rama no están terminados, este paquete se hace después de terminarlos, en la misma secuencia. Se rige por `vetline-clinic-00-guia-rectora.md`: sección 12 (verificación desde la interfaz, manual en `docs/ayuda/`) y sección 4.7, incluida la regla nueva "Nunca se pierden datos al salir de una pantalla".

## Por qué existe

Miguel siguió revisando en el navegador con `demo.medico` y encontró estos defectos. La mayoría son **de pantalla**: la API respondía bien y las pruebas pasaban, pero lo que ve el usuario no funcionaba. Por eso cada punto exige una prueba que mire **lo que usa la pantalla**, no solo la respuesta de la API.

**Forma de trabajar para cada punto:**
1. Reproducir y anotar la causa.
2. Corregir en el origen.
3. Agregar una prueba de regresión.
4. Verificar desde la interfaz, contrastando con la base.
5. Actualizar `docs/ayuda/`.

Como el entorno de Code no tiene navegador, el informe trae para cada punto los **clics exactos para que Miguel lo compruebe** ("cómo probarlo").

---

## 1. El registro histórico de vacunas y desparasitaciones no aparece en la lista

**Síntoma:** al registrar una vacuna o desparasitación histórica (pestaña Vacunas o Desparasitaciones › Registrar histórico), sale "guardado", pero no aparece en la pestaña ni en la línea de tiempo.

**Causa:** `registrarHistorico` (`backend/src/expediente/preventivos.ts`, ruta `POST /expediente/pacientes/:id/preventivo-historico`) inserta en `cuidados_preventivos` pero **no registra su evento en la línea de tiempo**. Las pestañas leen de la línea de tiempo (tipos `vacuna` y `desparasitacion`).

**Corrección:**
- `registrarHistorico` llama a `registrarInteraccion` en la misma transacción, con:
  - el tipo correspondiente;
  - **la fecha del evento igual a la fecha de aplicación**, no la de hoy;
  - la referencia al registro de `cuidados_preventivos`;
  - la marca **"histórico"**, visible en la pestaña, la línea de tiempo y el certificado de vacunas.
- **Relleno idempotente** del evento para los registros históricos que ya existen sin él.
- Revisar que **todo** punto que escribe en `cuidados_preventivos` registre su evento (regla de la línea de tiempo del 03).
- **La prueba** registra un histórico y comprueba que aparece en la respuesta del endpoint que usa la pestaña.

## 2. Examen por sistemas: cada estado con su color, siempre

**Síntoma:** los botones No evaluado, Normal y Anormal solo toman color cuando están elegidos. Como todo arranca en "No evaluado", se ven los tres grises. Miguel ya lo había pedido en el 07c (punto 5).

**Corrección**, en `AtencionActual.tsx`:

| Opción | Sin elegir | Elegida |
|---|---|---|
| **Normal** | Borde y texto `success` | `bg-success` con texto blanco |
| **Anormal** | Borde y texto `error` (o `warning`, si el contraste es mejor) | Relleno de ese color con texto blanco |
| **No evaluado** | Borde y texto neutros | Relleno neutro claro con texto oscuro, sin el `bg-black/20` actual |

- El hover de cada botón usa su propio color.
- Se mantienen el fondo de la fila según el estado y el ícono.
- Los colores salen de los tokens de estado, con contraste AA en todos los temas.
- **Verificación:** capturas de los tres estados en el tema Marca de la clínica y en el morado actual de la clínica de demostración.

## 3. La receta, la vacuna y la desparasitación no encuentran los productos del inventario

**Síntoma:** con cientos de productos cargados en el inventario, la receta solo muestra la Amoxicilina.

**Causa:** `catalogoClinico("medicamento")` (en `AccionesClinicas.tsx`) solo devuelve productos con `tipo_clinico = 'medicamento'`. La migración 115 dejó en NULL todo lo que no era evidente. Lo mismo afecta a Vacuna (`vacuna`) y Desparasitación (`antiparasitario`).

**Corrección:**
1. **Buscador con autocompletado** en lugar de la lista desplegable, en la receta, la vacuna y la desparasitación:
   - busca por nombre, código, principio activo y código de barras, desde la segunda letra;
   - muestra la presentación, la existencia y el precio;
   - se usa con el teclado.
2. **Los productos sin clasificar también aparecen**, con la etiqueta "sin clasificar". La receta muestra los de tipo `medicamento` más los sin clasificar; Vacuna y Desparasitación, igual con su tipo. Desde ahí mismo se puede clasificar el producto (administrador, o médico con permiso).
3. **Clasificación masiva en Inventario:**
   - una lista de productos sin tipo clínico, con filtros por categoría y familia;
   - selección múltiple y asignación del tipo en lote;
   - una sugerencia por categoría que el usuario confirma (nunca se aplica sola).
   - En el Inventario, un indicador "Productos sin clasificar: N" que lleva a esa lista.
4. **La plantilla y la importación** de productos incluyen la columna de tipo clínico.
5. **Confirmar en qué tenant** están los productos cargados recientemente y si coincide con la clínica de `demo.medico` ("Clínica Prueba Facturación"). Si no coincide, informarlo; no mover datos entre tenants.

**Verificación:** con el catálogo real cargado, buscar un medicamento sin clasificar en la receta, clasificarlo y recetarlo; clasificar 20 productos en lote; buscar una vacuna por código de barras.

## 4. Nunca se pierden datos al salir de una pantalla

Es una regla nueva de la guía, sección 4.7. Todo formulario y todo modal con campos pregunta **Guardar**, **Descartar** o **Seguir editando** si se intenta salir con cambios sin guardar, por cualquier vía:
- menú, miga de pan, enlace de volver;
- atrás del navegador o del teléfono;
- cerrar el modal con X, Escape o clic afuera;
- recargar o cerrar la pestaña.

**Excepción:** las pantallas con autoguardado (la atención) no preguntan si todo ya se guardó. Si hay un guardado pendiente, esperan o avisan.

**Implementación:**
- **Una sola vez:** un hook `useCambiosSinGuardar` con el bloqueo de navegación del router (`useBlocker`) y `beforeunload`, integrado en el `Modal` compartido.
- **Barrido de todas las pantallas con formulario**, como el de los modales: un verificador que liste cada formulario y falle si alguno no usa el hook.

## 5. Invitaciones: "Copiar enlace"

En desarrollo el correo es simulado, así que la persona invitada nunca recibe el enlace, y la pantalla solo ofrece "Reenviar".

- **Junto a cada invitación pendiente**, un botón **"Copiar enlace"** que copia el enlace de alta (`/invitacion/:token`) al portapapeles.
  - Solo lo ve quien tiene `personas.administrar`.
  - Como el enlace es una credencial de un solo uso, queda en la auditoría quién lo copió y cuándo.
- **Al crear una invitación**, el mensaje de éxito ofrece también copiar el enlace.
- El menú ya dice "Personal e invitaciones". Verificar que el nombre sea coherente en la miga de pan, el título y la ayuda.

## 6. Menú de Administración: ordenarlo

El grupo Administración tiene unas 14 opciones, y varias son lo mismo visto desde lugares distintos. A Miguel le costó encontrar dónde invitar a un médico. Se reorganiza en **menos opciones, con pestañas dentro de cada una**:

| Opción del menú | Pestañas |
|---|---|
| **Personas** | Personal · Invitaciones · Roles y permisos |
| **Clínica** | Datos · Apariencia · Salas y equipos · Agenda (horario, feriados, tipos de cita, numeraciones) · Notificaciones y servicios de IA · Políticas |
| **Catálogos y cumplimiento** | Las pestañas actuales del 11 que no son de personas |
| **Reportes** | Como está |
| **Calidad de datos** | Posibles duplicados · Productos sin clasificar (punto 3) · Fichas por completar |
| **Plan y suscripción** | Plan y consumo · Facturación de la suscripción |
| **Estado de Vetline Clinic** | Como está |

**Reglas:**
- Las URL actuales siguen funcionando y **redirigen** a la pestaña nueva, para no romper enlaces ni la ayuda.
- Cada pestaña queda en la URL.
- Se respetan los permisos por rol y los módulos activos.
- Se actualizan `docs/ayuda/` y los caminos de clics del relevamiento del marco.
- Si alguna opción no encaja en esta propuesta, se decide el lugar más natural y se informa.

## 7. `GET /citas` sin conexión a la base

En el log apareció `GET /citas TypeError: Cannot read properties of undefined (reading 'query')`, en `routes/citas.routes.ts:123` (`req.db!.query`), justo antes de un reinicio.

- Reproducir con el backend estable. Si no ocurre, confirmar que fue efecto del apagado y anotarlo.
- Si ocurre, encontrar por qué `req.db` no está (orden de los middlewares, transacción ya cerrada por el patrón de respuesta después del COMMIT, o el cambio del 05 en `agenda/citas.ts`) y corregirlo.
- En cualquier caso, que una solicitud sin conexión responda un error claro (503) y no un `TypeError`, y que **el apagado** espere o rechace limpiamente las solicitudes en curso.

## 8. Consultas simultáneas sobre la misma conexión

En el log aparece la advertencia de `pg`: "Calling client.query() when the client is already executing a query is deprecated". Alguna parte del código lanza consultas en paralelo (por ejemplo, `Promise.all`) sobre el mismo cliente de la transacción. Es el mismo tipo de defecto que ya se corrigió una vez.

- **Encontrar todos los casos:** buscar `Promise.all` y similares que usen `req.db` o el cliente de una transacción. Hacer las consultas en secuencia, o con conexiones distintas cuando no deban compartir la transacción.
- Para que no vuelva: una verificación que falle si se detecta esa advertencia durante los verificadores (por ejemplo, convirtiéndola en error en el ambiente de pruebas).

## 9. Ya corregido en el commit `17c1e6d`: solo verificar y blindar

Code ya corrigió el hook condicional de `AtencionActual`, el token que no viajaba en `metricasApi` y la hora UTC de la atención sin turno. Además:
- **Regla `react-hooks/rules-of-hooks` como error** en el build.
- **Un error boundary** en el `AppShell` y otro alrededor de cada pestaña del expediente, con un mensaje y la opción de reintentar en lugar de la página en blanco, registrando el error.
- **El cliente de API envía el token por defecto.** Lo que se declara explícitamente es la ruta pública.
- **Verificar desde la interfaz:** la atención con y sin cita; el dashboard de la clínica y del médico; el resumen del cliente y del paciente; el consumo de un producto; la trazabilidad de un lote y la exportación.

## 10. Flujo de la atención a la caja, sin digitar nada

La expectativa de Miguel es que, cuando el cliente llega a la caja, la cuenta ya esté armada con todo lo que hizo y recetó el médico, y que la cajera **no digite nada**. Hoy eso ya ocurre al **cerrar** la atención (los cargos pasan a la cuenta abierta del cliente por la puerta única). Faltan tres cosas para que el flujo sea realmente fluido:

### 10.1 La caja ve también las atenciones en curso

Si el médico no cerró la atención, la cuenta todavía no existe y la cajera no ve nada. Esto se corrige así:

- En **Caja**, junto a "Cuentas abiertas", aparece la sección **"En atención"**: los pacientes con una atención abierta hoy, con el médico, la hora de inicio y **lo que llevan cargado hasta ahora** (lo realizado y las líneas de receta dispensadas), con su total provisional. Es solo lectura: la caja no puede cobrar una atención abierta.
- La caja tiene un botón **"Avisar al médico"**, que le manda una notificación en la app ("El cliente de Toby está en caja; falta cerrar la atención"). Queda registrado.
- Si una atención lleva abierta más de N minutos (política del 04) con el paciente ya fuera de la consulta, el médico recibe un recordatorio para cerrarla.

### 10.2 Aviso en caja cuando una cuenta queda lista

Al cerrar una atención:
- la cuenta resultante **aparece destacada** al inicio de "Cuentas abiertas" con la marca "Lista para cobrar";
- quien tenga la caja abierta recibe un aviso en la app ("Toby · Ana María Rodríguez · ₡50 705 · lista para cobrar"), con un clic que abre directamente el cobro de esa cuenta.

Los avisos usan el mecanismo de notificaciones existente (regla de la sección 7 de la guía) y tienen su interruptor en la configuración.

### 10.3 Ofrecer en caja lo recetado que no se dispensó

Las líneas de receta **sin** "Se dispensa en la clínica" son medicamentos para comprar afuera. Si el producto existe en el inventario con existencia, es una venta que se puede quedar en la clínica:

- Al abrir el cobro de una cuenta que viene de una atención, la caja muestra **"Recetado y no entregado"**: cada línea con el producto, la cantidad recetada, la presentación sugerida, el precio y la existencia, con el botón **"Agregar"**.
- **Agregar** crea el cargo por la puerta única de caja, con salida de inventario por `registrarMovimiento` (por FEFO o con el lote elegido) y ligado a la línea de receta, que queda marcada como "dispensada en caja". Hay una sola fuente: no se puede agregar dos veces.
- Si el cliente no lo quiere, la cajera marca **"No lo lleva"**. Queda registrado, para medir cuántas recetas se van afuera; este dato lo usarán el 12 y el 16b.
- Una línea en texto libre (un producto que no está en el catálogo) se muestra como informativa, sin el botón Agregar.

**Verificación de este punto:**
- abrir una atención y comprobar que aparece en "En atención" en caja con su total provisional;
- avisar al médico;
- cerrarla y comprobar que la cuenta aparece destacada y que llega el aviso;
- cobrarla agregando desde caja una línea de receta no dispensada, y marcar otra como "No lo lleva";
- confirmar el inventario y que la línea no se pueda agregar dos veces.

---

## Verificación y entrega

El informe incluye, por cada punto:
- lo reproducido;
- la causa;
- la corrección;
- la prueba de regresión;
- **"cómo probarlo"**, con los clics exactos para Miguel con `demo.medico`.

Además:
- la lista del barrido de cambios sin guardar;
- el mapa del menú anterior frente al nuevo, con sus redirecciones;
- dónde estaban las consultas simultáneas.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
