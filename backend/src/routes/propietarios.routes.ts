import { Router } from "express";
import { direccionValida } from "../email";
import { authenticate, withTenantClient } from "../middleware/auth";
import {
  crearPropietario,
  ERROR_IDENTIFICACION_REPETIDA,
  esIdentificacionRepetida,
} from "../clientes/altaPropietario";
import { avisoDeDuplicado, clientesParecidos } from "../crm/duplicados";
import {
  consultarIdentificacion,
  formatoValido,
} from "../clientes/proveedorIdentificacionActivo";

export const propietariosRouter = Router();

// El correo del propietario es opcional (una clínica que atiende una
// urgencia no debe verse obligada a pedirlo, mismo criterio que la
// identificación) — pero si viene, tiene que ser una dirección a la que
// se le pueda escribir.
//
// Antes se guardaba con solo .trim(). El envío ahora rechaza una
// dirección mutilada (ver enviarEmail), así que una fila mala ya no puede
// inyectar nada; lo que sí hace es fallar en silencio cada vez que a ese
// tutor le toca un aviso, y para propietarios no hay webhook de rebotes
// que lo delate (correo_rebotado_en existe en `personas`, no acá). Por
// eso conviene rechazarla al cargarla, cuando hay alguien mirando la
// pantalla que puede corregir el typo.
//
// Se usa la MISMA función que aplica el envío: si divergieran, la
// pantalla aceptaría direcciones que después nunca se entregan, que es
// exactamente el problema que esto viene a cerrar.
const ERROR_CORREO_INVALIDO =
  "El correo electrónico no parece válido. Revisalo, o dejalo vacío si no lo tenés — el propietario se guarda igual.";

function correoUtilizable(email: string | undefined): boolean {
  if (!email || !email.trim()) return true; // sigue siendo opcional
  return direccionValida(email) !== null;
}

propietariosRouter.use(authenticate, withTenantClient);

// Ampliado a admin_clinica (ver prompt_fix_agenda_permisos_paciente.md):
// el módulo de Agenda necesita que un admin también pueda buscar/crear
// propietarios y pacientes al armar una cita nueva, no solo un médico
// vía el wizard de "Nuevo Caso" original que gateaba esto.
propietariosRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

// ---------------------------------------------------------------------
// GET /api/propietarios/tipos-identificacion
// prompt_code_expediente_y_propietario, Parte B2 — mismo catálogo
// tipos_identificacion que usa el registro de la clínica (paises.routes.ts,
// admin.routes.ts), filtrado automáticamente por el país de la propia
// clínica del médico/admin que llama — a diferencia de esas dos rutas,
// acá el país no es un parámetro: es siempre el de req.auth, nunca uno
// elegido por el cliente.
// ---------------------------------------------------------------------
/**
 * Cómo pudo llegar el cliente (anexo 07-03, B3).
 *
 * Las de la plataforma más las que agregó la clínica: la RLS de
 * `crm_fuentes_referencia` ya devuelve las dos, así que acá no hay
 * ningún filtro por tenant que pueda quedar desalineado con ella.
 */
/**
 * GET /api/propietarios/consultar-identificacion?tipoIdentificacionId=…&numero=…
 *
 * EL AUTOCOMPLETAR DEL ALTA (anexo 07-03, B2).
 *
 * NO FALLA NUNCA CON 500. Todas las respuestas son 200 con
 * `encontrado` en true o false y, cuando corresponde, el motivo: el
 * formulario de clientes no se puede romper porque un servicio público
 * ajeno no contestó. El único 400 es el de la pregunta mal hecha.
 *
 * EL FORMATO SE VALIDA ANTES DE CONSULTAR. Una cédula de ocho dígitos no
 * existe: preguntarle a Hacienda por ella es gastar una consulta del
 * límite para que nos diga lo que el catálogo ya sabía.
 */
