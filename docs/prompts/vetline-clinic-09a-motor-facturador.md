# Vetline Clinic 09a — Motor del facturador electrónico (Costa Rica, v4.4)

## Contexto

El facturador electrónico es un módulo de Vetline Clinic (`facturacion`), dentro de este mismo
repositorio y backend. Su referencia funcional son los procedimientos y flujos de TICO Factura, el
facturador de Hacienda en TRIBU-CR: se replica **qué** hace y en qué orden, no su código ni su
interfaz. Si existe un relevamiento de TICO Factura en `docs/relevamientos/`, es la referencia
funcional; si no, la referencia es la documentación oficial de Hacienda.

Rige la guía rectora (`docs/prompts/vetline-clinic-00-guia-rectora.md`).

Este prompt construye **el motor**, que no depende de ningún otro módulo de Vetline Clinic: recibe
un documento de venta genérico y se ocupa de todo lo que exige Hacienda. Caja, ventas y compras lo
van a invocar más adelante por su API; también tiene una interfaz propia, de uso secundario.

Trabajá en una rama nueva creada **a partir de `vetline-clinic/sesion-nocturna-2026-11-25`**, para
usar el sistema de diseño ampliado, que todavía no está en main.

Construí sin pedir confirmación. Parás solo ante una contradicción con el código o con la normativa
técnica, una decisión irreversible sobre datos existentes, o un trabajo mucho mayor al supuesto.
No se toca producción, no se envía nada a los servidores reales de Hacienda y no se envían correos
reales.

## Fuente técnica: la documentación oficial, no la memoria

- Descargá de los sitios oficiales del Ministerio de Hacienda los anexos y estructuras de
  comprobantes electrónicos **versión 4.4** (esquemas XSD, anexos de campos y códigos) y la
  documentación de la API de recepción y del servicio de autenticación. Guardalos en
  `docs/facturacion/fuentes/` con la URL de origen y la fecha de descarga en un `LEEME.md`.
- Toda URL de servicio, nombre de campo, código de catálogo, regla de longitud y valor permitido
  sale de esos documentos. Si algo no está en ellos, se reporta como no encontrado; no se completa
  de memoria.
- Si no se pueden descargar, se para el bloque que los necesita y se reporta.

---

## 1. Modelo de datos

Todas las tablas con `tenant_id`, RLS forzado, política estándar y `ON DELETE CASCADE` a `tenants`
(la auditoría de RLS tiene que pasar limpia).

- **Emisor:** tabla propia, no columnas en `tenants`, para no atar el emisor a la clínica (hoy uno
  por tenant). Datos fiscales: tipo y número de identificación, nombre, nombre comercial, actividad
  económica (CIIU 4), ubicación según los códigos oficiales, teléfono, correo. Sucursal y terminal.
  Ambiente: `pruebas` o `produccion`, por separado para cada juego de credenciales.
- **Credenciales del emisor:** usuario y contraseña de la API de Hacienda, llave criptográfica
  (.p12) y su PIN, por ambiente. **Cifradas en reposo** con una clave que viene de una variable de
  entorno; nunca se devuelven por la API, nunca aparecen en logs ni en la bitácora. La API solo
  informa si están cargadas, su ambiente y la fecha de vencimiento de la llave, y avisa antes de que
  venza.
- **Catálogos oficiales** sin `tenant_id`: CABYS (código, descripción, tarifa de impuesto sugerida),
  tipos de comprobante, tipos de identificación, medios de pago (incluido SINPE Móvil), condiciones
  de venta, naturaleza del descuento, códigos de impuesto y tarifa, unidades de medida, monedas.
  Cargados desde las fuentes oficiales por un script versionado e idempotente que se pueda volver a
  correr cuando Hacienda los actualice.
- **Comprobantes:** factura electrónica, tiquete electrónico, nota de crédito, nota de débito y
  recibo electrónico de pago (REP). Cabecera, líneas, impuestos, descuentos, medios de pago,
  referencias (una nota apunta al comprobante que corrige), moneda (CRC o USD con tipo de cambio).
  Guardan el XML firmado exacto que se envió y la respuesta exacta de Hacienda.
- **Comprobantes recibidos** de proveedores: el XML recibido, su validación y el mensaje receptor
  emitido (aceptación total, parcial o rechazo, con la condición del impuesto), que más adelante
  alimenta cuentas por pagar y el IVA acreditable.
- **Eventos de cada comprobante** en una tabla que solo se agrega: creado, firmado, enviado,
  respuesta recibida, reintento, contingencia, anulado por nota. El estado actual se deriva de ahí.

Reglas impuestas **en la base**, no solo en el código:

- Consecutivo único por emisor, sucursal, terminal y tipo de comprobante; clave numérica de 50
  dígitos única.
- Un comprobante enviado a Hacienda no se borra ni se edita: se corrige con una nota.
- El XML firmado y la respuesta de Hacienda, una vez guardados, no cambian.
- Una misma solicitud de emisión no genera dos comprobantes: clave de idempotencia única por emisor.

## 2. Motor

- **Construcción del XML v4.4** a partir del documento de venta: cálculo de impuestos por línea
  según su código CABYS y su tarifa, descuentos con su naturaleza obligatoria, totales y resumen,
  con redondeos según la norma.
