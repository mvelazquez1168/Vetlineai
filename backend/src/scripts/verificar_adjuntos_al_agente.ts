import PDFDocument from "pdfkit";
import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { construirMensajesParaModelo } from "../archivosDelCaso";

// ---------------------------------------------------------------------
// Verificación de los tres caminos por los que un estudio clínico podía
// quedar fuera del pedido al agente sin error, sin log y sin aviso —
// el modo de falla reportado en producción (caso Sussy, VetGlobal): el
// médico adjunta, ve los archivos en el hilo, y el agente contesta que
// solo recibió el resumen de texto.
//
//   A. Adjunto registrado con "Agregar información" (mensaje
//      tipo='informacion', excluido del historial que va al modelo).
//   B. Adjunto sin texto en la caja (la vinculación estaba condicionada a
//      que existiera una fila de mensaje).
//   C. Adjunto huérfano preexistente (mensaje_id NULL) — el estado en el
//      que ya pueden estar los archivos en producción.
//
// Más dos condiciones que no deben romperse:
//   D. Un formato que el agente no puede leer (.pages) no rompe la
//      llamada y se le NOMBRA al modelo.
//   E. Un adjunto de un turno normal sigue anclado a su turno.
//
// A y B se comprueban con llamadas REALES al agente: el PDF lleva un dato
// inventado y verificable, y se exige que el agente lo cite. Que el bloque
// viaje bien formado no se puede probar mirando la base.
//
// Clínica disposable, borrada al final (tenant + usuario Keycloak). Es
// re-corrible: cada corrida usa su propio sufijo.
// ---------------------------------------------------------------------

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

// Dato inventado, imposible de adivinar sin haber leído el PDF.
const HALLAZGO = "nodulo pilorico de 7 mm con base sesil";

// El agente responde con tildes ("pilórico", "sésil"): se compara sobre
// texto normalizado sin diacríticos, no contra el literal.
const normalizar = (s: string) =>
  (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const citaElHallazgo = (respuesta: string) => {
  const t = normalizar(respuesta);
  return t.includes("pilor") || t.includes("7 mm");
};

function generarPdf(texto: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on("data", (c: Buffer) => partes.push(c));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    doc.fontSize(14).text("INFORME DE ENDOSCOPIA", { align: "center" });
    doc.moveDown().fontSize(11).text(texto);
    doc.end();
  });
}

