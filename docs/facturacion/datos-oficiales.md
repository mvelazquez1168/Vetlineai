# Datos oficiales v4.4 — lo que el motor tiene permitido afirmar

Cada dato de acá sale de `docs/facturacion/fuentes/` y **cita dónde**. Es la referencia que el
código consulta: ninguna constante del motor se escribe sin que esté en esta página con su cita.

Fuente principal: `documentos/ANEXOS_Y_ESTRUCTURAS_V4.4.pdf` (99 páginas), citada como
**[Anexo, Nota N]** o **[Anexo 3]**. La guía del proveedor de identidad es
`documentos/Guia_IdP.pdf`, citada como **[Guía IdP]**.

## Vigencia

> "VERSIÓN 4.4. Rige a partir del 01 de setiembre del 2025, a partir de dicha fecha se deroga la
> Versión 4.3, esta y versiones anteriores, únicamente se podrán utilizar para generar notas de
> crédito y débito que ajusten comprobantes emitidos durante su vigencia."
> — [Anexo 1, control histórico de cambios]

La bitácora de ajustes del documento descargado es **al 22/04/2026**, o sea que es el texto vigente
al momento de este trabajo.

**Consecuencia de diseño, no cosmética:** una nota de crédito que ajusta un comprobante emitido en
4.3 tiene que generarse en 4.3. El motor guarda la versión con la que se emitió cada comprobante,
porque dentro de unos años una nota sobre un comprobante viejo va a necesitar saberlo.

## Numeración consecutiva — 20 posiciones

[Anexo, Nota 3]

| Posiciones | Qué es |
|---|---|
| 1–3 | Local o establecimiento. `001` = oficina central / casa matriz; `002` y siguientes, sucursales |
| 4–8 | Terminal o punto de venta. Con una sola terminal o un servidor centralizado: `00001` |
| 9–10 | Tipo de comprobante (tabla de abajo) |
| 11–20 | Consecutivo, **empieza en 1**, por sucursal o terminal según el caso |

> "En caso de que se llegue al tope del uso de la numeración consecutiva, se podrá volver a empezar
> desde el número 1." — [Anexo, Nota 3]

Y, para una clínica que viene de otro sistema:

> "Para aquellos casos donde el obligado tributario ya se encuentra utilizando comprobantes
> electrónicos conforme a la resolución vigente, y decida cambiar de plataforma de emisión deberá
> **mantener la numeración consecutiva**." — [Anexo, Nota 3]

Por eso el emisor tiene que poder arrancar su consecutivo en un número distinto de 1 — el mismo
problema que ya resolvió `expediente.ts` para el número de caso.

### Tipos de comprobante (posiciones 9–10 del consecutivo)

[Anexo, Nota 3, inciso c]

| Código | Tipo |
|---|---|
| `01` | Factura electrónica |
| `02` | Nota de débito electrónica |
| `03` | Nota de crédito electrónica |
| `04` | Tiquete electrónico |
| `05` | Confirmación de aceptación del comprobante electrónico |
| `06` | Confirmación de aceptación parcial del comprobante electrónico |
| `07` | Confirmación de rechazo del comprobante electrónico |
| `08` | Factura electrónica de compras |
| `09` | Factura electrónica de exportación |
| `10` | Recibo Electrónico de Pago |

## Clave numérica — 50 posiciones

[Anexo, Nota 3]

| Posiciones | Qué es |
|---|---|
| 1–3 | Código de país: **506** |
| 4–5 | Día de generación |
| 6–7 | Mes de generación |
| 8–9 | Año de generación (dos dígitos) |
| 10–21 | Número de cédula del emisor, **12 caracteres** (relleno según Nota 4.1) |
| 22–41 | La numeración consecutiva completa (los 20 de arriba) |
| 42 | Situación del comprobante (tabla de abajo) |
| 43–50 | Código de seguridad, **8 dígitos**, "generado por el sistema del obligado tributario" |

### Situación del comprobante (posición 42)

[Anexo, Nota 3, inciso g]

| Código | Situación | Cuándo |
|---|---|---|
| `1` | Normal | Generado y transmitido en el mismo acto de la compraventa |
| `2` | Contingencia | Sustituye a un comprobante físico emitido por contingencia |
| `3` | Sin internet | Generado en formato electrónico pero sin acceso a internet |

**Ojo con la lectura fácil:** el código `2` NO es "Hacienda no respondió". Es el que sustituye a un
comprobante **físico** emitido por contingencia. Cuando Hacienda no responde pero hay internet y el
comprobante se generó normal, la situación sigue siendo `1` y lo que cambia es el estado interno del
envío (en cola, reintentando). Confundir las dos cosas mete un dígito equivocado en la clave, que
después no se puede corregir sin anular el comprobante.

### Relleno de la cédula para la clave (posiciones 10–21)

