# Los gastos de la clínica

## Para qué sirve

Saber en qué se gastó el mes: el alquiler, la luz, la planilla, el laboratorio externo. Y que el
contador pueda distinguir lo que tiene factura de lo que no.

## Cuándo se usa

Cuando llega un recibo que **no es inventario**, y una vez al mes para los gastos fijos.

## Quién puede usarla

Ver, el administrador y el contador. Registrar, quien tenga el permiso *Registrar gastos y pagos a
proveedores*.

## Las dos maneras de registrar un gasto

| Caso | Camino | Qué hay que escribir |
|---|---|---|
| **Tiene comprobante electrónico** (luz, internet, mantenimiento, publicidad) | *Facturación › Recibidos* › **Registrar como gasto** | Solo la **categoría** |
| **No tiene comprobante** (planilla, pago a una persona física) | *Finanzas › Gastos* › **Registrar un gasto** | Fecha, categoría, descripción y monto |

En el primer caso **no se retipea nada**: el monto, la fecha, el emisor y el número salen del
comprobante que ya está en la bandeja. Y la **categoría se sugiere** con la del último gasto de ese
proveedor: el segundo recibo de la luz ya viene clasificado.

El segundo caso queda marcado **sin comprobante**, que es el dato que el contador necesita: eso no
se puede deducir.

## Los gastos fijos de cada mes

1. *Finanzas › Gastos* › **Generar los recurrentes del mes**.
2. Cada gasto recurrente activo genera su gasto **estimado** con el monto esperado.
3. Cuando llega el comprobante real, en ese gasto: **Conciliar**, y se ajusta el monto.

**No nace un segundo gasto.** Es el punto: sin esa conciliación el alquiler aparecería dos veces
todos los meses y el total del mes mentiría.

## Un ejemplo con números

El alquiler se define como recurrente por **₡400 000**, el día 1.

El 1.° de diciembre se generan los recurrentes: aparece un gasto **estimado** de ₡400 000. El total
del mes ya lo incluye, que es lo que se quiere —el alquiler se va a pagar igual—.

El 5 llega la factura de la inmobiliaria por **₡420 000** porque subió. Se concilia: el mismo gasto
pasa a **real** por ₡420 000. Sigue habiendo **un** gasto de alquiler en diciembre.

El recibo de la luz de ₡85 000 entra desde la bandeja, con **Electricidad** sugerida, y genera su
cuenta por pagar porque todavía no está pagado. El mes cierra con ₡505 000 de gastos, de los cuales
₡0 sin soporte fiscal… hasta que se registra la planilla, y ahí el indicador *Sin soporte fiscal*
muestra ese monto.

## Qué pasa después

- Si el gasto **no vino pagado**, genera su **cuenta por pagar** y aparece en *Cuentas por pagar* con
  su vencimiento.
- Cada gasto puede asignarse a una **línea de negocio** cuando es directo (el champú de grooming va a
  grooming) o quedar como **general**. El estado de resultados por línea usa esa asignación.
- El resumen del mes se compara contra el mes anterior y se agrupa por categoría.

## Preguntas frecuentes y errores comunes

**«Ese comprobante ya entró al inventario como compra. Una compra no es un gasto».**
Lo que entró al inventario es un **activo**: se convierte en costo cuando se vende. Contarlo también
como gasto duplicaría la salida de plata.

**«Ese comprobante ya estaba registrado como gasto».**
Un comprobante genera un solo gasto. Si la categoría quedó mal, editá el gasto en vez de volver a
clasificarlo.

**«El gasto necesita una descripción».**
Porque «otros ₡80 000» no se puede auditar tres meses después.

**No encuentro la categoría que usa mi clínica.**
Vienen trece y se pueden agregar las propias. Un gasto que cae siempre en «Otros» es un gasto que no
se puede analizar.

**Puse un recurrente el día 31 y no lo deja.**
El día va de 1 a 28, para que exista en febrero. Un recurrente el 31 se saltearía un mes al año.
