import { NextFunction, Request, Response, Router } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { authenticate, withTenantClient } from "../middleware/auth";
import { requiereModulo } from "../tenantModulos";
import { registrarMovimiento, registrarTraslado } from "../inventario/movimientos";
import { aprobarAjuste, rechazarAjuste, solicitarAjuste } from "../inventario/ajustes";
import {
  alertasDeInventario,
  consumoDeProducto,
  existenciasDeProducto,
  kardexDeProducto,
} from "../inventario/consultas";
import {
  crearOrden,
  devolverAProveedor,
  recibirOrden,
  sugerirOrden,
} from "../inventario/compras";
import { abrirConteo, anotarConteo, cerrarConteo } from "../inventario/conteos";
import {
  COLUMNAS_PLANTILLA,
  analizarImportacion,
  importarInventario,
} from "../inventario/importacion";
import {
  AlcanceMasivo,
  aplicarMasiva,
  crearLista,
  editarLista,
  fijarItem,
  itemsDeLista,
  listas,
  vistaPreviaMasiva,
} from "../inventario/precios";

// ---------------------------------------------------------------------
// API del módulo `inventario`. Todo bajo `requiereModulo('inventario')`.
//
// Permisos, mismo criterio que el facturador: médico o administrador
// para consultar y mover; SOLO administrador para aprobar ajustes,
// configurar parámetros e importar. Aprobar el ajuste que uno mismo
// pidió no es un control.
//
// Las rutas son finas a propósito: validan la forma del pedido, llaman
// al módulo de dominio y traducen el error. La lógica —la conversión a
// unidad base, el FEFO, el umbral, el cálculo de la sugerida— vive en
// `src/inventario/`, para que caja y la atención la usen igual sin
// pasar por HTTP.
// ---------------------------------------------------------------------
export const inventarioRouter = Router();

const subir = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

inventarioRouter.use(authenticate, withTenantClient);

inventarioRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

inventarioRouter.use(requiereModulo("inventario"));

function soloAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.esAdminClinica) {
    return res.status(403).json({
      error: "Esto lo hace un administrador de la clínica.",
    });
  }
  next();
}

function fallo(res: Response, err: unknown, contexto: string) {
  const e = err as { message?: string; code?: string };
  // Los errores de dominio ya traen un mensaje escrito para una
  // persona; los de la base, no. Un 23505 crudo no le dice nada a
  // quien está cargando un producto.
  if (e.code === "23505") {
    return res.status(409).json({ error: "Ya existe un registro con ese código." });
  }
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) {
    console.error(contexto, err);
    return res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
  }
  res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
}

// =====================================================================
// CATÁLOGOS DEL MÓDULO
// =====================================================================
inventarioRouter.get("/catalogos", async (req, res) => {
  try {
    const [lineas, especialidades, tipos, motivos, unidades, tarifas] = await Promise.all([
      req.db!.query(`SELECT codigo, nombre FROM lineas_negocio WHERE activo ORDER BY orden`),
      req.db!.query(`SELECT codigo, nombre FROM especialidades WHERE activo ORDER BY orden`),
      req.db!.query(
        `SELECT codigo, nombre, direccion, origen_tipico FROM inv_tipos_movimiento
          WHERE activo ORDER BY orden`
      ),
      req.db!.query(
        `SELECT codigo, nombre, exige_detalle FROM inv_motivos WHERE activo ORDER BY orden`
      ),
      req.db!.query(
        `SELECT codigo, descripcion FROM fact_cat_unidad_medida WHERE activo ORDER BY codigo`
      ),
      req.db!.query(
        `SELECT codigo, nombre, tarifa FROM fact_cat_tarifa_iva WHERE activo ORDER BY codigo`
      ),
    ]);
    res.json({
      lineasNegocio: lineas.rows,
      especialidades: especialidades.rows,
      tiposMovimiento: tipos.rows,
      motivos: motivos.rows,
      unidadesMedida: unidades.rows,
      tarifasIva: tarifas.rows,
    });
  } catch (err) {
    fallo(res, err, "GET /inventario/catalogos");
  }
});