async function main() {
  let tenantId: string | null = null;
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  try {
    // -------------------------------------------------------------
    // 0. Clínica disposable con un agente que tiene system_prompt (rama
    //    real de Claude, no el mock).
    // -------------------------------------------------------------
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const agenteResult = await pool.query(
      `SELECT id FROM agentes WHERE nombre = 'Gastroenterología' AND system_prompt IS NOT NULL`
    );
    const agenteId = agenteResult.rows[0].id;
    const email = `verif.adjuntos.${sufijo}@vetlineai-test.com`;

    const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Adjuntos Test ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId: tipoId.rows[0].id,
        numeroIdentificacion: `1-${sufijo}-7777`,
        nombreFiscal: `Clinica Adjuntos Test ${sufijo}`,
        nombreTitular: "Dra. Adjuntos Registrante",
        email,
        telefono: "88882222",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-ADJ-${sufijo}`,
        agenteId,
      }),
    });
    const dataReg = (await respReg.json()) as any;
    if (respReg.status !== 201) {
      reportar("Registro disposable exitoso", false, { status: respReg.status, dataReg });
      throw new Error("No se pudo registrar");
    }
    reportar("Registro disposable exitoso", true);
    const token = dataReg.access_token;
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    tenantId = ((await me.json()) as any).auth.tenantId;

    // El crédito de prueba del registro alcanza para uno o dos análisis;
    // esta verificación hace varios con PDF adjunto (los PDF con páginas
    // de imagen son caros en tokens de entrada). Se recarga a mano para
    // que un 402 del motor de crédito no se confunda con una falla de
    // adjuntos — que es exactamente lo que pasó en la primera corrida.
    await pool.query(
      `UPDATE saldos_ia SET credito_comprado_usd = credito_comprado_usd + 20, colchon_usado_usd = 0
        WHERE tenant_id = $1`,
      [tenantId]
    );

    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers,
      body: JSON.stringify({ nombre: "Tutor Adjuntos", telefono: "87652222", email: `tutor.adj.${sufijo}@example.com` }),
    });
    const propietarioId = ((await respProp.json()) as any).propietario.id;
    const razaResult = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);

    const crearCaso = async (nombrePaciente: string, motivo: string) => {
      const rp = await fetch(`${BASE_URL}/api/pacientes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          propietarioId,
          nombre: nombrePaciente,
          especie: "Canino",
          razaId: razaResult.rows[0].id,
          edadAnios: 5,
        }),
      });
      const pacienteId = ((await rp.json()) as any).paciente.id;
      const rc = await fetch(`${BASE_URL}/api/workspace/casos`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pacienteId, agenteId, motivo }),
      });
      const data = (await rc.json()) as any;
      if (rc.status !== 201) throw new Error(`No se pudo crear caso: ${JSON.stringify(data)}`);
      return data.caso.id as string;
    };

    // Sube por el endpoint real (multipart), igual que la interfaz.
    const subirArchivo = async (casoId: string, nombre: string, contenido: Buffer, mime: string) => {
      const form = new FormData();
      form.append("casoId", casoId);
      form.append("archivo", new Blob([new Uint8Array(contenido)], { type: mime }), nombre);
      const resp = await fetch(`${BASE_URL}/api/archivos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`No se pudo subir ${nombre}: ${JSON.stringify(data)}`);
      return data.archivo as { id: string; tipo: string; legible_por_agente: boolean };
    };

    const pdf = await generarPdf(`Hallazgo principal: ${HALLAZGO}. Resto del estudio sin particularidades.`);

    // =============================================================
    // A. Adjunto por "Agregar información" — la causa raíz reportada.
    // =============================================================
    const casoA = await crearCaso(`Sussy A ${sufijo}`, "Vomito cronico");
    const archivoA = await subirArchivo(casoA, "endoscopia.pdf", pdf, "application/pdf");
    reportar("A1: PDF subido y marcado como legible por el agente", archivoA.legible_por_agente === true, archivoA);

    const respInfo = await fetch(`${BASE_URL}/api/workspace/casos/${casoA}/informacion`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contenido: "Adjunto el informe de endoscopia.", archivoIds: [archivoA.id] }),
    });
    reportar("A2: información con adjunto registrada", respInfo.status === 201);

    const armadoA = await construirMensajesParaModelo(pool, casoA);
    const bloquesA = JSON.stringify(armadoA.mensajes);
    reportar(
      "A3: el adjunto de 'Agregar información' entra en el pedido al modelo",
      armadoA.archivosEnviados === 1 && bloquesA.includes("document"),
      { archivosEnviados: armadoA.archivosEnviados }
    );

    const respAnalisisA = await fetch(`${BASE_URL}/api/workspace/casos/${casoA}/mensajes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contenido: "Que ves en la endoscopia adjunta? Citá el hallazgo textual.", archivoIds: [] }),
    });
    const dataA = (await respAnalisisA.json()) as any;
    const textoA = dataA?.respuesta?.contenido ?? JSON.stringify(dataA);
    reportar("A4: el análisis con adjunto de información no falla", respAnalisisA.status === 201, {
      status: respAnalisisA.status,
    });
    reportar("A5: el agente LEE el PDF adjuntado por 'Agregar información'", citaElHallazgo(textoA), {
      respuesta: String(textoA).slice(0, 400),
    });

    // =============================================================
    // B. Adjuntar sin escribir nada en la caja.
    // =============================================================
    const casoB = await crearCaso(`Sussy B ${sufijo}`, "Control post endoscopia");
    const archivoB = await subirArchivo(casoB, "endoscopia_b.pdf", pdf, "application/pdf");

    const respAnalisisB = await fetch(`${BASE_URL}/api/workspace/casos/${casoB}/mensajes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contenido: "", archivoIds: [archivoB.id] }),
    });
    const dataB = (await respAnalisisB.json()) as any;
    reportar("B1: analizar solo con adjuntos, sin texto, es aceptado", respAnalisisB.status === 201, {
      status: respAnalisisB.status,
      error: dataB?.error,
    });

    const vinculoB = await pool.query(`SELECT mensaje_id FROM archivos WHERE id = $1`, [archivoB.id]);
    reportar("B2: el adjunto quedó vinculado aunque no hubiera texto", vinculoB.rows[0]?.mensaje_id !== null, {
      mensaje_id: vinculoB.rows[0]?.mensaje_id,
    });
    // Sin pregunta, el agente responde pidiendo contexto en vez de citar
    // el hallazgo — que reciba el archivo no obliga a que lo comente. Se
    // le pregunta en un segundo turno: si el PDF llegó en el turno
    // anterior, tiene que poder citarlo.
    const respAnalisisB2 = await fetch(`${BASE_URL}/api/workspace/casos/${casoB}/mensajes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contenido: "Citá textualmente el hallazgo del PDF que te adjunté.", archivoIds: [] }),
    });
    const dataB2 = (await respAnalisisB2.json()) as any;
    reportar(
      "B3: el agente LEE el PDF que se envió sin escribir texto",
      citaElHallazgo(dataB2?.respuesta?.contenido ?? ""),
      { respuesta: String(dataB2?.respuesta?.contenido ?? "").slice(0, 400) }
    );

    // =============================================================
    // C. Adjunto huérfano preexistente (mensaje_id NULL a mano, que es el
    //    estado en el que pueden estar los archivos ya subidos en prod).
    // =============================================================
    const casoC = await crearCaso(`Sussy C ${sufijo}`, "Huerfano");
    const archivoC = await subirArchivo(casoC, "endoscopia_c.pdf", pdf, "application/pdf");
    await pool.query(`UPDATE archivos SET mensaje_id = NULL WHERE id = $1`, [archivoC.id]);
    const armadoC = await construirMensajesParaModelo(pool, casoC);
    reportar(
      "C1: un adjunto huérfano (mensaje_id NULL) igual llega al modelo",
      armadoC.archivosEnviados === 1 && JSON.stringify(armadoC.mensajes).includes("document"),
      { archivosEnviados: armadoC.archivosEnviados }
    );

    // =============================================================
    // D. Formato que el agente no puede leer.
    // =============================================================
    const casoD = await crearCaso(`Sussy D ${sufijo}`, "Formato no soportado");
    const archivoD = await subirArchivo(
      casoD,
      "informe.pages",
      Buffer.from("contenido binario simulado de un .pages"),
      "application/octet-stream"
    );
    reportar("D1: la subida avisa que el agente no va a poder leer el .pages", archivoD.legible_por_agente === false, archivoD);
    const filaD = await pool.query(`SELECT tipo, file_id_anthropic FROM archivos WHERE id = $1`, [archivoD.id]);
    reportar(
      "D2: no se le carga un file_id que después no se puede usar",
      filaD.rows[0].tipo === "otro" && filaD.rows[0].file_id_anthropic === null,
      filaD.rows[0]
    );
    const armadoD = await construirMensajesParaModelo(pool, casoD);
    const textoD = JSON.stringify(armadoD.mensajes);
    reportar(
      "D3: el .pages no viaja como bloque pero SÍ se le nombra al modelo",
      armadoD.archivosEnviados === 0 &&
        armadoD.archivosNoLegibles.length === 1 &&
        textoD.includes("informe.pages") &&
        !textoD.includes('"document"'),
      { archivosNoLegibles: armadoD.archivosNoLegibles }
    );

    // =============================================================
    // E. No regresión: adjunto de un turno normal sigue en su turno.
    // =============================================================
    const casoE = await crearCaso(`Sussy E ${sufijo}`, "Turno normal");
    const archivoE = await subirArchivo(casoE, "endoscopia_e.pdf", pdf, "application/pdf");
    const respE = await fetch(`${BASE_URL}/api/workspace/casos/${casoE}/mensajes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ contenido: "Revisá este estudio.", archivoIds: [archivoE.id] }),
    });
    const dataE = (await respE.json()) as any;
    reportar("E1: mensaje con texto + adjunto sigue funcionando", respE.status === 201, {
      status: respE.status,
      error: dataE?.error,
    });
    const armadoE = await construirMensajesParaModelo(pool, casoE);
    const primerTurno = armadoE.mensajes[0];
    reportar(
      "E2: el adjunto viaja DENTRO del turno del médico, no en el de cierre",
      primerTurno !== undefined &&
        Array.isArray(primerTurno.content) &&
        primerTurno.content.some((b: any) => b.type === "document") &&
        (primerTurno.content[0] as any).text === "Revisá este estudio.",
      { primerTurno: JSON.stringify(primerTurno ?? null).slice(0, 300) }
    );
  } finally {
    if (tenantId) {
      const personaKc = await pool.query(
        `SELECT keycloak_user_id FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true`,
        [tenantId]
      );
      const keycloakUserId = personaKc.rows[0]?.keycloak_user_id;
      if (keycloakUserId) {
        await eliminarUsuarioKeycloak(keycloakUserId);
        console.log(`Usuario Keycloak ${keycloakUserId} eliminado.`);
      }
      await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
      // Los casos primero: mensajes.autor_persona_id (migración 066) apunta
      // a personas sin ON DELETE, así que borrar el tenant con mensajes
      // vivos choca contra esa FK antes de llegar a cascadear.
      await pool.query(`DELETE FROM casos WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      console.log(`Tenant ${tenantId} eliminado.`);
    }
  }

  console.log(`\n${ok ? "TODO OK" : "HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
