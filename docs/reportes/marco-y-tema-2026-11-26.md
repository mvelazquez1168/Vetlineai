# Marco único, dirección visual y tema por clínica — 01c

**Rama:** `vetline-clinic/01c-marco-y-tema`. No se fusionó a `main`.
**Fecha:** 2026-11-26.
**Prompt:** `docs/prompts/vetline-clinic-01c-marco-y-tema-por-clinica.md`.
**Partió de:** `vetline-clinic/03-crm`, que desciende de `07-expediente`, que desciende de la rama
del 08. Los tres prompts cerrados están incluidos; no hizo falta una rama de integración.

---

## 1. Lo que se entrega

### 1.1 Pantallas nuevas, con su camino de clics

| Pantalla | Camino | Qué es |
|---|---|---|
| **Inicio** | Menú lateral › Inicio (primera opción) | La entrada de una clínica con módulos de gestión. Indicadores reales y tarjetas que llevan a donde se resuelve lo que muestran. |
| **Apariencia** | Menú lateral › Administración › Clínica y usuarios › pestaña **Apariencia** | El color, el logo y el tema de la clínica, con vista previa en vivo y «Restablecer». Solo administrador. |

### 1.2 Pantallas migradas al marco

Las **cuarenta y tres** pantallas autenticadas de clínica cuelgan ahora de `AppShell`. Las que
además recibieron el encabezado del patrón, indicadores o pestañas:

| Pantalla | Camino | Qué cambió |
|---|---|---|
| Caja del día | Menú › Caja | Encabezado del patrón, una tarjeta por medio de pago, cuentas abiertas con su detalle, cinco secciones como pestañas. |
| Cuentas de clientes, Encargos, Contingencia, Reportes, Aprobaciones | Menú › Caja › pestañas | Antes **no se llegaba haciendo clic desde ellas mismas**: la barra vivía dentro de «Caja del día». Ahora se monta en la ruta. |
| Catálogo de inventario | Menú › Inventario | Nueve botones en fila → siete pestañas + dos contadores + **una** acción principal. Cuatro indicadores reales. |
| Movimientos, Kardex, Toma física, Compras, Precios, Servicios | Menú › Inventario › pestañas | Igual que en caja: las pestañas se montan en la ruta, no en una pantalla. |
| Calendario | Menú › Agenda | Encabezado del patrón y dos indicadores. Las seis secciones de la agenda siguen siendo rutas y se navegan con pestañas. |
| Pacientes | Menú › Pacientes | Encabezado e indicadores (activos, vacunas por vencer). |
| Propietarios | Menú › Propietarios | Encabezado del patrón. |
| Casos clínicos | Menú › Casos clínicos | Encabezado del patrón. |
| Comprobantes electrónicos | Menú › Facturación electrónica | Encabezado del patrón. |
| Ficha del paciente / expediente | Pacientes › una fila | **Variante compacta**: franja baja que al bajar queda como barra delgada, con el enlace al padre dentro del encabezado. |
| Clínica y usuarios | Menú › Administración › Clínica y usuarios | Encabezado del patrón y dos pestañas (Datos / Apariencia). |

### 1.3 Lo que desapareció

- **Tres marcos.** `AdminLayout`, `SeccionLayout` y `AgendaLayout` están borrados.
- **Los encabezados «← Volver».** Donde hacía falta, el enlace al padre va dentro del encabezado.
- **La segunda campana.** Eran dos contiguas en el mismo encabezado. Ver §3.2.

---

## 2. La entrada depende del rol y de los módulos

Esto no estaba en el prompt original y se agregó a pedido, **antes** del informe.

`frontend/src/lib/pantallaDeEntrada.ts`, en este orden:

1. **Superadministrador → `/platform-admin`.** No pertenece a ninguna clínica.
2. **Lo que el usuario eligió**, si sigue disponible. Una elección que apunta a un módulo
   deshabilitado deja de valer: mejor la entrada derivada que un 403.
