// Datos de demostración del BLOQUE B del prompt 07: la atención que
// genera cargos.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/sembrar_demo_atencion.ts <tenantId>
//
// Deja:
//   * el catálogo mínimo para registrar una consulta de verdad: dos
//     servicios (uno con insumos) y una vacuna con DOS lotes, para que
//     se vea que el médico elige el frasco;
//   * una atención EN CURSO de Toby, con su plantilla aplicada, el
//     examen a medio hacer y dos ítems cargados, que es el estado en el
//     que se ve la pantalla cuando alguien la abre a mirar.
//
// Es re-corrible: no duplica el catálogo y no abre una segunda atención
// si ya hay una en borrador.
//
// NO SALE NINGÚN CORREO: abrir una atención sin cita previa crea la
// cita, y crear una cita avisa al propietario. Este script apaga el
// aviso de confirmación de cita de la clínica de demostración antes de
// tocar nada, y lo deja apagado —es una clínica para mirar pantallas, no
// para mandarle correos a nadie—.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { registrarMovimiento } from "../inventario/movimientos";
import {
  abrirAtencion,
  agregarDiagnostico,
  agregarItem,
  guardarSoap,
  marcarSistema,
} from "../expediente/atencion";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_atencion");
  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_atencion.ts <tenantId>");
    process.exit(1);
  }

  await pool.query(
    `INSERT INTO configuracion_notificaciones (tenant_id, confirmacion_cita_activo)
     VALUES ($1,false)
     ON CONFLICT (tenant_id) DO UPDATE SET confirmacion_cita_activo = false`,
    [tenantId]
  );
  console.log("Avisos de confirmación de cita: APAGADOS en esta clínica (ningún correo sale).");

  const medico = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM personas WHERE tenant_id = $1 AND es_medico ORDER BY creado_en LIMIT 1`,
    [tenantId]
  );
  if (medico.rows.length === 0) throw new Error("Esta clínica no tiene ningún médico.");
  const medicoId = medico.rows[0].id;

  const paciente = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM pacientes WHERE tenant_id = $1 AND nombre = 'Toby' LIMIT 1`,
    [tenantId]
  );
  if (paciente.rows.length === 0) {
    throw new Error("No hay un paciente 'Toby': corré antes sembrar_demo_expediente.ts.");
  }
  const pacienteId = paciente.rows[0].id;

  const bodega = await pool.query<{ id: string }>(
    `SELECT id FROM inv_bodegas WHERE tenant_id = $1 AND activo
      ORDER BY es_default DESC LIMIT 1`,
    [tenantId]
  );
  if (bodega.rows.length === 0) {
    throw new Error("Esta clínica no tiene bodega: corré antes sembrar_demo_inventario.ts.");
  }
  const bodegaId = bodega.rows[0].id;

  // --- El catálogo ----------------------------------------------------
  const consulta = await servicio(tenantId, {
    codigo: "S-CONSULTA",
    nombre: "Consulta general",
    linea: "consulta",
    especialidad: "medicina_general",
    precio: 25000,
  });
  const curado = await servicio(tenantId, {
    codigo: "S-CURADO",
    nombre: "Curación de herida",
    linea: "consulta",
    precio: 8000,
  });

  // El curado consume gasas: su costo está en el precio del servicio,
  // pero el stock tiene que bajar igual.
  const gasa = await pool.query<{ id: string }>(
    `SELECT pr.id FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
      WHERE p.tenant_id = $1 AND p.nombre ILIKE '%algod%' AND pr.factor = 1
      LIMIT 1`,
    [tenantId]
  );
  if (gasa.rows.length > 0) {
    await pool.query(
      `INSERT INTO inv_servicio_insumos (tenant_id, servicio_id, presentacion_id, cantidad)
       SELECT $1,$2,$3,20
        WHERE NOT EXISTS (SELECT 1 FROM inv_servicio_insumos
                           WHERE servicio_id = $2 AND presentacion_id = $3)`,
      [tenantId, curado, gasa.rows[0].id]
    );
  }

  const vacunaProducto = await producto(tenantId, {
    codigo: "P-VACPOLI",
    nombre: "Vacuna polivalente canina",
    linea: "vacunacion",
    unidad: "dosis",
  });
  const presVacuna = await presentacion(tenantId, vacunaProducto, {
    codigo: "VP-1",
    nombre: "Dosis",
    factor: 1,
    precio: 14500,
  });

  const lotesExistentes = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM inv_lotes WHERE producto_id = $1`,
    [vacunaProducto]
  );
  if (lotesExistentes.rows[0].n === "0") {
    await conAlcanceTenant(tenantId, async (db) => {
      await registrarMovimiento(db, tenantId, {
        tipo: "compra",
        productoId: vacunaProducto,
        bodegaId,
        cantidadBase: 6,
        lote: { numero: "VP-2026-A", vencimiento: "2027-03-31", costoUnitario: 7000 },
        personaId: medicoId,
      });
      await registrarMovimiento(db, tenantId, {
        tipo: "compra",
        productoId: vacunaProducto,
        bodegaId,
        cantidadBase: 12,
        lote: { numero: "VP-2026-B", vencimiento: "2028-09-30", costoUnitario: 7200 },
        personaId: medicoId,
      });
    });
    console.log("Vacuna polivalente con dos lotes: VP-2026-A (vence antes) y VP-2026-B.");
  }

  // --- La atención en curso -------------------------------------------
  const yaHay = await pool.query<{ id: string }>(
    `SELECT id FROM atenciones WHERE paciente_id = $1 AND estado = 'borrador' LIMIT 1`,
    [pacienteId]
  );
  if (yaHay.rows.length > 0) {
    console.log(`Ya había una atención en curso (${yaHay.rows[0].id}); no se abre otra.`);
    console.log(`\nMirala en /pacientes/${pacienteId} → pestaña «Atención actual».`);
    await pool.end();
    return;
  }

  const atencion = await conAlcanceTenant(tenantId, (db) =>
    abrirAtencion(db, tenantId, {
      pacienteId,
      medicoId,
      tipoConsulta: "consulta_general",
      motivoConsulta: "Control anual y vacunación",
    })
  );

  await conAlcanceTenant(tenantId, async (db) => {
    await guardarSoap(db, atencion.id, {
      anamnesis:
        "Come bien, sin vómitos ni diarrea. El dueño nota que se sacude la cabeza desde hace una semana.",
      peso: 32.4,
      temperatura: 38.6,
      frecuencia_cardiaca: 96,
      frecuencia_respiratoria: 24,
      condicion_corporal: 6,
      mucosas: "rosadas",
      hidratacion: "normal",
      evaluacion: "Paciente sano, con sobrepeso leve. Otitis externa derecha incipiente.",
      plan_tratamiento:
        "Vacunación anual. Limpieza de oído y antibiótico tópico. Control en 15 días.",
      indicaciones_cliente:
        "Limpiar el oído derecho una vez al día con la solución indicada. No mojar los oídos al bañarlo.",
      control_fecha: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      control_motivo: "Control de otitis",
    });

    await marcarSistema(db, tenantId, atencion.id, "Actitud y estado general", "normal");
    await marcarSistema(db, tenantId, atencion.id, "Piel y pelaje", "normal");
    await marcarSistema(
      db,
      tenantId,
      atencion.id,
      "Oídos",
      "anormal",
      "Eritema y cerumen oscuro en pabellón derecho. Sin dolor a la palpación."
    );
    await marcarSistema(db, tenantId, atencion.id, "Cardiovascular", "normal");
    await marcarSistema(db, tenantId, atencion.id, "Respiratorio", "normal");

    await agregarDiagnostico(db, tenantId, {
      atencionId: atencion.id,
      tipo: "definitivo",
      descripcion: "Otitis externa derecha",
      personaId: medicoId,
      aLaListaDeProblemas: true,
    });

    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "servicio", servicioId: consulta, cantidad: 1 },
      medicoId
    );
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "servicio", servicioId: curado, cantidad: 1 },
      medicoId
    );
    const loteB = await db.query<{ id: string }>(
      `SELECT id FROM inv_lotes WHERE producto_id = $1 AND numero = 'VP-2026-B'`,
      [vacunaProducto]
    );
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      {
        tipo: "vacuna",
        presentacionId: presVacuna,
        loteId: loteB.rows[0]?.id,
        cantidad: 1,
        preventivo: {
          tipo: "vacunacion",
          nombre: "Polivalente canina",
          proxima: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        },
      },
      medicoId
    );
  });

  console.log(`\nAtención EN CURSO de ${paciente.rows[0].nombre}: ${atencion.id}`);
  console.log(`Médico: ${medico.rows[0].nombre}`);
  console.log(`\nMirala en /pacientes/${pacienteId} → pestaña «Atención actual».`);
  console.log(
    "Tiene tres ítems cargados y el examen a medio hacer. Al cerrarla, los cargos pasan a la caja."
  );
  await pool.end();
}

async function servicio(
  tenantId: string,
  d: { codigo: string; nombre: string; linea: string; especialidad?: string; precio: number }
): Promise<string> {
  const existe = await pool.query<{ id: string }>(
    `SELECT id FROM inv_servicios WHERE tenant_id = $1 AND codigo = $2`,
    [tenantId, d.codigo]
  );
  if (existe.rows.length > 0) return existe.rows[0].id;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, especialidad,
                                codigo_cabys, codigo_tarifa_iva, precio, duracion_min)
     VALUES ($1,$2,$3,$4,$5,'8351000000000','04',$6,30) RETURNING id`,
    [tenantId, d.codigo, d.nombre, d.linea, d.especialidad ?? null, d.precio]
  );
  console.log(`Servicio "${d.nombre}" creado.`);
  return r.rows[0].id;
}