[Anexo, Nota 4.1]

| Tipo de identificación | Relleno |
|---|---|
| Cédula Física | Tres ceros al inicio, para completar 12 dígitos |
| Cédula Jurídica | Dos ceros al inicio, para completar 12 caracteres |
| DIMEX | Si tiene 11 dígitos, un cero al inicio, para completar 12 |
| NITE | Dos ceros al inicio, para completar 12 dígitos |

## Nombres de archivo

[Anexo, Nota 3, cierre]

| Qué | Formato |
|---|---|
| XML del comprobante | `clave.xml` |
| XML de respuesta de Hacienda | `clave_respuesta.xml` |
| PDF del comprobante | `clave.pdf` |
| XML de confirmación (mensaje receptor) | `clave-consecutivo.xml` |
| PDF de confirmación | `clave-consecutivo.pdf` |
| Respuesta de una confirmación | `clave-consecutivo_respuesta.xml` |

## Catálogos

### Tipo de identificación — [Anexo, Nota 4]

| Código | Tipo |
|---|---|
| `01` | Cédula Física |
| `02` | Cédula Jurídica |
| `03` | DIMEX |
| `04` | NITE |
| `05` | Extranjero No Domiciliado |
| `06` | No Contribuyente |

`05` y `06` tienen uso restringido: `05` en los datos del emisor **solo** en la factura electrónica
de compra (y en los del receptor, solo con condición de venta `12`); `06` solo en factura
electrónica de compra con condición de venta `13`.

### Condición de la venta — [Anexo, Nota 5]

| Código | Condición |
|---|---|
| `01` | Contado |
| `02` | Crédito |
| `03` | Consignación |
| `04` | Apartado |
| `05` | Arrendamiento con opción de compra |
| `06` | Arrendamiento en función financiera |
| `07` | Cobro a favor de un tercero |
| `08` | Servicios prestados al Estado |
| `09` | Pago de servicios prestado al Estado |
| `10` | Venta a crédito en IVA hasta 90 días (Artículo 27, LIVA) |
| `11` | Pago de venta a crédito en IVA hasta 90 días (Artículo 27, LIVA) |
| `12` | Venta Mercancía No Nacionalizada |
| `13` | Venta Bienes Usados No Contribuyente |
| `14` | Arrendamiento Operativo |
| `15` | Arrendamiento Financiero |
| `99` | Otros (hay que indicar la condición en la representación gráfica) |

