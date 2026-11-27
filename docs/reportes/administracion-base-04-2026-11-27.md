# Prompt 04 — Administración base: personas, roles, políticas y configuración de la clínica

Rama `vetline-clinic/04-administracion-base`, partiendo de `vetline-clinic/complemento-caja-facturador`.
Nada fusionado a `main`.

Migraciones **139 a 148**. Dos verificadores: `verificar_administracion_04.ts` (107 aserciones) y
`verificar_administracion_04_http.ts` (49 aserciones, por HTTP real). Los dos en **TODO OK**.

---

## 1. Qué había antes, y qué quedó

El relevamiento completo está en `docs/relevamientos/administracion-base-antes.md`, hecho antes de
tocar código. Lo esencial:

| Tema | Antes | Ahora |
|---|---|---|
| Roles | dos columnas booleanas de `personas` (`es_medico`, `es_admin_clinica`) | ocho roles en `roles`, asignados en `persona_roles`; los dos booleanos siguen existiendo y se **derivan** |
| Permisos | no existían; 100 chequeos directos sobre los dos booleanos | 34 permisos en `permisos`, matriz en `rol_permisos`, lo que la clínica cambia en `tenant_rol_permiso` |
| Guardas de ruta | 5 funciones con 4 nombres distintos, todas preguntando por un booleano | una sola, `exigirPermiso(codigo)`, que resuelve contra la base |
| «Es personal de la clínica» | 14 copias de `esMedico \|\| esAdminClinica` | una sola, `soloPersonalDeLaClinica()` |
| Un desactivado | **seguía entrando**: `resolverPrincipal` no miraba `personas.estado`, y desactivar no tocaba Keycloak | no entra: estado + usuario deshabilitado + sesiones cerradas |
| Desactivar a un administrador | imposible por un `AND es_admin_clinica = false` en la ruta | se puede, salvo que sea el último |
| Horario de la clínica | no existía (solo por médico, y nadie lo comparaba con la cita) | `clinica_horario`, y la agenda lo respeta |
| Feriados y bloqueos | no existían | `clinica_excepciones` + `feriados_catalogo` por país |
| Tipos de cita | no existían | `tipos_cita`, con duración, color y servicio |
| Numeraciones | dispersas, sin prefijo | `clinica_numeraciones`: prefijo y dígitos en un lugar |
| Políticas | repartidas en `vta_parametros`, `crm_politicas` e inexistentes | 9 políticas en `politicas` + `tenant_politicas`, con historial |
| Invitación | solo de médicos: colegiatura obligatoria y cupo de médico siempre | de cualquier rol; la colegiatura solo si es médico y el cupo solo si consume uno |
| Pantalla de entrada | derivada de los dos booleanos | de `roles.pantalla_inicio`, que existía desde la 139 y **nadie leía** |

---

## 2. La matriz final: ocho roles, 34 permisos

Cantidad de permisos por rol, tal como quedó en la base:

| Rol | Permisos | Aterriza en |
|---|---|---|
| Administrador | 29 | `/inicio` |
| Médico | 18 | `/workspace` |
| Farmacia | 10 | `/inventario` |
| Caja | 9 | `/ventas` |
| Recepción | 8 | `/agenda` |
| Asistente técnico | 6 | `/agenda` |
| Contador | 6 | `/facturacion` |
| Estética | 5 | `/pacientes` |

**Cinco permisos son configurables por la clínica** (`permisos.configurable`): ver costos y
márgenes, aplicar descuentos, anular, ajustar inventario y exportar datos. Los demás —y en
particular **los seis clínicos**— no se pueden mover: escribir y firmar el expediente es del rol
médico, y es lo que hace que una firma signifique algo.

Los permisos clínicos finos, que existían en el catálogo y no los leía nadie, ahora se usan donde
corresponden: `expediente.firmar` en el cierre de la atención, `receta.emitir` en las tres rutas de
receta y `expediente.grooming` en atender un hallazgo de grooming.

### Las nueve políticas

`descuento.maximo_sin_autorizacion` (admite valor por rol), `margen.minimo`,
`mensajes.tope_promociones_mes`, `stock.umbral_aviso`, `presupuesto.vigencia_dias`,
`anulacion.requiere_aprobacion`, `anulacion.plazo_horas`, `arqueo.umbral_diferencia`,
`agente.autonomia` (nace en «solo sugiere»).

