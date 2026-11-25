# Relevamiento — modelo compartido entre Vetline Ai y Vetline Clinic

Estado **actual** de Vetline Ai, relevado para diseñar Vetline Clinic (repo propio, misma base,
mismo Keycloak, misma instancia). Solo lectura: no se modificó código, migración ni dato alguno.

**Fuentes.** Código del repo (`backend/src/**`, `frontend/src/**`, `docker-compose.prod.yml`,
`Caddyfile`, `keycloak-realm/`), las 84 migraciones de `backend/src/migrations/`, y el **esquema
real de la base de desarrollo** (`docker exec postgres17 psql -U postgres -d vetplatform`,
71 tablas, solo consultas de lectura). Producción no se tocó.

**Los inventarios previos de `docs/` están desactualizados** y no deben usarse como fuente sin
verificar: `docs/inventario-modulos.md` y `docs/inventario-trabajos-programados.md` describen
`jobs/suscripciones.job.ts`, que **ya no existe** (hoy hay 6 jobs, ver §8), y
`docs/inventario-endpoints.md` no incluye endpoints posteriores
(`/admin/clinica/numeracion-expedientes`, `/admin/reporte-atenciones`, `/admin/casos/:id/cerrar`,
`/api/atenciones/*`, `/api/restablecer-contrasena`, los routers de saldo del proveedor de IA).
Todo lo que sigue se verificó contra el código y la base, no contra esos documentos.

---

## 0. Contradicciones con el contexto del prompt — leer primero

Cuatro supuestos del prompt no se sostienen tal cual contra el código:

1. **La agenda existe, pero no tiene reglas de disponibilidad.** Las citas sí existen y son
   completas (migración `017_agenda_citas.sql`, `routes/citas.routes.ts`, 6 pantallas). Lo que no
   existe es el uso de la configuración de horarios: `horarios_configuracion.bloques`,
   `buffer_minutos`, `duracion_default_minutos` y `acepta_emergencias` **se guardan y se editan,
   pero ningún camino de creación de cita los lee**. `max_citas_dia` solo se lee en el indicador de
   carga de `routes/agenda.routes.ts:130`, nunca para impedir nada. Crear una cita fuera del
   horario del médico, en su almuerzo o en un día inactivo funciona sin advertencia. Lo único que
   se verifica es el solapamiento contra otras citas (`buscarConflictos`), y **nunca bloquea**:
   devuelve los conflictos junto con la cita ya creada (`citas.routes.ts:108-175`). Detalle en §3.

2. **El "expediente" de Vetline Ai es del caso, no del paciente.** `casos.numero_expediente`
   (migración `047_expediente_y_propietario.sql`) es un consecutivo **por caso** dentro del tenant
   (`UNIQUE (tenant_id, numero_expediente)`), asignado por `expediente.ts::asignarNumeroExpediente`.
   No hay número de expediente por paciente, ni ninguna entidad que represente el expediente
   longitudinal. Detalle en §9.

3. **La ficha del paciente no existe como pantalla ni como endpoint.** No hay `GET /api/pacientes/:id`,
   no hay `PATCH /api/pacientes/:id`, y no hay ninguna ruta de frontend bajo `/paciente`
   (verificado en `frontend/src/App.tsx`: la palabra "paciente" no aparece en ninguna ruta).
   Peor: **`pacientes.sexo` y `pacientes.edad_anios` se leen en 6 lugares pero no los escribe
   ningún endpoint** — solo `backend/src/seed/seed.ts:237`. Detalle en §9.

4. **Hoy nadie crea médicos "desde el expediente clínico", y tampoco los creará Vetline Clinic sin
   tocar Keycloak.** El alta de un médico es un flujo de invitación por correo con token
   (`invitaciones.ts`) que crea **las dos mitades** (fila en `personas` + usuario en Keycloak) en
   un solo acto. No existe `POST /api/admin/medicos`. Si Vetline Clinic va a dar de alta médicos,
   necesita el mismo cliente de servicio de Keycloak, no solo la base. Detalle en §2.

Un quinto punto que sí se sostiene: **pacientes, propietarios y citas son tablas con `tenant_id`
directo y sin lógica de dominio en la base**, así que un segundo escritor puede crearlos — con las
salvedades de §5 y §11.

---

## 1. Entidades maestras

Esquema verificado contra la base real (`\d <tabla>`), no contra las migraciones (que solo dicen
cómo se llegó hasta acá).

### 1.1 `tenants` — la clínica

Creada en `001_init.sql`. 45 columnas hoy. Clave: `id uuid PK`, `nombre`, `pais_codigo char(2) FK
paises(codigo_iso)`, `zona_horaria varchar NOT NULL DEFAULT 'America/Costa_Rica'`,
`suscripcion_id uuid FK suscripciones(id)`, `expediente_ultimo_numero integer NOT NULL DEFAULT 0`,
`logo_url`, `email`, `telefono`, `direccion`.

CHECKs vivos: `tenants_estado_suscripcion_check`
(`pendiente_pago|prueba|activa|morosa|suspendida|ventana_purga|cancelada|finalizada`),
`tenants_tipo_persona_check` (`fisica|juridica`), `tenants_limite_accion_check`,
`tenants_ventana_purga_origen_check` (`prueba_no_convertida|cuenta_no_operativa|impago`).

**29 tablas tienen FK a `tenants`.** Casi todas con `ON DELETE CASCADE`; las cuatro que no
(`uso_api`, `notificaciones_uso`, `eventos_facturacion`, `documentos_fiscales`) se borran a mano en
`purga.ts:684-687`. Esto importa para Vetline Clinic: ver §11.

Historial de modificaciones: `002` (pais_codigo, drop `pais`), `003` (zona_horaria),
`004` (estado_suscripcion, cancelación), `005` (plan_id, columnas `stripe_*`, trial_termina_en),
`010` (limite_usd_configurado, limite_accion), `012`, `022` (CHECK), `024` (suscripcion_id, datos
fiscales, columnas `purga_*`), `029` (medico_invitado_email, credito_prueba_otorgado_en),
`036`, `039`, `047` (expediente_ultimo_numero), `051` (ventana_purga_origen).

**Deuda visible en el esquema:** conviven dos modelos de suscripción. `tenants.estado_suscripcion`,
`tenants.plan_id` y las 5 columnas `stripe_*` son el modelo **anterior**; el vigente es
`suscripciones` + `saldos_ia`. `registro.routes.ts:222-230` fija `estado_suscripcion='prueba'` a
mano precisamente porque el DEFAULT de la tabla (`'trial'`) ya no pasa el CHECK. Vetline Clinic no
debería leer `tenants.estado_suscripcion` como fuente de verdad.

### 1.2 `personas` — médicos y administradores de clínica (una sola tabla)

Creada en `001_init.sql`. No hay tablas separadas de "staff" y "médico": **la misma fila es ambas
cosas, con dos booleanos independientes**: `es_admin_clinica boolean NOT NULL DEFAULT false`
(migración 001) y `es_medico boolean NOT NULL DEFAULT true` (migración `024`). Una persona puede
ser las dos a la vez, y es el caso normal en una clínica chica — está documentado en
`middleware/auth.ts:19-25` como corrección de una auditoría de 2026-08-06.

Columnas clave: `tenant_id FK tenants ON DELETE CASCADE`, `email varchar(200) UNIQUE`
(**único global, no por tenant**), `password_hash NOT NULL` (ya no autentica nada, ver §4),
`keycloak_user_id varchar UNIQUE` (**nullable** — migración `011`), `colegiatura`,
`estado activo|inactivo`, `correo_verificado_en`/`correo_rebotado_en`/`token_verificacion_correo`
(migración `039`), `universidad_egreso`/`anio_graduacion` (`029`),
`destinatario_informe_preferido colega|tutor` (`084`).

Restricciones notables:
- `colegiatura_medico_obligatoria`: `CHECK (es_medico = false OR colegiatura IS NOT NULL AND
  colegiatura <> '')` — **`NOT VALID`**: se aplica a filas nuevas, no a las preexistentes
  (migración `031`).
- `colegiatura_admin_unica`: índice único parcial sobre `colegiatura WHERE es_admin_clinica = true
  AND colegiatura IS NOT NULL` — regla anti-farming del crédito de prueba.
- `personas_keycloak_user_id_key UNIQUE`.

### 1.3 `staff_plataforma` — equipo interno (sin tenant)

`001_init.sql`. `rol super_admin|soporte_senior|soporte` (el tercero agregado en `002`),
`keycloak_user_id UNIQUE` (`011`), `password_hash NOT NULL` que no se usa nunca.
**Sin `tenant_id` y sin RLS**. No hay endpoint que inserte filas acá: se crea con
`npm run crear-admin-plataforma` (`backend/src/crearAdminPlataforma.ts`).

### 1.4 `medico_agente` y `tenant_agentes` — las dos capas de habilitación

- `tenant_agentes` (`001`, modificada en `024`): qué agentes **contrató** la clínica.
  `UNIQUE (tenant_id, agente_id)`, `estado habilitado|deshabilitado` (el valor
  `solicitud_pendiente` se eliminó en `024`), `habilitado_en`, `deshabilitado_en`,
  `periodo_ultimo_cambio` (freno anti-rotación).
- `medico_agente` (`001`, `habilitado boolean` agregado en `002`): qué agentes puede **usar** un
  médico puntual. `UNIQUE (persona_id, agente_id)`. **Sin `tenant_id` propio**: su RLS hereda el
  tenant vía `EXISTS` contra `personas`. Punto único de gestión: `backend/src/medicoAgente.ts`.

### 1.5 `propietarios` — los clientes

`001_init.sql`, ampliada en `047`. `tenant_id`, `nombre NOT NULL`, `telefono`, `email`, `direccion`,
`tipo_identificacion_id FK tipos_identificacion`, `numero_identificacion varchar(60)`.

Dos restricciones reales en la base:
- `propietarios_identificacion_ambos_o_ninguno`: `CHECK ((tipo_identificacion_id IS NULL) =
  (numero_identificacion IS NULL))`.
- `propietarios_identificacion_unica`: `UNIQUE (tenant_id, tipo_identificacion_id,
  numero_identificacion)`.

**No hay restricción de formato de correo en la base** — eso vive solo en el backend (§11).

### 1.6 `pacientes` — las mascotas

`001_init.sql`; `raza_id` en `009`; `fecha_nacimiento`, `estado`, `fecha_fallecimiento` en `057`.
`tenant_id`, `propietario_id FK propietarios ON DELETE CASCADE NOT NULL`, `nombre`, `especie
varchar(50) NOT NULL`, `raza varchar(100)` (texto libre, legado), `raza_id FK razas`,
`sexo varchar(20)`, `edad_anios numeric(4,1)`, `fecha_nacimiento date`,
`estado activo|fallecido` (CHECK), `fecha_fallecimiento date`.

Particularidades que condicionan el diseño nuevo:
- **Dos representaciones de edad**: `fecha_nacimiento` y `edad_anios`. La regla de que nunca
  conviven vive en código (`backend/src/edadPaciente.ts::calcularEdadEfectiva`), no en la base.
- **Dos representaciones de raza**: `raza` (texto) y `raza_id` (FK). Las especies se escriben
  distinto en cada tabla: `pacientes.especie` guarda `"Canino"`/`"Felino"` y `razas.especie`
  guarda `'canina'`/`'felina'`; el único mapeo entre ambas está en
  `routes/pacientes.routes.ts:21-24` (`ESPECIE_PACIENTE_A_RAZA`).
- **`fecha_fallecimiento` no tiene CHECK contra `estado`**: la coherencia la impone el endpoint.

### 1.7 `citas` — la agenda

