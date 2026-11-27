# Receta

## Para qué sirve

Escribir la prescripción completa —**cuánto, por dónde, cada cuánto y por cuántos días**— y
entregársela al dueño en papel o por correo. Sirve para las dos cosas que pasan en una consulta:
lo que se entrega en la clínica y lo que el dueño compra afuera.

Antes solo se podía *vender* un medicamento. Eso no es una receta: una receta es el documento que
el dueño se lleva y sigue en su casa.

## Cuándo se usa

Durante la consulta, cuando se indica un tratamiento. La receta se firma sola **al cerrar la
atención**; no hay que firmarla aparte.

## Quién puede usarla

Solo un **médico** la escribe. Cualquiera de la clínica puede **imprimirla** después, porque es el
papel que se entrega en el mostrador.

## Paso a paso

1. **Pacientes** › la ficha del paciente › pestaña **Atención actual**.
2. En **Lo realizado**, clic en **Receta** (atajo **Alt+R**).
3. Para cada indicación:
   - Elija el origen: **Del inventario** (lo que la clínica vende) o **Texto libre** (lo que no).
   - **Buscá el medicamento** escribiendo dos letras o más. Busca por **nombre**, por **código**,
     por **principio activo** y por **código de barras** —si tenés lector, apuntá y disparar—. Cada
     resultado muestra la presentación, **cuánto hay en existencia** y el precio.
   - Si el producto del inventario tiene cargada su **posología sugerida**, la dosis, la vía, la
     frecuencia y la duración **se llenan solas** al elegir la presentación. Es una sugerencia
     editable: el médico la cambia y lo que vale es lo que quede escrito.
   - **Dosis** y **unidad**. Si la dosis es por kilo, deje marcado *La dosis es por kilo*: el
     sistema la multiplica por el peso y le muestra la cuenta completa mientras escribe.
   - **Vía**, **frecuencia** y **duración**.
   - Si se entrega acá, marque **Se dispensa en la clínica** y escriba **cuántas se entregan**
     — presentaciones (cajas, frascos), **no tomas**.
   - **Agregar a la receta**.
4. Repita para la segunda indicación.
5. **Imprimir** baja el PDF, y **Enviar al propietario** se lo manda por correo con el PDF
   adjunto.

### Con qué peso se calculó

Al lado de la cuenta dice **de dónde salió el peso**, y son tres cosas distintas:

- **el que acaba de dictar** —si viene de dictar la consulta—;
- **el de la consulta de hoy** —el que escribió en *Objetivo*—;
- **el de la última visita**, con la fecha.

Si el peso tiene **más de 90 días**, aparece un aviso. No bloquea nada: un cachorro de marzo no
pesa lo mismo en agosto, y quien decide si sirve es el médico.

El panel de la receta y el borrador del dictado usan **el mismo peso**: no puede pasar que la
pantalla muestre un número y el dictado calcule con otro.

### Repetir una receta anterior

Abajo del panel aparecen las recetas anteriores del mismo paciente. **Repetir** copia sus líneas a
la consulta de hoy y **vuelve a calcular las dosis por kilo con el peso de hoy**. Un cachorro que
pesaba 4 kg en marzo pesa 11 kg en agosto: repetir con la dosis vieja sería subdosificar.

## Un ejemplo con números

Toby pesa **32,4 kg**. Se le indica amoxicilina a **12,5 mg/kg, cada 12 horas, por 7 días, vía
oral**.

- El sistema muestra: **12,5 mg/kg × 32,4 kg = 405 mg**.
- Y deduce el tratamiento completo: cada 12 h durante 7 días son **14 tomas**.
- Se marca *Se dispensa en la clínica* y se entrega **1 caja de 20 tabletas**: **₡9 000**.
- Segunda línea, en texto libre: *Omeprazol 20 mg (farmacia humana)*, 1 tableta cada 24 horas por
  10 días. **No se cobra nada**: el dueño lo compra afuera.

> Ojo con la diferencia: **14 tomas no son 14 cajas**. El sistema entrega **una** presentación por
> defecto y usted ajusta el número si hace falta.

## Qué pasa después

- La línea **dispensada** entra como [cargo](glosario.md#cargo) a la cuenta del cliente y
  descuenta su caja del inventario, al cerrar la atención.
- La línea **de afuera** no genera cargo ni mueve inventario. Queda en la receta, que es para lo
  que existe.
- La receta se **firma con la atención** y pasa a la pestaña **Prescripciones** del expediente,
  desde donde se puede volver a imprimir.
- Mientras dure el tratamiento, las indicaciones aparecen en **Medicación activa**, en el resumen
  del expediente.
- El PDF lleva los datos de la clínica, el nombre del médico con su **número de colegiado**, la
  fecha, el paciente, el dueño, **el peso con el que se calcularon las dosis** y las indicaciones.

## Preguntas frecuentes y errores comunes

**El buscador dice «sin clasificar» al lado de un producto.**
Significa que en el catálogo de inventario nadie le puso el **tipo clínico**. Se puede recetar
igual. Si tenés permiso para editar el catálogo, al lado sale **«Es medicamento»**: un clic y
queda clasificado para siempre, y la próxima vez aparece primero.

**Antes la lista de medicamentos solo traía uno o dos.**
Era un defecto, corregido el 27 de noviembre de 2026: la lista mostraba únicamente los productos
que ya tenían el tipo clínico puesto, y en un catálogo recién importado eso es casi ninguno. Ahora
el buscador muestra **todo el inventario** y marca cuáles están sin clasificar.

**Quiero clasificar muchos de una vez.**
*Inventario › Sin clasificar*. Está explicado en
[Clasificar los productos del catálogo](inventario-clasificar-productos.md).

**«Falta el peso del paciente: la dosis por kilo no se puede calcular».**
La atención no tiene peso y el paciente no tiene ninguno anterior. Escriba el peso en la sección
**Objetivo** de la consulta. El sistema no inventa un número: una dosis calculada con un peso
supuesto es una dosis equivocada con cara de correcta.

**Aparece un aviso amarillo que dice que el aviso por grupo farmacológico no se pudo comprobar.**
Quiere decir exactamente eso: ese producto del inventario no está ligado al catálogo de
medicamentos, así que el sistema no sabe a qué familia pertenece y no puede avisar por grupo. Las
alergias **por sustancia** sí se revisaron. Es un dato que falta en el catálogo, no una alergia
descartada.

**El envío dice que no salió.**
El sistema respeta el [consentimiento y la franja horaria](glosario.md#consentimiento--franja-horaria)
del cliente. Si son las 9 de la noche, el correo no sale y la pantalla dice por qué. Queda
registrado igual, para que nadie crea que se envió.

**No quiero cobrar lo que receté.**
Desmarque *Se dispensa en la clínica*. Sin esa marca, la línea es solo la indicación.

**Cargué la posología en el producto y no se completa sola.**
La posología se carga en **Inventario** › el producto › sección *Posología sugerida*. Si el
producto tiene la dosis por kilo y la dosis fija a la vez, el sistema guarda una sola: son dos
formas de decir la misma cosa y no pueden convivir.

**¿Puedo recetar algo que la clínica no vende?**
Sí: elija **Texto libre** y escriba el nombre. Esas líneas nunca se cobran.
