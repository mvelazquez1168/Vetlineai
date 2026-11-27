# Vetline Clinic — 13 · Análisis y correlaciones

Rama: `vetline-clinic/13-analisis-correlaciones`, que parte de la rama del 12 (necesita su diccionario de métricas y su historial de demostración de 12 meses). Se rige por `vetline-clinic-00-guia-rectora.md`: sección 6 para el contenido, 4.4 y 4.6 para la pantalla y la exportación, y sección 12 para la forma de trabajo.

## Por qué existe

Los dashboards del 12 dicen **cuánto** vende cada línea de negocio. Este prompt responde **cómo se relacionan entre sí**. Algunas preguntas que debe poder contestar:
- ¿los clientes de grooming compran productos?
- ¿después de una consulta, el cliente gasta más en farmacia?
- ¿cuando sube la vacunación, sube también el pet shop?

De ahí salen acciones concretas, como «el 40 % de los clientes de grooming nunca compró productos: esta es la lista».

También deja dos piezas que otros prompts esperan:
- el **diagnóstico de ingresos por línea**, que usa el agente de gestión (16);
- el **arrastre medido** entre líneas, que el simulador del 10b y el 16 pueden aplicar como supuesto.

**La regla que manda sobre todo lo demás:** una sola clínica tiene pocos datos. Un número sin su tamaño de muestra, o una correlación presentada como causa, es peor que no mostrar nada.

## 0. Relevamiento

El informe parte de una tabla con lo que ya existe y se reutiliza:
- el diccionario de métricas del 12, en especial *ingresos*, sus exclusiones (anulados, notas de crédito, cortesías) y la fecha de imputación;
- las líneas de negocio y especialidades de cada cargo;
- la resolución de cliente canónico del anexo B1, para que un cliente unificado cuente una sola vez;
- los segmentos o listas del CRM, si ya existen, para mandar ahí los resultados;
- el historial de demostración del 12;
- los componentes de gráficos, incluido el mapa de calor si existe.

Ningún cálculo de ingresos se reescribe: este prompt **lee del diccionario**. Si algo que necesita no está en el diccionario, se agrega ahí, no aquí.

## 1. La base: uso de líneas por cliente

Una sola fuente para las tres miradas: por cada cliente, línea de negocio y día, cuánto gastó, sin IVA y con las exclusiones del diccionario.
- **El cliente es el propietario del paciente**, resuelto al cliente canónico.
- Las ventas de mostrador sin paciente cuentan para el cliente de la cuenta.
- Las ventas anónimas se excluyen, y la pantalla dice cuántas fueron y cuánto sumaron.
- Se materializa y se recalcula de noche y a pedido. Cada resultado muestra la **fecha de cálculo**.

## 2. Afinidad por cliente (la mirada principal)

Para cada par de líneas A → B en el período:
- **Adhesión:** de los clientes que usaron A, qué porcentaje usó también B.
- **Lift:** adhesión ÷ porcentaje de todos los clientes activos que usaron B. Un lift de 1 significa «igual que cualquiera».
- **Intervalo de confianza** de la adhesión (Wilson) y **n** de clientes.
- La relación es asimétrica: A → B no es lo mismo que B → A, y se muestran las dos.

**Pantalla:** una matriz de líneas por líneas, en colores, con cada celda clicable. El clic abre las dos listas que más sirven:
- clientes de A que **sí** usaron B;
- clientes de A que **nunca** usaron B, con su última visita, gasto, mascotas y canal consentido.

La segunda lista se puede exportar y, cuando exista el CRM completo (14), convertir en segmento. Hasta entonces, el botón queda deshabilitado y explica por qué.

**Lectura en lenguaje simple** junto a cada cifra, por ejemplo: «De cada 10 clientes de grooming, 4 compraron productos en el período. Entre todos los clientes, compran productos 5 de cada 10».

## 3. Efecto posterior

Pregunta: después de usar la línea A, ¿el cliente gasta más en B en los 30, 60 o 90 días siguientes que un cliente comparable que no usó A?

- **Comparables:** clientes sin uso de A en la misma ventana, emparejados por especie de sus mascotas y por gasto y frecuencia en los 6 meses previos (por terciles). El método queda documentado y es visible en la pantalla.
- **Resultado:** diferencia de gasto promedio en B, con intervalo de confianza por bootstrap, y n de cada grupo.
- **Nombre en pantalla:** «gasto asociado», no «efecto» ni «causa».
- **Arrastre medido:** cada par A → B con evidencia suficiente se guarda con su valor, intervalo, n, ventana y fecha de cálculo. Es lo que el simulador del 10b y el 16 pueden aplicar, siempre marcado como supuesto y desactivable.

## 4. Correlación temporal

