# Vetline Clinic 06 — Catálogo, inventario y compras

Rama `vetline-clinic/06-inventario`, sacada de `vetline-clinic/facturador-cr`.
Módulo `inventario`. Migración **095**, 22 tablas.

---

## 1. Lo relevado antes de diseñar

El prompt pide relevar lo que ya existe y **vincular** en vez de duplicar. Lo que hay en Vetline Ai
y cómo quedó el vínculo:

| Qué existe | Cómo se usa hoy | Qué hizo el módulo |
|---|---|---|
| `medicamentos` | Catálogo de plataforma (`tenant_id` nulo) más los propios de cada clínica. Campos: nombre, principio activo, `presentacion` **como TEXTO**, concentración, rangos de dosis. | `inv_productos.medicamento_id` apunta ahí, nullable, `ON DELETE SET NULL`. **No se duplicó nada** y **no se tocó la tabla**. |
| `receta_items` | `medicamento_id` + dosis/frecuencia/duración en texto libre. | Queda como está. Con el vínculo de arriba, una receta ya puede resolver qué producto del inventario dispensa: `receta_items → medicamentos ← inv_productos`. |
| `medicamento_dosis_especie` | Dosis por especie (canino/felino). | Sin cambios. |
| `cuidados_preventivos` | Vacuna, lote y producto **como texto libre**. | Sin cambios, **a propósito**: migrar su contenido a productos está declarado fuera de este prompt. |

**Lo que NO se pudo vincular, y por qué.** `medicamentos.presentacion` es un texto libre
("Comprimidos 500 mg", "Frasco 100 ml") y `inv_presentaciones` es una tabla con factor de
conversión. No hay forma automática de convertir uno en el otro sin inventar el factor, que es
justamente el número que no se puede adivinar. El vínculo queda a nivel de PRODUCTO, no de
presentación, y eso alcanza para lo que el prompt pide.

---

## 2. La regla central, y todo lo que se deriva de ella

**Todo el stock vive en unidad base.** La más chica en que el producto se mueve: tableta, ml, g,
unidad. Nunca en cajas ni en litros.

Si se guardara en cajas, vender 3 tabletas de una caja de 20 daría 0,85 cajas, y a las veinte
ventas el inventario estaría descuadrado por redondeo sin que nadie pueda decir dónde. Guardando
tabletas, vender 3 resta 3 y la cuenta cierra siempre.

La **presentación** es la forma de comprar, vender o consumir, con su factor. Mover una presentación
mueve `cantidad × factor` de la misma existencia.

### Los tres ejemplos del prompt, verificados

| Caso | Compra | Venta / consumo | Resultado |
|---|---|---|---|
| Caja de 20 tabletas | 5 cajas → **100 tabletas** | 1 caja → **−20**; 3 tabletas → **−3** | 77 |
| Litro de alcohol | 2 litros → **2 000 ml** | 1 dosis de 100 ml → **−100** | 1 900 |
| Kilo de algodón | 1 kg → **1 000 g** | 5 g → **−5** | 995 |

---

## 3. Lo construido

### 3.1 En la base (migración 095)

- **`lineas_negocio` y `especialidades`, SIN prefijo `inv_`.** La guía rectora §3 las define como
  las dimensiones de todo ingreso y toda salida, así que son catálogo compartido y no una columna
  de texto dentro de productos. Una columna de texto daría "Farmacia", "farmacia" y "FARMACIA" como
  tres líneas distintas en el primer dashboard.
- **`inv_tipos_movimiento` con los trece tipos y su dirección FIJA.** La dirección vive en la base,
  no en un `switch`: un tipo nuevo agregado a la tabla y olvidado en el switch entraría sumando
  donde debía restar, y el inventario quedaría mal sin que nada falle.
- **La existencia vive en `inv_lotes`**, no en una tabla aparte: el lote ya es "este producto, en
  esta bodega, de esta tanda", y una segunda tabla con las mismas tres claves habría que mantenerla
  en acuerdo.
