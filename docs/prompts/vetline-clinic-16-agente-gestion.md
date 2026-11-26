# Vetline Clinic — 16 · Agente de IA de gestión

Se rige por `vetline-clinic-00-guia-rectora.md`, en especial la sección 9 (inteligencia del agente), la 8.3 (rentabilidad) y la 12 (cómo se trabaja).

Se construye en **dos entregas**:

- **16a · Ayuda del sistema:** no depende de nada pendiente y puede ir en la puesta en marcha.
- **16b · Asesor de gestión:** depende de los diagnósticos y del simulador que dejan el 10b, el 12, el 13 y el 14. Va después de ellos.

Cada entrega en su rama.

## Para quién y por qué

Las clínicas veterinarias suelen estar dirigidas por médicos veterinarios que no se formaron en administración ni en finanzas. El agente tiene que responder, con los datos de la propia clínica, preguntas como:

- ¿cómo mejoro la rentabilidad de la clínica o de un servicio?
- ¿qué líneas o productos no son rentables?
- ¿cómo mejoro y optimizo mi inventario?
- ¿cómo aumento los ingresos de una línea?
- ¿cómo aumento mis ventas este mes?
- ¿qué pasaría con el resultado del mes si las ventas de tal servicio caen un 10 %?

Y tiene que enseñar mientras responde.

**Regla rectora: sin dato no hay recomendación.** Toda sugerencia viene con el hecho que la sostiene, la lista concreta sobre la que se actúa y la forma de medir si funcionó. Una idea sin respaldo en los datos de la clínica no se presenta como recomendación.

## Principios de construcción (las dos entregas)

- **Herramientas, no SQL libre.** El agente trabaja con un catálogo de herramientas tipadas: las métricas del diccionario del 12, consultas de lectura de cada módulo, los diagnósticos, el simulador y las acciones por sus puertas únicas (crear cita, `emitirNotificacion` con `puedeEnviar()`, crear un borrador de campaña en el CRM, crear una orden de compra sugerida). No genera SQL.
- **Actúa como el usuario:** con sus permisos (resueltos desde la base, según el 04) y su tenant (RLS). Lo que la persona no puede ver o hacer, el agente tampoco. A una recepcionista no le muestra márgenes.
- **Nunca calcula de memoria.** Toda cifra sale de una herramienta y se muestra con **"ver de dónde sale"**, que abre la lista del drill-down del 12. Los resultados del simulador muestran sus supuestos.
- **Datos no son instrucciones.** El texto que viene de notas de clientes, mensajes, descripciones de productos o comprobantes de proveedores se trata como dato. Nunca cambia lo que el agente hace.
- **Nunca, con ninguna política:** escribir o modificar contenido clínico, mover saldo de controlados, anular, dar descuentos, registrar pagos ni enviar mensajes fuera del CRM y sus consentimientos.
- **Todo consumo de IA pasa por la compuerta de crédito existente.** Las tareas simples (clasificar la pregunta, extraer parámetros) usan un modelo liviano. El análisis y la redacción usan uno más capaz. La elección se documenta.
- **Auditoría:** cada conversación guarda las preguntas, las herramientas llamadas, sus parámetros y las acciones, marcadas como "hecho por el agente a pedido de X". Las respuestas que no pudo dar quedan registradas como señal de lo que falta construir.
- **Interfaz:** un panel lateral disponible en toda la app, que se abre con un atajo y desde Ctrl+K ("Preguntar…").
  - **Es contextual:** en la ficha de un cliente, de un producto o de un servicio, entiende "¿cuánto ha gastado?" o "¿es rentable?" sin repetir de quién se habla.
  - **Las respuestas tienen bloques visuales:** tablas, `KpiCard`, gráficos del sistema de diseño, listas con acciones.
  - Es responsive (PWA).

---

## 16a · Ayuda del sistema

- El agente responde **cómo se usa Vetline Clinic**: "¿cómo registro una vacuna?", "¿dónde anulo un tiquete?", "¿cómo creo un servicio?". Da el **camino de clics** y, cuando aplica, un enlace que lleva a esa pantalla.
- **Fuente:** una base de conocimiento del producto en `docs/ayuda/`, armada desde los caminos de clics de los informes de cada entrega, los textos de las pantallas y el relevamiento del marco (`docs/diseno/relevamiento-marco.md`). Se mantiene: cada entrega futura actualiza su parte de `docs/ayuda/` (se agrega como regla en la sección 12 de la guía).
- La respuesta tiene en cuenta el **rol** del usuario. Si pregunta por algo que su rol no permite, se lo dice y le indica quién puede hacerlo.
- Si la ayuda no cubre la pregunta, el agente lo dice y la pregunta queda registrada.
- **Verificación:** un banco de 40 preguntas de uso con su respuesta esperada, que debe aprobarse. Incluye las dudas reales que surgieron en la revisión: registrar atención, vacunas y receta; crear servicios; encontrar el expediente.

