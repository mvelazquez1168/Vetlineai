import { Router } from "express";
import { registrarInteraccion } from "../crm/interacciones";
import { calcularEdadEfectiva, fechaNacimientoDesdeEdad } from "../edadPaciente";
import { especieCanonica, validarRazaParaEspecie } from "../especiePaciente";
import { asignarNumeroExpedientePaciente } from "../expediente";
import { authenticate, withTenantClient } from "../middleware/auth";
import { soloPersonalDeLaClinica } from "../permisos";
import {
  crearPropietario,
  DatosAltaPropietario,
  ERROR_IDENTIFICACION_REPETIDA,
  esIdentificacionRepetida,
} from "../clientes/altaPropietario";
import { avisoDeDuplicado, clientesParecidos } from "../crm/duplicados";

export const pacientesRouter = Router();

pacientesRouter.use(authenticate, withTenantClient);

// Ampliado a admin_clinica — mismo motivo que propietarios.routes.ts
// (ver prompt_fix_agenda_permisos_paciente.md).
pacientesRouter.use(soloPersonalDeLaClinica());

// ---------------------------------------------------------------------
// Campos editables de la ficha, compartidos por POST y PATCH.
//
// `estado` NO está acá a propósito: el fallecimiento tiene su propio
// endpoint y no tiene vuelta atrás (ver PATCH /:id/estado más abajo).
// `edad_anios` tampoco: dejó de escribirse en la migración 087 — la edad
// se guarda solo como fecha de nacimiento.
// ---------------------------------------------------------------------
interface CamposFichaPaciente {
  nombre?: string;
  especie?: string;
  razaId?: string | null;
  sexo?: "macho" | "hembra" | null;
  estadoReproductivo?: "entero" | "castrado" | "desconocido";
  fechaNacimiento?: string | null;
  /** Alternativa a fechaNacimiento cuando el tutor solo sabe la edad. */
  edadAproximadaAnios?: number | null;
  microchip?: string | null;
  color?: string | null;
  alergias?: string | null;
  alertaManejo?: string | null;
  /* Los opcionales del anexo (A5). Existen en la base desde la
     migracion 111 y hasta ahora no los escribia nadie. */
  pelaje?: string | null;
  caracter?: string | null;
  habitat?: string | null;
  tipoDieta?: string | null;
  alimentacionDetalle?: string | null;
  pedigri?: boolean;
  pedigriRegistro?: string | null;
  partos?: number | null;
}

/* Las columnas opcionales, en el orden en que viajan a los dos INSERT /
   UPDATE. Una sola lista para que el alta y la edicion no se separen. */
const COLUMNAS_OPCIONALES_A5 = [
  "pelaje",
  "caracter",
  "habitat",
  "tipo_dieta",
  "alimentacion_detalle",
  "pedigri",
  "pedigri_registro",
  "partos",
] as const;

function valoresOpcionalesA5(body: CamposFichaPaciente): unknown[] {
  return [
    textoOpcional(body.pelaje),
    textoOpcional(body.caracter),
    textoOpcional(body.habitat),
    textoOpcional(body.tipoDieta),
    textoOpcional(body.alimentacionDetalle),
    body.pedigri === true,
    textoOpcional(body.pedigriRegistro),
    body.partos === null || body.partos === undefined ? null : Math.max(0, Math.trunc(body.partos)),
  ];
}

/* Lo que devuelven el alta y la edicion. Incluye los opcionales y lo que
   le falta a la ficha, que es lo que pinta el aviso de «ficha por
   completar». */
const DEVUELTO_DEL_PACIENTE = `id, numero_expediente, nombre, especie, raza_id, sexo,
                 estado_reproductivo, fecha_nacimiento, fecha_nacimiento_estimada,
                 microchip, color, alergias, alerta_manejo, estado,
                 ${COLUMNAS_OPCIONALES_A5.join(", ")},
                 baja_motivo, baja_en,
                 pacientes_datos_basicos_faltantes(especie, NULL, raza_id, sexo,
                   estado_reproductivo, fecha_nacimiento, edad_anios) AS datos_basicos_faltantes`;

const SEXOS = ["macho", "hembra"];
const ESTADOS_REPRODUCTIVOS = ["entero", "castrado", "desconocido"];

/**
 * Resuelve la fecha de nacimiento y si es estimada, a partir de los dos
 * caminos que acepta la ficha. Un solo lugar para las dos rutas: si cada
 * una lo resolviera por su cuenta, el alta y la edición podrían discrepar
 * sobre qué cuenta como "estimada".
 *
 * `fechaNacimiento` gana sobre `edadAproximadaAnios` si vienen las dos —
 * una fecha concreta es siempre mejor dato que una edad declarada.
 */
function resolverNacimiento(
  campos: CamposFichaPaciente
): { fecha: string | null; estimada: boolean } | { error: string } {
  if (campos.fechaNacimiento) return { fecha: campos.fechaNacimiento, estimada: false };

  if (campos.edadAproximadaAnios !== undefined && campos.edadAproximadaAnios !== null) {
    const edad = Number(campos.edadAproximadaAnios);
    if (!Number.isFinite(edad) || edad < 0 || edad > 60) {
      return { error: "La edad aproximada tiene que ser un número de años entre 0 y 60." };
    }
    return { fecha: fechaNacimientoDesdeEdad(edad), estimada: true };
  }

  return { fecha: null, estimada: false };
}

