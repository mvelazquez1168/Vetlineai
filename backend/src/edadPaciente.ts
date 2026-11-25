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

// vetline-clinic-01, punto 3.1 — la operación inversa, y vive acá por lo
// mismo que la de arriba: si el cálculo de ida y el de vuelta estuvieran
// en archivos distintos, nada garantizaría que sean consistentes entre
// sí (guardar "4 años" y que la ficha después muestre 3.9).
//
// Existe porque la edad ya no se guarda como número: cuando el tutor solo
// sabe la edad aproximada, se deriva una fecha de nacimiento y se marca
// `pacientes.fecha_nacimiento_estimada = true`. Así hay UNA sola
// representación de la edad en la base, y la bandera dice si es exacta.
//
// Se usa 365.25 (el mismo divisor que `calcularEdadEfectiva`) para que el
// viaje de ida y vuelta devuelva el mismo número: guardar 4 años y leer
// la edad efectiva da 4, no 3.9.
export function fechaNacimientoDesdeEdad(edadAnios: number): string {
  const dias = edadAnios * 365.25;
  const fecha = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  // YYYY-MM-DD en UTC: la columna es DATE (sin hora ni zona), así que
  // el día exacto no depende de la zona de nadie. Un día de corrimiento
  // sobre una edad declarada "aproximada" no significa nada, y usar la
  // zona de la clínica acá daría la falsa impresión de que sí.
  return fecha.toISOString().slice(0, 10);
}
