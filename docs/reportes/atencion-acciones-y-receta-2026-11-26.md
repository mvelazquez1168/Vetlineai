# Acciones explícitas en la atención y receta completa — 07c

**Rama:** `vetline-clinic/07c-atencion-y-receta`, que parte de `vetline-clinic/01c-marco-y-tema`.
No se fusionó nada a `main`.
**Fecha:** 2026-11-26.
**Prompt:** `docs/prompts/vetline-clinic-07c-atencion-acciones-y-receta.md`.

---

## 0. Relevamiento: cómo se registraba cada cosa antes

| Qué | Cómo se registraba | Qué tablas tocaba |
|---|---|---|
| **Vacuna** | Acción «Producto» → elegir presentación → marcar **«¿Es un preventivo?» = Vacuna** en un desplegable dentro del modal → escribir la próxima fecha a mano. | `exp_atencion_items` (tipo `vacuna`, `preventivo_*`); al cerrar, `vta_cargos`, `inv_movimientos` y `cuidados_preventivos`. |
| **Desparasitación** | Igual, con «¿Es un preventivo?» = Desparasitación. El subtipo (interna/externa) quedaba fijo en `interna`, sin forma de cambiarlo. | Las mismas. |
| **Medicamento dispensado** | Acción «Producto», con la casilla «se dispensa en la clínica». | `exp_atencion_items` (tipo `receta`). |
| **Receta con posología** | **No existía.** Solo estaba la receta del agente de IA (`recetas`/`receta_items`, migración 016), atada a un **caso**, con el medicamento del catálogo de IA y la posología en texto libre. | — |
| **Estudio de laboratorio** | Solo desde la pestaña **Laboratorio**, sin relación con la atención (aunque `exp_estudios_lab.atencion_id` existía y quedaba en null). | `exp_estudios_lab`. |
| **Preventivo histórico** | **No existía.** `cuidados_preventivos` nacía siempre de una atención. | — |

**Lo que ya funcionaba se reutilizó, no se duplicó:** el cargo sigue entrando por `agregarCargo`,
la salida por `registrarMovimiento` con el lote elegido, el recordatorio por
`cuidados_preventivos`, el aviso de alergia por `avisosAlRecetar`, el PDF por el mismo
`generarPdfReceta` de la receta del agente y el envío por `emitirNotificacion` con `puedeEnviar()`.

---

## 1. Lo que se entrega

### Pantallas nuevas y cambiadas, con su camino de clics

| Pantalla | Camino | Qué es |
|---|---|---|
| **Vacuna** (modal) | Pacientes › ficha › pestaña **Atención actual** › **Vacuna** (Alt+V) | Solo vacunas, lote obligatorio con el de FEFO preseleccionado, próxima fecha del protocolo. |
| **Desparasitación** (modal) | …› **Desparasitación** (Alt+D) | Igual, con el tipo interna/externa. |
| **Receta** (panel) | …› **Receta** (Alt+R) | Posología completa, texto libre, dosis por kilo con su cuenta, imprimir y enviar, repetir una anterior. |
| **Estudio** (modal) | …› **Estudio** (Alt+E) | La orden ligada a la atención, con su cargo si se hace acá. |
| **Resumen del cierre** | …› **Cerrar la atención** | Lo que va a pasar, con nombre y monto, antes de confirmar. |
| **Registrar histórico** (modal) | Pacientes › ficha › pestaña **Vacunas** o **Desparasitaciones** › **Registrar histórico** | Lo aplicado antes o en otro lugar. Sin cargo ni inventario. |

### Las migraciones

Todas con RLS forzada y `ON DELETE CASCADE` al tenant en lo que es de tenant.

| # | Qué hace |
|---|---|
| **115** | `inv_productos.tipo_clinico`; `exp_protocolos_preventivos` (RLS forzada, cascada); la receta atada a la atención con su peso y su firma; la línea de receta con posología, tres orígenes y `dispensado_aqui`; `cuidados_preventivos.historico` y `lugar`; el estudio con su servicio y su ítem. |
| **116** | Los protocolos de fábrica, en su propia migración (un INSERT con FK diferida dentro de la misma transacción que un `ALTER TABLE` falla con *pending trigger events*; ya pasó dos veces). |
| **117** | La receta sobrevive a su catálogo. Ver §3. |
| **118** | `notificaciones.tipo` y `correos_enviados.tipo` aceptan `receta_emitida`. Ver §3. |