// =====================================================================
// BODEGAS
// =====================================================================
inventarioRouter.get("/bodegas", async (req, res) => {
  const r = await req.db!.query(
    `SELECT id, codigo, nombre, es_default, activo FROM inv_bodegas ORDER BY nombre`
  );
  res.json({ bodegas: r.rows });
});

inventarioRouter.post("/bodegas", soloAdmin, async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,$2,$3,COALESCE($4,false)) RETURNING id`,
      [req.auth!.tenantId, b.codigo, b.nombre, b.esDefault ?? false]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/bodegas");
  }
});

// =====================================================================
// PRODUCTOS
// =====================================================================
inventarioRouter.get("/productos", async (req, res) => {
  const { q, categoria, linea, bodega, bajoMinimo, porVencer } = req.query as Record<
    string,
    string | undefined
  >;
  const pagina = Math.max(1, Number(req.query.pagina ?? 1));
  const porPagina = Math.min(100, Math.max(1, Number(req.query.porPagina ?? 25)));

  const condiciones = ["p.activo"];
  const valores: unknown[] = [];
  const agregar = (sql: string, valor: unknown) => {
    valores.push(valor);
    condiciones.push(sql.replace("$?", `$${valores.length}`));
  };
  if (q) {
    valores.push(q);
    condiciones.push(
      `(inmutable_unaccent(lower(p.nombre)) ILIKE '%' || inmutable_unaccent(lower($${valores.length})) || '%'
        OR p.codigo ILIKE $${valores.length} || '%')`
    );
  }
  if (categoria) agregar("p.categoria = $?", categoria);
  if (linea) agregar("p.linea_negocio = $?", linea);

  const where = condiciones.join(" AND ");
  // El filtro de bodega entra en la SUBCONSULTA de existencia, no en el
  // WHERE: filtrar los productos por bodega escondería los que esa
  // bodega no tiene, y lo que se quiere es verlos en cero.
  const paramBodega = bodega ? `AND l.bodega_id = $${valores.length + 1}` : "";
  if (bodega) valores.push(bodega);

  try {
    const total = await req.db!.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM inv_productos p WHERE ${where}`,
      valores.slice(0, bodega ? valores.length - 1 : valores.length)
    );

    const r = await req.db!.query(
      `SELECT p.id, p.codigo, p.nombre, p.categoria, p.linea_negocio, p.unidad_base,
              p.minimo, p.punto_reorden, p.requiere_receta, p.es_controlado,
              p.requiere_refrigeracion, p.medicamento_id,
              COALESCE((SELECT sum(l.cantidad) FROM inv_lotes l
                         WHERE l.producto_id = p.id ${paramBodega}), 0)::text AS existencia,
              (SELECT min(l.vencimiento_efectivo) FROM inv_lotes l
                WHERE l.producto_id = p.id AND l.cantidad > 0) AS proximo_vencimiento
         FROM inv_productos p
        WHERE ${where}
        ORDER BY p.nombre
        LIMIT ${porPagina} OFFSET ${(pagina - 1) * porPagina}`,
      valores
    );

    let productos = r.rows;
    // Los dos filtros que dependen de un cálculo se aplican después, y
    // está dicho: filtrarlos en SQL obligaría a repetir las
    // subconsultas en el WHERE y en el SELECT.
    if (bajoMinimo === "true") {
      productos = productos.filter((p) => Number(p.existencia) < Number(p.minimo));
    }
    if (porVencer === "true") {
      productos = productos.filter(
        (p) =>
          p.proximo_vencimiento &&
          new Date(p.proximo_vencimiento).getTime() <= Date.now() + 90 * 86400000
      );
    }

    res.json({ productos, total: Number(total.rows[0].n), pagina, porPagina });
  } catch (err) {
    fallo(res, err, "GET /inventario/productos");
  }
});

