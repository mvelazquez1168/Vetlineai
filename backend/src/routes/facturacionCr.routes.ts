import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { authenticate, withTenantClient } from "../middleware/auth";
import { requiereModulo } from "../tenantModulos";
import { emitir, intentarEnviar, leerEmisor } from "../facturacion/emision";
import { borrarBorrador, emitirBorrador, guardarBorrador } from "../facturacion/borradores";
import { calcularComprobante } from "../facturacion/calculo";
import { deMonto } from "../facturacion/decimal";
import { buscarPropietariosTolerante } from "../busquedaPropietarios";
import { emitirNota } from "../facturacion/notas";
import { entregarComprobante, estadoLegible, pdfDeComprobante } from "../facturacion/entrega";
import { nombresArchivo } from "../facturacion/claveConsecutivo";
import {
  borrarCredenciales,
  guardarCredenciales,
  listarCredencialesPublicas,
} from "../facturacion/credenciales";
import {
  CODIGOS_DESCUENTO,
  CODIGOS_REFERENCIA,
  CONDICIONES_VENTA,
  MEDIOS_PAGO,
  TARIFAS_IVA,
  TIPOS_COMPROBANTE,
  TIPOS_IDENTIFICACION,
  UNIDADES_MEDIDA,
} from "../facturacion/catalogos";
import { DocumentoVenta } from "../facturacion/tipos";
import { recibirComprobante, emitirMensajeReceptor, listarRecibidos } from "../facturacion/recibidos";

// ---------------------------------------------------------------------
// API del facturador electrónico. Todo bajo
// `requiereModulo("facturacion")`.
//
// El contrato del documento de venta —lo que caja, ventas y compras le
// mandan a `POST /comprobantes`— está documentado en
// `docs/facturacion/contrato-api.md`, para que no haya que leer este
// archivo para integrarse.
//
// Permisos: médico o administrador de la clínica para consultar y emitir;
// SOLO administrador para el emisor y las credenciales. Un médico no
// tiene por qué poder cambiar los datos fiscales de la clínica ni cargar
// su llave criptográfica.
// ---------------------------------------------------------------------
export const facturacionCrRouter = Router();

/**
 * La llave .p12 pesa unos pocos KB y el XML de un comprobante recibido,
 * decenas. 2 MB es holgado y evita que alguien suba un archivo enorme por
 * error. `memoryStorage` igual que el resto del backend.
 */
const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

facturacionCrRouter.use(authenticate, withTenantClient);

facturacionCrRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

facturacionCrRouter.use(requiereModulo("facturacion"));

/**
 * Solo administrador de la clínica. Un médico puede consultar y emitir;
 * los datos fiscales y la llave criptográfica son de la administración.
 */
function soloAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.esAdminClinica) {
    return res.status(403).json({
      error: "Solo un administrador de la clínica puede configurar la facturación electrónica.",
    });
  }
  next();
}

// =====================================================================
// CATÁLOGOS — lo que la pantalla de emisión manual necesita para armar
// sus selectores. Sin tenant: son catálogos de la plataforma.
// =====================================================================
facturacionCrRouter.get("/catalogos", async (_req, res) => {
  res.json({
    tiposComprobante: TIPOS_COMPROBANTE.filter((t) => t.esComprobante && t.codigo !== "08" && t.codigo !== "09").map(
      (t) => ({ codigo: t.codigo, nombre: t.nombre })
    ),
    tiposIdentificacion: TIPOS_IDENTIFICACION.map((t) => ({ codigo: t.codigo, nombre: t.nombre })),
    condicionesVenta: CONDICIONES_VENTA.filter((c) => !c.soloEnRep).map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre,
      exigeDetalle: c.exigeDetalle ?? false,
    })),
    mediosPago: MEDIOS_PAGO.map((m) => ({
      codigo: m.codigo,
      nombre: m.nombre,
      exigeDetalle: m.exigeDetalle ?? false,
    })),
    // Solo las tarifas que se pueden usar al EMITIR: los transitorios
    // (05, 06, 07) son exclusivos de notas, y ofrecerlos en una factura
    // produciría un rechazo.
    tarifasIva: TARIFAS_IVA.filter((t) => !t.soloEnNotas).map((t) => ({
      codigo: t.codigo,
      nombre: t.nombre,
      tarifa: t.tarifa,
    })),
    unidadesMedida: UNIDADES_MEDIDA,
    codigosDescuento: CODIGOS_DESCUENTO.map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre,
      exigeDetalle: c.exigeDetalle ?? false,
    })),
    codigosReferencia: CODIGOS_REFERENCIA.filter((c) => !c.soloEnRep).map((c) => ({
      codigo: c.codigo,
      nombre: c.nombre,
    })),
  });
});

