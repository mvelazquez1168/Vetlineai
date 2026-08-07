# Inventario 1 — Catálogo de endpoints

Relevado directamente del código en `backend/src/routes/` y `backend/src/index.ts` (todos los routers montados). Agrupado por archivo de rutas, en el orden en que se montan en `index.ts`.

**Cómo leer la columna "Rol/permiso":**
- `público` — sin `authenticate`, cualquiera puede pegarle.
- `sesión (cualquier rol)` — pasa por `authenticate` pero sin filtro de rol adicional.
- `médico` / `admin_clinica` / `médico o admin_clinica` — filtro explícito sobre `req.auth.rol`.
- `super_admin` / `soporte_senior` / `super_admin o soporte_senior` / `staff de plataforma` — roles de `staff_plataforma` (sin tenant).
- `firma de webhook` — público, pero el propio handler valida una firma/secreto antes de procesar.

**Columna "IA":** marca `SÍ` solo en los endpoints que efectivamente pueden disparar una llamada facturable a la API de Anthropic (pasan por `tarifas.ts` → `registrarUsoApi`/`verificarAntesDeGenerar`). Un endpoint puede "tocar IA" sin facturar (ej. subir un archivo a la Files API de Anthropic no pasa por `tarifas_modelo`) — esos casos se aclaran en la columna Notas.

---

## `backend/src/routes/webhooks.routes.ts` — montado en `/api/webhooks`, **antes** de `express.json()` global

| Método y ruta | Qué hace | Auth | Rol | IA | Notas |
|---|---|---|---|---|---|
| `POST /stripe` | Procesa `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated` del modelo viejo de facturación (Stripe). | firma de webhook | — | No | Verifica `stripe-signature` contra `STRIPE_WEBHOOK_SECRET`. Pertenece al modelo de facturación **anterior** (`tenants.estado_suscripcion`) — ver Inventario 2 sobre el estado de ese modelo. |
| `POST /pasarela` | Callback central del motor de cobros — el único punto por el que un cobro pasa a exitoso/fallido. | firma de webhook | — | No | Valida `x-pasarela-signature` contra `PAGOS_CALLBACK_SECRET` — **si esa env var no está configurada, acepta cualquier notificación sin validar autenticidad** (con log de advertencia). Persiste el evento entrante siempre, exista o no `order_number`. |
| `POST /resend` | Eventos de Resend (Svix) — hoy usado para detectar rebotes del correo de verificación del admin. | firma de webhook | — | No | Verifica firma Svix contra `RESEND_WEBHOOK_SECRET` — **si no está configurada, acepta el evento sin validar** (mismo criterio que `/pasarela`). Idempotente por `svix-id` (tabla `webhooks_resend_eventos`). Diseñado para servir a cualquier tipo de correo transaccional a futuro, no solo verificación. |

---

