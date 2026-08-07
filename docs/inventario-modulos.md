# Inventario 2 — Módulos del backend

Todos los archivos de `backend/src/` con responsabilidad real en el proceso en ejecución. **No incluye** `backend/src/scripts/` (ver nota al final) ni `backend/src/migrations/` (ya cubierto por el modelo de datos).

## Núcleo / arranque

| Archivo | Responsabilidad |
|---|---|
| `index.ts` | Punto de entrada Express. Monta todos los routers, el middleware global de auditoría, arranca los 4 jobs programados y valida credenciales de pasarela por país al boot. |
| `config.ts` | Único punto de lectura de variables de entorno — separa las que son obligatorias (tira el proceso si faltan) de las opcionales (la funcionalidad que dependa de ellas falla con un error claro en tiempo de uso, no al arrancar). Ver Inventario 4. |
| `db.ts` | Los dos pools de Postgres del proyecto: `pool` (conecta como owner, sin RLS — jobs de fondo y creación de tenant) y `tenantPool` (rol sin privilegios, RLS real — todo request autenticado de clínica). |

## Autenticación y auditoría

| Archivo | Responsabilidad |
|---|---|
| `middleware/auth.ts` | `authenticate` (verifica el JWT de Keycloak contra su JWKS, resuelve la persona/staff en la base a partir de `keycloak_user_id` — **no confía en ningún claim del token para autorizar**, ver Inventario 1) + `withTenantClient` (abre la transacción por request, hace `SET LOCAL app.tenant_id`). |
| `middleware/auditoria.ts` | Middleware global: audita automáticamente toda escritura (POST/PUT/PATCH/DELETE) autenticada que responda 2xx, sin que cada endpoint lo llame. Expone además `registrarLecturaSensible`/`registrarEventoDetallado` para los pocos casos que sí quieren auditar una lectura o guardar el detalle de un cambio. |
| `keycloakAdmin.ts` | Único punto que habla con la Admin API de Keycloak: crear/borrar usuarios, cambiar contraseña, cambiar email+username, sincronizar `emailVerified`, e intercambiar contraseña por tokens (usado para el auto-login post-registro). |

## Motor de crédito de IA (consumo, tarifas, límites)

| Archivo | Responsabilidad |
|---|---|
| `tarifas.ts` | **Punto único confirmado.** Resuelve `tarifas_modelo` vigente, calcula el costo real de una llamada a Anthropic y es el único lugar que escribe en `uso_api` (`registrarUsoApi`). También expone `verificarAntesDeGenerar` (compuerta de saldo antes de cualquier llamada facturable) y `mensajeRechazoGeneracion`. Antes de esto había 4 copias casi idénticas de esta lógica en 3 archivos — el propio código lo documenta como el ejemplo de referencia de "qué pasa si no se consolida". |
| `usoIa.ts` | Cálculo del ciclo de facturación vigente de un tenant (trial vs. suscripción real de Stripe vs. fallback calendario) + detección de umbrales de aviso (80%/100% del plan, saldo bajo) y si un mensaje debe bloquearse. |
| `cupos.ts` | Flujo de suscripción A — gestión de cupos de agentes/médicos contratados vs. usados (habilitar/deshabilitar agente, freno anti-rotación). |

## Facturación y suscripciones (modelo nuevo — vigente)

| Archivo | Responsabilidad |
|---|---|
| `facturacion.ts` | **Punto único confirmado.** Único lugar que escribe en `eventos_facturacion` — antes cada flujo de pago armaba su propio INSERT a mano (Stripe en dos lugares de `webhooks.routes.ts`, los jobs de `suscripciones.job.ts`, la factura manual). El propio archivo documenta que el flujo de registro con Tilopay nunca llegó a usarlo (gap conocido, ver más abajo). |
| `cambios.ts` | Flujo de suscripción B — downgrade programado (a fin de período) y cancelación. Ninguno de los dos cobra. |
| `upgrade.ts` | Upgrade de plan con prorrateo, cobro inmediato solo si el cobro es exitoso (vía el motor de cobros, nunca antes). |
| `registroPrueba.ts` | Otorgamiento del crédito de prueba gratuita — idempotente (`tenants.credito_prueba_otorgado_en`), con tope global mensual del sandbox. Gatea el otorgamiento a que el admin tenga el correo verificado (además del requisito preexistente de colegiatura). |
| `purga.ts` | Ciclo de vida completo de fin de prueba: cierre de prueba → ventana de purga con aviso/recordatorio → exportación de datos → eliminación definitiva (con auditoría que sobrevive al `DELETE`). Incluye también el límite exterior de "cuenta nunca operativa" (30 días sin correo verificado y sin médico con colegiatura) y los helpers de bloqueo de generación de IA durante la ventana de purga. |
| `medicoAgente.ts` | **Punto único confirmado.** Gestión de `medico_agente` (qué agentes puede *usar* un médico puntual — distinto de `tenant_agentes`, el entitlement de la clínica). Antes disperso dentro de `admin.routes.ts`. |
| `invitaciones.ts` | Invitación de médicos por correo (token de un solo uso, alta al aceptar, cupo reservado por invitaciones pendientes). |
| `contextoCaso.ts` | Arma el bloque de contexto del paciente (especie/raza/sexo/edad/motivo) que se inyecta como `system` adicional (sin cachear) en toda llamada al modelo. **Es el "contexto del caso" que ya conocías como punto único** — usado por chat, Dashboard e Informe. |
| `informacionRegistrada.ts` | Arma el bloque de "información registrada pendiente de análisis" (anotar vs. consultar) — mismo criterio de bloque `system` adicional sin cache. |

