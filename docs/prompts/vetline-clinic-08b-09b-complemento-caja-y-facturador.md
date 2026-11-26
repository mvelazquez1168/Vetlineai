# Vetline Clinic — 08b · 09b · Complemento de caja y facturador

Rama: `vetline-clinic/complemento-caja-facturador`. Se rige por `vetline-clinic-00-guia-rectora.md`. Complementa lo construido en `vetline-clinic-08-caja-ventas-cobros.md` y `vetline-clinic-09a-motor-facturador.md`.

Origen: el relevamiento funcional de Digital Vet (`docs/relevamientos/digital-vet-relevamiento-funcional.md`). Identificó capacidades que Medicavet usa hoy y que faltan para que pueda dejar ese sistema. El relevamiento describe capacidades; todo se diseña con el sistema de diseño y el marco de Vetline Clinic (prompt 01c).

**Fuera de alcance:** los reportes. Se definirán aparte con Medicavet.

## 0. Relevamiento previo

Antes de construir, el informe parte de una tabla con el estado actual de cada punto de este documento, a partir de lo que ya existe en el 08 y el 09a: existe completo, existe parcial (qué falta) o no existe. Se construye solo lo que falta, sin duplicar lo existente. Un punto que ya exista completo solo se verifica.

---

## Parte A — Caja y ventas (08b)

### A1. Presupuestos (proformas)

**El presupuesto:**
- Es un documento con cliente y, opcionalmente, paciente.
- Sus líneas salen del catálogo (servicios y productos, con la misma lógica de precios, descuentos e impuestos que una cuenta), con notas por línea.
- Tiene observaciones generales, **vigencia** (días, configurable por clínica, 15 por defecto) y un número consecutivo propio.
- **No es un comprobante electrónico** y no afecta inventario ni caja.

**Estados:** borrador, enviado, aceptado, rechazado, vencido y convertido. El paso a vencido es automático cuando pasa la vigencia sin aceptación.

**Origen:**
- Se crea desde Caja, desde la ficha del cliente o **desde la atención en el expediente**. Este último es el caso típico: el médico cotiza una cirugía o un tratamiento.
- Desde la atención, el presupuesto queda ligado a ella y aparece en la línea de tiempo del paciente.

**Envío y aprobación:**
- PDF con el logo y los datos de la clínica.
- Envío por correo o WhatsApp a través de `emitirNotificacion` y `puedeEnviar()`, con el propósito "transaccional".
- La aprobación la registra el usuario: aceptado por teléfono, por WhatsApp o en persona, con la fecha. No se construye una aprobación en línea del cliente; queda anotada como mejora futura.

**Conversión:**
- Un presupuesto aceptado se convierte en cargos de una **cuenta abierta** (o en cargos de la atención ligada), usando la puerta única de cargos de caja.
- Dentro de la vigencia se **respeta el precio cotizado**. Fuera de ella, el sistema avisa y ofrece usar el precio actual o mantener el cotizado (esto último requiere permiso).
- La conversión es **total**. Si el dueño quiere solo una parte, se edita el presupuesto antes de convertirlo. La conversión parcial no se construye en esta versión.
- Un presupuesto puede tener **anticipos** asociados (los del 08). Al convertir, el anticipo queda disponible para aplicarse en el cobro.

**Pantallas:**
- Lista de presupuestos con filtros por estado, cliente y vencimiento.
- Detalle del presupuesto.
- Es la **versión esencial**. No se construyen indicadores de aprobación ni la edición simultánea en pestañas.
- Acceso desde Caja, desde la ficha del cliente y desde la atención.

### A2. Arqueo por denominación y vales de caja

**Arqueo:**
- En el cierre de caja, el efectivo en colones y en dólares se puede contar **por denominación** (billetes y monedas), con un catálogo de denominaciones vigentes por moneda.
- Las denominaciones vigentes de Costa Rica se toman de la fuente oficial del BCCR, y el catálogo es editable por la clínica.
- El conteo por denominación calcula el total. Contar solo el total sigue permitido, y la clínica configura cuál es el predeterminado.
- El detalle del conteo queda guardado con el cierre y sale en su comprobante impreso.

**Vales:**
- Si los movimientos de caja del 08 ya cubren las salidas de efectivo (pago de un gasto menor, adelanto de un empleado), esto solo se verifica y se rotula en la interfaz como **"Vale de caja"**: concepto, monto, quien recibe, y foto o archivo del respaldo opcional.
- Si no existen, se construyen con esa definición.
- Los vales afectan el efectivo esperado del arqueo y salen en el cierre.

### A3. Autorización de descuentos

**Topes:**
- Cada producto y servicio del catálogo puede tener un **porcentaje máximo de descuento**.
- Cada rol tiene un **tope general** de descuento: por ejemplo, recepción 5 %, médico 10 %, administrador sin tope.
- Vale el menor de los dos.