- **`vencimiento_efectivo` es una columna GENERADA** (el menor entre el del lote y el de la
  apertura), porque la alerta de "por vencer", el FEFO y la pantalla tienen que leer el mismo
  número.
- **Tres reglas por trigger:** los movimientos solo se agregan; la existencia no queda negativa
  salvo que el producto lo permita; y la dirección la aplica la base leyendo el catálogo, así que el
  código nunca elige el signo.

### 3.2 El punto único

`inventario/movimientos.ts` → `registrarMovimiento`. Caja, la atención, las compras, los ajustes y
los conteos pasan todos por ahí. Nadie escribe en `inv_lotes` por fuera.

Ahí vive **la** conversión a unidad base, el **FEFO** con reparto entre lotes (cada salida con el
costo de *su* lote) y el registro del **envase abierto**.

### 3.3 El resto del backend

Ajustes con umbral **en dinero** (ajustar mil gasas baratas no es lo mismo que una ampolla cara);
orden sugerida explicable línea por línea; recepción parcial y total; conteos que **congelan** la
existencia al abrir; importación con validación fila por fila y carga atómica; trazabilidad por
origen con drill-down; seis grupos de alertas.

### 3.4 La interfaz

Nueve pantallas, entrada al menú gateada por el módulo y ocho comandos en la paleta.

---

## 4. Verificación, con resultados

| Verificador | Qué cubre | Resultado |
|---|---|---|
| `verificar_inventario_movimientos` | 12 secciones: los tres ejemplos, costo por tableta, bonificación, FEFO con reparto, envase abierto, **los trece tipos**, negativo rechazado, concurrencia, inmutabilidad, traslado ligado, devolución al lote original, presentación cruzada | **TODO OK** |
| `verificar_inventario_compras` | 9 secciones: presentación de existencia, ajustes bajo/sobre umbral, "Otro" sin detalle, **orden sugerida calculada a mano**, recepción parcial y total, conteo que congela, importación, drill-down, alertas | **TODO OK** |
| `verificar_api_facturacion` | regresión del facturador | 91 OK, 0 FAIL |
| `verificar_emitir_ajustes` | regresión de los ajustes de "Emitir" | TODO OK |
| `verificar_ubicacion` | regresión de la codificación | TODO OK |
| `verificar_purga_completa` | la purga con las 22 tablas nuevas | 19 OK, 0 FAIL |
| `verificar_auditoria_rls_reforzada` | RLS en las 22 tablas nuevas | TODO OK |
| `verificar_facturacion_modelo` | regresión | TODO OK |

`tsc` limpio en backend y frontend; `vite build` limpio.

### Los puntos del prompt, uno por uno

| Pide | Dónde se comprueba |
|---|---|
| Los tres ejemplos de presentación | movimientos §1, §2, §3 |
| Existencia en presentación y unidad base, con restos | compras §1 — `"3 cajas y 7 tabletas (67 tabletas)"` |
| Costo por tableta = caja / 20; bonificación baja el costo | movimientos §1, §4 (12 por el precio de 10 → costo 100, no 120) |
| FEFO y envase abierto | movimientos §5, §2 |
| Los 13 tipos en su dirección, ninguno al revés | movimientos §6 |
| Venta de mostrador de 3 tabletas y devolución al lote | movimientos §1, §11 |
| Ajuste positivo y negativo; sobre el umbral espera | compras §2 |
| Negativo rechazado salvo si se permite; dos salidas simultáneas | movimientos §7, §8 (dos conexiones reales) |
| Un movimiento no se edita ni se borra | movimientos §9 |
| Orden sugerida coherente, **calculada a mano en el test** | compras §4 |
| Importación rechaza con motivo y carga atómica | compras §7 |
| Drill-down con pacientes y sin paciente aparte | compras §8 |
| Auditoría de RLS limpia y verificadores en verde | tabla de arriba |

---

## 5. Hallazgos

### 5.1 Dos errores reales encontrados al verificar

