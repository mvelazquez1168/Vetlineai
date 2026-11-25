import { Pool, PoolClient } from "pg";
import { PassThrough } from "stream";
import { ZipArchive } from "archiver";
import { almacenamientoPrivado } from "./almacenamiento";
import { enviarCorreoTransaccional, urlExportar, urlPlanes, urlDatosClinica, urlMedioPago } from "./correos";
import { TABLAS_BORRADO_MANUAL_EN_PURGA } from "./tablasTenant";

// ---------------------------------------------------------------------
// Flujos de suscripción, Flujo C — cierre de la prueba, ventana de purga
// con exportación, y eliminación. Sigue el patrón de módulos planos del
// proyecto.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

async function leerParametro(db: EjecutorSql, clave: string, porDefecto: number): Promise<number> {
  const result = await db.query(`SELECT valor FROM parametros_plataforma WHERE clave = $1`, [clave]);
  return result.rows[0]?.valor != null ? Number(result.rows[0].valor) : porDefecto;
}

async function obtenerEmailAdminClinica(db: EjecutorSql, tenantId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT email FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true LIMIT 1`,
    [tenantId]
  );
  return result.rows[0]?.email ?? null;
}

// Los correos de este archivo hablan de eliminación de datos — Paso 4 de
// correos transaccionales pide ser explícito con la fecha, en la zona
// horaria de la clínica (tenants.zona_horaria), no en UTC crudo.
function formatearFechaTenant(fecha: Date, zonaHoraria: string | null): string {
  return new Intl.DateTimeFormat("es", {
    timeZone: zonaHoraria ?? "America/Costa_Rica",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(fecha);
}

// ---------------------------------------------------------------------
// PASO 1 — Fin de la prueba. Una suscripción en 'prueba' termina por lo
// que ocurra primero: agotar su crédito (saldos_ia) o cumplir
// trial.duracion_dias desde el alta (suscripciones.periodo_fin, que para
// una suscripción de prueba se fija a esa fecha al crearla — mismo dato
// que ya usa el bloque 4 para trial_agotado).
// ---------------------------------------------------------------------
export async function procesarFinDePruebas(db: Pool): Promise<{ procesadas: number }> {
  let procesadas = 0;
  const plazoDias = await leerParametro(db, "purga.plazo_dias", 15);

  const candidatos = await db.query(
    `SELECT s.id AS suscripcion_id, s.tenant_id, t.nombre AS tenant_nombre, t.zona_horaria, s.periodo_fin,
            si.credito_plan_usd, si.credito_comprado_usd
     FROM suscripciones s
     JOIN tenants t ON t.id = s.tenant_id
     LEFT JOIN saldos_ia si ON si.tenant_id = s.tenant_id
     WHERE s.estado = 'prueba'
       AND (s.periodo_fin <= now() OR COALESCE(si.credito_plan_usd, 0) + COALESCE(si.credito_comprado_usd, 0) <= 0)`
  );

  for (const fila of candidatos.rows) {
    const client = await db.connect();
    let purgaProgramadaPara: Date | null = null;
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE suscripciones SET estado = 'ventana_purga' WHERE id = $1`, [fila.suscripcion_id]);
      const tenantResult = await client.query(
        `UPDATE tenants SET purga_programada_para = now() + ($1 || ' days')::interval, purga_aviso_en = now(),
                            ventana_purga_origen = 'prueba_no_convertida'
         WHERE id = $2
         RETURNING purga_programada_para`,
        [plazoDias, fila.tenant_id]
      );
      purgaProgramadaPara = tenantResult.rows[0].purga_programada_para;
      await client.query(
        `INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje)
         VALUES ($1, 'trial_agotado', 'Tu período de prueba terminó — elegí un plan para seguir usando Vetline Ai.')`,
        [fila.tenant_id]
      );
      await client.query("COMMIT");
      procesadas++;
      console.log(`[purga] "${fila.tenant_nombre}" entró en ventana de purga (${plazoDias} días).`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[purga] Error al cerrar la prueba de "${fila.tenant_nombre}"`, err);
    } finally {
      client.release();
    }

    if (!purgaProgramadaPara) continue;
    const email = await obtenerEmailAdminClinica(db, fila.tenant_id);
    if (email) {
      await enviarCorreoTransaccional(db, fila.tenant_id, email, "prueba_terminada", {
        fechaEliminacion: formatearFechaTenant(purgaProgramadaPara, fila.zona_horaria),
        enlaceExportar: urlExportar(),
        enlacePlanes: urlPlanes(),
      });
    }
  }

  return { procesadas };
}

// PASO 5 — Recordatorio. purga.recordatorio_dias_antes de la fecha
// programada, si todavía no se envió.
export async function enviarRecordatoriosPurga(db: Pool): Promise<{ enviados: number }> {
  let enviados = 0;
  const diasAntes = await leerParametro(db, "purga.recordatorio_dias_antes", 3);

  const candidatos = await db.query(
    `SELECT t.id, t.nombre, t.zona_horaria, t.purga_programada_para, t.ventana_purga_origen
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE s.estado = 'ventana_purga'
       AND t.purga_programada_para IS NOT NULL
       AND t.purga_programada_para <= now() + ($1 || ' days')::interval
       AND t.purga_recordatorio_en IS NULL`,
    [diasAntes]
  );

  for (const tenant of candidatos.rows) {
    await db.query(`UPDATE tenants SET purga_recordatorio_en = now() WHERE id = $1`, [tenant.id]);
    const email = await obtenerEmailAdminClinica(db, tenant.id);
    if (email) {
      const fechaEliminacion = formatearFechaTenant(new Date(tenant.purga_programada_para), tenant.zona_horaria);
      // Origen impago (cierre por suspensión prolongada) tiene su propia
      // plantilla — el enlace principal es regularizar el pago, no elegir
      // un plan nuevo (la clínica ya tiene uno, solo dejó de pagarlo).
      if (tenant.ventana_purga_origen === "impago") {
        await enviarCorreoTransaccional(db, tenant.id, email, "recordatorio_cierre", {
          fechaEliminacion,
          enlaceExportar: urlExportar(),
          enlacePlanes: urlMedioPago(),
        });
      } else {
        await enviarCorreoTransaccional(db, tenant.id, email, "recordatorio_eliminacion", {
          fechaEliminacion,
          enlaceExportar: urlExportar(),
          enlacePlanes: urlPlanes(),
        });
      }
    }
    enviados++;
    console.log(`[purga] Recordatorio enviado a "${tenant.nombre}".`);
  }

  return { enviados };
}

// ---------------------------------------------------------------------
// Vetline_Ai_Suspension_Bloqueo.md, sección 4 — cierre por impago
// prolongado. suscripciones.estado='suspendida' queda excluida tanto del
// motor de crédito (jobs/ciclo.job.ts) como del ciclo de cobro
// (cicloCobro.ts::seleccionarCandidatos): nada vuelve a tocar
// periodo_fin mientras la suscripción está suspendida, así que se
// recalcula cuántos períodos completos transcurrieron directamente desde
// ahí — no es un contador que se incrementa una vez por corrida de job
// (eso dependería de la cadencia del job), sino tiempo transcurrido /
// duración del período, recalculado en cada pasada.
// ---------------------------------------------------------------------
export async function procesarCierrePorImpago(db: Pool): Promise<{ actualizadas: number; cerradas: number }> {
  let actualizadas = 0;
  let cerradas = 0;
  const periodosLimite = await leerParametro(db, "cierre.periodos_suspendida", 3);
  const plazoDias = await leerParametro(db, "cierre.plazo_dias", 15);

  const candidatos = await db.query(
    `SELECT s.id AS suscripcion_id, s.tenant_id, t.nombre AS tenant_nombre, t.zona_horaria,
            s.periodo_fin, s.periodicidad, s.periodos_suspendida_consecutivos
     FROM suscripciones s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.estado = 'suspendida'`
  );

  for (const fila of candidatos.rows) {
    const diasPeriodo = fila.periodicidad === "anual" ? 365 : 30;
    const msTranscurridos = Date.now() - new Date(fila.periodo_fin).getTime();
    const periodosTranscurridos = Math.max(Math.floor(msTranscurridos / (diasPeriodo * 24 * 60 * 60 * 1000)), 0);

    if (periodosTranscurridos === fila.periodos_suspendida_consecutivos) continue;

    if (periodosTranscurridos < periodosLimite) {
      await db.query(`UPDATE suscripciones SET periodos_suspendida_consecutivos = $1 WHERE id = $2`, [
        periodosTranscurridos,
        fila.suscripcion_id,
      ]);
      actualizadas++;
      continue;
    }

    // Umbral alcanzado — entra en ventana de cierre, mismo mecanismo que
    // una prueba no convertida (purga_programada_para/purga_aviso_en),
    // con su propio correo y origen.
    const client = await db.connect();
    let purgaProgramadaPara: Date | null = null;
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE suscripciones SET estado = 'ventana_purga', periodos_suspendida_consecutivos = $1 WHERE id = $2`,
        [periodosTranscurridos, fila.suscripcion_id]
      );
      const tenantResult = await client.query(
        `UPDATE tenants SET purga_programada_para = now() + ($1 || ' days')::interval, purga_aviso_en = now(),
                            ventana_purga_origen = 'impago'
         WHERE id = $2
         RETURNING purga_programada_para`,
        [plazoDias, fila.tenant_id]
      );
      purgaProgramadaPara = tenantResult.rows[0].purga_programada_para;
      await client.query(
        `INSERT INTO clinica_eventos_ciclo_vida (tenant_id, tipo_evento, motivo, estado_anterior, estado_nuevo)
         VALUES ($1, 'entrada_ventana_cierre', $2, 'suspendida', 'ventana_purga')`,
        [fila.tenant_id, `${periodosTranscurridos} períodos consecutivos en suspendida (límite: ${periodosLimite}).`]
      );
      await client.query(
        `INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje)
         VALUES ($1, 'cierre_por_impago', 'Tu cuenta entró en ventana de cierre por impago prolongado.')`,
        [fila.tenant_id]
      );
      await client.query("COMMIT");
      cerradas++;
      console.log(`[purga] "${fila.tenant_nombre}" entró en ventana de cierre por impago (${plazoDias} días).`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[purga] Error al cerrar por impago la suscripción de "${fila.tenant_nombre}"`, err);
      purgaProgramadaPara = null;
    } finally {
      client.release();
    }

    if (!purgaProgramadaPara) continue;
    const email = await obtenerEmailAdminClinica(db, fila.tenant_id);
    if (email) {
      await enviarCorreoTransaccional(db, fila.tenant_id, email, "entrada_ventana_cierre", {
        fechaEliminacion: formatearFechaTenant(purgaProgramadaPara, fila.zona_horaria),
        enlaceExportar: urlExportar(),
        enlacePlanes: urlMedioPago(),
      });
    }
  }

  return { actualizadas, cerradas };
}

// ---------------------------------------------------------------------
// Correos transaccionales, Prompt C — aviso de "prueba por terminar".
// A diferencia de procesarFinDePruebas (que dispara DESPUÉS de que la
// prueba ya terminó), este chequeo es previo: suscripciones en estado
// 'prueba' cuyo periodo_fin cae dentro de trial.aviso_dias_antes.
// tenants.trial_aviso_enviado_en evita repetirlo — mismo patrón que
// purga_recordatorio_en. No toca el estado de la suscripción: es solo un
// aviso, procesarFinDePruebas sigue siendo quien decide el cierre real.
// ---------------------------------------------------------------------
export async function enviarAvisoPruebaPorTerminar(db: Pool): Promise<{ enviados: number }> {
  let enviados = 0;
  const diasAntes = await leerParametro(db, "trial.aviso_dias_antes", 2);

  const candidatos = await db.query(
    `SELECT t.id, t.nombre, t.zona_horaria, s.periodo_fin
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE s.estado = 'prueba'
       AND s.periodo_fin > now()
       AND s.periodo_fin <= now() + ($1 || ' days')::interval
       AND t.trial_aviso_enviado_en IS NULL`,
    [diasAntes]
  );

  for (const tenant of candidatos.rows) {
    await db.query(`UPDATE tenants SET trial_aviso_enviado_en = now() WHERE id = $1`, [tenant.id]);
    const email = await obtenerEmailAdminClinica(db, tenant.id);
    if (email) {
      const diasRestantes = Math.max(
        Math.ceil((new Date(tenant.periodo_fin).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
        1
      );
      await enviarCorreoTransaccional(db, tenant.id, email, "prueba_por_terminar", {
        diasRestantes,
        enlacePlanes: urlPlanes(),
      });
    }
    enviados++;
    console.log(`[purga] Aviso de prueba por terminar enviado a "${tenant.nombre}".`);
  }

  return { enviados };
}

// ---------------------------------------------------------------------
// Prompt de verificación de correo, Capa 5 — límite exterior. Cubre dos
// situaciones que antes dejaban una cuenta abierta indefinidamente (la
// prueba nunca arranca porque el correo del admin no se verificó, o el
// primer médico invitado nunca acepta cuando el registrante no es
// médico): a los cuenta.dias_limite_no_operativa días desde el alta, si
// la cuenta sigue sin estar operativa, entra en ventana de purga con el
// mismo mecanismo que una prueba vencida — mismo aviso, mismo plazo.
// ---------------------------------------------------------------------
async function estadoOperatividad(
  db: EjecutorSql,
  tenantId: string
): Promise<{ operativa: boolean; motivos: string[] }> {
  const result = await db.query(
    `SELECT
       EXISTS(SELECT 1 FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true AND correo_verificado_en IS NOT NULL) AS correo_verificado,
       EXISTS(SELECT 1 FROM personas WHERE tenant_id = $1 AND es_medico = true AND estado = 'activo' AND colegiatura IS NOT NULL) AS tiene_medico`,
    [tenantId]
  );
  const fila = result.rows[0];
  const motivos: string[] = [];
  if (!fila.correo_verificado) motivos.push("El correo del administrador todavía no fue verificado.");
  if (!fila.tiene_medico) motivos.push("Todavía no hay ningún médico veterinario activo con colegiatura.");
  return { operativa: motivos.length === 0, motivos };
}

// Recordatorio intermedio — antes de que se cumpla el plazo, no después.
export async function enviarAvisoCuentaNoOperativa(db: Pool): Promise<{ enviados: number }> {
  let enviados = 0;
  const diasAviso = await leerParametro(db, "cuenta.aviso_dias_no_operativa", 7);
  const diasLimite = await leerParametro(db, "cuenta.dias_limite_no_operativa", 30);

  const candidatos = await db.query(
    `SELECT t.id, t.nombre
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE s.estado = 'prueba'
       AND t.creado_en <= now() - ($1 || ' days')::interval
       AND t.aviso_cuenta_no_operativa_enviado_en IS NULL`,
    [diasAviso]
  );

  for (const tenant of candidatos.rows) {
    const { operativa, motivos } = await estadoOperatividad(db, tenant.id);
    if (operativa) continue;

    await db.query(`UPDATE tenants SET aviso_cuenta_no_operativa_enviado_en = now() WHERE id = $1`, [tenant.id]);

    // Si el correo del admin ya rebotó, este aviso no tiene a dónde ir —
    // se marca igual como "ya avisado" (no tiene sentido reintentar un
    // destino que sabemos inválido) y el límite exterior de abajo es lo
    // único que va a cerrar el caso. enviarCorreoTransaccional ya es
    // best-effort por su cuenta, pero evitamos el intento cuando ya
    // sabemos que va a fallar.
    const admin = await db.query(
      `SELECT email FROM personas WHERE tenant_id = $1 AND es_admin_clinica = true AND correo_rebotado_en IS NULL LIMIT 1`,
      [tenant.id]
    );
    const email = admin.rows[0]?.email as string | undefined;
    if (email) {
      await enviarCorreoTransaccional(db, tenant.id, email, "cuenta_no_operativa", {
        nombreClinica: tenant.nombre,
        motivos,
        diasRestantes: Math.max(diasLimite - diasAviso, 1),
        enlace: urlDatosClinica(),
      });
    }
    enviados++;
    console.log(`[purga] Aviso de cuenta no operativa enviado a "${tenant.nombre}".`);
  }

  return { enviados };
}

// El límite en sí — mismo mecanismo que procesarFinDePruebas (estado a
// 'ventana_purga', purga_programada_para a purga.plazo_dias, mismo
// correo "prueba_terminada": la cuenta entra a la misma ventana de purga
// que una prueba vencida, con el mismo aviso).
export async function procesarCuentasNoOperativas(db: Pool): Promise<{ procesadas: number }> {
  let procesadas = 0;
  const diasLimite = await leerParametro(db, "cuenta.dias_limite_no_operativa", 30);
  const plazoDias = await leerParametro(db, "purga.plazo_dias", 15);

  const candidatos = await db.query(
    `SELECT s.id AS suscripcion_id, t.id AS tenant_id, t.nombre AS tenant_nombre, t.zona_horaria
     FROM suscripciones s
     JOIN tenants t ON t.id = s.tenant_id
     WHERE s.estado = 'prueba'
       AND t.creado_en <= now() - ($1 || ' days')::interval`,
    [diasLimite]
  );

  for (const fila of candidatos.rows) {
    const { operativa } = await estadoOperatividad(db, fila.tenant_id);
    if (operativa) continue;

    const client = await db.connect();
    let purgaProgramadaPara: Date | null = null;
    try {
      await client.query("BEGIN");
      await client.query(`UPDATE suscripciones SET estado = 'ventana_purga' WHERE id = $1`, [fila.suscripcion_id]);
      const tenantResult = await client.query(
        `UPDATE tenants SET purga_programada_para = now() + ($1 || ' days')::interval, purga_aviso_en = now(),
                            ventana_purga_origen = 'cuenta_no_operativa'
         WHERE id = $2
         RETURNING purga_programada_para`,
        [plazoDias, fila.tenant_id]
      );
      purgaProgramadaPara = tenantResult.rows[0].purga_programada_para;
      await client.query(
        `INSERT INTO notificaciones_uso (tenant_id, umbral, mensaje)
         VALUES ($1, 'cuenta_no_operativa', 'Tu cuenta nunca llegó a estar operativa — entró en ventana de eliminación.')`,
        [fila.tenant_id]
      );
      await client.query("COMMIT");
      procesadas++;
      console.log(`[purga] "${fila.tenant_nombre}" nunca estuvo operativa — entró en ventana de purga (${plazoDias} días).`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[purga] Error al cerrar la cuenta no operativa de "${fila.tenant_nombre}"`, err);
    } finally {
      client.release();
    }

    if (!purgaProgramadaPara) continue;
    const email = await obtenerEmailAdminClinica(db, fila.tenant_id);
    if (email) {
      await enviarCorreoTransaccional(db, fila.tenant_id, email, "prueba_terminada", {
        fechaEliminacion: formatearFechaTenant(purgaProgramadaPara, fila.zona_horaria),
        enlaceExportar: urlExportar(),
        enlacePlanes: urlPlanes(),
      });
    }
  }

  return { procesadas };
}