/**
 * Búsqueda de CABYS por código o descripción, para la pantalla de
 * emisión manual.
 *
 * Devuelve lista vacía con un aviso cuando el catálogo no está cargado.
 * NO devuelve 500 ni inventa resultados: inventar un código CABYS es
 * peor que no tenerlo, porque el comprobante se emite y lo rechaza
 * Hacienda —o peor, lo acepta con la clasificación equivocada.
 *
 * En una instalación normal el catálogo SÍ está cargado (más de veinte
 * mil códigos del Banco Central, por `npm run cargar-catalogos-fe`).
 * Esta rama queda para el ambiente recién levantado donde ese comando
 * todavía no corrió.
 */
facturacionCrRouter.get("/cabys", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  try {
    const hay = await req.db!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM fact_cat_cabys WHERE activo = true"
    );
    if (hay.rows[0].n === "0") {
      return res.json({
        resultados: [],
        catalogoVacio: true,
        aviso:
          "El catálogo CABYS no está cargado en este servidor. Lo carga `npm run cargar-catalogos-fe` " +
          "desde la planilla del Banco Central; mientras tanto el código hay que escribirlo a mano " +
          "(13 dígitos).",
      });
    }
    if (q.length < 3) return res.json({ resultados: [], catalogoVacio: false });

    const r = await req.db!.query(
      `SELECT codigo, descripcion, codigo_tarifa_iva_sugerido
         FROM fact_cat_cabys
        WHERE activo = true
          AND (codigo LIKE $1 || '%'
               OR inmutable_unaccent(descripcion) ILIKE '%' || inmutable_unaccent($1) || '%')
        ORDER BY (codigo LIKE $1 || '%') DESC, descripcion
        LIMIT 30`,
      [q]
    );
    res.json({
      resultados: r.rows.map((f) => ({
        codigo: f.codigo,
        descripcion: f.descripcion,
        codigoTarifaIvaSugerido: f.codigo_tarifa_iva_sugerido,
      })),
      catalogoVacio: false,
    });
  } catch (err) {
    console.error("GET /facturacion/cabys", err);
    res.status(500).json({ error: "Error al buscar en el catálogo CABYS." });
  }
});

/**
 * La codificación oficial de ubicación, un nivel por vez.
 *
 * UN SOLO ENDPOINT y no cuatro: los cuatro niveles son la misma
 * pregunta ("qué hay debajo de esto") y el nivel se deduce de lo que
 * venga en la query. Con cuatro rutas habría cuatro contratos que
 * mantener sincronizados para devolver siempre `{ codigo, nombre }`.
 *
 * Sin `provincia` devuelve las provincias; con `provincia`, sus
 * cantones; con `provincia` y `canton`, sus distritos; con los tres,
 * sus barrios.
 */
facturacionCrRouter.get("/ubicacion", async (req, res) => {
  const provincia = String(req.query.provincia ?? "").trim();
  const canton = String(req.query.canton ?? "").trim();
  const distrito = String(req.query.distrito ?? "").trim();

  try {
    let nivel: string;
    let filas;
    if (!provincia) {
      nivel = "provincia";
      filas = await req.db!.query(
        `SELECT codigo, nombre FROM fact_cat_provincia ORDER BY codigo`
      );
    } else if (!canton) {
      nivel = "canton";
      filas = await req.db!.query(
        `SELECT codigo, nombre FROM fact_cat_canton WHERE provincia = $1 ORDER BY codigo`,
        [provincia]
      );
    } else if (!distrito) {
      nivel = "distrito";
      filas = await req.db!.query(
        `SELECT codigo, nombre FROM fact_cat_distrito
          WHERE provincia = $1 AND canton = $2 ORDER BY codigo`,
        [provincia, canton]
      );
    } else {
      nivel = "barrio";
      filas = await req.db!.query(
        `SELECT codigo, nombre FROM fact_cat_barrio
          WHERE provincia = $1 AND canton = $2 AND distrito = $3 ORDER BY nombre`,
        [provincia, canton, distrito]
      );
    }

    // `catalogoVacio` se informa igual que en /cabys: la pantalla tiene
    // que poder decir "esto no está cargado en el servidor" en vez de
    // mostrar un selector vacío que parece un error de la clínica.
    const hay = await req.db!.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM fact_cat_provincia"
    );
    res.json({
      nivel,
      resultados: filas.rows,
      catalogoVacio: hay.rows[0].n === "0",
    });
  } catch (err) {
    console.error("GET /facturacion/ubicacion", err);
    res.status(500).json({ error: "Error al leer la codificación de ubicación." });
  }
});

// =====================================================================
// EMISOR Y CREDENCIALES
// =====================================================================
facturacionCrRouter.get("/emisor", async (req, res) => {
  try {
    const emisor = await leerEmisor(req.db!, req.auth!.tenantId!).catch(() => null);
    if (!emisor) return res.json({ emisor: null, credenciales: [] });
    const credenciales = await listarCredencialesPublicas(req.db!, emisor.id);
    res.json({ emisor, credenciales });
  } catch (err) {
    console.error("GET /facturacion/emisor", err);
    res.status(500).json({ error: "Error al leer el emisor." });
  }
});

