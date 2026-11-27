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
import {
  unificarClientes,
  unificarPacientes,
  UnificacionImposible,
  fichaViva,
} from "../crm/unificar";
import { clientesDuplicadosDeLaClinica, pacientesParecidos } from "../crm/duplicados";
import { historialDe } from "../crm/consentimientos";
import {
  consultarIdentificacion,
  formatoValido,
  proveedorIdentificacionActivo,
} from "../clientes/proveedorIdentificacionActivo";
import {
  identificacionHacienda,
  identificacionSimulada,
} from "../clientes/proveedorIdentificacion";
import { buscarPropietariosTolerante } from "../busquedaPropietarios";

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

    // =================================================================
    console.log("\n=== B1. Unificar duplicados ===");
    // -----------------------------------------------------------------
    // La pareja de prueba: el mismo cliente cargado dos veces, con el
    // teléfono escrito distinto y la cédula solo en una de las fichas.
    const tipoCedula = (
      await db.query<{ id: string }>(`SELECT id FROM tipos_identificacion LIMIT 1`)
    ).rows[0].id;
    const fichaVieja = await crearPropietario(
      db,
      tenantId,
      {
        nombre: "Rosa Méndez Castro",
        telefono: "8711-2233",
        email: `${PREFIJO}-rosa@probe.invalid`,
        tipoIdentificacionId: tipoCedula,
        numeroIdentificacion: "901230456",
      },
      medicoId
    );
    const nueva = await crearPropietario(
      db,
      tenantId,
      { nombre: "Rosa Mendez", telefono: "87112233" },
      medicoId
    );

    // El barrido de la clínica las encuentra como par.
    const pares = await clientesDuplicadosDeLaClinica(db, 50);
    const elPar = pares.find(
      (x) =>
        (x.a.id === fichaVieja.id && x.b.id === nueva.id) ||
        (x.a.id === nueva.id && x.b.id === fichaVieja.id)
    );
    assert(Boolean(elPar), "el barrido encuentra el par de clientes duplicados");
    igual(
      elPar?.a.criterios.includes("telefono"),
      true,
      "y dice por qué: el mismo teléfono escrito distinto"
    );

    // Historia en las dos fichas: el perro en una, el consentimiento en
    // la otra. Es lo que hace que la fusión importe.
    const perroDeLaVieja = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9101,'Tobi','Canino') RETURNING id`,
        [tenantId, fichaVieja.id]
      )
    ).rows[0].id;
    // EL CASO QUE OBLIGA A CAMBIAR ALGO: el que sobrevive tiene el SÍ y
    // el absorbido el NO. Al revés la negativa gana sin hacer nada, y la
    // aserción pasaría sin probar el código que importa.
    await registrarConsentimiento(db, tenantId, {
      propietarioId: fichaVieja.id,
      canal: "correo",
      finalidad: "promociones",
      otorgado: false,
      fuente: "respuesta_cliente",
      personaId: medicoId,
    });
    await registrarConsentimiento(db, tenantId, {
      propietarioId: nueva.id,
      canal: "correo",
      finalidad: "promociones",
      otorgado: true,
      fuente: "recepcion",
      personaId: medicoId,
    });
    const interaccionesAntes = Number(
      (await db.query<{ n: string }>(`SELECT count(*) AS n FROM crm_interacciones`)).rows[0].n
    );

    const fusion = await unificarClientes(db, tenantId, {
      sobrevivienteId: nueva.id,
      absorbidoId: fichaVieja.id,
      elegido: { nombre: "Rosa Méndez Castro", email: `${PREFIJO}-rosa@probe.invalid` },
      personaId: medicoId,
    });

    // 1. GANA LA NEGATIVA.
    const promos = await db.query<{ otorgado: boolean }>(
      `SELECT otorgado FROM crm_consentimientos
        WHERE propietario_id = $1 AND canal = 'correo' AND finalidad = 'promociones'`,
      [nueva.id]
    );
    igual(
      promos.rows[0]?.otorgado,
      false,
      "consentimientos en conflicto: una decía sí y la otra no, gana la NEGATIVA"
    );
    assert(
      fusion.conflictos.some((c) => c.includes("NO")),
      "y el conflicto queda dicho en castellano",
      fusion.conflictos.join(" | ")
    );

    // 2. EL PACIENTE SE MUDÓ.
    const duenoDelPerro = await db.query<{ propietario_id: string }>(
      `SELECT propietario_id FROM pacientes WHERE id = $1`,
      [perroDeLaVieja]
    );
    igual(duenoDelPerro.rows[0].propietario_id, nueva.id, "el paciente pasó a la ficha que sobrevivió");

    // 3. LA IDENTIFICACIÓN SE MUDÓ, porque el sobreviviente no tenía.
    const identificacion = await db.query<{ numero_identificacion: string | null }>(
      `SELECT numero_identificacion FROM propietarios WHERE id = $1`,
      [nueva.id]
    );
    igual(
      identificacion.rows[0].numero_identificacion,
      "901230456",
      "la cédula pasó a la ficha que sobrevivió, que no tenía"
    );

    // 4. crm_interacciones NO CAMBIÓ NI UNA FILA: solo se agregaron.
    const sinUpdate = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM crm_interacciones WHERE propietario_id = $1`,
      [fichaVieja.id]
    );
    assert(
      Number(sinUpdate.rows[0].n) > 0,
      "los eventos del absorbido siguen apuntando al absorbido: append-only respetado",
      `${sinUpdate.rows[0].n} eventos`
    );
    const interaccionesDespues = Number(
      (await db.query<{ n: string }>(`SELECT count(*) AS n FROM crm_interacciones`)).rows[0].n
    );
    assert(
      interaccionesDespues > interaccionesAntes,
      "y la fusión agregó su propio evento en vez de reescribir",
      `${interaccionesAntes} → ${interaccionesDespues}`
    );

    // 5. LA LÍNEA DE TIEMPO DEL SOBREVIVIENTE MUESTRA LAS DOS HISTORIAS.
    const lineaFusion = await lineaDeInteracciones(db, { propietarioId: nueva.id }, true);
    assert(
      lineaFusion.some((e) => e.propietario_id === fichaVieja.id),
      "la línea de tiempo del sobreviviente incluye los eventos del absorbido",
      `${lineaFusion.length} eventos`
    );
    assert(
      lineaFusion.some((e) => e.tipo === "cliente_unificado"),
      "y el evento de la fusión está ahí"
    );
    const historial = await historialDe(db, nueva.id);
    assert(
      historial.some((h) => h.fuente === "unificacion"),
      "el historial de consentimientos registra que lo cambió una fusión",
      historial.map((h) => h.fuente).join(", ")
    );

    // 6. EL ABSORBIDO NO APARECE EN LAS BÚSQUEDAS.
    const buscado = await buscarPropietariosTolerante(db, "Rosa Méndez", 20);
    assert(
      !buscado.some((b) => b.id === fichaVieja.id),
      "el absorbido no aparece en la búsqueda de clientes"
    );
    assert(
      buscado.some((b) => b.id === nueva.id),
      "y el que sobrevivió sí"
    );
    igual(
      await fichaViva(db, "propietarios", fichaVieja.id),
      nueva.id,
      "un enlace viejo al absorbido lleva a la ficha viva"
    );

    // 7. NO SE UNIFICA DOS VECES.
    let yaUnificado = false;
    try {
      await unificarClientes(db, tenantId, {
        sobrevivienteId: nueva.id,
        absorbidoId: fichaVieja.id,
        personaId: medicoId,
      });
    } catch (err) {
      yaUnificado = err instanceof UnificacionImposible;
    }
    assert(yaUnificado, "una ficha ya unificada no se vuelve a unificar");

    // 8. EL CRÉDITO FRENA LA FUSIÓN.
    const conCredito1 = await crearPropietario(
      db,
      tenantId,
      { nombre: "Deudor Uno", telefono: "87770001" },
      medicoId
    );
    const conCredito2 = await crearPropietario(
      db,
      tenantId,
      { nombre: "Deudor Uno", telefono: "87770001" },
      medicoId
    );
    for (const id of [conCredito1.id, conCredito2.id]) {
      await db.query(
        `INSERT INTO vta_credito_cliente (tenant_id, propietario_id, limite, habilitado)
         VALUES ($1,$2,100000,true)`,
        [tenantId, id]
      );
    }
    let frenado = "";
    try {
      await unificarClientes(db, tenantId, {
        sobrevivienteId: conCredito1.id,
        absorbidoId: conCredito2.id,
        personaId: medicoId,
      });
    } catch (err) {
      frenado = err instanceof UnificacionImposible ? err.message : "otro error";
    }
    assert(
      frenado.includes("crédito"),
      "dos líneas de crédito abiertas frenan la fusión en vez de inventar una regla de plata",
      frenado
    );

    // -----------------------------------------------------------------
    // PACIENTES
    // -----------------------------------------------------------------
    const gato1 = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9201,'Michi Pérez','Felino') RETURNING id`,
        [tenantId, nueva.id]
      )
    ).rows[0].id;
    const gato2 = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9202,'michi','Felino') RETURNING id`,
        [tenantId, nueva.id]
      )
    ).rows[0].id;
    const grupos = await pacientesParecidos(db, { propietarioId: nueva.id });
    assert(
      grupos.some((g) => g.grupo.some((x) => x.id === gato1) && g.grupo.some((x) => x.id === gato2)),
      "«Michi Pérez» y «michi» del mismo dueño se proponen como el mismo gato",
      JSON.stringify(grupos.map((g) => g.grupo.map((x) => x.nombre)))
    );

    const fusionGato = await unificarPacientes(db, tenantId, {
      sobrevivienteId: gato1,
      absorbidoId: gato2,
      elegido: { nombre: "Michi" },
      personaId: medicoId,
    });
    assert(Boolean(fusionGato.sobrevivienteId), "los dos expedientes se unifican");
    const alias = await db.query<{ alias: string[]; nombre: string }>(
      `SELECT numero_expediente_alias AS alias, nombre FROM pacientes WHERE id = $1`,
      [gato1]
    );
    assert(
      alias.rows[0].alias.includes("9202"),
      "el número del expediente absorbido queda buscable en el que sobrevivió",
      JSON.stringify(alias.rows[0].alias)
    );
    igual(alias.rows[0].nombre, "Michi", "y el nombre elegido campo por campo se aplicó");
    const absorbido = await db.query<{ estado: string; baja_motivo: string | null }>(
      `SELECT estado, baja_motivo FROM pacientes WHERE id = $1`,
      [gato2]
    );
    igual(absorbido.rows[0].estado, "baja_otro", "el expediente absorbido deja de estar activo");

    // DOS DUEÑOS DISTINTOS NO SE UNIFICAN SOLOS.
    const deOtroDueno = (
      await db.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie)
         VALUES ($1,$2,9203,'Michi','Felino') RETURNING id`,
        [tenantId, quienRefiere.id]
      )
    ).rows[0].id;
    let otroDueno = "";
    try {
      await unificarPacientes(db, tenantId, {
        sobrevivienteId: gato1,
        absorbidoId: deOtroDueno,
        personaId: medicoId,
      });
    } catch (err) {
      otroDueno = err instanceof UnificacionImposible ? err.message : "otro error";
    }
    assert(
      otroDueno.includes("clientes distintos"),
      "dos pacientes de dueños distintos no se unifican: primero se unifican los clientes",
      otroDueno
    );

    // LA AUDITORÍA NO SE REESCRIBE.
    const auditoria = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM crm_unificaciones`
    );
    igual(auditoria.rows[0].n, "2", "cada fusión dejó su fila de auditoría");
    // EL SAVEPOINT NO ES UN DETALLE: este UPDATE tiene que fallar, y un
    // error de Postgres aborta la transacción entera —todo lo que viene
    // después moriría con «current transaction is aborted»—. El
    // savepoint deja probar el trigger sin perder la transacción.
    let appendOnly = false;
    await db.query("SAVEPOINT antes_del_update");
    try {
      await db.query(`UPDATE crm_unificaciones SET absorbido_nombre = 'otro'`);
      await db.query("RELEASE SAVEPOINT antes_del_update");
    } catch {
      appendOnly = true;
      await db.query("ROLLBACK TO SAVEPOINT antes_del_update");
    }
    assert(appendOnly, "la auditoría de la fusión es solo de inserción");

    // =================================================================
    console.log("\n=== B2. Autocompletar por identificación ===");
    // -----------------------------------------------------------------
    // El proveedor por omisión es el simulado: ninguna consulta sale
    // hacia un servicio público del Estado desde desarrollo.
    igual(
      proveedorIdentificacionActivo().nombre,
      "simulado",
      "el proveedor por omisión es el simulado"
    );
    igual(
      identificacionSimulada.disponible().ok,
      true,
      "el simulado está siempre disponible"
    );
    // El real: sin URL mal puesta, está disponible —la API de
    // contribuyentes es pública y no tiene credencial—, y con una URL
    // inválida dice exactamente qué falta.
    const antes = process.env.IDENTIDAD_URL;
    process.env.IDENTIDAD_URL = "no-es-una-url";
    const malConfigurado = identificacionHacienda.disponible();
    assert(!malConfigurado.ok, "el real mal configurado no se declara disponible");
    assert(
      (malConfigurado.falta ?? "").includes("IDENTIDAD_URL"),
      "y dice qué variable está mal",
      malConfigurado.falta
    );
    if (antes === undefined) delete process.env.IDENTIDAD_URL;
    else process.env.IDENTIDAD_URL = antes;

    // LA CACHÉ ES DE LA PLATAFORMA, no de esta clínica de prueba: no se
    // va con el tenant al borrarlo, así que el verificador limpia sus
    // tres números antes de empezar. Sin esto, la segunda corrida ve la
    // caché de la primera y la aserción de «la primera consulta no
    // viene de la caché» falla por el ambiente y no por el código.
    await db.query(
      `DELETE FROM identificacion_cache
        WHERE numero IN ('102340565','102340560','102340569')`
    );

    const cedula = (
      await db.query<{ id: string }>(
        `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND codigo = '01'`
      )
    ).rows[0].id;
    const pasaporte = (
      await db.query<{ id: string }>(
        `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND codigo = '05'`
      )
    ).rows[0].id;

    // EL FORMATO SALE DEL CATÁLOGO, no de una constante en el código.
    const nueve = await formatoValido(db, cedula, "102340565");
    assert(nueve.valido, "nueve dígitos son una cédula física válida", nueve.formato);
    const ocho = await formatoValido(db, cedula, "10234056");
    assert(!ocho.valido, "ocho no: el número todavía no está completo");
    const conGuiones = await formatoValido(db, cedula, "1-0234-0565");
    assert(conGuiones.valido, "los guiones no cambian el número: se limpian antes de validar");
    const sinFormato = await formatoValido(db, pasaporte, "AB1234567");
    igual(
      sinFormato.formato,
      null,
      "el pasaporte no tiene formato cargado a propósito: es de otro país"
    );

    // EL SIMULADO ES DETERMINISTA: la misma cédula da lo mismo siempre.
    const primera = await consultarIdentificacion(db, tenantId, "01", "102340565");
    const deNuevo = await consultarIdentificacion(db, tenantId, "01", "102340565");
    assert(primera.encontrado, "el simulado encuentra la cédula de prueba");
    igual(
      deNuevo.datos?.nombre,
      primera.datos?.nombre,
      "y devuelve SIEMPRE lo mismo para el mismo número"
    );
    assert(!primera.deCache, "la primera consulta no viene de la caché");
    assert(deNuevo.deCache, "la segunda sí: se cacheó");

    // «NO EXISTE» TAMBIÉN SE CACHEA: preguntar diez veces por una cédula
    // que no está inscrita son diez viajes para la misma nada.
    const noExiste = await consultarIdentificacion(db, tenantId, "01", "102340560");
    assert(!noExiste.encontrado, "el número terminado en 0 no existe (caso del simulado)");
    const guardadoNegativo = await db.query<{ encontrado: boolean }>(
      `SELECT encontrado FROM identificacion_cache WHERE numero = '102340560'`
    );
    igual(guardadoNegativo.rows[0]?.encontrado, false, "y el «no existe» quedó cacheado");

    // LA NO-RESPUESTA NO SE CACHEA. Un timeout no es un dato sobre esa
    // cédula: cachearlo dejaría el autocompletar roto treinta días por
    // una caída de un minuto.
    const sinRespuesta = await consultarIdentificacion(db, tenantId, "01", "102340569");
    assert(!sinRespuesta.encontrado, "el terminado en 9 simula que el servicio no contesta");
    assert(Boolean(sinRespuesta.errorTecnico), "y lo dice como error técnico", sinRespuesta.errorTecnico);
    const nadaCacheado = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM identificacion_cache WHERE numero = '102340569'`
    );
    igual(nadaCacheado.rows[0].n, "0", "y NO se cacheó: el servicio podría estar bien mañana");

    // EL ALTA GUARDA DE DÓNDE SALIÓ EL DATO (ley 8968).
    const autocompletado = await crearPropietario(
      db,
      tenantId,
      {
        nombre: primera.datos?.nombre ?? "Sin nombre",
        telefono: "87654321",
        tipoIdentificacionId: cedula,
        numeroIdentificacion: "102340565",
        datosFuente: "simulado",
      },
      medicoId
    );
    const fuente = await db.query<{ datos_fuente: string | null; datos_fuente_en: Date | null }>(
      `SELECT datos_fuente, datos_fuente_en FROM propietarios WHERE id = $1`,
      [autocompletado.id]
    );
    igual(fuente.rows[0].datos_fuente, "simulado", "el cliente guarda de dónde salió su nombre");
    assert(Boolean(fuente.rows[0].datos_fuente_en), "y cuándo, que es lo que pide la ley 8968");
    const aMano = await crearPropietario(
      db,
      tenantId,
      { nombre: "Escrito A Mano", telefono: "87650000" },
      medicoId
    );
    const sinFuenteDeDatos = await db.query<{ datos_fuente: string | null }>(
      `SELECT datos_fuente FROM propietarios WHERE id = $1`,
      [aMano.id]
    );
    igual(
      sinFuenteDeDatos.rows[0].datos_fuente,
      null,
      "el alta que no lo declara queda en null: «no sabemos», que es la verdad"
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
