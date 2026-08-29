import { pool } from "../db";
import { requerirAnthropic } from "../anthropic";
import { obtenerDocumentosParaContexto, construirBloqueDocumentos } from "../routes/casos.routes";
import { HERRAMIENTAS_AGENTE } from "../herramientasAgente";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { construirBloqueRazaDocumento } from "../razaDocumento";
import { construirMensajesParaModelo } from "../archivosDelCaso";

// ---------------------------------------------------------------------
// Cuánto costaría el experimento del catálogo de componentes ANTES de
// correrlo.
//
// El experimento: tomar casos reales con conversación, y volver a correr
// cada turno del médico dos veces —con el catálogo en contexto y sin él—
// para comparar razonamiento clínico, diferenciales y derivaciones, y
// contar si el agente cita códigos de componente durante el chat.
//
// Este script NO llama al modelo para generar: solo cuenta tokens (el
// endpoint de conteo no se factura) y proyecta el costo con los precios
// de Sonnet 4.6. El promedio de tokens de salida sale de uso_api, de las
// llamadas clínicas reales ya facturadas, no de una suposición.
// ---------------------------------------------------------------------

const MODELO = "claude-sonnet-4-6";
const NOMBRE_CATALOGO = "GCIS Clinical Components Catalog";

// Sonnet 4.6: $3 por millón de entrada, $15 de salida.
// Escritura de caché a 1h = 2x entrada; lectura = 0,1x.
const USD_ENTRADA = 3 / 1_000_000;
const USD_SALIDA = 15 / 1_000_000;

async function contar(system: any[], messages: any[], tools?: any[]): Promise<number> {
  const r = await requerirAnthropic().messages.countTokens({
    model: MODELO,
    system: system as any,
    tools: tools as any,
    messages: messages as any,
  });
  return r.input_tokens;
}

