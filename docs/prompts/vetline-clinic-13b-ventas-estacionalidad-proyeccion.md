# Vetline Clinic — 13b · Ventas, estacionalidad y proyección

> Prompt para Claude Code. Repo: `vetplatform`. Lee antes `docs/prompts/vetline-clinic-00-guia-rectora.md`, `docs/prompts/vetline-clinic-00b-pilares-de-crecimiento.md` (contratos C1, C2 y C6), el 12 (diccionario de métricas) y el 13 (análisis y correlaciones).
> Depende de: 08 Caja (ventas), 12 Dashboards (diccionario de métricas), 13. Lo usan: 10b (flujo proyectado, simulador, presupuesto), 06 (compras), 05 (agenda), 14 (campañas) y 16b (asesor). Va **después del 13**.

## Por qué existe

El asesor debe conocer no solo cuánto se vende y en qué, sino **cuándo**: qué meses, quincenas, días y horas son fuertes o flojos, qué crece de verdad y qué es solo la época, y cuánto se va a vender en los próximos meses con un rango honesto. Medicavet tiene unos 8 años de historia (vendrá de Digital Vet), suficiente para estimar estacionalidad con confianza.

Hasta ahora la estacionalidad aparece solo de paso (ajuste del flujo y opción del simulador en el 10b, control en las correlaciones del 13). Este módulo la convierte en un análisis propio y en la **única fuente** de índices estacionales y proyecciones para todo el sistema.

## 0. Relevamiento (corto)

Revisa y anota en la bitácora:

- de dónde salen hoy las ventas para el 12 (tablas, vistas, cómo se tratan anulaciones y notas de crédito);
- las definiciones del diccionario de métricas;
- cómo el 10b y el 13 usan hoy la estacionalidad (para reemplazarlo por este módulo, no duplicarlo);
- si ya hay historial migrado o solo datos de demostración.

## 1. La base: serie de ventas única

- Una vista o tabla materializada de **ventas netas diarias** (y por hora para el análisis intradía): fecha, hora, sede, línea de negocio, categoría, producto o servicio, médico, cliente, unidades, monto neto sin IVA, costo, transacciones. Netas de anulaciones y notas de crédito, por fecha de venta, con la misma definición que el diccionario del 12 (una sola definición por número).
- Incluye el historial migrado (marcado como "histórico importado"), sin distinguirlo en los cálculos, salvo para mostrar desde cuándo hay datos.
- Se actualiza de noche con un trabajo idempotente.

## 2. Volumen y detalle

Pantalla Reportes › Ventas y estacionalidad › Resumen:

- ventas por línea, categoría, producto y servicio, médico y sede, en dinero y en unidades;
- **descomposición**: transacciones × ticket promedio (y clientes × frecuencia × ticket, reutilizando el diagnóstico del 13), para distinguir si se vende más porque viene más gente o porque cada uno gasta más;
- comparación contra el mismo período del año anterior y contra el promedio de los últimos N años;
- ranking de crecimiento y caída por línea y producto;
- drill-down hasta las transacciones, y exportación a Excel y PDF con el logo de la clínica.

## 3. Estacionalidad

### 3.1 Calendario de eventos

- Tabla de eventos por país y tenant: feriados de Costa Rica, Semana Santa (calculada por año), Navidad y fin de año, pago del aguinaldo (primera quincena de diciembre), vacaciones escolares de medio año y de fin de año (fechas configurables por año), época lluviosa (meses configurables), y eventos propios de la clínica (una campaña, una remodelación, el cierre por vacaciones).
- Editable en Administración; semilla para Costa Rica marcada para revisar cada año.

### 3.2 Índices estacionales

Calculados por línea de negocio, categoría y producto (los de volumen suficiente), y para el total:

- **por mes del año:** índice respecto de un mes promedio (por ejemplo, grooming en diciembre = 1,28, es decir 28 % sobre un mes normal);
- **por quincena** (efecto del pago de salarios);
- **por día de la semana**;
- **por hora del día** (mapa de calor día × hora, cruzado con la capacidad de la agenda del 05 para mostrar huecos y saturación);
- **efecto de eventos:** cuánto sube o baja la venta en la semana del aguinaldo, en Semana Santa o en vacaciones escolares, contra semanas comparables.

Cada índice lleva su **confianza** (según años de historia y variabilidad) y se muestra solo si cumple los mínimos de la sección 5.

