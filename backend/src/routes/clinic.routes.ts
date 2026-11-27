import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { soloPersonalDeLaClinica } from "../permisos";
import { ETIQUETA_MODULO, MODULOS, modulosHabilitados, requiereModulo } from "../tenantModulos";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 2 — raíz de Vetline Clinic.
//
// Por qué existe ya, con un solo endpoint: el gate `requiereModulo()` sin
// ningún consumidor es un mecanismo que nadie probó. Los módulos reales
// (inventario, ventas, facturación, campañas) llegan en los prompts 04 en
// adelante; hasta entonces este router es la única ruta gateada, y es la
// que demuestra que el 403 funciona.
//
// `GET /estado` queda igual cuando lleguen los módulos reales: es la
// pantalla de aterrizaje de Vetline Clinic, lo que la clínica ve al
// entrar a la sección. Hoy muestra qué módulos tiene y qué le falta.
//
// Gateado por `expediente` y no por "cualquier módulo": el expediente es
// el módulo base de Vetline Clinic (el paciente es el eje, ver guía
// rectora §3), así que una clínica sin expediente no tiene la sección.
// Ojo: la FICHA del paciente (`/api/pacientes/*`) NO está gateada — es
// núcleo de Vetline Ai, que también la necesita. Lo gateado es la
// sección de gestión, no el expediente del paciente en sí.
// ---------------------------------------------------------------------
export const clinicRouter = Router();

clinicRouter.use(authenticate, withTenantClient);

clinicRouter.use(soloPersonalDeLaClinica());

clinicRouter.get("/estado", requiereModulo("expediente"), async (req, res) => {
  try {
    const habilitados = await modulosHabilitados(req.db!, req.auth!.tenantId!);
    res.json({
      modulos: MODULOS.map((modulo) => ({
        modulo,
        etiqueta: ETIQUETA_MODULO[modulo],
        habilitado: habilitados.includes(modulo),
      })),
    });
  } catch (err) {
    console.error("GET /clinic/estado", err);
    res.status(500).json({ error: "Error al obtener el estado de los módulos." });
  }
});
