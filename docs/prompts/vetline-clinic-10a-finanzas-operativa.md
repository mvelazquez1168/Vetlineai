# Vetline Clinic — 10a · Finanzas, parte operativa

Rama: `vetline-clinic/10a-finanzas-operativa`, que parte de la rama del 04. Se rige por `vetline-clinic-00-guia-rectora.md`: sección 8.2 para el contenido y sección 12 para la forma de trabajo. Usa el módulo `finanzas` que agrega el 04.

## Por qué existe

Hoy Medicavet registra en Digital Vet las facturas de sus proveedores, lo que les debe, sus pagos y sus gastos. Para dejar ese sistema hace falta, como mínimo, saber **qué se debe, a quién, cuándo vence y qué se pagó**, registrar los gastos de operación y ver lo que deben los clientes. El 09b ya trae la recepción de comprobantes de proveedores y el 06 las compras. Este prompt cierra el ciclo del dinero que sale.

**Fuera de alcance**, en el 10b: estado de resultados por línea, flujo de caja proyectado, presupuesto contra real, IVA del período y análisis de rentabilidad (sección 8.3). Los reportes se definirán con Medicavet.

**Regla central** (sección 8.2): **finanzas consolida, no recaptura.** Toda cifra sale de una fuente que ya existe: comprobantes recibidos, compras, cobros, movimientos de caja. Un dato que ya está en el sistema no se vuelve a escribir. Lo que mueve dinero cumple las reglas de integridad de la sección 2.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y se reutiliza:

- proveedores (06) y su ficha;
- compras recibidas (06);
- la bandeja de comprobantes recibidos y su aceptación (09b);
- las cuentas por cobrar, los abonos y los anticipos del 08 (y su reporte);
- los vales de caja (08b);
- las monedas y el tipo de cambio que ya usa el sistema.

## 1. Cuentas por pagar

**Origen:**
- Una cuenta por pagar **nace** de un comprobante de proveedor aceptado (total o parcialmente) en la bandeja del 09b, o de una compra recibida sin comprobante electrónico todavía (proveedor informal o factura pendiente). En este último caso, la cuenta queda marcada "sin comprobante" y se concilia cuando el comprobante llega.
- **No se registra dos veces:** un comprobante y una compra que corresponden a lo mismo quedan ligados en una sola cuenta.
- Las **notas de crédito de proveedor** recibidas reducen la cuenta a la que se refieren.

**Datos:** proveedor, documento, fecha, **vencimiento** (según la condición de crédito del proveedor: contado, 15, 30 o 60 días, configurable en su ficha), moneda original, monto, saldo y estado (pendiente, parcial, pagada, vencida). La aceptación parcial del 09b se refleja en el monto exigible.

**Moneda:** una cuenta en dólares conserva su saldo en dólares. Al pagar se registra el tipo de cambio aplicado (por defecto, el de referencia del BCCR del día, editable), y la diferencia cambiaria queda registrada para el contador.

**Pantalla Finanzas › Cuentas por pagar:**
- indicadores: total por pagar, vencido, vence en 7 días y vence en 30 días;
- lista con filtros por proveedor, estado y vencimiento;
- antigüedad por tramos (al día, 1–30, 31–60, más de 60 días);
- **calendario de pagos** por semana.

Desde cada cuenta se llega a su comprobante, su compra y sus pagos.

## 2. Pagos a proveedores

**El pago:**
- Un pago se registra contra **una o varias cuentas** del mismo proveedor, total o parcial.
- Datos: fecha, medio (transferencia, SINPE, cheque, efectivo, tarjeta de la clínica), cuenta bancaria de origen (catálogo simple de cuentas de la clínica), referencia y comprobante adjunto opcional (foto o PDF de la transferencia).
- **Un pago en efectivo desde la caja abierta** genera su vale o salida de caja por la puerta que ya existe en el 08/08b, ligado al pago, para que el arqueo lo descuente. No se registra el efectivo en dos lugares.

**Corrección:** un pago se **anula** (no se borra), con motivo y permiso, y la cuenta recupera su saldo.

**Anticipos a proveedores:** no se construyen ahora. Se documentan en el informe.

## 3. Gastos operativos

**Categorías:** un catálogo por clínica con valores iniciales: alquiler, electricidad, agua, internet y teléfono, planilla, cargas sociales, mantenimiento, limpieza, publicidad, servicios profesionales, laboratorio externo, comisiones bancarias, otros.

