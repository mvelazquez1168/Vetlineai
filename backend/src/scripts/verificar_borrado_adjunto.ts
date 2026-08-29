import PDFDocument from "pdfkit";
import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
import { requerirAnthropic } from "../anthropic";
import { almacenamientoPrivado } from "../almacenamiento";
import { construirMensajesParaModelo } from "../archivosDelCaso";

// ---------------------------------------------------------------------
// Verificación del borrado de adjuntos (DELETE /api/archivos/:id) con las
// dos reglas definidas por el usuario: solo quien lo subió, y nunca en un
// caso cerrado. Más el aislamiento entre clínicas y el efecto real del
// borrado (fila, objeto guardado, copia del proveedor, y que deje de
// llegarle al agente).
//
// Dos clínicas disposables, borradas al final. Re-corrible.
//
// El "otro médico" de la regla 1 se simula cambiando en la base quién
// figura como autor del archivo: la regla que el backend aplica es
// exactamente esa comparación, así que probarla así verifica la regla sin
// tener que montar el flujo de invitación de un segundo médico.
// ---------------------------------------------------------------------

const BASE_URL = "http://localhost:4000";

function generarPdf(texto: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const partes: Buffer[] = [];
    doc.on("data", (c: Buffer) => partes.push(c));
    doc.on("end", () => resolve(Buffer.concat(partes)));
    doc.on("error", reject);
    doc.fontSize(12).text(texto);
    doc.end();
  });
}

