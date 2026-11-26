# Vetline Clinic 07d — Dictado por voz

Rama `vetline-clinic/07d-dictado-por-voz`, partida de la del 07c. Prompt:
`docs/prompts/vetline-clinic-07d-dictado-por-voz.md`. Fecha: 26/11/2026.

---

## 0. Relevamiento — cómo funcionaba el dictado de Vetline Ai

Lo que había antes de este prompt, leído en el código y no supuesto:

| Pregunta del prompt | Lo que encontré |
|---|---|
| Qué API usa | **Web Speech API del navegador** (`SpeechRecognition` / `webkitSpeechRecognition`), implementada en línea dentro de `CasoWorkspace.tsx` — 81 líneas mezcladas con el chat del caso. |
| En qué navegadores funciona | Chrome, Edge y Opera en computadora, y Chrome en Android. **No en Safari ni en iPhone.** |
| Cómo acumulaba el texto | `base + final + parcial`: lo que había escrito el médico, más los tramos finales, más el tramo en curso. El texto dictado **se agregaba**, nunca reemplazaba. |
| Cómo manejaba el micrófono | `continuous = true`, `interimResults = true`, `lang = "es-CR"`. Se cerraba al desmontar el componente. **No** se cerraba al cambiar de pestaña del navegador. |
| Qué pasaba en iPhone / PWA | El botón no se dibujaba (el chequeo de soporte ya existía y era correcto). Dentro de la PWA, lo mismo: el motor es el del navegador, y en iOS no está. |

Tres cosas de ese código se conservaron tal cual porque ya estaban bien: el texto se agrega, el
botón no se dibuja si no hay soporte, y el micrófono se cierra al desmontar. Lo que se agregó
aparte está más abajo.

---

## 1. Fase 1 — el dictado reusable, en toda la atención

**Commit `10038e5`.**

El dictado salió de `CasoWorkspace.tsx` y quedó en `frontend/src/components/ui/DictadoVoz.tsx`:

- `navegadorSoportaDictado()` — el chequeo, en un solo lugar.
- `useDictado(valorActual, onTexto, ref)` — el hook. `onTexto` recibe el valor completo que debe
  quedar en el campo: el hook sabe dictar, no sabe guardar, así que sirve igual para un campo con
  autoguardado que para uno que se guarda al salir.
- `BotonDictado` — el botón. Sin soporte **devuelve un ícono informativo, no un botón apagado**.
- `IndicadorMicrofono` — la franja roja fija de «micrófono abierto».

`CasoWorkspace.tsx` pasó a usar el hook: **−81 / +19 líneas**, mismo comportamiento.

### Lo que la fase 1 agregó

- **Puntuación por voz** (`frontend/src/lib/puntuacionDictada.ts`): `punto`, `coma`, `punto y
  coma`, `dos puntos`, `punto y aparte`, `nueva línea`, `signo de interrogación`.
  - Vive en su propio módulo **sin React**, para poder verificarlo sin navegador.
  - Es una **lista ordenada y no un objeto**: «punto y aparte» tiene que probarse antes que
    «punto», o la frase larga nunca se reconoce.
  - Una palabra que *contiene* «punto» o «coma» no se parte: «apuntar» y «comadreja» quedan
    enteras.
- **El micrófono se cierra también al cambiar de pestaña** (`visibilitychange`), que antes no.
- **Alt+M**, y solo para el campo con foco (`document.activeElement === ref.current`). Con nueve
  campos dictables en la atención, un atajo global tendría que adivinar en cuál dictar.
- **Micrófono en todos los campos largos de la atención**: motivo, anamnesis, **hallazgo de cada
  sistema anormal** (`CampoHallazgo`, nuevo), evaluación, tratamiento, indicaciones al cliente.

### Verificación de la fase 1

`frontend/src/lib/verificarPuntuacionDictada.ts` — **9 de 9 OK**.

Una de esas nueve aserciones documenta un error **mío**, no del código: al escribir la prueba
asumí que cada tramo dictado arranca en mayúscula. El código no lo hace y tiene razón —el tramo se
**agrega** a lo que ya había, y capitalizar partiría una frase en el medio: «el paciente llega
decaído **Y** luego vomitó»—. Corregí la prueba y dejé la aserción que explica por qué.

