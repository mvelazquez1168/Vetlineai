# Vetline Clinic 01 — Cimientos y ficha del paciente

## Contexto

Vetline Clinic son los módulos de gestión de la clínica (expediente, inventario, ventas, facturación,
CRM) y se construyen **dentro de este mismo repositorio y este mismo backend**, no como un
servicio aparte. Se activan por clínica; hoy solo para Medicavet.

La fuente de verdad sobre el estado actual es `docs/relevamientos/modelo-compartido-gestion.md`.
Todo lo que sigue se apoya en ese relevamiento; si algo de este prompt lo contradice, gana el código
y se reporta la contradicción.

Este prompt cubre tres cosas, en este orden: el refuerzo de la auditoría de seguridad por fila, la
habilitación de módulos por clínica y la ficha del paciente con su expediente. No cubre la agenda,
los cargos de la atención, el inventario, la facturación ni los roles nuevos: van en prompts
siguientes.

Construí sin pedir confirmación. Parás solo si encontrás una contradicción con el código, una
decisión irreversible sobre datos existentes, o un trabajo mucho mayor al que este prompt supone.

---

## 1. Auditoría de seguridad por fila que detecte lo que hoy deja pasar

Antes de crear cualquier tabla nueva:

- Que `jobs/auditoriaRls.job.ts` reporte, además de lo que ya reporta, toda tabla de `public` con
  columna `tenant_id` que tenga RLS **no forzado** (`relforcerowsecurity = false`) o **ninguna
  política** en `pg_policies`. Las dos tablas sin política a propósito
  (`clinica_eventos_ciclo_vida`, `clinicas_purgadas_auditoria`) quedan en una lista de excepciones
  explícita, en un solo lugar y con el motivo comentado.
- Que también reporte toda FK a `tenants` sin `ON DELETE CASCADE` que no esté en la lista de borrado
  manual de `purga.ts`. La lista de `purga.ts` y la del job tienen que ser **la misma constante**,
  no dos copias.
- Que `atenciones` quede con RLS forzado, y las otras cuatro tablas del grupo "habilitado no
  forzado" también, salvo que alguna tenga un motivo real para no estarlo (si lo tiene, va a la
  lista de excepciones con su motivo).
- **Verificación obligatoria:** el job tiene que fallar contra el defecto antes de que le creamos
  el visto bueno. Creá en desarrollo una tabla de prueba con `tenant_id` sin forzar RLS, otra sin
  política y otra con FK a `tenants` sin cascada; confirmá que el job reporta las tres; borralas.

## 2. Habilitación de módulos por clínica

- Que exista `tenant_modulos` con la forma de `tenant_agentes`: `tenant_id` (FK a `tenants`,
  `ON DELETE CASCADE`), `modulo`, `estado habilitado|deshabilitado`, `habilitado_en`,
  `deshabilitado_en`, `UNIQUE (tenant_id, modulo)`, RLS forzado con la política estándar.
- `modulo` con un CHECK de valores cerrados: `expediente`, `inventario`, `ventas`, `facturacion`,
  `crm`. Las campañas, los recordatorios comerciales y el motor de oportunidades son parte de
  `crm`, no módulos aparte. Un módulo nuevo exige migración, a propósito.
- Un único punto de consulta, `moduloHabilitado(db, tenantId, modulo)`, y un gate que devuelva 403
  con mensaje propio, en el mismo estilo que el gate de `tenant_agentes`. Nada de leer la tabla
  desde varios lugares.
- `GET /auth/me` devuelve la lista de módulos habilitados de la clínica, y el frontend muestra u
  oculta las secciones de Vetline Clinic según esa lista, desde un único hook.
- La activación para una clínica se hace por un comando (`npm run habilitar-modulo -- <tenantId>
  <modulo>`) o desde Platform Admin si ya hay un lugar natural para eso. **No** hardcodear el
  tenant de Medicavet en una migración.

## 3. Ficha del paciente y expediente

La ficha del paciente es parte del núcleo de Vetline Ai, no un módulo gateado: Vetline Ai también
la necesita (hoy el agente clínico recibe el contexto sin el sexo del paciente porque nada lo
escribe).

### 3.1 Datos

- `pacientes.sexo` con valores `macho|hembra`. Antes de poner el CHECK, relevá los valores que hay
  hoy en la base de desarrollo; si alguno no encaja, el CHECK va `NOT VALID` y lo reportás.
- `pacientes.estado_reproductivo` nuevo: `entero|castrado|desconocido`, default `desconocido`.
- La edad se guarda **solo** como `fecha_nacimiento`. Que exista `fecha_nacimiento_estimada boolean
  NOT NULL DEFAULT false`: cuando solo se conoce la edad aproximada, el sistema calcula una fecha
  de nacimiento y la marca como estimada. Ningún endpoint vuelve a escribir `edad_anios`; las filas
  viejas se siguen leyendo con `calcularEdadEfectiva`, que sigue siendo el único lugar que resuelve
  la edad.
