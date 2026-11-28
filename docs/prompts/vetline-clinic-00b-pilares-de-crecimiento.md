# Vetline Clinic — 00b · Pilares de crecimiento: un solo sistema

> Documento de referencia. Complementa la guía rectora (`vetline-clinic-00-guia-rectora.md`) y ata como un solo sistema los prompts **10b, 12, 13, 14, 15a, 15b, 16b y 17**.
> Sirve para dos cosas: revisar con la dirección de Medicavet qué se espera de cada pilar y cómo se va a medir, y que Claude Code construya cada módulo **conectado** a los demás. Regla para Code: **un módulo de estos no está terminado si no cierra su parte del circuito** (sección 3) y no pasa la prueba de punta a punta (sección 11).

## 1. Por qué estos pilares

La operación diaria (atención, caja, inventario, facturación) ordena la clínica. Estos pilares la hacen **crecer**:

| Pilar | Qué logra | Prompts |
|---|---|---|
| **Asesor de gestión** | Que una dueña veterinaria sin formación en finanzas entienda su negocio y decida con datos: ventas, estacionalidad, rentabilidad, inventario, proyecciones y simulaciones, con sugerencias concretas. | 16b, apoyado en 10b, 12, 13 y 13b |
| **CRM** | Generar demanda: saber quién es cada cliente, qué le falta, cuándo contactarlo y medir qué vendió cada acción. | 14 |
| **Fidelización** | Retener a los clientes, traer clientes nuevos por recomendación y aumentar el gasto por cliente. | 15a, 15b (15c más adelante) |
| **App del cliente (PWA)** | El canal propio con el cliente: informe posvisita, recordatorios, carné, paquetes, referidos, encuestas, autoservicio. | 17 |

No son cuatro módulos sueltos: son **un circuito**. Un asesor que sugiere sin poder ejecutar es un reporte; una campaña que no se mide no se puede mejorar.

## 2. El circuito

```
 Datos ─► Diagnóstico ─► Recomendación ─► Ejecución ─► Contacto ─► Respuesta ─► Atribución ─► Aprendizaje
   │          │               │              │            │            │             │              │
 migración  10b·12·13       16b            14 / 15     canal        PWA, cita,    14 (única)     16b iniciativas,
 operación  13b·14                         (campaña,   (correo,     venta         ─► 12 métricas  estimaciones
 diaria                                    secuencia,  WhatsApp                                   futuras
                                           oportunidad) asistido, PWA)
```

Ejemplo de una vuelta completa:

1. **Diagnóstico (14 y 16b):** 34 clientes con la vacuna anual vencida hace más de 60 días, que antes venían cada 5 meses.
2. **Recomendación (16b):** "Recuperarlos vale unos ₡1,2 millones (supuesto: 25 % de respuesta, según sus campañas anteriores)", con la lista y el botón.
3. **Ejecución (14 / 15a):** un clic crea la campaña o inscribe a los 34 en la secuencia de recuperación, solo con quienes tienen consentimiento.
4. **Contacto:** recepción ve en su bandeja 34 envíos de WhatsApp asistido, cada uno a un clic.
5. **Respuesta:** 9 agendan desde el enlace o por WhatsApp.
6. **Atribución (14):** las 9 citas y sus ventas quedan ligadas a la campaña.
7. **Aprendizaje (16b):** a los 30 días la iniciativa informa "9 de 34 volvieron, ₡410 000"; la tasa real (26 %) reemplaza al supuesto en la próxima estimación.

## 3. Los contratos que unen el circuito

Cada contrato tiene **un solo dueño**. Ningún otro módulo construye su propia versión.