### 3.3 Tendencia separada de la estacionalidad

- Descomposición de cada serie mensual en **tendencia + estacionalidad + irregular** (STL o descomposición clásica robusta, elegida por el código y documentada).
- Responde "¿crece de verdad o solo tuvo un buen mes?": la tendencia desestacionalizada con su pendiente anual y si es significativa.
- **Ventas desestacionalizadas** disponibles como métrica en el diccionario del 12, para que cualquier dashboard pueda mostrarlas.
- **Cambios de comportamiento:** detección de quiebres de nivel o de patrón (por ejemplo, un producto que perdió su pico estacional porque los clientes lo compran en otro lado), con fecha aproximada y aviso.

## 4. Proyección con rango

- Pronóstico mensual para los próximos 3 a 12 meses por total, línea de negocio, categoría y productos de volumen suficiente; semanal para las próximas 4 a 13 semanas para el flujo del 10b.
- **Siempre con rango** (intervalo del 80 % y del 95 %), nunca un número solo: "diciembre: entre ₡8,2 y ₡9,1 millones; lo más probable, ₡8,6".
- Métodos candidatos, deterministas e implementados con tests contra series conocidas: estacional ingenuo, Holt-Winters (aditivo y multiplicativo) y descomposición más tendencia. **Se elige por serie según el error en validación hacia atrás** (backtesting con origen móvil sobre los últimos 12 a 24 meses). El método elegido y su error se guardan y se muestran.
- **Error medido y visible:** WAPE o MAPE de la validación, y luego el error real mes a mes cuando el período ya ocurrió ("en los últimos 6 meses la proyección acertó con un error promedio del 7 %"). Esto le dice a la dirección cuánto confiar.
- **Ajustes manuales con motivo:** la dirección puede anotar un supuesto ("abrimos los sábados desde marzo", "subimos precios 5 % en enero") que ajusta la proyección; queda visible como supuesto y se puede quitar.
- Los pronósticos se recalculan de noche y se guardan con su fecha de cálculo, método y versión, para comparar contra lo real.

## 5. Reglas estadísticas (obligatorias)

- **Sin dato no hay recomendación:** con menos de 24 meses de historia no se calculan índices mensuales ni proyección estacional (se muestra "historia insuficiente: hay N meses, se necesitan 24"); con menos de 8 semanas no hay índice por día de la semana. Un producto con muy pocas ventas se agrupa en su categoría.
- **Atípicos:** los períodos anómalos se detectan y se pueden marcar para excluir del cálculo de índices (por ejemplo, la pandemia de 2020–2021, un cierre temporal, una venta extraordinaria). Por defecto se proponen, no se excluyen solos; la dirección confirma.
- **Moneda constante opcional:** ver los montos ajustados por inflación (índice configurable) para comparar años lejanos.
- **Unidades y dinero por separado:** un aumento de precios no se confunde con más volumen.
- **El modelo de lenguaje nunca calcula:** el 16b solo explica lo que estos cálculos devuelven.

## 6. Usos en el resto del sistema

- **Inventario (06):** puntos de reorden y cantidades sugeridas ajustados a la estación: la orden sugerida antes del pico usa la demanda proyectada, no el promedio. "Antiparasitario X: en junio se espera un 40 % más; pida 120 unidades en mayo."
- **Agenda y personal (05):** demanda esperada por día y franja contra la capacidad; aviso de semanas que se van a saturar y de franjas que conviene llenar.
- **CRM (14):** calendario de "próximos picos y valles" por línea, para lanzar campañas un mes antes del pico y llenar los meses flojos; el segmento sugerido del 16b usa este calendario.
- **Finanzas (10b):**
  - el flujo proyectado y la base del simulador usan **esta** proyección y estos índices (reemplaza el cálculo propio del 10b);
  - **presupuesto estacionalizado:** una meta anual se reparte por mes según los índices, en lugar de dividirla entre 12; presupuesto contra real con esa base.
- **Análisis (13):** el control por estacionalidad de las correlaciones usa estos índices.

## 7. Diagnósticos para el asesor (16b)

Funciones deterministas, tipadas, con su pantalla, que devuelven la **lista accionable** del contrato C1:

