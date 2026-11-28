# Vetline Clinic — 15b · Fidelización: paquetes prepagados y referidos

> Prompt para Claude Code. Repo: `vetplatform`. Lee antes `docs/prompts/vetline-clinic-00-guia-rectora.md` (secciones 7 y 7.1), el 14 (CRM completo) y el 15a (retención).
> Depende de: 06 Inventario, 07c Acciones clínicas, 08 Caja, 14 CRM, 15a (encuesta NPS y página pública por token). Va **después del 15a**.
> Los precios especiales para criadores y fundaciones quedan fuera de esta fase, pendientes de definir.

## 0. Objetivo

Dos programas:

1. **Paquetes prepagados totalmente paramétricos.** La clínica crea los paquetes que quiera sin tocar código: grooming, vacunas más desparasitaciones, healthcheck, controles de cachorro, dentales, lo que sea. El cliente paga por adelantado y el sistema lleva el saldo, lo descuenta solo al usarlo, avisa y mide si el paquete gana dinero.
2. **Referidos.** Cada cliente tiene un código; cuando alguien nuevo llega con él, ambos reciben el beneficio que la clínica configure, y el CRM registra quién trajo a quién y cuánto generó.

Reglas comunes de la guía: notificaciones por el mecanismo existente (`emitirNotificacion`, `puedeEnviar()`), consentimientos y tope de frecuencia, eventos en la línea de tiempo con `registrarInteraccion`, cargos con `agregarCargo`, inventario con `registrarMovimiento`, margen mínimo, textos de usted, `useCambiosSinGuardar`, manual de usuario. Mensajería simulada y sin Converza; en desarrollo, nunca envíos reales.

---

# Parte A — Paquetes prepagados

## A1. Plantillas de paquete (el catálogo que arma la clínica)

Pantalla Administración › Fidelización › Paquetes, con un constructor de paquetes. Cada **plantilla** define:

- **Identidad:** nombre, descripción para el cliente, categoría (grooming, preventivo, healthcheck, dental, cachorro, senior, otra; las categorías son una lista editable), imagen o color opcional, código interno.
- **Componentes:** una o más líneas, cada una con:
  - **qué cubre:** un producto o servicio específico del catálogo, **o** "cualquiera de un grupo" (por ejemplo, cualquier vacuna de una lista elegida, o el baño del tamaño que corresponda a la mascota);
  - **cantidad** (sesiones o unidades);
  - **intervalo mínimo entre usos**, opcional (por ejemplo, desparasitación cada 30 días: no se puede usar dos veces en la misma semana);
  - **calendario sugerido**, opcional (por ejemplo, vacunas a las 8, 12 y 16 semanas de edad, o una desparasitación por mes): genera los recordatorios y, si se activa, las propuestas de cita;
  - **valor de referencia por unidad**, para reconocer el ingreso al consumir y calcular reembolsos (por defecto, el precio de lista prorrateado con el descuento del paquete; editable).
- **Precio:** fijo, o calculado como la suma de los componentes a precio de lista menos un porcentaje de descuento. La pantalla muestra siempre el precio de lista, el ahorro para el cliente, el costo estimado de los componentes y el margen resultante. Si queda por debajo del margen mínimo, se exige la autorización de dirección.
- **Beneficios adicionales mientras esté vigente**, opcionales: por ejemplo, 10 % en alimento o en otro servicio, aplicados automáticamente en caja.
- **A quién aplica:** a una mascota, compartido entre las mascotas del mismo cliente, o a cualquier mascota del cliente; restricciones opcionales por especie, edad o etapa de vida, tamaño o peso (para grooming) y sede.
- **Vigencia:** N días o meses **desde la compra** o **desde el primer uso**.
- **Al vencer**, según la política elegida: se pierde lo no usado, se convierte en crédito a favor por su valor de referencia (total o parcial), o se concede un período de gracia.
- **Reglas de venta:** activa o no, ventana de venta (fechas de una promoción), cupo máximo de ventas, si se puede vender desde la atención, si permite congelar, si permite transferir a otra mascota o cliente, y política de cancelación (reembolso del valor no consumido menos un cargo porcentual, o sin reembolso).
- **Facturación:** código CABYS y tarifa de IVA por componente; **momento de facturación configurable** por la clínica: al vender el paquete (como anticipo) o al consumir cada sesión. Marca visible en la configuración: "Confirme esta opción con su contador".

Duplicar una plantilla, desactivarla y versionarla: un cambio de precio o componentes crea una versión nueva; los paquetes ya vendidos conservan las condiciones con que se compraron.

Datos de demostración (como plantillas de ejemplo editables):

