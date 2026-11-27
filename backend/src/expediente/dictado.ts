import { PoolClient } from "pg";
import { calcularEdadEfectiva } from "../edadPaciente";
import { registrarUsoApi, registrarUsoTranscripcion } from "../tarifas";
import { agregarDiagnostico, avisosAlRecetar, guardarSoap, marcarSistema } from "./atencion";
import { agregarLinea, calcularDosis, pesoVigente } from "./receta";
import { pedirEstudio } from "./preventivos";
import { BorradorDictado, ContextoDelPaciente, LineaRecetaDictada } from "./dictadoBorrador";
import { ResultadoTranscripcion } from "./transcripcion";

// ---------------------------------------------------------------------
// EL DICTADO DE LA CONSULTA — prompt 07d, fase 2.
//
// Este módulo es el que guarda y el que aplica. El que transcribe es
// `transcripcion.ts` y el que ordena es `dictadoBorrador.ts`; están
// separados porque los dos hablan con servicios de afuera y tienen que
// correr SIN la transacción de la request abierta.
//
// LA REGLA QUE MANDA SOBRE TODO LO DEMÁS: nada de lo que propone la IA
// queda registrado hasta que el médico lo acepta, y acepta CAMPO POR
// CAMPO. El borrador vive en `exp_dictados.borrador` como jsonb; el
// expediente no se toca hasta `aplicarBorrador`.
//
// Lo que esto NO hace, y es deliberado:
//   * no firma la atención — la firma es el acto del 07 y sigue siendo
//     un botón aparte;
//   * no cobra nada — los cargos los genera el cierre, y la receta
//     dispensada acá la decide el médico línea por línea en el 07c;
//   * no agenda el control — lo deja propuesto en `control_fecha`, que
//     es lo que el cierre lee para agendarlo.
// ---------------------------------------------------------------------

export interface EstadoDelDictado {
  activo: boolean;
  retencionAudioHoras: number;
}

/**
 * Si esta clínica tiene el dictado por IA encendido.
 *
 * Apagado es el estado por omisión y el que vale si no hay fila de
 * configuración: el dictado consume crédito, y cobrarle a una clínica
 * por un servicio que nunca encendió no es una opción.
 */
export async function estadoDelDictado(db: PoolClient, tenantId: string): Promise<EstadoDelDictado> {
  const r = await db.query<{ dictado_ia_activo: boolean; dictado_retencion_audio_horas: number }>(
    `SELECT dictado_ia_activo, dictado_retencion_audio_horas
       FROM configuracion_notificaciones WHERE tenant_id = $1`,
    [tenantId]
  );
  if (r.rows.length === 0) return { activo: false, retencionAudioHoras: 0 };
  return {
    activo: r.rows[0].dictado_ia_activo,
    retencionAudioHoras: Number(r.rows[0].dictado_retencion_audio_horas),
  };
}

export interface DictadoGuardado {
  id: string;
  atencionId: string;
  estado: "transcrito" | "ordenado" | "aplicado" | "descartado";
  proveedor: string;
  segundosAudio: number;
  textoTranscrito: string;
  borrador: BorradorDictado | null;
  camposAplicados: string[];
  creadoEn: string;
  /** Lo que costó: transcripción + ordenamiento, en USD. */
  costoUsd: number | null;
}

