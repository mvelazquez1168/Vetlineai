# Las políticas de la clínica

## Para qué sirve

Que las decisiones que cada clínica toma distinto se puedan cambiar sin llamar a soporte: hasta qué
descuento se da sin pedir permiso, cuánto margen mínimo se acepta, si una anulación necesita
autorización, cuánto puede hacer el agente administrativo por su cuenta.

Y que se sepa **quién las cambió y cuándo**. Un tope de descuento que cambió sin que nadie sepa
cuándo es un problema de plata.

## Cuándo se usa

Al empezar, para dejarlas como trabaja la clínica. Después, poco: son decisiones de meses, no de
días.

## Quién puede usarla

**Verlas** las ve todo el personal. Alguien a quien el sistema le dice «pedí autorización» tiene
derecho a ver cuál es el tope y de dónde sale.

**Cambiarlas** lo hace quien tenga el permiso *Configurar la clínica y sus políticas*.

## De dónde sale cada valor

Cada política muestra una etiqueta con su origen, y eso es la mitad de la pantalla:

| Etiqueta | Qué significa |
|---|---|
| **de la clínica** | Lo configuraron acá. |
| **de antes** | Viene de donde ese módulo guardaba el dato antes de que existieran las políticas. Se respeta tal cual, para que ninguna clínica cambie de comportamiento el día que esto se instala. |
| **por omisión** | Nadie lo tocó: rige el valor que trae el sistema. |

Sin esa etiqueta, un 25 % en la pantalla no se distingue de un 25 % que alguien eligió, y la primera
pregunta de un administrador es justamente *«¿esto lo pusimos nosotros?»*.

## Paso a paso

1. *Administración › Políticas*.
2. Cambie el valor en el campo.
3. **Guardar**, en la misma fila.

Para ver la historia de una: **Historial**. Sale cada cambio, con el valor anterior, el nuevo, quién
y cuándo.

**Un valor distinto para un rol**

El tope de descuento admite un valor por rol: la recepción hasta 5 %, la caja hasta 15 %.

1. En *Descuento máximo sin autorización*, **Por rol**.
2. Elija el rol y el tope.

Un rol sin tope propio usa el general de la clínica.

## Un ejemplo con números

La clínica venía trabajando con un tope de descuento del **25 %**, que es lo que tenía cargado el
módulo de caja. La pantalla lo muestra con la etiqueta **de antes**.

El administrador lo baja a **12 %** y guarda: ahora dice **de la clínica**.

Después le pone a **Recepción** un tope de **5 %**. Desde ese momento:

- la recepción descuenta hasta 5 % sola, y de 5 % para arriba pide autorización;
- la caja y el resto, hasta 12 %;
- Dani, que es **recepción y caja**, descuenta hasta **12 %**: con dos roles, vale el más
  permisivo.

El historial queda con las dos filas: *25 % → 12 %* y *(sin valor) → 5 % para recepción*, cada una
con su fecha y su nombre.

## Qué pasa después

- El cambio rige **en la siguiente operación**: no hay que cerrar sesión ni reiniciar nada.
- Cada cambio queda en el historial y **el historial no se puede editar ni borrar**.
- Las políticas que son de la clínica entera —el margen mínimo, por ejemplo— no admiten valor por
  rol, y el sistema lo dice en vez de aceptarlo y después ignorarlo.

## Preguntas frecuentes y errores comunes

**«"Descuento máximo sin autorización" no puede ser mayor que 100».**
Cada política tiene su rango. Un 400 % es un dedo que se resbaló, no una decisión.

**Cambié el tope y la caja sigue pidiendo autorización.**
El tope del descuento sale del **menor de tres**: el del producto o servicio, el del rol y el general
de la clínica. Si el producto tiene un tope del 4 %, ese manda. Está explicado en
[Descuentos](descuentos.md).

**¿Puedo poner un tope por persona?**
No: por rol. Un permiso por persona es un permiso que nadie puede auditar después, y «¿qué puede
hacer la recepción?» dejaría de tener respuesta.

**El agente administrativo nace en «solo sugiere».**
Sí, y es a propósito: es la opción más restrictiva. Se amplía cuando la clínica ya vio qué propone.
