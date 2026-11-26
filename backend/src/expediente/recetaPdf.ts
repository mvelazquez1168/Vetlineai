import { PoolClient } from "pg";
import { almacenamientoPublico, claveLogoDesdeValorGuardado } from "../almacenamiento";
import { emitirNotificacion } from "../notificaciones";
import { DatosPdfReceta, generarPdfReceta, sanitizarNombreArchivo } from "../routes/recetas.routes";

// ---------------------------------------------------------------------
// EL PDF DE LA RECETA DE LA ATENCIÓN — prompt 07c, sección 2.
//
// Usa EL MISMO generador que la receta que escribe el agente de IA
// (`generarPdfReceta`, exportado desde su ruta). Dos generadores serían
// dos recetas con distinto aspecto para el mismo paciente, y la que
// vale es la que el propietario tiene en la mano.
//
// Lo que este módulo agrega es de dónde salen los datos: una receta de
// atención no tiene caso, tiene atención; y sus líneas pueden venir del
// inventario o de texto libre, no solo del catálogo de medicamentos.
// ---------------------------------------------------------------------

export interface RecetaParaImprimir {
  buffer: Buffer;
  nombreArchivo: string;
  pacienteNombre: string;
  propietarioId: string | null;
  propietarioEmail: string | null;
  medicoNombre: string;
  lineas: number;
}

