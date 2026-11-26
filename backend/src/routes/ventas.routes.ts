import { NextFunction, Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { aExcel, aPdf, nombreDeArchivo } from "../exportacion/tabla";
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

    const [esperado, cobros, movimientos, cuentas, porMedio] = await Promise.all([
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

    res.json({
      sesion: s.rows[0],
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
    const nombre = nombreDeArchivo(r.titulo, formato === "excel" ? "xlsx" : "pdf");
    const cuerpo = formato === "excel" ? aExcel(tabla) : await aPdf(tabla);
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