/** Los tres valores que acepta `propietarios.datos_fuente`, y nada más. */
function fuenteDeLosDatos(valor: string | undefined): "manual" | "hacienda" | "simulado" | null {
  return valor === "manual" || valor === "hacienda" || valor === "simulado" ? valor : null;
}

propietariosRouter.get("/consultar-identificacion", async (req, res) => {
  const tipoIdentificacionId =
    typeof req.query.tipoIdentificacionId === "string" ? req.query.tipoIdentificacionId : "";
  const numero = typeof req.query.numero === "string" ? req.query.numero.trim() : "";
  if (!tipoIdentificacionId || !numero) {
    return res.status(400).json({ error: "Faltan tipoIdentificacionId o numero." });
  }

  try {
    const formato = await formatoValido(req.db!, tipoIdentificacionId, numero);
    if (!formato.codigo) {
      return res.status(400).json({ error: "Ese tipo de identificación no existe." });
    }
    if (!formato.formato) {
      // El pasaporte no tiene formato conocido y por eso no se consulta.
      // Se contesta que no se encontró, con el motivo: la pantalla
      // sigue manual sin mostrar un error rojo.
      return res.json({
        encontrado: false,
        motivo: "Ese tipo de identificación no se puede consultar: se escribe a mano.",
      });
    }
    if (!formato.valido) {
      return res.json({
        encontrado: false,
        motivo: "El número todavía no está completo para ese tipo de identificación.",
      });
    }

    const r = await consultarIdentificacion(
      req.db!,
      req.auth!.tenantId!,
      formato.codigo,
      numero
    );
    res.json({
      encontrado: r.encontrado,
      nombre: r.datos?.nombre ?? null,
      datos: r.datos?.datos ?? null,
      motivo: r.errorTecnico ?? null,
      deCache: r.deCache,
      proveedor: r.proveedor,
    });
  } catch (err) {
    // Hasta un error nuestro se contesta sin romper el alta.
    console.error("GET /propietarios/consultar-identificacion", err);
    res.json({ encontrado: false, motivo: "No pudimos consultar. Escribí el nombre a mano." });
  }
});

