import { pool } from "../db";
import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
import JSZip from "jszip";
import * as fs from "fs";

const BASE_URL = "http://localhost:4000";
const sufijo = Date.now();

async function main() {
  let tenantId: string | null = null;
  const email = `verif.informe.${sufijo}@vetlineai-test.com`;
  let ok = true;
  const reportar = (nombre: string, cond: boolean, detalle?: unknown) => {
    console.log(`[${cond ? "OK" : "FALLO"}] ${nombre}`, detalle ?? "");
    if (!cond) ok = false;
  };

  try {
    // -------------------------------------------------------------
    // 1. Registro disposable — registrante médico, agente GCIS
    //    ("Medicina General / Triage").
    // -------------------------------------------------------------
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const tipoIdentificacionId = tipoId.rows[0].id;
    const agenteResult = await pool.query(`SELECT id FROM agentes WHERE nombre = 'Medicina General / Triage'`);
    const agenteId = agenteResult.rows[0].id;

    const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Informe Test ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId,
        numeroIdentificacion: `1-${sufijo}-9999`,
        nombreFiscal: `Clinica Informe Test ${sufijo}`,
        nombreTitular: "Dra. Informe Registrante",
        email,
        telefono: "88889999",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-INF-${sufijo}`,
        agenteId,
      }),
    });
    const dataReg = (await respReg.json()) as any;
    if (respReg.status !== 201) {
      reportar("Registro disposable exitoso", false, { status: respReg.status, dataReg });
      throw new Error("No se pudo registrar");
    }
    reportar("Registro disposable exitoso", true);
    let token = dataReg.access_token;

    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    const meData = (await me.json()) as any;
    tenantId = meData.auth.tenantId;
    const medicoId = meData.auth.userId;

    // -------------------------------------------------------------
    // 2. Logo de clínica (reutilizando un archivo estático ya
    //    existente en el servidor — el informe exige logo cargado) y
    //    verificación de correo (dispara el crédito de prueba).
    // -------------------------------------------------------------
    await pool.query(
      `UPDATE tenants SET logo_url = '/uploads/logos/670bee27-7b74-49a6-82c8-195447b110f9.jpeg' WHERE id = $1`,
      [tenantId]
    );

    const tokenVerifResult = await pool.query(
      `SELECT token_verificacion_correo FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true`,
      [tenantId]
    );
    const tokenVerif = tokenVerifResult.rows[0].token_verificacion_correo;
    const respVerif = await fetch(`${BASE_URL}/api/verificar-correo/${tokenVerif}/confirmar`, { method: "POST" });
    reportar("Verificación de correo (dispara crédito de prueba)", respVerif.status === 200, await respVerif.json());

    // -------------------------------------------------------------
    // 3. Propietario + paciente (con especie/raza — campos mínimos
    //    exigidos por la compuerta del informe) + caso.
    // -------------------------------------------------------------
    const respProp = await fetch(`${BASE_URL}/api/propietarios`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nombre: "Marta Jiménez", telefono: "87654321", email: "marta.test@example.com" }),
    });
    const dataProp = (await respProp.json()) as any;
    reportar("Propietario creado", respProp.status === 201, dataProp);
    const propietarioId = dataProp.propietario.id;

    const razaResult = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);
    const razaId = razaResult.rows[0].id;
    const respPac = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ propietarioId, nombre: "Bruno", especie: "Canino", razaId }),
    });
    const dataPac = (await respPac.json()) as any;
    reportar("Paciente creado", respPac.status === 201, dataPac);
    const pacienteId = dataPac.paciente.id;
    await pool.query(`UPDATE pacientes SET sexo = 'Macho castrado', edad_anios = 6 WHERE id = $1`, [pacienteId]);

    const respCaso = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        pacienteId,
        agenteId,
        motivo: "Letargo, poliuria y polidipsia de dos semanas de evolución, con pérdida de peso asociada.",
      }),
    });
    const dataCaso = (await respCaso.json()) as any;
    reportar("Caso creado", respCaso.status === 201, dataCaso);
    const casoId = dataCaso.caso.id;

    // -------------------------------------------------------------
    // 4. Dos mensajes reales al agente, con contenido clínico rico
    //    (varios hallazgos, varios estudios) para que el informe
    //    tenga suficiente sustancia narrativa como para revisar el
    //    renderizado y la coherencia de secciones.
    // -------------------------------------------------------------
    console.log("\nEnviando mensaje 1 (real, puede tardar)...");
    const respMsg1 = await fetch(`${BASE_URL}/api/workspace/casos/${casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contenido:
          "Paciente canino, Bruno, 6 años, macho castrado. Motivo de consulta: letargo, poliuria y polidipsia " +
          "de dos semanas de evolución, con pérdida de peso asociada. Al examen físico: mucosas ligeramente " +
          "pálidas, tiempo de llenado capilar 2 segundos, deshidratación leve (~5%), abdomen sin dolor a la " +
          "palpación, no se palpan masas. Temperatura 38.9°C, frecuencia cardíaca 110 lpm, frecuencia " +
          "respiratoria 24 rpm. Propietaria refiere aumento notable en el consumo de agua y en el volumen y " +
          "frecuencia urinaria en las últimas dos semanas, junto con menor apetito y una pérdida de peso " +
          "estimada de 1.5 kg. No hay antecedentes de vómito ni diarrea. Vacunas al día, sin cirugías previas.",
      }),
    });
    const dataMsg1 = (await respMsg1.json()) as any;
    reportar("Mensaje 1 procesado (respuesta real del agente)", respMsg1.status === 200, {
      status: respMsg1.status,
      resumen: typeof dataMsg1?.respuestaAsistente?.contenido === "string" ? "ok" : dataMsg1,
    });

    console.log("\nEnviando mensaje 2 (real, con resultados de laboratorio)...");
    const respMsg2 = await fetch(`${BASE_URL}/api/workspace/casos/${casoId}/mensajes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        contenido:
          "Resultados de laboratorio recibidos. Hemograma: leve leucocitosis, resto sin alteraciones " +
          "relevantes. Química sanguínea: glucosa 320 mg/dL (elevada), urea y creatinina dentro de rango, " +
          "ALT levemente elevada. Urianálisis: densidad urinaria 1.012 (baja), glucosuria positiva, sin " +
          "cetonuria, sedimento sin hallazgos relevantes. Con estos datos, ¿cuál es tu razonamiento " +
          "diagnóstico completo y tu plan de manejo sugerido para este caso?",
      }),
    });
    const dataMsg2 = (await respMsg2.json()) as any;
    reportar("Mensaje 2 procesado (respuesta real del agente)", respMsg2.status === 200, {
      status: respMsg2.status,
    });

    // -------------------------------------------------------------
    // 5. Generar el informe real y guardar el .docx para inspección.
    // -------------------------------------------------------------
    console.log("\nGenerando informe (real, puede tardar)...");
    const respInforme = await fetch(`${BASE_URL}/api/casos/${casoId}/informe/generar`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (respInforme.status !== 200) {
      const errBody = await respInforme.text();
      reportar("Informe generado (200 con binario)", false, { status: respInforme.status, errBody });
      throw new Error("No se pudo generar el informe");
    }
    reportar("Informe generado (200 con binario)", true);
    const buffer = Buffer.from(await respInforme.arrayBuffer());
    const outPath = "/tmp/informe_verificacion.docx";
    fs.writeFileSync(outPath, buffer);
    console.log(`Guardado dentro del contenedor en: ${outPath}`);

    // -------------------------------------------------------------
    // 6. Inspección del .docx: XML crudo del cuerpo + del footer.
    // -------------------------------------------------------------
    const zip = await JSZip.loadAsync(buffer);
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const footerFiles = Object.keys(zip.files).filter((f) => f.startsWith("word/footer"));
    let footerXml = "";
    for (const f of footerFiles) {
      footerXml += await zip.file(f)!.async("string");
    }

    // Todo el texto visible (dentro de <w:t>) concatenado, para buscar
    // símbolos de marcado que hayan quedado sin interpretar.
    const textosVisibles = [...documentXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");

    reportar(
      "No quedan asteriscos dobles (negrita sin renderizar) en el texto visible",
      !textosVisibles.includes("**"),
      textosVisibles.includes("**") ? textosVisibles.slice(textosVisibles.indexOf("**") - 40, textosVisibles.indexOf("**") + 40) : undefined
    );
    reportar(
      "No quedan '## ' literales (encabezado sin renderizar) en el texto visible",
      !/##\s/.test(textosVisibles),
      undefined
    );
    reportar(
      "Aparecen estilos de encabezado reales (w:pStyle Heading) en el documento",
      /w:pStyle w:val="Heading/.test(documentXml),
      undefined
    );
    reportar("El nombre de la clínica aparece como texto en la portada", textosVisibles.includes(`Clinica Informe Test ${sufijo}`), undefined);
    reportar("Aparecen los datos de identificación del paciente (Sexo)", textosVisibles.includes("Macho castrado"), undefined);
    reportar("Aparece el propietario en la portada", textosVisibles.includes("Marta Jiménez"), undefined);
    reportar(
      "El footer trae numeración de páginas (PAGE / NUMPAGES)",
      footerXml.includes("PAGE") && footerXml.includes("NUMPAGES"),
      undefined
    );
    reportar(
      "Aparece el aviso de IA no negociable",
      textosVisibles.includes("elaborado con el apoyo de un sistema de inteligencia artificial"),
      undefined
    );

    console.log("\n--- Primeros 2000 caracteres del texto visible del informe (para revisión manual) ---");
    console.log(textosVisibles.slice(0, 2000));
  } finally {
    // ---------------------------------------------------------------
    // Limpieza — usuario Keycloak (antes de borrar el tenant: el id de
    // Keycloak vive en personas, que cae en cascada) + tenant disposable.
    // ---------------------------------------------------------------
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
      // uso_api.tenant_id no tiene ON DELETE CASCADE (migración 005) — se
      // borra a mano antes del tenant, igual que en otros scripts de
      // verificación que generan uso real de la API.
      await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      console.log(`Tenant ${tenantId} eliminado.`);
    }
  }

  console.log(`\n${ok ? "PASO 6: TODO OK" : "PASO 6: HAY HALLAZGOS — ver arriba"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("ERROR INESPERADO", err);
  process.exit(1);
});
