# Vetline Clinic 08 — Caja, ventas y cobros

Rama `vetline-clinic/08-caja-ventas`, sacada de `vetline-clinic/06-inventario`.
Módulo `ventas`. Migración **096**, 18 tablas.

---

## 1. La documentación fiscal, con su fuente

El prompt pide confirmar contra la documentación oficial tres cosas: cómo se documenta un **abono**,
cómo se documenta un **anticipo**, y cuál es la referencia de **contingencia**. Esto es lo que se
encontró, y dónde.

Para buscarlo hubo que **extraer el texto de dos PDF que no estaban extraídos**: el Reglamento de
Comprobantes Electrónicos y la resolución DGT-R-000-2024. Quedaron versionados en
`docs/facturacion/fuentes/texto-extraido/`, como los otros cinco.

### 1.1 Abono → Recibo Electrónico de Pago (CONCLUYENTE)

**Reglamento de Comprobantes Electrónicos**, definición 23:

> *"Recibo electrónico de Pago: Es el comprobante electrónico autorizado por la Administración
> Tributaria, que respalda el **pago parcial por la venta de bienes y la prestación de servicios a
> crédito con pago diferido** conforme lo dictan los artículos 3 inciso 8 y 27 de la Ley del
> Impuesto sobre el Valor Agregado."*

**Anexos y Estructuras v4.4**, campo `CondicionVenta`:

> *"Los códigos 09 y 11 de la nota 5, sobre pagos de servicios prestados al Estado y Ventas a
> Crédito en IVA a 90 días, se utilizarán **únicamente en Recibos Electrónicos de Pago**. Estos
> serán los **únicos códigos permitidos** en dicho Comprobante Electrónico."*

**Lo implementado**, en consecuencia:

| | |
|---|---|
| La factura a crédito | tipo **01**, condición **10** ("Venta a crédito en IVA hasta 90 días, art. 27 LIVA"), con su plazo |
| El abono | tipo **10** (REP), condición **11** ("Pago de venta a crédito en IVA hasta 90 días") |
| La referencia | una por cada factura abonada, código **17** ("Pago a comprobante electrónico") |

Verificado: el XML del REP **valida contra el XSD oficial** `ReciboElectronicoPago_V4.4.xsd` y lleva
dos `InformacionReferencia` cuando el abono se reparte entre dos facturas.

### 1.2 Anticipos → NO CONCLUYENTE, y por eso la opción conservadora

Se buscó `anticipo`, `adelanto` y `pago anticipado` en **los siete documentos oficiales**
descargados: Anexos 4.4, su actualización, el Reglamento, la resolución DGT-R-000-2024,
Generalidades v4.4, Código de moneda y la Guía IdP.

**Cero menciones, en los siete.** Y el REP está acotado por su propia definición a pagos de ventas
**ya hechas** a crédito, así que no cubre un anticipo.

**Lo implementado (la opción más conservadora):** el anticipo **no emite comprobante al recibirse**.
Se registra como saldo a favor del cliente —un movimiento de tesorería, no un hecho fiscal— y el
comprobante sale con la venta final, donde el anticipo entra como medio de pago. Así no se factura
dos veces ni se factura antes de que exista la operación.

> **PARA QUE EL CONTADOR LO CONFIRME.** El artículo 3 de la Ley del IVA habla de *"lo que ocurra
> primero"* entre la facturación y la prestación, y eso podría obligar a facturar al recibir el
> anticipo. Es una interpretación de derecho tributario que **no está en las fuentes que este repo
> tiene**, y no se resuelve adivinando.
>
> `vta_anticipos.comprobante_id` existe exactamente para ese día: si el contador define que sí hay
> que facturar al recibir, es cablear, no rediseñar.

### 1.3 Contingencia → código 05 (CONCLUYENTE)

