import { NextFunction, Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { requiereModulo } from "../tenantModulos";
import {
  abrirSesion,
  cerrarSesion,
  esperadoDeSesion,
  registrarMovimientoEfectivo,
  registrarTipoCambio,
  tipoDeCambioDelDia,
} from "../ventas/caja";
import { abrirCuenta, agregarCargo, totalDeCuenta } from "../ventas/cuentas";
import { cobrar, datosDeTiquete } from "../ventas/cobros";
import {
  cancelar,
  crearEncargo,
  entregar,
  marcarAvisado,
  marcarRecibido,
  pedirAlProveedor,
} from "../ventas/encargos";
import {
  Deudor,
  cuentaCorriente,
  estadoDeCredito,
  puedeComprarACredito,
  registrarAbono,
  registrarAnticipo,
  saldoAFavor,
} from "../ventas/credito";
import {
  aprobacionesPendientes,
  resolverAprobacion,
  solicitarAprobacion,
} from "../ventas/aprobaciones";
import {
  emitirTalonario,
  provisionalesPendientes,
  regularizarProvisional,
} from "../ventas/contingencia";

// ---------------------------------------------------------------------
// API del módulo `ventas`. Todo bajo `requiereModulo('ventas')`.
//
// PERMISOS. Hasta que exista el prompt de administración base no hay
// rol de caja, así que cada permiso se resuelve con los roles actuales
// pero tiene **nombre propio** para asignarlo después sin buscar los
// `if` por todo el archivo:
//
//   cobrar   → médico o admin        (hoy: cualquiera del personal)
//   aprobar  → SOLO admin            (anulaciones, excesos, arqueo)
//   config   → SOLO admin            (cajas, tipo de cambio, parámetros)
//
// Quien pide una aprobación NO puede resolverla: eso lo impone
// `resolverAprobacion`, no la ruta, porque es una regla del dominio.
// ---------------------------------------------------------------------
export const ventasRouter = Router();

ventasRouter.use(authenticate, withTenantClient);

ventasRouter.use((req, res, next) => {
  if (!req.auth!.esMedico && !req.auth!.esAdminClinica) {
    return res.status(403).json({ error: "Esta sección es solo para personal de la clínica." });
  }
  next();
});

ventasRouter.use(requiereModulo("ventas"));

/** PERMISO `aprobar`. Hoy lo tiene el administrador de clínica. */
function permisoAprobar(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.esAdminClinica) {
    return res.status(403).json({ error: "Esto lo aprueba un administrador de la clínica." });
  }
  next();
}

/** PERMISO `config`. Mismo titular hoy, nombre distinto a propósito. */
const permisoConfig = permisoAprobar;

function fallo(res: Response, err: unknown, contexto: string) {
  const e = err as { message?: string; code?: string };
  if (e.code === "23505") {
    return res.status(409).json({ error: "Ya existe un registro con esos datos." });
  }
  if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) console.error(contexto, err);
  res.status(400).json({ error: e.message ?? "No se pudo completar la operación." });
}

// =====================================================================
// CAJAS Y SESIONES
// =====================================================================
ventasRouter.get("/cajas", async (req, res) => {
  const r = await req.db!.query(
    `SELECT c.*, b.nombre AS bodega,
            (SELECT s.id FROM vta_sesiones_caja s
              WHERE s.caja_id = c.id AND s.estado = 'abierta') AS sesion_abierta
       FROM vta_cajas c JOIN inv_bodegas b ON b.id = c.bodega_id
      WHERE c.activo ORDER BY c.nombre`
  );
  res.json({ cajas: r.rows });
});

ventasRouter.post("/cajas", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    const r = await req.db!.query<{ id: string }>(
      `INSERT INTO vta_cajas (tenant_id, nombre, bodega_id, sucursal, terminal, imprime_tiquete)
       VALUES ($1,$2,$3,COALESCE($4,'001'),COALESCE($5,'00001'),COALESCE($6,true)) RETURNING id`,
      [req.auth!.tenantId, b.nombre, b.bodegaId, b.sucursal, b.terminal, b.imprimeTiquete]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /ventas/cajas");
  }
});

