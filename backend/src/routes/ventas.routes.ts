import { NextFunction, Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica } from "../permisos";
import { aExcel, aPdf, nombreDeArchivo } from "../exportacion/tabla";
import { marcaYAutor } from "../marca/marcaDeLaSolicitud";
import { esReporteConocido, reporteDeVentas } from "../ventas/reportes";
import { requiereModulo } from "../tenantModulos";
import {
  abrirSesion,
  cerrarSesion,
  esperadoDeSesion,
  grupoDeArqueo,
  registrarMovimientoEfectivo,
  registrarTipoCambio,
  tipoDeCambioDelDia,
} from "../ventas/caja";
import { abrirCuenta, agregarCargo, totalDeCuenta } from "../ventas/cuentas";
import {
  motivosDeDescuento,
  puedeAutorizarDescuento,
  topeDeDescuento,
} from "../ventas/descuentos";
import { conciliarTarjetas, registrarLoteDatafono } from "../ventas/comisionesTarjeta";
import {
  convertirPresupuesto,
  crearPresupuesto,
  listarPresupuestos,
  marcarEnviado,
  PresupuestoVencido,
  registrarRespuesta,
  verPresupuesto,
} from "../ventas/presupuestos";
import { presupuestoEnPdf } from "../ventas/presupuestoPdf";
import { comprobanteDeCierre } from "../ventas/cierrePdf";
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

ventasRouter.use(soloPersonalDeLaClinica());

ventasRouter.use(requiereModulo("ventas"));

