# Estado antes del 11 — relevamiento verificado contra el código y el esquema

Punto 0 del prompt `vetline-clinic-11-administracion-completa.md`. Hecho el 27 de noviembre de 2026,
consultando el esquema real de la base y el código.

---

## Tabla 1 — lo que ya existe, y dónde

| Qué | Dónde | Qué se hace con eso en el 11 |
|---|---|---|
| Personas, roles y permisos | `personas`, `roles`, `permisos`, `rol_permisos`, `persona_roles` (04) | se reusan; los permisos nuevos se agregan a la misma matriz |
| Horario de la clínica y del médico | `clinica_horario` (04), `horarios_configuracion` por médico | el **turno** es más fino que el horario: el horario dice cuándo puede, el turno cuándo le toca. La agenda consulta los dos |
| Bloqueos de agenda, vacaciones y feriados | `clinica_excepciones` (04), con `tipo` y `medico_id` | **las ausencias son esa tabla**: se le agregan estado y aprobación en vez de crear una segunda |
| Quién realizó y quién refirió cada cargo | `vta_cargos.realizado_por` y `.referido_por` (08b) | es la base de las comisiones. **Ya estaba y nadie lo leía** |
| Productos controlados | `inv_productos.es_controlado` (06) | el libro de controlados se arma con esos productos. Hoy hay **0 productos marcados** en la base de desarrollo |
| Movimientos de inventario por paciente | `inv_movimientos`, con `paciente_id` y `atencion_id` | de ahí salen las entradas y salidas del libro: **sin un segundo registro** |
| Bitácora de escrituras | `bitacora_auditoria` (`persona_id`, `accion`, `entidad`, `entidad_id`, `detalle` jsonb) | ver el hallazgo de abajo: **no sirve sola** para la pantalla de auditoría |
| Archivos y su almacenamiento | `archivos` + `almacenamiento/` (MinIO/S3) | las imágenes de productos, los documentos de cumplimiento y los procedimientos usan ese almacenamiento |
| Base de conocimiento de Vetline Ai | `documentos_conocimiento` (plataforma, por agente y por país) | **no sirve para los procedimientos de una clínica**: es de plataforma y su `ambito` no es por tenant. Los procedimientos van en su propia tabla por clínica |
| Catálogos clínicos por clínica | `exp_catalogos_clinicos`, 13 tipos (mucosas, hidratación, actitud, dolor, sistema de examen, vía, frecuencia, unidad de dosis, carácter, hábitat, tipo de dieta, pelaje, motivo de baja) | **se extiende con los que faltan** en vez de crear tablas nuevas |
| Insumos por servicio | `inv_servicio_insumos` (06) | ya existe: se **enlaza** desde Catálogos |
| Unidades de Hacienda | `fact_cat_unidad_medida` (09a) | no se editan: son de Hacienda |
| Plantillas de consentimiento | `exp_plantillas_consentimiento` (`tipo`, `titulo`, `cuerpo`) | existe y **no genera PDF**: el 11 le agrega las variables y el PDF |
| Plantillas de atención | `exp_plantillas_atencion` (07c) | se enlaza |
| Exportaciones de datos | `exportaciones` (`solicitada_por`, `estado`, `creada_en`) | es una de las fuentes de la auditoría |
| Historial de políticas | `politicas_historial` (04) | fuente de la auditoría: los cambios de política ya quedan con valor anterior y nuevo |
| Aprobaciones de caja | `vta_aprobaciones` (08b) | fuente de la auditoría: anulaciones y descuentos autorizados |
| Ajustes de inventario | `inv_ajustes` (`motivo`, `solicitado_por`, `aprobado_por`) | fuente de la auditoría |
| Unificaciones de clientes | `crm_unificaciones` (anexo 07-03 B1) | fuente de la auditoría |

### Hallazgo 1 — la bitácora es un registro de HTTP, no de eventos de negocio

`bitacora_auditoria.accion` guarda, en la mayoría de sus filas, **el método y la ruta**:
`GET /api/platform-admin/documentos` (313 filas), `POST /api/citas`, `POST /api/pacientes`. Hay un
puñado de acciones semánticas —`admin_reasigno_caso`, con `detalle` jsonb que sí trae el médico
anterior y el nuevo—, pero la regla es la ruta.

Consecuencias, y por eso la pantalla de auditoría del §5 **no se construye sobre esa tabla sola**:

1. **registra los GET**, que son ruido: una pantalla con 313 lecturas de documentos entre dos
   anulaciones no se puede leer;
2. **no tiene valor anterior ni nuevo** salvo donde alguien lo puso a mano en `detalle`;
3. **los eventos que el prompt pide ya viven en otro lado, y mejor**: los cambios de política en
   `politicas_historial`, las anulaciones y los descuentos en `vta_aprobaciones`, los ajustes en
   `inv_ajustes`, las fusiones en `crm_unificaciones`, las exportaciones en `exportaciones`.

**Decisión:** la auditoría del 11 es una **lectura unificada** de esas fuentes, más la bitácora
filtrada a sus acciones semánticas. No se crea un segundo registro de lo que ya está registrado —es
la misma regla que «finanzas consolida, no recaptura» del 10a—.

### Hallazgo 2 — los cambios de precio no quedan en ninguna parte

