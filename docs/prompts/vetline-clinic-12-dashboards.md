# Vetline Clinic — 12 · Dashboards, trazabilidad de productos y exportación

Rama: `vetline-clinic/12-dashboards`, que parte de la rama del 10a. Se rige por `vetline-clinic-00-guia-rectora.md`: secciones 4.1, 4.4, 4.5, 4.6 y 4.7 para el contenido y sección 12 para la forma de trabajo.

## Por qué existe

Los módulos ya registran todo: atenciones, cargos, cobros, comprobantes, inventario, citas, cuentas y CRM. Lo que falta es **verlo**: que la dueña sepa en un minuto cómo va la clínica, que cada médico vea lo suyo y que desde cualquier número se llegue al registro que lo explica.

**Los reportes no son este prompt.** Se definirán con Medicavet más adelante. Lo que sí deja este prompt es el **diccionario de métricas**, que esos reportes usarán.

## 0. Relevamiento

El informe parte de lo que ya existe y se reutiliza:

- los componentes del sistema de diseño (`KpiCard`, `SelectorPeriodo`, `MenuExportar`, `ChartBarras`, `ChartLinea`, `ChartDona`, `ChartArea`, `Sparkline`, `EmptyState`, `LoadingState`) y la paleta de datos con el mapa de color por línea de negocio;
- la pantalla Inicio del 01c y sus indicadores;
- los indicadores de Caja, Inventario y Finanzas;
- la cabecera y las tendencias del expediente;
- la línea de tiempo del CRM;
- la exportación que ya existe (caja, inventario).

Un indicador que hoy se calcula en dos lugares distintos se unifica en una sola función (sección 1).

## 1. Diccionario de métricas: una sola definición por número

Cada métrica de los dashboards se define **una vez**, en el backend. Lleva:
- nombre, descripción en lenguaje simple y fórmula;
- fuente (tablas y filtros);
- reglas: qué se excluye (anulados, notas de crédito, cortesías), en qué moneda se expresa (los dólares se convierten con el tipo de cambio del cobro) y a qué fecha se imputa (fecha del comprobante, del cobro o de la atención; se elige y se documenta por métrica).

**El mismo cálculo** alimenta la tarjeta, el gráfico, el drill-down, la exportación y, más adelante, los reportes y el agente (16). Si la tarjeta dice ₡1 250 000, la lista del drill-down suma ₡1 250 000.

El diccionario se publica en `docs/metricas/diccionario.md` y se puede consultar en la interfaz: cada `KpiCard` tiene un ícono de información que muestra la descripción y la fórmula en lenguaje simple.

**Definiciones que hay que fijar** (se proponen en el informe y se documentan):
- **Ingresos:** comprobantes emitidos menos notas de crédito, sin IVA.
- **Ticket promedio:** ingresos ÷ cuentas cobradas.
- **Atenciones:** atenciones cerradas y firmadas.
- **Ocupación de la agenda:** minutos citados ÷ minutos disponibles según los horarios del 04, por médico y por sala.
- **Inasistencias:** citas no presentadas ÷ citas del período, sin contar las canceladas con aviso.
- **Cargos fugados:** lo registrado en una atención cerrada que no llegó a cobrarse, o una cuenta abierta con más de N días (política del 04). Se muestra con su detalle, para recuperarlo.
- **Clientes nuevos:** clientes con su primera atención o compra en el período.
- **Retención:** de los clientes con actividad en el período anterior, cuántos volvieron en este.
- **Margen de contribución:** ingresos menos costo directo. El costo de los productos sale de los movimientos de inventario. **Un servicio o producto sin costo se muestra como "sin costo", nunca con 100 % de margen**, y la pantalla dice cuántos hay (regla de la sección 8.3).
- **Valor del cliente:** ingresos y margen acumulados del cliente desde su alta. El valor de vida proyectado queda para el 14.

## 2. Dashboard de la clínica

Ruta: **Inicio** para el administrador (reemplaza o amplía el Inicio del 01c, sin duplicarlo), y Reportes › Clínica.

**Controles comunes:**
- `SelectorPeriodo` (hoy, 7 días, mes, trimestre, año, personalizado);
- comparación contra el período anterior, con la variación en cada tarjeta;
- filtro por línea de negocio y por médico.

**Contenido:**
- **Indicadores:** ingresos, ticket promedio, atenciones, clientes nuevos, ocupación, inasistencias, cuentas por cobrar y cargos fugados. Cada uno con su sparkline y su variación.
- **Ingresos por línea de negocio:** barras o dona con el color fijo de cada línea, más la tendencia por semana o por mes.
- **Margen por línea**, con el aviso de cuántos ítems están sin costo.
- **Top 10 de productos y de servicios**, por ingresos y por margen, con una pestaña para alternar.
- **Inventario crítico:** bajo el mínimo y por vencer. Son los mismos números del Inventario.
- **Agenda:** ocupación por médico y por sala, e inasistencias por motivo.
- **Clientes:** nuevos contra recurrentes, y retención.
- **Cobros por medio de pago.**
- **Resultado de campañas:** solo si ya hay campañas con datos. Si no, el bloque no aparece (el 14 lo completa).

## 3. Dashboard del médico

Ruta: **Inicio** para el médico de una clínica con módulos de gestión (respetando la regla de entrada del 01c y del 04) y Reportes › Médicos. Un médico ve **lo suyo**. El administrador ve cualquiera con un selector y una vista comparativa de todos.

