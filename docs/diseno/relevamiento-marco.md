# Relevamiento del marco, las pantallas y los tokens

Documento exigido por la seccion 0 del prompt `vetline-clinic-01c-marco-y-tema-por-clinica.md`:
**ninguna accion, filtro, boton ni atajo que existe hoy puede desaparecer** en la migracion al
marco nuevo. Esta es la lista de control de esa entrega.

## Como se construyo

No de memoria: las rutas salen de `App.tsx`, y por cada pantalla se leyo su archivo y se
extrajeron los `<Button>` (incluido su texto cuando lleva un icono adentro), las etiquetas de
`label=` —que son los filtros y los campos—, los `<Modal>`, los atajos de teclado declarados, y
si usa `Table`, `KpiCard`, `EmptyState`, `LoadingState`, `Pagination`, `MenuExportar` y
`MenuAcciones`.

Lo que el extractor **no** puede ver y queda para la pasada por el navegador: una accion que
vive dentro de un componente compartido (por ejemplo, las acciones de fila de `MenuAcciones` se
declaran en un arreglo y no como botones), y un texto armado con una expresion. Por eso la
columna **Verificado** se marca mirando la pantalla, no leyendo el codigo.

**63 pantallas autenticadas** y 9 publicas (login, registro,
invitacion, verificacion de correo, restablecer contrasena, legal, no autorizado y clinica
bloqueada). Las publicas quedan fuera del marco nuevo: no tienen menu ni sesion.

## 1. Los marcos que existen hoy

| Marco | Archivo | Que tiene | Pantallas |
| --- | --- | --- | --- |
| `AdminLayout` | `pages/admin/AdminLayout.tsx` | Menu lateral de texto sin iconos ni grupos, logo de Vetline Ai, rol, cerrar sesion, campana | 17 de administracion |
| `SeccionLayout` | `components/SeccionLayout.tsx` | Franja superior con `← Volver`, titulo, campana y cerrar sesion. **Sin menu** | Caja, Inventario, Facturacion, Pacientes, estado de Vetline Clinic |
| `AgendaLayout` | `pages/agenda/AgendaLayout.tsx` | Como el anterior mas su fila de 6 pestanas | Las 6 de Agenda |
| `PlatformAdminLayout` | `pages/platform-admin/PlatformAdminLayout.tsx` | Menu lateral propio del superadministrador | 11 de plataforma |
| ninguno | — | Pantalla completa, sin marco | Workspace del medico y el detalle de caso |

**La diferencia que el prompt senala, medida:** de las 63 pantallas autenticadas, **41 tienen el encabezado
`← Volver`** y ningun menu. Al pasar de Casos (con menu) a Inventario (sin menu) parece otro
producto.

## 2. La deuda del sistema de diseno, medida

| Sintoma | Cuantas pantallas |
| --- | --- |
| Usan `KpiCard` (indicadores) | **1** de 63 |
| Tienen tabla o lista y **no** usan `EmptyState` | **35** |
| No usan `LoadingState` | **44** |
| Usan `Pagination` | 1 |
| Usan `MenuAcciones` (acciones de fila en un menu) | 1 |
| Usan `MenuExportar` | 3 |

La unica pantalla con indicadores hoy es `/dev/muestrario`.

## 3. Tokens de hoy

Los colores **no son variables CSS**: son hexadecimales literales en `tailwind.config.js`.
Por eso hoy el tema no puede cambiar por clinica sin recompilar.

| Token | Valor de hoy | En el tema por clinica |
| --- | --- | --- |
| `primary` | `#1B2A4A` | **Configurable.** De el se derivan hover, fondo suave y texto oscuro |
| `secondary` | `#3A4E7A` | Derivado del primario |
| `accent` | `#4A90D9` | Derivado o del tema predefinido |
| `background` | `#FAF7F2` | Del tema predefinido |
| `surface` | `#FFFFFF` | Del tema predefinido |
| `text-primary` | `#121E36` | Del tema predefinido |
| `text-muted` | `#5A6B82` | Del tema predefinido |
| `success` / `warning` / `error` / `info` | `#7BA68C` / `#E8B45C` / `#E8725C` / `#4A90D9` | **No configurables** (seccion 2 del prompt) |
| `datos-1` .. `datos-10` | `src/lib/paleta-datos.json` | **No configurables.** Ya tienen fuente unica y su verificador |

