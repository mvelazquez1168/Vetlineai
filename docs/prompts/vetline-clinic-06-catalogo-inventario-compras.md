# Vetline Clinic 06 — Catálogo, inventario y compras

## Contexto

Módulo `inventario` de Vetline Clinic, dentro de este mismo repositorio y backend. Rige la guía
rectora (`docs/prompts/vetline-clinic-00-guia-rectora.md`): en especial las reglas de integridad de
la sección 2, los ejes de la sección 3 (línea de negocio, especialidad, origen de cada movimiento) y
la trazabilidad de la sección 4.5.

Trabajá en una rama nueva creada a partir de la última versión de `vetline-clinic/facturador-cr`,
que ya contiene el sistema de diseño ampliado y el facturador.

Construí sin pedir confirmación. Parás solo ante una contradicción con el código, una decisión
irreversible sobre datos existentes o un trabajo mucho mayor al supuesto. No se toca producción ni
se envían correos reales.

### Antes de diseñar: relevar lo que ya existe

Vetline Ai ya tiene `medicamentos` (catálogo de plataforma con `tenant_id` nulo más los propios de
cada clínica), `receta_items`, `medicamento_dosis_especie`, `farmacos_equivalencias` y
`cuidados_preventivos` (vacuna, lote y producto como texto). Relevá cómo se usan. El producto de
farmacia **se vincula** a esas entidades (por ejemplo, un producto apunta al medicamento que
representa), no las duplica: una receta tiene que poder saber qué producto del inventario se
dispensa. Si el vínculo exige cambiar cómo funciona algo de Vetline Ai, se reporta en vez de
cambiarlo.

---

## 1. Unidades y presentaciones — la regla central

En farmacia se compra en una unidad y se vende o consume en otra: una caja de 20 tabletas que se
vende por tableta, un litro de alcohol que se usa en dosis de 100 ml, un kilo de algodón que se
consume por gramos.

- **Producto** = la existencia física. Tiene una **unidad base**, la más chica en que se mueve
  (tableta, ml, g, unidad, dosis). **Todo el stock, los movimientos, los lotes y los costos se
  guardan en unidad base**, en cantidades exactas. Nunca se guarda stock en cajas ni litros, para
  que no haya errores de redondeo que descuadren el inventario.
- **Presentación** = una forma de comprar, vender o consumir el producto. Cada una tiene su propio
  **código interno** (por ejemplo 1001 caja, 1002 tableta), código de barras opcional, nombre,
  **factor de conversión a la unidad base** (la caja = 20 tabletas; la dosis de alcohol = 100 ml),
  precio de venta propio, unidad de medida según el catálogo de Hacienda, y para qué sirve: compra,
  venta, consumo interno, o varias.
- Vender o consumir una presentación descuenta `cantidad × factor` en unidad base de la misma
  existencia. Comprar una presentación suma `cantidad × factor`.
- En pantalla el stock se muestra en la presentación natural y en unidad base:
  "3 cajas y 7 tabletas (67 tabletas)".
- Casos que tienen que quedar modelados como ejemplos de prueba: caja de 20 tabletas que se vende
  entera o por tableta; litro de alcohol que se vende entero o se usa en dosis de 100 ml; paquete
  de 1 kg de algodón que se consume por gramo.

## 2. Catálogo

- **Productos:** nombre, principio activo y concentración si es medicamento, vínculo opcional al
  `medicamento` de Vetline Ai, categoría, línea de negocio (farmacia, pet shop, insumo clínico…),
  código CABYS y tarifa de impuesto (usando el catálogo que cargó el facturador), unidad base,
  requiere receta, es controlado, requiere refrigeración, vida útil tras la apertura en días (para
  multidosis, alcohol, soluciones), permite stock negativo (por defecto no), mínimo y punto de
  reorden **en unidad base**, proveedor preferido, activo.
- **Servicios:** código, nombre, línea de negocio, especialidad, CABYS y tarifa, precio, duración
  estándar, y su **receta de insumos**: qué presentaciones y cantidades consume cada vez que se
  realiza (una castración: anestésico en ml, suturas en unidades, algodón en g). Esto lo usará la
  atención para descargar insumos automáticamente.
- **Listas de precio:** precio base por presentación o servicio, más listas opcionales (nocturno,
  fin de semana, urgencia, convenio) que lo reemplazan. Actualización masiva por porcentaje, con
  vista previa antes de aplicar.
