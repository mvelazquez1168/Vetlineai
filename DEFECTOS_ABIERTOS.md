# Defectos

Defectos encontrados y **no corregidos**, con lo que hace falta para cerrarlos.
Separados del trabajo en curso a propósito: cada uno tiene su dueño y su
criterio de cierre, y ninguno se arregla de paso.

---

## Regla de admisión — R1

> **El resultado negativo de un verificador no se convierte en reporte de defecto
> hasta que una persona lee la fuente y confirma la ausencia.**

Sale de tres errores del mismo día, y los tres fueron lo mismo: **un criterio más
estrecho que el concepto que decía medir.** Cada uno pasó sus propias pruebas.

| Verificador | Decía medir | Medía en realidad | Consecuencia |
|---|---|---|---|
| `resolver_residuos_por_frase` | posición del residuo | posición en el espacio real, no en el degradado | 4 lecturas absurdas («olo» para una flecha) |
| `verificar_premisas_banco` | «hay un valor numérico» | cifra + unidad de una lista cerrada, sin `meses` | 1 premisa verdadera marcada falsa |
| `barrer_candidatos_umbral` | «el umbral está en la KB» | cifra + unidad — **las razones adimensionales no cuentan** | **D-001: defecto falso reportado** |

El tercero llegó más lejos que los otros dos: produjo un informe de defecto en
producción que era falso y estuvo a punto de llevarse a un veterinario. Lo frenó
que alguien fuera a leer el documento antes de escribir uno nuevo — no una
comprobación del sistema.

**Verificar la ausencia leyendo es barato. Reportar un defecto falso a un
veterinario, no.** La asimetría es la razón de la regla.

Los scripts de verificación imprimen esta regla junto a cualquier resultado
negativo, para que el paso de lectura no dependa de acordarse.

---

## D-001 — Cardiología exige cuatro criterios cuya fuente no existe

**CERRADO — falso positivo** · abierto y cerrado 2026-08-29

Se reportó que tres de los cuatro criterios del estadio B2 (AI:Ao, LVIDDN, VHS)
no estaban en la Base de Conocimiento de cardiología.

**Era falso. Los cuatro están**, completos, con sus valores, en
`Consenso ACVIM 2019 — Enfermedad Valvular Mitral Degenerativa (MMVD)`,
asignado a cardiología, ámbito clínico, incluido en contexto:

```
## 3. Criterios exactos para identificar Etapa B2
Deben cumplirse idealmente los 4 criterios antes de iniciar tratamiento
preventivo (es un compromiso de por vida):
- Intensidad del soplo ≥3/6.
- Razón ecocardiográfica AI:Ao (eje corto derecho, diástole temprana) ≥1.6.
- LVIDDN ≥1.7 (fórmula: LVIDd(cm)/peso(kg)^0.294).
- Score vertebral cardíaco (VHS) ajustado por raza >10.5.
Si no hay ecocardiografía: VHS general ≥11.5, o VLAS ≥3.
```

Con cita completa: Keene BW, Atkins CE, Bonagura JD, et al. *J Vet Intern Med.*
2019;33(3):1127-1140.

### Causa del falso positivo

El verificador exigía **cifra seguida de unidad** (`mg`, `%`, `cm`…). Los
criterios de B2 son **razones adimensionales**: `≥1.6`, `≥1.7`, `>10.5`. Los
números estaban y la prueba de «tiene valor numérico» no los reconoció.

### Lo que sí quedó, y es un resultado positivo

Los valores del consenso vigente, buscados de forma independiente en la fuente
externa, **coinciden exactamente con los que ya están en la base, incluida la
fórmula de normalización del LVIDDN**. El contenido de cardiología para B2 está
verificado contra la fuente vigente — algo que antes no se sabía y que no era el
objetivo de la búsqueda.

### Arrastre

El caso `C4` del banco N2 usaba «razón AI:Ao» como umbral *verificado ausente*
para cardiología. Está presente, así que ese caso no mide `E11` en cardiología y
hay que reemplazar la instancia y volver a correr ese par.

---

## Regla de admisión — R2

> **Toda categoría que signifique «no se pudo determinar» tiene que distinguir
> por causa. Y el conteo por causa tiene que ser automático: si depende de que
> alguien tenga la curiosidad de mirar, no existe.**

