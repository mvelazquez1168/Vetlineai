import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// CONSENTIMIENTOS DIGITALES — sección 8 del prompt 07.
//
// La plantilla es de la clínica y tiene marcadores; el consentimiento
// firmado guarda el TEXTO YA RESUELTO, con los datos del paciente y del
// cliente puestos, y la firma dibujada.
//
// POR QUÉ SE CONGELA EL TEXTO: es el documento que la clínica muestra si
// alguien reclama. Si guardara solo `plantilla_id`, corregir una coma en
// la plantilla cambiaría retroactivamente lo que veinte clientes
// firmaron. La base además lo impone con un trigger: un consentimiento
// firmado no se edita ni se borra.
//
// LOS MARCADORES son los de la plantilla: {{paciente}}, {{especie}},
// {{raza}}, {{cliente}}, {{identificacion}}, {{fecha}}, {{clinica}},
// {{medico}}, {{procedimiento}}. Se resuelven ACÁ y no en la pantalla:
// el PDF, la vista previa y lo guardado tienen que decir lo mismo.
// ---------------------------------------------------------------------

export interface PlantillaConsentimiento {
  id: string;
  tipo: string;
  titulo: string;
  cuerpo: string;
  activo: boolean;
}

export async function plantillas(
  db: PoolClient,
  tenantId: string
): Promise<PlantillaConsentimiento[]> {
  const r = await db.query<PlantillaConsentimiento>(
    `SELECT id, tipo, titulo, cuerpo, activo FROM exp_plantillas_consentimiento
      WHERE tenant_id = $1 ORDER BY activo DESC, tipo, titulo`,
    [tenantId]
  );
  return r.rows;
}

export async function guardarPlantilla(
  db: PoolClient,
  tenantId: string,
  datos: { id?: string; tipo: string; titulo: string; cuerpo: string; activo?: boolean }
): Promise<{ id: string }> {
  if (!datos.titulo?.trim() || !datos.cuerpo?.trim()) {
    throw new Error("Una plantilla necesita su título y su texto.");
  }
  if (datos.id) {
    const r = await db.query<{ id: string }>(
      `UPDATE exp_plantillas_consentimiento
          SET tipo = $3, titulo = $4, cuerpo = $5, activo = COALESCE($6, activo)
        WHERE id = $1 AND tenant_id = $2 RETURNING id`,
      [datos.id, tenantId, datos.tipo, datos.titulo.trim(), datos.cuerpo, datos.activo ?? null]
    );
    if (r.rows.length === 0) throw new Error("Esa plantilla no existe.");
    return { id: r.rows[0].id };
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_plantillas_consentimiento (tenant_id, tipo, titulo, cuerpo)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [tenantId, datos.tipo, datos.titulo.trim(), datos.cuerpo]
  );
  return { id: r.rows[0].id };
}

interface DatosParaResolver {
  paciente: string;
  especie: string;
  raza: string;
  cliente: string;
  identificacion: string;
  clinica: string;
  medico: string;
  procedimiento: string;
}

/** Reemplaza los marcadores. Lo que no se conoce queda señalado. */
export function resolverMarcadores(cuerpo: string, datos: Partial<DatosParaResolver>): string {
  return cuerpo.replace(/\{\{(\w+)\}\}/g, (_todo, clave: string) => {
    const valor = (datos as Record<string, string | undefined>)[clave];
    // Un marcador sin dato NO se borra en silencio: se deja visible
    // para que quien lo lea antes de firmar note que falta algo.
    return valor && valor.trim() !== "" ? valor : `[${clave} no registrado]`;
  });
}

/**
 * Arma el texto del consentimiento con los datos del paciente, su
 * cliente y la clínica. Es lo que se muestra antes de firmar y lo que
 * se congela al firmar: una sola fuente.
 */