/** El contexto del paciente de una atención, para el ordenamiento. */
export async function contextoDelPaciente(
  db: PoolClient,
  atencionId: string
): Promise<{ pacienteId: string; contexto: ContextoDelPaciente } | null> {
  const r = await db.query<{
    paciente_id: string;
    especie: string | null;
    raza: string | null;
    sexo: string | null;
    edad_anios: number | null;
    fecha_nacimiento: string | null;
    peso: string | null;
  }>(
    `SELECT a.paciente_id, p.especie, p.raza, p.sexo, p.edad_anios,
            p.fecha_nacimiento::text AS fecha_nacimiento, a.peso
       FROM atenciones a JOIN pacientes p ON p.id = a.paciente_id
      WHERE a.id = $1`,
    [atencionId]
  );
  if (r.rows.length === 0) return null;
  const f = r.rows[0];
  // LA EDAD SALE DEL PUNTO ÚNICO, no de una cuenta propia.
  //
  // Esta función tenía su propio `Math.floor(dias / 365.25)`, y un
  // paciente que cumple años hoy salía con un año menos: 1826 días
  // divididos por 365,25 da 4,999. El repo ya tiene
  // `calcularEdadEfectiva` justamente para que el agente, la ficha, la
  // receta y el informe no muestren números distintos; esto era un
  // quinto cálculo. Lo encontró el verificador del 07d al correr otro
  // día que cuando se escribió.
  const anios = calcularEdadEfectiva(f.fecha_nacimiento, f.edad_anios);
  const edad =
    anios === null ? null : `${Math.round(anios)} año${Math.round(anios) === 1 ? "" : "s"}`;
  return {
    pacienteId: f.paciente_id,
    contexto: {
      especie: f.especie,
      raza: f.raza,
      sexo: f.sexo,
      edad,
      pesoConocidoKg: f.peso === null ? null : Number(f.peso),
    },
  };
}

// ---------------------------------------------------------------------
// EL CALCE DE LOS MEDICAMENTOS
//
// «carprofeno» tiene que llegar a «Carprofeno 50 mg — Tableta». Lo hace
// SQL y no el modelo (ver el encabezado de dictadoBorrador.ts).
//
// Y si calzan dos, no se elige: queda sin calzar y marcado «nombre» en
// revisar. Elegir el primero de dos presentaciones distintas del mismo
// principio activo es elegir una dosis por el médico.
// ---------------------------------------------------------------------
export async function calzarMedicamento(
  db: PoolClient,
  nombreDicho: string
): Promise<{ presentacionId: string; nombre: string } | { ambiguo: true } | null> {
  // Se busca por la palabra más larga del nombre dicho: «carprofeno 4
  // miligramos» tiene que encontrar «Carprofeno», y buscar la frase
  // completa no encontraría nada.
  const palabras = nombreDicho
    .split(/[\s,/()-]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4 && !/\d/.test(p))
    .sort((a, b) => b.length - a.length);
  if (palabras.length === 0) return null;

  const r = await db.query<{ id: string; nombre: string; presentacion: string }>(
    `SELECT pr.id, p.nombre, pr.nombre AS presentacion
       FROM inv_presentaciones pr
       JOIN inv_productos p ON p.id = pr.producto_id
      WHERE p.activo
        AND (p.nombre ILIKE $1 OR p.principio_activo ILIKE $1)
      ORDER BY p.nombre, pr.nombre
      LIMIT 5`,
    [`%${palabras[0]}%`]
  );
  if (r.rows.length === 0) return null;
  if (r.rows.length > 1) return { ambiguo: true };
  return { presentacionId: r.rows[0].id, nombre: `${r.rows[0].nombre} — ${r.rows[0].presentacion}` };
}

/**
 * Completa las líneas de receta del borrador: calce con el catálogo,
 * dosis calculada con el peso y avisos de alergia del 07c.
 *
 * QUÉ PESO SE USA, Y POR QUÉ ESTO IMPORTA. El médico dicta «peso 18
 * kilos» y en el mismo dictado «carprofeno 4 mg por kilo». Si la cuenta
 * se hiciera con el peso que tiene el expediente —el de la visita
 * anterior—, el borrador mostraría una dosis calculada con un peso que
 * el médico acaba de corregir: 4 mg/kg × 32,4 kg en vez de × 18 kg. Eso
 * es «una dosis equivocada con aspecto de correcta», que es justo lo que
 * `calcularDosis` evita en todos los demás caminos.
 *
 * Entonces: si el dictado trae peso, la cuenta se hace con ÉSE, y la
 * línea queda marcada `pesoDelDictado` para que la pantalla diga que el
 * peso todavía no está aceptado. Si no lo trae, se usa `pesoParaDosis`
 * —el de la atención o el último registrado—, como el resto del 07c.
 *
 * Encontrado al verificar en el navegador, no al escribir el código: el
 * primer borrador real de Toby mostró 129,6 mg.
 */
