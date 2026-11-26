import { PoolClient } from "pg";
import { TRANSICIONES_VALIDAS, crearCita } from "../routes/citas.routes";
import { precioVigente } from "../inventario/precios";
import { registrarMovimiento } from "../inventario/movimientos";
import { abrirCuenta, agregarCargo } from "../ventas/cuentas";
import { agregarProblema, avisosDeAlergia, cerrarYFirmarAtencion } from "./clinico";

// ---------------------------------------------------------------------
// LA ATENCIÓN QUE GENERA CARGOS — prompt 07, bloque B.
//
// Dos ideas sostienen todo este archivo:
//
// 1. MIENTRAS LA ATENCIÓN ESTÁ EN BORRADOR NO HAY PLATA. El médico elige del
//    catálogo y ve un total, pero eso vive en `exp_atencion_items`, no
//    en la cuenta de nadie. Un cargo es plata que alguien va a cobrar; y
//    mientras la consulta está en curso todavía puede cambiar todo.
//
// 2. EL CIERRE ES UNA SOLA OPERACIÓN. Los cargos, la descarga de
//    inventario, los preventivos, el control, la cita y la firma pasan
//    juntos o no pasa nada. Es una transacción, y el caso que lo prueba
//    es el que no alcanza el stock: si la vacuna no está, la atención
//    queda en borrador y la cuenta no existe, en vez de quedar una consulta
//    cobrada con una vacuna que nunca se aplicó.
//
// Nada de lo que ya tiene dueño se reimplementa acá: el dinero entra por
// `agregarCargo`, el stock por `registrarMovimiento`, el precio por
// `precioVigente`, la cita por `crearCita` y el aviso de alergia por
// `avisosDeAlergia`. Este módulo es el que los pone en orden.
// ---------------------------------------------------------------------

export interface ItemDeAtencion {
  tipo: "servicio" | "producto" | "vacuna" | "desparasitacion" | "receta";
  servicioId?: string;
  presentacionId?: string;
  loteId?: string;
  cantidad: number;
  descuento?: number;
  listaPrecioId?: string | null;
  realizadoPor?: string;
  /** Para una vacuna o desparasitación: lo que necesita el preventivo. */
  preventivo?: {
    tipo: "vacunacion" | "desparasitacion";
    nombre: string;
    subtipo?: string;
    proxima?: string | null;
  };
  /** Un ítem de receta que el cliente compra afuera no se cobra acá. */
  dispensadoAqui?: boolean;
}

export interface AtencionAbierta {
  id: string;
  citaId: string;
  pacienteId: string;
  estado: string;
  creada: boolean;
}