`inv_lista_precio_items` tiene `precio` y **ninguna historia**. La aplicación masiva de precios del
06 cambia esa columna y no deja rastro de qué valía antes. El §5 pide ver los cambios de precio en la
auditoría, así que **hay que crear la historia**: se hace con un trigger, que es la única forma de
que no se pueda escribir un precio sin dejar rastro.

### Hallazgo 3 — `inv_productos.categoria` es texto libre

Tres valores en toda la base de desarrollo: «Antibióticos», «Antiparasitarios», «Insumos clínicos».
Se migran a `inv_familias` sin perder lo cargado, y la columna de texto queda como respaldo hasta que
nadie la lea.

---

## Tabla 2 — los catálogos de Digital Vet contra Vetline

Fuentes: `docs/relevamientos/digital-vet-relevamiento-funcional.md` (sección 3.3 y el mapa de
módulos) y el menú **Mantenimientos** descrito en el prompt.

| Catálogo de Digital Vet | Estado en Vetline | Qué se hace |
|---|---|---|
| **Servicios** | existe: `inv_servicios` | se enlaza desde Catálogos |
| **Egresos** (categorías de gasto) | existe desde el 10a: `fin_categorias_gasto` | se enlaza |
| **Clientes: tipo de cliente** | **falta** | se crea `crm_tipos_cliente` + `propietarios.tipo_cliente_id` |
| **Clientes: zona** | **falta** | se crea `crm_zonas` + `propietarios.zona_id` |
| **Clientes: fuente de referencia** | existe: `crm_fuentes_referencia` (anexo B3) | se enlaza |
| **Compañías** (aseguradoras y convenios) | **no aplica todavía**: Vetline no tiene convenios ni catálogo de servicios por compañía. Queda documentado, no se construye |
| **Agenda: tipos de cita** | existe: `tipos_cita` (04) | se enlaza |
| **Agenda: salas** | existe: `salas` | se enlaza |
| **Agenda: feriados y bloqueos** | existe: `clinica_excepciones` (04) | se enlaza |
| **Veterinaria: especies y razas** | existe: `especies`, `razas` | se enlaza |
| **Veterinaria: protocolos de vacunación** | existe: `exp_protocolos_preventivos` | se enlaza |
| **Veterinaria: hábitat, carácter, pelaje, tipo de dieta, motivo de baja** | existe: `exp_catalogos_clinicos` | se enlaza |
| **Veterinaria: motivos de consulta** | **falta** | se agrega como tipo de `exp_catalogos_clinicos` |
| **Veterinaria: tipos de corte de grooming** | **falta** | idem |
| **Recetas: vía, frecuencia, unidad de dosis** | existe: `exp_catalogos_clinicos` | se enlaza |
| **Recetas: duraciones** | **falta** | idem |
| **Recetas: dosis** | **no aplica como catálogo**: la dosis es un número y sale del peso y del producto (07c) |
| **Transacciones** (tipos de movimiento) | existe: `inv_tipos_movimiento` y `inv_motivos` | se enlaza |
| **Inventarios: bodegas** | existe: `inv_bodegas` | se enlaza |
| **Inventarios: insumos** | existe: `inv_productos` | se enlaza |
| **Inventarios: insumos por servicio** | existe: `inv_servicio_insumos` | se enlaza |
| **Inventarios: insumos compuestos (kits)** | **falta** | se crea `inv_producto_componentes` con descuento por FEFO al vender |
| **Inventarios: clasificación de insumos** (familia, subfamilia, marca, ubicación) | **falta**: hoy es `categoria` en texto libre | se crea `inv_familias` (con subfamilia por autorreferencia), `inv_marcas`, `inv_ubicaciones` |
| **Inventarios: unidades de medida** | parcial: las de Hacienda están (`fact_cat_unidad_medida`) y la unidad base del producto es texto | se crea `inv_unidades` editable para la unidad base |
| **Inventarios: familias** | igual que clasificación | idem |
| **Cargador de imágenes de insumos** | **falta** | se crea `inv_producto_imagenes` sobre el almacenamiento existente, con carga masiva por código |
| **Plantillas del sistema** | parcial: `exp_plantillas_consentimiento` y `exp_plantillas_atencion` existen; las de mensajes viven en Notificaciones y el CRM | se completan las clínicas (variables + PDF) y se enlazan las demás |
| **Vehículos, embarques y los demás mantenimientos del ERP** | **no aplica**: son de otras industrias del ERP de Grupo Argus |

### Lo que este relevamiento decide

1. **Ningún catálogo se duplica.** Catálogos es **un punto de entrada**: lo que ya tiene pantalla en
   su módulo se enlaza. Lo contrario —copiar la pantalla de bodegas a Catálogos— deja dos lugares
   donde editar lo mismo.
2. **Las ausencias son `clinica_excepciones`.** Esa tabla ya bloquea la agenda con el nivel y el
   motivo correctos (04). Crear `personal_ausencias` significaría que la agenda tendría que consultar
   dos tablas y que un día una diría que sí y la otra que no.
3. **El libro de controlados no es una tabla nueva.** Se arma desde `inv_movimientos`. Lo único
   propio es el **cierre firmado por el regente**, que es un hecho nuevo.
4. **La auditoría es una lectura unificada** (hallazgo 1), más la historia de precios que falta
   (hallazgo 2).
5. **Los procedimientos de la clínica van en una tabla por clínica**, no en
   `documentos_conocimiento`: esa es de plataforma, la comparten todos los tenants y su ámbito es por
   país y por agente. Un protocolo de limpieza del quirófano de Medicavet no puede vivir ahí.