facturacionCrRouter.put("/emisor", soloAdmin, async (req, res) => {
  const b = req.body ?? {};
  const requeridos = [
    "tipoIdentificacion",
    "numeroIdentificacion",
    "nombre",
    "codigoActividadEconomica",
    "ubicacionProvincia",
    "ubicacionCanton",
    "ubicacionDistrito",
    "ubicacionOtrasSenas",
    "correo",
  ];
  const faltan = requeridos.filter((c) => !b[c]);
  if (faltan.length > 0) {
    return res.status(400).json({
      error: `Faltan datos fiscales obligatorios: ${faltan.join(", ")}.`,
      faltan,
    });
  }

  try {
    const r = await req.db!.query(
      `INSERT INTO fact_emisores (
         tenant_id, tipo_identificacion, numero_identificacion, nombre, nombre_comercial,
         codigo_actividad_economica, registro_fiscal_8707,
         ubicacion_provincia, ubicacion_canton, ubicacion_distrito, ubicacion_barrio,
         ubicacion_otras_senas, telefono_codigo_pais, telefono_numero, correo,
         proveedor_sistemas, sucursal, terminal, ambiente_activo
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
                 COALESCE($17,'001'), COALESCE($18,'00001'), COALESCE($19,'pruebas'))
       ON CONFLICT (tenant_id) DO UPDATE SET
         tipo_identificacion = EXCLUDED.tipo_identificacion,
         numero_identificacion = EXCLUDED.numero_identificacion,
         nombre = EXCLUDED.nombre,
         nombre_comercial = EXCLUDED.nombre_comercial,
         codigo_actividad_economica = EXCLUDED.codigo_actividad_economica,
         registro_fiscal_8707 = EXCLUDED.registro_fiscal_8707,
         ubicacion_provincia = EXCLUDED.ubicacion_provincia,
         ubicacion_canton = EXCLUDED.ubicacion_canton,
         ubicacion_distrito = EXCLUDED.ubicacion_distrito,
         ubicacion_barrio = EXCLUDED.ubicacion_barrio,
         ubicacion_otras_senas = EXCLUDED.ubicacion_otras_senas,
         telefono_codigo_pais = EXCLUDED.telefono_codigo_pais,
         telefono_numero = EXCLUDED.telefono_numero,
         correo = EXCLUDED.correo,
         sucursal = EXCLUDED.sucursal,
         terminal = EXCLUDED.terminal,
         ambiente_activo = EXCLUDED.ambiente_activo,
         actualizado_en = now()
       RETURNING id`,
      [
        req.auth!.tenantId,
        b.tipoIdentificacion,
        b.numeroIdentificacion,
        b.nombre,
        b.nombreComercial ?? null,
        b.codigoActividadEconomica,
        b.registroFiscal8707 ?? null,
        b.ubicacionProvincia,
        b.ubicacionCanton,
        b.ubicacionDistrito,
        b.ubicacionBarrio ?? null,
        b.ubicacionOtrasSenas,
        b.telefonoCodigoPais ?? null,
        b.telefonoNumero ?? null,
        b.correo,
        // El proveedor de sistemas NO se recibe del cliente: es el mismo
        // para todos los emisores y lo pone el servidor desde su
        // configuración. Recibirlo dejaría que una clínica declare a otro
        // como proveedor del software.
        proveedorSistemasConfigurado(),
        b.sucursal ?? null,
        b.terminal ?? null,
        b.ambienteActivo ?? null,
      ]
    );
    const emisor = await leerEmisor(req.db!, req.auth!.tenantId!);
    res.json({ emisor, id: r.rows[0].id });
  } catch (err) {
    console.error("PUT /facturacion/emisor", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

function proveedorSistemasConfigurado(): string {
  // Importado perezosamente para que este archivo no dependa del orden de
  // carga de config.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { config } = require("../config") as typeof import("../config");
  if (!config.feCrProveedorSistemas) {
    throw new Error(
      "FE_CR_PROVEEDOR_SISTEMAS no está configurada. Es la cédula del proveedor del sistema de facturación, obligatoria en cada comprobante (campo ProveedorSistemas del XSD v4.4)."
    );
  }
  return config.feCrProveedorSistemas;
}

facturacionCrRouter.put(
  "/emisor/credenciales",
  soloAdmin,
  subir.single("llave"),
  async (req, res) => {
    const b = req.body ?? {};
    if (!["pruebas", "produccion"].includes(b.ambiente)) {
      return res.status(400).json({ error: "El ambiente tiene que ser 'pruebas' o 'produccion'." });
    }
    if (!b.usuarioApi || !b.passwordApi || !b.pinLlave) {
      return res
        .status(400)
        .json({ error: "Hacen falta el usuario y la contraseña de la API de Hacienda y el PIN de la llave." });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Hace falta el archivo de la llave criptográfica (.p12)." });
    }

    try {
      const emisor = await leerEmisor(req.db!, req.auth!.tenantId!);
      const { publica, infoCertificado } = await guardarCredenciales(req.db!, {
        tenantId: req.auth!.tenantId!,
        emisorId: emisor.id,
        ambiente: b.ambiente,
        usuarioApi: b.usuarioApi,
        passwordApi: b.passwordApi,
        llaveP12: req.file.buffer,
        pinLlave: b.pinLlave,
        llaveNombreArchivo: req.file.originalname,
      });
      // De `infoCertificado` se devuelve lo que sirve para confirmar que
      // se cargó la llave correcta. Nunca la llave ni el PIN.
      res.json({
        credencial: publica,
        certificado: {
          sujeto: infoCertificado.sujeto,
          emisor: infoCertificado.emisor,
          validoHasta: infoCertificado.validoHasta,
          bitsRsa: infoCertificado.bitsRsa,
        },
      });
    } catch (err) {
      console.error("PUT /facturacion/emisor/credenciales", err);
      res.status(400).json({ error: mensajeDeError(err) });
    }
  }
);

facturacionCrRouter.delete("/emisor/credenciales/:ambiente", soloAdmin, async (req, res) => {
  const ambiente = req.params.ambiente;
  if (ambiente !== "pruebas" && ambiente !== "produccion") {
    return res.status(400).json({ error: "El ambiente tiene que ser 'pruebas' o 'produccion'." });
  }
  try {
    const emisor = await leerEmisor(req.db!, req.auth!.tenantId!);
    const borrada = await borrarCredenciales(req.db!, emisor.id, ambiente);
    res.json({ borrada });
  } catch (err) {
    console.error("DELETE /facturacion/emisor/credenciales", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

// =====================================================================
// COMPROBANTES
// =====================================================================

/**
 * `POST /comprobantes/vista-previa` — los totales, calculados por el
 * MISMO motor que emite.
 *
 * Existe para que la pantalla no calcule por su cuenta. Un total
 * calculado en el navegador y otro en el servidor son dos
 * implementaciones de las reglas del Anexo —redondeo, base imponible,
 * descuentos, IVA por línea— y la única forma de que no difieran es que
 * haya una sola. La pantalla muestra lo que devuelve esto.
 *
 * No escribe nada y no consume consecutivo.
 */
facturacionCrRouter.post("/comprobantes/vista-previa", async (req, res) => {
  try {
    const calculo = calcularComprobante(req.body as DocumentoVenta);

    // `deMonto` en CADA monto, y no `res.json(calculo.resumen)` a secas:
    // el motor trabaja los montos como `bigint` escalado (ver
    // decimal.ts) y `JSON.stringify` no sabe serializar un BigInt —
    // tira "Do not know how to serialize a BigInt" y la pantalla
    // muestra ese texto donde iba el total. Es además la MISMA
    // conversión que se usa al guardar en la base, así que lo que ve la
    // pantalla es carácter por carácter lo que va a quedar guardado.
    const r = calculo.resumen;
    res.json({
      resumen: {
        totalGravado: deMonto(r.totalGravado),
        totalExento: deMonto(r.totalExento),
        totalExonerado: deMonto(r.totalExonerado),
        totalNoSujeto: deMonto(r.totalNoSujeto),
        totalVenta: deMonto(r.totalVenta),
        totalDescuentos: deMonto(r.totalDescuentos),
        totalVentaNeta: deMonto(r.totalVentaNeta),
        totalImpuesto: deMonto(r.totalImpuesto),
        totalOtrosCargos: deMonto(r.totalOtrosCargos),
        totalComprobante: deMonto(r.totalComprobante),
      },
      lineas: calculo.lineas.map((l) => ({
        numeroLinea: l.numeroLinea,
        subtotal: deMonto(l.subtotal),
        baseImponible: deMonto(l.baseImponible),
        impuestoNeto: deMonto(l.impuestoNeto),
        montoTotalLinea: deMonto(l.montoTotalLinea),
      })),
    });
  } catch (err) {
    // Un documento a medio llenar da error de cálculo, y eso es
    // ESPERABLE mientras alguien escribe: se responde 400 con el motivo
    // y la pantalla muestra el total en blanco, no un error rojo.
    res.status(400).json({ error: (err as Error).message });
  }
});

/**
 * `GET /receptores?q=` — clientes de la clínica para elegir receptor.
 *
 * Es la MISMA búsqueda tolerante de la búsqueda global
 * (`busquedaPropietarios.ts`), no una copia: nombre con tolerancia a
 * errores de tipeo, teléfono y número de identificación por prefijo.
 *
 * Y es sobre `propietarios`, que ya es el fichero de clientes de la
 * clínica. Una segunda tabla de "clientes de facturación" obligaría a
 * mantener dos fichas de la misma persona.
 */
facturacionCrRouter.get("/receptores", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  try {
    const propietarios = q ? await buscarPropietariosTolerante(req.db!, q, 10) : [];
    res.json({ receptores: propietarios });
  } catch (err) {
    console.error("GET /facturacion/receptores", err);
    res.status(500).json({ error: "Error al buscar clientes." });
  }
});

/**
 * `POST /receptores` — registra un cliente nuevo desde la pantalla de
 * emisión, y queda guardado como cliente de la clínica.
 *
 * No crea nada aparte: inserta en `propietarios`, la misma tabla que
 * usa el expediente.
 */
facturacionCrRouter.post("/receptores", async (req, res) => {
  const b = req.body ?? {};
  if (!b.nombre || String(b.nombre).trim() === "") {
    return res.status(400).json({ error: "El cliente necesita un nombre." });
  }
  try {
    // El cliente manda el CÓDIGO de Hacienda ("01" cédula física, "02"
    // jurídica…), que es el que ya tiene en pantalla desde
    // `/catalogos`. El id de `tipos_identificacion` lo resuelve el
    // servidor: pedirle al navegador que conozca los UUID de un
    // catálogo interno sería acoplarlo a algo que no necesita saber.
    let tipoId: string | null = null;
    if (b.tipoIdentificacionCodigo) {
      const t = await req.db!.query<{ id: string }>(
        `SELECT ti.id FROM tipos_identificacion ti
           JOIN tenants te ON te.pais_codigo = ti.pais_codigo
          WHERE te.id = $1 AND ti.codigo = $2 AND ti.activo`,
        [req.auth!.tenantId, String(b.tipoIdentificacionCodigo)]
      );
      if (t.rows.length === 0) {
        return res.status(400).json({
          error: `El tipo de identificación "${b.tipoIdentificacionCodigo}" no está en el catálogo del país de la clínica.`,
        });
      }
      tipoId = t.rows[0].id;
    }

    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, telefono, email,
                                 tipo_identificacion_id, numero_identificacion)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        req.auth!.tenantId,
        String(b.nombre).trim(),
        b.telefono ?? null,
        b.email ?? null,
        tipoId,
        b.numeroIdentificacion ?? null,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    console.error("POST /facturacion/receptores", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

// =====================================================================
// BORRADORES
// =====================================================================

/** `POST /borradores` — guarda un comprobante sin emitirlo. */
facturacionCrRouter.post("/borradores", async (req, res) => {
  try {
    const r = await guardarBorrador(req.auth!.tenantId!, req.body as DocumentoVenta);
    res.status(201).json(r);
  } catch (err) {
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

/** `PUT /borradores/:id` — reemplaza el contenido de un borrador. */
facturacionCrRouter.put("/borradores/:id", async (req, res) => {
  try {
    const r = await guardarBorrador(
      req.auth!.tenantId!,
      req.body as DocumentoVenta,
      req.params.id
    );
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

/** `DELETE /borradores/:id` — lo elimina. Solo si sigue siendo borrador. */
facturacionCrRouter.delete("/borradores/:id", async (req, res) => {
  try {
    await borrarBorrador(req.auth!.tenantId!, req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

/**
 * `POST /borradores/:id/emitir` — recién acá el borrador consume su
 * consecutivo y pasa a existir para Hacienda.
 */
facturacionCrRouter.post("/borradores/:id/emitir", async (req, res) => {
  try {
    const resultado = await emitirBorrador(req.auth!.tenantId!, req.params.id);
    const entrega = await entregarComprobante(
      req.auth!.tenantId!,
      resultado.comprobanteId
    ).catch((err) => {
      console.error("POST /facturacion/borradores/:id/emitir: falló la entrega", err);
      return { enviado: false, motivo: "No se pudo enviar el correo al receptor." };
    });
    res.status(201).json({ ...resultado, entrega });
  } catch (err) {
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

/**
 * `POST /comprobantes` — crea y emite desde un documento de venta.
 *
 * El cuerpo ES el documento de venta de `facturacion/tipos.ts`. Se pasa
 * tal cual al motor, que valida: esta ruta NO reimplementa las
 * validaciones del cálculo ni del XML, porque entonces habría dos reglas
 * para lo mismo y una se quedaría atrás.
 */
facturacionCrRouter.post("/comprobantes", async (req, res) => {
  const documento = req.body as DocumentoVenta;
  try {
    const resultado = await emitir(req.auth!.tenantId!, documento);

    // La entrega al receptor NO bloquea la respuesta ni la invalida: un
    // correo que rebota no deshace una emisión.
    let entrega: { enviado: boolean; motivo?: string } | undefined;
    if (!resultado.yaExistia && resultado.estado !== "borrador") {
      entrega = await entregarComprobante(req.auth!.tenantId!, resultado.comprobanteId).catch(
        (err) => {
          console.error("POST /facturacion/comprobantes: falló la entrega por correo", err);
          return { enviado: false, motivo: "No se pudo enviar el correo al receptor." };
        }
      );
    }

    res.status(resultado.yaExistia ? 200 : 201).json({ ...resultado, entrega });
  } catch (err) {
    console.error("POST /facturacion/comprobantes", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

facturacionCrRouter.get("/comprobantes", async (req, res) => {
  const { tipo, estado, desde, hasta, receptor } = req.query as Record<string, string | undefined>;
  const pagina = Math.max(1, Number(req.query.pagina ?? 1));
  const porPagina = Math.min(100, Math.max(1, Number(req.query.porPagina ?? 25)));

  try {
    const condiciones: string[] = ["c.tenant_id = $1"];
    const valores: unknown[] = [req.auth!.tenantId];
    const agregar = (sql: string, valor: unknown) => {
      valores.push(valor);
      condiciones.push(sql.replace("$?", `$${valores.length}`));
    };
    if (tipo) agregar("c.tipo_comprobante = $?", tipo);
    if (estado) agregar("c.estado = $?", estado);
    if (desde) agregar("c.fecha_emision >= $?", desde);
    if (hasta) agregar("c.fecha_emision < ($?::date + interval '1 day')", hasta);
    if (receptor) {
      // Por nombre o por identificación, sin que quien busca tenga que
      // saber cuál de los dos tiene a mano.
      valores.push(`%${receptor}%`);
      condiciones.push(
        `(inmutable_unaccent(c.receptor_nombre) ILIKE inmutable_unaccent($${valores.length})` +
          ` OR c.receptor_numero_identificacion ILIKE $${valores.length})`
      );
    }
    const where = condiciones.join(" AND ");

    const total = await req.db!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fact_comprobantes c WHERE ${where}`,
      valores
    );

    const r = await req.db!.query(
      `SELECT c.id, c.tipo_comprobante, c.clave, c.consecutivo, c.fecha_emision, c.estado,
              c.receptor_nombre, c.receptor_numero_identificacion,
              c.moneda, c.total_comprobante, c.respuesta_ind_estado, c.respuesta_detalle
         FROM fact_comprobantes c
        WHERE ${where}
        ORDER BY c.fecha_emision DESC, c.consecutivo DESC
        LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
      valores
    );

    res.json({
      total: Number(total.rows[0].n),
      pagina,
      porPagina,
      comprobantes: r.rows.map((f) => ({
        id: f.id,
        tipoComprobante: f.tipo_comprobante,
        tipoComprobanteNombre:
          TIPOS_COMPROBANTE.find((t) => t.codigo === f.tipo_comprobante)?.nombre ?? f.tipo_comprobante,
        clave: f.clave,
        consecutivo: f.consecutivo,
        fechaEmision: f.fecha_emision,
        estado: f.estado,
        estadoLegible: estadoLegible(f.estado, f.respuesta_ind_estado),
        receptorNombre: f.receptor_nombre,
        receptorIdentificacion: f.receptor_numero_identificacion,
        moneda: f.moneda,
        totalComprobante: f.total_comprobante,
        indEstado: f.respuesta_ind_estado,
        detalle: f.respuesta_detalle,
      })),
    });
  } catch (err) {
    console.error("GET /facturacion/comprobantes", err);
    res.status(500).json({ error: "Error al listar los comprobantes." });
  }
});

facturacionCrRouter.get("/comprobantes/:id", async (req, res) => {
  try {
    const c = await req.db!.query(
      `SELECT * FROM fact_comprobantes WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    const f = c.rows[0];
    if (!f) return res.status(404).json({ error: "No existe ese comprobante." });

    const lineas = await req.db!.query(
      `SELECT l.*,
              COALESCE((SELECT json_agg(json_build_object(
                 'codigoImpuesto', i.codigo_impuesto,
                 'codigoTarifaIva', i.codigo_tarifa_iva,
                 'tarifa', i.tarifa,
                 'monto', i.monto,
                 'montoExonerado', i.exoneracion_monto
               ) ORDER BY i.codigo_impuesto) FROM fact_linea_impuestos i WHERE i.linea_id = l.id), '[]') AS impuestos,
              COALESCE((SELECT json_agg(json_build_object(
                 'monto', d.monto, 'codigo', d.codigo_descuento, 'naturaleza', d.naturaleza
               )) FROM fact_linea_descuentos d WHERE d.linea_id = l.id), '[]') AS descuentos
         FROM fact_comprobante_lineas l
        WHERE l.comprobante_id = $1
        ORDER BY l.numero_linea`,
      [f.id]
    );

    const eventos = await req.db!.query(
      `SELECT tipo_evento, detalle, creado_en FROM fact_comprobante_eventos
        WHERE comprobante_id = $1 ORDER BY creado_en, id`,
      [f.id]
    );

    const referencias = await req.db!.query(
      `SELECT tipo_documento, numero, fecha_emision, codigo, razon
         FROM fact_comprobante_referencias WHERE comprobante_id = $1`,
      [f.id]
    );

    const mediosPago = await req.db!.query(
      `SELECT codigo_medio_pago, medio_pago_otro, monto
         FROM fact_comprobante_medios_pago WHERE comprobante_id = $1`,
      [f.id]
    );

    // Las notas que corrigen ESTE comprobante, para poder navegar desde
    // el original hacia ellas y no solo al revés.
    const notas = await req.db!.query(
      `SELECT id, tipo_comprobante, consecutivo, clave, estado, total_comprobante
         FROM fact_comprobantes WHERE comprobante_referencia_id = $1 ORDER BY fecha_emision`,
      [f.id]
    );

    res.json({
      comprobante: {
        ...sinColumnasPesadas(f),
        estadoLegible: estadoLegible(f.estado, f.respuesta_ind_estado),
        // Los XML se devuelven como texto solo en el detalle, que es
        // donde la pantalla los muestra. En el LISTADO no van: son 6-10 KB
        // por comprobante y nadie los lee desde una tabla.
        xmlFirmado: f.xml_firmado ? f.xml_firmado.toString("utf-8") : null,
        respuestaXml: f.respuesta_xml ? f.respuesta_xml.toString("utf-8") : null,
      },
      lineas: lineas.rows,
      eventos: eventos.rows,
      referencias: referencias.rows,
      mediosPago: mediosPago.rows,
      notas: notas.rows,
    });
  } catch (err) {
    console.error("GET /facturacion/comprobantes/:id", err);
    res.status(500).json({ error: "Error al leer el comprobante." });
  }
});

/** Quita del objeto crudo las columnas binarias, que se devuelven aparte. */
function sinColumnasPesadas(fila: Record<string, unknown>): Record<string, unknown> {
  const { xml_firmado, respuesta_xml, ...resto } = fila;
  return resto;
}

facturacionCrRouter.post("/comprobantes/:id/nota-credito", async (req, res) => {
  await emitirNotaDesdeRuta(req, res, "credito");
});
facturacionCrRouter.post("/comprobantes/:id/nota-debito", async (req, res) => {
  await emitirNotaDesdeRuta(req, res, "debito");
});

async function emitirNotaDesdeRuta(req: Request, res: Response, tipo: "credito" | "debito") {
  const b = (req.body ?? {}) as Record<string, unknown>;
  if (!b.codigoReferencia) {
    return res.status(400).json({
      error:
        "Hace falta el código de referencia (Nota 9): '01' anula el documento, '02' corrige el monto, etc. No tiene valor por defecto porque el efecto contable para el receptor es distinto en cada caso.",
    });
  }
  if (!b.razon) {
    return res.status(400).json({ error: "Hace falta la razón de la nota." });
  }
  try {
    const resultado = await emitirNota(req.auth!.tenantId!, req.params.id, {
      tipo,
      codigoReferencia: String(b.codigoReferencia),
      razon: String(b.razon),
      lineas: b.lineas as never,
      claveIdempotencia: b.claveIdempotencia as string | undefined,
    });
    const entrega = await entregarComprobante(req.auth!.tenantId!, resultado.comprobanteId).catch(
      () => ({ enviado: false, motivo: "No se pudo enviar el correo al receptor." })
    );
    res.status(201).json({ ...resultado, entrega });
  } catch (err) {
    console.error(`POST /facturacion/comprobantes/:id/nota-${tipo}`, err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
}

facturacionCrRouter.get("/comprobantes/:id/pdf", async (req, res) => {
  try {
    const c = await req.db!.query<{ clave: string }>(
      `SELECT clave FROM fact_comprobantes WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (!c.rows[0]) return res.status(404).json({ error: "No existe ese comprobante." });

    const pdf = await pdfDeComprobante(req.auth!.tenantId!, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${nombresArchivo.pdf(c.rows[0].clave)}"`
    );
    res.send(pdf);
  } catch (err) {
    console.error("GET /facturacion/comprobantes/:id/pdf", err);
    res.status(500).json({ error: "Error al generar el PDF." });
  }
});

facturacionCrRouter.get("/comprobantes/:id/xml", async (req, res) => {
  try {
    const c = await req.db!.query<{ clave: string; xml_firmado: Buffer | null }>(
      `SELECT clave, xml_firmado FROM fact_comprobantes WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    const f = c.rows[0];
    if (!f) return res.status(404).json({ error: "No existe ese comprobante." });
    if (!f.xml_firmado) {
      return res
        .status(409)
        .json({ error: "El comprobante todavía no está firmado: no hay XML que descargar." });
    }
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${nombresArchivo.xml(f.clave)}"`);
    res.send(f.xml_firmado);
  } catch (err) {
    console.error("GET /facturacion/comprobantes/:id/xml", err);
    res.status(500).json({ error: "Error al leer el XML." });
  }
});

/**
 * Reintenta el envío a Hacienda, o vuelve a mandarle el correo al
 * receptor. Dos cosas distintas y dos parámetros distintos: "reenviar" a
 * secas es ambiguo justo cuando alguien lo necesita con urgencia.
 */
facturacionCrRouter.post("/comprobantes/:id/reenviar", async (req, res) => {
  const destino = String((req.body ?? {}).destino ?? "hacienda");
  try {
    const existe = await req.db!.query(
      `SELECT 1 FROM fact_comprobantes WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.auth!.tenantId]
    );
    if (existe.rows.length === 0) return res.status(404).json({ error: "No existe ese comprobante." });

    if (destino === "correo") {
      const entrega = await entregarComprobante(req.auth!.tenantId!, req.params.id);
      return res.json({ destino, entrega });
    }
    if (destino !== "hacienda") {
      return res.status(400).json({ error: "El destino tiene que ser 'hacienda' o 'correo'." });
    }

    const resultado = await intentarEnviar(req.auth!.tenantId!, req.params.id);
    res.json({ destino, ...resultado });
  } catch (err) {
    console.error("POST /facturacion/comprobantes/:id/reenviar", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

// =====================================================================
// COMPROBANTES RECIBIDOS DE PROVEEDORES
// =====================================================================
facturacionCrRouter.get("/recibidos", async (req, res) => {
  try {
    const emisor = await leerEmisor(req.db!, req.auth!.tenantId!).catch(() => null);
    if (!emisor) return res.json({ recibidos: [] });
    res.json({ recibidos: await listarRecibidos(req.db!, emisor.id) });
  } catch (err) {
    console.error("GET /facturacion/recibidos", err);
    res.status(500).json({ error: "Error al listar los comprobantes recibidos." });
  }
});

facturacionCrRouter.post("/recibidos", subir.single("xml"), async (req, res) => {
  // Acepta el XML como archivo o como texto en el cuerpo: la pantalla
  // sube un archivo, y una integración futura va a mandar el texto.
  const xml = req.file?.buffer?.toString("utf-8") ?? (req.body ?? {}).xml;
  if (!xml || typeof xml !== "string") {
    return res.status(400).json({ error: "Hace falta el XML del comprobante del proveedor." });
  }
  try {
    const emisor = await leerEmisor(req.db!, req.auth!.tenantId!);
    const resultado = await recibirComprobante(req.db!, req.auth!.tenantId!, emisor.id, xml);
    res.status(201).json(resultado);
  } catch (err) {
    console.error("POST /facturacion/recibidos", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

facturacionCrRouter.post("/recibidos/:id/mensaje", async (req, res) => {
  const b = req.body ?? {};
  if (!["1", "2", "3"].includes(String(b.mensaje))) {
    return res.status(400).json({
      error:
        "El mensaje tiene que ser '1' (aceptado), '2' (aceptado parcialmente) o '3' (rechazado). Son los tres valores del XSD MensajeReceptor, de un dígito.",
    });
  }
  try {
    const resultado = await emitirMensajeReceptor(req.auth!.tenantId!, req.params.id, {
      mensaje: String(b.mensaje) as "1" | "2" | "3",
      condicionImpuesto: b.condicionImpuesto ? String(b.condicionImpuesto) : undefined,
      detalle: b.detalle ? String(b.detalle) : undefined,
    });
    res.status(201).json(resultado);
  } catch (err) {
    console.error("POST /facturacion/recibidos/:id/mensaje", err);
    res.status(400).json({ error: mensajeDeError(err) });
  }
});

/**
 * El mensaje de un error, para el cliente.
 *
 * Los errores del motor son explicativos a propósito (dicen qué campo
 * falta y por qué), así que se pasan tal cual. Lo que NO se pasa es un
 * error de Postgres crudo: un "violates foreign key constraint" no le
 * sirve a nadie en una pantalla.
 */
function mensajeDeError(err: unknown): string {
  const e = err as { message?: string; code?: string; constraint?: string };
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) {
    if (e.code === "23505") return "Ese comprobante ya existe (clave o consecutivo repetido).";
    if (e.code === "23503") {
      // La ubicación es, de lejos, la FK que más se viola: son tres
      // códigos que hay que combinar bien entre sí. Decir "un código"
      // a secas obligaría a adivinar cuál de los tres está mal.
      if (e.constraint?.includes("ubicacion")) {
        return (
          "Esa combinación de provincia, cantón y distrito no existe en la codificación " +
          "oficial de Hacienda. Los tres códigos tienen que corresponderse entre sí."
        );
      }
      return "Hay un código que no existe en los catálogos de Hacienda.";
    }
    if (e.code === "23514") return "Un dato no cumple el formato que exige Hacienda.";
    if (e.code === "23001") return e.message ?? "La operación no está permitida sobre este comprobante.";
    return "No se pudo completar la operación por un problema de datos.";
  }
  return e.message ?? "No se pudo completar la operación.";
}
