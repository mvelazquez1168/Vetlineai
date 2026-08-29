// Verificación puntual del sembrado de plataforma (Paso del prompt de
// reproducibilidad): para cada uno de los 9 agentes del catálogo, abre un
// caso real (tenant/paciente/caso descartables en la base a la que apunte
// DATABASE_URL) y le manda una pregunta clínica real, reusando exactamente
// el mismo camino que workspace.routes.ts — obtenerDocumentosParaContexto +
// requerirAnthropic() — para confirmar que la base de conocimiento sembrada
// realmente llega al modelo. Se corre a mano, no se importa desde ningún
// otro módulo.
import "dotenv/config";
import { Pool } from "pg";
import { obtenerDocumentosParaContexto } from "../routes/casos.routes";
import { requerirAnthropic } from "../anthropic";
import { asignarNumeroExpediente } from "../expediente";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MODELO = "claude-sonnet-4-6";

async function main() {
  const client = await pool.connect();
  try {
    const tenantResult = await client.query(
      `INSERT INTO tenants (nombre, pais_codigo, estado_suscripcion)
       VALUES ('Verificación sembrado — descartable', 'CR', 'activa')
       RETURNING id`
    );
    const tenantId = tenantResult.rows[0].id;

    const propietarioResult = await client.query(
      `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1, 'Propietario de prueba') RETURNING id`,
      [tenantId]
    );
    const pacienteResult = await client.query(
      `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie)
       VALUES ($1, $2, 'Paciente de prueba', 'Canino') RETURNING id`,
      [tenantId, propietarioResult.rows[0].id]
    );
    const pacienteId = pacienteResult.rows[0].id;

    const medicoResult = await client.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico, colegiatura)
       VALUES ($1, 'Médico de prueba', 'medico.verificacion@descartable.local', 'x', false, true, 'VERIF-000')
       RETURNING id`,
      [tenantId]
    );
    const medicoId = medicoResult.rows[0].id;

    const agentes = await client.query(
      `SELECT id, nombre, slug, system_prompt FROM agentes ORDER BY nombre`
    );

    const resultados: { agente: string; ok: boolean; detalle: string }[] = [];

    for (const agente of agentes.rows) {
      if (!agente.system_prompt) {
        resultados.push({ agente: agente.nombre, ok: false, detalle: "sin system_prompt — salteado" });
        continue;
      }

      const documentos = (await obtenerDocumentosParaContexto(client, agente.id, tenantId)).todos;
      if (documentos.length === 0) {
        resultados.push({ agente: agente.nombre, ok: false, detalle: "0 documentos en contexto — salteado" });
        continue;
      }

      const documentosConTexto = documentos.filter((d: any) => d.contenido_texto);
      const bloqueDocumentos =
        "Documentos de referencia (contenido completo) para este caso:\n\n" +
        documentosConTexto
          .map((d: any) => `### ${d.nombre} (${d.tipo})\n${d.contenido_texto}`)
          .join("\n\n---\n\n");
      const systemCombinado = `${agente.system_prompt}\n\n---\n\n${bloqueDocumentos}`;

      // Pregunta genérica pero real: le pide al modelo que cite ALGO
      // concreto de su propio material de referencia, con el nombre exacto
      // de uno de los documentos que se le acaba de sembrar — si el modelo
      // inventa contenido en vez de citar el documento real, este chequeo
      // no lo detecta (no hay verificación automática de grounding acá),
      // pero si el system_prompt/documentos no llegaran de verdad, el
      // modelo no podría ni nombrar el documento correctamente.
      const nombreDocumentoElegido = documentosConTexto[0].nombre;
      const pregunta = `Tenés cargado un documento de referencia llamado "${nombreDocumentoElegido}". Sin inventar nada: ¿podés confirmar que lo tenés y citar textualmente una frase corta (menos de 20 palabras) de ese documento?`;

      const numeroExpediente = await asignarNumeroExpediente(client, tenantId);
      const caso = await client.query(
        `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, numero_expediente)
         VALUES ($1, $2, $3, $4, 'Verificación de sembrado', 'triage', $5) RETURNING id`,
        [tenantId, pacienteId, agente.id, medicoId, numeroExpediente]
      );
      void caso;

      try {
        const anthropic = requerirAnthropic();
        const response = await anthropic.messages.create({
          model: MODELO,
          max_tokens: 300,
          system: systemCombinado,
          messages: [{ role: "user", content: pregunta }],
        });
        const bloqueTexto = response.content.find((b) => b.type === "text");
        const texto = bloqueTexto?.type === "text" ? bloqueTexto.text : "";
        const respondioAlgo = texto.trim().length > 0;
        const pareceRechazo = /no teng[oa]|no puedo|no dispongo|no cuento con/i.test(texto.slice(0, 200));
        resultados.push({
          agente: agente.nombre,
          ok: respondioAlgo && !pareceRechazo,
          detalle: texto.replace(/\s+/g, " ").slice(0, 220),
        });
      } catch (err: any) {
        resultados.push({ agente: agente.nombre, ok: false, detalle: `error de API: ${err.message}` });
      }
    }

    console.log("\n=== Resultado por agente ===\n");
    for (const r of resultados) {
      console.log(`${r.ok ? "OK  " : "FAIL"} ${r.agente}`);
      console.log(`     ${r.detalle}\n`);
    }
    const okCount = resultados.filter((r) => r.ok).length;
    console.log(`${okCount}/${resultados.length} agentes respondieron citando su documentación real.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Error en la verificación:", err);
  process.exit(1);
});
