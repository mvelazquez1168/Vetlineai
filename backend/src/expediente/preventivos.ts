import { PoolClient } from "pg";
import { registrarInteraccion } from "../crm/interacciones";

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

/**
 * La posología que la clínica cargó para este producto (anexo 07-03,
 * A3). Se PRECARGA en la línea de receta y el médico la ajusta: es una
 * sugerencia del catálogo, no una indicación.
 *
 * Las columnas existen desde la migración 111 y hasta ahora no las leía
 * nadie.
 */
export interface PosologiaSugerida {
  dosisPorKg: number | null;
  dosisFija: number | null;
  unidadDosis: string | null;
  viaAdministracion: string | null;
  frecuencia: string | null;
  duracionCantidad: number | null;
  duracionUnidad: "dias" | "semanas" | "meses" | null;
}

export interface ProductoParaAtencion {
  presentacionId: string;
  productoId: string;
  nombre: string;
  presentacion: string;
  /** Lo que se busca además del nombre, y lo que se muestra para elegir. */
  codigo: string | null;
  principioActivo: string | null;
  concentracion: string | null;
  codigoBarras: string | null;
  tipoClinico: TipoClinico | null;
  requiereReceta: boolean;
  precio: number | null;
  /** Existencia total, en la unidad de la presentación. */
  existencia: number;
  /** Null si la clínica no cargó ninguna para este producto. */
  posologia: PosologiaSugerida | null;
  /** Lotes con existencia, en orden FEFO. El primero es el sugerido. */
  lotes: Array<{ id: string; numero: string; vence: string | null; cantidad: number }>;
}

/**
 * Los productos que puede ofrecer una acción de la atención.
 *
 * DEFECTO DEL 2026-11-27, y define esta función entera: `tipo_clinico`
 * filtraba con `=`, y la migración 115 dejó en NULL todo lo que no era
 * evidente. Con el catálogo real cargado —897 productos en la clínica de
 * `demo.medico`, 891 de ellos sin clasificar— la receta ofrecía UN
 * producto: la Amoxicilina, la única con `tipo_clinico = medicamento`.
 * El médico no podía recetar.
 *
 * ASÍ QUE LO SIN CLASIFICAR SE MUESTRA, con su etiqueta. Un dato que
 * falta no puede esconder el producto: esconderlo convierte un catálogo
 * incompleto en un sistema inservible. `incluirSinClasificar` es lo que
 * lo permite, y la pantalla ofrece clasificarlo ahí mismo.
 *
 * LA BÚSQUEDA ES POR CINCO CAMPOS, no por el nombre: en una clínica se
 * busca «amoxi» (nombre), «7501234…» (código de barras, con el lector),
 * «MED-0042» (código interno) y «enrofloxacina» (principio activo, que
 * es como el médico piensa el medicamento y casi nunca coincide con el
 * nombre comercial).
 */