Una sola etiqueta que cubra «el caso estaba mal planteado» y «la máquina falló»
hace que la segunda se disfrace de la primera. Y no se lee como un error: se lee
como un dato sobre el diseño, que es peor, porque un error visible se corrige y
un dato falso se usa.

### El caso que la origina

`INDETERMINADO` era, por rúbrica, un resultado de primera clase con un
significado preciso: *la respuesta no aborda la situación planteada*. Es lo que
indica que un caso del banco está mal construido.

Al contarlos apareció que **6 de 12 no eran eso**: el juez había devuelto JSON
inválido y el arnés lo convertía en `INDETERMINADO`. La causa era previsible —
se le pedía JSON y la cita es texto verbatim que casi siempre trae comillas
adentro.

Ninguna prueba fallaba. El arnés terminaba con `[OK]`, la matriz se veía
completa, y la conclusión que se iba a sacar era *«seis casos del banco están mal
planteados»* cuando la mitad de ellos estaban bien y lo que fallaba era el
parser.

**Lo que lo hizo visible fue contarlos, no que algo fallara.** Por eso la regla
tiene dos mitades: separar por causa no alcanza si el conteo depende de que
alguien mire.

### Cómo queda aplicada

| Antes | Ahora | Significa |
|---|---|---|
| `INDETERMINADO` | `INDETERMINADO` | las dos pasadas coinciden: la respuesta no aborda la situación → el caso está mal planteado |
| `INDETERMINADO` | `DESACUERDO` | las dos pasadas discrepan → el criterio es ambiguo, no la respuesta |
| `INDETERMINADO` | `FALLO_JUEZ` | el juez no dictaminó → problema de la máquina, no del caso |

Las tres eran la misma etiqueta y significan cosas distintas: una acusa al banco,
otra al criterio, la tercera al arnés.

El arnés y el análisis imprimen el desglose por causa **siempre**, también cuando
da cero — afirmar la ausencia vale más que suponerla — y la corrida sale con
código distinto de cero si hay `FALLO_JUEZ`.

---

## Hallazgo — H1: los agentes divergen por pérdida, no por desacuerdo

**Confirmado** · 2026-08-29

Cuatro búsquedas independientes de contradicciones entre las nueve versiones del
estándar de razonamiento. **Ninguna encontró una.**

| Búsqueda | Método | Resultado |
|---|---|---|
| Lectura de los ocho prompts | manual, completa | ninguna |
| Contraste por temas | siete temas donde un choque sería grave | ninguna |
| Reglas duras | matriz de 11 reglas × 8 agentes | ninguna |
| Unión afirmación por afirmación | 426 afirmaciones, marca por polaridad | 4 candidatas, **las 4 falsas** |

Las cuatro candidatas de la última resultaron ser la misma regla con la cola
adaptada a cada especialidad:

```
cardiologia   Ninguna etapa se salta … la estadificación siempre ocurre después de confirmar
dermatologia  Ninguna etapa se salta … el diagnóstico de DA siempre después del descarte
endocrino     Ninguna etapa se salta … la confirmación siempre después de la estimulación
```

### Por qué importa

**El arreglo es restauración, no reconciliación.** Nadie decidió nunca que un
agente razonara distinto de otro: lo que hay son copias que perdieron pedazos al
adaptarse. Neuro no contradice a sus hermanos — tiene un tercio de su contenido.
Reproducción no discrepa — tiene otra cosa, y más avanzada.

Eso cambia el riesgo de toda la fase. Reconciliar dos reglas incompatibles exige
decidir cuál es la correcta, y esa decisión es clínica. Restaurar una regla
perdida solo exige copiarla del que la conserva, y se puede verificar byte a
byte. Es la diferencia entre un trabajo que necesita criterio veterinario en cada
paso y uno que necesita disciplina de copia.

### Salvedad

La ausencia de contradicciones está medida sobre el **texto** de los prompts. Dos
agentes pueden comportarse de forma incompatible sin que sus prompts se
contradigan — por lo que cada uno omite, no por lo que dice. Eso lo mediría N2, y
la corrida base no llegó a tener resolución para responderlo.

---

## Regla de admisión — R3

> **Toda comparación de datos estructurados tiene que ser canónica. Comparar la
> forma serializada es un generador de falsos negativos, porque el orden de las
> claves no es parte del dato.**

### El caso que la origina

La prueba de las dos fases tenía que verificar que el complemento no pisara
ningún campo del núcleo. Comparaba así:

