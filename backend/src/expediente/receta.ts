import { PoolClient } from "pg";
import { avisosAlRecetar } from "./atencion";

// ---------------------------------------------------------------------
// LA RECETA DE LA ATENCIÓN — prompt 07c, sección 2.
//
// Hasta hoy el médico solo podía DISPENSAR un medicamento: agregarlo
// como producto cobrado. Eso no es una receta. Una receta dice cuánto,
// por dónde, cada cuánto y por cuántos días, y existe también —sobre
// todo— para lo que el cliente compra afuera.
//
// SE EXTIENDE `recetas`/`receta_items`, no se crea una tabla paralela.
// Una receta es una receta, la escriba el agente de IA desde un caso o
// el médico en la consulta; lo que cambia es de dónde cuelga.
//
// LA REGLA DEL DINERO NO CAMBIA. Una línea marcada «se dispensa en la
// clínica» crea su `exp_atencion_items`, y de ahí sale el cargo y la
// salida de inventario por el mismo camino que todo lo demás. La línea
// guarda el id de ese ítem: por eso no puede cobrarse dos veces, y por
// eso quitar la línea quita el cargo.
// ---------------------------------------------------------------------

export interface LineaReceta {
  /** Uno de los tres, nunca dos. */
  medicamentoId?: string | null;
  presentacionId?: string | null;
  textoLibre?: string | null;

  dosisCantidad?: number | null;
  dosisUnidad?: string | null;
  dosisPorKg?: boolean;

  viaCodigo?: string | null;
  frecuenciaCodigo?: string | null;
  duracionCantidad?: number | null;
  duracionUnidad?: "dias" | "semanas" | "meses" | null;

  cantidadTotal?: number | null;
  indicaciones?: string | null;
  observaciones?: string | null;
  dispensadoAqui?: boolean;
}

export interface LineaCalculada extends LineaReceta {
  id: string;
  orden: number;
  nombre: string;
  pesoBaseKg: number | null;
  dosisTotal: number | null;
  /** «12,5 mg/kg × 18 kg = 225 mg», o null si la dosis no es por kilo. */
  explicacionDosis: string | null;
  atencionItemId: string | null;
}

// ---------------------------------------------------------------------
// EL CÁLCULO DE LA DOSIS
//
// Vive acá y no en la pantalla, por lo de siempre: la pantalla muestra
// el número y el PDF lo imprime, y si cada uno lo calculara, un día
// mostrarían dos cosas distintas y la que vale es la que se imprimió.
//
// Se devuelve también la EXPLICACIÓN, no solo el resultado: «225 mg» no
// se puede revisar, «12,5 mg/kg × 18 kg = 225 mg» sí. Quien revisa una
// receta necesita ver la cuenta, no el resultado.
// ---------------------------------------------------------------------

function formatearNumero(n: number): string {
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 2 }).format(n);
}

export function calcularDosis(
  linea: Pick<LineaReceta, "dosisCantidad" | "dosisUnidad" | "dosisPorKg">,
  pesoKg: number | null
): { total: number | null; explicacion: string | null } {
  const cantidad = linea.dosisCantidad ?? null;
  if (cantidad === null) return { total: null, explicacion: null };
  if (!linea.dosisPorKg) return { total: cantidad, explicacion: null };
  if (pesoKg === null || pesoKg <= 0) {
    // SIN PESO NO SE INVENTA UN NÚMERO. Se dice que falta, que es un
    // dato que el médico puede ir a buscar; un total calculado con un
    // peso supuesto es una dosis equivocada con aspecto de correcta.
    return { total: null, explicacion: "Falta el peso del paciente para calcular la dosis." };
  }
  const total = cantidad * pesoKg;
  const u = linea.dosisUnidad ?? "";
  return {
    total,
    explicacion: `${formatearNumero(cantidad)} ${u}/kg × ${formatearNumero(pesoKg)} kg = ${formatearNumero(total)} ${u}`.trim(),
  };
}

