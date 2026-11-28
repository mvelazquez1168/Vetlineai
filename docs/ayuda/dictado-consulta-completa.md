# Dictar la consulta completa

## Para qué sirve

Hablar de corrido —motivo, signos, examen, diagnóstico, tratamiento, control, estudios— y encontrar
cada cosa en su campo, sin escribir nada.

Es distinto de [dictar en un campo](dictado-en-un-campo.md): ahí el texto cae donde está el cursor.
Acá la IA **reparte** el dictado en los campos de la atención y deja un **borrador** que usted
revisa y acepta.

## Cuándo se usa

Al terminar de examinar al paciente, mientras lo recuerda todo. También sirve dictar por partes: se
puede dictar dos veces en la misma consulta.

## Quién puede usarla

Solo un **médico**, y solo si el administrador de la clínica activó el servicio en
**Administración › Clínica › Notificaciones y servicios de IA**. Si no está activado, el recuadro no aparece.

**Consume crédito de IA** de la clínica. Por eso nace apagado.

## Paso a paso

1. En la pestaña **Atención actual**, arriba, está el recuadro **Dictar la consulta**.
2. Clic en **Dictar la consulta**. El navegador pide permiso para el micrófono la primera vez.
3. Hable de corrido. Arriba se ve el cronómetro y, si el navegador reconoce voz, el texto en vivo.
4. Clic en **Detener**. El sistema transcribe y ordena: tarda unos segundos.
5. Aparece el **borrador**, con fondo celeste y la etiqueta **«Propuesto por dictado»**. Cada grupo
   —Motivo, Anamnesis, Signos, Examen por sistemas, Evaluación, Plan, Indicaciones, Control, Receta,
   Estudios— tiene su **casilla**.
6. **Lea cada grupo.** Los que están completos vienen marcados si usa **Marcar lo que está
   completo**; los que tienen algo que revisar vienen **sin marcar** a propósito.
7. Destilde lo que no quiera, o corríjalo después a mano en su campo.
8. Clic en **Aceptar lo marcado**.

Lo aceptado queda en los campos de la atención, como si lo hubiera escrito. Lo que no marcó **no se
registra**.

## Un ejemplo

Se dicta:

> Perro macho de 5 años, viene por cojera del miembro posterior derecho de 3 días. Temperatura 38,9,
> frecuencia cardiaca 110, frecuencia respiratoria 28, peso 18 kilos. El resto del examen normal
> salvo dolor a la palpación de la rodilla derecha. Sospecho ruptura de ligamento cruzado.
> Carprofeno 4 miligramos por kilo cada 24 horas por 7 días, control en 10 días, radiografía de
> rodilla.

El borrador propone:

| Grupo | Lo que propone |
|---|---|
| Motivo de consulta | Cojera del miembro posterior derecho de 3 días de evolución |
| Signos | 38,9 °C · 110 lpm · 28 rpm · 18 kg |
| Examen por sistemas | **Locomotor: anormal** — dolor a la palpación de la rodilla derecha |
| Marcar el resto como normales | Dijo «el resto normal»: se propone marcar Normal los que no nombró |
| Evaluación | Ruptura de ligamento cruzado (presuntivo) |
| Control | En 10 días |
| Receta | Carprofeno · 4 mg/kg · cada 24 h · 7 días — **4 mg/kg × 18 kg = 72 mg** |
| Estudios | Radiografía de rodilla derecha |

## Qué pasa después

- Lo aceptado queda **en la atención, en borrador**. Nada está firmado.
- **Nada se cobra.** Los cargos los genera el cierre de la atención, como siempre.
- **Nada se agenda.** El control queda propuesto como fecha; la cita la crea el cierre.
- **La receta no se dispensa.** Entregar un medicamento descuenta inventario y cobra, y eso lo
  decide usted en la receta, con el lote a la vista.