---

## 2. Fase 2 — la consulta completa, ordenada por IA

### Lo construido, archivo por archivo

| Archivo | Qué hace |
|---|---|
| `backend/src/migrations/119_dictado_de_la_consulta.sql` | El interruptor por clínica, `exp_dictados`, `tarifas_transcripcion`, `uso_transcripcion`. |
| `backend/src/expediente/transcripcion.ts` | La **interfaz** `Transcriptor` y sus dos implementaciones, más el vocabulario de la clínica. |
| `backend/src/expediente/dictadoBorrador.ts` | El ordenamiento por modelo de lenguaje, con `tool_use` y validación de lo que devuelve. |
| `backend/src/expediente/dictado.ts` | Guardar, ver, descartar y **aplicar campo por campo**; el calce con el catálogo y el cálculo de dosis. |
| `backend/src/routes/dictado.routes.ts` | `/api/dictado` — estado, transcribir, ver, aplicar, descartar, audio. |
| `backend/src/jobs/dictadoAudio.job.ts` | El barrido que borra el audio vencido, cada hora. |
| `backend/src/tarifas.ts` | `registrarUsoTranscripcion` y la compuerta de crédito sin agente. |
| `frontend/src/components/expediente/DictadoConsulta.tsx` | El panel: grabar, ver el borrador, marcar y aceptar. |
| `frontend/src/lib/dictadoApi.ts` | El cliente (multipart, por el audio). |
| `frontend/src/pages/admin/Notificaciones.tsx` | La sección **Servicios de IA** con el interruptor y la retención. |

### Las cuatro decisiones de diseño que explican el resto

**1. El modelo reparte; no elige códigos ni medicamentos.**
Los sistemas, vías, frecuencias y unidades se le pasan como lista cerrada del catálogo de **esa**
clínica, y lo que devuelve se **valida contra el catálogo** antes de guardarlo: un `enum` en el
esquema de la herramienta es una instrucción, no una garantía. Los medicamentos no se le pasan: el
modelo transcribe el nombre que se dijo y el calce lo hace una consulta SQL que se puede leer y
repetir. Mandarle el catálogo entero sería un prompt enorme y un calce que nadie puede auditar.

**2. Si calzan dos medicamentos, no se elige ninguno.**
Queda sin calzar y marcado `revisar: nombre`. Elegir el primero de dos presentaciones del mismo
principio activo es elegir una dosis por el médico.

**3. Lo que no se entendió queda vacío y marcado, nunca completado.**
La instrucción al modelo lo dice cinco veces y de cinco formas distintas, porque es la regla que
más cuesta mantener: «Carprofeno 4 mg/kg» sin frecuencia **no es** «cada 24 horas».

**4. Aplicar es campo por campo, y por los mismos caminos que escribir a mano.**
`aplicarBorrador` usa `guardarSoap`, `marcarSistema`, `agregarDiagnostico`, `agregarLinea` y
`pedirEstudio` — ningún `UPDATE` directo. Si el 07c valida algo al agregar una línea de receta, el
dictado se come esa validación igual que el médico. Y lo que no se marcó **no se escribe**.

### Lo que el dictado NO hace, a propósito

- **No firma.** La atención queda en borrador; la firma sigue siendo el acto explícito del 07.
- **No cobra.** `cuentaViva` después de aplicar el borrador completo devuelve **0 cargos**.
- **No agenda.** El control queda propuesto en `control_fecha`; la cita la crea el cierre.
- **No dispensa.** Las líneas de receta entran con `dispensado_aqui = false`: entregar descuenta
  inventario y cobra, y eso se decide en la receta con el lote a la vista.
- **No pide un servicio para el estudio.** Sin servicio no hay cargo, y qué servicio corresponde a
  «radiografía de rodilla» lo elige el médico: elegirlo por él sería cobrarle al cliente un precio
  que nadie confirmó.

### «El resto normal» es una propuesta aparte

Tiene su propia casilla y **nunca arranca marcada**. Es la única parte del borrador que afirma algo
que el médico no dijo sistema por sistema.

---

## 3. El proveedor de transcripción, elegido y justificado

Está detrás de la interfaz `Transcriptor`, con dos implementaciones.

### El elegido: Deepgram nova-2

