import { PoolClient } from "pg";
import { registrarInteraccion } from "./interacciones";
import { registrarConsentimiento } from "./consentimientos";

// ---------------------------------------------------------------------
// UNIFICAR DOS FICHAS — anexo 07-03, B1.
//
// Una sola transacción y un solo lugar. La operación mueve historia
// clínica y plata de una ficha a otra, y hacerla a mano con cuatro
// UPDATE sueltos termina con la mitad movida y la otra mitad no.
//
// LO QUE NO HACE: borrar. El absorbido queda marcado apuntando al
// sobreviviente, por las razones que argumenta la migración 126.
//
// LAS TRES TABLAS QUE NO SE TOCAN, y por qué cada una:
//
//   * `crm_interacciones` y `crm_consentimiento_historial` prohíben
//     UPDATE con un trigger (108_base_crm.sql). Son append-only porque
//     son la prueba de lo que pasó. En vez de moverlas, las lecturas de
//     la línea de tiempo del sobreviviente UNEN los dos ids
//     (`idsUnificadosHacia`), así que la historia se ve completa sin
//     reescribir una sola fila.
//   * de `fact_comprobantes` se mueve SOLO `receptor_propietario_id`.
//     Las columnas `receptor_nombre`, `receptor_identificacion` y las
//     demás son el retrato del receptor en el momento de emitir, y
//     Hacienda ya tiene ese XML: cambiarlas acá haría que nuestra copia
//     diga algo distinto del comprobante que está afuera.
//
// EL CRÉDITO FRENA LA FUSIÓN. Si los dos clientes tienen línea de
// crédito abierta, la operación se rechaza en vez de inventar una regla
// para juntar dos saldos. Sumarlos cambiaría el límite aprobado;
// quedarse con uno perdería plata. Es una decisión del dueño de la
// clínica, no de este código.
// ---------------------------------------------------------------------

/** Las tablas que se mueven tal cual, sin conflicto posible. */
const MOVER_CLIENTE: Array<{ tabla: string; columna: string }> = [
  { tabla: "pacientes", columna: "propietario_id" },
  { tabla: "crm_mensajes", columna: "propietario_id" },
  { tabla: "crm_respuestas", columna: "propietario_id" },
  // Solo la FK; el retrato del receptor queda como se emitió.
  { tabla: "fact_comprobantes", columna: "receptor_propietario_id" },
  { tabla: "vta_abonos", columna: "propietario_id" },
  { tabla: "vta_anticipos", columna: "propietario_id" },
  { tabla: "vta_cuentas", columna: "propietario_id" },
  { tabla: "vta_encargos", columna: "propietario_id" },
  // Los que el absorbido había referido pasan a colgar del
  // sobreviviente: si no, el referido apunta a una ficha muerta.
  { tabla: "propietarios", columna: "referido_por_propietario_id" },
];

const MOVER_PACIENTE: Array<{ tabla: string; columna: string }> = [
  { tabla: "casos", columna: "paciente_id" },
  { tabla: "citas", columna: "paciente_id" },
  { tabla: "atenciones", columna: "paciente_id" },
  { tabla: "archivos", columna: "paciente_id" },
  { tabla: "recetas", columna: "paciente_id" },
  { tabla: "cuidados_preventivos", columna: "paciente_id" },
  { tabla: "exp_alergias", columna: "paciente_id" },
  { tabla: "exp_problemas", columna: "paciente_id" },
  { tabla: "exp_consentimientos", columna: "paciente_id" },
  { tabla: "exp_estudios_lab", columna: "paciente_id" },
  { tabla: "exp_grooming", columna: "paciente_id" },
  { tabla: "exp_grooming_hallazgos", columna: "paciente_id" },
  { tabla: "inv_movimientos", columna: "paciente_id" },
  { tabla: "lista_espera", columna: "paciente_id" },
  { tabla: "notificaciones", columna: "paciente_id" },
  { tabla: "vta_cargos", columna: "paciente_id" },
  { tabla: "crm_mensajes", columna: "paciente_id" },
];

