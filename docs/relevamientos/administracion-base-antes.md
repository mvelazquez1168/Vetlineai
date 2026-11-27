# Estado antes del 04 — relevamiento verificado contra el código y el esquema

Punto 0 del prompt `vetline-clinic-04-administracion-base.md`. Hecho el 27 de noviembre de 2026,
leyendo el código y consultando el esquema real.

---

## 1. Usuarios y roles: cómo funciona hoy

### Cómo se resuelve un rol

**Desde la base, en cada solicitud.** `middleware/auth.ts`, función `resolverPrincipal`: valida el
token de Keycloak (firma RS256 vía JWKS) y después consulta `personas` por `keycloak_user_id`. Lo
que decide los permisos sale de esa consulta, no del token.

Los roles del token (`realm_access.roles`) **se leen y se descartan**: hay un
`void rolesToken; // extraídos según lo pedido; sin gating adicional en esta fase.` Es decir, el
token identifica a la persona y nada más, que es justamente lo que el prompt pide. **Eso ya está
bien y no hay que cambiarlo.**

### Qué roles existen

**Dos, y son dos columnas booleanas de `personas`:** `es_medico` y `es_admin_clinica`. No hay tabla
de roles ni de permisos.

`AuthPayload.rol` es un valor **derivado** (`es_admin_clinica ? "admin_clinica" : "medico"`) y su
único uso legítimo es la pantalla de aterrizaje. Hay un comentario en el código que lo dice y
remite a la auditoría del 2026-08-06, cuando un rol excluyente causó que un médico no viera su
agente.

### Dónde se chequean permisos

| Dónde | Cuántos | Cómo |
|---|---|---|
| Backend, `esMedico` | 70 usos | directo sobre `req.auth` |
| Backend, `esAdminClinica` | 30 usos | directo sobre `req.auth` |
| Guardas con nombre | 5 | `soloAdmin` (crm, facturación, inventario), `soloMedico` (expediente), `permisoAprobar` (ventas) |
| Frontend | el menú y los botones | `useAuth().esMedico` / `.esAdminClinica` |

**Las cinco guardas hacen lo mismo con cuatro nombres distintos.** Ninguna consulta una tabla de
permisos porque no existe.

### El flujo de invitación

Existe y funciona: `invitaciones_medico` + el módulo que crea la persona en la base **y** en
Keycloak en un solo acto, con la colegiatura obligatoria y el cupo reservado por invitaciones
pendientes. Se reusa tal cual; lo único que hay que agregarle es **elegir roles** en vez de asumir
«médico».

### Qué pasa al desactivar a alguien — **dos defectos reales**

1. **Un desactivado sigue entrando.** `resolverPrincipal` **no mira `personas.estado`**. La
   consulta es `WHERE p.keycloak_user_id = $1` y nada más: una persona en `estado = 'inactivo'`
   resuelve igual y sigue trabajando hasta que su token expire… y puede renovarlo, porque Keycloak
   no sabe que se desactivó.
2. **Desactivar no toca Keycloak ni revoca sesiones.** `PATCH /admin/medicos/:id/estado` solo hace
   `UPDATE personas SET estado = $1`. `cerrarSesionesUsuarioKeycloak` **ya existe**
   (`keycloakAdmin.ts:312`) y hoy la usa únicamente el restablecimiento de contraseña.

Y una restricción que conviene mirar: esa misma ruta lleva `AND es_admin_clinica = false`, así que
**a un administrador no se lo puede desactivar nunca**. Cumple por accidente el requisito de «no se
puede desactivar al último administrador», pero prohibiendo demasiado: una clínica con dos
administradores no puede sacar a uno.

---

## 2. La configuración que hoy vive dispersa

| Qué | Dónde está hoy | Qué hacer |
|---|---|---|
| Datos fiscales, emisor, sucursal, terminal | `fact_emisores` + `fact_emisor_actividades` (09a/09b) | **enlazar**, no duplicar |
| Apariencia y logo | `clinica_apariencia` (01c) | enlazar |
| Salas | `salas` (agenda de Vetline Ai): `id, tenant_id, nombre, tipo, activa` | reusar; la sección de recursos escribe ahí |
| Horarios | `horarios_configuracion` **por médico**: `medico_id, dia_semana, bloques, max_citas_dia, duracion_default_minutos, buffer_minutos, acepta_emergencias` | reusar. **No hay horario de la clínica**, solo por médico |
| Feriados y bloqueos | **no existen** | crear |
| Tipos de cita | **no existen.** `citas` no tiene ninguna columna de tipo | crear |
| Numeraciones | dispersas y sin prefijo: `tenants.paciente_expediente_ultimo_numero` (expediente), `max(numero)+1` por tabla con lock de transacción (cuentas, presupuestos, órdenes de compra) | crear el lugar único; los consecutivos de Hacienda **no se tocan** (los controla `fact_consecutivos`) |
| Tope de mensajes promocionales | `crm_politicas`: `hora_desde, hora_hasta, tope_promociones_mes, ventana_duplicado_horas` (03) | migrar a políticas |
| Descuento máximo general | `vta_parametros.descuento_maximo_pct` (08) | migrar a políticas |
| Descuento máximo por rol | `vta_topes_descuento` (08b) | migrar a políticas |
| Descuento máximo por producto | `inv_productos.descuento_maximo_pct` / `inv_servicios` (08b) | **se queda en el producto**, y vale el menor de los dos (lo dice el prompt) |
| Vigencia de presupuestos | `vta_parametros.presupuesto_vigencia_dias` (08b) | migrar a políticas |
| Umbral de diferencia de arqueo | `vta_parametros.umbral_diferencia_arqueo` (08) | migrar a políticas |
| Modo de arqueo por denominación | `vta_parametros.arqueo_por_denominacion` (08b) | queda donde está: es una preferencia de pantalla, no una política de negocio |
| Umbral de aviso de stock | `inv_productos.minimo` por producto; `inv_parametros` para lo general | migrar el general a políticas |
| Margen mínimo | **no existe** | crear |
| Política de anulación | **no existe** como política; el control «quien pide no aprueba» está en `ventas/aprobaciones.ts` | crear la política; el control se queda donde está |
| Autonomía del agente | **no existe** | crear con su valor más restrictivo |

---

## 3. Lo que este relevamiento decide, para no duplicar

1. **Los dos booleanos de `personas` NO se borran: se derivan.** Hay 100 chequeos en el backend y
   el menú entero del frontend colgando de `esMedico` y `esAdminClinica`. La tabla de roles pasa a
   ser la fuente, y los dos booleanos se calculan desde ella en `resolverPrincipal`. Reescribir 100
   chequeos en la misma entrega que introduce el modelo es la forma de romper algo sin que nadie lo
   note; los permisos nuevos se expresan con `exigirPermiso(...)` y los chequeos viejos siguen
   funcionando porque los booleanos siguen diciendo la verdad.

2. **Las cinco guardas se unifican en una.** `soloAdmin`, `soloMedico` y `permisoAprobar` pasan a
   ser llamadas a `exigirPermiso("…")` con el permiso que les corresponde.

3. **`crm_politicas` y `vta_parametros` no se vacían de golpe.** Las políticas nuevas se leen con
   `politica(clave)`, y esa función lee de la tabla nueva **con respaldo en la columna vieja**
   mientras exista. Así ningún módulo se rompe el día del despliegue y la columna vieja se borra
   cuando ya nadie la lee.

4. **El horario de la clínica no existe y hay que crearlo**, porque hoy solo hay horario por
   médico. La agenda tiene que respetar los dos: el de la clínica como marco y el del médico
   dentro.