**Contenido:**
- **Indicadores:** sus atenciones, facturación atribuida (por el ejecutor que registra cada cargo, desde el 08b), ticket promedio y casos de Vetline Ai abiertos.
- **Agenda de hoy y de la semana**, con el estado de cada cita.
- **Seguimientos pendientes:** controles programados por él y preventivos vencidos de sus pacientes.
- **Recomendaciones no agendadas:** controles que recomendó en una atención y que el cliente no agendó. Es una lista accionable, que lleva a agendar o a enviar un recordatorio por el CRM.
- **Resultados de laboratorio sin ver.**
- **Facturación por línea y top de servicios propios.**

## 4. Dashboard del cliente (propietario)

Es la pestaña **Resumen** de la ficha del cliente y anticipa la ficha 360 del 14 con los datos que ya existen:

- gasto acumulado y por línea de negocio, con la tendencia;
- frecuencia de visita y última visita;
- sus mascotas, cada una con el estado de sus preventivos;
- saldo pendiente (de las cuentas del 08, con la regla del deudor);
- valor del cliente (sección 1);
- preventivos pendientes de todas sus mascotas;
- la línea de tiempo del CRM.

Las oportunidades y la respuesta a campañas aparecen cuando el 14 las construya. No se muestran bloques vacíos.

## 5. Dashboard del paciente

Es la pestaña **Resumen** del expediente. Se completa lo que falte, sin duplicar la cabecera:

- curva de peso y de los signos que registró el examen físico;
- **estado de preventivos por tipo:** al día, por vencer, vencido o **sin registro**, distinguiendo "sin registro" de "no vacunado" (sección 4.4 de la guía). Un registro histórico del 07c cuenta como registro;
- tratamientos activos;
- casos de Vetline Ai;
- gasto acumulado en el paciente;
- la cronología.

## 6. Trazabilidad de productos

Desde la ficha de cualquier producto, una pestaña **Consumo**:

1. el consumo del período en unidad base y en la presentación principal, con la tendencia;
2. el desglose por **origen** del movimiento (atención, venta de mostrador, consumo interno, merma, ajuste, devolución);
3. para los movimientos ligados a un paciente: los pacientes que lo usaron, con su atención concreta y el lote.

**Los movimientos sin paciente** aparecen como su propio grupo con su origen ("Venta de mostrador", "Consumo interno de quirófano", "Merma por vencimiento"). Nunca se esconden ni se reparten.

**Trazabilidad por lote** (útil ante una alerta del fabricante): a qué pacientes se aplicó un lote, con su contacto, y la acción de avisarles por el CRM dentro de sus consentimientos.

## 7. Drill-down

**Todo número lleva a su lista.** Un clic en una tarjeta, una barra o un sector abre la **lista filtrada** que lo compone, con los mismos filtros y el mismo período, y de cada fila se llega al registro (comprobante, atención, cita, movimiento o cliente).

- La lista es una pantalla reutilizable con paginación, orden y exportación.
- La URL conserva los filtros, para poder compartirla y volver con el navegador.
- La suma de la lista coincide con el número del que salió. **Esto se verifica**.

## 8. Exportación

Según la sección 4.6 de la guía:
- todo dashboard y toda lista del drill-down ofrecen Excel y PDF desde `MenuExportar`, generados en el backend, respetando tenant, permisos y filtros;
- Excel con datos tipados y formato de moneda;
- PDF con logo, título, filtros, período, fecha y usuario, y los gráficos incluidos;
- cada exportación queda en la auditoría.

## 9. Rendimiento

- **Meta:** un dashboard carga en menos de 1,5 s con un año de datos de una clínica mediana. Con `LoadingState` por bloque, cada bloque se pinta cuando llega su dato.
- Consultas agregadas en SQL, una por bloque y no una por fila, con los índices necesarios.
- Si una métrica lo requiere, una **tabla de resumen por día** (por tenant, línea, médico), mantenida de forma incremental en la misma transacción que la escritura o por un trabajo programado idempotente, con RLS y documentada. El resultado siempre se puede reconstruir desde las fuentes.
- Caché corta por tenant y filtros, invalidada al escribir en las fuentes.
- Respetar la sección 10 de la guía.

## 10. Permisos

- La clínica y la comparación entre médicos: el administrador.
- El propio dashboard: el médico.
- Solo lectura sin datos clínicos: el contador.
- Ver márgenes y costos requiere el permiso `catalogo.ver_costos` del 04. Sin él, los bloques de margen no aparecen.

## 11. Datos de demostración

Para verificar con números que digan algo, se genera un **historial de demostración de 12 meses**, solo en el tenant de demostración, con un script idempotente y marcado como tal: citas, atenciones, cobros, compras, mermas, campañas y estacionalidad razonable. **Nunca se ejecuta en un tenant real.** El script lo comprueba antes de escribir y se niega si el tenant no es de demostración.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador con los datos de demostración:

- cada dashboard en móvil y en escritorio;
- cambiar el período y la comparación;
- en cada dashboard, hacer clic en tres números distintos y comprobar que la suma de la lista coincide con el número;
- seguir un producto hasta el paciente y la atención, y un lote hasta sus pacientes;
- confirmar que un producto sin costo aparece como "sin costo";
- exportar a Excel y a PDF;
- entrar como médico (solo lo suyo), como contador (sin márgenes ni clínico) y con una clínica solo con Vetline Ai (sin dashboards de gestión, y su Inicio de siempre);
- medir los tiempos de carga con un año de datos.

El informe incluye el diccionario de métricas, las pantallas nuevas con su camino de clics, las tablas de resumen y su mantenimiento, las mediciones de rendimiento y los bloques que quedaron esperando otros módulos (campañas y oportunidades, del 14).

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
