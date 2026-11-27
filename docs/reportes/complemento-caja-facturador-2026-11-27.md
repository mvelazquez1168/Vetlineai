# 08b · 09b — Complemento de caja y facturador: informe de entrega

**Rama:** `vetline-clinic/complemento-caja-facturador`, sobre el anexo 07-03. **Nada fusionado a
`main`.**
**Fecha:** 27 de noviembre de 2026.
**Prompt:** `docs/prompts/vetline-clinic-08b-09b-complemento-caja-y-facturador.md`.

---

## 1. El relevamiento previo (punto 0 del prompt), y en qué quedó cada punto

El relevamiento completo, verificado contra el esquema y el código antes de tocar nada, está en
**`docs/relevamientos/complemento-caja-facturador-antes.md`**. De 16 puntos: 3 no existían, 10
estaban parciales y 3 existían completos.

| Punto | Estaba | Qué se hizo |
|---|---|---|
| **A1** Presupuestos | **No existía** | Construido completo: modelo, estados, vigencia, consecutivo, PDF, respuesta del cliente, conversión a cargos con anticipo, job de vencimiento, tres pantallas |
| **A2** Arqueo por denominación | Parcial (constante en el frontend) | Catálogo en la base con semilla del BCCR y editable por la clínica; modo predeterminado configurable; el detalle **sale impreso** |
| **A2** Vales de caja | Parcial (sin «quién recibe») | `recibido_por` y `recibido_por_nombre`; salen en el comprobante del cierre con el nombre |
| **A3** Topes de descuento | Parcial (uno por clínica) | Tres niveles —producto/servicio, rol, clínica— y vale el **menor**; pantalla de configuración |
| **A3** Autorización | Parcial (solo diferida) | El autorizador **se verifica**; nadie se autoriza a sí mismo; motivos que exigen autorización siempre |
| **A3** Motivos | No existía | Catálogo mapeado a los diez códigos de `CodigoDescuentoType`, leídos del XSD |
| **A4** Comisiones de tarjeta | **No existía** | Configuración por banco, tipo y marca con vigencia; comisión y neto **congelados en cada cobro** |
| **A4** Conciliación datáfono | Parcial (total contra declarado) | Lote por banco y tipo; diferencia por fila **y total**; el detalle en el comprobante del cierre |
| **A5** Ejecutor y referente | Parcial (solo en el ítem de la atención) | `realizado_por` y `referido_por` en el cargo, heredados del ítem |
| **B1** Actividad económica | Parcial (una sola) | Varias por emisor, regla por línea de negocio, elección al emitir, y **la cuenta mixta se frena** |
| **B2** Carga del XML | Existía | Se le agregaron los dos controles que faltaban: **receptor** y **firma** |
| **B2** Bandeja | Parcial | Avisos de receptor ajeno, firma y plazo; estado «en inventario» |
| **B2** Respuesta a Hacienda | Existía | Se bloquea responder un comprobante ajeno |
| **B2** Entrada a inventario desde el XML | **No existía** | Construida, con equivalencia por proveedor y su código |
| **B2** Descargas y bitácora | No existía | Zip del período por streaming; bitácora desde `correos_enviados` |
| **B3** Campos fiscales del producto | Parcial (solo en la línea del comprobante) | Los cinco campos en el producto, propagados al facturar, con su editor |

---

## 2. Verificación

| Verificador | Resultado |
|---|---|
| `verificar_complemento_08b_09b.ts` (nuevo) | **109 aserciones, TODO OK** |
| `verificar_ventas_caja.ts` | TODO OK (sin regresión, tras cambiar el control de descuentos) |
| `verificar_rutas_unicas.ts` | ninguna URL duplicada |
| `tsc --noEmit` backend y frontend | limpio |

Sin `--transpile-only`.

### Qué se verificó y cómo — con la etiqueta correcta

| Qué | Cómo se verificó de verdad |
|---|---|
| Los tres topes, el menor que gana, el motivo y su código | **verificador**, contra la base |
| La comisión vigente por fecha y marca, y el neto | **verificador** |
| Presupuesto completo: crear, enviar, aceptar, convertir con anticipo, vencido que pregunta | **verificador** |
| La actividad económica y la cuenta mixta que se frena | **verificador** |
| Los campos fiscales del producto y su llegada a la línea del comprobante | **verificador** |
| Recepción: receptor ajeno, firma, plazo, compra desde el XML, equivalencia que se aplica sola | **verificador**, con un XML de proveedor armado con la estructura v4.4 |
| Catálogos, lote del datáfono, conciliación | **API** con token real + lectura de la base |
| Comprobante del cierre | **archivo real**: PDF de 26 KB sobre una sesión de la demo |
| PDF del presupuesto | **archivo real**: 25 KB, firma `%PDF` |
| Zip del período | **archivo real**: 45 KB, firma `PK` |
| Bitácora de envíos | **API**, con envíos reales de la demo |
| Todo lo visual | **nada.** Pendiente de los ojos del usuario |