| # | Contrato | Dueño | Lo usan |
|---|---|---|---|
| C1 | **Lista accionable**: formato único que devuelve todo diagnóstico (entidad, identificadores, motivo, cifra, valor estimado, fuente, fecha de cálculo). | 16b define; cada módulo dueño de un diagnóstico la produce | 10b, 12, 13, 13b, 14 → 16b → 14 |
| C2 | **Diagnósticos deterministas** en el módulo dueño del dato, con pantalla propia; el agente los ejecuta, no los inventa. | 10b (rentabilidad, simulador), 06/12 (inventario), 12/13 (ventas), 13b (estacionalidad y proyección), 14 (recuperación) | 16b |
| C3 | **De lista a acción**: una lista accionable se convierte en segmento, campaña, oportunidad o inscripción a un programa con un clic. | 14 | 16b, 15a, 15b |
| C4 | **Un solo mecanismo de envío**: `emitirNotificacion` + `puedeEnviar()`, con canales correo, **WhatsApp asistido**, WhatsApp por API (Converza, futuro) y push de la PWA. Consentimientos, tope de frecuencia, exclusiones. | Notificaciones existentes de Vetline Ai, extendidas | 14, 15a, 15b, 16b, 17 |
| C5 | **Atribución única**: una cita o venta se liga a la acción que la provocó dentro de su ventana. | 14 | 15a, 15b, 16b, 12 |
| C6 | **Diccionario de métricas**: una sola definición por número, con fórmula y origen, y trazabilidad hasta la lista. | 12 | todos |
| C7 | **Línea de tiempo única** del cliente y la mascota (`registrarInteraccion`). | 03 / 14 | todos |
| C8 | **Páginas públicas por token** (encuesta, respuesta rápida, enlace de referido, agendar). | 15a | 15b, 17 |
| C9 | **Iniciativas**: toda acción ejecutada desde una recomendación se registra con su métrica, punto de partida y horizonte. | 16b | 14, 15a, 15b |

## 4. Qué aporta y qué consume cada prompt

| Prompt | Aporta al sistema | Consume |
|---|---|---|
| **10b** Resultados, rentabilidad y simulador | Estado de resultados por línea, márgenes, costo real del servicio, flujo proyectado, presupuesto contra real, diagnósticos de rentabilidad (C2), **motor del simulador**. | Costos del inventario, ventas, gastos (10a), proyección del 13b |
| **12** Dashboards | **Diccionario de métricas** (C6), dashboards de clínica, médico, cliente y paciente, drill-down, exportación. | Todo lo transaccional |
| **13** Análisis y correlaciones | Afinidad entre líneas, efecto posterior, correlación controlada por volumen y estación, diagnóstico de ingresos (clientes × frecuencia × ticket). | Ventas, visitas, 13b (para descontar la estacionalidad) |
| **13b** Ventas, estacionalidad y proyección | Volumen y detalle por línea y producto, índices estacionales (mes, quincena, día, hora, eventos de Costa Rica), tendencia separada, **proyección con rango** y su error medido. | Historial migrado de 8 años, ventas diarias |
| **14** CRM completo | Ficha 360, segmentos vivos, motor de oportunidades, campañas, **riesgo de abandono**, bandeja del día, **atribución** (C5), de lista a acción (C3). | Línea de tiempo, preventivos, ventas, consentimientos, listas del 16b |
| **15a** Retención | Recuperación de clientes, bienvenida, cumpleaños y aniversario, etapa de vida, fallecimiento, NPS, páginas públicas (C8), tablero de fidelización. | Riesgo y oportunidades del 14, mecanismo de envío |
| **15b** Paquetes y referidos | Paquetes paramétricos con consumo automático y rentabilidad por plantilla, referidos con embajadores. | Caja, inventario, 14, páginas públicas |
| **16b** Asesor de gestión | Preguntas en lenguaje natural → diagnósticos → recomendaciones de cinco partes con lista accionable (C1), simulador conversacional, iniciativas (C9), resumen de la mañana. | Todos los diagnósticos, el simulador, la atribución |
| **17** App del cliente *(por escribir)* | Canal propio: informe posvisita, receta con horarios, recordatorios, carné con QR, paquetes, referidos, encuestas, autoservicio, push. | C4, C7, C8, 15a, 15b |

## 5. Requisitos previos (sin esto los pilares no rinden)

1. **Migración del historial de Digital Vet (8 años)** — *prompt por escribir*. Sin historia, el riesgo de abandono, la recompra, la estacionalidad y las proyecciones arrancan "sin historial suficiente". Reglas:
   - carga primero a tablas intermedias, con mapeo, unificación de duplicados e informe de calidad;
   - ensayo en vacío y reejecución segura, conservando los identificadores de origen;
   - el historial entra como "histórico importado": las facturas viejas son solo consulta, nunca van a Hacienda ni mueven inventario;
   - validación por totales contra los reportes de Digital Vet.

   **Acción para Medicavet:** solicitar formalmente a Grupo Argus la exportación completa de su base de datos (los datos son de la clínica). Mientras llega, trabajar con exportaciones de reportes.
