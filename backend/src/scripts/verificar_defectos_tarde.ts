// Defectos de la revisión en el navegador del 2026-11-27 (tarde).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_defectos_tarde.ts
//
// SIN --transpile-only.
//
// LA REGLA DE ESTE PAQUETE, y la razón de que exista: «la API respondía
// bien y las pruebas pasaban, pero lo que ve el usuario no funcionaba».
// Así que cada aserción mira LO QUE USA LA PANTALLA, no la tabla:
//   · el histórico se comprueba en `lineaDeTiempo`, que es de donde lee
//     la pestaña Vacunas, no en `cuidados_preventivos`;
//   · el catálogo se comprueba en `productosParaAtencion`, que es lo que
//     llama el buscador de la receta, y contra el CATÁLOGO REAL cargado.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { registrarHistorico, productosParaAtencion } from "../expediente/preventivos";
import { abrirAtencion, agregarItem, cerrarAtencion, quitarItem } from "../expediente/atencion";
import { lineaDeTiempo } from "../expediente/resumen";
import {
  clasificarEnLote,
  cuantosSinClasificar,
  productosSinClasificar,
  tipoSugerido,
} from "../inventario/clasificacionClinica";
import { COLUMNAS_OPCIONALES, COLUMNAS_PLANTILLA } from "../inventario/importacion";
import { fechaHoyEnZona } from "../fecha";
import { crearInvitacion } from "../invitaciones";
import { buscarUsuarioKeycloakPorEmail, eliminarUsuarioKeycloak } from "../keycloakAdmin";

const API = process.env.API_URL ?? "http://localhost:4000/api";
const PREFIJO = "probe-tarde";
const CLAVE = "ProbeTarde2026!";

const correo = (quien: string) => `${PREFIJO}-${quien}@probe.test`;

