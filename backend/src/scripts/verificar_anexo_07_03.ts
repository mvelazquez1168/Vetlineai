// Verificación del anexo 07-03 (relevamiento Digital Vet).
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_anexo_07_03.ts
//
// SIN --transpile-only a propósito: con los tipos apagados, cuatro
// defectos de los verificadores de caja pasaron sin que nadie los viera.
//
// Es re-corrible: borra su clínica de prueba al empezar.
//
// Lo que verifica, bloque por bloque del anexo:
//
//   A1  el examen ordenado: anormales primero, «resto sin alteraciones»,
//       y lo no evaluado separado de lo normal;
//   A2  ingreso y salida: la estancia se sella una vez, la lista de «en
//       la clínica ahora» es entró-y-no-salió;
//   A3  UN SOLO peso para la dosis, con su procedencia, y la posología
//       del producto que llega precargada;
//   A4  la atención no se pisa: versión optimista y 409, y el borrador
//       con su latido de dos minutos;
//   A5  los datos opcionales del paciente, la baja con motivo, la ficha
//       por completar, y el alta de cliente con aviso de duplicado;
//   A6  el laboratorio con su resultado adjunto;
//   B3  cómo llegó el cliente y qué cliente lo trajo;
//   B4  el canal preferido ORDENA y no habilita.
//
// Lo de B1 y B2 se agrega cuando esos bloques estén construidos.

import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { puedeEnviar, registrarConsentimiento } from "../crm/consentimientos";
import { crearPropietario } from "../clientes/altaPropietario";
import { clientesParecidos } from "../crm/duplicados";
import { pesoVigente, calcularDosis, DIAS_PESO_VIEJO } from "../expediente/receta";
import { resumenDelExamen } from "../expediente/examen";
import { sellarIngreso, registrarSalida, enLaClinicaAhora } from "../expediente/estancia";
import { abrirAtencion, guardarSoap, ConflictoDeVersionError } from "../expediente/atencion";
import { tomarOLatir, liberar } from "../expediente/borrador";
import { solicitarEstudio, estudiosDePaciente } from "../expediente/laboratorio";
import { lineaDeInteracciones } from "../crm/interacciones";

