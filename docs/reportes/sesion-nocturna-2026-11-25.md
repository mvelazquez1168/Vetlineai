# Sesión nocturna 2026-11-25 — Vetline Clinic 01b + 02

Sesión sin supervisión. Tres bloques, construidos, verificados y commiteados por separado.
**No se desplegó nada ni se tocó producción.**

## Dónde quedó el trabajo

Rama **`vetline-clinic/sesion-nocturna-2026-11-25`**, pusheada a `origin` como respaldo.
`main` quedó intacta.

| Commit | Qué trae |
|---|---|
| `917212f` | Vetline Clinic 01: cimientos y ficha del paciente (estaba sin commitear al empezar) |
| `4952ec8` | Bloque B: sexo del paciente normalizado y `vite.config` sin artefactos versionados |
| `3070836` | Bloque A: la respuesta sale después del COMMIT |
| `5bec77a` | Bloque C: sistema de diseño ampliado, paleta de comandos y atajos |
| `6aef481` | `verificar_agentes_paises_v2`: restaura el país y denuncia por qué no puede |

**Decisión tomada sola, para que la sepas:** usé una rama de sesión en vez de commitear en `main`.
El prompt pedía "push al repositorio privado como respaldo" sin especificar rama, y una rama cumple
ese propósito sin tocar `main` mientras nadie revisó nada. Si preferís `main`, es un
`git merge --ff-only` desde ahí.

**Desvío de orden, también mío:** el bloque B ya estaba construido antes de que empezara la sesión
(lo pediste en el mensaje anterior), así que lo commiteé antes del A para que cada commit quedara
limpio. Ninguno de los dos depende del otro.

---

## Bloque A — la respuesta sale después del COMMIT

### El relevamiento que decidió el diseño

Antes de elegir el mecanismo relevé **cómo responde efectivamente este backend**, porque de eso
dependía si el arreglo podía vivir en un punto único. Son dos formas, no diez:

| Forma | Usos | Dónde |
|---|---|---|
| `res.json(...)` | 762 | todas las rutas |
| `res.send(buffer)` | 7 | las descargas (zip de exportación, PDF de reporte y de receta, `.docx` del informe, archivo de caso, documento de conocimiento) |
| `res.status(204).send()` | 3 | `DELETE` de archivo, de cita y de documento |

**Cero** `sendStatus`, `res.end`, `writeHead`, `sendFile`, `download`, `redirect` y streams a `res`.
Y `res.json` de Express delega en `res.send`. Así que envolver `res.send` dentro de
`withTenantClient` cubre el 100% de las respuestas que tienen una transacción abierta.

No quedó ninguna forma de responder sin cubrir, así que no hay rutas listadas como excepción.

### Lo construido

`middleware/auth.ts`, un solo lugar, ninguna de las 29 rutas ni de las 762 respuestas cambió:

- La primera llamada a `res.send` captura el cuerpo, confirma la transacción y recién entonces
  responde.
- Si el COMMIT falla, el cliente recibe **500** con un mensaje que explica la salida, no el éxito
  que esa respuesta traía. Se puede cambiar el estado porque las cabeceras todavía no salieron —
  justamente porque diferimos el envío.
- `release()` ahora relanza el error del COMMIT en vez de comérselo. Los handlers de
  `finish`/`close` lo siguen ignorando, porque ahí ya no hay a quién contarle.
- Convive con `cerrarTransaccion()` y `conAlcanceTenant()`: si la ruta ya cerró su transacción, la
  interceptación pasa de largo. No hay doble COMMIT.
- El pool de staff de plataforma sigue igual (también abre `BEGIN`, misma interceptación).
- 4xx sigue confirmando y 5xx sigue haciendo ROLLBACK, igual que antes.

### Verificación

**1. El reproductor falla antes del arreglo.** `verificar_respuesta_despues_del_commit.ts`, 50
vueltas de "crear paciente y usarlo enseguida" sin pausa:

| | sin el arreglo | con el arreglo |
|---|---|---|
| Vueltas que perdieron la carrera | **17 de 50** (404 real) | **0 de 50** |

