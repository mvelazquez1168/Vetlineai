// Verificación del BLOQUE B del prompt 07: la atención que genera cargos.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_expediente_bloque_b.ts
//
// SIN --transpile-only a propósito: con los tipos apagados, cuatro
// defectos de los verificadores de caja pasaron sin que nadie los viera.
//
// Lo que el prompt pide verificar de este bloque, en orden:
//
//   * el flujo de Toby de punta a punta —consulta, examen por sistemas,
//     vacuna con lote, desparasitación y receta dispensada— deja la
//     cuenta en caja con sus cargos, el inventario descargado POR LOTE
//     con origen atención y paciente, los recordatorios programados y la
//     cita completada;
//   * si falta stock, NO queda nada a medias;
//   * un cargo no llega dos veces;
//   * recetar algo a lo que el paciente es alérgico avisa antes;
//   * una atención cerrada no se edita;
//   * la atención sin cita previa crea la cita sola;
//   * los insumos del servicio se consumen aunque no se cobren aparte.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  abrirAtencion,
  agregarDiagnostico,
  agregarItem,
  aplicarPlantilla,
  atencionCompleta,
  avisosAlRecetar,
  cerrarAtencion,
  cuentaViva,
  guardarSoap,
  marcarSistema,
  quitarItem,
} from "../expediente/atencion";
import { cerrarYFirmarAtencion, registrarAlergia } from "../expediente/clinico";
import { registrarMovimiento } from "../inventario/movimientos";
import { totalDeCuenta } from "../ventas/cuentas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-atencion";

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
    assert(true, `${descripcion} — rechazado`, (err as Error).message.slice(0, 130));
  }
}

let tenantId = "";
let medicoId = "";
let propietarioId = "";
let toby = "";
let bodegaId = "";
let servicioConsulta = "";
let servicioCurado = "";
let presVacuna = "";
let presDespara = "";
let presAntibiotico = "";
let presGasa = "";
let loteVacunaViejo = "";
let loteVacunaNuevo = "";