| Criterio | Deepgram nova-2 | OpenAI `whisper-1` / `gpt-4o-transcribe` | Google Speech-to-Text v2 |
|---|---|---|---|
| Español de América Latina | `language=es-419`. No hay un `es-CR` propio en ninguno de los tres. | `language=es`, sin variante regional. | `es-US` / `es-419`. |
| **Vocabulario veterinario** | **`keywords` con peso por término** — «carprofeno:2» gana contra «car profe no». | Solo una pista de contexto en el `prompt`, sin peso por término. | `phrase_sets` con boost, equivalente. |
| Unidad de cobro | **Por minuto de audio**, precio de lista público. | Por minuto. | Por minuto (en bloques de 15 s). |
| Precio de lista (26/11/2026) | **USD 0,0043/min** (pre-recorded nova-2). | USD 0,006/min. | USD 0,016/min sin compromiso. |
| Integración | Una llamada HTTP con el audio crudo. **Sin SDK nuevo.** | SDK o multipart. | SDK de GCP, con credenciales de servicio. |
| Dónde se procesan los datos | EE. UU. por omisión; tiene opción de no retención y de despliegue regional. | EE. UU. | Región elegible. |

**Por qué Deepgram:** el refuerzo de vocabulario con peso es lo que decide. El 80 % de los errores
que importan en un dictado veterinario son nombres de fármacos y de razas, y es exactamente lo que
`keywords` resuelve y una pista de contexto no. Que además sea el más barato por minuto y no
agregue un SDK es lo que rompe el empate con Google.

**El vocabulario se arma del catálogo real de la clínica**, no de una lista fija nuestra: los
medicamentos y presentaciones activos, sus principios activos y las razas de sus pacientes
ordenadas por frecuencia. Una lista nuestra envejecería y no serviría para la clínica equina ni
para la que importa un antiparasitario que no conocemos. Se refuerzan solo las palabras de 4 letras
o más y sin dígitos: de «Amoxicilina 500 mg» sale «Amoxicilina», porque «500» y «mg» el modelo ya
los reconoce y reforzarlos gasta cupo (el tope de Deepgram es 500 términos).

> **NO ESTÁ PROBADO CONTRA EL SERVICIO REAL.** Este entorno no tiene credenciales de Deepgram. Lo
> que sí está probado es que **sin credencial el camino falla diciendo exactamente qué falta**
> (`disponible()` devuelve `{listo: false, motivo: "Falta DEEPGRAM_API_KEY…"}`, y la pantalla
> muestra ese motivo en vez de un botón que no anda). El código de la llamada —parámetros, lectura
> de la respuesta, duración cobrada— está escrito contra la documentación de la API, no verificado
> con tráfico real.

### El simulado: el de desarrollo

`TRANSCRIPCION_PROVEEDOR` por omisión es **`simulado`**, con el mismo criterio que
`FE_CR_PROVEEDOR` del facturador: en desarrollo siempre el simulado, y el default lo refleja en vez
de confiar en que nadie exporte la variable por error.

**El simulado no inventa un dictado: devuelve el texto que le pasa el navegador.** Puede sonar a
que no hace nada, y es deliberado. Lo que hay que poder recorrer sin credenciales es **todo el
resto** del camino —el ordenamiento, el borrador, la revisión campo por campo, el descuento del
crédito— y para eso hace falta un texto de entrada realista, no uno fijo que siempre ordena igual.
De dónde sale: del dictado de la fase 1, que ya corre en el navegador y ya reconoce español. Así la
verificación es de punta a punta y con voz real, **sin mandar audio a ningún servidor de terceros**.

El texto del cliente **lo ignora el proveedor real**. Si no lo ignorara, cualquiera podría mandar
un texto inventado y ahorrarse el audio.

Su tarifa es **0 y no facturable**, sembrada así en `tarifas_transcripcion`.

---

## 4. El crédito: dos unidades, un solo saldo

El prompt pide que todo pase por la compuerta existente, con el costo por minuto medido. Eso obligó
a dos cambios en el motor de crédito, los dos chicos y los dos explicados en el código:

**1. La compuerta ya no exige un agente.** `verificarAntesDeGenerar` nació con `agenteId: string`
porque sus cuatro consumidores (chat, Dashboard, Informe, receta) son todos de un agente de Vetline
Ai, y la verificación chequea que **ese** agente esté habilitado para la clínica. El dictado no es
un agente: es un servicio del expediente de Vetline Clinic, habilitado por
`configuracion_notificaciones.dictado_ia_activo`. Ahora el parámetro es `string | null`, y con
`null` se saltean los dos chequeos de agente y **corren todos los demás**: suscripción finalizada,
ventana de purga, saldo y colchón de gracia. Verificado: en ventana de purga el dictado se rechaza
con `fuera_de_ventana` (ahí solo se permite el Informe), y sin saldo con el colchón consumido, con
`colchon_agotado`.

**2. Un minuto de audio no es un token.** `uso_api` tiene cuatro columnas de tokens `NOT NULL` y
cuatro FK a `tarifas_modelo`, que cobra **por millón de tokens**. Meter minutos ahí —o en una fila
de `tarifas_modelo` cuya columna se llama `precio_usd_por_millon`— sería una columna que miente, y
ya nos pasó tres veces que el defecto fuera el nombre y no la falta de un comentario. Así que:

- `tarifas_transcripcion` — precio **por minuto** por proveedor, con vigencia por fecha (igual que
  `tarifas_modelo`), para poder reconstruir un consumo viejo con la tarifa que tenía ese día.
- `uso_transcripcion` — segundos, costo, proveedor, tarifa y bolsa afectada.
- **El descuento es el mismo.** `descontarSaldo` se generalizó con un parámetro de referencia
  (`uso_api` / `uso_transcripcion`) y su descripción, así el libro mayor
  (`movimientos_credito.referencia_tabla`) dice de cuál de los dos consumos vino cada descuento. El
  cliente ve **un solo crédito de IA**, porque es un solo crédito de IA.
- **Sin tarifa cargada no se inventa un precio**: se registra en cero, no cobrable, y queda el log.

También quedó más honesto `RegistrarUsoApiParams.casoId`, que ahora es `string | null`: la columna
siempre fue nullable y el dictado es el primer consumo que nace de una atención y no de un caso.

### Y `uso_transcripcion` traba la purga a propósito

Misma naturaleza que `uso_api`: es rastro de consumo, y su FK a `tenants` **no** tiene cascada para
que borrarlo sea un acto explícito. La consecuencia es que traba el `DELETE FROM tenants`, así que
está en `TABLAS_BORRADO_MANUAL_EN_PURGA` —la lista única que leen la purga y la auditoría de RLS—.
El verificador comprueba las dos mitades: que el borrado se traba, y que la tabla que lo traba está
en esa lista. En el 07c una FK así, sin nombrar, rompió el borrado de una clínica; ésta no va a
repetirlo en silencio.

---

## 5. Privacidad

| Qué | Dónde queda | Por cuánto |
|---|---|---|
| El audio | No se guarda. Va al proveedor, se transcribe y se descarta. | **0 horas por omisión.** |
| El audio, si la clínica lo configura | Almacenamiento privado, `dictados/<tenant>/<uuid>`, con fila en `archivos` y vencimiento en `exp_dictados.audio_borrar_despues_de`. | Lo que configure, 1 a 720 horas. |
| El texto transcrito | `exp_dictados.texto_transcrito`, con RLS forzada por clínica. | Mientras viva el expediente. |
| El borrador | `exp_dictados.borrador` (jsonb), misma RLS. | Ídem. |

- **El valor por omisión de la retención es 0 y eso significa que el audio nunca llega al
  almacenamiento** — no es que se guarde y se borre: el camino no se ejecuta.
- **`dictadoAudio.job.ts` corre cada hora**, no una vez al día: una retención de 1 hora tiene que
  significar una hora, no «hasta mañana a las 9». Borra el objeto primero y la fila después —al
  revés, un fallo en el medio dejaría un archivo que nadie puede volver a encontrar para borrar—.
- **El texto no se borra al descartar un dictado.** El dictado descartado es la prueba de qué dijo
  el médico cuando el borrador salió mal, y es lo único que sirve para entender por qué.
- **El audio guardado se puede escuchar** (`GET /api/dictado/:id/audio`), autorizado a través de
  `exp_dictados`, que sí tiene RLS por tenant — `archivos` no la tiene. Guardar algo que nadie
  puede escuchar no serviría de nada.
