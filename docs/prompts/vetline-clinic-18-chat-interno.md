# Vetline Clinic — 18 · Chat interno del equipo

Rama: `vetline-clinic/18-chat-interno`, que parte del último punto con todo lo construido. Se rige por `vetline-clinic-00-guia-rectora.md`, en especial la sección 12 (verificación y manual de usuario en `docs/ayuda/`) y la regla de notificaciones de la sección 7.

## Por qué existe

En una clínica, la recepción, la caja y los médicos se coordinan todo el día: "el paciente llegó", "pase a consulta", "la dueña de Toby está en caja, ¿cierras la atención?", "cárgale una consulta y una vacuna". Hoy eso se hace a gritos, por WhatsApp personal o caminando. El chat interno lo trae al sistema, **con contexto**: cada mensaje puede llevar el enlace al paciente, la atención o la cita de la que se habla.

**Se reutiliza al máximo el código del chat profesional–paciente de NutriSmart**, que ya está escrito, probado y es del mismo lenguaje (TypeScript, Postgres y React). Se **porta** a Vetline Clinic y se adapta solo lo que difiere entre los dos proyectos:

| Archivo de NutriSmart (`C:\Nutrismart\apps\…`) | Qué se reutiliza | Qué se adapta |
|---|---|---|
| `api/migrations/013_mensajeria.sql` | El modelo de datos, los índices, los contadores de no leídos | Nombres con prefijo `chat_`, `tenant_id` con RLS forzado y `ON DELETE CASCADE` (convención de Vetline), y participantes múltiples en lugar del par fijo paciente–profesional |
| `api/src/routes/mensajeria.ts` (366 líneas) | La lógica de las rutas: listar conversaciones, abrir, leer mensajes "desde", enviar, no leídos, marcar leído, validaciones, largo máximo | Fastify → **Express** (el router de Vetline); `pool` y `resolverAlcance` → `req.db` con el tenant y el usuario resueltos por el middleware de Vetline, y los permisos del 04 |
| `web-professional/src/api/mensajeria.ts` | El cliente de la API | El envoltorio autenticado de Vetline (token por defecto) |
| `web-professional/src/components/mensajeria/ConversacionItem.tsx`, `HiloConversacion.tsx`, `MensajeBurbuja.tsx` | Los componentes, incluido el sondeo incremental (`SONDEO_MS`) y el desplazamiento al último mensaje | Los componentes del sistema de diseño de Vetline (tokens y tema por clínica del 01c), los íconos de Vetline y los textos en "usted" |
| `web-professional/src/pages/BandejaMensajes.tsx` | La bandeja | La pantalla `/chat` y el panel lateral de la barra superior |
| `lib/fechas.ts` (lo que use el chat) | El formato de horas relativas | Las utilidades de fecha y zona horaria de Vetline, si ya existen |

**Reglas de la reutilización:**
- **Se copia y adapta dentro del repo de Vetline. No se crea una dependencia** entre los dos proyectos ni se modifica nada en NutriSmart.
- Se conservan **los comentarios que explican decisiones** (por ejemplo, la regla de privacidad del administrador), adaptados.
- Lo que NutriSmart no tiene (grupos, canal de la clínica, menciones, adjuntos, contexto ligado, mensajes rápidos, editar y eliminar) se construye **sobre** ese código, en su mismo estilo.
- El informe lista, archivo por archivo, qué se portó tal cual, qué se adaptó y qué es nuevo.

**La regla de privacidad que se adopta de NutriSmart:** la conversación es de quienes están en ella. Un administrador no lee las conversaciones de otros por ser administrador.

**El chat con el cliente no es este prompt.** Va en la app del cliente (17), sobre la misma base.

## 0. Relevamiento