// ---------------------------------------------------------------------
// ABRIR
//
// ATENCIÓN SIN CITA PREVIA: el paciente que llega sin turno es la mitad
// de un día normal, y el prompt pide que el médico no haga pasos extra.
// Así que la cita se crea acá, por `crearCita` —el único punto de
// creación de citas, con su detección de conflictos y su aviso— y queda
// en `en_consulta`, que es la verdad: el paciente está adentro.
// ---------------------------------------------------------------------
export async function abrirAtencion(
  db: PoolClient,
  tenantId: string,
  datos: {
    citaId?: string;
    pacienteId?: string;
    medicoId: string;
    motivoConsulta?: string;
    tipoConsulta?: string;
    duracionMinutos?: number;
  }
): Promise<AtencionAbierta> {
  let citaId = datos.citaId;

  if (!citaId) {
    if (!datos.pacienteId) {
      throw new Error("Para abrir una atención hace falta la cita o el paciente.");
    }
    const ahora = new Date();
    const cita = await crearCita(db, tenantId, {
      pacienteId: datos.pacienteId,
      medicoId: datos.medicoId,
      fecha: ahora.toISOString().slice(0, 10),
      horaInicio: ahora.toISOString().slice(11, 16),
      duracionMinutos: datos.duracionMinutos ?? 30,
      motivoConsulta: datos.motivoConsulta ?? "Atención sin cita previa",
    });
    citaId = cita.cita.id as string;
    // Sin turno pero ya adentro: el estado tiene que decir eso, y es la
    // transición que `guardarAtencion` necesita para poder completar.
    await db.query(`UPDATE citas SET estado = 'en_consulta', actualizado_en = now() WHERE id = $1`, [
      citaId,
    ]);
  }

  const existente = await db.query<{ id: string; paciente_id: string; estado: string }>(
    `SELECT id, paciente_id, estado FROM atenciones WHERE cita_id = $1`,
    [citaId]
  );
  if (existente.rows.length > 0) {
    const a = existente.rows[0];
    if (datos.tipoConsulta && a.estado === "borrador") {
      await aplicarPlantilla(db, tenantId, a.id, datos.tipoConsulta);
    }
    return {
      id: a.id,
      citaId: citaId!,
      pacienteId: a.paciente_id,
      estado: a.estado,
      creada: false,
    };
  }

  const cita = await db.query<{ paciente_id: string; motivo_consulta: string | null }>(
    `SELECT paciente_id, motivo_consulta FROM citas WHERE id = $1`,
    [citaId]
  );
  if (cita.rows.length === 0) throw new Error(`No existe la cita ${citaId}.`);

  const creada = await db.query<{ id: string }>(
    `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id, tipo_consulta,
                             motivo_consulta)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      tenantId,
      citaId,
      cita.rows[0].paciente_id,
      datos.medicoId,
      datos.tipoConsulta ?? null,
      datos.motivoConsulta ?? cita.rows[0].motivo_consulta,
    ]
  );

  if (datos.tipoConsulta) {
    await aplicarPlantilla(db, tenantId, creada.rows[0].id, datos.tipoConsulta);
  }

  return {
    id: creada.rows[0].id,
    citaId: citaId!,
    pacienteId: cita.rows[0].paciente_id,
    estado: "borrador",
    creada: true,
  };
}

// ---------------------------------------------------------------------
// LA PLANTILLA
//
// Siembra los sistemas a examinar en 'no_evaluado' y el texto sugerido
// de las secciones vacías. NO toca lo que el médico ya escribió: una
// plantilla que borra una nota es peor que no tener plantillas.
// ---------------------------------------------------------------------
export async function aplicarPlantilla(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  tipoConsulta: string
): Promise<{ plantillaId: string | null; sistemas: string[] }> {
  // La de la clínica gana sobre la de la plataforma: si una clínica
  // definió su propia consulta general, es la que vale.
  const p = await db.query<{
    id: string;
    sistemas: string[];
    motivo_sugerido: string | null;
    anamnesis_sugerida: string | null;
    plan_sugerido: string | null;
    indicaciones_sugeridas: string | null;
  }>(
    `SELECT id, sistemas, motivo_sugerido, anamnesis_sugerida, plan_sugerido,
            indicaciones_sugeridas
       FROM exp_plantillas_atencion
      WHERE tipo_consulta = $1 AND activo
      ORDER BY (tenant_id IS NOT NULL) DESC
      LIMIT 1`,
    [tipoConsulta]
  );
  if (p.rows.length === 0) return { plantillaId: null, sistemas: [] };
  const plantilla = p.rows[0];

  await db.query(
    `UPDATE atenciones
        SET tipo_consulta = $1,
            plantilla_id = $2,
            motivo_consulta = COALESCE(NULLIF(motivo_consulta, ''), $3),
            anamnesis = COALESCE(NULLIF(anamnesis, ''), $4),
            plan_tratamiento = COALESCE(NULLIF(plan_tratamiento, ''), $5),
            indicaciones_cliente = COALESCE(NULLIF(indicaciones_cliente, ''), $6),
            actualizado_en = now()
      WHERE id = $7`,
    [
      tipoConsulta,
      plantilla.id,
      plantilla.motivo_sugerido,
      plantilla.anamnesis_sugerida,
      plantilla.plan_sugerido,
      plantilla.indicaciones_sugeridas,
      atencionId,
    ]
  );

  for (const sistema of plantilla.sistemas) {
    await db.query(
      `INSERT INTO exp_examen_sistemas (tenant_id, atencion_id, sistema, estado)
       VALUES ($1,$2,$3,'no_evaluado')
       ON CONFLICT (atencion_id, sistema) DO NOTHING`,
      [tenantId, atencionId, sistema]
    );
  }

  return { plantillaId: plantilla.id, sistemas: plantilla.sistemas };
}

// ---------------------------------------------------------------------
// EL SOAP, guardado por partes
//
// Guardado automático: la pantalla manda lo que cambió cada pocos
// segundos, así que esto tiene que ser barato y no exigir nada. Un campo
// ausente no se toca; un campo en null explícito se borra.
// ---------------------------------------------------------------------
const CAMPOS_SOAP = [
  "tipo_consulta",
  "motivo_consulta",
  "anamnesis",
  "peso",
  "temperatura",
  "frecuencia_cardiaca",
  "frecuencia_respiratoria",
  "condicion_corporal",
  "mucosas",
  "tiempo_llenado_capilar",
  "hidratacion",
  "examen_general",
  "evaluacion",
  "plan_tratamiento",
  "indicaciones_cliente",
  "control_fecha",
  "control_motivo",
  "nota_medica",
] as const;

export async function guardarSoap(
  db: PoolClient,
  atencionId: string,
  campos: Record<string, unknown>
): Promise<void> {
  await exigirEnBorrador(db, atencionId);

  const asignaciones: string[] = [];
  const valores: unknown[] = [];
  for (const campo of CAMPOS_SOAP) {
    if (campo in campos) {
      valores.push(campos[campo] === "" ? null : campos[campo]);
      asignaciones.push(`${campo} = $${valores.length}`);
    }
  }
  if (asignaciones.length === 0) return;

  valores.push(atencionId);
  await db.query(
    `UPDATE atenciones SET ${asignaciones.join(", ")}, actualizado_en = now()
      WHERE id = $${valores.length}`,
    valores
  );
}

export async function marcarSistema(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  sistema: string,
  estado: "normal" | "anormal" | "no_evaluado",
  nota?: string | null
): Promise<void> {
  await exigirEnBorrador(db, atencionId);
  // La nota es de lo anormal. Marcar «normal» y dejar una nota vieja
  // ahí abajo es la forma de que el examen diga dos cosas a la vez.
  const notaFinal = estado === "anormal" ? nota ?? null : null;
  await db.query(
    `INSERT INTO exp_examen_sistemas (tenant_id, atencion_id, sistema, estado, nota)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (atencion_id, sistema)
       DO UPDATE SET estado = EXCLUDED.estado, nota = EXCLUDED.nota`,
    [tenantId, atencionId, sistema, estado, notaFinal]
  );
}

// ---------------------------------------------------------------------
// LOS DIAGNÓSTICOS
//
// `aLaListaDeProblemas` es la decisión del médico de que esto no es de
// esta visita sino del paciente. El problema se crea por el punto único
// del bloque A y queda uno solo, referenciado desde el diagnóstico.
// ---------------------------------------------------------------------
export async function agregarDiagnostico(
  db: PoolClient,
  tenantId: string,
  datos: {
    atencionId: string;
    tipo: "presuntivo" | "definitivo";
    descripcion: string;
    personaId?: string;
    aLaListaDeProblemas?: boolean;
  }
): Promise<{ id: string; problemaId: string | null }> {
  const atencion = await exigirEnBorrador(db, datos.atencionId);

  let problemaId: string | null = null;
  if (datos.aLaListaDeProblemas) {
    const problema = await agregarProblema(db, tenantId, {
      pacienteId: atencion.paciente_id,
      descripcion: datos.descripcion,
      atencionOrigenId: datos.atencionId,
      personaId: datos.personaId,
    });
    problemaId = problema.id;
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_diagnosticos (tenant_id, atencion_id, tipo, descripcion, problema_id,
                                   creado_por)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [tenantId, datos.atencionId, datos.tipo, datos.descripcion, problemaId, datos.personaId ?? null]
  );
  return { id: r.rows[0].id, problemaId };
}

// ---------------------------------------------------------------------
// AGREGAR LO REALIZADO
//
// El precio sale de `precioVigente` —el mismo punto que usa la caja— y
// se congela acá. La descripción también: lo que el médico vio al
// agregarlo es lo que el cliente va a leer en la factura.
// ---------------------------------------------------------------------
export async function agregarItem(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  item: ItemDeAtencion,
  personaId?: string
): Promise<{ id: string; descripcion: string; precioUnitario: number; total: number }> {
  await exigirEnBorrador(db, atencionId);
  if (item.cantidad <= 0) throw new Error("La cantidad tiene que ser mayor que cero.");

  let descripcion: string;
  let precio: number;
  let listaId: string | null = null;
  let lineaNegocio: string | null = null;
  let especialidad: string | null = null;

  if (item.servicioId) {
    const s = await db.query<{
      id: string;
      nombre: string;
      precio: string;
      linea_negocio: string | null;
      especialidad: string | null;
      activo: boolean;
    }>(
      `SELECT id, nombre, precio, linea_negocio, especialidad, activo
         FROM inv_servicios WHERE id = $1`,
      [item.servicioId]
    );
    if (s.rows.length === 0) throw new Error("Ese servicio no existe en el catálogo.");
    if (!s.rows[0].activo) throw new Error(`El servicio "${s.rows[0].nombre}" está inactivo.`);
    const vigente = await precioVigente(
      db,
      { servicioId: item.servicioId },
      { listaId: item.listaPrecioId ?? undefined }
    );
    descripcion = s.rows[0].nombre;
    precio = vigente.precio;
    listaId = vigente.listaId ?? null;
    lineaNegocio = s.rows[0].linea_negocio;
    especialidad = s.rows[0].especialidad;
  } else if (item.presentacionId) {
    const p = await db.query<{
      id: string;
      nombre: string;
      precio_venta: string | null;
      producto: string;
      producto_id: string;
      linea_negocio: string | null;
    }>(
      `SELECT pr.id, pr.nombre, pr.precio_venta, p.nombre AS producto, p.id AS producto_id,
              p.linea_negocio
         FROM inv_presentaciones pr
         JOIN inv_productos p ON p.id = pr.producto_id
        WHERE pr.id = $1`,
      [item.presentacionId]
    );
    if (p.rows.length === 0) throw new Error("Esa presentación no existe en el catálogo.");
    const vigente = await precioVigente(
      db,
      { presentacionId: item.presentacionId },
      { listaId: item.listaPrecioId ?? undefined }
    );
    // Precio cero es «sin precio»: `precioBase` devuelve 0 cuando la
    // presentación no tiene `precio_venta`, y dejar un ítem en ₡0 en la
    // cuenta de un cliente es regalar el producto sin que nadie lo
    // decida.
    if (!vigente.precio) {
      throw new Error(
        `"${p.rows[0].producto} — ${p.rows[0].nombre}" no tiene precio en el catálogo, ` +
          `y sin precio no se puede dejar en la cuenta del cliente.`
      );
    }
    descripcion = `${p.rows[0].producto} — ${p.rows[0].nombre}`;
    precio = vigente.precio;
    listaId = vigente.listaId ?? null;
    lineaNegocio = p.rows[0].linea_negocio;
  } else {
    throw new Error("Un ítem de la atención sale del catálogo: un servicio o una presentación.");
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_atencion_items
       (tenant_id, atencion_id, tipo, servicio_id, presentacion_id, lote_id, descripcion,
        cantidad, precio_unitario, descuento, lista_precio_id, linea_negocio, especialidad,
        realizado_por, preventivo_tipo, preventivo_nombre, preventivo_subtipo,
        preventivo_proxima, dispensado_aqui, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING id`,
    [
      tenantId,
      atencionId,
      item.tipo,
      item.servicioId ?? null,
      item.presentacionId ?? null,
      item.loteId ?? null,
      descripcion,
      item.cantidad,
      precio,
      item.descuento ?? 0,
      listaId,
      lineaNegocio,
      especialidad,
      item.realizadoPor ?? personaId ?? null,
      item.preventivo?.tipo ?? null,
      item.preventivo?.nombre ?? null,
      item.preventivo?.subtipo ?? null,
      item.preventivo?.proxima ?? null,
      item.dispensadoAqui ?? true,
      personaId ?? null,
    ]
  );

  return {
    id: r.rows[0].id,
    descripcion,
    precioUnitario: precio,
    total: precio * item.cantidad - (item.descuento ?? 0),
  };
}