/** PERMISO `aprobar`. Hoy lo tiene el administrador de clínica. */
// APROBAR Y CONFIGURAR DEJARON DE SER EL MISMO PERMISO (prompt 04).
//
// Hasta acá las dos guardas eran la misma función con dos nombres —el
// comentario decía «mismo titular hoy, nombre distinto a propósito»— y
// las dos preguntaban por `esAdminClinica`. Ahora cada una es su
// permiso, y la clínica puede darle a la caja la aprobación de una
// anulación sin darle la configuración de los topes.
const permisoAprobar = exigirPermiso("caja.aprobar");
const permisoConfig = exigirPermiso("clinica.configurar");

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

    const [esperado, cobros, movimientos, cuentas, porMedio] = await Promise.all([
      esperadoDeSesion(req.db!, req.params.id),
      req.db!.query(
        `SELECT co.*, p.nombre AS cajero, cu.numero AS cuenta_numero, cu.cliente_nombre,
                cmp.consecutivo, cmp.tipo_comprobante
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
      // CUENTAS ABIERTAS con lo que la pantalla necesita mostrar
      // (prompt 01c, seccion 5): paciente, propietario, cuantos cargos
      // y cuanto suman, con que antiguedad. Antes se devolvian cinco
      // columnas y la pantalla escribia «{c.cargos} cargo(s)» con
      // `cargos` siempre indefinido: salia «cargo(s)», sin numero.
      //
      // El paciente sale de los cargos, no de la cuenta: una cuenta
      // puede tener cargos de dos mascotas del mismo dueno, y entonces
      // se nombra a la primera y se dice cuantas mas hay.
      req.db!.query(
        `SELECT c.id, c.numero, c.cliente_nombre, c.estado, c.abierta_en,
                COALESCE(x.cargos, 0)::int   AS cargos,
                COALESCE(x.total, 0)::text   AS total,
                x.resumen,
                x.pacientes,
                x.primer_paciente,
                EXTRACT(EPOCH FROM (now() - c.abierta_en))::bigint AS antiguedad_segundos
           FROM vta_cuentas c
           LEFT JOIN LATERAL (
             SELECT count(*)                                   AS cargos,
                    sum(g.cantidad * g.precio_unitario - g.descuento) AS total,
                    string_agg(DISTINCT g.descripcion, ', ')   AS resumen,
                    count(DISTINCT g.paciente_id)              AS pacientes,
                    min(pa.nombre)                             AS primer_paciente
               FROM vta_cargos g
               LEFT JOIN pacientes pa ON pa.id = g.paciente_id
              WHERE g.cuenta_id = c.id AND g.anulado_en IS NULL
           ) x ON true
          WHERE c.estado = 'abierta' ORDER BY c.abierta_en`
      ),
      // UNA LINEA POR MEDIO Y MONEDA, con el monto en su moneda, su
      // equivalente en colones y cuantos cobros lo usaron (prompt 01c,
      // seccion 5). El equivalente ya esta calculado en la tabla:
      // reconvertir con el tipo de cambio de hoy daria otro numero que
      // el del arqueo.
      //
      // El VUELTO no se resta aca, a diferencia del reporte de ventas:
      // esto es «cuanto entro por cada medio», que es la pregunta del
      // cajero. Lo que se le debe al arqueo es otra cuenta y la hace
      // `esperadoDeSesion`.
      req.db!.query(
        `SELECT cm.medio, cm.moneda, cm.es_fiscal,
                sum(cm.monto)::text     AS monto,
                sum(cm.monto_crc)::text AS monto_crc,
                count(DISTINCT cm.cobro_id)::int AS cobros
           FROM vta_cobro_medios cm
           JOIN vta_cobros c ON c.id = cm.cobro_id
          WHERE c.sesion_id = $1 AND c.estado = 'aplicado'
          GROUP BY cm.medio, cm.moneda, cm.es_fiscal
          ORDER BY cm.es_fiscal DESC, sum(cm.monto_crc) DESC`,
        [req.params.id]
      ),
    ]);

    // LOS CODIGOS DE HACIENDA NO SE MUESTRAN. La tabla guarda "01",
    // "02", "06"; la pantalla tiene que decir Efectivo, Tarjetas, SINPE
    // Movil. Se agrupa con la MISMA funcion que usa el arqueo
    // (`grupoDeArqueo`) para que las dos listas de la pantalla —lo
    // cobrado y lo que deberia haber— no partan el dinero distinto.
    //
    // `anticipo` y `credito` no son codigos de Hacienda (es_fiscal =
    // false) y se dejan con su nombre: agruparlos en "otros" diria que
    // entro plata que no entro.
    const agrupado = new Map<string, {
      medio: string; moneda: string; es_fiscal: boolean;
      monto: number; monto_crc: number; cobros: number;
    }>();
    for (const l of porMedio.rows as {
      medio: string; moneda: string; es_fiscal: boolean;
      monto: string; monto_crc: string; cobros: number;
    }[]) {
      const medio = l.es_fiscal ? grupoDeArqueo(l.medio) : l.medio;
      const clave = `${medio}|${l.moneda}`;
      const previo = agrupado.get(clave);
      if (previo) {
        previo.monto += Number(l.monto);
        previo.monto_crc += Number(l.monto_crc);
        previo.cobros += l.cobros;
      } else {
        agrupado.set(clave, {
          medio,
          moneda: l.moneda,
          es_fiscal: l.es_fiscal,
          monto: Number(l.monto),
          monto_crc: Number(l.monto_crc),
          cobros: l.cobros,
        });
      }
    }

    // CUANTAS FACTURAS Y CUANTOS TIQUETES (prompt 01c, seccion 5). Sale
    // de los cobros de la sesion, no de `fact_comprobantes` sueltos: lo
    // que el cajero quiere saber es cuanto de lo que EL cobro salio con
    // factura. Los cobros sin comprobante —una cuenta saldada contra un
    // anticipo— se cuentan aparte y no se esconden.
    const comprobantes = { facturas: 0, tiquetes: 0, sinComprobante: 0 };
    for (const c of cobros.rows as { estado: string; tipo_comprobante: string | null }[]) {
      if (c.estado !== "aplicado") continue;
      if (c.tipo_comprobante === "01") comprobantes.facturas += 1;
      else if (c.tipo_comprobante === "04") comprobantes.tiquetes += 1;
      else comprobantes.sinComprobante += 1;
    }

    res.json({
      sesion: s.rows[0],
      comprobantes,
      esperado,
      cobros: cobros.rows,
      movimientos: movimientos.rows,
      cuentasAbiertas: cuentas.rows,
      porMedio: [...agrupado.values()]
        .sort((a, b) => Number(b.es_fiscal) - Number(a.es_fiscal) || b.monto_crc - a.monto_crc)
        .map((l) => ({ ...l, monto: l.monto.toFixed(2), monto_crc: l.monto_crc.toFixed(2) })),
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
// ---------------------------------------------------------------------
// LOS CATÁLOGOS DE LA CAJA — prompt 08b, A2 y A3.
//
// Los tres siguen el mismo molde: las filas de la plataforma más las de
// la clínica, y la clínica solo escribe las suyas (lo impone la RLS, no
// estas rutas).
// ---------------------------------------------------------------------
/**
 * El personal de la clínica, para decir quién recibió un vale y quién
 * realizó un servicio (prompt 08b, A2 y A5).
 *
 * Vive en el router de ventas y no en el de administración porque la
 * necesita el mostrador: `/admin/medicos` exige rol administrador y
 * además devuelve solo médicos, y un vale se lo puede llevar cualquiera
 * del personal.
 */
// ---------------------------------------------------------------------
// PRESUPUESTOS — prompt 08b, A1.
//
// Los puede ver y crear todo el personal del mostrador: cotizar es parte
// de atender. Lo único con permiso aparte es respetar el precio de un
// presupuesto vencido, que va por el mismo camino que autorizar un
// descuento (porque es lo mismo).
// ---------------------------------------------------------------------
ventasRouter.get("/presupuestos", async (req, res) => {
  try {
    res.json({
      presupuestos: await listarPresupuestos(req.db!, {
        estado: (req.query.estado as string) || undefined,
        propietarioId: (req.query.cliente as string) || undefined,
        porVencer: req.query.porVencer === "1",
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /ventas/presupuestos");
  }
});

ventasRouter.get("/presupuestos/:id", async (req, res) => {
  try {
    const p = await verPresupuesto(req.db!, req.params.id);
    if (!p) return res.status(404).json({ error: "Ese presupuesto no existe." });
    res.json({ presupuesto: p });
  } catch (err) {
    fallo(res, err, "GET /ventas/presupuestos/:id");
  }
});

ventasRouter.post("/presupuestos", async (req, res) => {
  try {
    const r = await crearPresupuesto(req.db!, req.auth!.tenantId!, {
      ...req.body,
      personaId: req.auth!.userId,
    });
    res.status(201).json(r);
  } catch (err) {
    fallo(res, err, "POST /ventas/presupuestos");
  }
});

ventasRouter.post("/presupuestos/:id/enviar", async (req, res) => {
  try {
    await marcarEnviado(req.db!, req.auth!.tenantId!, req.params.id, req.auth!.userId);
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /ventas/presupuestos/:id/enviar");
  }
});

ventasRouter.post("/presupuestos/:id/respuesta", async (req, res) => {
  try {
    await registrarRespuesta(req.db!, req.auth!.tenantId!, req.params.id, {
      acepta: req.body?.acepta === true,
      como: req.body?.como ?? "en_persona",
      nota: req.body?.nota,
      personaId: req.auth!.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "POST /ventas/presupuestos/:id/respuesta");
  }
});

ventasRouter.post("/presupuestos/:id/convertir", async (req, res) => {
  try {
    res.json(
      await convertirPresupuesto(req.db!, req.auth!.tenantId!, req.params.id, {
        cuentaId: req.body?.cuentaId,
        sesionId: req.body?.sesionId,
        bodegaId: req.body?.bodegaId,
        precioVencido: req.body?.precioVencido,
        autorizadoPor: req.body?.autorizadoPor,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    // EL VENCIDO ES UNA PREGUNTA, NO UN ERROR: el 409 lleva la fecha
    // para que la pantalla ofrezca las dos opciones en vez de mostrar
    // un mensaje rojo sin salida.
    if (err instanceof PresupuestoVencido) {
      return res.status(409).json({ error: err.message, venceEl: err.venceEl, vencido: true });
    }
    fallo(res, err, "POST /ventas/presupuestos/:id/convertir");
  }
});

ventasRouter.get("/presupuestos/:id/pdf", async (req, res) => {
  try {
    const { pdf, numero } = await presupuestoEnPdf(req.db!, req.auth!.tenantId!, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="presupuesto-${numero}.pdf"`);
    res.send(pdf);
  } catch (err) {
    fallo(res, err, "GET /ventas/presupuestos/:id/pdf");
  }
});

