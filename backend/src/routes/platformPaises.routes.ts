import { Router } from "express";
import { PoolClient } from "pg";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// Platform Admin — directorio de países y tributación. Cubre paises,
// impuestos_pais (mismo patrón cerrar-y-crear que tarifas_modelo) y
// tipos_identificacion, más la lista de espera de países no habilitados
// (lista_espera_paises, distinta de la lista de espera de turnos del
// módulo de Agenda — sin relación).
// ---------------------------------------------------------------------

export const platformPaisesRouter = Router();

platformPaisesRouter.use(authenticate, withTenantClient);

platformPaisesRouter.use((req, res, next) => {
  if (req.auth!.rol !== "super_admin") {
    return res.status(403).json({ error: "El directorio de países es solo para super_admin." });
  }
  next();
});

// GET /paises — listado con su configuración + impuesto vigente (si hay).
platformPaisesRouter.get("/paises", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT p.codigo_iso, p.nombre, p.idioma_default, p.estado, p.moneda_cotizacion,
              p.moneda_liquidacion, p.pasarela_codigo, p.proveedor_facturacion,
              i.nombre AS impuesto_nombre, i.tasa AS impuesto_tasa
       FROM paises p
       LEFT JOIN impuestos_pais i ON i.pais_codigo = p.codigo_iso AND i.vigente_hasta IS NULL
       ORDER BY p.estado = 'habilitado' DESC, p.estado = 'lista_espera' DESC, p.nombre`
    );
    res.json({
      paises: result.rows.map((p) => ({
        codigoIso: p.codigo_iso,
        nombre: p.nombre,
        idiomaDefault: p.idioma_default,
        estado: p.estado,
        monedaCotizacion: p.moneda_cotizacion,
        monedaLiquidacion: p.moneda_liquidacion,
        pasarelaCodigo: p.pasarela_codigo,
        proveedorFacturacion: p.proveedor_facturacion,
        impuesto: p.impuesto_nombre ? { nombre: p.impuesto_nombre, tasa: Number(p.impuesto_tasa) } : null,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/paises", err);
    res.status(500).json({ error: "Error al listar países." });
  }
});

async function calcularChecklist(db: PoolClient, codigoIso: string) {
  const paisResult = await db.query(
    `SELECT idioma_default, pasarela_codigo, proveedor_facturacion FROM paises WHERE codigo_iso = $1`,
    [codigoIso]
  );
  const pais = paisResult.rows[0];
  if (!pais) return null;

  const impuestoResult = await db.query(
    `SELECT 1 FROM impuestos_pais WHERE pais_codigo = $1 AND vigente_hasta IS NULL`,
    [codigoIso]
  );

  return {
    pasarela: pais.pasarela_codigo !== null,
    impuestoVigente: impuestoResult.rows.length > 0,
    proveedorFacturacion: pais.proveedor_facturacion !== null,
    idioma: pais.idioma_default !== null,
  };
}

// GET /paises/:codigo — detalle: checklist de habilitación + tipos de
// identificación, para la pantalla de detalle de país.
platformPaisesRouter.get("/paises/:codigo", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  try {
    const paisResult = await req.db!.query(
      `SELECT p.codigo_iso, p.nombre, p.idioma_default, p.estado, p.moneda_cotizacion,
              p.moneda_liquidacion, p.pasarela_codigo, p.proveedor_facturacion, p.motivo_inactivacion,
              i.nombre AS impuesto_nombre, i.tasa AS impuesto_tasa
       FROM paises p
       LEFT JOIN impuestos_pais i ON i.pais_codigo = p.codigo_iso AND i.vigente_hasta IS NULL
       WHERE p.codigo_iso = $1`,
      [codigoIso]
    );
    const paisFila = paisResult.rows[0];
    if (!paisFila) return res.status(404).json({ error: "País no encontrado." });

    const checklist = await calcularChecklist(req.db!, codigoIso);
    if (!checklist) return res.status(404).json({ error: "País no encontrado." });

    const tiposResult = await req.db!.query(
      `SELECT id, codigo, etiqueta, aplica_persona_fisica, aplica_persona_juridica, activo, orden
       FROM tipos_identificacion WHERE pais_codigo = $1 ORDER BY orden, etiqueta`,
      [codigoIso]
    );

    // Conteo de clínicas del país — se muestra tanto en el detalle como en
    // la confirmación de inactivar (Paso 4).
    const clinicasResult = await req.db!.query(
      `SELECT
         COUNT(*) FILTER (WHERE true) AS total,
         COUNT(*) FILTER (WHERE s.estado = 'prueba') AS en_prueba
       FROM tenants t
       JOIN suscripciones s ON s.id = t.suscripcion_id
       WHERE t.pais_codigo = $1`,
      [codigoIso]
    );

    res.json({
      pais: {
        codigoIso: paisFila.codigo_iso,
        nombre: paisFila.nombre,
        idiomaDefault: paisFila.idioma_default,
        estado: paisFila.estado,
        monedaCotizacion: paisFila.moneda_cotizacion,
        monedaLiquidacion: paisFila.moneda_liquidacion,
        pasarelaCodigo: paisFila.pasarela_codigo,
        proveedorFacturacion: paisFila.proveedor_facturacion,
        motivoInactivacion: paisFila.motivo_inactivacion,
        impuesto: paisFila.impuesto_nombre
          ? { nombre: paisFila.impuesto_nombre, tasa: Number(paisFila.impuesto_tasa) }
          : null,
      },
      clinicas: {
        total: Number(clinicasResult.rows[0].total),
        enPrueba: Number(clinicasResult.rows[0].en_prueba),
      },
      checklist,
      tiposIdentificacion: tiposResult.rows.map((t) => ({
        id: t.id,
        codigo: t.codigo,
        etiqueta: t.etiqueta,
        aplicaPersonaFisica: t.aplica_persona_fisica,
        aplicaPersonaJuridica: t.aplica_persona_juridica,
        activo: t.activo,
        orden: t.orden,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/paises/:codigo", err);
    res.status(500).json({ error: "Error al obtener el detalle del país." });
  }
});

// PATCH /paises/:codigo — moneda, pasarela y proveedor de facturación.
// El estado tiene su propio endpoint (más abajo) porque valida requisitos.
platformPaisesRouter.patch("/paises/:codigo", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  const { monedaLiquidacion, pasarelaCodigo, proveedorFacturacion } = req.body as {
    monedaLiquidacion?: string | null;
    pasarelaCodigo?: string | null;
    proveedorFacturacion?: string | null;
  };

  try {
    const result = await req.db!.query(
      `UPDATE paises
       SET moneda_liquidacion = COALESCE($1, moneda_liquidacion),
           pasarela_codigo = COALESCE($2, pasarela_codigo),
           proveedor_facturacion = COALESCE($3, proveedor_facturacion),
           actualizado_en = now()
       WHERE codigo_iso = $4
       RETURNING codigo_iso`,
      [monedaLiquidacion, pasarelaCodigo, proveedorFacturacion, codigoIso]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "País no encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /platform-admin/paises/:codigo", err);
    res.status(500).json({ error: "Error al actualizar el país." });
  }
});

// POST /paises/:codigo/impuesto — cerrar-y-crear, nunca UPDATE.
platformPaisesRouter.post("/paises/:codigo/impuesto", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  const { nombre, tasa } = req.body as { nombre?: string; tasa?: number };

  if (!nombre || typeof tasa !== "number" || !Number.isFinite(tasa) || tasa < 0) {
    return res.status(400).json({ error: "Falta el nombre del impuesto o la tasa no es válida." });
  }

  try {
    await req.db!.query(
      `UPDATE impuestos_pais SET vigente_hasta = current_date
       WHERE pais_codigo = $1 AND vigente_hasta IS NULL`,
      [codigoIso]
    );
    const nuevo = await req.db!.query(
      `INSERT INTO impuestos_pais (pais_codigo, nombre, tasa, vigente_desde)
       VALUES ($1, $2, $3, current_date)
       RETURNING id, vigente_desde`,
      [codigoIso, nombre, tasa]
    );
    res.status(201).json({ id: nuevo.rows[0].id, nombre, tasa, vigenteDesde: nuevo.rows[0].vigente_desde });
  } catch (err) {
    console.error("POST /platform-admin/paises/:codigo/impuesto", err);
    res.status(500).json({ error: "Error al crear el nuevo impuesto." });
  }
});

// GET/POST tipos de identificación del país.
platformPaisesRouter.get("/paises/:codigo/tipos-identificacion", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  try {
    const result = await req.db!.query(
      `SELECT id, codigo, etiqueta, aplica_persona_fisica, aplica_persona_juridica, activo, orden
       FROM tipos_identificacion WHERE pais_codigo = $1 ORDER BY orden, etiqueta`,
      [codigoIso]
    );
    res.json({
      tipos: result.rows.map((t) => ({
        id: t.id,
        codigo: t.codigo,
        etiqueta: t.etiqueta,
        aplicaPersonaFisica: t.aplica_persona_fisica,
        aplicaPersonaJuridica: t.aplica_persona_juridica,
        activo: t.activo,
        orden: t.orden,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/paises/:codigo/tipos-identificacion", err);
    res.status(500).json({ error: "Error al listar los tipos de identificación." });
  }
});

platformPaisesRouter.post("/paises/:codigo/tipos-identificacion", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  const { codigo, etiqueta, aplicaPersonaFisica, aplicaPersonaJuridica, formatoRegex, orden } = req.body as {
    codigo?: string;
    etiqueta?: string;
    aplicaPersonaFisica?: boolean;
    aplicaPersonaJuridica?: boolean;
    formatoRegex?: string;
    orden?: number;
  };

  if (!codigo || !etiqueta || (!aplicaPersonaFisica && !aplicaPersonaJuridica)) {
    return res.status(400).json({
      error: "Faltan datos: código, etiqueta y al menos un tipo de persona al que aplica.",
    });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO tipos_identificacion
         (pais_codigo, codigo, etiqueta, aplica_persona_fisica, aplica_persona_juridica, formato_regex, orden)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [codigoIso, codigo, etiqueta, !!aplicaPersonaFisica, !!aplicaPersonaJuridica, formatoRegex ?? null, orden ?? 0]
    );
    res.status(201).json({ id: result.rows[0].id });
  } catch (err: any) {
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Ya existe un tipo de identificación con ese código en ese país." });
    }
    console.error("POST /platform-admin/paises/:codigo/tipos-identificacion", err);
    res.status(500).json({ error: "Error al crear el tipo de identificación." });
  }
});

// PATCH /tipos-identificacion/:id — activar/desactivar o editar etiqueta.
platformPaisesRouter.patch("/tipos-identificacion/:id", async (req, res) => {
  const { activo, etiqueta } = req.body as { activo?: boolean; etiqueta?: string };
  try {
    const result = await req.db!.query(
      `UPDATE tipos_identificacion
       SET activo = COALESCE($1, activo), etiqueta = COALESCE($2, etiqueta)
       WHERE id = $3
       RETURNING id`,
      [activo, etiqueta, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "No se encontró el tipo de identificación." });
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /platform-admin/tipos-identificacion/:id", err);
    res.status(500).json({ error: "Error al actualizar el tipo de identificación." });
  }
});

// PATCH /paises/:codigo/estado — solo puede pasar a 'habilitado' si tiene
// los 4 requisitos completos (pasarela, impuesto vigente, proveedor de
// facturación, idioma). Las otras transiciones (a lista_espera/no_disponible)
// no tienen requisitos.
platformPaisesRouter.patch("/paises/:codigo/estado", async (req, res) => {
  const codigoIso = req.params.codigo.toUpperCase();
  const { estado, motivo } = req.body as { estado?: string; motivo?: string };

  if (!estado || !["no_disponible", "lista_espera", "habilitado"].includes(estado)) {
    return res.status(400).json({ error: "Estado no válido." });
  }

  try {
    if (estado === "habilitado") {
      const checklist = await calcularChecklist(req.db!, codigoIso);
      if (!checklist) return res.status(404).json({ error: "País no encontrado." });

      const faltantes = Object.entries(checklist)
        .filter(([, cumplido]) => !cumplido)
        .map(([item]) => item);

      if (faltantes.length > 0) {
        return res.status(400).json({
          error: "No se puede habilitar el país: faltan requisitos.",
          faltantes,
        });
      }
    }

    // motivo_inactivacion solo tiene sentido fuera de 'habilitado' — se
    // limpia al re-habilitar, igual que motivo_mantenimiento en agentes.
    const result = await req.db!.query(
      `UPDATE paises
       SET estado = $1::varchar,
           motivo_inactivacion = CASE WHEN $1::varchar = 'habilitado' THEN NULL ELSE $2::text END,
           actualizado_en = now()
       WHERE codigo_iso = $3
       RETURNING codigo_iso`,
      [estado, motivo?.trim() || null, codigoIso]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "País no encontrado." });

    res.json({ codigoIso, estado });
  } catch (err) {
    console.error("PATCH /platform-admin/paises/:codigo/estado", err);
    res.status(500).json({ error: "Error al cambiar el estado del país." });
  }
});

// GET /lista-espera — contador por país + listado completo de interesados.
platformPaisesRouter.get("/lista-espera", async (req, res) => {
  try {
    const porPaisResult = await req.db!.query(
      `SELECT le.pais_codigo, p.nombre AS pais_nombre, COUNT(*) AS cantidad
       FROM lista_espera_paises le
       LEFT JOIN paises p ON p.codigo_iso = le.pais_codigo
       GROUP BY le.pais_codigo, p.nombre
       ORDER BY cantidad DESC`
    );
    const interesadosResult = await req.db!.query(
      `SELECT le.id, le.correo, le.pais_codigo, p.nombre AS pais_nombre, le.creado_en
       FROM lista_espera_paises le
       LEFT JOIN paises p ON p.codigo_iso = le.pais_codigo
       ORDER BY le.creado_en DESC`
    );

    res.json({
      totalInteresados: interesadosResult.rows.length,
      porPais: porPaisResult.rows.map((r) => ({
        paisCodigo: r.pais_codigo,
        paisNombre: r.pais_nombre,
        cantidad: Number(r.cantidad),
      })),
      interesados: interesadosResult.rows.map((r) => ({
        id: r.id,
        correo: r.correo,
        paisCodigo: r.pais_codigo,
        paisNombre: r.pais_nombre,
        creadoEn: r.creado_en,
      })),
    });
  } catch (err) {
    console.error("GET /platform-admin/lista-espera", err);
    res.status(500).json({ error: "Error al listar la lista de espera." });
  }
});
