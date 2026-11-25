# Contrato de la API del facturador electrónico (Costa Rica v4.4)

Este documento es para **caja, ventas y compras**: los módulos que van a emitir comprobantes sin
leer el código del motor. Si algo de acá contradice al código, el código manda y este documento está
desactualizado — reportalo.

Todo vive bajo `/api/facturacion` y está gateado por `requiereModulo("facturacion")`. Una clínica sin
el módulo habilitado recibe en **cualquiera** de estas rutas:

```json
{ "error": "El módulo \"Facturación\" no está habilitado para tu clínica.",
  "code": "MODULO_NO_HABILITADO", "modulo": "facturacion" }
```

con estado `403`. Habilitarlo: `npm run habilitar-modulo -- <tenantId> facturacion`.

**Permisos.** Médico o administrador de la clínica para consultar y emitir. **Solo administrador**
para `PUT /emisor`, las credenciales y su borrado: un médico no tiene por qué poder cambiar los datos
fiscales de la clínica ni cargar su llave criptográfica.

---

## Lo primero: el documento de venta

`POST /api/facturacion/comprobantes` recibe un **documento de venta**. Dos reglas de diseño que
conviene entender antes de mirar los campos:

1. **Lo que se puede calcular, no se manda.** El documento NO trae subtotales, ni base imponible, ni
   montos de impuesto, ni totales. Los calcula el motor según el Anexo 1 de Hacienda. Si los
   recibiera, habría dos fuentes para el mismo número — y la que Hacienda valida es la del motor.

2. **Los códigos son códigos, no porcentajes.** Se manda `codigoTarifaIva: "08"`, no `tarifa: 13`.
   Hay **tres** códigos distintos que valen 0% y significan cosas fiscales diferentes:

   | Código | Qué es | Dónde suma en el resumen |
   |---|---|---|
   | `01` | 0% del art. 32 num. 1 RLIVA, **con** derecho a crédito pleno | No sujeto |
   | `10` | Exenta (Ley 9635, art. 8) | Exento |
   | `11` | 0% **sin** derecho a crédito | No sujeto |

   Elegir mal entre esos tres no cambia lo que se cobra: cambia la declaración de IVA del cliente.

### Forma del cuerpo

```jsonc
{
  "tipoComprobante": "01",          // 01 factura, 02 nota de débito, 03 nota de crédito,
                                    // 04 tiquete, 10 recibo electrónico de pago
  "sucursal": "001",                // opcional; por defecto, la del emisor
  "terminal": "00001",              // opcional; por defecto, la del emisor
  "situacion": "1",                 // opcional; ver la advertencia más abajo
  "fechaEmision": "2026-11-25T15:00:00-06:00",  // opcional; por defecto, ahora

  "receptor": {                     // OBLIGATORIO en factura (01) y REP (10);
                                    // opcional en tiquete (04) y notas (02, 03)
    "nombre": "Ana María Rodríguez Jiménez",
    "identificacion": { "tipo": "01", "numero": "112345678" },
    "nombreComercial": "…",         // opcional
    "correo": "ana@ejemplo.test",   // sin esto NO hay entrega por correo
    "ubicacion": {                  // opcional
      "provincia": "1", "canton": "01", "distrito": "01",
      "barrio": "Barrio Escalante", // texto de 5 a 50 caracteres, NO un código
      "otrasSenas": "Casa esquinera color verde"
    },
    "otrasSenasExtranjero": "…",    // para un receptor no domiciliado
    "telefono": { "codigoPais": "506", "numero": "22334455" },
    "codigoActividad": "750000"     // opcional
  },

  "condicionVenta": "01",           // Nota 5. 01 contado, 02 crédito, …, 99 otros
  "condicionVentaDetalle": "…",     // obligatorio si condicionVenta = "99"
  "plazoCreditoDias": 30,           // entero, en DÍAS (cambió en 4.4: antes era texto)

  "moneda": "CRC",                  // por defecto CRC
  "tipoCambio": 1,                  // obligatorio ≠ 1 si la moneda no es CRC

  "lineas": [ /* ver abajo */ ],
  "mediosPago": [ { "codigo": "06" } ],      // Nota 6. SINPE MÓVIL es el 06
  "otrosCargos": [ /* ver abajo */ ],
  "referencias": [ /* ver abajo */ ],

  "claveIdempotencia": "venta-caja-2026-11-25-0042"
}
```