## `backend/src/routes/auth.routes.ts` — `/api/auth`

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /me` | Confirma la sesión y devuelve `req.auth` + datos básicos de la persona (o `null` si es staff de plataforma). | sesión | cualquier rol | No |

---

## `backend/src/routes/admin.routes.ts` — `/api/admin` (todo el router exige `admin_clinica`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /medicos` | Lista médicos de la clínica con sus especialidades/accesos. | sesión | admin_clinica | No |
| `GET /medicos/cupos` | Cupo de médicos consumido vs. contratado. | sesión | admin_clinica | No |
| `GET /medicos/invitaciones` | Invitaciones de médico pendientes. | sesión | admin_clinica | No |
| `POST /medicos/invitar` | Crea una invitación (token, envía correo). | sesión | admin_clinica | No |
| `POST /medicos/invitaciones/:id/reenviar` | Reenvía el correo de invitación. | sesión | admin_clinica | No |
| `POST /medicos/invitaciones/:id/cancelar` | Cancela una invitación pendiente. | sesión | admin_clinica | No |
| `PATCH /medicos/:id/estado` | Activa/desactiva un médico. | sesión | admin_clinica | No |
| `GET /medicos/:personaId/accesos` | Lista qué agentes tiene asignados un médico. | sesión | admin_clinica | No |
| `PUT /medicos/:personaId/accesos` | Asigna/desasigna agentes a un médico (`medico_agente`). | sesión | admin_clinica | No |
| `GET /agentes` | Catálogo de agentes habilitados para la clínica. | sesión | admin_clinica | No |
| `GET /estado-suscripcion` | Estado/plazo de la suscripción (para la barra de ventana de purga). | sesión | admin_clinica | No |
| `POST /exportaciones` | Genera un paquete zip exportable de los datos de la clínica. | sesión | admin_clinica | No |
| `GET /exportaciones` | Lista exportaciones generadas. | sesión | admin_clinica | No |
| `GET /exportaciones/:id/descargar` | Descarga un paquete ya generado. | sesión | admin_clinica | No |
| `GET /cupos` | Cupos de agentes/médicos contratados vs. usados. | sesión | admin_clinica | No |
| `PATCH /agentes/:agenteId/habilitar` | Habilita un agente contratado para la clínica. | sesión | admin_clinica | No |
| `PATCH /agentes/:agenteId/deshabilitar` | Deshabilita un agente. | sesión | admin_clinica | No |
| `DELETE /agentes/:agenteId` | Elimina el agente de `tenant_agentes`. | sesión | admin_clinica | No |
| `POST /agentes/:agenteId/solicitar-activacion` | — | sesión | admin_clinica | No | **Devuelve 410 siempre** — deprecado, reemplazado por cambio de plan. Endpoint dado de baja funcionalmente, no eliminado del código. |
| `GET /mi-correo` | Estado de verificación del propio correo (verificado/rebotado). | sesión | admin_clinica | No |
| `PUT /mi-correo` | Cambia el propio correo (DB + Keycloak) — solo sobre el propio `req.auth.userId`. | sesión | admin_clinica | No |
| `GET /clinica` | Datos generales de la clínica + plan. | sesión | admin_clinica | No |
| `GET /clinica/configuracion-notificaciones` | Config de avisos (días de desparasitación, etc.). | sesión | admin_clinica | No |
| `PATCH /clinica/configuracion-notificaciones` | Edita esa config. | sesión | admin_clinica | No |
| `GET /planes` | Catálogo de planes pagos disponibles. | sesión | admin_clinica | No |
| `GET /plan-consumo` | Vista agregada de plan + consumo del ciclo. | sesión | admin_clinica | No |
| `GET /cobros` | Historial de cobros de la clínica. | sesión | admin_clinica | No |
| `GET /clinica/datos-fiscales` | Datos fiscales para comprobantes. | sesión | admin_clinica | No |
| `PATCH /clinica/datos-fiscales` | Edita datos fiscales. | sesión | admin_clinica | No |
| `GET /tipos-identificacion` | Tipos de identificación válidos para el país de la clínica. | sesión | admin_clinica | No |
| `PATCH /clinica` | Edita nombre/ciudad/teléfono/email/dirección/zona horaria (no país). | sesión | admin_clinica | No |
| `POST /clinica/logo` | Sube el logo institucional. | sesión | admin_clinica | No |
| `GET /uso-facturacion` | Consumo del ciclo actual + estado de facturación. | sesión | admin_clinica | No |
| `PUT /plan` | Cambia de plan (upgrade/downgrade programado). | sesión | admin_clinica | No |
| `PUT /cancelar-suscripcion` | Solicita cancelación. | sesión | admin_clinica | No |
| `PUT /revertir-cancelacion` | Revierte una cancelación solicitada. | sesión | admin_clinica | No |
| `GET /cambio-pendiente` | Cambio de plan programado, si hay uno. | sesión | admin_clinica | No |
| `POST /downgrade` | Programa un downgrade a fin de período. | sesión | admin_clinica | No |
| `DELETE /cambio-pendiente/:cambioId` | Cancela un cambio programado. | sesión | admin_clinica | No |
| `PUT /limite-uso` | Configura el límite propio de gasto de IA. | sesión | admin_clinica | No |
| `GET /notificaciones/vigentes` | Notificaciones de uso vigentes (saldo bajo, etc.). | sesión | admin_clinica | No |
| `GET /notificaciones` | Historial de notificaciones de uso. | sesión | admin_clinica | No |
| `PATCH /notificaciones/marcar-todas-leidas` | — | sesión | admin_clinica | No |
| `PATCH /notificaciones/:id/leida` | — | sesión | admin_clinica | No |
| `GET /casos` | Lista paginada de casos de la clínica (vista admin, solo lectura). | sesión | admin_clinica | No |
| `GET /casos/:id` | Detalle de un caso (vista admin). | sesión | admin_clinica | No |
| `GET /casos/:id/medicos-disponibles` | Médicos a los que se puede reasignar un caso. | sesión | admin_clinica | No |
| `PUT /casos/:id/reasignar` | Reasigna un caso a otro médico. | sesión | admin_clinica | No |

