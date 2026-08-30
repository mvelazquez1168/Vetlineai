import { HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { pool } from "../db";

// Paso 1 del relevamiento «una síntesis, dos vistas»: qué produce cada
// camino, campo por campo, y si lo que hay hoy sirve como fuente
// persistente. Solo lee.

interface Campo { ruta: string; nombre: string; tipo: string; requerido: boolean; desc: string }

function recorrer(nodo: any, ruta: string, out: Campo[], requeridos: string[] = []) {
  if (!nodo || typeof nodo !== "object") return;
  if (nodo.properties) {
    const req: string[] = nodo.required ?? [];
    for (const [k, v] of Object.entries<any>(nodo.properties)) {
      const r = ruta ? `${ruta}.${k}` : k;
      out.push({
        ruta: r, nombre: k,
        tipo: Array.isArray(v.type) ? v.type.join("|") : String(v.type ?? "?"),
        requerido: req.includes(k),
        desc: String(v.description ?? "").replace(/\s+/g, " ").slice(0, 120),
      });
      recorrer(v, r, out, requeridos);
    }
  }
  if (nodo.items) recorrer(nodo.items, `${ruta}[]`, out, requeridos);
}

async function main() {
  const dash = (HERRAMIENTAS_AGENTE as any[]).find((t) => t.name === "generar_dashboard");
  const inf = (HERRAMIENTAS_AGENTE as any[]).find((t) => t.name === "generar_informe");
  const cd: Campo[] = [], ci: Campo[] = [];
  recorrer(dash.input_schema, "", cd);
  recorrer(inf.input_schema, "", ci);

  const raiz = (c: Campo[]) => c.filter((x) => !x.ruta.includes(".") && !x.ruta.includes("["));
  const rd = raiz(cd), ri = raiz(ci);

  console.log(`ESQUEMAS · dashboard ${cd.length} campos (${rd.length} de raíz) · informe ${ci.length} campos (${ri.length} de raíz)\n`);

  // Correspondencia por nombre y por sinónimos conocidos.
  const SINONIMOS: Record<string, string> = {
    differential_diagnosis: "diagnostico_diferencial",
    clinical_state: "estado_clinico_actual",
    clinical_confidence: "matriz_evidencia",
    clinical_reasoning_journal: "razonamiento_diagnostico",
    timeline: "evolucion_clinica",
  };
  const equivalente = (n: string) => SINONIMOS[n] ?? n;

  const nombresI = new Set(ri.map((x) => x.nombre));
  const nombresD = new Set(rd.map((x) => x.nombre));

  console.log("=== 1. LO QUE EL INFORME TIENE Y EL DASHBOARD NO ===");
  console.log("   (define si la síntesis alcanza o hay que ampliarla)\n");
  const soloInforme = ri.filter((x) => !nombresD.has(x.nombre) && ![...nombresD].some((d) => equivalente(d) === x.nombre));
  for (const c of soloInforme)
    console.log(`   ${c.requerido ? "*" : " "} ${c.nombre.padEnd(34)}${c.tipo.padEnd(16)}${c.desc.slice(0, 78)}`);
  console.log(`   → ${soloInforme.length} campos (los marcados con * son obligatorios)\n`);

  console.log("=== 2. LO QUE EL DASHBOARD TIENE Y EL INFORME NO USA ===\n");
  const soloDash = rd.filter((x) => !nombresI.has(x.nombre) && !nombresI.has(equivalente(x.nombre)));
  for (const c of soloDash)
    console.log(`   ${c.requerido ? "*" : " "} ${c.nombre.padEnd(34)}${c.tipo.padEnd(16)}${c.desc.slice(0, 78)}`);
  console.log(`   → ${soloDash.length} campos\n`);

  console.log("=== EN AMBOS (con o sin cambio de nombre) ===\n");
  for (const c of rd) {
    const eq = equivalente(c.nombre);
    if (nombresI.has(c.nombre)) console.log(`   ${c.nombre.padEnd(34)}= mismo nombre`);
    else if (nombresI.has(eq)) console.log(`   ${c.nombre.padEnd(34)}→ informe lo llama «${eq}»`);
  }

  // ---------------------------------------------------------------- 3
  console.log("\n\n=== 3. CÓMO SE GUARDA HOY EL DASHBOARD ===\n");
  const tablas = (
    await pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND (table_name ILIKE '%dashboard%' OR table_name ILIKE '%informe%' OR table_name ILIKE '%sintesis%')
        ORDER BY table_name`
    )
  ).rows;
  console.log(`   tablas relacionadas: ${tablas.length ? tablas.map((t) => t.table_name).join(", ") : "NINGUNA"}`);

  for (const t of tablas) {
    const cols = (
      await pool.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
        [t.table_name]
      )
    ).rows;
    const n = (await pool.query(`SELECT count(*)::int n FROM ${t.table_name}`)).rows[0].n;
    console.log(`\n   ${t.table_name}  (${n} filas)`);
    for (const c of cols) console.log(`      ${c.column_name.padEnd(28)}${c.data_type}`);
  }

  // ---------------------------------------------------------------- 4
  console.log("\n\n=== 4. ¿HAY CÓMO SABER QUE QUEDÓ VIEJA? ===\n");
  const marcas = (
    await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema='public'
          AND (column_name ILIKE '%actualizado%' OR column_name ILIKE '%generado%' OR column_name ILIKE '%vigente%'
               OR column_name ILIKE '%version%' OR column_name ILIKE '%hash%')
          AND table_name IN ('casos','mensajes','archivos','recetas')
        ORDER BY table_name, column_name`
    )
  ).rows;
  console.log(`   columnas de versión/actualización en las tablas del caso: ${marcas.length}`);
  for (const m of marcas) console.log(`      ${m.table_name}.${m.column_name}`);

  let ultimo: any[] = [];
  try {
    ultimo = (
      await pool.query(
        `SELECT c.id, c.actualizado_en AS caso, max(m.creado_en) AS ultimo_mensaje
           FROM casos c LEFT JOIN mensajes m ON m.caso_id=c.id
          GROUP BY c.id, c.actualizado_en ORDER BY max(m.creado_en) DESC NULLS LAST LIMIT 3`
      )
    ).rows;
  } catch (e: any) {
    console.log(`   (no se pudo consultar: ${e.message})`);
  }
  console.log(`\n   (muestra de 3 casos con su última actividad, para ver si hay con qué comparar)`);
  for (const u of ultimo as any[]) console.log(`      caso ${String(u.id).slice(0, 8)}  caso.actualizado_en=${u.caso}  último mensaje=${u.ultimo_mensaje}`);

  await pool.end();
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