2. **Costos de productos al día.** Medicavet ya los mantiene; la carga y la migración deben traer el costo actual y, si existe, su historial.
3. **Clasificación y categorías de productos** (en curso): alimentan márgenes por línea, la estacionalidad por categoría y el buscador clínico.
4. **Contactos y consentimientos** bien cargados: teléfono, correo, canal preferido y permiso de contacto. Un cliente sin contacto no se puede recuperar.
5. **Canal WhatsApp asistido** — *ajuste por escribir*. Medicavet usa WhatsApp Business (la app, sin API). El sistema arma el mensaje y recepción lo envía con un clic, que abre WhatsApp Business con el chat y el texto listos; se registra como enviado. Cuando Converza tenga la integración con Meta, los mismos mensajes pasan a enviarse solos sin rehacer nada.
6. **Línea base medida antes de activar** (sección 6).

## 6. Métricas de éxito por pilar

Cada métrica definida en el diccionario del 12. La **línea base** se mide con los 12 meses previos a la activación, sobre el historial migrado.

| Pilar | Métricas | Pregunta que responde |
|---|---|---|
| Asesor | Recomendaciones ejecutadas y su resultado medido; iniciativas con resultado positivo; aciertos del banco de preguntas; error de la proyección contra lo real; uso semanal por la dirección. | ¿Le ayuda a decidir mejor? |
| CRM | Oportunidades detectadas, contactadas y convertidas; ingreso atribuido a campañas y oportunidades; preventivos vencidos recuperados; ocupación de agenda. | ¿Genera demanda medible? |
| Fidelización | Retención anual; frecuencia de visita; regreso de clientes nuevos a 90 días; clientes recuperados; NPS; paquetes vendidos y consumidos; clientes traídos por referidos; costo de los programas contra lo que generan. | ¿El cliente se queda, vuelve y recomienda? |
| PWA | Clientes activos en la app; informes posvisita abiertos; agendamientos y recompras desde la app; respuestas a encuestas por la app. | ¿Mejora la relación y baja la carga de recepción? |
| **Negocio** | **Ingreso total, ticket promedio, clientes activos, margen operativo**, contra la línea base y ajustados por estacionalidad. | ¿La clínica creció por esto? |

## 7. Banco de preguntas para el asesor

El asesor se afina con evidencia: estas preguntas son su examen. Cada versión debe responderlas con **cifras correctas** (calculadas por los diagnósticos, nunca por el modelo), **explicación** y **una acción concreta con su lista**. La dirección de Medicavet completa y corrige este banco con las preguntas que realmente se hace.

**Ventas y estacionalidad**
1. ¿Cuánto vendí este mes y cómo voy contra el mismo mes del año pasado?
2. ¿Por qué bajaron las ventas en octubre? ¿Es normal para la época?
3. ¿Cuánto voy a vender en diciembre? ¿Con qué rango?
4. ¿Qué líneas crecen de verdad y cuáles solo tuvieron un buen mes?
5. ¿Qué días y horas son los de más demanda y cuáles están vacíos?
6. ¿Qué productos suben en época lluviosa y cuánto?

**Rentabilidad**
7. ¿Qué línea de negocio me deja más margen y cuál menos?
8. ¿Qué servicios o productos no son rentables?
9. ¿Cuánto me cuesta realmente una castración?
10. ¿Qué productos perdieron margen porque el proveedor subió el precio?
11. ¿Cuánto di en descuentos este trimestre y a quién?
12. ¿Cuál es mi punto de equilibrio mensual?

**Inventario**
13. ¿Qué tengo que pedir esta semana y cuánto?
14. ¿Cuánto antiparasitario debo comprar para junio?
15. ¿Qué productos tengo parados y cuánto capital inmovilizan?
16. ¿Qué se me vence en los próximos 60 días?
17. ¿Cuántas ventas perdí por quiebres de stock?

**Clientes**
18. ¿Qué clientes no han vuelto y desde cuándo?
19. ¿Cuántos clientes nuevos llegaron este mes y cuántos regresaron?
20. ¿Quiénes son mis mejores clientes y cuánto gastan al año?
21. ¿Qué clientes de grooming nunca han usado la consulta médica?
22. ¿Cuál es mi NPS y qué se quejan los detractores?

**Simulación y decisiones**
23. ¿Qué pasa con mi resultado si las ventas de grooming caen un 10 %?
24. ¿Y si subo un 5 % el precio de las vacunas?
25. ¿Cuántas consultas más necesito para pagar un médico nuevo?
26. ¿Me conviene abrir los sábados?
27. ¿Qué pasa si el proveedor de alimento sube un 8 %?