```ts
JSON.stringify(nucleo[k]) !== JSON.stringify(completa[k])
```

Reportó que **el complemento había pisado seis campos**. No había pisado ninguno.

`JSON.stringify` conserva el orden de inserción de las claves. **JSONB no lo
conserva**: al guardar, Postgres las reordena por longitud y después
alfabéticamente. El núcleo recién generado tenía el orden en que lo escribió el
modelo; el mismo objeto leído de vuelta tenía el orden de JSONB. Mismo contenido,
serialización distinta.

```
modelo escribe:  diagnostico, evidencia_a_favor, evidencia_en_contra, sustento, ...
JSONB devuelve:  sustento, diagnostico, confirmacion, probabilidad, evidencia_a_favor, ...
```

### Por qué es una regla y no una anécdota

**Lo que evitó que llegara a reporte fue que el resultado era demasiado raro para
creerle** — seis campos pisados por un código que estructuralmente no puede
pisarlos. Eso es suerte, no método. La próxima vez el falso positivo puede ser de
un solo campo, y un solo campo pisado es perfectamente creíble.

Es la tercera vez en la misma semana que un verificador mide algo más estrecho
que lo que dice medir: el desplazamiento de índice, la cifra sin unidad, y ahora
el orden de las claves. Las tres pasaron sus propias pruebas.

### Cómo queda aplicada

Comparación canónica: se ordenan las claves recursivamente antes de serializar.
Se aplica a toda comparación de objetos que hayan pasado por la base, por la API
o por cualquier serialización — que en este sistema es casi todas.

Vale también en la otra dirección, y es la más peligrosa: dos objetos con el
mismo orden y **distinto contenido anidado** pueden parecer iguales si la
comparación es superficial. Canónica y profunda, las dos cosas.

---

## D-002 — La URL del JWKS hereda el esquema del issuer, no del anfitrión

**ABIERTO** · encontrado 2026-09-02 · causó una caída del inicio de sesión en producción

`backend/src/middleware/auth.ts` arma la dirección del JWKS así:

```ts
const jwksHost = config.keycloakJwksHost ?? issuerUrl.host;
jwksUri: `${issuerUrl.protocol}//${jwksHost}${issuerUrl.pathname}/protocol/openid-connect/certs`
```

El **anfitrión** es configurable (`KEYCLOAK_JWKS_HOST`) pero el **esquema** no:
sale siempre de `issuerUrl.protocol`, que es el del issuer público. Los dos
valores describen cosas distintas y se combinan como si describieran la misma.

### Qué provocó

En producción el issuer es `https://` (detrás de Caddy) y el anfitrión interno
es `keycloak:8080`, que dentro de la red de Docker escucha en **texto plano** —
Caddy termina el TLS afuera, `KC_HTTP_ENABLED: "true"`. Con
`KEYCLOAK_JWKS_HOST: keycloak:8080` puesta, la URL quedaba
`https://keycloak:8080/...`: la descarga del JWKS fallaba, con ella la
verificación de firma de todo token, y **nadie podía iniciar sesión**.

No se detecta en desarrollo porque ahí el issuer también es `http://`, así que el
esquema heredado resulta ser el correcto por casualidad.

### Cómo está hoy

Se desbloqueó **quitando `KEYCLOAK_JWKS_HOST` del compose de producción**. Sin
ella, `jwksHost` cae al anfitrión del issuer y el esquema heredado vuelve a
coincidir. Funciona, con un costo: la validación de firma resuelve por el camino
público, o sea que depende de que Caddy y el DNS público respondan, para algo que
podría resolverse dentro de la red.

`docker-compose.prod.yml` lleva la advertencia de no restaurar la variable.

### Criterio de cierre

Que el esquema se componga junto con el anfitrión y no se herede — por ejemplo
aceptando que `KEYCLOAK_JWKS_HOST` traiga el esquema (`http://keycloak:8080`), o
una `KEYCLOAK_JWKS_URL` completa. Cerrado el defecto, la variable puede volver y
la validación de tokens deja de depender del camino público.

Ojo al tocarlo: `issuerInternoDocker` (mismo archivo, unas líneas más abajo)
compone la cadena **de la misma forma** para armar la lista de issuers
aceptados, y arrastra el mismo supuesto.

### Por qué está acá y no arreglado de paso

