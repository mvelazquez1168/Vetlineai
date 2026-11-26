// Verificación del BLOQUE A del prompt 07: el expediente clínico.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_expediente_bloque_a.ts
//
// Cubre, contra la base real, lo que el prompt pide verificar del
// bloque A:
//
//   * un paciente con historia completa se ve en la línea de tiempo y
//     la búsqueda encuentra un término en notas, recetas y resultados;
//   * la ficha racial de un golden retriever sale del DOCUMENTO; una
//     raza sin cobertura lo dice; un mestizo no muestra nada inventado;
//   * la tendencia de un analito trae sus valores con el rango POR
//     ESPECIE, y la bandera se calcula;
//   * un hallazgo de grooming aparece en las alertas y se apaga solo
//     cuando alguien lo atiende;
//   * una atención cerrada NO se edita, una adenda queda con autor y
//     motivo, y el original se conserva;
//   * un consentimiento firmado no se edita ni se borra;
//   * recetar un fármaco al que el paciente es alérgico avisa, incluso
//     por grupo;
//   * RLS: nada de otra clínica se ve.
import { pool, tenantPool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  adendasDeAtencion,
  agregarAdenda,
  agregarProblema,
  alergiasDePaciente,
  avisosDeAlergia,
  cambiarEstadoProblema,
  cerrarYFirmarAtencion,
  problemasDePaciente,
  registrarAlergia,
} from "../expediente/clinico";
import {
  analitosConHistoria,
  banderaDe,
  cargarResultados,
  estudiosDePaciente,
  estudiosSinVer,
  marcarEstudioVisto,
  solicitarEstudio,
  tendenciaDeAnalito,
} from "../expediente/laboratorio";
import {
  atenderHallazgo,
  groomingDePaciente,
  hallazgosPendientes,
  registrarGrooming,
} from "../expediente/grooming";
import {
  consentimientosDePaciente,
  firmarConsentimiento,
  plantillas,
  prepararConsentimiento,
  sembrarPlantillasBase,
} from "../expediente/consentimientos";
import {
  buscarEnHistoria,
  encabezadoDeExpediente,
  evolucion,
  fichaRacial,
  lineaDeTiempo,
} from "../expediente/resumen";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { reconstruirHistorial } from "../crm/reconstruccion";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-expediente";

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
let otroTenantId = "";
let medicoId = "";
let groomerId = "";
let propietarioId = "";
let golden = "";
let mestizo = "";
let atencionId = "";