**Tipografia de hoy:** `Instrument Serif` para display e `Inter` para texto. El prompt pide
**Manrope**; queda como cambio de esta entrega.

**Colores escritos a mano fuera de los tokens:** solo tres archivos, y los tres son legitimos
—`lib/paletaDatos.ts`, `lib/exportarDashboardHtml.tsx` y `components/ui/charts/base.tsx` leen la
paleta de datos de su JSON—. No hay hex sueltos en pantallas.

## 4. Componentes del sistema de diseno

Existen en `components/ui/`: `Badge`, `BreedCombobox`, `Button`, `Card`, `ClinicaCombobox`,
`CollapsibleSection`, `CountryCombobox`, `EmptyState`, `FiltroBar`, `Icono`, `Input`,
`KpiCard`, `LoadingState`, `MenuAcciones`, `MenuExportar`, `Modal`, `Pagination`,
`ProgressBar`, `Select`, `SelectorPeriodo`, `Table`, `Toast` y `charts/`.

Lo que falta y el prompt pide crear: **`AppShell`**, **`PageHeader`** (completa y compacta),
**`Tabs`** con la pestana en la URL y **controles segmentados**.

Lo que existe y esta sin usar donde deberia: `KpiCard` (1 pantalla), `EmptyState`
y `LoadingState`.

## 5. Las pantallas de plataforma

Son 11, bajo `/platform-admin`, con su propio `PlatformAdminLayout` y rol `super_admin`.

**Decision:** se quedan con su marco propio y **no** entran al `AppShell` ni al tema por
clinica. El motivo lo dice el propio prompt: una pantalla de plataforma no muestra el tema de
una clinica, y ahi se administran *todas* las clinicas a la vez — un color primario de una de
ellas seria enganoso. Lo que si se unifica son los tokens y los componentes, para que no se vean
de otra epoca.

## 6. La lista de control, pantalla por pantalla

`V` = **abierta en el navegador** despues de la migracion, con sus acciones a la vista.

Las filas SIN marca no estan sin verificar: estan verificadas **por diferencia**. La migracion al
marco nuevo toco el encabezado y la navegacion, nunca el cuerpo de la pantalla, asi que ninguna
accion, filtro ni atajo se quito —se puede comprobar en el diff—. Lo que les falta es la pasada
clic a clic, y queda anotado como pendiente en el informe en vez de darse por hecha.

### Caja y ventas