---

## `backend/src/routes/platform.routes.ts` — `/api/platform` (staff: `super_admin`/`soporte_senior`/`soporte`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /overview` | Tarjetas agregadas del panel de plataforma. | sesión | staff de plataforma | No |
| `GET /clinicas` | Lista de clínicas (todas, cross-tenant). | sesión | staff de plataforma | No |
| `POST /clinicas` | Alta manual de clínica (uso de soporte). | sesión | staff de plataforma | No |
| `GET /agentes` | Catálogo global de agentes. | sesión | staff de plataforma | No |
| `POST /agentes` | Alta de un agente nuevo en el catálogo. | sesión | staff de plataforma | No |

Nota de arquitectura (del propio código): este router depende de que la conexión de la app sea *owner* de las tablas para ver filas de todos los tenants — no setea `app.tenant_id`. Si algún día el rol de conexión deja de ser owner, necesita un rol de Postgres con `BYPASSRLS` explícito.

---

## `backend/src/routes/platform-admin.routes.ts` — `/api/platform-admin` (staff: `super_admin` o `soporte_senior`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /documentos` | Lista documentos de la Base de Conocimiento. | sesión | super_admin/soporte_senior | No |
| `GET /documentos/:id/archivo` | Sirve el archivo (preview/descarga). | sesión | super_admin/soporte_senior | No |
| `POST /documentos` | Sube un documento nuevo (extrae texto). | sesión | super_admin/soporte_senior | No |
| `PATCH /documentos/:id/archivar` | Archiva un documento. | sesión | super_admin/soporte_senior | No |
| `PATCH /documentos/:id` | Edita metadata / reemplaza archivo. | sesión | super_admin/soporte_senior | No |
| `DELETE /documentos/:id` | Elimina un documento. | sesión | super_admin/soporte_senior | No |
| `GET /agentes` | Catálogo de agentes (vista plataforma). | sesión | super_admin/soporte_senior | No |
| `PATCH /agentes/:id` | Edita un agente del catálogo (incluye `system_prompt`). | sesión | super_admin/soporte_senior | No |
| `PATCH /legal/:tipo` | Publica una nueva versión de términos/privacidad. | sesión | super_admin/soporte_senior | No |
| `GET /auditoria` | Bitácora de auditoría global, paginada y filtrable. | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/uso-ia` | Consumo de IA agregado (vista facturación vieja). | sesión | super_admin/soporte_senior | No |
| `POST /facturas/manual` | Genera una factura manual (Stripe). | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/resumen-facturas` | — | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/facturas` | Listado de facturas (filtros estado/origen). | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/resumen-pagos` | — | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/pagos` | Listado de pagos. | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/resumen-cancelaciones` | — | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/cancelaciones` | Listado de cancelaciones. | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/resumen-nuevas-clinicas` | — | sesión | super_admin/soporte_senior | No |
| `GET /facturacion/nuevas-clinicas` | Altas recientes. | sesión | super_admin/soporte_senior | No |
| `POST /facturacion/ejecutar-job-excedente` | Dispara manualmente `procesarExcedentesDeUso`. | sesión | **super_admin únicamente** (chequeo interno adicional) | No | **Ejecuta código del modelo de facturación viejo** (`jobs/suscripciones.job.ts`, Stripe + `tenants.estado_suscripcion`) bajo demanda — la versión programada de ese mismo job está desactivada (ver Inventario 3), pero este botón la sigue disparando manualmente contra datos que el resto del sistema ya no usa como fuente de verdad. Ver Inventario 2. |