- El manual lo explica en [dictado-consulta-completa.md](../ayuda/dictado-consulta-completa.md),
  sección «Privacidad».

---

## 6. Disponibilidad

- **Solo el rol médico.** El router entero está detrás de `esMedico`; un administrador puede ver la
  atención, dictarla no.
- **La clínica lo activa** en Administración › Notificaciones › **Servicios de IA**, con su campo de
  retención de audio al lado.
- **Apagado por omisión**, al revés que los diez avisos de esa misma pantalla: los avisos son
  gratis y el dictado consume crédito. Encenderlo tiene que ser una decisión de la clínica, no algo
  que descubre en la factura.
- Sin fila de configuración también está apagado (*fail-closed*).
- `GET /api/dictado/estado` existe para que la pantalla **no dibuje el recuadro** cuando no
  corresponde: un botón que al tocarlo contesta «tu clínica no tiene esto» es un botón que no
  debería haber estado ahí.

**Nota para el 04:** el interruptor vive en `configuracion_notificaciones` porque es la fila única
por clínica que esa pantalla ya edita. Cuando el 04 reubique los servicios de IA, **esto se mueve
con él, no se duplica**.

---

## 7. Verificación

### Automática — `verificar_dictado_07d.ts`: 92 de 92 OK

```
docker compose exec backend npx ts-node src/scripts/verificar_dictado_07d.ts
```

Sin `--transpile-only`, como corresponde. **Hace dos llamadas reales al modelo**, y es el punto: lo
que hay que comprobar no es que el código compile, es que el ordenamiento reparta un dictado real y
que no invente lo que no se dijo. Un doble del modelo verificaría nuestro doble.

Las once secciones (92 aserciones): el interruptor (apagado por omisión, *fail-closed*, se enciende) · los dos
proveedores detrás de la misma interfaz y el real fallando sin credencial · el vocabulario salido
del catálogo · la compuerta sin agente, con purga y sin saldo · el ordenamiento del ejemplo del
prompt campo por campo · el calce, la dosis por peso y el aviso de alergia · el consumo en las dos
unidades sobre el mismo saldo · aplicar campo por campo · la dosis ambigua · descartar sin perder el
texto · la limpieza y la FK que traba la purga.

Algunos resultados concretos de esa corrida:

- temperatura **38,9** leída de «38,9» (coma decimal), FC **110**, FR **28**, peso **18**;
- «el resto del examen normal» → `restoNormal: true`, y **no** se agregaron los demás sistemas a la
  lista;
- sistema **Locomotor / anormal / «Dolor a la palpación de la rodilla derecha»**, con el código
  validado contra el catálogo de esa clínica;
- «sospecho ruptura de ligamento cruzado» → diagnóstico **presuntivo**;
- frecuencia `c24h`, duración 7 `dias`, control **10** días, estudio «Radiografía de rodilla»;
- `4 mg/kg × 18 kg = 72 mg`, con el aviso de alergia del 07c visible **en el borrador**;
- 95 s de audio → **USD 0,006808** (95/60 × 0,0043), bolsa `plan`;
- `movimientos_credito.referencia_tabla` = `['uso_api', 'uso_transcripcion']`;
- aplicando solo `motivo_consulta`, `signos` y `sistemas`: **el plan, el control y el diagnóstico
  quedaron vacíos**, y los sistemas normales en 0;
- marcando después `resto_normal`: **12 sistemas** quedaron Normal;
- `cuentaViva` tras aplicar todo: **0 cargos**; `atenciones.estado`: **borrador**.

### Medición — `medir_dictado_07d.ts`: 10 dictados

```
docker compose exec backend npx ts-node src/scripts/medir_dictado_07d.ts
```

Diez dictados con terminología veterinaria, escritos para cubrir casos distintos: el ejemplo del
prompt, otitis felina, cuerpo extraño, control de vacunación sin hallazgos, dermatitis con dos
medicamentos, **una dosis que se corta**, un geriátrico con varios sistemas, una herida con sutura,
una desparasitación de dos datos, y **un dictado desordenado con una corrección en el medio**.

Cada caso tiene dos listas: lo que **debe aparecer** y lo que **no puede inventarse**.

