import { PoolClient } from "pg";
import { buscarPropietariosTolerante } from "../busquedaPropietarios";
import { ReceptorDocumento } from "./tipos";

// ---------------------------------------------------------------------
// PERFILES DE FACTURACIÓN — sección 3 bis del prompt 08.
//
// A nombre de quién sale la factura cuando no es el dueño de la
// mascota: la empresa del dueño, una fundación que paga la atención, un
// familiar.
//
// EL PUNTO ÚNICO ES `resolverReceptor`. La caja y la pantalla "Emitir"
// del facturador lo llaman con la misma elección —dueño, perfil
// guardado, cualquiera de los dos buscado, o uno nuevo— y reciben el
// MISMO objeto de receptor. Dos resoluciones distintas serían dos
// criterios de qué dato falta, y la factura de la caja saldría distinta
// a la del facturador para el mismo cliente.
//
// LO QUE ESTE MÓDULO NO HACE: no toca la cuenta ni el expediente. La
// atención, la cuenta y el gasto del cliente en el CRM son del DUEÑO,
// aunque la factura salga a nombre de una empresa. Lo único que se
// mueve con el receptor es la deuda: en una venta a crédito el deudor
// es el receptor (ver `credito.ts`).
// ---------------------------------------------------------------------

export interface PerfilFacturacion {
  id: string;
  nombre: string;
  nombre_comercial: string | null;
  tipo_identificacion: string;
  numero_identificacion: string;
  ubicacion_provincia: string | null;
  ubicacion_canton: string | null;
  ubicacion_distrito: string | null;
  ubicacion_barrio: string | null;
  ubicacion_otras_senas: string | null;
  correo: string | null;
  telefono_codigo_pais: string | null;
  telefono_numero: string | null;
  codigo_actividad: string | null;
  activo: boolean;
}

export interface DatosPerfil {
  nombre: string;
  nombreComercial?: string | null;
  tipoIdentificacion: string;
  numeroIdentificacion: string;
  ubicacionProvincia?: string | null;
  ubicacionCanton?: string | null;
  ubicacionDistrito?: string | null;
  ubicacionBarrio?: string | null;
  ubicacionOtrasSenas?: string | null;
  correo?: string | null;
  telefonoCodigoPais?: string | null;
  telefonoNumero?: string | null;
  codigoActividad?: string | null;
  /** Si viene, el perfil queda ligado a ese cliente. */
  propietarioId?: string | null;
  /** Y si además es el que la caja va a proponer primero. */
  esPredeterminado?: boolean;
  personaId?: string | null;
}

function exigirDatosMinimos(d: DatosPerfil): void {
  if (!d.nombre?.trim()) {
    throw new Error("Un perfil de facturación necesita su nombre o razón social.");
  }
  if (!d.tipoIdentificacion || !d.numeroIdentificacion?.trim()) {
    throw new Error(
      "Un perfil de facturación necesita tipo y número de identificación: es lo que Hacienda exige del receptor de una factura."
    );
  }
}