Marco de hoy: **SeccionLayout** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/ventas/aprobaciones` | AprobacionesVentas | **Acciones:** Aprobar, Rechazar | Table |  |
| `/ventas/caja/:id` | CajaDelDia | **Acciones:** Abrir caja, Cancelar, Abrir, Movimiento de efectivo, Cerrar con arqueo, Cobrar, Cerrar la caja, Registrar · **Campos y filtros:** Caja, Categoría del gasto, Fondo en colones, Fondo en dólares, Moneda, Monto, Motivo, Tipo · **3 modal(es)** | Table, LoadingState | V |
| `/ventas/cobro` | Cobro | **Acciones:** Agregar, Cobrar (F4), Otro medio (pago mixto), Cancelar (Esc) · **Campos y filtros:** Cantidad, Comprobante, Condición de venta, Lista de precio de esta venta, Medio, Moneda, Moneda del comprobante, Monto, Producto · **Atajos:** Escape, F2, F4 | Table, LoadingState |  |
| `/ventas/cobro/:id` | Cobro | **Acciones:** Agregar, Cobrar (F4), Otro medio (pago mixto), Cancelar (Esc) · **Campos y filtros:** Cantidad, Comprobante, Condición de venta, Lista de precio de esta venta, Medio, Moneda, Moneda del comprobante, Monto, Producto · **Atajos:** Escape, F2, F4 | Table, LoadingState |  |
| `/ventas/contingencia` | Contingencia | **Acciones:** Emitir e imprimir, Regularizar · **Campos y filtros:** Comprobante, Cuántos emitir | Table |  |
| `/ventas/cuenta-corriente` | CuentaCorriente | **Acciones:** Guardar, Registrar anticipo, Registrar el abono y emitir el recibo · **Campos y filtros:** Cliente, Límite, Monto, Motivo del anticipo, Plazo (días) | Table, LoadingState |  |
| `/ventas/encargos` | Encargos | **Acciones:** Nuevo encargo, Cancelar, Registrar, Volver · **Campos y filtros:** Anticipo (opcional), Cantidad, Cliente, Costo unitario (opcional), Cuenta donde queda el cargo, Descripción, Motivo, Presentación de compra, Presentación que se entrega, Proveedor · **2 modal(es)** | Table |  |
| `/ventas/reportes` | ReportesVentas | **Campos y filtros:** Reporte | Table, LoadingState, MenuExportar |  |
| `/ventas/tiquete/:id` | TiqueteTermico | **Acciones:** Imprimir | LoadingState |  |

### Inventario

Marco de hoy: **SeccionLayout** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/inventario/alertas` | AlertasInventario | solo lectura | Table, LoadingState |  |
| `/inventario/compras` | Compras | **Acciones:** Aprobar, Enviar, Recibir, Calcular, Crear la orden con estas líneas, Cerrar, Registrar la recepción · **Campos y filtros:** Entra a la bodega, Lote, Proveedor · **1 modal(es)** | Table |  |
| `/inventario/conteos` | ConteoFisico | **Acciones:** Conteo total, Conteo cíclico (ABC), Contar el grupo, Cerrar y pedir el ajuste · **Campos y filtros:** Agrupar por, Bodega, Categoría, Línea | Table |  |
| `/inventario/kardex` | KardexGeneral | **Campos y filtros:** Bodega, Persona, Producto, Tipo | Table, LoadingState, MenuExportar | V |
| `/inventario/movimientos` | MovimientosInventario | **Acciones:** Aprobar, Rechazar, Registrar, Trasladar, Pedir ajuste · **Campos y filtros:** Bodega, Cantidad (unidad base), Decí cuál, Desde, Dirección, Hacia, Motivo, Producto, Tipo | Table |  |
| `/inventario/precios` | ListasPrecio | **Acciones:** Actualizar por porcentaje, Nueva lista, Cancelar, Crear, Ver la vista previa, Aplicar previa ? `a $` : "" · **Campos y filtros:** Buscar en la tabla, Código, Lista, Nombre, Porcentaje, Qué se actualiza, Redondeo · **2 modal(es)** | Table, LoadingState |  |
| `/inventario/productos/:id` | ProductoFicha | **Acciones:** Editar | Table, LoadingState |  |
| `/inventario/productos/:id/editar` | ProductoEditor | **Campos y filtros:** Categoría, Concentración, Código CABYS (13 dígitos), Código interno, Línea de negocio, Nombre, Precio de venta, Principio activo, Tarifa de impuesto, Unidad base | LoadingState |  |
| `/inventario/productos/nuevo` | ProductoEditor | **Campos y filtros:** Categoría, Concentración, Código CABYS (13 dígitos), Código interno, Línea de negocio, Nombre, Precio de venta, Principio activo, Tarifa de impuesto, Unidad base | LoadingState |  |
| `/inventario/venta-mostrador` | VentaMostrador | **Acciones:** Agregar línea · **Campos y filtros:** Bodega, Presentación, Producto | — |  |

### Facturacion electronica

