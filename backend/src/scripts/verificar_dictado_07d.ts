// Verificación del prompt 07d fase 2: el dictado de la consulta completa.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_dictado_07d.ts
//
// SIN --transpile-only a propósito: con los tipos apagados, cuatro
// defectos de los verificadores de caja pasaron sin que nadie los viera.
//
// HACE UNA LLAMADA REAL AL MODELO (dos, con el caso de la dosis
// ambigua). Es el punto de la verificación: lo que hay que comprobar no
// es que el código compile, es que el ordenamiento REPARTE bien un
// dictado real y que NO INVENTA lo que no se dijo. Un doble del modelo
// verificaría nuestro doble.
//
// Lo que se verifica, en el orden del prompt:
//
//   * el interruptor de la clínica: apagado por omisión;
//   * el proveedor simulado y el real detrás de la misma interfaz, y
//     que el real sin credencial falla diciendo que falta;
//   * el vocabulario sale del catálogo de la clínica;
//   * la compuerta de crédito corre SIN agente;
//   * el ordenamiento reparte el ejemplo del prompt campo por campo;
//   * «el resto normal» se propone, no se aplica;
//   * la receta calza con el catálogo, calcula la dosis por peso y
//     trae el aviso de alergia del 07c;
//   * una dosis ambigua queda vacía y marcada «revisar»;
//   * el consumo: minutos de audio y tokens, los dos descontados del
//     mismo saldo;
//   * aplicar es campo por campo: lo que no se marcó NO se registra;
//   * nada se firma ni se cobra al aplicar.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { abrirAtencion, cuentaViva } from "../expediente/atencion";
import { registrarAlergia } from "../expediente/clinico";
import {
  aplicarBorrador,
  calzarMedicamento,
  completarReceta,
  contextoDelPaciente,
  descartarDictado,
  estadoDelDictado,
  guardarDictado,
  verDictado,
} from "../expediente/dictado";
import { catalogosDelDictado, ordenarDictado } from "../expediente/dictadoBorrador";
import {
  Transcriptor,
  TranscriptorDeepgram,
  TranscriptorSimulado,
  transcriptorDelEntorno,
  vocabularioDeLaClinica,
} from "../expediente/transcripcion";
import { registrarMovimiento } from "../inventario/movimientos";
import { TABLAS_BORRADO_MANUAL_EN_PURGA } from "../tablasTenant";
import { verificarAntesDeGenerar } from "../tarifas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-07d";
const PLAN_BASICO = "bc264d7e-5749-4b50-9953-12ac4995838d";
const MODELO = "claude-sonnet-4-6";

// El ejemplo literal de la sección 2 del prompt. No se cambia: es el
// caso que el prompt pide comprobar.
const DICTADO_DEL_PROMPT =
  "Perro macho de 5 años, viene por cojera del miembro posterior derecho de 3 días. " +
  "Temperatura 38,9, frecuencia cardiaca 110, frecuencia respiratoria 28, peso 18 kilos. " +
  "El resto del examen normal salvo dolor a la palpación de la rodilla derecha. " +
  "Sospecho ruptura de ligamento cruzado. " +
  "Carprofeno 4 miligramos por kilo cada 24 horas por 7 días, control en 10 días, " +
  "radiografía de rodilla.";

// El mismo dictado con la dosis cortada. Lo que tiene que pasar es que
// la dosis quede VACÍA y marcada, no que el modelo complete un número
// razonable.
const DICTADO_AMBIGUO =
  "Viene por otitis. Temperatura 38,5. Oído derecho con secreción y mal olor. " +
  "Otitis externa. Le doy enrofloxacina a… bueno, la dosis la ajusto cuando tenga el peso, " +
  "control en una semana.";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

let tenantId = "";
let medicoId = "";
let toby = "";
let presCarprofeno = "";

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

/**
 * Borra las clínicas de prueba de una corrida anterior.
 *
 * No alcanza con `DELETE FROM tenants`: el consumo de IA —uso_api,
 * uso_transcripcion y notificaciones_uso, que escribe el chequeo de
 * umbrales— no tiene cascada a propósito, y traba el borrado. Es la
 * misma lista que lee la purga, y por eso se recorre en vez de
 * escribirla a mano: si mañana aparece otra tabla así, este script no
 * hay que tocarlo.
 */
