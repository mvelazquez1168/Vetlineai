# El receptor de la factura — prompt 08, sección 3 bis

Rama `vetline-clinic/08-receptor-factura`, sacada de `vetline-clinic/08-caja-ventas`.
Migración **100**. Verificador propio: `verificar_receptor_factura.ts`, **9 secciones, TODO OK**.

---

## 1. El problema, dicho como lo vive el mostrador

El dueño de la mascota y el receptor de la factura son dos cosas distintas. La factura sale a nombre
de la empresa del dueño, de la fundación que paga la atención, de un familiar. Antes de esto, la
pantalla "Emitir" buscaba al receptor **solo entre los dueños de mascotas**: facturarle a una empresa
obligaba a inventarla como cliente, con lo que aparecía en la búsqueda de clientes, en los listados y
—cuando llegue— en las campañas del CRM.

## 2. El modelo, y las tres decisiones que lo explican

**`fact_perfiles_facturacion`** es una entidad propia con RLS forzado: nombre o razón social, tipo y
número de identificación, dirección con la codificación oficial (provincia, cantón, distrito, barrio
y otras señas), correo, teléfono y actividad económica. **`fact_perfil_clientes`** la liga a los
clientes.

1. **Tabla propia, no una fila en `propietarios` con un flag.** La guía rectora dice que el cliente
   es `propietarios` y que no hay una segunda tabla de clientes en ningún módulo — y un perfil de
   facturación **no es un cliente**: no tiene mascotas, ni expediente, ni recordatorios, ni gasto en
   el CRM. Con el flag habría que excluirlo en cada lugar donde hoy se listan clientes, y el día que
   alguien se olvide, la fundación recibe un recordatorio de vacunas.
2. **Muchos a muchos, y puede no tener ninguno.** Una empresa paga por varios empleados y una
   fundación por varios rescatados; y un perfil puede no estar ligado a nadie (el tercero que pidió
   factura una vez). Uno de los perfiles de cada cliente puede marcarse como **el habitual**, y es el
   que la caja propone primero —con un índice único parcial que impone uno por cliente, porque dos
   "habituales" obligan a elegir igual.
3. **La identificación es la identidad fiscal y no se edita.** Dos perfiles con la misma cédula en la
   misma clínica son el mismo perfil cargado dos veces. Si estaba mal, se crea el correcto y se
   desactiva el otro; las facturas emitidas no cambian, porque guardan su copia.

## 3. El deudor es el receptor

`vta_credito_cliente` tenía `propietario_id` como **clave primaria**. Ahora el deudor es un cliente
**o** un perfil, con un `CHECK` que impone uno de los dos y nunca ambos, y lo mismo en `vta_abonos` y
`vta_anticipos`.

Todo el módulo de crédito dejó de hablar de un `propietarioId` suelto y habla de un **`Deudor`
tipado** (`{tipo: 'cliente' | 'perfil', id}`). Eso no es cosmética: el `tipo` decide en qué columna se
busca, y un id de perfil leído como propietario **no encontraría nada y daría crédito cero sin
fallar**. Cambiar el tipo hizo que el compilador señalara los 18 lugares que había que mirar, que es
exactamente para lo que sirve.

Si la factura salió a nombre de la empresa: el límite se mira contra la empresa, la cuenta por cobrar
es de la empresa, y el **Recibo Electrónico de Pago del abono sale a nombre de la empresa**, que es
quien paga.

## 4. Un solo selector, dos formas de usarlo

El prompt lo pide explícito: *"la pantalla Emitir usa exactamente el mismo selector de receptor que
la caja: un único componente, no dos"*. `components/SelectorReceptor.tsx` ofrece las cuatro opciones
—el dueño · un perfil guardado de ese cliente (el habitual primero) · cualquier cliente o perfil
existente, con búsqueda tolerante a errores de tipeo sobre **las dos** tablas · uno nuevo cargado ahí
mismo, con la casilla de guardarlo para ese cliente— y la salida por defecto: **sin datos, tiquete**.

Las dos pantallas lo usan, y cada una lo consume según lo que es:

| | Cómo lo manda | Por qué |
|---|---|---|
| **Caja** (`/ventas/cobro`) | la **elección** (`eleccionReceptor`), y el backend la resuelve | el cajero no edita datos fiscales: elige |
| **Emitir** (`/facturacion/emitir`) | lo elegido **llena los campos** del receptor, que ya estaban a la vista | es donde se completa lo que falta sin salir de la emisión, que es lo que el prompt pide |

Las dos terminan en el mismo lugar: la copia congelada en `fact_comprobantes.receptor_*` y la
trazabilidad en `receptor_perfil_id`. La resolución —qué datos y quién es el deudor— es **una sola
función**, `resolverReceptor`.