- **Ventas del período contra su estacionalidad:** ¿la caída o el alza es normal para la época? Con la brecha desestacionalizada y las líneas que la explican.
- **Tendencia real por línea:** qué crece y qué cae de verdad, con su pendiente.
- **Proyección:** cuánto se espera vender, con rango y error.
- **Picos y valles próximos:** qué viene en los próximos 3 meses, por línea, con la acción sugerida (comprar, reforzar agenda, campaña).
- **Compra estacional:** productos cuya demanda proyectada supera el stock más lo pedido, con la orden sugerida.
- **Capacidad ociosa y saturación** por día y franja.
- **Cambios de comportamiento** detectados.

Las 8 preguntas del banco (sección 7 del 00b) que dependen de este módulo (2, 3, 4, 5, 6, 14, 26 y 28) deben responderse con estos diagnósticos y entrar al banco de evaluación del 16b, como preguntas predefinidas con sus parámetros por defecto.

## 8. Pantallas

Reportes › Ventas y estacionalidad, con pestañas:

1. **Resumen:** volumen, descomposición, comparación anual, crecimientos y caídas.
2. **Estacionalidad:** índices por mes (barras por línea con el color fijo de cada una), calendario anual con intensidad, efecto de eventos, quincena.
3. **Día y hora:** mapa de calor día × hora contra capacidad.
4. **Tendencia:** serie original, desestacionalizada y tendencia, con los quiebres marcados.
5. **Proyección:** gráfico con lo real, lo proyectado y las bandas de rango; tabla por mes; error medido; supuestos manuales.
6. **Calendario de picos:** próximos 12 meses por línea, con las acciones sugeridas.

Gráficos a color con la paleta de datos (una línea por métrica con su color fijo, banda del rango sombreada, ejes en gris claro), filtros por sede, línea, categoría, producto y médico, preguntas predefinidas en contexto (16b), exportación con logo. Textos de usted, con explicaciones de una línea para cada concepto (índice estacional, desestacionalizado, rango de la proyección) y glosario.

## 9. Rendimiento

- Cálculos pesados (descomposición, backtesting, pronósticos) en el trabajo nocturno, guardados en tablas (`est_indices`, `est_descomposicion`, `est_pronosticos`, `est_backtest`) con fecha de cálculo y versión; las pantallas leen de ahí.
- Con 8 años de historia diaria y cientos de productos, el trabajo nocturno debe terminar en minutos: solo se modelan individualmente las series con volumen suficiente; el resto, por categoría.

## 10. Datos de demostración

El historial de demostración del 12 tiene 12 meses, insuficiente para estacionalidad. Extiende el script de demostración (mismo script idempotente, **solo en el tenant de demostración**, nunca en uno real) a **4 años** con:

- estacionalidad marcada y conocida por línea (grooming alto en diciembre, antiparasitarios altos en época lluviosa, consultas estables);
- efecto del aguinaldo y de Semana Santa;
- una tendencia creciente en una línea y decreciente en otra;
- un período atípico (un mes de cierre);
- un producto que pierde su estacionalidad en el último año.

Los tests verifican que el módulo **recupera** esos patrones: índices cercanos a los sembrados, tendencias con el signo correcto, el atípico detectado y el quiebre señalado.

## 11. Permisos

Desde la base (04): `ventas.analisis_ver` (dirección y contador por defecto), `ventas.proyeccion_ajustar` (dirección), `calendario_eventos.editar`.

## 12. Manual de usuario

`docs/ayuda/ventas-estacionalidad-proyeccion.md`, con el estándar de la guía: para qué sirve cada pestaña, cuándo usarla, paso a paso, un ejemplo con números (grooming: índice de diciembre 1,28 sobre una base de ₡2 millones = ₡2,56 millones esperados, con su rango; cómo eso cambia la compra de champú y la agenda), qué pasa después, preguntas frecuentes ("¿por qué la proyección no es un número exacto?", "¿por qué no veo índices de este producto?", "¿qué hago con 2020?") y glosario.

## Verificación y entrega

- Tests:
  - la serie de ventas cuadra con los totales del 12;
  - recuperación de los patrones sembrados en la demostración;
  - mínimos de historia respetados;
  - atípicos propuestos y no excluidos sin confirmación;
  - backtesting elige el método de menor error;
  - intervalos con la cobertura esperada en validación;
  - el 10b y el 13 leen de este módulo y no tienen cálculo propio;
  - aislamiento entre tenants.
- Capturas de cada pestaña en la bitácora y cómo probarlo en el navegador paso a paso.
- Nada a producción; nada a `main` sin revisión.
