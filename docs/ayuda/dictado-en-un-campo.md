# Dictar en un campo

## Para qué sirve

Escribir con el paciente encima de la mesa es incómodo y lento. Con el dictado se habla y el texto
aparece en el campo.

Esto es el dictado **de un campo**: el motivo, la anamnesis, un hallazgo, la evaluación, el
tratamiento, las indicaciones. Si lo que quiere es dictar **toda la consulta de corrido** y que el
sistema la reparta, eso es otra cosa: vea [Dictar la consulta completa](dictado-consulta-completa.md).

## Cuándo se usa

En cualquier momento, en cualquier campo de texto largo. No consume crédito de IA y no hace falta
que la clínica active nada.

## Quién puede usarla

Cualquiera que pueda escribir en ese campo. En la atención, eso es el **médico**.

## Paso a paso

1. Al lado del título del campo hay un **micrófono**. Clic.
2. La primera vez, el navegador pide permiso para usar el micrófono. **Permitir.**
3. Hable. El texto va apareciendo mientras habla.
4. Para detener: clic de nuevo en el micrófono, o **Alt+M**.

Mientras el micrófono está abierto hay una **franja roja fija abajo de la pantalla** que dice en qué
campo se está dictando. No desaparece al bajar en el formulario.

### El atajo

**Alt+M** inicia y detiene el dictado **del campo que tiene el cursor**. Si el cursor no está en un
campo dictable, no hace nada: con nueve campos dictables en la atención, un atajo que adivinara en
cuál dictar sería peor que no tenerlo.

## Los comandos de puntuación

El motor de voz devuelve «punto» como una palabra más. Estas palabras se convierten en su signo:

| Lo que dice | Lo que queda |
|---|---|
| punto | `.` y la palabra siguiente en mayúscula |
| coma | `,` |
| punto y coma | `;` |
| dos puntos | `:` |
| punto y aparte | `.` y un párrafo nuevo |
| nueva línea | un renglón nuevo |
| signo de interrogación | `?` |

Las palabras que **contienen** una de ésas no se parten: «conviene **apuntar** el peso» y «sin
signos de **comadreja**» quedan como se dijeron.

## Un ejemplo

Se dice:

> el paciente llega decaído **punto** no come desde ayer **punto y aparte** se indica reposo **punto** control en diez días

Queda:

```
el paciente llega decaído. No come desde ayer.

Se indica reposo. Control en diez días
```

## En qué navegadores funciona

**Chrome, Edge y Opera en computadora, y Chrome en Android.** En esos el dictado lo hace el
navegador, sin mandar nada a ningún servidor nuestro.

**En iPhone y en Safari no hay micrófono en los campos**, y en su lugar aparece un ícono gris que
lo explica. No es una falla: Safari no tiene esta función. Para dictar desde un iPhone está
[Dictar la consulta completa](dictado-consulta-completa.md), que sí funciona ahí porque la
transcripción la hace el servidor.

El botón **nunca aparece apagado**: o está, o en su lugar está el ícono que dice dónde funciona.

## Qué pasa después

El texto dictado **se agrega** a lo que ya había escrito; nunca lo reemplaza. Se puede corregir a
mano en cualquier momento, antes o después de dictar. El campo se guarda solo, como siempre.

## Preguntas frecuentes y errores comunes

**Dicté y no apareció nada.**
Revise que el navegador no haya bloqueado el micrófono (el candado de la barra de direcciones). Si
dice «No se pudo acceder al micrófono», es eso.

**Se cortó solo.**
El navegador corta el reconocimiento tras un silencio largo. Toque el micrófono otra vez y siga.

**Cambié de pestaña y se detuvo.**
A propósito. Un micrófono abierto en una pantalla que nadie mira es grabar sin que se note.

**Dicté en el campo equivocado.**
El texto se agrega donde está el cursor. Córtelo y péguelo donde va, o bórrelo y dicte de nuevo.

**¿El audio queda guardado?**
No. En el dictado de un campo no hay audio: el navegador escucha y entrega texto. Nada sale de la
computadora.