---

## 16b · Asesor de gestión

### 1. Diagnósticos: el agente los ejecuta, no los inventa

Cada tipo de pregunta de gestión corresponde a un **diagnóstico determinista**, construido en código, con su pantalla propia dentro del módulo dueño del dato. Así sirve también sin IA, y se puede revisar a mano. El agente reconoce la pregunta, ejecuta el diagnóstico o los diagnósticos, y prioriza y explica el resultado.

| Diagnóstico | Módulo dueño | Qué calcula |
|---|---|---|
| Rentabilidad | 10b | Margen por línea, servicio y producto; costo real del servicio (receta de insumos más tiempo de personal y sala); precio frente al costo actualizado; erosión de margen por compras más caras; descuentos dados; mezcla; punto de equilibrio |
| No rentables | 10b | Matriz volumen × margen por cuadrante; margen negativo o bajo el mínimo de la política; ítems sin costo cargado |
| Inventario | 06 o 12 | ABC por valor y margen; rotación y días de cobertura; stock muerto (sin movimiento en N días) y capital inmovilizado; quiebres y ventas perdidas; vencimientos y mermas; mínimos y máximos sugeridos según el consumo |
| Ingresos por línea | 13 | Descomposición clientes × frecuencia × ticket, para saber qué palanca falla; penetración entre líneas; preventivos vencidos; controles recomendados no agendados |
| Ventas del mes | 12 y 13 | Brecha frente al mes anterior y al mismo mes del año anterior; huecos libres en la agenda; preventivos que vencen en el mes; presupuestos aprobados sin convertir o vencidos; clientes inactivos; cuentas por cobrar |
| Recuperación y fidelización | 14 | Clientes que no vuelven: última visita, meses sin venir, gasto histórico, mascotas, preventivo pendiente y canal consentido |

Si alguno de esos módulos no dejó su diagnóstico, **se construye aquí, en el módulo dueño**, no dentro del agente.

### 2. Forma de cada recomendación

Cada recomendación tiene cinco partes:

1. **El hallazgo**, con su cifra y su fuente.
2. **Por qué ocurre**, con datos.
3. **La acción concreta**, con su efecto simulado cuando aplica (sección 3).
4. **La lista accionable**, con los clientes, productos, presupuestos o servicios concretos, y el botón que ejecuta: pasar a una campaña del CRM (solo contactos con consentimiento), generar una orden de compra sugerida o abrir el producto para ajustar su precio. La ejecución respeta la autonomía de la sección 5.
5. **La medición:** al ejecutarse, queda registrada como **iniciativa** (sección 4).

**Estimaciones con supuesto visible:** el valor estimado de una acción usa la historia de la propia clínica, por ejemplo la tasa de respuesta de sus campañas anteriores. Si no hay historia, usa un supuesto conservador y lo dice ("supuesto: 15 % de respuesta").

**Sin comparaciones inventadas con la industria:** el agente compara la clínica con su propia historia. Un referente externo solo entra si está configurado con su fuente.

**Datos insuficientes:** el agente lo dice y entrega lo que falta. Por ejemplo: "No puedo calcular la rentabilidad del grooming: 14 servicios no tienen costo cargado. Esta es la lista".

**Enseñar:** cuando usa un concepto (margen de contribución, rotación, punto de equilibrio, ticket promedio), lo explica en una línea con el ejemplo de la clínica. Hay un glosario consultable.

### 3. Simulador de escenarios

Un motor **determinista** de escenarios (construido en el 10b, con su pantalla en Finanzas › Simulador; si el 10b no lo dejó, se construye ahí) calcula el **resultado operativo** de un período bajo supuestos.

**El modelo:**
- **Base:** el mes elegido, o el promedio de los últimos N meses, con opción de estacionalidad según el mismo mes del año anterior.
- Ingresos por línea, servicio y producto: volumen × precio.
- Costo variable unitario: costo de inventario y receta de insumos.
- Margen de contribución.
- Costos fijos: gastos recurrentes y promedio de gastos del 10a, planilla y alquiler.
- **Resultado operativo** = margen de contribución − costos fijos.

