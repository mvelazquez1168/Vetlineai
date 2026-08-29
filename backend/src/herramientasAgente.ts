// ---------------------------------------------------------------------
// Las herramientas de los agentes, y el prefijo cacheado que comparten.
//
// Viven acá y no en cada router por una razón de costo, no de orden: el
// caché de Anthropic es un match de PREFIJO y el orden de render es
// tools → system → messages. Las herramientas se renderizan ANTES del
// system, así que dos llamadas con arrays de herramientas distintos NO
// comparten caché aunque su system sea idéntico byte a byte — que es
// exactamente lo que pasaba: el chat no mandaba herramientas, y
// dashboard, informe y receta mandaban una cada uno. Cuatro caminos,
// cuatro copias del mismo bloque de ~131.000 tokens, cada una pagando su
// propia escritura.
//
// Medido sobre un caso real de Gastroenterología: un análisis y un
// dashboard seguidos costaban $1,282 (dos escrituras) y pasan a costar
// $0,881 (una escritura + una lectura).
//
// Para que el prefijo sea idéntico, los cuatro mandan ESTE array, en este
// orden. Quién puede usar cuál se decide con tool_choice, que —a
// diferencia de las definiciones— no invalida el caché. Por eso el orden
// de HERRAMIENTAS_AGENTE no es cosmético: cambiarlo, o agregar una
// herramienta, invalida el caché de los cuatro caminos a la vez.
// ---------------------------------------------------------------------

