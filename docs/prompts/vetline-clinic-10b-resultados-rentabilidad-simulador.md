# Vetline Clinic — 10b · Resultados, rentabilidad y simulador

Rama: `vetline-clinic/10b-resultados-rentabilidad`, que parte de la rama del 14. Va en la cola justo antes del 16b. Se rige por `vetline-clinic-00-guia-rectora.md`: secciones 8.2 y 8.3 para el contenido, y sección 12 para la forma de trabajo. El simulador sigue la especificación de la sección 3 de `vetline-clinic-16-agente-gestion.md`.

## Por qué existe

El 10a cerró el ciclo del dinero que sale: cuentas por pagar, pagos, gastos asignados a línea, cuentas por cobrar, cierre diario y exportación para el contador. El 12 dejó el diccionario de métricas y el 13 el arrastre medido entre líneas.

Falta lo que la dueña de una clínica necesita para **decidir**:
- cuánto ganó la clínica y cada línea de negocio;
- qué servicios y productos dejan margen y cuáles no;
- cuánta plata va a tener el mes que viene;
- cómo va contra lo que presupuestó;
- qué pasaría si cambia un precio, un costo o un volumen.

Y lo que el asesor de gestión (16b) necesita para responder esas preguntas: los **diagnósticos de rentabilidad y de no rentables**, y el **simulador**.

**Regla central** (sección 8.2): **finanzas consolida, no recaptura.** Toda cifra sale de una fuente que ya existe: el diccionario del 12, los movimientos de inventario, los gastos del 10a, las comisiones del 11 y los comprobantes. Este prompt no reemplaza al contador ni produce estados financieros oficiales.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y se reutiliza:
- el diccionario de métricas del 12 (ingresos, margen de contribución, regla de «sin costo»);
- el costo de los productos desde los movimientos de inventario (06);
- las recetas de insumos de los servicios y los kits (06 y 11);
- los gastos con su asignación a línea, los recurrentes, las cuentas por pagar y por cobrar (10a);
- las comisiones liquidadas (11);
- los horarios y salas (04), para el costo por minuto y la capacidad;
- los descuentos autorizados y las campañas con su venta atribuida (08b y 14);
- los comprobantes emitidos y recibidos, con su IVA (09a y 09b);
- el arrastre medido entre líneas (13);
- la política de margen mínimo (04).

Si una cifra que este prompt necesita no está en el diccionario del 12, se agrega ahí. No se calcula una segunda vez.

## 1. Estado de resultados por línea de negocio

Un estado de resultados **de gestión** por período, con comparación contra el período anterior y contra el mismo período del año anterior:
- ingresos por línea;
- costo directo por línea: productos, insumos de servicios y comisiones;
- **margen de contribución** por línea, en monto y porcentaje;
- gastos directos asignados a cada línea (10a);
- gastos generales;
- **resultado operativo**.

**Reparto de gastos generales:** es opcional y se muestra aparte, con el criterio visible y configurable (por ingresos, por horas de agenda o por metros). La pantalla advierte que cambiar el criterio cambia qué línea «parece» rentable.

Se llega desde Finanzas › Resultados. Tiene drill-down hasta el comprobante, el movimiento o el gasto, y se exporta a Excel y PDF.

## 2. Análisis de rentabilidad y márgenes (sección 8.3)

Pantalla: Finanzas › Rentabilidad, con período y comparación.

- **Rentabilidad por línea, por especialidad y por médico:** ingresos, costo directo, margen de contribución, participación y tendencia.
- **Margen por producto y por servicio:** precio, costo, margen unitario y total, volumen.
  - El costo de un producto sale de su costo de compra.
  - El costo de un servicio sale de su receta de insumos más el **tiempo de personal y de sala**, con un **costo por minuto configurable** por rol y por sala.
- **Pareto y matriz volumen × margen:**
  - qué 20 % de los productos y servicios explica el 80 % del margen;
  - cuadrantes con los ítems clicables: estrellas, volumen sin margen, margen sin volumen, candidatos a revisar.
- **Erosión de margen:**
  - alerta cuando el costo de un producto subió en una compra y su precio de venta no se ajustó;
  - alerta cuando un servicio quedó por debajo del margen mínimo de la política.
- **Impacto de descuentos y campañas:**
  - margen que costaron los descuentos, por tipo y por persona que los aplicó;
  - margen neto de cada campaña del 14 contra la venta atribuida.
- **Variación de precio, volumen y mezcla:** por qué cambió el margen de una línea entre dos períodos.
- **Punto de equilibrio** de la clínica y por línea: cuánto hay que facturar en el mes para cubrir los costos fijos.
- **Rentabilidad por cliente:** margen acumulado, que alimenta el valor de vida del 14.

**Reglas:**
- El margen de contribución es la medida principal.
- Un ítem sin costo cargado se muestra como **«sin costo»**, nunca con margen del 100 %. La pantalla dice cuántos hay y lleva a la lista para completarlos. Esto ya pasa hoy con productos importados de Digital Vet con costo 0.

## 3. Flujo de caja proyectado

Proyección semanal de las próximas 4 a 13 semanas:
- **Saldo inicial:** el efectivo y los bancos que registre el cierre diario del 10a.
- **Entradas:** cuentas por cobrar por fecha esperada y venta proyectada según el promedio de las últimas semanas, ajustada por estacionalidad.
- **Salidas:** cuentas por pagar por vencimiento, gastos recurrentes, comisiones por liquidar, planilla estimada e impuestos del período.
- **Alerta** de la semana en que el saldo proyectado baja de un mínimo configurable.