ventasRouter.get("/personal", async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, nombre, es_medico, es_admin_clinica
         FROM personas
        -- La columna es estado y no activo: verificado contra el
        -- esquema en vez de suponerlo.
        WHERE estado = 'activo'
        ORDER BY nombre`
    );
    res.json({ personas: r.rows });
  } catch (err) {
    fallo(res, err, "GET /ventas/personal");
  }
});

ventasRouter.get("/denominaciones", async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, moneda, valor::text, especie, (tenant_id IS NOT NULL) AS de_la_clinica
         FROM vta_denominaciones
        WHERE activo
        ORDER BY moneda, valor DESC`
    );
    res.json({ denominaciones: r.rows });
  } catch (err) {
    fallo(res, err, "GET /ventas/denominaciones");
  }
});

/**
 * Agregar o desactivar una denominación propia de la clínica.
 *
 * Las de la plataforma NO se borran: se desactivan agregando la misma
 * (moneda, valor) como fila de la clínica con `activo = false`. Así el
 * día que se quiera volver atrás, la de la plataforma sigue ahí.
 */
ventasRouter.post("/denominaciones", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    if (!b.moneda || !(Number(b.valor) > 0)) {
      return res.status(400).json({ error: "Una denominación lleva su moneda y su valor." });
    }
    const r = await req.db!.query(
      `INSERT INTO vta_denominaciones (tenant_id, moneda, valor, especie, activo)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, moneda, valor) WHERE tenant_id IS NOT NULL
         DO UPDATE SET activo = EXCLUDED.activo, especie = EXCLUDED.especie
       RETURNING id`,
      [
        req.auth!.tenantId,
        String(b.moneda).toUpperCase(),
        b.valor,
        b.especie === "moneda" ? "moneda" : "billete",
        b.activo !== false,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /ventas/denominaciones");
  }
});