3. **Sin módulos de gestión, todo como antes**: el médico entra a `/workspace` y el administrador
   a `/admin/medicos`. Una clínica que solo usa Vetline Ai no tiene caja, ni inventario, ni agenda
   que resumir; Inicio le mostraría una pantalla de ceros.
4. **Con módulos de gestión, Inicio.**

El punto 3 es lo que evita que esta entrega sea una regresión: **ninguna clínica en producción
tiene hoy módulos de gestión habilitados**.

**Cada usuario elige su pantalla de entrada** desde su bloque en el menú lateral. Vive en
`personas.pantalla_inicio` (migración 114) y no en el navegador: es del usuario, no del equipo
desde el que entra. `NULL` significa «la que corresponda», no «ninguna», y se puede volver a eso
—la derivada cambia sola el día que la clínica habilita caja—.

---

## 3. Los defectos del relevamiento

| Defecto | Estado |
|---|---|
| Dos marcos distintos | Corregido: uno solo. |
| Menú lateral como lista larga sin íconos ni grupos | Corregido: cinco grupos, íconos, contadores, plegado recordado, modo colapsado y cajón. |
| Casi no hay color | Corregido: franja del color de la clínica, íconos con el color del módulo. |
| Las pantallas no resumen nada antes de la lista | Corregido en Inicio, Caja, Inventario, Agenda y Pacientes. |
| Nueve botones en fila en Inventario | Corregido: una acción principal. |
| Dos campanas en Casos | Corregido, **sin perder flujos**. Ver §3.2. |
| Título del modal cortado | Corregido: encabezado y pie pegados; el genérico gana botón de cerrar. |
| «cargo(s)» sin cantidad ni monto | Corregido. Ver §3.1. |
| Enumeraciones en minúscula | Corregido con `lib/etiquetas.ts`, **sin tocar el valor guardado**. |
| Voseo | Corregido: trato de usted en 30 archivos, y los 38 «(s)»/«(es)» con `lib/plural.ts`. |

### 3.1 «cargo(s)» no era un problema de redacción

La consulta de cuentas abiertas devolvía cinco columnas y **no incluía `cargos`**. La pantalla
escribía `{c.cargos} cargo(s)` con `cargos` siempre indefinido, así que en pantalla se leía
literalmente «cargo(s)», sin número. Ahora la consulta trae paciente, propietario, cuántos cargos,
cuánto suman, su resumen y la antigüedad, con aviso pasadas las 24 horas, y dice **«Cliente sin
registrar»** en vez de «sin cliente».

### 3.2 Las dos campanas se unificaron sin perder nada

Eran dos flujos distintos: las notificaciones personales del usuario y los avisos de consumo del
plan (de todo el tenant, solo del administrador). Se podían borrar las dos y dejar una, pero eso
habría dejado sin campana el aviso de que la clínica llegó al 100 % del plan. El panel tiene ahora
dos secciones con su título y **el contador suma las dos**.

---

## 4. Los defectos encontrados al verificar (no estaban en el relevamiento)

Los cinco aparecieron en el navegador, no leyendo el código.

1. **`text-primary` y `bg-primary` eran el mismo color.** Probando un amarillo puro: la franja
   quedaba perfecta (amarillo con texto oscuro encima, **15,46:1**) y la pestaña activa, los
   enlaces y la miga de pan quedaban amarillo sobre blanco, es decir **1,07:1**. El color de fondo
   y el color de texto son dos preguntas distintas y había una sola respuesta. Se agregó
   `primarioTexto` al tema (oscurecido hasta 4,5:1 contra la superficie) y Tailwind mapea
   `text-primary` ahí. Se arregla **en el tema y no pantalla por pantalla**: hay cientos de
   `text-primary` en el sistema y ninguno tiene por qué saber de esto.
2. **La pantalla de apariencia rotulaba mal el contraste.** Decía «contraste con el texto encima» y
   mostraba `contrasteConBlanco`. Con el amarillo decía 1,07:1 cuando el texto encima sacaba
   15,46:1. La etiqueta mentía; ahora son dos medidas con su nombre real.
