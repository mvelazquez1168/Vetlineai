# Vetline Clinic — 15a · Fidelización: retención

> Prompt para Claude Code. Repo: `vetplatform`. Lee antes `docs/prompts/vetline-clinic-00-guia-rectora.md` (sección 7 y 7.1) y `docs/prompts/vetline-clinic-14-crm-completo.md`.
> **Depende del 14 (CRM completo).** Constrúyelo después del 14: usa su indicador de riesgo de abandono, su motor de oportunidades, sus exclusiones, sus tareas y su bandeja del día. Si al llegar aquí algo del 14 no existe, constrúyelo según el 14 (no una versión paralela) y anótalo en la bitácora.
> El 15 se divide en tres: **15a retención** (este), 15b paquetes y referidos, 15c planes, puntos y niveles. El autoservicio del cliente va con la app del cliente (17).

## 0. Objetivo

Que el cliente vuelva. Cinco programas configurables por la clínica, cada uno con interruptor, textos editables y medición de lo que genera:

1. Recuperación de clientes en riesgo.
2. Bienvenida de los primeros 30 días.
3. Cumpleaños y aniversario.
4. Cambio de etapa de vida.
5. Protocolo de fallecimiento.
6. Encuesta posvisita (NPS) y reseñas, calificación de cada visita y voz del cliente (sugerencias y quejas con análisis por IA).

Más un tablero de fidelización.

## 1. Reglas comunes (no negociables)

- **Un solo mecanismo de envío.** Todo mensaje es un tipo más del mecanismo de notificaciones existente (`emitirNotificacion`, `puedeEnviar()`, registro en `notificaciones`, interruptor y plantilla en Administración › Notificaciones). Los avisos que Vetline Ai ya envía siguen exactamente igual.
- **Canal.** WhatsApp sigue simulado y sin Converza. El canal real es el correo (Resend). Cada mensaje respeta el canal preferido del cliente y cae al correo cuando el preferido no está disponible. En desarrollo, el proveedor simulado (nunca envíos reales).
- **Consentimientos y tope de frecuencia** de la sección 7 de la guía. Los mensajes de servicio no cuentan como promocionales; los de esta fase se clasifican explícitamente (servicio o promocional) en su tipo.
- **Exclusiones del 14**, siempre: mascota fallecida o dada de baja, mascota hospitalizada o en tratamiento delicado, cliente sin consentimiento, cliente en período de duelo (sección 6).
- **Sin duplicados con el 14.** Si un cliente ya tiene una oportunidad abierta o una campaña en curso por el mismo motivo, el programa no le manda otro mensaje por eso; se registra como "cubierto por" la oportunidad o campaña.
- **Línea de tiempo.** Cada envío, respuesta, tarea y resultado deja su evento con `registrarInteraccion`.
- **Atribución.** Cuando un programa trae de vuelta a un cliente, la cita o venta que lo resuelve queda ligada a la inscripción del programa, con la misma lógica de ventana de conversión del 14.
- **Margen mínimo.** Ningún beneficio ofrecido deja un servicio por debajo del margen mínimo configurado sin autorización de dirección.
- **Textos de usted.** Plantillas con variables (nombre del cliente, nombre y especie de la mascota, servicio, fecha, enlace para agendar, firma de la clínica), con vista previa.
- **Trabajos nocturnos idempotentes**, como el 14: reejecutarlos no duplica inscripciones ni mensajes.

## 2. Modelo de datos

- `fid_programas`: tipo (`recuperacion`, `bienvenida`, `cumpleanos`, `aniversario`, `etapa_vida`, `fallecimiento`, `nps`), activo, configuración (JSON validado por tipo: pasos, días, plantillas, beneficio opcional, límites).
- `fid_inscripciones`: programa, cliente, mascota (si aplica), paso actual, estado (`activa`, `completada`, `cortada`, `convertida`), motivo de corte, fechas, registro que la convirtió.
- `fid_pasos_ejecutados`: inscripción, paso, fecha programada, fecha ejecutada, resultado (enviado, omitido y por qué, tarea creada).
- `nps_encuestas`: cliente, mascota, atención o visita de origen, médico, línea de servicio, token, enviada, respondida, puntaje, comentario, clasificación (promotor, neutral, detractor), tarea ligada, invitación a reseña enviada.
- RLS forzado y `ON DELETE CASCADE` hacia cliente y mascota. Migraciones con el siguiente número libre.

Todos los programas reutilizan las tareas y la bandeja del día del 14; no se crea un sistema de tareas aparte.

## 3. Recuperación de clientes en riesgo