| Medición | Resultado |
|---|---|
| Campos repartidos en el campo correcto | **71 de 71 (100,0 %)** |
| Datos inventados | **0 de 20 controles (0,0 %)** |
| Audio estimado | 186 s en total (19 s por dictado) |
| Costo de transcripción (deepgram-nova-2) | USD 0,013330 |
| Costo de ordenamiento (claude-sonnet-4-6) | USD 0,175000 |
| **Costo por consulta** | **USD 0,0188** (transcripción 0,0013 + ordenamiento 0,0175) |

Los dos casos difíciles pasaron: en el de la dosis cortada la línea quedó **sin dosis y marcada**
`revisar: [dosis, via, frecuencia, duracion]`, y en el desordenado quedó la corrección («orina poco
y con esfuerzo») y **no quedó** el medicamento que el médico retiró en la misma frase.

**Cómo leer el 100 %, sin inflarlo:**

- Son **71 comprobaciones de campo sobre 10 dictados que escribí yo**. No es una muestra de
  dictados reales de clínica.
- Entra **texto**, no audio: equivale a una transcripción perfecta. Lo que se midió es el **techo
  del sistema**, no su precisión de punta a punta.
- **La precisión de la transcripción no está medida** y no se puede medir en este entorno: hace
  falta audio real y credenciales de Deepgram. Es el número que falta, y es el que más va a mover
  el resultado real.
- El costo por consulta está calculado con **19 s de audio por dictado**, que es lo que miden estos
  textos cortos. Un dictado real de consulta son 60 a 120 s: a **90 s**, la transcripción sube a
  USD 0,0065 y el **costo por consulta queda en ~USD 0,024**. El ordenamiento no cambia con la
  duración del audio, solo con el largo del texto.

### En el navegador, con `demo.medico`

Clínica «Clínica Prueba Facturacion QA», servicio activado, atención en borrador de **Toby** (18 kg
dictados contra 32,4 kg en el expediente). El dictado se creó por la **ruta HTTP real**
(`POST /api/dictado/atenciones/:id`, multipart con audio y con el texto del navegador), y el resto
—ver el borrador, marcar y aceptar— se hizo clic a clic en la pantalla.

Capturas en `docs/diseno/capturas/07d/`.

**Lo que se vio en el borrador** (`borrador-propuesto-por-dictado.png`):

- la etiqueta **PROPUESTO POR DICTADO**, «95 s de audio · proveedor simulado», y los enlaces «Ver lo
  que dicté» / «Ocultar el borrador»;
- el aviso en castellano: «Hay 3 cosas que no se entendieron del dictado y quedaron sin completar:
  **el peso (los signos) · la vía de administración (la receta) · qué estudio es (los estudios)**»;
- al tocar **Marcar lo que está completo**: quedaron marcados Motivo, Anamnesis, Examen por
  sistemas, Evaluación, Plan y Control; quedaron **sin marcar** Signos, Receta y Estudios —los tres
  que tienen algo que revisar— y «Marcar el resto de los sistemas como normales»;
- la línea de receta: «Carprofeno *(no está en el catálogo: va como texto libre)*», con
  **«4 mg/kg × 18 kg = 72 mg — con el peso dictado (18 kg), que se registra al aceptar Signos»**;
- el pie: «Aceptar no firma ni cobra nada: la atención se cierra aparte, como siempre».

**Lo que quedó en la base después de «Aceptar lo marcado»:**

| En la base | Valor | Por qué |
|---|---|---|
| `motivo_consulta` | «Cojera del miembro posterior derecho de 3 días de evolución.» | aceptado |
| `plan_tratamiento` | «Carprofeno 4 mg/kg cada 24 horas por 7 días…» | aceptado |
| `control_fecha` | **2026-12-06** (10 días) | aceptado |
| `exp_diagnosticos` | 1 — ruptura de ligamento cruzado, presuntivo | aceptado |
| `exp_examen_sistemas` | **13 filas, 1 anormal, 0 normales** | aceptado (el sistema anormal) |
| `temperatura` / `peso` | **null** / **32,4** (sin cambio) | «Signos» tenía algo que revisar: **no se marcó, no se registró** |
| `recetas` | **0** | ídem |
| `exp_estudios_lab` | **0** | ídem |
| `exp_atencion_items` | **0** | **el dictado no cobra nada** |
| `atenciones.estado` | **borrador** | **el dictado no firma nada** |
| `exp_dictados.campos_aplicados` | `{motivo_consulta, anamnesis, plan_tratamiento, control, sistemas, diagnosticos}` | queda registrado qué aceptó el médico |

