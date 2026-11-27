# Lo que la clínica debe, y cómo se paga

## Para qué sirve

Saber **qué se debe, a quién, cuándo vence y qué se pagó**, sin llevarlo en un cuaderno aparte. Y
pagar sin volver a escribir los datos de una factura que el sistema ya tiene.

## Cuándo se usa

Cada vez que llega una factura de un proveedor y cada vez que se le paga.

## Quién puede usarla

**Verla**: el administrador y el contador (solo lectura). **Registrar pagos**: quien tenga el permiso
*Registrar gastos y pagos a proveedores*, que se puede dar a cualquier rol desde *Roles y permisos*.
**Anular un pago** lleva su propio permiso.

## De dónde sale una cuenta por pagar

No se escribe a mano. Nace de uno de estos dos lugares:

| De dónde | Cuándo |
|---|---|
| **Un comprobante aceptado** en *Facturación › Recibidos* | El proveedor manda su factura electrónica y la clínica la acepta |
| **Una compra recibida** en *Inventario* | La mercadería llegó y la factura todavía no |

En el segundo caso la cuenta queda marcada **sin comprobante electrónico**, y cuando el comprobante
llega se **concilia** con esa cuenta en vez de crear una segunda. Ninguna factura entra dos veces: el
sistema no lo permite.

**El vencimiento** se calcula con los días de crédito del proveedor (su ficha en *Inventario ›
Proveedores*: contado, 15, 30 o 60 días). Si en esta factura el proveedor dio otro plazo, se puede
poner la fecha a mano.

## Paso a paso

**Pagar**

1. *Finanzas › Cuentas por pagar*.
2. En la cuenta, **Pagar**.
3. Se abren **todas las cuentas de ese proveedor** con saldo: poné cuánto va a cada una. Un pago
   puede cubrir tres facturas, que es lo que pasa cuando se manda una transferencia.
4. Elegí el **medio** y, si corresponde, la cuenta bancaria y la referencia.
5. **Registrar el pago.**

**Anular un pago**

Desde la cuenta, en la lista de pagos. Pide el motivo. **La cuenta recupera su saldo sola.**

## Un ejemplo con números

Llega la factura de la distribuidora por **₡100 000**, a 30 días. Se acepta en la bandeja y nace su
cuenta con vencimiento al mes.

Al día siguiente llega otra por **₡60 000**, pero faltaba una caja: se acepta **parcialmente** por
₡45 000. La cuenta muestra las dos cifras —el documento dice 60 000 y lo exigible es 45 000— y se
paga sobre 45 000. El papel del proveedor sigue coincidiendo con lo que el sistema muestra.

El viernes se manda **una transferencia de ₡120 000** que cubre la primera entera y ₡20 000 de la
segunda. La primera queda **pagada** y la segunda **parcial**, con ₡25 000 de saldo.

Si por error alguien intenta aplicar ₡999 999 a esa cuenta, el sistema no lo deja: *«El pago excede
el saldo de la cuenta 0002 en ₡974 999. Una cuenta no se puede pagar por encima de lo que se
debe.»*

## Qué pasa después

- **El saldo no se guarda: se calcula.** Es la suma de lo exigible menos los pagos registrados menos
  las notas de crédito. Por eso anular un pago devuelve el saldo sin que nadie ajuste nada.
- **Un pago en efectivo sale de la caja abierta** y genera su movimiento, para que el arqueo lo
  descuente. El efectivo no se registra en dos lugares. Si no hay caja abierta, el pago no se puede
  registrar así.
- **Una cuenta en dólares se paga en dólares** y se guarda con qué tipo de cambio: es lo que el
  contador necesita para la diferencia cambiaria.
- **Una nota de crédito del proveedor** se carga apuntando a la factura que reduce, y baja su saldo.
  No aparece como una cuenta a pagar, porque no se le debe a nadie.

## Preguntas frecuentes y errores comunes

**«Todas las cuentas de un pago tienen que ser del mismo proveedor».**
Un pago que cruza dos proveedores no es un pago: son dos. Registralos por separado.

**«Para pagar en efectivo hace falta una caja abierta».**
El efectivo sale del cajón y el arqueo tiene que verlo salir. Abrí la caja, o pagá por otro medio.

**Anulé un pago en efectivo y la caja ya estaba cerrada.**
Queda la anulación del pago y el saldo vuelve, pero el efectivo no se reingresa solo: la caja de ese
día ya se contó. Si la caja sigue abierta, el reingreso se registra automáticamente.

**El vencimiento salió para hoy y el proveedor me da 30 días.**
Cargale los días de crédito en su ficha de proveedor. Lo que no tenga días configurados se toma como
contado, que es lo más conservador: una cuenta que vence hoy se ve en la lista.

**Los indicadores suman colones y dólares.**
Sí: para poder mostrar un total, lo que está en dólares se convierte con el tipo de cambio del día.
El **saldo de cada cuenta** sigue estando en su moneda.
