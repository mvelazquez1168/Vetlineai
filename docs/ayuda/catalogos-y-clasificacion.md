# Los catálogos de la clínica

## Para qué sirve

Que las listas que el sistema ofrece —familias de productos, marcas, motivos de consulta, tipos de
cliente, vías de administración— sean las de **tu** clínica, y que estén todas en un lugar donde se
puedan encontrar.

## Cuándo se usa

Al empezar, para dejar las listas como la clínica trabaja. Después, cada vez que aparece algo nuevo:
una marca que antes no se vendía, un tipo de corte que la estética empezó a ofrecer.

## Quién puede usarla

**Verlos**, todo el personal. **Editarlos**, quien tenga el permiso *Editar los catálogos de la
clínica*, que por omisión tienen el administrador y farmacia.

## Cómo está organizado

*Administración › Catálogos, personal y cumplimiento › Catálogos*, agrupados en Inventario,
Veterinaria, Recetas, Clientes, Agenda y Documentos.

**Cada catálogo dice dónde se edita.** Los que tienen su propia pantalla en su módulo —bodegas,
servicios, tipos de cita, salas, especies y razas— muestran un botón **Ir a su módulo**. No se
copian acá: dos lugares donde editar lo mismo es cómo una clínica termina con dos listas distintas
de bodegas.

## La clasificación de los productos

Antes era una **categoría en texto libre**. Con texto libre, «Antibióticos» y «Antibiót.» son dos
categorías para la base y una para la clínica, y ningún filtro sirve.

Ahora son cuatro listas:

| Lista | Qué es | Ejemplo |
|---|---|---|
| **Familia** | La clasificación principal | Antiparasitarios |
| **Subfamilia** | Una familia dentro de otra | Antiparasitarios internos |
| **Marca** | De qué laboratorio es | Bayer |
| **Ubicación física** | Dónde hay que ir a buscarlo | Refrigerador de vacunas |

> Lo que ya estaba cargado en la categoría **no se perdió**: cada texto distinto se convirtió en una
> familia de su clínica y los productos quedaron apuntando a ella.

## Paso a paso

1. *Administración › Catálogos, personal y cumplimiento › Catálogos*.
2. Buscá el catálogo y **Abrir** (o **Ir a su módulo**, si vive en otro lado).
3. Escribí el valor nuevo y **Agregar**.
4. Para sacar uno de circulación: **Desactivar**.

**Para cargar muchos de una vez**: **Exportar** baja un Excel con las columnas `nombre`, `codigo`,
`orden` y `activo`. Se completa, se vuelve a subir, y el sistema muestra **fila por fila** qué está
bien y qué no antes de cargar nada.

## Un ejemplo

La clínica trae de Digital Vet 180 productos con la categoría «Antiparasitarios» escrita de cuatro
maneras distintas. Al migrar quedaron cuatro familias. En *Catálogos › Familias* se desactivan las
tres mal escritas, se deja «Antiparasitarios», y desde el inventario se reasignan los productos.

A partir de ahí, filtrar el inventario por esa familia trae los 180 y no 47.

## Qué pasa después

- **Nada se borra: se desactiva.** Un valor desactivado desaparece de los selectores y los registros
  viejos lo siguen mostrando. Borrarlo dejaría a diez productos sin clasificación y nadie se
  enteraría hasta filtrar.
- Los **tipos de corte**, los **motivos de consulta** y las **duraciones de receta** aparecen desde
  ese momento en la atención y en la receta.

## Preguntas frecuentes y errores comunes

**«“bodegas” no es un catálogo que se edite acá».**
Es correcto: las bodegas se editan en Inventario. Esta pantalla las enlaza para que no haya que
recordar dónde estaban.

**Subí un Excel y me rechazó tres filas.**
Las otras **sí se cargaron**. Corregí esas tres y volvé a subirlas: la importación va fila por fila
a propósito, para que un error en la 40 no te haga perder las 39 anteriores.

**Un kit de productos.**
Un producto puede estar hecho de otros —un kit de cirugía, un paquete de vacunas—. Al venderlo se
descuentan sus componentes de sus lotes. El kit **no tiene existencias propias**: lo que se puede
vender es lo que alcanza en los componentes.

**¿Por qué no me deja poner un kit dentro de sí mismo?**
Porque venderlo intentaría descontar infinito. El sistema lo rechaza aunque el ciclo sea largo (A
lleva B y B lleva A).