/** Validaciones comunes de los campos de la ficha. Devuelve el mensaje ya escrito, o null. */
function validarCamposFicha(campos: CamposFichaPaciente): string | null {
  if (campos.sexo !== undefined && campos.sexo !== null && !SEXOS.includes(campos.sexo)) {
    return "El sexo tiene que ser 'macho' o 'hembra', o quedar vacío.";
  }
  if (campos.estadoReproductivo !== undefined && !ESTADOS_REPRODUCTIVOS.includes(campos.estadoReproductivo)) {
    return "El estado reproductivo tiene que ser 'entero', 'castrado' o 'desconocido'.";
  }
  return null;
}

/** Vacío o solo espacios se guarda como NULL, nunca como cadena vacía. */
function textoOpcional(valor: string | null | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}

// ---------------------------------------------------------------------
// GET /api/pacientes?q=texto&pagina=1
//
// Listado de pacientes de la clínica. Hasta ahora el único listado era
// `GET /api/workspace/pacientes`, que exige rol médico y devuelve TODOS
// los pacientes sin paginar ni buscar — inservible como pantalla y
// cerrado para el administrador. Este es el equivalente de
// `GET /api/propietarios`: misma paginación (20) y mismo gate del router
// (médico o admin de clínica).
//
// Busca por nombre del paciente, número de expediente y nombre del
// propietario. El número se compara como texto para que "7" encuentre el
// expediente 7 sin tener que parsear la búsqueda aparte.
// ---------------------------------------------------------------------
const PACIENTES_POR_PAGINA = 20;

pacientesRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const pagina = Math.max(1, parseInt(String(req.query.pagina ?? "1"), 10) || 1);

  // SOLO LAS FICHAS POR COMPLETAR (anexo 07-03, A5).
  //
  // La etiqueta sola no alcanza: en un fichero de cuatrocientos
  // pacientes, encontrar las quince que están a medias scrolleando es
  // un trabajo que nadie hace. El criterio es el mismo de la etiqueta
  // —la función de la migración 121— y no una copia: si fueran dos
  // consultas distintas, el filtro mostraría fichas sin etiqueta.
  const soloIncompletas = req.query.incompletas === "1";
  const porCompletar = soloIncompletas
    ? ` AND cardinality(pacientes_datos_basicos_faltantes(p.especie, NULL, p.raza_id, p.sexo,
            p.estado_reproductivo, p.fecha_nacimiento, p.edad_anios)) > 0`
    : "";

  // EL EXPEDIENTE ABSORBIDO NO ESTÁ EN EL FICHERO (anexo 07-03, B1), y
  // su número viejo encuentra al que sobrevivió. El filtro va en las dos
  // ramas porque el fichero sin búsqueda es el que más se mira.
  const condicion = q
    ? `WHERE p.unificado_hacia_id IS NULL${porCompletar}
         AND (p.nombre ILIKE '%' || $1 || '%'
        OR p.numero_expediente::text = $1
        OR $1 = ANY(p.numero_expediente_alias)
        OR prop.nombre ILIKE '%' || $1 || '%')`
    : `WHERE p.unificado_hacia_id IS NULL${porCompletar}`;
  const params = q ? [q] : [];

  try {
    const totalResult = await req.db!.query(
      `SELECT COUNT(*) FROM pacientes p JOIN propietarios prop ON prop.id = p.propietario_id ${condicion}`,
      params
    );
    const total = Number(totalResult.rows[0].count);

    const result = await req.db!.query(
      `SELECT p.id, p.numero_expediente, p.nombre, p.especie, p.sexo, p.estado,
              p.fecha_nacimiento, p.fecha_nacimiento_estimada, p.edad_anios,
              r.nombre AS raza,
              prop.id AS propietario_id, prop.nombre AS propietario_nombre,
              -- «Ficha por completar»: lo que el alta rápida no pidió. La
              -- cuenta la hace la función de la migración 121, la misma
              -- que usan la ficha y el resumen del expediente.
              pacientes_datos_basicos_faltantes(p.especie, r.nombre, p.raza_id, p.sexo,
                p.estado_reproductivo, p.fecha_nacimiento, p.edad_anios)
                AS datos_basicos_faltantes
       FROM pacientes p
       JOIN propietarios prop ON prop.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       ${condicion}
       ORDER BY p.nombre
       LIMIT ${PACIENTES_POR_PAGINA} OFFSET ${(pagina - 1) * PACIENTES_POR_PAGINA}`,
      params
    );

    res.json({
      pacientes: result.rows.map((fila) => ({
        ...fila,
        // La edad se deriva siempre por el único punto de cálculo; nunca
        // se manda `edad_anios` crudo al cliente (ver edadPaciente.ts).
        edad_anios: calcularEdadEfectiva(fila.fecha_nacimiento, fila.edad_anios),
      })),
      total,
      pagina,
      porPagina: PACIENTES_POR_PAGINA,
    });
  } catch (err) {
    console.error("GET /pacientes", err);
    res.status(500).json({ error: "Error al listar los pacientes." });
  }
});