/**
 * El texto para el propietario, generado del resto de la línea.
 *
 * Se GUARDA aunque se genere: el médico lo puede editar, y una receta
 * que recalcula su texto al imprimirla cambiaría lo que el propietario
 * leyó el día que se la dieron.
 */
export async function indicacionesSugeridas(
  db: PoolClient,
  linea: LineaReceta,
  nombre: string,
  dosisTotal: number | null
): Promise<string> {
  const partes: string[] = [];
  const dosis =
    dosisTotal !== null
      ? `${formatearNumero(dosisTotal)} ${linea.dosisUnidad ?? ""}`.trim()
      : linea.dosisCantidad !== null && linea.dosisCantidad !== undefined
        ? `${formatearNumero(linea.dosisCantidad)} ${linea.dosisUnidad ?? ""}`.trim()
        : null;
  partes.push(dosis ? `${nombre}: ${dosis}` : nombre);

  if (linea.frecuenciaCodigo) {
    const f = await db.query<{ etiqueta: string }>(
      `SELECT etiqueta FROM exp_catalogos_clinicos
        WHERE tipo = 'frecuencia' AND codigo = $1
          AND (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true))
        ORDER BY tenant_id NULLS LAST LIMIT 1`,
      [linea.frecuenciaCodigo]
    );
    if (f.rows[0]) partes.push(f.rows[0].etiqueta.toLowerCase());
  }
  if (linea.duracionCantidad && linea.duracionUnidad) {
    // El plural con su acento: la unidad guardada es `dias` —sin
    // acento, porque es un codigo— y lo que se imprime es «días».
    const u = (
      linea.duracionCantidad === 1
        ? { dias: "día", semanas: "semana", meses: "mes" }
        : { dias: "días", semanas: "semanas", meses: "meses" }
    )[linea.duracionUnidad];
    partes.push(`por ${linea.duracionCantidad} ${u}`);
  }
  if (linea.viaCodigo) {
    const v = await db.query<{ etiqueta: string }>(
      `SELECT etiqueta FROM exp_catalogos_clinicos
        WHERE tipo = 'via_administracion' AND codigo = $1
          AND (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true))
        ORDER BY tenant_id NULLS LAST LIMIT 1`,
      [linea.viaCodigo]
    );
    if (v.rows[0]) partes.push(`vía ${v.rows[0].etiqueta.toLowerCase()}`);
  }
  return partes.join(", ") + ".";
}

/**
 * Cuántas unidades hacen falta para toda la duración.
 *
 * Solo se puede cuando la frecuencia dice cada cuántas horas y la
 * duración está en días: con «según necesidad» no hay cuenta posible, y
 * devolver un número ahí sería inventarlo.
 */
export async function cantidadTotalSugerida(
  db: PoolClient,
  linea: LineaReceta
): Promise<number | null> {
  if (!linea.frecuenciaCodigo || !linea.duracionCantidad || !linea.duracionUnidad) return null;
  const f = await db.query<{ horas: string | null }>(
    `SELECT horas FROM exp_catalogos_clinicos
      WHERE tipo = 'frecuencia' AND codigo = $1
        AND (tenant_id IS NULL OR tenant_id::text = current_setting('app.tenant_id', true))
      ORDER BY tenant_id NULLS LAST LIMIT 1`,
    [linea.frecuenciaCodigo]
  );
  const horas = Number(f.rows[0]?.horas ?? 0);
  if (!horas) return null;
  const dias =
    linea.duracionUnidad === "dias"
      ? linea.duracionCantidad
      : linea.duracionUnidad === "semanas"
        ? linea.duracionCantidad * 7
        : linea.duracionCantidad * 30;
  return Math.ceil((dias * 24) / horas);
}

// ---------------------------------------------------------------------
// LA RECETA DE UNA ATENCIÓN
//
// Una por atención: se crea cuando se agrega la primera línea y se
// reusa después. No se crea de oficio al abrir la atención porque una
// receta vacía en la historia del paciente es ruido.
// ---------------------------------------------------------------------