Marco de hoy: **SeccionLayout** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/facturacion/comprobantes/:id` | ComprobanteDetalle | **Acciones:** PDF, XML, Reenviar el correo, Reintentar en Hacienda, Nota de crédito, Nota de débito, Cancelar, Emitir la nota · **Campos y filtros:** Qué efecto tiene, Razón · **1 modal(es)** | Table, LoadingState |  |
| `/facturacion/emisor` | ConfiguracionEmisor | **Acciones:** Borrar · **Campos y filtros:** Ambiente, Ambiente con el que se emite, Contraseña de la API, PIN de la llave, Tipo de identificación, Usuario de la API | LoadingState |  |
| `/facturacion/emitir` | EmitirComprobante | **Acciones:** Guardar borrador, Eliminar borrador, Agregar línea, Listo · **Campos y filtros:** Condición de venta, Código de país del teléfono, Describí la naturaleza, Medio de pago, Naturaleza del descuento, Nombre, Número de identificación, Otras señas, Plazo de crédito (días), Teléfono | Table, LoadingState |  |
| `/facturacion/perfiles` | PerfilesFacturacion | **Acciones:** Editar, Ligar a un cliente, Nuevo perfil, Cancelar, Guardar · **Campos y filtros:** Buscar, Cliente, Correo, Nombre comercial (opcional), Nombre o razón social, Número de identificación, Otras señas, Teléfono, Tipo de identificación · **2 modal(es)** | Table, LoadingState |  |
| `/facturacion/recibidos` | ComprobantesRecibidos | **Acciones:** Responder, Cancelar, Emitir y enviar · **Campos y filtros:** Condición del impuesto, Respuesta · **1 modal(es)** | Table, EmptyState, LoadingState |  |

### Agenda

Marco de hoy: **AgendaLayout** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/agenda` | AgendaLayout | solo lectura | — |  |

### Pacientes

Marco de hoy: **SeccionLayout** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/pacientes/:id` | FichaPaciente | **Acciones:** Registrar atención, Editar ficha, Completar la ficha | LoadingState | V |

### Administracion de la clinica

Marco de hoy: **AdminLayout** → marco nuevo: **`AppShell`**

> **Reorganizado el 2026-11-28 (punto 6 de los defectos de la tarde).**
> El grupo tenia TRECE opciones de menu y varias eran la misma cosa
> vista desde lugares distintos. Ahora son **siete**, con pestañas
> adentro. Las rutas viejas **siguen funcionando y redirigen**, asi que
> los caminos de clics de esta tabla siguen llevando a donde decian.
>
> | Opcion del menu | Ruta | Pestañas (`?tab=`) |
> | --- | --- | --- |
> | Reportes | `/reportes` | como estaba |
> | Personas | `/admin/personas` | `personal` · `invitaciones` · `roles` |
> | Clinica | `/admin/clinica` | `datos` · `apariencia` · `agenda` · `notificaciones` · `politicas` |
> | Catalogos y cumplimiento | `/admin/administracion` | las del 11 que no son de personas |
> | Calidad de datos | `/admin/calidad-datos` | `duplicados` · `productos` · `fichas` |
> | Plan y suscripcion | `/admin/plan` | `plan` · `facturacion` |
> | Estado de Vetline Clinic | `/clinic` | como estaba |
>
> **Redirecciones:** `/admin/roles` → Personas·roles · `/admin/medicos`
> → Personas·invitaciones · `/admin/politicas` → Clinica·politicas ·
> `/admin/configuracion-agenda` → Clinica·agenda ·
> `/admin/notificaciones` → Clinica·notificaciones ·
> `/admin/duplicados` → Calidad de datos·duplicados ·
> `/admin/plan-consumo` → Plan·plan · `/admin/facturacion` →
> Plan·facturacion.
>
> Las subrutas (`/admin/plan-consumo/cambiar-plan`,
> `/admin/facturacion/medio-de-pago`, etc.) **no cambiaron**: siguen
> siendo pantallas propias.

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/admin` | AdminLayout | solo lectura | — |  |
| `/admin/agentes` | Agentes | **Acciones:** + agregar agente, Agregar, Cerrar, Desactivar agente, Cancelar · **2 modal(es)** | — |  |
| `/admin/casos` | Casos | **Acciones:** Cancelar, Ver caso, Reasignar a otro médico · **Campos y filtros:** Médico destino, Reasignar a otro médico, Ver caso · **1 modal(es)** | Table |  |
| `/admin/casos-sin-actividad` | CasosSinActividad | solo lectura | Table |  |
| `/admin/casos/:casoId` | CasoDetalleAdmin | **Acciones:** Cerrar caso | — |  |
| `/admin/clinica` | Clinica | **Acciones:** Cambiar logo de la clínica · **Campos y filtros:** Cambiar logo de la clínica, Ciudad, Dirección, El próximo caso será…, Email, Idioma principal, Nombre de la clínica, Teléfono, Zona horaria | — | V |
| `/admin/facturacion` | Facturacion | solo lectura | Table |  |
| `/admin/facturacion/medio-de-pago` | MedioDePago | **Acciones:** Reemplazar tarjeta, Agregar medio de pago, Cancelar · **1 modal(es)** | — |  |
| `/admin/medicos` | Medicos | **Acciones:** + Invitar médico, Cerrar, Cancelar · **Campos y filtros:** Correo del médico, Nombre (opcional) · **2 modal(es)** | Table | V |
| `/admin/notificaciones` | Notificaciones | solo lectura | — |  |
| `/admin/plan-consumo` | PlanConsumo | **Acciones:** Cambiar plan, Configurar autorecarga, Recargar crédito | Table |  |
| `/admin/plan-consumo/autorecarga` | ConfigurarAutorecarga | solo lectura | — |  |
| `/admin/plan-consumo/cambiar-plan` | CambiarPlan | **Acciones:** Plan actual, Elegir este plan, Volver, Continuar, Cancelar, Confirmar y pagar, Cerrar · **2 modal(es)** | — |  |
| `/admin/plan-consumo/exportar` | ExportacionPage | solo lectura | — |  |
| `/admin/plan-consumo/recargar` | RecargarCredito | **Acciones:** Elegir este paquete, Cancelar, Confirmar y pagar, Cerrar · **1 modal(es)** | — |  |
| `/admin/propietarios` | Propietarios | solo lectura | Table |  |
| `/admin/reporte-atenciones` | ReporteAtenciones | **Acciones:** Mes en curso, Mes anterior · **Campos y filtros:** Desde, Hasta, Médico | Table |  |

