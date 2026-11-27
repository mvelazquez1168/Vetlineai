import { Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica } from "../permisos";
import { requiereModulo } from "../tenantModulos";
import { aExcel, aPdf, nombreDeArchivo } from "../exportacion/tabla";
import { marcaYAutor } from "../marca/marcaDeLaSolicitud";
import {
  conciliarComprobanteConCuenta,
  crearCuentaPorPagar,
  cuentaDesdeComprobanteRecibido,
  CuentaPorPagarInvalida,
  cuentasPorPagar,
  detalleDeCuenta,
  resumenPorPagar,
} from "../finanzas/cuentasPagar";
import {
  anularPago,
  cuentasBanco,
  guardarCuentaBanco,
  PagoInvalido,
  pagosDelProveedor,
  registrarPago,
} from "../finanzas/pagos";
import {
  anularGasto,
  categoriaSugerida,
  categoriasDeGasto,
  conciliarRecurrente,
  gastoDesdeComprobante,
  gastos,
  GastoInvalido,
  generarPendientes,
  guardarCategoria,
  guardarRecurrente,
  recurrentes,
  registrarGasto,
  resumenDeGastos,
} from "../finanzas/gastos";
import {
  CobranzaInvalida,
  deudores,
  porQueNoSePuedeRecordar,
  recordarSaldo,
  resumenPorCobrar,
} from "../finanzas/cobranza";
import {
  cerrarDia,
  CierreInvalido,
  cierreDelDia,
  conciliarSinpe,
  desconciliarSinpe,
  registrarDeposito,
} from "../finanzas/cierreDiario";
import { Cuaderno, CUADERNOS, tablaContable } from "../finanzas/exportacionContable";

// ---------------------------------------------------------------------
// FINANZAS — prompt 10a.
//
// TODO LO QUE SE LEE PIDE `finanzas.ver` y todo lo que se escribe pide
// `finanzas.registrar`, salvo anular un pago y cerrar el día con
// diferencia, que tienen su propio permiso.
//
// POR QUÉ NO ES COMO LAS DEMÁS SECCIONES, donde leer está abierto a todo
// el personal: cuánto debe la clínica y a quién no es información de
// mostrador. El contador la ve en modo lectura, y la clínica que quiera
// que la caja registre pagos activa `finanzas.registrar`, que es
// configurable.
// ---------------------------------------------------------------------

export const finanzasRouter = Router();
finanzasRouter.use(authenticate, withTenantClient, soloPersonalDeLaClinica());
finanzasRouter.use(requiereModulo("finanzas"));
finanzasRouter.use(exigirPermiso("finanzas.ver"));

const puedeRegistrar = exigirPermiso("finanzas.registrar");

function fallo(res: Response, err: unknown, donde: string) {
  if (
    err instanceof CuentaPorPagarInvalida ||
    err instanceof PagoInvalido ||
    err instanceof GastoInvalido ||
    err instanceof CobranzaInvalida ||
    err instanceof CierreInvalido
  ) {
    return res.status(409).json({ error: err.message });
  }
  // Las invariantes de dinero las impone la base con un `check_violation`
  // y su mensaje ya está escrito para una persona: se muestra tal cual en
  // vez de un 500 sin explicación.
  const e = err as { code?: string; message?: string };
  if (e.code === "23514") {
    return res.status(409).json({ error: e.message ?? "La operación rompe una regla de dinero." });
  }
  if (e.code === "23505" || e.code === "23505") {
    return res.status(409).json({ error: "Ya existe un registro con esos datos." });
  }
  console.error(donde, err);
  res.status(500).json({ error: "Error inesperado en finanzas." });
}