**Tres residuos que estaban en la primera versión de este informe quedaron cerrados antes de
entregarlo:** el botón de la descarga del mes, la sección de actividades económicas en la
configuración del emisor, y el botón de presupuesto en la pantalla de la atención. Las tres eran
funciones que existían en el backend y no tenían de dónde llamarse, y una función a la que no se
llega no existe (§12 de la guía).

**No hubo pasada visual en un navegador.** Este entorno no tiene automatización de navegador y no
la hay en el repo. Lo que falta mirar, en orden de riesgo: el modal de registrar la compra desde el
XML (es el más nuevo y el que tiene más estado), el cierre de caja con el lote y el conteo, el alta
de presupuesto con sus tres tipos de línea, y la pantalla de configuración de caja.

---

## 3. Las fuentes oficiales consultadas, y qué se confirmó

Todo dato fiscal salió del **XSD oficial v4.4 que vive en el repo**
(`backend/esquemas/fe-cr/xml-schemas/v4.4/`), leído del archivo en cada caso.

| Dato | Qué dice la fuente | Confirmado |
|---|---|---|
| `CodigoDescuentoType` | Diez valores: 01 regalía, 02 regalía IVA cobrado, 03 bonificación, 04 volumen, 05 temporada, 06 promocional, 07 comercial, 08 frecuencia, 09 sostenido, 99 otros | **Sí** |
| `DescuentoType` | Cuatro elementos: `MontoDescuento`, `CodigoDescuento`, `CodigoDescuentoOTRO`, `NaturalezaDescuento` — los dos últimos opcionales y **distintos entre sí** | **Sí** |
| `CodigoActividadEmisor` | Seis caracteres, obligatorio, **no repetible**: un comprobante declara una actividad | **Sí** |
| `CodigoActividadReceptor` | Existe, opcional, para el crédito fiscal del receptor | **Sí** (no se usa todavía) |
| `RegistroMedicamento` | Texto, máximo 100: «número de registro del Ministerio de Salud» | **Sí** |
| `FormaFarmaceutica` | Máximo 3: «código de la presentación del medicamento» | **Longitud sí; la lista de valores NO** |
| `CodigoComercial` | `CodigoType` con `Tipo` (01 vendedor, 02 comprador, 03 industria, 04 interno, 99 otros) y `Codigo`, hasta cinco por línea | **Sí** |
| `PartidaArancelaria` | Doce caracteres exactos, **solo en el comprobante de exportación** | **Sí** |

### Lo que NO se pudo confirmar en la fuente, y por eso no se inventó

1. **El catálogo de formas farmacéuticas.** El XSD define que son tres caracteres y **no trae la
   enumeración**: la lista está en el Anexo de Hacienda, que no está en el repo. La columna acepta
   el código de tres y **no se sembró ninguna lista**. Hay que cargar el catálogo oficial antes de
   prometer que el campo valida.

2. **El plazo para el mensaje receptor.** Se dice que son ocho días hábiles desde la emisión, y el
   XSD **no habla de plazos** —define estructura, no procedimiento—. Quedó como **parámetro por
   emisor**, nace en 8 y se cuenta en **días corridos**, porque contar hábiles necesita el
   calendario de feriados de Costa Rica, que no tenemos. **Hay que confirmarlo contra la resolución
   vigente** antes de prometerle a una clínica que el aviso llega a tiempo. Avisar antes es del lado
   seguro; avisar después no sirve.

3. **El decreto 44863 y el IVA devuelto** quedaron **fuera de alcance** por el prompt, pendientes de
   consulta al contador de Medicavet. No se investigaron ni se construyeron.

---

## 4. Pantallas nuevas, con su camino de clics

