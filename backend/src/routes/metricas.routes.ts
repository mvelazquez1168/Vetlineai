import { Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica, tienePermiso } from "../permisos";
import { requiereModulo } from "../tenantModulos";
import { aExcel, aPdf, nombreDeArchivo } from "../exportacion/tabla";
import { marcaDeLaClinica } from "../pdf/marcaPdf";
import { METRICAS, Periodo, definicion } from "../metricas/diccionario";
import { comparativaDeMedicos, dashboardClinica, dashboardMedico } from "../metricas/dashboards";
import { dashboardAPdf } from "../metricas/dashboardPdf";
import { LISTAS, lista } from "../metricas/listas";
import { resumenDeCliente, resumenDePaciente } from "../metricas/fichas";
import { consumoDeProducto, trazabilidadDeLote } from "../metricas/trazabilidad";

// ---------------------------------------------------------------------
// DASHBOARDS Y DRILL-DOWN — prompt 12.
//
// Dos reglas de esta capa, y las dos son de permisos (§10):
//
//   1. **El margen y el costo no salen sin `catalogo.ver_costos`.** No
//      alcanza con no dibujarlos: si el número viaja en la respuesta,
//      cualquiera lo lee. Por eso el permiso se resuelve acá y se le
//      pasa al cálculo, que devuelve el bloque sin costo.
//   2. **Un médico ve lo suyo.** Pedir el dashboard de otro requiere
//      `reportes.ver`; sin él, el id que se pida se ignora y se
//      devuelve el propio. No es un 403: pedir «mi dashboard» sin
//      saber que hay que mandar el id es lo normal.
// ---------------------------------------------------------------------

export const metricasRouter = Router();
metricasRouter.use(authenticate, withTenantClient, soloPersonalDeLaClinica());
// Las métricas son de gestión: una clínica que solo tiene Vetline Ai no
// las ve, y su Inicio sigue siendo el de siempre.
metricasRouter.use(requiereModulo("ventas"));

function periodoDe(req: Request): Periodo {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = String(req.query.desde ?? hoy);
  const hasta = String(req.query.hasta ?? hoy);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw new Error("Las fechas van en formato AAAA-MM-DD.");
  }
  if (desde > hasta) throw new Error("La fecha de inicio es posterior a la del final.");
  return { desde, hasta };
}

function fallo(res: Response, err: unknown, donde: string) {
  const mensaje = err instanceof Error ? err.message : "Error inesperado.";
  // Los errores de dato pedido (fechas al revés, id que no existe) son
  // del que pregunta, no del servidor.
  if (/formato|posterior|no existe|no es de esta/i.test(mensaje)) {
    return res.status(400).json({ error: mensaje });
  }
  console.error(`[metricas] ${donde}:`, err);
  res.status(500).json({ error: "No se pudo calcular el indicador." });
}

/** Quién pidió el archivo. El token no trae el nombre: se lee. */
async function nombreDeQuienPide(req: Request): Promise<string> {
  const r = await req.db!.query<{ nombre: string }>(
    `SELECT nombre FROM personas WHERE id = $1`,
    [req.auth!.userId]
  );
  return r.rows[0]?.nombre ?? "—";
}

/** Deja la exportación en la auditoría (§8), sin una tabla nueva. */
async function anotarExportacion(
  req: Request,
  que: string,
  formato: string,
  detalle: Record<string, unknown>
) {
  try {
    await req.db!.query(
      `INSERT INTO bitacora_auditoria (tenant_id, persona_id, accion, entidad, detalle)
       VALUES ($1, $2, 'exportacion_reporte', $3, $4::jsonb)`,
      [req.auth!.tenantId, req.auth!.userId, que, JSON.stringify({ formato, ...detalle })]
    );
  } catch (err) {
    // Que no se pueda anotar no justifica negarle el archivo a quien
    // tiene permiso para tenerlo; queda en el log del servidor.
    console.error("[metricas] no se pudo anotar la exportación:", err);
  }
}

// ---------------------------------------------------------------------
// El diccionario, que la interfaz muestra en el ícono de información.
// ---------------------------------------------------------------------
metricasRouter.get("/diccionario", (_req, res) => {
  res.json({ metricas: METRICAS, listas: LISTAS.map((l) => ({ clave: l.clave, titulo: l.titulo })) });
});