// Tool tal como la definió el usuario en dashboard_schema.json — se usa
// TAL CUAL, sin reescribirla. name/description/input_schema copiados
// verbatim (solo transcriptos de JSON a objeto TS). Generalizada a
// cualquier agente clínico (GCIS, ICIS, etc.) — ver
// prompt_generalizar_dashboard_informe.md.
export const DASHBOARD_TOOL = {
  name: "generar_dashboard",
  description:
    "Genera el Dashboard clínico estructurado del caso actual, siguiendo estrictamente las zonas, " +
    "componentes y reglas de aparición condicional definidas en la Dashboard Functional Specification " +
    "del agente correspondiente al caso (GCIS-DASH-001 o ICIS-DASH-001, según el agente que lleva el " +
    "caso). Nunca completes un campo de tendencia u opcional si no se cumple el umbral mínimo de datos " +
    "especificado en su descripción — dejalo como null en ese caso. Nunca insertes componentes vacíos o decorativos.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "executive_summary",
      "clinical_state",
      "clinical_confidence",
      "active_problems",
      "alertas",
      "trends",
      "differential_diagnosis",
      "knowledge_match",
      "clinical_reasoning_journal",
      "referral_recommendation",
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_generacion"],
        properties: {
          estado_generacion: {
            type: "string",
            enum: ["sin_datos", "generado"],
            description:
              "Red de seguridad: si pese a haber pasado el filtro inicial del backend detectás que " +
              "el caso no tiene información clínica suficiente para un Dashboard con sentido, devolvé " +
              "'sin_datos' y dejá el resto de los campos raíz en null.",
          },
        },
      },
      executive_summary: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Siempre presente en caso contrario (Zona 1, Sección 4).",
        additionalProperties: false,
        required: ["resumen", "paciente", "contexto_racial"],
        properties: {
          resumen: {
            type: "string",
            description: "2-3 líneas: lo esencial del caso, motivo de consulta y hallazgo principal.",
          },
          paciente: {
            type: "object",
            additionalProperties: false,
            required: ["nombre", "especie", "raza", "edad", "sexo", "peso_actual_kg"],
            properties: {
              nombre: { type: "string" },
              especie: { type: "string" },
              raza: { type: "string" },
              edad: { type: "string" },
              sexo: { type: "string" },
              peso_actual_kg: { type: ["number", "null"] },
            },
          },
          contexto_racial: {
            type: ["string", "null"],
            description:
              "Solo si existe un Breed Knowledge Object cargado (GCIS-KD-001) para esta raza. Ej: " +
              "'Raza con riesgo alto documentado para enteropatía perdedora de proteínas'. Nunca es " +
              "una conclusión diagnóstica por sí sola. Null si no aplica.",
          },
        },
      },
      clinical_state: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Tomado literal del Clinical State Engine (Project Instructions).",
        additionalProperties: false,
        required: ["emoji", "estado", "justificacion"],
        properties: {
          emoji: {
            type: "string",
            enum: ["🟢", "🔵", "🟡", "🟠", "🔴", "⚫", "⚪"],
            description:
              "🟢 Remisión · 🔵 Estable · 🟡 Mejorando · 🟠 Respuesta parcial · 🔴 Empeorando · ⚫ Crítico · ⚪ Información insuficiente",
          },
          estado: {
            type: "string",
            enum: [
              "remision",
              "estable",
              "mejorando",
              "respuesta_parcial",
              "empeorando",
              "critico",
              "informacion_insuficiente",
            ],
          },
          justificacion: {
            type: "string",
            description: "Por qué se asignó este estado — siempre debe explicarse, nunca queda implícito.",
          },
        },
      },
      clinical_confidence: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Indica calidad de evidencia, NUNCA probabilidad de enfermedad.",
        additionalProperties: false,
        required: ["nivel", "justificacion"],
        properties: {
          nivel: { type: "string", enum: ["alto", "moderado", "bajo"] },
          justificacion: { type: "string" },
        },
      },
      active_problems: {
        type: ["array", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Siempre presente en caso contrario, aunque sea con un solo problema (Zona 2).",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["problema", "severidad", "fuente"],
          properties: {
            problema: { type: "string" },
            severidad: { type: "string", enum: ["critico", "relevante", "seguimiento"] },
            fuente: {
              type: "string",
              description: "De dónde surge este problema, ej. 'bioquímica adjunta 31/07', 'reportado por propietario'.",
            },
          },
        },
      },
      alertas: {
        type: ["array", "null"],
        description:
          "Null si no hay ninguna alerta activa (interacciones fármaco-fármaco/raza, banderas rojas, etc.). No es un campo obligatorio como active_problems.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "descripcion", "nivel", "componente_origen"],
          properties: {
            tipo: { type: "string" },
            descripcion: { type: "string" },
            nivel: { type: "string", enum: ["alta", "media"] },
            componente_origen: { type: "string", description: "Ej. 'CC-302', 'CC-307', 'banderas rojas GI'." },
          },
        },
      },
      trends: {
        type: ["object", "null"],
        description:
          "Null solo si meta.estado_generacion = 'sin_datos'. Cada campo interno es independientemente null si " +
          "no cumple su umbral (Zona 3, Sección 5.2) — el objeto trends en sí siempre está presente cuando hay datos.",
        additionalProperties: false,
        required: [
          "weight_trend",
          "bcs_trend",
          "cbc_trend",
          "clinical_chemistry_trend",
          "imaging_comparison",
          "clinical_timeline",
          "treatment_timeline",
        ],
        properties: {
          weight_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 pesos registrados en el expediente. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "peso_kg"],
              properties: { fecha: { type: "string" }, peso_kg: { type: "number" } },
            },
          },
          bcs_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 valores de BCS registrados. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "bcs"],
              properties: { fecha: { type: "string" }, bcs: { type: "number" } },
            },
          },
          cbc_trend: {
            type: ["array", "null"],
            description: "Requiere >=3 hemogramas. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "parametro", "valor", "unidad", "rango_ref"],
              properties: {
                fecha: { type: "string" },
                parametro: { type: "string" },
                valor: { type: "number" },
                unidad: { type: "string" },
                rango_ref: { type: "string" },
              },
            },
          },
          clinical_chemistry_trend: {
            type: ["array", "null"],
            description: "Requiere >=2 perfiles bioquímicos. Null si hay menos.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "parametro", "valor", "unidad", "rango_ref"],
              properties: {
                fecha: { type: "string" },
                parametro: { type: "string" },
                valor: { type: "number" },
                unidad: { type: "string" },
                rango_ref: { type: "string" },
              },
            },
          },
          imaging_comparison: {
            type: ["array", "null"],
            description: "Requiere estudios de imagen seriados (más de uno del mismo tipo). Null si no hay.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "hallazgo"],
              properties: { fecha: { type: "string" }, hallazgo: { type: "string" } },
            },
          },
          clinical_timeline: {
            type: ["array", "null"],
            description: "Requiere >=2 consultas. Null si es la primera consulta del caso.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "evento"],
              properties: { fecha: { type: "string" }, evento: { type: "string" } },
            },
          },
          treatment_timeline: {
            type: ["array", "null"],
            description: "Requiere que haya habido al menos un cambio terapéutico documentado. Null si el tratamiento no ha cambiado.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["fecha", "cambio"],
              properties: { fecha: { type: "string" }, cambio: { type: "string" } },
            },
          },
        },
      },
      differential_diagnosis: {
        type: ["array", "null"],
        description:
          "Requiere >=2 diagnósticos diferenciales activos (Zona 4, colapsada por defecto). Null si hay menos de 2, o si meta.estado_generacion = 'sin_datos'.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["diagnostico", "evidencia_a_favor", "evidencia_en_contra", "confianza", "informacion_faltante"],
          properties: {
            diagnostico: { type: "string" },
            evidencia_a_favor: { type: "array", items: { type: "string" } },
            evidencia_en_contra: { type: "array", items: { type: "string" } },
            confianza: { type: "string", enum: ["alta", "moderada", "baja"] },
            informacion_faltante: { type: "array", items: { type: "string" } },
          },
        },
      },
      knowledge_match: {
        type: ["array", "null"],
        description:
          "Solo si existen coincidencias reales y relevantes en la Base de Conocimiento (documentos_conocimiento " +
          "o casos similares previos). Null si no hay coincidencias — nunca forzar una referencia débil solo para llenar el campo.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["referencia", "relevancia"],
          properties: {
            referencia: { type: "string" },
            relevancia: { type: "string" },
          },
        },
      },
      clinical_reasoning_journal: {
        type: ["array", "null"],
        description:
          "Registro de hipótesis activas/descartadas a lo largo del caso (Zona 4). Null solo si " +
          "meta.estado_generacion = 'sin_datos' o si el caso es demasiado incipiente para tener hipótesis registradas todavía.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "hipotesis", "estado", "motivo"],
          properties: {
            fecha: { type: "string" },
            hipotesis: { type: "string" },
            estado: { type: "string", enum: ["activa", "descartada"] },
            motivo: { type: "string" },
          },
        },
      },
      referral_recommendation: {
        type: ["object", "null"],
        description:
          "EXCLUSIVO de ICIS (CC-260/261/262, Referral Engine Specification ICIS-REF-001). Siempre " +
          "null en casos de GCIS u otros agentes que no tengan motor de derivación. En ICIS, null solo " +
          "si el caso fue clasificado como 'manejable en atención primaria' — si se clasificó como " +
          "derivación no urgente o urgente, este campo es obligatorio.",
        additionalProperties: false,
        required: ["clasificacion", "especialidad_destino", "pregunta_clinica", "urgencia", "justificacion"],
        properties: {
          clasificacion: {
            type: "string",
            enum: ["manejable_atencion_primaria", "derivacion_no_urgente", "derivacion_urgente", "informacion_insuficiente"],
          },
          especialidad_destino: {
            type: ["string", "null"],
            description: "Null si clasificacion no implica derivación.",
          },
          pregunta_clinica: {
            type: ["string", "null"],
            description: "La pregunta clínica específica que el especialista debe resolver. Null si no aplica.",
          },
          urgencia: {
            type: ["string", "null"],
            enum: ["urgente", "no_urgente", null],
          },
          justificacion: {
            type: "string",
            description: "Por qué se llegó a esta clasificación — siempre presente, incluso si la clasificación es 'manejable en atención primaria'.",
          },
        },
      },
    },
  },
};