- **Validación contra los XSD oficiales** antes de firmar. Un XML que no valida no se firma ni se
  envía, y el error dice qué campo falla y por qué.
- **Clave numérica y consecutivo**, asignados de forma atómica en la misma transacción que crea el
  comprobante; si la transacción se revierte, el número no se consume.
- **Firma XAdES** con la llave criptográfica del emisor, según la especificación de Hacienda. Elegí
  la librería, justificala en una línea y dejala detrás de un único módulo de firma.
- **Autenticación** contra el servicio de identidad de Hacienda con caché y renovación del token,
  por emisor y ambiente.
- **Envío y consulta de estado** con reintentos y espera creciente. Ninguna llamada a Hacienda
  ocurre dentro de una transacción abierta (patrón de transacción corta).
- **Contingencia:** si Hacienda no responde, el comprobante queda firmado y en cola, y un trabajo
  programado lo reintenta. La venta nunca se bloquea por Hacienda. El trabajo es idempotente y no
  envía dos veces el mismo comprobante.
- **Rechazo:** se guarda el motivo tal cual lo devuelve Hacienda, el comprobante queda rechazado y
  la corrección se hace con un comprobante nuevo, nunca editando el rechazado.
- **Proveedor de Hacienda intercambiable:** una única interfaz con dos implementaciones, la real y
  una **simulada** que acepta, rechaza, demora o no responde según el caso de prueba. En desarrollo
  se usa la simulada.

## 3. Representación gráfica y entrega

- **PDF** del comprobante con los datos del emisor, el logo de la clínica, la clave, el consecutivo,
  el estado en Hacienda y un código QR si la norma lo contempla. Reusá el motor de PDF que ya genera
  las recetas, salvo que no sirva y lo justifiques.
- **Envío al receptor** por correo con el PDF y el XML adjuntos, a través de `enviarEmail` y la marca
  del comercio. En desarrollo no sale ningún correo real.

## 4. API

Bajo `requiereModulo('facturacion')`, con los permisos que correspondan:

- `POST /api/facturacion/comprobantes` — crea y emite desde un documento de venta, con clave de
  idempotencia.
- `GET /api/facturacion/comprobantes` (filtros por tipo, estado, fecha, receptor; paginado) y
  `GET /api/facturacion/comprobantes/:id` (con su historia de eventos).
- `POST /api/facturacion/comprobantes/:id/nota-credito` y `.../nota-debito` — total o parcial,
  referenciando al original.
- `GET .../:id/pdf` y `GET .../:id/xml`; `POST .../:id/reenviar`.
- `POST /api/facturacion/recibidos` — carga el XML de un comprobante de proveedor, lo valida y
  permite emitir el mensaje receptor.
- `GET/PUT /api/facturacion/emisor` y la carga de credenciales por ambiente.
- El contrato del documento de venta queda documentado en `docs/facturacion/contrato-api.md`, para
  que caja, ventas y compras lo usen sin leer el código del motor.

## 5. Interfaz propia (uso secundario)

Con el sistema de diseño ampliado y los patrones de Vetline Ai:

- Listado de comprobantes con filtros, estados en badges y búsqueda.
- Detalle: datos, líneas, historia de eventos, XML firmado y respuesta de Hacienda, descarga de PDF
  y XML, reenvío, nota de crédito.
- Emisión manual de una factura o un tiquete desde un formulario simple, con búsqueda de CABYS.
- Comprobantes recibidos: carga de XML y mensaje receptor.
- Configuración del emisor y carga de credenciales, mostrando solo si están cargadas y cuándo vence
  la llave.

---

## Verificación

Todo sin credenciales reales:

- Un XML de cada tipo (factura, tiquete, nota de crédito, nota de débito, REP, mensaje receptor)
  **valida contra el XSD oficial**. Y un XML con un campo obligatorio quitado a propósito **no**
  valida: el verificador falla contra el defecto antes de creerle.
- La firma se verifica con un certificado de prueba generado para el test (nunca una llave real), y
  un XML alterado después de firmar no pasa la verificación.
- Cálculo de impuestos y totales: casos con varias tarifas, descuentos, líneas exentas, moneda USD
  con tipo de cambio, contra resultados calculados a mano y documentados en el test.
- Con el proveedor simulado: aceptado, rechazado con motivo, demora con respuesta posterior, y sin
  respuesta → contingencia → reintento → aceptado, sin envío duplicado.
- Dos emisiones simultáneas no repiten consecutivo; la misma clave de idempotencia devuelve el mismo
  comprobante.
- Un comprobante enviado no se puede borrar ni editar desde la base.
- Las credenciales no aparecen en ninguna respuesta de la API ni en los logs.
- Los verificadores existentes siguen pasando.

## Fuera de este prompt

La conexión con caja y ventas (prompt 08), la recepción automática de facturas de proveedores por
correo, la factura electrónica de compra y la de exportación, y la prueba contra el ambiente de
pruebas real de Hacienda, que se hará cuando estén cargadas las credenciales de pruebas.

## Reporte

En `docs/reportes/`: lo construido, lo verificado con resultados, las fuentes oficiales usadas, lo
que no se encontró en ellas, lo que no se pudo y por qué, las decisiones que tomaste solo, y qué
falta para la prueba contra el ambiente de pruebas real.