async function borrarClinicasDePrueba(): Promise<void> {
  const previos = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE nombre LIKE $1`, [
    `${PREFIJO}%`,
  ]);
  for (const { id } of previos.rows) {
    for (const tabla of TABLAS_BORRADO_MANUAL_EN_PURGA) {
      await pool.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [id]);
    }
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
  }
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_dictado_07d");
  await borrarClinicasDePrueba();

  // -------------------------------------------------------------------
  console.log("=== 0. Clínica con suscripción, saldo, catálogo y paciente ===");
  tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@07d.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const suscripcion = await pool.query<{ id: string }>(
    `INSERT INTO suscripciones
       (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd,
        medicos_contratados, estado, periodo_inicio, periodo_fin)
     VALUES ($1,$2,'mensual',49,10,2,'activa', now() - interval '5 days', now() + interval '25 days')
     RETURNING id`,
    [tenantId, PLAN_BASICO]
  );
  await pool.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [
    suscripcion.rows[0].id,
    tenantId,
  ]);
  await pool.query(
    `INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 5, 0)`,
    [tenantId]
  );
  // Sin correos: la creación de la cita avisa al propietario.
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
       VALUES ($1,'Dra. Laura Méndez',$2,'x',true,true,'VET-07D') RETURNING id`,
      [tenantId, `${PREFIJO}-medico@probe.test`]
    )
  ).rows[0].id;
  const propietarioId = (
    await pool.query<{ id: string }>(
      `INSERT INTO propietarios (tenant_id, nombre, email, telefono)
       VALUES ($1,'Don Luis',$2,'88887777') RETURNING id`,
      [tenantId, `${PREFIJO}-luis@probe.invalid`]
    )
  ).rows[0].id;
  toby = (
    await pool.query<{ id: string }>(
      `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza,
                              sexo, estado_reproductivo, fecha_nacimiento)
       VALUES ($1,$2,1,'Toby','canino','Golden Retriever','macho','entero',
               (CURRENT_DATE - interval '5 years')::date) RETURNING id`,
      [tenantId, propietarioId]
    )
  ).rows[0].id;
  const bodegaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_bodegas (tenant_id, codigo, nombre, es_default)
       VALUES ($1,'FARM','Farmacia',true) RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;

  const carprofeno = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_productos (tenant_id, codigo, nombre, linea_negocio, unidad_base,
                                  codigo_cabys, codigo_tarifa_iva, principio_activo, tipo_clinico)
       VALUES ($1,'P-CAR','Carprofeno 50 mg','farmacia','tableta','3564012000000','08',
               'carprofeno','medicamento') RETURNING id`,
      [tenantId]
    )
  ).rows[0].id;
  presCarprofeno = (
    await pool.query<{ id: string }>(
      `INSERT INTO inv_presentaciones (tenant_id, producto_id, codigo_interno, nombre, factor,
                                       unidad_medida, precio_venta, para_venta)
       VALUES ($1,$2,'C1','Tableta',1,'Unid',900,true) RETURNING id`,
      [tenantId, carprofeno]
    )
  ).rows[0].id;
  await conAlcanceTenant(tenantId, (db) =>
    registrarMovimiento(db, tenantId, {
      tipo: "inventario_inicial",
      productoId: carprofeno,
      bodegaId,
      cantidadBase: 60,
      lote: { numero: "CAR-1", vencimiento: "2029-01-31", costoUnitario: 300 },
    })
  );
  assert(!!toby && !!presCarprofeno, "clínica con saldo, catálogo y paciente");

  // -------------------------------------------------------------------
  console.log("\n=== 1. El interruptor de la clínica ===");
  const apagado = await conAlcanceTenant(tenantId, (db) => estadoDelDictado(db, tenantId));
  igual(apagado.activo, false, "el dictado por IA nace APAGADO (consume crédito)");
  igual(apagado.retencionAudioHoras, 0, "el audio NO se guarda por omisión");

  const sinFila = await conAlcanceTenant(tenantId, (db) =>
    estadoDelDictado(db, "00000000-0000-0000-0000-000000000000")
  );
  igual(sinFila.activo, false, "sin fila de configuración también está apagado (fail-closed)");

  await pool.query(`UPDATE configuracion_notificaciones SET dictado_ia_activo = true WHERE tenant_id = $1`, [
    tenantId,
  ]);
  const encendido = await conAlcanceTenant(tenantId, (db) => estadoDelDictado(db, tenantId));
  igual(encendido.activo, true, "el administrador lo enciende y queda encendido");

  // -------------------------------------------------------------------
  console.log("\n=== 2. Los dos proveedores, detrás de la misma interfaz ===");
  // Por la interfaz y no por la clase: es como lo usa la ruta, y así
  // se verifica que el simulado la cumple de verdad.
  const simulado: Transcriptor = new TranscriptorSimulado("hola prueba de dictado de la consulta");
  igual(simulado.disponible().listo, true, "el simulado siempre está listo");
  const r1 = await simulado.transcribir({ bytes: Buffer.alloc(0), tipo: "audio/webm" }, []);
  igual(r1.texto, "hola prueba de dictado de la consulta", "el simulado devuelve el texto del navegador");
  assert(r1.segundos > 0, "estima los segundos cuando el navegador no los manda", `${r1.segundos} s`);

  const vacio: Transcriptor = new TranscriptorSimulado(null);
  let falloVacio = "";
  try {
    await vacio.transcribir({ bytes: Buffer.alloc(0), tipo: "audio/webm" }, []);
  } catch (err) {
    falloVacio = (err as Error).message;
  }
  assert(
    falloVacio.includes("texto que reconoció el navegador"),
    "el simulado sin texto falla diciendo exactamente qué le falta",
    falloVacio.slice(0, 80)
  );

  const real = new TranscriptorDeepgram();
  const estadoReal = real.disponible();
  if (process.env.DEEPGRAM_API_KEY) {
    assert(estadoReal.listo, "con DEEPGRAM_API_KEY el proveedor real queda listo");
  } else {
    assert(
      !estadoReal.listo && (estadoReal.motivo ?? "").includes("DEEPGRAM_API_KEY"),
      "sin credencial el proveedor real NO está listo, y dice qué falta",
      estadoReal.motivo
    );
  }
  igual(
    transcriptorDelEntorno(null).nombre,
    process.env.TRANSCRIPCION_PROVEEDOR === "deepgram" ? "deepgram-nova-2" : "simulado",
    "el entorno elige el proveedor, y en desarrollo es el simulado"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. El vocabulario sale del catálogo de la clínica ===");
  const vocabulario = await conAlcanceTenant(tenantId, (db) => vocabularioDeLaClinica(db, tenantId));
  assert(
    vocabulario.some((v) => v.toLowerCase() === "carprofeno"),
    "«Carprofeno» está en el vocabulario, porque está en el catálogo de esta clínica"
  );
  assert(
    vocabulario.some((v) => v === "Golden" || v === "Retriever"),
    "la raza del paciente también refuerza el reconocimiento",
    vocabulario.filter((v) => /gold|retr/i.test(v))
  );
  assert(
    !vocabulario.some((v) => /\d/.test(v) || v.length < 4),
    "no se refuerzan números ni palabras cortas: gastan cupo y no mejoran nada"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. La compuerta de crédito, sin agente ===");
  const compuerta = await conAlcanceTenant(tenantId, (db) =>
    verificarAntesDeGenerar(db, {
      tenantId,
      agenteId: null,
      tipoOperacion: "dictado",
      disparadoPor: "usuario",
    })
  );
  igual(compuerta.permitido, true, "con saldo y suscripción activa, permite dictar");

  await pool.query(`UPDATE suscripciones SET estado = 'ventana_purga' WHERE tenant_id = $1`, [tenantId]);
  const enPurga = await conAlcanceTenant(tenantId, (db) =>
    verificarAntesDeGenerar(db, {
      tenantId,
      agenteId: null,
      tipoOperacion: "dictado",
      disparadoPor: "usuario",
    })
  );
  igual(
    [enPurga.permitido, enPurga.motivo],
    [false, "fuera_de_ventana"],
    "en ventana de purga NO se dicta: ahí solo se permite el Informe"
  );
  await pool.query(`UPDATE suscripciones SET estado = 'activa' WHERE tenant_id = $1`, [tenantId]);

  await pool.query(`UPDATE saldos_ia SET credito_plan_usd = 0, colchon_usado_usd = 999 WHERE tenant_id = $1`, [
    tenantId,
  ]);
  const sinSaldo = await conAlcanceTenant(tenantId, (db) =>
    verificarAntesDeGenerar(db, {
      tenantId,
      agenteId: null,
      tipoOperacion: "dictado",
      disparadoPor: "usuario",
    })
  );
  igual(
    [sinSaldo.permitido, sinSaldo.motivo],
    [false, "colchon_agotado"],
    "sin saldo y con el colchón consumido, el dictado se rechaza como cualquier otra generación"
  );
  await pool.query(
    `UPDATE saldos_ia SET credito_plan_usd = 5, colchon_usado_usd = 0 WHERE tenant_id = $1`,
    [tenantId]
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. El ordenamiento del ejemplo del prompt (llamada real al modelo) ===");
  const atencionId = await nuevaAtencion("Cojera");
  const paciente = await conAlcanceTenant(tenantId, (db) => contextoDelPaciente(db, atencionId));
  assert(!!paciente, "el contexto del paciente se arma de la atención");
  igual(paciente!.contexto.especie, "canino", "la especie va al contexto");
  assert((paciente!.contexto.edad ?? "").startsWith("5"), "la edad sale de la fecha de nacimiento", paciente!.contexto.edad);

  // Cuántas filas de examen sembró la plantilla al abrir la atención. Es
  // la cuenta contra la que se compara después de aplicar el borrador.
  const sembrados = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM exp_examen_sistemas WHERE atencion_id = $1`,
    [atencionId]
  );
  const sistemasSembrados = Number(sembrados.rows[0].n);
  assert(sistemasSembrados > 0, `la plantilla sembró ${sistemasSembrados} sistemas en el examen`);

  const catalogos = await conAlcanceTenant(tenantId, (db) => catalogosDelDictado(db));
  assert(catalogos.sistemas.length > 0, `los sistemas del examen están cargados (${catalogos.sistemas.length})`);
  assert(catalogos.frecuencias.length > 0, `las frecuencias están cargadas (${catalogos.frecuencias.length})`);

  const ordenado = await ordenarDictado(catalogos, DICTADO_DEL_PROMPT, paciente!.contexto, MODELO);
  const b = ordenado.borrador;
  console.log(JSON.stringify(b, null, 1).slice(0, 2200));

  assert(/cojera/i.test(b.motivoConsulta ?? ""), "el motivo dice cojera", b.motivoConsulta);
  igual(b.signos.temperatura, 38.9, "la temperatura cae en su campo, con la coma leída como decimal");
  igual(b.signos.frecuenciaCardiaca, 110, "la frecuencia cardiaca cae en su campo");
  igual(b.signos.frecuenciaRespiratoria, 28, "la frecuencia respiratoria cae en su campo");
  igual(b.signos.peso, 18, "el peso cae en su campo");
  igual(b.restoNormal, true, "«el resto del examen normal» se reconoce como propuesta, no como campo");
  assert(
    b.sistemas.some((s) => s.estado === "anormal" && /rodilla|palpaci/i.test(s.hallazgo ?? "")),
    "el sistema anormal lleva el hallazgo que se dijo",
    b.sistemas
  );
  assert(
    b.sistemas.every((s) => catalogos.sistemas.some((c) => c.codigo === s.sistema)),
    "todo sistema propuesto existe en el catálogo de ESTA clínica"
  );
  assert(
    b.diagnosticos.some((d) => /cruzado/i.test(d.descripcion) && d.tipo === "presuntivo"),
    "«sospecho» es un diagnóstico PRESUNTIVO, no definitivo",
    b.diagnosticos
  );
  igual(b.controlDias, 10, "el control queda propuesto a 10 días");
  assert(
    b.estudios.some((e) => /radiograf/i.test(e.tipoEstudio)),
    "la radiografía queda propuesta como estudio",
    b.estudios
  );
  igual(b.receta.length, 1, "una línea de receta: el carprofeno");
  const linea = b.receta[0];
  igual(linea.dosisCantidad, 4, "4 mg/kg: la cantidad");
  igual(linea.dosisPorKg, true, "«por kilo» se entiende como dosis por peso");
  igual(linea.duracionCantidad, 7, "7 días de duración");
  igual(linea.duracionUnidad, "dias", "la unidad de la duración");
  assert(!!linea.frecuenciaCodigo, "la frecuencia sale del catálogo", linea.frecuenciaCodigo);
  assert(
    catalogos.frecuencias.some((f) => f.codigo === linea.frecuenciaCodigo),
    "y es un código que existe de verdad"
  );
  assert(ordenado.uso.tokensEntrada > 0 && ordenado.uso.tokensSalida > 0, "el uso del modelo viene medido", ordenado.uso);

  // -------------------------------------------------------------------
  console.log("\n=== 6. La receta: calce, dosis por peso y aviso de alergia ===");
  const calce = await conAlcanceTenant(tenantId, (db) => calzarMedicamento(db, "carprofeno"));
  assert(calce !== null && "presentacionId" in calce, "«carprofeno» calza con el catálogo", calce);

  // La alergia se registra ANTES de completar: el aviso del 07c tiene
  // que aparecer en el borrador, no después de aceptarlo.
  await conAlcanceTenant(tenantId, (db) =>
    registrarAlergia(db, tenantId, {
      pacienteId: toby,
      tipo: "alergia",
      sustancia: "carprofeno",
      severidad: "grave",
      reaccion: "Vómito y urticaria",
      personaId: medicoId,
    })
  );

  const completas = await conAlcanceTenant(tenantId, (db) =>
    completarReceta(db, atencionId, toby, b.receta)
  );
  igual(completas[0].presentacionId, presCarprofeno, "la línea queda ligada a la presentación del catálogo");
  igual(completas[0].dosisTotal, 72, "4 mg/kg × 18 kg = 72 mg, calculado con el peso real");
  assert(
    (completas[0].explicacionDosis ?? "").includes("72"),
    "y la cuenta se explica, no solo el resultado",
    completas[0].explicacionDosis
  );
  assert(completas[0].avisos.length > 0, "el aviso de alergia del 07c aparece en el borrador", completas[0].avisos);

  const sinCatalogo = await conAlcanceTenant(tenantId, (db) =>
    completarReceta(db, atencionId, toby, [{ ...b.receta[0], nombreDicho: "Sulfadimetoxina pura" }])
  );
  igual(sinCatalogo[0].presentacionId, null, "lo que no está en el catálogo NO se fuerza a otro producto");

  // EL PESO DEL DICTADO GANA AL DEL EXPEDIENTE. Defecto real encontrado
  // al verificar en el navegador: el expediente de Toby tenía 32,4 kg de
  // una visita anterior, el médico dictó 18 kg, y el borrador mostraba
  // «4 mg/kg × 32,4 kg = 129,6 mg» — una dosis equivocada con aspecto de
  // correcta. Se reproduce acá con los dos pesos distintos.
  await pool.query(`UPDATE atenciones SET peso = 32.4 WHERE id = $1`, [atencionId]);
  const conPesoViejo = await conAlcanceTenant(tenantId, (db) =>
    completarReceta(db, atencionId, toby, b.receta)
  );
  igual(conPesoViejo[0].dosisTotal, 129.6, "sin peso dictado se usa el del expediente (32,4 kg)");
  igual(conPesoViejo[0].pesoDelDictado, false, "y la línea NO dice que el peso venga del dictado");

  const conPesoDictado = await conAlcanceTenant(tenantId, (db) =>
    completarReceta(db, atencionId, toby, b.receta, 18)
  );
  igual(conPesoDictado[0].dosisTotal, 72, "con el peso dictado (18 kg) la dosis es 72 mg, no 129,6");
  igual(conPesoDictado[0].pesoUsadoKg, 18, "y se dice con qué peso se hizo la cuenta");
  igual(
    conPesoDictado[0].pesoDelDictado,
    true,
    "marcada, para que la pantalla avise que ese peso todavía no está aceptado"
  );
  await pool.query(`UPDATE atenciones SET peso = 18 WHERE id = $1`, [atencionId]);

  // -------------------------------------------------------------------
  console.log("\n=== 7. El consumo: minutos y tokens, del mismo saldo ===");
  const saldoAntes = Number(
    (await pool.query(`SELECT credito_plan_usd FROM saldos_ia WHERE tenant_id = $1`, [tenantId])).rows[0]
      .credito_plan_usd
  );
  b.receta = completas;
  const dictadoId = await conAlcanceTenant(tenantId, (db) =>
    guardarDictado(db, {
      tenantId,
      atencionId,
      personaId: medicoId,
      transcripcion: { texto: DICTADO_DEL_PROMPT, segundos: 95, proveedor: "deepgram-nova-2", confianza: 0.97 },
      borrador: b,
      modeloOrdenamiento: MODELO,
      usoOrdenamiento: ordenado.uso,
      retencionAudioHoras: 0,
    })
  );
  assert(!!dictadoId, "el dictado queda guardado");

  const consumo = await pool.query<{ segundos: string; costo: string; cobrable: boolean; bolsa: string }>(
    `SELECT segundos, costo_usd_calculado AS costo, cobrable, bolsa_afectada AS bolsa
       FROM uso_transcripcion WHERE dictado_id = $1`,
    [dictadoId]
  );
  igual(consumo.rows.length, 1, "hay UNA fila de consumo de transcripción");
  igual(Number(consumo.rows[0].segundos), 95, "con los segundos que informó el proveedor");
  // 95 s a USD 0,0043/min = 0,006808
  assert(
    Math.abs(Number(consumo.rows[0].costo) - (95 / 60) * 0.0043) < 1e-6,
    "y el costo es los minutos por la tarifa del proveedor",
    consumo.rows[0].costo
  );
  igual(consumo.rows[0].bolsa, "plan", "se descontó de la bolsa del plan");

  const usoApi = await pool.query<{ n: string; caso: string | null }>(
    `SELECT COUNT(*) AS n, MAX(caso_id::text) AS caso FROM uso_api WHERE tenant_id = $1 AND modelo = $2`,
    [tenantId, MODELO]
  );
  igual(Number(usoApi.rows[0].n), 1, "y UNA fila de consumo de tokens por el ordenamiento");
  igual(usoApi.rows[0].caso, null, "sin caso: el dictado nace de una atención, no de un caso");

  const movimientos = await pool.query<{ tabla: string; descripcion: string }>(
    `SELECT referencia_tabla AS tabla, descripcion FROM movimientos_credito
      WHERE tenant_id = $1 AND tipo = 'consumo' ORDER BY referencia_tabla`,
    [tenantId]
  );
  igual(
    movimientos.rows.map((m) => m.tabla),
    ["uso_api", "uso_transcripcion"],
    "el libro mayor distingue de qué consumo vino cada descuento"
  );
  const saldoDespues = Number(
    (await pool.query(`SELECT credito_plan_usd FROM saldos_ia WHERE tenant_id = $1`, [tenantId])).rows[0]
      .credito_plan_usd
  );
  assert(saldoDespues < saldoAntes, "el saldo bajó", { saldoAntes, saldoDespues });

  const guardado = await conAlcanceTenant(tenantId, (db) => verDictado(db, atencionId));
  igual(guardado?.estado, "ordenado", "el dictado queda esperando al médico, no aplicado");
  igual(guardado?.textoTranscrito, DICTADO_DEL_PROMPT, "el texto literal se conserva");

  // -------------------------------------------------------------------
  console.log("\n=== 8. Aplicar es campo por campo ===");
  const aplicado = await conAlcanceTenant(tenantId, (db) =>
    aplicarBorrador(db, tenantId, dictadoId, ["motivo_consulta", "signos", "sistemas"], medicoId)
  );
  igual(aplicado.problemas, [], "no hubo problemas al aplicar");
  assert(
    aplicado.aplicados.includes("motivo_consulta") && aplicado.aplicados.includes("signos"),
    "se aplicó lo marcado",
    aplicado.aplicados
  );

  const atencion = await pool.query<{
    motivo_consulta: string | null;
    temperatura: string | null;
    evaluacion: string | null;
    plan_tratamiento: string | null;
    control_fecha: string | null;
  }>(
    `SELECT motivo_consulta, temperatura, evaluacion, plan_tratamiento, control_fecha::text
       FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  assert(!!atencion.rows[0].motivo_consulta, "el motivo quedó registrado", atencion.rows[0].motivo_consulta);
  igual(Number(atencion.rows[0].temperatura), 38.9, "la temperatura quedó registrada");
  igual(
    [atencion.rows[0].plan_tratamiento, atencion.rows[0].control_fecha],
    [null, null],
    "LO QUE NO SE MARCÓ NO SE REGISTRÓ: el plan y el control siguen vacíos"
  );

  const diagnosticos = await pool.query(`SELECT COUNT(*) AS n FROM exp_diagnosticos WHERE atencion_id = $1`, [
    atencionId,
  ]);
  igual(Number(diagnosticos.rows[0].n), 0, "y tampoco se registró el diagnóstico que no se marcó");

  const sistemas = await pool.query<{ sistema: string; estado: string; nota: string | null }>(
    `SELECT sistema, estado, nota FROM exp_examen_sistemas WHERE atencion_id = $1 AND estado <> 'no_evaluado'`,
    [atencionId]
  );
  assert(
    sistemas.rows.some((s) => s.estado === "anormal" && !!s.nota),
    "el sistema anormal quedó con su hallazgo",
    sistemas.rows
  );
  igual(
    sistemas.rows.filter((s) => s.estado === "normal").length,
    0,
    "«el resto normal» NO se aplicó: no estaba marcado, y es una propuesta aparte"
  );

  // Ahora sí, con «resto_normal» marcado.
  await conAlcanceTenant(tenantId, (db) =>
    aplicarBorrador(db, tenantId, dictadoId, ["resto_normal", "receta", "estudios", "control"], medicoId)
  );
  const normales = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM exp_examen_sistemas WHERE atencion_id = $1 AND estado = 'normal'`,
    [atencionId]
  );
  assert(Number(normales.rows[0].n) > 0, "marcado, el resto de los sistemas queda Normal", normales.rows[0].n);

  // NO SE AGREGAN FILAS AL EXAMEN. Defecto real encontrado en el
  // navegador: el dictado marcaba por CÓDIGO («locomotor») y la
  // plantilla siembra por ETIQUETA («Locomotor»), así que el examen
  // quedaba con catorce filas y dos Locomotor, una sin evaluar y otra
  // anormal. La cuenta de filas es lo que lo detecta.
  const filas = await pool.query<{ n: string; anormales: string }>(
    `SELECT COUNT(*) AS n,
            COUNT(*) FILTER (WHERE estado = 'anormal') AS anormales
       FROM exp_examen_sistemas WHERE atencion_id = $1`,
    [atencionId]
  );
  igual(
    Number(filas.rows[0].n),
    sistemasSembrados,
    "el examen tiene las MISMAS filas que sembró la plantilla: el dictado no agrega sistemas"
  );
  igual(Number(filas.rows[0].anormales), 1, "y sigue habiendo un solo sistema anormal, no dos");

  const control = await pool.query<{ f: string | null }>(
    `SELECT control_fecha::text AS f FROM atenciones WHERE id = $1`,
    [atencionId]
  );
  assert(!!control.rows[0].f, "el control queda PROPUESTO como fecha; la cita la agenda el cierre", control.rows[0].f);

  const receta = await pool.query<{ n: string; nombre: string | null; dispensado: boolean | null }>(
    `SELECT COUNT(*) AS n, MAX(ri.nombre_impreso) AS nombre, bool_or(ri.dispensado_aqui) AS dispensado
       FROM recetas r JOIN receta_items ri ON ri.receta_id = r.id
      WHERE r.atencion_id = $1`,
    [atencionId]
  );
  igual(Number(receta.rows[0].n), 1, "la línea de receta quedó registrada");
  igual(receta.rows[0].dispensado, false, "NO se dispensa por dictado: eso descuenta stock y cobra");

  const cuenta = await conAlcanceTenant(tenantId, (db) => cuentaViva(db, atencionId));
  igual(cuenta.items.length, 0, "aplicar el borrador NO generó ningún cargo");

  const estadoFinal = await pool.query<{ estado: string; campos: string[] }>(
    `SELECT estado, campos_aplicados AS campos FROM exp_dictados WHERE id = $1`,
    [dictadoId]
  );
  igual(estadoFinal.rows[0].estado, "aplicado", "el dictado queda marcado como aplicado");
  assert(
    estadoFinal.rows[0].campos.includes("signos") && estadoFinal.rows[0].campos.includes("receta"),
    "y recuerda QUÉ campos se aceptaron, acumulando las dos veces",
    estadoFinal.rows[0].campos
  );

  const firmada = await pool.query<{ estado: string }>(`SELECT estado FROM atenciones WHERE id = $1`, [
    atencionId,
  ]);
  igual(firmada.rows[0].estado, "borrador", "la atención sigue EN BORRADOR: el dictado no firma nada");

  // -------------------------------------------------------------------
  console.log("\n=== 9. La dosis ambigua queda vacía y marcada (llamada real al modelo) ===");
  const atencion2 = await nuevaAtencion("Otitis");
  const paciente2 = await conAlcanceTenant(tenantId, (db) => contextoDelPaciente(db, atencion2));
  const ambiguo = await ordenarDictado(catalogos, DICTADO_AMBIGUO, paciente2!.contexto, MODELO);
  console.log(JSON.stringify(ambiguo.borrador.receta, null, 1));
  assert(
    ambiguo.borrador.receta.length === 0 ||
      (ambiguo.borrador.receta[0].dosisCantidad === null &&
        ambiguo.borrador.receta[0].revisar.length > 0),
    "la dosis que no se dijo NO se inventa: la línea no existe, o existe vacía y marcada",
    ambiguo.borrador.receta
  );
  // Una línea sin dosis, completada: tiene que salir marcada. Se arma a
  // mano y no se reusa la que devolvió el modelo, porque el modelo puede
  // no haber devuelto ninguna —que es el otro resultado correcto—, y lo
  // que se verifica acá es la regla, no cuál de los dos caminos tomó.
  const completadoAmbiguo = await conAlcanceTenant(tenantId, (db) =>
    completarReceta(db, atencion2, toby, [
      {
        nombreDicho: "enrofloxacina",
        presentacionId: null,
        nombreEnCatalogo: null,
        dosisCantidad: null,
        dosisUnidad: null,
        dosisPorKg: false,
        viaCodigo: null,
        frecuenciaCodigo: null,
        duracionCantidad: null,
        duracionUnidad: null,
        explicacionDosis: null,
        dosisTotal: null,
        pesoUsadoKg: null,
        pesoDelDictado: false,
        avisos: [],
        revisar: [],
      },
    ])
  );
  assert(
    completadoAmbiguo[0].revisar.includes("dosis"),
    "y al completar la línea queda marcada «dosis» para revisar",
    completadoAmbiguo[0].revisar
  );

  // -------------------------------------------------------------------
  console.log("\n=== 10. Descartar no borra lo que se dijo ===");
  const dictado2 = await conAlcanceTenant(tenantId, (db) =>
    guardarDictado(db, {
      tenantId,
      atencionId: atencion2,
      personaId: medicoId,
      transcripcion: { texto: DICTADO_AMBIGUO, segundos: 40, proveedor: "simulado", confianza: null },
      borrador: ambiguo.borrador,
      modeloOrdenamiento: MODELO,
      usoOrdenamiento: ambiguo.uso,
      retencionAudioHoras: 0,
    })
  );
  await conAlcanceTenant(tenantId, (db) => descartarDictado(db, dictado2));
  const tras = await pool.query<{ estado: string; texto: string }>(
    `SELECT estado, texto_transcrito AS texto FROM exp_dictados WHERE id = $1`,
    [dictado2]
  );
  igual(tras.rows[0].estado, "descartado", "el dictado queda descartado");
  igual(tras.rows[0].texto, DICTADO_AMBIGUO, "pero el texto que dijo el médico sigue ahí");
  const noVisible = await conAlcanceTenant(tenantId, (db) => verDictado(db, atencion2));
  igual(noVisible, null, "y la pantalla ya no lo ofrece");

  const simuladoSinTarifa = await pool.query<{ costo: string; cobrable: boolean }>(
    `SELECT costo_usd_calculado AS costo, cobrable FROM uso_transcripcion WHERE dictado_id = $1`,
    [dictado2]
  );
  igual(Number(simuladoSinTarifa.rows[0].costo), 0, "el proveedor simulado no cuesta nada");
  igual(simuladoSinTarifa.rows[0].cobrable, false, "y no es facturable");

  // -------------------------------------------------------------------
  console.log("\n=== 11. Limpieza, y el rastro de consumo que la purga borra a mano ===");
  // uso_transcripcion NO tiene cascada a `tenants`, igual que uso_api y
  // por el mismo motivo: es rastro de consumo y borrarlo tiene que ser
  // un acto explícito. La consecuencia es que TRABA el DELETE del
  // tenant, y que la purga la tiene que nombrar —está en
  // TABLAS_BORRADO_MANUAL_EN_PURGA—. Se comprueba acá porque en el 07c
  // una FK así, sin nombrar, rompió el borrado de una clínica.
  let bloqueo = "";
  try {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  } catch (err) {
    bloqueo = (err as Error).message;
  }
  // Cuál de las tablas sin cascada se queja primero lo decide el orden
  // de los triggers de Postgres, así que la aserción es sobre la LISTA y
  // no sobre una tabla: lo que importa es que la que traba esté nombrada
  // en el contrato que lee la purga.
  assert(
    TABLAS_BORRADO_MANUAL_EN_PURGA.some((t) => bloqueo.includes(t)),
    "el DELETE del tenant lo traba una tabla de TABLAS_BORRADO_MANUAL_EN_PURGA, no una desconocida",
    bloqueo.slice(0, 140)
  );
  assert(
    (TABLAS_BORRADO_MANUAL_EN_PURGA as readonly string[]).includes("uso_transcripcion"),
    "y uso_transcripcion está en esa lista"
  );

  // Lo mismo que hace la purga, en el mismo orden.
  for (const tabla of TABLAS_BORRADO_MANUAL_EN_PURGA) {
    await pool.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [tenantId]);
  }
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  const quedan = await pool.query(`SELECT COUNT(*) AS n FROM exp_dictados WHERE tenant_id = $1`, [tenantId]);
  igual(Number(quedan.rows[0].n), 0, "borrada la clínica, sus dictados se van con ella (cascada)");

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exitCode = ok ? 0 : 1;
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exitCode = 1;
});