ventasRouter.get("/motivos-descuento", async (req, res) => {
  try {
    res.json({ motivos: await motivosDeDescuento(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /ventas/motivos-descuento");
  }
});

/**
 * Hasta cuánto puede descontar quien está pidiendo, para esta línea.
 *
 * La pantalla lo consulta ANTES de dejar escribir el descuento: así el
 * cajero ve «hasta 10 %» en vez de escribir 30 y recibir un error.
 */
ventasRouter.get("/tope-descuento", async (req, res) => {
  try {
    const tope = await topeDeDescuento(req.db!, req.auth!.tenantId!, {
      presentacionId: (req.query.presentacion as string) || null,
      servicioId: (req.query.servicio as string) || null,
      personaId: req.auth!.userId,
    });
    res.json({
      ...tope,
      puedeAutorizar: await puedeAutorizarDescuento(req.db!, req.auth!.tenantId!, req.auth!.userId),
    });
  } catch (err) {
    fallo(res, err, "GET /ventas/tope-descuento");
  }
});

ventasRouter.get("/topes-descuento", permisoConfig, async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, rol, tope_pct::text, puede_autorizar FROM vta_topes_descuento
        WHERE tenant_id = $1 ORDER BY rol`,
      [req.auth!.tenantId]
    );
    res.json({ topes: r.rows });
  } catch (err) {
    fallo(res, err, "GET /ventas/topes-descuento");
  }
});

ventasRouter.put("/topes-descuento", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    if (!b.rol) return res.status(400).json({ error: "Falta el rol." });
    await req.db!.query(
      `INSERT INTO vta_topes_descuento (tenant_id, rol, tope_pct, puede_autorizar)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (tenant_id, rol) DO UPDATE SET
         tope_pct = EXCLUDED.tope_pct,
         puede_autorizar = EXCLUDED.puede_autorizar,
         actualizado_en = now()`,
      [
        req.auth!.tenantId,
        b.rol,
        // NULL explícito = sin tope. Se distingue de «no vino» para que
        // «sin tope» sea una decisión que se pueda guardar.
        b.topePct === null || b.topePct === "" || b.topePct === undefined ? null : b.topePct,
        b.puedeAutorizar === true,
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /ventas/topes-descuento");
  }
});

// ---------------------------------------------------------------------
// LAS COMISIONES DE TARJETA Y EL LOTE DEL DATÁFONO — prompt 08b, A4.
// ---------------------------------------------------------------------
ventasRouter.get("/comisiones-tarjeta", async (req, res) => {
  try {
    const r = await req.db!.query(
      `SELECT id, banco, tipo_tarjeta, marca, comision_pct::text, comision_fija::text,
              vigente_desde::text
         FROM vta_comisiones_tarjeta
        WHERE tenant_id = $1
        ORDER BY banco, tipo_tarjeta, vigente_desde DESC`,
      [req.auth!.tenantId]
    );
    res.json({ comisiones: r.rows });
  } catch (err) {
    fallo(res, err, "GET /ventas/comisiones-tarjeta");
  }
});

ventasRouter.post("/comisiones-tarjeta", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    if (!b.banco?.trim() || !b.tipoTarjeta || b.comisionPct === undefined || !b.vigenteDesde) {
      return res.status(400).json({
        error: "Una comisión lleva banco, tipo de tarjeta, porcentaje y desde cuándo rige.",
      });
    }
    const r = await req.db!.query(
      `INSERT INTO vta_comisiones_tarjeta
         (tenant_id, banco, tipo_tarjeta, marca, comision_pct, comision_fija, vigente_desde)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [
        req.auth!.tenantId,
        b.banco.trim(),
        b.tipoTarjeta,
        b.marca?.trim() || null,
        b.comisionPct,
        b.comisionFija ?? 0,
        b.vigenteDesde,
      ]
    );
    res.status(201).json({ id: r.rows[0].id });
  } catch (err) {
    fallo(res, err, "POST /ventas/comisiones-tarjeta");
  }
});

