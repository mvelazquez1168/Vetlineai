import { Pool, PoolClient } from "pg";
import { requerirAnthropic } from "../anthropic";
import { catalogo, OpcionCatalogo } from "./catalogosClinicos";

// ---------------------------------------------------------------------
// EL ORDENAMIENTO DEL DICTADO — prompt 07d, fase 2.
//
// Entra un párrafo corrido («perro macho de 5 años, viene por cojera del
// miembro posterior derecho de 3 días, temperatura 38,9…») y sale un
// borrador con cada cosa en su campo.
//
// TRES REGLAS QUE DECIDEN CÓMO ESTÁ ESCRITO ESTO:
//
//   1. LO QUE NO SE ENTENDIÓ NO SE INVENTA. El modelo deja el campo en
//      null y lo nombra en `revisar`. Una dosis adivinada que parece
//      correcta es peor que un campo vacío: el campo vacío se ve.
//   2. LOS CÓDIGOS NO LOS INVENTA EL MODELO. Los sistemas, las vías y
//      las frecuencias salen del catálogo de ESTA clínica, y el modelo
//      elige de la lista o no elige. Después se valida acá que el código
//      exista de verdad, porque un modelo puede devolver cualquier cosa.
//   3. LOS MEDICAMENTOS LOS BUSCA LA BASE, NO EL MODELO. El modelo
//      transcribe el nombre que se dijo; el calce contra el catálogo es
//      una consulta SQL que se puede leer y repetir. Mandarle el
//      catálogo entero al modelo para que elija sería un prompt enorme y
//      un calce que nadie puede auditar.
//
// NADA DE LO QUE SALE DE ACÁ ESTÁ REGISTRADO. Es una propuesta: la
// aplica `dictado.ts` cuando el médico acepta, campo por campo.
// ---------------------------------------------------------------------

export interface SignosDictados {
  temperatura: number | null;
  frecuenciaCardiaca: number | null;
  frecuenciaRespiratoria: number | null;
  peso: number | null;
  condicionCorporal: number | null;
}

export interface SistemaDictado {
  /** Código del catálogo de la clínica. */
  sistema: string;
  etiqueta: string;
  estado: "anormal" | "normal";
  hallazgo: string | null;
}

export interface LineaRecetaDictada {
  /** El nombre tal como se dijo. Se conserva aunque haya calce. */
  nombreDicho: string;
  /** Presentación del inventario que calzó, si calzó una sola. */
  presentacionId: string | null;
  nombreEnCatalogo: string | null;
  dosisCantidad: number | null;
  dosisUnidad: string | null;
  dosisPorKg: boolean;
  viaCodigo: string | null;
  frecuenciaCodigo: string | null;
  duracionCantidad: number | null;
  duracionUnidad: "dias" | "semanas" | "meses" | null;
  /** La cuenta hecha: «4 mg/kg × 18 kg = 72 mg», o null si falta algo. */
  explicacionDosis: string | null;
  dosisTotal: number | null;
  /** Con qué peso se hizo esa cuenta. */
  pesoUsadoKg: number | null;
  /**
   * Si ese peso viene del dictado y TODAVÍA NO ESTÁ ACEPTADO.
   *
   * Importa que se diga: el médico dictó «peso 18 kilos» y la dosis del
   * borrador sale de esos 18 kg, pero el expediente sigue teniendo el
   * peso anterior hasta que acepte el grupo «Signos». Si la pantalla no
   * lo dijera, mostraría una cuenta correcta con un peso que el
   * expediente no tiene.
   */
  pesoDelDictado: boolean;
  /** Avisos de alergia del paciente para este medicamento (07c). */
  avisos: Array<{ porque: string; severidad: string; detalle: string }>;
  /** Qué de esta línea hay que revisar antes de aceptarla. */
  revisar: string[];
}

