import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// LO QUE SE ROMPIÓ EN LA PANTALLA, GUARDADO — defecto del 2026-11-27.
//
// La ficha del paciente quedó en blanco y nos enteramos porque alguien
// abrió la consola del navegador y copió el mensaje. Los límites de
// error de la interfaz (`LimiteDeError.tsx`) mandan acá lo que pasó, así
// que la próxima vez el dato está sin depender de eso.
//
// NO HAY PERMISO QUE PEDIR, a propósito: cualquiera con sesión puede
// reportar un error de SU pantalla, igual que cualquiera puede ver un
// error. Exigir un permiso significa que el error de la pantalla de
// permisos no se registra.
//
// EL TOPE ES POR SESIÓN Y ESTÁ EN EL CLIENTE (tres por carga de página):
// un componente que explota en bucle de render podría mandar miles de
// filas por minuto. Acá además se recorta cada campo, que es la defensa
// que no depende del cliente.
// ---------------------------------------------------------------------

export const erroresClienteRouter = Router();

erroresClienteRouter.use(authenticate, withTenantClient);

const recortar = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const limpio = v.trim();
  return limpio ? limpio.slice(0, max) : null;
};

// POST /api/errores-cliente
erroresClienteRouter.post("/", async (req, res) => {
  try {
    const pantalla = recortar(req.body?.pantalla, 300) ?? "(desconocida)";
    const mensaje = recortar(req.body?.mensaje, 1000) ?? "(sin mensaje)";

    await req.db!.query(
      `INSERT INTO errores_cliente
         (tenant_id, persona_id, pantalla, ambito, mensaje, pila, pila_react, agente_usuario)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        req.auth!.tenantId,
        req.auth!.userId,
        pantalla,
        recortar(req.body?.ambito, 120),
        mensaje,
        recortar(req.body?.pila, 8000),
        recortar(req.body?.pilaReact, 8000),
        recortar(req.headers["user-agent"], 500),
      ]
    );

    // Que quede también en el log del servidor: es donde se mira primero
    // cuando alguien avisa «no carga» mientras está pasando.
    console.error(`[interfaz] ${pantalla}${req.body?.ambito ? ` · ${req.body.ambito}` : ""}: ${mensaje}`);

    res.status(201).json({ ok: true });
  } catch (err) {
    // Que falle el registro del error no puede ser un error más: el
    // límite de la interfaz ya está mostrando su mensaje y reintentando
    // acá no se gana nada.
    console.error("[erroresCliente] no se pudo guardar:", err);
    res.status(202).json({ ok: false });
  }
});