| Pantalla | Cómo se llega | Quién |
|---|---|---|
| **Presupuestos** (lista con filtros) | Caja › pestaña **Presupuestos** | médico y admin |
| **Nuevo presupuesto** | Caja › Presupuestos › **+ Nuevo presupuesto** | médico y admin |
| **Detalle del presupuesto** | Caja › Presupuestos › el número | médico y admin |
| **Configuración de la caja** | Caja › pestaña **Configuración** | ver: todos · guardar: **admin** |
| **Comprobante del cierre** (PDF) | Caja › **Comprobante del cierre** | quien tiene la caja |
| **Lote del datáfono** | Caja › Cerrar con arqueo › **Lote del datáfono** | quien cierra |
| **Quién recibió el vale** | Caja › Movimiento de efectivo | quien registra |
| **Registrar la compra desde el XML** | Facturación electrónica › Comprobantes recibidos › **Registrar la compra** | admin |
| **Datos fiscales del producto** | Inventario › el producto › **Datos fiscales del producto** | admin |
| **Descargar el mes (XML)** | Facturación electrónica › Comprobantes recibidos › botón del encabezado | admin |
| **Actividades económicas** | Facturación electrónica › Configuración del emisor › **Actividades económicas inscritas** | ver: todos · guardar: **admin** |
| **Presupuesto desde la consulta** | la atención › Lo realizado › **Presupuesto** | médico |

---

## 5. Migraciones

Todas con **RLS forzada** y `ON DELETE CASCADE` en el `tenant_id` de cada tabla nueva de clínica.

| # | Qué |
|---|---|
| **130** | Ejecutor y referente del cargo; catálogo de denominaciones con semilla del BCCR; «quién recibió» el vale; topes por rol; motivos de descuento; comisiones de tarjeta; lote del datáfono |
| **131** | Semilla de los ocho motivos de descuento, mapeados a los códigos del XSD; topes de ejemplo por rol |
| **132** | `vta_cargos.descuento_codigo_otro`: `CodigoDescuentoOTRO` y `NaturalezaDescuento` son dos campos distintos |
| **133** | Presupuestos y sus líneas; anticipo ligado al presupuesto; vigencia por clínica |
| **134** | `vta_cargos.origen` acepta `presupuesto` |
| **135** | El descuento del presupuesto guarda su código, su naturaleza y quién lo autorizó |
| **136** | Los cinco campos fiscales del producto, con los CHECK que el XSD impone |
| **137** | Varias actividades económicas por emisor, regla por línea de negocio, y la actividad guardada en el comprobante |
| **138** | Receptor, firma, plazo y compra registrada en el comprobante recibido; código del proveedor en la equivalencia |

---

## 6. Los defectos encontrados y corregidos

### Del relevamiento (previstos)

1. **`recibirComprobante` no comprobaba el receptor.** Un XML de una factura entre dos terceros se
   cargaba igual en la bandeja de la clínica, y el mensaje receptor se habría emitido por un
   comprobante ajeno: **decirle a Hacienda que aceptamos el gasto de otro, con nuestra firma**.
2. **La firma no se validaba al recibir**, aunque `verificarFirma` existía desde el facturador. Un
   XML editado a mano pasaba la validación de estructura sin problema.
3. **El catálogo de denominaciones era una constante del frontend**, con el argumento de que «son un
   hecho del país». El prompt las pide editables, y una clínica que no recibe billetes de ₡20 000 no
   quiere esa línea en su planilla.
4. **`vta_movimientos_efectivo.persona_id` significaba «quien lo registró»** y se usaba como «quien
   recibió». Son dos personas distintas en el caso que motiva el vale.
5. **`vta_cargos.creado_por` era «quien lo registró»** y el honorario del prompt 11 necesita «quien
   lo hizo».

### Encontrados mientras construía (no previstos)

6. **Una clínica nueva no podía autorizar ningún descuento.** La semilla de topes corrió para los
   tenants que existían ese día; una clínica creada después quedaba sin filas, y como el control
   fallaba cerrado, **el administrador no podía autorizar en su propia clínica**. Lo destapó el
   verificador de caja. Ahora el administrador autoriza por omisión y los demás roles siguen
   fallando cerrados.
7. **Mi propio defecto de diseño en A1:** la conversión de un presupuesto volvía a pasar por el
   control de descuentos y chocaba con «nadie autoriza su propio descuento». El control estaba en el
   lugar equivocado: el momento en que se decide cobrar menos es cuando se **cotiza**. Ahora el
   presupuesto valida el tope y guarda su autorización, y la conversión la respeta. **Sin ese
   cambio, cualquiera podía cotizar un 90 % y convertirlo después.**
8. **Estuve a punto de mezclar `CodigoDescuentoOTRO` con `NaturalezaDescuento`.** Son dos elementos
   distintos del XSD; `fact_linea_descuentos` ya los tenía separados y el que estaba corto era
   `vta_cargos`. El efecto habría sido un comprobante con código 99 sin explicar.
9. **Quinta aparición de la ambigüedad de tipo de parámetro:** la vigencia del presupuesto iba como
   `smallint` en la columna y como `int` en la suma de días, y el mismo `$8` en los dos lugares
   falla con *«inconsistent types deduced for parameter»*.