3. **El barrido de 4 096 colores medía dos pares y le faltaba el tercero**, que es justamente el
   que dejaba pasar el amarillo. Ahora mide tres y los 4 096 pasan.
4. **«Cobrar» era un botón invisible**: `bg-primary` sobre una franja `bg-primary`. Se resolvió en
   `PageHeader`, que es de quien es la regla, no en cada pantalla.
5. **El logo salía roto.** `apariencia()` devolvía la **clave** del almacenamiento
   (`logos/x.jpg`), no la URL, así que el navegador pedía `http://localhost:4000logos/x.jpg`, sin
   la barra. Había dos copias del mismo `if` en el frontend y una se olvidaba la barra: ahora hay
   un solo `urlDeArchivo()`.

Y dos en scripts de desarrollo, encontrados al crear el usuario de verificación:
`crear_usuario_demo.ts` tenía la colegiatura `DEMO-0001` **fija** (el segundo médico nunca se podía
crear) y un fallo posterior a Keycloak dejaba un usuario huérfano que bloqueaba todo reintento.

---

## 5. Las pantallas de administración de plataforma

**Decisión: se quedan con su propio marco (`PlatformAdminLayout`) y no entran a `AppShell`.**

El motivo no es estético. `AppShell` muestra el nombre y el logo de la clínica, gatea su menú por
`tenant_modulos` y pinta con el color de la clínica; un superadministrador no pertenece a ninguna
clínica y las tres cosas no tienen con qué resolverse. El prompt además lo pide explícito: *una
pantalla de plataforma no muestra el tema de una clínica*.

Eso obligó a un arreglo que no era obvio: el script anti-destello pinta **antes** de que corra nada
de React, leyendo `localStorage`. En la computadora donde antes entró alguien de una clínica, un
superadministrador veía el color de esa clínica durante el primer pintado. Ahora, una sesión sin
`tenantId` **borra** el tema guardado y las variables puestas a mano, en vez de limitarse a no
pedir uno nuevo.

---

## 6. Los indicadores que se omitieron

El prompt los nombra; no están porque hoy no hay de dónde sacarlos. **Un número que siempre dice
cero enseña a ignorar los números.**

| Indicador pedido | Por qué no está |
|---|---|
| Agenda: «confirmadas por WhatsApp» | El canal de WhatsApp quedó con proveedor simulado en el prompt 03 y no ha confirmado ninguna cita. No hay una sola fila que contar. |
| Caja: «cantidad de facturas y de tiquetes» | Está la cantidad de cobros y el detalle por medio. El tipo de comprobante por cobro existe en `fact_comprobantes`, pero contar facturas y tiquetes aparte en la franja repetía lo que ya muestra la tabla «Cobros de la sesión», que trae el consecutivo de cada uno. Se anota como pendiente menor, no como dato faltante. |
| Caja: «efectivo dólares con su equivalente en colones» | **Sí está**: la tarjeta muestra USD 15,00 y debajo ₡7 821,75, con el tipo de cambio con el que se cobró y no con el de hoy. |

---

## 7. Verificación

### 7.1 En el navegador

Con dos usuarios desechables creados para esto (`qa.marco01c@test.local` y
`qa.soloai01c@test.local`), **no** con credenciales de usuarios existentes.

