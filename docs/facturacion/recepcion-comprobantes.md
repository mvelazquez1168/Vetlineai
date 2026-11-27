# Recepción de comprobantes de proveedores: cómo entra el XML

Documento de diseño. Lo pide el prompt 09b, B2: la carga manual se construyó y **el buzón de
correo automático no**, así que acá queda escrito cómo se haría y qué decisiones hay que tomar
antes.

Fecha: 27 de noviembre de 2026.

---

## 1. Lo que está construido: la carga manual

**Pantalla:** Facturación electrónica › Comprobantes recibidos. Se arrastra el `.xml` o se elige
con el botón.

**Qué pasa con cada archivo** (`facturacion/recibidos.ts`, `recibirComprobante`):

1. Se lee la **clave** y se exige que tenga 50 caracteres: sin eso no es un comprobante
   costarricense y no se sigue.
2. Se identifica el **tipo** por el elemento raíz y se valida contra el **XSD oficial** de ese tipo.
   Una validación fallida **no rechaza la carga**: queda guardada con su motivo, porque un
   proveedor puede mandar algo mal y la clínica necesita verlo para reclamarle.
3. Se verifica la **firma digital** (`verificarFirma`). Tres resultados distintos: válida, inválida,
   o *no se pudo comprobar* —un XML sin nodo de firma—. Los tres se guardan y la bandeja los
   muestra distinto.
4. Se comprueba que el **receptor sea la clínica**, comparando la identificación del bloque
   `Receptor` contra la del emisor configurado. Si no es, se marca y **responderlo se bloquea**.
5. Se calcula **hasta cuándo se puede responder**, desde la fecha de emisión del comprobante.
6. Se guarda con `ON CONFLICT (emisor_id, clave)`: cargar el mismo archivo dos veces **no lo
   duplica** y no pisa el XML original; solo refresca la validación, porque el XSD con el que se
   valida puede haber cambiado.

**Lo que la carga manual no resuelve:** alguien tiene que acordarse de pedirle el XML al proveedor
y cargarlo. Es el trabajo que el buzón elimina.

---

## 2. El buzón de correo: cómo se haría

La idea: una dirección a la que los proveedores mandan sus facturas y que el sistema lee solo.

### 2.a. Qué dirección

Tres opciones, y la tercera es la que recomendaría:

| Opción | A favor | En contra |
|---|---|---|
| Una dirección por clínica en **nuestro** dominio (`facturas-mascotitas@vetlineai.com`) | la clínica no configura nada | somos responsables de un buzón por clínica; si una clínica se va, su correo sigue llegando |
| Una dirección **de la clínica** que ella reenvía a la nuestra | la clínica controla su dirección | depende de que configure un reenvío, y cuando falla no se nota hasta el cierre del mes |
| Una dirección por clínica en nuestro dominio **con alias derivado del tenant** y verificación del remitente | único buzón técnico, sin cuentas por clínica | hay que resolver qué pasa con un correo que llega a un alias que ya no existe |

### 2.b. Cómo se lee

No con IMAP contra una casilla. Con un **webhook entrante** del proveedor de correo: Resend —que es
el que el sistema ya usa para enviar— tiene recepción por webhook, y así no hay un proceso
sondeando una casilla cada cinco minutos ni credenciales de correo guardadas.

El webhook llega con el remitente, el asunto y los adjuntos. El flujo sería:

1. **Identificar la clínica** por el alias al que llegó. Un alias desconocido no se procesa: se
   registra y se descarta, porque intentar adivinar la clínica por el remitente es adivinar.
2. **Tomar los adjuntos `.xml`** y pasarlos por el **mismo** `recibirComprobante` que usa la carga
   manual. Ese es el punto: la interfaz ya está, y el buzón es otra entrada al mismo camino, no un
   segundo camino.
3. **Guardar el correo entero** —remitente, asunto, cuerpo— junto a los comprobantes que trajo:
   cuando un proveedor mande algo que no se pudo procesar, la clínica tiene que poder ver qué
   llegó.
4. **No responder nada automáticamente.** La aceptación ante Hacienda la decide una persona: un
   buzón que acepta solo lo que le llega firmaría declaraciones sin que nadie las mire.

### 2.c. Lo que hay que decidir antes de construirlo

1. **Qué se hace con un correo sin XML.** Un proveedor que manda solo el PDF es el caso más común.
   ¿Se guarda y se avisa? ¿Se contesta pidiendo el XML?
2. **Qué se hace con un XML que no es de esa clínica.** Hoy la carga manual lo marca y bloquea la
   respuesta. Por buzón, además, conviene avisar al remitente.
3. **El volumen.** Un proveedor que manda cien facturas en un correo es legítimo; el webhook tiene
   límite de tamaño y hay que decidir qué pasa cuando se pasa.
4. **El spam.** Una dirección publicada recibe spam. Sin verificación del remitente contra los
   proveedores del catálogo, la bandeja se llena de basura.

### 2.d. Lo que ya está listo para que esto entre

`recibirComprobante(db, tenantId, emisorId, xml)` no sabe de dónde viene el XML. El buzón no
necesita tocar nada de la validación, la firma, el receptor, el plazo ni la detección de
duplicados: solo tiene que llamarla.

---

## 3. La entrada a inventario, y por qué la equivalencia es el punto

`facturacion/compraDesdeXml.ts`. Lo que importa del diseño:

- **La primera factura de un proveedor se vincula a mano**, línea por línea.
- **La equivalencia se guarda con el código del proveedor**, que sale de `CodigoComercial` con tipo
  `01` («código del producto del vendedor») de la línea del XML. Cuando el proveedor no manda
  código, se guarda la descripción exacta.
- **La segunda factura del mismo proveedor llega reconocida.** Sin eso, cada compra es el mismo
  trabajo manual y la función se usa una vez y se abandona.
- **No se adivina por nombre parecido.** Una línea sin equivalencia queda sin vincular y la pantalla
  la muestra. Vincular «Alimento renal 10 kg» con «Alimento renal 3 kg» porque se parecen mete un
  producto equivocado al inventario, y eso aparece como un faltante de stock tres semanas después,
  sin que nadie sepa de dónde vino.

**Lo que no se construyó:** conciliar la factura recibida contra una **orden de compra** previa. El
modelo lo permite —la compra que se crea es una `inv_ordenes_compra` recibida— pero elegir contra
qué orden conciliar, y qué hacer con las diferencias de cantidad y de precio, es un flujo propio.
Queda anotado.