1. **`SELECT max(...) ... FOR UPDATE`** para numerar las órdenes: Postgres no lo permite con
   agregados (`0A000`), y bloquear la última fila tampoco serviría cuando la clínica todavía no
   tiene ninguna orden. Pasó a `pg_advisory_xact_lock` por clínica.
2. **Ambigüedad de tipo de parámetro en `CASE WHEN`** (`42P08`, "text versus character varying").
   Es la **tercera vez** que este proyecto la encuentra: ya había aparecido en `fijarEstadoModulo` y
   en los estados de agentes por país. Cast explícito a `varchar` en los dos usos.

### 5.2 Un defecto de los datos de demostración, corregido

La primera corrida de la siembra dio **11 de 13** tipos de movimiento, no 13: faltaban `atencion`
(la clínica de demostración no tenía pacientes) y `ajuste_negativo` (el ajuste grande quedó
pendiente, que es el comportamiento correcto). El script ahora crea un paciente de demostración,
agrega un ajuste negativo chico que sí se aplica, y **avisa** si quedan tipos sin usar en vez de dar
la lista por completa.

---

## 6. Decisiones tomadas sin consultar

1. **`lineas_negocio` y `especialidades` son catálogo global, sin `tenant_id`.** La lista la fija la
   guía rectora. Que una clínica agregue una propia es una decisión de producto que merece su
   migración, no una fila suelta.
2. **`unidad_base` es texto libre corto y no una FK al catálogo de Hacienda.** Las unidades fiscales
   (Nota 15) son las de la **factura**; "tableta" no está ahí y es exactamente la unidad base
   correcta de una caja de 20. La unidad fiscal vive en la presentación, que es lo que se factura.
3. **El costo de un lote se promedia ponderado al recibir, no se pisa.** Pisarlo haría que las
   unidades compradas baratas se valoricen al precio nuevo y el margen de lo ya vendido cambiaría
   hacia atrás.
4. **La plantilla de importación se entrega como CSV, no como `.xlsx`.** El analizador lee `.xlsx`,
   pero generar uno exigiría una librería de **escritura** que el proyecto no tiene; un CSV se abre
   en Excel y se guarda como `.xlsx` en dos clics.
5. **El conteo cíclico (ABC) queda deshabilitado, con su motivo en pantalla.** La clasificación se
   calcula con la rotación y llega con los dashboards; habilitarlo sin ella haría que "contar los A"
   no signifique nada.

---

## 7. Lo que NO se hizo

- **Listas de precio: el modelo está, la pantalla no.** `inv_listas_precio` y
  `inv_lista_precio_items` existen con su integridad (un ítem es de una presentación **o** de un
  servicio, nunca de las dos), pero **no hay pantalla** ni actualización masiva por porcentaje con
  vista previa. El precio base de la presentación y del servicio sí se edita.
- **Exportación a Excel y PDF del kardex, las existencias valorizadas y las alertas.** No está.
  `MenuExportar` existe como componente desde la sesión nocturna, pero la exportación real
  —generada en el backend, con tenant, permisos y filtros— es trabajo propio y no entró.
- **La clasificación ABC**, por lo dicho arriba.
- **El descargo automático al cerrar una atención** y **la caja**: declarados fuera de este prompt
  (prompts 07 y 08).
- **La migración de `cuidados_preventivos` a productos**: declarada fuera del prompt.

---

## 8. Cómo mirarlo

Módulo habilitado en **Clínica Prueba Facturacion QA** (`6fe3d9f0-7823-4cd3-b48a-8a232ddff83b`),
con datos sembrados por `sembrar_demo_inventario.ts` — todo por el punto único, ni un INSERT a
`inv_lotes`.

| Pantalla | URL |
|---|---|
| Catálogo | `/inventario` |
| Ficha del producto | `/inventario/productos/:id` |
| Nuevo producto / editar | `/inventario/productos/nuevo` · `/inventario/productos/:id/editar` |
| Servicios e insumos | `/inventario/servicios` |
| Movimientos y ajustes | `/inventario/movimientos` |
| Venta de mostrador | `/inventario/venta-mostrador` |
| Compras | `/inventario/compras` |
| Conteo físico | `/inventario/conteos` |
| Alertas | `/inventario/alertas` |