ventasRouter.get("/sesiones/:id", async (req, res) => {
  try {
    const s = await req.db!.query(
      `SELECT s.*, c.nombre AS caja, pa.nombre AS abierta_por_nombre,
              pc.nombre AS cerrada_por_nombre
         FROM vta_sesiones_caja s
         JOIN vta_cajas c ON c.id = s.caja_id
         LEFT JOIN personas pa ON pa.id = s.abierta_por
         LEFT JOIN personas pc ON pc.id = s.cerrada_por
        WHERE s.id = $1`,
      [req.params.id]
    );
    if (s.rows.length === 0) return res.status(404).json({ error: "No existe esa sesión." });

    const [esperado, cobros, movimientos, cuentas] = await Promise.all([
      esperadoDeSesion(req.db!, req.params.id),
      req.db!.query(
        `SELECT co.*, p.nombre AS cajero, cu.numero AS cuenta_numero, cu.cliente_nombre,
                cmp.consecutivo
           FROM vta_cobros co
           LEFT JOIN personas p ON p.id = co.cobrado_por
           LEFT JOIN vta_cuentas cu ON cu.id = co.cuenta_id
           LEFT JOIN fact_comprobantes cmp ON cmp.id = co.comprobante_id
          WHERE co.sesion_id = $1 ORDER BY co.creado_en DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT m.*, p.nombre AS persona FROM vta_movimientos_efectivo m
           LEFT JOIN personas p ON p.id = m.persona_id
          WHERE m.sesion_id = $1 ORDER BY m.creado_en DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT id, numero, cliente_nombre, estado, abierta_en FROM vta_cuentas
          WHERE estado = 'abierta' ORDER BY abierta_en`
      ),
    ]);

    res.json({
      sesion: s.rows[0],
      esperado,
      cobros: cobros.rows,
      movimientos: movimientos.rows,
      cuentasAbiertas: cuentas.rows,
    });
  } catch (err) {
    fallo(res, err, "GET /ventas/sesiones/:id");
  }
});

