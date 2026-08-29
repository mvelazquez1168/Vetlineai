# Defectos abiertos

Defectos encontrados y **no corregidos**, con lo que hace falta para cerrarlos.
Separados del trabajo en curso a propósito: cada uno tiene su dueño y su
criterio de cierre, y ninguno se arregla de paso.

---

## D-001 — Cardiología exige cuatro criterios y la fuente de tres no existe

**Abierto** · 2026-08-29 · contenido clínico · dueño: veterinario

El prompt de cardiología obliga:

> Nunca asignas un estadio B2 sin que se cumplan explícitamente los 4 criterios
> documentados en la Base de Conocimiento (intensidad de soplo, razón AI:Ao,
> LVIDDN, VHS/VLAS).

**Tres de esos cuatro criterios no están en la Base de Conocimiento del agente**
con valor numérico. Verificado sobre los 21 documentos que cardiología recibe en
contexto (`agente_id` propio o NULL, activos, `incluir_en_contexto`):

| Criterio | En la KB |
|---|---|
| intensidad de soplo | presente |
| razón AI:Ao | **ausente** |
| LVIDDN | **ausente** |
| VHS / VLAS | **ausente** |

### Consecuencia en producción

Un veterinario que pide estadificar recibe una de dos cosas, y las dos son malas:
una negativa a estadificar, o un número inventado presentado como criterio
documentado. La segunda es peor, porque no se ve como una omisión.

Es exactamente el modo de falla que el invariante `E11` (procedencia de todo
número) va a hacer visible, pero `E11` no lo arregla: `E11` obliga a declarar de
dónde sale el número, y acá el problema es que no hay de dónde.

### Cómo se encontró

No lo encontró la lectura de los prompts ni el diseño de la arquitectura. Lo
encontró exigir que las premisas del banco de pruebas N2 fueran verdaderas: el
caso C4b necesitaba un umbral verificado *presente* en cardiología, y al buscarlo
apareció que los criterios de B2 no estaban.

Reproducible con `backend/src/scripts/barrer_candidatos_umbral.ts`.

### Criterio de cierre

Los tres criterios ausentes documentados en la KB de cardiología con su valor y
su fuente, y `barrer_candidatos_umbral.ts` reportándolos como PRESENTE.

### Notas

- No se corrige desde acá: es contenido clínico y requiere criterio veterinario.
- El agente **no está roto**: hace lo que su prompt dice. Falta el documento.
- Cuando se llene, cardiología queda marcado para volver a medir en N2 — la
  huella de la KB que guarda cada corrida detecta el cambio automáticamente.
