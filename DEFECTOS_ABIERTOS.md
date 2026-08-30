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