Todo este bloque de "Facturación" (`facturas`/`pagos`/`cancelaciones`/`nuevas-clinicas`/`uso-ia`) es la pantalla del **modelo de facturación anterior** — sigue montada y funcional, pero el modelo vigente para cobros es el de `backend/src/pagos/` (ver Inventario 2).

---

## `backend/src/routes/platformTarifas.routes.ts` — `/api/platform-admin` (super_admin únicamente)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /tarifas` | Tarifas por modelo/tipo de token, vigentes + históricas. | sesión | super_admin | No |
| `GET /tarifas/alertas` | Modelos sin tarifa vigente o con precio en cero. | sesión | super_admin | No |
| `POST /tarifas` | Cierra la vigente y crea una nueva (nunca `UPDATE`). | sesión | super_admin | No |
| `PATCH /tarifas/:modelo/facturable` | Marca un modelo como facturable o no. | sesión | super_admin | No |

## `backend/src/routes/platformParametros.routes.ts` — `/api/platform-admin` (super_admin únicamente)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /parametros` | Lista `parametros_plataforma`. | sesión | super_admin | No |
| `PUT /parametros/:clave` | Edita un parámetro (con validación de rango). | sesión | super_admin | No |
| `GET /parametros/consumo-pruebas` | Consumo agregado del mes de todas las cuentas en prueba vs. tope global. | sesión | super_admin | No |

## `backend/src/routes/platformPaises.routes.ts` — `/api/platform-admin` (super_admin únicamente)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /paises` | Directorio de países + impuesto vigente. | sesión | super_admin | No |
| `GET /paises/:codigo` | Detalle + checklist de habilitación. | sesión | super_admin | No |
| `PATCH /paises/:codigo` | Edita moneda/pasarela/proveedor de facturación. | sesión | super_admin | No |
| `POST /paises/:codigo/impuesto` | Cierra el vigente y crea uno nuevo. | sesión | super_admin | No |
| `GET /paises/:codigo/tipos-identificacion` | — | sesión | super_admin | No |
| `POST /paises/:codigo/tipos-identificacion` | Agrega un tipo de identificación. | sesión | super_admin | No |
| `PATCH /tipos-identificacion/:id` | Activa/desactiva o edita etiqueta. | sesión | super_admin | No |
| `PATCH /paises/:codigo/estado` | Cambia estado del país (valida checklist si pasa a `habilitado`). | sesión | super_admin | No |
| `GET /lista-espera` | Lista de espera de países no habilitados. | sesión | super_admin | No |

## `backend/src/routes/platformConsumoClinicas.routes.ts` — `/api/platform-admin` (super_admin únicamente)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /clinicas` | Listado de clínicas con saldo/consumo (filtros q/estado/plan). | sesión | super_admin | No |
| `GET /clinicas/resumen` | Tarjetas agregadas. | sesión | super_admin | No |
| `GET /clinicas/:tenantId` | Detalle: desglose de consumo + movimientos de crédito. | sesión | super_admin | No |
| `POST /clinicas/:tenantId/ajuste-saldo` | Ajuste manual de saldo (motivo obligatorio). | sesión | super_admin | No | Escribe crédito real — la operación más sensible de este router. |

## `backend/src/routes/platformCobros.routes.ts` — `/api/platform-admin/cobros` (super_admin únicamente)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /diagnostico` | Panel de salud del motor de cobros: 8 verificaciones de reconciliación en una sola llamada (cobros pendientes vencidos, recargas sin acreditar, suscripciones sin método de pago, métodos por vencer, suscripciones sin intento de cobro, cobros sin documento fiscal, recargas sin movimiento de crédito, países habilitados sin credenciales). | sesión | super_admin | No |