export async function completarReceta(
  db: PoolClient,
  atencionId: string,
  pacienteId: string,
  lineas: LineaRecetaDictada[],
  pesoDictadoKg?: number | null
): Promise<LineaRecetaDictada[]> {
  // El peso y su procedencia los resuelve `pesoVigente`, que es el
  // único punto del sistema que contesta esa pregunta (anexo 07-03,
  // A3). Antes esta función tenía su propia versión de la regla.
  const vigente = await pesoVigente(db, atencionId, { pesoDictadoKg });
  const peso = vigente.kg;
  const pesoVieneDelDictado = vigente.origen === "dictado";
  const completas: LineaRecetaDictada[] = [];
  for (const linea of lineas) {
    const revisar = [...linea.revisar];
    const calce = await calzarMedicamento(db, linea.nombreDicho);
    let presentacionId: string | null = null;
    let nombreEnCatalogo: string | null = null;
    if (calce && "presentacionId" in calce) {
      presentacionId = calce.presentacionId;
      nombreEnCatalogo = calce.nombre;
    } else if (calce && "ambiguo" in calce) {
      if (!revisar.includes("nombre")) revisar.push("nombre");
    }

    const { total, explicacion } = calcularDosis(
      { dosisCantidad: linea.dosisCantidad, dosisUnidad: linea.dosisUnidad, dosisPorKg: linea.dosisPorKg },
      peso
    );
    if (linea.dosisCantidad === null && !revisar.includes("dosis")) revisar.push("dosis");

    const avisos = presentacionId ? await avisosAlRecetar(db, pacienteId, presentacionId) : [];

    completas.push({
      ...linea,
      presentacionId,
      nombreEnCatalogo,
      dosisTotal: total,
      explicacionDosis: explicacion,
      pesoUsadoKg: peso,
      pesoDelDictado: pesoVieneDelDictado,
      avisos,
      revisar,
    });
  }
  return completas;
}

