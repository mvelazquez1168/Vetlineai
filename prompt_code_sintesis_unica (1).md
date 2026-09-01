# Prompt para Claude Code — Una síntesis, dos vistas

Hoy el dashboard y el informe son dos llamadas independientes sobre el mismo
caso. Cuestan el doble y pueden contradecirse.

---

```
Contexto: Vetline Ai. El dashboard y el informe se generan por separado, cada
uno con su propia llamada al modelo, sobre el mismo caso y con la misma
información de base.

Eso tiene dos problemas. El costo se paga dos veces. Y, más grave: son dos
razonamientos independientes, así que pueden discrepar sobre el mismo paciente
sin que nadie lo note hasta que alguien compare.

LA PROPUESTA

Una síntesis clínica por caso, generada una sola vez, y dos formas de mostrarla:
el dashboard es la vista en pantalla, el informe es el documento.

PASO 1 — Relevamiento, antes de construir

Reportame:

  Qué genera hoy el informe que el dashboard no tenga. Campo por campo. Eso
  define si la síntesis alcanza o hay que ampliarla.
  Qué genera el dashboard que el informe no use.
  Cómo se guarda hoy el dashboard y si sirve como fuente persistente.
  Y qué pasa cuando el caso avanza: si hay forma de saber que la síntesis quedó
  vieja.

Esperá mi confirmación.

PASO 2 — La restricción que no se negocia

EL DASHBOARD NO SE EMPOBRECE. Al contrario.

Quiero el dashboard tan completo como sea posible: cronología, diferenciales,
análisis de correlación, estado clínico, todo lo que hoy tiene y lo que pueda
sumar.

La síntesis SE DISEÑA PARA EL DASHBOARD, y el informe toma de ahí lo que le
sirve. Nunca al revés.

Si la síntesis se diseñara con la estructura del documento en la cabeza, el
dashboard quedaría limitado a lo que un documento puede mostrar, y perdería
justamente lo que solo tiene sentido en pantalla.

Y si el informe necesita algo que la síntesis no tiene, la respuesta es sumarlo
a la síntesis, no generar aparte.

PASO 3 — La síntesis se genera cuando hace falta

No debe depender de que alguien haya abierto el dashboard antes. Si el médico
pide el informe y no hay síntesis, se genera en ese momento y sirve para los
dos.

Y tiene que poder regenerarse cuando el caso avanza. Hoy el estado clínico vive
como una foto congelada en el caché del dashboard, y un caso que mejoró sigue
mostrando lo último que dijo el agente. Con la síntesis como fuente única, eso
deja de estar escondido.

PASO 4 — El informe pregunta para quién es

Al generar el informe, el médico elige el destinatario: un colega o el tutor.

PARA UN COLEGA: composición pura desde la síntesis. Cero consumo de inteligencia
artificial. El lenguaje técnico ya está en la síntesis.

PARA EL TUTOR: adaptación del lenguaje. "Infiltrado linfoplasmocítico moderado"
no le dice nada a un dueño de mascota.

REGLA DURA para esa adaptación: solo puede reformular lo que la síntesis dice.
No puede agregar contenido clínico, ni matizar un pronóstico, ni sumar
tranquilidad que el veterinario no expresó.

Una versión simplificada que suaviza lo que el médico dijo es peor que no
tenerla. La adaptación traduce, no interpreta.

Y esa adaptación NO necesita el contexto completo: toma la síntesis ya hecha y
reescribe. Entrada chica, salida chica, sin volver a cargar la base de
conocimiento.

PASO 5 — Coherencia

Con una sola fuente, el dashboard y el informe no pueden contradecirse. Eso es
más importante que el ahorro.

Confirmame que el informe generado y el dashboard mostrado reflejan exactamente
la misma síntesis, y qué pasa si la síntesis se regenera después de haber
emitido un informe.

VERIFICACIÓN

  Generar el dashboard y después el informe para colega: el segundo no consume.
  Pedir el informe sin haber abierto el dashboard: la síntesis se genera y el
  dashboard después la muestra sin volver a generar.
  El informe para tutor no contiene ninguna afirmación clínica que no esté en la
  síntesis.
  Comparar el dashboard y el informe del mismo caso: mismo estado, mismos
  diferenciales, misma cronología.
  Medir el costo antes y después, por caso completo.

LO QUE NO DEBÉS HACER

  - No recortes nada del dashboard.
  - No diseñes la síntesis a partir de la estructura del informe.
  - No hagas que el informe dependa de que el dashboard se haya generado antes.
  - No permitas que la versión para el tutor agregue contenido clínico.
```

---

## Lo que más vale de esto no es el ahorro

**Hoy el dashboard y el informe pueden decir cosas distintas sobre el mismo
paciente**, porque son dos razonamientos independientes. Nadie lo notaría hasta
que alguien compare el documento con la pantalla.

Una sola fuente no puede contradecirse consigo misma.

## Y el efecto secundario sobre el estado congelado

El estado clínico vive hoy escondido en el caché del dashboard, y por eso un caso
que mejoró sigue alertando si nadie lo regeneró.

Con la síntesis como fuente única y explícita, ese problema deja de ser un efecto
lateral de un caché y pasa a ser algo que se puede ver y actualizar.