propietariosRouter.get("/fuentes-referencia", async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, codigo, etiqueta, pide_referidor
         FROM crm_fuentes_referencia
        WHERE activo
        ORDER BY orden, etiqueta`
    );
    res.json({ fuentes: r.rows });
  } catch (err) {
    console.error("GET /propietarios/fuentes-referencia", err);
    res.status(500).json({ error: "Error al listar las fuentes de referencia." });
  }
});

propietariosRouter.get("/tipos-identificacion", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT ti.id, ti.codigo, ti.etiqueta
       FROM tipos_identificacion ti
       JOIN tenants t ON t.pais_codigo = ti.pais_codigo
       WHERE t.id = $1 AND ti.activo = true AND ti.aplica_persona_fisica = true
       ORDER BY ti.orden`,
      [req.auth!.tenantId]
    );
    res.json({ tipos: result.rows });
  } catch (err) {
    console.error("GET /propietarios/tipos-identificacion", err);
    res.status(500).json({ error: "Error al obtener los tipos de identificación." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/buscar-por-identificacion?tipoIdentificacionId=X&numero=Y
// prompt_code_propietarios, Ajuste 1 — búsqueda EXACTA (no ILIKE) por la
// combinación que la propia tabla trata como llave única
// (propietarios_identificacion_unica: tenant + tipo + número). Es la que
// dispara el formulario de alta apenas se completan los dos campos, para
// ofrecer "usar este propietario" antes de crear uno nuevo. Devuelve como
// mucho un propietario (la unicidad lo garantiza), o ninguno.
// ---------------------------------------------------------------------
propietariosRouter.get("/buscar-por-identificacion", async (req, res) => {
  const tipoIdentificacionId = typeof req.query.tipoIdentificacionId === "string" ? req.query.tipoIdentificacionId : "";
  const numero = typeof req.query.numero === "string" ? req.query.numero.trim() : "";

  if (!tipoIdentificacionId || !numero) {
    return res.status(400).json({ error: "Faltan tipoIdentificacionId o numero." });
  }

  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.direccion, p.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
       WHERE p.tipo_identificacion_id = $1 AND p.numero_identificacion = $2
         AND p.unificado_hacia_id IS NULL`,
      [tipoIdentificacionId, numero]
    );
    res.json({ propietario: result.rows[0] ?? null });
  } catch (err) {
    console.error("GET /propietarios/buscar-por-identificacion", err);
    res.status(500).json({ error: "Error al buscar por identificación." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/buscar?q=texto
// Búsqueda por nombre, teléfono, email o número de identificación (ILIKE,
// no exact match), máximo 10 resultados. Sin query (q vacío/ausente)
// devuelve los primeros 10 alfabéticamente, para poblar el paso 1 del
// wizard de "Nuevo caso" antes de que el médico escriba nada.
// ---------------------------------------------------------------------
propietariosRouter.get("/buscar", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
      -- EL ABSORBIDO NO SE BUSCA (anexo 07-03, B1). La ficha sigue en la
      -- base porque el historial del CRM y los comprobantes emitidos la
      -- referencian, pero para la clínica ya no existe: aparecer en el
      -- buscador sería volver a crear el duplicado que se acaba de
      -- resolver.
       WHERE p.unificado_hacia_id IS NULL
         AND ($1 = ''
          OR p.nombre ILIKE '%' || $1 || '%'
          OR p.telefono ILIKE '%' || $1 || '%'
          OR p.email ILIKE '%' || $1 || '%'
          OR p.numero_identificacion ILIKE '%' || $1 || '%')
       ORDER BY p.nombre
       LIMIT 10`,
      [q]
    );
    res.json({ propietarios: result.rows });
  } catch (err) {
    console.error("GET /propietarios/buscar", err);
    res.status(500).json({ error: "Error al buscar propietarios." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios?q=texto&pagina=1
// Fichero de clientes de la clínica — a diferencia de /buscar (typeahead
// de 10 resultados para wizards), esta es la pantalla de listado: mismo
// criterio de búsqueda (nombre, teléfono, email o número de
// identificación) pero paginada, sin límite artificial.
// ---------------------------------------------------------------------
const PROPIETARIOS_POR_PAGINA = 20;

propietariosRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  // El filtro del absorbido va en las DOS ramas (anexo 07-03, B1): el
  // fichero sin búsqueda es el que más se mira, y dejarlo ahí sería
  // mostrar las fichas muertas justo en la pantalla donde se cuentan
  // los clientes de la clínica.
  const condicion = q
    ? `WHERE p.unificado_hacia_id IS NULL
         AND (p.nombre ILIKE '%' || $1 || '%'
        OR p.telefono ILIKE '%' || $1 || '%'
        OR p.email ILIKE '%' || $1 || '%'
        OR p.numero_identificacion ILIKE '%' || $1 || '%')`
    : "WHERE p.unificado_hacia_id IS NULL";
  const params = q ? [q] : [];

  try {
    const totalResult = await req.db!.query(`SELECT COUNT(*) FROM propietarios p ${condicion}`, params);
    const total = Number(totalResult.rows[0].count);

    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.numero_identificacion,
              ti.etiqueta AS tipo_identificacion_etiqueta,
              (SELECT COUNT(*) FROM pacientes pa WHERE pa.propietario_id = p.id) AS cantidad_pacientes
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
       ${condicion}
       ORDER BY p.nombre
       LIMIT ${PROPIETARIOS_POR_PAGINA} OFFSET ${(pagina - 1) * PROPIETARIOS_POR_PAGINA}`,
      params
    );

    res.json({
      propietarios: result.rows,
      total,
      pagina,
      porPagina: PROPIETARIOS_POR_PAGINA,
    });
  } catch (err) {
    console.error("GET /propietarios", err);
    res.status(500).json({ error: "Error al listar los propietarios." });
  }
});

// ---------------------------------------------------------------------
// POST /api/propietarios
// tipoIdentificacionId/numeroIdentificacion son opcionales — Parte B2:
// una clínica que atiende una urgencia no debe verse obligada a pedirle
// documentos al tutor. Cuando se completan, tienen que venir los dos
// juntos (el CHECK de la migración 047 lo exige a nivel de base; acá se
// valida temprano para devolver un 400 claro en vez de un error crudo de
// constraint) y la unicidad por clínica la aplica esa misma migración.
// ---------------------------------------------------------------------
propietariosRouter.post("/", async (req, res) => {
  const { nombre, telefono, email, direccion, tipoIdentificacionId, numeroIdentificacion, confirmado } =
    req.body as {
      nombre?: string;
      telefono?: string;
      email?: string;
      direccion?: string;
      tipoIdentificacionId?: string;
      numeroIdentificacion?: string;
      /* El alta vuelve a llamar con esto en true cuando el usuario vio
         los parecidos y decidió crear igual. */
      confirmado?: boolean;
    };

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del propietario." });
  }
  if (Boolean(tipoIdentificacionId) !== Boolean(numeroIdentificacion?.trim())) {
    return res.status(400).json({
      error: "Si cargás la identificación del propietario, hacen falta el tipo y el número juntos.",
    });
  }
  if (!correoUtilizable(email)) {
    return res.status(400).json({ error: ERROR_CORREO_INVALIDO });
  }

  try {
    // EL DUPLICADO MÁS BARATO ES EL QUE NO SE CREA (anexo 07-03, A5).
    // Antes de insertar se mira si ya hay un cliente con la misma
    // identificación o el mismo teléfono y se devuelve 409 con los
    // parecidos, para que la pantalla ofrezca usar el que ya existe. No
    // bloquea: con `confirmado` se crea igual, porque dos personas
    // pueden compartir un teléfono de casa.
    if (!confirmado) {
      const parecidos = await clientesParecidos(
        req.db!,
        { nombre, telefono, email, tipoIdentificacionId, numeroIdentificacion },
        { soloFuertes: true }
      );
      if (parecidos.length > 0) {
        return res.status(409).json({
          error: avisoDeDuplicado(parecidos),
          codigo: "POSIBLE_DUPLICADO",
          candidatos: parecidos,
        });
      }
    }

    const nuevo = await crearPropietario(
      req.db!,
      req.auth!.tenantId!,
      {
        nombre,
        telefono,
        email,
        direccion,
        tipoIdentificacionId,
        numeroIdentificacion,
        fuenteReferenciaId: (req.body as Record<string, string>).fuenteReferenciaId,
        referidoPorPropietarioId: (req.body as Record<string, string>).referidoPorPropietarioId,
        // LO QUE LLEGA NO ENTRA CRUDO: la columna tiene un CHECK de
        // tres valores y un cuarto sería un 500 en el alta de un
        // cliente. Lo que no esté en la lista se guarda como null,
        // que es «no sabemos de dónde salió» y es la verdad.
        datosFuente: fuenteDeLosDatos((req.body as Record<string, string>).datosFuente),
      },
      req.auth!.userId
    );

    res.status(201).json({ propietario: nuevo });
  } catch (err: any) {
    if (esIdentificacionRepetida(err)) {
      return res.status(409).json({ error: ERROR_IDENTIFICACION_REPETIDA });
    }
    console.error("POST /propietarios", err);
    res.status(500).json({ error: "Error al crear el propietario." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/:id
// Ficha del propietario — datos + tipo/número de identificación (para
// mostrarlos, nunca para editarlos desde acá).
// ---------------------------------------------------------------------
propietariosRouter.get("/:id", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.telefono, p.email, p.direccion,
              p.numero_identificacion, ti.etiqueta AS tipo_identificacion_etiqueta,
              -- Anexo 07-03, B3. El nombre del referidor viaja junto al
              -- id: sin él la ficha mostraría un UUID o tendría que
              -- pedir otro viaje al servidor para escribir «Marta Vega».
              p.fuente_referencia_id, p.referido_por_propietario_id,
              r.nombre AS referido_por_nombre
       FROM propietarios p
       LEFT JOIN tipos_identificacion ti ON ti.id = p.tipo_identificacion_id
       LEFT JOIN propietarios r ON r.id = p.referido_por_propietario_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Propietario no encontrado." });
    }
    res.json({ propietario: result.rows[0] });
  } catch (err) {
    console.error("GET /propietarios/:id", err);
    res.status(500).json({ error: "Error al obtener el propietario." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/propietarios/:id
// Editables: nombre, teléfono, correo, dirección, y cómo llegó a la
// clínica (anexo 07-03, B3). La identificación (tipo y número) NO se
// acepta acá a propósito — una vez creado el propietario queda fija; si
// el body la incluye, se ignora en silencio en vez de fallar, para no
// forzar al frontend a nunca mandarla.
//
// LA FUENTE SÍ SE EDITA, y no es una contradicción con la
// identificación: la fuente es un dato de marketing que la recepción
// completa después («ah, me dijo que la mandó la vecina»), mientras la
// identificación es la que ya salió impresa en un comprobante.
// ---------------------------------------------------------------------
propietariosRouter.patch("/:id", async (req, res) => {
  const { nombre, telefono, email, direccion, fuenteReferenciaId, referidoPorPropietarioId } =
    req.body as {
      nombre?: string;
      telefono?: string;
      email?: string;
      direccion?: string;
      fuenteReferenciaId?: string | null;
      referidoPorPropietarioId?: string | null;
    };

  if (!nombre || !nombre.trim()) {
    return res.status(400).json({ error: "Falta el nombre del propietario." });
  }
  if (!correoUtilizable(email)) {
    return res.status(400).json({ error: ERROR_CORREO_INVALIDO });
  }

  try {
    const result = await req.db!.query(
      `UPDATE propietarios
          SET nombre = $1, telefono = $2, email = $3, direccion = $4,
              fuente_referencia_id = $5,
              -- NADIE SE REFIERE A SÍ MISMO. No es un chiste: el
              -- buscador del formulario lista a todos los clientes y el
              -- que se está editando está entre ellos. Un ciclo de un
              -- solo nodo no lo frena la FK.
              referido_por_propietario_id = CASE WHEN $6::uuid = $7::uuid THEN NULL ELSE $6::uuid END
        WHERE id = $7
        RETURNING id, nombre, telefono, email, direccion, numero_identificacion,
                  fuente_referencia_id, referido_por_propietario_id`,
      [
        nombre.trim(),
        telefono?.trim() || null,
        email?.trim() || null,
        direccion?.trim() || null,
        fuenteReferenciaId || null,
        referidoPorPropietarioId || null,
        req.params.id,
      ]
    );
    if (!result.rows[0]) {
      return res.status(404).json({ error: "Propietario no encontrado." });
    }
    res.json({ propietario: result.rows[0] });
  } catch (err) {
    console.error("PATCH /propietarios/:id", err);
    res.status(500).json({ error: "Error al actualizar el propietario." });
  }
});

// ---------------------------------------------------------------------
// GET /api/propietarios/:id/pacientes
// Mascotas ya registradas de ese propietario, para el paso 2 del wizard.
// ---------------------------------------------------------------------
propietariosRouter.get("/:id/pacientes", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.id, p.nombre, p.especie, r.nombre AS raza
       FROM pacientes p
       LEFT JOIN razas r ON r.id = p.raza_id
       WHERE p.propietario_id = $1
       ORDER BY p.nombre`,
      [req.params.id]
    );
    res.json({ pacientes: result.rows });
  } catch (err) {
    console.error("GET /propietarios/:id/pacientes", err);
    res.status(500).json({ error: "Error al listar las mascotas del propietario." });
  }
});