// ---------------------------------------------------------------------
// GUARDAR EL DICTADO Y SU CONSUMO
//
// Los tres van juntos o no va ninguno: el dictado, el minuto de audio
// que costó y los tokens del ordenamiento. Si se registrara el consumo
// aparte y fallara, quedaría un dictado gratis; si se registrara el
// dictado aparte y fallara, quedaría un cobro sin nada que mostrar.
// ---------------------------------------------------------------------
export async function guardarDictado(
  db: PoolClient,
  datos: {
    tenantId: string;
    atencionId: string;
    personaId: string;
    transcripcion: ResultadoTranscripcion;
    borrador: BorradorDictado | null;
    modeloOrdenamiento: string | null;
    usoOrdenamiento: {
      tokensEntrada: number;
      tokensSalida: number;
      tokensCacheEscritura: number;
      tokensCacheLectura: number;
    } | null;
    audioArchivoId?: string | null;
    retencionAudioHoras: number;
  }
): Promise<string> {
  const borrarDespuesDe =
    datos.audioArchivoId && datos.retencionAudioHoras > 0
      ? `now() + interval '${datos.retencionAudioHoras} hours'`
      : "NULL";

  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_dictados
       (tenant_id, atencion_id, persona_id, proveedor, segundos_audio, texto_transcrito,
        borrador, estado, modelo_ordenamiento, audio_archivo_id, audio_borrar_despues_de)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, ${borrarDespuesDe})
     RETURNING id`,
    [
      datos.tenantId,
      datos.atencionId,
      datos.personaId,
      datos.transcripcion.proveedor,
      datos.transcripcion.segundos,
      datos.transcripcion.texto,
      datos.borrador === null ? null : JSON.stringify(datos.borrador),
      datos.borrador === null ? "transcrito" : "ordenado",
      datos.modeloOrdenamiento,
      datos.audioArchivoId ?? null,
    ]
  );
  const dictadoId = r.rows[0].id;

  await registrarUsoTranscripcion(db, {
    tenantId: datos.tenantId,
    personaId: datos.personaId,
    dictadoId,
    proveedor: datos.transcripcion.proveedor,
    segundos: datos.transcripcion.segundos,
  });

  if (datos.usoOrdenamiento && datos.modeloOrdenamiento) {
    await registrarUsoApi(db, {
      tenantId: datos.tenantId,
      // El dictado no cuelga de un caso de Vetline Ai: es de la atención
      // de Vetline Clinic. `uso_api.caso_id` es nullable justamente
      // porque no todo consumo nace de un caso.
      casoId: null,
      medicoAgenteId: null,
      personaId: datos.personaId,
      modelo: datos.modeloOrdenamiento,
      tokensEntrada: datos.usoOrdenamiento.tokensEntrada,
      tokensSalida: datos.usoOrdenamiento.tokensSalida,
      tokensCacheEscritura: datos.usoOrdenamiento.tokensCacheEscritura,
      tokensCacheLectura: datos.usoOrdenamiento.tokensCacheLectura,
      tipoConsumo: "clinico",
      disparadoPor: "usuario",
    });
  }

  return dictadoId;
}

/** El último dictado de una atención, con su borrador y su costo. */
export async function verDictado(db: PoolClient, atencionId: string): Promise<DictadoGuardado | null> {
  const r = await db.query(
    `SELECT d.id, d.atencion_id, d.estado, d.proveedor, d.segundos_audio, d.texto_transcrito,
            d.borrador, d.campos_aplicados, d.creado_en,
            (SELECT COALESCE(SUM(t.costo_usd_calculado), 0) FROM uso_transcripcion t
              WHERE t.dictado_id = d.id) AS costo_transcripcion
       FROM exp_dictados d
      WHERE d.atencion_id = $1 AND d.estado <> 'descartado'
      ORDER BY d.creado_en DESC
      LIMIT 1`,
    [atencionId]
  );
  if (r.rows.length === 0) return null;
  const f = r.rows[0] as Record<string, unknown>;
  return {
    id: f.id as string,
    atencionId: f.atencion_id as string,
    estado: f.estado as DictadoGuardado["estado"],
    proveedor: f.proveedor as string,
    segundosAudio: Number(f.segundos_audio),
    textoTranscrito: f.texto_transcrito as string,
    borrador: (f.borrador as BorradorDictado | null) ?? null,
    camposAplicados: (f.campos_aplicados as string[]) ?? [],
    creadoEn: (f.creado_en as Date).toISOString(),
    costoUsd: Number(f.costo_transcripcion),
  };
}

export async function descartarDictado(db: PoolClient, dictadoId: string): Promise<void> {
  // El texto NO se borra: el dictado descartado es la prueba de qué dijo
  // el médico cuando el borrador salió mal, y es lo que sirve para
  // entender por qué.
  await db.query(`UPDATE exp_dictados SET estado = 'descartado' WHERE id = $1`, [dictadoId]);
}

// ---------------------------------------------------------------------
// APLICAR EL BORRADOR
//
// `campos` es la lista de lo que el médico aceptó. Nombres planos y no
// un objeto anidado porque es lo que la pantalla puede mandar tildando
// casillas, y porque así el que acepta queda registrado en
// `campos_aplicados` de forma legible.
//
// Cada campo se aplica POR EL MISMO CAMINO que si se hubiera escrito a
// mano: `guardarSoap`, `marcarSistema`, `agregarDiagnostico`,
// `agregarLinea`, `pedirEstudio`. Nada de UPDATE directo. Si el 07c
// valida algo al agregar una línea de receta, el dictado se come esa
// validación igual que el médico.
// ---------------------------------------------------------------------

export const CAMPOS_APLICABLES = [
  "motivo_consulta",
  "anamnesis",
  "signos",
  "sistemas",
  "resto_normal",
  "diagnosticos",
  "plan_tratamiento",
  "indicaciones_cliente",
  "control",
  "receta",
  "estudios",
] as const;

export type CampoAplicable = (typeof CAMPOS_APLICABLES)[number];

export interface ResultadoAplicacion {
  aplicados: string[];
  /** Lo que no se pudo aplicar y por qué, para mostrarlo tal cual. */
  problemas: Array<{ campo: string; detalle: string }>;
}

export async function aplicarBorrador(
  db: PoolClient,
  tenantId: string,
  dictadoId: string,
  campos: string[],
  personaId: string
): Promise<ResultadoAplicacion> {
  const r = await db.query<{
    atencion_id: string;
    borrador: BorradorDictado | null;
    estado: string;
    campos_aplicados: string[];
  }>(`SELECT atencion_id, borrador, estado, campos_aplicados FROM exp_dictados WHERE id = $1`, [dictadoId]);
  if (r.rows.length === 0) throw new Error("Ese dictado no existe.");
  const fila = r.rows[0];
  if (fila.estado === "descartado") throw new Error("Ese dictado está descartado.");
  if (!fila.borrador) throw new Error("Ese dictado no tiene un borrador para aplicar.");

  const borrador = fila.borrador;
  const atencionId = fila.atencion_id;
  const pedidos = campos.filter((c): c is CampoAplicable =>
    (CAMPOS_APLICABLES as readonly string[]).includes(c)
  );
  const aplicados: string[] = [];
  const problemas: Array<{ campo: string; detalle: string }> = [];

  // El texto y los signos van en un solo UPDATE: son columnas de la
  // misma fila, y dos UPDATE seguidos sobre `atenciones` no agregan
  // nada.
  const soap: Record<string, unknown> = {};
  if (pedidos.includes("motivo_consulta") && borrador.motivoConsulta) {
    soap.motivo_consulta = borrador.motivoConsulta;
  }
  if (pedidos.includes("anamnesis") && borrador.anamnesis) soap.anamnesis = borrador.anamnesis;
  if (pedidos.includes("plan_tratamiento") && borrador.planTratamiento) {
    soap.plan_tratamiento = borrador.planTratamiento;
  }
  if (pedidos.includes("indicaciones_cliente") && borrador.indicacionesCliente) {
    soap.indicaciones_cliente = borrador.indicacionesCliente;
  }
  if (pedidos.includes("signos")) {
    const s = borrador.signos;
    if (s.temperatura !== null) soap.temperatura = s.temperatura;
    if (s.frecuenciaCardiaca !== null) soap.frecuencia_cardiaca = s.frecuenciaCardiaca;
    if (s.frecuenciaRespiratoria !== null) soap.frecuencia_respiratoria = s.frecuenciaRespiratoria;
    if (s.peso !== null) soap.peso = s.peso;
    if (s.condicionCorporal !== null) soap.condicion_corporal = s.condicionCorporal;
  }
  if (pedidos.includes("control") && borrador.controlDias !== null) {
    // La fecha se calcula acá, en la base, y no en el navegador: una
    // fecha de control calculada con el reloj del cliente es la clase de
    // dato que sale corrido un día (ver formatFecha.ts).
    const fecha = await db.query<{ f: string }>(
      `SELECT (CURRENT_DATE + ($1 || ' days')::interval)::date::text AS f`,
      [String(borrador.controlDias)]
    );
    soap.control_fecha = fecha.rows[0].f;
    if (borrador.controlMotivo) soap.control_motivo = borrador.controlMotivo;
  }

  if (Object.keys(soap).length > 0) {
    await guardarSoap(db, atencionId, soap);
    for (const campo of ["motivo_consulta", "anamnesis", "plan_tratamiento", "indicaciones_cliente", "signos", "control"] as const) {
      if (pedidos.includes(campo)) aplicados.push(campo);
    }
  }

  if (pedidos.includes("sistemas")) {
    for (const s of borrador.sistemas) {
      try {
        // LA ETIQUETA, NO EL CÓDIGO. `exp_examen_sistemas.sistema`
        // guarda el nombre que se ve —«Locomotor»—, que es lo que
        // siembra `aplicarPlantilla` y lo que la pantalla dibuja.
        // Marcando por código quedaban DOS filas: «Locomotor» sin
        // evaluar y «locomotor» anormal. Encontrado en el navegador, en
        // el primer borrador aceptado de verdad.
        await marcarSistema(db, tenantId, atencionId, s.etiqueta, s.estado, s.hallazgo);
      } catch (err) {
        problemas.push({ campo: `sistemas:${s.etiqueta}`, detalle: (err as Error).message });
      }
    }
    if (borrador.sistemas.length > 0) aplicados.push("sistemas");
  }

  // «EL RESTO NORMAL» ES UNA PROPUESTA APARTE, con su propia casilla: es
  // la única parte del borrador que afirma algo que el médico NO dijo
  // sistema por sistema, y por eso se acepta por separado de los
  // sistemas que sí nombró.
  if (pedidos.includes("resto_normal") && borrador.restoNormal) {
    const nombrados = new Set(borrador.sistemas.map((s) => s.etiqueta));
    // Los sistemas QUE YA TIENE ESTA ATENCIÓN, no los del catálogo: la
    // plantilla que se aplicó al abrirla es la que decide cuáles se
    // examinan, y puede no ser el catálogo entero.
    const todos = await db.query<{ sistema: string }>(
      `SELECT sistema FROM exp_examen_sistemas WHERE atencion_id = $1 ORDER BY orden`,
      [atencionId]
    );
    for (const { sistema } of todos.rows) {
      if (nombrados.has(sistema)) continue;
      try {
        await marcarSistema(db, tenantId, atencionId, sistema, "normal", null);
      } catch (err) {
        problemas.push({ campo: `resto_normal:${sistema}`, detalle: (err as Error).message });
      }
    }
    aplicados.push("resto_normal");
  }

  if (pedidos.includes("diagnosticos")) {
    for (const d of borrador.diagnosticos) {
      try {
        await agregarDiagnostico(db, tenantId, {
          atencionId,
          tipo: d.tipo,
          descripcion: d.descripcion,
          personaId,
        });
      } catch (err) {
        problemas.push({ campo: `diagnosticos:${d.descripcion}`, detalle: (err as Error).message });
      }
    }
    if (borrador.diagnosticos.length > 0) aplicados.push("diagnosticos");
  }

  if (pedidos.includes("receta")) {
    for (const linea of borrador.receta) {
      try {
        // SIN CALCE NO SE INVENTA UN PRODUCTO: la línea va como texto
        // libre con el nombre que se dijo. Es una receta válida —la del
        // 07c acepta texto libre— y no una que apunta a otro
        // medicamento.
        await agregarLinea(
          db,
          tenantId,
          atencionId,
          linea.presentacionId
            ? {
                presentacionId: linea.presentacionId,
                dosisCantidad: linea.dosisCantidad,
                dosisUnidad: linea.dosisUnidad,
                dosisPorKg: linea.dosisPorKg,
                viaCodigo: linea.viaCodigo,
                frecuenciaCodigo: linea.frecuenciaCodigo,
                duracionCantidad: linea.duracionCantidad,
                duracionUnidad: linea.duracionUnidad,
                // NO SE DISPENSA POR DICTADO. Dispensar descuenta
                // inventario y genera un cargo; eso lo decide el médico
                // en la receta, con el lote a la vista.
                dispensadoAqui: false,
              }
            : {
                textoLibre: linea.nombreDicho,
                dosisCantidad: linea.dosisCantidad,
                dosisUnidad: linea.dosisUnidad,
                dosisPorKg: linea.dosisPorKg,
                viaCodigo: linea.viaCodigo,
                frecuenciaCodigo: linea.frecuenciaCodigo,
                duracionCantidad: linea.duracionCantidad,
                duracionUnidad: linea.duracionUnidad,
              },
          personaId
        );
      } catch (err) {
        problemas.push({ campo: `receta:${linea.nombreDicho}`, detalle: (err as Error).message });
      }
    }
    if (borrador.receta.length > 0) aplicados.push("receta");
  }

  if (pedidos.includes("estudios")) {
    for (const e of borrador.estudios) {
      try {
        // Sin servicio del catálogo no hay cargo, y es lo correcto: qué
        // servicio corresponde a «radiografía de rodilla» lo elige el
        // médico, y elegirlo por él sería cobrarle al cliente un precio
        // que nadie confirmó.
        await pedirEstudio(
          db,
          tenantId,
          atencionId,
          { tipoEstudio: e.tipoEstudio, esExterno: false, observaciones: e.observaciones },
          personaId
        );
      } catch (err) {
        problemas.push({ campo: `estudios:${e.tipoEstudio}`, detalle: (err as Error).message });
      }
    }
    if (borrador.estudios.length > 0) aplicados.push("estudios");
  }

  const yaAplicados = new Set([...(fila.campos_aplicados ?? []), ...aplicados]);
  await db.query(
    `UPDATE exp_dictados
        SET estado = 'aplicado', campos_aplicados = $1, aplicado_en = now()
      WHERE id = $2`,
    [[...yaAplicados], dictadoId]
  );

  return { aplicados, problemas };
}
