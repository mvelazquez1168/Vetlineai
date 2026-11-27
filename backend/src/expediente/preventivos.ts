import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// VACUNAS, DESPARASITACIONES Y ESTUDIOS — prompt 07c, secciones 1 y 3.
//
// El 07 ya sabe registrar las tres cosas. Lo que faltaba era PODER
// DECIRLO: una vacuna se registraba entrando por «Producto» y marcando
// «¿es un preventivo?» en una casilla dentro de un modal. Funciona, y
// nadie lo encuentra.
//
// Acá no hay ningún camino nuevo para el dinero ni para el stock: la
// acción «Vacuna» termina llamando al mismo `agregarItem` que todo lo
// demás. Lo que agrega este módulo es el FILTRO (qué productos son
// vacunas) y la SUGERENCIA (cuándo toca la próxima).
// ---------------------------------------------------------------------

export type TipoClinico = "vacuna" | "antiparasitario" | "medicamento" | "insumo" | "otro";

export interface ProductoParaAtencion {
  presentacionId: string;
  productoId: string;
  nombre: string;
  presentacion: string;
  tipoClinico: TipoClinico | null;
  requiereReceta: boolean;
  precio: number | null;
  /** Lotes con existencia, en orden FEFO. El primero es el sugerido. */
  lotes: Array<{ id: string; numero: string; vence: string | null; cantidad: number }>;
}

/**
 * Los productos que puede ofrecer una acción de la atención.
 *
 * `tipoClinico` filtra: la acción «Vacuna» pide 'vacuna' y no muestra
 * nada más. La acción «Producto» pide lo contrario —lo que NO es
 * preventivo ni medicamento recetado—, porque para eso están las otras
 * acciones.
 */
export async function productosParaAtencion(
  db: PoolClient,
  opciones: { tipoClinico?: TipoClinico; excluir?: TipoClinico[]; busqueda?: string }
): Promise<ProductoParaAtencion[]> {
  const condiciones: string[] = ["p.activo"];
  const params: unknown[] = [];

  if (opciones.tipoClinico) {
    params.push(opciones.tipoClinico);
    condiciones.push(`p.tipo_clinico = $${params.length}`);
  }
  if (opciones.excluir?.length) {
    params.push(opciones.excluir);
    // `IS DISTINCT FROM ALL` no existe: un producto sin clasificar
    // (NULL) SÍ se muestra en «Producto». No clasificar algo no puede
    // esconderlo de la única acción general que queda.
    condiciones.push(`(p.tipo_clinico IS NULL OR p.tipo_clinico <> ALL($${params.length}))`);
  }
  if (opciones.busqueda) {
    params.push(`%${opciones.busqueda}%`);
    condiciones.push(`(p.nombre ILIKE $${params.length} OR p.codigo ILIKE $${params.length})`);
  }

  const r = await db.query(
    `SELECT pr.id AS presentacion_id, p.id AS producto_id, p.nombre, pr.nombre AS presentacion,
            p.tipo_clinico, p.requiere_receta, pr.precio_venta
       FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
      WHERE ${condiciones.join(" AND ")}
      ORDER BY p.nombre, pr.nombre
      LIMIT 100`,
    params
  );

  const salida: ProductoParaAtencion[] = [];
  for (const x of r.rows as Record<string, unknown>[]) {
    // LOS LOTES EN ORDEN FEFO, el mismo criterio que usa la salida de
    // inventario. Si la pantalla sugiriera otro lote que el que después
    // va a salir, el número impreso en la cartilla de vacunación sería
    // el equivocado.
    const lotes = await db.query(
      `SELECT l.id, l.numero, l.vencimiento::text AS vence, l.cantidad
         FROM inv_lotes l
        WHERE l.producto_id = $1 AND l.cantidad > 0
        ORDER BY l.vencimiento NULLS LAST, l.creado_en
        LIMIT 20`,
      [x.producto_id]
    );
    salida.push({
      presentacionId: x.presentacion_id as string,
      productoId: x.producto_id as string,
      nombre: x.nombre as string,
      presentacion: x.presentacion as string,
      tipoClinico: (x.tipo_clinico as TipoClinico) ?? null,
      requiereReceta: Boolean(x.requiere_receta),
      precio: x.precio_venta === null ? null : Number(x.precio_venta),
      lotes: (lotes.rows as Record<string, unknown>[]).map((l) => ({
        id: l.id as string,
        numero: (l.numero as string) ?? "—",
        vence: (l.vence as string) ?? null,
        cantidad: Number(l.cantidad),
      })),
    });
  }
  return salida;
}

// ---------------------------------------------------------------------
// CUÁNDO TOCA LA PRÓXIMA
//
// El protocolo más específico gana: el del producto, si lo hay; si no,
// el de la especie; si no, el general. Y si no hay ninguno, se devuelve
// null y la pantalla pide la fecha: una fecha inventada en una cartilla
// de vacunación es peor que un campo vacío.
// ---------------------------------------------------------------------