async function main() {
  exigirEntornoDeDesarrollo("verificar_expediente_bloque_b");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // -------------------------------------------------------------------
  console.log("=== 0. Clínica con catálogo, inventario con dos lotes y un paciente ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@atencion.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  // NINGÚN CORREO REAL: la creación de una cita manda la confirmación al
  // propietario, y en este entorno Resend está configurado. Se apagan
  // los avisos de esta clínica de prueba antes de crear cualquier cita.
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
       VALUES ($1,'Dra. Laura Méndez',$2,'x',true,true,'VET-9911') RETURNING id`,
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
       VALUES ($1,$2,1,'Toby','Canino','Golden Retriever','macho','entero') RETURNING id`,
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

  servicioConsulta = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, especialidad,
                                  codigo_cabys, codigo_tarifa_iva, precio)
       VALUES ($1,'S-CON','Consulta general','consulta','medicina_general','8351000000000','04',
               25000) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  servicioCurado = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_servicios (tenant_id, codigo, nombre, linea_negocio, codigo_cabys,
                                  codigo_tarifa_iva, precio)
       VALUES ($1,'S-CUR','Curación de herida','consulta','8351000000000','04',8000)
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  const vacuna = await crearProducto("P-VAC", "Vacuna polivalente", "vacunacion", "dosis");
  presVacuna = await crearPresentacion(vacuna, "V1", "Dosis", 1, 12000);
  const despara = await crearProducto("P-DES", "Desparasitante interno", "farmacia", "tableta");
  presDespara = await crearPresentacion(despara, "D1", "Tableta", 1, 3500);
  const antibiotico = await crearProducto(
    "P-AMO",
    "Amoxicilina 500 mg",
    "farmacia",
    "tableta",
    "amoxicilina"
  );
  presAntibiotico = await crearPresentacion(antibiotico, "A1", "Tableta", 1, 600);
  const gasa = await crearProducto("P-GAS", "Gasa estéril", "farmacia", "unidad");
  presGasa = await crearPresentacion(gasa, "G1", "Unidad", 1, 300);

  // EL CURADO CONSUME GASAS y no las cobra aparte: su costo está en el
  // precio del servicio. Es la "receta de insumos" del prompt.
  await pool.query(
    `INSERT INTO inv_servicio_insumos (tenant_id, servicio_id, presentacion_id, cantidad)
     VALUES ($1,$2,$3,3)`,
    [tenantId, servicioCurado, presGasa]
  );

  // DOS LOTES de la vacuna, con vencimientos distintos: así se puede
  // comprobar que sale el que el médico eligió y no el que FEFO habría
  // elegido solo.
  await conAlcanceTenant(tenantId, async (db) => {
    const viejo = await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: vacuna,
      bodegaId,
      cantidadBase: 5,
      lote: { numero: "VAC-VIEJO", vencimiento: "2027-01-31", costoUnitario: 5000 },
    });
    loteVacunaViejo = viejo[0].loteId;
    const nuevo = await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: vacuna,
      bodegaId,
      cantidadBase: 5,
      lote: { numero: "VAC-NUEVO", vencimiento: "2029-12-31", costoUnitario: 5200 },
    });
    loteVacunaNuevo = nuevo[0].loteId;
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: despara,
      bodegaId,
      cantidadBase: 10,
      lote: { numero: "DES-1", vencimiento: "2028-06-30", costoUnitario: 1200 },
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: antibiotico,
      bodegaId,
      cantidadBase: 100,
      lote: { numero: "AMO-1", vencimiento: "2028-06-30", costoUnitario: 200 },
    });
    await registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: gasa,
      bodegaId,
      cantidadBase: 20,
      lote: { numero: "GAS-1", costoUnitario: 100 },
    });
  });
  assert(!!toby && !!loteVacunaNuevo, "clínica, catálogo, dos lotes de vacuna y un paciente");

  // -------------------------------------------------------------------
  console.log("\n=== 1. Abrir la atención con su plantilla ===");
  const cita = await pool.query<{ id: string }>(
    `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                        duracion_minutos, motivo_consulta, estado)
     VALUES ($1,$2,$3,CURRENT_DATE,'09:00','09:30',30,'Control anual','en_consulta')
     RETURNING id`,
    [tenantId, toby, medicoId]
  );
  const atencion = await conAlcanceTenant(tenantId, (db) =>
    abrirAtencion(db, tenantId, {
      citaId: cita.rows[0].id,
      medicoId,
      tipoConsulta: "consulta_general",
    })
  );
  igual(
    [atencion.creada, atencion.estado],
    [true, "borrador"],
    "la atención nace en borrador, no cerrada"
  );

  const conPlantilla = await conAlcanceTenant(tenantId, (db) => atencionCompleta(db, atencion.id));
  const sistemas = conPlantilla.sistemas as Array<{ sistema: string; estado: string }>;
  assert(
    sistemas.length >= 10 && sistemas.every((s) => s.estado === "no_evaluado"),
    "la plantilla deja los sistemas a examinar, todos en 'no evaluado'",
    `${sistemas.length} sistemas`
  );
  assert(
    sistemas.every((s) => s.estado !== "normal"),
    "y NINGUNO arranca en 'normal': no haberlos mirado no es haberlos encontrado bien"
  );
  // EL ORDEN ES EL DE LA PLANTILLA y no cambia entre dos lecturas: los
  // doce se insertan en la misma transacción, así que ordenar por
  // `creado_en` devolvía un orden distinto cada vez. Se vio en el
  // navegador (migración 106).
  igual(
    sistemas[0].sistema,
    "Actitud y estado general",
    "el examen se lee en el orden de la plantilla, de lo general a lo particular"
  );
  const otraLectura = (
    (await conAlcanceTenant(tenantId, (db) => atencionCompleta(db, atencion.id)))
      .sistemas as Array<{ sistema: string }>
  ).map((s) => s.sistema);
  igual(
    otraLectura,
    sistemas.map((s) => s.sistema),
    "y dos lecturas seguidas devuelven el MISMO orden"
  );

  // Reaplicar la plantilla no puede borrar lo escrito.
  await conAlcanceTenant(tenantId, (db) =>
    guardarSoap(db, atencion.id, { anamnesis: "Come bien, sin vómitos." })
  );
  await conAlcanceTenant(tenantId, (db) =>
    aplicarPlantilla(db, tenantId, atencion.id, "consulta_general")
  );
  const tras = await conAlcanceTenant(tenantId, (db) => atencionCompleta(db, atencion.id));
  igual(
    (tras.atencion as { anamnesis: string }).anamnesis,
    "Come bien, sin vómitos.",
    "volver a aplicar la plantilla NO borra lo que el médico ya escribió"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. El SOAP y el examen por sistemas ===");
  await conAlcanceTenant(tenantId, (db) =>
    guardarSoap(db, atencion.id, {
      motivo_consulta: "Control anual y vacunación",
      peso: 32.4,
      temperatura: 38.6,
      frecuencia_cardiaca: 96,
      frecuencia_respiratoria: 24,
      condicion_corporal: 6,
      mucosas: "rosadas",
      hidratacion: "normal",
      evaluacion: "Paciente sano. Sobrepeso leve. Otitis externa derecha incipiente.",
      plan_tratamiento: "Vacunación anual, desparasitación y antibiótico por 7 días.",
      indicaciones_cliente: "Dar la tableta con comida. Volver en 15 días a control de oído.",
    })
  );
  await debeFallar("una condición corporal de 12 en una escala de 9", () =>
    conAlcanceTenant(tenantId, (db) => guardarSoap(db, atencion.id, { condicion_corporal: 12 }))
  );

  await conAlcanceTenant(tenantId, async (db) => {
    await marcarSistema(db, tenantId, atencion.id, "Oídos", "anormal", "Eritema en pabellón derecho");
    await marcarSistema(db, tenantId, atencion.id, "Cardiovascular", "normal");
    // Marcar normal después de anormal tiene que limpiar la nota.
    await marcarSistema(db, tenantId, atencion.id, "Piel y pelaje", "anormal", "Se corrigió");
    await marcarSistema(db, tenantId, atencion.id, "Piel y pelaje", "normal");
  });
  const examen = (
    (await conAlcanceTenant(tenantId, (db) => atencionCompleta(db, atencion.id)))
      .sistemas as Array<{ sistema: string; estado: string; nota: string | null }>
  );
  igual(
    examen.find((s) => s.sistema === "Oídos")?.nota,
    "Eritema en pabellón derecho",
    "lo anormal lleva su nota"
  );
  igual(
    examen.find((s) => s.sistema === "Piel y pelaje")?.nota,
    null,
    "y al volver a 'normal' la nota se va: un sistema no puede decir dos cosas a la vez"
  );

  const diagnostico = await conAlcanceTenant(tenantId, (db) =>
    agregarDiagnostico(db, tenantId, {
      atencionId: atencion.id,
      tipo: "definitivo",
      descripcion: "Otitis externa derecha",
      personaId: medicoId,
      aLaListaDeProblemas: true,
    })
  );
  assert(
    diagnostico.problemaId !== null,
    "un diagnóstico puede pasar a la lista de problemas del paciente",
    diagnostico.problemaId
  );
  const problema = await pool.query<{ descripcion: string; estado: string }>(
    `SELECT descripcion, estado FROM exp_problemas WHERE id = $1`,
    [diagnostico.problemaId]
  );
  igual(
    [problema.rows[0].descripcion, problema.rows[0].estado],
    ["Otitis externa derecha", "activo"],
    "y el problema queda UNO solo, con su descripción, no una copia"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. El aviso de alergia ANTES de recetar ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarAlergia(db, tenantId, {
      pacienteId: toby,
      sustancia: "Amoxicilina",
      severidad: "moderada",
      reaccion: "Urticaria",
      personaId: medicoId,
    })
  );
  const avisos = await conAlcanceTenant(tenantId, (db) =>
    avisosAlRecetar(db, toby, presAntibiotico)
  );
  assert(
    avisos.length === 1 && avisos[0].severidad === "moderada",
    "recetar amoxicilina al paciente alérgico AVISA, con su severidad y su reacción",
    avisos
  );
  const sinAviso = await conAlcanceTenant(tenantId, (db) => avisosAlRecetar(db, toby, presVacuna));
  igual(sinAviso.length, 0, "y la vacuna no avisa: un aviso de más también cansa");

  // -------------------------------------------------------------------
  console.log("\n=== 4. Lo realizado, elegido del catálogo ===");
  await conAlcanceTenant(tenantId, async (db) => {
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "servicio", servicioId: servicioConsulta, cantidad: 1 },
      medicoId
    );
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "servicio", servicioId: servicioCurado, cantidad: 1 },
      medicoId
    );
    // LA VACUNA CON SU LOTE: el médico elige el frasco que tiene en la
    // mano, y no es el que FEFO habría elegido.
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      {
        tipo: "vacuna",
        presentacionId: presVacuna,
        loteId: loteVacunaNuevo,
        cantidad: 1,
        preventivo: {
          tipo: "vacunacion",
          nombre: "Polivalente",
          proxima: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
        },
      },
      medicoId
    );
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      {
        tipo: "desparasitacion",
        presentacionId: presDespara,
        cantidad: 1,
        preventivo: {
          tipo: "desparasitacion",
          nombre: "Desparasitante interno",
          subtipo: "interna",
          proxima: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10),
        },
      },
      medicoId
    );
    // LA RECETA DISPENSADA ACÁ: se cobra y descarga stock.
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "receta", presentacionId: presAntibiotico, cantidad: 14 },
      medicoId
    );
    // Y UN ÍTEM QUE EL CLIENTE COMPRA AFUERA: no se cobra ni descarga.
    await agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "receta", presentacionId: presGasa, cantidad: 5, dispensadoAqui: false },
      medicoId
    );
  });

  const cuenta = await conAlcanceTenant(tenantId, (db) => cuentaViva(db, atencion.id));
  igual(cuenta.items.length, 6, "seis ítems en la atención");
  // 25 000 + 8 000 + 12 000 + 3 500 + 14 × 600 = 56 900. La gasa que el
  // cliente compra afuera (5 × 300 = 1 500) NO entra.
  igual(cuenta.total, 56900, "la cuenta viva suma solo lo que vendemos nosotros");
  igual(cuenta.yaCobrado, 0, "y todavía no hay nada cobrado: la atención está en borrador");

  const haySinCargo = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM vta_cargos WHERE tenant_id = $1`,
    [tenantId]
  );
  igual(
    haySinCargo.rows[0].n,
    "0",
    "NINGÚN cargo existe todavía: mientras la atención no se cierra no hay plata"
  );

  await debeFallar("un ítem escrito a mano, sin catálogo", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarItem(db, tenantId, atencion.id, { tipo: "servicio", cantidad: 1 }, medicoId)
    )
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Si falta stock, NO queda nada a medias ===");
  //
  // Se piden 50 dosis de una vacuna de la que hay 9. El cierre tiene que
  // fallar entero: sin cuenta, sin cargos, sin movimientos y con la
  // atención todavía en borrador.
  const itemImposible = await conAlcanceTenant(tenantId, (db) =>
    agregarItem(
      db,
      tenantId,
      atencion.id,
      { tipo: "producto", presentacionId: presVacuna, cantidad: 50 },
      medicoId
    )
  );

  await debeFallar("cerrar con una vacuna que no alcanza", () =>
    conAlcanceTenant(tenantId, (db) =>
      cerrarAtencion(db, tenantId, atencion.id, { personaId: medicoId })
    )
  );

  const despuesDelFallo = await pool.query<{
    cargos: string;
    movimientos: string;
    cuentas: string;
    preventivos: string;
    estado: string;
  }>(
    `SELECT (SELECT count(*) FROM vta_cargos WHERE tenant_id = $1) AS cargos,
            (SELECT count(*) FROM inv_movimientos
              WHERE tenant_id = $1 AND tipo = 'atencion') AS movimientos,
            (SELECT count(*) FROM vta_cuentas WHERE tenant_id = $1) AS cuentas,
            (SELECT count(*) FROM cuidados_preventivos WHERE tenant_id = $1) AS preventivos,
            (SELECT estado FROM atenciones WHERE id = $2) AS estado`,
    [tenantId, atencion.id]
  );
  igual(
    [
      despuesDelFallo.rows[0].cargos,
      despuesDelFallo.rows[0].movimientos,
      despuesDelFallo.rows[0].cuentas,
      despuesDelFallo.rows[0].preventivos,
      despuesDelFallo.rows[0].estado,
    ],
    ["0", "0", "0", "0", "borrador"],
    "NADA quedó a medias: ni cuenta, ni cargos, ni movimientos, ni preventivos"
  );

  await conAlcanceTenant(tenantId, (db) => quitarItem(db, atencion.id, itemImposible.id));

  // -------------------------------------------------------------------
  console.log("\n=== 5b. Firmar sin cobrar: la base no lo deja ===");
  //
  // Defecto real: el bloque A tenia su propia ruta de cierre que SOLO
  // firmaba, y al llegar el bloque B quedaron dos rutas con la misma
  // URL. Express atendio la primera: la atencion quedo firmada y los
  // cargos afuera, con `cuenta_id` en NULL. La ruta duplicada ya no
  // esta, y ademas la base lo impide por cualquier camino (migracion
  // 107).
  await debeFallar("firmar la atencion salteando el cierre completo", () =>
    conAlcanceTenant(tenantId, (db) => cerrarYFirmarAtencion(db, atencion.id, medicoId))
  );
  const siguenEnBorrador = await pool.query<{ estado: string }>(
    `SELECT estado FROM atenciones WHERE id = $1`,
    [atencion.id]
  );
  igual(
    siguenEnBorrador.rows[0].estado,
    "borrador",
    "y la atencion sigue en borrador: no quedo firmada a medias"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. El cierre, en una sola operación ===");
  const gasaAntes = await stockDe(presGasa);
  await conAlcanceTenant(tenantId, (db) =>
    guardarSoap(db, atencion.id, {
      control_fecha: new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10),
      control_motivo: "Control de otitis",
    })
  );

  const cierre = await conAlcanceTenant(tenantId, (db) =>
    cerrarAtencion(db, tenantId, atencion.id, { personaId: medicoId })
  );
  igual(
    [cierre.cargos, cierre.preventivos],
    [5, 2],
    "cinco cargos (lo que vendemos) y dos preventivos (vacuna y desparasitación)"
  );
  igual(cierre.total, 56900, "el total de los cargos es el de la cuenta viva, sin sorpresas");
  assert(cierre.controlCitaId !== null, "el control quedó agendado como una cita", cierre.controlCitaId);

  const enCaja = await conAlcanceTenant(tenantId, (db) => totalDeCuenta(db, cierre.cuentaId));
  assert(
    enCaja.neto === 56900 && enCaja.saldo > 56900,
    "la cuenta espera en la caja con su neto y su IVA calculado por la caja",
    { neto: enCaja.neto, saldoConIva: enCaja.saldo }
  );

  const cuentaAbierta = await pool.query<{ estado: string; propietario_id: string }>(
    `SELECT estado, propietario_id FROM vta_cuentas WHERE id = $1`,
    [cierre.cuentaId]
  );
  igual(
    [cuentaAbierta.rows[0].estado, cuentaAbierta.rows[0].propietario_id === propietarioId],
    ["abierta", true],
    "y es la cuenta del dueño del paciente, abierta: eso es el aviso a la caja"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 7. El inventario: por lote, con origen atención y paciente ===");
  const movimientos = await pool.query<{
    tipo: string;
    lote: string;
    cantidad_base: string;
    producto: string;
    paciente_id: string | null;
    atencion_id: string | null;
  }>(
    `SELECT m.tipo, l.numero AS lote, m.cantidad_base, p.nombre AS producto,
            m.paciente_id, m.atencion_id
       FROM inv_movimientos m
       JOIN inv_lotes l ON l.id = m.lote_id
       JOIN inv_productos p ON p.id = m.producto_id
      WHERE m.tenant_id = $1 AND m.tipo = 'atencion'
      ORDER BY p.nombre`,
    [tenantId]
  );
  assert(
    movimientos.rows.length === 4,
    "cuatro salidas de inventario: vacuna, desparasitante, antibiótico y las gasas del curado",
    movimientos.rows.map((m) => `${m.producto}/${m.lote}/${m.cantidad_base}`)
  );
  assert(
    movimientos.rows.every((m) => m.paciente_id === toby && m.atencion_id === atencion.id),
    "TODAS llevan el paciente y la atención: el kardex puede decir en qué visita se usó"
  );
  const salidaVacuna = movimientos.rows.find((m) => m.producto.includes("Vacuna"));
  igual(
    salidaVacuna?.lote,
    "VAC-NUEVO",
    "la vacuna salió del lote QUE ELIGIÓ EL MÉDICO, no del que FEFO habría tomado"
  );
  const gasas = movimientos.rows.find((m) => m.producto.includes("Gasa"));
  igual(
    Number(gasas?.cantidad_base),
    3,
    "las 3 gasas del curado se consumieron, aunque no se cobran aparte"
  );

  const gasaDespues = await stockDe(presGasa);
  igual(
    gasaAntes - gasaDespues,
    3,
    "la existencia de gasas bajó exactamente en 3, no en las 5 que el cliente compra afuera"
  );

  const loteViejoIntacto = await pool.query<{ cantidad: string }>(
    `SELECT cantidad FROM inv_lotes WHERE id = $1`,
    [loteVacunaViejo]
  );
  igual(
    Number(loteViejoIntacto.rows[0].cantidad),
    5,
    "el lote viejo quedó intacto: nadie lo tocó por 'eficiencia'"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. Los recordatorios y la cita ===");
  const preventivos = await pool.query<{
    tipo: string;
    vacuna: string | null;
    lote: string | null;
    producto_desparasitacion: string | null;
    proxima: string;
  }>(
    `SELECT tipo, vacuna, lote, producto_desparasitacion,
            fecha_proxima_recomendada::text AS proxima
       FROM cuidados_preventivos WHERE tenant_id = $1 ORDER BY tipo`,
    [tenantId]
  );
  igual(
    preventivos.rows.map((p) => p.tipo),
    ["desparasitacion", "vacunacion"],
    "los dos preventivos quedaron en la tabla que el job diario mira para avisar"
  );
  igual(
    preventivos.rows.find((p) => p.tipo === "vacunacion")?.lote,
    "VAC-NUEVO",
    "y la vacuna guardó SU LOTE: es el dato que un reclamo sanitario necesita"
  );
  assert(
    preventivos.rows.every((p) => !!p.proxima),
    "los dos tienen fecha próxima: sin eso el recordatorio no sale nunca",
    preventivos.rows.map((p) => p.proxima)
  );

  const citaEstado = await pool.query<{ estado: string }>(
    `SELECT estado FROM citas WHERE id = $1`,
    [cita.rows[0].id]
  );
  igual(citaEstado.rows[0].estado, "completada", "la cita de la visita quedó completada");

  const citaControl = await pool.query<{ estado: string; motivo_consulta: string; fecha: string }>(
    `SELECT estado, motivo_consulta, fecha::text FROM citas WHERE id = $1`,
    [cierre.controlCitaId!]
  );
  igual(
    [citaControl.rows[0].estado, citaControl.rows[0].motivo_consulta],
    ["programada", "Control de otitis"],
    "y el control es una cita programada, de donde sale su propio recordatorio"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. Un cargo no llega dos veces ===");
  const segundoCierre = await conAlcanceTenant(tenantId, (db) =>
    cerrarAtencion(db, tenantId, atencion.id, { personaId: medicoId })
  );
  igual(
    [segundoCierre.yaEstabaCerrada, segundoCierre.cargos, segundoCierre.cuentaId === cierre.cuentaId],
    [true, 0, true],
    "cerrar dos veces no agrega NADA y devuelve la misma cuenta"
  );
  const cargosTotales = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM vta_cargos WHERE tenant_id = $1`,
    [tenantId]
  );
  igual(cargosTotales.rows[0].n, "5", "siguen siendo cinco cargos, no diez");

  const movimientosTotales = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM inv_movimientos WHERE tenant_id = $1 AND tipo = 'atencion'`,
    [tenantId]
  );
  igual(movimientosTotales.rows[0].n, "4", "y cuatro movimientos, no ocho");

  // -------------------------------------------------------------------
  console.log("\n=== 10. Una atención cerrada no se edita ===");
  await debeFallar("editar el SOAP de una atención firmada", () =>
    conAlcanceTenant(tenantId, (db) =>
      guardarSoap(db, atencion.id, { evaluacion: "Otra cosa" })
    )
  );
  await debeFallar("agregar un ítem a una atención firmada", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarItem(
        db,
        tenantId,
        atencion.id,
        { tipo: "servicio", servicioId: servicioConsulta, cantidad: 1 },
        medicoId
      )
    )
  );
  await debeFallar("borrar un ítem ya cobrado", () =>
    pool.query(
      `DELETE FROM exp_atencion_items WHERE atencion_id = $1 AND cargo_id IS NOT NULL`,
      [atencion.id]
    )
  );
  await debeFallar("cambiar el examen de una atención firmada", () =>
    pool.query(`UPDATE exp_examen_sistemas SET estado = 'normal' WHERE atencion_id = $1`, [
      atencion.id,
    ])
  );

  const firma = await pool.query<{ firmada_nombre: string; cerrada_en: string }>(
    `SELECT firmada_nombre, cerrada_en::text FROM atenciones WHERE id = $1`,
    [atencion.id]
  );
  igual(
    firma.rows[0].firmada_nombre,
    "Dra. Laura Méndez",
    "la atención quedó firmada con el nombre de quien la cerró"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 11. Atención SIN CITA PREVIA ===");
  const sinCita = await conAlcanceTenant(tenantId, (db) =>
    abrirAtencion(db, tenantId, {
      pacienteId: toby,
      medicoId,
      motivoConsulta: "Llegó cojeando, sin turno",
      tipoConsulta: "urgencia",
    })
  );
  assert(sinCita.creada && !!sinCita.citaId, "se abrió la atención y la cita se creó sola");
  const citaNueva = await pool.query<{ estado: string; motivo_consulta: string }>(
    `SELECT estado, motivo_consulta FROM citas WHERE id = $1`,
    [sinCita.citaId]
  );
  igual(
    [citaNueva.rows[0].estado, citaNueva.rows[0].motivo_consulta],
    ["en_consulta", "Llegó cojeando, sin turno"],
    "y la cita dice la verdad: el paciente está adentro, sin turno previo"
  );

  await debeFallar("cerrar una atención sin evaluación ni nota", () =>
    conAlcanceTenant(tenantId, (db) =>
      cerrarAtencion(db, tenantId, sinCita.id, { personaId: medicoId })
    )
  );

  // Una urgencia que no genera cargos es legítima: se cierra igual, con
  // su cuenta en cero.
  await conAlcanceTenant(tenantId, (db) =>
    guardarSoap(db, sinCita.id, { evaluacion: "Contractura muscular. Reposo." })
  );
  const cierreUrgencia = await conAlcanceTenant(tenantId, (db) =>
    cerrarAtencion(db, tenantId, sinCita.id, { personaId: medicoId })
  );
  igual(
    [cierreUrgencia.cargos, cierreUrgencia.total],
    [0, 0],
    "una atención sin nada que cobrar se cierra igual, con su cuenta en cero"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 12. RLS: la atención de otra clínica no se ve ===");
  const otro = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','otra@atencion.test','CR') RETURNING id`,
      [`${PREFIJO}-otra`]
    )
  ).rows[0].id;
  const desdeOtra = await conAlcanceTenant(otro, (db) =>
    db.query(`SELECT count(*)::int AS n FROM exp_atencion_items`)
  );
  igual(
    desdeOtra.rows[0].n,
    0,
    "desde otra clínica, cero ítems de atención: el aislamiento vale también acá"
  );

  // -------------------------------------------------------------------
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

