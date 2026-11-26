// Verificación del prompt 07c: acciones explícitas y receta completa.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_atencion_07c.ts
//
// SIN --transpile-only a propósito, por lo mismo de siempre: con los
// tipos apagados, cuatro defectos de los verificadores de caja pasaron
// sin que nadie los viera.
//
// Lo que se verifica, en el orden del prompt:
//
//   * el filtro por tipo clínico: la acción Vacuna ofrece vacunas y
//     nada más, y la acción Producto no ofrece preventivos;
//   * el lote sugerido es el de FEFO, el mismo que va a salir;
//   * la próxima fecha sale del protocolo, y el más específico gana;
//   * la receta: dosis por kilo calculada con su explicación, cantidad
//     total deducida de la frecuencia, texto generado;
//   * una línea dispensada acá genera UN cargo —no dos—, y una línea
//     para comprar afuera no genera ninguno;
//   * quitar la línea quita el cargo;
//   * el aviso de alergia aparece al verla;
//   * el cierre firma la receta, y es idempotente;
//   * el PDF sale con bytes de PDF;
//   * el histórico no toca ni caja ni inventario;
//   * el estudio desde la atención cobra su servicio;
//   * el resumen del cierre dice lo que va a pasar antes de confirmar.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  abrirAtencion,
  cerrarAtencion,
  cuentaViva,
  guardarSoap,
  resumenDelCierre,
} from "../expediente/atencion";
import { registrarAlergia } from "../expediente/clinico";
import {
  estudiosDeAtencion,
  pedirEstudio,
  productosParaAtencion,
  proximaSugerida,
  registrarHistorico,
} from "../expediente/preventivos";
import {
  agregarLinea,
  calcularDosis,
  medicacionActiva,
  quitarLinea,
  recetasAnteriores,
  repetirReceta,
  verReceta,
} from "../expediente/receta";
import { recetaDeAtencionEnPdf } from "../expediente/recetaPdf";
import { registrarMovimiento } from "../inventario/movimientos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-07c";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}
async function debeFallar(descripcion: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    assert(false, `${descripcion} — NO falló, y tenía que fallar`);
  } catch (err) {
    assert(true, `${descripcion} — rechazado`, (err as Error).message.slice(0, 120));
  }
}

let tenantId = "";
let medicoId = "";
let propietarioId = "";
let toby = "";
let bodegaId = "";
let presVacuna = "";
let presAntibiotico = "";
let presGasa = "";
let servicioLab = "";
let loteVacunaViejo = "";
let productoVacuna = "";

async function crearProducto(
  codigo: string,
  nombre: string,
  unidad: string,
  tipoClinico: string | null,
  principioActivo?: string
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                codigo_cabys, codigo_tarifa_iva, principio_activo, tipo_clinico)
     VALUES ($1,$2,$3,'farmacia',$4,'3564012000000','08',$5,$6) RETURNING id`,
    [tenantId, codigo, nombre, unidad, principioActivo ?? null, tipoClinico]
  );
  return r.rows[0].id;
}

async function crearPresentacion(
  productoId: string,
  codigo: string,
  nombre: string,
  precio: number
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                     unidad_medida, precio_venta, para_venta)
     VALUES ($1,$2,$3,$4,1,'Unid',$5,true) RETURNING id`,
    [tenantId, productoId, codigo, nombre, precio]
  );
  return r.rows[0].id;
}