export async function proximaSugerida(
  db: PoolClient,
  datos: {
    tipo: "vacunacion" | "desparasitacion";
    especie?: string | null;
    productoId?: string | null;
    nombre?: string | null;
    desde?: string;
  }
): Promise<{ fecha: string; meses: number; origen: string } | null> {
  const r = await db.query<{ meses_hasta_proxima: number; nombre: string; especie: string | null; producto_id: string | null }>(
    // EL NOMBRE ORDENA, NO FILTRA. Era un filtro y el efecto fue que un
    // producto llamado "Vacuna polivalente canina" no encontraba el
    // protocolo "Polivalente" —ni ningun otro— y la pantalla pedia la
    // fecha a mano. Un nombre que no coincide no quiere decir que no
    // haya protocolo: quiere decir que hay que caer al de la especie, y
    // si no, al general.
    //
    // El orden es de lo mas especifico a lo mas general: el del
    // producto, el del nombre exacto, el de la especie, el general; y
    // entre dos iguales, el de la clinica le gana al de fabrica.
    `SELECT meses_hasta_proxima, nombre, especie, producto_id
       FROM exp_protocolos_preventivos
      WHERE activo AND tipo = $1
        AND (producto_id IS NULL OR producto_id = $2::uuid)
        -- lower() en los dos lados: la ficha guarda "Canino" con
        -- mayuscula y el protocolo "canino", y la comparacion exacta
        -- hacia que el protocolo de la especie no se encontrara nunca.
        -- Se vio en el navegador: una desparasitacion interna de un
        -- perro sugeria un mes (el protocolo general) en vez de tres.
        AND (especie IS NULL OR lower(especie) = lower($3))
      ORDER BY (producto_id IS NOT NULL) DESC,
               ($4::text IS NOT NULL AND nombre = $4) DESC,
               ($4::text IS NOT NULL AND $4 ILIKE '%' || nombre || '%') DESC,
               (especie IS NOT NULL) DESC,
               (tenant_id IS NOT NULL) DESC,
               meses_hasta_proxima
      LIMIT 1`,
    [datos.tipo, datos.productoId ?? null, datos.especie ?? null, datos.nombre ?? null]
  );
  if (r.rows.length === 0) return null;

  const meses = r.rows[0].meses_hasta_proxima;
  const base = datos.desde ? new Date(datos.desde) : new Date();
  const fecha = new Date(base);
  fecha.setMonth(fecha.getMonth() + meses);
  return {
    fecha: fecha.toISOString().slice(0, 10),
    meses,
    origen: r.rows[0].producto_id
      ? "el protocolo de este producto"
      : r.rows[0].especie
        ? `el protocolo de la especie (${r.rows[0].especie})`
        : "el protocolo general de la clínica",
  };
}

/** Los protocolos que la clínica ve y puede cambiar. */
export async function protocolos(
  db: PoolClient
): Promise<Array<{ id: string; tipo: string; especie: string | null; nombre: string; meses: number; propio: boolean }>> {
  const r = await db.query(
    `SELECT id, tipo, especie, nombre, meses_hasta_proxima, tenant_id IS NOT NULL AS propio
       FROM exp_protocolos_preventivos
      WHERE activo
      ORDER BY tipo, especie NULLS FIRST, nombre`
  );
  return r.rows.map((x: Record<string, unknown>) => ({
    id: x.id as string,
    tipo: x.tipo as string,
    especie: (x.especie as string) ?? null,
    nombre: x.nombre as string,
    meses: Number(x.meses_hasta_proxima),
    propio: Boolean(x.propio),
  }));
}

// ---------------------------------------------------------------------
// EL REGISTRO HISTÓRICO
//
// Una vacuna puesta el año pasado en otra clínica. NO pasa por la
// atención: no se aplicó nada acá, así que no hay cargo ni salida de
// inventario que registrar. Se marca `historico` para que nadie la
// confunda con producción de esta clínica.
// ---------------------------------------------------------------------

