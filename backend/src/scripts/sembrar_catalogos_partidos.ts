import fs from "fs";
import path from "path";
import crypto from "crypto";

// ---------------------------------------------------------------------
// Deja el sembrado listo con los catálogos partidos: reemplaza la entrada
// del catálogo entero por sus dos mitades en documentos.json, y copia el
// contenido a la carpeta documentos/ con el nombre por UUID que usa el
// resto del sembrado.
//
// El sembrado inserta con ON CONFLICT (id) DO NOTHING: agrega, nunca
// actualiza ni retira. Por eso esto NO alcanza solo — hace falta la
// migración 074, que archiva los dos catálogos enteros en las bases que
// ya los tienen. Los dos pasos juntos dan:
//
//   base nueva      → el sembrado inserta solo las mitades; la migración
//                     no matchea nada.
//   base existente  → la migración archiva el entero; el sembrado agrega
//                     las mitades.
//   correrlo 2 veces→ el ON CONFLICT no inserta nada nuevo y el UPDATE de
//                     la migración ya no matchea. Sin efecto.
//
// Los UUID de las mitades se derivan del UUID del catálogo original con
// un hash, no se sortean: correr este script dos veces produce los mismos
// ids, así que no aparecen documentos duplicados con id distinto.
//
// NO toca la base. Solo deja archivos listos para que el despliegue los
// aplique.
// ---------------------------------------------------------------------

const DIR = path.join(__dirname, "..", "seed", "plataforma");
const JSON_DOCS = path.join(DIR, "documentos.json");
const DIR_DOCS = path.join(DIR, "documentos");

interface DocumentoSeed {
  id: string;
  nombre: string;
  descripcion: string | null;
  tipo: string;
  agente_slug: string | null;
  pais_codigo: string | null;
  incluir_en_contexto: boolean;
  estado: string;
  contenidoFile: string;
  ambito?: "clinico" | "generacion";
}

// UUID v4-shape derivado determinísticamente del original + sufijo.
function idDerivado(idOriginal: string, sufijo: string): string {
  const h = crypto.createHash("sha1").update(`${idOriginal}:${sufijo}`).digest("hex");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    "4" + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join("-");
}

const CATALOGOS = [
  { patron: /^GCIS Clinical Components Catalog/, prefijo: "catalogo_gcis" },
  { patron: /^ICIS Clinical Components Catalog/, prefijo: "catalogo_icis" },
];

function main() {
  const docs: DocumentoSeed[] = JSON.parse(fs.readFileSync(JSON_DOCS, "utf8"));
  let cambios = 0;

  for (const cat of CATALOGOS) {
    const i = docs.findIndex((d) => cat.patron.test(d.nombre) && !/—/.test(d.nombre));
    if (i < 0) {
      console.log(`   (ya partido o ausente: ${cat.prefijo})`);
      continue;
    }
    const orig = docs[i];

    const mitades: { sufijo: string; nombre: string; ambito: "clinico" | "generacion"; archivo: string }[] = [
      {
        sufijo: "razonamiento",
        nombre: `${orig.nombre} — Razonamiento clínico`,
        ambito: "clinico",
        archivo: `${cat.prefijo}_razonamiento.md`,
      },
      {
        sufijo: "composicion",
        nombre: `${orig.nombre} — Composición de salida`,
        ambito: "generacion",
        archivo: `${cat.prefijo}_composicion.md`,
      },
    ];

    const nuevas: DocumentoSeed[] = mitades.map((m) => {
      const id = idDerivado(orig.id, m.sufijo);
      const contenido = fs.readFileSync(path.join(DIR, m.archivo), "utf8");
      fs.writeFileSync(path.join(DIR_DOCS, `${id}.txt`), contenido, "utf8");
      return {
        id,
        nombre: m.nombre,
        descripcion:
          m.ambito === "generacion"
            ? "Mitad del catálogo de componentes que describe cómo se arma la salida (dashboard, informe, base de conocimiento). No entra en el chat."
            : "Mitad del catálogo de componentes con el razonamiento clínico. Entra en todos los caminos.",
        tipo: orig.tipo,
        agente_slug: orig.agente_slug,
        pais_codigo: orig.pais_codigo,
        incluir_en_contexto: true,
        estado: "activo",
        contenidoFile: `${id}.txt`,
        ambito: m.ambito,
      };
    });

    // Reemplaza la entrada del entero por las dos mitades, en su lugar.
    docs.splice(i, 1, ...nuevas);
    cambios++;
    console.log(`   ${orig.nombre}`);
    console.log(`      → ${nuevas[0].nombre}  [clinico]     ${nuevas[0].id}`);
    console.log(`      → ${nuevas[1].nombre}  [generacion]  ${nuevas[1].id}`);
    console.log(`      (el entero ${orig.id} lo retira la migración 074)`);
  }

  if (cambios === 0) {
    console.log("\nNada que hacer: el sembrado ya está partido.");
    process.exit(0);
  }

  fs.writeFileSync(JSON_DOCS, JSON.stringify(docs, null, 2) + "\n", "utf8");
  console.log(`\ndocumentos.json actualizado: ${docs.length} entradas.`);
  process.exit(0);
}

main();