Cada una dice **de dónde sale su valor**: `clinica` (la configuraron), `columna_anterior` (viene de
donde el módulo lo guardaba antes, y se respeta para que nadie cambie de comportamiento el día del
despliegue) o `por_omision`.

---

## 3. Las pantallas, con su camino de clics

| Pantalla | Camino | Quién la ve |
|---|---|---|
| **Personal de la clínica** | Administración › Personal de la clínica (`/admin/personas`) | todo el personal la lee; cambiar roles y desactivar pide `personas.administrar` |
| **Roles y permisos** | Administración › Roles y permisos (`/admin/roles`) | todo el personal; editar pide `clinica.configurar` |
| **Políticas** | Administración › Políticas (`/admin/politicas`) | todo el personal; editar pide `clinica.configurar` |
| **Configuración de la agenda** | Administración › Configuración de la agenda (`/admin/configuracion-agenda`), con cuatro pestañas en la URL: Horario, Feriados y bloqueos, Tipos de cita, Numeraciones | lectura con `agenda.ver`; editar pide `clinica.configurar` |
| **Invitar con roles** | Administración › Médicos e invitaciones › + Invitar a alguien | `personas.administrar` |
| **Aviso de fuera de horario** | Agenda › Nueva cita, con una hora fuera del horario | lo ve quien agenda; autorizar pide `agenda.fuera_de_horario` |

**Por qué cuatro de ellas son de lectura para todo el equipo y no solo del administrador:** alguien
a quien el sistema le dice «pedí autorización» tiene derecho a ver cuál es el tope y de dónde sale,
y la recepción necesita poder explicarle al cliente por qué no hay turno el 25. Las acciones de
escritura están gateadas una por una en el backend.

El menú lateral se dibuja ahora con permisos (`Opcion.permiso`) y no con las dos banderas
`soloAdmin`/`soloMedico`, que desaparecieron.

---

## 4. Los defectos encontrados, y cuáles eran míos

### Del código que ya estaba

1. **Un desactivado seguía entrando.** `resolverPrincipal` no miraba `personas.estado`. Corregido:
   si no está `activo`, no resuelve. Y desactivar ahora deshabilita el usuario en Keycloak y cierra
   sus sesiones, en ese orden.
2. **A un administrador no se lo podía desactivar nunca** (`AND es_admin_clinica = false` en la
   ruta). Ahora se puede, con el único límite real: no se puede dejar la clínica sin administrador,
   ni desactivando al último ni quitándole el rol.
3. **`notificaciones.enviada_en` no existe.** El despacho por WhatsApp del anexo 07-03 la escribía.
   Como el aviso se emite dentro de la misma transacción que crea la cita, **`POST /citas`
   contestaba 500** con un dueño que solo tiene teléfono. Migración 148; el correo también la
   escribe ahora. Pasó inadvertido porque los verificadores de notificaciones prueban el correo y
   los dueños de prueba de los demás no tienen consentimiento de WhatsApp.
4. **`puedeAutorizarDescuento` leía `vta_topes_descuento.puede_autorizar`**, una segunda fuente de
   «quién autoriza». Ahora lee el permiso `caja.aprobar`.
5. **Aprobar y configurar en caja eran la misma función con dos nombres** (`permisoAprobar` y
   `permisoConfig`, con un comentario que decía «mismo titular hoy, nombre distinto a propósito»).
   Ahora son dos permisos distintos y la clínica puede separarlos.

### Míos, encontrados por los verificadores de esta misma entrega

6. **Una persona nueva nacía sin ningún permiso.** Con los roles en `persona_roles`, los tres
   caminos de alta que existen —invitación, registro público, alta desde la plataforma— no sabían
   de la tabla. Un médico recién invitado entraba y no podía hacer nada. Corregido **en la base**
   con un disparador (migración 143), no en los tres sitios: el cuarto camino que alguien escriba
   el mes que viene habría tenido el mismo defecto.
7. **`rolEfectivo` leía los dos booleanos**, así que una recepcionista caía en «otro». Ahora lee
   `persona_roles`, y con varios roles gana **el más permisivo**.
8. **El historial de políticas empataba**: `now()` es la hora de la transacción, así que dos cambios
   seguidos quedaban con la misma marca y el orden se perdía. Migración 141: `clock_timestamp()`.
9. **Seis permisos configurables en vez de cinco** (migración 142).
10. **La semilla de la 144 corrió una sola vez.** Horario y feriados se sembraron para las clínicas
    que existían ese día, y tipos de cita y numeraciones **nunca se sembraron**. Una clínica nueva
    nacía sin horario. Es la tercera vez que aparece esta forma de defecto (los topes de descuento
    del 08b, los roles de la 143), y por eso la 145 lo arregla con un disparador y pone los feriados
    en `feriados_catalogo` por país, que desde ahora es su única fuente.