inventarioRouter.get("/productos/:id", async (req, res) => {
  try {
    const p = await req.db!.query(`SELECT * FROM inv_productos WHERE id = $1`, [req.params.id]);
    if (p.rows.length === 0) return res.status(404).json({ error: "No existe ese producto." });

    const [presentaciones, lotes, existencias] = await Promise.all([
      req.db!.query(
        `SELECT * FROM inv_presentaciones WHERE producto_id = $1 ORDER BY factor DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT l.*, b.nombre AS bodega FROM inv_lotes l
           JOIN inv_bodegas b ON b.id = l.bodega_id
          WHERE l.producto_id = $1 ORDER BY l.vencimiento_efectivo NULLS LAST`,
        [req.params.id]
      ),
      existenciasDeProducto(req.db!, req.params.id),
    ]);

    res.json({
      producto: p.rows[0],
      presentaciones: presentaciones.rows,
      lotes: lotes.rows,
      existencias,
    });
  } catch (err) {
    fallo(res, err, "GET /inventario/productos/:id");
  }
});

inventarioRouter.post("/productos", async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, principio_activo, concentracion,
                                  medicamento_id, categoria, linea_negocio, codigo_cabys,
                                  codigo_tarifa_iva, unidad_base, requiere_receta, es_controlado,
                                  requiere_refrigeracion, vida_util_apertura_dias,
                                  permite_stock_negativo, minimo, punto_reorden,
                                  proveedor_preferido_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
               COALESCE($12,false),COALESCE($13,false),COALESCE($14,false),$15,
               COALESCE($16,false),COALESCE($17,0),COALESCE($18,0),$19)
       RETURNING id`,
      [
        req.auth!.tenantId, b.codigo, b.nombre, b.principioActivo ?? null, b.concentracion ?? null,
        b.medicamentoId ?? null, b.categoria ?? null, b.lineaNegocio, b.codigoCabys ?? null,
        b.codigoTarifaIva ?? null, b.unidadBase, b.requiereReceta, b.esControlado,
        b.requiereRefrigeracion, b.vidaUtilAperturaDias ?? null, b.permiteStockNegativo,
        b.minimo, b.puntoReorden, b.proveedorPreferidoId ?? null,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/productos");
  }
});

inventarioRouter.put("/productos/:id", async (req, res) => {
  const b = req.body ?? {};
  try {
    await req.db!.query(
      `UPDATE inv_productos SET
         nombre = $2, principio_activo = $3, concentracion = $4, medicamento_id = $5,
         categoria = $6, linea_negocio = $7, codigo_cabys = $8, codigo_tarifa_iva = $9,
         unidad_base = $10, requiere_receta = $11, es_controlado = $12,
         requiere_refrigeracion = $13, vida_util_apertura_dias = $14,
         permite_stock_negativo = $15, minimo = $16, punto_reorden = $17,
         proveedor_preferido_id = $18, activo = COALESCE($19, activo), actualizado_en = now()
       WHERE id = $1`,
      [
        req.params.id, b.nombre, b.principioActivo ?? null, b.concentracion ?? null,
        b.medicamentoId ?? null, b.categoria ?? null, b.lineaNegocio, b.codigoCabys ?? null,
        b.codigoTarifaIva ?? null, b.unidadBase, b.requiereReceta ?? false,
        b.esControlado ?? false, b.requiereRefrigeracion ?? false,
        b.vidaUtilAperturaDias ?? null, b.permiteStockNegativo ?? false,
        b.minimo ?? 0, b.puntoReorden ?? 0, b.proveedorPreferidoId ?? null, b.activo ?? null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /inventario/productos/:id");
  }
});

// --- Presentaciones ---------------------------------------------------
inventarioRouter.post("/productos/:id/presentaciones", async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, codigo_barras,
                                       nombre, factor, unidad_medida, precio_venta,
                                       para_compra, para_venta, para_consumo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,false),COALESCE($10,false),COALESCE($11,false))
       RETURNING id`,
      [
        req.auth!.tenantId, req.params.id, b.codigoInterno, b.codigoBarras ?? null, b.nombre,
        b.factor, b.unidadMedida, b.precioVenta ?? null,
        b.paraCompra, b.paraVenta, b.paraConsumo,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/productos/:id/presentaciones");
  }
});

