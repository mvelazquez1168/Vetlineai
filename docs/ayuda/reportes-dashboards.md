<!-- ayuda ruta=/reportes permisos=reportes.ver -->
# Los reportes: cómo va la clínica

## Para qué sirve

Saber en un minuto cómo va la clínica, y poder preguntarle a cualquier número de dónde salió.

Cada tarjeta y cada barra se puede abrir: se ve **la lista de los registros que la componen**, y esa
lista suma exactamente el número de la tarjeta. Si los ingresos dicen ₡1 250 000, la lista de
comprobantes suma ₡1 250 000.

## Cuándo se usa

- Cada mañana, para ver el día y la semana.
- A fin de mes, para comparar con el mes anterior.
- Cuando un número no cuadra con lo que esperabas: se abre y se ve qué lo compone.

## Quién puede usarla

- **El dashboard de la clínica y la comparativa entre médicos:** quien tenga el permiso **Ver
  reportes** (el administrador, y quien él decida).
- **El dashboard del médico:** cada médico ve **el suyo** sin necesidad de ningún permiso. Para ver
  el de otro médico hace falta **Ver reportes**.
- **Los márgenes y los costos** aparecen solo con el permiso **Ver costos**. Sin él, los ingresos se
  ven y el margen no: no es que se oculte el bloque por prolijidad, es que el dato no sale del
  servidor.

## Paso a paso

1. **Reportes** en el menú de Administración.
2. Pestaña **Clínica** o **Médicos**.
3. Elegí el período arriba: hoy, 7 días, mes, trimestre, año o personalizado. Al lado está la
   comparación contra el período anterior, que es de dónde sale el «+12 %» de cada tarjeta.
4. **Tocá cualquier tarjeta o cualquier barra** para ver la lista que la compone.
5. En la lista, el botón **Ver →** de cada fila lleva al registro: el comprobante, la atención, la
   cita o el cliente.
6. **Descargar Excel** o **Descargar PDF**, arriba a la derecha, exporta lo que estás viendo con el
   mismo período y los mismos filtros.

## Un ejemplo

Es el 1.º de diciembre. Entrás a Reportes con el período en **Mes** y ves:

- **Ingresos: ₡4 120 000**, con **+18 % vs. período anterior**;
- **Cargos fugados: ₡310 000**, con «19 cargos sin cobrar».

Tocás *Cargos fugados* y aparece la lista de los 19: cada uno con su cuenta, su cliente, su paciente
y su monto. Suman ₡310 000. Son consultas que se cerraron y nunca se cobraron, así que las abrís una
por una y las cobrás. Esa plata ya estaba hecha.

## Qué pasa después

- **Nada se modifica.** Los reportes son de solo lectura.
- **Cada exportación queda registrada** en la auditoría: quién la bajó, cuándo, de qué período y en
  qué formato.
- El PDF sale con el logo y el color de la clínica, el período, los filtros, la fecha y el nombre de
  quien lo generó.

## Preguntas frecuentes y errores comunes

**¿Dónde veo cómo viene el mes?**
Acá: **Reportes › Clínica**, con el período en **Mes**. Es el tablero de indicadores de la clínica
—ingresos, atenciones, ocupación, deuda— con la comparación contra el mes anterior.

**El total de la tarjeta no es igual a la suma de la lista.**
No debería pasar nunca: las dos salen del mismo cálculo y hay una verificación automática que lo
comprueba. Si lo ves, es un defecto y conviene reportarlo con el período exacto.

**«Cuentas por cobrar» no cambia cuando cambio el período.**
Es correcto y la tarjeta lo dice: **es el saldo de hoy**. Lo que se debe, se debe hoy; no tiene
sentido preguntar «cuánto me debían en marzo».

**La ocupación dice «falta configurar el horario de la clínica».**
La ocupación es *minutos citados ÷ minutos que la clínica abre*. Sin horario configurado no hay
divisor, y mostrar 0 % diría «la agenda está vacía» cuando lo que pasa es que falta el horario. Se
configura en **Administración › Horario y feriados**.

**Un producto aparece con «sin costo» en lugar de un margen.**
Es a propósito. Si el producto no tiene costo cargado, su margen no se puede calcular; mostrarlo
como 100 % de margen sería inventar que no costó nada. El aviso de arriba del bloque dice cuántos
ítems están así, y se arregla cargando el costo en el inventario.

**No me aparece el bloque de campañas.**
Aparece cuando haya campañas con datos. Un bloque que dice «0» ocupa el lugar de algo que informa.

**¿Qué quiere decir exactamente cada número?**
Tocá el **ⓘ** de la tarjeta: muestra la definición en lenguaje simple, la fórmula, lo que **no**
cuenta y a qué fecha se imputa. Están todas juntas en `docs/metricas/diccionario.md`.
