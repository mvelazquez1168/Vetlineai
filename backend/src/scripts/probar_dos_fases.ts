import { pool } from "../db";
import { obtenerSintesisParaDashboard, obtenerSintesisParaInforme } from "../generarSintesis";
import { PARTICION_SINTESIS, proyectarDashboard, proyectarInforme } from "../sintesisClinica";

// Prueba de las dos fases sobre un caso real.
//
// Lo que hay que demostrar no es que funcione: es que el dashboard deje de
// esperar por el informe, y que las dos vistas sigan sin poder
// contradecirse pese a venir de dos llamadas.

const seg = (t: number) => `${Math.round((Date.now() - t) / 1000)} s`;

// Comparacion canonica. JSONB no conserva el orden de las claves —las
// reordena por longitud y alfabeticamente al guardar—, asi que comparar
// con JSON.stringify da distinto para el mismo contenido. La primera
// version de esta prueba reporto que el complemento pisaba seis campos del
// nucleo cuando lo unico que habia cambiado era el orden.
function canonico(x: any): any {
  if (Array.isArray(x)) return x.map(canonico);
  if (x && typeof x === "object")
    return Object.fromEntries(Object.keys(x).sort().map((k) => [k, canonico(x[k])]));
  return x;
}
const igual = (a: any, b: any) => JSON.stringify(canonico(a)) === JSON.stringify(canonico(b));

async function main() {
  const client = await pool.connect();
  try {
    const caso = (
      await client.query(
        `SELECT c.id, count(m.id)::int n FROM casos c JOIN agentes a ON a.id = c.agente_id
           LEFT JOIN mensajes m ON m.caso_id = c.id
          WHERE a.system_prompt IS NOT NULL AND c.estado <> 'completado'
          GROUP BY c.id ORDER BY count(m.id) DESC LIMIT 1`
      )
    ).rows[0];
    const tenant = (await client.query(`SELECT tenant_id FROM casos WHERE id = $1`, [caso.id])).rows[0].tenant_id;
    await client.query(
      `UPDATE casos SET sintesis=NULL, sintesis_huella=NULL, sintesis_generada_en=NULL, sintesis_estado=NULL WHERE id=$1`,
      [caso.id]
    );
    console.log(`Caso ${String(caso.id).slice(0, 8)} · ${caso.n} mensajes · síntesis borrada\n`);

    // --- FASE 1: lo que espera el médico que abre el dashboard ---
    let t = Date.now();
    const n = await obtenerSintesisParaDashboard(tenant, caso.id);
    const tNucleo = Date.now() - t;
    console.log(`FASE 1 · núcleo      ${seg(t)}   estado=${n.estado}   salida ${n.usage?.output_tokens} tokens`);
    const faltanN = PARTICION_SINTESIS.nucleo.filter((k) => n.sintesis[k] === undefined);
    console.log(`   ${PARTICION_SINTESIS.nucleo.length} campos del núcleo · ausentes: ${faltanN.length}`);

    // El dashboard ya se puede mostrar.
    const dash = proyectarDashboard(n.sintesis, caso.id);
    const dashConDatos = Object.entries(dash).filter(([k, v]) => k !== "meta" && v !== null).length;
    console.log(`   dashboard proyectado: ${dashConDatos} campos con datos → ya se puede mostrar\n`);

    // Segunda apertura del dashboard: no debe costar nada.
    t = Date.now();
    const n2 = await obtenerSintesisParaDashboard(tenant, caso.id);
    console.log(`   segunda apertura del dashboard: generó=${n2.seGenero} en ${Date.now() - t} ms\n`);

    // --- FASE 2: solo cuando alguien pide el informe ---
    t = Date.now();
    const c = await obtenerSintesisParaInforme(tenant, caso.id);
    const tComplemento = Date.now() - t;
    console.log(`FASE 2 · complemento ${seg(t)}   estado=${c.estado}   salida ${c.usage?.output_tokens} tokens`);
    const faltanC = PARTICION_SINTESIS.complemento.filter((k) => c.sintesis[k] === undefined);
    console.log(`   ${PARTICION_SINTESIS.complemento.length} campos del complemento · ausentes: ${faltanC.length}`);

    // --- LO QUE IMPORTA: el complemento no pisó el núcleo ---
    const pisados = PARTICION_SINTESIS.nucleo.filter(
      (k) => !igual(n.sintesis[k], c.sintesis[k])
    );
    console.log(`\nEL COMPLEMENTO NO TOCÓ EL NÚCLEO: ${pisados.length === 0 ? "correcto" : "PISÓ " + pisados.join(", ")}`);

    // --- Coherencia entre las dos vistas ---
    const inf = proyectarInforme(c.sintesis, caso.id);
    const d2 = proyectarDashboard(c.sintesis, caso.id);
    const mismos =
      igual(d2.clinical_state, inf.estado_clinico_actual) &&
      igual(d2.differential_diagnosis, inf.diagnostico_diferencial);
    console.log(`LAS DOS VISTAS DICEN LO MISMO: ${mismos ? "sí" : "NO ←"}`);

    // --- El reparto de la espera ---
    console.log(`\nREPARTO DE LA ESPERA`);
    console.log(`   quien abre el dashboard espera   ${Math.round(tNucleo / 1000)} s`);
    console.log(`   quien pide el informe espera     ${Math.round(tComplemento / 1000)} s más`);
    console.log(`   antes, cualquiera de los dos     ~220 s`);

    const ok = !faltanN.length && !faltanC.length && !pisados.length && mismos && !n2.seGenero;
    console.log(`\n${ok ? "[OK] el dashboard dejó de esperar por el informe, y siguen sin poder contradecirse." : "[FALLO] revisar"}`);
    process.exit(ok ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