// ---------------------------------------------------------------------
// POST /api/pacientes
// Alta de mascota nueva. razaId es opcional (igual que antes lo era
// `raza` en texto libre) pero si viene, se valida que exista y que
// corresponda a la especie declarada — con la MISMA función que usa el
// PATCH (`validarRazaParaEspecie`), no con una copia.
//
// El número de expediente del paciente se asigna en ESTA transacción (la
// del request, abierta por withTenantClient), igual que el del caso: si
// el INSERT falla, el número no se consume. Ver expediente.ts.
//
// `estado` NO se acepta acá: nace 'activo' (default de la columna) y se
// marca 'fallecido' solo desde el endpoint dedicado más abajo.
// ---------------------------------------------------------------------
pacientesRouter.post("/", async (req, res) => {
  const body = req.body as CamposFichaPaciente & {
    propietarioId?: string;
    /* El alta desde el fichero puede crear al dueño en el mismo paso
       (anexo 07-03, A5): el cliente que llega con su mascota por primera
       vez es un solo gesto, no dos pantallas. */
    propietarioNuevo?: DatosAltaPropietario & { confirmado?: boolean };
  };
  const { propietarioId, nombre, especie } = body;

  if (!propietarioId && !body.propietarioNuevo?.nombre?.trim()) {
    return res.status(400).json({ error: "Falta el propietario: hay que elegir uno o crear uno nuevo." });
  }
  if (!nombre || !nombre.trim() || !especie || !especie.trim()) {
    return res.status(400).json({ error: "Faltan el nombre o la especie." });
  }
  const errorCampos = validarCamposFicha(body);
  if (errorCampos) return res.status(400).json({ error: errorCampos });

  const nacimiento = resolverNacimiento(body);
  if ("error" in nacimiento) return res.status(400).json({ error: nacimiento.error });

  try {
    const raza = await validarRazaParaEspecie(req.db!, body.razaId, especie);
    if (!raza.ok) return res.status(400).json({ error: raza.error });

    // El dueño primero, en la MISMA transacción de la request: si el
    // paciente falla después, no queda un cliente suelto que nadie pidió.
    let duenoId = propietarioId;
    let propietarioCreado = null;
    if (!duenoId && body.propietarioNuevo) {
      const nuevoDueno = body.propietarioNuevo;
      if (!nuevoDueno.confirmado) {
        const parecidos = await clientesParecidos(req.db!, nuevoDueno, { soloFuertes: true });
        if (parecidos.length > 0) {
          return res.status(409).json({
            error: avisoDeDuplicado(parecidos),
            codigo: "POSIBLE_DUPLICADO",
            candidatos: parecidos,
          });
        }
      }
      try {
        propietarioCreado = await crearPropietario(
          req.db!,
          req.auth!.tenantId!,
          nuevoDueno,
          req.auth!.userId
        );
      } catch (err) {
        if (esIdentificacionRepetida(err)) {
          return res.status(409).json({ error: ERROR_IDENTIFICACION_REPETIDA });
        }
        throw err;
      }
      duenoId = propietarioCreado.id;
    }

    const numeroExpediente = await asignarNumeroExpedientePaciente(req.db!, req.auth!.tenantId!);

    const result = await req.db!.query(
      `INSERT INTO pacientes
         (tenant_id, propietario_id, numero_expediente, nombre, especie, raza_id, sexo,
          estado_reproductivo, fecha_nacimiento, fecha_nacimiento_estimada,
          microchip, color, alergias, alerta_manejo,
          ${COLUMNAS_OPCIONALES_A5.join(", ")})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, $17, $18, $19, $20, $21, $22)
       RETURNING ${DEVUELTO_DEL_PACIENTE}`,
      [
        req.auth!.tenantId,
        duenoId,
        numeroExpediente,
        nombre.trim(),
        // LA ESPECIE SE GUARDA EN EL VOCABULARIO ÚNICO. «perro» y
        // «canina» entran igual y quedan como «Canino»; lo que no se
        // reconoce se guarda tal cual, porque cambiárselo a «Canino»
        // sería inventarle la especie a un animal.
        especieCanonica(especie) ?? especie.trim(),
        body.razaId || null,
        body.sexo ?? null,
        body.estadoReproductivo ?? "desconocido",
        nacimiento.fecha,
        nacimiento.estimada,
        textoOpcional(body.microchip),
        textoOpcional(body.color),
        textoOpcional(body.alergias),
        textoOpcional(body.alertaManejo),
        ...valoresOpcionalesA5(body),
      ]
    );

    await registrarInteraccion(req.db!, {
      tenantId: req.auth!.tenantId!,
      tipo: "mascota_registrada",
      pacienteId: result.rows[0].id,
      origenTabla: "pacientes",
      origenId: result.rows[0].id,
      personaId: req.auth!.userId,
      resumen: `${result.rows[0].nombre} (${result.rows[0].especie})`,
    });

    res.status(201).json({
      paciente: { ...result.rows[0], raza: raza.razaNombre },
      propietario: propietarioCreado,
    });
  } catch (err) {
    console.error("POST /pacientes", err);
    res.status(500).json({ error: "Error al crear la mascota." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/pacientes/:id
//
// Edición de la ficha. Hasta ahora NO existía: el único UPDATE sobre
// `pacientes` en todo el backend era marcar el fallecimiento, así que
// nombre, especie, raza, sexo y fecha de nacimiento eran inmutables desde
// la aplicación y un error de carga solo se corregía en la base (ver el
// relevamiento §9.2).
//
// Reemplazo completo, no parcial: la pantalla manda la ficha entera, así
// que un campo ausente significa "vaciarlo", no "dejarlo como está". Es
// el mismo criterio de `PATCH /api/propietarios/:id`.
//
// `estado` no se acepta: un fallecido no vuelve a 'activo' por esta vía
// (ni por ninguna otra desde la aplicación).
// ---------------------------------------------------------------------
pacientesRouter.patch("/:id", async (req, res) => {
  const body = req.body as CamposFichaPaciente;
  const { nombre, especie } = body;

  if (!nombre || !nombre.trim() || !especie || !especie.trim()) {
    return res.status(400).json({ error: "Faltan el nombre o la especie." });
  }
  const errorCampos = validarCamposFicha(body);
  if (errorCampos) return res.status(400).json({ error: errorCampos });

  const nacimiento = resolverNacimiento(body);
  if ("error" in nacimiento) return res.status(400).json({ error: nacimiento.error });

  try {
    const raza = await validarRazaParaEspecie(req.db!, body.razaId, especie);
    if (!raza.ok) return res.status(400).json({ error: raza.error });

    const result = await req.db!.query(
      `UPDATE pacientes SET
         nombre = $1, especie = $2, raza_id = $3, sexo = $4, estado_reproductivo = $5,
         fecha_nacimiento = $6, fecha_nacimiento_estimada = $7,
         microchip = $8, color = $9, alergias = $10, alerta_manejo = $11,
         pelaje = $13, caracter = $14, habitat = $15, tipo_dieta = $16,
         alimentacion_detalle = $17, pedigri = $18, pedigri_registro = $19, partos = $20
       WHERE id = $12
       RETURNING ${DEVUELTO_DEL_PACIENTE}`,
      [
        nombre.trim(),
        // LA ESPECIE SE GUARDA EN EL VOCABULARIO ÚNICO. «perro» y
        // «canina» entran igual y quedan como «Canino»; lo que no se
        // reconoce se guarda tal cual, porque cambiárselo a «Canino»
        // sería inventarle la especie a un animal.
        especieCanonica(especie) ?? especie.trim(),
        body.razaId || null,
        body.sexo ?? null,
        body.estadoReproductivo ?? "desconocido",
        nacimiento.fecha,
        nacimiento.estimada,
        textoOpcional(body.microchip),
        textoOpcional(body.color),
        textoOpcional(body.alergias),
        textoOpcional(body.alertaManejo),
        req.params.id,
        ...valoresOpcionalesA5(body),
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado." });
    }

    const paciente = result.rows[0];
    res.json({
      paciente: {
        ...paciente,
        raza: raza.razaNombre,
        edad_anios: calcularEdadEfectiva(paciente.fecha_nacimiento, null),
      },
    });
  } catch (err) {
    console.error("PATCH /pacientes/:id", err);
    res.status(500).json({ error: "Error al actualizar la ficha del paciente." });
  }
});

// ---------------------------------------------------------------------
// PATCH /api/pacientes/:id/estado — LA BAJA DEL PACIENTE
//
// prompt_code_paciente_nacimiento_estado.md, Parte B2 — nació como el
// único punto para registrar un fallecimiento. El anexo del 07 (A5) lo
// amplía a los cuatro estados de baja que la migración 111 agregó al
// CHECK: fallecido, extraviado, transferido y otro. La confirmación
// sigue siendo del frontend; acá se exige el dato que cada baja necesita.
//
// EL MOTIVO ES OBLIGATORIO EN LOS CUATRO. Una ficha que dice
// «transferido» y nada más no le sirve a quien la lea en dos años. Sale
// del catálogo `motivo_baja` de la clínica, y «otro» admite texto libre.
//
// `fecha_fallecimiento` sigue siendo obligatoria SOLO para 'fallecido',
// y sigue siendo la columna que miran los avisos: no se reemplaza por
// `baja_en`, que es la fecha de la baja en general.
//
// NO HAY VUELTA A 'activo' desde la aplicación, igual que antes: el
// `WHERE estado = 'activo'` lo impide y es deliberado.
// ---------------------------------------------------------------------
const ESTADOS_DE_BAJA = ["fallecido", "extraviado", "transferido", "baja_otro"] as const;
type EstadoDeBaja = (typeof ESTADOS_DE_BAJA)[number];

pacientesRouter.patch("/:id/estado", async (req, res) => {
  const { estado, fechaFallecimiento, motivo, fecha } = req.body as {
    estado?: string;
    fechaFallecimiento?: string;
    motivo?: string;
    fecha?: string;
  };

  if (!estado || !(ESTADOS_DE_BAJA as readonly string[]).includes(estado)) {
    return res.status(400).json({
      error: `El estado tiene que ser uno de: ${ESTADOS_DE_BAJA.join(", ")}.`,
    });
  }
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: "Falta el motivo de la baja." });
  }
  if (estado === "fallecido" && !fechaFallecimiento) {
    return res.status(400).json({ error: "Falta la fecha de fallecimiento." });
  }

  try {
    const result = await req.db!.query(
      // $1 va casteado en los dos usos: sin el cast, Postgres lo deduce
      // una vez como el tipo de la columna y otra por la comparación, y
      // se queja con «inconsistent types deduced for parameter $1». Es
      // el mismo tropiezo que ya costó un arreglo en el CASE WHEN de
      // agentes por país.
      `UPDATE pacientes
          SET estado = $1::varchar,
              fecha_fallecimiento = CASE WHEN $1::varchar = 'fallecido'
                                         THEN $2::date ELSE fecha_fallecimiento END,
              baja_motivo = $3,
              baja_en = COALESCE($4::date, $2::date, CURRENT_DATE)
        WHERE id = $5 AND estado = 'activo'
       RETURNING id, nombre, estado, fecha_fallecimiento, baja_motivo, baja_en::text AS baja_en`,
      [estado as EstadoDeBaja, fechaFallecimiento ?? null, motivo.trim(), fecha ?? null, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "El paciente no existe o ya está dado de baja." });
    }
    res.json({ paciente: result.rows[0] });
  } catch (err) {
    console.error("PATCH /pacientes/:id/estado", err);
    res.status(500).json({ error: "Error al registrar la baja del paciente." });
  }
});

// ---------------------------------------------------------------------
// GET /api/pacientes/:id/historial-farmacologico
//
// Consulta SQL directa, sin IA — mezcla recetas de cualquier agente
// (GCIS, ICIS, u otros) a propósito: el historial es del paciente, no
// de un agente en particular. No filtra por médico emisor: cualquier
// médico del tenant puede ver el historial completo del paciente, igual
// que ya pueden buscar/ver el paciente en el wizard de "Nuevo Caso".
// ---------------------------------------------------------------------
pacientesRouter.get("/:id/historial-farmacologico", async (req, res) => {
  try {
    const filasResult = await req.db!.query(
      `SELECT r.id AS receta_id, r.emitido_en, m.nombre AS medico_nombre,
              (r.validacion_ia IS NOT NULL) AS fue_validada,
              (r.atencion_id IS NOT NULL) AS con_visita,
              ri.medicamento_id, med.nombre AS medicamento_nombre,
              ri.dosis, ri.frecuencia, ri.duracion, ri.orden
       FROM recetas r
       JOIN personas m ON m.id = r.medico_id
       JOIN receta_items ri ON ri.receta_id = r.id
       JOIN medicamentos med ON med.id = ri.medicamento_id
       WHERE r.paciente_id = $1 AND r.estado = 'emitida'
       ORDER BY r.emitido_en DESC, ri.orden ASC`,
      [req.params.id]
    );

    const recetasPorId = new Map<
      string,
      {
        id: string;
        emitido_en: string;
        medico_nombre: string;
        fue_validada: boolean;
        // prompt_code_registro_atencion.md, respuesta del usuario — hace
        // visible en el historial cuál de los dos caminos generó cada
        // receta: con_visita=true vino de una atención (paciente
        // presente), false es un ajuste sin visita (POST /casos/:id/recetas).
        con_visita: boolean;
        items: { medicamento_id: string; medicamento_nombre: string; dosis: string; frecuencia: string; duracion: string }[];
      }
    >();
    const conteoMedicamentos = new Map<string, { nombre: string; veces: number }>();

    for (const fila of filasResult.rows) {
      if (!recetasPorId.has(fila.receta_id)) {
        recetasPorId.set(fila.receta_id, {
          id: fila.receta_id,
          emitido_en: fila.emitido_en,
          medico_nombre: fila.medico_nombre,
          fue_validada: fila.fue_validada,
          con_visita: fila.con_visita,
          items: [],
        });
      }
      recetasPorId.get(fila.receta_id)!.items.push({
        medicamento_id: fila.medicamento_id,
        medicamento_nombre: fila.medicamento_nombre,
        dosis: fila.dosis,
        frecuencia: fila.frecuencia,
        duracion: fila.duracion,
      });

      const actual = conteoMedicamentos.get(fila.medicamento_id) ?? { nombre: fila.medicamento_nombre, veces: 0 };
      actual.veces += 1;
      conteoMedicamentos.set(fila.medicamento_id, actual);
    }

    res.json({
      recetas: Array.from(recetasPorId.values()),
      medicamentosRepetidos: Array.from(conteoMedicamentos.entries()).map(([medicamentoId, datos]) => ({
        medicamentoId,
        nombre: datos.nombre,
        veces: datos.veces,
      })),
    });
  } catch (err) {
    console.error("GET /pacientes/:id/historial-farmacologico", err);
    res.status(500).json({ error: "Error al obtener el historial farmacológico." });
  }
});

// ---------------------------------------------------------------------
// GET /api/pacientes/:id/atenciones-sin-caso
//
// Atenciones de este paciente cuya cita todavía no tiene caso vinculado
// — candidatas para que el médico las asocie a un caso ya abierto desde
// la pantalla "Vincular atención anterior" (PATCH /citas/:id/caso hace
// el vínculo real). Mismo criterio que historial-farmacologico: no
// filtra por médico, cualquiera del tenant puede ver y vincular. Una
// atención cuya cita YA tiene caso_id (este u otro) no aparece acá —
// nunca se ofrece "robar" un vínculo existente.
// ---------------------------------------------------------------------
pacientesRouter.get("/:id/atenciones-sin-caso", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT a.id AS atencion_id, a.cita_id, a.nota_medica, a.peso, a.temperatura,
              c.fecha, c.hora_inicio, c.hora_fin, per.nombre AS medico_nombre
       FROM atenciones a
       JOIN citas c ON c.id = a.cita_id
       JOIN personas per ON per.id = a.medico_id
       WHERE a.paciente_id = $1 AND c.caso_id IS NULL
       ORDER BY c.fecha DESC, c.hora_inicio DESC`,
      [req.params.id]
    );
    res.json({ atenciones: result.rows });
  } catch (err) {
    console.error("GET /pacientes/:id/atenciones-sin-caso", err);
    res.status(500).json({ error: "Error al obtener las atenciones sin caso." });
  }
});

// ---------------------------------------------------------------------
// POST /api/pacientes/:id/cuidados-preventivos
// GET  /api/pacientes/:id/cuidados-preventivos
//
// prompt_code_notificaciones_pendientes.md, Parte A — segundo tipo
// ('vacunacion'), con vacuna obligatoria y lote opcional (solo lo que la
// vacunación necesita y la desparasitación no; ver migración 055). El
// job diario de notificaciones lee de esta misma tabla, nunca la
// modifica.
// ---------------------------------------------------------------------
// prompt_code_paciente_nacimiento_estado.md, Parte A — la desparasitación
// distingue interna/externa (obligatorio, son dos cosas clínicamente
// distintas) + producto aplicado en texto libre (opcional, mismo criterio
// que `vacuna`: los nombres comerciales varían mucho entre países). El
// disparador del aviso de "próxima" (jobs/notificaciones.job.ts) no
// necesitó cambios — ya procesa cada fila de cuidados_preventivos por
// separado, así que dos desparasitaciones vigentes con fechas distintas
// ya disparaban cada una por su cuenta antes de este cambio.
// prompt_code_registro_atencion.md, Paso 4 — atencionId opcional (este
// endpoint ya funcionaba sin caso; ahora también se llama desde el
// Registro de Atención, que sí quiere el vínculo). enfermedadIds solo
// aplica a tipo='vacunacion': selección múltiple del catálogo de
// plataforma, opcional — sin eso el sistema no puede razonar sobre la
// vacuna en un caso futuro, pero no bloquea el registro.
pacientesRouter.post("/:id/cuidados-preventivos", async (req, res) => {
  const {
    tipo,
    fechaAplicacion,
    fechaProximaRecomendada,
    vacuna,
    lote,
    subtipoDesparasitacion,
    productoDesparasitacion,
    atencionId,
    enfermedadIds,
  } = req.body as {
    tipo?: "desparasitacion" | "vacunacion";
    fechaAplicacion?: string;
    fechaProximaRecomendada?: string;
    vacuna?: string;
    lote?: string;
    subtipoDesparasitacion?: "interna" | "externa";
    productoDesparasitacion?: string;
    atencionId?: string;
    enfermedadIds?: string[];
  };

  if (!tipo || !fechaAplicacion || !fechaProximaRecomendada) {
    return res.status(400).json({ error: "Faltan tipo, fechaAplicacion o fechaProximaRecomendada." });
  }
  if (tipo !== "desparasitacion" && tipo !== "vacunacion") {
    return res.status(400).json({ error: "El tipo debe ser 'desparasitacion' o 'vacunacion'." });
  }
  if (tipo === "vacunacion" && !vacuna?.trim()) {
    return res.status(400).json({ error: "Falta indicar qué vacuna se aplicó." });
  }
  if (tipo === "desparasitacion" && subtipoDesparasitacion !== "interna" && subtipoDesparasitacion !== "externa") {
    return res.status(400).json({ error: "Falta indicar si la desparasitación es interna o externa." });
  }

  try {
    const result = await req.db!.query(
      `INSERT INTO cuidados_preventivos
         (tenant_id, paciente_id, tipo, fecha_aplicacion, fecha_proxima_recomendada, registrado_por, vacuna, lote,
          subtipo_desparasitacion, producto_desparasitacion, atencion_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, tipo, fecha_aplicacion, fecha_proxima_recomendada, registrado_por, creado_en, vacuna, lote,
                 subtipo_desparasitacion, producto_desparasitacion, atencion_id`,
      [
        req.auth!.tenantId,
        req.params.id,
        tipo,
        fechaAplicacion,
        fechaProximaRecomendada,
        req.auth!.userId,
        tipo === "vacunacion" ? vacuna!.trim() : null,
        tipo === "vacunacion" ? lote?.trim() || null : null,
        tipo === "desparasitacion" ? subtipoDesparasitacion : null,
        tipo === "desparasitacion" ? productoDesparasitacion?.trim() || null : null,
        atencionId ?? null,
      ]
    );
    const cuidadoPreventivo = result.rows[0];

    if (tipo === "vacunacion" && enfermedadIds && enfermedadIds.length > 0) {
      for (const enfermedadId of enfermedadIds) {
        await req.db!.query(
          `INSERT INTO cuidado_preventivo_enfermedades (cuidado_preventivo_id, enfermedad_id) VALUES ($1, $2)`,
          [cuidadoPreventivo.id, enfermedadId]
        );
      }
    }

    // CRM: la vacuna o la desparasitacion cargada a mano desde la ficha
    // tambien es un evento. La que entra por el cierre de una atencion
    // la registra ese cierre.
    await registrarInteraccion(req.db!, {
      tenantId: req.auth!.tenantId!,
      tipo: cuidadoPreventivo.tipo === "vacunacion" ? "vacuna_aplicada" : "desparasitacion",
      pacienteId: req.params.id,
      ocurridoEn: cuidadoPreventivo.fecha_aplicacion,
      origenTabla: "cuidados_preventivos",
      origenId: cuidadoPreventivo.id,
      personaId: req.auth!.userId,
      resumen:
        cuidadoPreventivo.vacuna ?? cuidadoPreventivo.producto_desparasitacion ?? null,
    });

    res.status(201).json({ cuidadoPreventivo });
  } catch (err) {
    console.error("POST /pacientes/:id/cuidados-preventivos", err);
    res.status(500).json({ error: "Error al registrar el cuidado preventivo." });
  }
});

pacientesRouter.get("/:id/cuidados-preventivos", async (req, res) => {
  try {
    const result = await req.db!.query(
      `SELECT cp.id, cp.tipo, cp.fecha_aplicacion, cp.fecha_proxima_recomendada, cp.creado_en,
              cp.vacuna, cp.lote, cp.subtipo_desparasitacion, cp.producto_desparasitacion,
              per.nombre AS registrado_por_nombre,
              COALESCE(
                (SELECT array_agg(ev.nombre ORDER BY ev.nombre)
                 FROM cuidado_preventivo_enfermedades cpe
                 JOIN enfermedades_vacuna ev ON ev.id = cpe.enfermedad_id
                 WHERE cpe.cuidado_preventivo_id = cp.id),
                ARRAY[]::text[]
              ) AS enfermedades_cubiertas
       FROM cuidados_preventivos cp
       JOIN personas per ON per.id = cp.registrado_por
       WHERE cp.paciente_id = $1
       ORDER BY cp.fecha_aplicacion DESC`,
      [req.params.id]
    );
    res.json({ cuidadosPreventivos: result.rows });
  } catch (err) {
    console.error("GET /pacientes/:id/cuidados-preventivos", err);
    res.status(500).json({ error: "Error al obtener los cuidados preventivos." });
  }
});

// ---------------------------------------------------------------------
// GET /api/pacientes/:id/cronologia
//
// UNA sola línea de tiempo del paciente. Mezcla cinco orígenes que hasta
// ahora solo se podían ver por separado y cada uno desde su propia
// pantalla: atenciones (la visita), apertura y cierre de casos, vacunas,
// desparasitaciones y recetas emitidas.
//
// Está ANTES de `GET /:id` en el archivo por costumbre de lectura, no por
// necesidad: Express compara por cantidad de segmentos, así que
// `/:id/cronologia` nunca cae en `/:id`.
//
// La fecha de cada evento se resuelve EN SQL al día calendario de la
// zona horaria del tenant (`AT TIME ZONE`), no en la zona del servidor
// ni en UTC. Es el mismo bug que ya se corrigió en el reporte de
// atenciones: en Costa Rica (UTC-6), una receta emitida a las 19:00
// locales se guarda como el día siguiente en UTC, y la cronología la
// mostraría un día después de la visita que la generó.
//
// `momento` sale aparte de `fecha` para desempatar dentro del mismo día.
// Para los orígenes que solo tienen DATE (la cita, la aplicación de un
// cuidado preventivo) es la medianoche local de ese día: no hay hora
// registrada y no se inventa una.
// ---------------------------------------------------------------------
pacientesRouter.get("/:id/cronologia", async (req, res) => {
  const zona = req.auth!.zonaHoraria ?? "America/Costa_Rica";

  try {
    const result = await req.db!.query(
      `WITH eventos AS (
         -- La visita. Se apoya en citas.fecha (el día en que ocurrió),
         -- no en atenciones.creado_en (cuándo se tipeó la nota).
         SELECT 'atencion'::text                                   AS tipo,
                c.fecha                                            AS fecha,
                (c.fecha + c.hora_inicio) AT TIME ZONE $2          AS momento,
                'Atención'::text                                   AS titulo,
                per.nombre                                         AS medico_nombre,
                NULLIF(concat_ws(' · ',
                  NULLIF(a.nota_medica, ''),
                  CASE WHEN a.peso        IS NOT NULL THEN 'peso ' || a.peso || ' kg'        END,
                  CASE WHEN a.temperatura IS NOT NULL THEN a.temperatura || ' °C'            END
                ), '')                                             AS detalle,
                a.id                                               AS referencia_id,
                c.caso_id                                          AS caso_id
         FROM atenciones a
         JOIN citas c   ON c.id = a.cita_id
         JOIN personas per ON per.id = a.medico_id
         WHERE a.paciente_id = $1

         UNION ALL

         -- Apertura del caso.
         SELECT 'caso_apertura',
                (cs.creado_en AT TIME ZONE $2)::date,
                cs.creado_en,
                'Caso abierto · N.º ' || cs.numero_expediente,
                per.nombre,
                cs.motivo,
                cs.id,
                cs.id
         FROM casos cs
         JOIN personas per ON per.id = cs.medico_id
         WHERE cs.paciente_id = $1

         UNION ALL

         -- Cierre del caso. Solo los cerrados, y con el diagnóstico
         -- final y el desenlace, que es lo que hace útil la entrada.
         SELECT 'caso_cierre',
                (cs.cerrado_en AT TIME ZONE $2)::date,
                cs.cerrado_en,
                'Caso cerrado · N.º ' || cs.numero_expediente,
                per.nombre,
                NULLIF(concat_ws(' · ', cs.diagnostico_final, cs.desenlace), ''),
                cs.id,
                cs.id
         FROM casos cs
         LEFT JOIN personas per ON per.id = cs.cerrado_por
         WHERE cs.paciente_id = $1 AND cs.cerrado_en IS NOT NULL

         UNION ALL

         -- Vacunación y desparasitación salen de la misma tabla con el
         -- mismo criterio; lo que cambia es qué columnas tienen sentido
         -- en el detalle de cada tipo.
         SELECT CASE WHEN cp.tipo = 'vacunacion' THEN 'vacunacion' ELSE 'desparasitacion' END,
                cp.fecha_aplicacion,
                cp.fecha_aplicacion::timestamp AT TIME ZONE $2,
                CASE WHEN cp.tipo = 'vacunacion' THEN 'Vacunación' ELSE 'Desparasitación' END,
                per.nombre,
                NULLIF(concat_ws(' · ',
                  cp.vacuna,
                  cp.subtipo_desparasitacion,
                  cp.producto_desparasitacion,
                  CASE WHEN cp.lote IS NOT NULL THEN 'lote ' || cp.lote END,
                  'próxima: ' || cp.fecha_proxima_recomendada
                ), ''),
                cp.id,
                NULL
         FROM cuidados_preventivos cp
         JOIN personas per ON per.id = cp.registrado_por
         WHERE cp.paciente_id = $1

         UNION ALL

         -- Recetas EMITIDAS únicamente: un borrador no es un hecho
         -- clínico, es trabajo en curso. Mismo criterio que el historial
         -- farmacológico de más arriba.
         SELECT 'receta',
                (r.emitido_en AT TIME ZONE $2)::date,
                r.emitido_en,
                'Receta emitida',
                per.nombre,
                (SELECT string_agg(med.nombre, ', ' ORDER BY ri.orden)
                   FROM receta_items ri
                   JOIN medicamentos med ON med.id = ri.medicamento_id
                  WHERE ri.receta_id = r.id),
                r.id,
                r.caso_id
         FROM recetas r
         JOIN personas per ON per.id = r.medico_id
         WHERE r.paciente_id = $1 AND r.estado = 'emitida'
       )
       SELECT tipo, fecha, momento, titulo, medico_nombre, detalle, referencia_id, caso_id
       FROM eventos
       ORDER BY fecha DESC, momento DESC`,
      [req.params.id, zona]
    );

    res.json({ eventos: result.rows });
  } catch (err) {
    console.error("GET /pacientes/:id/cronologia", err);
    res.status(500).json({ error: "Error al obtener la cronología del paciente." });
  }
});

// ---------------------------------------------------------------------
// GET /api/pacientes/:id
//
// La ficha completa. Es el endpoint que no existía: el paciente solo se
// podía ver como fila de un wizard, como dato de un caso o como columna
// de una cita (ver el relevamiento §9.2).
//
// Todo en una respuesta y no en cinco llamadas: la pantalla muestra las
// cinco cosas juntas, y cinco requests en paralelo desde el navegador son
// cinco transacciones con `app.tenant_id` para armar una sola pantalla.
// ---------------------------------------------------------------------
pacientesRouter.get("/:id", async (req, res) => {
  try {
    const pacienteResult = await req.db!.query(
      `SELECT p.id, p.numero_expediente, p.nombre, p.especie, p.raza_id, r.nombre AS raza,
              p.sexo, p.estado_reproductivo, p.fecha_nacimiento, p.fecha_nacimiento_estimada,
              p.edad_anios, p.microchip, p.color, p.alergias, p.alerta_manejo,
              p.estado, p.fecha_fallecimiento, p.creado_en,
              p.pelaje, p.caracter, p.habitat, p.tipo_dieta, p.alimentacion_detalle,
              p.pedigri, p.pedigri_registro, p.partos, p.baja_motivo, p.baja_en,
              pacientes_datos_basicos_faltantes(p.especie, r.nombre, p.raza_id, p.sexo,
                p.estado_reproductivo, p.fecha_nacimiento, p.edad_anios)
                AS datos_basicos_faltantes,
              prop.id AS propietario_id, prop.nombre AS propietario_nombre,
              prop.telefono AS propietario_telefono, prop.email AS propietario_email,
              prop.direccion AS propietario_direccion,
              prop.numero_identificacion AS propietario_numero_identificacion,
              ti.etiqueta AS propietario_tipo_identificacion_etiqueta
       FROM pacientes p
       JOIN propietarios prop ON prop.id = p.propietario_id
       LEFT JOIN razas r ON r.id = p.raza_id
       LEFT JOIN tipos_identificacion ti ON ti.id = prop.tipo_identificacion_id
       WHERE p.id = $1`,
      [req.params.id]
    );
    if (pacienteResult.rows.length === 0) {
      return res.status(404).json({ error: "Paciente no encontrado." });
    }
    const fila = pacienteResult.rows[0];

    const [cuidados, atenciones, casos, recetas] = await Promise.all([
      req.db!.query(
        `SELECT cp.id, cp.tipo, cp.fecha_aplicacion, cp.fecha_proxima_recomendada,
                cp.vacuna, cp.lote, cp.subtipo_desparasitacion, cp.producto_desparasitacion,
                per.nombre AS registrado_por_nombre
         FROM cuidados_preventivos cp
         JOIN personas per ON per.id = cp.registrado_por
         WHERE cp.paciente_id = $1
         ORDER BY cp.fecha_aplicacion DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT a.id, a.cita_id, c.caso_id, c.fecha, c.hora_inicio,
                a.nota_medica, a.peso, a.temperatura, per.nombre AS medico_nombre
         FROM atenciones a
         JOIN citas c ON c.id = a.cita_id
         JOIN personas per ON per.id = a.medico_id
         WHERE a.paciente_id = $1
         ORDER BY c.fecha DESC, c.hora_inicio DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT cs.id, cs.numero_expediente, cs.motivo, cs.estado, cs.severidad,
                cs.creado_en, cs.cerrado_en, cs.diagnostico_final, cs.desenlace,
                cs.tratamiento_activo,
                ag.nombre AS agente_nombre, per.nombre AS medico_nombre
         FROM casos cs
         JOIN agentes ag ON ag.id = cs.agente_id
         JOIN personas per ON per.id = cs.medico_id
         WHERE cs.paciente_id = $1
         ORDER BY cs.creado_en DESC`,
        [req.params.id]
      ),
      req.db!.query(
        `SELECT r.id, r.emitido_en, r.caso_id, (r.atencion_id IS NOT NULL) AS con_visita,
                per.nombre AS medico_nombre,
                (SELECT string_agg(med.nombre, ', ' ORDER BY ri.orden)
                   FROM receta_items ri
                   JOIN medicamentos med ON med.id = ri.medicamento_id
                  WHERE ri.receta_id = r.id) AS medicamentos
         FROM recetas r
         JOIN personas per ON per.id = r.medico_id
         WHERE r.paciente_id = $1 AND r.estado = 'emitida'
         ORDER BY r.emitido_en DESC`,
        [req.params.id]
      ),
    ]);

    res.json({
      paciente: {
        ...fila,
        // Único punto de cálculo de la edad. `edad_anios` crudo no sale
        // de acá: el cliente recibe la edad efectiva ya resuelta y la
        // bandera que dice si la fecha de la que sale es estimada.
        edad_anios: calcularEdadEfectiva(fila.fecha_nacimiento, fila.edad_anios),
      },
      cuidadosPreventivos: cuidados.rows,
      atenciones: atenciones.rows,
      casos: casos.rows,
      recetas: recetas.rows,
    });
  } catch (err) {
    console.error("GET /pacientes/:id", err);
    res.status(500).json({ error: "Error al obtener la ficha del paciente." });
  }
});