**Autorización:**
- Un descuento por encima del tope requiere **autorización** de un usuario con permiso.
- La autorización se da en la misma pantalla, con el usuario autorizador y su verificación por PIN de autorización o su sesión, sin compartir contraseñas.
- Si el autorizador no está presente, se puede dejar una solicitud pendiente que el administrador aprueba desde la campana de notificaciones.
- Todo descuento queda registrado con su motivo, quién lo aplicó y quién lo autorizó.

**Motivos:**
- El motivo se elige de un catálogo por clínica. Cada motivo se mapea al **código de descuento de la v4.4**, según la documentación oficial, que el comprobante necesita.
- Así el comprobante sale con el código correcto sin que el cajero lo conozca.

### A4. Comisiones de tarjeta y conciliación con el datáfono

**Comisiones:**
- Configuración por clínica de la **comisión por banco y tipo de tarjeta** (débito, crédito y, si aplica, marca), con vigencia desde una fecha.
- Cada cobro con tarjeta guarda su comisión estimada y el neto esperado. Ese es el **costo financiero** que usará la rentabilidad (sección 8.3 de la guía).

**Conciliación:**
- En el cierre de caja, el bloque de tarjetas, que ya compara contra el cierre del datáfono BAC, registra los totales del lote del datáfono (cantidad y monto por tipo de tarjeta).
- Muestra la diferencia contra el sistema, cobro por cobro cuando hace falta encontrarla.
- Exige una justificación para cerrar con diferencia.

**Más adelante:**
- Debe quedar preparado un lugar para conciliar contra el **depósito real del banco** (neto de comisiones), aunque la carga del estado de cuenta bancario **no se construye ahora**.

### A5. Datos de comisiones de personal (captura ahora, cálculo en el 11)

Las reglas y la liquidación de comisiones son del prompt 11 (administración completa: honorarios y comisiones), y su efecto en la rentabilidad, del 10. Para que puedan calcular sobre la historia real, cada cargo registra desde ya:

- **Quién realizó el servicio o la venta.** Por defecto, el médico de la atención o el usuario de la venta. Es editable por línea, porque en una misma cuenta pueden intervenir el médico, el groomer y el anestesista.
- **Quién refirió**, opcional. Es otro médico o funcionario que derivó el caso.

Los dos datos viajan al cobro y quedan disponibles para consultas. Si los cargos del 08 ya tienen el ejecutor, solo se agrega el referente.

---

## Parte B — Facturador (09b)

**Regla general de esta parte:** todo dato fiscal sale de la documentación oficial vigente de Hacienda (TRIBU-CR, anexos y estructuras v4.4) y de las normas publicadas. Si algo no se puede confirmar en la fuente oficial, no se construye: se anota en el informe con la referencia buscada.

### B1. Actividad económica por comprobante

- Un emisor puede tener **varias actividades económicas** registradas. Medicavet tiene dos: venta al por mayor de productos farmacéuticos y veterinarios, y actividades veterinarias.
- **Al emitir**, la actividad se elige así:
  - una predeterminada por **línea de negocio** o por categoría del catálogo (por ejemplo, farmacia y alimentos usan la de venta, y los servicios clínicos y el grooming usan la veterinaria);
  - una predeterminada del emisor si no hay regla;
  - y siempre se puede cambiar manualmente en la pantalla de emisión.
- Las actividades del emisor se pueden cargar y validar con la consulta pública de contribuyentes de Hacienda. Se usa el mismo proveedor del anexo del 03 (sección B2), simulado en desarrollo.
- Se verifica qué dice la documentación oficial sobre comprobantes con líneas de distinta actividad. Si un comprobante solo admite una actividad, el sistema lo hace cumplir: avisa y propone separar la cuenta en dos comprobantes.
- **Varios emisores por tenant** (por ejemplo, la sociedad actual y otra): se verifica si el facturador del 09a ya lo soporta. Si no, **no se construye ahora**; se documenta en el informe qué implicaría.

### B2. Recepción de comprobantes de proveedores

**Entrada del comprobante:** en esta versión, por **carga manual**: el usuario arrastra el XML del proveedor (y, opcionalmente, su PDF y la respuesta de Hacienda) a la bandeja. Se aceptan varios archivos a la vez. El **buzón de correo automático** (una dirección a la que los proveedores envían sus facturas) **no se construye ahora**. Se deja la carga detrás de una interfaz que permita agregar el buzón después, y se documenta cómo se haría en `docs/facturacion/recepcion-comprobantes.md`.

**Procesamiento:**
- Se valida la estructura y la firma.
- Se verifica que el receptor sea la clínica.
- Se detectan duplicados por clave.
- Se consulta el estado en Hacienda: en desarrollo, con el proveedor simulado.
- El comprobante queda en una bandeja.

