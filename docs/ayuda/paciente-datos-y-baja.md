# Dar de alta un paciente, completar su ficha y darlo de baja

## Para qué sirve

Registrar una mascota nueva con todo lo que después hace falta —la raza para las predisposiciones,
la fecha de nacimiento para la edad, el hábitat y la dieta para el consejo nutricional— y, cuando
ya no está, dejar dicho **por qué** sin borrarla.

Antes de esta entrega solo había dos formas de crear un paciente: el asistente de *Nuevo caso*,
que es solo para médicos, y el modal de *Nueva cita*, que pide el nombre y la especie y nada más.
Ni el fichero de pacientes ni la ficha del dueño tenían un botón de alta.

## Cuándo se usa

- **El alta completa**, cuando llega un cliente nuevo con tiempo: en el mostrador, antes de la
  consulta.
- **El alta rápida**, cuando llama por teléfono para pedir una cita y hay que anotarlo ya. La
  ficha queda marcada **Ficha por completar** y se termina después.
- **La baja**, cuando la mascota falleció, se extravió, se fue a otra clínica o el dueño pidió que
  la saquen.

## Quién puede usarla

**Médicos y administradores de la clínica**, por igual. No hace falta ser médico para registrar un
paciente: lo normal es que lo haga quien atiende el mostrador.

## Paso a paso

### Un paciente nuevo, con su dueño

1. **Pacientes** › botón **+ Nuevo paciente** (arriba a la derecha).
2. **El dueño**: escriba su nombre o su teléfono y elíjalo de la lista. Si no está, clic en
   **+ Registrar un propietario nuevo** y complete sus datos ahí mismo, sin salir de la pantalla.
3. **Lo esencial del paciente**: nombre, especie, raza, sexo, estado reproductivo, y **fecha de
   nacimiento o edad** (una de las dos; ver más abajo).
4. **+ Más datos del paciente (opcional)** abre el resto: color, pelaje, carácter, hábitat, tipo de dieta y
   detalle de la alimentación, microchip, pedigrí y su número de registro, partos, alergias y
   alerta de manejo.
5. **Guardar**.

### Una mascota más, de un cliente que ya está

1. **Propietarios** › el cliente › **+ Agregar mascota**.
2. El dueño ya viene puesto; solo se completa el paciente.

### Un cliente nuevo sin mascota todavía

**Propietarios** › **+ Nuevo propietario**. El mismo formulario que el del paso 2 de arriba: es
uno solo en todo el sistema, así que lo que se puede cargar en un lugar se puede corregir en el
otro.

### Completar una ficha que quedó a medias

1. **Pacientes** › marque **Solo las fichas por completar**, al lado del buscador.
2. Abra la ficha: arriba, la etiqueta **Ficha por completar** dice exactamente qué falta.
3. **Editar** › complete › **Guardar**.

### Dar de baja

1. **Pacientes** › la ficha del paciente › **Dar de baja**.
2. En **Qué pasó**, elija: fallecido, extraviado, transferido a otra clínica, o baja por otro
   motivo.
3. Escriba el **motivo** —es obligatorio— y la **fecha** (que se llama *Fecha del fallecimiento* o
   *Fecha de la baja* según lo que eligió).
4. **Dar de baja**.

## Un ejemplo con números

Llama una señora para pedir cita para su gato. Recepción abre **Nueva cita**, escribe «Michi»,
especie *Felino*, y agenda. El gato queda creado con **Ficha por completar: falta raza, sexo, edad
o fecha de nacimiento**.

El jueves llegan. En el mostrador se abre la ficha y se completa: raza *Siamés*, sexo *macho*,
estado *castrado*, nacimiento *14/03/2021*. La ficha deja de estar marcada y la edad aparece sola:
**5 años**. Nadie escribió «5»: se calcula de la fecha, así que el año que viene dirá 6 sin que
nadie lo toque.

## Qué pasa después

- El paciente recibe su **número de expediente**, que es el que se busca en el mostrador.
- Si cargó **fecha de nacimiento**, la edad se calcula y se actualiza sola. Si cargó **edad en
  años**, queda congelada en ese número: por eso se prefiere la fecha.
- La **raza** es lo que habilita el aviso de predisposiciones raciales del agente clínico.
- Al **dar de baja**, el paciente deja de aparecer en el fichero activo y **no le sale ningún
  aviso más**: ni recordatorio de cita, ni de vacuna, ni de desparasitación, ni campañas. Los
  cuatro estados de baja bloquean por igual.
- La ficha **no se borra**. Su historia clínica, sus recetas y sus comprobantes quedan.

## Preguntas frecuentes y errores comunes

**¿Por qué no me deja poner la edad y la fecha de nacimiento a la vez?**
Porque serían dos respuestas a la misma pregunta y una de las dos envejecería mal. Si sabe la
fecha, use la fecha. La edad en años es para cuando el dueño dice «tiene como cuatro».

**Puse «fallecido» y el dueño igual recibió un correo.**
No puede pasar por un aviso nuevo. Si el correo salió, salió **antes** de la baja: revise la fecha
del envío en la ficha del cliente. Desde la baja en adelante, ningún aviso sobre esa mascota sale,
y la pantalla dice el motivo cuando alguien intenta enviarlo.

**«Transferido» y «baja por otro motivo» son lo mismo.**
No. *Transferido* es «se la llevó a otra clínica» y sirve para medir cuántos clientes se van;
*otro motivo* es todo lo demás, y por eso ahí el motivo escrito es lo único que queda. Escríbalo
con una frase entera.

**El hábitat que usa mi clínica no está en la lista.**
Se agrega al catálogo de la clínica y aparece en la lista. Ya no hay una lista fija de tres
opciones.

**Creé el mismo cliente dos veces.**
El alta avisa cuando ya existe uno con la misma identificación o el mismo teléfono y ofrece usar
el que está. Si se le pasó, mire
[Clientes repetidos](clientes-duplicados.md): se unifican sin perder la historia de ninguno de los
dos.