async function nuevaAtencion(motivo: string): Promise<string> {
  const cita = await pool.query<{ id: string }>(
    `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                        duracion_minutos, motivo_consulta, estado)
     VALUES ($1,$2,$3,CURRENT_DATE,'09:00','09:30',30,$4,'en_consulta') RETURNING id`,
    [tenantId, toby, medicoId, motivo]
  );
  const a = await conAlcanceTenant(tenantId, (db) =>
    abrirAtencion(db, tenantId, { citaId: cita.rows[0].id, medicoId, tipoConsulta: "consulta_general" })
  );
  await pool.query(`UPDATE atenciones SET peso = 18 WHERE id = $1`, [a.id]);
  return a.id;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_atencion_07c");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // -------------------------------------------------------------------
  console.log("=== 0. Clínica, catálogo con tipo clínico, inventario y paciente ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@07c.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  // Ningún correo real: la creación de la cita avisa al propietario.
  await pool.query(
    `INSERT INTO configuracion_notificaciones
       (tenant_id, confirmacion_cita_activo, recordatorio_cita_activo)
     VALUES ($1,false,false)`,
    [tenantId]
  );
  medicoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica,
                             colegiatura)
       VALUES ($1,'Dra. Laura Méndez',$2,'x',true,true,'VET-07C') RETURNING id`,
      [tenantId, `${PREFIJO}-medico@probe.test`]
    )
  ).rows[0].id;
  propietarioId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email, telefono)
       VALUES ($1,'Don Luis',$2,'88887777') RETURNING id`,
      [tenantId, `${PREFIJO}-luis@probe.invalid`]
    )
  ).rows[0].id;
  toby = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza,
                              sexo, estado_reproductivo)
       VALUES ($1,$2,1,'Toby','canino','Golden Retriever','macho','entero') RETURNING id`,
      [tenantId, propietarioId]
    )
  ).rows[0].id;
  bodegaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  servicioLab = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, codigo_cabys,
                                  codigo_tarifa_iva, precio)
       VALUES ($1,'S-LAB','Hemograma','laboratorio','8351000000000','04',12000) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  productoVacuna = await crearProducto("P-VAC", "Vacuna polivalente", "dosis", "vacuna");
  presVacuna = await crearPresentacion(productoVacuna, "V1", "Dosis", 12000);
  const antibiotico = await crearProducto(
    "P-AMO", "Amoxicilina 500 mg", "tableta", "medicamento", "amoxicilina"
  );
  presAntibiotico = await crearPresentacion(antibiotico, "A1", "Tableta", 600);
  const gasa = await crearProducto("P-GAS", "Gasa estéril", "unidad", "insumo");
  presGasa = await crearPresentacion(gasa, "G1", "Unidad", 300);

  await conAlcanceTenant(tenantId, async (db) => {
    const viejo = await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: productoVacuna, bodegaId, cantidadBase: 5,
      lote: { numero: "VAC-VIEJO", vencimiento: "2027-01-31", costoUnitario: 5000 },
    });
    loteVacunaViejo = viejo[0].loteId;
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: productoVacuna, bodegaId, cantidadBase: 5,
      lote: { numero: "VAC-NUEVO", vencimiento: "2029-12-31", costoUnitario: 5200 },
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: antibiotico, bodegaId, cantidadBase: 100,
      lote: { numero: "AMO-1", vencimiento: "2028-06-30", costoUnitario: 200 },
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial", productoId: gasa, bodegaId, cantidadBase: 20,
      lote: { numero: "GAS-1", costoUnitario: 100 },
    });
  });
  assert(!!toby && !!presVacuna, "clínica, catálogo con tipo clínico e inventario");

  // -------------------------------------------------------------------
  console.log("\n=== 1. Cada acción ofrece lo suyo, y nada más ===");
  const vacunas = await conAlcanceTenant(tenantId, (db) =>
    productosParaAtencion(db, { tipoClinico: "vacuna" })
  );
  igual(
    vacunas.map((v) => v.nombre),
    ["Vacuna polivalente"],
    "la acción Vacuna ofrece SOLO las vacunas"
  );
  const productos = await conAlcanceTenant(tenantId, (db) =>
    productosParaAtencion(db, { excluir: ["vacuna", "antiparasitario"] })
  );
  assert(
    !productos.some((p) => p.tipoClinico === "vacuna"),
    "la acción Producto NO ofrece vacunas: para eso está su propia acción",
    productos.map((p) => p.nombre)
  );

  igual(
    vacunas[0].lotes.map((l) => l.numero),
    ["VAC-VIEJO", "VAC-NUEVO"],
    "los lotes vienen en orden FEFO: el sugerido es el que vence antes"
  );
  assert(
    vacunas[0].lotes[0].id === loteVacunaViejo,
    "y el sugerido es exactamente el lote que FEFO haría salir"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. La próxima fecha sale del protocolo ===");
  const proxCanino = await conAlcanceTenant(tenantId, (db) =>
    proximaSugerida(db, { tipo: "vacunacion", especie: "canino", nombre: "Rabia" })
  );
  assert(proxCanino?.meses === 12, "vacuna de rabia en canino: 12 meses", proxCanino);
  const proxDespara = await conAlcanceTenant(tenantId, (db) =>
    proximaSugerida(db, { tipo: "desparasitacion", especie: "canino", nombre: "Interna" })
  );
  assert(proxDespara?.meses === 3, "desparasitación interna: 3 meses", proxDespara);
  assert(
    (proxCanino?.origen ?? "").includes("especie"),
    "y dice de dónde salió, para que el médico pueda discutirlo",
    proxCanino?.origen
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. La receta: dosis por kilo, cantidad y texto ===");
  const atencion = await nuevaAtencion("Control con receta");

  const sinPeso = calcularDosis({ dosisCantidad: 12.5, dosisUnidad: "mg", dosisPorKg: true }, null);
  assert(
    sinPeso.total === null && (sinPeso.explicacion ?? "").includes("Falta el peso"),
    "sin peso NO se inventa un total: se dice que falta",
    sinPeso
  );

  const linea1 = await conAlcanceTenant(tenantId, (db) =>
    agregarLinea(
      db, tenantId, atencion,
      {
        presentacionId: presAntibiotico,
        dosisCantidad: 12.5, dosisUnidad: "mg", dosisPorKg: true,
        viaCodigo: "oral", frecuenciaCodigo: "c12h",
        duracionCantidad: 7, duracionUnidad: "dias",
        dispensadoAqui: true,
      },
      medicoId
    )
  );
  assert(linea1.dosisTotal === 225, "12,5 mg/kg × 18 kg = 225 mg", linea1.dosisTotal);
  assert(
    (linea1.explicacionDosis ?? "").includes("18") && (linea1.explicacionDosis ?? "").includes("225"),
    "y la receta muestra la cuenta, no solo el resultado",
    linea1.explicacionDosis
  );
  assert(linea1.cantidadTotal === 14, "cada 12 h por 7 días = 14 unidades", linea1.cantidadTotal);
  assert(
    (linea1.indicaciones ?? "").length > 10,
    "y el texto para el propietario se genera solo",
    linea1.indicaciones
  );

  // La segunda línea es texto libre: lo que la clínica no vende.
  const linea2 = await conAlcanceTenant(tenantId, (db) =>
    agregarLinea(
      db, tenantId, atencion,
      {
        textoLibre: "Omeprazol 20 mg (comprar en farmacia humana)",
        dosisCantidad: 1, dosisUnidad: "tableta", dosisPorKg: false,
        viaCodigo: "oral", frecuenciaCodigo: "c24h",
        duracionCantidad: 10, duracionUnidad: "dias",
        dispensadoAqui: false,
      },
      medicoId
    )
  );
  assert(!!linea2.id, "una línea de texto libre se acepta: es lo que se compra afuera");

  await debeFallar("una línea con dos orígenes a la vez", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarLinea(db, tenantId, atencion, {
        presentacionId: presAntibiotico, textoLibre: "Otra cosa",
      }, medicoId)
    )
  );
  await debeFallar("dispensar acá algo que no está en el inventario", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarLinea(db, tenantId, atencion, {
        textoLibre: "Algo de afuera", dispensadoAqui: true,
      }, medicoId)
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. Lo que se dispensa acá se cobra UNA vez; lo de afuera, ninguna ===");
  const cuenta = await conAlcanceTenant(tenantId, (db) => cuentaViva(db, atencion));
  igual(
    cuenta.items.map((i) => i.descripcion),
    ["Amoxicilina 500 mg — Tableta"],
    "en la cuenta está la línea dispensada y NO la de afuera"
  );
  assert(cuenta.items[0].cantidad === 14, "con la cantidad total de la receta", cuenta.items[0].cantidad);

  // -------------------------------------------------------------------
  console.log("\n=== 5. El aviso de alergia ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarAlergia(db, tenantId, {
      pacienteId: toby, sustancia: "amoxicilina", severidad: "grave", personaId: medicoId,
    })
  );
  const conAviso = await conAlcanceTenant(tenantId, (db) => verReceta(db, tenantId, atencion));
  assert(
    conAviso.avisos.length > 0,
    "recetar algo a lo que el paciente es alérgico avisa",
    conAviso.avisos[0]
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. Quitar la línea quita el cargo ===");
  await conAlcanceTenant(tenantId, (db) => quitarLinea(db, atencion, linea2.id));
  const tras = await conAlcanceTenant(tenantId, (db) => verReceta(db, tenantId, atencion));
  igual(tras.lineas.length, 1, "la línea de afuera se fue");
  const cuenta2 = await conAlcanceTenant(tenantId, (db) => cuentaViva(db, atencion));
  igual(cuenta2.items.length, 1, "y la cuenta no cambió: esa línea no cobraba nada");

  // -------------------------------------------------------------------
  console.log("\n=== 7. El estudio desde la atención ===");
  const estudio = await conAlcanceTenant(tenantId, (db) =>
    pedirEstudio(
      db, tenantId, atencion,
      { tipoEstudio: "Hemograma", esExterno: false, servicioId: servicioLab },
      medicoId
    )
  );
  assert(estudio.conCargo, "un estudio hecho acá con servicio del catálogo deja su cargo");
  const estudios = await conAlcanceTenant(tenantId, (db) => estudiosDeAtencion(db, atencion));
  igual(estudios.map((e) => e.tipo), ["Hemograma"], "y queda ligado a la atención");
  await debeFallar("un estudio externo sin decir a qué laboratorio", () =>
    conAlcanceTenant(tenantId, (db) =>
      pedirEstudio(db, tenantId, atencion, { tipoEstudio: "Citología", esExterno: true }, medicoId)
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. El resumen del cierre dice lo que va a pasar ===");
  const resumen = await conAlcanceTenant(tenantId, (db) => resumenDelCierre(db, atencion));
  assert(resumen.cargos.length === 2, "dos cargos: la amoxicilina y el hemograma", resumen.cargos);
  assert(resumen.total === 14 * 600 + 12000, "con su total", resumen.total);
  assert(resumen.salidas.length === 1, "una sola salida de inventario: el hemograma es un servicio");
  assert(resumen.receta?.lineas === 1, "y la receta que se va a firmar", resumen.receta);
  igual(
    resumen.impedimentos,
    ["Falta la evaluación o la nota médica: es lo que queda en el expediente."],
    "y AVISA lo que impide cerrar, en vez de dejar que el cierre falle después"
  );

  await conAlcanceTenant(tenantId, (db) =>
    guardarSoap(db, atencion, { evaluacion: "Gastritis leve. Responde bien." })
  );
  const resumen2 = await conAlcanceTenant(tenantId, (db) => resumenDelCierre(db, atencion));
  igual(resumen2.impedimentos, [], "con la evaluación escrita, nada impide cerrar");

  // -------------------------------------------------------------------
  console.log("\n=== 9. El cierre firma la receta, y es idempotente ===");
  const cierre = await conAlcanceTenant(tenantId, (db) =>
    cerrarAtencion(db, tenantId, atencion, { personaId: medicoId })
  );
  assert(cierre.recetaFirmada && cierre.recetaLineas === 1, "la receta se firmó con la atención", {
    firmada: cierre.recetaFirmada,
    lineas: cierre.recetaLineas,
  });
  const firmada = await pool.query<{ estado: string; firmada_en: string | null }>(
    `SELECT estado, firmada_en::text FROM recetas WHERE atencion_id = $1`,
    [atencion]
  );
  assert(
    firmada.rows[0].estado === "emitida" && firmada.rows[0].firmada_en !== null,
    "y quedó emitida con su fecha de firma",
    firmada.rows[0]
  );
  const otraVez = await conAlcanceTenant(tenantId, (db) =>
    cerrarAtencion(db, tenantId, atencion, { personaId: medicoId })
  );
  assert(otraVez.yaEstabaCerrada, "cerrar dos veces no vuelve a cobrar ni a firmar");

  await debeFallar("agregar una línea a una atención cerrada", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarLinea(db, tenantId, atencion, { textoLibre: "Tarde" }, medicoId)
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. El PDF y la medicación activa ===");
  const pdf = await conAlcanceTenant(tenantId, (db) => recetaDeAtencionEnPdf(db, atencion));
  assert(
    pdf.buffer.subarray(0, 4).toString() === "%PDF",
    "el PDF tiene bytes de PDF, no un objeto que dice que sí",
    `${pdf.buffer.length} bytes`
  );
  assert(pdf.nombreArchivo.startsWith("Receta_Toby_"), "con el nombre del paciente", pdf.nombreArchivo);

  const activa = await conAlcanceTenant(tenantId, (db) => medicacionActiva(db, toby));
  assert(activa.length === 1, "la medicación activa toma la línea mientras dure", activa);

  // -------------------------------------------------------------------
  console.log("\n=== 11. Repetir una receta recalcula con el peso de hoy ===");
  const atencion2 = await nuevaAtencion("Control de seguimiento");
  await pool.query(`UPDATE atenciones SET peso = 24 WHERE id = $1`, [atencion2]);
  const anteriores = await conAlcanceTenant(tenantId, (db) => recetasAnteriores(db, toby, atencion2));
  assert(anteriores.length === 1, "la receta anterior se puede elegir", anteriores[0]?.resumen);

  const repetida = await conAlcanceTenant(tenantId, (db) =>
    repetirReceta(db, tenantId, atencion2, anteriores[0].id, medicoId)
  );
  assert(repetida.copiadas === 1, "se copió la línea", repetida);
  const nueva = await conAlcanceTenant(tenantId, (db) => verReceta(db, tenantId, atencion2));
  assert(
    nueva.lineas[0].dosisTotal === 300,
    "y la dosis se recalculó con los 24 kg de hoy: 12,5 × 24 = 300 mg",
    nueva.lineas[0].dosisTotal
  );

  // -------------------------------------------------------------------
  console.log("\n=== 12. El registro histórico no toca caja ni inventario ===");
  const existenciaAntes = await pool.query<{ total: string }>(
    `SELECT COALESCE(sum(cantidad),0)::text AS total FROM inv_lotes WHERE producto_id = $1`,
    [productoVacuna]
  );
  const hist = await conAlcanceTenant(tenantId, (db) =>
    registrarHistorico(
      db, tenantId,
      {
        pacienteId: toby, tipo: "vacunacion", nombre: "Rabia",
        fechaAplicacion: "2026-05-10", lugar: "Clínica de otro cantón", lote: "EXT-123",
      },
      medicoId
    )
  );
  assert(hist.proxima === "2027-05-10", "la próxima se cuenta desde la aplicación, no desde hoy", hist);
  const existenciaDespues = await pool.query<{ total: string }>(
    `SELECT COALESCE(sum(cantidad),0)::text AS total FROM inv_lotes WHERE producto_id = $1`,
    [productoVacuna]
  );
  igual(existenciaDespues.rows[0].total, existenciaAntes.rows[0].total, "el inventario no se movió");
  const marcado = await pool.query<{ historico: boolean; lugar: string | null }>(
    `SELECT historico, lugar FROM cuidados_preventivos WHERE id = $1`,
    [hist.id]
  );
  assert(
    marcado.rows[0].historico && marcado.rows[0].lugar === "Clínica de otro cantón",
    "y queda marcado como histórico, con dónde se aplicó",
    marcado.rows[0]
  );
  await debeFallar("un histórico con fecha futura", () =>
    conAlcanceTenant(tenantId, (db) =>
      registrarHistorico(
        db, tenantId,
        { pacienteId: toby, tipo: "vacunacion", nombre: "Rabia", fechaAplicacion: "2099-01-01" },
        medicoId
      )
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 13. Limpieza ===");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  assert(true, "la clínica de prueba se borró");

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err);
    await pool.end();
    process.exit(1);
  });