Para volver a sembrar hay que vaciar primero las tablas del módulo para esa clínica: los
movimientos **no se borran** (es la regla), así que una segunda corrida duplicaría el kardex. El
script lo detecta y no hace nada.

---

## Addendum — 2026-11-26, listas de precio

Lo que la sección 7 daba por no hecho en «Listas de precio: el modelo está, la pantalla no» **ya
está**, y el hueco era más grande de lo que ese párrafo decía: no faltaba una pantalla, faltaba un
**lector**. `inv_listas_precio` e `inv_lista_precio_items` existían desde la 095 y el código no las
consultaba en ningún lado — el cargo y la venta de mostrador tomaban siempre
`inv_presentaciones.precio_venta`. Una clínica podía configurar su tarifa nocturna completa y
seguir cobrando el precio base sin que nada avisara.

**`backend/src/inventario/precios.ts`** es ahora el punto único que decide qué precio corresponde, y
`agregarCargo` lo usa. Las reglas, con su motivo:

- **La lista reemplaza el base, no lo ajusta.** Un ítem de lista es un precio final. Guardar un
  porcentaje haría que el precio recalculara sobre un base que cambia, y el precio que el cliente
  vio ayer dejaría de ser reconstruible.
- **Una lista vencida o inactiva no aplica**, ni elegida a mano en la pantalla de cobro: el precio
  de una lista vencida no es un precio, y cobrarlo sería cobrar mal.
- **Un precio escrito a mano gana** sobre la lista, y entonces **no se le atribuye a ninguna**: lo
  decidió una persona.
- **La migración 097** guarda en `vta_cargos.lista_precio_id` cuál lista determinó el precio. El
  precio ya quedaba congelado en el cargo, así que la factura era reconstruible sin esto; lo que no
  era reconstruible es la pregunta que la clínica se hace al revisar el mes: *¿esto salió caro
  porque era urgencia, o porque alguien lo digitó mal?* Sin la columna, las dos cosas se ven igual.
- **`vta_parametros.lista_precio_id`** es la lista que la caja ofrece preseleccionada. Es un
  parámetro de la clínica y no del cajero: si cada cajero eligiera en silencio, el mismo producto
  saldría a dos precios el mismo día.

**La actualización masiva por porcentaje comparte el cálculo con su vista previa.** Es el punto del
pedido: si la previa se calculara aparte, el día que una de las dos cambie el redondeo o el filtro
se autorizaría una cosa y se aplicaría otra, sin error visible. Además, cambiar cualquier parámetro
**descarta la previa**, y el botón de aplicar no se habilita sin una previa en pantalla. Se puede
actualizar el precio base del catálogo o una lista; actualizar una lista parte del precio que la
lista ya tiene, y del base para los ítems que no cubre.

**Verificado:** `verificar_listas_precio.ts`, **13 secciones, TODO OK** — incluida la prueba de que
la vista previa **no escribe nada**, que lo aplicado es exactamente lo previsto, los cuatro
redondeos, el rechazo del −100%, y que la lista de otra clínica no se ve ni cambia un precio usando
su id a mano (RLS).

**Pantalla:** `/inventario/precios`. Muestra **todo lo vendible**, no solo lo que la lista cubre: una
tabla que solo lista sus propios ítems esconde justamente lo que se está por revisar, que es qué
quedó afuera.

**Lo que sigue sin estar:** el total estimado de la venta de mostrador (`/inventario/venta-mostrador`)
sigue leyendo el precio base y no ofrece elegir lista. Esa pantalla solo mueve stock —no cobra ni
factura, y lo dice—, así que su total es informativo; el cobro real, que es el que usa la lista,
está en `/ventas/cobro`.

---

## Addendum 2 — 2026-11-26, el módulo visible

