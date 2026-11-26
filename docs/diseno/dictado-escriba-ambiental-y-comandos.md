# Escriba ambiental y comandos de voz — documentado, NO construido

Sección 3 del prompt `vetline-clinic-07d-dictado-por-voz.md`. Las dos cosas quedan fuera del
alcance entregado, a pedido explícito del prompt. Esto es lo que implicarían, para que la decisión
de construirlas o no se tome con el costo a la vista y no de nuevo desde cero.

Estado al 26/11/2026: **nada de esto está en el código.** Si algún día aparece una pantalla que lo
ofrezca sin que este documento cambie, es un defecto.

---

## 1. Escriba ambiental

**Qué sería.** Grabar la conversación completa entre el médico y el dueño durante la consulta —no un
dictado dirigido al sistema, sino el diálogo real— y generar la nota clínica a partir de ahí, sin
que el médico tenga que dictar nada.

### Por qué es tentador

Es la diferencia entre «hablarle al sistema» y «no hacer nada». El médico entra, atiende, y la nota
aparece. Es el producto que venden Abridge, Nuance DAX y Heidi en medicina humana, y lo que más
tiempo ahorra de todo lo que el 07d podía hacer.

### Por qué no se construye acá

**El problema no es técnico, es de consentimiento.** Grabar un dictado es grabar al médico, que es
el usuario del sistema y lo activa él. Grabar la consulta es grabar **a un tercero que no es usuario
nuestro**: el dueño del paciente.

Lo que haría falta, y no existe hoy:

1. **Consentimiento explícito, informado y registrado del dueño**, por consulta o con una vigencia
   declarada, con constancia de quién lo dio, cuándo y para qué. El módulo de consentimientos del
   expediente (`exp_consentimientos`, bloque A del 07) es el lugar natural, pero una plantilla de
   consentimiento para grabación de audio no es la misma figura que un consentimiento quirúrgico:
   hay que redactarla con criterio legal, no clonarla.
2. **Un análisis legal por país.** Costa Rica tiene la Ley 8968 de protección de la persona frente
   al tratamiento de sus datos personales, y una grabación de voz es un dato personal del dueño. Los
   países a los que la plataforma se expanda tendrán otra. Esto no se resuelve con una casilla.
3. **Poder revocar.** Si el dueño retira el consentimiento, hay que poder borrar el audio y decir
   qué quedó derivado de él. Hoy el expediente no sabe distinguir «esto lo escribió el médico» de
   «esto salió de una grabación».
4. **Qué pasa con lo que el dueño dice y no es clínico.** Una consulta real incluye el precio, la
   situación económica de la familia, el estado de otra mascota, una discusión. Un escriba ambiental
   lo escucha todo. Decidir qué se descarta —y poder demostrar que se descartó— es parte del
   producto, no un detalle de implementación.
5. **Un modelo de diarización** (quién habla) razonable en español de Costa Rica, con dos o tres
   voces y ruido de clínica. Deepgram lo ofrece; la precisión real en ese escenario está sin medir.

### Qué se reusaría si se construyera

Casi toda la fase 2:

- `transcripcion.ts` — la interfaz del proveedor, agregando `diarize=true`.
- `dictadoBorrador.ts` — el ordenamiento, con otra instrucción (del diálogo hay que extraer, no
  repartir).
- `exp_dictados` — la tabla ya guarda texto, borrador y retención de audio.
- La revisión campo por campo del borrador, tal cual.

### Lo que NO se reusaría

La regla de que el médico activa y detiene. Un escriba ambiental graba toda la consulta, y el
indicador de «micrófono abierto» pasa de ser una cortesía a ser una obligación legal frente al
dueño: tiene que verlo él, no solo el médico.

### Costo estimado si se decidiera construir

| Parte | Esfuerzo |
|---|---|
| Plantilla de consentimiento + registro + revocación | medio, y bloqueado por la revisión legal |
| Diarización y medición de precisión con audio real de clínica | medio |
| Extracción (no reparto) del diálogo, con descarte de lo no clínico | alto |
| Indicador visible para el dueño y control de la grabación | bajo |
| Retención, borrado y trazabilidad de lo derivado del audio | medio |

**Lo que lo bloquea no es ninguna de esas filas: es el análisis legal.** Mientras no esté, construir
el resto deja un sistema que no se puede encender.

---

## 2. Comandos de voz

**Qué sería.** Decir «cerrar atención», «agregar vacuna», «ir a la agenda» y que el sistema lo
ejecute, sin tocar la pantalla.

### Por qué no se construye acá

No es un problema de reconocimiento: la Web Speech API ya entiende «cerrar atención». El problema es
**qué pasa cuando entiende mal**.

El dictado tiene una propiedad que lo hace seguro: **su resultado es texto editable**. Si reconoce
mal, se ve y se corrige. Un comando de voz no tiene esa propiedad: ejecuta. Y los verbos de esta
pantalla no son reversibles —cerrar la atención firma, cobra, descuenta inventario y agenda, todo
junto (ver [cerrar la atención](../ayuda/atencion-cierre.md))—.

Entonces un comando de voz útil necesitaría:

1. **Confirmación hablada de dos pasos** para todo lo irreversible, que es casi todo lo que vale la
   pena ejecutar por voz. Y «¿confirma? — sí» reconocido mal es el mismo problema una capa más
   abajo.
2. **Una lista cerrada de comandos**, no lenguaje natural. «Agregá la vacuna esa que le pusimos la
   vez pasada» no es un comando, es una conversación.
3. **Un lugar donde ver qué se ejecutó por voz**, separado de lo que se hizo con el mouse, para
   poder auditar un cierre que nadie recuerda haber confirmado.

### Lo que sí tiene sentido, y ya está

Los **atajos de teclado**, que la atención ya tiene: Alt+S servicio, Alt+P producto, Alt+V vacuna,
Alt+D desparasitación, Alt+R receta, Alt+E estudio, Alt+C cerrar, Alt+M dictar. Resuelven el mismo
problema —no soltar lo que se tiene en la mano para buscar un botón— sin el riesgo de ejecutar algo
que nadie dijo.

### Si alguna vez se construyera

El orden sensato sería **navegación primero, acciones nunca**: «ir a la agenda» o «abrir el
expediente de Toby» son reversibles y no tienen consecuencia. «Cerrar atención» no debería ser un
comando de voz ni con confirmación: el cierre es el acto que el 07 definió como explícito, y
hacerlo por voz lo vuelve menos explícito, no más cómodo.
