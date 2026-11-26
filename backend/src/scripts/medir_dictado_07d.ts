// Medición del dictado de la consulta — prompt 07d, «Medir».
//
//   docker compose exec backend npx ts-node src/scripts/medir_dictado_07d.ts
//
// QUÉ MIDE, Y QUÉ NO:
//
//   * MIDE la precisión del ORDENAMIENTO: sobre 10 dictados con
//     terminología veterinaria, cuántos de los campos que el dictado
//     contiene quedan en el campo correcto, y —lo más importante—
//     cuántas veces el modelo INVENTA un dato que nadie dijo.
//   * MIDE el costo por consulta, con las tarifas reales de la base: no
//     se calcula acá, se registra el consumo por el mismo punto que lo
//     registra la aplicación (`registrarUsoApi` y
//     `registrarUsoTranscripcion`) y después se lee.
//   * NO MIDE la precisión de la TRANSCRIPCIÓN. Para eso hace falta
//     audio real y credenciales del proveedor, y este entorno no las
//     tiene. Los 10 dictados de acá entran como texto, que es lo que
//     saldría de una transcripción perfecta. Dicho de otro modo: lo que
//     se mide es el techo del sistema, no su precisión de punta a punta.
//     Está así en el informe, no vendido como otra cosa.
//
// Los minutos de audio se estiman a 150 palabras por minuto —el ritmo de
// un dictado normal, y la misma regla que usa el proveedor simulado—,
// porque sin audio real no hay duración real.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { catalogosDelDictado, ordenarDictado, BorradorDictado } from "../expediente/dictadoBorrador";
import { TABLAS_BORRADO_MANUAL_EN_PURGA } from "../tablasTenant";
import { registrarUsoApi, registrarUsoTranscripcion } from "../tarifas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "medicion-07d";
const PLAN_BASICO = "bc264d7e-5749-4b50-9953-12ac4995838d";
const MODELO = "claude-sonnet-4-6";
const PROVEEDOR_TRANSCRIPCION = "deepgram-nova-2";

type Comprobacion = { campo: string; ok: (b: BorradorDictado) => boolean };

interface CasoDeDictado {
  nombre: string;
  especie: string;
  texto: string;
  /** Lo que el dictado SÍ dice y tiene que aparecer. */
  debeAparecer: Comprobacion[];
  /**
   * Lo que el dictado NO dice y NO puede aparecer. Es la mitad que
   * importa: un ordenamiento que acierta todo lo dicho pero completa lo
   * que falta es peor que uno que deja huecos.
   */
  noDebeInventar: Comprobacion[];
}

const tieneSistemaAnormal = (patron: RegExp) => (b: BorradorDictado) =>
  b.sistemas.some((s) => s.estado === "anormal" && patron.test(s.hallazgo ?? ""));
const tieneDiagnostico = (patron: RegExp, tipo?: "presuntivo" | "definitivo") => (b: BorradorDictado) =>
  b.diagnosticos.some((d) => patron.test(d.descripcion) && (!tipo || d.tipo === tipo));
const tieneEstudio = (patron: RegExp) => (b: BorradorDictado) =>
  b.estudios.some((e) => patron.test(e.tipoEstudio));
const lineaDeReceta = (patron: RegExp) => (b: BorradorDictado) =>
  b.receta.find((l) => patron.test(l.nombreDicho));