export interface BorradorDictado {
  motivoConsulta: string | null;
  anamnesis: string | null;
  signos: SignosDictados;
  /** El médico dijo «el resto normal»: se PROPONE marcar el resto. */
  restoNormal: boolean;
  sistemas: SistemaDictado[];
  diagnosticos: Array<{ descripcion: string; tipo: "presuntivo" | "definitivo" }>;
  evaluacion: string | null;
  planTratamiento: string | null;
  indicacionesCliente: string | null;
  controlDias: number | null;
  controlMotivo: string | null;
  receta: LineaRecetaDictada[];
  estudios: Array<{ tipoEstudio: string; observaciones: string | null }>;
  /** Campos del borrador que quedaron ambiguos, en nombres de campo. */
  revisar: string[];
}

export interface ContextoDelPaciente {
  especie: string | null;
  raza: string | null;
  sexo: string | null;
  edad: string | null;
  pesoConocidoKg: number | null;
}

// ---------------------------------------------------------------------
// LA HERRAMIENTA
//
// Se usa tool_use y no texto libre con JSON por lo de siempre: el
// esquema lo valida el proveedor y el modelo reintenta solo si no
// encaja, en vez de que nosotros parseemos un JSON a medio escribir.
// ---------------------------------------------------------------------
function herramientaOrdenar(
  sistemas: OpcionCatalogo[],
  vias: OpcionCatalogo[],
  frecuencias: OpcionCatalogo[],
  unidades: OpcionCatalogo[]
) {
  const codigos = (opciones: OpcionCatalogo[]) => opciones.map((o) => o.codigo);
  return {
    name: "ordenar_dictado",
    description:
      "Ordena el dictado de una consulta veterinaria en los campos de la atención. " +
      "Cada valor sale de lo que el médico dijo. Lo que no dijo o no se entiende va en null " +
      "y se nombra en 'revisar'.",
    input_schema: {
      type: "object" as const,
      properties: {
        motivo_consulta: { type: ["string", "null"], description: "Por qué vino, en una o dos líneas." },
        anamnesis: {
          type: ["string", "null"],
          description: "La historia que contó el dueño: desde cuándo, cómo evolucionó, qué se intentó.",
        },
        signos: {
          type: "object",
          properties: {
            temperatura: { type: ["number", "null"], description: "En grados Celsius." },
            frecuencia_cardiaca: { type: ["integer", "null"], description: "Latidos por minuto." },
            frecuencia_respiratoria: { type: ["integer", "null"], description: "Respiraciones por minuto." },
            peso: { type: ["number", "null"], description: "En kilogramos." },
            condicion_corporal: { type: ["integer", "null"], description: "1 a 9." },
          },
          required: [],
        },
        resto_normal: {
          type: "boolean",
          description: "true solo si el médico dijo explícitamente que el resto del examen es normal.",
        },
        sistemas: {
          type: "array",
          items: {
            type: "object",
            properties: {
              sistema: { type: "string", enum: codigos(sistemas) },
              estado: { type: "string", enum: ["anormal", "normal"] },
              hallazgo: { type: ["string", "null"], description: "Qué se encontró. Obligatorio si es anormal." },
            },
            required: ["sistema", "estado"],
          },
        },
        diagnosticos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              descripcion: { type: "string" },
              tipo: {
                type: "string",
                enum: ["presuntivo", "definitivo"],
                description:
                  "'presuntivo' si dijo sospecho/probable/compatible con; 'definitivo' solo si lo afirmó.",
              },
            },
            required: ["descripcion", "tipo"],
          },
        },
        plan_tratamiento: { type: ["string", "null"], description: "Qué se va a hacer, en prosa." },
        indicaciones_cliente: { type: ["string", "null"], description: "Lo que hay que decirle al dueño." },
        control_dias: { type: ["integer", "null"], description: "En cuántos días el control, si lo indicó." },
        control_motivo: { type: ["string", "null"] },
        receta: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nombre_dicho: { type: "string", description: "El medicamento como se dijo, sin corregirlo." },
              dosis_cantidad: { type: ["number", "null"] },
              dosis_unidad: { type: ["string", "null"], enum: [...codigos(unidades), null] },
              dosis_por_kg: { type: "boolean", description: "true si dijo «por kilo»." },
              via: { type: ["string", "null"], enum: [...codigos(vias), null] },
              frecuencia: { type: ["string", "null"], enum: [...codigos(frecuencias), null] },
              duracion_cantidad: { type: ["integer", "null"] },
              duracion_unidad: { type: ["string", "null"], enum: ["dias", "semanas", "meses", null] },
              revisar: {
                type: "array",
                items: { type: "string" },
                description:
                  "Qué de esta línea quedó ambiguo: 'dosis', 'via', 'frecuencia', 'duracion', 'nombre'.",
              },
            },
            required: ["nombre_dicho", "dosis_por_kg", "revisar"],
          },
        },
        estudios: {
          type: "array",
          items: {
            type: "object",
            properties: {
              tipo_estudio: { type: "string", description: "Por ejemplo «Radiografía de rodilla derecha»." },
              observaciones: { type: ["string", "null"] },
            },
            required: ["tipo_estudio"],
          },
        },
        revisar: {
          type: "array",
          items: { type: "string" },
          description:
            "Campos del borrador que quedaron ambiguos o incompletos, con el nombre del campo " +
            "(«signos.temperatura», «control_dias»).",
        },
      },
      required: ["resto_normal", "sistemas", "diagnosticos", "receta", "estudios", "revisar"],
    },
  };
}

