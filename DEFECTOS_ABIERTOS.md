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