export async function quitarItem(db: PoolClient, atencionId: string, itemId: string): Promise<void> {
  await exigirEnBorrador(db, atencionId);
  await db.query(`DELETE FROM exp_atencion_items WHERE id = $1 AND atencion_id = $2`, [
    itemId,
    atencionId,
  ]);
}

// ---------------------------------------------------------------------
// LA RECETA, con su aviso de alergia
//
// El aviso NO es una excepción: el médico puede tener una razón para
// recetar igual (una alergia leve, una reacción que no fue alérgica).
// Lo que no puede pasar es que no se le diga. Así que esto devuelve los
// avisos y quien llama decide; la pantalla los muestra antes de
// confirmar, y el verificador comprueba que estén.
// ---------------------------------------------------------------------
export async function avisosAlRecetar(
  db: PoolClient,
  pacienteId: string,
  presentacionId: string
): Promise<Array<{ porque: string; severidad: string; detalle: string }>> {
  // EL GRUPO FARMACOLÓGICO NO ESTÁ EN EL PRODUCTO: está en el catálogo
  // de medicamentos (`medicamentos.clase`), al que el producto apunta
  // con `medicamento_id`. Un producto de inventario sin medicamento
  // ligado no tiene grupo, y entonces el aviso por grupo no puede
  // dispararse — eso es un dato que falta en el catálogo, no un criterio
  // distinto.
  const p = await db.query<{
    nombre: string;
    producto: string;
    principio_activo: string | null;
    medicamento_id: string | null;
    grupo: string | null;
  }>(
    `SELECT pr.nombre, p.nombre AS producto, p.principio_activo, p.medicamento_id,
            m.clase AS grupo
       FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
       LEFT JOIN medicamentos m ON m.id = p.medicamento_id
      WHERE pr.id = $1`,
    [presentacionId]
  );
  if (p.rows.length === 0) return [];
  const avisos = await avisosDeAlergia(db, pacienteId, {
    medicamentoId: p.rows[0].medicamento_id ?? undefined,
    nombre: p.rows[0].producto,
    principioActivo: p.rows[0].principio_activo ?? undefined,
    grupo: p.rows[0].grupo ?? undefined,
  });
  return avisos.map((a) => ({
    porque: a.porque,
    severidad: a.alergia.severidad,
    detalle: a.alergia.reaccion ?? a.alergia.nota ?? a.alergia.sustancia,
  }));
}