El catálogo de códigos de referencia del Anexo 4.4 (Nota 9) define el **05**, *"Sustituye
comprobante provisional por contingencia"*. Es el que usa la regularización, con el número del
provisional de papel y **la fecha real de la venta**, no la de la regularización.

---

## 2. Lo construido

### 2.1 Tres reglas de dinero, en la base

| Regla | Por qué en la base y no solo en el código |
|---|---|
| **Una cuenta no se cobra dos veces** | Dos cobros simultáneos de la misma cuenta —dos cajeros, dos pestañas— pasan los dos la validación de aplicación antes de que cualquiera escriba. Solo la base ve los dos. |
| **Un cierre de caja es inmutable** | No se edita, no se borra y no admite cobros posteriores. Si el arqueo estuvo mal, eso ya es un hecho: se corrige con un movimiento posterior. |
| **Quien pide no aprueba** | Sin eso, "pedir autorización" sería apretar dos botones. |

### 2.2 El arqueo

El esperado lo calcula el sistema, el declarado lo escribe la persona, y **la pantalla no precarga
uno en el campo del otro**: si lo hiciera, el cajero confirmaría el número del sistema sin contar.

```
efectivo CRC = fondo + cobros en efectivo CRC − vueltos
               + ingresos de cambio − retiros − gastos de caja chica
efectivo USD = fondo + cobros en efectivo USD ± movimientos en USD
tarjeta      = cobros con tarjeta      (se compara con el cierre del datáfono)
SINPE        = cobros por SINPE
otros        = transferencia y demás
```

Cada diferencia lleva justificación; una diferencia total sobre el umbral **no cierra la caja** y
deja una solicitud de aprobación.

### 2.3 El resto

Cajas configurables con su bodega y su terminal de Hacienda · sesiones compartidas con el
responsable por cobro · el punto único de cargos con referencia a su origen (listo para que la
atención del prompt 07 lo use sin tocar caja) · cuentas abiertas varios días con varias mascotas ·
pago mixto con dólares y vuelto en colones · crédito con límite y plazo · abonos con su REP ·
anticipos · encargos con reserva de stock · anulaciones y devoluciones con aprobación · tiquete
térmico de 80 mm · talonario de provisionales y regularización · cinco reportes.

---

## 3. Verificación, con resultados

`verificar_ventas_caja.ts` — **19 secciones, TODO OK**. Cubre uno por uno los puntos de la sección
"Verificación" del prompt:

| Lo que pide el prompt | Sección | Resultado |
|---|---|---|
| Abrir caja con fondo en colones y dólares | 1 | OK (y una segunda sesión en la misma caja se rechaza) |
| Vender una caja y una tableta suelta | 2 | OK — 500 → 477 tabletas |
| Pago mixto: dólares con vuelto en colones, más tarjeta | 3 | OK — $10 a 520 + ₡8 000 = ₡13 200, aplica ₡12 204, vuelto ₡996 |
| Cerrar con arqueo por los cinco medios | 7, 11 | OK |
| Una diferencia justificada | 8 | OK (sin justificación, no cierra) |
| Una diferencia sobre el umbral no cierra sin aprobación | 9 | OK |
| Dos personas cobrando en la misma sesión | 5 | OK — cada cobro con su responsable |
| Venta a crédito dentro del límite y sobre el límite | 12 | OK |
| Abono parcial a dos facturas con su documento fiscal | 13 | OK — REP validado contra el XSD, dos referencias |
| Anticipo aplicado a la cuenta final | 14 | OK — y sin comprobante al recibirse |
| Encargo con anticipo, reserva, aviso y entrega | — | **parcial**, ver §5 |
| Cuenta de hospitalización, tres días, dos mascotas | 19 | OK |
| Una anulación no se aplica sin aprobación | 15, 16 | OK — y al aprobarse sale la nota y el stock vuelve al MISMO lote |
| Tiquete térmico con todos sus datos | 17 | OK |
| Contingencia regularizada con la referencia correcta | 18 | OK — código 05, fecha real, XML validado |
| Ningún cargo se cobra dos veces | 3 | OK |
| Un cierre de caja no se modifica desde la base | 11 | OK (UPDATE, DELETE e INSERT de cobro, los tres rechazados) |
| RLS limpia y verificadores en verde | — | OK |