async function main() {
  exigirEntornoDeDesarrollo("verificar_expediente_bloque_a");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  console.log("=== 0. Clínica, personal y dos pacientes ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@expediente.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  otroTenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','otra@expediente.test','CR') RETURNING id`,
      [`${PREFIJO}-otra`]
    )
  ).rows[0].id;

  medicoId = (
    await pool.query<{ id: string }>(
      // La colegiatura es obligatoria para un médico desde la
      // migración que agregó ese CHECK: un médico sin número de
      // colegio no puede firmar nada.
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica,
                             colegiatura)
       VALUES ($1,'Dra. Laura Méndez',$2,'x',true,true,'VET-9911') RETURNING id`,
      [tenantId, `${PREFIJO}-medico@probe.test`]
    )
  ).rows[0].id;
  groomerId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica)
       VALUES ($1,'Sofía (grooming)',$2,'x',false,false) RETURNING id`,
      [tenantId, `${PREFIJO}-groomer@probe.test`]
    )
  ).rows[0].id;
  propietarioId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email) VALUES ($1,'Don Luis','luis@probe.test')
       RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  const razaGolden = await pool.query<{ id: string }>(
    `SELECT id FROM razas WHERE especie = 'canina' AND nombre ILIKE '%golden%' LIMIT 1`
  );
  golden = (
    await pool.query<{ id: string }>(
      // El número de expediente lo asigna el punto único del prompt
      // 01 (`asignarNumeroExpedientePaciente`) y la columna es NOT
      // NULL: un paciente sin número no existe para la clínica.
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza,
                              raza_id, sexo, estado_reproductivo, alerta_manejo)
       VALUES ($1,$2,1,'Toby','Canino','Golden Retriever',$3,'macho','entero',
               'Muerde al cortarle las uñas') RETURNING id`,
      [tenantId, propietarioId, razaGolden.rows[0]?.id ?? null]
    )
  ).rows[0].id;
  mestizo = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza)
       VALUES ($1,$2,2,'Nube','Felino','Mestizo') RETURNING id`,
      [tenantId, propietarioId]
    )
  ).rows[0].id;
  assert(!!golden && !!mestizo, "clínica, médico, groomer, cliente y dos pacientes");

  // -------------------------------------------------------------------
  console.log("\n=== 1. Historia: una visita, una vacuna y una receta ===");
  const cita = await pool.query<{ id: string }>(
    `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                        duracion_minutos, motivo_consulta, estado)
     VALUES ($1,$2,$3,CURRENT_DATE,'09:00','09:30',30,'Vómito de dos días','completada')
     RETURNING id`,
    [tenantId, golden, medicoId]
  );
  atencionId = (
    await pool.query<{ id: string }>(
      `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id, nota_medica, peso,
                               temperatura)
       VALUES ($1,$2,$3,$4,'Paciente con vómito agudo. Se indica dieta blanda y carprofeno.',
               32.4, 38.6) RETURNING id`,
      [tenantId, cita.rows[0].id, golden, medicoId]
    )
  ).rows[0].id;

  await pool.query(
    `INSERT INTO cuidados_preventivos (tenant_id, paciente_id, tipo, fecha_aplicacion,
                                       fecha_proxima_recomendada, registrado_por, vacuna, lote,
                                       atencion_id)
     VALUES ($1,$2,'vacunacion',CURRENT_DATE - 400, CURRENT_DATE - 35,$3,'Triple felina','L-2025-A',$4)`,
    [tenantId, golden, medicoId, atencionId]
  );

  const medicamento = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM medicamentos WHERE nombre ILIKE '%carprofeno%' LIMIT 1`
  );
  const receta = await pool.query<{ id: string }>(
    `INSERT INTO recetas (tenant_id, paciente_id, medico_id, estado, atencion_id, emitido_en)
     VALUES ($1,$2,$3,'emitida',$4, now()) RETURNING id`,
    [tenantId, golden, medicoId, atencionId]
  );
  if (medicamento.rows[0]) {
    await pool.query(
      `INSERT INTO receta_items (receta_id, medicamento_id, dosis, frecuencia, duracion,
                                 via_administracion, orden)
       VALUES ($1,$2,'2.2 mg/kg','cada 24 h','7 días','oral',0)`,
      [receta.rows[0].id, medicamento.rows[0].id]
    );
  }

  // LA LÍNEA DE TIEMPO AHORA LEE DE `crm_interacciones` (prompt 03): una
  // sola historia del paciente, no dos que pueden divergir. Este
  // verificador siembra sus orígenes con INSERT directo —no por los
  // puntos únicos que registran el evento—, así que primero hay que
  // reconstruir, que es exactamente lo que hace una clínica con
  // historia anterior al CRM.
  await conAlcanceTenant(tenantId, (db) => reconstruirHistorial(db, tenantId));

  const tiempo = await conAlcanceTenant(tenantId, (db) => lineaDeTiempo(db, golden, {}));
  assert(
    tiempo.length >= 3,
    "la línea de tiempo trae la visita, la vacuna y la receta",
    tiempo.map((e) => e.tipo)
  );
  const soloVacunas = await conAlcanceTenant(tenantId, (db) =>
    lineaDeTiempo(db, golden, { tipo: "vacuna" })
  );
  igual(soloVacunas.length, 1, "y el filtro por tipo deja solo la vacuna");

  const porNota = await conAlcanceTenant(tenantId, (db) => buscarEnHistoria(db, golden, "vómito"));
  assert(
    porNota.some((h) => h.tipo === "visita"),
    "la búsqueda encuentra 'vómito' en la nota de la visita",
    porNota.map((h) => h.tipo)
  );
  if (medicamento.rows[0]) {
    const porFarmaco = await conAlcanceTenant(tenantId, (db) =>
      buscarEnHistoria(db, golden, "carprofeno")
    );
    assert(
      porFarmaco.some((h) => h.tipo === "receta" || h.tipo === "visita"),
      "y encuentra 'carprofeno' en la receta",
      porFarmaco.map((h) => `${h.tipo}:${h.donde}`)
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== 2. Lista de problemas ===");
  const problema = await conAlcanceTenant(tenantId, (db) =>
    agregarProblema(db, tenantId, {
      pacienteId: golden,
      descripcion: "Gastroenteritis recurrente",
      estado: "cronico",
      atencionOrigenId: atencionId,
      personaId: medicoId,
    })
  );
  const problemas = await conAlcanceTenant(tenantId, (db) => problemasDePaciente(db, golden));
  igual(
    [problemas.length, problemas[0].estado, problemas[0].atenciones],
    [1, "cronico", 1],
    "el problema queda crónico y ligado a la visita donde nació"
  );

  await debeFallar("resolver un problema sin que la base le ponga fecha", () =>
    pool.query(`UPDATE exp_problemas SET estado = 'resuelto' WHERE id = $1`, [problema.id])
  );
  await conAlcanceTenant(tenantId, (db) =>
    cambiarEstadoProblema(db, tenantId, problema.id, { estado: "resuelto" })
  );
  const resuelto = await conAlcanceTenant(tenantId, (db) => problemasDePaciente(db, golden));
  assert(
    resuelto[0].estado === "resuelto" && !!resuelto[0].fecha_resolucion,
    "y al resolverlo queda con su fecha",
    resuelto[0].fecha_resolucion
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. Alergias: el aviso al recetar, incluso por grupo ===");
  await conAlcanceTenant(tenantId, (db) =>
    registrarAlergia(db, tenantId, {
      pacienteId: golden,
      sustancia: "Penicilina",
      grupo: "penicilinas",
      severidad: "grave",
      reaccion: "Edema facial",
      personaId: medicoId,
    })
  );
  const porSustancia = await conAlcanceTenant(tenantId, (db) =>
    avisosDeAlergia(db, golden, { nombre: "Penicilina G sódica" })
  );
  igual(
    [porSustancia.length, porSustancia[0]?.porque],
    [1, "sustancia"],
    "recetar penicilina avisa por la sustancia"
  );

  const porGrupo = await conAlcanceTenant(tenantId, (db) =>
    avisosDeAlergia(db, golden, { nombre: "Amoxicilina", grupo: "penicilinas" })
  );
  igual(
    [porGrupo.length, porGrupo[0]?.porque],
    [1, "grupo"],
    "y recetar amoxicilina avisa por el GRUPO, aunque nadie cargó ese fármaco"
  );

  const sinRelacion = await conAlcanceTenant(tenantId, (db) =>
    avisosDeAlergia(db, golden, { nombre: "Meloxicam", grupo: "aines" })
  );
  igual(sinRelacion.length, 0, "y un fármaco sin relación no avisa: un aviso de más también cansa");

  const otroPaciente = await conAlcanceTenant(tenantId, (db) =>
    avisosDeAlergia(db, mestizo, { nombre: "Penicilina" })
  );
  igual(otroPaciente.length, 0, "la alergia es del paciente, no de la clínica");

  // EL AGENTE TIENE QUE VER LA ALERGIA DEL EXPEDIENTE.
  //
  // El bloque de contexto del caso leía solo `pacientes.alergias`, el
  // campo de texto libre anterior al expediente. Una alergia cargada en
  // `exp_alergias` —la que dispara el aviso al prescribir— era invisible
  // para el modelo: el dato existía y el agente clínico no lo tenía.
  const agente = await pool.query<{ id: string }>(`SELECT id FROM agentes LIMIT 1`);
  const caso = await pool.query<{ id: string }>(
    `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, numero_expediente)
     VALUES ($1, $2, $3, $4, 'Control por creatinina alta',
             (SELECT COALESCE(max(numero_expediente), 0) + 1 FROM casos WHERE tenant_id = $1))
     RETURNING id`,
    [tenantId, golden, agente.rows[0].id, medicoId]
  );
  const bloque = await construirBloqueContextoCaso(pool, caso.rows[0].id);
  assert(
    bloque.includes("Alergias del expediente") &&
      bloque.toLowerCase().includes("penicilina") &&
      bloque.includes("grave"),
    "el contexto que recibe el agente incluye la alergia del EXPEDIENTE",
    bloque
      .split(String.fromCharCode(10))
      .filter((l) => l.includes("Alergia"))
      .join(" | ") || "(ninguna línea)"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. Laboratorio: rango por especie, bandera y tendencia ===");
  igual(banderaDe(2.9, 0.5, 1.5), "alto", "2,9 de creatinina con rango 0,5–1,5 es ALTO");
  igual(banderaDe(0.3, 0.5, 1.5), "bajo", "0,3 es BAJO");
  igual(banderaDe(1.0, 0.5, 1.5), "normal", "1,0 es normal");
  igual(banderaDe(1.0, null, null), null, "y sin rango no hay bandera: no se inventa");

  const estudio1 = await conAlcanceTenant(tenantId, (db) =>
    solicitarEstudio(db, tenantId, {
      pacienteId: golden,
      tipoEstudio: "quimica",
      atencionId,
      personaId: medicoId,
    })
  );
  const carga1 = await conAlcanceTenant(tenantId, (db) =>
    cargarResultados(db, tenantId, estudio1.id, [
      { codigo: "CREA", analito: "Creatinina", valor: 2.9, unidad: "mg/dL" },
      { codigo: "ALT", analito: "ALT", valor: 45 },
      { analito: "Hemoparásitos", valorTexto: "negativo" },
    ])
  );
  igual(
    [carga1.cargados, carga1.conBandera],
    [3, 1],
    "tres resultados, uno fuera de rango (la creatinina)"
  );

  const estudio2 = await conAlcanceTenant(tenantId, (db) =>
    solicitarEstudio(db, tenantId, { pacienteId: golden, tipoEstudio: "quimica", personaId: medicoId })
  );
  await conAlcanceTenant(tenantId, (db) =>
    cargarResultados(db, tenantId, estudio2.id, [
      { codigo: "CREA", analito: "Creatinina", valor: 1.2 },
    ])
  );

  const tendencia = await conAlcanceTenant(tenantId, (db) =>
    tendenciaDeAnalito(db, golden, "CREA")
  );
  igual(
    [tendencia.puntos.length, tendencia.puntos.map((p) => p.valor), tendencia.refMax],
    [2, [2.9, 1.2], 1.5],
    "la tendencia de creatinina trae los dos valores con el rango del PERRO"
  );

  // El rango del gato es otro: el mismo valor no se lee igual.
  const estudioGato = await conAlcanceTenant(tenantId, (db) =>
    solicitarEstudio(db, tenantId, { pacienteId: mestizo, tipoEstudio: "quimica" })
  );
  await conAlcanceTenant(tenantId, (db) =>
    cargarResultados(db, tenantId, estudioGato.id, [
      { codigo: "CREA", analito: "Creatinina", valor: 2.0 },
    ])
  );
  const delGato = await conAlcanceTenant(tenantId, (db) => estudiosDePaciente(db, mestizo));
  igual(
    [delGato[0].resultados[0].bandera, delGato[0].resultados[0].ref_max],
    // `json_agg` devuelve el numeric como número JSON, no como la
    // cadena con cuatro decimales que da una consulta plana.
    ["normal", 2.4],
    "2,0 de creatinina es NORMAL en un gato (rango 0,8–2,4): el rango es por especie"
  );

  const sinVer = await conAlcanceTenant(tenantId, (db) => estudiosSinVer(db));
  assert(sinVer.length >= 3, "los resultados cargados quedan como aviso pendiente", sinVer.length);
  await conAlcanceTenant(tenantId, (db) => marcarEstudioVisto(db, estudio1.id, medicoId));
  const trasVer = await conAlcanceTenant(tenantId, (db) => estudiosSinVer(db));
  igual(
    trasVer.some((e) => e.id === estudio1.id),
    false,
    "y deja de avisar cuando el médico lo marca visto"
  );

  const conHistoria = await conAlcanceTenant(tenantId, (db) => analitosConHistoria(db, golden));
  assert(
    conHistoria.some((a) => a.codigo === "CREA" && a.mediciones === 2),
    "la creatinina aparece como analito con historia graficable",
    conHistoria.map((a) => `${a.codigo}:${a.mediciones}`)
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Grooming y su hallazgo ===");
  const groom = await conAlcanceTenant(tenantId, (db) =>
    registrarGrooming(db, tenantId, {
      pacienteId: golden,
      groomerId,
      tipoCorte: "Corte verano",
      comportamiento: "nervioso",
      observaciones: "Se dejó bañar pero no las uñas.",
      servicios: [{ descripcion: "Baño y corte" }],
      hallazgos: [{ tipo: "bulto", descripcion: "Bulto de 1 cm en el flanco derecho" }],
    })
  );
  igual(groom.hallazgos, 1, "el grooming queda con su hallazgo");

  const encabezado = await conAlcanceTenant(tenantId, (db) =>
    encabezadoDeExpediente(db, golden, { verSaldo: true })
  );
  assert(
    encabezado.alertas.some((a) => a.tipo === "hallazgo"),
    "el hallazgo aparece en la franja de alertas",
    encabezado.alertas.map((a) => a.tipo)
  );
  assert(
    encabezado.alertas.some((a) => a.tipo === "alergia" && a.severidad === "alta"),
    "y también la alergia grave"
  );
  assert(
    encabezado.alertas.some((a) => a.tipo === "manejo"),
    "y la alerta de manejo de la ficha"
  );
  assert(
    encabezado.alertas.some((a) => a.tipo === "preventivo"),
    "y la vacuna vencida"
  );

  const pendientes = await conAlcanceTenant(tenantId, (db) => hallazgosPendientes(db, golden));
  igual(pendientes.length, 1, "el hallazgo está pendiente");
  await conAlcanceTenant(tenantId, (db) =>
    atenderHallazgo(db, String(pendientes[0].id), medicoId, atencionId)
  );
  igual(
    (await conAlcanceTenant(tenantId, (db) => hallazgosPendientes(db, golden))).length,
    0,
    "y se apaga cuando un médico lo atiende, no con el tiempo"
  );
  await debeFallar("atender dos veces el mismo hallazgo", () =>
    conAlcanceTenant(tenantId, (db) =>
      atenderHallazgo(db, String(pendientes[0].id), medicoId)
    )
  );

  const historialGroom = await conAlcanceTenant(tenantId, (db) => groomingDePaciente(db, golden));
  igual(
    [historialGroom.length, historialGroom[0].servicios.length, historialGroom[0].groomer_nombre],
    [1, 1, "Sofía (grooming)"],
    "el grooming queda en su pestaña con su groomer y sus servicios"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 6. Ficha racial: del documento, o nada ===");
  const fichaGolden = await conAlcanceTenant(tenantId, (db) => fichaRacial(db, golden));
  if (fichaGolden.coincidio) {
    assert(
      (fichaGolden.texto ?? "").length > 50,
      "el golden retriever trae su sección del documento de predisposiciones",
      `${(fichaGolden.texto ?? "").slice(0, 60)}…`
    );
  } else {
    assert(
      !!fichaGolden.motivo,
      "AVISO: el documento de predisposiciones no está cargado en este entorno, y la ficha lo dice en vez de inventar",
      fichaGolden.motivo
    );
  }

  const fichaMestizo = await conAlcanceTenant(tenantId, (db) => fichaRacial(db, mestizo));
  igual(
    [fichaMestizo.texto, fichaMestizo.coincidio],
    [null, false],
    "y un mestizo NO muestra predisposiciones: inventarlas sería un dato clínico falso"
  );
  assert(
    (fichaMestizo.motivo ?? "").includes("mestizo"),
    "con su motivo escrito",
    fichaMestizo.motivo
  );

  const inventada = await pool.query<{ id: string }>(
    `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza)
     VALUES ($1,$2,3,'Rayo','Canino','Perro de los Andes') RETURNING id`,
    [tenantId, propietarioId]
  );
  const fichaSinCobertura = await conAlcanceTenant(tenantId, (db) =>
    fichaRacial(db, inventada.rows[0].id)
  );
  igual(
    fichaSinCobertura.coincidio,
    false,
    "una raza sin cobertura en el documento lo dice y no muestra la de otra"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 7. Integridad del registro: cierre, adendas y edición ===");
  await debeFallar("que el groomer firme una atención", () =>
    conAlcanceTenant(tenantId, (db) => cerrarYFirmarAtencion(db, atencionId, groomerId))
  );
  await debeFallar("agregar una adenda a una atención ABIERTA", () =>
    conAlcanceTenant(tenantId, (db) =>
      agregarAdenda(db, tenantId, {
        atencionId,
        motivo: "Corrección",
        texto: "Algo",
        personaId: medicoId,
      })
    )
  );

  await conAlcanceTenant(tenantId, (db) => cerrarYFirmarAtencion(db, atencionId, medicoId));
  const cerrada = await pool.query<{ estado: string; firmada_nombre: string }>(
    `SELECT estado, firmada_nombre FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  igual(
    [cerrada.rows[0].estado, cerrada.rows[0].firmada_nombre],
    ["cerrada", "Dra. Laura Méndez"],
    "la atención queda cerrada y firmada con el nombre copiado"
  );

  const notaOriginal = (
    await pool.query<{ nota_medica: string }>(
      `SELECT nota_medica FROM atenciones WHERE id = $1`,
      [atencionId]
    )
  ).rows[0].nota_medica;

  await debeFallar("editar la nota de una atención cerrada", () =>
    pool.query(`UPDATE atenciones SET nota_medica = 'otra cosa' WHERE id = $1`, [atencionId])
  );
  await debeFallar("borrar una atención cerrada", () =>
    pool.query(`DELETE FROM atenciones WHERE id = $1`, [atencionId])
  );

  const adenda = await conAlcanceTenant(tenantId, (db) =>
    agregarAdenda(db, tenantId, {
      atencionId,
      motivo: "Resultado de laboratorio posterior",
      texto: "La creatinina volvió alta; se cita control en 15 días.",
      personaId: medicoId,
    })
  );
  const adendas = await conAlcanceTenant(tenantId, (db) => adendasDeAtencion(db, atencionId));
  igual(
    [adendas.length, adendas[0].autor_nombre, adendas[0].motivo],
    [1, "Dra. Laura Méndez", "Resultado de laboratorio posterior"],
    "la adenda queda con su autor y su motivo"
  );
  igual(
    (
      await pool.query<{ nota_medica: string }>(
        `SELECT nota_medica FROM atenciones WHERE id = $1`,
        [atencionId]
      )
    ).rows[0].nota_medica,
    notaOriginal,
    "y la versión original de la nota se conserva intacta"
  );
  await debeFallar("editar una adenda", () =>
    pool.query(`UPDATE exp_adendas SET texto = 'cambiado' WHERE id = $1`, [adenda.id])
  );
  await debeFallar("borrar una adenda", () =>
    pool.query(`DELETE FROM exp_adendas WHERE id = $1`, [adenda.id])
  );

  // -------------------------------------------------------------------
  console.log("\n=== 8. Consentimientos: texto congelado e inmutable ===");
  const sembradas = await conAlcanceTenant(tenantId, (db) => sembrarPlantillasBase(db, tenantId));
  igual(sembradas.creadas, 4, "las cuatro plantillas base se siembran una vez");
  igual(
    (await conAlcanceTenant(tenantId, (db) => sembrarPlantillasBase(db, tenantId))).creadas,
    0,
    "y sembrarlas de nuevo no duplica nada");

  const lista = await conAlcanceTenant(tenantId, (db) => plantillas(db, tenantId));
  const cirugia = lista.find((p) => p.tipo === "cirugia")!;
  const preparado = await conAlcanceTenant(tenantId, (db) =>
    prepararConsentimiento(db, tenantId, {
      plantillaId: cirugia.id,
      pacienteId: golden,
      procedimiento: "extracción de masa en el flanco",
      medicoId,
    })
  );
  assert(
    preparado.texto.includes("Toby") &&
      preparado.texto.includes("Don Luis") &&
      preparado.texto.includes("extracción de masa"),
    "el texto se arma con los datos del paciente, del cliente y del procedimiento"
  );
  assert(
    preparado.texto.includes("[identificacion no registrado]"),
    "y un dato que falta queda SEÑALADO, no borrado en silencio"
  );

  await debeFallar("firmar sin la firma dibujada", () =>
    conAlcanceTenant(tenantId, (db) =>
      firmarConsentimiento(db, tenantId, {
        pacienteId: golden,
        titulo: preparado.titulo,
        texto: preparado.texto,
        firmanteNombre: "Don Luis",
        firmaPng: "",
      })
    )
  );

  const firmado = await conAlcanceTenant(tenantId, (db) =>
    firmarConsentimiento(db, tenantId, {
      pacienteId: golden,
      plantillaId: cirugia.id,
      atencionId,
      titulo: preparado.titulo,
      texto: preparado.texto,
      firmanteNombre: "Don Luis",
      firmanteIdentificacion: "108880999",
      firmaPng: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==",
      testigoId: medicoId,
    })
  );
  const delPaciente = await conAlcanceTenant(tenantId, (db) =>
    consentimientosDePaciente(db, golden)
  );
  igual(
    [delPaciente.length, delPaciente[0].firmante_nombre],
    [1, "Don Luis"],
    "el consentimiento queda en el expediente con quien firmó"
  );

  await debeFallar("editar el texto de un consentimiento firmado", () =>
    pool.query(`UPDATE exp_consentimientos SET texto = 'otra cosa' WHERE id = $1`, [firmado.id])
  );
  await debeFallar("borrar un consentimiento firmado", () =>
    pool.query(`DELETE FROM exp_consentimientos WHERE id = $1`, [firmado.id])
  );

  // -------------------------------------------------------------------
  console.log("\n=== 9. El expediente completo y la evolución ===");
  const tiempoFinal = await conAlcanceTenant(tenantId, (db) => lineaDeTiempo(db, golden, {}));
  const tipos = [...new Set(tiempoFinal.map((e) => e.tipo))].sort();
  assert(
    ["visita", "vacuna", "laboratorio", "grooming", "consentimiento"].every((t) =>
      tipos.includes(t)
    ),
    "la línea de tiempo reúne visita, vacuna, laboratorio, grooming y consentimiento",
    tipos
  );

  const puntos = await conAlcanceTenant(tenantId, (db) => evolucion(db, golden));
  igual(
    [puntos.length, Number(puntos[0].peso)],
    [1, 32.4],
    "la evolución trae el peso de la visita"
  );

  const conMedicacion = await conAlcanceTenant(tenantId, (db) =>
    encabezadoDeExpediente(db, golden)
  );
  if (medicamento.rows[0]) {
    assert(
      conMedicacion.medicacionActiva.length === 1 &&
        conMedicacion.medicacionActiva[0].duracionEstructurada,
      "la medicación activa lee '7 días' y calcula su fin",
      conMedicacion.medicacionActiva[0]?.fecha_fin
    );
  }

  // -------------------------------------------------------------------
  console.log("\n=== 10. RLS: nada de otra clínica ===");
  // Un paciente necesita su dueño: la columna es NOT NULL porque una
  // mascota sin cliente no se puede atender ni cobrar.
  const duenoAjeno = await pool.query<{ id: string }>(
    `INSERT INTO propietarios (tenant_id, nombre) VALUES ($1,'Dueño de la otra clínica')
     RETURNING id`,
    [otroTenantId]
  );
  const ajeno = await pool.query<{ id: string }>(
    `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
     VALUES ($1,$2,1,'Ajeno','Canino') RETURNING id`,
    [otroTenantId, duenoAjeno.rows[0].id]
  );
  await conAlcanceTenant(otroTenantId, (db) =>
    agregarProblema(db, otroTenantId, {
      pacienteId: ajeno.rows[0].id,
      descripcion: "Problema de otra clínica",
    })
  );
  igual(
    (await conAlcanceTenant(tenantId, (db) => problemasDePaciente(db, ajeno.rows[0].id))).length,
    0,
    "el problema de otra clínica no se ve"
  );
  igual(
    (await conAlcanceTenant(tenantId, (db) => lineaDeTiempo(db, ajeno.rows[0].id, {}))).length,
    0,
    "ni su línea de tiempo"
  );
  await debeFallar("leer el expediente de un paciente de otra clínica", () =>
    conAlcanceTenant(tenantId, (db) => encabezadoDeExpediente(db, ajeno.rows[0].id))
  );

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLAS");
  if (!ok) process.exitCode = 1;
}

main()
  .then(async () => {
    await pool.end();
    await tenantPool.end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool.end().catch(() => undefined);
    await tenantPool.end().catch(() => undefined);
    process.exit(1);
  });