Toca el camino de autenticación de producción, que es exactamente donde ya hubo
una caída. Merece su propio cambio y su propia verificación, no un arreglo
incidental dentro de otro trabajo.

---

## D-003 — El estado de salud del contenedor no lo consume nadie

**ABIERTO** · encontrado 2026-09-02 · sin impacto hoy, tapa un fallo mañana

`backend/Dockerfile.prod:69` define un HEALTHCHECK real y bien pensado —
`wget --spider http://localhost:4000/api/health`, cada 30 s, con 3 reintentos —
y `/api/health` (`index.ts:72`) consulta la base, no solo si el proceso vive.

El comentario que lo acompaña dice: *"El orquestador puede consultar esto para
saber si el contenedor está listo para recibir tráfico"*. **No hay tal
orquestador.** Se revisaron los tres lugares que podrían consumir ese estado:

| Candidato | Qué hace con el estado no-sano |
|---|---|
| `restart: unless-stopped` (compose) | Nada. Reacciona a que el proceso **salga**, no al estado de salud. |
| Caddy (`Caddyfile`) | Nada. Los `reverse_proxy` no tienen `health_uri` ni ninguna directiva de salud: reenvía igual. |
| Orquestador (ECS/Swarm/k8s) | No hay. Es `docker compose` plano sobre una EC2. |

O sea que el estado no-sano solo se ve escribiendo `docker ps` a mano.

### Por qué importa igual

Tiene un lado bueno: **no hay cascada**. Agotar el grupo de conexiones degrada
pero no reinicia nada, así que no se pierde trabajo en vuelo. Eso está bien y no
hay que "arreglarlo" con un reinicio automático.

El lado malo es el contrario: un backend genuinamente roto —base caída, grupo de
conexiones agotado— **sigue recibiendo tráfico** y devolviendo errores hasta que
una persona mire. El chequeo detecta el problema y no se lo cuenta a nadie.

### Criterio de cierre — decidido: avisar, NO sacar de rotación

Se evaluó agregar `health_uri /api/health` al `reverse_proxy` del Caddyfile para
que Caddy dejara de mandarle tráfico al backend enfermo. **Descartado, y el
motivo vale como criterio general para esta infraestructura:**

> **Con un solo servidor, sacar de rotación no ayuda: la alternativa a uno
> degradado es ninguno.** El usuario pasa de lento a caído y no gana nada. Y si
> el chequeo se vuelve estricto, una saturación transitoria apagaría tráfico que
> habría funcionado.

Lo que falta no es que el sistema se apague solo: es que **alguien se entere**.

### Bloqueado a propósito — se cierra junto con el monitoreo

No se construye una alarma para este síntoma suelto. Desde el despliegue **no hay
monitoreo de ningún tipo**: si el servidor cae, el aviso llega porque una clínica
llama por teléfono. Una alarma solo para el chequeo de salud del backend dejaría
ese hueco intacto y agregaría un mecanismo más que mantener.

Este defecto se cierra como parte de ese trabajo, no antes. Cuando se haga, el
estado no-sano del contenedor es una de las señales a cubrir, no el objetivo.

Mientras tanto, que el comentario del Dockerfile no prometa un orquestador que no
existe.

---

## D-004 — No hay monitoreo de ningún tipo en producción

**ABIERTO** · anotado 2026-09-02 · pendiente desde el despliegue

Hoy, si el servidor de producción cae, **el aviso llega porque una clínica llama
por teléfono.** No hay nada mirando: ni disponibilidad, ni errores, ni recursos,
ni la base.

Lo que ya existe y no se está usando: el HEALTHCHECK del contenedor (ver D-003)
detecta un backend enfermo y no se lo cuenta a nadie; `/api/health` sabe
distinguir "el proceso vive" de "la base responde"; los logs quedan en el
contenedor.

### Por qué está acá como un solo defecto

Se llegó a este punto desde D-003, que necesitaba una alarma. La decisión fue
**no armar una alarma para un síntoma suelto**: resolvería el chequeo del backend
y dejaría intacto todo lo demás, agregando un mecanismo más que mantener. Este
defecto es el trabajo real; D-003 es uno de sus casos.

### Señales que tendría que cubrir, al menos

- El contenedor del backend marcado no-sano (D-003).
- La instancia EC2 caída o sin responder.
- La base administrada: conexiones, y en particular el `idle in transaction` que
  disparó la alerta de AWS (ver la nota del incidente).