export async function prepararConsentimiento(
  db: PoolClient,
  tenantId: string,
  datos: { plantillaId: string; pacienteId: string; procedimiento?: string; medicoId?: string }
): Promise<{ titulo: string; texto: string; firmanteSugerido: string; identificacion: string | null }> {
  const pl = await db.query<{ titulo: string; cuerpo: string }>(
    `SELECT titulo, cuerpo FROM exp_plantillas_consentimiento WHERE id = $1 AND tenant_id = $2`,
    [datos.plantillaId, tenantId]
  );
  if (pl.rows.length === 0) throw new Error("Esa plantilla no existe.");

  const p = await db.query<{
    paciente: string;
    especie: string;
    raza: string | null;
    cliente: string | null;
    identificacion: string | null;
  }>(
    `SELECT pa.nombre AS paciente, pa.especie, pa.raza,
            pr.nombre AS cliente, pr.numero_identificacion AS identificacion
       FROM pacientes pa
       LEFT JOIN propietarios pr ON pr.id = pa.propietario_id
      WHERE pa.id = $1`,
    [datos.pacienteId]
  );
  if (p.rows.length === 0) throw new Error("Ese paciente no existe.");

  const t = await db.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  const medico = datos.medicoId
    ? await db.query<{ nombre: string }>(`SELECT nombre FROM personas WHERE id = $1`, [
        datos.medicoId,
      ])
    : null;

  const f = p.rows[0];
  const texto = resolverMarcadores(pl.rows[0].cuerpo, {
    paciente: f.paciente,
    especie: f.especie,
    raza: f.raza ?? "",
    cliente: f.cliente ?? "",
    identificacion: f.identificacion ?? "",
    clinica: t.rows[0]?.nombre ?? "",
    medico: medico?.rows[0]?.nombre ?? "",
    procedimiento: datos.procedimiento ?? "",
    // La fecha se resuelve al firmar, no al preparar: preparar y firmar
    // pueden caer en días distintos.
  });

  return {
    titulo: pl.rows[0].titulo,
    texto,
    firmanteSugerido: f.cliente ?? "",
    identificacion: f.identificacion,
  };
}

/**
 * Firma el consentimiento.
 *
 * `firmaPng` es el trazo dibujado en pantalla, en base64. Se exige: un
 * consentimiento sin firma no es un consentimiento, y aceptarlo vacío
 * dejaría un documento que parece firmado y no lo está.
 */
export async function firmarConsentimiento(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    plantillaId?: string;
    atencionId?: string;
    titulo: string;
    texto: string;
    firmanteNombre: string;
    firmanteIdentificacion?: string;
    firmaPng: string;
    testigoId?: string;
  }
): Promise<{ id: string }> {
  if (!datos.firmaPng?.startsWith("data:image/")) {
    throw new Error(
      "Falta la firma: un consentimiento sin el trazo del cliente no respalda nada. Pedile que firme en pantalla."
    );
  }
  if (!datos.firmanteNombre?.trim()) {
    throw new Error("Falta el nombre de quien firma.");
  }
  if (!datos.texto?.trim()) throw new Error("Falta el texto del consentimiento.");

  const fecha = new Date().toLocaleDateString("es-CR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_consentimientos (tenant_id, paciente_id, atencion_id, plantilla_id, titulo,
                                      texto, firmante_nombre, firmante_identificacion, firma_png,
                                      testigo_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.atencionId ?? null,
      datos.plantillaId ?? null,
      datos.titulo.trim(),
      resolverMarcadores(datos.texto, { fecha } as never),
      datos.firmanteNombre.trim(),
      datos.firmanteIdentificacion?.trim() || null,
      datos.firmaPng,
      datos.testigoId ?? null,
    ]
  );
  return { id: r.rows[0].id };
}

export async function consentimientosDePaciente(db: PoolClient, pacienteId: string) {
  const r = await db.query(
    `SELECT c.id, c.titulo, c.firmante_nombre, c.firmante_identificacion, c.firmado_en,
            c.atencion_id, c.pdf_archivo_id, per.nombre AS testigo
       FROM exp_consentimientos c
       LEFT JOIN personas per ON per.id = c.testigo_id
      WHERE c.paciente_id = $1
      ORDER BY c.firmado_en DESC`,
    [pacienteId]
  );
  return r.rows;
}

