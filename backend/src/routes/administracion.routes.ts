import { Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica, tienePermiso } from "../permisos";
import {
  alternarActivo,
  CATALOGOS,
  CatalogoInvalido,
  guardar as guardarItem,
  listar as listarCatalogo,
  revisarImportacion,
} from "../clinica/catalogos";
import {
  ausencias,
  borrarTurno,
  copiarSemana,
  credenciales,
  guardarCredencial,
  guardarTurno,
  horasParaPlanilla,
  pedirAusencia,
  PersonalInvalido,
  porVencer,
  resolverAusencia,
  turnos,
} from "../clinica/personal";
import {
  ajustar,
  ajustesPendientes,
  aplicarAjustesPendientes,
  aprobar,
  calcularBorrador,
  ComisionInvalida,
  detalleDeLiquidacion,
  generarBorrador,
  guardarRegla,
  liquidaciones,
  reglas,
} from "../clinica/comisiones";
import {
  cerrarLibro,
  cierresDeControlados,
  CumplimientoInvalido,
  desechos,
  guardarPermiso,
  libroDeControlados,
  permisos as permisosDeCumplimiento,
  registrarDesecho,
  saldosDeControlados,
} from "../clinica/cumplimiento";
import { eventos, tiposDeEvento } from "../clinica/auditoria";
import {
  confirmarLectura,
  generarPdf,
  guardarPlantilla,
  guardarProcedimiento,
  lecturas,
  plantillas,
  PlantillaInvalida,
  procedimiento,
  procedimientos,
  VARIABLES,
  variablesDesconocidas,
} from "../clinica/documentosClinicos";
import { aExcel, nombreDeArchivo } from "../exportacion/tabla";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN COMPLETA — prompt 11.
//
// Catálogos, personal y turnos, comisiones, cumplimiento, auditoría y
// procedimientos. Un router aparte de `clinica.routes.ts` —que tiene el
// 04: personas, roles, políticas y horario— porque son seis temas más y
// juntarlos daría un archivo de mil líneas donde nadie encuentra nada.
//
// CADA SECCIÓN CON SU PERMISO. Los del 11 están en la matriz desde la
// migración 159.
// ---------------------------------------------------------------------

export const administracionRouter = Router();
administracionRouter.use(authenticate, withTenantClient, soloPersonalDeLaClinica());

function fallo(res: Response, err: unknown, donde: string) {
  if (
    err instanceof CatalogoInvalido ||
    err instanceof PersonalInvalido ||
    err instanceof ComisionInvalida ||
    err instanceof CumplimientoInvalido ||
    err instanceof PlantillaInvalida
  ) {
    return res.status(409).json({ error: err.message });
  }
  const e = err as { code?: string; message?: string };
  if (e.code === "23514") {
    return res.status(409).json({ error: e.message ?? "La operación rompe una regla." });
  }
  if (e.code === "23505") {
    return res.status(409).json({ error: "Ya existe un registro con esos datos." });
  }
  console.error(donde, err);
  res.status(500).json({ error: "Error inesperado." });
}

// =====================================================================
// CATÁLOGOS
// =====================================================================

/** El mapa: qué catálogos hay y dónde se edita cada uno. */
administracionRouter.get("/catalogos", async (_req, res) => {
  res.json({ catalogos: CATALOGOS });
});