### Los atajos: por qué no son F2…F8

El prompt los pide y **no alcanzan**. El navegador ya usa F1 (ayuda), F3 (buscar), F5 (recargar),
F7 (cursor de texto en Firefox), F10 (barra de menú), F11 (pantalla completa) y F12
(herramientas). Quedan cinco libres y hacen falta siete.

Se eligió **Alt + letra** para las siete: **Alt+S** servicio, **Alt+P** producto, **Alt+V**
vacuna, **Alt+D** desparasitación, **Alt+R** receta, **Alt+E** estudio, **Alt+C** cerrar. Un juego
mitad teclas de función y mitad Alt no se recuerda. Los atajos están **visibles** al lado de cada
acción, que es como se aprenden.

---

## 2. El examen por sistemas (sección 5 del prompt)

- La opción elegida va **rellena** con su color: verde para Normal, rojo para Anormal, gris para
  No evaluado. Las no elegidas quedan en contorno.
- **La tarjeta de la fila toma el estado**, con fondo suave y un ícono (✓ / ⚠). Al recorrer el
  examen, lo anormal salta y lo no evaluado se distingue de lo revisado.
- Una fila anormal **abre su campo de detalle**, que es obligatorio, y queda **en rojo** hasta que
  se completa.
- **Se eliminó el texto duplicado «Sin evaluar»**: el estado lo dice el control.
- Al pie, el resumen en vivo —«4 normales · 1 anormal · 8 sin evaluar»— y el botón **Todo
  normal**, que marca lo que sigue sin evaluar y **no toca** lo que el médico ya marcó.
- Los colores salen de los tokens de estado, que no son configurables por clínica: un hallazgo
  anormal se lee igual en todas.

---

## 3. Los defectos reales encontrados

Siete. **Seis se vieron en el navegador y ninguno en el verificador.**

1. **Borrar una presentación rompía la receta y bloqueaba el borrado.** Lo encontró el verificador
   al limpiar su clínica de prueba: `ON DELETE SET NULL` sobre `presentacion_id` dejaba la línea
   sin origen y violaba su propio CHECK. Pasa cada vez que una clínica descontinúa un producto, y
   pasaría en la **purga** de una clínica. El arreglo de fondo (migración 117) es reconocer que
   una receta es un **documento**: guarda su nombre congelado y el origen pasa a ser «como máximo
   uno».
2. **El nombre del protocolo filtraba en vez de ordenar.** El producto se llama «Vacuna
   polivalente canina» y el protocolo «Polivalente»: como no coincidía exacto, la consulta no
   devolvía **ningún** protocolo y la pantalla pedía la fecha a mano.
3. **La especie se comparaba con mayúsculas.** La ficha guarda «Canino» y el protocolo «canino»,
   así que el protocolo de la especie no se encontraba nunca: una desparasitación interna de un
   perro sugería **un mes** (el protocolo general) en vez de **tres**.
4. **El panel decía «falta el peso» con el peso a la vista.** `verReceta` devolvía `null` mientras
   no existiera la fila de receta, y esa fila nace recién con la primera línea.
5. **14 tomas no son 14 cajas.** La receta calculaba correctamente 14 tomas (cada 12 h por 7 días)
   y usaba ese 14 como cantidad de la **presentación**, que es una caja de 20 tabletas:
   **₡126 000 en vez de ₡9 000**. Convertir con el factor tampoco alcanza —la dosis puede estar en
   mg y la presentación en cajas—, así que se entrega **una** presentación por defecto y el médico
   ajusta, en un campo que dice explícitamente que son presentaciones y no tomas.
6. **El CHECK de `notificaciones.tipo` no incluía el tipo nuevo**, así que enviar la receta
   fallaba con una violación de restricción. **Es la tercera vez que pasa lo mismo en este repo**:
   el CHECK y `TipoCorreo` son dos copias de la misma lista. Queda dicho en la migración 118.
7. **El envío decía «enviado» cuando no se había enviado.** `puedeEnviar()` bloqueó el correo por
   estar fuera de la franja 08:00–20:00 —correcto— y la pantalla igual decía que había salido.
   Ahora lee el estado real de la notificación y dice el motivo.