**2. COMMIT fallido forzado.** `verificar_commit_fallido_y_latencia.ts` agrega temporalmente a
`pacientes` una restricción `UNIQUE ... DEFERRABLE INITIALLY DEFERRED` sobre `(tenant_id, microchip)`
—elegí `microchip` porque está en NULL en todas las filas y los NULL no colisionan, así que la
restricción no puede fallar por datos previos ni molestar a nadie mientras dura la prueba—. Con eso
el `INSERT` pasa y la violación aparece **recién al confirmar**, que es el caso difícil: la ruta
terminó bien, no hay excepción que atrapar.

| | sin el arreglo | con el arreglo |
|---|---|---|
| Lo que recibe el cliente | **201 con el objeto completo y un id fantasma** | **500** con mensaje |
| Lo que quedó en la base | nada | nada |

Era el peor de los dos mundos y es lo que esto cierra. 8/8 aserciones, incluida una que confirma que
**el contador de expedientes no se consume** por un alta que falló al confirmar, y otra que confirma
que la conexión fallida se descarta bien (el alta siguiente funciona).

**3. Latencia**, 100 repeticiones de cada ruta, misma máquina, mismo script:

| Ruta | sin el arreglo | con el arreglo | delta |
|---|---|---|---|
| `GET /auth/me` promedio | 14 ms | 15 ms | +1 ms |
| `GET /auth/me` p95 | 27 ms | 21 ms | −6 ms |
| `POST /pacientes` promedio | 23 ms | 30 ms | +7 ms |
| `POST /pacientes` p50 | 18 ms | 24 ms | +6 ms |
| `POST /pacientes` p95 | 60 ms | 71 ms | +11 ms |

El costo es una ida y vuelta de COMMIT por respuesta. En la lectura está dentro del ruido; en la
escritura son 6 ms sobre una operación que ya tardaba ~20. Sin regresión apreciable.

---

## Bloque B — decisiones sobre el reporte del 01

### 1. `pacientes.sexo` normalizado y el CHECK validado

Migración **089**. Los valores viejos venían del sembrado de desarrollo, no de carga clínica:
ningún endpoint escribía esa columna hasta el prompt 01.

- `'Macho'` → `macho`, `'Hembra'` → `hembra`, `'Macho castrado'` → `macho` +
  `estado_reproductivo = 'castrado'`. Conversiones explícitas, **sin `lower()` ciego**: un valor
  inesperado tiene que hacer fallar el VALIDATE, no colarse convertido a medias.
- `VALIDATE CONSTRAINT`: el CHECK deja de ser una promesa sobre las filas nuevas y pasa a ser una
  garantía sobre toda la tabla. Con eso se cierra la consecuencia que la 087 reportaba (un `UPDATE`
  sobre una fila vieja fallaba aunque no tocara `sexo`).
- Resultado en dev: 14 NULL, 1 `hembra`, 3 `macho`, 1 `macho`+`castrado`, y
  `pacientes_sexo_check` con `convalidated = true`.
- `seed.ts` escribe el vocabulario nuevo y la edad como fecha de nacimiento estimada.

**La compuerta previa al despliegue** es `src/scripts/verificar_sexo_paciente_normalizable.ts`: solo
lectura, lista cualquier valor fuera de `macho|hembra|NULL` y termina en 1 si aparece algo que la 089
no cubre. **No se corrió contra producción: queda lista para mañana.**

Verificación (el verificador falla contra el defecto antes de que le crea): inyectando un
`'Hembra castrada'`, la compuerta reporta exit 1 y nombra la fila exacta; y con esa fila presente la
migración 089 **aborta sin dejar conversión parcial** (estado idéntico antes y después, 089 sin
registrar en `schema_migrations`). El cambio de `seed.ts` se verificó en una base limpia: migrar +
`seed` **sin** `seed:plataforma` deja `sexo` macho/hembra, estado reproductivo, fecha estimada y la
edad volviendo exacta (5/3/4/6 años).

### 2. `vite.config.js` y `vite.config.d.ts` desversionados