const INSTRUCCION = `Sos el asistente que ordena el dictado de un médico veterinario en los campos de la atención clínica.

QUÉ HACÉS: tomás el dictado corrido y lo repartís en los campos de la herramienta ordenar_dictado.

LO QUE NO HACÉS, Y ES LO MÁS IMPORTANTE:
- NO INVENTÁS NADA. Si el médico no dijo la vía de administración, va null. Si dijo una dosis que no se entiende («cuatro miligramos por… » y se corta), va null y «dosis» en el revisar de esa línea.
- NO COMPLETÁS con lo que sería razonable. «Carprofeno 4 mg/kg» sin frecuencia no es «cada 24 horas»: es frecuencia null.
- NO CORREGÍS el nombre del medicamento. Lo escribís como se dijo; el calce con el catálogo lo hace el sistema después.
- NO CONVERTÍS unidades ni deducís el peso. Si dijo el peso, va; si no, null.
- NO DIAGNOSTICÁS. Repetís el diagnóstico que el médico dijo, con su grado: «sospecho» es presuntivo.

CÓMO REPARTÍS:
- Lo que el dueño cuenta (desde cuándo, cómo empezó) es anamnesis. Por qué vino es el motivo.
- Los valores medidos van a signos, cada uno en su campo. «38,9» con temperatura es 38.9.
- Los sistemas del examen: solo los que se nombraron. Un sistema nombrado con un hallazgo es anormal, y el hallazgo es lo que se encontró. Un sistema nombrado como normal es normal.
- «El resto normal» o «el resto del examen sin alteraciones» pone resto_normal en true, y NO agregás los demás sistemas a la lista: el sistema se los propone al médico aparte.
- El tratamiento en prosa va a plan_tratamiento; los medicamentos con dosis van además a receta.
- Los estudios pedidos («radiografía de rodilla») van a estudios, no al plan.

Respondé SIEMPRE con la herramienta ordenar_dictado, nunca con texto.`;

export interface ResultadoOrdenamiento {
  borrador: BorradorDictado;
  modelo: string;
  uso: {
    tokensEntrada: number;
    tokensSalida: number;
    tokensCacheEscritura: number;
    tokensCacheLectura: number;
  };
}

export interface CatalogosDelDictado {
  sistemas: OpcionCatalogo[];
  vias: OpcionCatalogo[];
  frecuencias: OpcionCatalogo[];
  unidades: OpcionCatalogo[];
}

/**
 * Los catálogos que el ordenamiento necesita, leídos de una vez.
 *
 * Se leen APARTE de `ordenarDictado` a propósito: esa función habla con
 * el modelo, que tarda segundos, y tiene que correr con la transacción
 * de la request ya cerrada (el `idle in transaction` ya nos costó una
 * alerta, ver migración 081). Entonces los datos que necesita se
 * levantan antes, en una transacción corta.
 */
