import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// EL EXAMEN QUE SE LEE, Y LAS TENDENCIAS — anexo del 07, parte A1.
//
// El 07 ya deja marcar cada sistema Normal / Anormal / No evaluado, y el
// 07c le puso el color. Lo que faltaba es lo que el anexo pide para
// DESPUÉS: que el examen se pueda leer de un vistazo, y que los signos
// que se miden en cada visita se vean como una serie y no como catorce
// números sueltos en catorce visitas.
//
// EL ORDEN DEL RESUMEN NO ES DECORATIVO. Primero lo anormal —que es lo
// que hay que leer—, después «resto sin alteraciones» en una línea, y
// los no evaluados aparte. Un examen de trece sistemas listado en orden
// alfabético obliga a leer trece líneas para encontrar la única que
// importa.
//
// Vive acá y no en la pantalla porque lo usan tres: la vista de la
// visita, el PDF y el resumen del cierre. Si cada uno lo ordenara,
// algún día dirían cosas distintas.
// ---------------------------------------------------------------------

export interface ResumenDelExamen {
  anormales: Array<{ sistema: string; hallazgo: string | null }>;
  normales: string[];
  noEvaluados: string[];
  /** «Locomotor: dolor a la palpación… · Resto sin alteraciones». */
  textoCorrido: string;
  /** Un examen sin un solo sistema tocado no se resume: se dice que falta. */
  sinExaminar: boolean;
}

export async function resumenDelExamen(
  db: PoolClient,
  atencionId: string
): Promise<ResumenDelExamen> {
  const r = await db.query<{ sistema: string; estado: string; nota: string | null }>(
    `SELECT sistema, estado, nota FROM exp_examen_sistemas
      WHERE atencion_id = $1
      ORDER BY orden NULLS LAST, sistema`,
    [atencionId]
  );

  const anormales = r.rows
    .filter((s) => s.estado === "anormal")
    .map((s) => ({ sistema: s.sistema, hallazgo: s.nota }));
  const normales = r.rows.filter((s) => s.estado === "normal").map((s) => s.sistema);
  const noEvaluados = r.rows.filter((s) => s.estado === "no_evaluado").map((s) => s.sistema);

  const partes: string[] = [];
  for (const a of anormales) {
    partes.push(a.hallazgo ? `${a.sistema}: ${a.hallazgo}` : `${a.sistema}: anormal, sin detallar`);
  }
  if (normales.length > 0) {
    // «Resto sin alteraciones» SOLO si hubo algo anormal. Si está todo
    // normal, decir «resto» sería raro: el resto de nada.
    partes.push(
      anormales.length > 0
        ? `Resto sin alteraciones (${normales.length})`
        : `Sin alteraciones en ${normales.length === 1 ? "el sistema examinado" : `los ${normales.length} sistemas examinados`}`
    );
  }
  if (noEvaluados.length > 0) {
    partes.push(`Sin evaluar: ${noEvaluados.join(", ")}`);
  }

  return {
    anormales,
    normales,
    noEvaluados,
    textoCorrido: partes.join(". "),
    sinExaminar: anormales.length === 0 && normales.length === 0,
  };
}

// ---------------------------------------------------------------------
// LAS TENDENCIAS DE LOS SIGNOS
//
// Peso, temperatura y condición corporal a lo largo de las visitas. El
// anexo pide «el mismo componente de gráficos y el mismo patrón que los
// laboratorios», así que esto devuelve la misma forma que
// `tendenciaDeAnalito`: una serie de puntos con fecha y valor.
//
// SOLO DE ATENCIONES CERRADAS. Una atención en borrador tiene el peso a
// medio escribir —el médico tipea «3» antes de «32»— y un punto de 3 kg
// en la serie de un perro de 32 es ruido que parece un dato.
// ---------------------------------------------------------------------

export type SignoConTendencia = "peso" | "temperatura" | "condicion_corporal";

export interface PuntoDeTendencia {
  fecha: string;
  valor: number;
}

export interface TendenciaDeSignos {
  signo: SignoConTendencia;
  etiqueta: string;
  unidad: string;
  puntos: PuntoDeTendencia[];
}

const SIGNOS: Record<SignoConTendencia, { etiqueta: string; unidad: string }> = {
  peso: { etiqueta: "Peso", unidad: "kg" },
  temperatura: { etiqueta: "Temperatura", unidad: "°C" },
  condicion_corporal: { etiqueta: "Condición corporal", unidad: "/9" },
};

export async function tendenciaDeSignos(
  db: PoolClient,
  pacienteId: string,
  limite = 24
): Promise<TendenciaDeSignos[]> {
  const r = await db.query<{
    fecha: string;
    peso: string | null;
    temperatura: string | null;
    condicion_corporal: number | null;
  }>(
    `SELECT COALESCE(a.cerrada_en, a.creado_en)::date::text AS fecha,
            a.peso, a.temperatura, a.condicion_corporal
       FROM atenciones a
      WHERE a.paciente_id = $1 AND a.estado = 'cerrada'
        AND (a.peso IS NOT NULL OR a.temperatura IS NOT NULL OR a.condicion_corporal IS NOT NULL)
      ORDER BY COALESCE(a.cerrada_en, a.creado_en)
      LIMIT $2`,
    [pacienteId, limite]
  );

  const salida: TendenciaDeSignos[] = [];
  for (const signo of Object.keys(SIGNOS) as SignoConTendencia[]) {
    const puntos = r.rows
      .map((f) => ({ fecha: f.fecha, valor: f[signo] === null ? null : Number(f[signo]) }))
      .filter((p): p is PuntoDeTendencia => p.valor !== null && Number.isFinite(p.valor));
    // UN SOLO PUNTO NO ES UNA TENDENCIA. Dibujar un gráfico con un dato
    // sugiere una evolución que nadie midió. Se devuelve igual —la
    // pantalla decide si lo muestra como número suelto— pero el que
    // consume sabe cuántos hay.
    if (puntos.length === 0) continue;
    salida.push({ signo, etiqueta: SIGNOS[signo].etiqueta, unidad: SIGNOS[signo].unidad, puntos });
  }
  return salida;
}