Reclamo del usuario después de revisar en el navegador: *"no encuentro dónde registrar los
movimientos que no son compra ni venta"*. Tenía razón, y el diagnóstico es incómodo: **estaba todo
construido y nada enlazado.**

### Lo que ya existía (y dónde)

| Qué | Dónde | Estado |
|---|---|---|
| Movimientos manuales: merma, consumo interno, baja por vencimiento, devolución a proveedor | `/inventario/movimientos`, tarjeta «Salida manual» | construido y verificado |
| Traslado entre bodegas | misma pantalla, tarjeta «Traslado» | construido y verificado |
| Ajuste positivo y negativo con motivo y umbral de aprobación | misma pantalla, tarjeta «Ajuste» | construido y verificado |
| Aprobación de ajustes | misma pantalla, tabla de abajo (solo administrador) | construido, sin acceso directo ni contador |
| Conteo físico total | `/inventario/conteos` | construido y verificado |
| Venta de mostrador mínima | `/inventario/venta-mostrador` | construido; el prompt 08 la reemplazó por la caja real |
| Kardex de un producto | ficha del producto | construido |

**El problema no era que faltara: era que desde el catálogo no había un solo botón que llevara
ahí.** Una pantalla a la que solo se llega escribiendo la URL no existe.

### Lo que se hizo visible

- **Cuatro botones en la barra del catálogo**: Movimientos, Toma física, Kardex y —solo para el
  administrador— **Aprobaciones con el contador de pendientes**. El contador viaja con el mismo
  endpoint que la lista, así que el número del badge y el de la pantalla no pueden diferir.
- **Menú de acciones en cada fila**: Ajustar existencia · Registrar merma · Trasladar · Ver kardex.
  Cada uno entra a la tarjeta que corresponde **con el producto ya elegido** y hace scroll hasta
  ella; antes, "registrar una merma" obligaba a buscar el producto otra vez en un selector de cien.
  Es un menú y no cuatro botones por fila porque cuatro botones × veinticinco filas son cien
  botones y la fila deja de poder leerse (`MenuAcciones`, nuevo en el sistema de diseño).

### Lo que faltaba de verdad, y se construyó

1. **El kardex general** (`/inventario/kardex`). El producto pasó de requisito a filtro y se
   agregaron los de **persona** y fecha; la consulta es **la misma** para la ficha, la pantalla y la
   exportación. Los filtros viven en la URL, así que un kardex filtrado se puede pegar en un
   mensaje. El tope de 500 filas **se dice en pantalla** en vez de cortar en silencio.
2. **La exportación a Excel y PDF, de verdad.** Se genera en el backend **con los filtros
   aplicados**: un archivo armado en el navegador exportaría la página cargada y nadie lo notaría
   hasta contar las filas. El `.xlsx` se escribe con `fflate` —que ya estaba en el proyecto para
   leer planillas— porque un xlsx es un zip con cuatro XML y traer una librería de escritura sería
   una dependencia nueva a cambio de treinta líneas; el PDF usa `pdfkit`, que ya genera el reporte
   de atenciones. El archivo lleva impreso **qué filtros tenía**, y avisa si llegó al tope de 20 000
   filas.
3. **La toma física por grupo** (migración **099**). Contar todo de una vez es raro: lo normal es
   "hoy, farmacia". Se puede agrupar por línea de negocio, por categoría o por los controlados, y
   **el conteo guarda su criterio**. Se podría haber guardado como `ciclico` reusando el motor que
   ya acepta una lista de productos, pero entonces la columna diría "cíclico" en un conteo por línea
   de negocio: el tipo mentiría. El cíclico (ABC) sigue deshabilitado con su motivo a la vista.
4. **La captura de lo contado por presentación**: se cuenta "8 cajas" y el backend convierte a
   unidad base; la fila muestra el equivalente y la diferencia **siempre en unidad base**, que es la
   única comparable con lo que decía el sistema.
