# Estudios de laboratorio

## Para qué sirve

Pedir un hemograma, una química o una radiografía **desde la consulta**, en vez de tener que ir a
otra pantalla. La orden queda ligada a esta atención, así que después se sabe por qué se pidió.

## Cuándo se usa

En el momento de decidirlo, durante la consulta. El resultado se carga más tarde, en la pestaña
**Laboratorio** del expediente, y el sistema avisa hasta que un médico lo marque como visto.

## Quién puede usarla

Solo un **médico** pide el estudio. Quien cargue el resultado después puede ser otra persona.

## Paso a paso

1. **Pacientes** › la ficha del paciente › pestaña **Atención actual**.
2. En **Lo realizado**, clic en **Estudio** (atajo **Alt+E**).
3. Escriba qué estudio es.
4. Si se manda afuera, marque **Se envía a un laboratorio externo** y escriba a cuál.
5. Si se hace en la clínica y se cobra, elija el **servicio del catálogo** que le corresponde.
6. **Pedir**.

## Un ejemplo con números

A Toby se le pide un **hemograma completo**, que se hace en la clínica y está en el catálogo como
servicio *Hemograma* a **₡12 000**. Al pedirlo, los ₡12 000 entran a la cuenta igual que una
consulta o una vacuna.

Si en cambio se envía a *Laboratorio Clínico Veterinario XYZ*, no se elige servicio: lo que se
cobra en ese caso es el envío, y eso se agrega aparte como servicio.

## Qué pasa después

- La orden queda en la pestaña **Laboratorio** del paciente, en estado *solicitado*.
- Si eligió un servicio, su [cargo](glosario.md#cargo) entra a la cuenta del cliente al cerrar la
  atención.
- Cuando llegue el resultado, se carga en esa misma pestaña. Mientras no esté revisado, el
  expediente lo muestra como pendiente en la franja de alertas de arriba.

## Preguntas frecuentes y errores comunes

**«Un estudio externo lleva a qué laboratorio se envió».**
Si marcó que va afuera, el nombre del laboratorio es obligatorio: sin eso, dentro de un mes nadie
sabe a quién reclamarle el resultado.

**No me deja elegir un servicio para un estudio externo.**
Es a propósito. Si se hace afuera, lo que la clínica cobra no es el estudio sino el envío o la
toma de muestra, y mezclarlos haría que después nadie supiera cuál de los dos se cobró. Agregue
ese servicio con la acción **Servicio**.

**Pedí el estudio y no veo el cargo en caja.**
Los cargos entran a caja **al cerrar la atención**, no antes. Vea
[Cerrar la atención](atencion-cierre.md).