Cada fila se abre para ver qué la compone. La venta proyectada se marca como estimación, separada de lo que ya está comprometido.

## 4. Presupuesto contra real

- Un presupuesto anual por mes y por línea, de ingresos y gastos. Se puede cargar desde Excel o generar desde el año anterior con un porcentaje de ajuste.
- **Pantalla de seguimiento:** presupuesto, real y diferencia, en monto y porcentaje, con semáforo y drill-down a lo real.
- Se pueden guardar varias versiones del presupuesto (por ejemplo, original y revisado). Solo una está vigente.

## 5. IVA del período

Un **resumen informativo para el contador**, no la declaración:
- IVA de ventas por tarifa, desde los comprobantes emitidos menos las notas de crédito;
- IVA de compras acreditable, desde los comprobantes recibidos y aceptados;
- diferencia estimada;
- detalle exportable comprobante por comprobante.

La pantalla dice claramente que la declaración la presenta el contador en el sistema de Hacienda. Si el formato de la declaración vigente se confirma en la fuente oficial, el resumen sigue sus mismas casillas; si no se confirma, se documenta que no se pudo.

## 6. Diagnósticos para el agente (16b)

Funciones deterministas, tipadas, con su pantalla propia, que el 16b llama como herramientas y que devuelven lo mismo que muestra la pantalla:
- **Rentabilidad:**
  - margen por línea, servicio y producto;
  - costo real del servicio;
  - precio frente al costo actualizado;
  - erosión de margen;
  - descuentos dados;
  - mezcla;
  - punto de equilibrio.
- **No rentables:**
  - cuadrantes de la matriz;
  - ítems con margen negativo o bajo el mínimo de la política;
  - ítems sin costo cargado.

## 7. Simulador de escenarios

Pantalla: Finanzas › Simulador. Es la especificación de la sección 3 del 16, construida aquí:

**El modelo** (determinista):
- **Base:** el mes elegido, o el promedio de los últimos N meses, con estacionalidad opcional.
- Ingresos por línea, servicio y producto, como volumen × precio.
- Costo variable unitario.
- Margen de contribución.
- Costos fijos.
- Resultado operativo.

**Palancas combinables:**
- volumen;
- precio;
- costo de un insumo;
- un costo fijo nuevo o eliminado;
- capacidad;
- mezcla.

**Efectos y restricciones:**
- **Arrastre del 13:** opcional, marcado como supuesto, con su valor medido y desactivable.
- **Capacidad:** advierte si el volumen supera la agenda y dice cuánta capacidad haría falta.

**Entrega:**
- tabla antes y después;
- cascada del resultado;
- punto de equilibrio;
- tornado de sensibilidad;
- escenarios guardados para comparar;
- exportación.

**Preguntas inversas:** cuánto volumen o precio hace falta para un resultado objetivo, por ejemplo: «¿cuántas consultas más necesito para pagar un médico nuevo?».

El motor es una **función pura con su API**, separada de la pantalla, para que el 16b la llame con parámetros y muestre los supuestos antes de correr.

## Permisos

Agregar a la matriz del 04:
- `finanzas.resultados.ver`;
- `finanzas.rentabilidad.ver`, que además respeta el permiso configurable «ver costos y márgenes» del 04;
- `finanzas.presupuesto.editar`;
- `finanzas.simulador.usar`.

Por defecto: el administrador tiene todo y el contador ve resultados e IVA. Los demás roles no ven nada de esto.

## Verificación y entrega

**Los verificadores primero tienen que fallar contra el defecto que dicen detectar.** Aserciones mínimas, sobre el historial de demostración del 12:
- la suma de los márgenes por línea del estado de resultados coincide con el margen de contribución del diccionario del 12;
- un producto con costo 0 aparece como «sin costo» y no con margen del 100 %;
- cambiar el criterio de reparto de gastos generales no cambia el margen de contribución de ninguna línea, solo el resultado después del reparto;
- una compra más cara sin ajuste de precio dispara la alerta de erosión;
- el simulador sin palancas devuelve exactamente la base;
- con la palanca «castraciones −10 %», el resultado baja exactamente el margen de esas castraciones;
- el punto de equilibrio calculado, puesto como volumen en el simulador, da un resultado operativo de cero;
- el IVA de ventas del resumen coincide con la suma de los comprobantes del período menos las notas de crédito.

En el navegador:
- ver el estado de resultados del mes con el reparto activado y desactivado;
- abrir la matriz volumen × margen y entrar a un candidato a revisar;
- ver la alerta de erosión de un producto;
- proyectar el flujo de caja y encontrar la semana de alerta;
- cargar un presupuesto y ver el semáforo;
- correr el escenario «sube 8 % el costo del alimento y sube 5 % el precio de vacunas», guardarlo y compararlo con otro;
- preguntar en el simulador cuántas consultas hacen falta para cubrir un costo fijo nuevo.

El informe incluye:
- la tabla del relevamiento;
- las definiciones agregadas al diccionario del 12;
- las pantallas nuevas con su camino de clics;
- las migraciones, con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant;
- las fuentes oficiales consultadas para el IVA, con lo que se confirmó y lo que no;
- las páginas de `docs/ayuda/` escritas para alguien que no sabe de finanzas, con el ejemplo de la clínica en cada concepto;
- lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