### Un hallazgo que NO es un defecto, y se hizo visible

Con Toby —alérgico a la penicilina— **el aviso de alergia no saltó al recetar amoxicilina**. Es
correcto: el grupo farmacológico sale de `medicamentos.clase` y ese producto del inventario no
está ligado al catálogo de medicamentos, así que no hay grupo que comparar. Las alergias **por
sustancia** sí se revisaron.

Lo que **sí** era un defecto es callarlo: «no hay aviso» puede querer decir «no hay alergia» o «no
se pudo comprobar», y son cosas muy distintas. La receta ahora lo dice en un aviso aparte.

---

## 4. Verificación

### En el navegador, con `demo.medico`

Recorrido completo sobre Toby, contrastado contra la base:

| Paso | Resultado |
|---|---|
| Las siete acciones con sus atajos visibles | ✔ |
| **Vacuna** con lote FEFO preseleccionado (VP-2026-A «sugerido») y próxima del protocolo | ✔ |
| **Desparasitación** con su tipo, lote DES-2026-A y próxima a 3 meses | ✔ |
| **Receta** de dos líneas: amoxicilina **12,5 mg/kg × 32,4 kg = 405 mg** dispensada, y omeprazol en texto libre para comprar afuera | ✔ |
| **Estudio** pedido desde la atención | ✔ |
| **Resumen del cierre**: 5 cargos, ₡61 000, tres salidas con su lote, dos avisos con su fecha, el control y la receta | ✔ |
| **Cierre y firma** | Atención `cerrada`, firmada por «Dra. Demo Vetline», con su cuenta. |
| **Caja** | 5 cargos: ₡25 000 + ₡8 000 + ₡14 500 + ₡4 500 + ₡9 000. |
| **Inventario por lote** | Vacuna de VP-2026-B, desparasitante de DES-2026-A, amoxicilina 13 + 7 unidades de dos lotes (= 1 caja de 20). |
| **Recordatorios** | Vacuna → 2027-11-26 (12 meses). Desparasitación → 2027-02-26 (3 meses, el de la especie). |
| **Receta firmada** | `emitida`, con firma, 2 líneas. |
| **PDF** | 25 570 bytes, `%PDF-1.3`, `Receta_Toby_2026-11-26.pdf`. |
| **Envío** | Bloqueado por la franja 08:00–20:00, **dicho**: «No se envió: Fuera de la franja 08:00–20:00. Se manda a las 08:00.» |

Capturas en `docs/diseno/capturas/07c/`, incluido el PDF emitido.

### Scripts

- `verificar_atencion_07c.ts` — **16 secciones, 48 aserciones, TODO OK**, sin `--transpile-only`.
- `verificar_expediente_bloque_b.ts` — TODO OK (una expectativa quedó al día: el primer sistema
  del examen cambió de nombre con la migración 112).
- `verificar_rutas_unicas.ts` — ninguna URL duplicada.
- `tsc --noEmit` limpio en backend y frontend.

---

## 5. El manual de usuario

Por la regla nueva de la sección 12 de la guía, se creó **`docs/ayuda/`** con su índice, el
**glosario** y las cinco páginas de esta entrega: vacunas y desparasitaciones, receta, estudios,
cierre y registro histórico. Cada una con sus ocho secciones y su ejemplo con números.

El manual consolidado en PDF y Word se genera **al cierre del bloque**, no en esta entrega.

---

## 6. Lo que quedó pendiente

1. **La pestaña Prescripciones no reimprime todavía.** El aviso de «dónde se registra» está, y el
   PDF se baja desde el panel de la receta en la atención; falta el botón de reimpresión en la
   historia.
2. **Los protocolos no tienen pantalla.** Se leen y se usan; para cambiarlos hoy hay que tocar la
   base. El endpoint `GET /expediente/protocolos` ya los expone.
3. **El `tipo_clinico` no se edita desde el catálogo de inventario.** La migración lo infirió
   donde el nombre no dejaba dudas y el script de demostración completó el resto; falta el campo
   en la pantalla del producto.
4. **La validación de dosis fuera de rango** (la del 07 por peso) no se conectó a la línea de
   receta: hoy avisa la alergia, no la dosis.
5. **La repetición de receta no se probó en el navegador**, solo en el verificador.
