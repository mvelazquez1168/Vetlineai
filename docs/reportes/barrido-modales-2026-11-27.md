# Barrido — los modales con formulario no se cierran con un clic afuera

Rama `vetline-clinic/barrido-modales`, partiendo de la rama del arreglo de especie (que trae el 12).
Nada fusionado a `main`. Sin migraciones: es todo frontend.

Verificador nuevo `npm run verificar-modales`: **TODO OK** contra el estado nuevo y
**15 fallos contra el estado anterior**, que es la prueba de que sirve.

---

## 1. El defecto, y por qué era de todo el sistema

Se reportó desde **Finanzas › Gastos › Registrar un gasto**: un clic fuera del modal lo cerraba y se
perdía lo escrito.

No era un descuido de esa pantalla. `Modal.tsx` llamaba a `onClose` en el clic sobre el fondo —y lo
usan **45 archivos, con 102 modales**—, y otros **once componentes se armaban su propio fondo**
(`fixed inset-0`) copiando el mismo `onClick={onClose}`. Trece fondos en total contando los dos
archivos que tenían dos.

El mismo defecto en catorce lugares no se arregla catorce veces: se arregla en uno y se impide que
vuelva.

---

## 2. La regla, en un solo componente

`components/ui/CapaModal.tsx` es ahora el único lugar del sistema que decide **cuándo se cierra un
modal**. `Modal.tsx` lo usa por dentro, así que los 102 modales cambiaron de comportamiento sin
tocar ninguno.

| Tipo | Clic afuera | Esc, X o Cancelar |
|---|---|---|
| **Con formulario o acción** (por omisión) | **no cierra** | cierra si no hay cambios; con cambios, pregunta |
| **De consulta** (solo lectura) | cierra | cierra |

Tres decisiones, con su motivo:

1. **El tipo por omisión es «formulario».** Es el caso seguro: un modal nuevo que se olvide de
   declarar su tipo no va a perder lo que alguien escribió. El de consulta se pide explícitamente, y
   hoy son 6 de 102.
2. **En un modal de formulario, el clic afuera no hace NADA**: ni cierra, ni pregunta. Preguntar en
   cada clic al costado sería un diálogo cada dos minutos.
3. **La confirmación aparece solo si hay algo escrito.** Una confirmación que aparece siempre se
   vuelve un trámite y se contesta sin leerla, que es la forma elegante de no proteger nada.

**Dos cosas que ningún modal del sistema hacía y ahora hacen todos:** el foco queda adentro mientras
está abierto (el tabulador no se va a la página de atrás) y vuelve al botón que lo abrió al cerrarse.

**Un modal encima de otro no cierra el de abajo:** la confirmación de descartar tiene su propia capa
y su propio Esc, y detiene la propagación del clic.

---

## 3. Dónde vive «hay cambios sin guardar»

En los dos formularios compartidos —cliente y paciente— el hook expone `sucio`, comparando los
valores con los que tenía al abrirse:

```
const form = useFormularioPaciente(valoresDelPaciente);
…
<Modal hayCambios={form.sucio} …>
```

Vive en el hook y no en cada modal porque **es el hook el que sabe con qué valores se abrió**.
Calcularlo afuera obligaría a cada pantalla a guardarse una copia del inicial, y la tercera que lo
hiciera lo haría distinto. `reiniciar()` mueve también esa referencia: cargar la ficha que se va a
editar no deja el formulario «sucio».

Los modales con estado propio declaran su expresión. Por ejemplo:

| Modal | Hay algo que perder cuando… |
|---|---|
| Registrar un gasto | hay descripción, monto o categoría |
| Nueva cita | se eligió paciente, o se tocó la fecha o la hora |
| Cerrar caso | hay diagnóstico, tratamiento activo o el desenlace cambió |
| Reabrir caso | hay motivo escrito |
| Nuevo caso (wizard) | se pasó del paso 1 o hay motivo |
| Registro de atención | hay nota médica, peso o temperatura |

**Vincular atención anterior no lleva confirmación a propósito**: cada vínculo se guarda en el
momento, así que al cerrar no hay nada escrito que se pueda perder. Sigue siendo de formulario —el
clic afuera no cierra— porque es un modal de acción.

**Las acciones irreversibles tampoco preguntan al cerrar:** «Marcar como fallecido» o «Continuar sin
enviar los archivos» cancelan sin más. Cancelar una acción irreversible es lo seguro; preguntar
«¿descartar?» para no hacer algo que no se puede deshacer sería al revés.

---

## 4. Los trece fondos propios, uno por uno