inventarioRouter.delete("/presentaciones/:id", async (req, res) => {
  try {
    // Se DESACTIVA, no se borra: un movimiento viejo la referencia, y
    // borrarla dejaría el kardex sin poder decir en qué presentación se
    // registró.
    await req.db!.query(`UPDATE inv_presentaciones SET activo = false WHERE id = $1`, [
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "DELETE /inventario/presentaciones/:id");
  }
});

// =====================================================================
// MOVIMIENTOS, KARDEX Y TRAZABILIDAD
// =====================================================================
inventarioRouter.post("/movimientos", async (req, res) => {
  try {
    const hechos = await registrarMovimiento(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json({ movimientos: hechos });
  } catch (err) {
    fallo(res, err, "POST /inventario/movimientos");
  }
});

inventarioRouter.post("/traslados", async (req, res) => {
  try {
    const r = await registrarTraslado(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/traslados");
  }
});

inventarioRouter.get("/productos/:id/kardex", async (req, res) => {
  try {
    const movimientos = await kardexDeProducto(req.db!, req.params.id, req.query as never);
    res.json({ movimientos });
  } catch (err) {
    fallo(res, err, "GET /inventario/productos/:id/kardex");
  }
});

inventarioRouter.get("/productos/:id/consumo", async (req, res) => {
  const desde = String(req.query.desde ?? "").trim();
  const hasta = String(req.query.hasta ?? "").trim();
  if (!desde || !hasta) {
    return res.status(400).json({ error: "El consumo se pide para un período: desde y hasta." });
  }
  try {
    res.json({ origenes: await consumoDeProducto(req.db!, req.params.id, desde, hasta) });
  } catch (err) {
    fallo(res, err, "GET /inventario/productos/:id/consumo");
  }
});

inventarioRouter.get("/alertas", async (req, res) => {
  try {
    res.json(await alertasDeInventario(req.db!));
  } catch (err) {
    fallo(res, err, "GET /inventario/alertas");
  }
});

// =====================================================================
// AJUSTES
// =====================================================================
inventarioRouter.get("/ajustes", async (req, res) => {
  const estado = String(req.query.estado ?? "").trim();
  const valores: unknown[] = [];
  let where = "1=1";
  if (estado) {
    valores.push(estado);
    where = `a.estado = $1`;
  }
  const r = await req.db!.query(
    `SELECT a.*, m.nombre AS motivo_nombre,
            ps.nombre AS solicitado_por_nombre, pa.nombre AS aprobado_por_nombre,
            (SELECT count(*) FROM inv_ajuste_lineas al WHERE al.ajuste_id = a.id)::int AS lineas
       FROM inv_ajustes a
       JOIN inv_motivos m ON m.codigo = a.motivo
       LEFT JOIN personas ps ON ps.id = a.solicitado_por
       LEFT JOIN personas pa ON pa.id = a.aprobado_por
      WHERE ${where}
      ORDER BY a.solicitado_en DESC LIMIT 200`,
    valores
  );
  res.json({ ajustes: r.rows });
});

inventarioRouter.post("/ajustes", async (req, res) => {
  try {
    const r = await solicitarAjuste(req.db!, req.auth!.tenantId!, {
      ...req.body,
      solicitadoPor: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/ajustes");
  }
});

inventarioRouter.post("/ajustes/:id/aprobar", soloAdmin, async (req, res) => {
  try {
    await aprobarAjuste(req.db!, req.auth!.tenantId!, req.params.id, req.auth!.userId!);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /inventario/ajustes/:id/aprobar");
  }
});

inventarioRouter.post("/ajustes/:id/rechazar", soloAdmin, async (req, res) => {
  try {
    await rechazarAjuste(req.db!, req.params.id, req.auth!.userId!);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /inventario/ajustes/:id/rechazar");
  }
});

// =====================================================================
// SERVICIOS Y SU RECETA DE INSUMOS
// =====================================================================
inventarioRouter.get("/servicios", async (req, res) => {
  const r = await req.db!.query(
    `SELECT s.*,
            COALESCE((
              SELECT sum(si.cantidad * pr.factor * COALESCE(
                       (SELECT avg(l.costo_unitario) FROM inv_lotes l
                         WHERE l.producto_id = pr.producto_id AND l.cantidad > 0), 0))
                FROM inv_servicio_insumos si
                JOIN inv_presentaciones pr ON pr.id = si.presentacion_id
               WHERE si.servicio_id = s.id
            ), 0)::text AS costo_insumos
       FROM inv_servicios s
      WHERE s.activo ORDER BY s.nombre`
  );
  res.json({ servicios: r.rows });
});

inventarioRouter.get("/servicios/:id", async (req, res) => {
  const s = await req.db!.query(`SELECT * FROM inv_servicios WHERE id = $1`, [req.params.id]);
  if (s.rows.length === 0) return res.status(404).json({ error: "No existe ese servicio." });
  const insumos = await req.db!.query(
    `SELECT si.id, si.cantidad, si.presentacion_id, pr.nombre AS presentacion,
            pr.factor, p.id AS producto_id, p.nombre AS producto, p.unidad_base
       FROM inv_servicio_insumos si
       JOIN inv_presentaciones pr ON pr.id = si.presentacion_id
       JOIN inv_productos p ON p.id = pr.producto_id
      WHERE si.servicio_id = $1 ORDER BY p.nombre`,
    [req.params.id]
  );
  res.json({ servicio: s.rows[0], insumos: insumos.rows });
});

inventarioRouter.post("/servicios", async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, especialidad,
                                  codigo_cabys, codigo_tarifa_iva, precio, duracion_min)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8,0),$9) RETURNING id`,
      [
        req.auth!.tenantId, b.codigo, b.nombre, b.lineaNegocio, b.especialidad ?? null,
        b.codigoCabys ?? null, b.codigoTarifaIva ?? null, b.precio, b.duracionMin ?? null,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/servicios");
  }
});

inventarioRouter.post("/servicios/:id/insumos", async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_servicio_insumos (tenant_id, servicio_id, presentacion_id, cantidad)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (servicio_id, presentacion_id) DO UPDATE SET cantidad = EXCLUDED.cantidad
       RETURNING id`,
      [req.auth!.tenantId, req.params.id, b.presentacionId, b.cantidad]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/servicios/:id/insumos");
  }
});