export async function registrarHistorico(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    tipo: "vacunacion" | "desparasitacion";
    nombre: string;
    subtipo?: string | null;
    fechaAplicacion: string;
    fechaProxima?: string | null;
    lote?: string | null;
    lugar?: string | null;
  },
  personaId: string
): Promise<{ id: string; proxima: string }> {
  if (!datos.nombre?.trim()) {
    throw new Error("Un registro histórico lleva el nombre de lo que se aplicó.");
  }
  if (new Date(datos.fechaAplicacion) > new Date()) {
    throw new Error("Un registro histórico es de algo que ya pasó: la fecha no puede ser futura.");
  }

  // Sin próxima explícita, la del protocolo contada DESDE LA APLICACIÓN,
  // no desde hoy. Una vacuna de hace once meses tiene que quedar
  // venciendo el mes que viene, no dentro de un año.
  let proxima = datos.fechaProxima ?? null;
  if (!proxima) {
    const esp = await db.query<{ especie: string | null }>(
      `SELECT especie FROM pacientes WHERE id = $1`,
      [datos.pacienteId]
    );
    const sug = await proximaSugerida(db, {
      tipo: datos.tipo,
      especie: esp.rows[0]?.especie ?? null,
      nombre: datos.nombre,
      desde: datos.fechaAplicacion,
    });
    proxima = sug?.fecha ?? null;
  }
  if (!proxima) {
    throw new Error(
      "No hay protocolo para eso, así que la próxima fecha hay que indicarla: sin ella el aviso nunca se dispara."
    );
  }

  const r = await db.query<{ id: string }>(
    `INSERT INTO cuidados_preventivos
       (tenant_id, paciente_id, tipo, fecha_aplicacion, fecha_proxima_recomendada,
        registrado_por, vacuna, subtipo_desparasitacion, producto_desparasitacion,
        lote, lugar, historico)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)
     RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.tipo,
      datos.fechaAplicacion,
      proxima,
      personaId,
      datos.tipo === "vacunacion" ? datos.nombre : null,
      datos.tipo === "desparasitacion" ? (datos.subtipo ?? null) : null,
      datos.tipo === "desparasitacion" ? datos.nombre : null,
      datos.lote ?? null,
      datos.lugar ?? null,
    ]
  );
  return { id: r.rows[0].id, proxima };
}

// ---------------------------------------------------------------------
// EL ESTUDIO PEDIDO DESDE LA ATENCIÓN
//
// La misma orden que crea la pestaña Laboratorio, ligada a la atención.
// Si se hace acá y tiene un servicio del catálogo, el cargo entra a la
// atención como cualquier otra cosa que se hizo: por `agregarItem`.
// ---------------------------------------------------------------------

export async function pedirEstudio(
  db: PoolClient,
  tenantId: string,
  atencionId: string,
  datos: {
    tipoEstudio: string;
    esExterno: boolean;
    laboratorio?: string | null;
    servicioId?: string | null;
    observaciones?: string | null;
    /** Anexo 07-03, A6: el laboratorio ya se hizo y se carga su resultado. */
    conResultado?: boolean;
    fechaMuestra?: string | null;
  },
  personaId: string
): Promise<{ id: string; conCargo: boolean }> {
  const a = await db.query<{ paciente_id: string; estado: string }>(
    `SELECT paciente_id, estado FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  if (a.rows.length === 0) throw new Error("Esa atención no existe.");
  if (a.rows[0].estado !== "borrador") {
    throw new Error("La atención ya está cerrada: un estudio nuevo va en una adenda.");
  }
  if (datos.esExterno && !datos.laboratorio?.trim()) {
    throw new Error("Un estudio externo lleva a qué laboratorio se envió.");
  }
  if (!datos.esExterno && datos.laboratorio) {
    throw new Error("Un estudio que se hace acá no se envía a ningún laboratorio externo.");
  }

  let itemId: string | null = null;
  if (datos.servicioId) {
    if (datos.esExterno) {
      // Se podría cobrar igual, pero entonces el cargo sería del envío y
      // no del estudio, y nadie sabría cuál de los dos. Se deja dicho.
      throw new Error(
        "Un estudio externo no lleva servicio del catálogo: lo que se cobra es el envío, y eso se agrega como servicio aparte."
      );
    }
    const { agregarItem } = await import("./atencion");
    const item = await agregarItem(
      db,
      tenantId,
      atencionId,
      { tipo: "servicio", servicioId: datos.servicioId, cantidad: 1 },
      personaId
    );
    itemId = item.id;
  }

  // EL INSERT NO ESTÁ ACÁ (anexo 07-03, A6). Lo hace `solicitarEstudio`,
  // que es el único punto que crea un estudio: acá vive la regla del
  // CARGO, que es lo propio de la atención. Dos INSERT a la misma tabla
  // eran dos lugares donde agregar una columna nueva, y uno de los dos
  // se iba a olvidar.
  const { solicitarEstudio } = await import("./laboratorio");
  const creado = await solicitarEstudio(db, tenantId, {
    pacienteId: a.rows[0].paciente_id,
    atencionId,
    tipoEstudio: datos.tipoEstudio,
    esExterno: datos.esExterno,
    laboratorio: datos.laboratorio ?? undefined,
    observaciones: datos.observaciones ?? undefined,
    personaId,
    servicioId: datos.servicioId ?? null,
    atencionItemId: itemId,
    fechaMuestra: datos.fechaMuestra ?? null,
    conResultado: datos.conResultado === true,
  });
  return { id: creado.id, conCargo: itemId !== null };
}

/** Los estudios pedidos en esta atención, para el panel y el cierre. */
export async function estudiosDeAtencion(
  db: PoolClient,
  atencionId: string
): Promise<Array<{ id: string; tipo: string; externo: boolean; laboratorio: string | null; estado: string }>> {
  const r = await db.query(
    `SELECT id, tipo_estudio, es_externo, laboratorio, estado
       FROM exp_estudios_lab WHERE atencion_id = $1 ORDER BY creado_en`,
    [atencionId]
  );
  return r.rows.map((x: Record<string, unknown>) => ({
    id: x.id as string,
    tipo: x.tipo_estudio as string,
    externo: Boolean(x.es_externo),
    laboratorio: (x.laboratorio as string) ?? null,
    estado: x.estado as string,
  }));
}