**Origen:**
- **Los comprobantes recibidos que no son de inventario** (luz, internet, mantenimiento, publicidad) se clasifican como gasto desde la misma bandeja del 09b, con la acción "Registrar como gasto". **No se retipean.** Generan su cuenta por pagar si no vienen pagados.
- El sistema recuerda la categoría por proveedor, para sugerirla la siguiente vez.
- Los **gastos sin comprobante electrónico** (por ejemplo, planilla o un pago a una persona física sin factura) se registran a mano, con su respaldo adjunto. Quedan marcados "sin comprobante", para que el contador sepa cuáles no tienen soporte fiscal.

**Asignación:** cada gasto puede asignarse a una **línea de negocio** cuando es directo (el champú de grooming va a grooming), o quedar como **general**. El 10b usará esa asignación.

**Recurrentes:**
- Un gasto puede definirse como **recurrente** (el alquiler mensual), y cada período genera su gasto pendiente con el monto estimado.
- Cuando llega el comprobante real se **concilia** con el pendiente, sin duplicarlo, y se ajusta el monto si cambió.

**Pantalla Finanzas › Gastos:** indicadores del mes (total, por categoría con un gráfico de la paleta de datos, contra el mes anterior), lista con filtros, y la acción de registrar un gasto.

## 4. Cuentas por cobrar y cobranza

El 08 ya maneja crédito, abonos y anticipos, y tiene su reporte. Aquí se agrega la vista de gestión. Los saldos **salen de las cuentas del 08**: no hay una segunda tabla de saldos.

**Pantalla Finanzas › Cuentas por cobrar:**
- indicadores: total por cobrar, vencido y clientes con saldo;
- antigüedad por tramos;
- lista por **deudor**. Recordar la regla del 08: en crédito, el deudor es el receptor de la factura, que puede ser distinto del dueño del paciente.

**Cobranza amable:**
- Desde la lista o desde la ficha del cliente, se envía un **recordatorio de saldo** por WhatsApp o correo, con una plantilla editable.
- El envío pasa por `emitirNotificacion` y `puedeEnviar()`, con el propósito "transaccional/cuenta", y respeta los consentimientos y el tope.
- Cada recordatorio queda en la línea de tiempo del CRM.
- Una política del 04 define cada cuántos días se puede volver a recordar al mismo deudor.

**Contexto en la atención:** el aviso "El cliente tiene ₡X pendiente" que ya aparece en la ficha del paciente sale de la misma fuente.

## 5. Cierre diario consolidado

**Pantalla Finanzas › Cierre del día**, una sola vista por fecha:
- ventas por medio de pago (de todas las sesiones de caja del día);
- conciliación con el datáfono (la del 08b);
- **SINPE Móvil:** la lista de cobros por SINPE del día, para marcar uno por uno contra lo recibido en la cuenta bancaria. Queda la marca de conciliado y quién la hizo.
- **Depósitos de efectivo al banco:** monto, cuenta, fecha y comprobante, contra el efectivo de los cierres.

Las diferencias se señalan, y cerrar el día con una diferencia exige una justificación. **La carga automática del estado de cuenta bancario no se construye**: queda documentada como mejora.

## 6. Exportación para el contador

Desde Finanzas, se exporta a Excel (y CSV) por período, con columnas fijas y documentadas en `docs/finanzas/exportacion-contable.md`:
- ventas (comprobantes emitidos);
- compras y gastos (comprobantes recibidos y gastos sin comprobante);
- pagos a proveedores;
- cobros;
- movimientos de inventario valorizados.

Se reutiliza `MenuExportar`. El formato exacto de importación de un software contable específico **no se construye ahora**: se documenta qué haría falta.

## Permisos

- **Ver** finanzas: el administrador y el rol contador (solo lectura).
- **Registrar** gastos y pagos: el administrador y quien tenga el permiso `finanzas.registrar`. El 04 lo agrega a la matriz como configurable.
- Anular un pago y cerrar el día con diferencia requieren permisos específicos.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador:

- aceptar en la bandeja un comprobante de proveedor a 30 días y ver nacer su cuenta por pagar con el vencimiento correcto;
- aceptar otro parcialmente;
- pagar dos cuentas del mismo proveedor con una transferencia, y otra en efectivo desde la caja abierta (comprobando que el arqueo la descuenta);
- una cuenta en dólares pagada con su tipo de cambio;
- anular un pago;
- clasificar un recibo de electricidad como gasto desde la bandeja, y ver la sugerencia de categoría en el siguiente del mismo proveedor;
- definir el alquiler como recurrente y conciliarlo con su comprobante;
- enviar un recordatorio de saldo (simulado) a un deudor que no es el dueño del paciente;
- cerrar el día conciliando dos cobros por SINPE y un depósito;
- la exportación del mes.

El informe incluye la tabla del relevamiento, las pantallas nuevas con su camino de clics, las migraciones (con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant), las invariantes de dinero en la base (un saldo nunca negativo; una cuenta no puede pagarse por encima de su saldo) y lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