**Regresión completa, al cierre**, con los scripts corridos **sin `--transpile-only`** (es decir, con
el chequeo de tipos encendido, más estricto que el comando que los propios encabezados documentan):

| Verificador | Resultado |
|---|---|
| `verificar_ventas_caja` | 19 secciones, TODO OK |
| `verificar_inventario_movimientos` | TODO OK |
| `verificar_inventario_compras` | TODO OK |
| `verificar_emitir_ajustes` | TODO OK |
| `verificar_emision_facturacion` | TODO OK |
| `verificar_facturacion_modelo` | TODO OK |
| `verificar_api_facturacion` | 91 OK, 0 FAIL |
| `verificar_ubicacion` | TODO OK |
| `verificar_purga_completa` | 19 OK, 0 FAIL |
| `verificar_auditoria_rls_reforzada` | TODO OK (0 FK que traben la purga) |

`tsc --noEmit` **limpio en backend y frontend**, y `vite build` limpio.

Correr con tipos encendido dejó al descubierto **cuatro defectos de higiene** que
`--transpile-only` tapaba, los cuatro corregidos:

1. `verificar_inventario_movimientos.ts` llamaba a su helper `igual()` con un cuarto argumento —
   el contexto del fallo— que la firma no recibía: **en una sección que fallara, ese contexto no se
   habría impreso**. Ahora la firma lo acepta.
2. `verificar_inventario_compras.ts` pasaba un `boolean | undefined` a una aserción. A nivel de
   ejecución fallaba ruidosamente igual, pero el tipo estaba mintiendo.
3. `tenantModulos.ts` no compilaba fuera del grafo de las rutas: el `declare global` que declara
   `req.auth` y `req.db` vive en `middleware/auth.ts`, y un script que importara `tenantModulos`
   sin pasar por ahí se quedaba sin el aumento de Express. Resuelto con una importación **solo de
   tipos** (no emite nada, así que no introduce ciclo).
4. Dos errores de tipo preexistentes (vienen del commit `5bec77a`, de la sesión nocturna, no de
   estos prompts) en `keycloak_habilitar_edit_username.ts` y `verificar_busqueda_paleta.ts`.

**Revisión visual** en Chrome con el usuario de demostración: las siete pantallas principales cargan
con datos reales y **cero errores de página**. Los números del arqueo cuadran a mano: efectivo CRC
75 000 + 5 000 − 1 295,75 − 2 288 − 30 000 = **46 416,25**; USD 200 + 15 = **215**; tarjetas
**5 000**.

---

## 4. Tres errores reales encontrados al verificar

1. **Con pago mixto, el XML declaraba lo ENTREGADO.** Hacienda valida que los medios sumen el total
   del comprobante, y el vuelto no es parte de la factura. Ahora el vuelto se descuenta del
   efectivo, que es de donde sale físicamente.
2. **El XSD del REP exige `MedioPago`** y no se le estaba pasando. Un abono se recibe por algún
   medio y eso va en el comprobante; además es el dato que el arqueo necesita.
3. **Un cargo sin CABYS fallaba AL COBRAR**, con el cliente esperando en el mostrador. Ahora se
   exige al crear el cargo, que es donde se puede arreglar.

---

## 5. Lo que NO se hizo, y por qué

- **Encargos: falta el ciclo completo con anticipo y orden de compra.** Los seis estados, la reserva
  de stock al recibir y la pantalla están; lo que no está es el vínculo automático
  encargo → orden de compra del inventario, ni el anticipo ligado al encargo desde la pantalla (el
  modelo sí lo soporta: `vta_encargos.orden_compra_id` y `vta_anticipos.encargo_id`). El aviso al
  cliente **no sale solo**: el canal lo da el CRM, y mientras tanto el encargo recibido queda
  visible en caja como tarea, que es lo que el prompt pide para el intertanto.
