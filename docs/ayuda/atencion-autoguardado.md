# La consulta se guarda sola

## Para qué sirve

Que lo que el médico escribe en la consulta no se pierda: ni si se va el internet, ni si se cierra
la pestaña por error, ni si otra persona abre la misma atención desde otra computadora.

## Cuándo se usa

Siempre, sin hacer nada. No hay botón de guardar en la consulta: hay un cartelito que dice en qué
estado está.

## Quién puede usarla

El **médico** que tiene la atención abierta. Es importante: la atención la escribe **una persona a
la vez**.

## Paso a paso

No hay pasos. Hay cuatro cosas que puede decir el cartelito de arriba:

| Lo que dice | Qué significa | Qué hacer |
|---|---|---|
| **Guardando…** | Está subiendo lo último que escribió | Nada |
| **Guardado hace 12 s** | Todo lo que escribió está en el servidor | Nada |
| **Sin conexión — se guarda al volver** | No hay internet. Lo que escribe queda **en esta computadora** | Seguir escribiendo. Cuando vuelva la conexión, sube solo |
| **Otra sesión tiene esta atención** | Alguien más la abrió | Ver abajo |

### Si otra persona la tiene abierta

La pantalla se pone en **solo lectura** y dice quién la tiene y desde qué hora. No es un castigo:
es lo que evita que dos médicos escriban el mismo campo y uno le borre el texto al otro sin que
ninguno se entere.

Si esa persona ya no está —cerró la computadora, se fue—, después de **dos minutos** sin señales
aparece el botón **Reclamar la atención**. Desde ahí se escribe normal.

### Si la escribieron los dos a la vez

Puede pasar si las dos sesiones estaban escribiendo cuando se cortó la red. Al volver, aparece un
panel con **lo suyo** y **lo del servidor**, campo por campo, y usted elige cuál queda. El sistema
no decide por su cuenta: la evolución de una consulta no es algo que una computadora pueda
fusionar.

## Un ejemplo con números

La doctora escribe la anamnesis a las 10:14. A las 10:14:01 el cartel dice *Guardando…*; un
segundo después, *Guardado hace 1 s*.

A las 10:16 se corta el internet de la clínica. Ella sigue escribiendo la evolución durante cuatro
minutos: el cartel dice **Sin conexión**, y cada tecla queda guardada en su computadora. A las
10:20 vuelve la conexión: los cuatro minutos de texto suben solos y el cartel vuelve a decir
*Guardado*.

## Qué pasa después

- Nada se cobra, nada se descuenta del inventario y nada se le avisa al cliente: esto es solo el
  guardado del texto. Los cargos y los avisos pasan **al cerrar la atención**.
- Lo que queda **en la computadora** (el borrador local) se borra en tres momentos: cuando sube al
  servidor, cuando se cierra la atención y cuando se cierra sesión. No queda texto de pacientes en
  una computadora compartida después de salir.
- La atención lleva una **versión** interna. Es lo que permite darse cuenta de que alguien más
  escribió en el medio, en vez de pisarlo.

## Preguntas frecuentes y errores comunes

**Cerré la pestaña sin querer. ¿Perdí lo que escribí?**
No. Al cerrar, lo último se sube de apuro; y si no llegó a subir, al volver a abrir la atención
aparece lo que había quedado en la computadora.

**Dice «Sin conexión» pero yo tengo internet.**
Puede tenerlo usted y no el servidor. Siga escribiendo igual: el texto está a salvo en su
computadora y sube cuando se restablezca.

**¿Puedo trabajar la misma consulta desde la tablet y desde la computadora?**
Una a la vez. Cierre la atención en una antes de abrirla en la otra, o espere los dos minutos y
recláme la desde la segunda.

**Estoy en solo lectura y la persona que la tiene soy yo, en otra pestaña.**
Cierre la otra pestaña. Si ya la cerró, espere dos minutos y use **Reclamar la atención**.

**¿Esto guarda los datos del paciente en el navegador?**
Guarda **solo el texto de la atención que está escribiendo**, por atención y por usuario, y lo
borra en los tres momentos de arriba. Es distinto de guardar respuestas del servidor para usarlas
sin internet, que el sistema **no** hace con los datos de pacientes.