/** Los totales del lote que imprime el datáfono, para conciliar. */
ventasRouter.put("/sesiones/:id/lote-datafono", async (req, res) => {
  try {
    const lineas = (req.body?.lineas ?? []) as Parameters<typeof registrarLoteDatafono>[3];
    res.json(await registrarLoteDatafono(req.db!, req.auth!.tenantId!, req.params.id, lineas));
  } catch (err) {
    fallo(res, err, "PUT /ventas/sesiones/:id/lote-datafono");
  }
});

/**
 * El comprobante del cierre, en PDF.
 *
 * Se puede pedir con la sesión abierta —sale marcado «SIN CERRAR»—
 * porque el cajero lo usa para contar antes de cerrar.
 */
ventasRouter.get("/sesiones/:id/cierre.pdf", async (req, res) => {
  try {
    const pdf = await comprobanteDeCierre(req.db!, req.auth!.tenantId!, req.params.id);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="cierre-de-caja.pdf"`);
    res.send(pdf);
  } catch (err) {
    fallo(res, err, "GET /ventas/sesiones/:id/cierre.pdf");
  }
});

ventasRouter.get("/sesiones/:id/conciliacion-tarjetas", async (req, res) => {
  try {
    res.json(await conciliarTarjetas(req.db!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /ventas/sesiones/:id/conciliacion-tarjetas");
  }
});

ventasRouter.get("/parametros", async (req, res) => {
  const r = await req.db!.query(`SELECT * FROM vta_parametros WHERE tenant_id = $1`, [
    req.auth!.tenantId,
  ]);
  res.json({
    parametros: r.rows[0] ?? {
      tenant_id: req.auth!.tenantId,
      umbral_diferencia_arqueo: "2000",
      descuento_maximo_pct: "10",
      arqueo_por_denominacion: false,
    },
  });
});

ventasRouter.put("/parametros", permisoConfig, async (req, res) => {
  const b = req.body ?? {};
  try {
    await req.db!.query(
      // COALESCE Y NO EXCLUDED A SECAS: la pantalla de configuración de
      // caja guarda solo el modo de arqueo, y el PUT entero con los
      // defaults borraría el tope de descuento y la lista de precios que
      // otra pantalla había configurado. Lo que no viene en el body se
      // queda como está.
      `INSERT INTO vta_parametros (tenant_id, umbral_diferencia_arqueo, descuento_maximo_pct,
                                  lista_precio_id, arqueo_por_denominacion)
       VALUES ($1, COALESCE($2, 2000), COALESCE($3, 10), $4, COALESCE($5, false))
       ON CONFLICT (tenant_id) DO UPDATE SET
         umbral_diferencia_arqueo =
           COALESCE($2, vta_parametros.umbral_diferencia_arqueo),
         descuento_maximo_pct = COALESCE($3, vta_parametros.descuento_maximo_pct),
         lista_precio_id = CASE WHEN $6::boolean THEN $4 ELSE vta_parametros.lista_precio_id END,
         arqueo_por_denominacion =
           COALESCE($5, vta_parametros.arqueo_por_denominacion),
         actualizado_en = now()`,
      [
        req.auth!.tenantId,
        b.umbralDiferenciaArqueo ?? null,
        b.descuentoMaximoPct ?? null,
        b.listaPrecioId || null,
        b.arqueoPorDenominacion ?? null,
        // «La lista vino en el body», aunque haya venido en null: null
        // explícito significa «a precio base» y tiene que poder guardarse.
        Object.prototype.hasOwnProperty.call(b, "listaPrecioId"),
      ]
    );
    res.json({ ok: true });
  } catch (err) {
    fallo(res, err, "PUT /ventas/parametros");
  }
});

/**
 * LOS CINCO REPORTES, en un endpoint con un parámetro.
 *
 * Uno y no cinco porque los cinco son la misma forma —agrupar lo cobrado
 * de un período por una dimensión— y cinco endpoints serían cinco
 * filtros de fecha implementados distinto.
 *
 * El cálculo NO vive acá: vive en `ventas/reportes.ts`, porque lo piden
 * dos caminos —esta pantalla y la exportación— y una consulta escrita
 * dos veces es un reporte que un día dice dos cosas distintas.
 */
ventasRouter.get("/reportes/:cual", async (req, res) => {
  const desde = String(req.query.desde ?? "");
  const hasta = String(req.query.hasta ?? "");
  if (!desde || !hasta) {
    return res.status(400).json({ error: "El reporte se pide para un período: desde y hasta." });
  }
  if (!esReporteConocido(req.params.cual)) {
    return res.status(404).json({ error: "Ese reporte no existe." });
  }
  try {
    res.json(await reporteDeVentas(req.db!, req.params.cual, desde, hasta));
  } catch (err) {
    fallo(res, err, `GET /ventas/reportes/${req.params.cual}`);
  }
});

/**
 * El mismo reporte, como archivo.
 *
 * Se arma EN EL BACKEND y con los mismos filtros que la pantalla: un
 * Excel armado en el navegador con las filas que alcanzó a traer la
 * tabla es un archivo que no coincide con el reporte.
 */
ventasRouter.get("/reportes/:cual/exportar", async (req, res) => {
  const desde = String(req.query.desde ?? "");
  const hasta = String(req.query.hasta ?? "");
  const formato = String(req.query.formato ?? "excel");
  if (!desde || !hasta) {
    return res.status(400).json({ error: "El reporte se pide para un período: desde y hasta." });
  }
  if (!esReporteConocido(req.params.cual)) {
    return res.status(404).json({ error: "Ese reporte no existe." });
  }
  if (formato !== "excel" && formato !== "pdf") {
    return res.status(400).json({ error: "Formato: excel o pdf." });
  }
  try {
    const r = await reporteDeVentas(req.db!, req.params.cual, desde, hasta);
    const tabla = {
      titulo: r.titulo,
      // El período va en el archivo: un reporte sin su período es un
      // número que nadie puede volver a reproducir. Si el reporte lo
      // ignora, el archivo lo dice.
      subtitulo: r.ignoraPeriodo
        ? "Saldos al día de hoy (este reporte no depende del período)"
        : `Del ${desde} al ${hasta}`,
      columnas: r.columnas,
      filas: r.filas,
    };
    const nombre = nombreDeArchivo(r.titulo, formato === "excel" ? "xlsx" : "pdf", req.auth!.zonaHoraria);
    const marca = await marcaYAutor(req);
    const cuerpo = formato === "excel" ? aExcel(tabla, marca) : await aPdf(tabla, marca);
    res.setHeader(
      "Content-Type",
      formato === "excel"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "application/pdf"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nombre}"`);
    res.send(cuerpo);
  } catch (err) {
    fallo(res, err, `GET /ventas/reportes/${req.params.cual}/exportar`);
  }
});