- **Exportación a Excel y PDF de los reportes.** No está. Se genera en el backend con tenant,
  permisos y filtros, y queda en la auditoría: es trabajo propio y no entró. La pantalla lo dice.
- **Conteo por denominación en la pantalla.** El modelo y el backend lo soportan
  (`vta_arqueo_denominaciones`, y `cerrarSesion` lo recibe), pero la pantalla de arqueo todavía no
  tiene la grilla de billetes y monedas.
- **Lector de código de barras: no se probó con un lector físico.** La pantalla está hecha para que
  funcione (el foco vuelve al buscador y Enter agrega), que es todo lo que un lector HID necesita,
  pero no hay un lector en este entorno para confirmarlo.
- **Factura en dólares.** El cobro en dólares funciona y se convierte; emitir el comprobante
  *denominado* en dólares cuando el cliente lo pide no está.
- **Canje de beneficios de fidelización** y **link de pago a distancia**: declarados fuera de
  alcance por el propio prompt. Los medios de pago y las líneas de la cuenta quedaron extensibles
  (`vta_cobro_medios.medio` es texto con una marca `es_fiscal`, no un enum cerrado).

---

## 6. Decisiones tomadas sin consultar

1. **El anticipo no emite comprobante.** Ver §1.2. Es la decisión más importante del módulo y la
   única que depende de una interpretación que no está en las fuentes.
2. **Una sola tabla de aprobaciones para las seis clases.** Las seis tienen los mismos campos; seis
   tablas iguales serían seis pantallas de aprobación que divergen.
3. **El cargo descuenta inventario al crearse, no al cobrar.** El producto sale del estante cuando
   se lo lleva el cliente, y una cuenta de hospitalización de tres días no puede tener el stock
   "reservado en el aire" todo ese tiempo.
4. **El vuelto solo sale del efectivo.** Pagar ₡50 000 con tarjeta por una cuenta de ₡30 000 no es
   "vuelto de ₡20 000": es un error de digitación, y se rechaza.
5. **Solo se factura la primera vez.** Un pago parcial posterior sobre la misma cuenta no emite otra
   factura por lo mismo: eso duplicaría el ingreso.
6. **La caja de demostración usa la terminal `00002`.** La `00001` la usa la emisión manual del
   facturador, y dos emisores con la misma terminal se pelearían el consecutivo.

---

## 7. Cómo mirarlo

Módulo habilitado en **Clínica Prueba Facturacion QA** (`6fe3d9f0-7823-4cd3-b48a-8a232ddff83b`), con
datos sembrados por `sembrar_demo_ventas.ts` — todo por el dominio, sin INSERT sueltos.

| Pantalla | URL |
|---|---|
| Caja del día | `/ventas` |
| Cobro | `/ventas/cobro` |
| Tiquete térmico | `/ventas/tiquete/:id` |
| Cuenta corriente del cliente | `/ventas/cuenta-corriente` |
| Encargos | `/ventas/encargos` |
| Aprobaciones | `/ventas/aprobaciones` |
| Contingencia | `/ventas/contingencia` |
| Reportes | `/ventas/reportes` |

Para volver a sembrar hay que vaciar primero las tablas `vta_*` de esa clínica: un cierre de caja es
inmutable y los cobros no se borran. El script lo detecta y no hace nada.

---

## Addendum — 2026-11-26: el conteo por denominación, el ciclo del encargo y dos agujeros de plata

Cerrados dos de los pendientes de §5, y en el camino aparecieron **dos defectos reales de dinero**
del propio módulo.

### A. El arqueo por denominación, y el conteo manda

