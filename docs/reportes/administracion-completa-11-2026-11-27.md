# Prompt 11 — Administración completa

Rama `vetline-clinic/11-administracion-completa`, partiendo de la rama del 10a. Nada fusionado a
`main`.

Migraciones **155 a 162**. Verificador `verificar_administracion_11.ts`: **95 aserciones, TODO OK**,
sin `--transpile-only`.

El relevamiento completo —las dos tablas que pide el punto 0— está en
`docs/relevamientos/administracion-completa-antes.md`. Acá va lo esencial y lo que se decidió.

---

## 1. Relevamiento: las dos tablas, resumidas

### Lo que ya existía y se reusó

| Qué | Dónde | Cómo se usó |
|---|---|---|
| Personas, roles y permisos | 04 | los 10 permisos nuevos van a la misma matriz |
| Bloqueos de agenda por médico | `clinica_excepciones` (04) | **las ausencias son esa tabla**, con estado y aprobación |
| Quién realizó y quién refirió cada cargo | `vta_cargos` (08b) | es la base de las comisiones; **estaba y nadie lo leía** |
| Movimientos de inventario con paciente y lote | `inv_movimientos` | el libro de controlados **se arma de ahí**, sin segundo registro |
| Trece catálogos clínicos por clínica | `exp_catalogos_clinicos` (anexo 07-03) | se extiende con los tres que faltaban |
| Insumos por servicio, bodegas, servicios, tipos de cita, salas, especies, razas, protocolos | sus módulos | se **enlazan** desde Catálogos |
| Plantillas de consentimiento | `exp_plantillas_consentimiento` (07) | existía **sin generar PDF**: se le agregaron variables y documento |
| Historial de políticas, aprobaciones, ajustes, unificaciones, exportaciones | sus módulos | son las fuentes de la auditoría |
| Escritor de Excel y PDF | `exportacion/tabla.ts` | lo usan la exportación de catálogos, la planilla y la auditoría |
| Encabezado de PDF con marca | `pdf/marcaPdf.ts` | lo usa el consentimiento |

### Los catálogos de Digital Vet, uno por uno

De los 20 catálogos del menú **Mantenimientos**: **11 ya existían** (se enlazan), **8 faltaban** y se
crearon, **1 no aplica** (Compañías: Vetline no tiene convenios ni catálogo de servicios por
compañía; queda documentado sin construir). Los mantenimientos de otras industrias del ERP
—vehículos, embarques— tampoco aplican.

Lo que se creó: familias y subfamilias, marcas, ubicaciones físicas, unidades base, kits, imágenes
de producto, tipos de cliente y zonas; más tres catálogos clínicos (motivos de consulta, tipos de
corte y duraciones de receta) **dentro de la tabla que ya existía**.

---

## 2. Los tres hallazgos del relevamiento

### La bitácora es un registro de HTTP, no de eventos de negocio

`bitacora_auditoria.accion` guarda, en la mayoría de sus filas, **el método y la ruta**:
`GET /api/platform-admin/documentos`, 313 veces. No tiene valor anterior ni nuevo, y registra las
lecturas, que son ruido.

Lo que el §5 pide ver **ya está registrado, y mejor**, en las tablas de cada módulo. Por eso la
pantalla de Auditoría es una **lectura unificada de siete fuentes** y no un segundo registro: la
misma regla que el 10a aplicó a finanzas.

### Los cambios de precio no quedaban en ninguna parte

`inv_lista_precio_items.precio` se cambiaba —a mano o con la aplicación masiva del 06— y **no dejaba
rastro**. No se puede mostrar lo que nadie guardó. Se creó `inv_precios_historial` **con un
trigger**: es la única forma de que no se pueda cambiar un precio sin dejar rastro.

Para que el historial sepa **quién**, `app.persona_id` ahora viaja en la sesión junto a
`app.tenant_id` (un trigger no recibe parámetros).

### `inv_productos.categoria` era texto libre

Tres valores en toda la base. Se migró a `inv_familias` sin perder nada.

---

## 3. Decisiones de diseño, y por qué

1. **Catálogos es un punto de entrada, no una copia.** Cada catálogo declara `donde`: `"aqui"` o la
   ruta de la pantalla que ya lo edita. Copiar la pantalla de bodegas habría dejado dos lugares
   donde editar lo mismo.
2. **Las ausencias no son una tabla nueva.** `clinica_excepciones` ya bloquea la agenda con el nivel
   y el motivo correctos. Una segunda tabla obligaría a la agenda a consultar dos lugares.
3. **Pedir una ausencia no bloquea la agenda; aprobarla sí.** Lo contrario le cerraría la agenda a
   alguien a quien quizá no se las den.
4. **El libro de controlados no es una tabla de movimientos.** Lo único propio es el **cierre
   firmado**, que es un hecho nuevo y es **solo de agregar**.
5. **Los procedimientos van en una tabla por clínica**, no en `documentos_conocimiento`: esa es de
   plataforma, la comparten todos los tenants y su ámbito es por país y por agente.