10. **El `PUT /ventas/parametros` borraba lo que no venía en el body.** La pantalla nueva de
    configuración guarda solo el modo de arqueo, y eso habría borrado el tope de descuento y la
    lista de precios que otra pantalla había configurado. Ahora es `COALESCE` por campo.
11. **Escribí un `INSERT` contra `inv_compras`, que no existe.** La compra es una
    `inv_ordenes_compra` recibida. Lo encontré consultando el esquema antes de correrlo.

---

## 7. Lo documentado sin construir

1. **Varios emisores por tenant.** El facturador tiene un emisor por clínica (`fact_emisores` con
   `tenant_id`), y toda la emisión lo resuelve con `leerEmisor(tenantId)`. Soportar dos sociedades
   en la misma clínica implica: elegir emisor al emitir, consecutivos por emisor —que ya son por
   emisor—, credenciales por emisor —que ya lo son—, y decidir **qué emisor usa cada venta**, que es
   la pregunta de negocio real. No se construyó.
2. **Conciliación contra el depósito bancario.** La comisión y el neto esperado quedan guardados en
   cada cobro, que es la mitad que faltaba. Cargar el estado de cuenta del banco y cruzarlo contra
   esos netos es un flujo propio; el lugar está preparado.
3. **Aceptación en línea del presupuesto por el cliente.** El prompt lo deja como mejora futura. Hoy
   la respuesta la registra quien la recibió, con el canal y la fecha.
4. **Conversión parcial de un presupuesto.** Necesitaría decidir qué pasa con el resto —¿sigue
   vigente? ¿se vence?— y no estaba en el alcance. Se edita el presupuesto antes de convertirlo.
5. **Buzón de correo para los proveedores.** Documentado en
   `docs/facturacion/recepcion-comprobantes.md`, con las tres opciones de dirección, por qué un
   webhook y no IMAP, y las cuatro decisiones que hay que tomar antes (correo sin XML, XML ajeno,
   volumen, spam). La carga manual quedó detrás de la misma función, así que el buzón es otra
   entrada al mismo camino.
6. **Conciliar la factura recibida contra una orden de compra previa.** El modelo lo permite; elegir
   contra qué orden y qué hacer con las diferencias de cantidad y precio es un flujo propio.
7. **El padrón del TSE** sigue documentado en `docs/diseno/tse-padron-y-ley-8968.md` (del anexo
   07-03). Sin cambios.

---

## 8. Residuos conocidos

1. **La bitácora de envíos liga por tipo y no por comprobante.** `correos_enviados` no tiene
   `comprobante_id`: agregarlo es un cambio del módulo de correos y no de este. Mientras no esté, la
   bitácora dice *«se mandó un correo de tipo factura a este destinatario»* y no *«se mandó ESTA
   factura»*.
2. **El zip no trae los PDF.** A propósito: se generan a demanda y doscientos PDF harían que la
   descarga tarde minutos. El contador necesita los XML.
3. **La conciliación de tarjetas de cobros viejos no calza por fila.** Los cobros hechos antes de
   esta entrega no tienen banco cargado, así que aparecen en su propia fila con la diferencia
   entera. Por eso se agregó la fila de **total**, que sí es comparable siempre, y el PDF dice
   cuántos cobros están en ese caso.
4. **La bandeja de recibidos no tiene filtros por proveedor, fecha ni estado.** El prompt los pide
   y están los datos para armarlos; el listado trae todo ordenado por fecha. Con pocos comprobantes
   alcanza; con un año de facturas, no.
5. **El conteo por denominación no separa billetes de monedas en la planilla.** El catálogo guarda
   la especie (`vta_denominaciones.especie`) y el conteo las muestra en una sola lista ordenada por
   valor. Es cosmético y queda anotado.

---

## 9. El requisito que venía del rol de recepción

Confirmado y corregido en la entrega anterior: **quien cobra no puede aprobar sus propias
anulaciones**. El control existía pero se salteaba cuando la solicitud no tenía autor registrado.
Ver el informe del anexo 07-03, defecto 12.

Y el dato que sigue vigente para el prompt 04: **no existe un rol de recepción**. Todo lo que esta
entrega abre «para recepción» está abierto a `admin_clinica`. Los topes de descuento por rol están
listos para recibir su fila (`vta_topes_descuento.rol` es texto, no una FK a una tabla que no
existe) **sin rediseñar nada**.

---

## 10. Lo que sigue en la cola

**04, 10a, 11, 16a, 12, 13, 14, 10b, 16b.**