- **Disparo:** el indicador de riesgo de abandono del 14 pasa a "alto". Un cliente con "sin historial suficiente" no entra.
- **Secuencia por defecto** (días y textos configurables):
  - **Paso 1, día 0:** mensaje de servicio con lo pendiente de su mascota (vacuna o control vencido, tomado de `cuidados_preventivos` y citas) y enlace para agendar.
  - **Paso 2, día 10:** mensaje con algo de valor (beneficio opcional configurable; si la mascota es senior, el chequeo senior).
  - **Paso 3, día 25:** **tarea para recepción** de llamar por teléfono, con guion sugerido y el historial a mano. El resultado de la llamada se registra (contestó, agendó, no le interesa, número equivocado, no contesta).
- **Corte inmediato** si el cliente responde, agenda, compra, se da de baja de los mensajes o entra en una exclusión. "No le interesa" o "se mudó" lo marcan y no vuelve a entrar por 12 meses (configurable).
- Un cliente no reingresa a la secuencia antes de 6 meses de haberla terminado (configurable).
- La bandeja del día muestra los clientes en secuencia y en qué paso están.

## 4. Bienvenida de los primeros 30 días

- **Disparo:** primera visita pagada de un cliente nuevo (cliente canónico, aprovechando la unificación de duplicados del anexo B: un cliente que ya existía no es "nuevo").
- **Pasos por defecto:**
  - **Día 1:** agradecimiento, datos de la clínica (horario, contacto, emergencias) y resumen de la visita.
  - **Día 3:** "¿Cómo sigue [mascota]?" con enlace de respuesta rápida (bien, igual, peor). "Peor" crea una **tarea urgente para el médico** tratante, en el mismo día.
  - **Día 15:** lo que le corresponde a su mascota según especie y edad (protocolo preventivo existente).
  - **Día 30:** si no tiene cita futura, invitación a agendar el siguiente control.
- Cada paso se puede apagar o editar. La respuesta del día 3 usa la misma página pública por token que la encuesta (sección 8).

## 5. Cumpleaños, aniversario y etapa de vida

- **Cumpleaños de la mascota:** el aviso existente de Vetline Ai **no se toca**. Se agrega solo la opción configurable de incluir un beneficio durante el mes de cumpleaños (por ejemplo, 15 % en un baño), que caja reconoce y aplica al cobrar.
- **Aniversario como cliente:** tipo nuevo, en la fecha de la primera visita, cada año, con beneficio opcional.
- **Cambio de etapa de vida:** el 14 ya lo detecta como oportunidad. El 15a agrega el mensaje educativo por especie y etapa (cachorro → adulto, adulto → senior; edades configurables por especie y tamaño), con la recomendación del protocolo de esa etapa y el enlace para agendar. Si la oportunidad del 14 ya contactó al cliente por eso, no se duplica.

## 6. Protocolo de fallecimiento

- Al registrar el fallecimiento de una mascota (dar de baja con motivo fallecimiento), en la misma transacción:
  - se cancelan todas las notificaciones pendientes de esa mascota (recordatorios, cumpleaños, preventivos, seguimientos);
  - se descartan sus oportunidades abiertas con motivo "fallecimiento";
  - se cortan sus inscripciones en programas;
  - se excluye de toda campaña, presente y futura.
- **Período de duelo** del cliente (configurable, por defecto 60 días): no recibe nada promocional por ninguna de sus mascotas; sí los mensajes de servicio de sus otras mascotas.
- **Condolencia opcional:** si la clínica la activa, un único mensaje con texto aprobado de antemano, enviado al día siguiente (configurable). Opcionalmente, una tarea para recepción de enviar tarjeta firmada por el equipo.
- Reversión: si la baja fue un error, al reactivar la mascota se avisa qué se canceló, para que el usuario decida qué reprogramar (no se reprograma solo).
- Tests específicos: después del fallecimiento, ningún trabajo nocturno genera mensajes sobre esa mascota.

## 7. Encuesta posvisita (NPS) y reseñas

- **Disparo:** atención cerrada y cobrada, o servicio de grooming completado, con N horas de espera (configurable, por defecto 4). Máximo una encuesta por cliente cada 90 días (configurable). No se envía si la visita terminó en fallecimiento, si el paciente quedó hospitalizado o si el cliente está en duelo.
- **Página pública por token:** una sola pregunta obligatoria ("Del 0 al 10, ¿qué tan probable es que recomiende [clínica] a un amigo o familiar?") y un comentario opcional. Con la marca y el tema de la clínica, sin iniciar sesión, adaptada a celular, token de un solo uso con vencimiento (14 días), con límite de solicitudes y sin exponer datos del cliente más allá del nombre de la mascota.
- **Clasificación:**
  - **Promotor (9–10):** agradecimiento e invitación a dejar una reseña con el enlace de Google configurado por sede (si no hay enlace, solo agradecimiento).
  - **Neutral (7–8):** agradecimiento; comentario registrado.
  - **Detractor (0–6):** **tarea para dirección con plazo de 24 horas**, con el comentario, la visita, el médico y el historial. Su resolución (contactado, motivo, acción tomada) queda en la línea de tiempo. Si vence sin resolver, aviso a dirección.