6. **El kit no tiene existencias propias.** Si las tuviera habría dos verdades sobre lo mismo. Y un
   trigger rechaza los ciclos, incluso los largos.
7. **La lectura de un procedimiento se guarda con su versión.** Sin eso, un cambio de protocolo
   quedaría «leído» por todos sin que nadie lo lea.
8. **El turno avisa, no prohíbe.** El turno es organización de la clínica, no una regla sanitaria.
   Una clínica que no carga turnos no ve ningún aviso.

---

## 4. Las invariantes de dinero y de registro, en la base

| Invariante | Cómo |
|---|---|
| Una **liquidación aprobada** no se edita, ni se le agregan líneas, ni cambia de total, ni vuelve a borrador | dos triggers |
| Un **cargo no se liquida dos veces** | índice único `(cargo_id, es_ajuste)` |
| Un **ajuste** sin motivo no entra | `CHECK` |
| Un **porcentaje** de comisión mayor que 100 | `CHECK` |
| Un **cierre de controlados** firmado no se edita ni se borra | trigger, con excepción para la cascada |
| Un **kit** no se contiene a sí mismo, ni en cadena | trigger recursivo |
| Un producto tiene **una sola imagen principal** | índice único parcial |
| Un **desecho** sin peso ni volumen | `CHECK` |
| Un **permiso** con aviso fuera de 1–365 días | `CHECK` |
| Un **turno** que termina antes de empezar | `CHECK` |
| Un recurrente el día 29, 30 o 31 | `CHECK` (1 a 28: tiene que existir en febrero) |

Todas las tablas nuevas: `tenant_id` con `ON DELETE CASCADE`, `ENABLE` + **`FORCE ROW LEVEL
SECURITY`** y su política por `app.tenant_id`.

---

## 5. Las pantallas, con su camino de clics

Todas en **Administración › Catálogos, personal y cumplimiento** (`/admin/administracion`), con seis
pestañas en la URL:

| Pestaña | Qué hace | Permiso para editar |
|---|---|---|
| **Catálogos** | el mapa de los 30 catálogos; abre los que viven acá y enlaza los demás; exportar e importar con errores fila por fila | `catalogos.editar` |
| **Personal y turnos** | la semana con sus turnos, copiar a la siguiente, ausencias con su aprobación y las citas que quedan por reasignar, credenciales con su aviso, horas para el contador | `personal.gestionar` |
| **Comisiones** | reglas, liquidaciones, el detalle línea por línea, aprobar | `comisiones.aprobar` |
| **Cumplimiento** | permisos con su vencimiento, el libro de controlados con sus saldos y su cierre firmado, desechos | `cumplimiento.gestionar`, `controlados.firmar_cierre` |
| **Auditoría** | los eventos de las siete fuentes, con filtros y exportación | solo lectura, `auditoria.ver` |
| **Procedimientos** | los manuales de la clínica, con su versión y «lo leí» | `procedimientos.editar` |

**La entrada del menú no pide permiso**: cada pestaña tiene el suyo. Pedir un permiso para entrar
dejaría a la recepción sin poder leer los procedimientos que la clínica escribió para ella.

---

## 6. Las fuentes oficiales: qué se confirmó y qué no

**No se confirmó nada contra una fuente oficial, y por eso nada se presenta como obligación legal.**
Este entorno no tiene acceso al Ministerio de Salud, a SENASA ni al Colegio de Médicos Veterinarios.

Lo que se hizo en su lugar:

- los ocho permisos sembrados nacen con `sugerido = true`, y la pantalla lo dice con esas palabras:
  *«La lista viene sugerida, no confirmada»*;
- `cmp_permisos.fuente_confirmada` y `fuente_confirmada_en` existen para que, cuando alguien
  confirme, quede dicho **contra qué** y **cuándo**;
- al cargar los datos de un permiso, deja de estar marcado como sugerencia del sistema.

**Lo mismo con el formato de exportación del libro de controlados.** El prompt pide exportarlo «en
el formato que pida la fuente oficial, si existe uno». No se pudo confirmar si existe, así que el
libro se muestra en pantalla en formato tabular con todas las columnas que una inspección pediría
—fecha, producto, lote, motivo, cantidad con signo, paciente y médico que lo indicó— y **no se
inventó un formato oficial**. Queda como lo primero a confirmar con Medicavet.

---

## 7. Defectos encontrados

### Míos, encontrados al correr el verificador — los tres de la misma familia

1. **El saldo de controlados sumaba las salidas como entradas.** `inv_movimientos.cantidad_base` es
   **siempre positiva** (hay un `CHECK`) y la dirección vive en `inv_tipos_movimiento.direccion`. Con
   100 que entran y 20 que salen, mi consulta decía 120. **Era el número que el regente firma.**
2. **El cierre firmado bloqueaba la purga de la clínica.** Mismo defecto que la migración 126, que la
   129 ya había corregido una vez: un trigger de «solo de agregar» sin excepción también bloquea el
   `DELETE` en cascada.
