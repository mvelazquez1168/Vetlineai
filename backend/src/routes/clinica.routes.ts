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
  if (err instanceof CambioDeRolesImposible || err instanceof PoliticaInvalida) {
    return res.status(409).json({ error: err.message });
  }
  console.error(donde, err);
  res.status(500).json({ error: err instanceof Error ? err.message : "Error inesperado." });
}

// --- Personas ---------------------------------------------------------
clinicaRouter.get("/personas", exigirPermiso("personas.administrar"), async (req, res) => {
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