## 5. Lo que NO se movió

La **cuenta, la atención y el gasto del cliente en el CRM siguen siendo del dueño**, aunque la
factura salga a nombre de una empresa. Verificado: después de facturarle a Transportes del Valle,
`vta_cuentas.propietario_id` sigue apuntando al dueño.

## 6. Defecto real encontrado al verificar

La primera versión guardaba el dueño de la cuenta en `receptor_propietario_id` **"para no perder el
vínculo"**, incluso cuando el receptor era un perfil. El efecto: la factura de la empresa aparecía
**también en la cuenta corriente del dueño** — la misma deuda cobrada a dos personas, y el dueño
viendo una deuda que no es suya.

Ahora esa columna significa lo que dice —"el receptor **es** este cliente"— y va NULL cuando el
receptor es un perfil. El vínculo con el dueño no se perdió: nunca estuvo ahí, está donde
corresponde, el cobro apunta a la cuenta y la cuenta es del dueño.

Lo encontró la sección 6 del verificador, que compara las dos cuentas corrientes en vez de mirar
solo la que tenía que tener la deuda.

## 7. Verificación

`verificar_receptor_factura.ts` — **9 secciones, TODO OK**, con el proveedor simulado de Hacienda:

1. un perfil es entidad propia, con su dirección; **no** aparece como cliente; sin identificación se
   rechaza; dos con la misma cédula se rechazan;
2. un perfil sirve a dos clientes y un cliente tiene tres perfiles, con el habitual primero;
3. **las cuatro opciones** resuelven al receptor correcto, el "nuevo guardado" queda como perfil del
   cliente, el "nuevo sin guardar" no queda en ninguna tabla, y *sin datos* no es un error;
4. factura a nombre de la empresa: el comprobante guarda nombre, identificación, dirección y de qué
   perfil salieron, y **la cuenta sigue siendo del dueño**;
5. se cambia el nombre y la dirección del perfil: **la factura emitida no cambia**;
6. a crédito, el límite y la cuenta por cobrar son de la empresa, el dueño no tiene crédito, el abono
   emite su REP a nombre de la empresa y el usado baja de 22 600 a 12 600;
7. sin receptor sale **tiquete**; pedir factura sin identificación se rechaza con un mensaje que dice
   qué hacer;
8. la búsqueda trae clientes y perfiles juntos: la razón social, el nombre **mal tipeado**
   ("mariena soto" → Mariana Soto) y el prefijo de la cédula jurídica;
9. RLS: el perfil de otra clínica no se lista, no resuelve y no se edita.

**Regresión completa en verde:** ventas/caja 21 secciones TODO OK · api facturación 91 OK · emisión
TODO OK · ajustes de Emitir TODO OK · inventario TODO OK · listas de precio TODO OK · purga 19 OK ·
auditoría RLS TODO OK. `tsc` limpio en backend y frontend, `vite build` limpio.

## 8. Qué mirar, y con qué datos

Sembrado por `sembrar_demo_receptor.ts` (re-corrible) en **Clínica Prueba Facturacion QA**:
**Transportes del Valle S.A.** como el habitual de Ana María Rodríguez, **Fundación Patitas Felices**
ligada al mismo cliente, y **Consultores Pérez y Asociados S.A.** sin ningún cliente ligado.

| Pantalla | URL |
|---|---|
| Perfiles de facturación | `/facturacion/perfiles` |
| Emitir (con el selector nuevo) | `/facturacion/emitir` |
| Cobro (el mismo selector, en «A nombre de quién sale») | `/ventas/cobro` |
| Cuenta corriente de un cliente | `/ventas/cuenta-corriente` |

La pantalla de perfiles se revisó en Chrome con el usuario de demostración: **cero errores de
página**, los tres perfiles con su dirección y su conteo de clientes ligados.

## 9. Lo que queda dicho y no hecho

- **La cuenta corriente de un perfil no tiene pantalla propia todavía.** El backend ya la calcula
  (`GET /ventas/clientes/:id/cuenta-corriente?tipo=perfil`) y el verificador la comprueba, pero
  `/ventas/cuenta-corriente` sigue buscando solo clientes. Un administrador que quiera ver la deuda
  de la empresa hoy tiene que llamar al endpoint.
- **El crédito de un perfil se configura por API**, no desde la pantalla de la cuenta corriente, por
  lo mismo.
- **El correo del comprobante** va al del receptor, que es lo correcto; no se le manda copia al dueño.
  Si la clínica lo quiere, es un campo más en el perfil y no se construyó sin pedido.