**Causa raíz, que no era solo "están versionados":** `tsconfig.node.json` es `composite` (no admite
`noEmit`) y no tenía `outDir`, así que emitía al lado del fuente. Y Vite resuelve `vite.config.js`
**antes** que `vite.config.ts`. Como además el `.js` estaba versionado y desactualizado, el dev
server venía levantando una copia vieja: el arreglo de `navigateFallback: undefined` del service
worker estaba en el `.ts` desde agosto y **nunca tomó efecto**. El log del contenedor lo decía de
frente (`vite.config.js changed, restarting server`).

- `outDir` a `node_modules/.tmp/tsconfig-node`; los dos artefactos desversionados y en `.gitignore`.
- La configuración real vive solo en `vite.config.ts`.

Confirmado que **dev y el build de producción leen el `.ts`**: en disco solo queda `vite.config.ts`,
el build pasa con exit 0, y `dist/sw.js` tiene **0** `createHandlerBoundToURL` con las reglas de
`runtimeCaching` presentes (antes, el `.js` viejo producía lo contrario).

---

## Bloque C — sistema de diseño ampliado, paleta de comandos y atajos

Todo fue al sistema de diseño **compartido** (`frontend/src/components/ui/` y `tailwind.config.js`).

### C.1 Deuda previa

- El barrel exporta los **13** componentes del directorio con sus tipos (exportaba 9). La cuenta
  real es 13, no 12 como decía el relevamiento.
- Los 2 overrides de tamaño muertos de `Button` pasan a `size="sm"` (`CasoDetalleAdmin` ×2,
  `VincularAtencionModal`). **Aparecieron 2 más** en `PwaPrompts.tsx` (`px-2` que pierde contra el
  `px-4` de la base): también quitados, sin cambio visual porque ya no se aplicaban.

### C.2 Las dos librerías, cada una detrás de una puerta