/** Los campos del cliente que la pantalla deja elegir uno por uno. */
export const CAMPOS_ELEGIBLES_CLIENTE = [
  "nombre",
  "telefono",
  "email",
  "direccion",
  "fuente_referencia_id",
] as const;

/** Los del paciente. */
export const CAMPOS_ELEGIBLES_PACIENTE = [
  "nombre",
  "especie",
  "raza_id",
  "sexo",
  "estado_reproductivo",
  "fecha_nacimiento",
  "edad_anios",
  "microchip",
  "color",
  "pelaje",
  "caracter",
  "habitat",
  "tipo_dieta",
  "alimentacion_detalle",
  "alergias",
  "alerta_manejo",
  "notas",
] as const;

export interface ResultadoUnificacion {
  sobrevivienteId: string;
  absorbidoId: string;
  /** Cuántas filas se movieron, por tabla. Solo las que movieron algo. */
  movido: Record<string, number>;
  /** Lo que hubo que resolver, en castellano, para el informe y la UI. */
  conflictos: string[];
}

/** La fusión no se puede hacer y hay que decir por qué, no fallar feo. */
export class UnificacionImposible extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "UnificacionImposible";
  }
}

/**
 * Todos los ids que terminan en este cliente (o paciente), incluido él.
 *
 * RESUELVE LA CADENA, no un solo salto: A absorbido por B y B absorbido
 * por C tiene que devolver los tres cuando se pregunta por C. Sin la
 * recursión, la línea de tiempo de C perdería la historia de A, que es
 * justo lo que la fusión prometió conservar.
 */
export async function idsUnificadosHacia(
  db: PoolClient,
  tabla: "propietarios" | "pacientes",
  id: string
): Promise<string[]> {
  const r = await db.query<{ id: string }>(
    `WITH RECURSIVE absorbidos AS (
       SELECT id FROM ${tabla} WHERE id = $1
       UNION
       SELECT t.id FROM ${tabla} t JOIN absorbidos a ON t.unificado_hacia_id = a.id
     )
     SELECT id FROM absorbidos`,
    [id]
  );
  return r.rows.map((f) => f.id);
}

/**
 * A dónde apunta hoy una ficha absorbida.
 *
 * Devuelve el id vivo al final de la cadena, o el mismo id si no fue
 * absorbida. Lo usan las pantallas que reciben un id viejo —un enlace
 * guardado, un número de expediente anotado en un carnet— para llevar a
 * la ficha que existe en vez de mostrar una vacía.
 */
export async function fichaViva(
  db: PoolClient,
  tabla: "propietarios" | "pacientes",
  id: string
): Promise<string> {
  const r = await db.query<{ id: string }>(
    `WITH RECURSIVE cadena AS (
       SELECT id, unificado_hacia_id FROM ${tabla} WHERE id = $1
       UNION ALL
       SELECT t.id, t.unificado_hacia_id
         FROM ${tabla} t JOIN cadena c ON t.id = c.unificado_hacia_id
     )
     SELECT id FROM cadena WHERE unificado_hacia_id IS NULL LIMIT 1`,
    [id]
  );
  return r.rows[0]?.id ?? id;
}