async function recetaDeAtencion(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  crear: boolean
): Promise<{ id: string; pesoKg: number | null } | null> {
  const r = await db.query<{ id: string; peso_kg: string | null }>(
    `SELECT id, peso_kg FROM recetas WHERE atencion_id = $1 ORDER BY creado_en LIMIT 1`,
    [atencionId]
  );
  if (r.rows.length > 0) {
    return { id: r.rows[0].id, pesoKg: r.rows[0].peso_kg === null ? null : Number(r.rows[0].peso_kg) };
  }
  if (!crear) return null;

  const a = await db.query<{
    paciente_id: string;
    medico_id: string;
    peso: string | null;
    cita_id: string | null;
    estado: string;
  }>(`SELECT paciente_id, medico_id, peso, cita_id, estado FROM atenciones WHERE id = $1`, [
    atencionId,
  ]);
  if (a.rows.length === 0) throw new Error("Esa atención no existe.");

  // EL PESO: el de la atención, y si no hay, el último registrado del
  // paciente. El prompt lo pide así, y la receta guarda cuál usó.
  let peso = a.rows[0].peso === null ? null : Number(a.rows[0].peso);
  if (peso === null) {
    const ultimo = await db.query<{ peso: string }>(
      `SELECT peso FROM atenciones
        WHERE paciente_id = $1 AND peso IS NOT NULL
        ORDER BY creado_en DESC LIMIT 1`,
      [a.rows[0].paciente_id]
    );
    peso = ultimo.rows[0] ? Number(ultimo.rows[0].peso) : null;
  }

  const nueva = await db.query<{ id: string }>(
    `INSERT INTO recetas (tenant_id, caso_id, atencion_id, paciente_id, medico_id, peso_kg, estado)
     VALUES ($1, NULL, $2, $3, $4, $5, 'borrador')
     RETURNING id`,
    [tenantId, atencionId, a.rows[0].paciente_id, a.rows[0].medico_id, peso]
  );
  return { id: nueva.rows[0].id, pesoKg: peso };
}

async function exigirBorrador(db: PoolClient, atencionId: string): Promise<void> {
  const a = await db.query<{ estado: string }>(`SELECT estado FROM atenciones WHERE id = $1`, [
    atencionId,
  ]);
  if (a.rows.length === 0) throw new Error("Esa atención no existe.");
  if (a.rows[0].estado !== "borrador") {
    throw new Error("La atención ya está cerrada: una receta firmada solo admite adendas.");
  }
}

export interface RecetaDeAtencion {
  id: string | null;
  pesoKg: number | null;
  estado: string;
  lineas: LineaCalculada[];
  /** Los avisos de alergia de todas las líneas juntos. */
  avisos: Array<{ porque: string; severidad: string; detalle: string; linea: string }>;
}