## Correo transaccional y verificación

| Archivo | Responsabilidad |
|---|---|
| `email.ts` | Cliente Resend perezoso — `enviarEmail` de bajo nivel, devuelve el id del mensaje. |
| `correos.ts` | Plantillas HTML de los correos transaccionales + `enviarCorreoTransaccional`, que registra cada intento (éxito o falla) en `correos_enviados`. |
| `verificacionCorreo.ts` | Verificación del correo del administrador: genera/envía el token, confirma, marca rebotes (correlacionados por `proveedor_message_id`, no por destinatario adivinado), y el cambio de correo (DB + Keycloak). |

## Motor de cobros (`backend/src/pagos/`)

| Archivo | Responsabilidad |
|---|---|
| `credencialesPasarela.ts` | **Punto único confirmado.** Resuelve las credenciales de pasarela por país (`PASARELA_<ISO>_*`), valida al arrancar que todo país habilitado tenga sus credenciales. |
| `proveedorPagos.ts` | **Punto único confirmado.** Única interfaz con "la pasarela" — todo lo que cobra pasa por acá, nunca por Tilopay directo. Hoy es un proveedor **simulado**: el resultado siempre llega por el mismo camino de callback asíncrono que usaría una pasarela real (nunca en la respuesta síncrona), a propósito, para no repetir el bug real que motivó este diseño. |
| `callbackCobros.ts` | **Punto único confirmado.** El componente más crítico del motor: único lugar que puede pasar un cobro a exitoso/fallido y disparar sus efectos (crédito, plan, cupos, documento fiscal). Registra siempre la notificación entrante antes de procesarla, e idempotente por `order_number`. |
| `cicloCobro.ts` | **Punto único confirmado ("ciclo de cobro").** Ciclo de cobro recurrente + política de reintentos (0/3/7/10 días desde el vencimiento) — deliberadamente independiente del ciclo de *crédito* (`jobs/ciclo.job.ts`), que vive en su propia columna. |
| `documentoFiscal.ts` | Emisión de documento fiscal interno al confirmarse un cobro (copia los datos fiscales, no los referencia). Emisión electrónica real (Hacienda, etc.) queda fuera de alcance a propósito — el punto de enganche ya está previsto (`estado_externo`). |
| `recargas.ts` | Recarga de crédito, autorecarga y medio de pago — todo pasa por `obtenerProveedorPagos()`, el crédito se acredita solo con la confirmación del callback. |
| `tilopay.ts` | Integración real con Tilopay (sandbox). Único adaptador de pasarela concreto hoy — recibe `paisCodigo` y resuelve sus propias credenciales, sin globales. |
| `conversionPrueba.ts` | Conversión de una clínica en prueba a un plan pago — el admin elige agentes nuevos (nunca arrastra los de la prueba) y se cobra el primer período. |

## Integraciones externas (clientes perezosos)

| Archivo | Responsabilidad |
|---|---|
| `anthropic.ts` | Cliente Anthropic perezoso — `requerirAnthropic()` tira un error claro si falta `ANTHROPIC_API_KEY`, nunca tumba el arranque. |
| `stripe.ts` | Mismo patrón para Stripe — usado hoy solo por el modelo de facturación **anterior** (ver más abajo). |
| `lib/extraccion.ts` | Único punto de extracción de texto de un archivo de la Base de Conocimiento (PDF vía `pdf-parse`, DOCX vía `mammoth`, txt/md directo) — usado tanto por la carga desde Platform Admin como por el script de backfill. |

## Trabajos programados (`backend/src/jobs/`)

Ver detalle completo en el Inventario 3. Resumen de responsabilidad:

| Archivo | Responsabilidad |
|---|---|
| `ciclo.job.ts` | Motor de crédito, ciclo de facturación vigente (expira/otorga crédito del período, ejecuta cambios de suscripción vencidos, dispara los avisos/purga de prueba y de cuenta no operativa). |
| `cicloCobro.job.ts` | Dispara diariamente el ciclo de cobro recurrente (`pagos/cicloCobro.ts`). |
| `notificaciones.job.ts` | Recordatorios de cita, avisos de desparasitación próxima, alertas de seguimiento clínico faltante. |
| `suscripciones.job.ts` | **Desactivado** — ver "Qué está dado de baja" más abajo. |

## Rutas HTTP (`backend/src/routes/`)

Catalogadas endpoint por endpoint en el Inventario 1. A nivel de archivo, cada uno corresponde 1:1 a un dominio de negocio salvo las excepciones ya notadas ahí (ej. `casos.routes.ts` también exporta helpers que reusan `recetas.routes.ts` y `workspace.routes.ts`).

## `backend/src/scripts/`

No se detalla archivo por archivo: son **scripts operativos de un solo uso**, ejecutados a mano con `ts-node` contra la base viva (relevamientos, migraciones aplicadas manualmente, verificaciones end-to-end, reparaciones puntuales de datos). Ninguno se importa desde `index.ts` ni forma parte del proceso en ejecución. Hay decenas acumuladas de sesiones sucesivas de desarrollo — mismo patrón de acumulación sin consolidar que ya está señalado en el relevamiento de reproducibilidad del ambiente (fuera de alcance de este inventario).

---

## Puntos únicos de gestión — confirmados

Los 6 que ya conocías, confirmados en el código real: **`tarifas.ts`**, **`proveedorPagos.ts`**, **`callbackCobros.ts`**, **`credencialesPasarela.ts`**, **`cicloCobro.ts`** (motor de cobros) y **`contextoCaso.ts`**.

Además, otros dos que cumplen el mismo criterio (una sola escritura posible a su tabla, documentado explícitamente en el propio archivo como reemplazo de un patrón disperso anterior):
- **`facturacion.ts`** — único punto que escribe en `eventos_facturacion`.
- **`medicoAgente.ts`** — único punto que gestiona `medico_agente` (el que motivó el prompt "urgente" de esta misma sesión).

## Responsabilidades repartidas que convendría consolidar

1. **Armado del historial de mensajes para Claude, duplicado 4 veces en 3 archivos.** El bloque que arma `mensajesParaClaude` (LEFT JOIN a `archivos`, agrupa por mensaje, convierte a bloques `image`/`document` por `file_id_anthropic`) está copiado literal en `workspace.routes.ts` (el chat real), y **dos veces dentro de `casos.routes.ts`** (`POST /:id/dashboard/actualizar` y `POST /:id/informe/generar`), más una vez en `recetas.routes.ts` (`POST /:id/validar`). Es exactamente la forma del problema que ya se corrigió una vez con `tarifas.ts` (4 copias en 3 archivos) y con `medico_agente` (disperso en `admin.routes.ts`) — con la diferencia de que acá la duplicación es **deliberada y está documentada en el propio código** ("duplicado a propósito, ver nota de cabecera... no tocar workspace.routes.ts, no acoplar este endpoint a otro"). No es un descuido, pero cumple el mismo criterio de "cuatro copias" que en el pasado sí ameritó consolidar — vale la pena revisarlo con la misma vara.
2. **Dos modelos de facturación coexistiendo.** El modelo anterior (`tenants.estado_suscripcion`, Stripe, `jobs/suscripciones.job.ts`, el bloque `/api/platform-admin/facturacion/*`, `webhooks.routes.ts` → `POST /stripe`) sigue montado y respondiendo junto al modelo vigente (`suscripciones`/`saldos_ia`, `backend/src/pagos/`, `jobs/ciclo.job.ts` + `jobs/cicloCobro.job.ts`). No hay ningún aviso en el código ni en la UI que le diga a quien no participó del desarrollo cuál de los dos paneles de "Facturación" es la fuente de verdad hoy — ambos existen y ambos responden con datos plausibles.
3. **La constante de modelo (`MODELO_CLAUDE`/`MODELO_GCIS`) se repite** en `workspace.routes.ts`, `casos.routes.ts` y `recetas.routes.ts` (mismo string, `claude-sonnet-4-6`, tres nombres de variable distintos). Menor que los dos anteriores — el precio en sí ya está unificado en `tarifas_modelo`, esto es solo el identificador del modelo — pero un cambio de versión del modelo requiere tocar 3 archivos en vez de uno.