- **Importación inicial** desde una planilla (Excel o CSV) con plantilla descargable, validación
  fila por fila con errores claros, vista previa y carga atómica. Es el camino para traer el
  inventario actual de Medicavet.

## 3. Inventario

- **Bodegas:** farmacia, quirófano, hospitalización y las que la clínica cree. Traslados entre
  bodegas como movimientos de salida y entrada ligados.
- **Lotes** por producto y bodega: número, vencimiento, costo unitario en unidad base, fecha de
  apertura cuando corresponde. Salida por **primer vencimiento** (FEFO) por defecto, con elección
  manual de lote cuando haga falta.
- **Costo:** el costo de cada salida es el del lote del que sale. Si una compra trae bonificación
  (por ejemplo, 12 unidades por el precio de 10), el costo unitario del lote baja en consecuencia.
  El costo por unidad base hace que el margen de vender por tableta salga correcto.
- **Movimientos que solo se agregan:** cada entrada o salida es un movimiento con su tipo, cantidad
  en unidad base, presentación usada y su cantidad, lote, bodega, costo unitario, persona que lo
  hizo, motivo cuando corresponde, y vínculos **opcionales** a paciente, atención, comprobante y
  compra. Un error se corrige con un movimiento inverso, nunca editando ni borrando.
- **Tipos de movimiento, cada uno con su dirección fija** (en un catálogo único, no repartidos en
  el código):

  | Tipo | Dirección | Origen típico |
  |---|---|---|
  | Inventario inicial | Entrada | Importación o carga inicial |
  | Compra | Entrada | Recepción de una orden de compra |
  | Devolución de cliente | Entrada | Nota de crédito de una venta; vuelve al lote original |
  | Ajuste positivo | Entrada | Conteo físico o corrección, con motivo |
  | Traslado entrante | Entrada | Desde otra bodega |
  | Venta | Salida | Caja o venta de mostrador |
  | Atención | Salida | Producto dispensado o aplicado a un paciente |
  | Consumo interno | Salida | Receta de insumos de un servicio o uso general |
  | Merma | Salida | Rotura, derrame, pérdida, con motivo |
  | Vencimiento | Salida | Baja de un lote vencido |
  | Ajuste negativo | Salida | Conteo físico o corrección, con motivo |
  | Traslado saliente | Salida | Hacia otra bodega |
  | Devolución a proveedor | Salida | Producto devuelto al proveedor |

- **Ajustes:** positivos y negativos, con motivo obligatorio elegido de un catálogo (diferencia de
  conteo, error de registro, producto encontrado, rotura, otro con texto). Un ajuste cuyo valor
  supere un umbral configurable requiere aprobación de un administrador antes de aplicarse, y queda
  registrado quién lo pidió y quién lo aprobó.
- **Un único punto de entrada** para mover stock (por ejemplo `registrarMovimiento`), que van a usar
  caja, atención y compras. Nadie escribe en las tablas de stock por fuera de él.
- **Reglas en la base:** movimientos inmutables; existencia por lote y bodega nunca negativa salvo
  productos que lo permitan explícitamente; dos salidas simultáneas de la última unidad no pueden
  pasar las dos.
- **Envases abiertos:** al primer fraccionamiento de un lote con vida útil tras la apertura, queda
  registrada la apertura y su nuevo vencimiento efectivo, que es el menor entre el del lote y el de
  la apertura.
- **Conteos físicos:** conteo total o cíclico (por clasificación ABC), captura de lo contado por
  presentación, diferencias calculadas en unidad base y ajuste con motivo y aprobación.
- **Alertas:** bajo el mínimo, en punto de reorden, por vencer a 30, 60 y 90 días, envases abiertos
  vencidos, lotes vencidos con existencia.

## 4. Compras

- **Proveedores:** datos fiscales y de contacto, condiciones de pago, tiempo de entrega, productos
  que provee con su presentación de compra y último costo.