async function exigirFusionables(
  db: PoolClient,
  tabla: "propietarios" | "pacientes",
  sobrevivienteId: string,
  absorbidoId: string
): Promise<{ sobreviviente: Record<string, unknown>; absorbido: Record<string, unknown> }> {
  if (sobrevivienteId === absorbidoId) {
    throw new UnificacionImposible("Hay que elegir dos fichas distintas.");
  }
  const r = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${tabla} WHERE id = ANY($1::uuid[])`,
    [[sobrevivienteId, absorbidoId]]
  );
  const sobreviviente = r.rows.find((f) => f.id === sobrevivienteId);
  const absorbido = r.rows.find((f) => f.id === absorbidoId);
  // La RLS ya filtró por clínica: si no aparece, o no existe o es de
  // otra clínica, y las dos cosas se contestan igual.
  if (!sobreviviente || !absorbido) {
    throw new UnificacionImposible("Una de las dos fichas no existe en esta clínica.");
  }
  if (sobreviviente.unificado_hacia_id || absorbido.unificado_hacia_id) {
    throw new UnificacionImposible(
      "Una de las dos fichas ya fue unificada antes. Abrí la ficha viva y unificá desde ahí."
    );
  }
  return { sobreviviente, absorbido };
}

/** Un UPDATE de FK que devuelve cuántas filas movió. */
async function mover(
  db: PoolClient,
  tabla: string,
  columna: string,
  deId: string,
  aId: string
): Promise<number> {
  const r = await db.query(
    `UPDATE ${tabla} SET ${columna} = $2 WHERE ${columna} = $1`,
    [deId, aId]
  );
  return r.rowCount ?? 0;
}

/** Los valores elegidos, aplicados al sobreviviente. */
async function aplicarElegidos(
  db: PoolClient,
  tabla: "propietarios" | "pacientes",
  id: string,
  permitidos: readonly string[],
  elegido: Record<string, unknown> | undefined
): Promise<Record<string, unknown>> {
  const usados: Record<string, unknown> = {};
  const sets: string[] = [];
  const valores: unknown[] = [];
  for (const campo of permitidos) {
    if (elegido && campo in elegido) {
      valores.push(elegido[campo] === "" ? null : elegido[campo]);
      sets.push(`${campo} = $${valores.length}`);
      usados[campo] = elegido[campo];
    }
  }
  if (sets.length === 0) return usados;
  valores.push(id);
  await db.query(`UPDATE ${tabla} SET ${sets.join(", ")} WHERE id = $${valores.length}`, valores);
  return usados;
}

// ---------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------
export async function unificarClientes(
  db: PoolClient,
  tenantId: string,
  datos: {
    sobrevivienteId: string;
    absorbidoId: string;
    /** Campo → valor elegido. Lo que no venga, queda como está. */
    elegido?: Record<string, unknown>;
    personaId?: string;
  }
): Promise<ResultadoUnificacion> {
  const { sobrevivienteId, absorbidoId, personaId } = datos;
  const { sobreviviente, absorbido } = await exigirFusionables(
    db,
    "propietarios",
    sobrevivienteId,
    absorbidoId
  );

  const conflictos: string[] = [];
  const movido: Record<string, number> = {};

  // -------------------------------------------------------------------
  // 1. EL CRÉDITO, ANTES DE MOVER NADA.
  //
  // Se chequea primero para que el rechazo no deje la transacción a
  // medio camino: mover diez tablas y después abortar funciona por el
  // ROLLBACK, pero el mensaje de error llega después de un trabajo que
  // no hacía falta.
  // -------------------------------------------------------------------
  const credito = await db.query<{ propietario_id: string; limite: string; habilitado: boolean }>(
    `SELECT propietario_id, limite::text AS limite, habilitado FROM vta_credito_cliente
      WHERE propietario_id = ANY($1::uuid[])`,
    [[sobrevivienteId, absorbidoId]]
  );
  const habilitadas = credito.rows.filter((c) => c.habilitado);
  if (habilitadas.length === 2) {
    // DOS LÍMITES APROBADOS NO SE SUMAN NI SE DESCARTAN. El límite es
    // cuánto le fía la clínica a esa persona: sumar dos aprobaciones le
    // duplicaría el crédito sin que nadie lo haya autorizado, y quedarse
    // con uno podría bajárselo a la mitad. La decide el dueño.
    throw new UnificacionImposible(
      `Las dos fichas tienen línea de crédito habilitada (${habilitadas.map((c) => c.limite).join(" y ")}). Deshabilitá una de las dos antes de unificar: qué límite de crédito queda es una decisión de la clínica, no del sistema.`
    );
  }
  if (credito.rows.length === 2) {
    // Una de las dos está deshabilitada: es configuración sin usar, y la
    // columna es única por cliente, así que no puede mudarse. Se borra
    // la del absorbido, que es la ficha que deja de existir.
    const sobra = credito.rows.find((c) => !c.habilitado)!;
    await db.query(`DELETE FROM vta_credito_cliente WHERE propietario_id = $1`, [
      sobra.propietario_id === absorbidoId ? absorbidoId : sobrevivienteId,
    ]);
    if (sobra.propietario_id === sobrevivienteId) {
      movido.vta_credito_cliente = await mover(
        db,
        "vta_credito_cliente",
        "propietario_id",
        absorbidoId,
        sobrevivienteId
      );
    }
    conflictos.push(
      "Las dos fichas tenían línea de crédito y una estaba deshabilitada. Quedó la habilitada."
    );
  } else if (credito.rows.length === 1 && credito.rows[0].propietario_id === absorbidoId) {
    movido.vta_credito_cliente = await mover(
      db,
      "vta_credito_cliente",
      "propietario_id",
      absorbidoId,
      sobrevivienteId
    );
    conflictos.push(
      `La línea de crédito (límite ${credito.rows[0].limite}) pasó a la ficha que sobrevivió.`
    );
  }

  // -------------------------------------------------------------------
  // 2. LOS CONSENTIMIENTOS: GANA LA NEGATIVA.
  //
  // No es una preferencia estética. Si el cliente dijo en una de las
  // dos fichas que no quiere promociones, unificar no puede ser la
  // forma de volver a tener permiso para mandárselas. El criterio es el
  // mismo de toda la ley 8968: ante la duda, no.
  // -------------------------------------------------------------------
  const consAbsorbido = await db.query<{ canal: string; finalidad: string; otorgado: boolean }>(
    `SELECT canal, finalidad, otorgado FROM crm_consentimientos WHERE propietario_id = $1`,
    [absorbidoId]
  );
  for (const c of consAbsorbido.rows) {
    const delSobreviviente = await db.query<{ otorgado: boolean }>(
      `SELECT otorgado FROM crm_consentimientos
        WHERE propietario_id = $1 AND canal = $2 AND finalidad = $3`,
      [sobrevivienteId, c.canal, c.finalidad]
    );
    if (delSobreviviente.rows.length === 0) {
      // No hay conflicto: la fila se muda y el historial del
      // sobreviviente registra que ahora tiene este consentimiento.
      await registrarConsentimiento(db, tenantId, {
        propietarioId: sobrevivienteId,
        canal: c.canal as "correo" | "whatsapp",
        finalidad: c.finalidad as "salud" | "promociones",
        otorgado: c.otorgado,
        fuente: "unificacion",
        personaId,
        nota: `Viene de la ficha unificada de ${String(absorbido.nombre)}.`,
      });
      continue;
    }
    if (delSobreviviente.rows[0].otorgado && !c.otorgado) {
      await registrarConsentimiento(db, tenantId, {
        propietarioId: sobrevivienteId,
        canal: c.canal as "correo" | "whatsapp",
        finalidad: c.finalidad as "salud" | "promociones",
        otorgado: false,
        fuente: "unificacion",
        personaId,
        nota: `En la ficha de ${String(absorbido.nombre)} estaba en NO, y al unificar gana la negativa.`,
      });
      conflictos.push(
        `${c.finalidad} por ${c.canal}: una ficha decía que sí y la otra que no. Quedó en NO.`
      );
    }
  }
  // Las filas del absorbido se borran: `crm_consentimientos` es el
  // estado actual, no el historial. El historial —que es el que
  // prueba— no se toca nunca.
  await db.query(`DELETE FROM crm_consentimientos WHERE propietario_id = $1`, [absorbidoId]);

  // -------------------------------------------------------------------
  // 3. LAS PREFERENCIAS DE CONTACTO: la del sobreviviente, si tiene.
  //
  // La clave primaria es el propietario, así que no pueden convivir. Se
  // queda la del sobreviviente porque es la ficha que la clínica eligió
  // conservar; si no tiene ninguna, se muda la del absorbido en vez de
  // perderla.
  // -------------------------------------------------------------------
  const prefSobreviviente = await db.query(
    `SELECT 1 FROM crm_preferencias_contacto WHERE propietario_id = $1`,
    [sobrevivienteId]
  );
  if (prefSobreviviente.rows.length > 0) {
    const borradas = await db.query(
      `DELETE FROM crm_preferencias_contacto WHERE propietario_id = $1`,
      [absorbidoId]
    );
    if ((borradas.rowCount ?? 0) > 0) {
      conflictos.push("Las dos fichas tenían preferencias de contacto. Quedaron las de la que sobrevivió.");
    }
  } else {
    movido.crm_preferencias_contacto = await mover(
      db,
      "crm_preferencias_contacto",
      "propietario_id",
      absorbidoId,
      sobrevivienteId
    );
  }

  // -------------------------------------------------------------------
  // 4. LOS PERFILES DE FACTURACIÓN.
  //
  // UNIQUE (perfil_id, propietario_id): si los dos están enlazados al
  // mismo perfil, el enlace del absorbido se borra porque es el mismo
  // enlace. Y como solo puede haber un perfil predeterminado por
  // cliente, los que llegan del absorbido dejan de ser predeterminados
  // si el sobreviviente ya tiene uno.
  // -------------------------------------------------------------------
  await db.query(
    `DELETE FROM fact_perfil_clientes
      WHERE propietario_id = $1
        AND perfil_id IN (SELECT perfil_id FROM fact_perfil_clientes WHERE propietario_id = $2)`,
    [absorbidoId, sobrevivienteId]
  );
  const tienePredeterminado = await db.query(
    `SELECT 1 FROM fact_perfil_clientes WHERE propietario_id = $1 AND es_predeterminado`,
    [sobrevivienteId]
  );
  if (tienePredeterminado.rows.length > 0) {
    const bajados = await db.query(
      `UPDATE fact_perfil_clientes SET es_predeterminado = false
        WHERE propietario_id = $1 AND es_predeterminado`,
      [absorbidoId]
    );
    if ((bajados.rowCount ?? 0) > 0) {
      conflictos.push(
        "Las dos fichas tenían un receptor de facturación predeterminado. Quedó el de la que sobrevivió."
      );
    }
  }
  movido.fact_perfil_clientes = await mover(
    db,
    "fact_perfil_clientes",
    "propietario_id",
    absorbidoId,
    sobrevivienteId
  );

  // -------------------------------------------------------------------
  // 5. LA IDENTIFICACIÓN, cuando el sobreviviente no tiene.
  //
  // Es el caso normal del duplicado real: la ficha vieja tiene la cédula
  // y la nueva no, porque la cargó alguien con prisa. Sin esto, la
  // clínica unifica y se queda sin poder facturarle.
  //
  // Hay que SACARLA del absorbido antes de ponerla: el índice único
  // `propietarios_identificacion_unica` es por clínica y la fila del
  // absorbido sigue existiendo. Eso vacía un dato de una ficha muerta,
  // y la auditoría guarda cuál era.
  // -------------------------------------------------------------------
  if (!sobreviviente.numero_identificacion && absorbido.numero_identificacion) {
    await db.query(
      `UPDATE propietarios SET tipo_identificacion_id = NULL, numero_identificacion = NULL
        WHERE id = $1`,
      [absorbidoId]
    );
    await db.query(
      `UPDATE propietarios SET tipo_identificacion_id = $2, numero_identificacion = $3
        WHERE id = $1`,
      [sobrevivienteId, absorbido.tipo_identificacion_id, absorbido.numero_identificacion]
    );
    conflictos.push(
      `La identificación ${String(absorbido.numero_identificacion)} pasó a la ficha que sobrevivió, que no tenía.`
    );
  } else if (
    sobreviviente.numero_identificacion &&
    absorbido.numero_identificacion &&
    sobreviviente.numero_identificacion !== absorbido.numero_identificacion
  ) {
    // DOS IDENTIFICACIONES DISTINTAS NO SE UNIFICAN SOLAS. Puede ser un
    // error de tipeo o pueden ser dos personas distintas con el mismo
    // teléfono —una pareja, una oficina—, y acertar no es tarea del
    // sistema.
    conflictos.push(
      `Las dos fichas tienen identificaciones distintas (${String(sobreviviente.numero_identificacion)} y ${String(absorbido.numero_identificacion)}). Quedó la de la ficha que sobrevivió: revisá que sean la misma persona.`
    );
  }

  // -------------------------------------------------------------------
  // 6. EL RESTO, tal cual.
  // -------------------------------------------------------------------
  for (const { tabla, columna } of MOVER_CLIENTE) {
    const n = await mover(db, tabla, columna, absorbidoId, sobrevivienteId);
    if (n > 0) movido[`${tabla}.${columna}`] = n;
  }

  // -------------------------------------------------------------------
  // 7. LOS VALORES ELEGIDOS Y LA MARCA.
  // -------------------------------------------------------------------
  const elegidos = await aplicarElegidos(
    db,
    "propietarios",
    sobrevivienteId,
    CAMPOS_ELEGIBLES_CLIENTE,
    datos.elegido
  );
  await db.query(
    `UPDATE propietarios
        SET unificado_hacia_id = $2, unificado_en = now(), unificado_por = $3
      WHERE id = $1`,
    [absorbidoId, sobrevivienteId, personaId ?? null]
  );

  await registrarInteraccion(db, {
    tenantId,
    tipo: "cliente_unificado",
    propietarioId: sobrevivienteId,
    origenTabla: "propietarios",
    origenId: absorbidoId,
    personaId,
    resumen: `Absorbió la ficha de ${String(absorbido.nombre)}`,
  });
  await db.query(
    `INSERT INTO crm_unificaciones
       (tenant_id, entidad, sobreviviente_id, absorbido_id, sobreviviente_nombre,
        absorbido_nombre, detalle, hecho_por)
     VALUES ($1,'cliente',$2,$3,$4,$5,$6,$7)`,
    [
      tenantId,
      sobrevivienteId,
      absorbidoId,
      String(sobreviviente.nombre),
      String(absorbido.nombre),
      JSON.stringify({ movido, elegido: elegidos, conflictos }),
      personaId ?? null,
    ]
  );

  return { sobrevivienteId, absorbidoId, movido, conflictos };
}

// ---------------------------------------------------------------------
// PACIENTES
// ---------------------------------------------------------------------
export async function unificarPacientes(
  db: PoolClient,
  tenantId: string,
  datos: {
    sobrevivienteId: string;
    absorbidoId: string;
    elegido?: Record<string, unknown>;
    personaId?: string;
  }
): Promise<ResultadoUnificacion> {
  const { sobrevivienteId, absorbidoId, personaId } = datos;
  const { sobreviviente, absorbido } = await exigirFusionables(
    db,
    "pacientes",
    sobrevivienteId,
    absorbidoId
  );

  const conflictos: string[] = [];
  const movido: Record<string, number> = {};

  // DOS DUEÑOS DISTINTOS NO SE UNIFICAN SOLOS. Puede ser el mismo perro
  // que cambió de dueño —y entonces hay dos expedientes legítimos, uno
  // por dueño— o puede ser un homónimo. Unificarlos movería la historia
  // clínica de una familia a otra, que es justo lo que no se puede
  // deshacer: primero se unifican los clientes.
  if (sobreviviente.propietario_id !== absorbido.propietario_id) {
    throw new UnificacionImposible(
      "Los dos pacientes están a nombre de clientes distintos. Si es el mismo dueño registrado dos veces, unificá primero los clientes."
    );
  }

  for (const { tabla, columna } of MOVER_PACIENTE) {
    const n = await mover(db, tabla, columna, absorbidoId, sobrevivienteId);
    if (n > 0) movido[`${tabla}.${columna}`] = n;
  }

  // EL NÚMERO DE EXPEDIENTE VIEJO, BUSCABLE. Se suman el número del
  // absorbido y los alias que el absorbido ya tenía: una fusión puede
  // encadenarse y el número del primero no se puede perder en el camino.
  const numeroAbsorbido = absorbido.numero_expediente;
  await db.query(
    `UPDATE pacientes
        SET numero_expediente_alias = (
              SELECT array_agg(DISTINCT x) FROM unnest(
                numero_expediente_alias
                || $2::text[]
                || ARRAY[$3::text]
              ) AS x WHERE x IS NOT NULL AND x <> ''
            )
      WHERE id = $1`,
    [
      sobrevivienteId,
      (absorbido.numero_expediente_alias as string[]) ?? [],
      numeroAbsorbido === null || numeroAbsorbido === undefined ? "" : String(numeroAbsorbido),
    ]
  );

  const elegidos = await aplicarElegidos(
    db,
    "pacientes",
    sobrevivienteId,
    CAMPOS_ELEGIBLES_PACIENTE,
    datos.elegido
  );
  await db.query(
    `UPDATE pacientes
        SET unificado_hacia_id = $2, unificado_en = now(), unificado_por = $3,
            -- El absorbido no vuelve a contar como paciente activo de la
            -- clínica: ni en el fichero, ni en los avisos, ni en los
            -- números del dashboard.
            estado = CASE WHEN estado = 'activo' THEN 'baja_otro' ELSE estado END,
            baja_motivo = COALESCE(baja_motivo, 'Ficha unificada'),
            baja_en = COALESCE(baja_en, now())
      WHERE id = $1`,
    [absorbidoId, sobrevivienteId, personaId ?? null]
  );
  conflictos.push(
    `El expediente ${String(numeroAbsorbido)} sigue encontrando a ${String(sobreviviente.nombre)}.`
  );

  await registrarInteraccion(db, {
    tenantId,
    tipo: "cliente_unificado",
    propietarioId: String(sobreviviente.propietario_id),
    pacienteId: sobrevivienteId,
    origenTabla: "pacientes",
    origenId: absorbidoId,
    personaId,
    resumen: `${String(sobreviviente.nombre)} absorbió el expediente de ${String(absorbido.nombre)}`,
  });
  await db.query(
    `INSERT INTO crm_unificaciones
       (tenant_id, entidad, sobreviviente_id, absorbido_id, sobreviviente_nombre,
        absorbido_nombre, detalle, hecho_por)
     VALUES ($1,'paciente',$2,$3,$4,$5,$6,$7)`,
    [
      tenantId,
      sobrevivienteId,
      absorbidoId,
      String(sobreviviente.nombre),
      String(absorbido.nombre),
      JSON.stringify({ movido, elegido: elegidos, conflictos }),
      personaId ?? null,
    ]
  );

  return { sobrevivienteId, absorbidoId, movido, conflictos };
}

/** Las fusiones hechas, para la pantalla de duplicados. */
export async function unificacionesHechas(
  db: PoolClient,
  limite = 20
): Promise<
  Array<{
    id: string;
    entidad: string;
    sobreviviente_id: string;
    sobreviviente_nombre: string;
    absorbido_nombre: string;
    hecho_en: string;
    hecho_por_nombre: string | null;
  }>
> {
  const r = await db.query(
    `SELECT u.id, u.entidad, u.sobreviviente_id, u.sobreviviente_nombre, u.absorbido_nombre,
            u.hecho_en, p.nombre AS hecho_por_nombre
       FROM crm_unificaciones u
       LEFT JOIN personas p ON p.id = u.hecho_por
      ORDER BY u.hecho_en DESC
      LIMIT $1`,
    [limite]
  );
  return r.rows;
}