// ---------------------------------------------------------------------
// LA CUENTA EN VIVO
//
// El mismo cálculo que la caja: neto, descuento y total por ítem. El
// impuesto NO se calcula acá: lo pone `agregarCargo` con la tarifa del
// catálogo, y adelantarlo con una tarifa supuesta sería tener dos
// criterios de IVA. La pantalla dice que el IVA se suma al cobrar.
// ---------------------------------------------------------------------
export async function cuentaViva(
  db: PoolClient,
  atencionId: string
): Promise<{
  items: Array<{
    id: string;
    tipo: string;
    descripcion: string;
    cantidad: number;
    precio_unitario: number;
    descuento: number;
    total: number;
    cobrado: boolean;
    dispensado_aqui: boolean;
  }>;
  total: number;
  yaCobrado: number;
}> {
  const r = await db.query<{
    id: string;
    tipo: string;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string;
    cargo_id: string | null;
    dispensado_aqui: boolean;
  }>(
    `SELECT id, tipo, descripcion, cantidad, precio_unitario, descuento, cargo_id,
            dispensado_aqui
       FROM exp_atencion_items WHERE atencion_id = $1 ORDER BY creado_en`,
    [atencionId]
  );

  const items = r.rows.map((i) => ({
    id: i.id,
    tipo: i.tipo,
    descripcion: i.descripcion,
    cantidad: Number(i.cantidad),
    precio_unitario: Number(i.precio_unitario),
    descuento: Number(i.descuento),
    total: Number(i.cantidad) * Number(i.precio_unitario) - Number(i.descuento),
    cobrado: i.cargo_id !== null,
    dispensado_aqui: i.dispensado_aqui,
  }));

  // Lo que el cliente compra afuera no entra en el total: no se lo
  // estamos vendiendo nosotros.
  const cobrables = items.filter((i) => i.dispensado_aqui);
  return {
    items,
    total: Math.round(cobrables.reduce((a, i) => a + i.total, 0) * 100) / 100,
    yaCobrado:
      Math.round(cobrables.filter((i) => i.cobrado).reduce((a, i) => a + i.total, 0) * 100) / 100,
  };
}

