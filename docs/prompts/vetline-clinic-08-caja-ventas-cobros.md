# Vetline Clinic 08 — Caja, ventas y cobros

## Contexto

Módulo `ventas` de Vetline Clinic, en este mismo repositorio y backend. Rige la guía rectora
(`docs/prompts/vetline-clinic-00-guia-rectora.md`), en especial las reglas de integridad de dinero
de la sección 2.

Se apoya en lo ya construido: el **facturador** (`vetline-clinic/facturador-cr`), que emite los
comprobantes por su API; el **inventario** (prompt 06), cuyo punto único de movimientos descarga lo
vendido; y `propietarios` como única tabla de clientes. La venta de mostrador mínima que dejó el
prompt 06 se reemplaza por la caja real.

Trabajá en una rama nueva creada a partir de la rama del prompt 06 terminada. Construí sin pedir
confirmación. Parás solo ante una contradicción con el código o con la normativa, una decisión
irreversible sobre datos existentes o un trabajo mucho mayor al supuesto. No se toca producción, no
se envía nada a Hacienda real y no salen correos reales.

### Cómo trabaja Medicavet hoy (requisitos del cliente)

- Una sola caja. Cobra la recepcionista o la doctora.
- Datáfono del BAC San José: el cajero digita el monto en el datáfono y registra el pago a mano en
  el sistema. No hay integración con el datáfono.
- Imprime el tiquete de caja en impresora térmica y envía la factura electrónica.
- Algunos clientes se llevan productos o servicios y pagan después.
- Cobra anticipos, sobre todo en cirugías y en encargos de alimentos o medicamentos especiales.
- Recibe dólares.

---

## 1. Cajas y sesiones

- **Cajas configurables:** la clínica crea las cajas que necesite, con nombre, la bodega de la que
  descuentan inventario y la terminal de Hacienda que usan para el consecutivo. Medicavet empieza
  con una.
- **Cajas compartidas:** una sesión de caja abierta puede ser operada por varias personas; cada
  cobro registra quién lo hizo.
- **Apertura:** fondo inicial en colones y en dólares, por quien abre.
- **Cierre con arqueo** por medio de pago, como lo pidió el cliente:

  | Medio | Esperado (lo calcula el sistema) | Declarado (lo ingresa el cajero) |
  |---|---|---|
  | Efectivo en colones | Fondo + cobros − vueltos ± movimientos de efectivo | Lo contado (con conteo opcional por denominación) |
  | Efectivo en dólares | Fondo + cobros en USD ± movimientos | Lo contado |
  | Tarjetas | Suma de cobros con tarjeta | Total del cierre del datáfono BAC |
  | SINPE Móvil | Suma de cobros por SINPE | Total confirmado |
  | Otros | Transferencias y demás medios | Total confirmado |

  Cada diferencia lleva justificación. Una diferencia que supere un umbral configurable requiere
  aprobación de un administrador para cerrar la caja. El cierre queda inmutable y alimenta la
  conciliación de finanzas.
- **Movimientos de efectivo que no son ventas:** retiro a caja fuerte, ingreso de cambio y pago
  menor de caja chica (con categoría de gasto, que finanzas tomará después, y foto opcional del
  respaldo). Todos con motivo y responsable; el arqueo los considera.

## 2. Ventas y cuentas

- **Venta de mostrador:** búsqueda de producto por nombre o código, y lector de código de barras
  (que funciona como teclado); vende cualquier presentación del inventario (la caja entera o la
  tableta suelta) con su precio y la lista de precio que corresponda; muestra la existencia y
  advierte si no alcanza.
- **Cuentas:** una cuenta agrupa cargos de un cliente. Los cargos pueden venir de la venta de
  mostrador, de cargos manuales, y más adelante de la atención (prompt 07). Diseñá la entrada de
  cargos como un punto único con referencia a su origen, para que la atención la use sin cambiar la
  caja.
- **Cuentas abiertas:** una cuenta puede quedar abierta varios días acumulando cargos (por ejemplo,
  una hospitalización) y un cliente con varias mascotas puede cobrarse en una sola cuenta, con cada
  línea indicando a qué mascota corresponde.
- **Descuentos** según la política: dentro del máximo se aplican directo; por encima, piden
  autorización de un administrador. Cada descuento lleva su naturaleza para el comprobante.

## 3. Cobros

- **Medios:** efectivo (colones o dólares), tarjeta (con número de autorización del datáfono, que
  el cajero digita), SINPE Móvil (con número de referencia), transferencia y otros. Un cobro puede
  combinar varios medios (pago mixto).
- **Dólares:** el tipo de cambio del día lo registra un administrador (con la referencia del Banco
  Central como sugerencia si hay una fuente oficial accesible; si no, carga manual). El cobro en
  dólares se convierte al tipo del día y el vuelto se da en colones. El comprobante sigue en colones
  salvo que el cliente pida factura en dólares.
- **Pagos parciales:** una cuenta puede pagarse en varios cobros.
- **Comprobante al cobrar:** factura electrónica a nombre del cliente o tiquete, emitido por la API
  del facturador, e impreso y enviado según la elección del momento.

## 4. Crédito, abonos y anticipos

- **Crédito a clientes:** un cliente puede tener crédito habilitado, con límite y plazo en días. La
  venta a crédito se emite con la condición de venta y el plazo que correspondan según el Anexo
  4.4. Si la venta supera el límite disponible, se pide autorización.
- **Cuenta corriente del cliente:** saldo, facturas pendientes con antigüedad y vencimiento, y
  abonos. Un abono se aplica a una o varias facturas y genera el documento que exige Hacienda para
  pagos sobre ventas a crédito (por ejemplo, el recibo electrónico de pago). Confirmalo con la
  documentación oficial.