/** Un usuario descartable con los roles que se le pidan, por el flujo real. */
async function alta2(
  tenantId: string,
  quien: string,
  nombre: string,
  roles: string[]
): Promise<string> {
  const inv = await crearInvitacion(
    pool,
    tenantId,
    `${PREFIJO} clínica`,
    null,
    correo(quien),
    nombre,
    roles
  );
  if (!inv.ok) throw new Error(`no se pudo invitar a ${quien}: ${inv.motivo}`);
  const r = await fetch(`${API}/invitaciones/${inv.invitacion.token}/aceptar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre,
      colegiatura: roles.includes("medico") ? `VET-${quien.toUpperCase()}` : undefined,
      password: CLAVE,
    }),
  });
  const cuerpo = (await r.json()) as { access_token?: string; error?: string };
  if (!cuerpo.access_token) throw new Error(`sin token para ${quien}: ${cuerpo.error}`);
  return cuerpo.access_token;
}

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

async function limpiar() {
  const descartables = [
    ...["recepcion", "caja", "farmacia", "estetica", "asistente", "contador"].map(
      (r) => `rol-${r}`
    ),
    "perm-recepcion",
    "perm-caja",
  ];
  for (const quien of descartables) {
    const id = await buscarUsuarioKeycloakPorEmail(correo(quien));
    if (id) await eliminarUsuarioKeycloak(id);
  }
  await pool.query(
    `DELETE FROM uso_api WHERE tenant_id IN (SELECT id FROM tenants WHERE nombre LIKE $1)`,
    [`${PREFIJO}%`]
  );
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_defectos_tarde");
  await limpiar();

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa',$2,'CR') RETURNING id`,
      [`${PREFIJO}-clinica`, `${PREFIJO}@probe.test`]
    )
  ).rows[0].id;
  for (const modulo of ["expediente", "inventario", "ventas"]) {
    await pool.query(
      `INSERT INTO tenant_modulos (tenant_id, modulo, estado)
       VALUES ($1,$2,'habilitado') ON CONFLICT DO NOTHING`,
      [tenantId, modulo]
    );
  }

  try {
    // =============================================================
    console.log(["", "=== 1. El registro histórico aparece en la lista ==="].join("\n"));

    const { pacienteId, personaId } = await conAlcanceTenant(tenantId, async (db) => {
      const prop = await db.query<{ id: string }>(
        `INSERT INTO propietarios (tenant_id, nombre, telefono)
         VALUES ($1,'Dueño histórico','88881111') RETURNING id`,
        [tenantId]
      );
      const pac = await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
         VALUES ($1,$2,'Cartilla','Canino',1) RETURNING id`,
        [tenantId, prop.rows[0].id]
      );
      const per = await db.query<{ id: string }>(
        `INSERT INTO personas (tenant_id, nombre, email, es_medico, colegiatura, password_hash)
         VALUES ($1,'Dr. Cartilla',$2,true,'VET-CART','sin-login-probe') RETURNING id`,
        [tenantId, `${PREFIJO}-medico@probe.test`]
      );
      return { pacienteId: pac.rows[0].id, personaId: per.rows[0].id };
    });

    // Una vacuna de hace tres años, cargada de la cartilla del cliente.
    const HACE_TRES_ANIOS = "2023-11-27";
    const historico = await conAlcanceTenant(tenantId, async (db) =>
      registrarHistorico(
        db,
        tenantId,
        {
          pacienteId,
          tipo: "vacunacion",
          nombre: "Polivalente",
          fechaAplicacion: HACE_TRES_ANIOS,
          fechaProxima: "2024-11-27",
          lugar: "Otra clínica",
        },
        personaId
      )
    );
    assert(!!historico.id, "se guarda el registro histórico");

    // LA PRUEBA QUE FALTABA: lo que lee la PESTAÑA, no la tabla.
    const enLaPestana = await conAlcanceTenant(tenantId, async (db) =>
      lineaDeTiempo(db, pacienteId, { tipo: "vacuna" })
    );
    assert(
      enLaPestana.length === 1,
      "y APARECE en la pestaña Vacunas (que lee la línea de tiempo)",
      enLaPestana.length
    );
    assert(
      enLaPestana[0]?.titulo === "Polivalente",
      "con el nombre de lo que se aplicó",
      enLaPestana[0]?.titulo
    );
    assert(
      new Date(enLaPestana[0]!.fecha).toISOString().slice(0, 10) === HACE_TRES_ANIOS,
      "FECHADO EL DÍA DE LA APLICACIÓN, no hoy: una vacuna de 2023 va en 2023",
      `${new Date(enLaPestana[0]!.fecha).toISOString().slice(0, 10)} vs hoy ${fechaHoyEnZona(null)}`
    );
    assert(
      enLaPestana[0]?.historico === true,
      "y marcado como histórico: no lo aplicó esta clínica"
    );

    // La desparasitación, por el mismo camino.
    await conAlcanceTenant(tenantId, async (db) =>
      registrarHistorico(
        db,
        tenantId,
        {
          pacienteId,
          tipo: "desparasitacion",
          nombre: "Bravecto",
          subtipo: "externa",
          fechaAplicacion: "2025-06-01",
          fechaProxima: "2025-09-01",
        },
        personaId
      )
    );
    const despara = await conAlcanceTenant(tenantId, async (db) =>
      lineaDeTiempo(db, pacienteId, { tipo: "desparasitacion" })
    );
    assert(
      despara.length === 1 && despara[0].titulo === "Bravecto",
      "la desparasitación histórica también aparece en SU pestaña",
      despara.map((d) => d.titulo)
    );
    assert(
      despara[0]?.detalle === "externa",
      "con su subtipo, que sale de cuidados_preventivos y no del evento",
      despara[0]?.detalle
    );

    // El relleno de la migración 171 es idempotente: no duplica.
    await pool.query(
      `INSERT INTO crm_interacciones
         (tenant_id, propietario_id, paciente_id, tipo, ocurrido_en,
          origen_tabla, origen_id, persona_id, resumen)
       SELECT cp.tenant_id, pac.propietario_id, cp.paciente_id,
              CASE WHEN cp.tipo = 'vacunacion' THEN 'vacuna_aplicada' ELSE 'desparasitacion' END,
              cp.fecha_aplicacion::timestamptz, 'cuidados_preventivos', cp.id,
              cp.registrado_por, COALESCE(cp.vacuna, cp.producto_desparasitacion)
         FROM cuidados_preventivos cp
         JOIN pacientes pac ON pac.id = cp.paciente_id
        WHERE cp.tenant_id = $1 AND cp.atencion_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM crm_interacciones i
             WHERE i.origen_tabla = 'cuidados_preventivos' AND i.origen_id = cp.id
               AND i.tipo IN ('vacuna_aplicada','desparasitacion'))
       ON CONFLICT DO NOTHING`,
      [tenantId]
    );
    const trasRelleno = await conAlcanceTenant(tenantId, async (db) =>
      lineaDeTiempo(db, pacienteId, { tipo: "vacuna" })
    );
    assert(
      trasRelleno.length === 1,
      "correr el relleno de nuevo NO duplica el evento (es idempotente)",
      trasRelleno.length
    );

    // Todo lo que escribe en cuidados_preventivos deja su evento.
    const sinEvento = await conAlcanceTenant(tenantId, async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM cuidados_preventivos cp
          WHERE cp.tenant_id = $1 AND cp.atencion_id IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM crm_interacciones i
               WHERE i.origen_tabla = 'cuidados_preventivos' AND i.origen_id = cp.id)`,
        [tenantId]
      );
      return Number(r.rows[0].n);
    });
    assert(sinEvento === 0, "no queda ningún preventivo sin su evento", sinEvento);

    // =============================================================
    console.log(["", "=== 3. La receta encuentra los productos ==="].join("\n"));

    // Productos de prueba que imitan lo que hay cargado de verdad: casi
    // todos sin tipo clínico, con nombre y código y nada más.
    const ids = await conAlcanceTenant(tenantId, async (db) => {
      const creados: Record<string, string> = {};
      const bodega = await db.query<{ id: string }>(
        `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
         VALUES ($1,'PRB','Bodega de prueba',true) RETURNING id`,
        [tenantId]
      );
      const productos: Array<[string, string, string | null, string | null, string | null]> = [
        // nombre, codigo, tipo_clinico, principio_activo, codigo_barras
        ["Amoxicilina 500 mg", "MED-001", "medicamento", "amoxicilina", "7501111111111"],
        ["Acedan 50 ml frasco (Acepromacina)", "1349", null, null, "7502222222222"],
        ["Vanguard Plus 5", "VAC-010", null, null, "7503333333333"],
        ["BRAVECTO PERRO 20-40 KG", "ANT-020", null, null, "7504444444444"],
        ["1ST CHOICE DOG SKIN COAT 18KG", "919", null, null, "7505555555555"],
        ["Jeringa 3 ml", "INS-030", null, null, "7506666666666"],
      ];
      for (const [nombre, codigo, tipo, principio, barras] of productos) {
        const p = await db.query<{ id: string }>(
          // Con CABYS y tarifa: sin ellos el cierre no puede dejar el
          // cargo en la cuenta, y lo que se está probando acá es el
          // cierre, no el catálogo fiscal.
          `INSERT INTO inv_productos
             (tenant_id, codigo, nombre, principio_activo, linea_negocio, unidad_base,
              tipo_clinico, codigo_cabys, codigo_tarifa_iva)
           VALUES ($1,$2,$3,$4,'farmacia','unidad',$5,'2399900000000','08') RETURNING id`,
          [tenantId, codigo, nombre, principio, tipo]
        );
        await db.query(
          `INSERT INTO inv_presentaciones
             (tenant_id, producto_id, codigo_interno, codigo_barras, nombre, factor,
              unidad_medida, precio_venta, para_venta)
           VALUES ($1,$2,$3,$4,'Unidad',1,'Unid',$5,true)`,
          [tenantId, p.rows[0].id, `${codigo}-P`, barras, 1500]
        );
        await db.query(
          `INSERT INTO inv_lotes (tenant_id, producto_id, bodega_id, numero, cantidad, vencimiento)
           VALUES ($1,$2,$3,'L1',10,'2027-12-31')`,
          [tenantId, p.rows[0].id, bodega.rows[0].id]
        );
        creados[codigo] = p.rows[0].id;
      }
      return creados;
    });
    // El desparasitante de prueba, para el caso del cierre.
    const { presentacionDesparasitante, loteDesparasitante } = await conAlcanceTenant(
      tenantId,
      async (db) => {
        const r = await db.query<{ pid: string; lid: string }>(
          `SELECT pr.id AS pid, l.id AS lid
             FROM inv_presentaciones pr
             JOIN inv_lotes l ON l.producto_id = pr.producto_id
            WHERE pr.producto_id = $1 LIMIT 1`,
          [ids["ANT-020"]]
        );
        return {
          presentacionDesparasitante: r.rows[0].pid,
          loteDesparasitante: r.rows[0].lid,
        };
      }
    );

    const comoLaReceta = (busqueda?: string) =>
      conAlcanceTenant(tenantId, async (db) =>
        productosParaAtencion(db, {
          tipoClinico: "medicamento",
          incluirSinClasificar: true,
          busqueda,
        })
      );

    const todos = await comoLaReceta();
    assert(
      todos.length === 6,
      "la receta ve TODOS los productos, no solo el que tiene tipo_clinico (era 1 de 6)",
      todos.length
    );
    assert(
      todos[0]?.tipoClinico === "medicamento",
      "y los clasificados van primero",
      todos[0]?.nombre
    );
    assert(
      todos.filter((p) => p.tipoClinico === null).length === 5,
      "los cinco sin clasificar vienen con tipoClinico null, para que la pantalla los etiquete"
    );

    const soloClasificados = await conAlcanceTenant(tenantId, async (db) =>
      productosParaAtencion(db, { tipoClinico: "medicamento" })
    );
    assert(
      soloClasificados.length === 1,
      "sin incluirSinClasificar sigue dando 1: ESE era el defecto",
      soloClasificados.length
    );

    for (const [que, consulta, esperado] of [
      ["el nombre", "amoxi", "Amoxicilina 500 mg"],
      ["el código", "1349", "Acedan 50 ml frasco (Acepromacina)"],
      ["el principio activo", "amoxicilina", "Amoxicilina 500 mg"],
      ["el código de barras", "7503333333333", "Vanguard Plus 5"],
    ] as const) {
      const r = await comoLaReceta(consulta);
      assert(
        r.some((p) => p.nombre === esperado),
        `busca por ${que} («${consulta}» encuentra «${esperado}»)`,
        r.map((p) => p.nombre)
      );
    }

    const amoxi = (await comoLaReceta("amoxi"))[0];
    assert(amoxi?.existencia === 10, "trae la existencia", amoxi?.existencia);
    assert(amoxi?.precio === 1500, "y el precio", amoxi?.precio);

    // --- La sugerencia, con nombres del catálogo real ---------------
    for (const [nombre, esperado] of [
      ["Vanguard Plus 5", "vacuna"],
      ["BRAVECTO PERRO 20-40 KG", "antiparasitario"],
      ["Acedan 50 ml frasco (Acepromacina)", "medicamento"],
      ["Jeringa 3 ml", "insumo"],
      ["1ST CHOICE DOG SKIN COAT 18KG", "otro"],
    ] as const) {
      const s = tipoSugerido({ nombre });
      assert(s?.tipo === esperado, `sugiere «${esperado}» para «${nombre}»`, s?.tipo ?? "nada");
      assert(!!s?.porque, "y dice por qué, para que el usuario pueda discutirlo", s?.porque);
    }
    assert(
      tipoSugerido({ nombre: "Producto XYZ 123" }) === null,
      "y no inventa una sugerencia cuando no reconoce nada"
    );

    // --- La clasificación en lote -----------------------------------
    const antes = await conAlcanceTenant(tenantId, async (db) =>
      cuantosSinClasificar(db, tenantId)
    );
    assert(antes === 5, "el contador del indicador dice 5", antes);

    const lista = await conAlcanceTenant(tenantId, async (db) =>
      productosSinClasificar(db, tenantId)
    );
    assert(lista.total === 5, "la lista trae los cinco", lista.total);
    assert(
      lista.productos.every((p) => p.sugerencia !== null),
      "y cada uno con su sugerencia"
    );

    const cambiados = await conAlcanceTenant(tenantId, async (db) =>
      clasificarEnLote(db, tenantId, [ids["VAC-010"], ids["ANT-020"], ids["MED-001"]], "vacuna")
    );
    assert(
      cambiados === 2,
      "clasificar en lote NO pisa el que ya estaba clasificado (3 pedidos, 2 cambiados)",
      cambiados
    );
    const amoxiSigue = await conAlcanceTenant(tenantId, async (db) => {
      const r = await db.query<{ tipo_clinico: string }>(
        `SELECT tipo_clinico FROM inv_productos WHERE id = $1`,
        [ids["MED-001"]]
      );
      return r.rows[0].tipo_clinico;
    });
    assert(
      amoxiSigue === "medicamento",
      "la amoxicilina sigue siendo medicamento: no se perdió el trabajo hecho a mano",
      amoxiSigue
    );

    const despues = await conAlcanceTenant(tenantId, async (db) =>
      cuantosSinClasificar(db, tenantId)
    );
    assert(despues === 3, "y el contador baja a 3", despues);

    let tipoInventado = false;
    try {
      await conAlcanceTenant(tenantId, async (db) =>
        clasificarEnLote(db, tenantId, [ids["INS-030"]], "medicamentos" as never)
      );
    } catch {
      tipoInventado = true;
    }
    assert(tipoInventado, "un tipo clínico inventado se rechaza");

    // --- La plantilla y la importación ------------------------------
    assert(
      COLUMNAS_OPCIONALES.includes("tipo_clinico"),
      "la plantilla de importación declara tipo_clinico"
    );
    assert(
      !(COLUMNAS_PLANTILLA as readonly string[]).includes("tipo_clinico"),
      "y NO es obligatoria: una planilla ya armada sigue importando"
    );

    // =============================================================
    console.log(["", "=== El catálogo real, de solo lectura ==="].join("\n"));
    const demo = await pool.query<{ id: string; nombre: string }>(
      `SELECT t.id, t.nombre FROM tenants t
        JOIN personas p ON p.tenant_id = t.id
       WHERE p.email = 'demo.medico@vetlineai-test.com' LIMIT 1`
    );
    if (demo.rows.length === 0) {
      console.log("  (sin demo.medico en esta base: se omite)");
    } else {
      const real = await conAlcanceTenant(demo.rows[0].id, async (db) => ({
        sinClasificar: await cuantosSinClasificar(db, demo.rows[0].id),
        conBusqueda: await productosParaAtencion(db, {
          tipoClinico: "medicamento",
          incluirSinClasificar: true,
          busqueda: "amoxi",
        }),
        soloClasificados: await productosParaAtencion(db, { tipoClinico: "medicamento" }),
      }));
      console.log(
        `  La clínica de demo.medico es «${demo.rows[0].nombre}» (${demo.rows[0].id}) ` +
          `y tiene ${real.sinClasificar} productos sin clasificar.`
      );
      assert(
        real.conBusqueda.length >= real.soloClasificados.length,
        "con el catálogo REAL, la búsqueda devuelve al menos tanto como el filtro viejo",
        `${real.conBusqueda.length} vs ${real.soloClasificados.length}`
      );
    }

    // =============================================================
    console.log(["", "=== El cierre de la atención (caso Kira) ==="].join("\n"));
    {
      const { pacienteId: pacKira, medicoId } = await conAlcanceTenant(tenantId, async (db) => {
        const prop = await db.query<{ id: string }>(
          `INSERT INTO propietarios (tenant_id, nombre, telefono)
           VALUES ($1,'Dueño del cierre','88882222') RETURNING id`,
          [tenantId]
        );
        const pac = await db.query<{ id: string }>(
          `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, numero_expediente)
           VALUES ($1,$2,'Kira de prueba','Canino',2) RETURNING id`,
          [tenantId, prop.rows[0].id]
        );
        const per = await db.query<{ id: string }>(
          `INSERT INTO personas (tenant_id, nombre, email, es_medico, colegiatura, password_hash)
           VALUES ($1,'Dra. Cierre',$2,true,'VET-CIERRE','sin-login-probe') RETURNING id`,
          [tenantId, `${PREFIJO}-cierre@probe.test`]
        );
        return { pacienteId: pac.rows[0].id, medicoId: per.rows[0].id };
      });

      const atencionId = await conAlcanceTenant(tenantId, async (db) => {
        const a = await abrirAtencion(db, tenantId, { pacienteId: pacKira, medicoId });
        return a.id;
      });

      // Una desparasitación del catálogo, como la de Kira.
      const itemId = await conAlcanceTenant(tenantId, async (db) => {
        const r = await agregarItem(
          db,
          tenantId,
          atencionId,
          {
            tipo: "desparasitacion",
            presentacionId: presentacionDesparasitante,
            loteId: loteDesparasitante,
            cantidad: 1,
            preventivo: {
              tipo: "desparasitacion",
              nombre: "Desparasitante de prueba",
              subtipo: "interna",
              proxima: "2027-03-01",
            },
          },
          medicoId
        );
        return r.id;
      });

      // El cierre exige que quede algo escrito en el expediente.
      await conAlcanceTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE atenciones SET nota_medica = 'Nota de prueba del cierre' WHERE id = $1`,
          [atencionId]
        );
      });

      // --- EL CIERRE, DOS VECES ---------------------------------
      const primero = await conAlcanceTenant(tenantId, async (db) =>
        cerrarAtencion(db, tenantId, atencionId, { personaId: medicoId })
      );
      assert(primero.cargos === 1, "el cierre deja un cargo", primero.cargos);

      const preventivosTrasCierre = await conAlcanceTenant(tenantId, async (db) => {
        const r = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM cuidados_preventivos WHERE atencion_id = $1`,
          [atencionId]
        );
        return Number(r.rows[0].n);
      });
      assert(
        preventivosTrasCierre === 1,
        "EL DEFECTO DE KIRA: el cierre crea el registro preventivo (antes: cero)",
        preventivosTrasCierre
      );

      const enPestana = await conAlcanceTenant(tenantId, async (db) =>
        lineaDeTiempo(db, pacKira, { tipo: "desparasitacion" })
      );
      assert(
        enPestana.length === 1,
        "y por lo tanto aparece en la pestaña Desparasitaciones",
        enPestana.length
      );

      // Cerrar de nuevo no duplica nada: es el reintento del usuario
      // después de un "no se pudo conectar".
      await conAlcanceTenant(tenantId, async (db) =>
        cerrarAtencion(db, tenantId, atencionId, { personaId: medicoId })
      );
      const trasReintento = await conAlcanceTenant(tenantId, async (db) => {
        const c = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM vta_cargos
            WHERE origen = 'atencion' AND origen_id = $1 AND anulado_en IS NULL`,
          [atencionId]
        );
        const p = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM cuidados_preventivos WHERE atencion_id = $1`,
          [atencionId]
        );
        const m = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM inv_movimientos WHERE atencion_id = $1`,
          [atencionId]
        );
        return { cargos: Number(c.rows[0].n), prev: Number(p.rows[0].n), mov: Number(m.rows[0].n) };
      });
      assert(trasReintento.cargos === 1, "reintentar el cierre NO duplica el cargo", trasReintento.cargos);
      assert(trasReintento.prev === 1, "ni el registro preventivo", trasReintento.prev);
      assert(trasReintento.mov === 1, "ni la salida de inventario", trasReintento.mov);

      // --- QUITAR UNA LÍNEA YA COBRADA --------------------------
      const existenciaAntes = await conAlcanceTenant(tenantId, async (db) => {
        const r = await db.query<{ c: string }>(
          `SELECT COALESCE(sum(cantidad),0) AS c FROM inv_lotes WHERE id = $1`,
          [loteDesparasitante]
        );
        return Number(r.rows[0].c);
      });

      await conAlcanceTenant(tenantId, async (db) => {
        await db.query(
          `UPDATE atenciones SET estado = 'borrador', cerrada_en = NULL WHERE id = $1`,
          [atencionId]
        );
        await quitarItem(db, tenantId, atencionId, itemId);
      });

      const trasQuitar = await conAlcanceTenant(tenantId, async (db) => {
        const c = await db.query<{ vivos: string; anulados: string }>(
          `SELECT count(*) FILTER (WHERE anulado_en IS NULL) AS vivos,
                  count(*) FILTER (WHERE anulado_en IS NOT NULL) AS anulados
             FROM vta_cargos WHERE origen = 'atencion' AND origen_id = $1`,
          [atencionId]
        );
        const l = await db.query<{ c: string }>(
          `SELECT COALESCE(sum(cantidad),0) AS c FROM inv_lotes WHERE id = $1`,
          [loteDesparasitante]
        );
        return {
          vivos: Number(c.rows[0].vivos),
          anulados: Number(c.rows[0].anulados),
          existencia: Number(l.rows[0].c),
        };
      });
      assert(
        trasQuitar.vivos === 0 && trasQuitar.anulados === 1,
        "EL OTRO DEFECTO DE KIRA: quitar la línea ANULA su cargo (antes quedaba vivo en la cuenta)",
        JSON.stringify(trasQuitar)
      );
      assert(
        trasQuitar.existencia === existenciaAntes + 1,
        "y el producto vuelve al estante: el stock no se pierde",
        `${existenciaAntes} → ${trasQuitar.existencia}`
      );
    }

    // =============================================================
    console.log(["", "=== Cada rol entra y aterriza donde le toca ==="].join("\n"));
    {
      // El defecto bloqueante: se invitó a alguien con rol Recepción y
      // al entrar cayó en «No autorizado». Acá se comprueba la mitad que
      // se puede comprobar sin navegador —que la sesión resuelve, con su
      // rol y su pantalla de entrada—, que es exactamente el dato que la
      // guarda del frontend necesitaba y no estaba mirando.
      const esperado: Record<string, string> = {
        recepcion: "/agenda",
        caja: "/ventas",
        farmacia: "/inventario",
        estetica: "/pacientes",
        asistente: "/agenda",
        contador: "/facturacion",
      };

      for (const [rol, pantalla] of Object.entries(esperado)) {
        const token = await alta2(tenantId, `rol-${rol}`, `Prueba ${rol}`, [rol]);
        const r = await fetch(`${API}/clinica/mis-permisos`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const cuerpo = (await r.json()) as {
          roles?: string[];
          permisos?: string[];
          pantallaInicio?: string | null;
        };
        assert(r.status === 200, `«${rol}» tiene sesión válida`, r.status);
        assert(
          (cuerpo.roles ?? []).includes(rol),
          `y el backend le devuelve su rol «${rol}» desde la base`,
          cuerpo.roles
        );
        assert(
          (cuerpo.roles ?? []).length > 0,
          `con al menos un rol: es lo que la puerta del frontend miraba mal (antes: lista vacía → «No autorizado»)`
        );
      }

      // Y que los permisos NO sean los mismos para todos: si lo fueran,
      // el menú sería el mismo y los roles no servirían de nada.
      const permisosDe = async (rol: string) => {
        const token = await alta2(tenantId, `perm-${rol}`, `Permisos ${rol}`, [rol]);
        const r = await fetch(`${API}/clinica/mis-permisos`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        return ((await r.json()) as { permisos?: string[] }).permisos ?? [];
      };
      const deRecepcion = await permisosDe("recepcion");
      const deCaja = await permisosDe("caja");
      assert(
        JSON.stringify(deRecepcion.sort()) !== JSON.stringify(deCaja.sort()),
        "recepción y caja no tienen los mismos permisos",
        `${deRecepcion.length} vs ${deCaja.length}`
      );
    }
  } finally {
    await limpiar();
    await pool.end();
  }

  console.log(ok ? "\nTodo OK." : "\nHAY FALLOS.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
