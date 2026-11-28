# Vetline Clinic — 20 · Canal WhatsApp asistido

> Prompt para Claude Code. Repo: `vetplatform`. Lee antes `docs/prompts/vetline-clinic-00-guia-rectora.md` (sección 7, notificaciones) y `docs/prompts/vetline-clinic-00b-pilares-de-crecimiento.md` (contrato C4: un solo mecanismo de envío).
> Depende de: el mecanismo de notificaciones existente de Vetline Ai y lo construido en 03 (consentimientos, canal preferido, línea de tiempo). Lo usan: los avisos existentes (vacunas, desparasitaciones, citas, seguimientos), 14 (CRM), 15a, 15b y 16b.
> **Va después del 07e y antes del 05**: da valor inmediato con los avisos que ya existen y deja el canal listo para el CRM y la fidelización.

## Por qué existe

Los clientes de Medicavet viven en WhatsApp, y la clínica usa **WhatsApp Business (la aplicación, sin API)**. La integración con la API de Meta llegará por Converza más adelante. Mientras tanto, el canal real del sistema es solo el correo, que el cliente abre poco.

**WhatsApp asistido** cierra esa brecha sin integración: el sistema arma cada mensaje y recepción lo envía con un clic, que abre WhatsApp con el chat del cliente y el texto ya escrito; recepción solo revisa y pulsa enviar. Usa el canal donde están los clientes, no cuesta nada por mensaje, mantiene a una persona en el circuito (lo que ayuda a la adopción) y se mide igual que un envío automático. Cuando llegue la API, los mismos mensajes pasan a salir solos sin rehacer nada.

## 0. Relevamiento (corto)

Revisa y anota en la bitácora: cómo funciona hoy `emitirNotificacion` y `puedeEnviar()`, qué proveedores y canales existen (correo real, WhatsApp simulado del 03), cómo se guardan el teléfono, el canal preferido y los consentimientos del cliente, la tabla `notificaciones` y la pantalla Administración › Notificaciones. Construye sobre eso: **no** crees un segundo mecanismo de envío.

## 1. El canal dentro del mecanismo existente

- Nuevo canal `whatsapp_asistido` en el mecanismo de notificaciones. Para cada tipo de aviso, la clínica elige en Administración › Notificaciones el canal: correo, WhatsApp asistido o ambos. Por defecto, para los tipos de servicio (recordatorios de vacuna, desparasitación, cita, seguimiento), WhatsApp asistido con respaldo por correo cuando el cliente no tiene teléfono válido.
- Se respeta el **canal preferido** del cliente: si prefiere correo, va por correo.
- Cuando un aviso resuelve a WhatsApp y no hay proveedor de API activo, `emitirNotificacion` **no envía**: crea un **envío asistido** pendiente, con el mismo registro en `notificaciones`, el mismo paso por `puedeEnviar()` (consentimiento, tope de frecuencia, exclusiones) y el mismo evento en la línea de tiempo al confirmarse.
- Diseño preparado para el proveedor por API: el envío asistido y el envío por API son el mismo registro con distinto proveedor. Activar más adelante el proveedor de Converza debe cambiar solo la configuración, no el código de quienes emiten avisos.

## 2. Envío asistido: estados

`pendiente → abierto → enviado | omitido | vencido`

- **pendiente:** listo en la bandeja.
- **abierto:** alguien pulsó "Enviar por WhatsApp" (queda quién y cuándo; bloquea el envío para que otra persona no lo mande dos veces).
- **enviado:** se marca al pulsar el botón; durante el resto del día se puede corregir con "No se envió", que lo devuelve a pendiente.
- **omitido:** recepción decide no enviarlo, con motivo (número equivocado, el cliente ya agendó, otro).
- **vencido:** pasó su ventana de utilidad sin enviarse (por ejemplo, la confirmación de una cita cuya hora ya pasó). Cada tipo define su vencimiento.

## 3. La bandeja de envíos de WhatsApp

Pantalla para recepción (y sección dentro de la bandeja del día del 14 cuando exista):

- Lista de envíos pendientes del día, **ordenada por prioridad** y luego por hora programada. Prioridades por defecto (configurables): seguimiento urgente posvisita, confirmación de cita de mañana, recordatorio de vacuna o desparasitación, control recomendado, recompra, recuperación de clientes, encuesta, mensaje promocional.
- Agrupación por tipo con contador ("hoy: 8 recordatorios, 3 confirmaciones, 2 encuestas").
- Cada fila: cliente, mascota, tipo, vista previa del texto, teléfono, y el botón **"Enviar por WhatsApp"**.
- El botón abre `https://wa.me/<teléfono E.164 sin +>?text=<texto codificado>` en una pestaña nueva: en la computadora abre WhatsApp Business de escritorio o WhatsApp Web (la clínica debe tener su WhatsApp Business vinculado en esa computadora); en el celular abre la aplicación directamente. La pantalla es adaptable para usarse desde el celular de la clínica.
- **Editar antes de enviar:** recepción puede ajustar el texto de un envío puntual; queda registrado el texto final.
- **Modo seguido:** después de marcar un envío, el siguiente queda listo con un toque, para despachar la lista rápido.
- **Tope diario configurable** de envíos asistidos por tipo, para no saturar a recepción ni al cliente; lo que excede queda para el día siguiente si su ventana lo permite.
- Antes de abrir WhatsApp se **vuelve a verificar** `puedeEnviar()`: si desde que se creó el envío el cliente retiró el consentimiento, la mascota falleció o el cliente ya agendó, el envío pasa a omitido con el motivo y no se abre.

