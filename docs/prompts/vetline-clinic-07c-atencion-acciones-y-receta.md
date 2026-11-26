# Vetline Clinic — 07c · Acciones explícitas en la atención y receta completa

Rama: una nueva, que parte de la rama del 01c (marco y tema). Se rige por `vetline-clinic-00-guia-rectora.md`, en especial la sección 12. Corrige lo que mostró la revisión en el navegador del 07 ya construido.

## Por qué existe

En la atención construida en el 07:

- **Vacunas y desparasitaciones existen, pero están escondidas.** Para registrarlas hay que entrar por "Producto" y marcar "¿Es un preventivo?" en un campo del modal. Un médico no lo encuentra.
- **No hay receta con posología.** Solo se puede dispensar un medicamento como producto cobrado. Faltan dosis, vía, frecuencia, duración e indicaciones, la receta imprimible para comprar fuera de la clínica y el cálculo de dosis por peso desde la pantalla.
- **El estudio de laboratorio no se pide desde la atención.** Solo existe en la pestaña Laboratorio.
- **Las pestañas Vacunas, Desparasitaciones, Prescripciones y Laboratorio son solo historia**, y no dicen dónde se registra cada cosa.

## 0. Relevamiento

Antes de cambiar nada, el informe describe cómo se registran hoy, extremo a extremo, una vacuna, una desparasitación, un medicamento dispensado, una receta y un estudio de laboratorio: tablas, eventos de la línea de tiempo, cargos, movimientos de inventario y recordatorios. Lo que ya funciona (cargo por la puerta única, salida por `registrarMovimiento` con el lote elegido, recordatorio con fecha próxima, aviso de alergia) **se reutiliza, no se duplica**.

## 1. Acciones explícitas en "Lo realizado"

El panel de la atención tiene una acción visible por cada cosa que hace el médico, cada una con su atajo:

| Acción | Atajo | Qué abre |
|---|---|---|
| Servicio | F2 | El catálogo de servicios, como hoy |
| Producto | F3 | Productos aplicados o vendidos que no son preventivos ni receta |
| **Vacuna** | F5 | Solo los productos marcados como vacuna |
| **Desparasitación** | F6 | Solo los antiparasitarios, con el tipo (interna o externa) |
| **Receta** | F7 | La prescripción (sección 2) |
| **Estudio** | F8 | La orden de laboratorio o de imagen ligada a esta atención (sección 3) |
| Cerrar | F4 | El cierre, como hoy |

Si alguno de esos atajos lo usa el navegador o ya está ocupado, se elige otro y se documenta. En la pantalla aparecen visibles.

**Vacuna y desparasitación:**
- El producto se marca en el catálogo con su **tipo clínico** (vacuna, antiparasitario, medicamento, insumo, otro). Ese campo lo filtra en la acción correspondiente. Si el inventario ya tiene un dato equivalente, se reutiliza.
- El lote es **obligatorio**, con el sugerido por FEFO preseleccionado.
- La **próxima fecha** se sugiere según el protocolo de la especie y del producto (catálogo de protocolos por clínica, con valores iniciales razonables y editables) y se puede cambiar.
- El campo "¿Es un preventivo?" desaparece: la acción misma lo dice.
- Por debajo se usa exactamente el flujo que ya existe (cargo, movimiento, evento de vacuna o desparasitación, recordatorio).

## 2. Receta

La receta es un documento de la atención con una o más líneas. Cada línea tiene:

- **El medicamento**, del catálogo de inventario o **en texto libre**, para lo que la clínica no vende.
- **La dosis:** por kg o fija, con la unidad. Si es por kg, se calcula con el peso de la atención o, si no hay, con el último registrado, mostrando el resultado y su base ("12,5 mg/kg × 18 kg = 225 mg"). La validación de dosis por peso del 07 avisa fuera de rango, sin bloquear, como el aviso de alergia.
- **La vía, la frecuencia y la duración**, de los catálogos de receta. Estos catálogos, y la posología sugerida por producto, son los de la sección A3 del anexo del 07: se construyen aquí, y el anexo los da por hechos.
- **La cantidad total**, calculada cuando se puede y editable.
- **Las indicaciones**, en texto legible para el propietario, generado y editable: "1 tableta cada 12 horas por 7 días, con comida".
- **"Se dispensa en la clínica":** si está marcada y el medicamento es del catálogo, la línea genera su cargo y su salida de inventario por el flujo de producto que ya existe, ligada a la línea de receta. Hay una sola fuente: no se agrega dos veces. Si no está marcada, la receta es solo indicación, para comprar fuera.

