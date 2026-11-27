<!-- ayuda permisos=catalogo.editar -->
# Clasificar los productos del catálogo

## Para qué sirve

Que el médico **encuentre** cada producto donde lo busca: las vacunas en *Vacuna*, los
antiparasitarios en *Desparasitación*, los medicamentos en la *Receta*.

Eso lo decide el **tipo clínico** de cada producto. Un catálogo recién importado no lo trae, y sin
él los productos existen pero no aparecen ordenados por su uso.

## Cuándo se usa

- Después de **importar** el catálogo de productos por primera vez.
- Cuando el indicador **Productos sin clasificar** del inventario tiene un número.
- Cada tanto, cuando entran productos nuevos sin el dato.

## Quién puede usarla

Quien pueda **editar el catálogo** (*catalogo.editar*), que por omisión es el administrador. Verla
la ve todo el personal que entra al inventario.

## Paso a paso

1. **Inventario**. Arriba, al lado de *Alertas*, está el indicador **Sin clasificar** con el
   número. Clic.
2. **Buscá un grupo**: escribí una palabra que tengan en común. Por ejemplo *choice* trae todos
   los alimentos de esa marca.
3. **Marcá** los que correspondan, o usá **Todos los que se ven**.
4. Elegí el tipo en **Clasificar los elegidos como** y tocá **Clasificar N**.
5. Repetí con el siguiente grupo.

### La sugerencia

Cada producto puede traer una etiqueta **quizá medicamento**, **quizá vacuna**… Es una sugerencia
del sistema a partir de la categoría y de las palabras del nombre. Pasá el puntero por encima y
dice **por qué** lo cree.

Los botones **Marcar sugeridos: medicamento** (y los demás) marcan de una vez todos los que el
sistema cree de ese tipo, **para que los revises**. Nunca se aplica sola: hay que confirmar.

## Un ejemplo

Importaste 891 productos y el indicador dice **891**.

Escribís *choice* en el buscador: salen 13 alimentos. **Todos los que se ven** › tipo **Otro** ›
*Clasificar 13*. Quedan 878.

Tocás **Marcar sugeridos: medicamento**: se marcan 120 que tienen una dosis o un principio activo
en el nombre. Mirás la lista, desmarcás dos que no lo son, y clasificás 118. Quedan 760.

En veinte minutos el catálogo está ordenado, y el médico que busca «amoxi» en la receta encuentra
la amoxicilina de primera.

## Qué pasa después

- El producto **aparece en su acción** de la atención, antes que los sin clasificar.
- El indicador baja.
- **No se pisa lo que ya estaba clasificado.** Si marcás un producto que alguien ya había
  clasificado a mano, se respeta lo que había y el mensaje dice cuántos cambiaron de verdad.

## Preguntas frecuentes y errores comunes

**El filtro por categoría no me muestra nada.**
Porque los productos no tienen categoría cargada. Es lo normal en un catálogo importado de otro
sistema: viene el nombre y el código, y nada más. Usá la búsqueda por nombre, que es lo que
funciona con lo que hay.

**¿Tengo que clasificar todo antes de poder trabajar?**
No. Un producto sin clasificar **se puede recetar y aplicar igual**: el buscador de la atención lo
muestra con la etiqueta «sin clasificar». Clasificar es para encontrarlo más rápido, no un
requisito.

**Clasifiqué mal uno.**
Abrí su ficha en el catálogo y cambiale el tipo clínico ahí. La herramienta masiva no pisa lo ya
clasificado, justamente para que una corrección a mano no se pierda en la próxima tanda.

**¿Puedo traerlo desde la importación?**
Sí. La plantilla tiene la columna **tipo_clinico** con los valores `vacuna`, `antiparasitario`,
`medicamento`, `insumo` y `otro`. Es opcional: una planilla que no la traiga importa igual, y los
productos quedan sin clasificar.

**¿Qué es «otro»?**
Lo que no es clínico: alimentos, accesorios, higiene, juguetes. Se venden y se cobran como
cualquier producto; lo que no hacen es aparecer en la receta ni en las acciones de vacuna.