export async function recetaDeAtencionEnPdf(
  db: PoolClient,
  atencionId: string
): Promise<RecetaParaImprimir> {
  const r = await db.query<{
    id: string;
    peso_kg: string | null;
    paciente_id: string;
    paciente_nombre: string;
    especie: string;
    raza: string | null;
    sexo: string | null;
    edad_anios: number | null;
    propietario_id: string | null;
    propietario_nombre: string;
    propietario_email: string | null;
    medico_nombre: string;
    medico_colegiatura: string | null;
    zona_horaria: string | null;
    tenant_logo_url: string | null;
    instrucciones_generales: string | null;
    instrucciones_propietario: string | null;
  }>(
    `SELECT r.id, r.peso_kg, r.instrucciones_generales, r.instrucciones_propietario,
            pa.id AS paciente_id, pa.nombre AS paciente_nombre, pa.especie, pa.raza, pa.sexo,
            pa.edad_anios,
            pro.id AS propietario_id,
            COALESCE(pro.nombre, 'Sin propietario registrado') AS propietario_nombre,
            pro.email AS propietario_email,
            me.nombre AS medico_nombre, me.colegiatura AS medico_colegiatura,
            t.zona_horaria, t.logo_url AS tenant_logo_url
       FROM recetas r
       JOIN pacientes pa ON pa.id = r.paciente_id
       LEFT JOIN propietarios pro ON pro.id = pa.propietario_id
       LEFT JOIN personas me ON me.id = r.medico_id
       JOIN tenants t ON t.id = r.tenant_id
      WHERE r.atencion_id = $1
      ORDER BY r.creado_en LIMIT 1`,
    [atencionId]
  );
  if (r.rows.length === 0) throw new Error("Esta atención no tiene receta.");
  const receta = r.rows[0];

  const items = await db.query<{
    nombre: string;
    dosis: string | null;
    frecuencia: string | null;
    duracion: string | null;
    via: string | null;
    indicaciones: string | null;
    observaciones: string | null;
    dispensado_aqui: boolean;
  }>(
    `SELECT ri.nombre_impreso AS nombre,
            ri.dosis, fr.etiqueta AS frecuencia,
            CASE WHEN ri.duracion_cantidad IS NOT NULL
                 THEN ri.duracion_cantidad || ' ' || ri.duracion_unidad
                 ELSE ri.duracion END AS duracion,
            vi.etiqueta AS via, ri.indicaciones, ri.observaciones, ri.dispensado_aqui
       FROM receta_items ri
       LEFT JOIN medicamentos m ON m.id = ri.medicamento_id
       LEFT JOIN inv_presentaciones pr ON pr.id = ri.presentacion_id
       LEFT JOIN inv_productos p ON p.id = pr.producto_id
       LEFT JOIN exp_catalogos_clinicos fr
              ON fr.tipo = 'frecuencia' AND fr.codigo = ri.frecuencia_codigo
       LEFT JOIN exp_catalogos_clinicos vi
              ON vi.tipo = 'via_administracion' AND vi.codigo = ri.via_codigo
      WHERE ri.receta_id = $1
      ORDER BY ri.orden, ri.id`,
    [receta.id]
  );
  if (items.rows.length === 0) throw new Error("Esta receta no tiene líneas.");

  // EL LOGO. La receta del agente devuelve 422 si no hay logo; acá no
  // se bloquea: una receta es un documento clínico que el propietario
  // necesita, y no entregarla porque falta un archivo de marca es poner
  // la marca por encima del paciente. Sin logo se imprime sin logo.
  let logoBuffer: Buffer = Buffer.alloc(0);
  if (receta.tenant_logo_url) {
    try {
      logoBuffer = await almacenamientoPublico.leer(
        claveLogoDesdeValorGuardado(receta.tenant_logo_url)
      );
    } catch {
      logoBuffer = Buffer.alloc(0);
    }
  }

  const datos: DatosPdfReceta = {
    pacienteNombre: receta.paciente_nombre,
    especie: receta.especie,
    raza: receta.raza,
    sexo: receta.sexo,
    edadAnios: receta.edad_anios,
    propietarioNombre: receta.propietario_nombre,
    medicoNombre: receta.medico_nombre ?? "—",
    medicoColegiatura: receta.medico_colegiatura,
    pesoKg: receta.peso_kg === null ? null : Number(receta.peso_kg),
    zonaHoraria: receta.zona_horaria,
    logoBuffer,
    instruccionesGenerales: receta.instrucciones_generales,
    instruccionesPropietario: receta.instrucciones_propietario,
    items: items.rows.map((i) => ({
      medicamento_nombre: i.dispensado_aqui ? `${i.nombre} (entregado en la clínica)` : i.nombre,
      dosis: i.dosis ?? "—",
      frecuencia: i.frecuencia ?? "—",
      duracion: i.duracion ?? "—",
      via_administracion: i.via ?? "—",
      // Las indicaciones para el propietario son lo que de verdad se
      // lee en la farmacia: van en la columna de observaciones, que es
      // la ancha.
      observaciones: i.indicaciones ?? i.observaciones,
    })),
  };

  const buffer = await generarPdfReceta(datos);
  const fecha = new Intl.DateTimeFormat("en-CA", {
    timeZone: receta.zona_horaria ?? "America/Costa_Rica",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  return {
    buffer,
    nombreArchivo: `Receta_${sanitizarNombreArchivo(receta.paciente_nombre)}_${fecha}.pdf`,
    pacienteNombre: receta.paciente_nombre,
    propietarioId: receta.propietario_id,
    propietarioEmail: receta.propietario_email,
    medicoNombre: receta.medico_nombre ?? "—",
    lineas: items.rows.length,
  };
}

/**
 * Enviar la receta al propietario, con su PDF adjunto.
 *
 * Pasa por `emitirNotificacion`, que es quien consulta `puedeEnviar()`:
 * el consentimiento y la franja horaria se respetan igual que en
 * cualquier otro mensaje al cliente. Si el envío queda bloqueado, el
 * registro interno se escribe igual y la pantalla lo dice.
 */
export async function enviarReceta(
  db: PoolClient,
  tenantId: string,
  atencionId: string
): Promise<{ enviado: boolean; motivo: string | null; destinatario: string | null }> {
  const receta = await recetaDeAtencionEnPdf(db, atencionId);
  if (!receta.propietarioId || !receta.propietarioEmail) {
    return {
      enviado: false,
      motivo: "El paciente no tiene un propietario con correo registrado.",
      destinatario: null,
    };
  }

  const paciente = await db.query<{ paciente_id: string }>(
    `SELECT paciente_id FROM atenciones WHERE id = $1`,
    [atencionId]
  );

  const notificacionId = await emitirNotificacion(db, {
    tenantId,
    tipo: "receta_emitida",
    destinatarioTipo: "propietario",
    destinatarioId: receta.propietarioId,
    pacienteId: paciente.rows[0]?.paciente_id ?? null,
    asunto: `Receta de ${receta.pacienteNombre}`,
    contenido: `Receta con ${receta.lineas} indicación(es), emitida por ${receta.medicoNombre}.`,
    datosCorreo: {
      nombrePaciente: receta.pacienteNombre,
      medicoNombre: receta.medicoNombre,
      fecha: new Date().toLocaleDateString("es-CR"),
      lineas: receta.lineas,
    },
    adjuntos: [
      { nombreArchivo: receta.nombreArchivo, contenido: receta.buffer },
    ],
  });

  // QUE PASO DE VERDAD. `emitirNotificacion` SIEMPRE deja el registro
  // interno, salga o no salga el correo: puede quedar bloqueado por el
  // consentimiento del cliente o por la franja horaria. Devolver
  // "enviado" sin mirar era mentir, y se vio en el navegador: la receta
  // quedo bloqueada por la franja de las 20:00 y la pantalla decia que
  // habia salido.
  const estado = await db.query<{ estado: string; error: string | null }>(
    `SELECT estado, error FROM notificaciones WHERE id = $1`,
    [notificacionId]
  );
  const enviado = estado.rows[0]?.estado === "enviada";
  return {
    enviado,
    motivo: enviado ? null : (estado.rows[0]?.error ?? "No se pudo enviar."),
    destinatario: receta.propietarioEmail,
  };
}