- **Reportes:** NPS por clínica, médico, línea de servicio y período, con tendencia y los comentarios; bajando del número a la lista de respuestas.

## 8. Página pública de respuestas

Una sola infraestructura de páginas públicas por token para la encuesta NPS y la respuesta del día 3 de la bienvenida (y lista para las que vengan: app del cliente, confirmaciones). Rutas fuera del área autenticada, validación del token en el backend, RLS respetado resolviendo el tenant desde el token, y registro de la respuesta con `registrarInteraccion`.

## 8b. Calificación de cada visita (satisfacción)

Distinta del NPS: el NPS mide la lealtad a la clínica (máximo cada 90 días); esta mide **cada visita**.

- Después de cada consulta, grooming o procedimiento: "¿Cómo le fue con [servicio] de [mascota]?", de 1 a 5 estrellas, comentario opcional y aspectos rápidos de un toque (configurables: atención del médico, tiempo de espera, trato de recepción, limpieza, precio).
- Por la misma página pública por token (sección 8) hoy, y por la app del cliente (17) cuando exista. Si en esa visita corresponde también el NPS, se presentan juntos en una sola pantalla corta.
- Reportes de satisfacción por servicio, médico, día de la semana y período, con tendencia.
- Una calificación de 1 o 2 estrellas entra a la bandeja de la voz del cliente (sección 8c) como queja.

## 8c. Voz del cliente: sugerencias y quejas (que no sea un buzón que nadie lee)

Regla central: **cada comentario tiene dueño, plazo y respuesta**, y la IA hace el trabajo pesado de leer, clasificar y agrupar.

**Entrada.** Un espacio de "¿Algo que podamos mejorar? ¿Alguna sugerencia?" junto al NPS y a la calificación de la visita, y disponible en cualquier momento (página pública hoy; app del cliente después; WhatsApp cuando exista): texto libre, foto opcional y si el cliente quiere respuesta. Los comentarios de NPS y de calificación también entran aquí. Tabla `voz_cliente` con cliente, mascota, visita, canal, texto, adjuntos, origen (NPS, calificación, sugerencia espontánea) y estado.

**Clasificación por IA al llegar** (propuesta, no verdad):
- tema (lista configurable: espera, trato, precio, limpieza, comunicación, resultado clínico, grooming, horarios, instalaciones, app, servicio nuevo sugerido, otro);
- tipo (queja, sugerencia, felicitación);
- sentimiento y urgencia;
- servicio, médico o área mencionados;
- **críticos:** posible error clínico, maltrato, seguridad, amenaza de reclamo o denuncia → **alerta inmediata a dirección**.

Quien atiende corrige la clasificación con un clic; las correcciones quedan guardadas para medir y afinar la clasificación. Texto del cliente tratado como dato (defensa contra inyección, como en Vetline Ai); solo se envía al modelo el texto del comentario y el contexto mínimo, sin datos de identificación innecesarios.

**Bandeja con dueño y plazo.**
- Estados: `nuevo → asignado → respondido → cerrado` (con motivo de cierre).
- Responsable asignado por tema según una tabla configurable (por ejemplo, grooming → responsable de grooming; precio → dirección).
- Plazos configurables: 24 horas para quejas, 72 para sugerencias; los críticos, inmediato.
- **Borrador de respuesta redactado por la IA**, que una persona revisa, edita y envía por el canal del cliente. Nunca sale una respuesta sin revisión humana.
- Vencido el plazo: escalamiento a dirección y aparición en el resumen de la mañana del 16b.
- Todo queda en la línea de tiempo del cliente con `registrarInteraccion`.

**Analítica.** Pantalla Reportes › Voz del cliente:
- temas recurrentes con su tendencia ("espera los sábados: 14 comentarios este mes, el doble que el anterior") y ejemplos reales de cada tema;
- **cruce con datos:** quejas de espera contra ocupación real de la agenda; de precio contra ticket y segmento; de un médico contra su volumen de atenciones, para distinguir un problema real de un caso aislado;
- satisfacción y NPS por tema mencionado;
- **resumen semanal para dirección** generado por la IA sobre los datos calculados: 3 temas principales, qué cambió, felicitaciones destacadas para el equipo y comentarios sin atender;
- **de tema a iniciativa:** un tema recurrente se convierte con un clic en una iniciativa del 16b (contrato C9 del 00b), con su métrica (menciones del tema, satisfacción del servicio, NPS) para medir si la acción funcionó.

