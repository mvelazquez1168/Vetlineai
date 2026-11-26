# Vetline Clinic 07 — La atención que genera cargos (bloque B)

Rama `vetline-clinic/07-expediente`. Sección 9 del prompt
`docs/prompts/vetline-clinic-07-expediente-clinico.md`. El bloque A —el expediente— está en
`expediente-bloque-a-2026-11-26.md`.

Se construyó **después** de completar el prompt 08, porque la atención entra por la entrada de
cargos de la caja (ver `caja-ventas-2026-11-26.md`, addendum 2).

No se tocó producción. **No salió ningún correo.** Ningún comprobante fue a Hacienda.

---

## 1. Las dos ideas que sostienen el modelo

### Mientras la atención está en borrador, no hay plata

El médico elige del catálogo y ve un total, pero eso vive en `exp_atencion_items` con su precio
**congelado**, no en la cuenta de nadie. Un cargo es plata que alguien va a cobrar, y mientras la
consulta está en curso todavía puede cambiar todo: el dueño dice que no quiere la vacuna, el médico
cambia el antibiótico, alguien se equivocó con la cantidad.

El verificador lo exige en los dos sentidos: con seis ítems cargados, **cero cargos** en
`vta_cargos`; y el precio que el médico vio al agregar el ítem es el que se cobra, aunque el
catálogo cambie a mitad de la consulta.

### El cierre pasa entero o no pasa

Una sola operación: los cargos por `agregarCargo`, el stock por `registrarMovimiento`, los
preventivos en `cuidados_preventivos` —la tabla que el job diario lee para avisar—, el control por
`crearCita` —que ya dispara su propio recordatorio—, la cita completada con la máquina de estados de
la agenda y la firma por el punto único del bloque A.

**Nada de eso se reimplementó.** Este módulo los pone en orden; la regla de cada cosa sigue viviendo
donde ya vivía.

El caso que lo prueba: se piden 50 dosis de una vacuna de la que hay 9. Después del fallo quedan
**cero** cuentas, cargos, movimientos y preventivos, y la atención sigue en borrador. Lo contrario
sería una consulta cobrada con una vacuna que nunca se aplicó.

### Un cargo no llega dos veces, por el modelo

`exp_atencion_items.cargo_id` y `atenciones.cuenta_id` son el candado, con un
`pg_advisory_xact_lock` para dos pestañas abiertas. Cerrar dos veces devuelve **la misma cuenta** y
agrega cero: cinco cargos siguen siendo cinco, no diez.

---

## 2. Lo construido

| Pieza | Qué es |
| --- | --- |
| Migración **105** | El SOAP y los signos en `atenciones`; `exp_plantillas_atencion` (6 tipos de consulta de plataforma, configurables por la clínica); `exp_examen_sistemas`; `exp_diagnosticos`; `exp_atencion_items`; RLS forzada y la inmutabilidad de lo que cuelga de una atención firmada |
| Migración **106** | El orden del examen físico (ver defecto 2) |
| Migración **107** | Una atención no pasa a cerrada dejando ítems cobrables sin cargo (ver defecto 1) |
| `expediente/atencion.ts` | `abrirAtencion` (con cita o **sin cita previa**), `aplicarPlantilla`, `guardarSoap`, `marcarSistema`, `agregarDiagnostico`, `agregarItem`, `quitarItem`, `avisosAlRecetar`, `cuentaViva`, `cerrarAtencion`, `atencionEnCurso` |
| `agregarCargo` | Acepta `atencionId` y `loteId`: lo que sale en una consulta es un movimiento de tipo `atencion` con su paciente y su atención, y la vacuna sale **del lote que eligió el médico**, no del que FEFO habría tomado |
| `components/expediente/AtencionActual.tsx` | La pantalla: SOAP con guardado automático, examen por sistemas, diagnósticos, lo realizado, cuenta viva y cierre |

### Detalles que importan

- **«No evaluado» no es «normal».** No haber mirado los oídos no es haberlos encontrado bien. Los
  tres estados existen y la plantilla siembra todo en «no evaluado».
- **La nota es de lo anormal.** Al volver un sistema a «normal» la nota se borra: un sistema no
  puede decir dos cosas a la vez.
