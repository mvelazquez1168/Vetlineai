import { Request, Response, Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso } from "../permisos";
import {
  asignarRoles,
  CambioDeRolesImposible,
  desactivarPersona,
  personasDeLaClinica,
  reactivarPersona,
} from "../clinica/personas";
import {
  guardarPolitica,
  historialDePolitica,
  politicasDeLaClinica,
  PoliticaInvalida,
} from "../clinica/politicas";
import { matrizDeRoles, guardarPermisoDeRol } from "../clinica/roles";
import {
  borrarExcepcion,
  excepcionesDeLaClinica,
  guardarExcepcion,
  guardarHorarioDelDia,
  horarioDeLaClinica,
} from "../clinica/horarios";
import {
  ConfiguracionInvalida,
  desactivarTipoDeCita,
  guardarNumeracion,
  guardarTipoDeCita,
  numeraciones,
  tiposDeCita,
} from "../clinica/agendaConfig";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN DE LA CLÍNICA — prompt 04.
//
// Un router propio y no más rutas dentro de `admin.routes.ts`, que ya
// tiene 2 000 líneas y mezcla la administración de la clínica con la
// gestión de agentes y la suscripción.
//
// TODAS LAS RUTAS DE ESCRITURA PASAN POR `exigirPermiso`, que resuelve
// contra la base. Las de lectura de la matriz no: saber qué puede hacer
// cada rol no es información sensible y es lo que permite que una
// pantalla explique por qué un botón no está.
// ---------------------------------------------------------------------

export const clinicaRouter = Router();
clinicaRouter.use(authenticate, withTenantClient);