| | Elegida | Por qué, en una línea |
|---|---|---|
| Íconos | **`lucide-react` 1.80** | Íconos de línea con `stroke-width` 2 — el mismo trazo de los 13 SVG que el proyecto ya tenía escritos a mano — y un componente por ícono, así que el tree-shaking es real. |
| Charts | **`recharts` 3.11`** | Composable en SVG y permite `onClick` **por elemento**, que es lo que el drill-down obligatorio necesita; `chart.js` pinta en canvas y no entrega el elemento. |

`components/ui/Icono.tsx` es la única puerta a lucide (mapa de 33 íconos con nombres propios, así
que el compilador atrapa un nombre inexistente). `components/ui/charts/` es la única a recharts:
`ChartBarras` (vertical/horizontal, simple/apilada), `ChartLinea`, `ChartArea`, `ChartDona` y
`Sparkline`. Los cinco aceptan manejador de clic por elemento y devuelven la clave que el drill-down
necesita.

### C.3 La paleta de datos, medida y no elegida a ojo

Los 10 hex viven en `src/lib/paleta-datos.json`, su **fuente única**: los leen `tailwind.config.js`
(tokens `datos-1`..`datos-10`), `src/lib/paletaDatos.ts` (los charts necesitan el hex en tiempo de
ejecución) y el verificador.

**Mi primer intento a mano lo rechazó el propio verificador**, con 8 pares que se confundían entre sí
o con un semántico (`datos-9` a ΔE2000 **10.9** del `accent`, `datos-10` a 10.9 del `success`). Los
definitivos salen de una búsqueda en espacio LCh que maximiza la peor separación sujeta a las
restricciones duras.

`scripts/verificar-paleta-datos.mjs` (node puro, sin dependencias) mide y falla si algo no cumple:

| Criterio | Exigido | Peor caso real |
|---|---|---|
| Contraste contra `surface` (#FFFFFF) | ≥ 3:1 | **3.39:1** |
| Contraste contra `background` (#FAF7F2) | ≥ 3:1 | **3.17:1** |
| CIEDE2000 entre pares | ≥ 18 | **18.7** |
| CIEDE2000 contra un semántico | ≥ 24 | **24.0** |
| Luminosidad: escalera monótona | — | 0.032 → 0.260 |

**El techo medido, y la decisión que te queda.** Exigir 3:1 contra blanco acota la luminosidad útil a
L* ≤ 58, y dentro de esa banda la cantidad de colores y la separación se pelean:

| Colores | Peor ΔE2000 alcanzable |
|---|---|
| 8 | 22.6 |
| 9 | 20.4 |
| **10 (elegido)** | **18.7** |

Elegí **10** porque cada línea de negocio tiene que tener su color fijo (guía §3) y con 8 dos
compartirían color en el chart principal, que es el de ingresos por línea. Los tres valores están muy
por encima del umbral de percepción (~2.3) y del "son colores distintos" (~10). **Si preferís el
margen extra, bajar a 8 es una decisión informada por esa tabla** — es tu llamada, no la tomé por vos
más allá de lo necesario para entregar el bloque.

**Diferencia con la guía, reportada:** la guía pedía una paleta de **8** colores y, a la vez, un color
fijo para cada una de las **10** líneas de negocio. Las dos cosas juntas no se pueden. Resolví a
favor del color por línea y extendí a 10 tokens.

### C.4 Los 8 componentes nuevos

`Pagination`, `EmptyState`, `LoadingState` (skeleton de líneas/tarjetas/tabla), `Modal` con prop de
ancho, `Toast` con proveedor y `useToast`, `KpiCard`, `SelectorPeriodo` y `MenuExportar`.

Tres decisiones que vale conocer:

- **`Modal`**: `ancho` por defecto es `"md"`, exactamente el `max-w-md` que había, así que **los 16
  usos existentes no cambian** de aspecto ni necesitan tocar nada.
- **`KpiCard`**: el color de la variación sale de `sentido`, **no del signo**. Que una cifra suba es
  bueno en ingresos y malo en inasistencias o en cuentas por cobrar. Un dashboard que pinta de verde
  toda flecha hacia arriba le miente a quien lo lee.
- **`SelectorPeriodo`**: resuelve las fechas en la **zona horaria del tenant** vía `formatFecha`, y
  el período anterior es del **mismo largo** (31 días contra 31, no "el mes anterior" — comparar 31
  contra 28 haría que febrero parezca siempre peor).

La ficha y el listado de pacientes adoptaron `Pagination`, `EmptyState` y `LoadingState`, y el modal
de edición usa `useToast` (el modal se cierra al guardar, así que un mensaje inline se iría con él;
el error, en cambio, queda inline porque hay que corregir el formulario que está a la vista).
`Pagination` recibe el `porPagina` **del backend**, no una constante local. Ninguna otra pantalla se
migró.

### C.5 Paleta de comandos, búsqueda tolerante y atajos

Migración **090**: `pg_trgm` + `unaccent` + `inmutable_unaccent()`. Ese envoltorio no es adorno:
`unaccent` es `STABLE` y Postgres no deja usar una función `STABLE` en la expresión de un índice, así
que hay que fijar el diccionario y declararla `IMMUTABLE`. Índices GIN de trigramas sobre el nombre
de paciente y de propietario; prefijo (`text_pattern_ops`) para microchip, teléfono e identificación,
que son dígitos y donde un trigrama parecido no significa un typo.

**El umbral está calibrado, no supuesto:**

| | similitud |
|---|---|
| Méndez / Mendez | 1.000 |
| Firulais / Firulai | 0.700 |
| Velásquez / Velazquez | 0.538 |
| **Toby / Tobi** (peor positivo) | **0.429** |
| **Lucas / Luna** (mejor negativo) | **0.222** |
| Mariana / Ana | 0.200 |
| Rocky / Toby | 0.000 |

La ventana es 0.222–0.429, así que **0.30** cae cómodo en el medio. Se fija por transacción, no se
confía en el default del servidor (que nadie versiona).

`GET /api/busqueda` pasa por `withTenantClient`, así que el aislamiento **no es un WHERE que se pueda
omitir: es RLS**. `lib/comandos.ts` es el registro único que leen la paleta y la ayuda — no hay dos
listas que puedan divergir. Los atajos son secuencias `g` + tecla (convención de GitHub/Linear): no
chocan con el navegador y necesitan intención; `Ctrl/Cmd+K` abre la paleta, `?` la ayuda, y ningún
atajo se dispara dentro de un campo de texto (`esCampoDeTexto`, en un solo lugar). Recientes en
`localStorage` por usuario, primeros en la paleta vacía.

### C.6 Verificación

`verificar_busqueda_paleta.ts`: **17/17**. Monta **dos** clínicas con el mismo nombre de paciente y
el mismo propietario a propósito, para probar el aislamiento contra el caso que de verdad lo
rompería.

- "Tobi" encuentra a "Toby"; "Mendez" encuentra a "Méndez" y al revés.
- Cada clínica ve **un** Toby, el suyo, y el script confirma que son filas distintas (que la prueba
  no se engañó sola).
- Prefijos de microchip, teléfono y número de expediente exacto.
- Negativos: "Rocky" no devuelve a Toby; una sola letra no busca nada.
- Peor búsqueda **355 ms**, promedio 76 ms.

**Encontró un defecto real:** con el mínimo en 2 caracteres a secas, los expedientes del **1 al 9**
eran inalcanzables desde la paleta — y toda clínica que recién arranca tiene exactamente esos. Ahora
una consulta de solo dígitos pasa con uno, tanto en el backend como en el frontend.

`/dev/muestrario` tiene todos los componentes y variantes, condicionado a `import.meta.env.DEV`.

**Build de producción: exit 0, sin advertencias nuevas** (queda la de tamaño de chunk, preexistente).
Bundle 903 → **931 kB** (gzip 241 → 251 kB). Verifiqué qué entró realmente:

| | en el bundle de producción |
|---|---|
| `recharts` | **no** — 0 ocurrencias |
| `lucide` | sí |
| Muestrario | **no** |
| Paleta de comandos | sí |

`recharts` se elimina por tree-shaking porque **ninguna pantalla de producción usa los charts
todavía** (solo el muestrario, que es de desarrollo). Su costo real llega con los dashboards.

---

## Todos los `verificar_*` siguen pasando

**20 de 20** verificadores de comportamiento en verde, más el de la paleta.

### Lo que rompí y arreglé

| Verificador | Qué cambio lo rompió | Estado |
|---|---|---|
| `verificar_fsm_y_origen_receta` | La migración **087** del prompt 01: insertaba pacientes a mano sin `numero_expediente`, que pasó a `NOT NULL` | Arreglado: pide el número por el punto único. **8/8** |
| `verificar_vincular_atencion_anterior` | Lo mismo | Arreglado. **13/13** |

### La regresión que investigué y no era mía

Cinco verificadores que venían pasando empezaron a fallar entre un barrido y el siguiente:
`vinculo_caso_cita`, `paciente_nacimiento_estado`, `validacion_correo_propietario`,
`urgente_medico_agente` y el propio `agentes_paises_v2`.

Causa: **`verificar_agentes_paises_v2` dejaba Costa Rica inactivada.** Es el único país habilitado
del ambiente, así que mientras quede inactivo todo verificador que registre una clínica recibe 202
("entra a lista de espera") y falla por un motivo ajeno a lo que prueba. También explica el fallo de
`almacenamiento_publico`, que ya venía de antes.

Lo probé: con CR habilitado, los cinco pasan sin tocar nada más. Y para `motor_cobros` hice la prueba
decisiva —correrlo **sin** el arreglo del bloque A— y falla idéntico, así que es preexistente.

El script **sí** intentaba re-habilitar CR, pero disparaba el PATCH y descartaba la respuesta. Y ese
PATCH **no puede funcionar**: el endpoint exige el checklist de habilitación y CR tiene
`proveedor_facturacion` en NULL, así que devuelve 400 con `faltantes: ["proveedorFacturacion"]`.
Ahora el script captura el estado original, intenta devolverlo por la API, y si la API lo rechaza lo
restaura por SQL **imprimiendo el motivo exacto**, además de verificarlo contra la base como una
aserción más. Un fallo silencioso pasó a ser un fallo visible.

---

## Lo que no se pudo, y por qué

1. **No hay verificación visual en navegador de nada del bloque C.** Los componentes, los charts, la
   paleta de comandos y el muestrario están typecheckeados, servidos por Vite sin error de
   transformación y con el build de producción en verde — pero **no los miré**. El muestrario existe
   exactamente para que los revises de un vistazo: `/dev/muestrario`.
2. **Los atajos de teclado no se probaron con un teclado.** La lógica de "no dispararse en un campo
   de texto" y la secuencia `g` + tecla están escritas y typecheckeadas, no ejercitadas.
3. **11 verificadores que llaman al modelo no se corrieron** (`adjuntos_al_agente`, `alias_raza_e2e`,
   `borrado_adjunto`, `cache_compartido`, `cambio4_purga_consumo`, `dos_bloques`, `gcis_real`,
   `marca_correos`, `renderizado_informe`, `seleccion_raza_e2e`, `sembrado_plataforma`). Gastan
   crédito real de Anthropic en una sesión sin supervisión. Tampoco corrí los 3 que **envían correo
   real** por Resend (`correos_cobro`, `correos_transaccionales`,
   `correos_transaccionales_e2e`): mandar correos de verdad es una acción hacia afuera y no la tomo
   sin que estés. Ni `lan_completo`/`url_correos_lan`, que son de una configuración de red revertida.
4. **`verificar_motor_cobros` sigue fallando, y es preexistente** (falla idéntico con y sin el arreglo
   del bloque A). La primera aserción que cae es "intento 1: suscripción quedó 'morosa' (fue
   'activa')". No lo toqué: es el motor de cobros, fuera del alcance de los tres bloques.
5. **`verificar_almacenamiento_publico` falla por el estado del ambiente**, no por código: registra
   una clínica en CR y, cuando CR está inactivo, recibe 202. Con CR habilitado debería pasar; no
   volví a correrlo después de restaurar CR.

---

## Lo que queda para que decidas

1. **`paises.CR` está habilitado sin cumplir el checklist** (`proveedor_facturacion` en NULL). Es un
   estado que la propia API no permite crear: alguien lo puso directo en la base. Mientras siga así,
   el ambiente de desarrollo no es reproducible por la aplicación y la restauración de
   `agentes_paises_v2` tiene que ir por SQL. **Completar `proveedor_facturacion` para CR** lo
   arreglaría de raíz. Es una decisión de datos, no de código, y no la tomé.
2. **8 o 10 colores en la paleta de datos.** Tenés la tabla con el ΔE2000 alcanzable en cada caso.
   Elegí 10 por el color fijo por línea de negocio; si querés el margen extra, es un cambio de
   `paleta-datos.json` más el mapa.
3. **Los 9 modales escritos a mano** ya pueden usar `Modal` con `ancho`: `CerrarCasoModal`,
   `CronologiaModal`, `FichaPropietarioModal`, `ReabrirCasoModal`, `RegistroAtencionModal`,
   `ResolverCitaModal`, `VincularAtencionModal`, `NuevaCitaModal` y `EditarPacienteModal`. No los
   migré porque el prompt pedía no migrar pantallas existentes y porque cambiar el contenedor de un
   formulario de 11 campos sin poder mirarlo conviene hacerlo con alguien revisando.
4. **`seed.ts` tiene dos defectos preexistentes** que encontré al verificar el bloque B, y no los
   corregí: inserta sus propios agentes sin `ON CONFLICT`, así que **choca con `agentes_slug_key` si
   ya corrió `seed:plataforma`** (los dos sembrados son incompatibles entre sí), y no es idempotente
   — cada corrida inserta un tenant demo nuevo, de ahí "Clínica Veterinaria San Martín 2". Para
   verificar un cambio del seed hay que crear una base limpia, migrarla y correr `seed` **sin**
   `seed:plataforma`.
5. **`MenuExportar` es solo el componente y su contrato.** La exportación real (Excel tipado, PDF con
   logo y filtros, generada en el backend) llega con el prompt de dashboards, como pedía el prompt.
6. **El bundle de producción pasó los 900 kB** y la advertencia de tamaño de chunk sigue ahí
   (preexistente). Cuando los dashboards traigan recharts al bundle real va a crecer bastante más.
   Vale decidir si se parte con `manualChunks` antes de eso.