- **El texto de lo que dictó queda guardado** junto a la atención, aunque acepte o descarte el
  borrador. Está en **«Ver lo que dicté»**.

## «Revisar»: lo que la IA no entendió

Si una dosis, un nombre o un valor quedó ambiguo, **el campo queda vacío y marcado «Revisar»**. No
se completa con lo que sería razonable.

Por ejemplo, si dice «le doy doxiciclina a… la dosis la calculo cuando lo pese», la línea de la
receta aparece **sin dosis** y con la etiqueta `Revisar: dosis`. Una dosis adivinada que parece
correcta es peor que un campo vacío: el campo vacío se ve.

Los grupos con algo que revisar **no se marcan solos**. Para aceptarlos hay que decidirlo.

## Lo que conviene saber para que salga bien

- **Diga los valores con su nombre**: «temperatura 38,9», «frecuencia cardiaca 110», «peso 18
  kilos». Un número solo no sabe a qué campo va.
- **Diga la dosis completa**: «4 miligramos por kilo cada 24 horas por 7 días». Si falta la
  frecuencia, queda vacía: no se supone.
- **«El resto normal» sirve** y es lo que ahorra más tiempo. Queda como propuesta aparte, para que
  usted la confirme.
- **«Sospecho» deja el diagnóstico como presuntivo.** Si lo afirma, queda definitivo.
- **Corregirse en el medio funciona.** «Orina mucho… perdón, orina poco y con esfuerzo» queda como
  la corrección, no como lo primero.
- **El peso dictado manda sobre el del expediente.** Si dicta un peso nuevo, la dosis se calcula con
  ése, y la línea dice «con el peso dictado (18 kg), que se registra al aceptar Signos».

## Privacidad: qué se procesa, dónde y por cuánto tiempo

- **El audio sale de la computadora** hacia el servicio de transcripción, se convierte en texto y
  **no se guarda**.
- Si la clínica configura una **retención** (Administración › Clínica › Notificaciones y servicios de IA, campo
  «Guardar el audio»), el audio se guarda esas horas y se borra solo al vencer. **Por omisión son 0
  horas: no se guarda.**
- **El texto sí queda** en el expediente del paciente, con el mismo aislamiento por clínica que el
  resto del expediente: nadie de otra clínica puede leerlo.
- El ordenamiento lo hace un modelo de lenguaje, que recibe el texto del dictado, los datos del
  paciente de esa consulta y los catálogos de la clínica. **No recibe el expediente completo ni
  datos de otros pacientes.**

## En qué navegadores funciona

**En todos, incluido el iPhone.** La transcripción la hace el servidor a partir del audio, así que
no depende de que el navegador sepa reconocer voz.

## Preguntas frecuentes y errores comunes

**Dice «El dictado de la consulta con IA no está activado para esta clínica».**
Lo activa el administrador en Administración › Clínica › Notificaciones y servicios de IA.

**Dice que la clínica no tiene saldo de IA.**
El dictado consume crédito como el chat o el informe. Avísele al administrador para recargar.

**Se transcribió pero no se ordenó.**
Pasa si el modelo no contesta. El texto queda guardado igual —está en «Ver lo que dicté»— y se puede
copiar a los campos a mano. No se perdió nada de lo dictado.

**El borrador repartió algo en el campo equivocado.**
Destilde ese grupo, acepte el resto y escriba eso a mano. Si pasa seguido, dígalo: el reparto se
corrige.

**Acepté sin querer un grupo.**
Los campos de la atención se editan normalmente mientras está en borrador: entre al campo y
corríjalo. Lo que no se puede deshacer es el cierre, que es otro acto.

**Dicté dos veces.**
El segundo dictado reemplaza el borrador en pantalla; los campos que ya aceptó del primero quedan
como están y aparecen con la etiqueta **«Ya registrado»**.

**¿Puedo dictar con la atención ya cerrada?**
No. Lo que falte después de firmar va en una [adenda](glosario.md#adenda).
