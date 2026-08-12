// prompt_code_cierre_caso.md, Paso 4 — "Una consulta que liste los casos
// abiertos filtrados por tiempo sin actividad, con el parámetro a
// elección: cantidad de meses, o una fecha de corte." Un solo helper para
// resolver esa fecha de corte, reusado por el endpoint del médico
// (casos.routes.ts) y el del admin de clínica (admin.routes.ts) — la
// query en sí queda en cada router porque el WHERE de pertenencia
// (medico_id vs. tenant_id) es distinto.

export type ResolucionFechaCorte = { valido: true; fechaCorte: Date } | { valido: false; error: string };

export function resolverFechaCorte(query: Record<string, unknown>): ResolucionFechaCorte {
  const { meses, fechaCorte } = query;

  if (typeof fechaCorte === "string" && fechaCorte) {
    const fecha = new Date(fechaCorte);
    if (Number.isNaN(fecha.getTime())) {
      return { valido: false, error: "fechaCorte inválida." };
    }
    return { valido: true, fechaCorte: fecha };
  }

  if (typeof meses === "string" && meses) {
    const n = Number(meses);
    if (!Number.isFinite(n) || n <= 0) {
      return { valido: false, error: "meses debe ser un número mayor a cero." };
    }
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() - n);
    return { valido: true, fechaCorte: fecha };
  }

  return { valido: false, error: "Falta el parámetro meses o fechaCorte." };
}