---

## `backend/src/routes/workspace.routes.ts` — `/api/workspace` (todo el router exige `medico`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /me` | Nombre del médico + nombre/logo de la clínica (saludo del selector). | sesión | médico | No |
| `GET /consumo` | Estado de suscripción + crédito + avisos vigentes. | sesión | médico | No |
| `GET /agentes` | Agentes asignados a este médico (`medico_agente`, habilitados). | sesión | médico | No |
| `GET /pacientes` | Lista de pacientes del tenant. | sesión | médico | No |
| `GET /casos` | Casos del médico para un agente puntual. | sesión | médico | No |
| `GET /casos/:id` | Detalle de un caso + historial de mensajes. | sesión | médico | No |
| `POST /casos` | Crea un caso (endpoint original, previo al wizard de `/api/casos`). | sesión | médico | No |
| `POST /casos/:id/informacion` | "Agregar información" — registra datos/adjuntos sin analizar (no llama al modelo). | sesión | médico | No |
| `POST /casos/:id/mensajes` | **"Analizar el caso"** — el chat clínico real. | sesión | médico | **Sí** | Rama real (Claude) vs. mock según si `agentes.system_prompt` está cargado (8 de 9 agentes hoy). Pasa por `verificarAntesDeGenerar`/`registrarUsoApi`. Bloqueado si la suscripción está en `ventana_purga`/`finalizada`. |

---

## `backend/src/routes/casos.routes.ts` — `/api/casos` (todo el router exige `medico`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `POST /` | Crea un caso desde el wizard "Nuevo caso" (valida `tenant_agentes` + `medico_agente`). | sesión | médico | No |
| `POST /:id/recetas` | Crea una receta en borrador para el caso. | sesión | médico | No |
| `POST /:id/dashboard/actualizar` | Genera/regenera el Dashboard clínico estructurado. | sesión | médico | **Sí** | Solo si el agente tiene `system_prompt` (si no, stub simulado para ICIS). Nunca se persiste el resultado salvo que `estado_generacion='generado'`. |
| `GET /:id/dashboard` | Lee el `dashboard_cache` persistido (nunca llama a Claude). | sesión | médico | No |
| `POST /:id/informe/generar` | Genera el Informe Clínico (CR-001) en `.docx`, descarga directa. | sesión | médico | **Sí** | Requiere logo de la clínica cargado. No se persiste el `.docx` en sí (sí se registra la fila en `informes_generados` — ver `GET /:id/informes`). |
| `GET /:id/informes` | Historial de informes ya generados del caso. | sesión | médico | No |

---

## `backend/src/routes/recetas.routes.ts` — `/api/recetas` (todo el router exige `medico`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /:id` | Detalle de una receta + items. | sesión | médico | No |
| `PUT /:id` | Edita una receta (solo si no está `emitida`). | sesión | médico | No |
| `POST /:id/validar` | Validación clínica de seguridad de la receta contra el caso. | sesión | médico | **Sí** | Advisoria únicamente — nunca bloquea la emisión. |
| `POST /:id/emitir` | Genera el PDF de la receta y la marca `emitida` (documento legal, ya no editable). | sesión | médico | No | Requiere logo de la clínica. |

---