### `claveIdempotencia` — lo más importante para la caja

Es lo que impide que un reintento emita **dos** comprobantes por la misma venta. Mandá tu propio
identificador de venta.

- Dos llamadas con la misma clave y el mismo emisor devuelven **el mismo comprobante**, con
  `yaExistia: true` y estado `200` en vez de `201`.
- Dos llamadas **sin** clave son dos comprobantes, y eso es lo correcto cuando quien emite es una
  persona apretando un botón.
- La unicidad está además **en la base** (`UNIQUE (emisor_id, clave_idempotencia)`), así que cubre la
  carrera entre dos solicitudes simultáneas, no solo el reintento secuencial.

### Líneas

```jsonc
{
  "codigoCabys": "8690100000000",   // 13 dígitos. OBLIGATORIO en factura y tiquete
  "codigoComercial": { "tipo": "04", "codigo": "CONS-001" },  // opcional, tu código interno
  "cantidad": 1,                    // número o string; hasta 3 decimales
  "unidadMedida": "Sp",             // Nota 15: el SÍMBOLO, no un número
  "unidadMedidaComercial": "…",     // opcional
  "tipoTransaccion": "01",          // Nota 22, opcional
  "detalle": "Consulta veterinaria general",   // 3 a 200 caracteres
  "precioUnitario": 10000,

  "descuentos": [
    { "monto": 2000, "codigoDescuento": "04",  // Nota 20. OBLIGATORIO en 4.4
      "codigoDescuentoOtro": "…",              // obligatorio si el código es 99
      "naturaleza": "…" }                      // obligatoria si el código es 99
  ],

  "impuestos": [                    // AL MENOS UNO. Ver la nota de abajo
    { "codigo": "01",               // Nota 8
      "codigoTarifaIva": "08",      // Nota 8.1. Obligatorio para los códigos 01 y 07
      "exoneracion": { /* ver abajo */ } }
  ],

  "ivaCobradoFabrica": "01",        // Nota 21, opcional
  "baseImponibleEditada": 12345,    // SOLO con impuesto 07 o IVA de fábrica 01
  "registroMedicamento": "…",       // opcional
  "formaFarmaceutica": "…"          // Nota 19, opcional
}
```

**Una línea exenta NO va sin impuesto.** Va con `codigo: "01"` y `codigoTarifaIva: "10"`. Es la
diferencia entre "no cobré IVA" y "no declaré nada sobre el IVA", y el XSD exige al menos un nodo
`Impuesto` por línea.

**El primer dígito del CABYS decide si la línea es servicio o mercancía** (5, 6, 7, 8, 9 →
servicio), y de eso depende en qué total del resumen suma. No es un detalle cosmético: Hacienda lo
valida.

### Exoneración

```jsonc
{
  "tipoDocumento": "03",            // Nota 10.1
  "tipoDocumentoOtro": "…",         // obligatorio si el tipo es 99
  "numeroDocumento": "AL-2026-0001",
  "articulo": 12, "inciso": 3,      // opcionales
  "nombreInstitucion": "03",        // Nota 23
  "nombreInstitucionOtros": "…",
  "fechaEmision": "2026-01-15T00:00:00-06:00",
  "tarifaExonerada": 10             // el PORCENTAJE exonerado, como entero
}
```

### Otros cargos y referencias

```jsonc
"otrosCargos": [
  { "tipoDocumento": "07",          // Nota 16. 07 = timbre de colegio profesional
    "tercero": { "identificacion": { "tipo": "02", "numero": "3007045419" },
                 "nombre": "Colegio de Médicos Veterinarios" },
    "detalle": "Timbre del colegio profesional",
    "porcentaje": 1,                // opcional
    "monto": 500 }
],
"referencias": [
  { "tipoDocumento": "01",          // Nota 10
    "numero": "506…",               // la clave de 50 del comprobante referenciado
    "fechaEmision": "2026-11-20T10:00:00-06:00",
    "codigo": "01",                 // Nota 9
    "razon": "Anulación por error en el monto" }
]
```