export async function productosParaAtencion(
  db: PoolClient,
  opciones: {
    tipoClinico?: TipoClinico;
    /** Mostrar también los que no tienen tipo clínico asignado. */
    incluirSinClasificar?: boolean;
    excluir?: TipoClinico[];
    busqueda?: string;
    limite?: number;
  }
): Promise<ProductoParaAtencion[]> {
  const condiciones: string[] = ["p.activo", "pr.activo", "pr.para_venta"];
  const params: unknown[] = [];

  if (opciones.tipoClinico) {
    params.push(opciones.tipoClinico);
    condiciones.push(
      opciones.incluirSinClasificar
        ? `(p.tipo_clinico = $${params.length} OR p.tipo_clinico IS NULL)`
        : `p.tipo_clinico = $${params.length}`
    );
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
    const n = params.length;
    condiciones.push(
      `(p.nombre ILIKE $${n} OR p.codigo ILIKE $${n} OR p.principio_activo ILIKE $${n}
        OR pr.codigo_barras ILIKE $${n} OR pr.codigo_interno ILIKE $${n})`
    );
  }

  params.push(Math.min(opciones.limite ?? 100, 200));

  const r = await db.query(
    `SELECT pr.id AS presentacion_id, p.id AS producto_id, p.nombre, pr.nombre AS presentacion,
            p.codigo, p.principio_activo, p.concentracion, pr.codigo_barras,
            p.tipo_clinico, p.requiere_receta, pr.precio_venta,
            p.dosis_por_kg, p.dosis_fija, p.unidad_dosis, p.via_administracion,
            p.frecuencia_sugerida, p.duracion_sugerida_cantidad, p.duracion_sugerida_unidad,
            -- LA EXISTENCIA, en la unidad de la presentacion. Es lo que
            -- el medico necesita saber ANTES de elegir: recetar algo que
            -- no hay es una receta que el cliente no puede llenar.
            COALESCE(ex.total, 0) / NULLIF(pr.factor, 0) AS existencia
       FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
       LEFT JOIN LATERAL (
         SELECT sum(l.cantidad) AS total FROM inv_lotes l
          WHERE l.producto_id = p.id AND l.cantidad > 0
       ) ex ON true
      WHERE ${condiciones.join(" AND ")}
      -- LOS CLASIFICADOS PRIMERO: lo que la clinica ya curo vale mas que
      -- lo que todavia nadie miro.
      ORDER BY (p.tipo_clinico IS NULL), p.nombre, pr.nombre
      LIMIT $${params.length}`,
    params
  );

  const filas = r.rows as Record<string, unknown>[];
  if (filas.length === 0) return [];

  // LOS LOTES EN ORDEN FEFO, el mismo criterio que usa la salida de
  // inventario. Si la pantalla sugiriera otro lote que el que después va
  // a salir, el número impreso en la cartilla de vacunación sería el
  // equivocado.
  //
  // EN UNA SOLA CONSULTA para todos los productos: antes había una por
  // producto, y con el catálogo real eso son 100 consultas por cada
  // letra que el médico teclea en el buscador.
  const productoIds = [...new Set(filas.map((x) => x.producto_id as string))];
  const lotes = await db.query(
    `SELECT l.id, l.numero, l.vencimiento::text AS vence, l.cantidad, l.producto_id
       FROM inv_lotes l
      WHERE l.producto_id = ANY($1) AND l.cantidad > 0
      ORDER BY l.vencimiento NULLS LAST, l.creado_en`,
    [productoIds]
  );
  const porProducto = new Map<string, ProductoParaAtencion["lotes"]>();
  for (const l of lotes.rows as Record<string, unknown>[]) {
    const lista = porProducto.get(l.producto_id as string) ?? [];
    if (lista.length < 20) {
      lista.push({
        id: l.id as string,
        numero: (l.numero as string) ?? "—",
        vence: (l.vence as string) ?? null,
        cantidad: Number(l.cantidad),
      });
    }
    porProducto.set(l.producto_id as string, lista);
  }

  return filas.map((x) => ({
    presentacionId: x.presentacion_id as string,
    productoId: x.producto_id as string,
    nombre: x.nombre as string,
    presentacion: x.presentacion as string,
    codigo: (x.codigo as string) ?? null,
    principioActivo: (x.principio_activo as string) ?? null,
    concentracion: (x.concentracion as string) ?? null,
    codigoBarras: (x.codigo_barras as string) ?? null,
    tipoClinico: (x.tipo_clinico as TipoClinico) ?? null,
    requiereReceta: Boolean(x.requiere_receta),
    precio: x.precio_venta === null ? null : Number(x.precio_venta),
    existencia: x.existencia === null ? 0 : Number(x.existencia),
    // Null entero cuando no hay NADA cargado: media posología sería peor
    // que ninguna, porque el médico vería unos campos llenos y otros
    // vacíos sin saber por qué.
    posologia:
      x.dosis_por_kg === null &&
      x.dosis_fija === null &&
      x.via_administracion === null &&
      x.frecuencia_sugerida === null
        ? null
        : {
            dosisPorKg: x.dosis_por_kg === null ? null : Number(x.dosis_por_kg),
            dosisFija: x.dosis_fija === null ? null : Number(x.dosis_fija),
            unidadDosis: (x.unidad_dosis as string) ?? null,
            viaAdministracion: (x.via_administracion as string) ?? null,
            frecuencia: (x.frecuencia_sugerida as string) ?? null,
            duracionCantidad:
              x.duracion_sugerida_cantidad === null
                ? null
                : Number(x.duracion_sugerida_cantidad),
            duracionUnidad:
              (x.duracion_sugerida_unidad as PosologiaSugerida["duracionUnidad"]) ?? null,
          },
    lotes: porProducto.get(x.producto_id as string) ?? [],
  }));
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

  // EL EVENTO EN LA LÍNEA DE TIEMPO. Defecto del 2026-11-27: esto no
  // estaba, y era el defecto entero.
  //
  // La pestaña Vacunas y la pestaña Desparasitaciones NO leen
  // `cuidados_preventivos`: leen la línea de tiempo filtrada por tipo
  // (ver `lineaDeTiempo` en `resumen.ts`). Así que el histórico se
  // guardaba de verdad —el aviso de la próxima dosis hasta salía— y la
  // pantalla decía «guardado» mostrando una lista sin él. El usuario lo
  // cargaba dos y tres veces.
  //
  // LA FECHA DEL EVENTO ES LA DE APLICACIÓN, no hoy: una vacuna de hace
  // tres años tiene que aparecer hace tres años. Es para esto que
  // `registrarInteraccion` acepta `ocurridoEn`.
  //
  // Y VA AL MEDIODÍA, no a medianoche. `ocurrido_en` es TIMESTAMPTZ y
  // la pantalla lo muestra en la zona de la clínica: medianoche UTC del
  // 27 es el 26 a las 18:00 en Costa Rica, y la vacuna aparecería un día
  // antes de lo que dice la cartilla. Al mediodía UTC el día es el mismo
  // en toda zona entre UTC−11 y UTC+11, que las cubre todas menos las
  // islas del Pacífico donde no hay clínicas.
  await registrarInteraccion(db, {
    tenantId,
    tipo: datos.tipo === "vacunacion" ? "vacuna_aplicada" : "desparasitacion",
    pacienteId: datos.pacienteId,
    ocurridoEn: `${datos.fechaAplicacion}T12:00:00Z`,
    origenTabla: "cuidados_preventivos",
    origenId: r.rows[0].id,
    personaId,
    resumen: datos.nombre,
    // De dónde salió el dato. Lo que la pantalla muestra como
    // «histórico» sale de `cuidados_preventivos.historico`, que es la
    // fuente; esto es para quien lee el evento suelto.
    nota: datos.lugar ? `histórico · ${datos.lugar}` : "histórico",
  });

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