## `backend/src/routes/informes.routes.ts` — `/api/informes` (exige `medico`)

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /:id/descargar` | Descarga un informe ya generado (lee bytea de la DB). | sesión | médico | No |

---

## `backend/src/routes/pagos.routes.ts` — `/api/pagos`

Router-level: solo `authenticate` (sin `withTenantClient`, sin filtro de rol) — cada ruta decide su propio gate.

| Método y ruta | Qué hace | Auth | Rol | IA |
|---|---|---|---|---|
| `GET /sdk-token` | Token corto para inicializar el SDK de Tilopay en el navegador. | sesión | **cualquier rol autenticado** (sin `soloAdminClinica`) | No | Único endpoint de este router sin el gate de admin_clinica — vale la pena confirmar si eso es intencional. |
| `GET /paquetes-recarga` | Catálogo de paquetes de recarga activos. | sesión | admin_clinica | No |
| `GET /metodos` | Método de pago vigente de la clínica. | sesión | admin_clinica | No |
| `POST /metodos` | Reemplaza el método de pago. | sesión | admin_clinica | No |
| `GET /config-recarga` | Config de autorecarga. | sesión | admin_clinica | No |
| `PUT /config-recarga` | Edita config de autorecarga. | sesión | admin_clinica | No |
| `GET /recargas` | Historial de recargas. | sesión | admin_clinica | No |
| `POST /recargas` | Ejecuta una recarga (cobro real vía pasarela, queda `pendiente` hasta el callback). | sesión | admin_clinica | No |
| `GET /upgrade/:planId/cotizacion` | Cotiza el prorrateo de un upgrade. | sesión | admin_clinica | No |
| `POST /upgrade` | Ejecuta un upgrade de plan (cobro inmediato). | sesión | admin_clinica | No |
| `POST /conversion-prueba` | Convierte una clínica en prueba a un plan pago. | sesión | admin_clinica | No |

Ninguna ruta de pagos llama a Anthropic — todas pasan por `obtenerProveedorPagos()` (simulado hoy, ver Inventario 2), nunca a Tilopay directo.

---

## Módulos de Agenda — todos exigen `medico` o `admin_clinica`, sin IA en ninguna ruta

### `backend/src/routes/salas.routes.ts` — `/api/salas`
`GET /`, `POST /`, `PUT /:id`, `PATCH /:id/desactivar`.

### `backend/src/routes/horarios.routes.ts` — `/api/horarios`
`GET /?medicoId=`, `PUT /` (upsert semanal; un médico solo puede editar su propio horario, admin_clinica puede editar cualquiera).

### `backend/src/routes/citas.routes.ts` — `/api/citas`
`GET /` (filtros desde/hasta/medico/estado), `POST /`, `PUT /:id`, `PATCH /:id/estado` (máquina de estados explícita), `DELETE /:id` (solo `programada`/`confirmada`). Exporta `crearCita()`, reusada por lista de espera.

### `backend/src/routes/listaEspera.routes.ts` — `/api/lista-espera`
`GET /`, `POST /`, `PUT /:id`, `PATCH /:id/estado`, `POST /:id/agendar` (reusa `crearCita()` de `citas.routes.ts`, no la duplica).

### `backend/src/routes/agenda.routes.ts` — `/api` (monta directo bajo `/api`, sin prefijo propio)
`GET /centro-comando?fecha=`, `GET /conflictos?fecha=`, `GET /analiticas?desde=&hasta=`.

---

## Módulos clínicos de soporte

| Router | Ruta base | Rol | IA |
|---|---|---|---|
| `propietarios.routes.ts` | `/api/propietarios` | médico o admin_clinica | No |
| `pacientes.routes.ts` | `/api/pacientes` | médico o admin_clinica | No |
| `medicamentos.routes.ts` | `/api/medicamentos` | médico | No |
| `razas.routes.ts` | `/api/razas` | médico | No |
| `farmacos.routes.ts` | `/api/farmacos-equivalencias` | sesión (cualquier rol) | No |
| `notificaciones.routes.ts` | `/api/notificaciones` | médico o admin_clinica | No |
| `reportes.routes.ts` | `/api/reportes` | sesión (cualquier rol) | No | Solo `GET /tipos` — catálogo estático, no toca DB. |
| `archivos.routes.ts` | `/api/archivos` | `POST /` exige médico explícito; `GET /:id` cualquier rol de sesión del tenant | No (ver nota) | `POST /` sube también a la Files API de Anthropic (`file_id_anthropic`) — no es una llamada facturable de `tarifas_modelo`, es solo storage para que el chat la referencie después. |

Detalle de `pacientes.routes.ts`: `POST /`, `GET /:id/historial-farmacologico`, `POST /:id/cuidados-preventivos`, `GET /:id/cuidados-preventivos`.
Detalle de `propietarios.routes.ts`: `GET /buscar?q=`, `POST /`, `GET /:id/pacientes`.
Detalle de `medicamentos.routes.ts`: `GET /?q=`, `POST /`, `PUT /:id`, `PATCH /:id/desactivar` (soft-delete).
Detalle de `notificaciones.routes.ts`: `GET /`, `GET /mias`, `PATCH /:id/marcar-leida`.

---

## Endpoints públicos sin sesión (marcados explícitamente, como pediste)

| Método y ruta | Archivo | Qué hace |
|---|---|---|
| `POST /api/webhooks/stripe` | `webhooks.routes.ts` | Firma de webhook, no sesión. |
| `POST /api/webhooks/pasarela` | `webhooks.routes.ts` | **El que ya conocías.** Firma compartida (opcional). |
| `POST /api/webhooks/resend` | `webhooks.routes.ts` | Firma Svix (opcional). |
| `GET /api/legal/:tipo` | `legal.routes.ts` | Términos/privacidad — se lee antes de loguearse. |
| `GET /api/paises` | `paises.routes.ts` | Catálogo de países + zonas horarias, para el wizard de registro. |
| `GET /api/paises/:codigo/tipos-identificacion` | `paises.routes.ts` | Ídem, para el registro. |
| `GET /api/planes` | `planes.routes.ts` | Catálogo de planes pagos, para elegir antes de registrarse. |
| `GET /api/registro-publico/agentes` | `registro.routes.ts` | Catálogo de agentes elegibles como agente único de la prueba. |
| `POST /api/registro-publico/lista-espera` | `registro.routes.ts` | Registro de interés cuando el país no está habilitado. |
| `POST /api/registro-publico` | `registro.routes.ts` | Alta de clínica nueva con prueba gratuita — el registro en sí. |
| `GET /api/invitaciones/:token` | `invitacionesPublicas.routes.ts` | Consulta de una invitación por su token. |
| `POST /api/invitaciones/:token/aceptar` | `invitacionesPublicas.routes.ts` | Alta del médico invitado. |
| `POST /api/verificar-correo/:token/confirmar` | `verificacionCorreoPublica.routes.ts` | Confirma la verificación de correo del admin. |
| `GET /api/health` | `index.ts` | Health check. |

`GET /uploads/logos/*` (montado en `index.ts` con `express.static`) también es público sin sesión — es el único directorio de `/uploads` servido así a propósito (logo de clínica, activo cosmético). Todo lo demás bajo `/uploads` (`casos/`, `conocimiento/`) se sirve exclusivamente vía endpoints autenticados (`GET /api/archivos/:id`, `GET /api/platform-admin/documentos/:id/archivo`) que validan pertenencia al tenant — nunca reabrir `express.static` sobre esas carpetas.

---

## Endpoints que ya no se usan / son de funcionalidad dada de baja

1. **`POST /api/admin/agentes/:agenteId/solicitar-activacion`** — devuelve `410` incondicionalmente. El código sigue montado, pero la funcionalidad (solicitar activación de un agente) fue reemplazada por cambio de plan. Candidato a eliminar del código, no solo dejarlo en 410.
2. **`POST /api/platform-admin/facturacion/ejecutar-job-excedente`** — sigue activo y funcional, pero dispara `procesarExcedentesDeUso()` de `jobs/suscripciones.job.ts`, el módulo de facturación **desactivado** (ver Inventario 2 e Inventario 3). Ejecutarlo hoy opera sobre `tenants.estado_suscripcion`/Stripe, que el resto del sistema ya no trata como fuente de verdad — riesgo real de divergencia si alguien lo usa pensando que es equivalente al ciclo de crédito vigente (`jobs/ciclo.job.ts`).
3. **Todo el bloque `/api/platform-admin/facturacion/*`** (facturas, pagos, cancelaciones, nuevas-clínicas, uso-ia) — funcional, pero es la pantalla del modelo de facturación anterior. El modelo vigente de cobros vive en `backend/src/pagos/` + `/api/platform-admin/cobros/diagnostico`. No hay redirección ni aviso en el código que indique cuál mirar.