`vta_arqueo_denominaciones` y `cerrarSesion` ya lo aceptaban, pero la pantalla no lo ofrecía, así
que en la práctica no existía. Ahora la grilla de billetes y monedas de Costa Rica —y los billetes
de dólar— está en el cierre de caja.

**Cuando una moneda tiene cantidades escritas, el efectivo declarado de esa moneda sale de la suma
del conteo y el campo manual queda de solo lectura.** Contar los billetes y además escribir el total
serían dos fuentes del mismo número; el día que no coincidan ganaría el que escribió el campo, que
es el menos confiable de los dos. El verificador declara ₡99 999 a mano con ₡25 000 contados y
comprueba que valen los 25 000.

### B. El encargo, de punta a punta

Los seis estados eran un `UPDATE` en la ruta: movían el estado y nada más. Ahora hay un módulo de
dominio (`backend/src/ventas/encargos.ts`) con lo que pasa alrededor de cada paso:

| Paso | Lo que hace de verdad |
|---|---|
| Registrar | Toma el **anticipo** si el cliente deja algo, ligado a este encargo. Sin sesión de caja abierta, se rechaza: un anticipo entra a una caja |
| Pedir al proveedor | Crea la **orden de compra del inventario** —con su consecutivo y su recepción— y la liga al encargo, así el pedido no se carga dos veces. Es opcional: quien pide por WhatsApp cambia el estado sin orden |
| Recibido | **Reserva** el stock del lote que vence primero |
| Avisado | Registra que se llamó. El aviso automático sigue esperando el canal del CRM |
| Entregar | Descarga el **lote reservado** (no por FEFO), deja el cargo en una cuenta y libera la reserva |
| Cancelar | Libera la reserva y **no se come el anticipo**: queda como saldo a favor, porque eso es lo que es |

**La reserva la respeta `registrarMovimiento`**, que es el único lugar por donde sale stock. Vender
lo reservado ahora falla nombrando al cliente que lo espera, y lo no reservado del mismo lote se
sigue vendiendo. La consulta mira una tabla de ventas desde el módulo de inventario a propósito: la
alternativa —que cada quien consulte la reserva antes de mover— es la regla escrita en varios
lugares que la guía rectora prohíbe, y el día que alguien se olvide, el producto que se pidió para
un cliente se le vende a otro sin que nada avise.

### C. Dos defectos reales de dinero que esto destapó

**1. El arqueo no contaba los anticipos ni los abonos.** Un cliente deja ₡6 000 de anticipo o abona
₡10 000 de su cuenta corriente, el billete queda en la gaveta, y el cierre decía que **sobraban**.
El cajero tenía que justificar una diferencia que el sistema se había causado solo, y si pasaba el
umbral la caja no cerraba. Peor: con eso pasando todos los días, la gente aprende a justificar
diferencias sin mirarlas, que es exactamente lo que el arqueo existe para evitar.

Las dos tablas ya guardaban `sesion_id` desde la 096, así que el dinero estaba atribuido a la caja
correcta; lo que faltaba era el **medio** por el que entró. De ahí la **migración 098**:
`vta_anticipos.medio`/`moneda`, y una tabla `vta_abono_medios` porque un abono puede venir partido
y sus medios vivían **solo dentro del XML del REP**, que no es un lugar del que el arqueo pueda
sumar.

**2. El medio «anticipo» saldaba una cuenta sin verificar que el cliente tuviera ese saldo a favor,
y sin descontarlo.** Es decir: se podía cerrar una cuenta con plata imaginaria, emitir la factura, y
el saldo a favor del cliente quedaba intacto para volver a usarlo. Ahora `cobrar` lo verifica antes
y lo consume después de que el cobro existe (si la emisión falla, el anticipo del cliente sigue
disponible).