inventarioRouter.delete("/servicios/:servicioId/insumos/:id", async (req, res) => {
  await req.db!.query(`DELETE FROM inv_servicio_insumos WHERE id = $1 AND servicio_id = $2`, [
    req.params.id,
    req.params.servicioId,
  ]);
  res.status(204).end();
});

// =====================================================================
// PROVEEDORES Y COMPRAS
// =====================================================================
inventarioRouter.get("/proveedores", async (req, res) => {
  const r = await req.db!.query(
    `SELECT * FROM inv_proveedores WHERE activo ORDER BY nombre`
  );
  res.json({ proveedores: r.rows });
});

inventarioRouter.post("/proveedores", async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO inv_proveedores (tenant_id, nombre, tipo_identificacion, numero_identificacion,
                                    contacto_nombre, contacto_telefono, contacto_email,
                                    condiciones_pago, dias_entrega)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,3)) RETURNING id`,
      [
        req.auth!.tenantId, b.nombre, b.tipoIdentificacion ?? null, b.numeroIdentificacion ?? null,
        b.contactoNombre ?? null, b.contactoTelefono ?? null, b.contactoEmail ?? null,
        b.condicionesPago ?? null, b.diasEntrega,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /inventario/proveedores");
  }
});

inventarioRouter.post("/proveedores/:id/productos", async (req, res) => {
  const b = req.body ?? {};
  try {
    await req.db!.query(
      `INSERT INTO inv_proveedor_productos (tenant_id, proveedor_id, producto_id,
                                            presentacion_compra_id, ultimo_costo)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (proveedor_id, producto_id) DO UPDATE SET
         presentacion_compra_id = EXCLUDED.presentacion_compra_id,
         ultimo_costo = EXCLUDED.ultimo_costo, actualizado_en = now()`,
      [req.auth!.tenantId, req.params.id, b.productoId, b.presentacionCompraId, b.ultimoCosto ?? null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /inventario/proveedores/:id/productos");
  }
});

inventarioRouter.get("/proveedores/:id/orden-sugerida", async (req, res) => {
  try {
    res.json({ lineas: await sugerirOrden(req.db!, req.auth!.tenantId!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /inventario/proveedores/:id/orden-sugerida");
  }
});

inventarioRouter.get("/ordenes", async (req, res) => {
  const estado = String(req.query.estado ?? "").trim();
  const valores: unknown[] = [];
  let where = "1=1";
  if (estado) {
    valores.push(estado);
    where = "o.estado = $1";
  }
  const r = await req.db!.query(
    `SELECT o.*, pr.nombre AS proveedor, b.nombre AS bodega,
            (SELECT count(*) FROM inv_orden_compra_lineas ol WHERE ol.orden_id = o.id)::int AS lineas
       FROM inv_ordenes_compra o
       JOIN inv_proveedores pr ON pr.id = o.proveedor_id
       JOIN inv_bodegas b ON b.id = o.bodega_id
      WHERE ${where}
      ORDER BY o.numero DESC LIMIT 200`,
    valores
  );
  res.json({ ordenes: r.rows });
});

inventarioRouter.get("/ordenes/:id", async (req, res) => {
  const o = await req.db!.query(
    `SELECT o.*, pr.nombre AS proveedor, b.nombre AS bodega
       FROM inv_ordenes_compra o
       JOIN inv_proveedores pr ON pr.id = o.proveedor_id
       JOIN inv_bodegas b ON b.id = o.bodega_id
      WHERE o.id = $1`,
    [req.params.id]
  );
  if (o.rows.length === 0) return res.status(404).json({ error: "No existe esa orden." });
  const lineas = await req.db!.query(
    `SELECT ol.*, p.nombre AS producto, p.unidad_base, pres.nombre AS presentacion, pres.factor
       FROM inv_orden_compra_lineas ol
       JOIN inv_productos p ON p.id = ol.producto_id
       JOIN inv_presentaciones pres ON pres.id = ol.presentacion_id
      WHERE ol.orden_id = $1 ORDER BY p.nombre`,
    [req.params.id]
  );
  res.json({ orden: o.rows[0], lineas: lineas.rows });
});

inventarioRouter.post("/ordenes", async (req, res) => {
  try {
    const r = await crearOrden(req.db!, req.auth!.tenantId!, {
      ...req.body,
      creadoPor: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/ordenes");
  }
});

inventarioRouter.post("/ordenes/:id/estado", async (req, res) => {
  const estado = String(req.body?.estado ?? "");
  if (!["aprobada", "enviada", "cancelada"].includes(estado)) {
    return res.status(400).json({
      error: "Desde acá una orden se aprueba, se envía o se cancela. Recibirla es otra cosa.",
    });
  }
  try {
    await req.db!.query(
      `UPDATE inv_ordenes_compra
          SET estado = $2::varchar, enviada_en = CASE WHEN $2::varchar = 'enviada' THEN now() ELSE enviada_en END
        WHERE id = $1`,
      [req.params.id, estado]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /inventario/ordenes/:id/estado");
  }
});

inventarioRouter.post("/ordenes/:id/recibir", async (req, res) => {
  try {
    const r = await recibirOrden(req.db!, req.auth!.tenantId!, req.params.id, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/ordenes/:id/recibir");
  }
});

inventarioRouter.post("/devoluciones-proveedor", async (req, res) => {
  try {
    const r = await devolverAProveedor(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json({ movimientos: r });
  } catch (err) {
    fallo(res, err, "POST /inventario/devoluciones-proveedor");
  }
});

// =====================================================================
// CONTEOS
// =====================================================================
inventarioRouter.get("/conteos", async (req, res) => {
  const r = await req.db!.query(
    `SELECT c.*, b.nombre AS bodega,
            (SELECT count(*) FROM inv_conteo_lineas cl WHERE cl.conteo_id = c.id)::int AS lineas,
            (SELECT count(*) FROM inv_conteo_lineas cl
              WHERE cl.conteo_id = c.id AND cl.cantidad_contada_base IS NOT NULL)::int AS contadas
       FROM inv_conteos c JOIN inv_bodegas b ON b.id = c.bodega_id
      ORDER BY c.creado_en DESC LIMIT 100`
  );
  res.json({ conteos: r.rows });
});

inventarioRouter.get("/conteos/:id", async (req, res) => {
  const c = await req.db!.query(`SELECT * FROM inv_conteos WHERE id = $1`, [req.params.id]);
  if (c.rows.length === 0) return res.status(404).json({ error: "No existe ese conteo." });
  const lineas = await req.db!.query(
    `SELECT cl.*, p.nombre AS producto, p.unidad_base, l.numero AS lote
       FROM inv_conteo_lineas cl
       JOIN inv_productos p ON p.id = cl.producto_id
       LEFT JOIN inv_lotes l ON l.id = cl.lote_id
      WHERE cl.conteo_id = $1 ORDER BY p.nombre`,
    [req.params.id]
  );
  res.json({ conteo: c.rows[0], lineas: lineas.rows });
});

inventarioRouter.post("/conteos", async (req, res) => {
  try {
    const r = await abrirConteo(req.db!, req.auth!.tenantId!, {
      ...req.body,
      creadoPor: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/conteos");
  }
});

inventarioRouter.put("/conteos/:id/lineas/:lineaId", async (req, res) => {
  try {
    const r = await anotarConteo(req.db!, req.params.id, req.params.lineaId, req.body);
    res.json(r);
  } catch (err) {
    fallo(res, err, "PUT /inventario/conteos/:id/lineas/:lineaId");
  }
});

inventarioRouter.post("/conteos/:id/cerrar", async (req, res) => {
  try {
    const r = await cerrarConteo(req.db!, req.auth!.tenantId!, req.params.id, req.auth!.userId);
    res.json(r);
  } catch (err) {
    fallo(res, err, "POST /inventario/conteos/:id/cerrar");
  }
});

// =====================================================================
// IMPORTACIÓN
// =====================================================================
inventarioRouter.get("/importacion/plantilla", (_req, res) => {
  // La plantilla se entrega como CSV y no como .xlsx: el analizador lee
  // .xlsx, pero generar uno acá exigiría una librería de ESCRITURA que
  // el proyecto no tiene, y un CSV se abre en Excel y se guarda como
  // .xlsx en dos clics. Queda dicho en vez de arrastrar 135 paquetes.
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="plantilla-inventario.csv"');
  res.send(COLUMNAS_PLANTILLA.join(",") + "\n");
});

inventarioRouter.post(
  "/importacion/analizar",
  soloAdmin,
  subir.single("planilla"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Falta la planilla." });
    const temporal = path.join(os.tmpdir(), `inv-import-${Date.now()}.xlsx`);
    try {
      fs.writeFileSync(temporal, req.file.buffer);
      res.json(await analizarImportacion(req.db!, temporal));
    } catch (err) {
      fallo(res, err, "POST /inventario/importacion/analizar");
    } finally {
      fs.rmSync(temporal, { force: true });
    }
  }
);

inventarioRouter.post(
  "/importacion/cargar",
  soloAdmin,
  subir.single("planilla"),
  async (req, res) => {
    if (!req.file) return res.status(400).json({ error: "Falta la planilla." });
    const bodegaId = String(req.body?.bodegaId ?? "");
    if (!bodegaId) return res.status(400).json({ error: "Falta a qué bodega entra el inventario." });

    const temporal = path.join(os.tmpdir(), `inv-import-${Date.now()}.xlsx`);
    try {
      fs.writeFileSync(temporal, req.file.buffer);
      const analisis = await analizarImportacion(req.db!, temporal);
      // La transacción la abrió `withTenantClient`: si algo falla, la
      // carga entera se deshace. Eso es lo que la hace atómica.
      const r = await importarInventario(
        req.db!,
        req.auth!.tenantId!,
        analisis,
        bodegaId,
        req.auth!.userId
      );
      res.json(r);
    } catch (err) {
      fallo(res, err, "POST /inventario/importacion/cargar");
    } finally {
      fs.rmSync(temporal, { force: true });
    }
  }
);

// =====================================================================
// PARÁMETROS
// =====================================================================
inventarioRouter.get("/parametros", async (req, res) => {
  const r = await req.db!.query(`SELECT * FROM inv_parametros WHERE tenant_id = $1`, [
    req.auth!.tenantId,
  ]);
  res.json({
    parametros: r.rows[0] ?? {
      tenant_id: req.auth!.tenantId,
      umbral_aprobacion_ajuste: "10000",
      dias_stock_seguridad: 7,
    },
  });
});

inventarioRouter.put("/parametros", soloAdmin, async (req, res) => {
  const b = req.body ?? {};
  try {
    await req.db!.query(
      `INSERT INTO inv_parametros (tenant_id, umbral_aprobacion_ajuste, dias_stock_seguridad)
       VALUES ($1,$2,$3)
       ON CONFLICT (tenant_id) DO UPDATE SET
         umbral_aprobacion_ajuste = EXCLUDED.umbral_aprobacion_ajuste,
         dias_stock_seguridad = EXCLUDED.dias_stock_seguridad,
         actualizado_en = now()`,
      [req.auth!.tenantId, b.umbralAprobacionAjuste ?? 10000, b.diasStockSeguridad ?? 7]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /inventario/parametros");
  }
});

// ---------------------------------------------------------------------
// Listas de precio (prompt 06, sección 2).
//
// Consultar la lista vigente lo puede hacer cualquiera del personal —la
// caja necesita saber a qué precio cobrar—, pero CREARLAS, editar
// precios y correr la actualización masiva es solo del administrador:
// un porcentaje aplicado a todo el catálogo mueve el ingreso de la
// clínica, y no es una decisión de mostrador.
// ---------------------------------------------------------------------

inventarioRouter.get("/listas-precio", async (req, res) => {
  try {
    res.json({ listas: await listas(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /inventario/listas-precio");
  }
});

inventarioRouter.post("/listas-precio", soloAdmin, async (req, res) => {
  try {
    res.status(201).json(await crearLista(req.db!, req.auth!.tenantId!, req.body ?? {}));
  } catch (err) {
    fallo(res, err, "POST /inventario/listas-precio");
  }
});

inventarioRouter.put("/listas-precio/:id", soloAdmin, async (req, res) => {
  try {
    await editarLista(req.db!, req.auth!.tenantId!, req.params.id, req.body ?? {});
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /inventario/listas-precio/:id");
  }
});

inventarioRouter.get("/listas-precio/:id/items", async (req, res) => {
  try {
    res.json({ items: await itemsDeLista(req.db!, req.auth!.tenantId!, req.params.id) });
  } catch (err) {
    fallo(res, err, "GET /inventario/listas-precio/:id/items");
  }
});

inventarioRouter.put("/listas-precio/:id/items", soloAdmin, async (req, res) => {
  const b = req.body ?? {};
  try {
    const precio = b.precio === null || b.precio === "" ? null : Number(b.precio);
    if (precio !== null && !Number.isFinite(precio)) {
      return res.status(400).json({ error: "El precio no es un número." });
    }
    await fijarItem(
      req.db!,
      req.auth!.tenantId!,
      req.params.id,
      b.presentacionId
        ? { presentacionId: b.presentacionId, precio }
        : { servicioId: b.servicioId, precio }
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /inventario/listas-precio/:id/items");
  }
});

// La vista previa y la aplicación llaman al MISMO cálculo en el módulo
// de dominio. Son dos rutas porque una escribe y la otra no.
inventarioRouter.post("/precios/vista-previa", soloAdmin, async (req, res) => {
  try {
    res.json(await vistaPreviaMasiva(req.db!, req.auth!.tenantId!, cuerpoMasivo(req.body)));
  } catch (err) {
    fallo(res, err, "POST /inventario/precios/vista-previa");
  }
});

inventarioRouter.post("/precios/aplicar", soloAdmin, async (req, res) => {
  try {
    res.json(await aplicarMasiva(req.db!, req.auth!.tenantId!, cuerpoMasivo(req.body)));
  } catch (err) {
    fallo(res, err, "POST /inventario/precios/aplicar");
  }
});

function cuerpoMasivo(b: Record<string, unknown> | undefined): AlcanceMasivo {
  const c = b ?? {};
  return {
    destino: c.destino === "lista" ? "lista" : "base",
    listaId: (c.listaId as string) ?? null,
    porcentaje: Number(c.porcentaje),
    lineaNegocio: (c.lineaNegocio as string) || null,
    categoria: (c.categoria as string) || null,
    incluirProductos: c.incluirProductos !== false,
    incluirServicios: c.incluirServicios !== false,
    redondeo: (c.redondeo as AlcanceMasivo["redondeo"]) ?? "colon",
  };
}
