# Estado antes del 08b/09b — relevamiento verificado contra el código y el esquema

Punto 0 del prompt `vetline-clinic-08b-09b-complemento-caja-y-facturador.md`. Hecho el 27 de
noviembre de 2026, contra el esquema real de la base (`information_schema`, `pg_constraint`) y
contra el código, no contra la documentación.

**Para qué sirve:** se construye solo lo que falta. Un punto que ya existe completo solo se
verifica.

---

## Tabla de estado

| Punto | Estado | Qué hay | Qué falta |
|---|---|---|---|
| **A1** Presupuestos | **No existe** | nada | todo: tabla, estados, vigencia, consecutivo, PDF, envío, conversión a cargos, anticipos, dos pantallas |
| **A2** Arqueo por denominación | **Parcial** | `vta_arqueo_denominaciones`, el backend acepta el conteo y calcula el total (`ventas/caja.ts:225`), y la UI de conteo en `CajaDelDia.tsx` | el catálogo de denominaciones es una **constante en el frontend** (`DENOMINACIONES`, línea 53) y no una tabla editable; no hay configuración de cuál modo es el predeterminado; el detalle no sale en el comprobante del cierre |
| **A2** Vales de caja | **Parcial** | `vta_movimientos_efectivo` con `tipo`, `categoria_gasto`, `motivo`, `respaldo_url`, `persona_id`; UI con tres tipos de movimiento | no se llama «vale»; falta **quién recibe** (`persona_id` es quien lo registra); el respaldo tiene columna pero no hay subida de archivo; no sale en el comprobante del cierre |
| **A3** Topes de descuento | **Parcial** | un tope único por clínica (`vta_parametros.descuento_maximo_pct`), y `vta_cargos` ya lleva `descuento_codigo`, `descuento_naturaleza` y `descuento_autorizado_por` | tope por producto y por servicio; tope por rol; PIN de autorización; catálogo de motivos mapeado al código v4.4 |
| **A3** Autorización | **Parcial** | `vta_aprobaciones` tiene el tipo `descuento` y el flujo pedir→resolver, con «quien pide no aprueba» | la autorización **en la misma pantalla** con verificación del autorizador (hoy solo existe la solicitud diferida) |
| **A4** Comisiones de tarjeta | **No existe** | `cobros.comision_pasarela` es de la **suscripción de la plataforma**, no de la caja de la clínica | configuración por banco y tipo de tarjeta con vigencia; comisión estimada y neto esperado en cada cobro |
| **A4** Conciliación con datáfono | **Parcial** | `vta_arqueo_lineas` compara esperado contra declarado por medio y exige justificación para cerrar con diferencia | totales del lote por tipo de tarjeta (cantidad y monto); la diferencia cobro por cobro; el lugar preparado para el depósito bancario |
| **A5** Ejecutor y referente | **Parcial** | `exp_atencion_items.realizado_por` existe desde la migración 105 | `vta_cargos` tiene `creado_por` (quien registró) y **no** `realizado_por` ni referente; no viaja del item al cargo; no se puede editar por línea |
| **B1** Actividad económica | **Parcial** | `fact_emisores.codigo_actividad_economica`: **una sola**, y la emisión la usa | varias actividades por emisor; regla por línea de negocio; elección en la pantalla de emisión; carga y validación contra la consulta pública; la regla del comprobante con líneas de distinta actividad |
| **B2** Recepción: carga | **Existe** | pantalla `ComprobantesRecibidos.tsx` con subida de XML, `recibirComprobante`, validación XSD, **detección de duplicados** por `ON CONFLICT (emisor_id, clave)` que informa `yaEstaba` | varios archivos a la vez; **no se valida la firma** aunque `verificarFirma` existe (`firma.ts:265`); **no se verifica que el receptor sea la clínica**; no se consulta el estado en Hacienda |
| **B2** Bandeja | **Parcial** | listado con estado de validación y del mensaje | indicadores de pendientes y plazo que vence; filtros por proveedor, fecha y estado; el estado «registrado en inventario» |
| **B2** Respuesta a Hacienda | **Existe** | `emitirMensajeReceptor` con los tres estados, incluida la **aceptación parcial** (`2 — Aceptado parcialmente`) y la condición del impuesto | el aviso antes de que venza el plazo |
| **B2** Entrada a inventario desde el XML | **No existe** | `inv_proveedor_productos` (proveedor, producto, presentación de compra, último costo) sirve de base | el **código del proveedor** en la equivalencia; vincular línea por línea; lote y vencimiento; crear la compra ligada al comprobante; no registrar dos veces; conciliar contra la orden de compra |
| **B2** Descargas y bitácora | **No existe** | — | zip por período de XML y PDF emitidos y recibidos; bitácora de envíos |
| **B3** Campos fiscales del producto | **Parcial** | las **líneas del comprobante** ya llevan `registro_medicamento`, `forma_farmaceutica` y `codigo_comercial` (`borradores.ts:83`) | esos campos en `inv_productos`, y que se propaguen solos al emitir |

---

## Lo que el relevamiento encontró de paso

1. **El catálogo de denominaciones está duplicado conceptualmente.** Hoy es una constante del
   frontend con el comentario «están acá y no en la base porque son un hecho del país». El prompt
   pide que sea editable por la clínica, lo que convierte ese argumento en falso: pasa a la base y
   el frontend la pide. Es el patrón de [una sola fuente] que ya costó tres incidentes.

2. **`recibirComprobante` no comprueba el receptor.** Un XML de una factura entre dos terceros se
   carga igual en la bandeja de la clínica, y el mensaje receptor se emitiría por un comprobante
   que no es nuestro. El dato está en el XML (`Receptor/Identificacion/Numero`) y el del emisor
   está en `fact_emisores.numero_identificacion`: es una comparación.

3. **La firma no se valida al recibir** aunque la función existe. Un XML modificado a mano pasa la
   validación XSD sin problema.

4. **`vta_movimientos_efectivo.persona_id` significa «quien lo registró»**, y el prompt pide
   además «quien recibe». Son dos personas distintas en el caso que motiva el vale (el adelanto a
   un empleado), y usar la misma columna para las dos cosas sería el defecto de nombre que ya
   apareció tres veces.

5. **El tope de descuento es uno solo por clínica y está en `vta_parametros`.** Los topes por rol
   que pide el prompt chocan con un dato real: **no existe el rol de recepción** (`personas` tiene
   `es_medico` y `es_admin_clinica` y nada más). Los topes se van a construir por **rol efectivo**
   —médico, administrador— y el día que el prompt 04 cree el rol de recepción hay que agregarle su
   fila, no rediseñar.
