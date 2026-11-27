# Barrido: los modales con formulario no se cierran con un clic afuera

Rama: `vetline-clinic/barrido-modales`, que parte de la rama del 16a. Va en la cola **justo después del 16a y antes del 05**. Es corto.

## El problema

En Finanzas › Gastos › **Registrar un gasto**, un clic fuera del modal lo cierra y se pierde lo escrito. Pasa en todo el sistema:
- `components/ui/Modal.tsx` llama a `onClose` en el clic sobre el fondo (línea ~55), y lo usan unos 16 modales;
- al menos 11 componentes arman su propio fondo con `fixed inset-0`: `CerrarCasoModal`, `CronologiaModal`, `FichaPropietarioModal`, `ReabrirCasoModal`, `RegistroAtencionModal`, `ResolverCitaModal`, `VincularAtencionModal`, `PaletaComandos`, `NuevaCitaModal`, `BaseConocimiento` y `CasoWorkspace`.

## Resultado esperado

**Dos tipos de modal, con una regla para cada uno:**

| Tipo | Ejemplos | Clic afuera | Esc, X o Cancelar |
|---|---|---|---|
| **Con formulario o acción** | Registrar un gasto, Nueva cita, Pedir un estudio, alta de paciente, cerrar caso | **No cierra** | Cierra si no hay cambios. Si hay cambios sin guardar, pregunta «¿Descartar los cambios?» |
| **De consulta**, solo lectura | Cronología, paleta Ctrl+K, vista previa de un archivo | Cierra | Cierra |

- **`Modal.tsx`:** por omisión **no se cierra con el clic afuera**. Se cierra con el clic afuera solo si se le pasa explícitamente la propiedad de modal de consulta. Recibe también un indicador de «hay cambios sin guardar» para la confirmación.
- **Los 11 componentes con fondo propio** pasan a usar `Modal.tsx`, o, si eso no es posible sin perder funcionalidad, aplican la misma regla. Antes de tocar cada uno, se mira qué hace hoy para no perder nada.
- **Un modal encima de otro** (por ejemplo, la confirmación de descartar) no cierra el de abajo.
- **El foco queda dentro del modal** mientras está abierto, y vuelve al botón que lo abrió al cerrarse.

## Que no vuelva a pasar

- Un verificador que **falle** si aparece un `fixed inset-0` fuera de `Modal.tsx` y de una lista corta de excepciones justificadas, o un `Modal` de formulario con cierre al clic afuera. Primero tiene que fallar contra el estado actual.
- Una regla nueva en la sección 4.7 de la guía rectora (`vetline-clinic-00-guia-rectora.md`): «Un modal con formulario nunca se cierra con un clic fuera de él; cerrarlo con cambios sin guardar pide confirmación».

## Verificación y entrega

- La lista de todos los modales del sistema, con su tipo asignado.
- Una prueba en el navegador con al menos Registrar un gasto, Nueva cita y el alta de paciente: un clic afuera no cierra, Esc con cambios pide confirmar, y Esc sin cambios cierra.
- Un informe corto en `docs/reportes/`, y commit con push.

Este trabajo se detiene solo ante una contradicción con lo construido.