Las referencias son **obligatorias** en nota de crédito, nota de débito y REP. Para las notas, usá
`POST /comprobantes/:id/nota-credito`, que las arma solo.

### ⚠️ `situacion` no significa lo que parece

| Valor | Qué significa |
|---|---|
| `1` | Normal. **Es el default y el que corresponde casi siempre.** |
| `2` | Contingencia: este comprobante **sustituye a un documento FÍSICO** emitido durante una contingencia. |
| `3` | Sin internet: generado sin acceso a internet, conforme la norma. |

Un comprobante que no se pudo transmitir porque Hacienda no contestó sigue siendo **situación 1**: se
emitió y se transmite cuando se puede. Poner `2` ahí declara algo distinto de lo que pasó.

---

## Respuesta de `POST /comprobantes`

```jsonc
{
  "comprobanteId": "…uuid…",
  "clave": "50625112600310112345600100001010000000001187654321",
  "consecutivo": "00100001010000000001",
  "estado": "aceptado",
  "yaExistia": false,
  "indEstado": "ACEPTADO",          // el valor CRUDO de Hacienda, sin traducir
  "detalle": null,                  // el motivo del rechazo, tal cual lo devolvió Hacienda
  "entrega": { "enviado": true }    // el correo al receptor; no afecta la validez
}
```

### Los estados, y qué hacer con cada uno

| `estado` | Qué pasó | Qué tiene que hacer la caja |
|---|---|---|
| `aceptado` | Hacienda lo aceptó | Nada. Cobrar y entregar. |
| `aceptado_parcial` | Hacienda lo aceptó parcialmente | Nada automático; mostrar `detalle`. |
| `enviado` | Transmitido, Hacienda todavía no resolvió | **Nada.** Cobrar y entregar: el comprobante ya existe. El job consulta el estado solo. |
| `en_cola` | Hacienda no respondió; queda firmado y encolado | **Nada.** Cobrar y entregar. El job lo reintenta. |
| `rechazado` | Hacienda lo rechazó, con motivo en `detalle` | Corregir y emitir un comprobante **nuevo**. No se edita ni se borra el rechazado. |
| `error` | Se agotaron los reintentos, o Hacienda rechazó la recepción | Requiere que alguien lo mire en la pantalla de facturación. |

**La venta nunca se bloquea por Hacienda.** `POST /comprobantes` devuelve en cuanto el comprobante
está firmado: no espera la aceptación. `en_cola` y `enviado` son respuestas **exitosas**.

---