// Tal como la definió el usuario en informe_schema.json — se usa TAL
// CUAL, sin reescribirla.
// Generalizada a cualquier agente clínico (GCIS, ICIS, etc.) — ver
// prompt_generalizar_dashboard_informe.md.
export const INFORME_TOOL = {
  name: "generar_informe",
  description:
    "Genera el contenido estructurado del Clinical Consultation Report (CR-001) del caso actual, " +
    "siguiendo la Clinical Report Specification del agente correspondiente al caso (GCIS-REP-001 o " +
    "ICIS-REP-001). El backend ensambla el .docx final a partir de este JSON — vos solo producís el " +
    "contenido de texto/datos de cada sección, nunca el documento en sí. Nunca completes una sección " +
    "opcional si no hay datos reales que la sustenten en el caso — dejala en null. Las secciones " +
    "marcadas como 'siempre presente' deben completarse aunque sea indicando explícitamente la " +
    "ausencia de información (ej. 'sin estudios de imagen realizados hasta la fecha'), nunca " +
    "omitirse. Nunca insertes contenido genérico o de relleno.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "meta",
      "resumen_ejecutivo",
      "informacion_paciente",
      "motivo_consulta",
      "historia_clinica",
      "cronologia_clinica",
      "examen_fisico",
      "analisis_laboratorio",
      "estudios_imagen",
      "razonamiento_diagnostico",
      "diagnostico_diferencial",
      "referral_recommendation",
      "matriz_evidencia",
      "historial_terapeutico",
      "evolucion_clinica",
      "estado_clinico_actual",
      "manejo_nutricional",
      "consideraciones_farmacologicas",
      "recomendaciones",
      "pronostico",
      "referencias",
      "apendices",
    ],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_generacion", "tipo_reporte"],
        properties: {
          estado_generacion: {
            type: "string",
            enum: ["sin_datos", "generado"],
            description:
              "Red de seguridad: si el caso no tiene información clínica suficiente para un informe " +
              "con sentido, devolvé 'sin_datos' y dejá el resto de los campos raíz (excepto meta) en null.",
          },
          tipo_reporte: { type: "string", enum: ["CR-001"] },
        },
      },

      resumen_ejecutivo: {
        type: ["object", "null"],
        description: "CRS-002. Siempre presente si estado_generacion='generado'. Máximo equivalente a una página.",
        additionalProperties: false,
        required: [
          "paciente_resumen",
          "problema_principal",
          "diagnostico_mas_probable",
          "estado_clinico_actual",
          "pronostico_resumen",
        ],
        properties: {
          paciente_resumen: { type: "string" },
          problema_principal: { type: "string" },
          diagnostico_mas_probable: { type: "string" },
          estado_clinico_actual: { type: "string" },
          pronostico_resumen: { type: "string" },
        },
      },

      informacion_paciente: {
        type: ["object", "null"],
        description: "CRS-003. Siempre presente.",
        additionalProperties: false,
        required: ["nombre", "especie", "raza", "sexo", "edad", "peso_kg", "bcs", "propietario", "veterinario_remitente"],
        properties: {
          nombre: { type: "string" },
          especie: { type: "string" },
          raza: { type: "string" },
          sexo: { type: "string" },
          edad: { type: "string" },
          peso_kg: { type: ["number", "null"] },
          bcs: { type: ["string", "null"] },
          propietario: { type: "string" },
          veterinario_remitente: { type: ["string", "null"] },
        },
      },

      motivo_consulta: {
        type: ["object", "null"],
        description: "CRS-004. Siempre presente.",
        additionalProperties: false,
        required: ["motivo", "tiempo_evolucion", "antecedentes_relevantes"],
        properties: {
          motivo: { type: "string" },
          tiempo_evolucion: { type: "string" },
          antecedentes_relevantes: { type: "string" },
        },
      },

      historia_clinica: {
        type: ["string", "null"],
        description:
          "CRS-005. Narrativa cronológica sintetizada por vos — nunca copiar notas textuales del chat. Siempre presente.",
      },

      cronologia_clinica: {
        type: ["array", "null"],
        description: "CRS-006. Null solo si es la primera consulta del caso sin eventos previos que cronologizar.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "evento"],
          properties: { fecha: { type: "string" }, evento: { type: "string" } },
        },
      },

      examen_fisico: {
        type: ["object", "null"],
        description: "CRS-007. Siempre presente si hubo examen físico registrado en el caso.",
        additionalProperties: false,
        required: ["hallazgos_por_sistema", "estado_general", "estado_nutricional", "hidratacion"],
        properties: {
          hallazgos_por_sistema: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["sistema", "hallazgo"],
              properties: { sistema: { type: "string" }, hallazgo: { type: "string" } },
            },
          },
          estado_general: { type: "string" },
          estado_nutricional: { type: "string" },
          hidratacion: { type: "string" },
        },
      },

      analisis_laboratorio: {
        type: ["array", "null"],
        description: "CRS-008. Null si no hay laboratorios adjuntos al caso. Valores siempre como tabla con datos originales, nunca parafraseados.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tipo_estudio", "valores", "comentario_interpretativo"],
          properties: {
            fecha: { type: "string" },
            tipo_estudio: { type: "string", description: "Ej. 'Hemograma completo', 'Bioquímica sérica', 'Urianálisis'." },
            valores: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["parametro", "valor", "unidad", "rango_ref", "fuera_de_rango"],
                properties: {
                  parametro: { type: "string" },
                  valor: { type: "string" },
                  unidad: { type: "string" },
                  rango_ref: { type: "string" },
                  fuera_de_rango: { type: "boolean" },
                },
              },
            },
            comentario_interpretativo: { type: "string" },
          },
        },
      },

      estudios_imagen: {
        type: ["array", "null"],
        description: "CRS-009. Null si no hay estudios de imagen en el caso.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tipo_estudio", "resumen", "hallazgos", "interpretacion"],
          properties: {
            fecha: { type: "string" },
            tipo_estudio: { type: "string" },
            resumen: { type: "string" },
            hallazgos: { type: "string" },
            interpretacion: { type: "string" },
          },
        },
      },

      razonamiento_diagnostico: {
        type: ["string", "null"],
        description:
          "CRS-010. La sección más importante del informe — explicación paso a paso de cómo se llegó al " +
          "diagnóstico o sospecha diagnóstica, no solo el resultado. Siempre presente.",
      },

      diagnostico_diferencial: {
        type: ["array", "null"],
        description: "CRS-011. Null solo si hay un único diagnóstico confirmado sin diferenciales activos.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["diagnostico", "probabilidad", "evidencia", "estado"],
          properties: {
            diagnostico: { type: "string" },
            probabilidad: { type: "string", enum: ["alta", "moderada", "baja"] },
            evidencia: { type: "string" },
            estado: { type: "string", enum: ["activo", "descartado"] },
          },
        },
      },

      referral_recommendation: {
        type: ["object", "null"],
        description:
          "CRS-013. EXCLUSIVO de ICIS (Referral Engine Specification ICIS-REF-001) — siempre null en " +
          "informes de GCIS u otros agentes sin motor de derivación. En ICIS, null solo si el caso fue " +
          "clasificado como 'manejable en atención primaria'.",
        additionalProperties: false,
        required: ["clasificacion", "especialidad_destino", "pregunta_clinica", "urgencia", "justificacion"],
        properties: {
          clasificacion: {
            type: "string",
            enum: ["manejable_atencion_primaria", "derivacion_no_urgente", "derivacion_urgente", "informacion_insuficiente"],
          },
          especialidad_destino: { type: ["string", "null"] },
          pregunta_clinica: {
            type: ["string", "null"],
            description: "La pregunta clínica específica que el especialista debe resolver.",
          },
          urgencia: { type: ["string", "null"], enum: ["urgente", "no_urgente", null] },
          justificacion: { type: "string" },
        },
      },

      matriz_evidencia: {
        type: ["array", "null"],
        description: "CRS-012. Toda afirmación clínicamente relevante del informe debe estar sustentada acá. Siempre presente si hay al menos un hallazgo clínico relevante.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["afirmacion", "evidencia_sustento", "fuente"],
          properties: {
            afirmacion: { type: "string" },
            evidencia_sustento: { type: "string" },
            fuente: { type: "string" },
          },
        },
      },

      historial_terapeutico: {
        type: ["array", "null"],
        description: "CRS-014. Null si no ha habido ningún tratamiento indicado todavía.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["fecha", "tratamiento", "respuesta"],
          properties: {
            fecha: { type: "string" },
            tratamiento: { type: "string" },
            respuesta: { type: "string" },
          },
        },
      },

      evolucion_clinica: {
        type: ["string", "null"],
        description: "CRS-015. Narrativa longitudinal desde la primera consulta hasta hoy. Null si es la primera consulta del caso.",
      },

      estado_clinico_actual: {
        type: ["object", "null"],
        description: "CRS-016. Siempre presente. Mismo Clinical State Engine usado en el Dashboard.",
        additionalProperties: false,
        required: ["emoji", "estado", "explicacion"],
        properties: {
          emoji: { type: "string", enum: ["🟢", "🔵", "🟡", "🟠", "🔴", "⚫", "⚪"] },
          estado: {
            type: "string",
            enum: ["remision", "estable", "mejorando", "respuesta_parcial", "empeorando", "critico", "informacion_insuficiente"],
          },
          explicacion: { type: "string" },
        },
      },

      manejo_nutricional: {
        type: ["object", "null"],
        description: "CRS-021. Null si no hay registro dietario (CC-306) en el caso.",
        additionalProperties: false,
        required: ["dieta_actual", "objetivo_terapeutico", "fuente_indicacion", "extras_no_controlados", "alerta_ensayo_eliminacion"],
        properties: {
          dieta_actual: { type: "array", items: { type: "string" } },
          objetivo_terapeutico: { type: "string" },
          fuente_indicacion: { type: "string" },
          extras_no_controlados: { type: "array", items: { type: "string" } },
          alerta_ensayo_eliminacion: {
            type: ["string", "null"],
            description: "Si hay una dieta de eliminación activa: tiempo transcurrido vs. punto de decisión esperado (3 semanas / ~12 semanas). Null si no aplica.",
          },
        },
      },

      consideraciones_farmacologicas: {
        type: ["array", "null"],
        description: "CRS-022. Null si no hay alertas del motor de interacciones (CC-302) en el caso.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo_alerta", "descripcion", "nivel", "fuente"],
          properties: {
            tipo_alerta: { type: "string" },
            descripcion: { type: "string" },
            nivel: { type: "string", enum: ["alta", "media"] },
            fuente: { type: "string" },
          },
        },
      },

      recomendaciones: {
        type: ["object", "null"],
        description: "CRS-017. Siempre presente.",
        additionalProperties: false,
        required: ["terapeuticas", "estudios_sugeridos", "seguimiento", "monitoreo", "informacion_faltante", "riesgos"],
        properties: {
          terapeuticas: { type: "array", items: { type: "string" } },
          estudios_sugeridos: { type: "array", items: { type: "string" } },
          seguimiento: { type: "string" },
          monitoreo: { type: "array", items: { type: "string" } },
          informacion_faltante: { type: "array", items: { type: "string" } },
          riesgos: { type: "array", items: { type: "string" } },
        },
      },

      pronostico: {
        type: ["object", "null"],
        description: "CRS-018. Siempre presente.",
        additionalProperties: false,
        required: ["categoria", "justificacion"],
        properties: {
          categoria: { type: "string", enum: ["favorable", "reservado", "grave", "incierto", "pendiente_evaluacion_especialista"] },
          justificacion: { type: "string" },
        },
      },

      referencias: {
        type: ["array", "null"],
        description: "CRS-019. Null si el razonamiento no se apoyó en literatura, casos similares ni documentos de banderas rojas específicos.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tipo", "referencia", "detalle"],
          properties: {
            tipo: { type: "string", enum: ["literatura", "caso_similar", "banderas_rojas", "otro"] },
            referencia: { type: "string" },
            detalle: { type: "string" },
          },
        },
      },

      apendices: {
        type: ["array", "null"],
        description: "CRS-020. Datos de soporte completos (tablas extendidas de laboratorio, listados de estudios, etc.) que no caben cómodamente en el cuerpo del informe. Null si el caso es simple y todo el detalle ya cabe en las secciones principales.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["titulo", "contenido"],
          properties: {
            titulo: { type: "string" },
            contenido: { type: "string" },
          },
        },
      },
    },
  },
};

