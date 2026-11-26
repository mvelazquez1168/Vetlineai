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