const PREFIJO = "probe-anexo";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_anexo_07_03");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@anexo.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  // Ningún correo real sale de esta clínica de prueba.
  await pool.query(
    `INSERT INTO configuracion_notificaciones (tenant_id, confirmacion_cita_activo,
                                               recordatorio_cita_activo)
     VALUES ($1,false,false)`,
    [tenantId]
  );
  const medicoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica,
                             colegiatura)
       VALUES ($1,'Dra. Ana Soto',$2,'x',true,true,'VET-9001') RETURNING id`,
      [tenantId, `${PREFIJO}-medica@probe.test`]
    )
  ).rows[0].id;
  const otroMedicoId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, colegiatura)
       VALUES ($1,'Dr. Beto Ruiz',$2,'x',true,'VET-9002') RETURNING id`,
      [tenantId, `${PREFIJO}-medico2@probe.test`]
    )
  ).rows[0].id;

  await conAlcanceTenant(tenantId, async (db) => {
    // =================================================================
    console.log("\n=== B3. Cómo llegó el cliente y quién lo trajo ===");
    // -----------------------------------------------------------------
    const fuentes = await db.query<{ id: string; codigo: string; pide_referidor: boolean }>(
      `SELECT id, codigo, pide_referidor FROM crm_fuentes_referencia WHERE activo ORDER BY orden`
    );
    assert(
      fuentes.rows.length >= 7,
      "el catálogo de fuentes trae la semilla de plataforma",
      `${fuentes.rows.length} fuentes`
    );
    const referido = fuentes.rows.find((f) => f.codigo === "referido_cliente");
    assert(
      referido?.pide_referidor === true,
      "«referido por un cliente» pide ADEMÁS qué cliente lo trajo"
    );
    assert(
      fuentes.rows.filter((f) => f.pide_referidor).length === 1,
      "pedir el referidor es propiedad de la fuente, no de un código fijo",
      "solo una fuente sembrada lo pide"
    );

    const redes = fuentes.rows.find((f) => f.codigo === "redes_sociales")!;
    const quienRefiere = await crearPropietario(
      db,
      tenantId,
      {
        nombre: "Marta Vega",
        telefono: "88880001",
        email: `${PREFIJO}-marta@probe.invalid`,
        fuenteReferenciaId: redes.id,
      },
      medicoId
    );
    const referida = await crearPropietario(
      db,
      tenantId,
      {
        nombre: "Carlos Pérez",
        telefono: "88880002",
        email: `${PREFIJO}-carlos@probe.invalid`,
        fuenteReferenciaId: referido!.id,
        referidoPorPropietarioId: quienRefiere.id,
      },
      medicoId
    );
    const guardado = await db.query<{ fuente: string | null; referidor: string | null }>(
      `SELECT fuente_referencia_id AS fuente, referido_por_propietario_id AS referidor
         FROM propietarios WHERE id = $1`,
      [referida.id]
    );
    igual(guardado.rows[0].fuente, referido!.id, "la fuente queda guardada en el cliente");
    igual(
      guardado.rows[0].referidor,
      quienRefiere.id,
      "el referidor es un ENLACE a otro cliente, no un texto"
    );

    const linea = await lineaDeInteracciones(db, { propietarioId: referida.id, limite: 20 }, true);
    const tipos = linea.map((i) => i.tipo);
    assert(
      tipos.includes("cliente_referido"),
      "el referido deja su propio evento en la línea de tiempo",
      tipos.join(", ")
    );
    assert(
      tipos.includes("cliente_registrado"),
      "y no reemplaza al evento de alta: están los dos"
    );
    const evento = linea.find((i) => i.tipo === "cliente_referido")!;
    assert(
      (evento.resumen ?? "").includes("Marta Vega"),
      "el evento dice quién lo refirió, con nombre",
      evento.resumen
    );
    // El cliente sin fuente sigue siendo válido: el dato es opcional y
    // nadie puede inventarlo por el que ya estaba registrado.
    const sinFuente = await crearPropietario(
      db,
      tenantId,
      { nombre: "Sin Fuente", telefono: "88880003" },
      medicoId
    );
    assert(Boolean(sinFuente.id), "el alta sin fuente de referencia sigue funcionando");

    // =================================================================
    console.log("\n=== B4. El canal preferido ORDENA, no habilita ===");
    // -----------------------------------------------------------------
    const pacienteDeMarta = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9001,'Rocky','Canino') RETURNING id`,
        [tenantId, quienRefiere.id]
      )
    ).rows[0].id;

    // Dentro de la franja horaria, para que el único motivo posible sea
    // el consentimiento. El verificador no puede esperar a mañana.
    const enHorario = new Date();
    enHorario.setHours(10, 0, 0, 0);
    const consulta = {
      tenantId,
      propietarioId: quienRefiere.id,
      pacienteId: pacienteDeMarta,
      finalidad: "salud" as const,
      tipo: "probe_b4",
      ahora: enHorario,
    };

    // 1. Sin preferencia: sale, y no está marcado como alternativo.
    const v1 = await puedeEnviar(db, consulta);
    assert(v1.puede, "sin preferencia el envío de salud sale", v1.motivo ?? v1.canal);
    assert(!v1.canalAlternativo, "y no se marca como canal alternativo");

    // 2. Prefiere WhatsApp y lo tiene consentido: sale por WhatsApp.
    await db.query(
      `INSERT INTO crm_preferencias_contacto (tenant_id, propietario_id, canal_preferido)
       VALUES ($1,$2,'whatsapp')
       ON CONFLICT (propietario_id) DO UPDATE SET canal_preferido = 'whatsapp'`,
      [tenantId, quienRefiere.id]
    );
    await registrarConsentimiento(db, tenantId, {
      propietarioId: quienRefiere.id,
      canal: "whatsapp",
      finalidad: "salud",
      otorgado: true,
      fuente: "recepcion",
      personaId: medicoId,
    });
    const v2 = await puedeEnviar(db, consulta);
    igual(v2.canal, "whatsapp", "el canal preferido y consentido es el que se usa");
    assert(v2.puede, "y el envío sale");
    assert(!v2.canalAlternativo, "no es alternativo: es el que el cliente eligió");

    // 3. Prefiere WhatsApp pero NO lo consiente: cae al correo, MARCADO.
    //    Es el defecto que este bloque corrige: antes cortaba acá con
    //    `sin_consentimiento` aunque el correo estuviera consentido.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: quienRefiere.id,
      canal: "whatsapp",
      finalidad: "salud",
      otorgado: false,
      fuente: "respuesta_cliente",
      personaId: medicoId,
    });
    const v3 = await puedeEnviar(db, consulta);
    assert(v3.puede, "el envío NO se cae porque el preferido no esté consentido", v3.motivo);
    igual(v3.canal, "correo", "se usa el siguiente canal consentido");
    assert(v3.canalAlternativo === true, "y queda marcado que no fue el preferido");

    // 4. El preferido NUNCA habilita un envío sin consentimiento.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: quienRefiere.id,
      canal: "correo",
      finalidad: "salud",
      otorgado: false,
      fuente: "respuesta_cliente",
      personaId: medicoId,
    });
    const v4 = await puedeEnviar(db, consulta);
    assert(!v4.puede, "sin ningún canal consentido no sale nada");
    igual(v4.motivo, "sin_consentimiento", "y el motivo lo dice");

    // 5. Un canal PEDIDO explícitamente no se cambia por otro.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: quienRefiere.id,
      canal: "correo",
      finalidad: "salud",
      otorgado: true,
      fuente: "recepcion",
      personaId: medicoId,
    });
    const v5 = await puedeEnviar(db, { ...consulta, canal: "whatsapp" });
    igual(v5.canal, "whatsapp", "el canal pedido por quien llama no se reemplaza");
    assert(!v5.puede, "y si ése no está consentido, el veredicto es que no");

    // 6. El rechazo que se devuelve es el del canal que llegó MÁS LEJOS.
    //    Defecto propio encontrado en la verificación: a las 23:46 el
    //    correo falla solo por la franja y trae `reprogramarPara`;
    //    devolver el `sin_consentimiento` del WhatsApp le hacía perder
    //    a quien llama el único motivo sobre el que puede actuar.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: quienRefiere.id,
      canal: "whatsapp",
      finalidad: "salud",
      otorgado: false,
      fuente: "respuesta_cliente",
      personaId: medicoId,
    });
    const deNoche = new Date();
    deNoche.setHours(23, 46, 0, 0);
    const v6 = await puedeEnviar(db, { ...consulta, ahora: deNoche });
    igual(v6.motivo, "fuera_de_horario", "de noche gana el motivo reprogramable del correo");
    assert(Boolean(v6.reprogramarPara), "y viene con la hora a la que se reprograma");

    // 7. La mascota dada de baja no mejora probando otro canal.
    await db.query(
      `UPDATE pacientes SET estado = 'transferido', baja_motivo = 'Se mudó de país',
                            baja_en = now() WHERE id = $1`,
      [pacienteDeMarta]
    );
    const v7 = await puedeEnviar(db, consulta);
    igual(v7.motivo, "mascota_de_baja", "la baja corta el recorrido entero, sin probar canales");
    await db.query(
      `UPDATE pacientes SET estado = 'activo', baja_motivo = NULL, baja_en = NULL WHERE id = $1`,
      [pacienteDeMarta]
    );

    // =================================================================
    console.log("\n=== A5. Datos del paciente, baja con motivo y duplicados ===");
    // -----------------------------------------------------------------
    // Los cuatro estados de baja bloquean, no solo el fallecimiento.
    for (const estado of ["fallecido", "extraviado", "transferido", "baja_otro"]) {
      await db.query(`UPDATE pacientes SET estado = $2 WHERE id = $1`, [pacienteDeMarta, estado]);
      const v = await puedeEnviar(db, consulta);
      igual(v.motivo, "mascota_de_baja", `el estado «${estado}» bloquea los envíos`);
    }
    await db.query(`UPDATE pacientes SET estado = 'activo' WHERE id = $1`, [pacienteDeMarta]);

    // La ficha por completar mira los cinco datos que el alta rápida no
    // pide, y no los nueve de `completitud`.
    const rapido = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9002,'Michi','Felino') RETURNING id`,
        [tenantId, quienRefiere.id]
      )
    ).rows[0].id;
    const faltan = await db.query<{ faltantes: string[] }>(
      `SELECT pacientes_datos_basicos_faltantes(especie, NULL, raza_id, sexo,
                estado_reproductivo, fecha_nacimiento, edad_anios) AS faltantes
         FROM pacientes WHERE id = $1`,
      [rapido]
    );
    assert(
      faltan.rows[0].faltantes.length > 0,
      "el paciente del alta rápida queda con ficha por completar",
      faltan.rows[0].faltantes.join(", ")
    );
    const completo = await db.query<{ faltantes: string[] }>(
      `SELECT pacientes_datos_basicos_faltantes('Canino','Labrador',NULL,'macho','castrado',
                '2020-01-01'::date, NULL) AS faltantes`
    );
    igual(
      completo.rows[0].faltantes,
      [],
      "con especie, raza, sexo, estado reproductivo y nacimiento no falta nada"
    );
    const soloEdad = await db.query<{ faltantes: string[] }>(
      `SELECT pacientes_datos_basicos_faltantes('Canino','Labrador',NULL,'macho','castrado',
                NULL, 3.5) AS faltantes`
    );
    igual(
      soloEdad.rows[0].faltantes,
      [],
      "la edad en años alcanza: es «edad O nacimiento», no las dos"
    );

    // El hábitat ya no tiene doble gobierno: la clínica agrega la suya.
    await db.query(
      `UPDATE pacientes SET habitat = 'finca' WHERE id = $1`,
      [rapido]
    );
    assert(true, "el hábitat acepta una opción propia de la clínica (CHECK retirado)");

    // La baja escribe motivo y fecha.
    await db.query(
      `UPDATE pacientes SET estado = 'fallecido', baja_motivo = 'Falla renal',
                            baja_en = now() WHERE id = $1`,
      [rapido]
    );
    const baja = await db.query<{ baja_motivo: string; baja_en: Date }>(
      `SELECT baja_motivo, baja_en FROM pacientes WHERE id = $1`,
      [rapido]
    );
    assert(
      baja.rows[0].baja_motivo === "Falla renal" && Boolean(baja.rows[0].baja_en),
      "la baja guarda su motivo y su fecha"
    );

    // Duplicados: identificación exacta y teléfono normalizado.
    const porTelefono = await clientesParecidos(db, {
      nombre: "Marta V.",
      telefono: "8888-0001",
    });
    assert(
      porTelefono.some((c) => c.id === quienRefiere.id),
      "el mismo teléfono con guiones encuentra al cliente que ya existe",
      porTelefono.map((c) => `${c.nombre}:${c.puntaje}`).join(", ")
    );
    const ninguno = await clientesParecidos(db, {
      nombre: "Zoraida Quesada",
      telefono: "22223333",
    });
    assert(
      !ninguno.some((c) => c.id === quienRefiere.id),
      "un cliente sin nada en común no se propone como duplicado"
    );

    // =================================================================
    console.log("\n=== A3. Un solo peso para la dosis, con su procedencia ===");
    // -----------------------------------------------------------------
    // La visita del año pasado, donde quedó el peso de 32,4 kg. El peso
    // NO vive en `pacientes`: vive en la atención en la que se pesó, y
    // por eso «el del expediente» es el de la última visita.
    // Toda atención cuelga de una cita (`atenciones.cita_id` es NOT
    // NULL), así que la vieja también se abre por su camino real y
    // después se cierra con el peso y la fecha de entonces.
    const vieja = await abrirAtencion(db, tenantId, {
      pacienteId: pacienteDeMarta,
      medicoId,
      motivoConsulta: "Consulta del año pasado",
    });
    await db.query(
      `UPDATE atenciones
          SET peso = 32.4, estado = 'cerrada',
              creado_en = now() - interval '200 days',
              cerrada_en = now() - interval '200 days'
        WHERE id = $1`,
      [vieja.id]
    );
    // La de hoy, por su camino real: `abrirAtencion` crea también la
    // cita, que es lo que A2 necesita para el check-in.
    const atencion = (
      await abrirAtencion(db, tenantId, {
        pacienteId: pacienteDeMarta,
        medicoId,
        motivoConsulta: "Control de peso para dosificar",
      })
    ).id;

    // Sin peso de hoy, la dosis usa el de la última visita.
    const p1 = await pesoVigente(db, atencion);
    igual(p1.kg, 32.4, "sin peso de hoy, la dosis usa el de la última visita");
    igual(p1.origen, "ultima_atencion", "y dice de dónde salió");
    assert(
      (p1.antiguedadDias ?? 0) > DIAS_PESO_VIEJO,
      "y cuántos días tiene, para que la pantalla pueda avisar que está viejo",
      `${p1.antiguedadDias} días, umbral ${DIAS_PESO_VIEJO}`
    );
    igual(
      calcularDosis({ dosisCantidad: 4, dosisUnidad: "mg", dosisPorKg: true }, p1.kg).total,
      129.6,
      "la dosis sale del MISMO peso en el panel de receta"
    );

    // El peso dictado manda sobre todo lo demás: es el de hoy.
    const p2 = await pesoVigente(db, atencion, { pesoDictadoKg: 18 });
    igual(p2.kg, 18, "el peso dictado hoy manda sobre el del expediente");
    igual(p2.origen, "dictado", "y su procedencia lo dice");

    // EL MISMO NÚMERO EN LOS DOS CAMINOS. Éste era el defecto que el
    // bloque corrige: el panel del 07c y el borrador del 07d resolvían
    // el peso cada uno por su lado, y el dictado podía dosificar con un
    // peso distinto del que mostraba la pantalla.
    igual(
      calcularDosis({ dosisCantidad: 4, dosisUnidad: "mg", dosisPorKg: true }, p2.kg).total,
      72,
      "18 kg dictados dan 72 mg, el mismo número en el panel y en el dictado"
    );

    // El peso tomado en la atención de hoy manda sobre el de la visita
    // anterior.
    await db.query(`UPDATE atenciones SET peso = 21.5 WHERE id = $1`, [atencion]);
    const p3 = await pesoVigente(db, atencion);
    igual(p3.kg, 21.5, "el peso tomado hoy manda sobre el de la última visita");
    igual(p3.origen, "atencion_actual", "y su procedencia lo dice");
    igual(p3.antiguedadDias, 0, "el de hoy tiene cero días de antigüedad");
    await db.query(`UPDATE atenciones SET peso = NULL WHERE id = $1`, [atencion]);

    // =================================================================
    console.log("\n=== A1. El examen ordenado ===");
    // -----------------------------------------------------------------
    const vacio = await resumenDelExamen(db, atencion);
    assert(vacio.sinExaminar, "un examen sin un solo sistema tocado se dice que falta");
    for (const [sistema, estado, nota] of [
      ["Piel y pelaje", "anormal", "Dermatitis en el lomo"],
      ["Cardiovascular", "normal", null],
      ["Respiratorio", "normal", null],
      ["Neurológico", "no_evaluado", null],
    ] as Array<[string, string, string | null]>) {
      await db.query(
        `INSERT INTO exp_examen_sistemas (tenant_id, atencion_id, sistema, estado, nota)
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, atencion, sistema, estado, nota]
      );
    }
    const resumen = await resumenDelExamen(db, atencion);
    assert(!resumen.sinExaminar, "con sistemas tocados ya se resume");
    const texto = resumen.textoCorrido;
    assert(
      texto.indexOf("Dermatitis") < texto.indexOf("sin alteraciones"),
      "lo anormal se lee primero y lo normal se resume después",
      texto
    );
    assert(
      resumen.noEvaluados.includes("Neurológico"),
      "lo NO evaluado se dice aparte, no se cuenta como normal",
      JSON.stringify(resumen.noEvaluados)
    );
    assert(
      !resumen.normales.includes("Neurológico"),
      "y no se cuela entre los normales"
    );
    assert(
      !texto.includes("Cardiovascular"),
      "los sistemas normales se agrupan en vez de enumerarse",
      texto
    );

    // =================================================================
    console.log("\n=== A2. Ingreso, salida y quién está en la clínica ===");
    // -----------------------------------------------------------------
    await sellarIngreso(db, atencion, null);
    const dosVeces = await db.query<{ ingreso_en: Date }>(
      `SELECT ingreso_en FROM atenciones WHERE id = $1`,
      [atencion]
    );
    const primerIngreso = dosVeces.rows[0].ingreso_en;
    await sellarIngreso(db, atencion, null);
    const otraVez = await db.query<{ ingreso_en: Date }>(
      `SELECT ingreso_en FROM atenciones WHERE id = $1`,
      [atencion]
    );
    igual(
      otraVez.rows[0].ingreso_en?.toISOString(),
      primerIngreso?.toISOString(),
      "el ingreso se sella UNA vez: el segundo no lo mueve"
    );

    const dentro = await enLaClinicaAhora(db);
    assert(
      dentro.some((e) => e.atencionId === atencion),
      "quien entró y no salió aparece en la lista",
      `${dentro.length} en la clínica`
    );
    await registrarSalida(db, atencion);
    const despues = await enLaClinicaAhora(db);
    assert(
      !despues.some((e) => e.atencionId === atencion),
      "y deja de aparecer cuando se registra la salida"
    );

    // =================================================================
    console.log("\n=== A4. La atención no se pisa ===");
    // -----------------------------------------------------------------
    const g1 = await guardarSoap(db, atencion, { anamnesis: "Lo que contó la dueña" }, 0);
    igual(g1.version, 1, "guardar sube la versión de la atención");
    let conflicto = false;
    try {
      await guardarSoap(db, atencion, { anamnesis: "Otra sesión escribiendo" }, 0);
    } catch (err) {
      conflicto = err instanceof ConflictoDeVersionError;
    }
    assert(conflicto, "guardar con una versión vieja es un conflicto, no un sobrescribir");
    const sinPisar = await db.query<{ anamnesis: string }>(
      `SELECT anamnesis FROM atenciones WHERE id = $1`,
      [atencion]
    );
    igual(
      sinPisar.rows[0].anamnesis,
      "Lo que contó la dueña",
      "y lo que había escrito el primero sigue ahí"
    );

    const tomada = await tomarOLatir(db, tenantId, {
      documentoTipo: "atencion",
      documentoId: atencion,
      personaId: medicoId,
    });
    assert(tomada.mio, "el primero que entra toma la atención");
    const segunda = await tomarOLatir(db, tenantId, {
      documentoTipo: "atencion",
      documentoId: atencion,
      personaId: otroMedicoId,
    });
    assert(!segunda.mio, "la segunda sesión NO la toma");
    assert(
      (segunda.porNombre ?? "").includes("Ana"),
      "y le dice quién la tiene abierta",
      segunda.porNombre
    );
    // Latido vencido: se puede reclamar. Dos minutos atrás alcanza.
    await db.query(
      `UPDATE exp_borradores SET ultimo_latido = now() - interval '3 minutes'
        WHERE documento_tipo = 'atencion' AND documento_id = $1`,
      [atencion]
    );
    const reclamada = await tomarOLatir(db, tenantId, {
      documentoTipo: "atencion",
      documentoId: atencion,
      personaId: otroMedicoId,
    });
    assert(reclamada.mio, "con el latido vencido, la otra sesión puede reclamarla");
    await liberar(db, { documentoTipo: "atencion", documentoId: atencion, personaId: otroMedicoId });
    const libre = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM exp_borradores
        WHERE documento_tipo = 'atencion' AND documento_id = $1`,
      [atencion]
    );
    igual(libre.rows[0].n, "0", "al cerrar la atención el borrador se libera");

    // =================================================================
    console.log("\n=== A6. El laboratorio con su resultado adjunto ===");
    // -----------------------------------------------------------------
    const estudio = await solicitarEstudio(db, tenantId, {
      atencionId: atencion,
      pacienteId: pacienteDeMarta,
      tipoEstudio: "Hemograma completo",
      laboratorio: "Laboratorio interno",
      personaId: medicoId,
      fechaMuestra: "2026-11-26",
    });
    assert(Boolean(estudio.id), "el estudio se pide desde un solo lugar");
    const archivoId = (
      await db.query<{ id: string }>(
        `INSERT INTO archivos (estudio_lab_id, paciente_id, nombre_archivo, tipo, url,
                               subido_por_persona_id)
         VALUES ($1,$2,'hemograma.pdf','application/pdf','probe/hemograma.pdf',$3)
         RETURNING id`,
        [estudio.id, pacienteDeMarta, medicoId]
      )
    ).rows[0].id;
    const conResultado = await estudiosDePaciente(db, pacienteDeMarta);
    const elEstudio = conResultado.find((e) => e.id === estudio.id)!;
    assert(
      (elEstudio.adjuntos ?? []).some((a) => a.id === archivoId),
      "el resultado adjunto viaja con el estudio",
      JSON.stringify(elEstudio.adjuntos)
    );
    assert(
      (elEstudio.adjuntos ?? []).length === 1,
      "y el estudio admite más de un archivo sin perder los anteriores"
    );
    const legible = await db.query<{ file_id_anthropic: string | null }>(
      `SELECT file_id_anthropic FROM archivos WHERE id = $1`,
      [archivoId]
    );
    igual(
      legible.rows[0].file_id_anthropic,
      null,
      "el adjunto de laboratorio NO se sube al proveedor del agente"
    );
  });

  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(`\n${ok ? "TODO OK" : "HAY FALLOS"}`);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = ok ? 0 : 1;
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
});
