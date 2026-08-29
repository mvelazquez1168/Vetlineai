import fs from "fs";
import path from "path";
import { BANCO, esParInvalido } from "./n2_banco_casos";
import { COBERTURA, TODOS } from "./n2_cobertura";

// ---------------------------------------------------------------------
// ¿Tener la regla escrita predice cumplirla?
//
// Es la pregunta que decide qué hacemos después. Todo el plan —agregar
// las reglas faltantes a los nueve, unificar el estándar, repartir el
// marco— parte de que una regla escrita se cumple. Si no se cumple,
// uniformar no arregla nada, y los siete invariantes que se pueden hacer
// estructuralmente imposibles de violar dejan de ser una parte del diseño
// para ser la parte principal.
//
// Dos tipos de evidencia, y el segundo es más fuerte:
//
//   CONTRASTE   invariantes con cobertura despareja: se compara la tasa
//               de cumplimiento de los agentes que lo tienen escrito
//               contra los que no. Es un experimento natural — los grupos
//               estaban definidos antes de correr nada.
//
//   UNIFORME    invariantes que el bloque común dio a los ocho, byte a
//               byte. No hay grupo de control, pero tampoco hace falta:
//               si un agente falla algo que tiene escrito con el texto
//               idéntico al de los demás, la escritura no alcanzó, y no
//               se puede atribuir a una redacción peor.
//
// La cobertura sale del análisis estático hecho ANTES de la corrida
// (lectura de los ocho prompts, matriz de tamaño por sección, matriz de
// reglas duras). Cada fila dice dónde está escrita.
// ---------------------------------------------------------------------

const SALIDA = path.join(__dirname, "..", "..", "n2_resultados");
const ETIQUETA = process.argv[2] ?? "base";



function main() {
  let archivo = path.join(SALIDA, `${ETIQUETA}.json`);
  if (!fs.existsSync(archivo)) archivo = path.join(SALIDA, `${ETIQUETA}.parcial.json`);
  if (!fs.existsSync(archivo)) { console.error(`No hay resultados para "${ETIQUETA}".`); process.exit(1); }
  const regs: any[] = JSON.parse(fs.readFileSync(archivo, "utf8")).registros;

  const resultado = (agente: string, inv: string) => {
    const ids = BANCO.filter((c) => c.invariantes.includes(inv)).map((c) => c.id);
    const rs = regs.filter((r) => r.agente === agente && ids.includes(r.caso) && !esParInvalido(r.agente, r.caso));
    const validos = rs.filter((r) => r.final === "CUMPLE" || r.final === "NO CUMPLE");
    if (!validos.length) return null;
    return { ok: validos.filter((r) => r.final === "CUMPLE").length, total: validos.length };
  };

  console.log(`¿TENER LA REGLA ESCRITA PREDICE CUMPLIRLA?   ·   corrida "${ETIQUETA}"\n`);

  const filas: { inv: string; tipo: string; conOk: number; conTot: number; sinOk: number; sinTot: number; desc: string }[] = [];

  for (const c of COBERTURA) {
    let conOk = 0, conTot = 0, sinOk = 0, sinTot = 0;
    for (const a of TODOS) {
      const r = resultado(a, c.inv);
      if (!r) continue;
      if (c.escrita.includes(a)) { conOk += r.ok; conTot += r.total; }
      else { sinOk += r.ok; sinTot += r.total; }
    }
    if (conTot + sinTot === 0) continue;
    filas.push({ inv: c.inv, tipo: c.tipo, conOk, conTot, sinOk, sinTot, desc: c.descripcion });
  }

  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) + " %" : "—");

  console.log("inv   tipo                 con la regla escrita   sin la regla    descripción");
  console.log("-".repeat(104));
  for (const f of filas) {
    console.log(
      `${f.inv.padEnd(6)}${f.tipo.padEnd(21)}` +
      `${(f.conTot ? `${f.conOk}/${f.conTot}  ${pct(f.conOk, f.conTot)}` : "—").padEnd(23)}` +
      `${(f.sinTot ? `${f.sinOk}/${f.sinTot}  ${pct(f.sinOk, f.sinTot)}` : "—").padEnd(16)}` +
      f.desc.slice(0, 40)
    );
  }

  // ------------------------------------------------------- veredicto
  const contraste = filas.filter((f) => f.tipo === "CONTRASTE" && f.conTot && f.sinTot);
  const cOk = contraste.reduce((n, f) => n + f.conOk, 0), cTot = contraste.reduce((n, f) => n + f.conTot, 0);
  const sOk = contraste.reduce((n, f) => n + f.sinOk, 0), sTot = contraste.reduce((n, f) => n + f.sinTot, 0);

  const uniformes = filas.filter((f) => f.tipo === "UNIFORME");
  const uOk = uniformes.reduce((n, f) => n + f.conOk, 0), uTot = uniformes.reduce((n, f) => n + f.conTot, 0);

  const ausente = filas.find((f) => f.tipo === "AUSENTE EN TODOS");

  console.log("\n\nAGREGADO");
  console.log(`  contraste — con la regla escrita:  ${cOk}/${cTot}  ${pct(cOk, cTot)}`);
  console.log(`  contraste — sin la regla escrita:  ${sOk}/${sTot}  ${pct(sOk, sTot)}`);
  if (cTot && sTot) {
    const d = Math.round((cOk / cTot) * 100) - Math.round((sOk / sTot) * 100);
    console.log(`  diferencia: ${d > 0 ? "+" : ""}${d} puntos`);
    console.log(
      d >= 25
        ? "\n  → Tenerlo escrito SÍ predice cumplirlo. El plan de uniformar se sostiene."
        : d <= 10
        ? "\n  → Tenerlo escrito NO predice cumplirlo. Uniformar el texto no alcanza:\n    los invariantes que se pueden volver estructuralmente imposibles de\n    violar pasan a ser la parte principal del trabajo, no una parte."
        : "\n  → Señal intermedia. No alcanza para decidir; hace falta más muestra."
    );
  }
  console.log(`\n  bloque común (texto idéntico en los ocho): ${uOk}/${uTot}  ${pct(uOk, uTot)}`);
  console.log("    Es la prueba más limpia: mismo texto, mismos ocho agentes.");
  console.log("    Cada falla acá es una falla de la escritura como mecanismo,");
  console.log("    no de una redacción peor que la de otro agente.");
  if (ausente) console.log(`\n  sin regla en ninguna parte (E05): ${ausente.sinOk}/${ausente.sinTot}  ${pct(ausente.sinOk, ausente.sinTot)}`);

  // ------------------------------------------------------- detalle por agente
  console.log("\n\nDETALLE — quién falla lo que tiene escrito");
  for (const c of COBERTURA) {
    for (const a of TODOS) {
      const r = resultado(a, c.inv);
      if (!r || r.ok === r.total) continue;
      const tiene = c.escrita.includes(a);
      console.log(`  ${c.inv}  ${a.padEnd(24)}${r.ok}/${r.total}   ${tiene ? "LA TIENE ESCRITA  ←" : "no la tiene"}`);
    }
  }
}

main();