Con `99` es obligatorio el campo "Detalle Condición de la Venta OTRO" [Anexo, bitácora 4.4.0 #34].

**Corrección sobre la nota, hecha leyendo el XSD** (2026-11-25, durante la construcción del motor):
la tabla de arriba es la Nota 5 completa, pero **el XSD de `FacturaElectronica` NO enumera `09` ni
`11`** — enumera `01`..`08`, `10`, `12`..`15` y `99`. Los dos que faltan son de uso **exclusivo del
Recibo Electrónico de Pago**, cuyo XSD enumera exactamente `[09|11]` y nada más (son el pago de una
factura con condición `08` y `10` respectivamente; lo dicen las notas al pie 20 y 22 del Anexo).

Ofrecer `09` o `11` en una factura produce un rechazo, así que el catálogo del motor lo marca con
`soloEnRep` y la pantalla de emisión no los muestra. Lo mismo pasa con el **código de referencia
`17`** (Nota 9, "Pago a comprobante electrónico"): el XSD de factura no lo enumera y el del REP sí.

### Medio de pago — [Anexo, Nota 6]

| Código | Medio |
|---|---|
| `01` | Efectivo |
| `02` | Tarjeta |
| `03` | Cheque |
| `04` | Transferencia – depósito bancario |
| `05` | Recaudado por terceros |
| `06` | SINPE MOVIL |
| `07` | Plataforma Digital |
| `99` | Otros (hay que indicarlo en la representación gráfica) |

En v4.4 el nodo de medio de pago **se trasladó** al resumen del comprobante, ya no va en el
encabezado [Anexo, bitácora 4.4.0 #36].

### Código de impuesto — [Anexo, Nota 8]

| Código | Impuesto |
|---|---|
| `01` | Impuesto al Valor Agregado |
| `02` | Impuesto Selectivo de Consumo |
| `03` | Impuesto Único a los Combustibles |
| `04` | Impuesto específico de Bebidas Alcohólicas |
| `05` | Impuesto Específico sobre bebidas envasadas sin contenido alcohólico y jabones de tocador |
| `06` | Impuesto a los Productos de Tabaco |
| `07` | IVA (cálculo especial) |
| `08` | IVA Régimen de Bienes Usados (Factor) |
| `12` | Impuesto Específico al Cemento |
| `99` | Otros |

Con `99` es obligatorio "Código de impuesto OTRO" [Anexo, bitácora 4.4.0 #61]. Los códigos `03`,
`04`, `05` y `06` obligan el nodo "Datos para Impuestos Específicos" [bitácora #73]. Nótese que
**no hay código `09`, `10` ni `11`**: la lista salta de `08` a `12`.

### Tarifa del IVA — [Anexo, Nota 8.1]

| Código | Tarifa |
|---|---|
| `01` | Tarifa 0% (Artículo 32, num 1, RLIVA) — con derecho a crédito pleno |
| `02` | Tarifa reducida 1% |
| `03` | Tarifa reducida 2% |
| `04` | Tarifa reducida 4% |
| `05` | Transitorio 0% — **solo** en notas de crédito y débito |
| `06` | Transitorio 4% — **solo** en notas de crédito y débito |
| `07` | Tarifa transitoria 8% — **código inhabilitado** |
| `08` | Tarifa general 13% |
| `09` | Tarifa reducida 0.5% |
| `10` | Tarifa Exenta (Ley 9635, artículo 8) |
| `11` | Tarifa 0% sin derecho a crédito |

**Tres ceros distintos, y la diferencia es fiscal, no cosmética:** `01` da derecho a crédito pleno,
`10` es exenta, y `11` es 0% sin derecho a crédito. Un motor que trate "0%" como un solo caso le
genera a la clínica una declaración de IVA equivocada. Por eso la tarifa es un **código**, nunca un
número, en todo el modelo de datos.

### Unidad de medida — [Anexo, Nota 15]

Lista larga: unidades del SI (`A`, `Bq`, `C`, `cd/m²`, `m`, `kg`, …) más unidades propias de Costa
Rica (`Sp` servicios profesionales, `Al` alquiler de uso habitacional, `Alc` alquiler de uso
comercial, `Cm` comisiones, `Fa` fanega de café, `Cc` cajuela de café, `Cu` cuartillos de café, `Qq`
quintal, `Acv` activo virtual, …).

**No se transcribe acá**: la carga de este catálogo la hace el script de sembrado leyendo el texto
extraído de la fuente, justamente para no copiar a mano una tabla de cientos de filas y equivocarse
en una.

**Son 101**, contados en la enumeración de `UnidadMedidaType` del XSD, no estimados. El código ES el
símbolo (`Kg`, `Unid`, `m³`, `Ω`) y va literal al XML.

### Moneda — [Anexo, Nota 13.1 / `Codigodemoneda_V4.4.pdf`]

**Son 168 códigos ISO 4217**, contados en la enumeración de `CodigoMonedaType` del XSD. (Una
estimación anterior decía 178; el número sale de contar el esquema real.)

Los nombres de las 168 salen del `Codigodemoneda_V4.4.pdf`. Para `CRC` el `TipoCambio` del XML vale
`1`; para cualquier otra moneda es el tipo de cambio de venta de referencia del BCCR.

## API de recepción

[Anexo 3]

| | URI |
|---|---|
| Producción | `https://api.comprobanteselectronicos.go.cr/recepcion/v1/` |
| Pruebas (sandbox) | `https://api.comprobanteselectronicos.go.cr/recepcion-sandbox/v1/` |

> "La base de datos que utiliza este API de sandbox se puede limpiar en cualquier momento para
> reiniciar el ambiente." — [Anexo 3]

HTTPS obligatorio. Todos los mensajes JSON, con mapa de caracteres UTF-8.

### Recursos

| Recurso | Método | Qué hace |
|---|---|---|
| `/recepcion` | POST | Recibe el comprobante electrónico o la respuesta del receptor |
| `/recepcion/{clave}` | GET | Estado del comprobante indicado por la clave |
| `/comprobantes` | GET | Resumen de todos los comprobantes enviados, descendente por fecha |
| `/comprobantes/{clave}` | GET | El comprobante indicado por la clave |

### Callback asincrónico

El POST a `/recepcion` acepta un atributo `callbackUrl` donde Hacienda deja la respuesta de forma
asincrónica, con el mismo JSON que devolvería el GET por clave:

```json
{
  "clave": "50601011600310112345600100010100000000011999999999",
  "fecha": "2016-01-01T00:00:00-0600",
  "indEstado": "RECIBIDO",
  "respuestaXml": "<el XML de respuesta, en base64>"
}
```

> "Y el URL debe responder con un HTTP_OK (200), si no se recibe el HTTP_OK o se recibe un error de
> timeout, se realizarían 3 reintentos." — [Anexo 3]

**Decisión de diseño que esto habilita:** el motor no necesita el callback para funcionar. El mismo
JSON se obtiene con el GET por clave, así que la consulta de estado por reintento alcanza, y evita
exponer un endpoint público. El callback queda como mejora posterior.

## Autenticación — OAuth 2.0 / OpenID Connect

[Anexo 3] y [Guía IdP]

IdP: `https://idp.comprobanteselectronicos.go.cr/auth`

| | Producción | Pruebas |
|---|---|---|
| Realm | `rut` | `rut-stag` |
| Token URL | `…/auth/realms/rut/protocol/openid-connect/token` | `…/auth/realms/rut-stag/protocol/openid-connect/token` |
| `client_id` | `api-prod` | `api-stag` |
| Formato de usuario | `cpf-01-1234-5678@comprobanteselectronicos.go.cr` | `cpj-3-101-261506@stag.comprobanteselectronicos.go.cr` |

- Grant type: `password` ("Resource Owner Password Credential").
- `client_secret` y `scope` **se dejan vacíos**: "no son necesarias" [Guía IdP].
- Payload `application/x-www-form-urlencoded` con `grant_type`, `client_id`, `username`, `password`.
- Respuesta `application/json;charset=UTF-8` con al menos `access_token` y `refresh_token`.
- El token se manda en el header `Authorization` con el prefijo `bearer`.

**El dato que condiciona el diseño:**

> "este IdP permite crear nuevos Tokens (JWT) o refrescar los existentes ya que estos tienen un
> **tiempo de expiración de 5 minutos**." — [Anexo 3]

Cinco minutos es muy poco. Un caché de token por emisor y ambiente no es una optimización: sin él,
una tanda de comprobantes pide un token por comprobante. Y hay que usar el `refresh_token`, no
volver a mandar la contraseña.

La contraseña **no la elige el contribuyente**: se genera en el ATV (Administración Tributaria
Virtual) y llega al buzón electrónico [Anexo 3]. La guía avisa que son cadenas de ~20 caracteres y
pueden traer caracteres especiales, así que hay que codificarlas bien en el form-urlencoded [Guía
IdP] — que es exactamente el tipo de detalle que rompe una integración y después cuesta encontrar.

## Firma

El Anexo 2 ("Mecanismo de seguridad para la autenticación e integridad de los Comprobantes
Electrónicos") tiene la especificación y ejemplos, con `xades:` y el `xades:Identifier` apuntando a
`https://cdn.comprobanteselectronicos.go.cr/xml-schemas/…`. Hay además un detalle opcional:

> "Los emisores electrónicos que no requieran estas firmas adicionales, no tendrán obligación de
> utilizar el atributo `<xades:ClaimedRole>`" — [Anexo 1, mecanismo de seguridad]

## Límites de líneas de detalle

**`maxOccurs="1000"` para todos**, verificado leyendo el `LineaDetalle` de los XSD de 4.4
(`FacturaElectronica_V4.4.xsd`, `TiqueteElectronico_V4.4.xsd`,
`NotaCreditoElectronica_V4.4.xsd`).

El Anexo 1 trae, en su control histórico, un cambio del **22/07/2011** que dice:

> "Se limita las líneas de detalle en la factura electrónica a un máximo de 60 líneas y en el
> tiquete electrónico a un máximo de 1000 líneas de detalle."

**Ese dato está obsoleto y no hay que usarlo.** El control histórico del anexo es acumulativo: lista
los cambios de todas las versiones desde 2009, no el estado actual. El esquema de 4.4 dice 1000 para
los dos. Queda anotado porque es una trampa fácil: la tabla de 2011 se lee como una especificación
vigente y no lo es.

Regla general que sale de acá: **ante una diferencia entre el PDF y el XSD, manda el XSD**. El PDF
describe, el XSD es lo que Hacienda efectivamente valida.

## Elementos raíz de cada esquema

Verificado leyendo los XSD. Hace falta para armar el XML y para elegir el esquema con el que
validar.

| Comprobante | Elemento raíz | Archivo XSD |
|---|---|---|
| Factura electrónica | `FacturaElectronica` | `FacturaElectronica_V4.4.xsd` |
| Tiquete electrónico | `TiqueteElectronico` | `TiqueteElectronico_V4.4.xsd` |
| Nota de crédito | `NotaCreditoElectronica` | `NotaCreditoElectronica_V4.4.xsd` |
| Nota de débito | `NotaDebitoElectronica` | `NotaDebitoElectronica_V4.4.xsd` |
| Recibo electrónico de pago | `ReciboElectronicoPago` | `ReciboElectronicoPago_V4.4.xsd` |
| Factura electrónica de compra | `FacturaElectronicaCompra` | `FacturaElectronicaCompra_V4.4.xsd` |
| Factura electrónica de exportación | `FacturaElectronicaExportacion` | `FacturaElectronicaExportacion_V4.4.xsd` |
| Mensaje del receptor | `MensajeReceptor` | `MensajeReceptor_V4.4.xsd` |
| Mensaje de Hacienda | `MensajeHacienda` | `MensajeHacienda_V4.4.xsd` |
