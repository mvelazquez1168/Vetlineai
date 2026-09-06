import { pool } from "../db";
import { calcularHuellaCaso, estadoSintesis } from "../sintesisClinica";

// La huella no sirve si no reacciona. Se prueba contra un caso real:
// estable ante lecturas repetidas, distinta ante cualquier cambio del
// material, y volviendo a la original si el cambio se revierte.
//
// Todo dentro de una transacción que se revierte: no deja datos.

async function main() {
  const client = await pool.connect();
  try {
    const caso = (
      await client.query(
        `SELECT c.id, count(m.id)::int mensajes FROM casos c
           LEFT JOIN mensajes m ON m.caso_id = c.id
          GROUP BY c.id ORDER BY count(m.id) DESC LIMIT 1`
      )
    ).rows[0];
    console.log(`Caso de prueba: ${String(caso.id).slice(0, 8)} · ${caso.mensajes} mensajes\n`);

    const h1 = await calcularHuellaCaso(client, caso.id);
    const h2 = await calcularHuellaCaso(client, caso.id);
    console.log(`1. estable entre lecturas:            ${h1 === h2 ? "SÍ" : "NO ←"}   ${h1.slice(0, 16)}`);

    await client.query("BEGIN");

    // Cambio 1: un mensaje nuevo.
    await client.query(
      `INSERT INTO mensajes (caso_id, remitente, tipo, contenido)
       VALUES ($1, 'medico', 'consulta', 'mensaje de prueba de huella')`,
      [caso.id]
    );
    const h3 = await calcularHuellaCaso(client, caso.id);
    console.log(`2. cambia al agregar un mensaje:      ${h3 !== h1 ? "SÍ" : "NO ←"}   ${h3.slice(0, 16)}`);
    await client.query("ROLLBACK");

    // Cambio 2: el estado del caso.
    await client.query("BEGIN");
    await client.query(`UPDATE casos SET severidad = 'critico' WHERE id = $1`, [caso.id]);
    const h4 = await calcularHuellaCaso(client, caso.id);
    console.log(`3. cambia al cambiar el caso:         ${h4 !== h1 ? "SÍ" : "NO ←"}   ${h4.slice(0, 16)}`);
    await client.query("ROLLBACK");

    // Cambio 3: reversión.
    const h5 = await calcularHuellaCaso(client, caso.id);
    console.log(`4. vuelve a la original al revertir:  ${h5 === h1 ? "SÍ" : "NO ←"}   ${h5.slice(0, 16)}`);

    // Estado de la síntesis sobre un caso sin síntesis.
    //
    // La precondición se FUERZA en vez de suponerse. Este arnés elige el
    // caso con más mensajes, que es justo el que cualquier script de
    // síntesis usa primero: apenas alguien corrió uno, el caso ya tiene
    // síntesis y este punto pasa a medir otra cosa (existe=true,
    // vigente=true) sin que nada avise. Se limpia acá adentro y se revierte:
    // el caso real no se toca.
    await client.query("BEGIN");
    await client.query(
      `UPDATE casos SET sintesis=NULL, sintesis_huella=NULL, sintesis_generada_en=NULL, sintesis_estado=NULL
        WHERE id = $1`,
      [caso.id]
    );
    const e = await estadoSintesis(client, caso.id);
    console.log(`\n5. estado sobre un caso sin síntesis: existe=${e.existe} vigente=${e.vigente}`);
    await client.query("ROLLBACK");

    // Vigencia: se guarda una síntesis con la huella actual y se comprueba
    // que quede vigente, y que deje de estarlo al tocar el caso.
    await client.query("BEGIN");
    await client.query(
      `UPDATE casos SET sintesis = '{"meta":{"estado_generacion":"generado"}}'::jsonb,
              sintesis_huella = $2, sintesis_generada_en = now() WHERE id = $1`,
      [caso.id, h1]
    );
    const e2 = await estadoSintesis(client, caso.id);
    console.log(`6. con síntesis guardada:             existe=${e2.existe} vigente=${e2.vigente}`);
    await client.query(`UPDATE casos SET motivo = motivo || ' (tocado)' WHERE id = $1`, [caso.id]);
    const e3 = await estadoSintesis(client, caso.id);
    console.log(`7. tras tocar el caso:                existe=${e3.existe} vigente=${e3.vigente}${e3.vigente ? "  ← DEBERÍA SER false" : ""}`);
    await client.query("ROLLBACK");

    // El CHECK impide estados a medias.
    //
    // Misma precondición forzada, y por un motivo más filoso que el del
    // punto 5: si el caso YA tiene huella, fecha y estado, escribir
    // `sintesis` no deja ningún estado a medias, el CHECK no se viola, y
    // este punto reporta "el CHECK no protege" cuando el CHECK está
    // perfecto. Es una falsa alarma, no un falso OK — la peor clase, porque
    // manda a investigar una restricción que funciona.
    await client.query("BEGIN");
    await client.query(
      `UPDATE casos SET sintesis=NULL, sintesis_huella=NULL, sintesis_generada_en=NULL, sintesis_estado=NULL
        WHERE id = $1`,
      [caso.id]
    );
    let bloqueado = false;
    try {
      await client.query(`UPDATE casos SET sintesis = '{}'::jsonb WHERE id = $1`, [caso.id]);
    } catch { bloqueado = true; }
    await client.query("ROLLBACK");
    console.log(`8. el CHECK impide síntesis sin huella: ${bloqueado ? "SÍ" : "NO ←"}`);

    const ok = h1 === h2 && h3 !== h1 && h4 !== h1 && h5 === h1 && !e.vigente && e2.vigente && !e3.vigente && bloqueado;
    console.log(`\n${ok ? "[OK] 8/8 — la huella reacciona a lo que tiene que reaccionar." : "[FALLO] revisar"}`);
    process.exit(ok ? 0 : 1);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error("ERROR", e.message ?? e); process.exit(1); });
