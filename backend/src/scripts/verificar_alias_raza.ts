// Verifica las 23 filas de razas_alias_documento contra el documento
// real (sin pegarle a un caso — arma el bloque directo con la función
// pura + los datos de la fila de alias), y confirma que la nota, cuando
// existe, aparece en el texto que recibiría el agente.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_alias_raza.ts
import { pool } from "../db";
import { seleccionarSeccionRaza, NOMBRE_DOCUMENTO_PREDISPOSICIONES } from "../razaDocumento";

async function main() {
  const docResult = await pool.query(
    `SELECT contenido_texto FROM documentos_conocimiento WHERE nombre = $1`,
    [NOMBRE_DOCUMENTO_PREDISPOSICIONES]
  );
  const contenido = docResult.rows[0].contenido_texto as string;

  const alias = await pool.query(
    `SELECT r.nombre AS raza, r.especie, a.titulo_seccion, a.nota
     FROM razas_alias_documento a JOIN razas r ON r.id = a.raza_id
     ORDER BY r.nombre`
  );

  let ok = true;
  for (const fila of alias.rows) {
    const especieDoc = fila.especie === "canina" ? "Canino" : "Felino";
    const { texto, coincidio } = seleccionarSeccionRaza(contenido, especieDoc, fila.raza, fila.titulo_seccion, fila.nota);
    const notaOk = fila.nota ? texto.includes(fila.nota) : true;
    const pass = coincidio && notaOk;
    if (!pass) ok = false;
    console.log(
      `[${pass ? "OK" : "FALLO"}] ${fila.raza} → "${fila.titulo_seccion}"` +
        (fila.nota ? ` (con nota, presente=${notaOk})` : "") +
        ` — tamaño=${texto.length}`
    );
  }

  console.log(`\n${ok ? `TODO OK — 23/23 razas mapeadas resuelven` : "HAY FALLOS"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