## 4. Resultado de la conversación

La respuesta del cliente llega a WhatsApp, no al sistema. Para que el circuito se cierre igual:

- En cada envío marcado, botones rápidos de resultado: **respondió**, **agendó** (abre la agenda con el cliente y la mascota cargados), **no le interesa**, **número equivocado**, **sin respuesta**.
- Esos resultados alimentan lo que corresponda: cortan la secuencia de recuperación del 15a, cierran o descartan la oportunidad del 14, marcan el teléfono como inválido (y lo envían a Calidad de datos), y quedan en la línea de tiempo.
- La atribución de la cita o venta posterior funciona igual que con cualquier canal (contrato C5).

## 5. Teléfonos

- Normalización a formato internacional (E.164) con el código de país de la clínica por defecto (+506 en Costa Rica). Validación básica de longitud.
- Un cliente sin teléfono válido: el aviso cae al correo si existe; si no tiene ningún contacto, se registra como "sin contacto" y aparece en Administración › Calidad de datos.
- Si el cliente tiene varios teléfonos, se usa el marcado como WhatsApp o el principal.

## 6. Plantillas

- Cada tipo de aviso tiene su plantilla para WhatsApp, distinta de la de correo: más corta, en tono cercano, con trato de usted, firma de la clínica y emojis opcionales.
- Variables: nombre del cliente, nombre y especie de la mascota, servicio, fecha y hora, nombre de la clínica, y enlaces (agendar, encuesta, código de referido, documento publicado) generados con las páginas públicas por token del 15a (contrato C8).
- Vista previa con datos de ejemplo y conteo de caracteres.
- Cada plantilla lleva una categoría (servicio o promocional), que decide si cuenta para el tope de frecuencia y que servirá para registrarlas en Meta cuando llegue la API.
- Plantillas por defecto para todos los avisos que ya existen y para los del 14, 15a y 15b.

## 7. Configuración

Administración › Notificaciones, ampliada:

- canal por tipo de aviso (correo, WhatsApp asistido, ambos);
- prioridad, tope diario y vencimiento por tipo;
- plantillas de WhatsApp;
- código de país por defecto;
- número de WhatsApp de la clínica (para mostrar en mensajes, correos y la futura app del cliente).

Formularios con `useCambiosSinGuardar`. Permisos desde la base: `whatsapp_asistido.enviar` (recepción por defecto), `whatsapp_asistido.configurar` (dirección).

## 8. Métricas

En el diccionario del 12:

- envíos creados, enviados, omitidos (por motivo) y vencidos, por tipo y por día;
- tiempo desde la hora programada hasta el envío;
- resultados registrados (respondió, agendó, no le interesa);
- conversión atribuida por tipo de aviso;
- carga de recepción: envíos por día y por persona.

El 16b puede advertir cuando muchos envíos vencen sin enviarse ("esta semana vencieron 23 recordatorios de vacuna sin enviar").

## 9. Datos de demostración

En el tenant de demostración: una bandeja del día con envíos de todos los tipos y prioridades, algunos enviados con resultados registrados, uno omitido por número equivocado, uno vencido, un cliente sin teléfono que cayó al correo y otro sin ningún contacto en Calidad de datos.

## 10. Manual de usuario

`docs/ayuda/whatsapp-asistido.md`, con el estándar de la guía: para qué sirve, cómo preparar la computadora de recepción (WhatsApp Business vinculado), el paso a paso de despachar la bandeja, un ejemplo (una mañana con 12 envíos: cuánto toma, qué hacer si un número está mal, cómo registrar que el cliente agendó), qué pasa después, preguntas frecuentes ("¿por qué no aparece un cliente?", "¿qué pasa si cerré la pestaña sin enviar?", "¿qué cambia cuando llegue la integración automática?") y glosario.

## Verificación y entrega

- Tests:
  - un aviso con canal WhatsApp asistido crea un envío pendiente y no envía nada;
  - el enlace `wa.me` se arma con el teléfono normalizado y el texto codificado (acentos, saltos de línea, signos);
  - `puedeEnviar()` se verifica al crear y al abrir; un consentimiento retirado o una mascota fallecida en el medio bloquea el envío;
  - dos usuarios no pueden abrir el mismo envío a la vez;
  - "No se envió" lo devuelve a pendiente;
  - el vencimiento por tipo;
  - el tope diario;
  - los resultados cortan la secuencia del 15a y cierran la oportunidad del 14 (cuando existan; si no, el punto de extensión queda probado);
  - los avisos existentes de Vetline Ai siguen funcionando igual por correo cuando ese es su canal;
  - aislamiento entre tenants.
- Capturas en la bitácora: configuración por tipo, bandeja con prioridades, vista previa, resultado registrado.
- En la bitácora, cómo probarlo en el navegador paso a paso (en desarrollo, el enlace `wa.me` se puede abrir para ver el texto armado, sin enviar).
- Sin envíos reales por otros canales en desarrollo; nada a producción; nada a `main` sin revisión.