// ---------------------------------------------------------------------
// PASO 3 — Informe de cortesía. Se ejecuta sin verificar saldo (por eso
// no pasa por verificarAntesDeGenerar de tarifas.ts, que si lo haría) —
// la llamada al modelo la sigue haciendo el endpoint de informe existente
// en casos.routes.ts, esta función solo valida el permiso previo y
// específico de este camino.
// ---------------------------------------------------------------------
export type MotivoRechazoCortesia = "no_es_ventana_purga" | "ya_tiene_informe";

export async function verificarInformeCortesiaPermitido(
  db: EjecutorSql,
  tenantId: string,
  casoId: string
): Promise<{ permitido: boolean; motivo?: MotivoRechazoCortesia }> {
  const suscripcionResult = await db.query(
    `SELECT s.estado FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
    [tenantId]
  );
  if (suscripcionResult.rows[0]?.estado !== "ventana_purga") {
    return { permitido: false, motivo: "no_es_ventana_purga" };
  }

  // "El caso existe y no tiene informe persistido" + "no se generó ya un
  // informe de cortesía para ese caso" — la primera condición ya
  // subsume la segunda (si no hay NINGÚN informe, tampoco hay uno de
  // cortesía), pero se deja el límite estricto de un informe de cortesía
  // por caso explícito y separado, tal como lo pide el paso 3: sin este
  // tope, una prueba podría duplicar su costo real generando al final
  // todos los informes que no generó durante el período.
  const informeExistente = await db.query(`SELECT 1 FROM informes_generados WHERE caso_id = $1 LIMIT 1`, [casoId]);
  if (informeExistente.rows.length > 0) {
    return { permitido: false, motivo: "ya_tiene_informe" };
  }

  return { permitido: true };
}

export function mensajeRechazoCortesia(motivo: MotivoRechazoCortesia): string {
  switch (motivo) {
    case "no_es_ventana_purga":
      return "Este beneficio solo está disponible durante la ventana de cierre de la prueba.";
    case "ya_tiene_informe":
      return "Este caso ya tiene un informe generado.";
  }
}

// ---------------------------------------------------------------------
// Pantallas faltantes, Prompt B, Paso 2 — "crear casos, generar
// dashboards, cualquier operación con IA: no disponible". Comparte el
// mismo motivo "fuera_de_ventana" que ya usa POST /api/casos (creación),
// para que el frontend maneje los tres puntos de bloqueo con un único
// chequeo de motivo.
// ---------------------------------------------------------------------
export async function obtenerEstadoSuscripcion(db: EjecutorSql, tenantId: string): Promise<string | null> {
  const result = await db.query(
    `SELECT s.estado FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id WHERE t.id = $1`,
    [tenantId]
  );
  return result.rows[0]?.estado ?? null;
}

export function suscripcionBloqueaGeneracionIa(estado: string | null): boolean {
  return estado === "ventana_purga" || estado === "finalizada";
}

// ---------------------------------------------------------------------
// PASO 4 — Exportación. Paquete zip con los datos de cada caso
// (anamnesis/hallazgos/laboratorio quedan representados por el
// historial de mensajes y los campos estructurados del caso — es lo que
// existe hoy en el esquema, no hay tablas separadas de anamnesis/
// hallazgos/laboratorio), los archivos subidos, y los informes generados
// (incluidos los de cortesía). Disponible para cualquier admin de
// clínica en cualquier momento, no solo durante ventana_purga — el flujo
// C solo pide que esté disponible TAMBIÉN para cancelada/finalizada
// (paso 7), no que se restrinja para el resto.
// ---------------------------------------------------------------------
export async function generarPaqueteExportacion(db: EjecutorSql, tenantId: string, solicitadaPor: string): Promise<string> {
  const exportacionResult = await db.query(
    `INSERT INTO exportaciones (tenant_id, solicitada_por, estado) VALUES ($1, $2, 'generando') RETURNING id`,
    [tenantId, solicitadaPor]
  );
  const exportacionId = exportacionResult.rows[0].id;

  try {
    const nombreArchivo = `${exportacionId}.zip`;
    const clave = `exportaciones/${nombreArchivo}`;

    const casosResult = await db.query(
      `SELECT c.id, c.motivo, c.estado, c.severidad, c.confianza_diagnostica, c.creado_en,
              p.nombre AS paciente_nombre, p.especie, p.edad_anios,
              pr.nombre AS propietario_nombre
       FROM casos c
       JOIN pacientes p ON p.id = c.paciente_id
       JOIN propietarios pr ON pr.id = p.propietario_id
       WHERE c.tenant_id = $1
       ORDER BY c.creado_en`,
      [tenantId]
    );

    // El zip se arma en memoria (no en disco): un contenedor descartable
    // no garantiza que sobreviva hasta que termine de escribirse. El
    // PassThrough colecciona los chunks que archiver produce y se
    // concatenan en un Buffer al terminar, que es lo que va al
    // almacenamiento de objetos.
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const salida = new PassThrough();
      const chunks: Buffer[] = [];
      salida.on("data", (chunk) => chunks.push(chunk));
      salida.on("end", () => resolve(Buffer.concat(chunks)));
      salida.on("error", reject);

      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on("error", reject);
      archive.pipe(salida);

      (async () => {
        for (const caso of casosResult.rows) {
          const carpeta = `caso_${caso.id}`;

          const mensajesResult = await db.query(
            `SELECT remitente, contenido, creado_en FROM mensajes WHERE caso_id = $1 ORDER BY creado_en`,
            [caso.id]
          );
          const datosCaso = {
            paciente: caso.paciente_nombre,
            especie: caso.especie,
            edadAnios: caso.edad_anios,
            propietario: caso.propietario_nombre,
            motivo: caso.motivo,
            estado: caso.estado,
            severidad: caso.severidad,
            confianzaDiagnostica: caso.confianza_diagnostica,
            creadoEn: caso.creado_en,
            historial: mensajesResult.rows,
          };
          archive.append(JSON.stringify(datosCaso, null, 2), { name: `${carpeta}/datos_caso.json` });

          const archivosResult = await db.query(
            `SELECT nombre_archivo, url FROM archivos WHERE caso_id = $1`,
            [caso.id]
          );
          for (const arch of archivosResult.rows) {
            try {
              const datosArchivo = await almacenamientoPrivado.leer(arch.url.replace(/^\/uploads\//, ""));
              archive.append(datosArchivo, { name: `${carpeta}/archivos/${arch.nombre_archivo}` });
            } catch {
              // El archivo ya no está disponible en el almacenamiento —
              // se omite del paquete en vez de fallar toda la exportación.
            }
          }

          const informesResult = await db.query(
            `SELECT nombre_archivo, contenido_docx, es_cortesia FROM informes_generados WHERE caso_id = $1`,
            [caso.id]
          );
          for (const informe of informesResult.rows) {
            const prefijo = informe.es_cortesia ? "cortesia_" : "";
            archive.append(informe.contenido_docx, {
              name: `${carpeta}/informes/${prefijo}${informe.nombre_archivo}`,
            });
          }
        }
        await archive.finalize();
      })().catch(reject);
    });

    await almacenamientoPrivado.guardar(clave, zipBuffer, "application/zip");

    await db.query(
      `UPDATE exportaciones
       SET estado = 'lista', archivo_ref = $1, casos_incluidos = $2, lista_en = now(), expira_en = now() + interval '30 days'
       WHERE id = $3`,
      [clave, casosResult.rows.length, exportacionId]
    );
  } catch (err) {
    console.error(`[purga] Error al generar la exportación ${exportacionId}`, err);
    await db.query(`UPDATE exportaciones SET estado = 'fallida' WHERE id = $1`, [exportacionId]);
    throw err;
  }

  return exportacionId;
}

// ---------------------------------------------------------------------
// PASO 6 — Eliminación. Al llegar purga_programada_para sin conversión
// (la suscripción sigue en 'ventana_purga' — si el admin convirtió a un
// plan pago, el estado ya cambió y este tenant deja de ser candidato).
//
// El registro de auditoría se inserta ANTES de eliminar, en
// clinicas_purgadas_auditoria (fuera de `tenants` a propósito — ver
// migración 027 — porque tiene que sobrevivir al DELETE), incluyendo la
// contabilidad agregada de uso_api (migración 046) — es la única
// oportunidad de capturarla, porque uso_api se borra unas líneas más
// abajo y no queda otro rastro agregado en ningún lado.
//
// Las tablas tenant-scoped que NO tienen ON DELETE CASCADE desde
// tenants se borran a mano antes del DELETE FROM tenants final, que se
// apoya en el resto de las FK con CASCADE para todo lo demás (personas,
// casos, pacientes, recetas, citas, saldos_ia, movimientos_credito…).
//
// Cuáles son vive en tablasTenant.ts::TABLAS_BORRADO_MANUAL_EN_PURGA, no
// en este archivo: jobs/auditoriaRls.job.ts lee la MISMA constante para
// reportar cualquier FK sin cascada que no esté contemplada ahí. Son dos
// lecturas de la misma regla y tienen que ser un solo dato.
// ---------------------------------------------------------------------
export async function ejecutarPurgas(db: Pool): Promise<{ purgadas: number }> {
  let purgadas = 0;

  const candidatos = await db.query(
    `SELECT t.id, t.nombre, t.purga_aviso_en, t.purga_recordatorio_en
     FROM tenants t
     JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE s.estado = 'ventana_purga'
       AND t.purga_programada_para IS NOT NULL
       AND t.purga_programada_para <= now()`
  );

  for (const tenant of candidatos.rows) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");

      const emailAdmin = await obtenerEmailAdminClinica(client, tenant.id);

      // Contabilidad agregada — se calcula ANTES de borrar uso_api, la
      // única oportunidad de capturarla (prompt_code_optimizacion_contexto,
      // Cambio 4: sin esto, la purga borraba el consumo sin dejar rastro).
      const consumoResult = await client.query(
        `SELECT COALESCE(SUM(costo_usd_calculado), 0) AS total,
                count(*) AS cantidad,
                min("timestamp") AS primera,
                max("timestamp") AS ultima
         FROM uso_api WHERE tenant_id = $1`,
        [tenant.id]
      );
      const consumo = consumoResult.rows[0];
      const creditoResult = await client.query(
        `SELECT COALESCE(SUM(monto_usd), 0) AS total FROM movimientos_credito WHERE tenant_id = $1 AND tipo = 'credito_prueba'`,
        [tenant.id]
      );

      await client.query(
        `INSERT INTO clinicas_purgadas_auditoria
           (tenant_id, nombre_clinica, email_administrador, aviso_en, recordatorio_en, purgado_en,
            consumo_total_usd, cantidad_llamadas, primera_llamada_en, ultima_llamada_en, credito_otorgado_usd)
         VALUES ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9, $10)`,
        [
          tenant.id,
          tenant.nombre,
          emailAdmin,
          tenant.purga_aviso_en,
          tenant.purga_recordatorio_en,
          consumo.total,
          consumo.cantidad,
          consumo.primera,
          consumo.ultima,
          creditoResult.rows[0].total,
        ]
      );

      // La lista vive en tablasTenant.ts, no acá: la auditoría de RLS
      // (jobs/auditoriaRls.job.ts) lee LA MISMA constante para reportar
      // cualquier FK a `tenants` sin cascada que no esté contemplada.
      // Antes eran cuatro DELETE escritos a mano acá, invisibles para
      // cualquier chequeo.
      //
      // El nombre de tabla se interpola porque viene de una constante
      // `as const` del propio código, nunca de un request — no hay
      // parámetro de Postgres para un identificador.
      for (const tabla of TABLAS_BORRADO_MANUAL_EN_PURGA) {
        await client.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [tenant.id]);
      }
      // notificaciones_callback.cobro_id no tiene ON DELETE CASCADE (es un
      // log crudo de todo lo que llegó por el callback, sin tenant_id
      // propio — se atribuye por order_number, ver callbackCobros.ts). Sin
      // este DELETE, cualquier clínica que haya tenido un intento de cobro
      // real (que es el caso normal para una que llega a ventana_purga por
      // impago) hace fallar el DELETE FROM tenants de más abajo — hallazgo
      // real de la verificación del escenario 5, no algo que este prompt
      // pidiera cambiar.
      await client.query(
        `DELETE FROM notificaciones_callback WHERE cobro_id IN (SELECT id FROM cobros WHERE tenant_id = $1)`,
        [tenant.id]
      );

      await client.query(`DELETE FROM tenants WHERE id = $1`, [tenant.id]);

      await client.query("COMMIT");
      purgadas++;
      console.log(`[purga] Tenant "${tenant.nombre}" (${tenant.id}) eliminado — registro de auditoría conservado.`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[purga] Error al purgar el tenant "${tenant.nombre}" (${tenant.id})`, err);
    } finally {
      client.release();
    }
  }

  return { purgadas };
}