Como parte de lo mismo **se fue el endpoint `POST /ventas/clientes/:id/aplicar-anticipos`**:
consumía el saldo a favor sin tocar ninguna cuenta, así que la plata desaparecía del saldo y la
cuenta seguía debiendo el total. Un anticipo se aplica cobrando, que es donde queda el registro que
baja el saldo. La primera versión de `entregar` tenía el mismo error y por eso lo encontré: ahora
**entregar no cobra**, informa cuánto anticipo hay disponible para aplicar.

### D. Verificación

`verificar_ventas_caja.ts` pasó de 19 a **21 secciones, TODO OK** (11b denominaciones, 20 encargos).
Las nuevas cubren: el conteo que manda sobre lo declarado a mano, el detalle guardado, la cantidad
fraccionaria y el valor cero rechazados, el anticipo en el esperado del arqueo, la orden de compra
ligada, la reserva que frena la venta ajena, la entrega desde el lote reservado, el cobro con medio
anticipo que baja el saldo de verdad, el intento de pagar con más anticipo del que existe, y las
transiciones de estado imposibles.

Regresión completa en verde: inventario (movimientos y compras), listas de precio, facturación (91
OK), purga (19 OK), auditoría RLS. `tsc` y `vite build` limpios.

### E. Qué mirar en el navegador

Datos sembrados por `sembrar_demo_precios_encargos.ts` —re-corrible, a diferencia de los dos de base
que son de una sola corrida porque un cierre de caja es inmutable—:

- **`/inventario/precios`**: tres listas (NOCTURNO cargada con la masiva a +25%, CONVENIO con dos
  precios puestos a mano y vigencia 2026, y PROMO-ENE **vencida a propósito** para ver que no aplica).
- **`/ventas/encargos`**: un encargo pendiente de pedir, y otro con anticipo de ₡5 000, su orden de
  compra #3 y **20 unidades reservadas**. Intentar vender ese stock desde `/ventas/cobro` falla
  nombrando al cliente.
- **`/ventas`** → «Cerrar con arqueo»: la grilla de denominaciones.