Creada en `017_agenda_citas.sql`. `tenant_id`, `sala_id FK salas` (nullable), `paciente_id NOT NULL`,
`medico_id FK personas NOT NULL`, `fecha date`, `hora_inicio`/`hora_fin time`, `duracion_minutos`,
`prioridad baja|normal|alta|emergencia`, `motivo_consulta`, `estado` (7 valores, ver §3),
`motivo_cancelacion`, **`caso_id uuid FK casos(id)` — sin CASCADE**, `creado_en`, `actualizado_en`.

Índices: `idx_citas_tenant_fecha`, `idx_citas_medico_fecha`, `idx_citas_sala_fecha`,
`idx_citas_paciente`, `idx_citas_caso WHERE caso_id IS NOT NULL` (migración `058`).

**`propietario_id` no se guarda a propósito** — se deriva por JOIN vía `pacientes.propietario_id`
(nota de diseño en la migración 017). Mismo criterio que `casos`.

**No hay concepto de sede/sucursal.** La migración 017 lo dice explícitamente: el mockup original
tenía pestañas "Clínica Centro / Oeste" pero no existe tabla `clinicas`/`sedes` — un `tenant_id`
**es** una única clínica. `salas` es solo una sala de examen dentro de esa clínica. Multi-sede real
sería un cambio de modelo deliberado.

### 1.8 `cuidados_preventivos` — vacunación y desparasitación

Creada en `019_notificaciones.sql`. `tenant_id`, `paciente_id ON DELETE CASCADE`,
`tipo desparasitacion|vacunacion` (el segundo agregado en `055`), `fecha_aplicacion`,
`fecha_proxima_recomendada` (ambas `NOT NULL`), `registrado_por FK personas NOT NULL`,
`vacuna`/`lote` (`055`), `subtipo_desparasitacion interna|externa` + `producto_desparasitacion`
(`057`), `atencion_id FK atenciones` (`069`).
Tabla hija `cuidado_preventivo_enfermedades` → `enfermedades_vacuna` (catálogo de plataforma,
sin tenant).

La obligatoriedad condicional (`vacuna` requerida si `tipo='vacunacion'`,
`subtipo_desparasitacion` requerido si `tipo='desparasitacion'`) **no está en la base**: está en
`routes/pacientes.routes.ts:276-287`.

### 1.9 `casos` — el episodio diagnóstico

`001_init.sql` + 6 migraciones. `tenant_id`, `paciente_id ON DELETE CASCADE`, `agente_id FK agentes`,
`medico_id FK personas`, `medico_agente_id` (`008`), `motivo TEXT NOT NULL`,
`estado triage|en_curso|completado`, `severidad` (5 valores),
`dashboard_cache jsonb` + `dashboard_generado_en` (`015`),
`numero_expediente integer NOT NULL` con `UNIQUE (tenant_id, numero_expediente)` (`047`),
cierre: `diagnostico_final`, `tratamiento_activo`, `tratamiento_activo_detalle`,
`desenlace resuelto|derivado|en_control|fallecido`, `cerrado_por`, `cerrado_en` (`067`),
reapertura: `motivo_reapertura`, `reabierto_por`, `reabierto_en` (`068`),
síntesis: `sintesis jsonb`, `sintesis_huella`, `sintesis_generada_en`,
`sintesis_estado nucleo|completa` (`079`, `080`), con `casos_sintesis_completa_check` que exige que
las cuatro vayan juntas o ninguna.

**Relación con paciente:** `casos.paciente_id` directo, `ON DELETE CASCADE`.
**Relación con cita:** inversa — `citas.caso_id`, no `casos.cita_id`. Una cita apunta como máximo a
un caso; un caso puede tener varias citas. El vínculo se escribe en tres lugares:
`POST /api/casos` (`casos.routes.ts:183-190`), `PATCH /api/citas/:id/caso`
(`citas.routes.ts`, rechaza con 409 si ya hay vínculo) y `PATCH /api/citas/:id/estado` vía
`COALESCE`. **Es siempre opcional y nunca bloqueante.**

### 1.10 `atenciones` — el registro de la visita (puente agenda ↔ clínica)

Creada en `069_registro_atencion.sql`. `tenant_id`, `cita_id FK citas **UNIQUE**` (una atención por
cita), `paciente_id`, `medico_id`, `nota_medica text`, `peso numeric`, `temperatura numeric`.
Referenciada por `cuidados_preventivos.atencion_id` y `recetas.atencion_id`.

Es la pieza más cercana a "la visita" del modelo que describe el prompt, y la que Vetline Clinic
probablemente quiera extender. **Es también la única tabla tenant-scoped con RLS habilitado pero
no forzado** (ver §5).

### 1.11 Catálogos sin `tenant_id` (compartidos entre ambos repos)

`agentes`, `razas`, `razas_alias_documento`, `paises`, `tipos_identificacion`, `impuestos_pais`,
`planes`, `paquetes_recarga`, `tarifas_modelo`, `parametros_plataforma`, `enfermedades_vacuna`,
`farmacos_equivalencias`, `documentos_conocimiento`, `documentos_legales`, `staff_plataforma`,
`schema_migrations`, y 12 más — 28 tablas en total sin RLS (lista completa en §5).

`medicamentos` es un caso mixto: **`tenant_id` es nullable** — `NULL` significa catálogo de
plataforma (migración `071_catalogo_farmacos_plataforma.sql`), un valor significa medicamento
propio de la clínica. Es la única tabla con 4 políticas RLS separadas por comando en vez de una
`FOR ALL`.

---

## 2. Quién crea cada entidad hoy

### 2.1 Propietarios — `routes/propietarios.routes.ts` (`/api/propietarios`)

Gate: `authenticate` + `withTenantClient` + `esMedico || esAdminClinica` (ampliado a admin para la
agenda, línea 35-41).

| Endpoint | Qué hace |
|---|---|
| `GET /tipos-identificacion` | Catálogo filtrado por el país **de la propia clínica** (nunca por parámetro) |
| `GET /buscar-por-identificacion` | Búsqueda exacta por la llave única, para ofrecer "usar este propietario" |
| `GET /buscar?q=` | Typeahead, máximo 10 |
| `GET /?q=&pagina=` | Listado paginado (20/página) — pantalla "Propietarios" |
| `POST /` | Alta |
| `GET /:id` | Ficha |
| `PATCH /:id` | Edita nombre/teléfono/correo/dirección |
| `GET /:id/pacientes` | Mascotas del propietario |

**No hay DELETE.** La identificación (tipo + número) es **inmutable por diseño**: `PATCH` la ignora
en silencio si viene en el body (comentario en la línea 258-263).

Pantalla: `frontend/src/pages/admin/Propietarios.tsx` + `components/caso/FichaPropietarioModal.tsx`.

### 2.2 Pacientes — `routes/pacientes.routes.ts` (`/api/pacientes`)

Mismo gate. **Solo cinco endpoints, y ninguno es una ficha editable:**

| Endpoint | Qué hace |
|---|---|
| `POST /` | Alta: `propietarioId`, `nombre`, `especie`, `razaId?`, `fechaNacimiento?` |
| `PATCH /:id/estado` | Único camino para marcar `fallecido` (exige fecha; **no hay vuelta atrás**) |
| `GET /:id/historial-farmacologico` | Recetas emitidas del paciente, cruzando todos los agentes |
| `GET /:id/atenciones-sin-caso` | Atenciones cuya cita no tiene caso, para vincular |
| `POST`/`GET /:id/cuidados-preventivos` | Vacunación y desparasitación |

Listado de pacientes: `GET /api/workspace/pacientes` (`workspace.routes.ts`), **solo rol médico**.

Segundo escritor de `pacientes.estado` dentro del propio backend: `cierreCaso.ts:129`, cuando se
cierra un caso con desenlace `fallecido`.

### 2.3 Médicos — invitación, no alta directa

**No existe `POST /api/admin/medicos`.** El alta pasa por `backend/src/invitaciones.ts` +
`invitaciones_medico` (migración `030`, `038`):

1. `POST /api/admin/medicos/invitar` (admin_clinica) → `crearInvitacion()`: valida cupo
   (los pendientes reservan cupo, `contarInvitacionesPendientes`), genera token, manda el correo
   `invitacion_medico`.
2. El médico abre `/invitacion/:token` (`frontend/src/pages/InvitacionMedico.tsx`) →
   `GET /api/invitaciones/:token` → `POST /api/invitaciones/:token/aceptar` con nombre,
   **colegiatura (obligatoria)** y contraseña.
3. `aceptarInvitacion()` (`invitaciones.ts:216-269`) hace todo en una transacción:
   `INSERT INTO personas (es_admin_clinica=false, es_medico=true)` → `crearUsuarioKeycloak(rol:
   "VETERINARIO")` → `UPDATE personas SET keycloak_user_id` → marca la invitación aceptada →
   `otorgarCreditoPruebaSiCorresponde()`.
4. Auto-login con `obtenerTokenParaUsuario()` (password grant del lado del backend).

Operaciones restantes: `PATCH /api/admin/medicos/:id/estado` (activo/inactivo),
`PUT /api/admin/medicos/:personaId/accesos` (`medico_agente`), reenviar y cancelar invitación.
Pantalla: `frontend/src/pages/admin/Medicos.tsx`.

**Hallazgo:** `PATCH /medicos/:id/estado` pone `personas.estado='inactivo'` pero **no deshabilita el
usuario en Keycloak**, y `resolverPrincipal` (`middleware/auth.ts:170-193`) **no filtra por
`estado`**. Un médico "inactivo" sigue autenticándose y pasando `authenticate`. Lo que sí lo frena
son los gates puntuales que listan médicos activos.

El alta del administrador de clínica es otra cosa: `POST /api/registro-publico`
(`routes/registro.routes.ts`), público, sin sesión.

### 2.4 Citas — `routes/citas.routes.ts`

`POST /api/citas` y `POST /api/lista-espera/:id/agendar`, que **reusa la misma función exportada**
`crearCita()` (`citas.routes.ts:122-186`) en vez de duplicarla. Edición con `PUT /:id`, estado con
`PATCH /:id/estado`, vínculo a caso con `PATCH /:id/caso`, borrado duro con `DELETE /:id`
(solo `programada`/`confirmada`).

Pantallas: `frontend/src/pages/agenda/Calendario.tsx`, `NuevaCitaModal.tsx`, `CitaDetallePanel.tsx`,
`CentroComando.tsx`, `ListaEspera.tsx`.

### 2.5 El alta de usuarios en Keycloak — las dos mitades

Todo pasa por `backend/src/keycloakAdmin.ts`, único módulo que habla con la Admin API, autenticado
con `client_credentials` del client confidencial `vetplatform-backend-service`
(rol `manage-users` de `realm-management`). `fetch` con `AbortSignal.timeout(15_000)`.

**Mitad A — Keycloak.** `crearUsuarioKeycloak()` hace tres llamadas: `POST /users`
(`username = email`, `emailVerified`, atributo `tenant_id`) → `PUT /users/{id}/reset-password`
(`temporary: false`) → `POST /users/{id}/role-mappings/realm` con `VETERINARIO`, `ADMIN` o
`SUPER_ADMIN`. **Si falla la contraseña o el rol, borra el usuario recién creado** antes de
propagar el error. Devuelve el `id` leído del header `Location`.

**Mitad B — la base.** Una fila en `personas` (clínica) o `staff_plataforma` (plataforma), con
`keycloak_user_id` = ese `id`.

**El vínculo** es `keycloak_user_id` contra el claim `sub` del token. Lo resuelve
`middleware/auth.ts::resolverPrincipal`, que además **cruza `personas.tenant_id` contra el claim
`tenant_id`** del token y rechaza si difieren (línea 180).

**Qué pasa si solo se crea una mitad:**