**Las palancas**, combinables:
- volumen de un servicio, producto o línea (±%);
- precio (±% o un monto);
- costo de un insumo o producto (por ejemplo, el proveedor sube un 8 %);
- un costo fijo nuevo o eliminado (un médico más, un alquiler mayor);
- capacidad (abrir los sábados, una sala más);
- mezcla de ventas.

**Efectos y restricciones:**
- **Efectos cruzados opcionales:** si el 13 midió que el grooming arrastra ventas de productos, el escenario puede aplicar ese arrastre. Va marcado como supuesto, con el valor medido y desactivable.
- **Capacidad:** si un aumento de volumen supera la capacidad de la agenda (horarios del 04), el simulador lo advierte y dice cuánta capacidad haría falta.

**Lo que entrega:**
- tabla antes y después por línea;
- gráfico de cascada del resultado;
- punto de equilibrio;
- **sensibilidad**: qué variable mueve más el resultado, en un gráfico de tornado;
- escenarios guardados, con nombre, para comparar lado a lado;
- exportación a Excel y PDF.

**El agente frente al simulador:**
- El agente traduce la pregunta a parámetros. "¿Qué pasa si las castraciones caen un 10 % y sube un 5 % el precio de las vacunas?" se convierte en dos palancas.
- **Muestra los parámetros y la base antes de correr**, para que el usuario los confirme o ajuste.
- Ejecuta el motor y explica el resultado en lenguaje simple, con los supuestos visibles.
- **El modelo nunca hace la aritmética.**
- También responde preguntas inversas: "¿cuántas consultas más necesito para pagar un médico nuevo?" (punto de equilibrio de una decisión).

### 4. Iniciativas y seguimiento

Toda recomendación ejecutada queda como **iniciativa**:
- qué se hizo, cuándo y sobre qué lista;
- la métrica que debe moverse, con su punto de partida y el horizonte (30, 60 o 90 días).

Al vencer el horizonte, el agente informa el resultado medido con la misma métrica. Por ejemplo: "La campaña de recuperación trajo a 9 de 48 clientes y ₡410 000 en ventas en 30 días". Para campañas, la atribución es la del CRM del 14.

Hay una pantalla de iniciativas con su estado y su resultado. Ese historial alimenta las estimaciones futuras.

### 5. Resumen de la mañana, alertas y autonomía

**Resumen de la mañana** para el administrador, en la app y, más adelante, por WhatsApp vía Converza, dentro de sus consentimientos:
- agenda del día;
- cargos fugados;
- cuentas vencidas;
- stock crítico y vencimientos;
- laboratorios sin ver;
- controles recomendados no agendados;
- variaciones relevantes de una línea frente a su propia historia;
- el estado de las iniciativas.

Las alertas las detectan **reglas en código**. El agente prioriza y redacta. Se genera una vez al día por clínica.

**Autonomía graduada** por tipo de acción, según la política del 04: informa, sugiere, ejecuta con confirmación o ejecuta solo. **Por defecto, todo lo que modifica algo pide confirmación.** "Ejecuta solo" lo habilita el administrador, acción por acción.

### 6. Calidad

- **Banco de evaluación:** preguntas de gestión sobre el historial de demostración del 12, con la respuesta esperada calculada por los diagnósticos y el simulador. El banco revisa tres cosas:
  - que las cifras coincidan;
  - que cada recomendación tenga sus cinco partes y su lista;
  - que no aparezca ninguna recomendación sin dato.

  Debe aprobarse antes de cada entrega.
- **Pruebas de permisos:** la misma pregunta con roles distintos da respuestas acordes a cada rol.
- **Pruebas de inyección:** una nota de cliente con instrucciones dirigidas al agente no cambia su comportamiento.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador:

- **16a:** el banco de 40 preguntas de uso.
- **16b**, con el historial de demostración:
  - cada una de las preguntas de "Para quién y por qué", con sus listas y acciones;
  - pasar una lista de clientes inactivos a una campaña del CRM y verla como iniciativa;
  - un escenario de caída del 10 % de un servicio con aumento de precio de otro, con la cascada y la sensibilidad;
  - una pregunta inversa de punto de equilibrio;
  - el resumen de la mañana;
  - una pregunta con datos insuficientes.

El informe incluye el catálogo de herramientas, los diagnósticos usados y su módulo, el modelo del simulador con sus fórmulas, los resultados del banco de evaluación y los costos de IA medidos por conversación.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