## Las rutas

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/catalogos` | Los códigos oficiales para armar selectores: tipos, condiciones de venta, medios de pago, tarifas de IVA, unidades de medida, descuentos, referencias. |
| `GET` | `/cabys?q=…` | Busca en el catálogo CABYS por código o descripción. Ver la advertencia abajo. |
| `GET` | `/emisor` | Los datos fiscales del emisor y el **estado** de sus credenciales. |
| `PUT` | `/emisor` | Crea o actualiza el emisor. Solo administrador. |
| `PUT` | `/emisor/credenciales` | Carga usuario, contraseña, llave `.p12` y PIN de un ambiente. `multipart/form-data` con el archivo en el campo `llave`. Solo administrador. |
| `DELETE` | `/emisor/credenciales/:ambiente` | Borra las credenciales de `pruebas` o `produccion`. Solo administrador. |
| `POST` | `/comprobantes` | Crea y emite desde un documento de venta. |
| `GET` | `/comprobantes` | Listado con filtros `tipo`, `estado`, `desde`, `hasta`, `receptor`, `pagina`, `porPagina`. |
| `GET` | `/comprobantes/:id` | Detalle con líneas, impuestos, eventos, referencias, medios de pago, notas que lo corrigen, el XML firmado y la respuesta de Hacienda. |
| `POST` | `/comprobantes/:id/nota-credito` | Nota de crédito contra ese comprobante. |
| `POST` | `/comprobantes/:id/nota-debito` | Nota de débito. |
| `GET` | `/comprobantes/:id/pdf` | El PDF con el QR. |
| `GET` | `/comprobantes/:id/xml` | El XML firmado. `409` si todavía no está firmado. |
| `POST` | `/comprobantes/:id/reenviar` | `{"destino":"hacienda"}` reintenta la transmisión; `{"destino":"correo"}` vuelve a mandarle el correo al receptor. |
| `GET` | `/recibidos` | Comprobantes de proveedores cargados. |
| `POST` | `/recibidos` | Carga el XML de un comprobante de proveedor y lo valida contra el XSD. |
| `POST` | `/recibidos/:id/mensaje` | Emite el mensaje receptor: `{"mensaje":"1"}` acepta, `"2"` acepta parcialmente, `"3"` rechaza. |

### Notas de crédito y débito

```jsonc
POST /api/facturacion/comprobantes/<id>/nota-credito
{
  "codigoReferencia": "01",         // OBLIGATORIO. Nota 9: 01 anula, 02 corrige monto, …
  "razon": "Anulación por error en el monto facturado",
  "lineas": [ /* opcional: si no se mandan, la nota es TOTAL y copia las del original */ ],
  "claveIdempotencia": "…"
}
```

`codigoReferencia` **no tiene valor por defecto** a propósito: "anula el documento" y "corrige el
monto" tienen efectos contables distintos en la declaración del receptor, y adivinar cuál quiso quien
factura sería inventarle un efecto fiscal.

Una nota contra un comprobante **rechazado** se rechaza con su motivo: Hacienda no tiene ese
comprobante, así que no hay nada que corregir — lo que corresponde es emitir uno nuevo.

### Mensaje receptor

El código del mensaje es **`1`, `2` o `3`: un dígito**, no `"01"`/`"02"`/`"03"`. Es el único catálogo
de v4.4 que no usa dos dígitos, y confundirlo produce un XML que no valida.

`condicionImpuesto` (Nota 18) es lo que define si el IVA de esa factura de proveedor es crédito
pleno, crédito parcial, bien de capital, gasto corriente o proporcionalidad. Es el dato que más
adelante alimenta el IVA acreditable.

---

## Lo que esta API NO hace

- **No cobra.** Emitir un comprobante y cobrar son dos cosas distintas; el cobro es de caja.
- **No recibe facturas de proveedores por correo.** Hay que subir el XML.
- **No emite factura electrónica de compra (08) ni de exportación (09).** Fuera de alcance por ahora.
- **No usa el `callbackUrl` de Hacienda.** El mismo JSON se obtiene con el GET por clave, así que la
  consulta por reintento alcanza y evita exponer un endpoint público. Queda como mejora posterior.

## Dos cosas que hay que saber

**El catálogo CABYS está cargado**: 20 506 códigos de la planilla oficial del Banco Central (versión
2025, la vigente). `GET /cabys?q=…` busca por código o por descripción, tolerando acentos, y devuelve
hasta 30 resultados con su tarifa de IVA **sugerida**.

Sugerida quiere decir sugerida: el catálogo propone la tarifa del bien o servicio, pero la que va al
comprobante la decide la línea, porque una exoneración o un régimen especial la cambian. Tres de los
20 506 códigos no traen tarifa (el catálogo no se la asigna); ahí hay que elegirla.

Si por alguna razón el catálogo no estuviera cargado, `GET /cabys` devuelve
`{"resultados": [], "catalogoVacio": true, "aviso": "…"}` en vez de un 500 o de resultados
inventados, y el código hay que escribirlo a mano: son 13 dígitos y es **obligatorio** en cada línea
de factura y tiquete.

**El proveedor de Hacienda es el simulado** mientras `FE_CR_PROVEEDOR` no diga `real`. En desarrollo
no sale nada hacia los servidores de Hacienda, y eso es deliberado: el default protege contra un
ambiente mal configurado.