// ---------------------------------------------------------------------
// EL CIERRE
//
// Una sola operación coherente. El orden importa:
//
//   1. se toma el lock de la atención, para que dos pestañas abiertas no
//      cierren la misma atención dos veces;
//   2. si ya tiene cuenta, se termina acá: el cierre es idempotente y un
//      cargo no llega dos veces;
//   3. se abre o se reusa la cuenta del cliente;
//   4. cada ítem cobrable pasa por `agregarCargo`, que descarga el
//      inventario —con tipo `atencion` y vínculo al paciente— y escribe
//      el cargo. Si falta stock, `registrarMovimiento` falla y toda la
//      transacción se va atrás;
//   5. los insumos de cada servicio se descargan aparte: no se cobran,
//      pero se consumen;
//   6. los preventivos entran en `cuidados_preventivos`, que es lo que
//      el job diario lee para avisar;
//   7. el control recomendado se agenda por `crearCita`;
//   8. la cita pasa a completada y la atención queda firmada.
//
// La caja «recibe el aviso» por donde ya mira: la cuenta queda abierta y
// aparece en la pantalla de caja con su total. No hay una tabla de
// avisos nueva porque no hace falta otra cosa que una cuenta abierta.
// ---------------------------------------------------------------------
export interface ResultadoCierre {
  cuentaId: string;
  cuentaNumero: number;
  cargos: number;
  total: number;
  movimientos: number;
  preventivos: number;
  controlCitaId: string | null;
  yaEstabaCerrada: boolean;
}