5. **La existencia en presentación natural con plurales correctos**, en el catálogo y en la ficha:
   «6 cajas y 4 tabletas (124 tabletas)», «88 unidades», «2 litros y 400 ml». El plural se deriva de
   las reglas del español (vocal → +s, consonante → +es, -z → -ces, -s/-x invariable) y **los
   símbolos de unidad quedan invariables** porque "ml" no se escribe "mles". Pedirle a la clínica un
   campo "nombre en plural" y otro "nombre corto" sería pedirle que escriba dos veces lo que ya
   escribió, y el día que no coincidan la pantalla miente sin romperse.

### Dos defectos corregidos de paso

- **`Input` y `Select` no asociaban su etiqueta.** Cuando no venía ni `id` ni `name` —el caso de casi
  todas las pantallas— `htmlFor` quedaba vacío: clickear la etiqueta no enfocaba el campo y un
  lector de pantalla no podía decir de qué campo se trata. Ahora caen a `useId()`, y eso arregla
  **todas** las pantallas de una vez, no solo las de inventario.
- **Cinco copias del mismo bloque de descarga** (crear object URL, `<a>` invisible, click, revocar)
  con tiempos de revocación distintos, y una que revocaba de inmediato —lo que puede cancelar la
  descarga—. Quedó una sola función: `lib/descargas.ts`.

### Verificación: desde la interfaz, no desde la API

El pedido fue explícito, así que los siete movimientos se registraron **con el navegador**, y cada
uno se contrastó contra la base (tipo, cantidad, motivo, persona y bodega):

| Movimiento | Cómo se hizo | Resultado en la base |
|---|---|---|
| Merma | 2 tabletas, motivo rotura | `merma` 2, rotura, Demo Facturacion, Farmacia |
| Consumo interno | 150 ml, motivo otro + detalle | `consumo_interno` 150, otro, "Limpieza de la sala de cirugía" |
| Baja por vencimiento | 40 g de algodón, motivo vencido | `vencimiento` 40, vencido |
| Devolución a proveedor | 3 tabletas, motivo otro + detalle | `devolucion_proveedor` 3, "Lote con empaque dañado" |
| Traslado | 5 tabletas de Farmacia a Quirófano | `traslado_saliente` + `traslado_entrante`, 5 cada uno, **ligados** |
| Ajuste negativo (bajo el umbral) | 1 tableta, diferencia de conteo | ₡337,50 → **aplicado directo** |
| Ajuste positivo (sobre el umbral) | 60 tabletas, producto encontrado | ₡20 250 → **pendiente**; aprobado desde «Aprobaciones» → aplicado |
| Toma física por grupo | línea farmacia, 9 líneas, contadas **8 cajas** | 8 × 20 = **160** base contra 80 del sistema → ajuste pendiente |

La existencia quedó cuadrada a mano: 124 − 2 (merma) − 3 (devolución) − 5 (traslado) − 1 (ajuste)
+ 60 (ajuste aprobado) = **173 en Farmacia** y 5 en Quirófano, y el catálogo muestra «8 cajas y 18
tabletas (178 tabletas)» sumando las dos bodegas.

La exportación se probó con un token real: el `.xlsx` (4 773 bytes, firma `PK`) se **volvió a leer
con el propio lector de planillas del proyecto** —40 filas: título, filtros, encabezados y los 37
movimientos— y el PDF salió con firma `%PDF`. Las cinco pantallas cargan con **cero errores de
página**.

**Verificadores:** `verificar_inventario_movimientos`, `verificar_inventario_compras` y
`verificar_listas_precio` siguen en TODO OK; `tsc` limpio en backend y frontend.

### URL

| Pantalla | URL |
|---|---|
| Movimientos y ajustes | `/inventario/movimientos` |
| Aprobaciones pendientes | `/inventario/movimientos?ver=aprobaciones` |
| Toma física | `/inventario/conteos` |
| Kardex general | `/inventario/kardex` (filtrable: `?tipo=merma`, `?producto=…`, `?persona=…`) |
| Listas de precio | `/inventario/precios` |
