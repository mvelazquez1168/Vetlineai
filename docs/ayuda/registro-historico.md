# Registrar algo histórico

## Para qué sirve

Cargar una vacuna o una desparasitación que se aplicó **antes de empezar a usar el sistema, o en
otra clínica**, para que el expediente del paciente esté completo y los avisos salgan cuando
corresponde.

## Cuándo se usa

Cuando un cliente llega con la cartilla de otra clínica, o al cargar los pacientes que ya tenía
antes de empezar a usar Vetline Clinic.

## Quién puede usarla

Solo un **médico**: es contenido clínico.

## Paso a paso

1. **Pacientes** › la ficha del paciente › pestaña **Vacunas** (o **Desparasitaciones**).
2. Arriba de la lista, clic en **Registrar histórico**.
3. Complete:
   - **Qué se aplicó** — búsquelo en el catálogo, escribiendo dos letras del nombre, el código o
     el principio activo. Si la clínica no vende ese producto —lo normal en una cartilla de otra
     clínica—, toque **Escribir el nombre a mano** y quedará registrado como *fuera del
     catálogo*.
   - **Fecha de aplicación** — no puede ser futura: esto es algo que ya pasó.
   - **Próxima** — con un producto del catálogo se calcula sola, con el
     [protocolo](glosario.md#protocolo-preventivo) **de ese producto** y **contando desde la
     aplicación**, no desde hoy. Con un nombre a mano no hay protocolo que consultar: la fecha la
     escribe usted.
   - **Lote** — opcional, si la cartilla lo trae.
   - **Dónde se aplicó** — la otra clínica, una campaña, el propio dueño.
4. **Registrar**.

## Un ejemplo con números

Hoy es **26 de noviembre de 2026**. El dueño de Toby trae una cartilla que dice que le pusieron la
antirrábica el **10 de mayo de 2026** en una clínica de otro cantón.

Se registra con esa fecha y sin próxima. El sistema calcula la próxima con el protocolo de 12
meses **desde el 10 de mayo**: queda para el **10 de mayo de 2027**, no para noviembre de 2027.
Esa diferencia de seis meses es justamente el punto.

## Qué pasa después

- **Aparece en el acto** en la pestaña **Vacunas** (o **Desparasitaciones**) y en la **línea de
  tiempo** del paciente, con la etiqueta **histórico**.
- Y aparece **con la fecha de la cartilla**, no con la de hoy: una vacuna de 2023 se ordena en
  2023, entre lo que pasó ese año.
- **No genera ningún cargo y no toca el inventario.** Acá no se aplicó nada: no hay nada que
  cobrar ni que descontar.
- El aviso al dueño sí se programa con la próxima fecha, como cualquier otro.
- No cuenta como producción de la clínica en los reportes, porque no lo fue.

## Preguntas frecuentes y errores comunes

**«Un registro histórico es de algo que ya pasó: la fecha no puede ser futura».**
Si lo que quiere es agendar algo, eso no es un histórico. Las próximas fechas se programan solas
al aplicar la vacuna, y las citas se agendan desde la **Agenda**.

**«No hay protocolo para eso, así que la próxima fecha hay que indicarla».**
El nombre que escribió no corresponde a ningún protocolo cargado y no hay uno general para esa
especie. Escriba la próxima fecha a mano; si no, el aviso no se dispara nunca. Eligiendo el
producto del catálogo esto casi no pasa: el protocolo del producto es el más específico y gana.

**¿Para qué sirve elegirlo del catálogo si igual puedo escribirlo?**
Para que el historial y los reportes **agrupen**. «Polivalente», «polivalente» y «Nobivac DHPPi»
son tres filas distintas para cualquier reporte aunque sean el mismo frasco; con el producto
elegido son el mismo producto. Y la próxima fecha sale del protocolo de ese producto, no de uno
general.

**¿Mueve el inventario o cobra algo?**
No, y eso no cambió. Elegir el producto del catálogo sirve para identificarlo; acá no se aplicó
nada, así que no hay cargo ni salida de stock.

**Lo registré y no apareció en la lista.**
Hasta el 27 de noviembre de 2026 pasaba: se guardaba de verdad —el aviso de la próxima dosis
hasta salía— pero la pestaña no lo mostraba, y uno terminaba cargándolo tres veces. Ya está
corregido, y los que se habían cargado así **aparecieron solos**. Si quedaron repetidos de esos
días, se borran desde la misma pestaña.

**¿Para qué sirve la etiqueta «histórico»?**
Para distinguir lo que aplicó esta clínica de lo que el cliente dice que le aplicaron en otro
lado. No es desconfianza: es que una no tiene lote, ni responsable, ni factura, y quien lea el
expediente dentro de dos años tiene que poder saberlo.

**¿Y si la aplicamos nosotros pero me olvidé de registrarla en el momento?**
Entonces no es histórica: es producción de la clínica y debería ir con su cargo y su descuento de
inventario. Regístrela en una atención, aunque sea tarde.