export async function cerrarAtencion(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  datos: {
    personaId: string;
    sesionId?: string;
    bodegaId?: string;
    /** Para cobrar en la cuenta que el cliente ya tiene abierta. */
    cuentaId?: string;
  }
): Promise<ResultadoCierre> {
  // Un cierre por atención, incluso con dos pestañas abiertas. El lock
  // se suelta al terminar la transacción.
  await db.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `atencion:${atencionId}`,
  ]);

  const a = await db.query<{
    id: string;
    estado: string;
    cita_id: string;
    paciente_id: string;
    medico_id: string;
    cuenta_id: string | null;
    control_fecha: string | null;
    control_motivo: string | null;
    control_cita_id: string | null;
    nota_medica: string | null;
    evaluacion: string | null;
  }>(
    `SELECT id, estado, cita_id, paciente_id, medico_id, cuenta_id, control_fecha,
            control_motivo, control_cita_id, nota_medica, evaluacion
       FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  if (a.rows.length === 0) throw new Error(`No existe la atención ${atencionId}.`);
  const atencion = a.rows[0];

  if (atencion.cuenta_id) {
    const yaCuenta = await db.query<{ numero: number }>(
      `SELECT numero FROM vta_cuentas WHERE id = $1`,
      [atencion.cuenta_id]
    );
    const total = await cuentaViva(db, atencionId);
    return {
      cuentaId: atencion.cuenta_id,
      cuentaNumero: yaCuenta.rows[0]?.numero ?? 0,
      cargos: 0,
      total: total.yaCobrado,
      movimientos: 0,
      preventivos: 0,
      controlCitaId: atencion.control_cita_id,
      yaEstabaCerrada: true,
    };
  }

  // Una atención sin nada escrito no se cierra: el expediente queda con
  // una visita vacía y nadie sabe qué pasó.
  if (!atencion.nota_medica && !atencion.evaluacion) {
    throw new Error(
      "La atención no tiene evaluación ni nota médica: eso es lo que queda en el expediente."
    );
  }

  const paciente = await db.query<{ propietario_id: string }>(
    `SELECT propietario_id FROM pacientes WHERE id = $1`,
    [atencion.paciente_id]
  );

  const items = await db.query<{
    id: string;
    tipo: string;
    servicio_id: string | null;
    presentacion_id: string | null;
    lote_id: string | null;
    descripcion: string;
    cantidad: string;
    precio_unitario: string;
    descuento: string;
    lista_precio_id: string | null;
    dispensado_aqui: boolean;
    preventivo_tipo: string | null;
    preventivo_nombre: string | null;
    preventivo_subtipo: string | null;
    preventivo_proxima: string | null;
  }>(
    `SELECT id, tipo, servicio_id, presentacion_id, lote_id, descripcion, cantidad,
            precio_unitario, descuento, lista_precio_id, dispensado_aqui, preventivo_tipo,
            preventivo_nombre, preventivo_subtipo, preventivo_proxima
       FROM exp_atencion_items
      WHERE atencion_id = $1 AND cargo_id IS NULL
      ORDER BY creado_en`,
    [atencionId]
  );

  // La cuenta: la que el cliente ya tiene abierta, o una nueva.
  let cuentaId = datos.cuentaId;
  let cuentaNumero = 0;
  if (!cuentaId) {
    const cuenta = await abrirCuenta(db, tenantId, {
      propietarioId: paciente.rows[0]?.propietario_id,
      sesionId: datos.sesionId,
    });
    cuentaId = cuenta.id;
    cuentaNumero = cuenta.numero;
  } else {
    const n = await db.query<{ numero: number }>(`SELECT numero FROM vta_cuentas WHERE id = $1`, [
      cuentaId,
    ]);
    cuentaNumero = n.rows[0]?.numero ?? 0;
  }

  let cargos = 0;
  let total = 0;
  let movimientos = 0;

  for (const item of items.rows) {
    if (!item.dispensado_aqui) continue;

    const cargo = await agregarCargo(db, tenantId, {
      cuentaId,
      origen: "atencion",
      origenId: atencionId,
      atencionId,
      servicioId: item.servicio_id ?? undefined,
      presentacionId: item.presentacion_id ?? undefined,
      loteId: item.lote_id ?? undefined,
      descripcion: item.descripcion,
      pacienteId: atencion.paciente_id,
      cantidad: Number(item.cantidad),
      // El precio congelado del ítem gana: es el que el médico vio y el
      // que el cliente escuchó. Volver a consultar el catálogo acá
      // podría cobrar otro número.
      precioUnitario: Number(item.precio_unitario),
      descuento: Number(item.descuento) > 0 ? Number(item.descuento) : undefined,
      descuentoCodigo: Number(item.descuento) > 0 ? "01" : undefined,
      descuentoNaturaleza:
        Number(item.descuento) > 0 ? "Descuento aplicado en la atención" : undefined,
      listaPrecioId: item.lista_precio_id,
      personaId: datos.personaId,
      bodegaId: datos.bodegaId,
    });

    await db.query(
      `UPDATE exp_atencion_items SET cargo_id = $1, movimiento_id = $2 WHERE id = $3`,
      [cargo.id, cargo.movimientoId ?? null, item.id]
    );
    cargos += 1;
    total += cargo.total;
    if (cargo.movimientoId) movimientos += 1;

    // LOS INSUMOS DEL SERVICIO: se consumen y no se cobran aparte —su
    // costo está en el precio del servicio—, pero el stock tiene que
    // bajar. Es el «incluida la receta de insumos de cada servicio» del
    // prompt.
    if (item.servicio_id) {
      movimientos += await descargarInsumos(db, tenantId, {
        servicioId: item.servicio_id,
        veces: Number(item.cantidad),
        atencionId,
        pacienteId: atencion.paciente_id,
        personaId: datos.personaId,
        bodegaId: datos.bodegaId,
      });
    }
  }

  // LOS PREVENTIVOS. Van a `cuidados_preventivos` porque es la tabla que
  // el job diario mira para avisar: si se guardaran en otro lado, el
  // aviso no saldría nunca.
  let preventivos = 0;
  for (const item of items.rows) {
    if (!item.preventivo_tipo) continue;
    const lote = item.lote_id
      ? await db.query<{ numero: string }>(`SELECT numero FROM inv_lotes WHERE id = $1`, [
          item.lote_id,
        ])
      : { rows: [] as Array<{ numero: string }> };
    await db.query(
      `INSERT INTO cuidados_preventivos
         (tenant_id, paciente_id, tipo, fecha_aplicacion, fecha_proxima_recomendada,
          registrado_por, vacuna, lote, subtipo_desparasitacion, producto_desparasitacion,
          atencion_id)
       VALUES ($1,$2,$3,CURRENT_DATE,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tenantId,
        atencion.paciente_id,
        item.preventivo_tipo,
        item.preventivo_proxima,
        datos.personaId,
        item.preventivo_tipo === "vacunacion" ? item.preventivo_nombre : null,
        lote.rows[0]?.numero ?? null,
        item.preventivo_tipo === "desparasitacion" ? item.preventivo_subtipo ?? "interna" : null,
        item.preventivo_tipo === "desparasitacion" ? item.preventivo_nombre : null,
        atencionId,
      ]
    );
    preventivos += 1;
  }

  // EL CONTROL. Una cita programada, por `crearCita`: de ahí sale el
  // recordatorio al cliente sin inventar un tipo de aviso nuevo.
  let controlCitaId = atencion.control_cita_id;
  if (atencion.control_fecha && !controlCitaId) {
    const cita = await crearCita(db, tenantId, {
      pacienteId: atencion.paciente_id,
      medicoId: atencion.medico_id,
      fecha: comoFecha(atencion.control_fecha),
      horaInicio: "09:00",
      duracionMinutos: 20,
      motivoConsulta: atencion.control_motivo ?? "Control",
    });
    controlCitaId = cita.cita.id as string;
  }

  // LA CITA Y LA FIRMA. El estado de la cita se mueve con la misma
  // máquina de estados de la agenda: completar una cita cancelada sigue
  // sin poder pasar.
  const cita = await db.query<{ estado: string }>(`SELECT estado FROM citas WHERE id = $1`, [
    atencion.cita_id,
  ]);
  if (cita.rows[0]?.estado !== "completada") {
    if (!TRANSICIONES_VALIDAS[cita.rows[0]?.estado ?? ""]?.includes("completada")) {
      throw new Error(
        `La cita está en estado '${cita.rows[0]?.estado}' y desde ahí no se puede completar. ` +
          `Revisá el estado de la cita en la agenda.`
      );
    }
    await db.query(`UPDATE citas SET estado = 'completada', actualizado_en = now() WHERE id = $1`, [
      atencion.cita_id,
    ]);
  }

  // LA FIRMA la pone el punto único del bloque A: es el que exige que
  // quien firma sea médico. Acá solo se agrega lo que este bloque sabe
  // —la cuenta y la cita del control—.
  await cerrarYFirmarAtencion(db, atencionId, datos.personaId);
  await db.query(
    `UPDATE atenciones SET cuenta_id = $1, control_cita_id = $2, actualizado_en = now()
      WHERE id = $3`,
    [cuentaId, controlCitaId, atencionId]
  );

  return {
    cuentaId,
    cuentaNumero,
    cargos,
    total: Math.round(total * 100) / 100,
    movimientos,
    preventivos,
    controlCitaId,
    yaEstabaCerrada: false,
  };
}