export async function catalogosDelDictado(db: Pool | PoolClient): Promise<CatalogosDelDictado> {
  const [sistemas, vias, frecuencias, unidades] = await Promise.all([
    catalogo(db, "sistema_examen"),
    catalogo(db, "via_administracion"),
    catalogo(db, "frecuencia"),
    catalogo(db, "unidad_dosis"),
  ]);
  return { sistemas, vias, frecuencias, unidades };
}

/**
 * El ordenamiento crudo: habla con el modelo y devuelve el borrador SIN
 * resolver medicamentos ni calcular dosis (eso necesita la base, y esta
 * función corre sin ella).
 */
export async function ordenarDictado(
  catalogos: CatalogosDelDictado,
  texto: string,
  paciente: ContextoDelPaciente,
  modelo: string
): Promise<ResultadoOrdenamiento> {
  const { sistemas, vias, frecuencias, unidades } = catalogos;

  const herramienta = herramientaOrdenar(sistemas, vias, frecuencias, unidades);

  // El contexto del paciente va para que el modelo entienda el dictado
  // («macho de 5 años» ya lo sabe), NO para que complete lo que falta.
  const contexto = [
    `Paciente: ${paciente.especie ?? "especie no registrada"}`,
    paciente.raza ? `raza ${paciente.raza}` : null,
    paciente.sexo ? `sexo ${paciente.sexo}` : null,
    paciente.edad ? `edad ${paciente.edad}` : null,
    paciente.pesoConocidoKg ? `último peso registrado ${paciente.pesoConocidoKg} kg` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const listas = [
    `Sistemas del examen de esta clínica (código — etiqueta):\n${sistemas
      .map((s) => `  ${s.codigo} — ${s.etiqueta}`)
      .join("\n")}`,
    `Vías de administración:\n${vias.map((v) => `  ${v.codigo} — ${v.etiqueta}`).join("\n")}`,
    `Frecuencias:\n${frecuencias.map((f) => `  ${f.codigo} — ${f.etiqueta}`).join("\n")}`,
    `Unidades de dosis:\n${unidades.map((u) => `  ${u.codigo} — ${u.etiqueta}`).join("\n")}`,
  ].join("\n\n");

  const anthropic = requerirAnthropic();
  const respuesta = await anthropic.messages.create({
    model: modelo,
    max_tokens: 4096,
    system: [
      { type: "text", text: INSTRUCCION },
      { type: "text", text: listas },
    ],
    messages: [
      {
        role: "user",
        content:
          `${contexto}\n\nDictado del médico, literal:\n\n"""\n${texto}\n"""\n\n` +
          "Ordenalo con la herramienta ordenar_dictado.",
      },
    ],
    tools: [herramienta as never],
    tool_choice: { type: "tool", name: "ordenar_dictado" },
  });

  const bloque = respuesta.content.find(
    (b) => b.type === "tool_use" && b.name === "ordenar_dictado"
  ) as { input: Record<string, unknown> } | undefined;
  if (!bloque) {
    throw new Error("El modelo no devolvió el borrador del dictado.");
  }

  return {
    borrador: aBorrador(bloque.input, sistemas),
    modelo,
    uso: {
      tokensEntrada: respuesta.usage.input_tokens,
      tokensSalida: respuesta.usage.output_tokens,
      tokensCacheEscritura: respuesta.usage.cache_creation_input_tokens ?? 0,
      tokensCacheLectura: respuesta.usage.cache_read_input_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------
// LA VALIDACIÓN DE LO QUE DEVOLVIÓ EL MODELO
//
// Un `enum` en el esquema es una instrucción, no una garantía: el modelo
// puede devolver un código que no existe. Acá se descarta lo que no
// calza contra el catálogo de la clínica, en vez de guardarlo y que
// falle al aplicarlo.
// ---------------------------------------------------------------------
function aBorrador(crudo: Record<string, unknown>, sistemas: OpcionCatalogo[]): BorradorDictado {
  const porCodigo = new Map(sistemas.map((s) => [s.codigo, s]));
  const signosCrudos = (crudo.signos ?? {}) as Record<string, unknown>;
  const revisar = aListaDeTextos(crudo.revisar);

  const sistemasDictados: SistemaDictado[] = [];
  for (const s of aLista(crudo.sistemas)) {
    const codigo = texto(s.sistema);
    const opcion = codigo ? porCodigo.get(codigo) : undefined;
    if (!opcion) {
      // El modelo nombró un sistema que esta clínica no tiene. No se
      // descarta en silencio: el hallazgo que venía con él es
      // información clínica real que el médico dictó.
      const hallazgo = texto(s.hallazgo);
      if (hallazgo) revisar.push(`sistema no reconocido: ${hallazgo}`);
      continue;
    }
    const estado = s.estado === "normal" ? "normal" : "anormal";
    const hallazgo = texto(s.hallazgo);
    sistemasDictados.push({ sistema: opcion.codigo, etiqueta: opcion.etiqueta, estado, hallazgo });
    // Anormal sin hallazgo es justo lo que el 07c no deja cerrar.
    if (estado === "anormal" && !hallazgo) revisar.push(`hallazgo de ${opcion.etiqueta}`);
  }

  return {
    motivoConsulta: texto(crudo.motivo_consulta),
    anamnesis: texto(crudo.anamnesis),
    signos: {
      temperatura: numero(signosCrudos.temperatura),
      frecuenciaCardiaca: entero(signosCrudos.frecuencia_cardiaca),
      frecuenciaRespiratoria: entero(signosCrudos.frecuencia_respiratoria),
      peso: numero(signosCrudos.peso),
      condicionCorporal: entero(signosCrudos.condicion_corporal),
    },
    restoNormal: crudo.resto_normal === true,
    sistemas: sistemasDictados,
    diagnosticos: aLista(crudo.diagnosticos)
      .map((d) => ({
        descripcion: texto(d.descripcion) ?? "",
        tipo: d.tipo === "definitivo" ? ("definitivo" as const) : ("presuntivo" as const),
      }))
      .filter((d) => d.descripcion !== ""),
    // La evaluación en prosa se arma de los diagnósticos al aplicar: el
    // campo `evaluacion` de la atención es texto, y repetir ahí lo que ya
    // está en `exp_diagnosticos` sería el mismo dato en dos lugares.
    evaluacion: null,
    planTratamiento: texto(crudo.plan_tratamiento),
    indicacionesCliente: texto(crudo.indicaciones_cliente),
    controlDias: entero(crudo.control_dias),
    controlMotivo: texto(crudo.control_motivo),
    receta: aLista(crudo.receta)
      .map((l) => ({
        nombreDicho: texto(l.nombre_dicho) ?? "",
        presentacionId: null,
        nombreEnCatalogo: null,
        dosisCantidad: numero(l.dosis_cantidad),
        dosisUnidad: texto(l.dosis_unidad),
        dosisPorKg: l.dosis_por_kg === true,
        viaCodigo: texto(l.via),
        frecuenciaCodigo: texto(l.frecuencia),
        duracionCantidad: entero(l.duracion_cantidad),
        duracionUnidad: unidadDuracion(l.duracion_unidad),
        explicacionDosis: null,
        dosisTotal: null,
        pesoUsadoKg: null,
        pesoDelDictado: false,
        avisos: [],
        revisar: aListaDeTextos(l.revisar),
      }))
      .filter((l) => l.nombreDicho !== ""),
    estudios: aLista(crudo.estudios)
      .map((e) => ({
        tipoEstudio: texto(e.tipo_estudio) ?? "",
        observaciones: texto(e.observaciones),
      }))
      .filter((e) => e.tipoEstudio !== ""),
    revisar,
  };
}

function aLista(valor: unknown): Record<string, unknown>[] {
  return Array.isArray(valor) ? (valor.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
}
function aListaDeTextos(valor: unknown): string[] {
  return Array.isArray(valor) ? valor.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}
function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const limpio = valor.trim();
  return limpio === "" ? null : limpio;
}
function numero(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}
function entero(valor: unknown): number | null {
  const n = numero(valor);
  return n === null ? null : Math.round(n);
}
function unidadDuracion(valor: unknown): "dias" | "semanas" | "meses" | null {
  return valor === "dias" || valor === "semanas" || valor === "meses" ? valor : null;
}
