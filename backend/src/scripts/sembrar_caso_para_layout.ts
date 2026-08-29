import { pool } from "../db";

// ---------------------------------------------------------------------
// Siembra una clínica disposable con un caso cargado (mensajes, informes
// anteriores, adjuntos) para poder MEDIR el layout del área de trabajo en
// una pantalla de portátil. No borra nada al final a propósito: la
// verificación es visual y se hace después, en el navegador. Para
// limpiarla, correr este mismo script con `--limpiar <tenantId>`.
//
// La contraseña es de un usuario creado por el script — nunca se usan
// credenciales de un usuario real para probar.
// ---------------------------------------------------------------------

const BASE_URL = "http://localhost:4000";
const PASSWORD = "ClaveLayout123!";

async function limpiar(tenantId: string) {
  const personaKc = await pool.query(
    `SELECT keycloak_user_id FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true`,
    [tenantId]
  );
  const keycloakUserId = personaKc.rows[0]?.keycloak_user_id;
  if (keycloakUserId) {
    const { eliminarUsuarioKeycloak } = await import("../keycloakAdmin");
    await eliminarUsuarioKeycloak(keycloakUserId);
  }
  await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM casos WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  console.log(`Tenant ${tenantId} y su usuario eliminados.`);
}

async function main() {
  if (process.argv[2] === "--limpiar") {
    await limpiar(process.argv[3]);
    process.exit(0);
  }

  const sufijo = Date.now();
  const email = `layout.${sufijo}@vetlineai-test.com`;

  const tipoId = await pool.query(
    `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
  );
  const agente = await pool.query(
    `SELECT id FROM agentes WHERE nombre = 'Gastroenterología' AND system_prompt IS NOT NULL`
  );
  const agenteId = agente.rows[0].id;

  const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paisCodigo: "CR",
      nombreComercial: `Clinica Layout ${sufijo}`,
      tipoPersona: "fisica",
      tipoIdentificacionId: tipoId.rows[0].id,
      numeroIdentificacion: `1-${sufijo}-6666`,
      nombreFiscal: `Clinica Layout ${sufijo}`,
      nombreTitular: "Dra. Layout",
      email,
      telefono: "88883333",
      password: PASSWORD,
      esMedico: true,
      colegiatura: `COL-LAY-${sufijo}`,
      agenteId,
    }),
  });
  const dataReg = (await respReg.json()) as any;
  if (respReg.status !== 201) throw new Error(`Registro falló: ${JSON.stringify(dataReg)}`);
  const token = dataReg.access_token;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

  const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const tenantId = ((await me.json()) as any).auth.tenantId;

  const rp = await fetch(`${BASE_URL}/api/propietarios`, {
    method: "POST",
    headers,
    body: JSON.stringify({ nombre: "Tutor Layout", telefono: "87653333", email: `tutor.lay.${sufijo}@example.com` }),
  });
  const propietarioId = ((await rp.json()) as any).propietario.id;
  const raza = await pool.query(`SELECT id FROM razas WHERE especie = 'canina' LIMIT 1`);

  // Varios casos: la columna izquierda tiene que verse con contenido real
  // (nombres largos y motivos de dos líneas, que es lo que la aprieta).
  const pacientes = [
    ["Sussy", "Vomito cronico intermitente de tres semanas, con perdida de peso progresiva"],
    ["Bartolomeo", "Diarrea con moco y sangre fresca, tenesmo, sin fiebre"],
    ["Nina", "Control post endoscopia — seguimiento de nodulo pilorico"],
    ["Kiwi", "Anorexia de cinco dias y distension abdominal"],
  ];

  let primerCasoId = "";
  for (const [nombre, motivo] of pacientes) {
    const rpac = await fetch(`${BASE_URL}/api/pacientes`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        propietarioId,
        nombre,
        especie: "Canino",
        razaId: raza.rows[0].id,
        edadAnios: 5,
      }),
    });
    const pacienteId = ((await rpac.json()) as any).paciente.id;
    const rc = await fetch(`${BASE_URL}/api/workspace/casos`, {
      method: "POST",
      headers,
      body: JSON.stringify({ pacienteId, agenteId, motivo }),
    });
    const casoId = ((await rc.json()) as any).caso.id;
    if (!primerCasoId) primerCasoId = casoId;
  }

  // Mensajes largos en el caso abierto, sin llamar al modelo: se insertan
  // directo para que el hilo tenga altura real que leer (que es lo que se
  // quiere medir) sin gastar credito ni depender de la latencia del agente.
  const textoMedico =
    "Paciente con vomito posprandial tardio de tres semanas. Perdio 1.8 kg. " +
    "Apetito conservado. Sin acceso a cuerpos extraños conocido.";
  const textoAgente =
    "Con vomito posprandial tardio y perdida de peso conservando apetito, el eje del razonamiento es " +
    "obstruccion parcial de vaciamiento gastrico frente a enteropatia cronica.\n\n" +
    "**Diferenciales principales**\n\n" +
    "1. Obstruccion parcial de salida gastrica (cuerpo extraño, hipertrofia pilorica, neoplasia)\n" +
    "2. Enteropatia cronica inflamatoria\n" +
    "3. Trastorno de motilidad secundario\n\n" +
    "**Lo que cambia la conducta ahora**\n\n" +
    "El vaciamiento gastrico tardio con apetito conservado orienta fuerte a obstruccion parcial. " +
    "Antes de escalar a endoscopia conviene descartar lo barato: perfil bioquimico completo, " +
    "radiografia simple y ecografia abdominal con foco en pared gastrica y region pilorica.\n\n" +
    "Si la ecografia muestra engrosamiento de la pared pilorica o retencion de contenido a las 8 horas, " +
    "la endoscopia con biopsia pasa a ser el paso siguiente, no una opcion mas.";

  for (let i = 0; i < 3; i++) {
    await pool.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, tipo) VALUES ($1, 'medico', $2, 'consulta')`,
      [primerCasoId, textoMedico]
    );
    await pool.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido, tipo) VALUES ($1, 'ai', $2, 'respuesta')`,
      [primerCasoId, textoAgente]
    );
  }

  console.log(
    JSON.stringify(
      {
        tenantId,
        email,
        password: PASSWORD,
        agenteId,
        casoId: primerCasoId,
        url: `http://localhost:5174/workspace/agentes/${agenteId}/casos/${primerCasoId}`,
        limpiar: `npx ts-node --transpile-only src/scripts/sembrar_caso_para_layout.ts --limpiar ${tenantId}`,
      },
      null,
      2
    )
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR", err);
  process.exit(1);
});