**Cerrar el círculo con el cliente.**
- Quien dejó una sugerencia recibe la respuesta y, si se implementó, un aviso: "Usted lo sugirió y lo hicimos".
- Opcional: sección "Lo que mejoramos gracias a ustedes", alimentada por las iniciativas cerradas que la dirección marque como publicables (para la app del cliente, 17).

**Métricas del propio buzón** (en el diccionario del 12): porcentaje atendido en plazo, tiempo promedio de respuesta, temas resueltos contra abiertos, detractores que tras la respuesta volvieron o mejoraron su calificación. Si se deterioran, el 16b lo advierte en sus alertas.

**Permisos:** `voz_cliente.ver`, `voz_cliente.responder`, `voz_cliente.configurar`; los comentarios sobre un médico no los ve ese médico salvo que dirección lo habilite.

## 9. Tablero de fidelización

En Reportes › Fidelización, con las métricas definidas en el diccionario de métricas del 12 (definición, fórmula y origen) y trazabilidad hasta la lista de clientes:

- retención anual (clientes activos hace 12 meses que siguen activos);
- frecuencia de visita promedio;
- tasa de regreso de clientes nuevos a 90 días, con bienvenida contra sin ella;
- clientes en riesgo, en secuencia y recuperados, con el ingreso atribuido;
- NPS y su tendencia, por médico y línea;
- tareas de detractores: abiertas, resueltas, vencidas;
- costo de los beneficios otorgados contra el ingreso atribuido, por programa.
- satisfacción por visita (servicio, médico, día) y métricas de la voz del cliente (sección 8c).

Estas métricas quedan disponibles para el asesor del 16b.

## 10. Configuración

Administración › Fidelización: una tarjeta por programa con interruptor, pasos, días, plantillas con vista previa, beneficio opcional (con validación de margen mínimo), límites y período de duelo; enlace de reseñas de Google por sede. Formularios con `useCambiosSinGuardar`. Permisos nuevos desde la base: `fidelizacion.configurar`, `fidelizacion.ver_tablero`, `nps.ver_respuestas`.

## 11. Datos de demostración

En el tenant de prueba:

- clientes en cada paso de la recuperación (uno recuperado con su cita atribuida y uno cortado por "no le interesa");
- un cliente nuevo en bienvenida con respuesta "peor" y su tarea urgente;
- una mascota fallecida con todo cancelado;
- encuestas de las tres clasificaciones, incluida una tarea de detractor resuelta y una vencida.
- calificaciones de visitas y unos 40 comentarios de voz del cliente con temas recurrentes (espera los sábados, precio del grooming), uno crítico, felicitaciones, y uno convertido en iniciativa.

## 12. Manual de usuario

`docs/ayuda/fidelizacion-retencion.md`, con el estándar de la guía: para qué sirve cada programa, cuándo se dispara, quién actúa, paso a paso de configuración, un ejemplo con números (un cliente que venía cada 4 meses y lleva 7 sin venir: los tres pasos y cómo queda atribuida su vuelta), qué pasa después, preguntas frecuentes (¿por qué este cliente no recibió el mensaje?) y glosario (NPS, promotor, detractor, retención, atribución).

## 13. Verificación y entrega

- Tests:
  - secuencia completa con corte al agendar;
  - no reingreso antes del plazo;
  - exclusiones;
  - fallecimiento cancela todo en una transacción;
  - token de un solo uso y vencido;
  - detractor crea tarea con plazo;
  - comentario crítico genera alerta inmediata;
  - todo comentario queda asignado con plazo y escala al vencer;
  - ninguna respuesta sale sin revisión humana;
  - texto con instrucciones maliciosas no altera la clasificación ni el borrador;
  - sin duplicados con oportunidades del 14;
  - idempotencia de los trabajos nocturnos;
  - aislamiento entre tenants.
- Capturas en la bitácora de: configuración, bandeja con secuencias, página pública en celular, tarea de detractor, tablero.
- En la bitácora, cómo probarlo en el navegador paso a paso, incluido cómo forzar los trabajos nocturnos en desarrollo para ver los pasos sin esperar días.

## 14. Límites

- Sin envíos reales en desarrollo; sin conexión con Converza.
- No se modifica el comportamiento de los avisos existentes de Vetline Ai.
- Nada a producción; nada a `main` sin revisión.
