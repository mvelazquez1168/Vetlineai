# Vetline Clinic — 07d · Dictado por voz en la atención

Rama: una nueva, que parte de la del 07c. Se rige por `vetline-clinic-00-guia-rectora.md`, sección 12, incluida la regla del manual de usuario.

## Por qué existe

Durante la consulta, el médico tiene las manos ocupadas con el paciente, y escribir la nota después le quita tiempo o le hace olvidar detalles. Dictar las observaciones, el examen, la evaluación, el plan y la receta, y encontrarlos ordenados en la atención, ahorra tiempo en cada consulta y mejora la calidad del registro.

**Vetline Ai ya tiene dictado por voz** en el workspace de casos (`CasoWorkspace.tsx`, con la Web Speech API del navegador). **Se reutiliza y se extiende, no se crea otro.**

## 0. Relevamiento

El informe parte de cómo funciona hoy el dictado de Vetline Ai:
- qué API usa y en qué navegadores funciona;
- cómo acumula el texto y cómo maneja el micrófono;
- qué pasa en iPhone y en Android dentro de la PWA.

## 1. Fase 1 · Dictado en cualquier campo (sin costo de IA)

- El dictado de Vetline Ai se convierte en **un componente reutilizable** (`DictadoVoz`), y el workspace de casos pasa a usarlo, sin cambiar su comportamiento.
- **Todo campo de texto largo de la atención** tiene su botón de micrófono: motivo y anamnesis, hallazgos de cada sistema anormal, evaluación, tratamiento, indicaciones al cliente, notas de la receta y hallazgos de grooming.
- **Uso:** se toca el micrófono, se dicta, y el texto aparece en el campo mientras se habla. Se puede editar en cualquier momento. Al tocar de nuevo, se detiene.
  - El texto dictado **se agrega** a lo que ya había. Nunca reemplaza.
  - Se apoya en el autoguardado del anexo del 07.
- **Puntuación por voz en español:** "punto", "coma", "punto y aparte", "nueva línea".
- **Un atajo de teclado** para iniciar o detener el dictado en el campo con foco.
- **Si el navegador no soporta dictado**, el botón no aparece y un ícono informativo explica en qué navegadores funciona. Nunca queda un botón que no hace nada.
- El indicador de micrófono abierto es siempre visible. Al salir de la pantalla o cambiar de pestaña, el micrófono se cierra.

## 2. Fase 2 · Dictado de la consulta completa, ordenado por IA

El médico dicta todo de corrido, como le sale, por ejemplo: "Perro macho de 5 años, viene por cojera del miembro posterior derecho de 3 días… temperatura 38,9, frecuencia cardiaca 110… el resto del examen normal salvo dolor a la palpación de la rodilla derecha… sospecho ruptura de ligamento cruzado… carprofeno 4 mg por kilo cada 24 horas por 7 días, control en 10 días, radiografía de rodilla".

El sistema lo **ordena como borrador** en la atención:

- **Subjetivo:** motivo y anamnesis.
- **Signos:** temperatura, frecuencia cardiaca, frecuencia respiratoria, peso y los demás que se nombren, cada uno en su campo.
- **Examen por sistemas:** los sistemas mencionados como anormales, con su hallazgo. Si el médico dijo "el resto normal", el borrador **propone** marcar los demás como Normal, como sugerencia visible que el médico confirma.
- **Evaluación:** los diagnósticos presuntivos.
- **Plan:** el tratamiento, las indicaciones y el control, que se propone agendar.
- **Receta:** cada medicamento se busca en el catálogo (o queda en texto libre si no está), con su dosis, vía, frecuencia y duración. Pasa por el **cálculo de dosis por peso y el aviso de alergia** del 07c.
- **Estudios:** los exámenes mencionados quedan propuestos como orden.

**Reglas:**
- **Todo lo que viene de la IA es un borrador marcado** como "propuesto por dictado", con un resaltado visible. El médico revisa, corrige y acepta campo por campo, o todo de una vez. **Nada se firma, se cobra ni se agenda sin su confirmación.** La firma sigue siendo un acto explícito, como define el 07.
- **El texto original del dictado se conserva** junto a la atención, como respaldo de lo que dijo el médico.
- **Lo que la IA no entendió no se inventa.** Si una dosis, un nombre de medicamento o un valor es ambiguo, el campo queda vacío y marcado "revisar".
- **Transcripción del lado del servidor:** para esta fase, el audio se transcribe en el servidor, con un servicio de transcripción de buena precisión en español y vocabulario médico veterinario. El vocabulario incluye nombres de medicamentos del catálogo de la clínica y razas.
  - Funciona en cualquier navegador, incluido el iPhone.
  - El proveedor se elige y se justifica en el informe: precisión en español de Costa Rica, costo por minuto y dónde se procesan los datos. Va detrás de una interfaz intercambiable, con un proveedor simulado en desarrollo.
  - El ordenamiento lo hace un modelo de lenguaje.
  - **Todo pasa por la compuerta de crédito existente**, con el costo por minuto medido.
- **Privacidad:**
  - El audio no se guarda después de transcribirlo, salvo que la clínica lo configure, con un tiempo de retención.
  - El texto queda en el expediente con su RLS.
  - El manual explica qué se procesa, dónde y por cuánto tiempo.
- **Disponibilidad:** solo para el rol médico, y la clínica la activa en su configuración (Administración › Notificaciones y servicios de IA, o donde el 04 ubique los servicios de IA).

## 3. No incluido (documentar para después)

- **Escriba ambiental:** grabar la conversación completa entre el médico y el dueño durante la consulta para generar la nota sola. Requiere el consentimiento explícito del dueño y un análisis legal aparte. **No se construye.** Se documenta qué implicaría.
- **Comandos de voz** para navegar o ejecutar acciones ("cerrar atención"). No se construyen.

## Manual de usuario

Las páginas de `docs/ayuda/` explican cómo dictar en un campo; los comandos de puntuación; en qué navegadores funciona la fase 1; cómo dictar la consulta completa; cómo revisar y aceptar el borrador; qué significa "revisar"; ejemplos de dictado bien estructurado; y la privacidad del audio.

## Verificación y entrega

Según la sección 12 de la guía, se recorre en el navegador con `demo.medico`:

- **Fase 1:** dictar en tres campos distintos de una atención de Toby, en Chrome o Edge, y comprobar que en un navegador sin soporte el botón no aparece.
- **Fase 2** (con el proveedor simulado y con el real, si hay credenciales de desarrollo):
  - dictar el ejemplo de la sección 2 y comprobar cada campo del borrador, la receta con la dosis calculada para el peso y el aviso de alergia si corresponde;
  - corregir un campo, aceptar el resto y firmar;
  - dictar una dosis ambigua y comprobar que queda marcada "revisar".

**Medir:** la precisión sobre 10 dictados de prueba con terminología veterinaria y el costo por consulta.

El informe incluye el componente reutilizado, el proveedor elegido con su justificación, las mediciones y lo documentado sin construir.

Este trabajo se detiene solo ante:
- una contradicción con la guía o con lo construido;
- una decisión irreversible;
- un trabajo mucho mayor al supuesto.