export async function verReceta(
  db: PoolClient,
  tenantId: string,
  atencionId: string
): Promise<RecetaDeAtencion> {
  const cab = await db.query<{ id: string; peso_kg: string | null; estado: string }>(
    `SELECT id, peso_kg, estado FROM recetas WHERE atencion_id = $1 ORDER BY creado_en LIMIT 1`,
    [atencionId]
  );
  if (cab.rows.length === 0) {
    return { id: null, pesoKg: null, estado: "borrador", lineas: [], avisos: [] };
  }
  const pesoKg = cab.rows[0].peso_kg === null ? null : Number(cab.rows[0].peso_kg);
  const lineas = await lineasDeReceta(db, cab.rows[0].id);

  const avisos: RecetaDeAtencion["avisos"] = [];
  const paciente = await db.query<{ paciente_id: string }>(
    `SELECT paciente_id FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  for (const l of lineas) {
    if (!l.presentacionId) continue;
    const a = await avisosAlRecetar(db, paciente.rows[0].paciente_id, l.presentacionId);
    for (const x of a) avisos.push({ ...x, linea: l.nombre });
  }

  return { id: cab.rows[0].id, pesoKg, estado: cab.rows[0].estado, lineas, avisos };
}

async function lineasDeReceta(db: PoolClient, recetaId: string): Promise<LineaCalculada[]> {
  const r = await db.query(
    `SELECT ri.*,
            ri.nombre_impreso AS nombre
       FROM receta_items ri
       LEFT JOIN medicamentos m ON m.id = ri.medicamento_id
       LEFT JOIN inv_presentaciones pr ON pr.id = ri.presentacion_id
       LEFT JOIN inv_productos p ON p.id = pr.producto_id
      WHERE ri.receta_id = $1
      ORDER BY ri.orden, ri.id`,
    [recetaId]
  );
  return r.rows.map((x: Record<string, unknown>) => {
    const linea: LineaReceta = {
      medicamentoId: (x.medicamento_id as string) ?? null,
      presentacionId: (x.presentacion_id as string) ?? null,
      textoLibre: (x.texto_libre as string) ?? null,
      dosisCantidad: x.dosis_cantidad === null ? null : Number(x.dosis_cantidad),
      dosisUnidad: (x.dosis_unidad as string) ?? null,
      dosisPorKg: Boolean(x.dosis_por_kg),
      viaCodigo: (x.via_codigo as string) ?? null,
      frecuenciaCodigo: (x.frecuencia_codigo as string) ?? null,
      duracionCantidad: x.duracion_cantidad === null ? null : Number(x.duracion_cantidad),
      duracionUnidad: (x.duracion_unidad as LineaReceta["duracionUnidad"]) ?? null,
      cantidadTotal: x.cantidad_total === null ? null : Number(x.cantidad_total),
      indicaciones: (x.indicaciones as string) ?? null,
      observaciones: (x.observaciones as string) ?? null,
      dispensadoAqui: Boolean(x.dispensado_aqui),
    };
    const pesoBase = x.peso_base_kg === null ? null : Number(x.peso_base_kg);
    const total = x.dosis_total === null ? null : Number(x.dosis_total);
    return {
      ...linea,
      id: x.id as string,
      orden: Number(x.orden ?? 0),
      nombre: (x.nombre as string) ?? "Sin nombre",
      pesoBaseKg: pesoBase,
      dosisTotal: total,
      explicacionDosis:
        linea.dosisPorKg && total !== null && pesoBase !== null
          ? `${formatearNumero(linea.dosisCantidad ?? 0)} ${linea.dosisUnidad ?? ""}/kg × ${formatearNumero(pesoBase)} kg = ${formatearNumero(total)} ${linea.dosisUnidad ?? ""}`.trim()
          : null,
      atencionItemId: (x.atencion_item_id as string) ?? null,
    };
  });
}

// ---------------------------------------------------------------------
// AGREGAR UNA LÍNEA
//
// Si la línea se dispensa en la clínica y sale del inventario, acá se
// crea TAMBIÉN su ítem de atención, que es el que termina en cargo y en
// salida de stock. La línea guarda su id: una sola fuente, y quitar la
// línea quita el ítem.
// ---------------------------------------------------------------------

export async function agregarLinea(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  linea: LineaReceta,
  personaId?: string
): Promise<LineaCalculada> {
  await exigirBorrador(db, atencionId);

  const origenes = [linea.medicamentoId, linea.presentacionId, linea.textoLibre].filter(
    (x) => x !== null && x !== undefined && x !== ""
  );
  if (origenes.length !== 1) {
    throw new Error(
      "Una línea de receta sale de un solo lugar: el catálogo de medicamentos, el inventario o el texto libre."
    );
  }
  if (linea.dispensadoAqui && !linea.presentacionId) {
    throw new Error(
      "Solo se puede dispensar en la clínica lo que está en el inventario: elija una presentación o desmarque «se dispensa acá»."
    );
  }

  const receta = (await recetaDeAtencion(db, tenantId, atencionId, true))!;

  // El nombre, para el texto y para el aviso de alergia.
  let nombre = linea.textoLibre ?? "";
  if (linea.medicamentoId) {
    const m = await db.query<{ nombre: string }>(
      `SELECT nombre FROM medicamentos WHERE id = $1`,
      [linea.medicamentoId]
    );
    if (m.rows.length === 0) throw new Error("Ese medicamento no existe en el catálogo.");
    nombre = m.rows[0].nombre;
  } else if (linea.presentacionId) {
    const p = await db.query<{ nombre: string }>(
      `SELECT p.nombre || ' — ' || pr.nombre AS nombre
         FROM inv_presentaciones pr JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.id = $1`,
      [linea.presentacionId]
    );
    if (p.rows.length === 0) throw new Error("Esa presentación no existe en el catálogo.");
    nombre = p.rows[0].nombre;
  }

  const { total } = calcularDosis(linea, receta.pesoKg);
  const cantidadTotal = linea.cantidadTotal ?? (await cantidadTotalSugerida(db, linea));
  const indicaciones =
    linea.indicaciones ?? (await indicacionesSugeridas(db, linea, nombre, total));

  // El texto plano que la tabla original guarda y que se imprime. Se
  // arma del dato estructurado para que una receta nueva no quede con
  // los campos viejos vacíos.
  const dosisTexto =
    total !== null ? `${formatearNumero(total)} ${linea.dosisUnidad ?? ""}`.trim() : "";

  const orden = await db.query<{ siguiente: number }>(
    `SELECT COALESCE(max(orden), 0) + 1 AS siguiente FROM receta_items WHERE receta_id = $1`,
    [receta.id]
  );

  const r = await db.query<{ id: string }>(
    `INSERT INTO receta_items
       (receta_id, medicamento_id, presentacion_id, texto_libre, nombre_impreso,
        dosis, frecuencia, duracion,
        via_administracion, observaciones, orden,
        dosis_cantidad, dosis_unidad, dosis_por_kg, peso_base_kg, dosis_total,
        via_codigo, frecuencia_codigo, duracion_cantidad, duracion_unidad,
        cantidad_total, indicaciones, dispensado_aqui)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     RETURNING id`,
    [
      receta.id,
      linea.medicamentoId ?? null,
      linea.presentacionId ?? null,
      linea.textoLibre ?? null,
      nombre,
      dosisTexto,
      linea.frecuenciaCodigo ?? "",
      linea.duracionCantidad ? `${linea.duracionCantidad} ${linea.duracionUnidad}` : "",
      linea.viaCodigo ?? "",
      linea.observaciones ?? null,
      orden.rows[0].siguiente,
      linea.dosisCantidad ?? null,
      linea.dosisUnidad ?? null,
      linea.dosisPorKg ?? false,
      linea.dosisPorKg ? receta.pesoKg : null,
      total,
      linea.viaCodigo ?? null,
      linea.frecuenciaCodigo ?? null,
      linea.duracionCantidad ?? null,
      linea.duracionUnidad ?? null,
      cantidadTotal,
      indicaciones,
      linea.dispensadoAqui ?? false,
    ]
  );

  // Lo que se entrega acá genera su ítem de atención, por el camino de
  // siempre. `agregarItem` se importa adentro para no crear un ciclo de
  // módulos: atencion.ts ya importa de acá.
  if (linea.dispensadoAqui && linea.presentacionId) {
    const { agregarItem } = await import("./atencion");
    const item = await agregarItem(
      db,
      tenantId,
      atencionId,
      {
        tipo: "receta",
        presentacionId: linea.presentacionId,
        cantidad: cantidadTotal && cantidadTotal > 0 ? cantidadTotal : 1,
        dispensadoAqui: true,
      },
      personaId
    );
    await db.query(`UPDATE receta_items SET atencion_item_id = $2 WHERE id = $1`, [
      r.rows[0].id,
      item.id,
    ]);
  }

  const lineas = await lineasDeReceta(db, receta.id);
  return lineas.find((l) => l.id === r.rows[0].id)!;
}

export async function quitarLinea(
  db: PoolClient,
  atencionId: string,
  lineaId: string
): Promise<void> {
  await exigirBorrador(db, atencionId);
  const l = await db.query<{ atencion_item_id: string | null }>(
    `SELECT ri.atencion_item_id
       FROM receta_items ri JOIN recetas r ON r.id = ri.receta_id
      WHERE ri.id = $1 AND r.atencion_id = $2`,
    [lineaId, atencionId]
  );
  if (l.rows.length === 0) throw new Error("Esa línea no es de esta receta.");
  // El ítem primero: si se borrara la línea antes, el ítem quedaría
  // cobrándose sin nada que lo explique.
  if (l.rows[0].atencion_item_id) {
    await db.query(`DELETE FROM exp_atencion_items WHERE id = $1 AND cargo_id IS NULL`, [
      l.rows[0].atencion_item_id,
    ]);
  }
  await db.query(`DELETE FROM receta_items WHERE id = $1`, [lineaId]);
}

/**
 * La receta se firma con la atención. Lo llama el cierre.
 *
 * Idempotente: una receta ya firmada no se vuelve a firmar, porque el
 * cierre se puede reintentar y la fecha de firma no puede moverse.
 */
export async function firmarRecetaDeAtencion(
  db: PoolClient,
  atencionId: string,
  personaId?: string
): Promise<{ firmada: boolean; lineas: number }> {
  const r = await db.query<{ id: string; estado: string }>(
    `SELECT id, estado FROM recetas WHERE atencion_id = $1 ORDER BY creado_en LIMIT 1`,
    [atencionId]
  );
  if (r.rows.length === 0) return { firmada: false, lineas: 0 };
  const n = await db.query<{ c: string }>(
    `SELECT count(*)::text AS c FROM receta_items WHERE receta_id = $1`,
    [r.rows[0].id]
  );
  const lineas = Number(n.rows[0].c);
  if (lineas === 0) {
    // Una receta sin líneas no se firma: se borra. Es lo que queda
    // cuando el médico abrió la acción y no agregó nada.
    await db.query(`DELETE FROM recetas WHERE id = $1`, [r.rows[0].id]);
    return { firmada: false, lineas: 0 };
  }
  if (r.rows[0].estado === "emitida") return { firmada: true, lineas };
  await db.query(
    `UPDATE recetas
        SET estado = 'emitida', emitido_en = now(), firmada_en = now(), firmada_por = $2
      WHERE id = $1`,
    [r.rows[0].id, personaId ?? null]
  );
  return { firmada: true, lineas };
}

// ---------------------------------------------------------------------
// REPETIR UNA RECETA ANTERIOR
//
// Copia las líneas a la atención actual y RECALCULA las dosis por kilo
// con el peso de hoy. No se copia el total viejo: un cachorro que pesaba
// 4 kg en marzo pesa 11 kg en agosto, y repetir la receta con la dosis
// de marzo es subdosificar.
// ---------------------------------------------------------------------

export async function repetirReceta(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  recetaOrigenId: string,
  personaId?: string
): Promise<{ copiadas: number; recalculadas: number }> {
  await exigirBorrador(db, atencionId);
  const origen = await db.query<{ paciente_id: string }>(
    `SELECT paciente_id FROM recetas WHERE id = $1`,
    [recetaOrigenId]
  );
  if (origen.rows.length === 0) throw new Error("Esa receta no existe.");
  const destino = await db.query<{ paciente_id: string }>(
    `SELECT paciente_id FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  if (origen.rows[0].paciente_id !== destino.rows[0].paciente_id) {
    throw new Error("Una receta solo se repite en el mismo paciente.");
  }

  const lineas = await lineasDeReceta(db, recetaOrigenId);
  let recalculadas = 0;
  for (const l of lineas) {
    const nueva = await agregarLinea(
      db,
      tenantId,
      atencionId,
      {
        medicamentoId: l.medicamentoId,
        presentacionId: l.presentacionId,
        textoLibre: l.textoLibre,
        dosisCantidad: l.dosisCantidad,
        dosisUnidad: l.dosisUnidad,
        dosisPorKg: l.dosisPorKg,
        viaCodigo: l.viaCodigo,
        frecuenciaCodigo: l.frecuenciaCodigo,
        duracionCantidad: l.duracionCantidad,
        duracionUnidad: l.duracionUnidad,
        // La cantidad y las indicaciones NO se copian: se vuelven a
        // generar con el peso de hoy.
        cantidadTotal: null,
        indicaciones: null,
        observaciones: l.observaciones,
        dispensadoAqui: l.dispensadoAqui,
      },
      personaId
    );
    if (l.dosisPorKg && nueva.dosisTotal !== l.dosisTotal) recalculadas += 1;
  }
  return { copiadas: lineas.length, recalculadas };
}

/** Las recetas anteriores del paciente, para elegir cuál repetir. */
export async function recetasAnteriores(
  db: PoolClient,
  pacienteId: string,
  excluirAtencionId?: string
): Promise<Array<{ id: string; fecha: string; medico: string; lineas: number; resumen: string }>> {
  const r = await db.query(
    `SELECT r.id, COALESCE(r.emitido_en, r.creado_en) AS fecha, p.nombre AS medico,
            count(ri.id)::int AS lineas,
            string_agg(ri.nombre_impreso, ', ' ORDER BY ri.orden) AS resumen
       FROM recetas r
       LEFT JOIN personas p ON p.id = r.medico_id
       LEFT JOIN receta_items ri ON ri.receta_id = r.id
       LEFT JOIN medicamentos m ON m.id = ri.medicamento_id
       LEFT JOIN inv_presentaciones pr ON pr.id = ri.presentacion_id
      WHERE r.paciente_id = $1
        AND ($2::uuid IS NULL OR r.atencion_id IS DISTINCT FROM $2::uuid)
      GROUP BY r.id, r.emitido_en, r.creado_en, p.nombre
     HAVING count(ri.id) > 0
      ORDER BY COALESCE(r.emitido_en, r.creado_en) DESC
      LIMIT 20`,
    [pacienteId, excluirAtencionId ?? null]
  );
  return r.rows.map((x: Record<string, unknown>) => ({
    id: x.id as string,
    fecha: String(x.fecha),
    medico: (x.medico as string) ?? "—",
    lineas: Number(x.lineas),
    resumen: (x.resumen as string) ?? "",
  }));
}

/**
 * La medicación activa del paciente: las líneas cuya duración todavía
 * no terminó. Es lo que alimenta la cabecera del expediente.
 */
export async function medicacionActiva(
  db: PoolClient,
  pacienteId: string
): Promise<Array<{ nombre: string; indicaciones: string | null; hasta: string }>> {
  const r = await db.query(
    `SELECT ri.nombre_impreso AS nombre,
            ri.indicaciones,
            (COALESCE(r.emitido_en, r.creado_en)::date + (
              ri.duracion_cantidad * CASE ri.duracion_unidad
                WHEN 'dias' THEN 1 WHEN 'semanas' THEN 7 ELSE 30 END
            ))::text AS hasta
       FROM receta_items ri
       JOIN recetas r ON r.id = ri.receta_id
       LEFT JOIN medicamentos m ON m.id = ri.medicamento_id
       LEFT JOIN inv_presentaciones pr ON pr.id = ri.presentacion_id
       LEFT JOIN inv_productos p ON p.id = pr.producto_id
      WHERE r.paciente_id = $1
        AND r.estado = 'emitida'
        AND ri.duracion_cantidad IS NOT NULL
        AND (COALESCE(r.emitido_en, r.creado_en)::date + (
              ri.duracion_cantidad * CASE ri.duracion_unidad
                WHEN 'dias' THEN 1 WHEN 'semanas' THEN 7 ELSE 30 END
            )) >= CURRENT_DATE
      ORDER BY 3`,
    [pacienteId]
  );
  return r.rows.map((x: Record<string, unknown>) => ({
    nombre: x.nombre as string,
    indicaciones: (x.indicaciones as string) ?? null,
    hasta: x.hasta as string,
  }));
}