async function main() {
  const cantidadCasos = Number(process.argv[2] ?? 4);
  // El catálogo grande es de un agente puntual: comparar con/sin él en
  // casos de otro agente no mide nada (su contexto ni lo incluye).
  const agente = process.argv[3] ?? "Gastroenterología";

  const salidaPromedio = Number(
    (
      await pool.query(
        `SELECT ROUND(AVG(tokens_salida)) AS s FROM uso_api WHERE tipo_consumo = 'clinico' AND tokens_salida > 0`
      )
    ).rows[0].s
  );

  // Casos candidatos: agente con system_prompt (llamada real), con turnos
  // de consulta del médico de verdad, el más conversado primero.
  const casos = (
    await pool.query(
      `SELECT c.id, c.agente_id, c.tenant_id, a.nombre AS agente, a.system_prompt,
              (SELECT COUNT(*) FROM mensajes m
                WHERE m.caso_id = c.id AND m.tipo = 'consulta' AND m.remitente = 'medico') AS turnos
         FROM casos c
         JOIN agentes a ON a.id = c.agente_id
        WHERE a.system_prompt IS NOT NULL
          AND a.nombre = $2
          AND (SELECT COUNT(*) FROM mensajes m
                WHERE m.caso_id = c.id AND m.tipo = 'consulta' AND m.remitente = 'medico') >= 2
        ORDER BY turnos DESC
        LIMIT $1`,
      [cantidadCasos, agente]
    )
  ).rows;

  if (casos.length === 0) throw new Error("No hay casos con conversación suficiente.");

  console.log(`\nPRESUPUESTO DEL EXPERIMENTO — ${casos.length} caso(s), 2 variantes cada uno`);
  console.log(`Salida promedio por respuesta (medida en uso_api): ${salidaPromedio} tokens\n`);
  console.log("CASO                                  AGENTE            TURNOS   CON CAT.   SIN CAT.");
  console.log("---------------------------------------------------------------------------------");

  let totalConCatalogo = 0;
  let totalSinCatalogo = 0;
  let ahorroBloque = 0;

  for (const caso of casos) {
    const cliente = await pool.connect();
    let documentos: any[];
    let bloqueContexto: string;
    let bloqueRaza: string;
    let historial: Awaited<ReturnType<typeof construirMensajesParaModelo>>;
    try {
      documentos = (await obtenerDocumentosParaContexto(cliente, caso.agente_id, caso.tenant_id)).todos;
      bloqueContexto = await construirBloqueContextoCaso(cliente, caso.id);
      bloqueRaza = (await construirBloqueRazaDocumento(cliente, caso.id, caso.tenant_id)) ?? "";
      historial = await construirMensajesParaModelo(cliente, caso.id);
    } finally {
      cliente.release();
    }

    const sinCatalogo = documentos.filter((d: any) => !String(d.nombre).startsWith(NOMBRE_CATALOGO));
    const systemCon = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(documentos as any)}`;
    const systemSin = `${caso.system_prompt}\n\n---\n\n${construirBloqueDocumentos(sinCatalogo as any)}`;

    // El bloque cacheado incluye las herramientas: se renderizan antes del
    // system y son parte del mismo prefijo (ver herramientasAgente.ts).
    const bloqueCon = await contar([{ type: "text", text: systemCon }], [{ role: "user", content: "." }], HERRAMIENTAS_AGENTE);
    const bloqueSin = await contar([{ type: "text", text: systemSin }], [{ role: "user", content: "." }], HERRAMIENTAS_AGENTE);

    // Lo que NO se cachea y se recalcula en cada turno: contexto del caso,
    // raza, y el historial acumulado. Se mide en el estado final del caso
    // (el turno más caro); los turnos anteriores son más baratos, así que
    // esto sobreestima a propósito — un presupuesto que se pasa es peor
    // que uno que sobra.
    const soloTexto = historial.mensajes.map((m) =>
      typeof m.content === "string"
        ? m
        : { ...m, content: m.content.filter((b: any) => b.type === "text") }
    );
    const noCacheado =
      (await contar(
        [
          { type: "text", text: "." },
          { type: "text", text: bloqueContexto },
          ...(bloqueRaza ? [{ type: "text" as const, text: bloqueRaza }] : []),
        ],
        soloTexto.length > 0 ? (soloTexto as any) : [{ role: "user", content: "." }]
      )) - (await contar([{ type: "text", text: "." }], [{ role: "user", content: "." }]));

    const turnos = Number(caso.turnos);
    const costoVariante = (bloque: number) =>
      bloque * 2 * USD_ENTRADA + // una escritura de caché a 1h
      (turnos - 1) * bloque * 0.1 * USD_ENTRADA + // el resto lee
      turnos * noCacheado * USD_ENTRADA +
      turnos * salidaPromedio * USD_SALIDA;

    const con = costoVariante(bloqueCon);
    const sin = costoVariante(bloqueSin);
    totalConCatalogo += con;
    totalSinCatalogo += sin;
    ahorroBloque += bloqueCon - bloqueSin;

    console.log(
      String(caso.id).slice(0, 36).padEnd(38) +
        String(caso.agente).slice(0, 16).padEnd(18) +
        String(turnos).padStart(6) +
        ("$" + con.toFixed(2)).padStart(11) +
        ("$" + sin.toFixed(2)).padStart(11)
    );
  }

  const total = totalConCatalogo + totalSinCatalogo;
  console.log("---------------------------------------------------------------------------------");
  console.log(
    "TOTAL".padEnd(62) + ("$" + totalConCatalogo.toFixed(2)).padStart(11) + ("$" + totalSinCatalogo.toFixed(2)).padStart(11)
  );
  console.log(`\nCOSTO TOTAL DEL EXPERIMENTO: $${total.toFixed(2)}`);
  console.log(
    `Tokens que el catálogo agrega al bloque, sumados sobre los casos: ${ahorroBloque} ` +
      `(promedio ${Math.round(ahorroBloque / casos.length)} por caso)`
  );

  console.log(
    "\nNota: el no-cacheado se mide en el estado FINAL del caso y se aplica a todos los\n" +
      "turnos, así que el número de arriba es un techo, no un promedio. El costo real va a\n" +
      "ser menor."
  );

  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