// ---------------------------------------------------------------------
// §2 — El dashboard de la clínica
// ---------------------------------------------------------------------
metricasRouter.get("/clinica", exigirPermiso("reportes.ver"), async (req, res) => {
  try {
    const p = periodoDe(req);
    const verCostos = tienePermiso(req, "catalogo.ver_costos");
    res.json(await dashboardClinica(req.db!, req.auth!.tenantId!, p, { verCostos }));
  } catch (err) {
    fallo(res, err, "clinica");
  }
});

metricasRouter.get("/clinica/exportar", exigirPermiso("reportes.ver"), async (req, res) => {
  try {
    const p = periodoDe(req);
    const verCostos = tienePermiso(req, "catalogo.ver_costos");
    const d = await dashboardClinica(req.db!, req.auth!.tenantId!, p, { verCostos });
    const formato = String(req.query.formato ?? "pdf");
    await anotarExportacion(req, "dashboard_clinica", formato, { periodo: p });

    if (formato === "pdf") {
      const marca = await marcaDeLaClinica(req.db!, req.auth!.tenantId!);
      const pdf = await dashboardAPdf(d, marca, {
        usuario: await nombreDeQuienPide(req),
        filtros: verCostos ? undefined : "sin costos (el rol no los ve)",
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${nombreDeArchivo("dashboard-clinica", "pdf")}"`
      );
      return res.send(pdf);
    }

    // En Excel el dashboard va como la tabla de sus indicadores: una
    // planilla con un gráfico adentro necesitaría escribir XML de
    // gráficos a mano, y lo que la dueña hace con esto es pegarlo en
    // otra planilla.
    const xlsx = aExcel({
      titulo: "Dashboard de la clínica",
      subtitulo: `Del ${p.desde} al ${p.hasta}`,
      columnas: [
        { clave: "indicador", titulo: "Indicador" },
        { clave: "valor", titulo: "Valor", tipo: "numero" },
        { clave: "anterior", titulo: "Período anterior", tipo: "numero" },
        { clave: "variacion", titulo: "Variación %", tipo: "numero" },
        { clave: "detalle", titulo: "Detalle" },
      ],
      filas: d.tarjetas.map((t) => ({
        indicador: definicionSegura(t.clave),
        valor: t.valor,
        anterior: t.anterior,
        variacion: t.variacion,
        detalle: t.detalle ?? "",
      })),
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nombreDeArchivo("dashboard-clinica", "xlsx")}"`
    );
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "clinica/exportar");
  }
});

function definicionSegura(clave: string): string {
  try {
    return definicion(clave as never).nombre;
  } catch {
    return clave;
  }
}

// ---------------------------------------------------------------------
// §3 — El dashboard del médico
// ---------------------------------------------------------------------
metricasRouter.get("/medico", async (req, res) => {
  try {
    const p = periodoDe(req);
    const pedido = req.query.medicoId ? String(req.query.medicoId) : null;
    const puedeVerOtros = tienePermiso(req, "reportes.ver");
    const medicoId = pedido && puedeVerOtros ? pedido : req.auth!.userId;
    res.json(await dashboardMedico(req.db!, req.auth!.tenantId!, medicoId, p));
  } catch (err) {
    fallo(res, err, "medico");
  }
});

metricasRouter.get("/medicos/comparativa", exigirPermiso("reportes.ver"), async (req, res) => {
  try {
    res.json({ medicos: await comparativaDeMedicos(req.db!, req.auth!.tenantId!, periodoDe(req)) });
  } catch (err) {
    fallo(res, err, "medicos/comparativa");
  }
});

// ---------------------------------------------------------------------
// §4 y §5 — Los resúmenes del cliente y del paciente
// ---------------------------------------------------------------------
metricasRouter.get("/cliente/:id", exigirPermiso("cliente.ver"), async (req, res) => {
  try {
    const verCostos = tienePermiso(req, "catalogo.ver_costos");
    res.json(
      await resumenDeCliente(req.db!, req.auth!.tenantId!, req.params.id, { verCostos })
    );
  } catch (err) {
    fallo(res, err, "cliente");
  }
});

