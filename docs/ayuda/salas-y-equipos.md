<!-- ayuda permisos=clinica.configurar -->
# Salas y equipos

## Para qué sirve

Que la agenda sepa **dónde** se atiende y **con qué**, para no ofrecer un horario que en realidad
no se puede dar: dos cirugías en el único quirófano, o dos ecografías con un solo ecógrafo.

## Cuándo se usa

- Al empezar a usar la agenda.
- Cuando la clínica suma un consultorio, un equipo nuevo o uno sale a reparación.

## Quién puede usarla

Verla, todo el personal de la clínica. **Cargar y editar**, quien tenga *Configurar la clínica*,
que por omisión es el administrador.

## Paso a paso

1. *Administración › Clínica › **Salas y equipos***.
2. **+ Nueva sala**: el nombre («Quirófano 1», «Consultorio 2») y el tipo.
3. **+ Nuevo equipo**: el nombre, la categoría y **cuántos hay**.
4. Para que la agenda los use, hay que **exigirlos en un tipo de cita**: *Administración › Clínica
   › Agenda › Tipos de cita*.

## Un ejemplo con números

La clínica tiene **un** quirófano y **dos** ecógrafos.

El tipo de cita «Cirugía» exige el quirófano; «Ecografía» exige el ecógrafo con cantidad 2.

A las 10:00 ya hay una cirugía: la agenda **no ofrece** otra cirugía a esa hora. Pero sí ofrece
**dos** ecografías a las 10:00, y la tercera no.

## Qué pasa después

- Los huecos que la agenda ofrece pasan a tener en cuenta la sala y el equipo.
- En el detalle de una cita se ve qué sala y qué equipo quedaron reservados.
- Un médico con el permiso de **sobrecarga** puede agendar igual sobre un recurso ocupado,
  diciendo por qué. Queda registrado.

## Preguntas frecuentes y errores comunes

**¿Por qué no puedo borrar una sala?**
Porque las citas pasadas la usaron, y borrarla se las llevaría por delante. Se **desactiva**: deja
de ofrecerse y la historia queda intacta. Para verla de nuevo, marque *Ver también los
desactivados*.

**Desactivé una sala por error.**
Marque *Ver también los desactivados* y toque **Activar**. Antes del 28 de noviembre de 2026 solo
se podía apagar, nunca volver a encender; ya no.

**¿Para qué sirve «cuántos hay»?**
Es lo que permite agendar en paralelo. Con cantidad 1, el equipo es un cuello de botella y la
agenda lo trata así. Con cantidad 3, acepta tres citas simultáneas que lo necesiten.

**Cargué los equipos y la agenda no cambió nada.**
Falta la otra mitad: hay que decir **qué tipo de cita los exige**. Un equipo que ningún tipo de
cita pide no restringe nada — la columna *Lo exigen* de la tabla lo dice.

**La agenda dice «Sin salas configuradas».**
Ese aviso lleva directo a esta pantalla.