- **El diagnóstico puede pasar a la lista de problemas** del paciente, y queda **uno solo**,
  referenciado desde el diagnóstico — no una copia en cada lado.
- **El aviso de alergia no es un freno.** El médico puede tener una razón para recetar igual (una
  alergia leve, una reacción que no fue alérgica). Lo que no puede pasar es que no se le diga.
- **Los insumos del servicio se consumen sin cobrarse aparte**: su costo está en el precio del
  servicio, pero el stock baja. Un curado consume 3 gasas y la existencia baja en 3.
- **Lo que el cliente compra afuera no se cobra ni descarga stock**, y el total lo dice.
- **El IVA no se muestra en la pantalla de la atención.** Lo calcula la caja con la tarifa de cada
  ítem al convertirlo en cargo; estimarlo acá sería tener dos criterios de impuesto. El texto lo
  dice: «sin impuesto: el IVA lo calcula la caja al cobrar».
- **Atención sin cita previa**: la cita se crea sola, por `crearCita`, y queda en `en_consulta`, que
  es la verdad —el paciente está adentro—.

---

## 3. Tres defectos reales, dos de ellos solo visibles en el navegador

### 1. Una ruta duplicada dejaba la plata afuera — el más grave

El bloque A había dejado su propia ruta `POST /expediente/atenciones/:id/cerrar`, que **solo
firmaba**. Al llegar el bloque B quedaron **dos rutas con la misma URL**, y Express atiende la
primera: la pantalla nueva firmaba la atención y los tres ítems cargados se quedaban sin cargo. La
atención terminaba cerrada con `cuenta_id` en NULL, y **la plata de esa consulta no existía en
ninguna parte**.

Lo encontró el cierre desde el navegador: la pantalla decía que todo había salido bien y la cuenta
no aparecía en caja. Ningún verificador lo podía ver, porque los verificadores llaman a la función,
no a la URL.

Se cerraron **las dos causas**: la ruta duplicada ya no está, y la migración **107** impide en la
base que una atención pase a cerrada dejando ítems cobrables sin cargo, venga del código que venga.
El verificador ahora intenta firmar salteando el cierre completo y exige que falle.

### 2. El examen físico se reordenaba solo entre dos cargas

La plantilla inserta los doce sistemas en la misma transacción, así que comparten `creado_en` y
Postgres los devolvía en el orden que le convenía —distinto cada vez—. Para quien tilda doce
casillas con el paciente delante eso no es un detalle estético: se pierde el lugar y se vuelve a
empezar. Migración **106**: el orden de la plantilla se guarda, y hay una aserción que exige que dos
lecturas seguidas devuelvan el mismo orden.

### 3. Una fecha DATE que Postgres rechazaba

`control_fecha` vuelve de node-postgres como `Date`, y `String(fecha).slice(0, 10)` da
`"Fri Dec 11"`. Misma familia que el bug de fechas de las notificaciones; ahora hay una sola función
en vez de un `slice` repetido.

Y dos defectos propios de la primera versión de la migración: llamaba `abierta` al estado que el
bloque A llama `borrador` —un disparador viejo con el nombre viejo rechazaba **toda** escritura— y
los nombres de los disparadores quedaron diciendo `abierta`. Corregido, con la limpieza de la
versión anterior dentro de la misma migración.

---

## 4. Verificación

`backend/src/scripts/verificar_expediente_bloque_b.ts`, **sin `--transpile-only`**, termina en
`TODO OK`. Catorce secciones:

| § | Qué prueba |
| --- | --- |
| 0 | Clínica con catálogo, inventario con **dos lotes** de vacuna y un paciente |
| 1 | La atención nace en borrador; la plantilla siembra los sistemas en «no evaluado»; reaplicarla **no borra** lo escrito; el orden es estable |
| 2 | El SOAP, el rechazo de una condición corporal de 12 en una escala de 9, la nota de lo anormal que se va al volver a normal, el diagnóstico que pasa a la lista de problemas |
| 3 | El aviso de alergia **antes** de recetar, con su severidad; y la vacuna que no avisa |
| 4 | Seis ítems del catálogo, la cuenta viva en ₡56 900 sin lo que el cliente compra afuera, **cero cargos** todavía, y el rechazo de un ítem escrito a mano |
| 5 | **Falta stock → no queda nada a medias**: cero cuentas, cargos, movimientos y preventivos |
| 5b | **Firmar salteando el cierre completo: la base no lo deja** (el defecto 1) |
| 6 | El cierre: cinco cargos, dos preventivos, el total igual al de la cuenta viva, el control agendado, la cuenta del dueño abierta en caja con su IVA |
| 7 | El inventario: cuatro salidas **por lote**, todas con paciente y atención; la vacuna del lote que eligió el médico; las 3 gasas del insumo; el lote viejo intacto |
| 8 | Los preventivos con su lote y su fecha próxima; la cita completada; el control programado |
| 9 | **Un cargo no llega dos veces**: cerrar de nuevo agrega cero |
| 10 | Una atención cerrada no se edita: ni el SOAP, ni un ítem nuevo, ni borrar un ítem cobrado, ni el examen |
| 11 | **Atención sin cita previa**: la cita se crea sola; cerrar sin evaluación ni nota se rechaza; una urgencia sin nada que cobrar se cierra igual |
| 12 | RLS: desde otra clínica, cero ítems de atención |

### En el navegador, contrastado contra la base

Con `demo.medico@vetlineai-test.com`, cerrando la atención de Toby desde la pantalla:

- Aterriza en **`/ventas/cobro/…` cuenta #8** con los tres cargos, cada uno con el paciente:
  neto **₡47 500**, IVA **₡3 205**, total **₡50 705**.
- En la base: dos movimientos de tipo `atencion` con su paciente —la vacuna del lote **VP-2026-B**,
  el que eligió el médico, y las **20 unidades de algodón** del insumo del curado—.
- El preventivo de vacunación con su lote y su próxima fecha (26 nov 2027).
- La cita de hoy **completada** y el control **programado** para el 11 de diciembre.
- La atención firmada por «Dra. Demo Vetline».

---

## 5. Cómo mirarlo

| Qué | Camino de clics |
| --- | --- |
| Atención en curso de Toby | Menú lateral → **Pacientes** → `Toby` → pestaña **Atención actual** |
| Lo mismo, por la acción rápida | Menú lateral → **Pacientes** → `Toby` → botón **Registrar atención** |
| Abrir una atención nueva (sin cita) | Pestaña **Atención actual** → elegir tipo de consulta → **Registrar atención de Toby** |
| Agregar un servicio | En la atención: botón **Servicio** o **F2** |
| Agregar un producto, con su lote y el aviso de alergia | Botón **Producto** o **F3** |
| Cerrar y firmar | Botón **Cerrar la atención** o **F4** |
| La cuenta que quedó en caja | El cierre lleva solo; también desde **Caja** → cuentas abiertas |

URL directa: `/pacientes/1acf9b72-b082-4c05-b605-1258fd44b70c`.

Sembrado por `sembrar_demo_atencion.ts` (re-corrible): dos servicios —uno con insumos—, la vacuna
polivalente con **dos lotes** de vencimiento distinto, y una atención **en curso** de Toby con el
examen a medio hacer, un diagnóstico que ya pasó a la lista de problemas y tres ítems cargados por
₡47 500.

**El script apaga el aviso de confirmación de cita de la clínica de demostración** y lo deja
apagado: abrir una atención sin cita previa crea una cita, y crear una cita le escribe al
propietario. Es una clínica para mirar pantallas, no para mandarle correos a nadie. Se vuelve a
encender desde `/admin/notificaciones` cuando haga falta.

---

## 6. Lo que quedó afuera, y por qué

- **La exportación a PDF de cada vista del expediente** (§10 del prompt). El exportador genérico ya
  existe (`exportacion/tabla.ts`, usado por inventario y por los reportes de caja), pero una vista
  del expediente no es una tabla: es un documento clínico con su encabezado, su franja de alertas y
  su firma. Hacerlo bien es trabajo propio y no entra en este bloque.
- **El rol de peluquería**: lo crea el prompt 04. Hasta entonces el grooming lo escribe cualquier
  persona del personal, y está dicho en el código.
- **Los `servicios_sugeridos` de la plantilla** están en el modelo y no en la pantalla: la plantilla
  los puede declarar, pero la pantalla todavía no los ofrece. Se agregan, no se cargan solos —un
  cargo que aparece sin que nadie lo pida es un cargo que alguien va a tener que explicar—.
