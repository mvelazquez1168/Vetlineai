# Descuentos: topes y motivos

## Para qué sirve

Que quien cobra pueda dar un descuento razonable sin pedir permiso, que uno grande necesite
autorización, y que el comprobante electrónico salga con el código que Hacienda exige **sin que
nadie en el mostrador tenga que conocer esos códigos**.

## Cuándo se usa

Cada vez que se descuenta algo: en el cobro, en una cotización o en una atención.

## Quién puede usarla

Todos descuentan, cada uno hasta su tope. Un administrador **autoriza** por encima del tope de
otros.

## Cómo se decide el tope

Hay tres topes y **vale el menor de los tres**:

| Tope | Dónde se configura | Para qué |
|---|---|---|
| **Del producto o servicio** | Inventario › el producto o el servicio | Un saco de alimento con 4 % de margen no admite un 10 % de descuento |
| **Del rol** | Caja › Configuración | Médico 10 %, administrador sin tope |
| **General de la clínica** | Caja › Configuración | El techo de todos |

> Es **el menor** y no «el más específico». Si la clínica puso un techo del 15 % y alguien carga un
> producto con tope del 50 %, el 15 % sigue valiendo: un tope que se puede agrandar desde la ficha
> de un producto no es un tope.

## Paso a paso

1. En la línea, escriba el **descuento**.
2. Elija el **motivo** de la lista: cliente frecuente, promoción vigente, campaña de temporada,
   descuento comercial, compra por volumen, muestra o bonificación, cortesía de la clínica, rescate
   o albergue.
3. Si pasa su tope, el sistema lo dice y hay que **pedir autorización**: un administrador la da ahí
   mismo, o queda una solicitud pendiente que resuelve después desde la campana.

## Un ejemplo con números

Un saco de alimento de **₡25 000**. El médico quiere descontar **₡2 500** (10 %).

Su rol le permite 10 %... pero ese producto tiene tope de **4 %**, así que el máximo real es
**₡1 000**. El sistema lo dice con esas palabras: *«El descuento es del 10,0 % y el máximo de ese
producto o servicio es 4 %. Pedí autorización»*.

Con la autorización de la administradora, el descuento de ₡2 500 pasa, y queda registrado que ella
lo autorizó.

Con el motivo **cliente frecuente**, la factura sale con el **código 08** en ese descuento, que es
«descuento por frecuencia» en la tabla de Hacienda. Nadie tuvo que saber eso.

## Qué pasa después

- Queda registrado **cuánto**, **por qué motivo**, **quién lo aplicó** y **quién lo autorizó**.
- El comprobante sale con el **código oficial** del motivo. Los motivos que caen en «otros
  descuentos» (código 99) llevan además su texto, porque un 99 sin explicar no se puede justificar.
- Dos motivos —**cortesía** y **rescate o albergue**— piden autorización **siempre**, sin importar
  el monto: una cortesía no la decide quien cobra.

## Preguntas frecuentes y errores comunes

**«No se puede autorizar el propio descuento».**
Quien lo aplica no se autoriza a sí mismo, igual que con las anulaciones de caja: si no, «pedir
autorización» sería apretar dos botones.

**«Esa persona no tiene permiso para autorizar descuentos».**
Solo autoriza quien tiene el permiso en **Caja › Configuración**. El administrador de la clínica lo
tiene por omisión.

**Un descuento del 1 % me pide autorización.**
Revise el motivo: *cortesía* y *rescate o albergue* la piden siempre. Si no corresponde, elija el
motivo real.

**No aparece el motivo que usa mi clínica.**
Los que trae el sistema cubren los códigos oficiales. Se pueden agregar motivos propios, y cada uno
se mapea a uno de esos códigos: el código es de Hacienda y no se inventa.

**Quiero descontar sobre el total y no línea por línea.**
El descuento es por línea, porque así lo pide el comprobante electrónico: cada línea declara su
descuento con su código.