**Lo que el navegador no puede ejercitar, y hay que decirlo:** la captura del micrófono. Un
navegador sin micrófono real entrega silencio, y de ahí no sale ningún texto. Esa parte quedó
verificada en la **fase 1**, con voz real; la fase 2 se verificó desde el punto inmediatamente
siguiente —el audio y el texto ya capturados, entrando por la ruta real—.

## 8. Los dos defectos reales que encontró la pantalla

Los dos salieron de **mirar la pantalla con datos reales**, no de leer el código. Los dos tienen su
aserción de regresión en el verificador.

### 8.1 La dosis se calculaba con el peso viejo del expediente

El primer borrador real de Toby mostró:

```
4 mg/kg × 32,4 kg = 129,6 mg
```

El médico había dictado **«peso 18 kilos»**. Los 32,4 kg eran el peso de una visita anterior, que es
lo que tenía el expediente porque el peso dictado **todavía no estaba aceptado**.

Mi código hacía eso **a propósito** y lo tenía documentado: «el peso que se usa es el de
`pesoParaDosis`, no el que el modelo entendió; usar un peso que todavía no está aceptado sería
calcular con un dato sin confirmar». El razonamiento era defendible y el resultado era malo: una
dosis de 129,6 mg para un perro de 18 kg, con la cuenta hecha y con aspecto de correcta. Es
exactamente lo que `calcularDosis` evita en todos los demás caminos del 07c.

**Cómo quedó:** si el dictado trae peso, la cuenta se hace con **ése**, y la línea queda marcada
`pesoDelDictado` para que la pantalla diga «*— con el peso dictado (18 kg), que se registra al
aceptar «Signos»*». Si no lo trae, se usa el del expediente, como el resto del 07c.

**Regresión:** con el expediente en 32,4 kg, sin peso dictado da 129,6 mg y `pesoDelDictado =
false`; con peso dictado 18 da **72 mg** y la marca puesta.

### 8.2 El examen quedaba con dos filas del mismo sistema

Después de aceptar el borrador, el examen de Toby tenía **catorce** filas: las trece de la
plantilla, con «Locomotor» sin evaluar, y una decimocuarta **«locomotor»** en minúscula, marcada
anormal con el hallazgo.

`exp_examen_sistemas.sistema` guarda la **etiqueta** —«Locomotor»—, que es lo que siembra
`aplicarPlantilla` y lo que la pantalla dibuja. Mi `aplicarBorrador` marcaba por **código**
(«locomotor»), y el `ON CONFLICT (atencion_id, sistema)` de `marcarSistema` no podía evitarlo:
para Postgres eran dos sistemas distintos. El resultado en pantalla era un examen que decía dos
cosas a la vez sobre el mismo sistema.

**Cómo quedó:** se marca por etiqueta. Y «el resto normal» dejó de recorrer el catálogo para
recorrer **los sistemas que esta atención ya tiene**, que es lo correcto por otro motivo además: la
plantilla que se aplicó al abrir la atención es la que decide cuáles se examinan, y puede no ser el
catálogo entero.

**Regresión:** el verificador ahora guarda cuántas filas sembró la plantilla (13) y, después de
aplicar el borrador completo, exige **las mismas 13 filas y un solo sistema anormal**. Antes la
aserción solo contaba cuántos quedaban en «normal», y por eso el defecto pasó: contaba lo que
esperaba ver, no lo que no tenía que aparecer.

### 8.3 Y una tercera, de interfaz

El aviso de «revisar» mostraba los nombres internos del modelo: «Hay 2 cosas que no se entendieron:
**receta[0].via · estudios[0].tipo_estudio**». Correcto para el código, inútil para el médico.
Ahora se traducen (`revisarEnCastellano`): «la vía de administración (la receta) · qué estudio es
(los estudios)». Lo que no se reconoce se muestra tal cual, sin inventarle una traducción: es texto
del modelo y puede ser una frase entera.