- Memoria: Keycloak ya fue matado por el kernel una vez sin dejar rastro útil en
  su propio log (ver la nota de `JAVA_OPTS_APPEND` en `docker-compose.prod.yml`).
- Errores de la aplicación que hoy solo quedan en el log del contenedor.

### Criterio de cierre

Que un fallo de producción llegue a una persona **antes** que a una clínica.

---

## Regla de admisión — R4

> **Una medición que da cero tiene que demostrar que ejercitó el camino que dice
> medir. Un cero que no midió nada se lee igual que un cero que sí midió.**

Sale de la migración del Dashboard (2026-09-02). Se medía cuánto tiempo queda una
transacción abierta y quieta durante la llamada al modelo. Las dos primeras
corridas dieron `MAXIMO: 0.0s` — el resultado buscado — y **ninguna de las dos
había llamado al modelo**:

| Corrida | Resultado | Lo que pasó en realidad |
|---|---|---|
| 1 | `HTTP 200`, `0.0s` | La compuerta de datos mínimos cortó: `raza` sale de `LEFT JOIN razas ON r.id = p.raza_id`, y el dato de prueba había llenado la columna de texto, no `raza_id` |
| 2 | `HTTP 402`, `0.0s` | El motor de crédito rechazó: el tenant descartable no tenía saldo |
| 3 | `HTTP 200`, `0.0s` | Generación real de 43.5 s — **este cero sí significa algo** |

Los tres ceros son idénticos en la salida. Lo que delató a los dos primeros no fue
ninguna comprobación: fue que **el tiempo total no cuadraba** — 0.1 s para algo
que debía tardar decenas de segundos.

### Es la misma familia que R1, R2 y R3

Un resultado plausible que no significa lo que parece. Igual que el verificador
que medía «cifra + unidad» y decía medir «hay un valor numérico», acá el arnés
medía «no hubo transacción abierta» y decía medir «la transacción ya no abarca la
llamada al modelo». Son cosas distintas cuando la llamada no ocurre.

### Cómo se aplica

La medición tiene que llevar **un testigo de que el camino se ejercitó**, no solo
la métrica. En este caso alcanzaba con cualquiera de estos, y conviene imprimir
los tres:

- el tiempo total (una generación real no baja de decenas de segundos);
- el efecto observable (`estado_generacion: generado`, el Dashboard persistido);
- el consumo registrado (una fila nueva en `uso_api`).

Vale para cualquier medición de una ausencia: si el número puede salir del camino
corto **y** del largo, no distingue nada por sí solo.

---

## D-005 — Un concepto "unificado" de la síntesis tiene tipos incompatibles entre las dos vistas

**CERRADO 2026-09-05** · encontrado 2026-09-04 · bloqueaba el cableado del informe

**Cómo se cerró: des-unificando.** Eran dos cosas distintas, no dos nombres del
mismo dato — lo decide la evidencia de los propios esquemas, no una preferencia:

- Las **reglas de presencia son incompatibles**: `razonamiento_diagnostico` es
  "siempre presente" y `clinical_reasoning_journal` admite null legítimo en un
  caso incipiente. Dos nombres del mismo dato no pueden diferir en eso; si fueran
  lo mismo, un caso incipiente dejaría al informe sin su sección más importante.
- El informe **ya cubre lo cronológico** en `historia_clinica` y
  `evolucion_clinica`, que es lo que el arreglo fecha/estado/motivo describe.
  `razonamiento_diagnostico` no es la evolución: es la argumentación.

La síntesis ahora carga las dos, como con `confianza`/`probabilidad`. El diario
estructurado queda en el **núcleo** (lo usa el dashboard) y la narrativa en el
**complemento** — sale del `origen` del campo, así que no se genera cuando nadie
pide el informe.

Y `verificar_sintesis_esquema.ts` compara **tipos** además de presencia (punto
4b). Se comprobó que el chequeo nuevo detecta el defecto: reponiendo la
unificación reporta `array|null ≠ null|string ← INCOMPATIBLES` y falla.

Verificado de punta a punta, 12/12: el informe genera (16.470 bytes), y el
segundo informe sobre síntesis vigente sale en **0.3 s con consumo cero**.

---



`CONCEPTOS_UNIFICADOS` (`sintesisClinica.ts`) declara que estos tres nombres son
el mismo concepto:

```
sintesis: "diario_de_razonamiento"
dashboard: "clinical_reasoning_journal"
informe:   "razonamiento_diagnostico"
```

