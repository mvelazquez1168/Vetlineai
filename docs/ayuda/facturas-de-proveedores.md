# Las facturas que envían los proveedores

## Para qué sirve

Dos cosas distintas que se resuelven con el mismo archivo:

1. **Aceptar o rechazar cada factura ante Hacienda.** Es lo que habilita usar el IVA que la clínica
   pagó como crédito en su declaración. Si nadie responde, ese IVA se pierde.
2. **Registrar la compra en inventario con el costo exacto.** El XML trae el precio real que pagó
   la clínica, y ese costo es la base de todos los márgenes: sin él, el margen es una estimación.

## Qué es ese XML

Cuando un proveedor factura, emite un **comprobante electrónico**: un archivo `.xml` firmado
digitalmente que Hacienda ya tiene. El PDF que a veces manda al lado es una representación del XML,
no el comprobante. **El que vale es el XML.**

## Cuándo se usa

Cuando llega la factura del proveedor, que normalmente es cuando llega la mercadería. **Hay plazo**:
el sistema avisa antes de que venza.

## Quién puede usarla

Administradores de la clínica. Aceptar o rechazar ante Hacienda compromete la declaración.

## Paso a paso

### Cargar la factura

1. **Facturación electrónica** › **Comprobantes recibidos**.
2. Arrastre el `.xml` o elíjalo con el botón.
3. El sistema comprueba cuatro cosas y las muestra:
   - que el archivo sea un comprobante v4.4 válido;
   - que **la firma digital verifique**;
   - que **el receptor sea la clínica**;
   - que no esté cargado ya (se reconoce por su clave).

### Responderle a Hacienda

1. Abra el comprobante.
2. Elija: **aceptado**, **aceptado parcialmente** o **rechazado**.
3. Si lo acepta, elija la **condición del impuesto** (si genera crédito del IVA, si lo genera
   parcial, o si es un gasto).
4. **Enviar el mensaje**.

### Registrar la compra en inventario

1. En el comprobante, **registrar la entrada a inventario**.
2. Por cada línea del XML, elija **a qué producto y a qué presentación** corresponde. *«Caja x 20»*
   del proveedor es una presentación de compra del producto.
3. Escriba el **lote** y el **vencimiento** donde el producto los exige.
4. **Confirmar**: el stock entra con el costo del XML.

**La próxima factura de ese proveedor llega con las líneas ya reconocidas.** El sistema recuerda la
equivalencia con el código que ese proveedor usa.

### Lo que el contador pide cada mes

**Facturación electrónica** › **Descargar el período**: un zip con los XML emitidos y recibidos del
mes, y la respuesta de Hacienda al lado de cada uno.

## Un ejemplo con números

Llega la factura de Distribuidora del Valle: **4 sacos de alimento renal 10 kg a ₡18 000** y
**2 cajas de jeringas a ₡9 000**. Total ₡90 000.

Se carga el XML. La primera vez hay que decir que «DV-ALM-10K» es el *Alimento medicado renal 10 kg*
del catálogo, presentación *Saco de 10 kg*. Se escribe el lote `LOTE-NOV26` con vencimiento
30/11/2027 y se confirma: entran **4 sacos a ₡18 000 de costo**.

El mes siguiente llega otra factura del mismo proveedor con la misma línea: aparece **ya vinculada**.
Solo se escribe el lote nuevo.

## Qué pasa después

- Lo que la clínica responde queda enviado a Hacienda con la **firma de la clínica**: es un acto
  formal, no una nota interna.
- El stock entra por el mismo camino que cualquier otra entrada, con su **lote** y su **costo**.
- El costo del XML **actualiza el costo del producto**, que es lo que después calcula el margen.
- Un comprobante **no se registra dos veces**: si ya entró, el sistema lo dice.
- La equivalencia proveedor–producto queda guardada para las próximas compras.

## Preguntas frecuentes y errores comunes

**«No se puede aceptar ni rechazar un comprobante que no es de la clínica».**
El receptor del XML es otra identificación. Puede ser que el proveedor mandó el archivo equivocado:
pídaselo de nuevo. Aceptar una factura ajena sería declararle a Hacienda un gasto que no es de la
clínica.

**La firma dice que no verifica.**
El archivo se modificó después de firmarse, o no es el original. No lo responda: pida el XML tal
como lo emitió el proveedor.

**«El elemento raíz no corresponde a ningún comprobante de v4.4».**
Lo que cargó no es un comprobante electrónico: puede ser el PDF renombrado, o un XML de otra cosa.

**Una línea de la factura no existe en mi catálogo.**
Créela como producto y vincúlela. El sistema **no adivina por nombre parecido**: entrar un producto
equivocado al inventario es un faltante de stock que aparece semanas después.

**El proveedor factura una presentación que no tengo cargada.**
Cargue esa presentación en el producto (por ejemplo, *Caja x 20*) y vincule la línea ahí. El sistema
sabe cuántas unidades base tiene cada presentación.

**¿Qué pasa si no respondo a tiempo?**
El plazo se vence y el crédito del IVA de esa factura queda en discusión con Hacienda. El sistema
avisa antes; el plazo que usa es configurable y nace en 8 días desde la emisión.

**El zip no trae los PDF.**
A propósito: los PDF se generan cuando alguien los pide y doscientos PDF harían que la descarga
tarde minutos. El contador necesita los XML, que son los que valen ante Hacienda.
