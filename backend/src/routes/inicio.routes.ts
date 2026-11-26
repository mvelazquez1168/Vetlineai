import { Router } from "express";
import { authenticate, withTenantClient } from "../middleware/auth";

// ---------------------------------------------------------------------
// LOS INDICADORES DEL INICIO Y DEL MENÚ — prompt 01c, secciones 1 y 5.
//
// UNA SOLA CONSULTA AGREGADA, que es lo que el prompt pide: «si un
// indicador requiere un endpoint nuevo, es una sola consulta agregada
// que respeta RLS». Siete subconsultas en un `SELECT` y no siete viajes:
// esto lo pide el menú en cada carga de pantalla.
//
// CADA NÚMERO SALE DE DATOS REALES. Los que el prompt nombra y hoy no
// tienen de dónde salir se omiten y quedan dichos en el informe, en vez
// de inventarse: «confirmadas por WhatsApp» no existe porque el canal de
// WhatsApp todavía no envía nada (el prompt 03 dejó el proveedor
// simulado), y un número que siempre dice cero es peor que no estar.
//
// Los módulos apagados devuelven `null`, no cero: cero significa «no hay
// ninguna aprobación pendiente» y null significa «esta clínica no usa
// caja». La diferencia importa porque el menú muestra el contador solo
// cuando hay algo que contar.
// ---------------------------------------------------------------------

export const inicioRouter = Router();

inicioRouter.use(authenticate, withTenantClient);

inicioRouter.get("/indicadores", async (req, res) => {
  try {
    const modulos = await req.db!.query<{ modulo: string }>(
      // `tenant_modulos` usa `estado`, no una bandera booleana: un
      // modulo puede estar 'habilitado', 'deshabilitado' o en otro
      // estado del ciclo. Se pregunta por el valor real.
      `SELECT modulo FROM tenant_modulos WHERE tenant_id = $1 AND estado = 'habilitado'`,
      [req.auth!.tenantId]
    );
    const tiene = (m: string) => modulos.rows.some((r) => r.modulo === m);

    const r = await req.db!.query<{
      citas_hoy: number;
      citas_por_confirmar: number;
      en_sala_de_espera: number;
      casos_pendientes: number;
      pacientes_activos: number;
      vacunas_por_vencer: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM citas
           WHERE fecha = CURRENT_DATE AND estado NOT IN ('cancelada')) AS citas_hoy,
         (SELECT count(*)::int FROM citas
           WHERE fecha = CURRENT_DATE AND estado = 'programada') AS citas_por_confirmar,
         -- «En sala de espera» es el estado registrada: el paciente
         -- llegó y todavía no entró a consulta. El nombre del estado es
         -- de la agenda y el del indicador es de quien atiende.
         (SELECT count(*)::int FROM citas
           WHERE fecha = CURRENT_DATE AND estado = 'registrada') AS en_sala_de_espera,
         (SELECT count(*)::int FROM casos
           WHERE estado NOT IN ('completado')) AS casos_pendientes,
         (SELECT count(*)::int FROM pacientes WHERE estado = 'activo') AS pacientes_activos,
         (SELECT count(*)::int FROM cuidados_preventivos cp
           JOIN pacientes p ON p.id = cp.paciente_id AND p.estado = 'activo'
          WHERE cp.tipo = 'vacunacion'
            AND cp.fecha_proxima_recomendada IS NOT NULL
            AND cp.fecha_proxima_recomendada <= CURRENT_DATE + 30) AS vacunas_por_vencer`
    );

    // Caja: solo si el módulo está habilitado. Las tablas existen igual
    // —el esquema es compartido— pero preguntar por ellas en una clínica
    // que no usa caja devolvería ceros que parecen información.
    let caja: Record<string, number | string | null> | null = null;
    if (tiene("ventas")) {
      const c = await req.db!.query<{
        sesion_abierta: string | null;
        cobrado_hoy: string;
        cobros_hoy: number;
        cuentas_abiertas: number;
        aprobaciones_pendientes: number;
      }>(
        `SELECT
           (SELECT id::text FROM vta_sesiones_caja WHERE estado = 'abierta'
             ORDER BY abierta_en DESC LIMIT 1) AS sesion_abierta,
           (SELECT COALESCE(sum(total), 0)::text FROM vta_cobros
             WHERE estado = 'aplicado' AND creado_en::date = CURRENT_DATE) AS cobrado_hoy,
           (SELECT count(*)::int FROM vta_cobros
             WHERE estado = 'aplicado' AND creado_en::date = CURRENT_DATE) AS cobros_hoy,
           (SELECT count(*)::int FROM vta_cuentas WHERE estado = 'abierta') AS cuentas_abiertas,
           (SELECT count(*)::int FROM vta_aprobaciones
             WHERE estado = 'pendiente') AS aprobaciones_pendientes`
      );
      caja = c.rows[0];
    }

    let inventario: Record<string, number | string | null> | null = null;
    if (tiene("inventario")) {
      const i = await req.db!.query<{
        bajo_minimo: number;
        vencen_60_dias: number;
        ajustes_por_aprobar: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM (
              SELECT p.id, p.minimo, COALESCE(sum(l.cantidad), 0) AS existencia
                FROM inv_productos p
                LEFT JOIN inv_lotes l ON l.producto_id = p.id
               WHERE p.activo AND p.minimo IS NOT NULL AND p.minimo > 0
               GROUP BY p.id, p.minimo
             ) x WHERE x.existencia < x.minimo) AS bajo_minimo,
           (SELECT count(*)::int FROM inv_lotes
             WHERE cantidad > 0 AND vencimiento IS NOT NULL
               AND vencimiento <= CURRENT_DATE + 60) AS vencen_60_dias,
           (SELECT count(*)::int FROM inv_ajustes
             WHERE estado = 'pendiente') AS ajustes_por_aprobar`
      );
      inventario = i.rows[0];
    }

    res.json({ ...r.rows[0], caja, inventario });
  } catch (err) {
    console.error("GET /inicio/indicadores", err);
    res.status(500).json({ error: "Error al calcular los indicadores." });
  }
});