- **Grooming 5 baños** (perro mediano, vigencia 6 meses, compartido entre mascotas del cliente).
- **Preventivo cachorro**: 3 vacunas del grupo de vacunas de cachorro con calendario a las 8, 12 y 16 semanas, más 6 desparasitaciones mensuales; vigencia 8 meses; una mascota; especie perro.
- **Healthcheck senior**: consulta, hemograma, química sanguínea, urianálisis y radiografía de tórax, para usar en 30 días desde el primer uso; mascotas de 7 años o más.

## A2. Venta

- Se vende en **caja** como una línea más, y opcionalmente desde la **atención** (el médico lo recomienda y lo agrega; llega armado a caja, como el resto).
- Al venderlo se elige la mascota (o el cliente, si es compartido) y se valida que cumpla las restricciones.
- La venta crea el **paquete del cliente** con su saldo por componente, la fecha de vencimiento y, si tiene calendario, las fechas sugeridas.
- El cobro sigue el flujo normal de caja (`agregarCargo`, medios de pago, comprobante según el momento de facturación configurado).
- El cliente recibe un mensaje de servicio con el detalle: qué incluye, cuánto le queda y hasta cuándo.

## A3. Consumo automático

- Cuando en la atención, en grooming o en caja aparece un ítem cubierto por un paquete vigente de ese cliente o mascota, el sistema lo detecta y propone **"Usar del paquete"** (activado por defecto). La línea queda a ₡0 con la referencia al paquete; quien atiende puede desmarcarlo si el cliente prefiere pagarlo aparte.
- Si hay más de un paquete que lo cubre, se usa primero el que vence antes.
- El inventario se mueve igual que siempre: una vacuna del paquete sale del inventario con su lote por `registrarMovimiento`.
- Se respeta el intervalo mínimo entre usos; si no se cumple, se avisa y se puede autorizar con permiso.
- Cada consumo descuenta el saldo, reconoce el ingreso por el valor de referencia y deja un evento en la línea de tiempo.
- Si el paquete se agota con ese uso, se ofrece la renovación en el mismo momento.

## A4. Visibilidad

- **Ficha del cliente y cabecera del paciente:** insignia con el saldo ("Grooming: quedan 3 de 5 · vence 15 may").
- **Agenda:** la cita de un servicio cubierto muestra que tiene paquete.
- **Caja:** los paquetes vigentes del cliente a la vista al abrir su cuenta.
- **Pantalla de paquetes vendidos:** filtros por plantilla, estado (vigente, agotado, vencido, congelado, cancelado), vencimiento y sede; detalle de cada paquete con su historial de consumos.

## A5. Operaciones sobre un paquete vendido

Con permisos y motivo registrado:

- **Congelar** por un período (viaje o enfermedad de la mascota): la vigencia se extiende lo mismo.
- **Extender vigencia.**
- **Transferir** a otra mascota o a otro cliente, si la plantilla lo permite.
- **Cancelar** con el reembolso que calcule la política (valor de referencia de lo no consumido menos el cargo), como nota de crédito, devolución o crédito a favor.
- **Ajustar el saldo**, solo con `paquetes.ajustar` y motivo, como asiento auditable.

## A6. Avisos (tipos nuevos del mecanismo de notificaciones)

- Saldo bajo (configurable, por ejemplo, cuando queda 1).
- Paquete por vencer con sesiones sin usar (por ejemplo, 15 días antes).
- Sesión programada próxima según el calendario (por ejemplo, "Le toca la desparasitación de este mes a Luna") con enlace para agendar.
- Paquete agotado, con la oferta de renovación.

Todos son mensajes de servicio, con interruptor y plantilla editable, y no se envían a mascotas fallecidas ni a clientes en duelo (15a).

## A7. Contabilidad y finanzas

- Lo cobrado y no consumido es un **pasivo**: "Paquetes por consumir". El ingreso se reconoce al consumir, por el valor de referencia; lo vencido se reconoce según la política (ingreso por vencimiento o crédito a favor).
- Integración con 10a y 10b:
  - saldo del pasivo a una fecha;
  - ingreso reconocido por consumo y por vencimiento;
  - **rentabilidad por plantilla**: precio cobrado contra costo real de lo consumido, más los beneficios adicionales otorgados.
- Métricas en el diccionario del 12: paquetes vendidos, tasa de consumo, tasa de vencimiento sin uso, renovación, margen por plantilla, ingreso adicional de clientes con paquete contra sin paquete.

---

# Parte B — Referidos

## B1. Configuración del programa

Administración › Fidelización › Referidos:

- interruptor del programa;
- **beneficio para quien refiere** y **beneficio para el referido**, cada uno de un tipo: crédito a favor en colones, descuento porcentual en un servicio o línea, un servicio gratis, una sesión extra en un paquete vigente, o ninguno;
- **condición para calificar**: primera visita pagada, con un monto mínimo opcional, dentro de N días desde que se registró el código;
- **vencimiento** del beneficio otorgado;
- **tope** de referidos premiados por cliente al año;
- formato del código (por defecto, nombre más 4 dígitos, como LAURA-4821) y texto del mensaje para compartir.