Las dos pantallas nuevas se revisaron en Chrome con el usuario de demostración: **cero errores de
página**, y el contenido real en el DOM (las tres listas, «20 reservada(s)», «orden #3»).

### F. Lo que sigue sin estar, de §5

Exportación a Excel y PDF de los reportes (el componente `MenuExportar` la declara para el prompt de
dashboards), factura denominada en dólares, y el canje de fidelización y el link de pago, que el
prompt declara fuera de alcance. Del ciclo del encargo quedó afuera **el aviso automático al
cliente**, que depende del canal del CRM.

---

## Addendum 2 — 2026-11-26: el estado del prompt 08 completo, pedido punto por punto

Se pidió aclarar el estado de **todo** el prompt 08 y construir lo que faltara **antes** del bloque B
del expediente, porque la atención con cargos entra por la entrada de cargos de la caja. Esta sección
es ese inventario, con el verificador que lo sostiene. Las secciones citadas son de
`backend/src/scripts/verificar_ventas_caja.ts`, que corre de punta a punta **sin `--transpile-only`**
y termina en `TODO OK` con 23 secciones.

| Lo pedido | Estado | Dónde se construyó | Qué lo verifica |
| --- | --- | --- | --- |
| Cajas y sesiones | **completo** | `ventas/caja.ts`, pantalla `CajaDelDia` | §1 (fondo en colones y dólares), §5 (dos personas cobrando en la misma sesión) |
| Arqueo por los cinco medios | **completo** | `ventas/caja.ts` (`esperadoDeSesion`, `cerrarSesion`) | §7, §8 (una diferencia sin justificar no cierra), §9–§11 (umbral, quien pide no aprueba, inmutable), §11b (el conteo por denominación **es** el declarado) |
| Movimientos de efectivo | **completo** | `vta_movimientos_efectivo` + modal en `CajaDelDia` | §7 |
| Venta de mostrador | **completo** | `ventas/cuentas.ts` + pantalla `Cobro` | §2 (una caja y una tableta suelta, con descargo FEFO) |
| Cuentas abiertas | **completo** | `vta_cuentas` | §19 (una cuenta varios días, dos mascotas, una sola cuenta) |
| Cobros mixtos | **completo** | `ventas/cobros.ts` | §3 (dólares con vuelto en colones + tarjeta), §4 (la tarjeta exige autorización) |
| Cobros **en dólares** | **nuevo en esta entrega** | `monedaComprobante` en `cobrar`, selector en `Cobro` | §21 |
| Crédito y abonos | **completo** | `ventas/credito.ts` | §12 (dentro y por encima del límite), §13 (abono con su REP repartido entre dos facturas) |
| Anticipos | **completo** | `vta_anticipos` | §14 (anticipo aplicado a la cuenta final), y el defecto de §C del addendum anterior |
| Encargos | **completo** | `ventas/encargos.ts` | §20 (anticipo, orden de compra, reserva, aviso y entrega) |
| Anulaciones con aprobación | **completo** | `ventas/aprobaciones.ts` | §15 (sin aprobación no pasa nada), §16 (anular emite la nota de crédito) |
| Tiquete térmico | **completo** | `datosDeTiquete` + `TiqueteTermico` | §17, y la corrección de moneda de esta entrega en §21 |
| Contingencia | **completo** | `ventas/contingencia.ts` | §18 (provisional regularizado) |
| **Reportes** | **nuevos en esta entrega** | `ventas/reportes.ts` | §22 (los cinco con sus columnas, y la deuda de un perfil), §23 (el archivo exportado es un archivo de verdad) |

### Lo que faltaba de verdad, y se construyó ahora

1. **Los reportes no tenían ninguna verificación.** Estaban escritos dentro del `switch` de la ruta
   y ningún verificador los tocaba. Salieron a `ventas/reportes.ts`, con el **título y las columnas
   declarados al lado de la consulta que los produce**, porque ahora los piden dos caminos —la
   pantalla y la exportación— y una consulta escrita dos veces es un reporte que un día dice dos
   cosas distintas.
2. **La exportación a Excel y PDF no existía.** Se genera en el backend con los mismos filtros, con
   el exportador que ya tenía el inventario —movido de `inventario/exportacion.ts` a
   `exportacion/tabla.ts`, porque ya no es del inventario—.
3. **La factura en dólares no existía**: el cobro siempre emitía en colones. Ahora se elige la moneda
   del comprobante al cobrar, y los precios de línea y los medios de pago se dividen por el tipo de
   cambio del día, que queda guardado. Sin eso, una factura en dólares habría dicho 520 veces el
   monto real.

### Cinco defectos reales encontrados en el camino

1. **Cuentas por cobrar perdía la deuda de los perfiles de facturación.** La consulta unía solo
   `propietarios` por `receptor_propietario_id`. Desde que el receptor puede ser un perfil (la
   empresa del dueño, una fundación), **la deuda de un cliente corporativo no aparecía en ningún
   reporte**. Ahora une las dos y dice de cada deudor qué es. Verificado con una deuda a nombre de
   «Empresa Deudora S.A.» que antes se perdía.
2. **El tiquete térmico mezclaba monedas.** El neto y el impuesto salían del comprobante y el total,
   del cobro. Con una factura en dólares el tiquete decía `Venta neta ₡0,48 · TOTAL ₡282,50`: los
   dos primeros eran dólares con el signo de colón. El tiquete ahora habla en colones —es el
   documento de la caja— y la moneda de emisión se informa aparte, para que el cliente reconozca el
   monto que va a ver en el portal de Hacienda.
3. **El vuelto se contaba como venta.** El reporte por medio de pago sumaba lo que el cliente
   *entregó*: una venta de ₡282,50 pagada con un billete de ₡10 000 figuraba como ₡10 000 de
   efectivo. El arqueo sí descuenta el vuelto, así que el reporte y el arqueo decían cosas distintas
   del mismo efectivo. Hay una aserción nueva que exige que el reporte **cierre** contra la suma de
   los cobros del período (₡155 802 = ₡155 802).
4. **Ninguna descarga llegaba con su nombre.** Sin `exposedHeaders` en CORS el navegador no le deja
   leer `Content-Disposition` al JavaScript que pide el archivo, así que todo archivo se guardaba
   como `reporte.xlsx`. Afectaba también a las exportaciones del inventario ya entregadas.
5. **Cinco pantallas sin camino.** Cuentas de clientes, encargos, aprobaciones, contingencia y
   reportes estaban en el router y **nada enlazaba a ellas**: la única forma de abrirlas era escribir
   la URL.

Los defectos 2, 4 y 5 **no los encontró ningún verificador**: aparecieron recién al hacer clic en el
navegador. Es exactamente lo que pide la regla nueva de la sección 12 de la guía rectora.

### Pantallas y cómo se llega a cada una

| Pantalla | URL | Camino de clics |
| --- | --- | --- |
| Caja del día | `/ventas` | Menú lateral → **Caja** |
| Cobro / venta de mostrador | `/ventas/cobro/:cuenta` | **Caja** → botón `Cobrar`, o una cuenta abierta de la lista |
| Tiquete térmico | `/ventas/tiquete/:cobro` | **Caja** → columna «Comprobante» de un cobro → `Tiquete` |
| Cuentas de clientes | `/ventas/cuenta-corriente` | **Caja** → barra → `Cuentas de clientes` |
| Encargos | `/ventas/encargos` | **Caja** → barra → `Encargos` |
| Aprobaciones | `/ventas/aprobaciones` | **Caja** → barra → `Aprobaciones` *(solo administrador, con el contador de pendientes)* |
| Contingencia | `/ventas/contingencia` | **Caja** → barra → `Contingencia` |
| Reportes de ventas | `/ventas/reportes` | **Caja** → barra → `Reportes`; la exportación, en `Exportar` → Excel/PDF |

La barra está en la pantalla de caja **con sesión abierta y sin ella**: los reportes y la cuenta de
un cliente se consultan justamente cuando la caja está cerrada.

### Verificado en el navegador (no solo desde la API)

Con `demo.medico@vetlineai-test.com` en la clínica de demostración, en Chrome:

- Los cinco reportes con sus columnas declaradas, y el de cuentas por cobrar con su columna «Qué es»
  (cliente o perfil de facturación).
- `Exportar → Excel` y `Exportar → PDF` descargan con su nombre real
  (`ventas-por-cajero-caja-y-medio-de-pago-2026-11-26.xlsx`).
- Una **venta de mostrador facturada en dólares**, hecha a mano: producto buscado, cobrada con un
  billete de ₡10 000, moneda del comprobante en dólares. Contrastado contra la base: comprobante
  `00100001040000000003`, `moneda = USD`, `tipo_cambio = 521,45`, `total_comprobante = 0,54176`, y
  XML con `<CodigoMoneda>USD</CodigoMoneda>` y `<PrecioUnitario>0.47943</PrecioUnitario>`.
- El tiquete de ese cobro: `Venta neta ₡250,00 · Impuesto ₡32,50 · TOTAL ₡282,50` y
  `Emitido en USD por USD 0,54 · tipo de cambio ₡521,45`.
- Desde `/ventas`, el botón `Reportes` de la barra abre la pantalla.

Ningún comprobante salió hacia Hacienda (proveedor **simulado**) y no se envió ningún correo.

### Lo que sigue sin estar

Del alcance original quedan afuera, a propósito: el **canje de fidelización** y el **link de pago**
—el prompt los declara fuera de alcance— y el **aviso automático al cliente** del ciclo del encargo,
que depende del canal del CRM (prompt 03). El **anticipo sigue sin comprobante**, esperando el
criterio de un contador, con su fundamento en §1.2.