| Situación | Consecuencia real |
|---|---|
| Usuario en Keycloak, sin fila en la base | El login contra Keycloak funciona y el token es válido, pero `resolverPrincipal` devuelve `null` y **todo request da 401** con `"Usuario autenticado en Keycloak pero no registrado en Vetline Ai — contactá a soporte."`. Además `useAuth.tsx::establecerSesionKeycloak` llama a `/auth/me` antes de dar la sesión por buena, así que el error aparece en el login, no después. |
| Fila en la base, sin usuario en Keycloak (`keycloak_user_id IS NULL`) | **No puede iniciar sesión de ninguna forma** — no hay credencial. La fila es invisible para `resolverPrincipal`. `personas.keycloak_user_id` es nullable, así que la base permite este estado: en la base de desarrollo hay **1 de 23 personas** así. |
| Usuario en Keycloak sin el rol de realm | El frontend lo rechaza **antes** de llamar al backend: `mapearRol()` devuelve `null` y `useAuth.tsx:138` tira `"Tu usuario no tiene un rol reconocido en Vetline Ai."` |
| Usuario en Keycloak sin el atributo `tenant_id` | `resolverPrincipal` cae a la rama de `staff_plataforma`; si tampoco está ahí, 401. |

Las compensaciones existentes son asimétricas y Vetline Clinic debe conocerlas:
- `registro.routes.ts` crea **Keycloak primero, fuera de la transacción** (genera el `tenantId` con
  `crypto.randomUUID()` para poder invertir el orden) y si el `INSERT` falla, llama a
  `eliminarUsuarioKeycloak()` (línea 339).
- `invitaciones.ts::aceptarInvitacion` hace lo **contrario**: la llamada a Keycloak ocurre **dentro
  de la transacción** (línea 244). Si el `COMMIT` falla después, queda un usuario huérfano en
  Keycloak; y mientras Keycloak responde, la conexión queda `idle in transaction`.
- **La purga de una clínica (`purga.ts::ejecutarPurgas`) nunca borra los usuarios de Keycloak.**
  No hay ninguna mención a Keycloak en `purga.ts`. Cada clínica purgada deja sus usuarios vivos en
  el realm.

---

## 3. Agenda

### 3.1 Modelo

Cuatro tablas, todas creadas en `017_agenda_citas.sql`, todas con `tenant_id` directo y RLS:
`salas`, `horarios_configuracion`, `citas`, `lista_espera`.

`horarios_configuracion`: un row por `(medico_id, dia_semana)` con `UNIQUE`, `dia_semana SMALLINT
CHECK BETWEEN 0 AND 6` (0 = domingo, convención de `EXTRACT(DOW)` y `Date.getDay()`),
`bloques jsonb` (franjas `disponible`/`almuerzo`/`bloqueado`), `activo`, `max_citas_dia`,
`duracion_default_minutos DEFAULT 30`, `buffer_minutos DEFAULT 0`, `acepta_emergencias DEFAULT true`.

`lista_espera`: `paciente_id`, `medico_preferido_id`, `motivo`, `prioridad baja|media|alta`,
`estado pendiente|agendada|cancelada`, `cita_id` (se completa al agendar).

### 3.2 Máquina de estados

Declarada una sola vez y **exportada** en `citas.routes.ts:38-46` como `TRANSICIONES_VALIDAS`;
`atencion.ts:2` la importa en vez de repetirla.

```
programada  → confirmada, cancelada, no_show, completada
confirmada  → registrada,  cancelada, no_show, completada
registrada  → en_consulta, cancelada, completada
en_consulta → completada,  cancelada
completada  → (terminal)
cancelada   → (terminal)
no_show     → (terminal)
```

El mismo juego de 7 valores está como `CHECK` en `citas.estado`. Las transiciones **solo** se
validan en `PATCH /:id/estado`; `PUT /:id` no toca el estado y `atencion.ts:89` consulta la misma
tabla antes de forzar `completada`.

### 3.3 Reglas de disponibilidad — lo que realmente hay

**Lo único que se evalúa al crear o editar una cita es el solapamiento** (`buscarConflictos`,
`citas.routes.ts:56-99`): mismo día, estado distinto de `cancelada`/`no_show`, mismo médico **o**
misma sala, rangos que se cruzan. **Nunca bloquea** — `POST` y `PUT` devuelven
`{ cita, conflictos }` con la cita ya creada/modificada.

Lo que **no** se verifica en ningún lado:
- que la hora caiga dentro de un bloque `disponible` de `horarios_configuracion.bloques`;
- que el día esté `activo`;
- `buffer_minutos` entre citas;
- `max_citas_dia` como tope (solo se muestra como porcentaje de carga);
- `acepta_emergencias` frente a `prioridad='emergencia'`;
- `duracion_default_minutos` (el cliente manda siempre `duracionMinutos`);
- que el médico pertenezca al tenant o esté activo;
- que la sala esté `activa`.

Verificado por búsqueda exhaustiva: `horarios_configuracion` solo aparece en
`routes/horarios.routes.ts` (lectura y upsert) y en `routes/agenda.routes.ts:130`
(`SELECT max_citas_dia`, para el indicador de carga del Centro de Comando, con un
`CAPACIDAD_MAXIMA_DEFAULT = 20` hardcodeado cuando no hay configuración).

Hallazgo adicional: `calcularCargaTrabajo` (`agenda.routes.ts:118`) selecciona médicos con
`es_admin_clinica = false`, así que **una persona que es admin y médico a la vez no aparece en el
indicador de carga** — es la misma confusión rol-excluyente que ya se corrigió en `auth.ts`.

### 3.4 Pantallas

Seis, todas bajo `AgendaLayout` (`frontend/src/pages/agenda/`), accesibles para `medico` **y**
`admin_clinica` (`App.tsx:148`):

| Pantalla | Archivo |
|---|---|
| Calendario | `Calendario.tsx` (485 líneas) + `NuevaCitaModal.tsx` + `CitaDetallePanel.tsx` |
| Centro de Comando | `CentroComando.tsx` — `GET /api/centro-comando?fecha=` |
| Lista de Espera | `ListaEspera.tsx` |
| Configuración de Horarios | `ConfiguracionHorarios.tsx` |
| Analíticas | `Analiticas.tsx` — `GET /api/analiticas?desde=&hasta=` |
| Notificaciones | `Notificaciones.tsx` |

**Móvil: no hay aplicación nativa.** Búsqueda en todo el repo: no existe directorio
`android`/`ios`/`mobile`/`expo`. Lo que hay es una **PWA instalable** (`vite.config.ts`,
`vite-plugin-pwa`, `registerType: "prompt"`, manifest `display: standalone`), con la API en
`NetworkOnly` por decisión de privacidad explícita (nunca se cachean datos clínicos). La
adaptación móvil es responsive a secas: `useMenuColapsable` + `BotonMenuMovil` +
`BackdropMenuMovil` para los paneles con menú lateral. Su cobertura es desigual —
`Calendario.tsx` usa 4 breakpoints, `CentroComando.tsx` 2, y `pages/admin/Propietarios.tsx`
**ninguno** (depende del `overflow-x-auto` de `Table`).

### 3.5 Avisos que dispara la agenda

Diez tipos de aviso con toggle por clínica en `configuracion_notificaciones`. Los que nacen de la
agenda:

| Aviso | Disparador | Toggle |
|---|---|---|
| `confirmacion_cita` | `crearCita()` — al agendar, en el momento | `confirmacion_cita_activo` |
| `cita_cancelada_o_reprogramada` | 3 puntos: `PATCH /estado → cancelada`, `PUT` con fecha u hora distinta, y `DELETE` (antes de borrar) | `cancelacion_cita_activo` |
| `recordatorio_cita` | `jobs/notificaciones.job.ts`, diario 06:00, citas `programada`/`confirmada` dentro de ~26 h | `recordatorio_cita_activo` + `horas_aviso_recordatorio_cita` |
| `agenda_dia_siguiente` | job diario, al médico | `agenda_dia_siguiente_activo` |
| `seguimiento_faltante` | job diario: casos `empeorando`/`crítico` sin cita futura | `seguimiento_faltante_activo` |

Dos reglas transversales que un segundo escritor debe replicar:
- **Un paciente `fallecido` no recibe ningún aviso** — chequeado en cada emisor
  (`citas.routes.ts:160`, `:214`).
- El recordatorio de cita se desduplica con un **índice único parcial en base**
  (`idx_notificaciones_recordatorio_unico ON notificaciones (cita_id) WHERE tipo='recordatorio_cita'
  AND cita_id IS NOT NULL`); el resto de los avisos usan ventanas de tiempo en código.

`DELETE /citas/:id` hace `UPDATE notificaciones SET cita_id = NULL` antes de borrar, porque
`notificaciones.cita_id` **no tiene CASCADE** a propósito.

---

## 4. Keycloak

### 4.1 Realm y clientes

Realm `Vetplatform`. Fuente versionada: `keycloak-realm/Vetplatform-realm-produccion.json`
(derivado por `generar-realm-produccion.js` del export real de dev, que **no** se versiona).

Flags del realm: `registrationAllowed: false`, `editUsernameAllowed: true`, `verifyEmail: false`,
`smtpServer: {}` (la verificación de correo se hace con Resend, no con el SMTP de Keycloak —
`backend/keycloak/CONFIGURACION_MANUAL.md`).

9 clients; los tres que importan:

| Client | Tipo | Flujos | Para qué |
|---|---|---|---|
| `vetplatform-web` | público | standardFlow + **directAccessGrants** | Login real del navegador (password grant, sin redirect — `frontend/src/lib/keycloakAuth.ts`). Redirect URIs y Web Origins = `https://app.vetlineai.com` |
| `vetplatform-backend-service` | confidencial | **serviceAccounts** | Admin API: crear/borrar usuarios, contraseñas, emails, roles. Rol `manage-users` de `realm-management` — **no tiene `view-clients`/`manage-clients`** |
| `vetplatform-api` | público | standardFlow | Presente en el realm, **sin uso encontrado en el código** |

### 4.2 Roles y el claim `tenant_id`

Roles de realm de negocio: **`SUPER_ADMIN`, `ADMIN`, `VETERINARIO`**. Hay un cuarto, `CLIENTE`,
definido en el realm y **sin uso en ningún lado del código**.

El `tenant_id` llega al token por un client scope dedicado:

- Atributo de perfil de usuario `tenant_id` (`displayName: "ID de Veterinaria"`,
  `permissions.edit: ["admin"]`, `view: []`) en
  `components["org.keycloak.userprofile.UserProfileProvider"]`.
- Client scope **`tenant-info`**, con un mapper `oidc-usermodel-attribute-mapper`:
  `user.attribute: tenant_id` → `claim.name: tenant_id`, en access token, ID token, userinfo e
  introspection.
- `tenant-info` está en los **default client scopes** de `vetplatform-web` y en los default del
  realm, así que viaja en todo token sin pedirlo.

### 4.3 Cómo se mapean a permisos — backend

`middleware/auth.ts`:
1. `verificarFirma()` — RS256 contra el JWKS, con **dos issuers aceptados** (`ISSUERS_ACEPTADOS`):
   el público (`KEYCLOAK_ISSUER`) y el alias interno de Docker derivado de `KEYCLOAK_JWKS_HOST`.
   Keycloak estampa `iss` según el host por el que entró la request, y el backend pide tokens por
   el alias interno (auto-login del registro).
2. `resolverPrincipal()` — **los roles del token se extraen y se descartan**: la línea 167 es
   literalmente `void rolesToken; // extraídos según lo pedido; sin gating adicional en esta fase.`
   La autorización sale **de la base**: `personas.es_admin_clinica`, `personas.es_medico`,
   `staff_plataforma.rol`. El `tenant_id` del token solo se usa para elegir rama y como doble
   verificación contra `personas.tenant_id`.
3. Resultado: `req.auth = { userId, tenantId, rol, esAdminClinica, esMedico, zonaHoraria }`.
   `rol` es **solo la pantalla de aterrizaje** (admin tiene prioridad); todo gate de "es médico"
   debe usar `esMedico`.
4. Si `suscripciones.estado = 'bloqueada'`, lanza `ClinicaBloqueadaError` → 403 con
   `code: "CLINICA_BLOQUEADA"`. Es la única transición que corta el acceso en la autenticación
   misma.