// --- Cuentas por pagar ------------------------------------------------
finanzasRouter.get("/por-pagar", async (req, res) => {
  try {
    res.json({
      resumen: await resumenPorPagar(req.db!, req.auth!.tenantId!),
      cuentas: await cuentasPorPagar(req.db!, req.auth!.tenantId!, {
        proveedorId: (req.query.proveedorId as string) || undefined,
        estado: (req.query.estado as string) || undefined,
        hasta: (req.query.hasta as string) || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/por-pagar");
  }
});

finanzasRouter.get("/por-pagar/:id", async (req, res) => {
  try {
    res.json(await detalleDeCuenta(req.db!, req.auth!.tenantId!, req.params.id));
  } catch (err) {
    fallo(res, err, "GET /finanzas/por-pagar/:id");
  }
});

finanzasRouter.post("/por-pagar", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await crearCuentaPorPagar(req.db!, req.auth!.tenantId!, {
        proveedorId: b.proveedorId,
        documento: b.documento,
        fecha: b.fecha,
        vencimiento: b.vencimiento,
        moneda: b.moneda,
        monto: Number(b.monto),
        exigible: b.exigible === undefined ? undefined : Number(b.exigible),
        compraId: b.compraId,
        recibidoId: b.recibidoId,
        sinComprobante: b.sinComprobante,
        reduceACuentaId: b.reduceACuentaId,
        nota: b.nota,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/por-pagar");
  }
});

/** La cuenta que nace de un comprobante ya aceptado en la bandeja (09b). */
finanzasRouter.post("/por-pagar/desde-comprobante", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await cuentaDesdeComprobanteRecibido(req.db!, req.auth!.tenantId!, {
        recibidoId: b.recibidoId,
        proveedorId: b.proveedorId,
        montoAceptado: b.montoAceptado === undefined ? undefined : Number(b.montoAceptado),
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/por-pagar/desde-comprobante");
  }
});

finanzasRouter.post("/por-pagar/:id/conciliar", puedeRegistrar, async (req, res) => {
  try {
    await conciliarComprobanteConCuenta(req.db!, req.auth!.tenantId!, {
      cuentaId: req.params.id,
      recibidoId: req.body?.recibidoId,
    });
    res.json({ conciliada: true });
  } catch (err) {
    fallo(res, err, "POST /finanzas/por-pagar/:id/conciliar");
  }
});

// --- Pagos ------------------------------------------------------------
finanzasRouter.post("/pagos", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await registrarPago(req.db!, req.auth!.tenantId!, {
        proveedorId: b.proveedorId,
        fecha: b.fecha,
        medio: b.medio,
        cuentaBancoId: b.cuentaBancoId,
        referencia: b.referencia,
        respaldoUrl: b.respaldoUrl,
        moneda: b.moneda,
        tipoCambio: b.tipoCambio === undefined ? undefined : Number(b.tipoCambio),
        aplicaciones: (b.aplicaciones ?? []).map(
          (a: { cuentaId: string; monto: number | string }) => ({
            cuentaId: a.cuentaId,
            monto: Number(a.monto),
          })
        ),
        sesionCajaId: b.sesionCajaId,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/pagos");
  }
});

finanzasRouter.post(
  "/pagos/:id/anular",
  exigirPermiso("finanzas.anular_pago"),
  async (req, res) => {
    try {
      res.json(
        await anularPago(req.db!, req.auth!.tenantId!, {
          pagoId: req.params.id,
          motivo: req.body?.motivo ?? "",
          personaId: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /finanzas/pagos/:id/anular");
    }
  }
);

finanzasRouter.get("/pagos/proveedor/:proveedorId", async (req, res) => {
  try {
    res.json({
      pagos: await pagosDelProveedor(req.db!, req.auth!.tenantId!, req.params.proveedorId),
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/pagos/proveedor/:id");
  }
});

// --- Cuentas bancarias de la clínica ----------------------------------
finanzasRouter.get("/cuentas-banco", async (req, res) => {
  try {
    res.json({
      cuentas: await cuentasBanco(req.db!, req.auth!.tenantId!, req.query.todas === "1"),
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/cuentas-banco");
  }
});

finanzasRouter.post("/cuentas-banco", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(b.id ? 200 : 201).json(
      await guardarCuentaBanco(req.db!, req.auth!.tenantId!, {
        id: b.id,
        nombre: b.nombre,
        banco: b.banco,
        terminacion: b.terminacion,
        moneda: b.moneda,
        activa: b.activa,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/cuentas-banco");
  }
});

// --- Gastos -----------------------------------------------------------
finanzasRouter.get("/gastos", async (req, res) => {
  try {
    const mes = (req.query.mes as string) || new Date().toISOString().slice(0, 10);
    res.json({
      resumen: await resumenDeGastos(req.db!, req.auth!.tenantId!, mes),
      gastos: await gastos(req.db!, req.auth!.tenantId!, {
        desde: (req.query.desde as string) || undefined,
        hasta: (req.query.hasta as string) || undefined,
        categoriaId: (req.query.categoriaId as string) || undefined,
        estado: (req.query.estado as string) || undefined,
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/gastos");
  }
});

finanzasRouter.post("/gastos", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await registrarGasto(req.db!, req.auth!.tenantId!, {
        fecha: b.fecha,
        categoriaId: b.categoriaId,
        proveedorId: b.proveedorId,
        descripcion: b.descripcion,
        moneda: b.moneda,
        monto: Number(b.monto),
        lineaNegocio: b.lineaNegocio,
        sinComprobante: b.sinComprobante,
        respaldoUrl: b.respaldoUrl,
        generaCuentaPorPagar: b.generaCuentaPorPagar,
        vencimiento: b.vencimiento,
        documento: b.documento,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/gastos");
  }
});

/** La acción «Registrar como gasto» de la bandeja del 09b. */
finanzasRouter.post("/gastos/desde-comprobante", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await gastoDesdeComprobante(req.db!, req.auth!.tenantId!, {
        recibidoId: b.recibidoId,
        categoriaId: b.categoriaId,
        proveedorId: b.proveedorId,
        lineaNegocio: b.lineaNegocio,
        generaCuentaPorPagar: b.generaCuentaPorPagar,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/gastos/desde-comprobante");
  }
});

finanzasRouter.post("/gastos/:id/anular", puedeRegistrar, async (req, res) => {
  try {
    await anularGasto(req.db!, req.auth!.tenantId!, {
      gastoId: req.params.id,
      motivo: req.body?.motivo ?? "",
    });
    res.json({ anulado: true });
  } catch (err) {
    fallo(res, err, "POST /finanzas/gastos/:id/anular");
  }
});

finanzasRouter.get("/categorias-gasto", async (req, res) => {
  try {
    res.json({
      categorias: await categoriasDeGasto(req.db!, req.auth!.tenantId!, req.query.todas === "1"),
      sugerida: req.query.proveedorId
        ? await categoriaSugerida(req.db!, req.auth!.tenantId!, req.query.proveedorId as string)
        : null,
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/categorias-gasto");
  }
});

finanzasRouter.post("/categorias-gasto", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(b.id ? 200 : 201).json(
      await guardarCategoria(req.db!, req.auth!.tenantId!, {
        id: b.id,
        nombre: b.nombre,
        activo: b.activo,
        orden: b.orden,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/categorias-gasto");
  }
});

// --- Gastos recurrentes -----------------------------------------------
finanzasRouter.get("/recurrentes", async (req, res) => {
  try {
    res.json({ recurrentes: await recurrentes(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /finanzas/recurrentes");
  }
});

finanzasRouter.post("/recurrentes", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(b.id ? 200 : 201).json(
      await guardarRecurrente(req.db!, req.auth!.tenantId!, {
        id: b.id,
        categoriaId: b.categoriaId,
        proveedorId: b.proveedorId,
        descripcion: b.descripcion,
        montoEstimado: Number(b.montoEstimado),
        moneda: b.moneda,
        diaDelMes: b.diaDelMes === undefined ? undefined : Number(b.diaDelMes),
        lineaNegocio: b.lineaNegocio,
        activo: b.activo,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/recurrentes");
  }
});

finanzasRouter.post("/recurrentes/generar", puedeRegistrar, async (req, res) => {
  try {
    const mes = req.body?.mes ?? new Date().toISOString().slice(0, 10);
    res.json(await generarPendientes(req.db!, req.auth!.tenantId!, mes, req.auth!.userId));
  } catch (err) {
    fallo(res, err, "POST /finanzas/recurrentes/generar");
  }
});

finanzasRouter.post("/gastos/:id/conciliar", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json(
      await conciliarRecurrente(req.db!, req.auth!.tenantId!, {
        gastoEstimadoId: req.params.id,
        recibidoId: b.recibidoId,
        monto: b.monto === undefined ? undefined : Number(b.monto),
        fecha: b.fecha,
        generaCuentaPorPagar: b.generaCuentaPorPagar,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/gastos/:id/conciliar");
  }
});

// --- Cuentas por cobrar y cobranza ------------------------------------
finanzasRouter.get("/por-cobrar", async (req, res) => {
  try {
    res.json({
      resumen: await resumenPorCobrar(req.db!, req.auth!.tenantId!),
      deudores: await deudores(req.db!, req.auth!.tenantId!),
    });
  } catch (err) {
    fallo(res, err, "GET /finanzas/por-cobrar");
  }
});

finanzasRouter.get("/por-cobrar/:propietarioId/puede-recordar", async (req, res) => {
  try {
    const motivo = await porQueNoSePuedeRecordar(
      req.db!,
      req.auth!.tenantId!,
      req.params.propietarioId
    );
    res.json({ puede: motivo === null, motivo });
  } catch (err) {
    fallo(res, err, "GET /finanzas/por-cobrar/:id/puede-recordar");
  }
});

finanzasRouter.post("/por-cobrar/:propietarioId/recordar", puedeRegistrar, async (req, res) => {
  try {
    res.json(
      await recordarSaldo(req.db!, req.auth!.tenantId!, {
        propietarioId: req.params.propietarioId,
        mensaje: req.body?.mensaje,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/por-cobrar/:id/recordar");
  }
});

// --- Cierre del día ---------------------------------------------------
finanzasRouter.get("/cierre-dia", async (req, res) => {
  try {
    const fecha = (req.query.fecha as string) || new Date().toISOString().slice(0, 10);
    res.json(await cierreDelDia(req.db!, req.auth!.tenantId!, fecha));
  } catch (err) {
    fallo(res, err, "GET /finanzas/cierre-dia");
  }
});

finanzasRouter.post("/cierre-dia/sinpe/:cobroMedioId", puedeRegistrar, async (req, res) => {
  try {
    res.json(
      await conciliarSinpe(req.db!, req.auth!.tenantId!, {
        cobroMedioId: req.params.cobroMedioId,
        cuentaBancoId: req.body?.cuentaBancoId,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/cierre-dia/sinpe/:id");
  }
});

finanzasRouter.delete("/cierre-dia/sinpe/:cobroMedioId", puedeRegistrar, async (req, res) => {
  try {
    await desconciliarSinpe(req.db!, req.auth!.tenantId!, req.params.cobroMedioId);
    res.json({ desconciliado: true });
  } catch (err) {
    fallo(res, err, "DELETE /finanzas/cierre-dia/sinpe/:id");
  }
});

finanzasRouter.post("/cierre-dia/deposito", puedeRegistrar, async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await registrarDeposito(req.db!, req.auth!.tenantId!, {
        fecha: b.fecha,
        monto: Number(b.monto),
        moneda: b.moneda,
        cuentaBancoId: b.cuentaBancoId,
        referencia: b.referencia,
        respaldoUrl: b.respaldoUrl,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/cierre-dia/deposito");
  }
});

/**
 * Cerrar el día.
 *
 * CON DIFERENCIA, PIDE SU PROPIO PERMISO. Sin diferencia alcanza con
 * `finanzas.registrar`: cerrar un día que cuadra es un trámite, cerrar
 * uno que no cuadra es una decisión. El chequeo va acá y no en una
 * guarda porque depende de los números, que todavía no se conocen cuando
 * corre el middleware.
 */
finanzasRouter.post("/cierre-dia/cerrar", puedeRegistrar, async (req, res) => {
  try {
    const fecha = req.body?.fecha ?? new Date().toISOString().slice(0, 10);
    const previo = await cierreDelDia(req.db!, req.auth!.tenantId!, fecha);
    if (
      Math.abs(previo.diferencia) > 0.001 &&
      !req.auth!.permisos?.has("finanzas.cerrar_con_diferencia")
    ) {
      return res.status(403).json({
        error:
          "El día cierra con una diferencia y no tenés permiso para cerrarlo así. Pedíselo a un administrador.",
        permisoFaltante: "finanzas.cerrar_con_diferencia",
        diferencia: previo.diferencia,
      });
    }
    res.json(
      await cerrarDia(req.db!, req.auth!.tenantId!, {
        fecha,
        justificacion: req.body?.justificacion,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /finanzas/cierre-dia/cerrar");
  }
});

// --- Exportación para el contador -------------------------------------
finanzasRouter.get("/exportacion", async (req, res) => {
  res.json({ cuadernos: CUADERNOS });
});

finanzasRouter.get("/exportacion/:cuaderno.:formato", async (req, res) => {
  try {
    const cuaderno = req.params.cuaderno as Cuaderno;
    if (!CUADERNOS.some((c) => c.clave === cuaderno)) {
      return res.status(400).json({ error: "Ese cuaderno no existe." });
    }
    const desde = (req.query.desde as string) || new Date().toISOString().slice(0, 10);
    const hasta = (req.query.hasta as string) || desde;
    const tabla = await tablaContable(req.db!, req.auth!.tenantId!, cuaderno, desde, hasta);

    if (req.params.formato === "pdf") {
      const pdf = await aPdf(tabla, await marcaYAutor(req));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${nombreDeArchivo(cuaderno, "pdf")}"`
      );
      return res.send(pdf);
    }
    const xlsx = aExcel(tabla, await marcaYAutor(req));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nombreDeArchivo(cuaderno, "xlsx")}"`
    );
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "GET /finanzas/exportacion/:cuaderno");
  }
});