Pero no son la misma **forma**:

| Campo | Tipo |
|---|---|
| `sintesis.diario_de_razonamiento` | `array` de `{fecha, hipotesis, estado, motivo}` |
| `dashboard.clinical_reasoning_journal` | `array` (igual) |
| `informe.razonamiento_diagnostico` | **`string`** — prosa |

La síntesis adoptó la forma del dashboard. Al proyectar el informe, ese array
llega a `construirCuerpoInforme`, que hace `texto.split()` sobre él y falla con
`TypeError: texto.split is not a function`. Medido: el informe devuelve HTTP 500
después de generar (y cobrar) la síntesis completa.

Los otros tres conceptos unificados sí son compatibles — `estado_clinico` es
`object` en las tres.

### Por qué no se arregla en la proyección

`proyectarInforme` renombra la clave de primer nivel y **nunca traduce valores**;
es lo que garantiza que las dos vistas no puedan contradecirse. Convertir el
array en prosa ahí sería que la proyección interprete, que es exactamente lo que
la fuente única existe para impedir.

### Es el error que el propio módulo ya advierte

`sintesisClinica.ts` documenta no fusionar `clinical_confidence` con
`matriz_evidencia` porque "el relevamiento los emparejó por posición" y son cosas
distintas: *"fusionarlas sería repetir el error de confianza/probabilidad, con
otro disfraz"*. Este caso es el mismo: la narrativa del razonamiento (informe) y
el registro de hipótesis activas/descartadas (dashboard) se emparejaron por tema,
no por ser el mismo dato.

### El verificador no lo detecta

`verificar_sintesis_esquema.ts` dice `[OK] la síntesis es superconjunto de las dos
vistas y el dashboard manda`. Comprueba **presencia de campos**, no compatibilidad
de tipos — así que pasó mientras un concepto unificado tenía dos formas
incompatibles. Misma familia que R1/R2/R4: mide algo más estrecho de lo que dice.
Su propio mensaje nombra la causa sin advertirla: *"el dashboard manda"*.

### Criterio de cierre

Es una decisión de producto sobre qué dice la sección "Razonamiento Diagnóstico"
del informe, que es un documento que se entrega:

- **Des-unificar**: la síntesis lleva las dos cosas — el diario estructurado para
  el dashboard y la narrativa para el informe. Cuesta un campo más en el esquema
  y que el modelo escriba las dos, pero cada vista recibe lo que su formato pide.
- **Unificar de verdad**: el informe pasa a renderizar el diario estructurado
  (fecha, hipótesis, estado, motivo). Una sola fuente sin duplicar, pero cambia lo
  que ve el veterinario y el tutor.

Y en cualquier caso, que `verificar_sintesis_esquema.ts` compare tipos además de
presencia.

---

## D-006 — Una clínica cuyo médico escribió un mensaje no se puede purgar nunca

**CERRADO** · abierto 2026-11-25 durante la verificación de `vetline-clinic-09a`
(facturador de Costa Rica), cerrado el mismo día por decisión explícita.
**No tenía nada que ver con la facturación**: apareció porque el barrido de
verificadores existentes dejó en rojo a `verificar_cambio4_purga_consumo`.

`DELETE FROM tenants` fallaba con:

```
mensajes_autor_persona_id_fkey
Key (id)=(…) is still referenced from table "mensajes".
```

`purga.ts::ejecutarPurgas` atrapaba el error y hacía `ROLLBACK` dentro de un
`catch`, así que **la clínica no se eliminaba y quedaba pendiente
indefinidamente**, en silencio salvo una línea de log. Y como
`mensajes.autor_persona_id` se llena en cuanto un médico escribe en el chat —que
es el uso normal del producto— afectaba a **cualquier** clínica con actividad.

### La decisión

> *«`mensajes.autor_persona_id` mantiene su regla: un médico no se borra en la
> operación normal, se desactiva, y sus mensajes son historial clínico. Que la
> purga deje de bloquearse, ordenando el borrado para que los mensajes se
> eliminen antes que las personas, o haciendo esa restricción DEFERRABLE
> INITIALLY DEFERRED, lo que sea más simple y seguro.»*