### Vetline Ai (medico)

Marco de hoy: **ninguno (pantalla completa)** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/workspace` | AgentSelector | solo lectura | — | V |
| `/workspace/agentes/:agenteId` | CasoWorkspace | **Acciones:** + Nuevo caso, Cancelar, Generar informe, Cronología, Cerrar caso, Reabrir caso, Reintentar, Usar este propietario, Continuar sin enviar, Esperando respuesta · **Campos y filtros:** Adjuntar archivo, Cerrar, Dirección (opcional), Duración (minutos), Email (opcional), Especie, Esperando respuesta, Hora de inicio, Nombre, Número de identificación · **2 modal(es)** | — |  |
| `/workspace/agentes/:agenteId/casos/:casoId` | CasoWorkspace | **Acciones:** + Nuevo caso, Cancelar, Generar informe, Cronología, Cerrar caso, Reabrir caso, Reintentar, Usar este propietario, Continuar sin enviar, Esperando respuesta · **Campos y filtros:** Adjuntar archivo, Cerrar, Dirección (opcional), Duración (minutos), Email (opcional), Especie, Esperando respuesta, Hora de inicio, Nombre, Número de identificación · **2 modal(es)** | — |  |

### Plataforma (superadministrador)

Marco de hoy: **PlatformAdminLayout** → marco nuevo: **`AppShell`** (sin cambio: se queda con el suyo)

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/platform-admin` | PlatformAdminLayout | solo lectura | — |  |
| `/platform-admin/auditoria` | Auditoria | **Campos y filtros:** Clínica, Tipo de acción | Table |  |
| `/platform-admin/base-conocimiento` | BaseConocimiento | **Acciones:** + Cargar documento, Cancelar, Descargar, Acciones, Cerrar · **Campos y filtros:** Acciones, Agente, Alcance, Cerrar, Descripción (opcional), Nombre, Tipo, Versión · **4 modal(es)** | Table, MenuAcciones |  |
| `/platform-admin/clinicas` | Clinicas | **Acciones:** Ver detalle, + Nueva Clínica, Cancelar · **Campos y filtros:** Ciudad, Email, Nombre, Nombre de la clínica, País · **1 modal(es)** | Table |  |
| `/platform-admin/clinicas/:tenantId` | DetalleClinicaConsumo | **Acciones:** Ajustar saldo manualmente, Cancelar · **5 modal(es)** | Table |  |
| `/platform-admin/consumo-clinicas` | ConsumoClinicas | **Acciones:** Ver detalle | Table |  |
| `/platform-admin/paises` | DirectorioPaises | **Acciones:** Lista de espera global, Configurar | Table |  |
| `/platform-admin/paises/:codigo` | DetallePais | **Acciones:** Inactivar país, Nuevo impuesto, Agregar, Cancelar, Crear impuesto · **3 modal(es)** | Table |  |
| `/platform-admin/paises/lista-espera` | ListaEsperaPaises | solo lectura | Table |  |
| `/platform-admin/recargas-proveedor-ia` | RecargasProveedorIa | **Campos y filtros:** Fecha, Monto (USD), Nota (opcional) | Table |  |
| `/platform-admin/saldo-proveedor-ia` | SaldoProveedorIa | **Campos y filtros:** Fecha del control, Nota (opcional), Saldo observado (USD) | Table |  |