## 9. Lo documentado y no construido (sección 3 del prompt)

`docs/diseno/dictado-escriba-ambiental-y-comandos.md`, con lo que implicaría cada uno:

- **Escriba ambiental** — grabar la conversación con el dueño. Lo que lo bloquea no es técnico:
  es el consentimiento de un tercero que no es usuario nuestro, la Ley 8968 y el país de cada
  clínica, poder revocar y poder demostrar qué se descartó de lo que se oyó y no era clínico. Se
  reusaría casi toda la fase 2; lo que no se reusaría es la regla de que el médico activa y detiene.
- **Comandos de voz** — el problema no es reconocer «cerrar atención», es qué pasa cuando se
  reconoce mal. El dictado es seguro porque su resultado es **texto editable**; un comando ejecuta,
  y los verbos de esta pantalla no son reversibles. Lo que sí tiene sentido y ya está son los
  atajos de teclado.

---

## 10. El manual de usuario (sección 12 de la guía)

| Página | Qué cubre |
|---|---|
| [dictado-en-un-campo.md](../ayuda/dictado-en-un-campo.md) | El micrófono por campo, la tabla de comandos de puntuación, el atajo, los navegadores donde funciona y por qué en iPhone no. |
| [dictado-consulta-completa.md](../ayuda/dictado-consulta-completa.md) | Cómo dictar de corrido, el ejemplo con la tabla de lo que propone, qué significa «revisar», cómo dictar para que salga bien, y la privacidad del audio. |

Las dos siguen el formato de siete partes de la sección 12 y están enlazadas desde
`docs/ayuda/README.md`.

---

## 11. Lo que queda pendiente

1. **La precisión de la transcripción real, sin medir.** Hace falta `DEEPGRAM_API_KEY` de
   desarrollo. Con ella, el camino a correr es el mismo verificador con
   `TRANSCRIPCION_PROVEEDOR=deepgram` y audio grabado de verdad, y lo que hay que medir es cuántos
   nombres de fármacos y razas sobreviven al reconocimiento.
2. **La llamada a Deepgram no se ejecutó nunca.** Está escrita contra la documentación. El primer
   intento real puede encontrar un parámetro mal puesto o una forma de respuesta distinta.
3. **El audio guardado no tiene reproductor en la pantalla.** El endpoint existe y está
   autorizado; el panel todavía no ofrece un botón para escucharlo. Con la retención en 0 por
   omisión, no hay nada que escuchar en el camino normal.
4. **Dictar en iPhone no se probó** (no hay un iPhone en este entorno). Por diseño debería
   funcionar: el audio lo graba `MediaRecorder`, que Safari soporta desde iOS 14.3, y la
   transcripción es del servidor. Lo que **sí** está verificado es que el dictado *por campo* de la
   fase 1 no se ofrece ahí, y que el ícono informativo lo explica.
5. **Un dictado muy largo no se probó.** El tope de subida son 20 MB (unos 40 minutos de opus); una
   consulta dictada está dos órdenes de magnitud por debajo.
6. **El borrador no se puede editar en el panel**, solo aceptar o destildar. Corregir un campo se
   hace después, en su campo de la atención. Es lo que el prompt pide («corregir un campo, aceptar
   el resto y firmar»), y se cumple así; un editor dentro del borrador sería un segundo lugar donde
   escribir lo mismo.

---

## 12. Lo que esta entrega cambió fuera del 07d

Tres cosas tocaron código compartido, y conviene tenerlas a la vista:

1. **`verificarAntesDeGenerar(agenteId)` ahora acepta `null`.** Los cuatro consumidores existentes
   no cambian (siguen pasando su agente); el comportamiento con un agente es idéntico.
2. **`RegistrarUsoApiParams.casoId` ahora es `string | null`.** Solo se amplió el tipo para que
   coincida con la columna, que siempre fue nullable.
3. **`descontarSaldo` recibe de qué tabla viene el consumo**, con el valor por omisión que
   reproduce exactamente lo de antes (`uso_api` / «Consumo de IA»).

Ninguno de los tres cambia lo que ya funcionaba; los tres están explicados en el código, donde el
próximo que los lea los va a encontrar.