Patrón de gate por router, repetido ~8 veces textualmente:

```ts
router.use(authenticate, withTenantClient);
router.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});
```

### 4.4 Cómo se mapean a permisos — frontend

`frontend/src/hooks/useAuth.tsx` es la única puerta a la sesión. A diferencia del backend, **sí usa
los roles del token**: `mapearRol(realm_access.roles)` traduce `SUPER_ADMIN → super_admin`,
`ADMIN → admin_clinica`, `VETERINARIO → medico`, y un token sin ninguno de los tres se rechaza en
el login. Después llama a `GET /auth/me` y **reemplaza el objeto con el que devuelve el backend**
(que incluye `zonaHoraria` y los booleanos reales).

`misRoles(user)` devuelve **todos** los roles de la sesión (no solo `rol`), y
`routes/ProtectedRoute.tsx` gatea contra esa lista. Tres zonas: `/workspace` (`medico`), `/admin`
(`admin_clinica`), `/agenda` (ambos), `/platform-admin` (los tres roles de staff).

### 4.5 Defecto abierto que afecta a un segundo servicio

**D-002** (`DEFECTOS_ABIERTOS.md:227`): la URL del JWKS se arma con `issuerUrl.protocol` + el host
interno, de modo que en producción queda `https://keycloak:8080/...` mientras Keycloak escucha en
texto plano dentro de la red (Caddy termina el TLS). Se desbloqueó **quitando
`KEYCLOAK_JWKS_HOST` del compose de producción** — confirmado: no aparece en
`docker-compose.prod.yml`. Hoy el JWKS se resuelve por el host público, lo que ata la validación de
tokens a que Caddy y el DNS respondan. **Vetline Clinic va a chocar con lo mismo si copia el
armado de la URL del JWKS.**

---

## 5. Multi-tenant

### 5.1 Los dos pools (`backend/src/db.ts`)

| Pool | Rol de Postgres | RLS | Para qué |
|---|---|---|---|
| `pool` | `postgres` (**owner de las 71 tablas**, superusuario, BYPASSRLS) | **No aplica** | Jobs de fondo, registro público, invitaciones, auditoría, `resolverPrincipal` |
| `tenantPool` | `vetplatform_app` (sin atributos, no owner) | **Sí, real** | Todo request autenticado de clínica |

Ambos con `connectionTimeoutMillis: 2_000` y `idle_in_transaction_session_timeout: 600_000`
(10 minutos, migración `081`/`082`; el comentario explica que baja a medida que las rutas que
llaman al modelo migren al patrón de transacción corta).

`vetplatform_app` tiene `SELECT, INSERT, UPDATE, DELETE` sobre todas las tablas, concedido por
default privileges (`ALTER DEFAULT PRIVILEGES ... GRANT ... TO vetplatform_app`) — es decir,
**una tabla nueva creada por `postgres` le queda accesible automáticamente, con o sin RLS**.

### 5.2 `withTenantClient` (`middleware/auth.ts:290-397`)

Por request autenticado de clínica: `tenantPool.connect()` → `BEGIN` →
`SELECT set_config('app.tenant_id', $1, true)` (local a la transacción) → `req.db = client`.
Para staff de plataforma (`tenantId === null`) usa el pool admin **sin** `set_config`, a propósito:
esas rutas consultan cross-tenant y dependen 100% de sus propios `WHERE`.

El cierre es cuidadoso y vale la pena copiarlo: `release(commit)` hace `COMMIT`/`ROLLBACK` y, si
falla, llama a `client.release(err)` para que el pool **destruya** la conexión en vez de reciclar
una sucia (hay una nota verificada contra la base de que `release()` pelado deja la sesión en
`idle in transaction` y el siguiente que la tome hereda la transacción).

`req.cerrarTransaccion()` confirma antes de una llamada externa larga y **reemplaza `req.db` por un
`Proxy` que lanza** si alguien lo usa después. Para escribir luego está
`backend/src/alcanceTenant.ts::conAlcanceTenant(tenantId, fn)`, que abre su propia transacción
corta contra `tenantPool` con el mismo `set_config`.

### 5.3 RLS — estado real de las 71 tablas

| Grupo | Cantidad | Tablas |
|---|---|---|
| RLS **forzado** + 1 política `FOR ALL` | 36 | `tenants`, `personas`, `propietarios`, `pacientes`, `casos`, `citas`, `cuidados_preventivos`, `salas`, `horarios_configuracion`, `lista_espera`, `mensajes`, `archivos`, `recetas`, `receta_items`, `notificaciones`, `suscripciones`, `saldos_ia`, `cobros`, … |
| RLS forzado + 4 políticas por comando | 1 | `medicamentos` (`tenant_id` nullable = catálogo de plataforma) |
| RLS **habilitado pero NO forzado**, con política | 5 | **`atenciones`**, `correos_enviados`, `cuidado_preventivo_enfermedades`, `medicamento_dosis_especie`, `razas_sin_coincidencia_log` |
| RLS habilitado **sin ninguna política** (bloqueo total salvo para el owner) | 2 | `clinica_eventos_ciclo_vida`, `clinicas_purgadas_auditoria` — a propósito (migración `045`) |
| Sin RLS (catálogos globales y tablas de plataforma) | 28 | `agentes`, `razas`, `paises`, `planes`, `tarifas_modelo`, `parametros_plataforma`, `staff_plataforma`, `tipos_identificacion`, `enfermedades_vacuna`, `documentos_conocimiento`, `restablecimientos_contrasena`, `schema_migrations`, … |

Forma de la política estándar:
`USING (tenant_id::text = current_setting('app.tenant_id', true))`.
Las tablas sin `tenant_id` propio heredan por `EXISTS` contra el padre
(`medico_agente` → `personas`; `mensajes`, `archivos`, `derivaciones` → `casos`).

**Las políticas `FOR ALL` no declaran `WITH CHECK`** (verificado en `pg_policies`). En Postgres eso
significa que la expresión de `USING` se aplica también a los `INSERT`, así que `vetplatform_app`
**no puede insertar una fila con el `tenant_id` de otro**. Es correcto, pero depende de que nadie
agregue una política `FOR INSERT` sin `WITH CHECK`.

El aislamiento se verificó con una prueba directa contra la base (bypaseando la app) en una sesión
previa: **funciona**. Hay además un job diario de auditoría, `jobs/auditoriaRls.job.ts`
(09:00 + una corrida al arrancar), que reporta cualquier tabla de `public` con columna `tenant_id`
y `relrowsecurity = false`.

### 5.4 Lo que tendría que respetar Vetline Clinic

1. **Conectarse con `vetplatform_app`, no con el owner**, para todo request de usuario. Si conecta
   como `postgres`, RLS no se aplica en ninguna de las 36 tablas forzadas y mucho menos en las 5 no
   forzadas.
2. **Abrir `app.tenant_id` por transacción con `set_config(..., true)`**, nunca a nivel de sesión:
   una conexión devuelta al pool con el tenant anterior puesto es exactamente la fuga que RLS
   existe para impedir (`alcanceTenant.ts:21-24`).
3. **Resolver el tenant desde la base, no desde el token.** Es la decisión explícita de
   `resolverPrincipal`, y es la que sostiene el fail-closed.
4. **Toda tabla nueva con `tenant_id` necesita `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL
   SECURITY` y su política.** `auditoriaRls.job.ts` solo detecta la falta de `ENABLE`: **no mira
   `relforcerowsecurity` ni exige que exista política**, así que una tabla nueva en el estado de
   `atenciones` pasa la auditoría sin ruido.
5. **Toda tabla nueva con FK a `tenants` necesita `ON DELETE CASCADE`**, o hay que agregarla a mano
   a `purga.ts:684-700`. Sin eso, la purga de una clínica falla con violación de FK y hace
   `ROLLBACK` — ya pasó con `notificaciones_callback`, está documentado en el propio archivo.
6. **El rol `vetplatform_app` no es owner**: no puede crear tablas ni correr migraciones. Las
   migraciones de Vetline Clinic van con la conexión owner (`DATABASE_URL`).
7. Si Vetline Clinic necesita vistas cross-tenant (reportes de plataforma), hoy el patrón es usar
   el pool owner y filtrar a mano — `platform.routes.ts` lo documenta y advierte que si el rol de
   conexión dejara de ser owner, haría falta un rol con `BYPASSRLS` explícito.

---

## 6. Habilitación por tenant

### 6.1 El mecanismo que existe: `tenant_agentes`

Es el único mecanismo de capacidad por clínica. Tres piezas acopladas:

1. **`tenant_agentes`** — la fila existe o no, y tiene `estado habilitado|deshabilitado`. Es el
   *entitlement* de la clínica.
2. **`suscripciones.agentes_contratados` + `agentes_extra`** — el **cupo**: cuántos puede tener
   habilitados a la vez. Lo administra `backend/src/cupos.ts` (`habilitarAgente`,
   `deshabilitarAgente`, conteo contra el cupo, y un freno anti-rotación vía
   `periodo_ultimo_cambio` + el parámetro `agentes.cambios_por_ciclo`).
3. **`medico_agente`** — la segunda capa: qué agentes puede usar cada médico dentro de los que la
   clínica tiene habilitados (`backend/src/medicoAgente.ts`).

Cómo se usa como gate, en su forma canónica (`casos.routes.ts:141-157`):

```ts
const ta = await req.db!.query(
  `SELECT estado FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2`, [...]);
if (ta.rows[0]?.estado !== "habilitado")
  return res.status(403).json({ error: "Este agente no está habilitado para tu clínica." });

const ma = await req.db!.query(
  `SELECT id FROM medico_agente WHERE persona_id = $1 AND agente_id = $2 AND habilitado = true`, [...]);
if (ma.rows.length === 0)
  return res.status(403).json({ error: "No tenés acceso a este agente." });
```

Pantallas: `frontend/src/pages/admin/Agentes.tsx` (la clínica habilita/deshabilita dentro de su
cupo) y `pages/admin/Medicos.tsx` (asigna agentes a cada médico).

### 6.2 ¿Sirve como patrón para habilitar los módulos de gestión?

**El patrón sí; la tabla no.** `tenant_agentes` modela "esta clínica contrató el agente X del
catálogo `agentes`", y está amarrada a tres cosas que un módulo de gestión no tiene: una fila en
`agentes` (con `slug`, `system_prompt`, `especialidad`, `estado_catalogo`, y los 3 estados de
`agentes.estado`), un cupo numérico en `suscripciones`, y el motor de crédito de IA.
Reusar la tabla obligaría a inventar filas falsas en `agentes` para "Inventario" o "Caja".

Lo que sí es reusable, tal cual:
- la **forma**: tabla puente `tenant_<capacidad>` con `UNIQUE (tenant_id, <capacidad>)` + `estado`
  + marcas de tiempo + RLS forzada;
- el **doble gate** entitlement de la clínica / permiso de la persona;
- el **gate explícito en el handler**, que devuelve 403 con un mensaje propio — no hay middleware
  genérico de feature flags en el que colgarse.

Lo que **no** existe hoy y habría que decidir:
- No hay tabla de *features* ni columna de flags en `tenants`.
- `parametros_plataforma` (21 claves, ver abajo) es **global, no por tenant** — no sirve para
  habilitar algo en una clínica y no en otra.
- `planes` existe, pero `planes` no describe módulos: describe precio, crédito y cupos.
- No hay nada en el token de Keycloak que transporte capacidades: `tenant-info` solo lleva
  `tenant_id`.

