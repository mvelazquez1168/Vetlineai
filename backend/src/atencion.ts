import { PoolClient } from "pg";
import { cambiarEstadoDeCita, TRANSICIONES_VALIDAS } from "./agenda/citas";

// prompt_code_registro_atencion.md — módulo único para las 3 puertas
// (agenda/paciente/caso) del registro de atención. Todas resuelven una
// cita primero (crearla si hace falta, vía POST /citas ya existente) y
// después llaman a estas mismas funciones — nunca hay una segunda copia
// de "qué es una atención".

export interface AtencionRow {
  id: string;
  tenant_id: string;
  cita_id: string;
  paciente_id: string;
  medico_id: string;
  nota_medica: string | null;
  peso: string | null;
  temperatura: string | null;
  creado_en: string;
  actualizado_en: string;
}

// Get-or-create: una cita tiene a lo sumo una atención (UNIQUE cita_id
// en la tabla). Si el médico vuelve a entrar a la misma cita, sigue
// editando la misma fila — no se crean duplicados.
export async function obtenerOCrearAtencionParaCita(
  db: PoolClient,
  citaId: string,
  medicoId: string
): Promise<{ atencion: AtencionRow; error?: string; status?: number }> {
  const citaResult = await db.query(
    `SELECT id, tenant_id, paciente_id, medico_id FROM citas WHERE id = $1`,
    [citaId]
  );
  if (citaResult.rows.length === 0) {
    return { atencion: null as any, error: "Cita no encontrada.", status: 404 };
  }
  const cita = citaResult.rows[0];

  const existente = await db.query(`SELECT * FROM atenciones WHERE cita_id = $1`, [citaId]);
  if (existente.rows.length > 0) {
    return { atencion: existente.rows[0] };
  }

  const creada = await db.query(
    `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [cita.tenant_id, citaId, cita.paciente_id, medicoId]
  );
  return { atencion: creada.rows[0] };
}

export interface GuardarAtencionInput {
  notaMedica?: string | null;
  peso?: number | null;
  temperatura?: number | null;
}

// Todo opcional salvo la nota — no se valida acá que notaMedica venga
// completa: guardar con solo peso/vacuna y sin nota es una operación
// intermedia legítima (el veterinario puede volver después a completar
// la nota). El botón "Guardar" del frontend es el que exige la nota
// antes de dar por cerrado el registro.
//
// prompt_code_registro_atencion.md, respuesta del usuario — NO se salta
// la máquina de estados de citas.routes.ts. Antes se forzaba
// estado='completada' sin importar el estado de partida; eso permitía
// completar una cita cancelada, exactamente lo que la máquina existe
// para impedir. Ahora se valida contra la misma TRANSICIONES_VALIDAS: si
// el estado actual no puede llegar a 'completada', la atención NO se
// guarda — se devuelve un error explícito en vez de guardar la nota con
// una cita en un estado que no refleja lo que realmente pasó. Ver la
// nota al usuario sobre qué transiciones existen hoy (solo
// en_consulta→completada) y si hace falta ampliarlas.
export async function guardarAtencion(
  db: PoolClient,
  atencionId: string,
  input: GuardarAtencionInput
): Promise<{ atencion: AtencionRow } | { error: string; status: number }> {
  const atencionActual = await db.query(`SELECT cita_id FROM atenciones WHERE id = $1`, [atencionId]);
  if (atencionActual.rows.length === 0) {
    return { error: "Atención no encontrada.", status: 404 };
  }
  const citaId = atencionActual.rows[0].cita_id;

  const citaResult = await db.query(`SELECT estado FROM citas WHERE id = $1`, [citaId]);
  const estadoActual = citaResult.rows[0]?.estado as string | undefined;
  const puedeCompletar = estadoActual === "completada" || TRANSICIONES_VALIDAS[estadoActual ?? ""]?.includes("completada");
  if (!puedeCompletar) {
    return {
      error: `No se puede registrar la atención: la cita está en estado '${estadoActual}' y desde ahí no se puede completar. Revisá el estado de la cita en la agenda.`,
      status: 409,
    };
  }

  const result = await db.query(
    `UPDATE atenciones
     SET nota_medica = COALESCE($1, nota_medica),
         peso = $2,
         temperatura = $3,
         actualizado_en = now()
     WHERE id = $4
     RETURNING *`,
    [input.notaMedica ?? null, input.peso ?? null, input.temperatura ?? null, atencionId]
  );
  const atencion = result.rows[0];

  if (estadoActual !== "completada") {
    // POR EL PUNTO ÚNICO (prompt 05, §0). Este `UPDATE` directo no
    // validaba la transición ni dejaba el evento del CRM: una atención
    // podía completar una cita cancelada y la línea de tiempo del
    // cliente se quedaba sin el «completada».
    // El tenant sale de la cita: esta función no lo recibe, y leerlo de
    // la fila es más seguro que agregarle un parámetro a los seis
    // llamadores.
    const t = await db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM citas WHERE id = $1`,
      [citaId]
    );
    await cambiarEstadoDeCita(db, t.rows[0].tenant_id, citaId, "completada");
  }

  return { atencion };
}