Se midió antes de elegir, y la medición cambió la respuesta: **no era una FK,
eran 42**. Toda FK `NO ACTION` entre dos tablas que la purga borra por cascada
tiene el mismo problema, porque cada rama de la cascada de `DELETE FROM tenants`
es **su propia sentencia interna** y `NO ACTION` se chequea al final de cada
sentencia — así que si la rama que borra `personas` corre antes que la que borra
`mensajes`, falla, y el orden entre ramas no se controla desde la aplicación.

Por eso **ordenar los borrados quedó descartado**: habría arreglado 1 de 42 y se
habría vuelto a romper con la 43ª, que es cualquier tabla nueva de Vetline Clinic.

### Lo que se hizo

1. **Migración `092_purga_fk_diferidas.sql`** — las 42 constraints pasan a
   `DEFERRABLE INITIALLY DEFERRED`. El chequeo se corre al `COMMIT`, cuando ya no
   existe ninguna de las dos filas. Están escritas una por una, no en un bucle
   `DO`: una migración tiene que hacer siempre lo mismo, corra cuando corra.
   La migración termina con un bloque que recalcula el cierre de la cascada y
   **falla** si quedó alguna sin diferir.
2. **La regla NO se debilitó.** La FK sigue existiendo y sigue siendo `NO ACTION`:
   borrar un médico que escribió un mensaje sigue prohibido, solo que el error
   llega en el `COMMIT`. Verificado como aserción, no como comentario.
3. **`restablecimientos_contrasena`** — encontrada al clasificar las 42: es de la
   misma familia pero **diferir no la arregla**, porque la fila que apunta
   sobrevive al `COMMIT`. La purga la borra a mano, como ya hacía con
   `notificaciones_callback`. Cualquier clínica cuyo usuario alguna vez usó
   «olvidé mi contraseña» también estaba trabada, y eso **no estaba en el
   síntoma original**.
4. **El SQL de esas dos vive en `tablasTenant.ts`**
   (`TABLAS_BORRADO_MANUAL_SIN_TENANT_ID`), no en `purga.ts`, para que la
   auditoría lea exactamente lo que la purga borra y no una copia.

### El segundo criterio de cierre: que la auditoría cubra la familia

El chequeo viejo de `auditoriaRls.job.ts` miraba FK **a `tenants`** sin cascada:
más estrecho que el concepto que decía cubrir, y por eso dejó pasar esto durante
meses. Ahora calcula qué tablas borra la purga —cierre transitivo de las cascadas
desde `tenants`, más las que borra a mano— y mira **toda** FK que apunte ahí
dentro, con el remedio que corresponde a cada caso:

| Situación | Remedio que reporta |
|---|---|
| La fila que apunta también se borra | `DEFERRABLE INITIALLY DEFERRED` |
| La fila que apunta sobrevive | borrado manual en la purga |

### Evidencia

| Verificador | Resultado |
|---|---|
| `verificar_cambio4_purga_consumo` | **TODO OK** — era el que estaba en rojo |
| `verificar_purga_completa` (nuevo) | **19 OK, 0 FAIL** |
| `verificar_auditoria_rls_reforzada` | **TODO OK**, con sección 3b nueva |

`verificar_purga_completa` no usa una lista escrita a mano: calcula del esquema
qué tablas pueden trabar (52 FK de 27 tablas), arma una clínica con una fila en
cada una, y la purga. La sección 5 confirma que la FK sigue prohibiendo lo que
prohibía. En `verificar_auditoria_rls_reforzada`, la sección 3b crea los dos
casos con remedio distinto y confirma que el chequeo los distingue y que diferir
apaga uno y no el otro — un chequeo que no falla contra el defecto no vale nada.

Correr `verificar_purga_completa` **purgó de paso 3 clínicas de prueba reales**
que llevaban días atascadas en `ventana_purga`: evidencia directa de que el
defecto estaba frenando purgas, no solo de que podía.

### Para antes del próximo despliegue

`npm run purga-pendiente` — **solo lectura** (abre `BEGIN TRANSACTION READ ONLY`).
Lista las clínicas que la purga va a eliminar en la próxima corrida, las que
tienen fecha futura, cuáles presentan el síntoma de D-006 y si la migración 092
está aplicada. Se probó que **detecta**, no solo que imprime «ninguna»: se creó
una clínica pendiente descartable y la listó.

No hay variante `:prod` compilada a propósito: `tsconfig.build.json` excluye
`src/scripts`, así que `node dist/scripts/…` sería un comando roto justo en el
momento en que más importa que funcione.
