// prompt_code_paciente_nacimiento_estado.md, Parte B1 — edad y fecha de
// nacimiento no conviven como datos independientes: cuando hay fecha de
// nacimiento, la edad SIEMPRE se deriva de ella (nunca se lee edad_anios
// aparte); cuando no la hay, se sigue usando edad_anios tal cual. Un único
// punto de cálculo para que el agente, la ficha del paciente, la receta y
// el informe nunca muestren números distintos entre sí.
export function calcularEdadEfectiva(
  fechaNacimiento: Date | string | null,
  edadAnios: number | string | null
): number | null {
  if (fechaNacimiento) {
    const fecha = fechaNacimiento instanceof Date ? fechaNacimiento : new Date(fechaNacimiento);
    const diasVividos = (Date.now() - fecha.getTime()) / (1000 * 60 * 60 * 24);
    return Math.round((diasVividos / 365.25) * 10) / 10;
  }
  return edadAnios === null || edadAnios === undefined ? null : Number(edadAnios);
}