El informe parte de lo que ya existe en Vetline Ai y Vetline Clinic, para no duplicarlo:
- **La tabla `mensajes`** (de la migración 001): es la conversación entre el médico y el agente de IA dentro de un caso (`remitente` 'medico' o 'ai'). **No es un chat entre personas y no se reutiliza para esto**: las tablas nuevas llevan otro nombre (por ejemplo, `chat_conversaciones`, `chat_participantes`, `chat_mensajes`, `chat_lecturas`) para que nadie las confunda.
- El mecanismo de notificaciones (`emitirNotificacion`, la campana), las notificaciones en la app y, si existe, el envío push de la PWA.
- El aviso "Avisar al médico" de la caja (paquete de defectos de la tarde, punto 10.1), que pasa a ser un mensaje de este chat.
- El almacenamiento de archivos y su RLS.

## 1. Conversaciones

**Tres tipos:**

| Tipo | Quién participa | Ejemplo |
|---|---|---|
| **Directa** | Dos personas del personal | La recepcionista con la Dra. Solís |
| **Grupo** | Un grupo con nombre, creado por cualquiera | "Cirugía del jueves" |
| **Canal de la clínica** | Todo el personal activo, automáticamente | "General" |

- Un canal por rol (por ejemplo, "Recepción") se puede crear como grupo. No hace falta un tipo aparte.
- Las conversaciones son de la clínica (tenant, con RLS forzado y `ON DELETE CASCADE` en todas las tablas nuevas).
- **Privacidad:** solo los participantes leen una conversación directa o de grupo. **El administrador no tiene acceso por ser administrador.** La excepción es una auditoría formal, que queda fuera de este prompt y se documenta como pendiente.
- **Una persona desactivada** (04) deja de recibir y enviar, pero sus mensajes se conservan con su nombre.

## 2. Mensajes

- **Texto**, hasta un largo máximo razonable, con saltos de línea y enlaces.
- **Adjuntos:** imágenes y PDF, con el almacenamiento de archivos existente y la validación de tipo por firma de bytes. Las imágenes se ven en miniatura.
- **Menciones** con `@nombre`, que notifican a la persona mencionada aunque haya silenciado la conversación.
- **Contexto ligado:** desde la ficha del paciente, una atención, una cita o la caja, el botón **"Enviar mensaje sobre esto"** abre el chat con el enlace ya adjunto. Por ejemplo: "Toby · Atención en curso · Dra. Solís".
  - El enlace **respeta los permisos de quien lo recibe**. Si la persona no puede ver ese registro, ve el texto del mensaje y "sin acceso" en lugar del enlace.
- **Mensajes rápidos predefinidos** por clínica, con valores iniciales: "El paciente llegó", "Pase a consulta", "Cierre la atención, el cliente está en caja", "Necesito ayuda en consulta", "El resultado de laboratorio llegó". Se envían con un clic, con el contexto ligado si se abren desde un registro.
- **Editar** el propio mensaje dentro de los primeros 5 minutos, con la marca "editado".
- **Eliminar** el propio mensaje: es un borrado lógico que deja "Mensaje eliminado".
- **Leído:** cada participante marca lo leído al abrir la conversación. En las directas se ve "Visto".

**El chat no es el expediente.** Lo que se dice en el chat no entra al expediente clínico. Si un mensaje tiene información clínica que debe quedar registrada, el médico la copia a la atención, y la pantalla lo recuerda con un aviso discreto en los mensajes ligados a una atención.

## 3. Interfaz

- **Ícono de chat en la barra superior**, junto a la campana, con el contador de no leídos. Abre un **panel lateral** que no saca al usuario de su pantalla: puede seguir en la atención o en la caja mientras chatea.
- **Panel:** lista de conversaciones (no leídas primero, con la última línea y la hora), buscador de conversaciones y personas, y el botón "Nueva conversación".
- **Pantalla completa** en `/chat`, para quien lo use mucho. En el teléfono (PWA), el chat ocupa la pantalla completa.
- **Silenciar** una conversación, con excepción de las menciones.
- **Tiempo real:** los mensajes nuevos llegan sin recargar. **Se empieza con el sondeo incremental de NutriSmart**, que ya funciona. Solo si las mediciones con 10 usuarios muestran una carga o latencia inaceptables, se propone en el informe pasar a un canal de eventos del servidor (SSE). **Meta:** un mensaje aparece al otro lado en menos de 5 segundos.
- **Avisos:**
  - en la app, un aviso discreto con el remitente y la primera línea;
  - si el usuario tiene la PWA instalada y aceptó notificaciones, un aviso push en el teléfono.

  Los avisos usan el mecanismo de notificaciones existente y tienen su interruptor por usuario.