| Componente | Qué es | Tipo asignado |
|---|---|---|
| `ui/Modal.tsx` | el modal genérico, 102 usos | pasa a `CapaModal` |
| `PaletaComandos` (Ctrl+K) | buscador, solo lectura | **consulta** |
| `PaletaComandos` (ayuda de atajos) | lista de teclas | **consulta** |
| `CronologiaModal` | la cronología del caso | **consulta** |
| `BaseConocimiento` (vista previa) | el PDF de un documento | **consulta** |
| `CerrarCasoModal` | desenlace, diagnóstico, fallecimiento | formulario, con confirmación |
| `ReabrirCasoModal` | motivo de reapertura | formulario, con confirmación |
| `ResolverCitaModal` | elegir o crear la cita | formulario, con confirmación |
| `VincularAtencionModal` | vincular atenciones sueltas | formulario, sin confirmación (ver §3) |
| `RegistroAtencionModal` | nota médica, peso, temperatura | formulario, con confirmación |
| `RegistroAtencionModal` (fallecimiento) | acción irreversible | formulario, sin confirmación |
| `FichaPropietarioModal` | pestañas, una de ellas edita | formulario, con confirmación |
| `NuevaCitaModal` | el formulario de la cita | formulario, con confirmación |
| `CasoWorkspace` (nuevo caso) | wizard de tres pasos | formulario, con confirmación |
| `CasoWorkspace` (archivos sin enviar) | decisión de abandonar | formulario, sin confirmación |

Dos de los once se volvieron **consulta** y el resto de formulario. Las dos pestañas de
`FichaPropietarioModal` que son de lectura no la hacen de consulta: **el clic afuera no puede
depender de la pestaña que esté abierta**.

La lista completa de los 102 modales, con su tipo, está en
[`anexos/inventario-modales-2026-11-27.md`](anexos/inventario-modales-2026-11-27.md) y se puede
regenerar.

**Tres `fixed inset-0` quedaron, con su motivo escrito en el verificador:** `CapaModal.tsx` (es la
regla), `BackdropMenuMovil.tsx` (el cajón del menú en móvil, que no tiene formulario y cerrarse al
tocar afuera es su gesto esperado) y `PanelAyuda.tsx` (panel lateral de consulta que no bloquea el
trabajo de atrás).

---

## 5. Que no vuelva a pasar

`frontend/scripts/verificar_modales.mjs`, corrible con `npm run verificar-modales`, falla si:

1. aparece un **`fixed inset-0` fuera de `CapaModal.tsx`** y de las tres excepciones justificadas;
2. un modal declarado **`tipo="consulta"` tiene `<Input`, `<Select`, `<textarea` o `hayCambios`**
   adentro: un modal de consulta con formulario está mal declarado, y declararlo mal es la otra
   forma de volver al defecto.

**Primero se comprobó que falla contra el estado anterior**, que es lo que el prompt pide: se
extrajeron del commit previo los doce archivos tocados y el verificador los rechazó con **15
hallazgos**, uno por cada fondo propio (los dos de `PaletaComandos`, los dos de
`RegistroAtencionModal`, los dos de `CasoWorkspace`, el de `Modal.tsx` y los ocho restantes). Contra
el estado nuevo da **TODO OK** sobre 241 archivos.

Y la regla quedó escrita en la **guía rectora, §4.7**, con su tabla, para que el próximo prompt no
tenga que deducirla del código.

---

## 6. Qué se verificó, y qué no

| Qué | Cómo |
|---|---|
| Los 13 fondos propios desaparecieron | `verificar-modales`: **TODO OK** |
| El verificador **falla** contra el estado anterior | 15 hallazgos sobre los 12 archivos del commit previo |
| Ningún modal de consulta tiene campos adentro | idem (la regla 2 del verificador) |
| Los 102 modales compilan | `tsc --noEmit` limpio |
| Los dos formularios compartidos exponen `sucio` y lo reinician bien | lectura del código; `reiniciar()` mueve la referencia |

**No se probó en el navegador.** No hay automatización de navegador en este entorno. El prompt pide
el recorrido con Registrar un gasto, Nueva cita y el alta de paciente —clic afuera que no cierra, Esc
con cambios que pregunta, Esc sin cambios que cierra— y queda pendiente de hacerse a mano. Lo que
está probado es que el patrón ya no existe en el código y que no puede volver sin que el verificador
lo diga.

**El foco y su devolución tampoco se probaron en vivo**, por lo mismo. Están implementados en un
solo lugar (`CapaModal`), que es la parte que se podía asegurar sin navegador.
