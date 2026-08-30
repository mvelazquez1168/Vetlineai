import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------
// Agrega el bloque de reglas comunes al final de cada prompt de agente.
//
// La condición dura es que el bloque quede IDÉNTICO CARÁCTER POR CARÁCTER
// en todos los prompts. No es prolijidad: el mismo mecanismo de copiar
// texto entre prompts es el que produjo la deriva del AI Reasoning
// Standard (hoy entre 14% y 69% de solape entre agentes con los mismos
// títulos). Si estas reglas entran idénticas, la partición futura las
// puede extraer a un documento único con un corte exacto; si entran con
// variaciones, hay que reconciliarlas primero.
//
// Por eso el texto sale de UN archivo (reglas_comunes_agentes.md) y se
// copia sin tocar, y por eso la verificación final no confía en que la
// copia haya salido bien: relee los archivos escritos y compara los
// bloques entre sí.
//
// Saltos de línea: se normaliza todo a LF antes de escribir. Sin esto,
// gastroenterología —el único prompt con CRLF en el repo— tendría un
// bloque distinto byte a byte al de los otros siete, aunque el texto se
// leyera igual.
//
// Idempotente: si el prompt ya trae el bloque, no se vuelve a agregar.
//
// Verificaciones, todas antes de dar el OK:
//   1. El bloque quedó byte-idéntico en los ocho.
//   2. Lo anterior al bloque no cambió en ningún prompt.
//   3. Ninguna regla del bloque quedó sin aparecer.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const PROMPTS = path.join(DIR, "prompts");
const BLOQUE = path.join(DIR, "reglas_comunes_agentes.md");
const MARCA = "## Reglas comunes a todos los agentes clínicos de Vetline Ai";

const escribir = process.argv.includes("--escribir");

function main() {
  const bloque = fs.readFileSync(BLOQUE, "utf8").replace(/\r\n/g, "\n").trimEnd();
  const archivos = fs.readdirSync(PROMPTS).filter((f) => f.endsWith(".txt"));

  const antes = new Map<string, string>();
  for (const f of archivos) antes.set(f, fs.readFileSync(path.join(PROMPTS, f), "utf8").replace(/\r\n/g, "\n"));

  console.log(`Bloque: ${bloque.length} caracteres, ${bloque.split("\n\n").length - 1} regla(s) + encabezado.`);
  console.log(`Prompts: ${archivos.length}\n`);

  const resultados: { f: string; accion: string; antes: number; despues: number }[] = [];
  for (const f of archivos) {
    const original = antes.get(f)!;
    // Si el bloque ya está, se REEMPLAZA en vez de saltearse. Saltearlo
    // funcionaba mientras el bloque no cambiara nunca; ahora que se le
    // promueven reglas, saltearlo dejaría a los ocho con la versión vieja
    // y el archivo fuente diciendo otra cosa — deriva silenciosa, que es
    // justo lo que este bloque existe para evitar.
    const i = original.indexOf(MARCA);
    if (i >= 0 && original.slice(i).trimEnd() === bloque) {
      resultados.push({ f, accion: "ya idéntico", antes: original.length, despues: original.length });
      continue;
    }
    // Sin salto de línea final: ningún prompt de este repo lo tiene, y la
    // migración concatena el bloque tal cual. Un "\n" de más acá hace que
    // el archivo y la base difieran en 1 carácter — invisible al leer,
    // pero suficiente para que el auditor de deriva marque los ocho.
    const previo = (i >= 0 ? original.slice(0, i) : original).trimEnd();
    const nuevo = previo + "\n\n" + bloque;
    if (escribir) fs.writeFileSync(path.join(PROMPTS, f), nuevo, "utf8");
    resultados.push({
      f,
      accion: (i >= 0 ? "actualizado" : "agregado") + (escribir ? "" : " (simulado)"),
      antes: original.length,
      despues: nuevo.length,
    });
  }

  console.log("prompt                       antes   después   acción");
  console.log("-".repeat(64));
  for (const r of resultados)
    console.log(
      `${r.f.replace(".txt", "").padEnd(27)}${String(r.antes).padStart(6)}${String(r.despues).padStart(10)}   ${r.accion}`
    );

  if (!escribir) {
    console.log("\n(simulación — nada escrito; correr con --escribir)");
    return;
  }

  // ---------------- verificación ----------------
  console.log("\nVERIFICACIÓN");
  const bloques = new Map<string, string>();
  let prefijosOk = true;
  for (const f of archivos) {
    const ahora = fs.readFileSync(path.join(PROMPTS, f), "utf8").replace(/\r\n/g, "\n");
    const i = ahora.indexOf(MARCA);
    if (i < 0) {
      console.log(`   [FALLO] ${f}: el bloque no está.`);
      return process.exit(1);
    }
    bloques.set(f, ahora.slice(i));
    // 2. lo anterior al bloque tiene que ser el original, sin cambios.
    // La línea base se toma SIN el bloque: en una segunda corrida el
    // archivo leído al inicio ya lo trae, y compararlo entero contra el
    // prefijo daba un falso fallo (el bug estaba acá, no en el prompt).
    const sinBloque = (s: string) => {
      const j = s.indexOf(MARCA);
      return (j < 0 ? s : s.slice(0, j)).trimEnd();
    };
    const previo = ahora.slice(0, i).trimEnd();
    if (previo !== sinBloque(antes.get(f)!)) {
      console.log(`   [FALLO] ${f}: cambió texto fuera del bloque.`);
      prefijosOk = false;
    }
  }

  const distintos = [...new Set(bloques.values())];
  const idem = distintos.length === 1;
  console.log(`   1. bloque byte-idéntico en los ${archivos.length}: ${idem ? "SÍ" : `NO — ${distintos.length} variantes`}`);
  if (!idem) {
    const [a, b] = distintos;
    for (let i = 0; i < Math.max(a.length, b.length); i++)
      if (a[i] !== b[i]) {
        console.log(`      primera diferencia en ${i}: ${JSON.stringify(a.slice(i - 40, i + 40))} vs ${JSON.stringify(b.slice(i - 40, i + 40))}`);
        break;
      }
  }
  console.log(`   2. nada cambió fuera del bloque: ${prefijosOk ? "SÍ" : "NO"}`);

  const reglas = bloque
    .split("\n")
    .filter((l) => /^[A-ZÁÉÍÓÚÑ][^.]{5,45}\./.test(l))
    .map((l) => l.split(".")[0]);
  const faltantes = reglas.filter((r) => [...bloques.values()].some((b) => !b.includes(r)));
  console.log(`   3. las ${reglas.length} reglas están en los ${archivos.length}: ${faltantes.length === 0 ? "SÍ" : `NO — falta ${faltantes.join(", ")}`}`);

  const ok = idem && prefijosOk && faltantes.length === 0;
  console.log(`\n   ${ok ? "[OK] listo para sembrar. La base NO se tocó." : "[FALLO] revisar"}`);
  process.exit(ok ? 0 : 1);
}

main();
