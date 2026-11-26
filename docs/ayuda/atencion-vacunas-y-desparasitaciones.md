# Vacunas y desparasitaciones

## Para qué sirve

Dejar registrado, durante la consulta, que se aplicó una vacuna o una desparasitación: **con qué
producto, de qué [lote](glosario.md#lote) y cuándo toca la próxima**. De ese registro salen solos
el cobro, el descuento del inventario, la cartilla del paciente y el aviso al dueño cuando se
acerque la fecha.

Antes había que entrar por «Producto» y marcar una casilla escondida que decía «¿es un
preventivo?». Funcionaba, y nadie la encontraba.

## Cuándo se usa

Durante la consulta, en el momento de aplicarla. Si lo que quiere registrar es algo que se aplicó
**antes de usar el sistema o en otra clínica**, eso va por otro lado: vea
[Registrar algo histórico](registro-historico.md).

## Quién puede usarla

Solo un **médico**. Es contenido clínico y queda firmado con la atención.

## Paso a paso

1. Entre a **Pacientes** en el menú de la izquierda y abra la ficha del paciente.
2. Haga clic en la pestaña **Atención actual**. Si no hay una consulta abierta, el botón
   **Registrar atención** la abre.
3. En el panel **Lo realizado**, a la derecha, haga clic en **Vacuna** (o **Desparasitación**).
   También puede usar el atajo **Alt+V** (o **Alt+D**) sin soltar el teclado.
4. Elija el producto de la lista. **Solo aparecen los que están marcados como vacuna o
   antiparasitario** en el catálogo; si el suyo no está, vea las preguntas frecuentes.
5. Revise los cuatro campos:
   - **Nombre en la cartilla** — lo que va a leer el dueño. Viene con el nombre del producto y se
     puede cambiar.
   - **Lote** — es **obligatorio**. Viene elegido el que vence primero ([FEFO](glosario.md#fefo)),
     que es el mismo del que el sistema va a descontar.
   - **Cantidad** — normalmente una.
   - **Próxima** — viene calculada con el
     [protocolo](glosario.md#protocolo-preventivo) de la clínica y se puede cambiar. Debajo dice de
     dónde salió la fecha.
6. **Registrar**.

## Un ejemplo con números

Toby, canino de 32,4 kg, viene a su control anual el 26 de noviembre de 2026.

- Acción **Vacuna** → *Vacuna polivalente canina — Dosis*.
- Lote sugerido: **VP-2026-B**, el que vence primero.
- Próxima: **26 de noviembre de 2027**, sugerida por el protocolo de la especie (12 meses).
- Precio: **₡14 500**.

Después, acción **Desparasitación** → *Desparasitante interno (praziquantel) — Tableta*, tipo
**interna**, lote **DES-2026-A**, próxima el **26 de febrero de 2027** (3 meses), **₡4 500**.

## Qué pasa después

Mientras la atención está abierta, las dos líneas aparecen en **Lo realizado** con su precio y
todavía no pasó nada. **Al cerrar la atención**:

- Los **₡14 500** y los **₡4 500** entran como [cargos](glosario.md#cargo) a la
  [cuenta](glosario.md#cuenta) del cliente, para que caja los cobre.
- Se descuenta **una dosis del lote VP-2026-B** y **una tableta del lote DES-2026-A**, no de
  cualquier otro.
- Quedan programados los dos avisos: el sistema le escribirá al dueño cuando se acerque cada
  fecha.
- Las dos quedan en las pestañas **Vacunas** y **Desparasitaciones** del expediente, y en la línea
  de tiempo del paciente.

## Preguntas frecuentes y errores comunes

**«No hay vacunas en el catálogo», y sí las hay.**
El producto necesita tener su [tipo clínico](glosario.md#tipo-clínico) puesto. Se arregla en
**Inventario › Catálogo**, abriendo el producto y eligiendo *vacuna* o *antiparasitario*. Sin ese
dato el sistema no tiene cómo saber que una «Polivalente» es una vacuna y no un insumo.

**El producto aparece pero sin lotes.**
No hay existencia. No se puede aplicar lo que no hay: primero se registra la entrada en
**Inventario › Compras** o con un movimiento de inventario.

**¿Puedo cambiar el lote que me sugiere?**
Sí. Pero tenga en cuenta que el número que elija es el que va a quedar en la cartilla **y** el que
se va a descontar: el sistema no deja que digan cosas distintas.

**Dice «No hay protocolo para esto: indique la fecha».**
No hay un protocolo cargado que corresponda. Escriba la fecha a mano; si no, el aviso al dueño no
se dispara nunca. Los protocolos se pueden ampliar para que la próxima vez venga sugerida.

**Me equivoqué y ya cerré la atención.**
Lo firmado no se edita. La corrección es una [adenda](glosario.md#adenda).