export async function consentimiento(db: PoolClient, id: string) {
  const r = await db.query(
    `SELECT c.*, pa.nombre AS paciente, pa.especie, pa.raza
       FROM exp_consentimientos c
       JOIN pacientes pa ON pa.id = c.paciente_id
      WHERE c.id = $1`,
    [id]
  );
  if (r.rows.length === 0) throw new Error("Ese consentimiento no existe.");
  return r.rows[0];
}

/**
 * Las cuatro plantillas con las que una clínica arranca.
 *
 * Se siembran una sola vez por clínica y después son suyas: el texto es
 * un punto de partida razonable, no un modelo legal. Lo dice la propia
 * plantilla en su último párrafo.
 */
export async function sembrarPlantillasBase(
  db: PoolClient,
  tenantId: string
): Promise<{ creadas: number }> {
  const base = [
    {
      tipo: "anestesia",
      titulo: "Consentimiento informado para anestesia",
      cuerpo: `Yo, {{cliente}}, identificación {{identificacion}}, en calidad de responsable de {{paciente}} ({{especie}}, raza {{raza}}), autorizo a {{clinica}} a realizar el procedimiento anestésico necesario para {{procedimiento}}.

Declaro que se me explicó que todo procedimiento anestésico implica riesgos, incluso en pacientes sanos y con los controles adecuados, y que esos riesgos aumentan con la edad, el sobrepeso y las enfermedades previas. Se me informó sobre los estudios previos recomendados y acepto la decisión del médico tratante.

Informé con veracidad los antecedentes de salud, medicación y ayuno de mi animal.

Firmado el {{fecha}}. Médico responsable: {{medico}}.`,
    },
    {
      tipo: "cirugia",
      titulo: "Consentimiento informado para cirugía",
      cuerpo: `Yo, {{cliente}}, identificación {{identificacion}}, autorizo a {{clinica}} a realizar en {{paciente}} ({{especie}}, raza {{raza}}) el procedimiento quirúrgico de {{procedimiento}}.

Entiendo que se me explicó el procedimiento, sus alternativas, los cuidados posteriores y que ningún resultado puede garantizarse. Autorizo además los procedimientos adicionales que resulten necesarios durante la cirugía para preservar la vida del paciente.

Me comprometo a cumplir las indicaciones posoperatorias y a asistir a los controles.

Firmado el {{fecha}}. Médico responsable: {{medico}}.`,
    },
    {
      tipo: "hospitalizacion",
      titulo: "Consentimiento para hospitalización",
      cuerpo: `Yo, {{cliente}}, identificación {{identificacion}}, autorizo la hospitalización de {{paciente}} en {{clinica}} y los tratamientos que el médico tratante considere necesarios durante su internamiento.

Entiendo que se me informará de los cambios relevantes en su estado y que los costos se calculan por día de internamiento más los procedimientos realizados.

Firmado el {{fecha}}. Médico responsable: {{medico}}.`,
    },
    {
      tipo: "eutanasia",
      titulo: "Consentimiento para eutanasia",
      cuerpo: `Yo, {{cliente}}, identificación {{identificacion}}, en pleno uso de mis facultades y como responsable de {{paciente}} ({{especie}}, raza {{raza}}), solicito y autorizo a {{clinica}} a realizar la eutanasia humanitaria de mi animal.

Declaro que se me explicaron su condición, el pronóstico y las alternativas disponibles, y que tomo esta decisión de forma libre e informada. Declaro ser el responsable legal del animal.

Firmado el {{fecha}}. Médico responsable: {{medico}}.`,
    },
  ];

  let creadas = 0;
  for (const p of base) {
    const r = await db.query(
      `INSERT INTO exp_plantillas_consentimiento (tenant_id, tipo, titulo, cuerpo)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, tipo, titulo) DO NOTHING`,
      [tenantId, p.tipo, p.titulo, p.cuerpo]
    );
    creadas += r.rowCount ?? 0;
  }
  return { creadas };
}