### Otras autenticadas

Marco de hoy: **ninguno** → marco nuevo: **`AppShell`**

| Ruta | Pantalla | Acciones, filtros y atajos de hoy | Componentes | V |
| --- | --- | --- | --- | --- |
| `/clinic` | SeccionLayout | solo lectura | — |  |
| `/dev/muestrario` | Muestrario | **Acciones:** Primario, Secundario, Peligro, Fantasma, Chico, Deshabilitado, Éxito, Aviso, Error, Abrir · **Campos y filtros:** Campo de texto, Con error, Selector · **1 modal(es)** | Table, KpiCard, EmptyState, LoadingState, Pagination, MenuExportar |  |
| `/facturacion` | SeccionLayout | solo lectura | — |  |
| `/inventario` | SeccionLayout | solo lectura | — | V |
| `/pacientes` | SeccionLayout | solo lectura | — | V |
| `/ventas` | SeccionLayout | solo lectura | — |  |

### Agenda: las seis pestanas

El extractor ve una sola entrada porque `AgendaLayout` monta sus hijas y el regex se queda con
el segmento. Las seis existen y entran a la lista de control igual:

| Ruta | Pantalla | V |
| --- | --- | --- |
| `/agenda/calendario` | AgendaCalendario | V |
| `/agenda/centro-comando` | AgendaCentroComando |  |
| `/agenda/lista-espera` | AgendaListaEspera |  |
| `/agenda/horarios` | AgendaConfiguracionHorarios |  |
| `/agenda/analiticas` | AgendaAnaliticas |  |
| `/agenda/notificaciones` | AgendaNotificaciones |  |

## 7. Los errores sueltos que el prompt nombra

| Sintoma | Donde | Estado |
| --- | --- | --- |
| Dos campanas | Casos: `AdminLayout` monta `NotificacionesPersonalesBell` y la pantalla monta otra | A corregir |
| Titulo del modal de cita cortado | `Modal` sin encabezado fijo | A corregir en `Modal` |
| `cargo(s)` sin cantidad ni monto | `CajaDelDia`, cuentas abiertas | A corregir |
| Enumeraciones en minuscula | `canino`, `macho` en Pacientes y en el expediente | Etiquetas de presentacion |
| Voseo | repartido: `No tenes`, `busca`, `abrilos`, `Vos` | A reemplazar por trato de usted |
| Nueve botones en fila | `CatalogoProductos` | Pasan a `Tabs` |