Claves reales de `parametros_plataforma` (consultadas en la base): `agentes.cambios_por_ciclo`,
`cierre.periodos_suspendida`, `cierre.plazo_dias`, `cierre.recordatorio_dias_antes`,
`cobro.aviso_vencimiento_dias`, `cobro.plazo_pendiente_horas`, `cobro.reintentos_dias`,
`cuenta.aviso_dias_no_operativa`, `cuenta.dias_limite_no_operativa`, `purga.plazo_dias`,
`purga.recordatorio_dias_antes`, `recarga.minimo_usd`, `saldo.colchon_gracia_usd`,
`saldo.umbral_aviso_usd`, `saldo_proveedor.correo_destino`, `saldo_proveedor.umbral_usd`,
`trial.aviso_dias_antes`, `trial.credito_usd`, `trial.duracion_dias`, `trial.medicos_incluidos`,
`trial.tope_global_mensual_usd`.

---

## 7. Resend y notificaciones

### 7.1 Dónde vive la configuración

`backend/src/config.ts` lee `RESEND_API_KEY` (opcional), `RESEND_FROM_EMAIL`
(default `VetlineAI <onboarding@resend.dev>`) y `RESEND_WEBHOOK_SECRET` (opcional). En producción
las tres llegan por `.env.prod` → `docker-compose.prod.yml`.
**Sin `RESEND_API_KEY` el backend arranca igual**: los correos quedan registrados como no enviados.
El dominio `vetlineai.com` está verificado en Resend.

### 7.2 Punto único de envío

Tres capas, en este orden:

1. **`backend/src/email.ts::enviarEmail()`** — el único lugar que llama al SDK de Resend. Devuelve
   el `id` del mensaje. Hace **todo el saneo de cabeceras acá adentro, no en los llamadores**
   (decisión explícita, comentada en las líneas 28-41: los valores vienen de 27 plantillas y una
   decena de módulos, y "sanear en cada origen deja la puerta abierta al próximo llamador"):
   - `direccionValida()` — regex estricta; el destinatario se **rechaza**, no se limpia;
   - `nombreParaCabecera()` — quita CRLF, caracteres de control, comillas, barras y **ángulos**
     (corrección de un bug real de inyección de cabecera por el nombre de la clínica), tope 78;
   - `asuntoParaCabecera()` — quita CRLF y control, tope 200;
   - `componerRemitente()` — **conserva siempre la dirección verificada** y solo reemplaza el
     nombre visible, porque la dirección firma DKIM.
2. **`backend/src/correos.ts::enviarCorreoTransaccional()`** — las 27 plantillas (`TipoCorreo`) con
   su `DatosPlantilla` tipada, y el registro de **cada intento** (éxito o falla) en
   `correos_enviados`. Devuelve `{ correoEnviadoId, resultado }` con
   `enviado | fallido | no_configurado`. **No lanza** ante un fallo del proveedor.
3. **`backend/src/notificaciones.ts::emitirNotificacion()`** — punto único de emisión para los
   avisos clínicos: inserta en `notificaciones` y dispara el envío, dejando
   `notificaciones.correo_enviado_id` como referencia (no una copia del texto).
   `avisoActivo(db, tenantId, columna)` lee el toggle con `COALESCE(..., true)`.

### 7.3 Marca del comercio

`backend/src/marcaCorreo.ts` decide quién firma cada correo. `TIPOS_MARCA_COMERCIO` es un
`ReadonlySet` de **10 de los 27 tipos**, y es la única fuente de esa decisión — un tipo nuevo sale
con marca de plataforma por defecto y hay que agregarlo ahí a propósito:

```
recordatorio_cita, confirmacion_cita, cita_cancelada_o_reprogramada, vacunacion_proxima,
desparasitacion_proxima, seguimiento_posterior_consulta, informe_disponible, cumpleanos,
seguimiento_faltante, agenda_dia_siguiente
```

Los 8 primeros van al tutor (`propietarios`); los 2 últimos van a un médico de la clínica pero su
contenido es 100% de la clínica. Los otros 17 (cobros, suspensión, verificación, invitación,
restablecimiento, saldo del proveedor…) salen con marca Vetline Ai.

`MarcaCorreo` = `{ nombre, logoUrl, logoTamano: {width,height}, replyTo, esComercio }`. Detalles:
el logo de la clínica se sirve desde el bucket público con clave `logos/<uuid>.<ext>`; el tamaño se
calcula escalando dentro de una caja (`lib/imagenLogo.ts`) porque **Outlook ignora `max-width` y
respeta `width`/`height`**; `replyTo` es `tenants.email` validado con la **misma**
`direccionValida()` del envío; el logo de plataforma sale de `frontend/public/brand`
(`logo-horizontal-claro@2x.png`, 194×100, PNG y no SVG porque varios clientes no rasterizan SVG).
Layout único y claro para las 27 plantillas.

### 7.4 Registro y webhook

- `correos_enviados`: `tenant_id` (nullable), `destinatario`, `tipo varchar(40)` **sin CHECK**,
  `resultado enviado|fallido` (CHECK), `error`, `proveedor_message_id`, `rebotado_en`.
  RLS habilitado **no forzado**.
- `notificaciones`: `tipo varchar(30)` **con CHECK de exactamente 10 valores** — un aviso nuevo
  exige migración. También `canal` con `CHECK (canal = 'correo')`: el canal está previsto pero no
  hay un segundo valor permitido.
- `POST /api/webhooks/resend` — firma Svix contra `RESEND_WEBHOOK_SECRET`; **si la variable no está
  configurada acepta cualquier evento** (con log de advertencia). Idempotente por `svix-id`
  (`webhooks_resend_eventos`). Hoy se usa para rebotes del correo de verificación del admin,
  correlacionados por `proveedor_message_id`.

**Para Vetline Clinic:** si comparte la configuración de Resend, comparte la **reputación del
dominio**. Las piezas a reusar (no reimplementar) son `enviarEmail` con su saneo, la clasificación
de `TIPOS_MARCA_COMERCIO` y el layout. Un tipo de notificación nuevo requiere ampliar el CHECK de
`notificaciones.tipo`.

---

## 8. Despliegue

### 8.1 Composición de producción (`docker-compose.prod.yml`)

Cuatro servicios en una red `interna`:

| Servicio | Imagen | Puertos al host | Límites |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | **80, 443 — el único expuesto** | 128m / 64m |
| `backend` | `${ECR_REGISTRY}/vetplatform-backend:${IMAGE_TAG}` | — | 768m / 384m |
| `frontend` | `${ECR_REGISTRY}/vetplatform-frontend:${IMAGE_TAG}` | — | 128m / 64m |
| `keycloak` | `quay.io/keycloak/keycloak:26.3` | — | 1200m / 768m (`-Xmx640m`) |

Imágenes en ECR (`344872152822.dkr.ecr.us-east-1.amazonaws.com`), tag por `IMAGE_TAG`
(default `95726cf`). **La base de datos de la aplicación no está en el compose** — es administrada
(RDS), igual que en dev. Keycloak sí corre en el compose, con su **propia base** (`KC_DB_URL`).

### 8.2 Caddy

```
{$APP_DOMAIN} {
  handle /api/*     { reverse_proxy backend:4000 }
  handle /uploads/* { reverse_proxy backend:4000 }
  handle            { reverse_proxy frontend:80 }
}
{$KEYCLOAK_DOMAIN} { reverse_proxy keycloak:8080 }
```