/** El stock en unidad base del producto de una presentación. */
async function stockDe(presentacionId: string): Promise<number> {
  const r = await pool.query<{ total: string }>(
    `SELECT COALESCE(sum(l.cantidad), 0)::text AS total
       FROM inv_lotes l
      WHERE l.producto_id = (SELECT producto_id FROM inv_presentaciones WHERE id = $1)
        AND l.tenant_id = $2`,
    [presentacionId, tenantId]
  );
  return Number(r.rows[0].total);
}

async function crearProducto(
  codigo: string,
  nombre: string,
  linea: string,
  unidad: string,
  principioActivo?: string
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                codigo_cabys, codigo_tarifa_iva, principio_activo)
     VALUES ($1,$2,$3,$4,$5,'3564012000000','08',$6) RETURNING id`,
    [tenantId, codigo, nombre, linea, unidad, principioActivo ?? null]
  );
  return r.rows[0].id;
}

async function crearPresentacion(
  productoId: string,
  codigo: string,
  nombre: string,
  factor: number,
  precio: number
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                     unidad_medida, precio_venta, para_venta)
     VALUES ($1,$2,$3,$4,$5,'Unid',$6,true) RETURNING id`,
    [tenantId, productoId, codigo, nombre, factor, precio]
  );
  return r.rows[0].id;
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
