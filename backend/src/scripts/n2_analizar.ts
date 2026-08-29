import fs from "fs";
import path from "path";
import { PREDICCIONES } from "./n2_predicciones";
import { BANCO, PARES_INVALIDOS } from "./n2_banco_casos";

// ---------------------------------------------------------------------
// Contraste de una corrida de N2 contra las predicciones pre-registradas.
//
// Lo importante de esta fase no es el porcentaje de cumplimiento: es
// cuántas veces el análisis estático de los prompts predijo el
// comportamiento medido. Una coincidencia alta valida el método —permite
// razonar sobre los otros agentes sin pagar una corrida por cada duda—.
// Una coincidencia baja lo invalida, y eso también es un resultado.
//
// Lee tanto el archivo completo como el `.parcial.json`, así el contraste
// se puede hacer con la corrida a mitad de camino.
//
// Uso: ts-node n2_analizar.ts [etiqueta]
// ---------------------------------------------------------------------

const SALIDA = path.join(__dirname, "..", "..", "n2_resultados");
const ETIQUETA = process.argv[2] ?? "base";

// Pares invalidados después de lanzar la corrida. Se excluyen del
// contraste en vez de contarlos mal: su premisa resultó falsa o su
// criterio era demasiado flojo para distinguir un hallazgo de un error
// del juez.
const INVALIDOS = PARES_INVALIDOS;
const esInvalido = (a: string, c: string) => INVALIDOS.find((x) => x.agente === a && x.caso === c);

function main() {
  let archivo = path.join(SALIDA, `${ETIQUETA}.json`);
  let parcial = false;
  if (!fs.existsSync(archivo)) {
    archivo = path.join(SALIDA, `${ETIQUETA}.parcial.json`);
    parcial = true;
    if (!fs.existsSync(archivo)) {
      console.error(`No hay resultados para "${ETIQUETA}".`);
      process.exit(1);
    }
  }
  const datos = JSON.parse(fs.readFileSync(archivo, "utf8"));
  const regs: any[] = datos.registros;
  const agentes = [...new Set(regs.map((r) => r.agente))];
  const casos = BANCO.map((c) => c.id).filter((id) => regs.some((r) => r.caso === id));

  console.log(`N2 · corrida "${ETIQUETA}"${parcial ? "  (PARCIAL — la corrida no terminó)" : ""}`);
  console.log(`${regs.length} estímulos · ${agentes.length} agentes\n`);

  // ------------------------------------------------------- matriz
  console.log("MATRIZ");
  console.log("caso ".padEnd(7) + agentes.map((a) => a.slice(0, 6).padStart(9)).join("") + "   invariante");
  console.log("-".repeat(7 + agentes.length * 9 + 14));
  for (const id of casos) {
    const c = BANCO.find((x) => x.id === id)!;
    const fila = agentes.map((a) => {
      const r = regs.find((x) => x.agente === a && x.caso === id);
      if (!r) return "·".padStart(9);
      const inv = esInvalido(a, id) ? "*" : "";
      return ((r.final === "CUMPLE" ? "ok" : r.final === "NO CUMPLE" ? "FALLA" : r.final === "ERROR" ? "err" : "indet") + inv).padStart(9);
    });
    console.log(id.padEnd(7) + fila.join("") + "   " + c.invariantes.join(",") + (c.control_negativo ? " (control)" : ""));
  }
  console.log("\n  * = par invalidado después de lanzar la corrida, excluido del contraste");

  // --------------------------------------- contraste con predicciones
  console.log("\n\nCONTRASTE CON LAS PREDICCIONES PRE-REGISTRADAS");
  let ac = 0, fa = 0, sin = 0, exc = 0;
  const detalle: string[] = [];
  for (const p of PREDICCIONES) {
    const r = regs.find((x) => x.agente === p.agente && x.caso === p.caso);
    if (!r) { sin++; continue; }
    if (esInvalido(p.agente, p.caso)) { exc++; continue; }
    if (r.final === "INDETERMINADO" || r.final === "ERROR") { sin++; continue; }
    const acierta = r.final === p.espera;
    if (acierta) ac++; else fa++;
    detalle.push(
      `  ${acierta ? "✓" : "✗"} ${p.agente.padEnd(24)}${p.caso.padEnd(5)}predijo ${p.espera.padEnd(10)}dio ${r.final.padEnd(10)}${p.yaVisto ? "[no ciega] " : ""}${p.fundamento.slice(0, 52)}…`
    );
  }
  detalle.forEach((l) => console.log(l));
  const ciegas = ac + fa;
  console.log(`\n  aciertos ${ac} · fallos ${fa} · de ${ciegas} contrastables`);
  if (ciegas) console.log(`  coincidencia análisis estático ↔ comportamiento: ${Math.round((ac / ciegas) * 100)} %`);
  console.log(`  (${exc} excluidas por par inválido · ${sin} sin resultado o indeterminadas)`);

  // ------------------------------------------------------- por invariante
  console.log("\n\nPOR INVARIANTE");
  const invs = [...new Set(BANCO.flatMap((c) => c.invariantes))].sort();
  for (const inv of invs) {
    const ids = BANCO.filter((c) => c.invariantes.includes(inv)).map((c) => c.id);
    const rs = regs.filter((r) => ids.includes(r.caso) && !esInvalido(r.agente, r.caso));
    if (!rs.length) continue;
    const ok = rs.filter((r) => r.final === "CUMPLE").length;
    const mal = rs.filter((r) => r.final === "NO CUMPLE").length;
    const ind = rs.filter((r) => r.final === "INDETERMINADO").length;
    const barra = "█".repeat(ok) + "░".repeat(mal) + "·".repeat(ind);
    console.log(`  ${inv}  ${String(ok).padStart(2)}/${String(rs.length).padStart(2)} cumplen  ${barra}${mal > 0 ? "   ← " + mal + " falla(n)" : ""}`);
  }

  // ------------------------------------------------------- desacuerdos del juez
  const desac = regs.filter((r) => r.pasada_a && r.pasada_b && r.pasada_a.veredicto !== r.pasada_b.veredicto);
  console.log(`\n\nCONTROL DEL JUEZ: ${desac.length} desacuerdo(s) entre las dos pasadas de ${regs.filter((r) => r.pasada_a && r.pasada_b).length}`);
  for (const d of desac.slice(0, 8))
    console.log(`  ${d.agente.padEnd(24)}${d.caso.padEnd(5)}${d.pasada_a.veredicto} vs ${d.pasada_b.veredicto}`);
  if (desac.length > 8) console.log(`  (+${desac.length - 8} más)`);
}

main();
