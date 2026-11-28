import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";
import { exigirPermiso, soloPersonalDeLaClinica } from "../permisos";

// ---------------------------------------------------------------------
// EQUIPOS DE LA CLÍNICA — el rayos X, el ecógrafo, el equipo dental.
//
// La tabla `agenda_equipos` existe desde la migración 166 (prompt 05) y
// la usa el motor de disponibilidad: un tipo de cita puede exigir un
// equipo, y si los que hay están ocupados, el hueco no se ofrece. Lo que
// NO existía era ninguna forma de cargar uno: la tabla estaba vacía y
// la función que la lee no podía encontrar nada. Punto 2.2 de la
// revisión del 2026-11-27 («Salas y equipos»).
//
// `cantidad` es lo que hace útil esto: una clínica con DOS ecógrafos
// puede agendar dos ecografías a la misma hora. Con uno solo, la
// segunda no se ofrece. Por eso no es una lista de nombres.
//
// SE DESACTIVA, NO SE BORRA: un equipo borrado se lleva por delante las
// citas pasadas que lo usaron (`cita_equipos`). Desactivado deja de
// ofrecerse y la historia queda.
// ---------------------------------------------------------------------

export const equiposRouter = Router();

equiposRouter.use(authenticate, withTenantClient);
equiposRouter.use(soloPersonalDeLaClinica());

/** Verlos los ve todo el personal: la agenda necesita saber qué hay. */
equiposRouter.get("/", async (req, res) => {
  try {
    const incluirInactivos = req.query.inactivos === "1";
    const r = await req.db!.query(
      `SELECT e.id, e.nombre, e.categoria, e.cantidad, e.activo, e.creado_en,
              -- En cuántos tipos de cita se exige: borrar o desactivar
              -- uno que la agenda está usando tiene consecuencias, y la
              -- pantalla las muestra antes.
              (SELECT count(*) FROM tipo_cita_equipos te WHERE te.equipo_id = e.id)::int
                AS tipos_de_cita
         FROM agenda_equipos e
        WHERE e.tenant_id = $1 ${incluirInactivos ? "" : "AND e.activo"}
        ORDER BY e.activo DESC, e.nombre`,
      [req.auth!.tenantId]
    );
    res.json({ equipos: r.rows });
  } catch (err) {
    console.error("GET /equipos", err);
    res.status(500).json({ error: "No se pudieron listar los equipos." });
  }
});

equiposRouter.post("/", exigirPermiso("clinica.configurar"), async (req, res) => {
  const { nombre, categoria, cantidad } = req.body as {
    nombre?: string;
    categoria?: string;
    cantidad?: number;
  };
  if (!nombre?.trim()) return res.status(400).json({ error: "Falta el nombre del equipo." });
  const n = Number(cantidad ?? 1);
  if (!Number.isInteger(n) || n < 1) {
    return res.status(400).json({
      error: "La cantidad es cuántos hay de este equipo: un entero de 1 para arriba.",
    });
  }
  try {
    const r = await req.db!.query(
      `INSERT INTO agenda_equipos (tenant_id, nombre, categoria, cantidad)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.auth!.tenantId, nombre.trim(), categoria?.trim() || null, n]
    );
    res.status(201).json({ equipo: r.rows[0] });
  } catch (err) {
    console.error("POST /equipos", err);
    res.status(500).json({ error: "No se pudo crear el equipo." });
  }
});

equiposRouter.put("/:id", exigirPermiso("clinica.configurar"), async (req, res) => {
  const { nombre, categoria, cantidad } = req.body as {
    nombre?: string;
    categoria?: string;
    cantidad?: number;
  };
  if (!nombre?.trim()) return res.status(400).json({ error: "Falta el nombre del equipo." });
  const n = Number(cantidad ?? 1);
  if (!Number.isInteger(n) || n < 1) {
    return res.status(400).json({ error: "La cantidad tiene que ser un entero de 1 para arriba." });
  }
  try {
    const r = await req.db!.query(
      `UPDATE agenda_equipos SET nombre = $2, categoria = $3, cantidad = $4
        WHERE id = $1 AND tenant_id = $5 RETURNING *`,
      [req.params.id, nombre.trim(), categoria?.trim() || null, n, req.auth!.tenantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Ese equipo no existe." });
    res.json({ equipo: r.rows[0] });
  } catch (err) {
    console.error("PUT /equipos/:id", err);
    res.status(500).json({ error: "No se pudo guardar el equipo." });
  }
});

equiposRouter.patch("/:id/activo", exigirPermiso("clinica.configurar"), async (req, res) => {
  const activo = Boolean((req.body as { activo?: boolean })?.activo);
  try {
    const r = await req.db!.query(
      `UPDATE agenda_equipos SET activo = $2 WHERE id = $1 AND tenant_id = $3 RETURNING *`,
      [req.params.id, activo, req.auth!.tenantId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: "Ese equipo no existe." });
    res.json({ equipo: r.rows[0] });
  } catch (err) {
    console.error("PATCH /equipos/:id/activo", err);
    res.status(500).json({ error: "No se pudo cambiar el estado del equipo." });
  }
});
