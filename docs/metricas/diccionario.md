# Diccionario de métricas de Vetline Clinic

**Este archivo se genera.** Sale de `backend/src/metricas/diccionario.ts` con
`escribir_diccionario_metricas.ts`; no se edita a mano. Si una definición hay
que cambiarla, se cambia en el código —que es lo que calcula el número— y se
vuelve a generar.

Cada métrica está definida **una sola vez** y el mismo cálculo alimenta la
tarjeta del dashboard, el gráfico, la lista del drill-down y la exportación. La
verificación que lo sostiene es una: **la suma de la lista es igual al número de
la tarjeta** (`verificar_dashboards_12.ts`).

La definición de cada métrica también se ve en la interfaz: el ícono de
información de cada tarjeta muestra la descripción y la fórmula.

## Ingresos

Lo que la clínica facturó en el período, sin el IVA y descontando las notas de crédito.

- **Fórmula:** suma(comprobantes de venta sin IVA) − suma(notas de crédito sin IVA)
- **Se expresa en:** colones
- **Sale de:** fact_comprobantes
- **No cuenta:** los comprobantes rechazados por Hacienda y los anulados; el IVA, que es de Hacienda y está de paso
- **Se imputa a:** la fecha de emisión del comprobante. Es la que el contador usa y la que no cambia si el cliente paga tarde
- **Al tocarla se ve:** los comprobantes del período, con su cliente y su total

## Ticket promedio

Cuánto deja, en promedio, cada cuenta que se cobró.

- **Fórmula:** ingresos ÷ cantidad de cuentas cobradas
- **Se expresa en:** colones
- **Sale de:** fact_comprobantes, vta_cuentas
- **No cuenta:** las cuentas abiertas: todavía no son una venta
- **Se imputa a:** la del ingreso que promedia

## Atenciones

Las consultas que se cerraron y se firmaron en el período.

- **Fórmula:** cantidad de atenciones con estado cerrada
- **Se expresa en:** cantidad
- **Sale de:** atenciones
- **No cuenta:** las atenciones abiertas o a medio escribir: una consulta sin firmar todavía no pasó del todo
- **Se imputa a:** la fecha de cierre, no la de apertura
- **Al tocarla se ve:** las atenciones cerradas, con su paciente y su médico

## Clientes nuevos

Clientes cuya PRIMERA atención o compra cayó en el período.

- **Fórmula:** clientes cuya primera actividad está dentro del período
- **Se expresa en:** cantidad
- **Sale de:** propietarios, atenciones, vta_cuentas
- **No cuenta:** los que se dieron de alta pero nunca vinieron: un cliente cargado en el sistema no es un cliente
- **Se imputa a:** la fecha de su primera actividad real
- **Al tocarla se ve:** los clientes y la fecha de su primera visita

## Ocupación de la agenda

Qué parte del tiempo disponible de la clínica está citado.

- **Fórmula:** minutos citados ÷ minutos disponibles según el horario de la clínica
- **Se expresa en:** porcentaje
- **Sale de:** citas, clinica_horario
- **No cuenta:** las citas canceladas; los días que la clínica no abre
- **Se imputa a:** la fecha de la cita

## Inasistencias

De las citas del período, cuántas no se presentaron.

- **Fórmula:** citas no presentadas ÷ citas del período
- **Se expresa en:** porcentaje
- **Sale de:** citas
- **No cuenta:** las canceladas con aviso: avisar que no se puede venir no es faltar, y contarlas igual castiga al cliente que avisó
- **Se imputa a:** la fecha de la cita
- **Al tocarla se ve:** las citas no presentadas, con su cliente

## Cuentas por cobrar

Lo que los clientes deben hoy, venga del período que venga.

- **Fórmula:** facturas a crédito − abonos aplicados
- **Se expresa en:** colones
- **Sale de:** fact_comprobantes, vta_abono_aplicaciones
- **No cuenta:** lo que se cobró al contado
- **Se imputa a:** no se imputa a un período: es un saldo de HOY. Cambiar el período no lo cambia, y la pantalla lo dice
- **Al tocarla se ve:** los deudores con su saldo

## Cargos fugados

Lo que se registró en una atención ya cerrada y nunca se cobró. Es plata que la clínica hizo y no facturó.

- **Fórmula:** cargos de cuentas abiertas cuya atención ya cerró, más las cuentas abiertas hace más de N días
- **Se expresa en:** colones
- **Sale de:** vta_cargos, vta_cuentas, atenciones
- **No cuenta:** los cargos anulados y las cuentas ya cobradas
- **Se imputa a:** la fecha del cargo
- **Al tocarla se ve:** los cargos sin cobrar, con su cuenta y su paciente, para poder recuperarlos

## Margen de contribución

Lo que queda después de pagar lo que costó: ingresos menos costo directo.

- **Fórmula:** ingresos − costo de los productos que salieron del inventario
- **Se expresa en:** colones
- **Sale de:** vta_cargos, inv_movimientos
- **No cuenta:** los ítems SIN COSTO CARGADO, que se cuentan aparte y nunca como 100 % de margen: eso sería inventar que algo no costó nada
- **Se imputa a:** la del ingreso
- **Requiere el permiso:** `catalogo.ver_costos`
- **Al tocarla se ve:** los cargos con su ingreso, su costo y su margen

## Retención

De los clientes que vinieron en el período anterior, cuántos volvieron en este.

- **Fórmula:** clientes con actividad en los dos períodos ÷ clientes con actividad en el anterior
- **Se expresa en:** porcentaje
- **Sale de:** atenciones, vta_cuentas
- **No cuenta:** los clientes nuevos de este período: no se puede retener a quien todavía no estaba
- **Se imputa a:** la fecha de la actividad

## Las listas del drill-down

| Lista | Reproduce la métrica | Suma la columna |
|---|---|---|
| Comprobantes del período | ingresos | monto |
| Atenciones cerradas | atenciones | —, es un conteo de filas |
| Clientes nuevos | clientes_nuevos | —, es un conteo de filas |
| Citas no presentadas | inasistencias | —, es un conteo de filas |
| Cargos sin cobrar | cargos_fugados | monto |
| Clientes con saldo | por_cobrar | monto |
