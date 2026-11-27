# Lo que le deben a la clínica, y el cierre del día

## Para qué sirve

Dos cosas que se hacen todos los días: ver **quién debe y desde cuándo** —y poder recordárselo sin
pelearse— y comprobar que lo que la caja cobró **llegó de verdad al banco**.

## Cuándo se usa

La cobranza, una o dos veces por semana. El cierre, al final de cada día.

## Quién puede usarla

Ver, el administrador y el contador. Mandar recordatorios, marcar SINPE, registrar depósitos y
cerrar el día: quien tenga el permiso *Registrar gastos y pagos a proveedores*. **Cerrar un día con
diferencia** lleva su propio permiso.

---

# Cuentas por cobrar

## Cómo está armada

La lista es **por deudor**, y el deudor es el **receptor de la factura**, que puede no ser el dueño
del paciente: la empresa que paga por el perro de su empleado, el albergue que trae veinte gatos. Si
la lista mostrara dueños de pacientes, la clínica le cobraría al que no debe.

Los saldos **salen de las facturas a crédito** y de los abonos que ya están en Caja: no hay una
segunda lista de saldos que un día diga otra cosa.

## Paso a paso

1. *Finanzas › Cuentas por cobrar*.
2. En el deudor, **Recordar el saldo**.
3. Si querés, agregá una línea propia («Pasá cuando puedas y lo arreglamos»).
4. **Enviar.**

## Qué pasa después

- El recordatorio sale **por el canal que el cliente prefiere** —correo o WhatsApp— y respeta sus
  consentimientos y la franja horaria de la clínica. Si no consintió ninguno, no sale, y la pantalla
  lo dice.
- Queda en la **línea de tiempo** del cliente, como «Recordatorio de saldo».
- Se guarda **cuánto debía** cuando se le avisó: el monto cambia, el recordatorio queda.
- No se le puede volver a recordar antes de los días que la clínica configuró en *Políticas ›
  Días entre recordatorios de saldo* (catorce por omisión).

---

# Cierre del día

## Qué muestra

Todo el dinero del día, de **todas** las sesiones de caja juntas:

- las ventas por medio de pago;
- los **cobros por SINPE, uno por uno**, para marcar los que llegaron a la cuenta;
- el **datáfono**: lo que el lote declara contra lo que se cobró con tarjeta;
- los **depósitos** del efectivo al banco.

## Por qué SINPE se marca uno por uno

Porque un cobro por SINPE que el cliente dijo que hizo y **no hizo** deja un total que cuadra con la
caja y no con el banco. Lo que se concilia es el cobro, no la suma.

## Paso a paso

1. *Finanzas › Cierre del día*, con la fecha.
2. En cada SINPE, **Llegó al banco**.
3. **Registrar un depósito** con el efectivo que se llevó al banco.
4. **Cerrar el día.**

## Un ejemplo con números

El martes la clínica cobró **₡70 000**: ₡25 000 en efectivo, ₡10 000 con tarjeta y ₡35 000 en dos
SINPE.

Al cerrar, el indicador *Falta conciliar* muestra **₡60 000**: los dos SINPE sin marcar más el
efectivo sin depositar. Se marcan los dos SINPE contra el movimiento de la cuenta y se registra el
depósito de ₡25 000. El indicador queda en **₡0** y el día se cierra.

Si uno de los SINPE no hubiera llegado, cerrar el día pediría una **justificación** y el permiso de
cerrar con diferencia: *«El día cierra con una diferencia de ₡20 000. Hace falta una
justificación»*.

## Qué pasa después

- El cierre guarda **los números que vio**, congelados. Una anulación posterior no reescribe lo que
  se cerró.
- Un día **no se cierra dos veces**.
- El mismo SINPE **no se concilia dos veces**: si dos personas marcan la misma lista, el segundo
  recibe un aviso. Contarlo doble haría que el día cuadre por un error doble.
- La diferencia del datáfono **no bloquea el cierre**: ahí la diferencia es del banco y se resuelve
  con el banco.

## Preguntas frecuentes y errores comunes

**«Un depósito necesita la cuenta a la que entró».**
Cargá las cuentas de la clínica en *Finanzas*. Un depósito sin cuenta no se puede conciliar contra
nada.

**La carga automática del estado de cuenta del banco.**
No existe todavía: los SINPE y los depósitos se marcan a mano. El lugar donde se guardan ya está
preparado para el día que la carga automática exista.

**El cliente dice que ya pagó y el saldo sigue ahí.**
El saldo baja con el **abono** registrado en Caja. Si el pago entró por transferencia y nadie lo
registró, el saldo no lo sabe.