| Qué | Resultado |
|---|---|
| Inicio con datos reales | 2 citas, ₡45 031 cobrados, 4 cobros, 4 cuentas abiertas, 1 aprobación, 1 producto bajo el mínimo, 2 ajustes por aprobar. |
| Apariencia: guardar un color | `#B45309` aplicado al sistema entero y persistido; el menú se repinta sin recargar. |
| Apariencia: **amarillo puro** `#FFFF00` | Fondo amarillo con texto oscuro (15,46:1) y `#7A7A00` como color de texto (4,55:1). Todo legible. |
| Apariencia: **casi negro** `#0B0B0B` + tema Sereno | 19,68:1 en los dos pares. Todo legible. |
| Caja del día | Una tarjeta por medio: Efectivo ₡15 000 (2 cobros), Efectivo USD 15,00 (1 cobro · ₡7 821,75), Tarjetas ₡5 000, A crédito ₡30 510. Cuentas abiertas con paciente, cliente, cargos, monto y antigüedad. |
| Inventario | ₡191 152,00 a costo, 1 bajo el mínimo, 0 por vencer, 2 ajustes; 7 pestañas y 2 contadores. |
| Agenda | Pestañas de las seis secciones, 2 indicadores, el filtro de médicos dice «Usted». |
| Expediente | Franja compacta con «← Pacientes» dentro, nombre, N.º, especie, raza, sexo, estado y edad. |
| **Clínica solo con Vetline Ai** | Aterriza en `/workspace` con su chrome de siempre. Ninguna opción de gestión en el menú, ningún grupo vacío, el flujo de casos del médico idéntico al anterior. |
| Menú en 420 px | Cajón, se abre y se cierra. |
| Modo colapsado | Solo íconos, con el nombre al pasar el cursor. |
| **Sin destello al recargar** | A los **60 ms** del recargado la barra lateral ya es `rgb(114, 10, 184)`, el color guardado, y no el de fábrica `rgb(15, 118, 110)`. Medido sobre el píxel, no a ojo. |

Las capturas están en `docs/diseno/capturas/` (12 archivos).

### 7.2 Scripts

- `verificar_tema_por_clinica.ts` — **8/8**, con el barrido de 4 096 colores exigiendo AA en los
  **tres** pares y la prueba de aislamiento entre dos clínicas (RLS no deja ver la fila ajena).
- `verificar_rutas_unicas.ts` — **405 rutas**, ninguna URL registrada dos veces con el mismo
  método.
- `verificar_envios_simulados.ts` — sigue pasando.
- `tsc --noEmit` limpio en backend y frontend.

---

## 8. Lo que quedó pendiente

1. **Las subpantallas de inventario y de facturación** (Movimientos, Kardex, Compras, Precios,
   Servicios, Emitir, Emisor, Perfiles, Recibidos) están **dentro del marco y con sus pestañas**,
   pero conservan su encabezado propio: no recibieron `PageHeader` ni indicadores. Funcionan y no
   perdieron ninguna acción; les falta el patrón visual.
2. **Las pantallas de administración de la suscripción** (Plan y consumo, Cambiar plan, Facturación
   de la suscripción, Medio de pago, Recargar crédito) tampoco recibieron el encabezado del patrón.
3. **Tablas**: no se aplicaron el ícono en la primera columna, la barra de existencia contra el
   mínimo ni el menú «⋯» donde no estaban ya.
4. **Controles segmentados** y **selector de paciente en tarjetas**: sin cambios.
5. **Caja**: falta el desglose de facturas contra tiquetes en la franja (ver §6).
6. **La lista de control del relevamiento** se verificó por módulo y por camino de clics, no fila
   por fila con marca individual.

## 9. Dos cosas del ambiente que conviene saber

- **`ts-node-dev` no recarga solo en Windows + Docker.** Pasó **cuatro veces** en esta entrega: el
  código estaba bien, la API respondía con la forma vieja y la pantalla fallaba. Hay que
  `docker compose restart backend` después de cada cambio de backend, y el arranque tarda cerca de
  un minuto.
- **Tailwind tampoco relee su configuración sin reiniciar el contenedor.** Durante un rato las
  variables CSS nuevas se servían pero las utilidades seguían siendo las viejas, así que la
  interfaz se veía con la paleta anterior y el texto sobre la franja quedaba invisible. No era un
  defecto del código.
- **La base es compartida.** Mientras se verificaba, otra sesión (`demo.facturacion@…`) cambió el
  color de la clínica de demostración a `#720AB8`. Las capturas de la segunda mitad están en
  morado por eso, no por una decisión de diseño.