metricasRouter.get("/paciente/:id", exigirPermiso("expediente.ver"), async (req, res) => {
  try {
    res.json(await resumenDePaciente(req.db!, req.auth!.tenantId!, req.params.id));
  } catch (err) {
    fallo(res, err, "paciente");
  }
});

// ---------------------------------------------------------------------
// §6 — Trazabilidad
// ---------------------------------------------------------------------
metricasRouter.get("/producto/:id/consumo", exigirPermiso("inventario.ver"), async (req, res) => {
  try {
    res.json(await consumoDeProducto(req.db!, req.auth!.tenantId!, req.params.id, periodoDe(req)));
  } catch (err) {
    fallo(res, err, "producto/consumo");
  }
});

metricasRouter.get("/lote/:id/trazabilidad", exigirPermiso("inventario.ver"), async (req, res) => {
  try {
    res.json(await trazabilidadDeLote(req.db!, req.auth!.tenantId!, req.params.id));
  } catch (err) {
    fallo(res, err, "lote/trazabilidad");
  }
});

// ---------------------------------------------------------------------
// §7 — El drill-down: la lista que compone cada número
//
// Una sola ruta para todas las listas. La definición vive en
// `listas.ts` junto al total que tiene que reproducir, que es lo que
// hace posible verificar que suman lo mismo.
// ---------------------------------------------------------------------
metricasRouter.get("/listas/:clave", exigirPermiso("reportes.ver"), async (req, res) => {
  try {
    const l = lista(req.params.clave);
    if (l.permiso && !(tienePermiso(req, l.permiso))) {
      return res.status(403).json({ error: "Tu rol no puede ver esta lista." });
    }
    const p = periodoDe(req);
    const filas = await l.filas(req.db!, req.auth!.tenantId!, p);
    const total = await l.total(req.db!, req.auth!.tenantId!, p);

    // La paginación es del lado del servidor pero el TOTAL es de la
    // lista entera: una página que sumara solo sus filas no coincidiría
    // con la tarjeta, que es justo lo que no puede pasar.
    const pagina = Math.max(1, Number(req.query.pagina ?? 1));
    const porPagina = Math.min(500, Math.max(10, Number(req.query.porPagina ?? 50)));
    const desde = (pagina - 1) * porPagina;

    res.json({
      clave: l.clave,
      titulo: l.titulo,
      metrica: l.metrica,
      columnas: l.columnas,
      columnaSuma: l.columnaSuma,
      sinPeriodo: !!l.sinPeriodo,
      total,
      filas: filas.slice(desde, desde + porPagina).map((f) => ({
        ...f,
        _destino: l.destino ? l.destino(f) : null,
      })),
      cantidad: filas.length,
      pagina,
      porPagina,
    });
  } catch (err) {
    fallo(res, err, "listas");
  }
});

metricasRouter.get("/listas/:clave/exportar", exigirPermiso("reportes.ver"), async (req, res) => {
  try {
    const l = lista(req.params.clave);
    if (l.permiso && !(tienePermiso(req, l.permiso))) {
      return res.status(403).json({ error: "Tu rol no puede ver esta lista." });
    }
    const p = periodoDe(req);
    const filas = await l.filas(req.db!, req.auth!.tenantId!, p);
    const formato = String(req.query.formato ?? "excel");
    await anotarExportacion(req, `lista_${l.clave}`, formato, { periodo: p, filas: filas.length });

    const tabla = {
      titulo: l.titulo,
      subtitulo: l.sinPeriodo
        ? "Saldo de hoy (el período no la afecta)"
        : `Del ${p.desde} al ${p.hasta}`,
      columnas: l.columnas.map((c) => ({ clave: c.clave, titulo: c.etiqueta, tipo: c.tipo })),
      filas,
    };

    if (formato === "pdf") {
      const marca = await marcaDeLaClinica(req.db!, req.auth!.tenantId!);
      const pdf = await aPdf(tabla, {
        marca,
        usuario: await nombreDeQuienPide(req),
      });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${nombreDeArchivo(l.clave, "pdf")}"`
      );
      return res.send(pdf);
    }

    const xlsx = aExcel(tabla);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nombreDeArchivo(l.clave, "xlsx")}"`
    );
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "listas/exportar");
  }
});