// Tal como la definió el usuario en receta_validacion_schema.json — se
// usa TAL CUAL, sin reescribirla.
export const VALIDAR_RECETA_TOOL = {
  name: "validar_receta",
  description:
    "Realiza la validación de seguridad clínica de una receta veterinaria propuesta por el médico, en " +
    "el contexto del caso actual — esta tool es común a cualquier agente clínico de Vetline Ai (GCIS, " +
    "ICIS, u otros que se agreguen a futuro), no exclusiva de una especialidad. Esta validación es " +
    "EXCLUSIVAMENTE ADVISORIA: nunca aprueba, rechaza ni bloquea la receta — el médico es el único " +
    "responsable de la prescripción. Tu única función es identificar riesgos potenciales y explicarlos " +
    "con claridad, para que el médico decida con esa información. Nunca inventes contraindicaciones sin " +
    "fundamento; si no hay preocupaciones reales, devolvé un array vacío en alertas.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["meta", "alertas", "resumen_validacion"],
    properties: {
      meta: {
        type: "object",
        additionalProperties: false,
        required: ["estado_validacion"],
        properties: {
          estado_validacion: {
            type: "string",
            enum: ["completada", "informacion_insuficiente"],
            description:
              "'informacion_insuficiente' solo si el caso carece de datos básicos del paciente (especie, " +
              "peso, edad) necesarios para cualquier validación mínima — en ese caso, alertas puede venir " +
              "vacío y el resumen_validacion debe explicar qué falta.",
          },
        },
      },
      alertas: {
        type: "array",
        description:
          "Lista de advertencias clínicas encontradas. Array vacío si no se identificó ningún riesgo " +
          "relevante — eso es un resultado válido y esperado, no forzar alertas artificiales.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["categoria", "medicamento_afectado", "descripcion", "nivel", "fuente"],
          properties: {
            categoria: {
              type: "string",
              enum: [
                "interaccion_medicamentosa",
                "contraindicacion",
                "alergia_registrada",
                "duplicidad_terapeutica",
                "dosis_fuera_de_rango",
                "incompatibilidad_enfermedad_existente",
                "advertencia_edad",
                "advertencia_peso",
                "advertencia_especie",
                "advertencia_raza",
              ],
            },
            medicamento_afectado: {
              type: "string",
              description:
                "Nombre del medicamento de la receta al que aplica esta alerta (o 'combinación de X y Y' " +
                "si es una interacción entre dos items de la misma receta).",
            },
            descripcion: {
              type: "string",
              description: "Explicación clínica clara del riesgo — nunca solo una etiqueta, siempre el razonamiento.",
            },
            nivel: { type: "string", enum: ["alta", "media"] },
            fuente: {
              type: "string",
              description:
                "De dónde surge esta alerta: documento de Farmacoterapia, historia clínica del caso, " +
                "predisposición racial documentada, etc.",
            },
          },
        },
      },
      resumen_validacion: {
        type: "string",
        description:
          "1-2 líneas resumiendo el resultado general de la validación, para mostrar como encabezado del " +
          "panel de advertencias. Ej: 'Se identificaron 2 advertencias de nivel alta relacionadas con " +
          "función renal.' o 'No se identificaron riesgos relevantes con la información disponible.'",
      },
    },
  },
};

// El array que mandan los cuatro caminos. El orden es parte del contrato
// del caché: no reordenar sin entender que eso tira el caché de todos.
export const HERRAMIENTAS_AGENTE = [DASHBOARD_TOOL, INFORME_TOOL, VALIDAR_RECETA_TOOL] as any[];

// Una hora es el máximo que ofrece la API (las opciones son 5 minutos o
// 1 hora). El chat ya lo usaba; dashboard, informe y receta estaban en el
// default de 5 minutos, que con el patrón de uso real —leer, revisar el
// expediente, pensar, recién ahí pedir el informe— vencía casi siempre.
// Escribir a 1h cuesta 2x en vez de 1,25x, pero se paga una vez por caso
// en lugar de una vez por acción.
export const CACHE_PREFIJO_COMPARTIDO = { type: "ephemeral" as const, ttl: "1h" as const };
