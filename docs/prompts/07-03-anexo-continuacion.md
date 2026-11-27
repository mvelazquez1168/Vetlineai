# 07-03 Anexo — continuación de la parte A y parte B

Contexto: el 07d (dictado por voz) está completo en `vetline-clinic/07d-dictado-por-voz` (10038e5, 3a7b1c4). A1 y A2 del anexo están entregados en `vetline-clinic/07-03-anexo` (63d91d1). Seguimos en la rama del anexo.

## Antes de empezar

- La rama `vetline-clinic/07-03-anexo` tiene integrado el 07d: si partió de otra base, que quede rebasada o mergeada sobre 07d sin perder nada, y que el verificador del 07d siga en 92/92 dentro de esta rama.

## Parte A — terminar

**A3 — posología sugerida (07c).** La posología sugerida que construyó el 07c usa siempre el peso más reciente del paciente (el dictado o registrado en la atención en curso gana sobre el del expediente) y muestra de dónde salió el peso y su fecha, con la misma regla que se corrigió en el borrador del 07d. Si existe una sola función de "peso vigente" para dosis, ambos módulos la usan; si hay dos lógicas, que quede una. Aserción de regresión: perro de 18 kg recién pesado con 32,4 kg en el expediente → la dosis se calcula con 18 kg en la posología del 07c y en el borrador del 07d.

**A4 — autoguardado.** La atención se guarda sola en el servidor con un indicador visible (guardando / guardado hace X / sin conexión). Una segunda sesión sobre la misma atención queda bloqueada en modo lectura con el aviso de quién la tiene abierta. Si se corta la red, lo escrito se conserva en el navegador y se sube al volver, sin pisar cambios más nuevos del servidor; si hay conflicto, el médico elige.

**A5 — paciente.** Los campos opcionales del paciente están disponibles sin estorbar el alta rápida, y la baja del paciente pide motivo (fallecimiento, traslado, otro). La baja por fallecimiento detiene todos los envíos automáticos a ese paciente (recordatorios, vacunas, campañas) en el mecanismo de notificaciones existente de Vetline Ai.

**Además en la parte A:**
- PDF del examen, con el orden de lectura de A1 y la marca de la clínica.
- Verificador del anexo con aserciones para A1–A5.
- Verificación en navegador de A1–A5 con el usuario demo, mirando la pantalla y no solo el código, como en el 07d.

## Parte B (03)

- **B1** — unificar clientes y pacientes duplicados: detección de candidatos, vista lado a lado, fusión que conserva todo el historial (atenciones, facturas, casos de Vetline Ai) y queda registrada en bitácora.
- **B2** — autocompletar datos del cliente por número de identificación, con proveedor simulado por omisión e intercambiable por uno real, igual que el proveedor de transcripción.
- **B3** — fuente de referencia del cliente (cómo llegó a la clínica), lista configurable por clínica y disponible para el CRM.
- **B4** — canal preferido de contacto del cliente, respetado por el mecanismo de notificaciones existente.

Verificador y verificación en navegador también para la parte B.

## Cierre

Commits y push en la rama del anexo, manual de usuario actualizado en `docs/ayuda/` para lo que cambie de cara al médico o a recepción, e informe con lo hecho, defectos encontrados y residuos. Para solo si hay contradicción con lo construido, una decisión irreversible (en especial en la fusión de B1) o trabajo mucho mayor al supuesto.