- **Orden de compra sugerida** por proveedor, a partir del consumo real, el tiempo de entrega, un
  stock de seguridad y el punto de reorden, con la explicación de cada línea ("consumo de 46
  tabletas al mes, entrega en 3 días").
- **Estados de la orden:** sugerida, aprobada, enviada, recibida parcial, recibida, cancelada. Envío
  al proveedor por correo con `enviarEmail`; en desarrollo no sale ningún correo real.
- **Recepción** en la presentación de compra, convertida a unidad base, con lote, vencimiento y
  costo por línea; recepción parcial; diferencias contra la orden señaladas. Se guarda el número de
  la factura del proveedor; la conciliación automática con el comprobante recibido en el facturador
  queda para el prompt de finanzas.
- **Devoluciones a proveedor** como movimiento con su origen.

## 5. Interfaz

Con el sistema de diseño ampliado y los patrones de Vetline Ai, bajo `requiereModulo('inventario')`:

- **Catálogo:** listado con búsqueda y filtros (categoría, línea, bodega, bajo mínimo, por vencer),
  y alta o edición de producto con un constructor de presentaciones que muestre en vivo la
  equivalencia ("1 caja = 20 tabletas").
- **Ficha del producto:** existencia por bodega en presentación y unidad base, lotes con
  vencimientos, kardex de movimientos con filtros, y consumo del período por origen con
  **drill-down a los pacientes** que lo usaron y a los movimientos sin paciente agrupados por su
  origen (guía, sección 4.5).
- **Servicios** con su receta de insumos y su costo de insumos calculado.
- **Movimientos manuales:** merma, consumo interno, traslado, ajuste positivo y ajuste negativo,
  con motivo y, cuando supera el umbral, flujo de aprobación.
- **Venta de mostrador mínima**, solo para registrar la salida de inventario por venta mientras no
  exista la caja: elegir presentaciones y cantidades y confirmar. No cobra ni factura; el prompt 08
  la reemplaza por la caja real usando el mismo punto único de movimientos.
- **Compras:** orden sugerida, órdenes con sus estados y recepción.
- **Conteo físico** y **alertas**.
- Productos y servicios aparecen en la paleta de comandos (Ctrl K).
- Exportación a Excel y PDF del kardex, las existencias valorizadas y las alertas.

---

## Verificación

- Las presentaciones de los tres ejemplos: vender 1 caja descuenta 20 tabletas, vender 3 tabletas
  descuenta 3; comprar 2 litros suma 2000 ml y vender una dosis descuenta 100 ml; comprar 1 kg de
  algodón suma 1000 g y consumir 5 g descuenta 5.
- La existencia se muestra en presentación y unidad base de forma correcta, incluidos restos
  ("3 cajas y 7 tabletas").
- El costo por tableta es el costo de la caja dividido entre 20; una bonificación baja el costo
  unitario del lote.
- FEFO toma el lote que vence primero; un envase abierto muestra su vencimiento efectivo.
- Cada uno de los 13 tipos de movimiento se registra con su dirección correcta y mueve la existencia
  en el sentido esperado; un tipo de salida nunca suma y uno de entrada nunca resta.
- Una venta de mostrador de 3 tabletas descuenta 3; una devolución de cliente de esas 3 las
  regresa al lote original.
- Un ajuste positivo y uno negativo mueven la existencia con su motivo; un ajuste sobre el umbral no
  se aplica hasta que un administrador lo aprueba.
- Una salida que dejaría la existencia negativa se rechaza, salvo en productos que lo permiten; dos
  salidas simultáneas de la última unidad: solo una pasa.
- Un movimiento no se puede editar ni borrar desde la base.
- La orden sugerida da cantidades coherentes con consumo, tiempo de entrega y stock de seguridad en
  un caso calculado a mano y documentado en el test.
- La importación rechaza filas inválidas con su motivo y carga las válidas de forma atómica.
- El drill-down de un producto lista los pacientes desde movimientos ligados a atención, y agrupa
  aparte los movimientos sin paciente.
- La auditoría de RLS pasa limpia y los verificadores existentes siguen en verde.

## Fuera de este prompt

La venta en caja (prompt 08) y el descargo automático al cerrar una atención (prompt 07), que van a
usar el punto único de movimientos; la conciliación con facturas de proveedores (finanzas); y la
migración del contenido de `cuidados_preventivos` a productos.

## Reporte

En `docs/reportes/`: lo construido, lo verificado con resultados, cómo quedó el vínculo con
`medicamentos` y las recetas, lo que no se pudo y por qué, y las decisiones que tomaste solo.