export async function crearPerfil(
  db: PoolClient,
  tenantId: string,
  d: DatosPerfil
): Promise<{ id: string }> {
  exigirDatosMinimos(d);

  const r = await db.query<{ id: string }>(
    `INSERT INTO fact_perfiles_facturacion (
       tenant_id, nombre, nombre_comercial, tipo_identificacion, numero_identificacion,
       ubicacion_provincia, ubicacion_canton, ubicacion_distrito, ubicacion_barrio,
       ubicacion_otras_senas, correo, telefono_codigo_pais, telefono_numero,
       codigo_actividad, creado_por
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      tenantId,
      d.nombre.trim(),
      d.nombreComercial?.trim() || null,
      d.tipoIdentificacion,
      d.numeroIdentificacion.replace(/\D/g, ""),
      d.ubicacionProvincia || null,
      d.ubicacionCanton || null,
      d.ubicacionDistrito || null,
      d.ubicacionBarrio?.trim() || null,
      d.ubicacionOtrasSenas?.trim() || null,
      d.correo?.trim() || null,
      d.telefonoCodigoPais || null,
      d.telefonoNumero?.replace(/\D/g, "") || null,
      d.codigoActividad || null,
      d.personaId || null,
    ]
  );
  const id = r.rows[0].id;

  if (d.propietarioId) {
    await ligarACliente(db, tenantId, id, d.propietarioId, d.esPredeterminado === true);
  }
  return { id };
}

export async function editarPerfil(
  db: PoolClient,
  tenantId: string,
  perfilId: string,
  d: Partial<DatosPerfil> & { activo?: boolean }
): Promise<void> {
  // Un UPDATE con COALESCE por campo: así la pantalla manda solo lo que
  // cambió y no hace falta leer el perfil entero antes de guardarlo.
  const r = await db.query(
    `UPDATE fact_perfiles_facturacion SET
       nombre = COALESCE($3, nombre),
       nombre_comercial = COALESCE($4, nombre_comercial),
       ubicacion_provincia = COALESCE($5, ubicacion_provincia),
       ubicacion_canton = COALESCE($6, ubicacion_canton),
       ubicacion_distrito = COALESCE($7, ubicacion_distrito),
       ubicacion_barrio = COALESCE($8, ubicacion_barrio),
       ubicacion_otras_senas = COALESCE($9, ubicacion_otras_senas),
       correo = COALESCE($10, correo),
       telefono_codigo_pais = COALESCE($11, telefono_codigo_pais),
       telefono_numero = COALESCE($12, telefono_numero),
       codigo_actividad = COALESCE($13, codigo_actividad),
       activo = COALESCE($14, activo),
       actualizado_en = now()
     WHERE id = $1 AND tenant_id = $2`,
    [
      perfilId,
      tenantId,
      d.nombre?.trim() ?? null,
      d.nombreComercial?.trim() ?? null,
      d.ubicacionProvincia ?? null,
      d.ubicacionCanton ?? null,
      d.ubicacionDistrito ?? null,
      d.ubicacionBarrio?.trim() ?? null,
      d.ubicacionOtrasSenas?.trim() ?? null,
      d.correo?.trim() ?? null,
      d.telefonoCodigoPais ?? null,
      d.telefonoNumero?.replace(/\D/g, "") ?? null,
      d.codigoActividad ?? null,
      d.activo ?? null,
    ]
  );
  if (r.rowCount === 0) throw new Error("Ese perfil de facturación no existe.");
}

/**
 * LA IDENTIFICACIÓN NO SE EDITA, igual que en la ficha del propietario:
 * cambiar la cédula de un perfil ya usado reescribiría a quién se le
 * facturó. Si la identificación estaba mal, se crea el perfil correcto
 * y se desactiva el equivocado.
 */
export async function listarPerfiles(
  db: PoolClient,
  tenantId: string,
  filtros: { q?: string; soloActivos?: boolean } = {}
): Promise<Array<PerfilFacturacion & { clientes: number }>> {
  const condiciones = ["p.tenant_id = $1"];
  const valores: unknown[] = [tenantId];
  if (filtros.soloActivos) condiciones.push("p.activo");
  if (filtros.q?.trim()) {
    valores.push(`%${filtros.q.trim()}%`);
    condiciones.push(
      `(inmutable_unaccent(lower(p.nombre)) ILIKE inmutable_unaccent(lower($${valores.length}))
        OR p.numero_identificacion ILIKE $${valores.length})`
    );
  }

  const r = await db.query<PerfilFacturacion & { clientes: string }>(
    `SELECT p.*, (SELECT count(*) FROM fact_perfil_clientes pc WHERE pc.perfil_id = p.id)::text
              AS clientes
       FROM fact_perfiles_facturacion p
      WHERE ${condiciones.join(" AND ")}
      ORDER BY p.activo DESC, p.nombre
      LIMIT 200`,
    valores
  );
  return r.rows.map((f) => ({ ...f, clientes: Number(f.clientes) }));
}

/** Los perfiles de un cliente, el predeterminado primero. */
export async function perfilesDeCliente(
  db: PoolClient,
  propietarioId: string
): Promise<Array<PerfilFacturacion & { es_predeterminado: boolean }>> {
  const r = await db.query<PerfilFacturacion & { es_predeterminado: boolean }>(
    `SELECT p.*, pc.es_predeterminado
       FROM fact_perfil_clientes pc
       JOIN fact_perfiles_facturacion p ON p.id = pc.perfil_id
      WHERE pc.propietario_id = $1 AND p.activo
      ORDER BY pc.es_predeterminado DESC, p.nombre`,
    [propietarioId]
  );
  return r.rows;
}

export async function ligarACliente(
  db: PoolClient,
  tenantId: string,
  perfilId: string,
  propietarioId: string,
  esPredeterminado = false
): Promise<void> {
  if (esPredeterminado) {
    // Uno por cliente: el índice único parcial lo impone, así que el
    // anterior se baja antes de subir el nuevo.
    await db.query(
      `UPDATE fact_perfil_clientes SET es_predeterminado = false
        WHERE propietario_id = $1 AND es_predeterminado`,
      [propietarioId]
    );
  }
  await db.query(
    `INSERT INTO fact_perfil_clientes (tenant_id, perfil_id, propietario_id, es_predeterminado)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (perfil_id, propietario_id)
     DO UPDATE SET es_predeterminado = EXCLUDED.es_predeterminado`,
    [tenantId, perfilId, propietarioId, esPredeterminado]
  );
}

export async function desligarDeCliente(
  db: PoolClient,
  perfilId: string,
  propietarioId: string
): Promise<void> {
  await db.query(
    `DELETE FROM fact_perfil_clientes WHERE perfil_id = $1 AND propietario_id = $2`,
    [perfilId, propietarioId]
  );
}

// ---------------------------------------------------------------------
// Búsqueda unificada: clientes y perfiles en una sola lista
// ---------------------------------------------------------------------

export interface ReceptorPosible {
  tipo: "cliente" | "perfil";
  id: string;
  nombre: string;
  tipoIdentificacion: string | null;
  numeroIdentificacion: string | null;
  correo: string | null;
  /** Texto para la segunda línea de la opción: qué es y a quién sirve. */
  detalle: string;
  puntaje: number;
}

/**
 * Busca entre clientes Y perfiles de facturación, tolerante a errores
 * de tipeo.
 *
 * La parte de clientes la hace `buscarPropietariosTolerante`, que ya es
 * el punto único de esa búsqueda (la usa el buscador del encabezado):
 * acá no se reescribe la consulta, se la llama. Los perfiles van por
 * `unaccent` + prefijo de identificación, que es lo que se puede hacer
 * con una tabla que todavía no tiene índice de trigramas —son decenas
 * de filas por clínica, no miles—.
 */
export async function buscarReceptoresPosibles(
  db: PoolClient,
  tenantId: string,
  q: string,
  limite = 10
): Promise<ReceptorPosible[]> {
  const texto = q.trim();
  if (texto === "") return [];

  const clientes = await buscarPropietariosTolerante(db, texto, limite);

  const perfiles = await db.query<{
    id: string;
    nombre: string;
    tipo_identificacion: string;
    numero_identificacion: string;
    correo: string | null;
    clientes: string;
  }>(
    `SELECT p.id, p.nombre, p.tipo_identificacion, p.numero_identificacion, p.correo,
            (SELECT count(*) FROM fact_perfil_clientes pc WHERE pc.perfil_id = p.id)::text
              AS clientes
       FROM fact_perfiles_facturacion p
      WHERE p.tenant_id = $1 AND p.activo
        AND (inmutable_unaccent(lower(p.nombre)) ILIKE '%' || inmutable_unaccent(lower($2)) || '%'
             OR p.numero_identificacion ILIKE $2 || '%')
      ORDER BY p.nombre
      LIMIT $3`,
    [tenantId, texto, limite]
  );

  const resultados: ReceptorPosible[] = [
    ...clientes.map((c) => ({
      tipo: "cliente" as const,
      id: c.id,
      nombre: c.nombre,
      tipoIdentificacion: c.tipo_identificacion_codigo,
      numeroIdentificacion: c.numero_identificacion,
      correo: c.email,
      detalle:
        `cliente` +
        (c.cantidad_pacientes > 0 ? ` · ${c.cantidad_pacientes} mascota(s)` : "") +
        (c.numero_identificacion ? ` · ${c.numero_identificacion}` : " · sin identificación"),
      puntaje: c.puntaje,
    })),
    ...perfiles.rows.map((p) => ({
      tipo: "perfil" as const,
      id: p.id,
      nombre: p.nombre,
      tipoIdentificacion: p.tipo_identificacion,
      numeroIdentificacion: p.numero_identificacion,
      correo: p.correo,
      detalle:
        `perfil de facturación · ${p.numero_identificacion}` +
        (Number(p.clientes) > 0 ? ` · ligado a ${p.clientes} cliente(s)` : " · sin cliente ligado"),
      // Los perfiles no pasan por trigramas, así que no tienen puntaje
      // comparable. Se les da 1 cuando el texto coincide de lleno con
      // el nombre y 0.5 si no, para que un perfil que se llama igual a
      // lo tecleado no quede debajo de un cliente parecido.
      puntaje: p.nombre.toLowerCase() === texto.toLowerCase() ? 1 : 0.5,
    })),
  ];

  return resultados.sort((a, b) => b.puntaje - a.puntaje).slice(0, limite * 2);
}

// ---------------------------------------------------------------------
// El punto único: de una elección a un receptor
// ---------------------------------------------------------------------

/** Lo que la pantalla eligió. Las cuatro opciones de la sección 3 bis. */
export type EleccionReceptor =
  | { modo: "sin_datos" }
  | { modo: "dueno"; propietarioId: string }
  | { modo: "perfil"; perfilId: string }
  | { modo: "existente"; tipo: "cliente" | "perfil"; id: string }
  | { modo: "nuevo"; datos: DatosPerfil; guardar?: boolean };

export interface ReceptorResuelto {
  receptor?: ReceptorDocumento;
  /** El cliente al que pertenece la cuenta. NO cambia con el receptor. */
  propietarioId?: string;
  /** De qué perfil salieron los datos, si salieron de uno. */
  perfilId?: string;
  /** El deudor de una venta a crédito: el receptor, no el dueño. */
  deudor: { tipo: "cliente" | "perfil"; id: string } | null;
  /** Qué falta para poder emitir una factura (vacío = se puede). */
  faltantes: string[];
}

function receptorDePerfil(p: PerfilFacturacion): ReceptorDocumento {
  return {
    nombre: p.nombre,
    nombreComercial: p.nombre_comercial ?? undefined,
    identificacion: { tipo: p.tipo_identificacion, numero: p.numero_identificacion },
    ubicacion:
      p.ubicacion_provincia && p.ubicacion_canton && p.ubicacion_distrito
        ? {
            provincia: p.ubicacion_provincia,
            canton: p.ubicacion_canton,
            distrito: p.ubicacion_distrito,
            barrio: p.ubicacion_barrio ?? undefined,
            // `otrasSenas` es obligatorio en el XSD cuando hay
            // ubicación (5 a 250). Un perfil con los tres códigos y sin
            // señas pondría una cadena vacía y Hacienda lo rechazaría,
            // así que se dice qué falta en vez de mandar un hueco.
            otrasSenas: p.ubicacion_otras_senas ?? "Sin otras señas",
          }
        : undefined,
    telefono:
      p.telefono_codigo_pais && p.telefono_numero
        ? { codigoPais: p.telefono_codigo_pais, numero: p.telefono_numero }
        : undefined,
    correo: p.correo ?? undefined,
    codigoActividad: p.codigo_actividad ?? undefined,
  };
}

async function leerPerfil(db: PoolClient, perfilId: string): Promise<PerfilFacturacion> {
  const r = await db.query<PerfilFacturacion>(
    `SELECT * FROM fact_perfiles_facturacion WHERE id = $1`,
    [perfilId]
  );
  if (r.rows.length === 0) throw new Error("Ese perfil de facturación no existe.");
  return r.rows[0];
}

/**
 * Resuelve la elección de la pantalla en un receptor listo para emitir.
 *
 * `propietarioId` es el dueño de la cuenta y viaja aparte del receptor:
 * se devuelve tal como entró, porque la cuenta y el expediente son del
 * dueño pase lo que pase con la factura.
 *
 * `faltantes` NO lanza error: devuelve qué falta. Es la pantalla la que
 * decide si pide los datos o emite un tiquete, y eso es lo que el
 * prompt pide ("si al dueño o al perfil elegido le faltan datos que la
 * factura exige, se piden en ese momento").
 */
export async function resolverReceptor(
  db: PoolClient,
  tenantId: string,
  eleccion: EleccionReceptor,
  propietarioDeLaCuenta?: string | null
): Promise<ReceptorResuelto> {
  const base = { propietarioId: propietarioDeLaCuenta ?? undefined };

  if (eleccion.modo === "sin_datos") {
    // Sin datos no hay factura: se emite tiquete. No es un error.
    return { ...base, deudor: null, faltantes: [] };
  }

  if (eleccion.modo === "perfil" || (eleccion.modo === "existente" && eleccion.tipo === "perfil")) {
    const perfilId = eleccion.modo === "perfil" ? eleccion.perfilId : eleccion.id;
    const p = await leerPerfil(db, perfilId);
    return {
      ...base,
      receptor: receptorDePerfil(p),
      perfilId: p.id,
      deudor: { tipo: "perfil", id: p.id },
      faltantes: faltantesDeReceptor(receptorDePerfil(p)),
    };
  }

  if (eleccion.modo === "nuevo") {
    if (eleccion.guardar) {
      const creado = await crearPerfil(db, tenantId, eleccion.datos);
      const p = await leerPerfil(db, creado.id);
      return {
        ...base,
        receptor: receptorDePerfil(p),
        perfilId: p.id,
        deudor: { tipo: "perfil", id: p.id },
        faltantes: faltantesDeReceptor(receptorDePerfil(p)),
      };
    }
    // Sin guardar: los datos van al comprobante y a ningún otro lado.
    // La copia congelada del comprobante es el único registro, y eso
    // alcanza — es lo que pasa cuando alguien factura una vez a nombre
    // de un tercero de paso.
    exigirDatosMinimos(eleccion.datos);
    const comoPerfil: PerfilFacturacion = {
      id: "",
      nombre: eleccion.datos.nombre.trim(),
      nombre_comercial: eleccion.datos.nombreComercial ?? null,
      tipo_identificacion: eleccion.datos.tipoIdentificacion,
      numero_identificacion: eleccion.datos.numeroIdentificacion.replace(/\D/g, ""),
      ubicacion_provincia: eleccion.datos.ubicacionProvincia ?? null,
      ubicacion_canton: eleccion.datos.ubicacionCanton ?? null,
      ubicacion_distrito: eleccion.datos.ubicacionDistrito ?? null,
      ubicacion_barrio: eleccion.datos.ubicacionBarrio ?? null,
      ubicacion_otras_senas: eleccion.datos.ubicacionOtrasSenas ?? null,
      correo: eleccion.datos.correo ?? null,
      telefono_codigo_pais: eleccion.datos.telefonoCodigoPais ?? null,
      telefono_numero: eleccion.datos.telefonoNumero ?? null,
      codigo_actividad: eleccion.datos.codigoActividad ?? null,
      activo: true,
    };
    return {
      ...base,
      receptor: receptorDePerfil(comoPerfil),
      deudor: null,
      faltantes: faltantesDeReceptor(receptorDePerfil(comoPerfil)),
    };
  }

  // El dueño, o un cliente buscado: los datos salen de `propietarios`.
  const propietarioId = eleccion.modo === "dueno" ? eleccion.propietarioId : eleccion.id;
  const c = await db.query<{
    id: string;
    nombre: string;
    email: string | null;
    telefono: string | null;
    numero_identificacion: string | null;
    codigo: string | null;
  }>(
    `SELECT p.id, p.nombre, p.email, p.telefono, p.numero_identificacion, t.codigo
       FROM propietarios p
       LEFT JOIN tipos_identificacion t ON t.id = p.tipo_identificacion_id
      WHERE p.id = $1`,
    [propietarioId]
  );
  if (c.rows.length === 0) throw new Error("Ese cliente no existe.");
  const f = c.rows[0];

  const receptor: ReceptorDocumento = {
    nombre: f.nombre,
    identificacion:
      f.codigo && f.numero_identificacion
        ? { tipo: f.codigo, numero: f.numero_identificacion }
        : undefined,
    correo: f.email ?? undefined,
    telefono: f.telefono
      ? { codigoPais: "506", numero: f.telefono.replace(/\D/g, "").slice(-8) }
      : undefined,
  };

  return {
    // El dueño de la cuenta es el de la cuenta; si se eligió a otro
    // cliente como receptor, la cuenta NO se le pasa.
    propietarioId: propietarioDeLaCuenta ?? propietarioId,
    receptor,
    deudor: { tipo: "cliente", id: propietarioId },
    faltantes: faltantesDeReceptor(receptor),
  };
}

/**
 * Qué le falta a un receptor para que se le pueda emitir una FACTURA.
 *
 * Solo la identificación: es lo único que Hacienda exige del receptor
 * en una factura electrónica (el resto —correo, teléfono, dirección— es
 * opcional en el XSD). El correo se nombra aparte porque sin él no hay
 * entrega, aunque la factura sea válida.
 */
export function faltantesDeReceptor(r?: ReceptorDocumento): string[] {
  if (!r) return ["identificación"];
  const faltan: string[] = [];
  if (!r.identificacion?.numero || !r.identificacion?.tipo) faltan.push("identificación");
  return faltan;
}