async function producto(
  tenantId: string,
  d: { codigo: string; nombre: string; linea: string; unidad: string }
): Promise<string> {
  const existe = await pool.query<{ id: string }>(
    `SELECT id FROM inv_productos WHERE tenant_id = $1 AND codigo = $2`,
    [tenantId, d.codigo]
  );
  if (existe.rows.length > 0) return existe.rows[0].id;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                codigo_cabys, codigo_tarifa_iva, requiere_refrigeracion)
     VALUES ($1,$2,$3,$4,$5,'3564012000000','08',true) RETURNING id`,
    [tenantId, d.codigo, d.nombre, d.linea, d.unidad]
  );
  console.log(`Producto "${d.nombre}" creado.`);
  return r.rows[0].id;
}

async function presentacion(
  tenantId: string,
  productoId: string,
  d: { codigo: string; nombre: string; factor: number; precio: number }
): Promise<string> {
  const existe = await pool.query<{ id: string }>(
    `SELECT id FROM inv_presentaciones WHERE producto_id = $1 AND codigo_interno = $2`,
    [productoId, d.codigo]
  );
  if (existe.rows.length > 0) return existe.rows[0].id;
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                     unidad_medida, precio_venta, para_venta)
     VALUES ($1,$2,$3,$4,$5,'Unid',$6,true) RETURNING id`,
    [tenantId, productoId, d.codigo, d.nombre, d.factor, d.precio]
  );
  return r.rows[0].id;
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