11. **El control de horario se le aplicó a los otros tres llamadores de `crearCita`.** Es el único
    punto de creación de citas del sistema, y dos de esos caminos no son «agendar»: la atención del
    paciente que llega sin turno —la cita registra lo que **ya** está pasando— y el control
    recomendado al cerrar la atención. Una urgencia a las siete de la tarde habría dejado al médico
    sin poder abrir la atención, y un control en un feriado habría hecho fallar el cierre entero.
    Ahora llevan `omitirHorario`, que es un **parámetro de función y no un campo del cuerpo** a
    propósito: `POST /citas` pasa `req.body` tal cual, así que un campo sería forjable desde el
    navegador y el permiso no serviría para nada. Agendar desde la lista de espera **sí** es
    agendar, y pasa por el mismo control.
12. **`/auth/me` devolvía `permisos: {}`.** `req.auth.permisos` es un `Set`, y
    `JSON.stringify(new Set(["a"]))` es `{}`. La sesión llegaba al navegador sin permisos, con un
    200 y sin ningún error visible: el menú se habría dibujado vacío y nadie habría sabido por qué.
13. **El defecto más grande del prompt**, y lo encontró el verificador por HTTP: los **catorce**
    routers de la clínica preguntaban `esMedico || esAdminClinica` para decidir si alguien es
    personal. Con los ocho roles, eso dejaba afuera a recepción, caja, farmacia, estética, asistente
    y contador —los seis roles que este prompt existe para crear—. El síntoma era exacto y silencioso
    para los verificadores de módulo: la recepción entraba, el menú le mostraba la agenda, y cada
    llamada contestaba «Esta sección es solo para personal de la clínica». Ahora la pregunta está en
    un solo lugar y es la correcta: pertenece a una clínica y tiene algún rol.

---

## 5. Lo que se movió de otros módulos

- **El tope de descuento** ya no se lee de `vta_parametros.descuento_maximo_pct` ni de
  `vta_topes_descuento`: se lee de las políticas, **con respaldo en la columna vieja**. Ninguna
  clínica cambia de comportamiento el día del despliegue, y la etiqueta «de antes» en la pantalla lo
  dice.
- **El tope de promociones del CRM** (`crm_politicas.tope_promociones_mes`) y la **vigencia de
  presupuestos** y el **umbral de arqueo** (`vta_parametros`), igual.
- **El tope por producto se queda en el producto**: el tope real es el menor de los tres, como ya
  lo explicaba el manual de descuentos.
- **Las salas y el horario por médico se reusan**: esta entrega no los duplica. El horario de la
  clínica es el marco y el del médico va adentro.
- **Los consecutivos de Hacienda no se tocaron.** `clinica_numeraciones` guarda prefijo y dígitos;
  el siguiente número lo sigue calculando cada módulo, y la pantalla lo muestra sin dejar editarlo
  —bajarlo generaría números repetidos en documentos ya entregados—. Unificar los cuatro
  consecutivos es un cambio aparte y así está escrito en la migración 144.

---

## 6. Qué se verificó, y cómo

**Esto es lo que se corrió de verdad.** No hay verificación en navegador en esta entrega: nadie abrió
una pantalla.

| Qué | Cómo se verificó |
|---|---|
| Los 8 roles, sus permisos, la unión con varios roles | `verificar_administracion_04.ts`, contra la base |
| Lo configurable y lo que no | el mismo, intentando cambiar un permiso clínico |
| Caché de permisos invalidada al cambiar roles | el mismo |
| Un desactivado no resuelve; no se puede dejar la clínica sin administrador | el mismo |
| Las 9 políticas: valor, origen, rango, historial, valor por rol | el mismo |
| Horario, feriados, vacaciones, bloqueos por hora, cita que termina pasado el cierre | el mismo, con `sePuedeAgendar` |
| La guarda `exigirPermiso` y la del fuera de horario | el mismo, con un `req`/`res` armados a mano |
| La invitación con roles y el cupo que es de médicos | el mismo |
| Tipos de cita y numeraciones sembrados en una clínica nueva | el mismo |
| **Token real → `req.auth` → guarda de la ruta, por rol** | `verificar_administracion_04_http.ts`: crea sus usuarios por el camino real (invitación con roles), los autentica contra **Keycloak** y llama la API por HTTP. 403 por falta de permiso, 409 del horario con su motivo, 403 al forzar sin permiso, 400 sin motivo, 201 con permiso y motivo, y la cita con quién autorizó y por qué |
| Una clínica que **solo usa Vetline Ai** (sin módulos de gestión) | el mismo: su médica entra, aterriza en su área de trabajo, abre el expediente; la recepción no entra al área de trabajo del médico |
| Sin regresiones | `rutas_unicas`, `atencion_07c`, `anexo_07_03`, `complemento_08b_09b`, `ventas_caja`, `dictado_07d` — los seis en TODO OK |
| Compilación | `tsc --noEmit` limpio en backend y frontend |