**Bandeja:**
- Lista de comprobantes recibidos con su estado: nuevo, aceptado, aceptado parcialmente, rechazado, registrado en inventario.
- Indicadores: pendientes de responder y plazo que vence.
- Filtros por proveedor, fecha y estado.

**Respuesta a Hacienda:**
- Aceptación total, **parcial** o rechazo, con el mensaje receptor que ya existe en el 09a. Se verifica y completa el caso parcial.
- Se respeta el plazo oficial de respuesta, y se avisa antes de que venza.

**Entrada a inventario desde el XML:**
- Cada línea del comprobante se vincula a un producto del catálogo y a una **presentación** (por ejemplo, el proveedor factura "caja x 20").
- El sistema recuerda la **equivalencia proveedor-código-producto-presentación** para las próximas compras: una tabla de equivalencias por proveedor.
- Las líneas sin equivalencia se resuelven a mano una vez, con búsqueda en el catálogo y la opción de crear el producto.
- Se piden el lote y el vencimiento donde el producto los exige.
- Al confirmar, se crea la **compra** con la lógica que ya existe en el 06 (entrada vía `registrarMovimiento` y actualización del costo), ligada al comprobante. Un comprobante no se puede registrar dos veces.
- Si ya existía una orden de compra para ese proveedor, se puede conciliar contra ella.

**Descargas y bitácora:**
- Descarga masiva por período de los XML y PDF emitidos y recibidos, en un zip, para el contador.
- Bitácora de envíos al correo de clientes y proveedores.

### B3. Campos fiscales del producto (v4.4)

- Se agregan al producto los campos que la estructura v4.4 contempla para medicamentos y mercancías, **según la documentación oficial**: **registro sanitario del medicamento**, **forma farmacéutica** (catálogo oficial), **código comercial** (tipo y código) y **partida arancelaria** (solo para exportación).
- Los campos son opcionales en el producto. El comprobante los incluye cuando la estructura los exige para ese tipo de línea, y la validación XSD lo confirma.
- **Fuera de alcance, pendiente de consulta al contador de Medicavet:** el decreto 44863 de precios regulados y el IVA devuelto (que parece aplicar solo a servicios de salud humana). No se investigan ni se construyen en esta entrega.

---

## Manual de usuario

Cada funcionalidad de este prompt se documenta en el **manual de usuario** (`docs/ayuda/`, con el formato de la sección 12 de la guía), escrito para una persona que sabe de veterinaria pero no de administración ni de facturación electrónica. Como mínimo:

- **Presupuestos:** para qué sirven (cotizar una cirugía o un tratamiento antes de hacerlo y cobrar el anticipo sobre un monto claro), cómo se crean desde la atención o la caja, cómo se envían, qué significa cada estado, qué pasa al vencer y cómo se convierten en cargos con el anticipo aplicado.
- **Recepción de comprobantes de proveedores:** qué es el XML que envía el proveedor; por qué hay que **aceptar o rechazar** cada comprobante ante Hacienda (es la base para usar el IVA pagado como crédito en la declaración, con el plazo oficial que corresponda); qué significa una aceptación parcial; cómo se vinculan las líneas a los productos la primera vez y por qué después se vinculan solas; y por qué conviene registrar la compra desde el XML (el costo exacto es la base de los márgenes).
- **Arqueo por denominación, vales, autorización de descuentos, comisiones de tarjeta y conciliación con el datáfono, actividad económica por comprobante y campos fiscales del producto:** cada uno con su para qué, su paso a paso y un ejemplo con números.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador:

- crear un presupuesto desde una atención, enviarlo (simulado), aprobarlo, aceptarlo, convertirlo con su anticipo aplicado y cobrarlo; dejar vencer otro;
- un cierre de caja contando por denominación, con un vale;
- un descuento por encima del tope con autorización inmediata y otro con solicitud pendiente; confirmar el código de descuento en el XML;
- un cobro con tarjeta con su comisión, y un cierre con diferencia en el datáfono que exige justificación;
- un cargo con ejecutor distinto del médico y con referente;
- emitir con cada actividad económica, y una cuenta mixta;
- recibir un comprobante de proveedor por carga manual, aceptarlo (y otro parcialmente) y registrar su entrada a inventario con una equivalencia nueva; recibir otro del mismo proveedor y confirmar que la equivalencia se aplica sola;
- la descarga masiva;
- un producto con registro sanitario y forma farmacéutica, y su línea en el XML validada contra el XSD.

**El informe incluye:**
- la tabla de la sección 0;
- las pantallas nuevas con su camino de clics;
- las migraciones (con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant);
- las fuentes oficiales consultadas para cada dato fiscal, con lo que se confirmó y lo que no;
- lo documentado sin construir: varios emisores, conciliación bancaria, aceptación en línea del presupuesto, conversión parcial, buzón de correo de proveedores, TSE.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
