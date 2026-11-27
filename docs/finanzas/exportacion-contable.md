# La exportación para el contador — columnas fijas

Prompt 10a, sección 6. Las columnas de cada archivo **son fijas y están documentadas acá**: un
contador que recibe un archivo con columnas distintas cada mes tiene que volver a armar su plantilla
cada mes.

Se descarga desde **Finanzas › Para el contador**, eligiendo el período. Cada cuaderno sale en Excel
(`.xlsx`) y en PDF. El archivo lo arma el **backend**, con los mismos filtros y el mismo alcance de
clínica que la consulta de la pantalla: un CSV armado en el navegador exportaría solo lo que la
pantalla tenía cargado.

---

## 1. Ventas (comprobantes emitidos)

Todo lo que la clínica emitió en el período, en cualquier estado de Hacienda.

| Columna | Qué es | De dónde sale |
|---|---|---|
| Fecha | Fecha de emisión | `fact_comprobantes.fecha_emision` |
| Tipo | Código del tipo de comprobante (01 factura, 02 nota de débito, 03 nota de crédito, 04 tiquete…) | `tipo_comprobante` |
| Consecutivo | El consecutivo de 20 dígitos | `consecutivo` |
| Clave | La clave de 50 dígitos | `clave` |
| Cliente | Nombre del receptor | `receptor_nombre`, o el nombre del cliente si el comprobante lo tiene vinculado |
| Identificación | Cédula o DIMEX del receptor | `receptor_numero_identificacion` |
| Condición | Código de condición de venta (01 contado, 02 crédito…) | `condicion_venta` |
| Moneda | CRC o USD | `moneda` |
| Subtotal | Total menos IVA | calculado |
| IVA | Impuesto del comprobante | `total_impuesto` |
| Total | Total del comprobante | `total_comprobante` |
| Estado en Hacienda | aceptado, aceptado_parcial, rechazado, enviado, en_cola… | `estado` |

> **Un comprobante rechazado por Hacienda también sale**, con su estado. No se filtra: el contador
> necesita verlo para saber que existe y que hay que reemplazarlo.

## 2. Compras y gastos

Las dos cosas en **un** archivo, con la columna *Origen* para distinguirlas. Van juntas porque el
total que salió de la clínica es la suma de las dos, y en dos archivos hay que cruzarlas a mano.

| Columna | Qué es |
|---|---|
| Fecha | Del gasto, o de emisión del comprobante de compra |
| Origen | **Gasto** (lo que no es inventario) o **Compra** (lo que entró al inventario) |
| Proveedor | Nombre del proveedor o del emisor del comprobante |
| Identificación | Cédula del proveedor |
| Documento | Consecutivo del comprobante, o la descripción si no tiene comprobante |
| Categoría | La categoría del gasto, o «Inventario» para una compra |
| Línea de negocio | Cuando el gasto es directo a una línea (el champú de grooming va a grooming). Vacío = general |
| Moneda | CRC o USD |
| Monto | Lo que salió |
| IVA | El impuesto del comprobante, cuando tiene |
| Soporte fiscal | **Comprobante electrónico** o **Sin comprobante electrónico** |

> La última columna es la importante: lo que dice **Sin comprobante electrónico** no se puede
> deducir. Son la planilla, los pagos a personas físicas sin factura y los gastos con solo un
> respaldo interno. El archivo lo lleva como aviso impreso, porque el contador recibe el archivo y
> no vio la pantalla.

## 3. Pagos a proveedores

| Columna | Qué es |
|---|---|
| Fecha | Del pago |
| Proveedor | A quién se le pagó |
| Medio | transferencia, sinpe, cheque, efectivo, tarjeta |
| Cuenta | La cuenta bancaria de la clínica de la que salió |
| Referencia | N.º de transferencia, de cheque, de recibo |
| Moneda | CRC o USD |
| Monto | Lo pagado |
| Tipo de cambio | Con qué tipo de cambio se pagó, cuando fue en dólares. Es lo que permite ver la **diferencia cambiaria**: la cuenta nació a un tipo y se pagó a otro |
| Documentos pagados | Los números de factura que cubre ese pago, separados por coma |
| Estado | registrado o **anulado** |

> **Los pagos anulados salen igual**, con su estado. Un pago que desaparece del archivo es un pago
> que el contador ya asentó y no puede reconciliar.

## 4. Cobros

Una fila **por medio de pago**, no por cobro: un cobro mitad efectivo y mitad tarjeta son dos filas.
Es lo que hace que el archivo cuadre con el banco.

| Columna | Qué es |
|---|---|
| Fecha | Del cobro |
| Cliente | Quién pagó |
| Medio | efectivo, tarjeta, sinpe, transferencia, crédito… |
| Moneda | CRC o USD |
| Monto | En la moneda del cobro |
| Monto en colones | Convertido con el tipo de cambio de ese día |
| Referencia | N.º de SINPE, de voucher |
| Comprobante | El consecutivo de la factura, cuando el cobro la tiene |
| Estado | aplicado o anulado |

## 5. Movimientos de inventario valorizados

| Columna | Qué es |
|---|---|
| Fecha | Del movimiento |
| Producto | Nombre del producto |
| Motivo | compra, venta, ajuste, merma, vencimiento, uso en atención… |
| Cantidad | En unidad base, con signo: negativo es salida |
| Costo unitario | El costo del movimiento |
| Valor | Cantidad × costo unitario |
| Bodega | De qué bodega salió o a cuál entró |

> Esta es la tabla con la que se arma el **costo de ventas** del período. El valor sale del costo
> registrado en el movimiento, no de un recálculo: el costo de un producto cambia con el tiempo y
> cada movimiento se valoriza con el que tenía ese día.

---

## Lo que no se construyó, y qué haría falta

**El formato de importación de un software contable específico.** Cada paquete contable
—ContaCR, Monica, QuickBooks, Odoo— importa con su propio diseño: nombres de columna exactos,
códigos de cuenta contable propios y un orden fijo. Para generar uno de esos haría falta:

1. **saber cuál usa el contador**, y la versión;
2. **un mapa de cuentas**: qué número de cuenta contable corresponde a cada categoría de gasto, a
   cada línea de negocio y a cada medio de cobro. Ese mapa es del contador, no del sistema, y
   tendría que poder configurarse por clínica;
3. decidir si la exportación arma **asientos** (débito y crédito por cuenta) o deja los documentos y
   que el paquete los asiente. Lo primero es más trabajo y más útil; lo segundo no se puede
   equivocar.

Mientras eso no exista, un Excel con estas columnas es lo que un contador puede usar hoy: copia las
columnas que necesita a su plantilla y asienta.

**La carga automática del estado de cuenta bancario** tampoco se construyó (sección 5 del prompt).
La tabla de conciliaciones está preparada: el día que exista, lo que hará es llenar esas mismas
filas en vez de que alguien las marque a mano.