TLS automático (Let's Encrypt) con `email {$TLS_EMAIL}`, volúmenes `caddy_data`/`caddy_config`.
**Un dominio por servicio, y el ruteo del dominio de la app es por prefijo de path.**

### 8.3 Imágenes

- `backend/Dockerfile.prod`: multi-stage (`npm ci` → `npm run build` con `tsconfig.build.json`, que
  **excluye `src/scripts/`** → imagen final `--omit=dev`), usuario `node`, `HEALTHCHECK` sobre
  `GET /api/health` con `--timeout 5s`, `CMD` en forma exec para recibir `SIGTERM`. Descarga el
  bundle de CAs de RDS a `/etc/vetplatform/rds-global-bundle.pem`.
- `frontend/Dockerfile.prod`: `vite build` → nginx. **Las `VITE_*` no se compilan en el bundle**:
  `docker-entrypoint.sh` genera `env-config.js` en cada arranque con `envsubst`, y
  `src/lib/runtimeEnv.ts` lee `window.__ENV__` antes de `import.meta.env`. Una imagen sirve para
  cualquier ambiente. `nginx.conf`: gzip, `immutable` 1 año solo para `/assets/*`, `no-cache`
  explícito en `sw.js`/`env-config.js`/`index.html`.

### 8.4 Variables de entorno

Plantilla en `.env.prod.example`; `.env.prod` está cubierto por `.gitignore`.
Obligatorias al arrancar el backend (`requireEnv`, tira el proceso): `DATABASE_URL`,
`TENANT_DATABASE_URL`, `JWT_SECRET`, `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`,
`KEYCLOAK_ADMIN_URL`, `KEYCLOAK_SERVICE_CLIENT_ID`, `KEYCLOAK_SERVICE_CLIENT_SECRET`.
Opcionales con degradación explicada: `ANTHROPIC_API_KEY`, `RESEND_*`, `PAGOS_CALLBACK_SECRET`,
`PASARELA_<ISO>_*` (validadas al final del arranque con `console.error`, sin tumbar el proceso).
Producción agrega `ALMACENAMIENTO_PROVEEDOR=s3` + 7 `S3_*`, y del lado de Keycloak `KC_DB_*`.
**`KEYCLOAK_JWKS_HOST` no está en producción** (ver D-002, §4.5).

Cadenas de conexión con TLS verificado:
`?uselibpqcompat=true&sslmode=verify-full&sslrootcert=/etc/vetplatform/rds-global-bundle.pem`.

### 8.5 Migraciones y sembrado

`backend/src/migrate.ts` lleva su propia tabla **`schema_migrations`** (`filename` PK +
`applied_at`), la crea si no existe y aplica solo lo pendiente. Rechaza de entrada cualquier
migración que traiga meta-comandos de psql (como `\echo`), señalando el archivo exacto.

| Comando | Qué corre |
|---|---|
| `npm run migrate` | `ts-node src/migrate.ts` (dev) |
| `npm run migrate:prod` | `node dist/migrate.js` (`ts-node` no está en la imagen) |
| `npm run seed` | Datos de ejemplo de desarrollo |
| `npm run seed:plataforma:prod` | `node dist/seed/seedPlataforma.js` — tarifas, agentes, documentos, alias de raza |
| `npm run crear-admin-plataforma[:prod]` | Primer `super_admin` (Keycloak + `staff_plataforma`, vinculados, idempotente por email) |

Cuidado conocido: **cualquier base ya migrada por otra vía necesita un backfill de
`schema_migrations`** antes del primer `migrate`, o el ejecutor reintenta desde `001` y choca con
`relation "tenants" already exists`.

### 8.6 Trabajos programados — **6, no 4**

`backend/src/index.ts:141-148`. `jobs/suscripciones.job.ts` **fue eliminado**; los inventarios
previos están desactualizados.

| Hora | Job | Qué hace |
|---|---|---|
| 05:00 | `ciclo.job.ts` | Motor de crédito + pipeline de prueba/purga |
| 06:00 | `notificaciones.job.ts` | Recordatorio de cita, vacunación/desparasitación próximas, seguimiento faltante, agenda del día siguiente, cumpleaños |
| 07:00 | `cicloCobro.job.ts` | Ciclo de cobro recurrente y reintentos |
| 09:00 (+ al arrancar) | `auditoriaRls.job.ts` | Tablas con `tenant_id` y RLS deshabilitado |
| — | `tarjetaPorVencer.job.ts` | Aviso de tarjeta por vencer |
| — | `saldoProveedorIa.job.ts` | Aviso de saldo bajo del proveedor de IA |

### 8.7 Qué haría falta para que Vetline Clinic conviva en la misma instancia

Lo que es puramente mecánico:
- **Caddy**: agregar un `handle` nuevo bajo el mismo `{$APP_DOMAIN}` (p. ej. `/clinic-api/*` →
  `clinic-backend:4000`) o un tercer bloque de dominio. Caddy saca el certificado solo.
- **Compose**: dos servicios más (`clinic-backend`, `clinic-frontend`) en la misma red `interna`,
  con sus propias imágenes de ECR y su propio `IMAGE_TAG`.
- **Memoria**: hoy los cuatro servicios suman ~2,2 GB de `mem_limit`. Hay que dimensionar la
  instancia antes de sumar dos más.
- **Keycloak**: ningún client nuevo es estrictamente necesario si Vetline Clinic se sirve desde el
  mismo origen (`vetplatform-web` ya tiene ese Redirect URI y Web Origin). Si va en otro dominio,
  hay que agregar sus URIs — **y eso no se puede automatizar con la service account actual**: tiene
  solo `manage-users`, no `manage-clients` (un intento previo falló con HTTP 403).
  El secreto de `vetplatform-backend-service` tendría que compartirse con el segundo backend, o
  crearse un segundo client de servicio.

Lo que exige una decisión, no solo configuración:
- **Las migraciones.** Hay una sola tabla `schema_migrations` con `filename` como PK y un solo
  directorio de migraciones. Dos repos escribiendo ahí van a colisionar en la numeración
  (`085_...`) salvo que se separe por prefijo (`clinic_001_...`) o por tabla aparte. **No hay
  ningún mecanismo previsto para esto hoy.**
- **`CORS_ORIGIN` y `FRONTEND_URL`** son valores únicos por proceso. `CORS_ORIGIN` admite un solo
  origen (`index.ts:55`). Si los dos frontends comparten dominio no hay problema; si no, el backend
  de Vetline Ai necesita aceptar dos orígenes.
- **Los 6 jobs** corren dentro del proceso del backend. Un segundo backend con sus propios jobs
  contra la misma base necesita su propia disciplina de idempotencia — y hay que evitar levantar
  dos réplicas del mismo backend, porque ningún job tiene lock distribuido.

---

## 9. Ficha del paciente y expediente

### 9.1 Lo que existe

**Datos.** `pacientes` tiene las columnas (§1.6) y todas las tablas que cuelgan del paciente están:
`casos`, `citas`, `cuidados_preventivos`, `recetas`, `atenciones`, `notificaciones`,
`lista_espera`.

**Consultas longitudinales, dos y solo dos**, ambas en `routes/pacientes.routes.ts`, ambas sin IA y
sin filtrar por médico (el historial es del paciente, no del médico):
- `GET /api/pacientes/:id/historial-farmacologico` — recetas **emitidas** con sus items, marcando
  `fue_validada` y `con_visita`, más un conteo de medicamentos repetidos. Se muestra en una pestaña
  dentro del área de trabajo del caso.
- `GET /api/pacientes/:id/atenciones-sin-caso` — atenciones cuya cita no tiene caso, para
  vincularlas (`components/caso/VincularAtencionModal.tsx`).

**El número de expediente** (`casos.numero_expediente`, migración `047`) es un consecutivo **por
caso** y por tenant, con `UNIQUE (tenant_id, numero_expediente)`, asignado atómicamente por
`expediente.ts::asignarNumeroExpediente` (un `UPDATE ... RETURNING` sobre `tenants`, que toma lock
de fila; si la transacción del caso hace `ROLLBACK`, el número no se consume). La clínica puede
configurar el número de inicio con `PATCH /api/admin/clinica/numeracion-expedientes` →
`configurarInicioExpediente()`, que **solo avanza, nunca retrocede**, y deja el evento en la
bitácora de auditoría en vez de en una columna.

**La "visita"** existe como `atenciones` (migración `069`), con `UNIQUE (cita_id)`, nota médica,
peso y temperatura, y `cuidados_preventivos`/`recetas` colgando de ella. La escribe
`components/caso/RegistroAtencionModal.tsx` (676 líneas) vía `/api/atenciones` (**solo médicos**).

**La cronología** más parecida a un expediente es `components/caso/CronologiaModal.tsx` — y es
**del caso**, no del paciente.

### 9.2 Lo que no existe

- **No hay `GET /api/pacientes/:id`.** No se puede traer la ficha de un paciente.
- **No hay edición de paciente.** El único `UPDATE pacientes` en todo el backend es
  `estado='fallecido'` (dos caminos: `pacientes.routes.ts:113` y `cierreCaso.ts:129`). Nombre,
  especie, raza, sexo y fecha de nacimiento **son inmutables desde la aplicación**: un error de
  carga solo se corrige en la base.
- **`pacientes.sexo` y `pacientes.edad_anios` no los escribe ningún endpoint.** Se leen en
  `contextoCaso.ts:36` (el bloque que se le inyecta al agente), `recetas.routes.ts:424` (el PDF de
  la receta), `casos.routes.ts:1289`/`:1542` y `admin.routes.ts:1880`, pero el único `INSERT` que
  los completa está en `seed/seed.ts:237`. **En producción esos dos campos están siempre vacíos**,
  y el contexto que recibe el agente sale sin sexo.
- **No hay pantalla de paciente.** Ninguna ruta de `frontend/src/App.tsx` menciona "paciente", y no
  hay archivo `Paciente*.tsx`. El paciente solo se ve como fila dentro de un wizard
  (`GET /api/workspace/pacientes`, solo médicos), como dato del caso, o como columna de una cita.
  Hay pantalla de **propietarios** (`pages/admin/Propietarios.tsx` + `FichaPropietarioModal.tsx`),
  pero no su equivalente para mascotas.
- **La exportación de datos de la clínica no exporta el paciente.** `purga.ts:518-584` arma el zip
  recorriendo **casos**: `datos_caso.json`, mensajes, archivos adjuntos e informes `.docx`. No hay
  un `pacientes.json`, `propietarios.json` ni `citas.json`.
- **No hay peso ni temperatura a nivel de paciente**: viven en `atenciones`, una por cita. No hay
  curva de peso ni ninguna serie temporal de signos.

### 9.3 Lo que quedó solo diseñado

En `docs/` hay mockups y manuales (`Vetline_Ai_Manual_de_Usuario.docx`,
`Vetline_Ai_Manual_Tecnico.docx`, `pendientes.docx`, `pendientes 2.docx`) que no se abrieron en este
relevamiento. De las notas internas del repo y de los comentarios de código surge que la "pantalla
de perfil real del paciente" estuvo en los diseños del módulo Calendario y **nunca se implementó**
— pero **no se pudo verificar contra el archivo de diseño original**, así que queda marcado como
**no encontrado**: no hay en el repo ningún artefacto de diseño versionado (ni Figma exportado, ni
spec) que describa la ficha del paciente. Donde se buscó: `docs/`, `docs/prompts/`,
`operational manuals/`, y los `.md` sueltos de la raíz.

---

## 10. Sistema de diseño y patrones de UX

**No hay paquete de diseño, ni monorepo, ni Storybook.** No existe `package.json` en la raíz del
repo (verificado) y por lo tanto no hay npm workspaces. El frontend es un único paquete
`vetplatform-frontend` con **5 dependencias de producción**: `react`, `react-dom`,
`react-router-dom`, `react-markdown`, `remark-gfm`. **Nada de librerías de UI, de iconos, de
formularios, de toasts, de fechas ni de estado.** Todo lo visual es Tailwind + componentes propios.

### 10.1 Tokens (`frontend/tailwind.config.js`)

Es la fuente única y completa del lenguaje visual. No hay variables CSS: `src/index.css` son
7 líneas (las 3 directivas de Tailwind + `height: 100%`).

```js
colors: {
  primary:        "#1B2A4A",  // azul marino — sidebar, títulos, botón principal, overlay de modal
  secondary:      "#3A4E7A",  // hover del botón principal
  accent:         "#4A90D9",  // azul de foco, enlaces, barras de progreso
  background:     "#FAF7F2",  // crema — fondo de la app y de los inputs
  surface:        "#FFFFFF",  // tarjetas, tablas, modales, header de agenda
  "text-primary": "#121E36",
  "text-muted":   "#5A6B82",
  success:        "#7BA68C",
  warning:        "#E8B45C",
  error:          "#E8725C",
  info:           "#4A90D9",  // = accent
},
fontFamily: {
  display: ["'Instrument Serif'", "serif"],
  sans:    ["Inter", "system-ui", "sans-serif"],
}
```

Las dos tipografías se cargan desde **Google Fonts por `<link>` en `index.html`**
(`Instrument+Serif:ital@0;1` + `Inter:wght@400;500;600;700`), con `preconnect` y cacheadas por el
service worker (`StaleWhileRevalidate` para la hoja, `CacheFirst` 1 año para los woff2).
No hay fuentes self-hosted. **`font-display` (Instrument Serif) está declarada en el tema pero su
uso real en pantallas no se relevó componente por componente.**

**Escalas, por convención y no por token** (hay que leerlas del código, no hay `spacing`/`radius`
extendidos — se usan los de Tailwind por defecto):

| Elemento | Valor usado |
|---|---|
| Radio de tarjetas y modales | `rounded-2xl` (16px) |
| Radio de botones, inputs, selects, items de nav | `rounded-lg` (8px) |
| Radio de tablas | `rounded-xl` (12px) |
| Radio de badges | `rounded-full` |
| Sombra de tarjeta | `shadow-sm` |
| Sombra de modal | `shadow-xl` |
| Borde estándar | `border border-black/5` (tarjetas, tablas) / `border-black/10` (inputs) |
| Padding de tarjeta | `p-6` |
| Padding de modal | `p-8` |
| Padding del área de trabajo | `p-10` (admin) / `p-4 sm:p-8` (agenda) |
| Celda de tabla | `px-6 py-4`; encabezado `px-6 py-3` |
| Input / botón md | `px-4 py-2.5 text-sm` |
| Ancho del sidebar | `w-64` (256px) |

**Paleta duplicada fuera de Tailwind:** `vite.config.ts` repite `theme_color: "#1B2A4A"` y
`background_color: "#FAF7F2"` en el manifest de la PWA. Son los mismos valores escritos dos veces.

### 10.2 Librería de componentes — `frontend/src/components/ui/`

Doce archivos. El barrel `index.ts` **exporta solo 9 de ellos**: faltan `CollapsibleSection`,
`FiltroBar`, `BreedCombobox` y `ClinicaCombobox`, que se importan por ruta directa. Es una
inconsistencia real a corregir antes de extraer nada.

| Componente | API | Notas |
|---|---|---|
| `Button` | `variant: primary\|secondary\|danger\|ghost`, `size: sm\|md`, `fullWidth` | El tamaño **debe** decidirse con `size`, no con `className`: pasar `px-3` junto al `px-4` de la base no achica nada (gana la clase que Tailwind emite última). Hay una nota en el archivo con las líneas exactas del CSS generado y 2 llamadas con el override muerto todavía sin tocar |
| `Card` + `CardTitle` + `CardDescription` | `highlighted` cambia el borde a `border-2 border-accent` | |
| `Input` | `label`, `error` | Label `text-sm font-semibold`, error `text-xs text-error` debajo, borde rojo en el campo |
| `Select` | `label`, `options: {value,label}[]`, `error` | Mismas clases que `Input` |
| `Badge` | `variant: success\|warning\|error\|info\|neutral`, `dot` | `bg-<v>/15 text-<v>`, `uppercase tracking-wide text-xs`. Nombres **genéricos a propósito**, no acoplados al dominio |
| `Modal` | `open`, `onClose`, `title`, `description`, `children`, `footer` | `max-w-md` fijo, overlay `bg-primary/60`, cierra al clickear afuera, `role="dialog"` |
| `Table` | `columns: {key,header,render,className}[]`, `data`, `rowKey`, `emptyMessage` | **El estado vacío vive adentro del componente** |
| `ProgressBar` | `value` 0-100 (recortado), `colorClassName` | |
| `CollapsibleSection` | `titulo`, `defaultAbierto`, `forzarAbierto` | `forzarAbierto` existe para el export a HTML estático |
| `FiltroBar` | `busqueda` + `onBusqueda` + `placeholder`, `selects[]`, `desde`/`hasta` | **Debounce de 300 ms** en la búsqueda; todos los filtros van al backend, nunca filtran un array ya cargado |
| `CountryCombobox`, `BreedCombobox`, `ClinicaCombobox` | — | Tres combobox de dominio, no genéricos |

### 10.3 Layout

**Tres chrome distintos, sin layout compartido.** Lo que se comparte es un hook, no el markup
(dicho explícitamente en `hooks/useMenuColapsable.ts`).

1. **`pages/admin/AdminLayout.tsx` — sidebar.** `<aside>` de `w-64` con `bg-primary`, `p-6`,
   texto blanco. Arriba: cuadrado `h-9 w-9 rounded-lg bg-accent` con un punto blanco + "Vetline Ai"
   / "AI ADMIN" en `text-xs text-white/60`. Nav con 11 items y la clase activa
   `bg-white/10 text-white` contra `text-white/70 hover:bg-white/5`. Abajo, separado por
   `border-t border-white/10`: rol, "Cerrar sesión", enlace legal. El `<main>` es `flex-1 p-10` y
   arranca con una fila de barras de estado (`BarraVerificacionCorreo`, `BarraVentanaPurga`) y dos
   campanas de notificaciones alineadas a la derecha.

2. **`pages/agenda/AgendaLayout.tsx` — header con pestañas.** `<header>` `bg-surface` con
   `border-b border-black/5`: a la izquierda "← Volver" + título `text-lg font-bold text-primary`;
   a la derecha campana y logout. Debajo, una fila de 6 pestañas `overflow-x-auto` con la activa en
   `bg-primary text-white`. Existe porque el módulo es accesible a **los dos roles** y ninguno de
   los otros dos chrome servía para ambos (comentario en el archivo).

3. **`pages/platform-admin/PlatformAdminLayout.tsx`** — sidebar con una franja superior fija de
   32px (por eso `BackdropMenuMovil` acepta `claseTop`).

4. **El área de trabajo del médico** (`pages/workspace/CasoWorkspace.tsx`, **2442 líneas**) no tiene
   layout propio: es una pantalla de tres zonas (lista de casos / chat / paneles) que arma su
   chrome a mano y reusa `useMenuColapsable` para la lista de casos.

### 10.4 Patrones por caso de uso

**Listas con filtros.** Dos variantes conviviendo:
- *Platform Admin* usa `FiltroBar` (5 pantallas), con debounce incorporado.
- *Admin de clínica* usa un `Input` suelto y arma el debounce en el `useEffect` de la propia
  pantalla — `pages/admin/Propietarios.tsx:32-36` es el ejemplo canónico.

**Paginación.** **No hay componente.** Cada pantalla la escribe a mano: `POR_PAGINA = 20`
declarado en el archivo (y repetido en el backend, `propietarios.routes.ts:139`), y abajo de la
tabla una fila `flex items-center justify-between` con
`"Mostrando {desde}–{hasta} de {total} propietarios"` a la izquierda y
`[Anterior] Página N de M [Siguiente]` con `Button variant="secondary"` a la derecha.

**Formularios y validación.** Sin librería. Estado con `useState`, validación en el `submit`,
error renderizado por la prop `error` de `Input`/`Select`, o un bloque de error arriba del
formulario. **El mensaje casi siempre viene del backend**: `apiFetch` lanza
`ApiError(data.error, status, data)` y la pantalla pinta `err.message`. El backend escribe esos
mensajes en segunda persona, en español rioplatense y explicando la salida
(`"El correo electrónico no parece válido. Revisalo, o dejalo vacío si no lo tenés — el propietario
se guarda igual."`).

**Modales y confirmaciones.** El `Modal` compartido se usa en 16 archivos. Pero **8 modales están
escritos a mano** porque `Modal` es `max-w-md` y no alcanza: `CerrarCasoModal`, `CronologiaModal`,
`FichaPropietarioModal`, `ReabrirCasoModal`, `RegistroAtencionModal`, `ResolverCitaModal`,
`VincularAtencionModal`, `NuevaCitaModal`. Los 8 copian las mismas clases
(`fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4` + `role="dialog"` +
`aria-modal` + cierre por click en el fondo), así que el resultado se ve igual — pero es copia, no
reuso. Las confirmaciones destructivas usan un modal dedicado; **hay un solo `window.confirm()` en
todo el frontend** (`CasoWorkspace.tsx:1024`).

**Estados vacíos.** Centralizado solo para tablas: `Table` renderiza
`<p className="py-8 text-center text-sm text-text-muted">{emptyMessage}</p>` cuando `data` está
vacío, con default `"No hay datos para mostrar."`. Fuera de tablas, cada pantalla escribe su
párrafo.

**Carga.** **No hay spinner ni skeleton en ninguna parte.** El patrón universal es
`{isLoading ? <p className="text-text-muted">Cargando…</p> : <contenido/>}` — con puntos
suspensivos tipográficos (`…`), no tres puntos. Aparece en 40+ archivos.
`ProtectedRoute` usa una variante a pantalla completa: `"Cargando sesión…"`.

**Avisos y toasts.** **No hay sistema de toasts ni ninguna librería.** Hay tres mecanismos:
1. **Barras persistentes** arriba del área de trabajo: `BarraVerificacionCorreo`,
   `BarraVentanaPurga`, `ConsumoBanner` (con `TONO_CLASES` por severidad).
2. **Campanas**: `NotificacionBell` (avisos de consumo) y `NotificacionesPersonalesBell`.
3. **Mensajes inline** dentro de la pantalla que disparó la acción.

**Tablas.** Siempre el componente `Table`: `overflow-x-auto` + `rounded-xl border border-black/5
bg-surface`; encabezado `bg-background/60` con `text-xs font-bold uppercase tracking-wide
text-primary`; filas con `border-b border-black/5 last:border-0 hover:bg-background/40`. El
contenido de cada celda lo decide `render`, así que los `—` de los valores nulos los pone la
pantalla, no la tabla.

**Comportamiento móvil.** `useMenuColapsable` (cierra solo al cambiar de ruta) + `BotonMenuMovil`
(44×44, `md:hidden`) + `BackdropMenuMovil` (`bg-black/40`). El sidebar es
`fixed ... -translate-x-full` que pasa a `translate-x-0` y vuelve a `md:static md:translate-x-0`.
El breakpoint es siempre **`md`**. Cobertura desigual: hay pantallas sin ningún breakpoint.

### 10.5 Textos, íconos y nombres de acciones

**Íconos: no hay librería.** 13 `<svg>` inline en todo el frontend (hamburguesa, campanas, logos,
estados). El resto son **glifos de texto y emoji**: `▾` para colapsar, `←` para volver, `→` para
"ir a", `—` para dato vacío, `🐶`/`🐱` en `ESPECIE_ICONO` (`pages/agenda/ListaEspera.tsx:25`),
`ICONO_POR_TIPO` en `CronologiaModal`. **Para Vetline Clinic esto significa que no hay un set de
íconos que heredar — hay que decidir uno y, si se elige una librería, Vetline Ai queda divergente.**

**Tono de los textos.** Español rioplatense y voseo consistente en toda la aplicación
(*"Revisalo"*, *"dejalo vacío si no lo tenés"*, *"Solo podés editar tu propia configuración"*,
*"No tenés acceso a este agente"*). Los errores explican la salida, no solo el problema.
`lib/saludoMedico.ts` documenta la regla de saludo con un detalle que conviene respetar: **nunca se
infiere el género ni se inventa un título** — el verbo es neutro (*"Te damos la bienvenida"*) y
"Dr."/"Dra." solo aparece si está en el dato cargado.

**Nombres de acciones.** Verbo en infinitivo, primera persona cuando el botón es el CTA de un
correo o de un modal: *Guardar*, *Cancelar*, *Crear*, *Invitar médico*, *Reenviar*, *Habilitar* /
*Deshabilitar*, *Activar* / *Desactivar*, *Anterior* / *Siguiente*, *Cerrar sesión*,
*Exportar mis datos*, *Elegir un plan*, *Completar mi alta*, *Confirmar mi correo*.
En los correos el CTA es siempre en primera persona (`envolverLayout(..., "Registrar tarjeta
nueva", enlace)`).

**Formato de fechas.** `lib/formatFecha.ts` es el **punto único**, y su regla es explícita:
*"nunca concatenar strings ni usar `toLocaleDateString` sueltos"*, siempre con zona horaria
explícita (la del tenant, nunca la del navegador ni UTC). Expone `formatearFecha`,
`formatearFechaCorta`, `formatearHora`, `fechaHoyEnZona` y `formatearFechaRelativa`
("Hoy, 09:30" / "Ayer, 16:15" / fecha completa). El comentario registra el bug real que lo motivó:
`new Date().toISOString().slice(0,10)` da el día en UTC y en Costa Rica (UTC−6) mandaba todo lo
posterior a las 18:00 al día siguiente.

**Mapas de etiquetas.** Hay ~20 `Record<string, string>` locales traduciendo enums a texto
(`ESTADO_LABEL` existe tres veces: `lib/agendaApi.ts:126`, `pages/admin/Casos.tsx:19`,
`pages/admin/Exportacion.tsx:15`). El mapeo estado→variante de badge también está suelto
(`pages/agenda/CitaDetallePanel.tsx:17`).

### 10.6 Qué conviene extraer a un paquete compartido

Esto es un **relevamiento de qué hay, no un plan**. Dicho eso, el material se separa solo en cuatro
capas según cuánto dominio arrastra:

| Capa | Qué contiene | Por qué |
|---|---|---|
| **1. Tokens** | El bloque `theme.extend` de `tailwind.config.js` (11 colores + 2 familias), el `<link>` de Google Fonts, `index.css`, y las convenciones de radio/sombra/padding de §10.1 | Es el único artefacto donde una divergencia es **visible de inmediato** y donde copiar 11 hex a mano garantiza que en seis meses difieran. Hoy la paleta **ya está duplicada** en `vite.config.ts` (manifest de la PWA) |
| **2. Primitivas sin dominio** | `Button`, `Card`, `Input`, `Select`, `Badge`, `Modal`, `Table`, `ProgressBar`, `CollapsibleSection`, `FiltroBar`, `BotonMenuMovil`, `BackdropMenuMovil`, `useMenuColapsable` | Ninguno conoce el dominio veterinario. `Badge` ya está escrito con variantes genéricas **a propósito** ("el mismo Badge sirve para Activo/Habilitado/Rechazada, sin acoplar el componente a un dominio") — es decir, ya fue diseñado pensando en esto |
| **3. Utilidades de comportamiento** | `lib/formatFecha.ts`, `lib/apiError.ts`, el `apiFetch`/`apiFetchBlob`/`apiFetchFile` de `lib/api.ts`, `lib/session.ts`, `lib/keycloakAuth.ts`, `hooks/useAuth.tsx` + `misRoles`, `routes/ProtectedRoute.tsx`, `lib/runtimeEnv.ts` | Son las piezas donde una divergencia **no se ve pero rompe**: dos interpretaciones distintas de la zona horaria, dos criterios de refresco de token, dos mapeos de rol. `useAuth` se declara a sí mismo "la ÚNICA puerta de entrada a la sesión"; tener dos no cumple esa promesa |
| **4. Patrones a escribir, no a extraer** | Un `Pagination`, un `EmptyState` fuera de tablas, un `LoadingState`, y un `Modal` con prop de ancho (hoy 8 modales lo copian porque `max-w-md` no alcanza) | Hoy no existen como componente: son copias. Extraerlos ahora es escribirlos por primera vez — el mejor momento es antes de que haya **dos** repos copiándolos |

**Lo que NO conviene mover:** `CountryCombobox`, `BreedCombobox`, `ClinicaCombobox`, todo
`components/caso/` y las tres `*Layout.tsx`. Los tres layouts resuelven tres problemas distintos y
ya tienen comentarios explicando por qué no se unificaron; forzar un layout compartido ahora
importa decisiones de Vetline Ai a un producto que todavía no eligió las suyas.

**Dos cosas hay que arreglar antes de extraer nada**, o el paquete nace con la deuda adentro:
el barrel `components/ui/index.ts` no exporta 4 de sus 12 componentes, y `Button` tiene 2 llamadas
con un override de tamaño muerto (documentadas en el propio archivo).

**Forma del paquete: decisión abierta.** No hay monorepo hoy (sin `package.json` raíz, sin
workspaces), así que la opción es crear uno, publicar un paquete privado, o usar un submódulo de
git. El relevamiento no la resuelve.

---

## 11. Riesgos de compartir la base entre dos repos

Todo lo que sigue es **lógica que vive en el backend de Vetline Ai y que la base no impone**. Un
segundo escritor que vaya directo a las tablas se la saltea sin error.

### 11.1 Validaciones que no existen como restricción

| Regla | Dónde vive hoy | Qué pasa si Vetline Clinic la salta |
|---|---|---|
| Correo de propietario con formato utilizable | `propietarios.routes.ts:27` → `email.ts::direccionValida()` | La fila se guarda. `enviarEmail` **rechaza** el destinatario después, así que el tutor nunca recibe nada y **no hay webhook de rebotes para propietarios** (`correo_rebotado_en` existe en `personas`, no en `propietarios`): falla en silencio, para siempre |
| Saneo de cabeceras (CRLF, comillas, ángulos) en nombre de clínica, asunto y destinatario | `email.ts:28-100`, aplicado **dentro** de `enviarEmail` | Si el segundo repo arma su propio envío con el SDK de Resend, reabre la inyección de cabeceras que este saneo cerró (bug real) |
| `vacuna` obligatoria si `tipo='vacunacion'`; `subtipo_desparasitacion` obligatorio si `tipo='desparasitacion'` | `pacientes.routes.ts:276-287` | Fila válida para la base, inútil para el aviso y para el agente |
| `fecha_fallecimiento` obligatoria con `estado='fallecido'` | `pacientes.routes.ts:106` | Sin CHECK en la base |
| Un paciente `fallecido` no recibe avisos | Chequeado en cada emisor (`citas.routes.ts:160`, `:214`, el job) | Se le manda un recordatorio de cita al tutor de un animal muerto |
| La identificación del propietario es inmutable | `propietarios.routes.ts` ignora los campos en `PATCH` | La base solo impone unicidad y "ambos o ninguno", no la inmutabilidad |
| La raza tiene que corresponder a la especie | `pacientes.routes.ts:63-69` + el mapeo `Canino→canina` | `pacientes.raza_id` queda apuntando a una raza de otra especie |
| Colegiatura obligatoria para médicos | CHECK en la base, pero **`NOT VALID`** (migración `031`) | Se aplica a filas nuevas; las viejas pueden violarla |
| `personas.email` único **global**, no por tenant | `UNIQUE` en la base | Sí está impuesto — pero significa que una misma persona **no puede existir en dos clínicas** |

### 11.2 Máquinas de estado que solo viven en código

- **Citas.** El `CHECK` de `citas.estado` acepta los 7 valores, pero **no sabe nada de
  transiciones**. `TRANSICIONES_VALIDAS` (`citas.routes.ts:38`) es la única barrera: un `UPDATE`
  directo puede llevar una cita de `cancelada` a `en_consulta`.
- **Suscripciones.** Los 8 estados de `suscripciones.estado` tienen CHECK, pero las transiciones y
  sus efectos (crédito, cupos, bloqueo de acceso) viven en `purga.ts`, `cambios.ts`, `upgrade.ts`,
  `cicloCobro.ts` y `callbackCobros.ts`.
- **Casos.** Cierre y reapertura (`cierreCaso.ts`) escriben 8 columnas coordinadas; solo las de
  síntesis tienen CHECK de coherencia.
- **Recetas.** "Una receta `emitida` ya no se edita" es un `if` en `recetas.routes.ts`, no una regla
  de la base.
- **Pacientes.** "De `fallecido` no se vuelve" es que no existe el endpoint, nada más.

### 11.3 Efectos secundarios que un segundo escritor no dispara

| Efecto | Dónde |
|---|---|
| **Aviso al tutor** al agendar, cancelar, reprogramar o borrar una cita | `crearCita()` y `notificarCitaCanceladaOReprogramada()`. Un `INSERT INTO citas` directo **no manda nada** |
| **Desvincular `notificaciones.cita_id` antes de borrar una cita** | `citas.routes.ts` (DELETE). Sin esto, el `DELETE` **falla con violación de FK** en cuanto la cita tuvo alguna notificación — y siempre tiene al menos la confirmación |
| **Número de expediente** al crear un caso | `expediente.ts::asignarNumeroExpediente`, en la misma transacción. Un `INSERT INTO casos` sin él viola `NOT NULL` |
| **Auditoría automática de toda escritura** | `middleware/auditoria.ts`, middleware **global**: cualquier POST/PUT/PATCH/DELETE autenticado con respuesta 2xx deja fila en `bitacora_auditoria`. Un segundo backend no audita nada salvo que monte su propio equivalente |
| **Compuerta de crédito antes de llamar al modelo** | `tarifas.ts::verificarAntesDeGenerar` + `registrarUsoApi` (único escritor de `uso_api`). El agente de IA administrativo de Vetline Clinic **debe pasar por acá** o consume sin descontar |
| **Crédito de prueba al confirmarse el primer médico colegiado** | `registroPrueba.ts::otorgarCreditoPruebaSiCorresponde`, llamado desde el registro y desde la aceptación de invitación |
| **Cupo reservado por invitaciones pendientes** | `invitaciones.ts::contarInvitacionesPendientes`. Un alta directa en `personas` saltea el cupo contratado |
| **Rollback del usuario de Keycloak** si falla el alta en base | `registro.routes.ts:339` |
| **Bloqueo de generación en `ventana_purga`/`finalizada`** | `casos.routes.ts:122-134` y `purga.ts::suscripcionBloqueaGeneracionIa` |

### 11.4 Riesgos estructurales

1. **La purga.** `purga.ts::ejecutarPurgas` tiene una lista **hardcodeada** de 5 tablas a borrar a
   mano antes del `DELETE FROM tenants`. Cualquier tabla nueva de Vetline Clinic con FK a `tenants`
   **sin `ON DELETE CASCADE`** hace que la purga falle y haga `ROLLBACK`, dejando clínicas que
   debían eliminarse colgadas indefinidamente, con un error solo en el log. Ya pasó una vez
   (`notificaciones_callback`).
2. **La exportación.** `purga.ts` exporta recorriendo **casos**. Los datos que Vetline Clinic genere
   (inventario, ventas, caja, compras) **no entran en el zip** que la clínica descarga antes de que
   la borren.
3. **`atenciones` tiene RLS habilitado pero NO forzado.** Es la única tabla tenant-scoped en ese
   estado. Hoy no importa porque `vetplatform_app` no es owner — importa el día que algo se conecte
   con el rol owner. Y `auditoriaRls.job.ts` **no lo detecta**: solo mira `relrowsecurity`.
4. **Las migraciones comparten `schema_migrations` con `filename` como PK** y un solo directorio.
   Dos repos numerando `085_...` colisionan. No hay convención prevista.
5. **El CHECK de `notificaciones.tipo`** tiene 10 valores cerrados y `notificaciones.canal` tiene
   `CHECK (canal = 'correo')`. Cualquier aviso nuevo de Vetline Clinic exige una migración sobre una
   tabla de Vetline Ai.
6. **`parametros_plataforma` es global.** Dos productos escribiendo claves ahí necesitan al menos
   una convención de prefijo.
7. **Tokens compartidos, superficie compartida.** Un access token emitido por `vetplatform-web`
   sirve para los dos backends. Si Vetline Clinic afloja un gate, lo afloja para el mismo usuario
   que ya tiene sesión en Vetline Ai.
8. **La transacción por request.** `withTenantClient` sostiene la transacción durante toda la
   request, y en varias rutas eso incluye una llamada externa (medido: ~9,5 s por mensaje del chat;
   la síntesis clínica ~220 s). Es la alerta de `idle in transaction` de AWS, mitigada con un tope
   de 10 minutos pero **no resuelta**. Un segundo backend contra la misma base **suma presión sobre
   el mismo servidor**: si copia el patrón sin copiar `cerrarTransaccion()`/`conAlcanceTenant()`,
   lo empeora.
9. **Un médico `inactivo` sigue autenticándose** (§2.3). Vetline Clinic no debería asumir que pasar
   `authenticate` implica que la persona está activa.
10. **La purga no borra usuarios de Keycloak** (§2.5). El realm acumula usuarios de clínicas que ya
    no existen; si Vetline Clinic da de alta usuarios, hereda el mismo agujero.
11. **Import muerto:** `routes/admin.routes.ts:7` importa `eliminarUsuarioKeycloak` y nunca lo usa.
    Señal de que la compensación "dar de baja al médico también en Keycloak" se pensó y no se
    terminó.

---

## Resumen

1. **La agenda existe y es sólida como CRUD, pero no tiene reglas de disponibilidad**: `bloques`,
   `buffer_minutos`, `acepta_emergencias` y `duracion_default_minutos` se guardan y no los lee
   nadie; lo único que se evalúa es el solapamiento, y nunca bloquea.
2. **No hay ficha de paciente**: sin `GET /api/pacientes/:id`, sin edición (el único `UPDATE` es
   marcar fallecido), sin pantalla, y con `sexo`/`edad_anios` que se leen en 6 lugares pero no los
   escribe ningún endpoint. El "expediente" numerado es del **caso**, no del paciente.
3. **El aislamiento multi-tenant funciona y es copiable**: rol `vetplatform_app` sin privilegios +
   `set_config('app.tenant_id', …, true)` por transacción + RLS forzada en 36 tablas. Vetline Clinic
   tiene que usar ese rol, forzar RLS en toda tabla nueva y ponerle `ON DELETE CASCADE` a `tenants`,
   o rompe la purga.
4. **El alta de usuarios son dos mitades** (`personas`/`staff_plataforma` + Keycloak, unidas por
   `keycloak_user_id` ↔ `sub`), y la autorización sale **de la base, no del token**. Vetline Clinic
   necesita el client de servicio de Keycloak, no solo la base.
5. **`tenant_agentes` sirve como patrón** (tabla puente + doble gate entitlement/persona + 403 en el
   handler) pero **no como tabla**: está amarrada al catálogo `agentes`, al cupo de `suscripciones`
   y al motor de crédito. No hay feature flags por tenant.
6. **El correo tiene punto único con saneo de cabeceras adentro de `enviarEmail`** y una
   clasificación explícita de 10 de 27 tipos que salen con la marca del comercio. Compartir Resend
   es compartir reputación de dominio.
7. **El despliegue admite un segundo servicio con cambios mecánicos** (un `handle` en Caddy, dos
   servicios en el compose, memoria), pero **`schema_migrations` con `filename` PK y un solo
   directorio de migraciones no está preparado para dos repos**.
8. **El sistema de diseño es Tailwind puro, sin librerías**: 11 colores, 2 tipografías de Google
   Fonts, 12 componentes propios, cero iconos de librería, cero toasts, cero spinners, paginación
   copiada a mano, 8 modales duplicados.
9. **Lo que conviene compartir son los tokens, las 12 primitivas y las utilidades de
   sesión/fecha/API** — y escribir ahora, por primera vez, el `Pagination`, el `EmptyState`, el
   `LoadingState` y un `Modal` con ancho variable, antes de que haya dos repos copiándolos.
10. **El riesgo mayor no es el esquema sino los efectos secundarios**: avisos al tutor, número de
    expediente, auditoría global, compuerta de crédito, cupos y desvinculación de notificaciones
    antes de borrar una cita. La base no impone ninguno.
