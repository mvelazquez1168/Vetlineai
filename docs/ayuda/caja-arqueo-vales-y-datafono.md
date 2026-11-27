# Cerrar la caja: conteo, vales y datáfono

## Para qué sirve

Que el cierre de caja explique la diferencia en vez de solo mostrarla: contar el efectivo billete
por billete, dejar registrados los vales de caja con quién recibió la plata, y comparar lo que el
sistema cobró con tarjeta contra el lote que imprime el datáfono.

Y que todo eso salga en un papel que se firma, porque la caja cambia de manos.

## Cuándo se usa

Al cerrar el turno. El **comprobante del cierre** se puede bajar también con la caja abierta, para
contar antes de cerrar.

## Quién puede usarla

Quien tiene la caja abierta. La **configuración** —qué billetes se cuentan, cuánto cobra el banco—
es de un administrador.

## Paso a paso

### Contar el efectivo billete por billete

1. **Caja** › **Cerrar con arqueo**.
2. En **Conteo por denominación**, escriba **cuántos** billetes y monedas hay de cada valor.
3. El total se calcula solo, y **el campo del efectivo declarado se bloquea**: sale de esta suma.

> Si prefiere escribir solo el total, no complete el conteo. La clínica elige cuál de las dos formas
> es la predeterminada en **Caja › Configuración**.

### Un vale de caja

1. **Caja** › **Movimiento de efectivo**.
2. Elija **Gasto de caja chica** (o el retiro que corresponda), el **monto** y el **motivo**.
3. **Quién recibió la plata**: alguien del personal, de la lista; o **escriba el nombre** si es de
   afuera (la mensajería, el ferretero).
4. **Registrar**.

El vale baja el efectivo esperado del arqueo y sale en el comprobante del cierre, con el nombre de
quien lo recibió.

### El lote del datáfono

1. En el cierre, **Lote del datáfono** › **+ Agregar línea**.
2. Copie lo que imprime el papel: **banco**, **tipo de tarjeta**, **cuántas transacciones**, el
   **monto** y el **número de lote**.
3. Si carga el lote, **el declarado de tarjeta sale de esa suma**, igual que con las
   denominaciones.

### El comprobante del cierre

**Comprobante del cierre** baja un PDF con el arqueo, el conteo billete por billete, los vales, las
tarjetas contra el lote y **dos líneas de firma**: quien entrega y quien recibe.

## Un ejemplo con números

El turno cerró con **₡182 500 esperados en efectivo**. La cajera cuenta: 8 billetes de ₡10 000,
20 de ₡5 000, 2 de ₡1 000 y ₡500 en monedas → **₡182 500**. No hay diferencia y no hay nada que
justificar.

En tarjetas el sistema dice **₡340 000**; el datáfono imprime **12 transacciones por ₡338 000**. La
diferencia de **₡2 000** aparece en el cierre y hay que justificarla: revisando cobro por cobro,
aparece una venta cobrada como tarjeta que en realidad se pagó por SINPE.

Con la comisión de BAC crédito al **3,25 %**, el comprobante dice que de esos ₡338 000 el banco va a
retener **₡10 985**: el depósito va a llegar por **₡327 015** y no por el total cobrado.

## Qué pasa después

- El conteo, los vales y el lote **quedan guardados con el cierre** y salen en su comprobante.
- Cada diferencia lleva **su justificación**; si la diferencia total pasa el umbral de la clínica, la
  caja no cierra hasta que un administrador lo apruebe.
- Cada cobro con tarjeta guarda **su comisión y el neto esperado** con la comisión vigente **de ese
  día**: si el banco renegocia después, los cobros viejos no cambian.
- La comisión es el **costo financiero** que después usa la rentabilidad.

## Preguntas frecuentes y errores comunes

**No me deja escribir el efectivo declarado.**
Porque hay un conteo por denominación cargado, y el declarado sale de ahí. Para volver a escribirlo
a mano, use **Borrar el conteo de CRC y volver a declarar el total a mano**.

**El billete que recibo no está en la lista.**
Se agrega en **Caja › Configuración › Billetes y monedas del arqueo**. Las que trae el sistema son
la emisión vigente del BCCR; la clínica puede agregar o quitar.

**La conciliación de tarjetas muestra «sin banco» y la diferencia entera.**
Son cobros hechos antes de que existiera esta función, que no tienen banco cargado: no se pueden
comparar línea por línea. Mire la fila **Total de tarjetas**, que sí es comparable siempre. El
comprobante dice cuántos cobros están en ese caso.

**El cobro con tarjeta no muestra comisión.**
La clínica no cargó la comisión de ese banco y tipo de tarjeta, o el cobro no dice de qué banco es.
El sistema **no inventa un porcentaje**: una comisión supuesta ensuciaría la rentabilidad con un
costo que nadie cobró.

**¿El vale necesita el respaldo escaneado?**
No es obligatorio. Lo que sí queda es quién lo recibió, quién lo registró y el motivo, que es lo
que se firma.