- **Series semanales** de ingresos por línea.
- **Correlación de Spearman** entre cada par, en un mapa de calor en colores.
- **Control del volumen y la estación:** dos líneas suben juntas en diciembre solo porque viene más gente. La correlación se calcula también **quitando el efecto del total de visitas** (correlación parcial, o sobre los residuos sin tendencia ni estacionalidad), y la pantalla muestra las dos. La que se destaca es la controlada.
- **Muchas comparaciones a la vez:** con 10 líneas hay 45 pares, y alguno saldrá «significativo» por azar. Se corrige por comparaciones múltiples (Benjamini-Hochberg) y se dice en la pantalla.

## 5. Diagnóstico de ingresos por línea (para el 16)

Un diagnóstico determinista, con su propia pestaña, que explica **por qué** cambió el ingreso de una línea entre dos períodos (el anterior y el mismo del año anterior):
- **Descomposición clientes × frecuencia × ticket:** cuánto del cambio vino de tener más o menos clientes, de que vinieran más o menos veces y de que gastaran más o menos por visita. Así se sabe qué palanca falla.
- **Penetración entre líneas:** la afinidad de la sección 2, resumida en las oportunidades más grandes, con su lista.
- **Preventivos vencidos:** pacientes con vacunas o desparasitaciones vencidas, con el monto estimado según el precio vigente del servicio.
- **Controles recomendados no agendados:** controles que el médico propuso en una atención y que el cliente no agendó.

Del diagnóstico «ventas del mes», compartido con el 12, aquí van la penetración, los preventivos y los controles. Si el 12 no dejó la brecha contra períodos anteriores ni los huecos de agenda, se construyen aquí.

Cada diagnóstico se expone como función tipada que el 16 llama como herramienta, con el mismo resultado que la pantalla.

## 6. Reglas estadísticas (obligatorias)

- **Tamaño de muestra siempre visible.** Por debajo del mínimo, que es una política configurable del 04 (por defecto 30 clientes o 12 semanas), se muestra **«datos insuficientes»** y qué haría falta. No se muestra un número.
- **Fuerza de la evidencia** en palabras (débil, moderada, fuerte), según el intervalo y el n, con el criterio documentado.
- **Aviso permanente** en la pantalla: correlación no es causa, y dos líneas pueden moverse juntas porque las dos dependen del volumen de visitas o de la estación.
- **Todo se calcula con consultas y código**, nunca con la aritmética de un modelo de IA. Cada resultado guarda método, período, filtros, n y fecha, y se puede reproducir.
- **Datos de demostración:** nunca se mezclan con los de un tenant real.

## 7. Pantalla

**Inteligencia › Análisis**, con pestañas Afinidad, Gasto posterior, Temporal e Ingresos por línea.
- **Filtros:** período con comparación, especie, médico y especialidad.
- **Drill-down en todo:** de la celda a la lista, y de la lista al cliente y su línea de tiempo.
- **Exportación** a Excel y PDF con `MenuExportar`. El PDF incluye los avisos de la sección 6.
- Cada cifra lleva un ícono de información con la definición y el método en lenguaje simple.
- **Permisos:** `analisis.ver`, por defecto solo para administrador. Agregarlo a la matriz del 04.

## Verificación y entrega

**Los verificadores primero tienen que fallar contra el defecto que dicen detectar.** Para eso, el historial de demostración del 12 se extiende con **efectos sembrados conocidos**, solo en el tenant de demostración:
- un arrastre real (por ejemplo, los clientes de grooming compran productos con un lift de alrededor de 1,5);
- un par sin relación;
- dos líneas que solo comparten la estacionalidad.

Aserciones:
- la afinidad y el gasto posterior **recuperan el efecto sembrado** dentro de su intervalo;
- el par sin relación no se marca;
- las dos líneas estacionales dan correlación alta sin control y **dejan de destacarse con el control** de la sección 4;
- con una muestra recortada por debajo del mínimo, la pantalla dice «datos insuficientes»;
- la suma del drill-down coincide con la cifra de la celda;
- un cliente unificado por el B1 cuenta una sola vez.

En el navegador:
- abrir la matriz de afinidad, entrar a «grooming → productos» y exportar la lista de quienes nunca compraron;
- ver el gasto posterior a 60 días de la consulta sobre farmacia;
- comparar el mapa de calor con y sin control;
- abrir el diagnóstico de ingresos por línea de grooming contra el mes anterior.

El informe incluye:
- la tabla del relevamiento;
- los métodos con sus supuestos;
- los resultados sobre los efectos sembrados;
- las pantallas nuevas con su camino de clics;
- las migraciones, con RLS forzado y `ON DELETE CASCADE` en toda tabla nueva de tenant;
- las páginas de `docs/ayuda/` explicadas para alguien sin formación en estadística;
- lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