const CASOS: CasoDeDictado[] = [
  {
    nombre: "1. Cojera — el ejemplo del prompt",
    especie: "canino",
    texto:
      "Perro macho de 5 años, viene por cojera del miembro posterior derecho de 3 días. " +
      "Temperatura 38,9, frecuencia cardiaca 110, frecuencia respiratoria 28, peso 18 kilos. " +
      "El resto del examen normal salvo dolor a la palpación de la rodilla derecha. " +
      "Sospecho ruptura de ligamento cruzado. Carprofeno 4 miligramos por kilo cada 24 horas " +
      "por 7 días, control en 10 días, radiografía de rodilla.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /cojera/i.test(b.motivoConsulta ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 38.9 },
      { campo: "frecuencia cardiaca", ok: (b) => b.signos.frecuenciaCardiaca === 110 },
      { campo: "frecuencia respiratoria", ok: (b) => b.signos.frecuenciaRespiratoria === 28 },
      { campo: "peso", ok: (b) => b.signos.peso === 18 },
      { campo: "resto normal", ok: (b) => b.restoNormal },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/rodilla|palpaci/i) },
      { campo: "diagnóstico presuntivo", ok: tieneDiagnostico(/cruzado/i, "presuntivo") },
      { campo: "receta: dosis 4 mg/kg", ok: (b) => lineaDeReceta(/carprofeno/i)(b)?.dosisCantidad === 4 },
      { campo: "receta: por kilo", ok: (b) => lineaDeReceta(/carprofeno/i)(b)?.dosisPorKg === true },
      { campo: "receta: 7 días", ok: (b) => lineaDeReceta(/carprofeno/i)(b)?.duracionCantidad === 7 },
      { campo: "control 10 días", ok: (b) => b.controlDias === 10 },
      { campo: "estudio radiografía", ok: tieneEstudio(/radiograf/i) },
    ],
    noDebeInventar: [
      { campo: "condición corporal", ok: (b) => b.signos.condicionCorporal === null },
    ],
  },
  {
    nombre: "2. Otitis felina con cultivo",
    especie: "felino",
    texto:
      "Gata de 3 años, viene por rascado de oreja izquierda desde hace una semana, la dueña dice " +
      "que sacude la cabeza. Temperatura 38,6, peso 4,2 kilos. Oído izquierdo con eritema y " +
      "secreción marrón, mal olor. Otitis externa izquierda. Pido citología de oído y cultivo. " +
      "Limpieza con solución ótica y enrofloxacina 5 miligramos por kilo cada 24 horas por 10 días.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /rasc|oreja|o[íi]do/i.test(b.motivoConsulta ?? "") },
      { campo: "anamnesis con la semana", ok: (b) => /semana|sacud/i.test(b.anamnesis ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 38.6 },
      { campo: "peso", ok: (b) => b.signos.peso === 4.2 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/secreci|eritema|olor/i) },
      { campo: "diagnóstico", ok: tieneDiagnostico(/otitis/i) },
      { campo: "receta: dosis 5 mg/kg", ok: (b) => lineaDeReceta(/enrofloxacina/i)(b)?.dosisCantidad === 5 },
      { campo: "receta: 10 días", ok: (b) => lineaDeReceta(/enrofloxacina/i)(b)?.duracionCantidad === 10 },
      { campo: "estudio citología o cultivo", ok: tieneEstudio(/citolog|cultivo/i) },
    ],
    noDebeInventar: [
      { campo: "resto normal", ok: (b) => !b.restoNormal },
      { campo: "control", ok: (b) => b.controlDias === null },
    ],
  },
  {
    nombre: "3. Vómito con sospecha de cuerpo extraño",
    especie: "canino",
    texto:
      "Cachorro de 6 meses, vómito desde ayer, cuatro episodios, no come. El dueño cree que " +
      "mordió un juguete de goma. Temperatura 39,1, frecuencia cardiaca 140, mucosas pálidas. " +
      "Abdomen tenso y doloroso a la palpación craneal. Sospecho cuerpo extraño intestinal. " +
      "Radiografía abdominal de urgencia y hemograma. Suero fisiológico intravenoso.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /v[óo]mito/i.test(b.motivoConsulta ?? "") },
      { campo: "anamnesis con el juguete", ok: (b) => /juguete|goma|mordi/i.test(b.anamnesis ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 39.1 },
      { campo: "frecuencia cardiaca", ok: (b) => b.signos.frecuenciaCardiaca === 140 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/abdomen|tenso|doloros/i) },
      { campo: "diagnóstico presuntivo", ok: tieneDiagnostico(/cuerpo extra/i, "presuntivo") },
      { campo: "dos estudios", ok: (b) => b.estudios.length >= 2 },
    ],
    noDebeInventar: [
      { campo: "peso", ok: (b) => b.signos.peso === null },
      { campo: "resto normal", ok: (b) => !b.restoNormal },
    ],
  },
  {
    nombre: "4. Control de vacunación sin hallazgos",
    especie: "canino",
    texto:
      "Viene por refuerzo de vacuna polivalente. Peso 22 kilos, temperatura 38,4. " +
      "Examen físico completo normal. Aplico polivalente. Control en un año. " +
      "Le explico a la dueña que puede estar decaído 24 horas.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /vacun|refuerzo/i.test(b.motivoConsulta ?? "") },
      { campo: "peso", ok: (b) => b.signos.peso === 22 },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 38.4 },
      { campo: "resto normal", ok: (b) => b.restoNormal || b.sistemas.every((s) => s.estado === "normal") },
      { campo: "indicaciones al cliente", ok: (b) => /decaíd|24|horas/i.test(b.indicacionesCliente ?? "") },
      { campo: "control a un año", ok: (b) => b.controlDias !== null && b.controlDias >= 300 },
    ],
    noDebeInventar: [
      { campo: "sistema anormal", ok: (b) => b.sistemas.every((s) => s.estado !== "anormal") },
      { campo: "estudios", ok: (b) => b.estudios.length === 0 },
    ],
  },
  {
    nombre: "5. Dermatitis con dos medicamentos",
    especie: "canino",
    texto:
      "Prurito generalizado de dos meses, peor en verano. Peso 31 kilos. " +
      "Piel con eritema en axilas e ingles, alopecia por lamido en patas. " +
      "Dermatitis alérgica. Apoquel media tableta cada 12 horas por 14 días y champú clorhexidina " +
      "dos veces por semana. Raspado cutáneo para descartar sarna. Control en 15 días.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /prurito|rasca|picaz/i.test(b.motivoConsulta ?? "") },
      { campo: "peso", ok: (b) => b.signos.peso === 31 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/eritema|alopecia|axila|ingle/i) },
      { campo: "diagnóstico", ok: tieneDiagnostico(/dermatitis/i) },
      { campo: "dos líneas de receta", ok: (b) => b.receta.length >= 2 },
      { campo: "estudio raspado", ok: tieneEstudio(/raspado/i) },
      { campo: "control 15 días", ok: (b) => b.controlDias === 15 },
    ],
    noDebeInventar: [
      { campo: "temperatura", ok: (b) => b.signos.temperatura === null },
      {
        // «Media tableta» no es una dosis en miligramos: el modelo no
        // puede convertirla sin saber la presentación.
        campo: "dosis en mg del Apoquel",
        ok: (b) => {
          const l = lineaDeReceta(/apoquel/i)(b);
          return !l || l.dosisUnidad === null || l.dosisUnidad !== "mg" || l.dosisCantidad === 0.5;
        },
      },
    ],
  },
  {
    nombre: "6. Dosis que se corta: tiene que quedar «revisar»",
    especie: "canino",
    texto:
      "Viene por tos seca de 4 días. Temperatura 38,8. Tráquea sensible a la palpación, " +
      "tos refleja positiva. Traqueobronquitis infecciosa. Le doy doxiciclina a… la dosis la " +
      "calculo cuando lo pese. Control en una semana.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /tos/i.test(b.motivoConsulta ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 38.8 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/tr[áa]quea|tos/i) },
      { campo: "diagnóstico", ok: tieneDiagnostico(/traqueo/i) },
      { campo: "control 7 días", ok: (b) => b.controlDias === 7 },
    ],
    noDebeInventar: [
      {
        campo: "dosis de doxiciclina",
        ok: (b) => {
          const l = lineaDeReceta(/doxiciclina/i)(b);
          // O no la pone, o la pone vacía y marcada. Lo que no puede es
          // poner un número que nadie dijo.
          return !l || (l.dosisCantidad === null && l.revisar.length > 0);
        },
      },
      { campo: "peso", ok: (b) => b.signos.peso === null },
    ],
  },
  {
    nombre: "7. Geriátrico con varios sistemas",
    especie: "canino",
    texto:
      "Perra de 13 años, la traen por decaimiento y aumento de la sed desde hace un mes. " +
      "Peso 9,8 kilos, temperatura 38,2, frecuencia cardiaca 96, condición corporal 3. " +
      "Mucosas pálidas, soplo cardiaco grado 2, abdomen sin dolor. " +
      "Sospecho enfermedad renal crónica. Pido hemograma, química sanguínea y urianálisis. " +
      "Dieta renal. Control en 7 días con resultados.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /decaimiento|sed|policlips?|polidipsia/i.test(b.motivoConsulta ?? "") },
      { campo: "peso", ok: (b) => b.signos.peso === 9.8 },
      { campo: "condición corporal", ok: (b) => b.signos.condicionCorporal === 3 },
      { campo: "frecuencia cardiaca", ok: (b) => b.signos.frecuenciaCardiaca === 96 },
      { campo: "dos sistemas anormales", ok: (b) => b.sistemas.filter((s) => s.estado === "anormal").length >= 2 },
      { campo: "diagnóstico presuntivo", ok: tieneDiagnostico(/renal/i, "presuntivo") },
      { campo: "tres estudios", ok: (b) => b.estudios.length >= 3 },
      { campo: "control 7 días", ok: (b) => b.controlDias === 7 },
    ],
    noDebeInventar: [
      { campo: "receta", ok: (b) => b.receta.length === 0 },
      { campo: "frecuencia respiratoria", ok: (b) => b.signos.frecuenciaRespiratoria === null },
    ],
  },
  {
    nombre: "8. Herida con sutura",
    especie: "felino",
    texto:
      "Gato entero que se peleó anoche. Herida punzante en la base de la cola, con secreción " +
      "purulenta. Temperatura 39,4. Lavado, desbridamiento y dos puntos. " +
      "Amoxicilina con ácido clavulánico 12,5 miligramos por kilo cada 12 horas por 7 días. " +
      "Peso 5 kilos. Control en 3 días para retirar puntos. Collar isabelino.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /herida|pelea|pele/i.test(b.motivoConsulta ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 39.4 },
      { campo: "peso", ok: (b) => b.signos.peso === 5 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/herida|purulent|cola/i) },
      { campo: "receta: dosis 12,5 mg/kg", ok: (b) => lineaDeReceta(/amoxicilina/i)(b)?.dosisCantidad === 12.5 },
      { campo: "receta: 7 días", ok: (b) => lineaDeReceta(/amoxicilina/i)(b)?.duracionCantidad === 7 },
      { campo: "control 3 días", ok: (b) => b.controlDias === 3 },
      { campo: "indicaciones con el collar", ok: (b) => /collar|isabelin/i.test(b.indicacionesCliente ?? "") },
    ],
    noDebeInventar: [{ campo: "estudios", ok: (b) => b.estudios.length === 0 }],
  },
  {
    nombre: "9. Desparasitación y peso solamente",
    especie: "canino",
    texto: "Viene solo por desparasitación. Peso 12,5 kilos. Se ve bien. Le doy la tableta hoy.",
    debeAparecer: [
      { campo: "motivo", ok: (b) => /desparasit/i.test(b.motivoConsulta ?? "") },
      { campo: "peso", ok: (b) => b.signos.peso === 12.5 },
    ],
    noDebeInventar: [
      { campo: "temperatura", ok: (b) => b.signos.temperatura === null },
      { campo: "diagnósticos", ok: (b) => b.diagnosticos.length === 0 },
      { campo: "estudios", ok: (b) => b.estudios.length === 0 },
      { campo: "control", ok: (b) => b.controlDias === null },
    ],
  },
  {
    nombre: "10. Dictado desordenado, con corrección en el medio",
    especie: "canino",
    texto:
      "A ver… viene por… la dueña dice que orina mucho. Perdón, orina poco y con esfuerzo. " +
      "Macho de 7 años. Temperatura 38,7, peso 26 kilos. Vejiga distendida y dolorosa. " +
      "Próstata aumentada al tacto rectal. Sospecho hiperplasia prostática. " +
      "Ecografía abdominal. Finasterida 0,1 miligramos por kilo cada 24 horas. " +
      "No, mejor dejemos la finasterida para cuando tenga la ecografía.",
    debeAparecer: [
      // LO QUE IMPORTA DE ESTE CASO: la corrección gana. Dijo «orina
      // mucho» y se corrigió a «orina poco», y dijo un medicamento y
      // después lo retiró.
      { campo: "motivo con la corrección", ok: (b) => /poco|esfuerzo|disuria/i.test(b.motivoConsulta ?? "") },
      { campo: "temperatura", ok: (b) => b.signos.temperatura === 38.7 },
      { campo: "peso", ok: (b) => b.signos.peso === 26 },
      { campo: "sistema anormal con hallazgo", ok: tieneSistemaAnormal(/vejiga|pr[óo]stata/i) },
      { campo: "diagnóstico presuntivo", ok: tieneDiagnostico(/prost[áa]tica|hiperplasia/i, "presuntivo") },
      { campo: "estudio ecografía", ok: tieneEstudio(/ecograf/i) },
    ],
    noDebeInventar: [
      { campo: "finasterida retirada", ok: (b) => b.receta.length === 0 },
      { campo: "control", ok: (b) => b.controlDias === null },
    ],
  },
];

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
  exigirEntornoDeDesarrollo("medir_dictado_07d");
  await borrarClinicasDePrueba();

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','medicion@07d.test','CR') RETURNING id`,
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
    `INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd) VALUES ($1, 50, 0)`,
    [tenantId]
  );

  const catalogos = await conAlcanceTenant(tenantId, (db) => catalogosDelDictado(db));

  let aciertos = 0;
  let total = 0;
  let inventos = 0;
  let totalNoInventar = 0;
  const porCaso: Array<{ nombre: string; aciertos: number; total: number; inventos: number }> = [];

  for (const caso of CASOS) {
    console.log(`\n=== ${caso.nombre} ===`);
    const r = await ordenarDictado(
      catalogos,
      caso.texto,
      { especie: caso.especie, raza: null, sexo: null, edad: null, pesoConocidoKg: null },
      MODELO
    );
    const b = r.borrador;

    let aciertosCaso = 0;
    for (const c of caso.debeAparecer) {
      total++;
      const bien = c.ok(b);
      if (bien) {
        aciertos++;
        aciertosCaso++;
      } else {
        console.log(`  [FALTA] ${c.campo}`);
      }
    }
    let inventosCaso = 0;
    for (const c of caso.noDebeInventar) {
      totalNoInventar++;
      if (!c.ok(b)) {
        inventos++;
        inventosCaso++;
        console.log(`  [INVENTÓ] ${c.campo}`);
      }
    }
    console.log(
      `  ${aciertosCaso}/${caso.debeAparecer.length} campos repartidos · ` +
        `${inventosCaso} invenciones de ${caso.noDebeInventar.length} controles`
    );
    porCaso.push({
      nombre: caso.nombre,
      aciertos: aciertosCaso,
      total: caso.debeAparecer.length,
      inventos: inventosCaso,
    });

    // El consumo se registra por el punto de la aplicación, con las
    // tarifas de la base: así el costo medido es el que se le cobra a la
    // clínica, no uno calculado acá en paralelo.
    const palabras = caso.texto.split(/\s+/).filter(Boolean).length;
    const segundos = Math.max(1, Math.round((palabras / 150) * 60));
    await conAlcanceTenant(tenantId, async (db) => {
      await registrarUsoApi(db, {
        tenantId,
        casoId: null,
        medicoAgenteId: null,
        personaId: null,
        modelo: MODELO,
        tokensEntrada: r.uso.tokensEntrada,
        tokensSalida: r.uso.tokensSalida,
        tokensCacheEscritura: r.uso.tokensCacheEscritura,
        tokensCacheLectura: r.uso.tokensCacheLectura,
        tipoConsumo: "clinico",
        disparadoPor: "usuario",
      });
      await registrarUsoTranscripcion(db, {
        tenantId,
        personaId: null,
        dictadoId: null,
        proveedor: PROVEEDOR_TRANSCRIPCION,
        segundos,
      });
    });
  }

  const costos = await pool.query<{ ordenamiento: string; transcripcion: string; segundos: string }>(
    `SELECT
       (SELECT COALESCE(SUM(costo_usd_calculado),0) FROM uso_api WHERE tenant_id = $1) AS ordenamiento,
       (SELECT COALESCE(SUM(costo_usd_calculado),0) FROM uso_transcripcion WHERE tenant_id = $1) AS transcripcion,
       (SELECT COALESCE(SUM(segundos),0) FROM uso_transcripcion WHERE tenant_id = $1) AS segundos`,
    [tenantId]
  );
  const ordenamiento = Number(costos.rows[0].ordenamiento);
  const transcripcion = Number(costos.rows[0].transcripcion);
  const segundos = Number(costos.rows[0].segundos);

  console.log("\n==================== RESUMEN ====================");
  console.log(`Dictados medidos: ${CASOS.length}`);
  console.log(
    `Campos repartidos bien: ${aciertos}/${total} (${((aciertos / total) * 100).toFixed(1)} %)`
  );
  console.log(
    `Datos inventados: ${inventos}/${totalNoInventar} controles ` +
      `(${((inventos / totalNoInventar) * 100).toFixed(1)} % de invención)`
  );
  console.log("");
  for (const c of porCaso) {
    console.log(`  ${c.aciertos}/${c.total} · ${c.inventos} invenciones — ${c.nombre}`);
  }
  console.log("");
  console.log(`Audio estimado: ${segundos} s en total (${(segundos / CASOS.length).toFixed(0)} s por consulta)`);
  console.log(`Costo de transcripción (${PROVEEDOR_TRANSCRIPCION}): USD ${transcripcion.toFixed(6)}`);
  console.log(`Costo de ordenamiento (${MODELO}):  USD ${ordenamiento.toFixed(6)}`);
  console.log(
    `COSTO POR CONSULTA: USD ${((transcripcion + ordenamiento) / CASOS.length).toFixed(5)} ` +
      `(transcripción USD ${(transcripcion / CASOS.length).toFixed(5)} + ` +
      `ordenamiento USD ${(ordenamiento / CASOS.length).toFixed(5)})`
  );
  console.log("=================================================");

  await borrarClinicasDePrueba();
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exitCode = 1;
});
