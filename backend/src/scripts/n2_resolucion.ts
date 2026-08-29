import fs from "fs";
import path from "path";
import { BANCO, esParInvalido } from "./n2_banco_casos";
import { COBERTURA, TODOS } from "./n2_cobertura";

// ---------------------------------------------------------------------
// ¿Qué diferencia puede DISTINGUIR esta muestra, de verdad?
//
// Fijar umbrales de decisión sin saber la resolución del instrumento es
// cómo se lee ruido como si fuera señal. Con catorce estímulos, diez
// puntos porcentuales son 1,4 casos: si el juez se contradice en uno de
// cada doce veredictos, esa diferencia no se distingue de nada.
//
// Se calcula tres cosas:
//
//   1. Los tamaños REALES de cada grupo de comparación. Es donde esta el
//      problema de fondo: tres de los cinco contrastes tienen un solo
//      agente de un lado.
//   2. La diferencia minima detectable (DMD) para cada contraste y para
//      el agregado, por el error estandar de una diferencia de
//      proporciones. Se usa p=0,5, que es el caso de maxima varianza:
//      cualquier otro valor da una DMD menor, asi que este numero es el
//      techo del pesimismo y no se puede acusar de optimista.
//   3. Cuanta muestra haria falta para que los umbrales fijados sean
//      utilizables.
//
// El ruido del juez entra de una forma particular: los DESACUERDO se
// excluyen del analisis, asi que no sesgan el resultado — reducen la n.
// Eso es mejor que un sesgo, pero achica todavia mas la resolucion.
// ---------------------------------------------------------------------

const SALIDA = path.join(__dirname, "..", "..", "n2_resultados");
const ETIQUETA = process.argv[2] ?? "base";
const Z95 = 1.96;
const Z80 = 1.2816;

function main() {
  let archivo = path.join(SALIDA, `${ETIQUETA}.json`);
  if (!fs.existsSync(archivo)) archivo = path.join(SALIDA, `${ETIQUETA}.parcial.json`);
  const regs: any[] = JSON.parse(fs.readFileSync(archivo, "utf8")).registros;

  const causa = (r: any) =>
    r.final === "ERROR" ? "ERROR"
      : !r.pasada_a || !r.pasada_b ? "FALLO_JUEZ"
      : r.pasada_a.veredicto !== r.pasada_b.veredicto ? "DESACUERDO"
      : r.pasada_a.veredicto;

  // ------------------------------------------- ruido medido del juez
  const con2 = regs.filter((r) => r.pasada_a && r.pasada_b);
  const desac = con2.filter((r) => causa(r) === "DESACUERDO");
  const ruido = con2.length ? desac.length / con2.length : 0;

  console.log(`RESOLUCIÓN DE LA MUESTRA   ·   corrida "${ETIQUETA}"\n`);
  console.log(`Ruido medido del instrumento: ${desac.length}/${con2.length} = ${(ruido * 100).toFixed(1)} % de desacuerdo entre las dos pasadas.`);
  console.log(`Los DESACUERDO no sesgan: se excluyen. Pero reducen la n utilizable en esa proporción.\n`);

  // ------------------------------------------- tamaños por contraste
  const dmd = (n1: number, n2: number, z: number) =>
    n1 && n2 ? z * Math.sqrt(0.25 / n1 + 0.25 / n2) * 100 : Infinity;

  console.log("TAMAÑOS REALES DE CADA CONTRASTE");
  console.log("inv    estímulos con la regla   sin la regla   DMD 95%    DMD 80%   utilizable");
  console.log("-".repeat(88));

  let totalCon = 0, totalSin = 0;
  for (const c of COBERTURA.filter((x) => x.tipo === "CONTRASTE")) {
    const ids = BANCO.filter((b) => b.invariantes.includes(c.inv)).map((b) => b.id);
    const util = (agentes: string[]) =>
      regs.filter(
        (r) => agentes.includes(r.agente) && ids.includes(r.caso) && !esParInvalido(r.agente, r.caso) &&
          (causa(r) === "CUMPLE" || causa(r) === "NO CUMPLE")
      ).length;
    const nCon = util(c.escrita);
    const nSin = util(TODOS.filter((a) => !c.escrita.includes(a)));
    totalCon += nCon; totalSin += nSin;
    const d95 = dmd(nCon, nSin, Z95), d80 = dmd(nCon, nSin, Z80);
    const veredicto = nCon === 0 || nSin === 0 ? "sin datos aún" : Math.min(nCon, nSin) === 1 ? "NO — un solo agente de un lado" : d95 <= 40 ? "limitada" : "NO — DMD > 40 pts";
    console.log(
      `${c.inv.padEnd(7)}${String(ids.length).padStart(9)}${String(nCon).padStart(15)}${String(nSin).padStart(15)}` +
      `${(isFinite(d95) ? d95.toFixed(0) + " pts" : "—").padStart(10)}${(isFinite(d80) ? d80.toFixed(0) + " pts" : "—").padStart(11)}   ${veredicto}`
    );
  }

  // ------------------------------------------- agregado
  const d95 = dmd(totalCon, totalSin, Z95);
  const d80 = dmd(totalCon, totalSin, Z80);
  console.log("-".repeat(88));
  console.log(`AGREGADO${String(totalCon).padStart(29)}${String(totalSin).padStart(15)}${d95.toFixed(0).padStart(7)} pts${d80.toFixed(0).padStart(8)} pts\n`);

  // ------------------------------------------- veredicto sobre los umbrales
  console.log("LOS UMBRALES FIJADOS, CONTRA LA RESOLUCIÓN REAL\n");
  const filas = [
    { u: 25, txt: "≥ 25 pts → «escrito predice cumplido»" },
    { u: 10, txt: "≤ 10 pts → «escrito NO predice cumplido»" },
    { u: 17, txt: "banda 10–25 → «señal intermedia»" },
  ];
  for (const f of filas) {
    const ok95 = f.u >= d95, ok80 = f.u >= d80;
    console.log(
      `  ${f.txt.padEnd(46)}${ok95 ? "USABLE al 95 %" : ok80 ? "usable solo al 80 %" : "NO USABLE"}` +
      `   (hace falta ${d95.toFixed(0)} pts al 95 %, ${d80.toFixed(0)} al 80 %)`
    );
  }

  // ------------------------------------------- cuanta muestra haria falta
  console.log("\nMUESTRA NECESARIA PARA QUE CADA UMBRAL SEA UTILIZABLE");
  console.log("(n por grupo, asumiendo grupos iguales y p = 0,5)\n");
  for (const u of [25, 15, 10]) {
    const n = Math.ceil((2 * 0.25 * Math.pow(Z95 / (u / 100), 2)));
    const estimulos = n * 2;
    console.log(`  detectar ${String(u).padStart(2)} pts al 95 %:  n = ${String(n).padStart(3)} por grupo · ${estimulos} observaciones · hoy hay ${totalCon + totalSin}`);
  }

  console.log("\nNOTA SOBRE EL RUIDO DEL JUEZ");
  console.log(`  El ${(ruido * 100).toFixed(0)} % de desacuerdo entre pasadas se descarta, así que no sesga.`);
  console.log(`  Pero las dos pasadas comparten el MISMO modelo: coincidir no prueba acertar.`);
  console.log(`  Un error correlacionado entre pasadas es invisible para este control, y`);
  console.log(`  ningún cálculo de resolución lo cubre.`);
}

main();