## 4. Integración con la atención y la caja

- **"Avisar al médico"** (caja, punto 10.1 del paquete de defectos) envía un mensaje rápido directo al médico de la atención, con el enlace a la atención. Si ya se construyó como notificación aparte, se reemplaza por esto para no tener dos mecanismos.
- **Desde la sección "En atención" de la caja** y desde "En la clínica ahora" del Inicio, el botón de chat abre la conversación con el médico de ese paciente.

**Pedido del médico a la recepción ("cárgale esto"):**
- **Lo que se cobra** (servicios y productos) lo puede cargar en una atención abierta alguien que no es médico, si tiene el permiso configurable `atencion.cargar_items` (agregarlo a la matriz del 04, apagado por defecto). Cada ítem queda con quién lo cargó.
- **La receta es contenido clínico.** Un usuario no médico puede **transcribirla como borrador**, a partir de lo que el médico le indicó. Cada línea queda marcada "transcrita por [nombre], pendiente de confirmación del médico". El médico recibe un aviso con el enlace, revisa y **confirma con un clic** (o corrige). **La atención no se puede cerrar con líneas de receta sin confirmar.** Las validaciones de dosis por peso y alergias se aplican igual, y el médico las ve al confirmar.
- Este flujo se ofrece desde el mensaje del médico: un mensaje ligado a una atención muestra a la recepción el botón "Cargar en la atención".

## 5. Retención y auditoría

- Los mensajes se conservan mientras la clínica exista, salvo que la política de la clínica (04) defina un tiempo de retención. Se crea la política, sin valor por defecto: se conservan.
- Las acciones administrativas (crear o borrar grupos, cambiar participantes) quedan en la auditoría. **El contenido de los mensajes no se copia a la auditoría.**

## Manual de usuario

Las páginas de `docs/ayuda/` explican:
- cómo abrir el chat y empezar una conversación;
- los grupos y el canal general;
- cómo enviar un mensaje sobre un paciente o una atención;
- los mensajes rápidos y las menciones;
- silenciar;
- **por qué el chat no es el expediente**;
- el flujo de "cárgale esto": qué puede cargar la recepción y cómo el médico confirma la receta transcrita;
- la privacidad de las conversaciones.

## Verificación y entrega

Se recorre en el navegador con dos usuarios (un médico y una recepcionista con roles de recepción y caja), en dos ventanas:
- una conversación directa, con mensajes en ambos sentidos en menos de 5 segundos, leído y no leídos;
- un grupo y el canal general;
- un adjunto de imagen;
- una mención en una conversación silenciada;
- desde la caja, "Avisar al médico" con el enlace a la atención;
- el médico pide por chat "consulta, vacuna y amoxicilina por 7 días";
- la recepcionista carga la consulta y la vacuna (con el permiso activado) y transcribe la receta como borrador;
- comprobar que la atención no cierra hasta que el médico confirma la receta, y que el médico la confirma con un clic;
- el administrador no puede abrir la conversación directa entre otros dos;
- un enlace a un registro que el receptor no puede ver;
- en el teléfono, el panel a pantalla completa.

**Medir:** la latencia y la carga en el servidor con 10 usuarios conectados.

El informe incluye la tabla de reutilización archivo por archivo, la medición del sondeo, las migraciones, los permisos agregados, lo adoptado de NutriSmart y "cómo probarlo" con los clics exactos para Miguel.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