async function main() {
  const tenants: string[] = [];
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  try {
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const agente = await pool.query(
      `SELECT id FROM agentes WHERE nombre = 'Gastroenterología' AND system_prompt IS NOT NULL`
    );
    const agenteId = agente.rows[0].id;
    const raza = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);

    const crearClinica = async (etiqueta: string) => {
      const sufijo = `${Date.now()}${Math.floor(process.hrtime()[1] / 1000)}`;
      const resp = await fetch(`${BASE_URL}/api/registro-publico`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paisCodigo: "CR",
          nombreComercial: `Clinica Borrado ${etiqueta} ${sufijo}`,
          tipoPersona: "fisica",
          tipoIdentificacionId: tipoId.rows[0].id,
          numeroIdentificacion: `1-${sufijo}-5555`,
          nombreFiscal: `Clinica Borrado ${etiqueta} ${sufijo}`,
          nombreTitular: `Dra. Borrado ${etiqueta}`,
          email: `borrado.${etiqueta}.${sufijo}@vetlineai-test.com`,
          telefono: "88884444",
          password: "ClaveTest123!",
          esMedico: true,
          colegiatura: `COL-BOR-${sufijo}`,
          agenteId,
        }),
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`Registro ${etiqueta} falló: ${JSON.stringify(data)}`);
      const token = data.access_token;
      const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
      const auth = ((await me.json()) as any).auth;
      tenants.push(auth.tenantId);
      return { token, tenantId: auth.tenantId, userId: auth.userId };
    };

    const crearCaso = async (token: string, nombre: string) => {
      const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
      const rp = await fetch(`${BASE_URL}/api/propietarios`, {
        method: "POST",
        headers,
        body: JSON.stringify({ nombre: `Tutor ${nombre}`, telefono: "87654444" }),
      });
      const propietarioId = ((await rp.json()) as any).propietario.id;
      const rpac = await fetch(`${BASE_URL}/api/pacientes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ propietarioId, nombre, especie: "Canino", razaId: raza.rows[0].id, edadAnios: 4 }),
      });
      const pacienteId = ((await rpac.json()) as any).paciente.id;
      const rc = await fetch(`${BASE_URL}/api/workspace/casos`, {
        method: "POST",
        headers,
        body: JSON.stringify({ pacienteId, agenteId, motivo: "Caso para probar borrado de adjuntos" }),
      });
      return ((await rc.json()) as any).caso.id as string;
    };

    const subir = async (token: string, casoId: string, nombre: string) => {
      const pdf = await generarPdf("Estudio de prueba para borrado.");
      const form = new FormData();
      form.append("casoId", casoId);
      form.append("archivo", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), nombre);
      const resp = await fetch(`${BASE_URL}/api/archivos`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      const data = (await resp.json()) as any;
      if (resp.status !== 201) throw new Error(`Subida falló: ${JSON.stringify(data)}`);
      return data.archivo as { id: string };
    };

    const borrar = (token: string, archivoId: string) =>
      fetch(`${BASE_URL}/api/archivos/${archivoId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

    const clinicaA = await crearClinica("A");
    const clinicaB = await crearClinica("B");

    // =============================================================
    // 1. Quien lo subió sí puede borrarlo, y el borrado es real.
    // =============================================================
    const casoA = await crearCaso(clinicaA.token, "Sussy");
    const archivo1 = await subir(clinicaA.token, casoA, "estudio_uno.pdf");

    const filaAntes = await pool.query(
      `SELECT url, file_id_anthropic, subido_por_persona_id FROM archivos WHERE id = $1`,
      [archivo1.id]
    );
    reportar(
      "1a: la subida registra quién subió el archivo",
      filaAntes.rows[0].subido_por_persona_id === clinicaA.userId,
      { subido_por: filaAntes.rows[0].subido_por_persona_id }
    );
    const claveObjeto = String(filaAntes.rows[0].url).replace(/^\/uploads\//, "");
    const fileIdProveedor = filaAntes.rows[0].file_id_anthropic;

    const antesDelBorrado = await construirMensajesParaModelo(pool, casoA);
    reportar("1b: antes de borrar, el adjunto le llega al agente", antesDelBorrado.archivosEnviados === 1);

    const respBorrado = await borrar(clinicaA.token, archivo1.id);
    reportar("1c: quien lo subió lo puede borrar", respBorrado.status === 204, { status: respBorrado.status });

    // Se consulta con reintentos cortos, no una sola vez: withTenantClient
    // hace el COMMIT DESPUÉS de mandar la respuesta, así que un cliente que
    // recibe el 204 y consulta la base en el mismo instante todavía puede
    // ver la fila. No es propio del borrado —afecta a todo el backend, ya
    // estaba anotado como hallazgo sistémico sin corregir— y acá no tiene
    // impacto en la interfaz porque el chip se saca en memoria en vez de
    // recargar el caso. Pero cualquier verificación que consulte la base
    // inmediatamente después de un 2xx va a pegarle a esta carrera.
    let filaBorrada = false;
    for (let intento = 0; intento < 20 && !filaBorrada; intento++) {
      const r = await pool.query(`SELECT id FROM archivos WHERE id = $1`, [archivo1.id]);
      filaBorrada = r.rows.length === 0;
      if (!filaBorrada) await new Promise((res) => setTimeout(res, 100));
    }
    reportar("1d: la fila ya no existe", filaBorrada);

    const despuesDelBorrado = await construirMensajesParaModelo(pool, casoA);
    reportar(
      "1e: deja de llegarle al agente",
      despuesDelBorrado.archivosEnviados === 0 && despuesDelBorrado.archivosNoLegibles.length === 0
    );

    // El objeto y la copia del proveedor se borran en segundo plano: se
    // le da un margen antes de comprobar.
    await new Promise((r) => setTimeout(r, 1500));
    let objetoSigue = true;
    try {
      await almacenamientoPrivado.leer(claveObjeto);
    } catch {
      objetoSigue = false;
    }
    reportar("1f: el archivo guardado se borró del almacenamiento", objetoSigue === false);

    let proveedorSigue = true;
    try {
      await requerirAnthropic().beta.files.retrieveMetadata(fileIdProveedor, {
        betas: ["files-api-2025-04-14"],
      });
    } catch {
      proveedorSigue = false;
    }
    reportar("1g: la copia en la Files API del proveedor se borró", proveedorSigue === false);

    const auditoria = await pool.query(
      `SELECT accion, entidad, detalle FROM bitacora_auditoria
        WHERE entidad = 'archivo' AND entidad_id = $1 ORDER BY creado_en DESC LIMIT 1`,
      [archivo1.id]
    );
    reportar(
      "1h: queda auditado con el nombre del archivo",
      auditoria.rows.length === 1 && auditoria.rows[0].detalle?.nombre_archivo === "estudio_uno.pdf",
      auditoria.rows[0]
    );

    // =============================================================
    // 2. Otro médico (autor distinto) no puede borrarlo.
    // =============================================================
    const archivo2 = await subir(clinicaA.token, casoA, "estudio_dos.pdf");
    await pool.query(`UPDATE archivos SET subido_por_persona_id = $1 WHERE id = $2`, [
      clinicaB.userId,
      archivo2.id,
    ]);
    const respAjeno = await borrar(clinicaA.token, archivo2.id);
    const cuerpoAjeno = (await respAjeno.json().catch(() => null)) as any;
    reportar("2: un médico que no lo subió recibe 403", respAjeno.status === 403, {
      status: respAjeno.status,
      error: cuerpoAjeno?.error,
    });

    // =============================================================
    // 3. Aislamiento: otra clínica ni siquiera confirma que existe.
    // =============================================================
    const respOtraClinica = await borrar(clinicaB.token, archivo2.id);
    reportar("3: otra clínica recibe 404, no 403", respOtraClinica.status === 404, {
      status: respOtraClinica.status,
    });

    // =============================================================
    // 4. Caso cerrado: no tiene sentido, 409.
    // =============================================================
    await pool.query(`UPDATE archivos SET subido_por_persona_id = $1 WHERE id = $2`, [
      clinicaA.userId,
      archivo2.id,
    ]);
    await pool.query(`UPDATE casos SET estado = 'completado' WHERE id = $1`, [casoA]);
    const respCerrado = await borrar(clinicaA.token, archivo2.id);
    const cuerpoCerrado = (await respCerrado.json().catch(() => null)) as any;
    reportar("4: en un caso cerrado devuelve 409", respCerrado.status === 409, {
      status: respCerrado.status,
      error: cuerpoCerrado?.error,
    });
    const sigueExistiendo = await pool.query(`SELECT id FROM archivos WHERE id = $1`, [archivo2.id]);
    reportar("4b: y el archivo sigue en el caso cerrado", sigueExistiendo.rows.length === 1);
  } finally {
    for (const tenantId of tenants) {
      const personaKc = await pool.query(
        `SELECT keycloak_user_id FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true`,
        [tenantId]
      );
      const keycloakUserId = personaKc.rows[0]?.keycloak_user_id;
      if (keycloakUserId) await eliminarUsuarioKeycloak(keycloakUserId);
      await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM casos WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    console.log(`${tenants.length} clínica(s) de prueba eliminadas.`);
  }

  console.log(`\n${ok ? "TODO OK" : "HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