administracionRouter.get("/catalogos/:clave", async (req, res) => {
  try {
    res.json({
      items: await listarCatalogo(
        req.db!,
        req.auth!.tenantId!,
        req.params.clave,
        req.query.todos === "1"
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/catalogos/:clave");
  }
});

administracionRouter.post(
  "/catalogos/:clave",
  exigirPermiso("catalogos.editar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarItem(req.db!, req.auth!.tenantId!, req.params.clave, {
          id: b.id,
          nombre: b.nombre,
          codigo: b.codigo,
          padreId: b.padreId,
          orden: b.orden === undefined ? undefined : Number(b.orden),
          activo: b.activo,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/catalogos/:clave");
    }
  }
);

administracionRouter.post(
  "/catalogos/:clave/:id/activo",
  exigirPermiso("catalogos.editar"),
  async (req, res) => {
    try {
      await alternarActivo(
        req.db!,
        req.auth!.tenantId!,
        req.params.clave,
        req.params.id,
        req.body?.activo !== false
      );
      res.json({ ok: true });
    } catch (err) {
      fallo(res, err, "POST /administracion/catalogos/:clave/:id/activo");
    }
  }
);

/** La vista previa de una importación: valida y no escribe nada. */
administracionRouter.post(
  "/catalogos/:clave/importar/revisar",
  exigirPermiso("catalogos.editar"),
  async (req, res) => {
    try {
      res.json(revisarImportacion(req.body?.filas ?? []));
    } catch (err) {
      fallo(res, err, "POST /administracion/catalogos/:clave/importar/revisar");
    }
  }
);

administracionRouter.post(
  "/catalogos/:clave/importar",
  exigirPermiso("catalogos.editar"),
  async (req, res) => {
    try {
      const { validas, conError } = revisarImportacion(req.body?.filas ?? []);
      // LAS FILAS CON ERROR NO SE CARGAN Y LAS BUENAS SÍ: el prompt pide
      // errores fila por fila, no un todo o nada. Quien importa corrige
      // esas filas y vuelve a importarlas.
      let cargadas = 0;
      for (const f of validas) {
        await guardarItem(req.db!, req.auth!.tenantId!, req.params.clave, {
          nombre: f.nombre,
          codigo: f.codigo,
          orden: f.orden,
          activo: f.activo,
        });
        cargadas += 1;
      }
      res.json({ cargadas, conError });
    } catch (err) {
      fallo(res, err, "POST /administracion/catalogos/:clave/importar");
    }
  }
);

administracionRouter.get("/catalogos/:clave/exportar.xlsx", async (req, res) => {
  try {
    const items = await listarCatalogo(req.db!, req.auth!.tenantId!, req.params.clave, true);
    const xlsx = aExcel({
      titulo: req.params.clave,
      columnas: [
        { clave: "nombre", titulo: "nombre" },
        { clave: "codigo", titulo: "codigo" },
        { clave: "orden", titulo: "orden", tipo: "numero" },
        { clave: "activo", titulo: "activo" },
      ],
      filas: items.map((i) => ({ ...i, activo: i.activo ? "si" : "no" })),
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nombreDeArchivo(req.params.clave, "xlsx")}"`
    );
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "GET /administracion/catalogos/:clave/exportar");
  }
});

// =====================================================================
// PERSONAL, TURNOS Y CREDENCIALES
// =====================================================================

administracionRouter.get("/turnos", async (req, res) => {
  try {
    const desde = (req.query.desde as string) || new Date().toISOString().slice(0, 10);
    const hasta = (req.query.hasta as string) || desde;
    res.json({
      turnos: await turnos(
        req.db!,
        req.auth!.tenantId!,
        desde,
        hasta,
        (req.query.personaId as string) || undefined
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/turnos");
  }
});

administracionRouter.post("/turnos", exigirPermiso("personal.gestionar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    res.status(201).json(
      await guardarTurno(req.db!, req.auth!.tenantId!, {
        personaId: b.personaId,
        fecha: b.fecha,
        horaDesde: b.horaDesde,
        horaHasta: b.horaHasta,
        tipo: b.tipo,
        nota: b.nota,
        personaQueRegistra: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /administracion/turnos");
  }
});

administracionRouter.delete(
  "/turnos/:id",
  exigirPermiso("personal.gestionar"),
  async (req, res) => {
    try {
      await borrarTurno(req.db!, req.auth!.tenantId!, req.params.id);
      res.json({ borrado: true });
    } catch (err) {
      fallo(res, err, "DELETE /administracion/turnos/:id");
    }
  }
);

administracionRouter.post(
  "/turnos/copiar-semana",
  exigirPermiso("personal.gestionar"),
  async (req, res) => {
    try {
      res.json(
        await copiarSemana(req.db!, req.auth!.tenantId!, {
          desdeLunes: req.body?.desdeLunes,
          haciaLunes: req.body?.haciaLunes,
          personaQueRegistra: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/turnos/copiar-semana");
    }
  }
);

administracionRouter.get("/ausencias", async (req, res) => {
  try {
    res.json({
      ausencias: await ausencias(req.db!, req.auth!.tenantId!, (req.query.desde as string) || undefined),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/ausencias");
  }
});

/**
 * Pedir una ausencia.
 *
 * CUALQUIERA PUEDE PEDIR LA SUYA; pedirla para otro, o aprobarla, lleva
 * el permiso. Es la diferencia entre «me voy de vacaciones» y «la mando
 * de vacaciones».
 */
administracionRouter.post("/ausencias", async (req, res) => {
  try {
    const b = req.body ?? {};
    const paraOtro = b.personaId && b.personaId !== req.auth!.userId;
    if (paraOtro && !tienePermiso(req, "personal.gestionar")) {
      return res.status(403).json({
        error: "Podés pedir tu propia ausencia. Registrar la de otra persona lleva permiso.",
        permisoFaltante: "personal.gestionar",
      });
    }
    const puedeAprobar = tienePermiso(req, "personal.gestionar");
    res.status(201).json(
      await pedirAusencia(req.db!, req.auth!.tenantId!, {
        personaId: b.personaId ?? req.auth!.userId,
        tipo: b.tipo,
        desde: b.desde,
        hasta: b.hasta,
        nota: b.nota,
        solicitadaPor: req.auth!.userId,
        aprobarYa: puedeAprobar && b.aprobarYa !== false,
        aprobadaPor: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /administracion/ausencias");
  }
});

administracionRouter.post(
  "/ausencias/:id/resolver",
  exigirPermiso("personal.gestionar"),
  async (req, res) => {
    try {
      await resolverAusencia(req.db!, req.auth!.tenantId!, {
        id: req.params.id,
        aprobar: req.body?.aprobar !== false,
        personaId: req.auth!.userId,
      });
      res.json({ ok: true });
    } catch (err) {
      fallo(res, err, "POST /administracion/ausencias/:id/resolver");
    }
  }
);

administracionRouter.get("/credenciales", async (req, res) => {
  try {
    res.json({
      credenciales: await credenciales(
        req.db!,
        req.auth!.tenantId!,
        (req.query.personaId as string) || undefined
      ),
      porVencer: await porVencer(req.db!, req.auth!.tenantId!, Number(req.query.dias ?? 30)),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/credenciales");
  }
});

administracionRouter.post(
  "/credenciales",
  exigirPermiso("personal.gestionar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarCredencial(req.db!, req.auth!.tenantId!, {
          id: b.id,
          personaId: b.personaId,
          tipo: b.tipo,
          numero: b.numero,
          emitidaEl: b.emitidaEl,
          venceEl: b.venceEl,
          archivoClave: b.archivoClave,
          activo: b.activo,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/credenciales");
    }
  }
);

administracionRouter.get("/planilla.xlsx", exigirPermiso("personal.gestionar"), async (req, res) => {
  try {
    const desde = (req.query.desde as string) || new Date().toISOString().slice(0, 8) + "01";
    const hasta = (req.query.hasta as string) || new Date().toISOString().slice(0, 10);
    const filas = await horasParaPlanilla(req.db!, req.auth!.tenantId!, desde, hasta);
    const xlsx = aExcel({
      titulo: "Horas del período",
      subtitulo: `Del ${desde} al ${hasta}`,
      columnas: [
        { clave: "persona", titulo: "Persona" },
        { clave: "dias", titulo: "Días con turno", tipo: "numero" },
        { clave: "horas_turno", titulo: "Horas de turno", tipo: "numero" },
        { clave: "horas_guardia", titulo: "Horas de guardia", tipo: "numero" },
        { clave: "ausencias", titulo: "Ausencias", tipo: "numero" },
      ],
      filas,
      aviso:
        "La planilla y las cargas sociales las calcula el contador: esto son las horas del período, nada más.",
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nombreDeArchivo("planilla", "xlsx")}"`);
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "GET /administracion/planilla.xlsx");
  }
});

// =====================================================================
// COMISIONES
// =====================================================================

administracionRouter.get("/comisiones/reglas", exigirPermiso("comisiones.ver_todas"), async (req, res) => {
  try {
    res.json({ reglas: await reglas(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /administracion/comisiones/reglas");
  }
});

administracionRouter.post(
  "/comisiones/reglas",
  exigirPermiso("comisiones.aprobar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarRegla(req.db!, req.auth!.tenantId!, {
          id: b.id,
          personaId: b.personaId,
          servicioId: b.servicioId,
          familiaId: b.familiaId,
          lineaNegocio: b.lineaNegocio,
          rolEnElCargo: b.rolEnElCargo,
          tipo: b.tipo,
          valor: Number(b.valor),
          base: b.base,
          descontarInsumos: b.descontarInsumos,
          vigenteDesde: b.vigenteDesde,
          vigenteHasta: b.vigenteHasta,
          activo: b.activo,
          personaQueRegistra: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/comisiones/reglas");
    }
  }
);

/**
 * Las liquidaciones.
 *
 * CADA PERSONA VE LAS SUYAS. Quien tiene `comisiones.ver_todas` las ve
 * todas; el resto, con `comisiones.ver_propias`, solo las propias — y el
 * filtro se impone acá, no en la pantalla.
 */
administracionRouter.get("/comisiones/liquidaciones", async (req, res) => {
  try {
    const todas = tienePermiso(req, "comisiones.ver_todas");
    if (!todas && !tienePermiso(req, "comisiones.ver_propias")) {
      return res.status(403).json({
        error: "No tenés permiso para ver comisiones.",
        permisoFaltante: "comisiones.ver_propias",
      });
    }
    res.json({
      liquidaciones: await liquidaciones(req.db!, req.auth!.tenantId!, {
        personaId: todas ? ((req.query.personaId as string) || undefined) : undefined,
        soloPropias: todas ? undefined : req.auth!.userId,
      }),
      puedeVerTodas: todas,
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/comisiones/liquidaciones");
  }
});

administracionRouter.get("/comisiones/liquidaciones/:id", async (req, res) => {
  try {
    const detalle = await detalleDeLiquidacion(req.db!, req.auth!.tenantId!, req.params.id);
    // La de otra persona solo la ve quien puede verlas todas.
    if (
      detalle.liquidacion.persona_id !== req.auth!.userId &&
      !tienePermiso(req, "comisiones.ver_todas")
    ) {
      return res.status(403).json({ error: "Esa liquidación es de otra persona." });
    }
    res.json(detalle);
  } catch (err) {
    fallo(res, err, "GET /administracion/comisiones/liquidaciones/:id");
  }
});

administracionRouter.post(
  "/comisiones/borrador",
  exigirPermiso("comisiones.aprobar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.json(
        await generarBorrador(req.db!, req.auth!.tenantId!, {
          personaId: b.personaId,
          desde: b.desde,
          hasta: b.hasta,
          personaQueGenera: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/comisiones/borrador");
    }
  }
);

administracionRouter.get(
  "/comisiones/vista-previa",
  exigirPermiso("comisiones.ver_todas"),
  async (req, res) => {
    try {
      res.json(
        await calcularBorrador(
          req.db!,
          req.auth!.tenantId!,
          req.query.personaId as string,
          req.query.desde as string,
          req.query.hasta as string
        )
      );
    } catch (err) {
      fallo(res, err, "GET /administracion/comisiones/vista-previa");
    }
  }
);

administracionRouter.post(
  "/comisiones/liquidaciones/:id/ajuste",
  exigirPermiso("comisiones.aprobar"),
  async (req, res) => {
    try {
      await ajustar(req.db!, req.auth!.tenantId!, {
        liquidacionId: req.params.id,
        descripcion: req.body?.descripcion ?? "Ajuste",
        monto: Number(req.body?.monto),
        motivo: req.body?.motivo ?? "",
      });
      res.json({ ok: true });
    } catch (err) {
      fallo(res, err, "POST /administracion/comisiones/liquidaciones/:id/ajuste");
    }
  }
);

administracionRouter.post(
  "/comisiones/liquidaciones/:id/aprobar",
  exigirPermiso("comisiones.aprobar"),
  async (req, res) => {
    try {
      res.json(
        await aprobar(req.db!, req.auth!.tenantId!, {
          liquidacionId: req.params.id,
          personaId: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/comisiones/liquidaciones/:id/aprobar");
    }
  }
);

administracionRouter.get(
  "/comisiones/ajustes-pendientes/:personaId",
  exigirPermiso("comisiones.ver_todas"),
  async (req, res) => {
    try {
      res.json({
        ajustes: await ajustesPendientes(req.db!, req.auth!.tenantId!, req.params.personaId),
      });
    } catch (err) {
      fallo(res, err, "GET /administracion/comisiones/ajustes-pendientes/:id");
    }
  }
);

administracionRouter.post(
  "/comisiones/liquidaciones/:id/aplicar-ajustes",
  exigirPermiso("comisiones.aprobar"),
  async (req, res) => {
    try {
      res.json(
        await aplicarAjustesPendientes(req.db!, req.auth!.tenantId!, {
          liquidacionId: req.params.id,
          personaId: req.body?.personaId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/comisiones/liquidaciones/:id/aplicar-ajustes");
    }
  }
);

// =====================================================================
// CUMPLIMIENTO
// =====================================================================

administracionRouter.get("/cumplimiento/permisos", async (req, res) => {
  try {
    res.json({
      permisos: await permisosDeCumplimiento(req.db!, req.auth!.tenantId!, req.query.todos === "1"),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/cumplimiento/permisos");
  }
});

administracionRouter.post(
  "/cumplimiento/permisos",
  exigirPermiso("cumplimiento.gestionar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarPermiso(req.db!, req.auth!.tenantId!, {
          id: b.id,
          nombre: b.nombre,
          organismo: b.organismo,
          numero: b.numero,
          emitidoEl: b.emitidoEl,
          venceEl: b.venceEl,
          diasAviso: b.diasAviso === undefined ? undefined : Number(b.diasAviso),
          responsableId: b.responsableId,
          archivoClave: b.archivoClave,
          fuenteConfirmada: b.fuenteConfirmada,
          activo: b.activo,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/cumplimiento/permisos");
    }
  }
);

administracionRouter.get("/controlados/libro", exigirPermiso("controlados.registrar"), async (req, res) => {
  try {
    const desde = (req.query.desde as string) || new Date().toISOString().slice(0, 8) + "01";
    const hasta = (req.query.hasta as string) || new Date().toISOString().slice(0, 10);
    res.json({
      asientos: await libroDeControlados(
        req.db!,
        req.auth!.tenantId!,
        desde,
        hasta,
        (req.query.productoId as string) || undefined
      ),
      saldos: await saldosDeControlados(req.db!, req.auth!.tenantId!, hasta),
      cierres: await cierresDeControlados(req.db!, req.auth!.tenantId!),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/controlados/libro");
  }
});

administracionRouter.post(
  "/controlados/cerrar",
  exigirPermiso("controlados.firmar_cierre"),
  async (req, res) => {
    try {
      res.status(201).json(
        await cerrarLibro(req.db!, req.auth!.tenantId!, {
          desde: req.body?.desde,
          hasta: req.body?.hasta,
          regenteId: req.auth!.userId,
          observaciones: req.body?.observaciones,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/controlados/cerrar");
    }
  }
);

administracionRouter.get("/desechos", exigirPermiso("cumplimiento.gestionar"), async (req, res) => {
  try {
    res.json({
      desechos: await desechos(req.db!, req.auth!.tenantId!, (req.query.desde as string) || undefined),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/desechos");
  }
});

administracionRouter.post(
  "/desechos",
  exigirPermiso("cumplimiento.gestionar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(201).json(
        await registrarDesecho(req.db!, req.auth!.tenantId!, {
          fecha: b.fecha,
          tipo: b.tipo,
          pesoKg: b.pesoKg === undefined ? undefined : Number(b.pesoKg),
          volumenL: b.volumenL === undefined ? undefined : Number(b.volumenL),
          gestor: b.gestor,
          gestorAutorizacion: b.gestorAutorizacion,
          archivoClave: b.archivoClave,
          personaId: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/desechos");
    }
  }
);

// =====================================================================
// AUDITORÍA
// =====================================================================

administracionRouter.get("/auditoria", exigirPermiso("auditoria.ver"), async (req, res) => {
  try {
    res.json({
      eventos: await eventos(req.db!, req.auth!.tenantId!, {
        desde: (req.query.desde as string) || undefined,
        hasta: (req.query.hasta as string) || undefined,
        personaId: (req.query.personaId as string) || undefined,
        modulo: (req.query.modulo as string) || undefined,
        tipo: (req.query.tipo as string) || undefined,
        entidadId: (req.query.entidadId as string) || undefined,
        limite: req.query.limite ? Number(req.query.limite) : undefined,
      }),
      tipos: await tiposDeEvento(req.db!, req.auth!.tenantId!),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/auditoria");
  }
});

administracionRouter.get("/auditoria.xlsx", exigirPermiso("auditoria.ver"), async (req, res) => {
  try {
    const filas = await eventos(req.db!, req.auth!.tenantId!, {
      desde: (req.query.desde as string) || undefined,
      hasta: (req.query.hasta as string) || undefined,
      limite: 1000,
    });
    const xlsx = aExcel({
      titulo: "Auditoría",
      subtitulo: `Del ${req.query.desde ?? "inicio"} al ${req.query.hasta ?? "hoy"}`,
      columnas: [
        { clave: "cuando", titulo: "Cuándo", tipo: "fecha" },
        { clave: "quien", titulo: "Quién" },
        { clave: "modulo", titulo: "Módulo" },
        { clave: "tipo", titulo: "Qué pasó" },
        { clave: "sobre", titulo: "Sobre" },
        { clave: "valor_anterior", titulo: "Antes" },
        { clave: "valor_nuevo", titulo: "Después" },
        { clave: "detalle", titulo: "Detalle" },
      ],
      // El tipo de la tabla exportable pide filas genéricas; los eventos
      // son un tipo cerrado y por eso se ensanchan acá.
      filas: filas as unknown as Array<Record<string, unknown>>,
    });
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${nombreDeArchivo("auditoria", "xlsx")}"`);
    res.send(xlsx);
  } catch (err) {
    fallo(res, err, "GET /administracion/auditoria.xlsx");
  }
});

// =====================================================================
// PLANTILLAS DE DOCUMENTOS Y PROCEDIMIENTOS
// =====================================================================

administracionRouter.get("/plantillas-documento", async (req, res) => {
  try {
    res.json({
      plantillas: await plantillas(req.db!, req.auth!.tenantId!, req.query.todas === "1"),
      variables: VARIABLES,
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/plantillas-documento");
  }
});

administracionRouter.post(
  "/plantillas-documento",
  exigirPermiso("catalogos.editar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarPlantilla(req.db!, req.auth!.tenantId!, {
          id: b.id,
          tipo: b.tipo ?? "consentimiento",
          titulo: b.titulo,
          cuerpo: b.cuerpo,
          activo: b.activo,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/plantillas-documento");
    }
  }
);

administracionRouter.post("/plantillas-documento/revisar", async (req, res) => {
  res.json({ desconocidas: variablesDesconocidas(req.body?.cuerpo ?? "") });
});

/** El PDF, desde el expediente. */
administracionRouter.get("/plantillas-documento/:id/pdf", async (req, res) => {
  try {
    const { buffer, titulo } = await generarPdf(req.db!, req.auth!.tenantId!, {
      plantillaId: req.params.id,
      pacienteId: req.query.pacienteId as string,
      medicoId: (req.query.medicoId as string) || req.auth!.userId,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${titulo.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}.pdf"`
    );
    res.send(buffer);
  } catch (err) {
    fallo(res, err, "GET /administracion/plantillas-documento/:id/pdf");
  }
});

administracionRouter.get("/procedimientos", async (req, res) => {
  try {
    res.json({
      procedimientos: await procedimientos(req.db!, req.auth!.tenantId!, {
        categoria: (req.query.categoria as string) || undefined,
        // Cada quien ve los suyos: un protocolo marcado para farmacia no
        // tiene por qué aparecerle al médico.
        rol: (req.query.rol as string) || undefined,
        incluirInactivos: req.query.todos === "1",
      }),
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/procedimientos");
  }
});

administracionRouter.get("/procedimientos/:id", async (req, res) => {
  try {
    res.json({
      procedimiento: await procedimiento(req.db!, req.auth!.tenantId!, req.params.id),
      lecturas: tienePermiso(req, "procedimientos.editar")
        ? await lecturas(req.db!, req.auth!.tenantId!, req.params.id)
        : [],
    });
  } catch (err) {
    fallo(res, err, "GET /administracion/procedimientos/:id");
  }
});

administracionRouter.post(
  "/procedimientos",
  exigirPermiso("procedimientos.editar"),
  async (req, res) => {
    try {
      const b = req.body ?? {};
      res.status(b.id ? 200 : 201).json(
        await guardarProcedimiento(req.db!, req.auth!.tenantId!, {
          id: b.id,
          categoria: b.categoria,
          titulo: b.titulo,
          contenido: b.contenido,
          archivoClave: b.archivoClave,
          version: b.version,
          vigenteDesde: b.vigenteDesde,
          roles: b.roles,
          exigeLectura: b.exigeLectura,
          activo: b.activo,
          personaId: req.auth!.userId,
        })
      );
    } catch (err) {
      fallo(res, err, "POST /administracion/procedimientos");
    }
  }
);

administracionRouter.post("/procedimientos/:id/leido", async (req, res) => {
  try {
    res.json(
      await confirmarLectura(req.db!, req.auth!.tenantId!, {
        procedimientoId: req.params.id,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "POST /administracion/procedimientos/:id/leido");
  }
});