function fallo(res: Response, err: unknown, donde: string) {
  if (
    err instanceof CambioDeRolesImposible ||
    err instanceof PoliticaInvalida ||
    err instanceof ConfiguracionInvalida
  ) {
    return res.status(409).json({ error: err.message });
  }
  console.error(donde, err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Error inesperado." });
}

// --- Personas ---------------------------------------------------------
// VER EL EQUIPO ES DE TODO EL EQUIPO. Cambiarle los roles a alguien o
// desactivarlo, no: esas tres rutas sí llevan `personas.administrar`.
clinicaRouter.get("/personas", async (req, res) => {
  try {
    res.json({ personas: await personasDeLaClinica(req.db!) });
  } catch (err) {
    fallo(res, err, "GET /clinica/personas");
  }
});

clinicaRouter.put(
  "/personas/:id/roles",
  exigirPermiso("personas.administrar"),
  async (req: Request, res: Response) => {
    try {
      const roles = (req.body?.roles ?? []) as string[];
      res.json(await asignarRoles(req.db!, req.params.id, roles, req.auth!.userId));
    } catch (err) {
      fallo(res, err, "PUT /clinica/personas/:id/roles");
    }
  }
);

clinicaRouter.post(
  "/personas/:id/desactivar",
  exigirPermiso("personas.administrar"),
  async (req, res) => {
    try {
      res.json(await desactivarPersona(req.db!, req.params.id, req.auth!.userId));
    } catch (err) {
      fallo(res, err, "POST /clinica/personas/:id/desactivar");
    }
  }
);

clinicaRouter.post(
  "/personas/:id/reactivar",
  exigirPermiso("personas.administrar"),
  async (req, res) => {
    try {
      const roles = (req.body?.roles ?? []) as string[];
      res.json(await reactivarPersona(req.db!, req.params.id, roles, req.auth!.userId));
    } catch (err) {
      fallo(res, err, "POST /clinica/personas/:id/reactivar");
    }
  }
);

// --- Roles y permisos -------------------------------------------------
clinicaRouter.get("/roles", async (req, res) => {
  try {
    res.json(await matrizDeRoles(req.db!, req.auth!.tenantId!));
  } catch (err) {
    fallo(res, err, "GET /clinica/roles");
  }
});

clinicaRouter.put("/roles/permiso", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json(
      await guardarPermisoDeRol(req.db!, req.auth!.tenantId!, {
        rol: b.rol,
        permiso: b.permiso,
        concedido: b.concedido === true,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "PUT /clinica/roles/permiso");
  }
});

/** Lo que el frontend necesita para dibujar el menú y los botones. */
clinicaRouter.get("/mis-permisos", async (req, res) => {
  res.json({
    roles: req.auth!.roles ?? [],
    permisos: [...(req.auth!.permisos ?? [])],
  });
});

// --- Políticas --------------------------------------------------------
clinicaRouter.get("/politicas", async (req, res) => {
  try {
    res.json({ politicas: await politicasDeLaClinica(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /clinica/politicas");
  }
});

clinicaRouter.put("/politicas", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    res.json(
      await guardarPolitica(req.db!, req.auth!.tenantId!, {
        clave: b.clave,
        valor: String(b.valor),
        rol: b.rol ?? null,
        personaId: req.auth!.userId,
      })
    );
  } catch (err) {
    fallo(res, err, "PUT /clinica/politicas");
  }
});

clinicaRouter.get("/politicas/:clave/historial", async (req, res) => {
  try {
    res.json({
      historial: await historialDePolitica(req.db!, req.auth!.tenantId!, req.params.clave),
    });
  } catch (err) {
    fallo(res, err, "GET /clinica/politicas/:clave/historial");
  }
});

// --- Horario de la clínica, feriados y bloqueos -----------------------
//
// LAS LECTURAS NO LLEVAN PERMISO: la recepción tiene que poder ver el
// horario y los feriados para explicarle al cliente por qué no hay turno
// el 25. Configurarlos sí lleva `clinica.configurar`.
clinicaRouter.get("/horario", async (req, res) => {
  try {
    res.json({
      horario: await horarioDeLaClinica(req.db!, req.auth!.tenantId!),
      excepciones: await excepcionesDeLaClinica(
        req.db!,
        req.auth!.tenantId!,
        (req.query.desde as string) || undefined
      ),
    });
  } catch (err) {
    fallo(res, err, "GET /clinica/horario");
  }
});

clinicaRouter.put("/horario/:dia", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    await guardarHorarioDelDia(req.db!, req.auth!.tenantId!, {
      diaSemana: Number(req.params.dia),
      bloques: b.bloques ?? [],
      abierto: b.abierto === true,
    });
    res.json({ horario: await horarioDeLaClinica(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    // Un bloque al revés es un dedo que se resbaló, no un error del
    // sistema: se contesta 409 con el texto tal cual para mostrarlo.
    if (err instanceof Error && err.message.includes("termina antes de empezar")) {
      return res.status(409).json({ error: err.message });
    }
    fallo(res, err, "PUT /clinica/horario/:dia");
  }
});

clinicaRouter.post("/excepciones", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    if (!b.nombre?.trim() || !b.desde) {
      return res.status(400).json({ error: "Hacen falta el nombre y la fecha." });
    }
    const guardada = await guardarExcepcion(req.db!, req.auth!.tenantId!, {
      id: b.id,
      tipo: b.tipo ?? "bloqueo",
      nombre: b.nombre.trim(),
      desde: b.desde,
      hasta: b.hasta || b.desde,
      horaDesde: b.horaDesde || null,
      horaHasta: b.horaHasta || null,
      medicoId: b.medicoId || null,
      bloquea: b.bloquea,
    });
    res.status(b.id ? 200 : 201).json(guardada);
  } catch (err) {
    fallo(res, err, "POST /clinica/excepciones");
  }
});

clinicaRouter.delete(
  "/excepciones/:id",
  exigirPermiso("clinica.configurar"),
  async (req, res) => {
    try {
      await borrarExcepcion(req.db!, req.params.id);
      res.json({ borrada: true });
    } catch (err) {
      fallo(res, err, "DELETE /clinica/excepciones/:id");
    }
  }
);

// --- Tipos de cita ----------------------------------------------------
clinicaRouter.get("/tipos-cita", async (req, res) => {
  try {
    res.json({
      tipos: await tiposDeCita(req.db!, req.auth!.tenantId!, req.query.todos === "1"),
    });
  } catch (err) {
    fallo(res, err, "GET /clinica/tipos-cita");
  }
});

clinicaRouter.post("/tipos-cita", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    const b = req.body ?? {};
    const guardado = await guardarTipoDeCita(req.db!, req.auth!.tenantId!, {
      id: b.id,
      nombre: b.nombre,
      duracionMinutos: Number(b.duracionMinutos),
      color: b.color,
      salaId: b.salaId,
      lineaNegocio: b.lineaNegocio,
      servicioId: b.servicioId,
      activo: b.activo,
      orden: b.orden,
    });
    res.status(b.id ? 200 : 201).json(guardado);
  } catch (err) {
    fallo(res, err, "POST /clinica/tipos-cita");
  }
});

clinicaRouter.delete(
  "/tipos-cita/:id",
  exigirPermiso("clinica.configurar"),
  async (req, res) => {
    try {
      await desactivarTipoDeCita(req.db!, req.auth!.tenantId!, req.params.id);
      res.json({ desactivado: true });
    } catch (err) {
      fallo(res, err, "DELETE /clinica/tipos-cita/:id");
    }
  }
);

// --- Numeraciones -----------------------------------------------------
clinicaRouter.get("/numeraciones", async (req, res) => {
  try {
    res.json({ numeraciones: await numeraciones(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "GET /clinica/numeraciones");
  }
});

clinicaRouter.put("/numeraciones/:documento", exigirPermiso("clinica.configurar"), async (req, res) => {
  try {
    await guardarNumeracion(req.db!, req.auth!.tenantId!, {
      documento: req.params.documento,
      prefijo: req.body?.prefijo,
      digitos: req.body?.digitos === undefined ? undefined : Number(req.body.digitos),
    });
    res.json({ numeraciones: await numeraciones(req.db!, req.auth!.tenantId!) });
  } catch (err) {
    fallo(res, err, "PUT /clinica/numeraciones/:documento");
  }
});