3. **El historial de precios la rompía escribiendo.** Al borrar la clínica, el trigger intentaba
   insertar una fila con el `tenant_id` que se estaba borrando.

   Y acá hay algo que vale la pena anotar: **`fact_es_operacion_directa()` —`pg_trigger_depth() = 1`—
   no alcanzó**. Con la cascada desde `tenants`, la profundidad que ve el trigger sigue siendo 1, así
   que el guard no se activaba. La pregunta que sí funciona es la directa: **¿la clínica todavía
   existe?** (migración 162).

   **La regla, para la próxima:** un trigger que escribe en otra tabla tiene que preguntarse qué pasa
   cuando lo que se borra es el padre, y hay que **probarlo contra el borrado real**.

### Del código que ya estaba

4. **Los cambios de precio no se registraban** (ver §2).
5. **El verificador del 04 afirmaba que hay exactamente cinco permisos configurables.** El 10a agregó
   `finanzas.registrar` y el 11 `controlados.firmar_cierre`, los dos legítimamente configurables.
   Ahora verifica que **estén los cinco del 04** y que **ningún permiso clínico** sea configurable,
   que es lo que el prompt pedía.

---

## 8. Qué se verificó, y cómo

**No hay verificación en navegador: nadie abrió una pantalla.** Lo probado es el dominio contra la
base y la compilación.

| Escenario del prompt | Cómo |
|---|---|
| Familia «Antiparasitarios», productos y filtro | verificador, contra la base |
| Kit con tres componentes (y el ciclo rechazado) | idem |
| Consentimiento en PDF desde el expediente | idem: se comprueba que el PDF empieza con `%PDF-` y que la variable desconocida queda a la vista |
| Turnos de una semana copiados a la siguiente | idem, incluido que copiar dos veces no duplica |
| Vacaciones que bloquean la agenda | idem, **y que pedirlas no la bloquea** |
| Comisión del 10 % sobre cirugías, dos cobradas, liquidar, aprobar | idem: gana sobre la regla general del 5 % |
| Anular una después del cierre → ajuste en el siguiente | idem: la liquidación cerrada **no cambió** |
| Permiso sanitario con su vencimiento y su aviso | idem |
| Entrada y salida por paciente de un controlado, y cierre firmado | idem, con el saldo correcto y el cierre inmutable |
| Buscar en la auditoría quién anuló un cobro | idem, con el nombre de quien lo aprobó |
| Sin regresiones | `rutas_unicas`, `atencion_07c`, `anexo_07_03`, `complemento_08b_09b`, `ventas_caja`, `finanzas_10a`, `administracion_04` y el verificador **por HTTP** del 04 — todos en TODO OK |
| Compilación | `tsc --noEmit` limpio en backend y frontend |

---

## 9. Lo documentado sin construir

1. **Compañías / convenios y catálogo de servicios por compañía** (Mantenimientos de Digital Vet).
   Vetline no tiene convenios con aseguradoras ni precios por compañía. Construirlo es un modelo
   nuevo —convenio, cobertura, copago, facturación a un tercero— y toca caja y facturación.
2. **El formato oficial del libro de controlados** (§6).
3. **La carga masiva de imágenes de producto por código.** La tabla y la imagen por producto están;
   la carga masiva —un zip con los archivos nombrados por código— no se construyó. Lo que falta es
   el endpoint que recibe el zip y resuelve el código: el almacenamiento y el modelo ya están.
4. **La importación de catálogos desde Excel**: la validación fila por fila y la carga **sí están**;
   lo que la pantalla no hace todavía es **leer el archivo** (hoy recibe las filas ya parseadas). El
   lector de planillas del 06 se puede reusar tal cual.
5. **El aviso automático de vencimientos por correo.** Hoy el aviso se **ve en la pantalla** de
   personal y cumplimiento. Mandarlo por correo es agregar el tipo al job de notificaciones, que ya
   existe; no se hizo para no sumar un correo más sin que la clínica lo pida.
6. **`inv_productos.categoria`** sigue en la tabla como respaldo de la migración, con su `COMMENT`
   diciendo que no se interpreta. Se borra cuando nadie la lea.

---

## 10. Las migraciones

| # | Qué hace |
|---|---|
| 155 | familias/subfamilias, marcas, ubicaciones, unidades, kits (+trigger de ciclos), imágenes de producto, tipos de cliente, zonas, y los 3 catálogos clínicos que faltaban; migra `categoria` a familia |
| 156 | `personal_turnos`, `personal_credenciales`, y el estado/aprobación de las ausencias sobre `clinica_excepciones` |
| 157 | `com_reglas`, `com_liquidaciones`, `com_liquidacion_lineas` y los dos triggers de inmutabilidad |
| 158 | `cmp_permisos` (con la lista sugerida por disparador), `cmp_controlados_cierres`, `cmp_desechos` |
| 159 | `clinica_procedimientos` y sus lecturas, `inv_precios_historial` con su trigger, y los 10 permisos del 11 |
| 160 | el cierre firmado deja pasar el borrado en cascada |
| 161 | primer intento de lo mismo para el historial de precios (no alcanzó, y queda escrito por qué) |
| 162 | el guard que sí funciona: mirar si la clínica todavía existe |