// ---------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------

async function descargarInsumos(
  db: PoolClient,
  tenantId: string,
  datos: {
    servicioId: string;
    veces: number;
    atencionId: string;
    pacienteId: string;
    personaId: string;
    bodegaId?: string;
  }
): Promise<number> {
  const insumos = await db.query<{ presentacion_id: string; cantidad: string; producto_id: string }>(
    `SELECT si.presentacion_id, si.cantidad, pr.producto_id
       FROM inv_servicio_insumos si
       JOIN inv_presentaciones pr ON pr.id = si.presentacion_id
      WHERE si.servicio_id = $1`,
    [datos.servicioId]
  );
  if (insumos.rows.length === 0) return 0;

  const bodegaId = datos.bodegaId ?? (await bodegaPorDefecto(db));
  let hechos = 0;
  for (const insumo of insumos.rows) {
    const movs = await registrarMovimiento(db, tenantId, {
      tipo: "atencion",
      productoId: insumo.producto_id,
      bodegaId,
      presentacionId: insumo.presentacion_id,
      cantidadPresentacion: Number(insumo.cantidad) * datos.veces,
      pacienteId: datos.pacienteId,
      atencionId: datos.atencionId,
      personaId: datos.personaId,
      motivoDetalle: "Insumo consumido en la atención",
    });
    hechos += movs.length;
  }
  return hechos;
}