**Mercadeo**
28. ¿A quién le mando una campaña este mes y con qué mensaje?
29. ¿Cuánto me generó la última campaña?
30. ¿Qué paquete conviene crear según lo que más compran mis clientes?

## 8. Plan de activación por etapas

La adopción también se diseña. Cada etapa se activa cuando la anterior está asimilada y sus métricas están estables.

| Etapa | Qué se activa | Criterio para pasar a la siguiente |
|---|---|---|
| 1 | Operación diaria: atención, receta, caja, inventario, facturación. Migración del historial. | Dos semanas sin volver a Digital Vet para la operación; totales migrados validados. |
| 2 | Recordatorios existentes y nuevos, **WhatsApp asistido**, bandeja del día. | Recepción procesa la bandeja a diario. |
| 3 | CRM: ficha 360, oportunidades, recuperación de clientes (15a) y encuesta NPS. **Piloto** (sección 9). | Piloto evaluado contra la línea base. |
| 4 | Paquetes prepagados y referidos (15b). | Primeros paquetes vendidos y consumidos sin fricción en caja. |
| 5 | Asesor de gestión (16b) con el banco de preguntas aprobado; resumen de la mañana. | Uso semanal por la dirección; primeras iniciativas medidas. |
| 6 | App del cliente (17) y Converza con WhatsApp por API. | — |

Los dashboards (12), el análisis (13 y 13b) y la rentabilidad (10b) están disponibles desde la etapa 1 como consulta; el asesor los conversa a partir de la etapa 5.

## 9. Piloto

- **Qué:** 30 días con la secuencia de recuperación de clientes y la encuesta posvisita activas, por WhatsApp asistido.
- **Contra qué:** la línea base de los mismos meses del año anterior (ajustada por estacionalidad) y un grupo de control opcional: una parte de los clientes en riesgo no recibe la secuencia, para medir el efecto real.
- **Se mide:** clientes recuperados, ingreso atribuido, NPS, detractores atendidos en 24 horas y tiempo que le toma a recepción.
- **Se decide:** ajustar textos, días y ofertas antes de pasar a la etapa 4.

## 10. Decisiones y definiciones pendientes

**De la dirección de Medicavet**
- Solicitud de exportación completa a Grupo Argus.
- Completar el banco de preguntas (sección 7).
- Paquetes a ofrecer, precios y vigencias; beneficio por referido.
- Textos y ofertas de la secuencia de recuperación y de la bienvenida.
- Reportes propios (pendiente, a definir).
- Más adelante: planes de salud, puntos y niveles (15c); precios para criadores y fundaciones.

**Del contador**
- Momento de facturación y tratamiento del IVA en paquetes prepagados; registro del pasivo de paquetes y créditos a favor.

**Por escribir (prompts)**
- Migración desde Digital Vet.
- Canal WhatsApp asistido (ajuste al mecanismo de notificaciones, 14, 15a y 15b).
- 17 App del cliente (PWA).
- 15c Planes, puntos y niveles.

## 11. Prueba de punta a punta (obligatoria para Code)

Cuando estén construidos 14, 15a y 16b, este escenario debe funcionar completo en el tenant de demostración, con capturas en la bitácora:

1. Un cliente que venía cada 4 meses lleva 7 sin venir: el 14 lo marca en riesgo alto.
2. Aparece en el diagnóstico de recuperación y el 16b lo incluye en una recomendación con su lista accionable (C1) y valor estimado.
3. Desde la recomendación, un clic lo inscribe en la secuencia de recuperación del 15a (C3) y queda registrada la iniciativa (C9).
4. Recepción ve el envío en la bandeja y lo manda por WhatsApp asistido (C4); queda en la línea de tiempo (C7).
5. El cliente agenda; la cita y la venta posterior quedan atribuidas (C5) y la secuencia se corta.
6. El tablero de fidelización y el diccionario de métricas (C6) reflejan al cliente recuperado.
7. Al vencer el horizonte, la iniciativa informa el resultado medido y el 16b usa la tasa real en su próxima estimación.

Y, cuando exista el 15b: un paquete vendido desde una recomendación del 16b ("clientes que compran 4 o más baños al año") se consume solo en caja y su rentabilidad aparece en el 10b.