## B2. Código y enlace

- Cada cliente tiene un código único y un enlace. El enlace abre una página pública (la infraestructura por token del 15a) con la marca de la clínica, sus datos, el beneficio para el nuevo cliente y los botones para llamar, escribir o agendar; guarda el código para cuando el cliente llegue.
- El código se ve en la ficha del cliente, y la clínica puede enviarlo con un mensaje ("Comparta su código…"); la invitación automática a los promotores de la encuesta NPS del 15a puede incluirlo (configurable).

## B3. Registro del referido

- Al crear un cliente nuevo, en "¿Cómo nos conoció?" (la fuente de referencia del anexo B) la opción **"Referido por un cliente"** pide el código o permite buscar al cliente que lo refirió.
- Validaciones: el referido debe ser un cliente **nuevo de verdad** (la detección de duplicados por cédula, teléfono y correo del anexo B decide); no puede referirse a sí mismo ni a alguien con el mismo teléfono o dirección (configurable); se respeta el tope anual del que refiere.
- Estado del referido: `pendiente` → `calificado` → `premiado` | `vencido` | `rechazado` (con motivo).

## B4. Otorgamiento del beneficio

- Cuando el referido cumple la condición, el referido pasa a calificado y **ambos beneficios se otorgan automáticamente**.
- El **crédito a favor** queda como saldo del cliente, visible en la ficha y en caja, y se aplica como medio de pago; es un pasivo de la clínica hasta usarse o vencer.
- Los descuentos y servicios gratis quedan como beneficios pendientes que caja aplica al cobrar el servicio correspondiente.
- Quien refirió recibe un mensaje de servicio: "Gracias: [nombre] llegó con su código y ya tiene su beneficio".
- Todo deja su evento en la línea de tiempo de ambos clientes.

## B5. Reportes

- Embajadores: quién trajo a quién y cuánto ha generado cada referido a 12 meses ("Laura trajo 4 clientes que suman ₡620 000").
- Conversión: códigos registrados, calificados, premiados y vencidos.
- Costo del programa (beneficios otorgados y usados) contra el ingreso generado por los referidos.
- Alertas de posible abuso: muchos referidos de un mismo cliente en poco tiempo, o referidos que solo vinieron una vez a cobrar el beneficio.
- Métricas en el diccionario del 12; disponibles para el asesor del 16b.

---

## C. Permisos

Desde la base (04): `paquetes.configurar`, `paquetes.vender`, `paquetes.congelar_extender`, `paquetes.transferir`, `paquetes.cancelar`, `paquetes.ajustar`, `referidos.configurar`, `referidos.gestionar`.

## D. Datos de demostración

- Las tres plantillas de ejemplo.
- Paquetes vendidos en distintos estados (vigente con consumos, por vencer, agotado con renovación, congelado, cancelado con reembolso).
- Un cliente con dos referidos premiados y uno pendiente.
- Un crédito a favor usado en caja.

## E. Manual de usuario

`docs/ayuda/paquetes-prepagados.md` y `docs/ayuda/referidos.md`, con el estándar de la guía: para qué sirve, cuándo, quién, paso a paso (crear una plantilla, venderla, consumirla, congelarla, cancelarla), ejemplos con números (un paquete de 5 baños por ₡40 000 con precio de lista ₡50 000: valor de referencia por baño ₡8 000, pasivo inicial ₡40 000, cuánto queda tras 3 baños y qué pasa si vence con 2 sin usar; un referido que califica con su primera consulta), qué pasa después, preguntas frecuentes y glosario (valor de referencia, pasivo, crédito a favor, calificar).

## F. Verificación y entrega

- Tests:
  - consumo automático y elección del paquete que vence antes;
  - intervalo mínimo;
  - restricciones por especie, edad y tamaño;
  - versión de plantilla que no altera paquetes vendidos;
  - congelar extiende la vigencia;
  - reembolso calculado por la política;
  - pasivo e ingreso reconocido cuadran con lo cobrado;
  - referido duplicado rechazado;
  - tope anual;
  - beneficio otorgado una sola vez;
  - crédito a favor aplicado en caja;
  - aislamiento entre tenants.
- Capturas en la bitácora: constructor de plantillas, venta en caja, consumo en la atención, insignia en la cabecera del paciente, reporte de rentabilidad por plantilla, página pública del enlace de referido, reporte de embajadores.
- En la bitácora, cómo probarlo en el navegador paso a paso.

## G. Límites

- Sin envíos reales en desarrollo; sin conexión con Converza.
- El momento de facturación de los paquetes queda configurable y marcado para validar con el contador.
- Nada a producción; nada a `main` sin revisión.
