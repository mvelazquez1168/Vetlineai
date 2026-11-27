# La actividad económica del comprobante

## Para qué sirve

Que cada factura declare la actividad económica correcta. Una clínica que además vende alimento y
medicamentos tiene **dos actividades inscritas** ante Hacienda, y facturar la venta de alimento con
la actividad de servicios veterinarios es declarar mal.

## Lo que hay que saber antes

**Un comprobante declara UNA sola actividad.** No es una limitación del sistema: la estructura de
la factura electrónica v4.4 tiene un único campo para la actividad del emisor, y no se puede
repetir.

La consecuencia práctica: **una cuenta con un alimento y una consulta no se puede facturar junta.**

## Cuándo se usa

Se configura una vez. Después el sistema elige solo, y quien cobra solo interviene cuando hay una
cuenta mixta.

## Quién puede usarla

Un administrador de la clínica configura; quien cobra puede cambiar la actividad en la pantalla de
emisión.

## Paso a paso

### Cargar las actividades inscritas

1. **Facturación electrónica** › **Configuración del emisor** › **Actividades económicas**.
2. Por cada una: el **código de seis dígitos** y su descripción. Marque **una** como
   predeterminada.

> Son **seis dígitos exactos**. Un código de cinco hace que Hacienda rechace el comprobante
> completo.

### Decir qué actividad usa cada línea de negocio

En la misma pantalla, por cada línea de negocio (farmacia, pet shop, consulta, cirugía, grooming…),
elija la actividad que le corresponde.

Lo típico: **farmacia y pet shop** → la actividad de venta; **consulta, cirugía, vacunación,
grooming** → la actividad veterinaria.

### Cuando la cuenta mezcla dos

El sistema **no factura** y dice qué hacer: hay que separar la cuenta en dos comprobantes, uno por
actividad.

## Un ejemplo con números

Medicavet tiene inscritas **862100 — actividades veterinarias** y **464901 — venta al por mayor de
productos farmacéuticos y veterinarios**.

- Una cuenta con **consulta ₡25 000 + vacuna ₡15 000** sale con **862100**.
- Una cuenta con **un saco de alimento ₡25 000** sale con **464901**.
- Una cuenta con **la consulta y el saco** no sale: *«Esta cuenta mezcla 2 actividades económicas
  (464901, 862100) y un comprobante solo puede declarar una. Hay que separarla en dos
  comprobantes»*.

## Qué pasa después

- El comprobante guarda **con qué actividad salió**. Cambiar la configuración después no reescribe
  lo ya emitido.
- Mientras no se configure nada, todo sale con la actividad que la clínica ya tenía: el
  comportamiento no cambia hasta que alguien cargue la segunda.
- Un cargo **sin línea de negocio** —un cargo manual sin clasificar— no parte la factura en dos: cae
  en la actividad que resuelva el resto.

## Preguntas frecuentes y errores comunes

**«Esta cuenta mezcla 2 actividades económicas».**
Separe la cuenta: cobre primero los productos y después los servicios, o al revés. Son dos
comprobantes porque la estructura de Hacienda no admite otra cosa.

**¿Y si facturo todo con una sola para no complicarme?**
Se puede —la actividad se elige a mano en la emisión— pero es declarar ingresos en la actividad
equivocada, y eso lo revisa Hacienda cruzando las ventas con la actividad inscrita.

**La actividad que necesito no está en la lista.**
Solo se pueden usar las que el contribuyente tiene **inscritas**. Si falta, primero se inscribe
ante Hacienda y después se carga acá; el sistema rechaza una actividad que el emisor no tiene.

**¿Qué pasa con la actividad del receptor?**
La estructura tiene un campo opcional para la actividad del receptor, que sirve para su crédito
fiscal. Todavía no se usa.