**Además:**
- **El aviso de alergia** de siempre, al agregar la línea.
- **La receta se firma con la atención.** Después solo admite adendas, como todo lo firmado.
- **Imprimir y enviar:** PDF con los datos de la clínica, el nombre del médico y su **número de colegiado** (el campo se agrega al perfil del médico si no existe), la fecha, el paciente, el propietario, el peso y las líneas. Se envía por correo o WhatsApp con `emitirNotificacion` y `puedeEnviar()`.
- **Medicación activa:** las líneas alimentan la medicación activa de la cabecera del expediente hasta que termina su duración.
- **Historia:** la pestaña Prescripciones muestra las recetas con sus líneas y permite reimprimirlas.
- **Repetir:** una receta anterior del mismo paciente se puede repetir en la atención actual. Copia las líneas, recalcula las dosis con el peso actual y queda editable.

## 3. Estudio desde la atención

- La acción **Estudio** crea la misma orden que la pestaña Laboratorio, **ligada a la atención**.
- Si el estudio se hace en la clínica y tiene un servicio del catálogo asociado, el cargo se agrega a la atención.
- Si se envía a un laboratorio externo, se registra a cuál.
- El resultado se carga después en la pestaña Laboratorio, como hoy, y avisa hasta que un médico lo marque visto.

## 4. Pestañas de historia

En Vacunas, Desparasitaciones, Prescripciones y Laboratorio:

- Cada pestaña dice en una línea dónde se registra ("Se registran desde la atención: Vacuna (F5)") y, para un médico, lleva a la atención abierta o la abre.
- En Vacunas y Desparasitaciones también está la acción **"Registrar histórico"**, para una aplicación hecha antes o en otro lugar. Es la que se pidió en la revisión: fecha, producto o nombre libre, lote opcional, lugar y próxima fecha, sin cargo ni inventario, y marcada como histórica.
- Para un usuario que no es médico, se explica que solo un médico registra contenido clínico.

## 5. Estado visible en el examen por sistemas

Hoy los tres estados de cada sistema (No evaluado, Normal, Anormal) se ven todos iguales, en gris. Además, la fila repite el estado en texto ("Sin evaluar") junto al botón "No evaluado". Lo que se pide:

- La opción elegida va **rellena con el color semántico** de su estado: Normal en verde (éxito); Anormal en naranja o rojo de aviso; No evaluado en neutro. Las no elegidas quedan en contorno.
- **La tarjeta de la fila también toma el estado**, con un fondo suave del mismo color y un ícono (✓ para Normal, ⚠ para Anormal). Así, al recorrer el examen, lo anormal salta a la vista y lo no evaluado se distingue de lo revisado.
- Una fila Anormal **abre su campo de detalle**, que es obligatorio, y queda resaltada hasta que se completa.
- Se elimina el texto duplicado "Sin evaluar". El estado lo dice el control.
- Al pie del examen, un resumen en vivo: "3 normales · 1 anormal · 9 sin evaluar", junto al botón **"Todo normal"** del anexo del 07 (si todavía no existe, se agrega aquí).
- Los colores salen de los tokens de estado del sistema de diseño, que no son configurables por clínica, y cumplen contraste AA con cualquier tema.

## 6. Cierre

El resumen del cierre lista, antes de confirmar, lo que va a pasar: los cargos que van a caja con su total, las salidas de inventario por lote, los recordatorios que se programan, el control que se agenda, la receta que se firma y si se envía.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador con `demo.medico`:

- una atención de Toby con una vacuna (con su lote y la próxima fecha sugerida), una desparasitación, una receta de dos líneas (una dispensada en la clínica y otra para comprar fuera, con dosis por kg calculada y aviso de alergia), y un estudio en clínica;
- el cierre y la firma;
- la caja con los cargos, el inventario por lote y los recordatorios;
- el PDF de la receta y su envío simulado;
- la medicación activa en la cabecera;
- repetir la receta en otra atención;
- un registro histórico de una vacuna.

El informe incluye las pantallas nuevas y cambiadas con su camino de clics, las migraciones (con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant) y lo que se reutilizó del 07.