- **Anticipos:** se registran como saldo a favor del cliente, ligados opcionalmente a una cirugía o a
  un encargo, y se aplican a la cuenta final. **Cómo se documenta fiscalmente un anticipo** (si se
  emite comprobante al recibirlo, cuál, y cómo se refleja al aplicarlo) se determina con la
  documentación oficial de Hacienda; si no es concluyente, se implementa la opción más conservadora,
  se documenta y se deja marcado para que el contador lo confirme.
- **Encargos especiales:** alimentos o medicamentos que se piden para un cliente. Registro del
  encargo (producto, cantidad, cliente, anticipo), estados (pendiente, pedido al proveedor, recibido,
  avisado, entregado, cancelado), vínculo con la orden de compra del inventario, reserva del stock al
  recibirlo para que no se venda a otro, y aviso al cliente cuando llega (por el canal que el CRM
  provea; mientras no exista, queda la tarea visible en caja).

## 5. Devoluciones y anulaciones

- **Anulación de un cobro o de un comprobante:** el cajero la solicita con motivo y **un
  administrador la aprueba** antes de que se aplique. Un comprobante emitido se anula con nota de
  crédito por el facturador; el dinero se revierte por el medio correspondiente.
- **Devolución de productos:** con la misma aprobación; el producto vuelve a su lote por el punto
  único de movimientos.
- Todo queda auditado: quién pidió, quién aprobó, cuándo y por qué.

## 6. Impresión

- **Tiquete de caja para impresora térmica de 80 mm**, desde el navegador con una plantilla de
  impresión dedicada: datos de la clínica, líneas, impuestos, medios de pago, vuelto, clave y
  consecutivo del comprobante electrónico si existe, y un QR si el facturador lo genera. Al cobrar,
  el diálogo de impresión se abre solo si la caja lo tiene configurado.
- Reimpresión de cualquier tiquete.

## 7. Contingencia sin internet

- **Conexión de respaldo:** documentá en `docs/operacion/contingencia-caja.md` la recomendación de
  una conexión de respaldo (router con chip 4G o hotspot) como primera línea.
- **Talonario de comprobantes provisionales:** el sistema genera un formulario imprimible y
  prenumerado de comprobante provisional para usar en papel si no hay conexión.
- **Regularización:** una pantalla para registrar las ventas hechas en contingencia, con su fecha y
  hora real y el número del provisional. Cada una emite el comprobante electrónico con el código de
  referencia que el Anexo 4.4 prevé para sustituir un comprobante provisional por contingencia
  (confirmalo con la documentación oficial), descarga el inventario y entra en la sesión de caja
  correspondiente.
- La caída de Hacienda (con internet) ya la resuelve el facturador con su cola de contingencia.

## 8. Previsto, no construido

- **Canje de beneficios de fidelización** (sesiones de paquetes, beneficios de planes, puntos):
  dejá los medios de pago y las líneas de la cuenta extensibles para que se agreguen sin cambiar el
  modelo. No se construye la lógica.
- **Link de pago a distancia:** fuera de alcance.

## 9. Reportes

Con el sistema de diseño ampliado, filtros, `SelectorPeriodo` y exportación a Excel y PDF:

- Ventas por cajero, por medio de pago, por línea de negocio y por caja.
- Arqueos y diferencias en el tiempo, por cajero.
- Anulaciones, devoluciones y descuentos, por persona que los pidió y que los aprobó.
- Cuentas por cobrar con antigüedad, anticipos pendientes de aplicar y encargos abiertos.

## 10. Interfaz

Bajo `requiereModulo('ventas')`. La pantalla de cobro es la más usada de la clínica: rápida, con
atajos de teclado (buscar producto, cobrar, cambiar medio de pago), el total siempre visible y el
vuelto calculado en grande. Pantallas: caja del día (sesión, cuentas abiertas, cobros), cobro,
apertura y cierre con arqueo, movimientos de efectivo, cuenta corriente del cliente, encargos,
regularización de contingencia, aprobaciones pendientes y reportes.

Hasta que exista el prompt de administración base, los permisos de cobrar, anular y aprobar se
resuelven con los roles actuales (médico y administrador), dejando cada permiso con nombre propio
para asignarlo después al rol de caja.

---

## Verificación

- Abrir caja con fondo en colones y dólares; vender en mostrador una caja y una tableta suelta;
  cobrar con pago mixto (efectivo en dólares con vuelto en colones, más tarjeta); cerrar con arqueo
  por los cinco medios y una diferencia justificada; una diferencia sobre el umbral no cierra sin
  aprobación.
- Dos personas cobrando en la misma sesión; cada cobro con su responsable.
- Venta a crédito dentro del límite; otra sobre el límite que pide autorización; abono parcial a dos
  facturas con su documento fiscal.
- Anticipo de una cirugía aplicado a la cuenta final; encargo con anticipo que llega, reserva stock,
  se avisa y se entrega.
- Cuenta abierta de hospitalización con cargos de tres días y dos mascotas en una sola cuenta.
- Una anulación no se aplica sin aprobación de un administrador; al aprobarse, sale la nota de
  crédito y el stock vuelve al lote.
- Tiquete térmico generado con todos sus datos.
- Venta en contingencia regularizada con la referencia correcta, validando el XML contra el XSD.
- Ningún cargo se cobra dos veces; un cierre de caja no se puede modificar desde la base.
- La auditoría de RLS pasa limpia y los verificadores existentes siguen en verde.

## Reporte

En `docs/reportes/`: lo construido, lo verificado con resultados, cómo quedó la documentación fiscal
de anticipos y abonos con su fuente oficial, lo que no se pudo y por qué, y las decisiones que
tomaste solo. Al terminar, sembrá datos de demostración en la clínica del usuario de demostración y
pasá las URL de cada pantalla.