ventasRouter.post("/sesiones", async (req, res) => {
  try {
    const r = await abrirSesion(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/sesiones");
  }
});

ventasRouter.post("/sesiones/:id/cerrar", async (req, res) => {
  try {
    const r = await cerrarSesion(req.db!, req.auth!.tenantId!, req.params.id, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/sesiones/:id/cerrar");
  }
});

ventasRouter.post("/sesiones/:id/efectivo", async (req, res) => {
  try {
    const r = await registrarMovimientoEfectivo(req.db!, req.auth!.tenantId!, {
      ...req.body,
      sesionId: req.params.id,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/sesiones/:id/efectivo");
  }
});

// =====================================================================
// TIPO DE CAMBIO
// =====================================================================
ventasRouter.get("/tipo-cambio", async (req, res) => {
  try {
    res.json({ valor: await tipoDeCambioDelDia(req.db!, req.auth!.tenantId!, "USD") });
  } catch (err) {
    // Que no haya tipo de cambio NO es un error del servidor: es un
    // dato que falta, y la pantalla tiene que poder decirlo.
    res.json({ valor: null, aviso: (err as Error).message });
  }
});

ventasRouter.put("/tipo-cambio", permisoConfig, async (req, res) => {
  try {
    await registrarTipoCambio(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /ventas/tipo-cambio");
  }
});

// =====================================================================
// CUENTAS Y CARGOS
// =====================================================================
ventasRouter.get("/cuentas", async (req, res) => {
  const estado = String(req.query.estado ?? "abierta");
  const r = await req.db!.query(
    `SELECT c.*, (SELECT count(*) FROM vta_cargos g
                   WHERE g.cuenta_id = c.id AND g.anulado_en IS NULL)::int AS cargos
       FROM vta_cuentas c WHERE c.estado = $1 ORDER BY c.abierta_en DESC LIMIT 200`,
    [estado]
  );
  res.json({ cuentas: r.rows });
});

ventasRouter.get("/cuentas/:id", async (req, res) => {
  try {
    const c = await req.db!.query(`SELECT * FROM vta_cuentas WHERE id = $1`, [req.params.id]);
    if (c.rows.length === 0) return res.status(404).json({ error: "No existe esa cuenta." });
    const cargos = await req.db!.query(
      `SELECT g.*, pa.nombre AS paciente, per.nombre AS creado_por_nombre,
              lp.nombre AS lista_precio_nombre
         FROM vta_cargos g
         LEFT JOIN pacientes pa ON pa.id = g.paciente_id
         LEFT JOIN personas per ON per.id = g.creado_por
         LEFT JOIN inv_listas_precio lp ON lp.id = g.lista_precio_id
        WHERE g.cuenta_id = $1 ORDER BY g.creado_en`,
      [req.params.id]
    );
    res.json({
      cuenta: c.rows[0],
      cargos: cargos.rows,
      totales: await totalDeCuenta(req.db!, req.params.id),
    });
  } catch (err) {
    fallo(res, err, "GET /ventas/cuentas/:id");
  }
});

ventasRouter.post("/cuentas", async (req, res) => {
  try {
    res.status(201).json(await abrirCuenta(req.db!, req.auth!.tenantId!, req.body ?? {}));
  } catch (err) {
    fallo(res, err, "POST /ventas/cuentas");
  }
});

ventasRouter.post("/cuentas/:id/cargos", async (req, res) => {
  try {
    const r = await agregarCargo(req.db!, req.auth!.tenantId!, {
      ...req.body,
      cuentaId: req.params.id,
      personaId: req.auth!.userId,
    });
    res.status(201).json({ ...r, totales: await totalDeCuenta(req.db!, req.params.id) });
  } catch (err) {
    fallo(res, err, "POST /ventas/cuentas/:id/cargos");
  }
});

// =====================================================================
// COBROS
// =====================================================================
ventasRouter.post("/cuentas/:id/cobrar", async (req, res) => {
  try {
    const r = await cobrar(req.db!, req.auth!.tenantId!, {
      ...req.body,
      cuentaId: req.params.id,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/cuentas/:id/cobrar");
  }
});

ventasRouter.get("/cobros/:id/tiquete", async (req, res) => {
  try {
    res.json(await datosDeTiquete(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /ventas/cobros/:id/tiquete");
  }
});

// =====================================================================
// CRÉDITO, ABONOS Y ANTICIPOS
//
// LAS RUTAS HABLAN DE UN DEUDOR, no de un cliente: el deudor de una
// venta a crédito es el RECEPTOR de la factura, que puede ser un perfil
// de facturación (la empresa del dueño, una fundación). El tipo viaja
// en la query (`?tipo=perfil`) y por defecto es cliente, que es el caso
// común y el que ya estaba.
// =====================================================================

/** El deudor que pide la ruta: cliente por defecto, perfil si lo dice. */
function deudorDeLaRuta(req: Request): Deudor {
  const tipo = String(req.query.tipo ?? req.body?.deudorTipo ?? "cliente");
  return { tipo: tipo === "perfil" ? "perfil" : "cliente", id: req.params.id };
}

ventasRouter.get("/clientes/:id/cuenta-corriente", async (req, res) => {
  try {
    res.json(await cuentaCorriente(req.db!, deudorDeLaRuta(req)));
  } catch (err) {
    fallo(res, err, "GET /ventas/clientes/:id/cuenta-corriente");
  }
});

ventasRouter.put("/clientes/:id/credito", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    const deudor = deudorDeLaRuta(req);
    const columna = deudor.tipo === "cliente" ? "propietario_id" : "perfil_id";
    // El ON CONFLICT apunta al índice único PARCIAL de cada columna
    // (migración 100): uno por cliente y uno por perfil.
    await req.db!.query(
      `INSERT INTO vta_credito_cliente (${columna}, tenant_id, habilitado, limite, plazo_dias)
       VALUES ($1,$2,COALESCE($3,false),COALESCE($4,0),COALESCE($5,30))
       ON CONFLICT (${columna}) WHERE ${columna} IS NOT NULL DO UPDATE SET
         habilitado = EXCLUDED.habilitado, limite = EXCLUDED.limite,
         plazo_dias = EXCLUDED.plazo_dias, actualizado_en = now()`,
      [deudor.id, req.auth!.tenantId, b.habilitado, b.limite, b.plazoDias]
    );
    res.json({ ok: true, estado: await estadoDeCredito(req.db!, deudor) });
  } catch (err) {
    fallo(res, err, "PUT /ventas/clientes/:id/credito");
  }
});

ventasRouter.get("/clientes/:id/credito-disponible", async (req, res) => {
  try {
    const monto = Number(req.query.monto ?? 0);
    res.json(await puedeComprarACredito(req.db!, deudorDeLaRuta(req), monto));
  } catch (err) {
    fallo(res, err, "GET /ventas/clientes/:id/credito-disponible");
  }
});

/**
 * El deudor que viene en el CUERPO, para abonos y anticipos.
 *
 * Se exige explícito en vez de adivinarlo: un abono cargado contra el
 * dueño cuando la factura es de la empresa deja la cuenta por cobrar de
 * la empresa intacta, y el dinero aparece como saldo a favor de alguien
 * que no debía nada.
 */
function deudorDelCuerpo(cuerpo: Record<string, unknown> | undefined): Deudor {
  const c = cuerpo ?? {};
  const d = c.deudor as { tipo?: string; id?: string } | undefined;
  const id = d?.id ?? (c.propietarioId as string | undefined);
  if (!id) {
    throw new Error(
      "Falta decir quién paga: `deudor: { tipo: 'cliente' | 'perfil', id }`. En una venta a crédito el deudor es el receptor de la factura."
    );
  }
  return { tipo: d?.tipo === "perfil" ? "perfil" : "cliente", id };
}

ventasRouter.post("/abonos", async (req, res) => {
  try {
    const r = await registrarAbono(req.db!, req.auth!.tenantId!, {
      ...req.body,
      deudor: deudorDelCuerpo(req.body),
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/abonos");
  }
});

ventasRouter.post("/anticipos", async (req, res) => {
  try {
    const r = await registrarAnticipo(req.db!, req.auth!.tenantId!, {
      ...req.body,
      deudor: deudorDelCuerpo(req.body),
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/anticipos");
  }
});

// NO HAY ENDPOINT PARA "APLICAR ANTICIPOS" SUELTO, y lo hubo: consumía
// el saldo a favor del cliente sin tocar ninguna cuenta, así que la
// plata desaparecía del saldo y la cuenta seguía debiendo el total.
//
// Un anticipo se aplica COBRANDO, con el medio `anticipo` en
// `POST /ventas/cuentas/:id/cobrar`: ahí queda el `vta_cobros` que baja
// el saldo, el comprobante que lo respalda y la verificación de que el
// cliente tenga ese saldo a favor.

// =====================================================================
// ENCARGOS
// =====================================================================
ventasRouter.get("/encargos", async (req, res) => {
  const r = await req.db!.query(
    `SELECT e.*, p.nombre AS cliente, pr.nombre AS producto,
            oc.numero AS orden_numero,
            COALESCE((SELECT sum(a.monto) FROM vta_anticipos a
                       WHERE a.encargo_id = e.id), 0)::text AS anticipo,
            COALESCE((SELECT sum(a.monto - a.aplicado) FROM vta_anticipos a
                       WHERE a.encargo_id = e.id AND a.estado = 'disponible'), 0)::text
              AS anticipo_disponible
       FROM vta_encargos e
       JOIN propietarios p ON p.id = e.propietario_id
       LEFT JOIN inv_productos pr ON pr.id = e.producto_id
       LEFT JOIN inv_ordenes_compra oc ON oc.id = e.orden_compra_id
      WHERE e.estado <> 'entregado' OR e.entregado_en > now() - interval '30 days'
      ORDER BY e.creado_en DESC LIMIT 200`
  );
  res.json({ encargos: r.rows });
});

ventasRouter.post("/encargos", async (req, res) => {
  try {
    const r = await crearEncargo(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/encargos");
  }
});

/**
 * Las transiciones de estado, cada una con lo que pasa alrededor: la
 * orden de compra al pedir, la reserva al recibir, el cargo y el
 * anticipo al entregar. La tabla de transiciones válidas vive en el
 * módulo de dominio, no acá: la ruta no decide qué estado sigue a cuál.
 */
ventasRouter.post("/encargos/:id/estado", async (req, res) => {
  const b = req.body ?? {};
  const estado = String(b.estado ?? "");
  try {
    switch (estado) {
      case "pedido":
        return res.json(
          await pedirAlProveedor(req.db!, req.auth!.tenantId!, req.params.id, {
            ...b,
            personaId: req.auth!.userId,
          })
        );
      case "recibido":
        return res.json(await marcarRecibido(req.db!, req.params.id, b));
      case "avisado":
        await marcarAvisado(req.db!, req.params.id);
        return res.json({ ok: true });
      case "entregado":
        if (!b.cuentaId) {
          return res.status(400).json({
            error:
              "Para entregar el encargo hace falta la cuenta donde queda el cargo: la entrega " +
              "descarga el stock reservado y cobra, no solo cambia el estado.",
          });
        }
        return res.json(
          await entregar(req.db!, req.auth!.tenantId!, req.params.id, {
            ...b,
            personaId: req.auth!.userId,
          })
        );
      case "cancelado":
        return res.json(await cancelar(req.db!, req.params.id, b.motivo));
      default:
        return res.status(400).json({ error: "Ese no es un estado de encargo." });
    }
  } catch (err) {
    fallo(res, err, "POST /ventas/encargos/:id/estado");
  }
});

// =====================================================================
// APROBACIONES
// =====================================================================
ventasRouter.get("/aprobaciones", async (req, res) => {
  res.json({ aprobaciones: await aprobacionesPendientes(req.db!) });
});

ventasRouter.post("/aprobaciones", async (req, res) => {
  try {
    const r = await solicitarAprobacion(req.db!, req.auth!.tenantId!, {
      ...req.body,
      solicitadaPor: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/aprobaciones");
  }
});

ventasRouter.post("/aprobaciones/:id/resolver", permisoAprobar, async (req, res) => {
  try {
    const r = await resolverAprobacion(req.db!, req.auth!.tenantId!, req.params.id, {
      aprobar: !!req.body?.aprobar,
      resueltaPor: req.auth!.userId!,
      nota: req.body?.nota,
    });
    res.json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/aprobaciones/:id/resolver");
  }
});

// =====================================================================
// CONTINGENCIA
// =====================================================================
ventasRouter.get("/provisionales", async (req, res) => {
  res.json({ provisionales: await provisionalesPendientes(req.db!) });
});

ventasRouter.post("/provisionales/talonario", permisoConfig, async (req, res) => {
  try {
    res.status(201).json(
      await emitirTalonario(req.db!, req.auth!.tenantId!, {
        cajaId: req.body?.cajaId,
        cantidad: Number(req.body?.cantidad ?? 50),
      })
    );
  } catch (err) {
    fallo(res, err, "POST /ventas/provisionales/talonario");
  }
});

ventasRouter.post("/provisionales/regularizar", async (req, res) => {
  try {
    res.status(201).json(await regularizarProvisional(req.db!, req.auth!.tenantId!, req.body));
  } catch (err) {
    fallo(res, err, "POST /ventas/provisionales/regularizar");
  }
});

// =====================================================================
// PARÁMETROS Y REPORTES
// =====================================================================
ventasRouter.get("/parametros", async (req, res) => {
  const r = await req.db!.query(`SELECT * FROM vta_parametros WHERE tenant_id = $1`, [
    req.auth!.tenantId,
  ]);
  res.json({
    parametros: r.rows[0] ?? {
      tenant_id: req.auth!.tenantId,
      umbral_diferencia_arqueo: "2000",
      descuento_maximo_pct: "10",
    },
  });
});

ventasRouter.put("/parametros", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    await req.db!.query(
      `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct,
                                  lista_precio_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id) DO UPDATE SET
         umbral_diferencia_arqueo = EXCLUDED.umbral_diferencia_arqueo,
         descuento_maximo_pct = EXCLUDED.descuento_maximo_pct,
         lista_precio_id = EXCLUDED.lista_precio_id, actualizado_en = now()`,
      [
        req.auth!.tenantId,
        b.umbralDiferenciaArqueo ?? 2000,
        b.descuentoMaximoPct ?? 10,
        b.listaPrecioId || null,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /ventas/parametros");
  }
});

/**
 * Los cuatro reportes del prompt, en un endpoint con un parámetro.
 *
 * Uno y no cuatro porque los cuatro son la misma forma —agrupar los
 * cobros de un período por una dimensión— y cuatro endpoints serían
 * cuatro filtros de fecha que se implementan distinto.
 */
ventasRouter.get("/reportes/:cual", async (req, res) => {
  const desde = String(req.query.desde ?? "");
  const hasta = String(req.query.hasta ?? "");
  if (!desde || !hasta) {
    return res.status(400).json({ error: "El reporte se pide para un período: desde y hasta." });
  }
  const rango = [desde, hasta];

  try {
    switch (req.params.cual) {
      case "ventas": {
        const r = await req.db!.query(
          `SELECT p.nombre AS cajero, caja.nombre AS caja, cm.medio,
                  mp.nombre AS medio_nombre,
                  count(DISTINCT co.id)::int AS cobros,
                  sum(cm.monto_crc)::text AS total
             FROM vta_cobros co
             JOIN vta_cobro_medios cm ON cm.cobro_id = co.id
             JOIN vta_sesiones_caja s ON s.id = co.sesion_id
             JOIN vta_cajas caja ON caja.id = s.caja_id
             LEFT JOIN personas p ON p.id = co.cobrado_por
             LEFT JOIN fact_cat_medio_pago mp ON mp.codigo = cm.medio
            WHERE co.estado = 'aplicado'
              AND co.creado_en >= $1::date AND co.creado_en < ($2::date + interval '1 day')
            GROUP BY p.nombre, caja.nombre, cm.medio, mp.nombre
            ORDER BY caja.nombre, p.nombre`,
          rango
        );
        return res.json({ filas: r.rows });
      }
      case "lineas-negocio": {
        const r = await req.db!.query(
          `SELECT COALESCE(ln.nombre, 'Sin línea') AS linea,
                  sum(g.cantidad * g.precio_unitario - g.descuento)::text AS neto,
                  count(*)::int AS lineas
             FROM vta_cargos g
             JOIN vta_cuentas cu ON cu.id = g.cuenta_id
             LEFT JOIN lineas_negocio ln ON ln.codigo = g.linea_negocio
            WHERE g.anulado_en IS NULL AND cu.estado = 'cobrada'
              AND g.creado_en >= $1::date AND g.creado_en < ($2::date + interval '1 day')
            GROUP BY ln.nombre ORDER BY 2 DESC`,
          rango
        );
        return res.json({ filas: r.rows });
      }
      case "arqueos": {
        const r = await req.db!.query(
          `SELECT s.id, c.nombre AS caja, p.nombre AS cajero, s.cerrada_en,
                  sum(al.diferencia)::text AS diferencia_total,
                  count(*) FILTER (WHERE al.diferencia <> 0)::int AS medios_con_diferencia
             FROM vta_sesiones_caja s
             JOIN vta_cajas c ON c.id = s.caja_id
             LEFT JOIN personas p ON p.id = s.cerrada_por
             LEFT JOIN vta_arqueo_lineas al ON al.sesion_id = s.id
            WHERE s.estado = 'cerrada'
              AND s.cerrada_en >= $1::date AND s.cerrada_en < ($2::date + interval '1 day')
            GROUP BY s.id, c.nombre, p.nombre ORDER BY s.cerrada_en DESC`,
          rango
        );
        return res.json({ filas: r.rows });
      }
      case "aprobaciones": {
        const r = await req.db!.query(
          `SELECT a.tipo, a.estado, a.monto, a.motivo, a.solicitada_en, a.resuelta_en,
                  ps.nombre AS solicitada_por, pr.nombre AS resuelta_por
             FROM vta_aprobaciones a
             LEFT JOIN personas ps ON ps.id = a.solicitada_por
             LEFT JOIN personas pr ON pr.id = a.resuelta_por
            WHERE a.solicitada_en >= $1::date AND a.solicitada_en < ($2::date + interval '1 day')
            ORDER BY a.solicitada_en DESC`,
          rango
        );
        return res.json({ filas: r.rows });
      }
      case "por-cobrar": {
        const r = await req.db!.query(
          `SELECT p.id AS propietario_id, p.nombre AS cliente,
                  sum(f.total_comprobante
                      - COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                                   WHERE aa.comprobante_id = f.id), 0))::text AS pendiente,
                  min(f.fecha_emision)::date AS mas_antigua,
                  max(CURRENT_DATE - f.fecha_emision::date)::int AS antiguedad_max_dias
             FROM fact_comprobantes f
             JOIN propietarios p ON p.id = f.receptor_propietario_id
            WHERE f.tipo_comprobante = '01' AND f.condicion_venta IN ('02','10')
              AND f.estado IN ('aceptado','aceptado_parcial','enviado','en_cola')
            GROUP BY p.id, p.nombre
           HAVING sum(f.total_comprobante
                      - COALESCE((SELECT sum(aa.monto) FROM vta_abono_aplicaciones aa
                                   WHERE aa.comprobante_id = f.id), 0)) > 0
            ORDER BY 3 DESC`
        );
        return res.json({ filas: r.rows });
      }
      default:
        return res.status(404).json({ error: "Ese reporte no existe." });
    }
  } catch (err) {
    fallo(res, err, `GET /ventas/reportes/${req.params.cual}`);
  }
});
