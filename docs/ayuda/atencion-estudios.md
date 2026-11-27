# Estudios de laboratorio

## Para qué sirve

Pedir un hemograma, una química o una radiografía **desde la consulta**, en vez de tener que ir a
otra pantalla. La orden queda ligada a esta atención, así que después se sabe por qué se pidió.

## Cuándo se usa

Dos momentos distintos, y los dos se hacen desde el mismo lugar:

- **Lo pido ahora y el resultado llega después.** Es el caso del estudio que se manda afuera: la
  orden queda pendiente y el sistema avisa hasta que un médico la marque como vista.
- **El resultado ya está y lo estoy cargando.** Es el caso normal de la clínica: el laboratorio lo
  mandó por correo o el dueño lo trajo en papel. Se carga el estudio **con su archivo** en un solo
  paso, sin tener que pedirlo primero para después completarlo.

## Quién puede usarla

Solo un **médico** pide el estudio. Quien cargue el resultado después puede ser otra persona.

## Paso a paso

1. **Pacientes** › la ficha del paciente › pestaña **Atención actual**.
2. En **Lo realizado**, clic en **Estudio** (atajo **Alt+E**).
3. Escriba qué estudio es.
4. Si se manda afuera, marque **Se envía a un laboratorio externo** y escriba a cuál.
5. Si se hace en la clínica y se cobra, elija el **servicio del catálogo** que le corresponde.
6. **Si ya tiene el resultado** —que es lo que la pantalla asume por omisión—: ponga la **fecha de
   la toma de la muestra** —que no es la de hoy: es el día en que se tomó—, la **interpretación** y
   **adjunte el archivo** (el PDF del laboratorio, o la foto de la placa). Clic en **Registrar**.
7. **Si todavía no lo tiene**: marque abajo *Todavía no tengo el resultado: dejarlo pendiente* y
   clic en **Dejar pendiente**. Al adjuntar el resultado después, **este mismo estudio se cierra**:
   no se crea otro.

### Agregar un archivo a un estudio que ya está

**Pacientes** › la ficha › pestaña **Laboratorio** › el estudio pendiente › cargar el resultado
desde ahí. Se pueden adjuntar **varios** archivos al mismo estudio: el informe y la placa son dos
archivos del mismo estudio, no dos estudios.

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
- Si lo cargó **con el resultado**, el estudio no pasa por pendiente: nace con su archivo y su
  fecha de muestra.
- Los archivos del laboratorio **se guardan en el expediente y no se le mandan al agente de IA**.
  El adjunto de un caso sí, porque el médico lo sube para que el agente lo lea; un resultado de
  laboratorio se sube para que quede en la historia. Se abren y se descargan con la sesión abierta
  y solo desde la clínica que los subió, igual que cualquier otro archivo del expediente.

## Preguntas frecuentes y errores comunes

**«Un estudio externo lleva a qué laboratorio se envió».**
Si marcó que va afuera, el nombre del laboratorio es obligatorio: sin eso, dentro de un mes nadie
sabe a quién reclamarle el resultado.

**No me deja elegir un servicio para un estudio externo.**
Es a propósito. Si se hace afuera, lo que la clínica cobra no es el estudio sino el envío o la
toma de muestra, y mezclarlos haría que después nadie supiera cuál de los dos se cobró. Agregue
ese servicio con la acción **Servicio**.

**¿Qué pongo en «fecha de la muestra»?**
El día en que se le sacó la sangre o se tomó la radiografía, que puede ser una semana antes de que
llegue el informe. Es lo que hace que el valor se pueda comparar con el de la vez anterior en la
fecha correcta.

**Pedí el estudio y no veo el cargo en caja.**
Los cargos entran a caja **al cerrar la atención**, no antes. Vea
[Cerrar la atención](atencion-cierre.md).