- Campos nuevos opcionales: `microchip`, `color`, `alergias` (texto), `alerta_manejo` (texto corto,
  por ejemplo "agresivo, requiere bozal").
- **Número de expediente del paciente:** `pacientes.numero_expediente integer`, `UNIQUE (tenant_id,
  numero_expediente)`, asignado de forma atómica con el mismo patrón que
  `expediente.ts::asignarNumeroExpediente`, sobre un contador propio en `tenants`
  (`paciente_expediente_ultimo_numero`). Las dos asignaciones quedan en `expediente.ts`, no
  repartidas. Backfill de los pacientes existentes por orden de creación; reportá qué criterio de
  orden usaste. Una vez completo el backfill, la columna pasa a `NOT NULL`.
- `casos.numero_expediente` **no cambia de significado ni de datos**. En la interfaz, donde hoy se
  muestra como "Expediente", pasa a mostrarse como "N.º de caso", para que no se confunda con el
  expediente del paciente.

### 3.2 Backend

- `GET /api/pacientes/:id` — la ficha completa: datos del paciente, su propietario, cuidados
  preventivos, atenciones, casos (con estado y diagnóstico final si están cerrados) y recetas
  emitidas resumidas. Mismo gate que el resto de `/api/pacientes` (médico o admin de clínica).
- `GET /api/pacientes/:id/cronologia` — una sola línea de tiempo del paciente que mezcle
  atenciones, casos (apertura y cierre), vacunas, desparasitaciones y recetas, ordenada por fecha,
  con zona horaria del tenant.
- `PATCH /api/pacientes/:id` — edita nombre, especie, raza, sexo, estado reproductivo, fecha de
  nacimiento (o edad aproximada), microchip, color, alergias y alerta de manejo. La validación
  raza-especie reusa el mapeo que ya existe; si hay que moverlo para reusarlo, se mueve, no se
  copia. El `estado` **no** se edita acá: fallecido sigue teniendo su propio camino y no tiene
  vuelta atrás.
- `POST /api/pacientes` acepta los campos nuevos y asigna el número de expediente en la misma
  transacción.
- Un listado de pacientes con búsqueda (nombre, número de expediente, nombre del propietario) y
  paginación de 20, accesible también para el admin de clínica (hoy solo existe para médicos en
  `/api/workspace/pacientes`).
- El contexto del caso que recibe el agente (`contextoCaso.ts`) incluye sexo y estado reproductivo
  cuando están cargados, y la edad calculada desde la fecha de nacimiento, indicando si es
  estimada.

### 3.3 Frontend

- Una pantalla de ficha del paciente, `/pacientes/:id`, accesible para médico y admin de clínica:
  encabezado con nombre, especie, raza, sexo, estado reproductivo, edad, número de expediente,
  propietario y alerta de manejo destacada si existe; debajo, la cronología; y un modal de edición.
- Una pantalla de listado de pacientes con la misma estructura que `pages/admin/Propietarios.tsx`.
- Enlaces a la ficha desde la ficha del propietario, desde el detalle de una cita y desde el área
  de trabajo del caso.
- Patrones de diseño de Vetline Ai, sin excepciones: tokens de `tailwind.config.js`, primitivas de
  `components/ui/`, fechas solo por `lib/formatFecha.ts`, textos con el mismo tono de la
  aplicación. No se agrega ninguna librería de UI ni de íconos.

### 3.4 Duplicados

Hoy el paciente nace junto con el caso, así que es probable que haya el mismo animal registrado
varias veces. Que exista un script **de solo lectura**, que se pueda correr después en producción,
que liste posibles duplicados (mismo propietario y nombre parecido de la misma especie) con sus
casos y citas. **No fusiona nada.** La fusión es una decisión aparte.

---

## Verificación y reporte

- Migraciones aplicadas en desarrollo, con el prefijo de numeración que corresponda en el
  directorio único de migraciones.
- El job de auditoría falla contra las tres tablas defectuosas de prueba (punto 1) y queda limpio
  después.
- Dos altas simultáneas de pacientes no repiten número de expediente.
- `PATCH` con una raza de otra especie se rechaza; `PATCH` no puede revertir un fallecido.
- Una clínica sin el módulo `expediente` habilitado recibe 403 en un endpoint gateado de prueba, y
  lo ve en la interfaz como sección ausente.
- El contexto del agente de un caso de prueba muestra sexo, estado reproductivo y edad.

Reportá lo construido, lo que no se pudo y por qué, y cualquier contradicción con el relevamiento.
No se toca producción.