/**
 * Una columna DATE vuelve de node-postgres como `Date`, y
 * `String(date).slice(0, 10)` da "Fri Dec 11": Postgres lo rechaza.
 * Ya pasó antes con una comparación de fechas en las notificaciones, así
 * que acá va una sola función en vez de un `slice` repetido.
 */
function comoFecha(valor: unknown): string {
  if (valor instanceof Date) return valor.toISOString().slice(0, 10);
  return String(valor).slice(0, 10);
}

async function bodegaPorDefecto(db: PoolClient): Promise<string> {
  const b = await db.query<{ id: string }>(
    `SELECT id FROM inv_bodegas WHERE es_default AND activo LIMIT 1`
  );
  if (b.rows.length === 0) {
    throw new Error("No hay bodega por defecto de la que descontar los insumos.");
  }
  return b.rows[0].id;
}

async function exigirEnBorrador(
  db: PoolClient,
  atencionId: string
): Promise<{ id: string; paciente_id: string; estado: string }> {
  const r = await db.query<{ id: string; paciente_id: string; estado: string }>(
    `SELECT id, paciente_id, estado FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  if (r.rows.length === 0) throw new Error(`No existe la atención ${atencionId}.`);
  if (r.rows[0].estado !== "borrador") {
    throw new Error(
      `La atención está en estado ${r.rows[0].estado} y lo que ya se firmó no se edita: ` +
        `la corrección es una adenda.`
    );
  }
  return r.rows[0];
}

// ---------------------------------------------------------------------
// LECTURA: la atención completa, para la pantalla
// ---------------------------------------------------------------------
export async function atencionCompleta(
  db: PoolClient,
  atencionId: string
): Promise<Record<string, unknown>> {
  const a = await db.query(
    `SELECT a.*, c.fecha AS cita_fecha, c.hora_inicio, c.estado AS cita_estado,
            p.nombre AS paciente_nombre, p.especie, p.propietario_id,
            m.nombre AS medico_nombre, cu.numero AS cuenta_numero
       FROM atenciones a
       JOIN citas c ON c.id = a.cita_id
       JOIN pacientes p ON p.id = a.paciente_id
       LEFT JOIN personas m ON m.id = a.medico_id
       LEFT JOIN vta_cuentas cu ON cu.id = a.cuenta_id
      WHERE a.id = $1`,
    [atencionId]
  );
  if (a.rows.length === 0) throw new Error(`No existe la atención ${atencionId}.`);

  const sistemas = await db.query(
    `SELECT sistema, estado, nota FROM exp_examen_sistemas
      WHERE atencion_id = $1 ORDER BY creado_en`,
    [atencionId]
  );
  const diagnosticos = await db.query(
    `SELECT d.id, d.tipo, d.descripcion, d.problema_id, p.nombre AS creado_por_nombre
       FROM exp_diagnosticos d
       LEFT JOIN personas p ON p.id = d.creado_por
      WHERE d.atencion_id = $1 ORDER BY d.creado_en`,
    [atencionId]
  );
  const cuenta = await cuentaViva(db, atencionId);

  return {
    atencion: a.rows[0],
    sistemas: sistemas.rows,
    diagnosticos: diagnosticos.rows,
    items: cuenta.items,
    total: cuenta.total,
  };
}