El verificador por HTTP **crea y borra sus propios usuarios** en Keycloak y en la base
(`probe-04-http-*`). No toca ninguna credencial existente.

---

## 7. Lo que queda pendiente, y por qué

1. **Verificación en navegador.** Las cuatro pantallas nuevas y el aviso de fuera de horario no se
   abrieron en un navegador: no hay automatización de navegador en este entorno. Lo que está
   probado es la API con tokens reales y la compilación. El paso visual queda para el usuario.
2. **El nombre `invitaciones_medico` ya no describe lo que es.** Hoy es «invitaciones de personal»:
   guarda roles y la mayoría de sus filas pueden no ser de médicos. No se renombró porque toca el
   módulo de invitaciones, el registro público, tres verificadores y los correos; queda anotado como
   deuda de nombre, que es la forma de defecto que este repo ya tuvo tres veces.
3. **Decisión con impacto comercial, CONFIRMADA por el usuario el 2026-11-27:** *invitar a alguien
   que no es médico no consume cupo del plan*. El plan se cobra por médico y contar a la recepción como un cupo de
   veterinario sería cobrar dos veces por una persona que no factura horas clínicas; pero es una
   decisión de producto y no de código. Si el criterio es otro —por ejemplo, cobrar por usuario— se
   cambia en un solo lugar (`contarInvitacionesPendientes` y `crearInvitacion`).
4. **`personas.ultimo_acceso` no existe** y el prompt lo pedía en la pantalla de personal. Se
   devuelve `null` en vez de inventarlo: registrarlo significa una escritura en cada autenticación,
   que es una decisión de rendimiento y no un detalle de esta pantalla.
5. **Los feriados llegan hasta 2027.** Cargar más desde ahora es insertar en `feriados_catalogo`; lo
   que falta es decidir si eso lo hace un job anual o una fuente oficial. Inventar diez años de
   feriados ahora sería inventarlos.
6. **La entrada del médico cambió con módulos de gestión habilitados**: antes del 04 aterrizaba en
   Inicio, ahora en su área de trabajo, porque es lo que dice `roles.pantalla_inicio`. Cada persona
   puede elegir la suya y su elección gana; si el criterio preferido es el anterior, se cambia con
   un `UPDATE roles SET pantalla_inicio = '/inicio' WHERE codigo = 'medico'`.
7. **Los 100 chequeos viejos siguen en pie**, por decisión del relevamiento: los dos booleanos ahora
   se derivan de los roles y siguen diciendo la verdad. Reescribirlos en la misma entrega que
   introduce el modelo era la forma de romper algo sin que nadie lo notara.

---

## 8. Las migraciones

| # | Qué hace |
|---|---|
| 139 | `roles` (8), `permisos` (34), `rol_permisos`, `tenant_rol_permiso`, `persona_roles` + semilla desde los dos booleanos |
| 140 | `politicas`, `tenant_politicas`, `politicas_historial` |
| 141 | el historial usa `clock_timestamp()`: con `now()` dos cambios seguidos empataban |
| 142 | deja cinco permisos configurables, no seis |
| 143 | disparador: una persona nueva nace con sus roles por cualquier camino de alta |
| 144 | `clinica_horario`, `clinica_excepciones` (+feriados CR 2026-2027), `tipos_cita`, `clinica_numeraciones`, y las tres columnas de `citas` |
| 145 | disparador: una clínica nueva nace configurada; `feriados_catalogo` por país como fuente única |
| 146 | el administrador aterriza en Inicio y no en la pantalla de configuración |
| 147 | `invitaciones_medico.roles`, con `CHECK` de que los roles existan |
| 148 | `notificaciones.enviada_en`, la columna que el despacho por WhatsApp escribía y no existía |
