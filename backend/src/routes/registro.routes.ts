import bcrypt from "bcrypt";
import { Router } from "express";
import { pool } from "../db";
import { crearUsuarioKeycloak, KeycloakUsuarioExistenteError, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { crearInvitacion } from "../invitaciones";
import { asignarAgenteAlRegistrante } from "../medicoAgente";
import { otorgarCreditoPruebaSiCorresponde } from "../registroPrueba";
import { generarYEnviarVerificacion } from "../verificacionCorreo";
import { zonasHorariasParaPais } from "./paises.routes";

export const registroRouter = Router();

// Público — catálogo de agentes elegibles como agente único de la prueba
// gratuita (wizard paso 4). Mismo filtro "disponible" que ya usa el
// registro-publico principal para validar el agenteId elegido.
registroRouter.get("/agentes", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nombre, descripcion, icono FROM agentes WHERE estado_catalogo = 'disponible' AND estado = 'activo' ORDER BY nombre`
    );
    res.json({ agentes: result.rows });
  } catch (err) {
    console.error("GET /registro-publico/agentes", err);
    res.status(500).json({ error: "Error al listar los agentes." });
  }
});

// Público — paso 1 del wizard, cuando el país elegido no está habilitado.
// Separado del alta principal para no obligar a completar el resto del
// formulario antes de saber si el país admite registro.
registroRouter.post("/lista-espera", async (req, res) => {
  const { email, paisCodigo, nombre } = req.body as { email?: string; paisCodigo?: string; nombre?: string };
  if (!email || !paisCodigo) {
    return res.status(400).json({ error: "Faltan el correo o el país." });
  }
  try {
    await pool.query(
      `INSERT INTO lista_espera_paises (correo, pais_codigo, nombre) VALUES ($1, $2, $3)`,
      [email, paisCodigo, nombre ?? null]
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("POST /registro-publico/lista-espera", err);
    res.status(500).json({ error: "Error al registrar el interés en la lista de espera." });
  }
});

interface RegistroBody {
  paisCodigo?: string;
  nombreComercial?: string;
  tipoPersona?: "fisica" | "juridica";
  tipoIdentificacionId?: string;
  numeroIdentificacion?: string;
  nombreFiscal?: string;
  nombreTitular?: string;
  email?: string;
  telefono?: string;
  password?: string;
  esMedico?: boolean;
  colegiatura?: string;
  universidadEgreso?: string;
  anioGraduacion?: number;
  correoMedicoInvitado?: string;
  agenteId?: string;
}

// ---------------------------------------------------------------------
// POST /api/registro-publico — SIN autenticación. Reemplaza por completo
// el flujo anterior (cobro inmediato vía Tilopay, sin período de prueba,
// escribía en el modelo viejo tenants.estado_suscripcion/plan_id). El
// alta ahora NO cobra nada: termina con una suscripción en estado
// 'prueba' (motor de crédito, ver tarifas.ts/usoIa.ts/ciclo.job.ts).
//
// El paso de tarjeta del wizard (frontend) es un componente aislado que
// hoy no manda nada acá — la tokenización de la pasarela está pendiente
// de confirmación con el proveedor (ver nota en Registro.tsx). Cuando se
// resuelva, ese componente pasa a llamar a la pasarela ANTES de este
// POST y le agrega el token/método de pago al body; este endpoint no
// necesita cambiar para eso, porque hoy no toca ningún dato de tarjeta.
// ---------------------------------------------------------------------
registroRouter.post("/", async (req, res) => {
  const {
    paisCodigo,
    nombreComercial,
    tipoPersona,
    tipoIdentificacionId,
    numeroIdentificacion,
    nombreFiscal,
    nombreTitular,
    email,
    telefono,
    password,
    esMedico,
    colegiatura,
    universidadEgreso,
    anioGraduacion,
    correoMedicoInvitado,
    agenteId,
  } = req.body as RegistroBody;

  if (!paisCodigo || !nombreComercial || !tipoPersona || !nombreTitular || !email || !password || !agenteId) {
    return res.status(400).json({ error: "Faltan datos obligatorios del registro." });
  }
  if (esMedico && !colegiatura) {
    return res.status(400).json({ error: "Falta el número de colegiatura del médico." });
  }
  if (!esMedico && !correoMedicoInvitado) {
    return res.status(400).json({ error: "Falta el correo del primer médico a invitar." });
  }

  try {
    // PASO 1 — el país determina si el registro puede continuar.
    const paisResult = await pool.query(`SELECT estado FROM paises WHERE codigo_iso = $1`, [paisCodigo]);
    if (paisResult.rows[0]?.estado !== "habilitado") {
      await pool.query(
        `INSERT INTO lista_espera_paises (correo, pais_codigo, nombre) VALUES ($1, $2, $3)`,
        [email, paisCodigo, nombreComercial]
      );
      return res.status(202).json({ listaEspera: true });
    }

    const emailExistente = await pool.query(`SELECT id FROM personas WHERE email = $1`, [email]);
    if (emailExistente.rows.length > 0) {
      return res.status(409).json({ error: "Ya existe un usuario con ese email." });
    }

    // PASO 2 — el tipo de identificación depende del país y del tipo de
    // persona, se consulta, no se asume.
    if (tipoIdentificacionId) {
      const tipoResult = await pool.query(
        `SELECT 1 FROM tipos_identificacion
         WHERE id = $1 AND pais_codigo = $2 AND activo = true
           AND ($3 = 'fisica' AND aplica_persona_fisica = true OR $3 = 'juridica' AND aplica_persona_juridica = true)`,
        [tipoIdentificacionId, paisCodigo, tipoPersona]
      );
      if (tipoResult.rows.length === 0) {
        return res
          .status(400)
          .json({ error: "El tipo de identificación no es válido para ese país y tipo de persona." });
      }
    }

    const agenteResult = await pool.query(
      `SELECT id FROM agentes WHERE id = $1 AND estado_catalogo = 'disponible' AND estado = 'activo'`,
      [agenteId]
    );
    if (agenteResult.rows.length === 0) {
      return res.status(400).json({ error: "El agente elegido no está disponible." });
    }

    const planPruebaResult = await pool.query(
      `SELECT id FROM planes WHERE es_plan_prueba = true LIMIT 1`
    );
    const planPrueba = planPruebaResult.rows[0];
    if (!planPrueba) {
      console.error("POST /registro-publico: no hay un plan marcado como es_plan_prueba en el catálogo");
      return res.status(500).json({ error: "No se encontró el plan de prueba." });
    }

    const parametrosResult = await pool.query(
      `SELECT clave, valor FROM parametros_plataforma WHERE clave IN ('trial.duracion_dias', 'trial.medicos_incluidos')`
    );
    const parametros = new Map(parametrosResult.rows.map((p) => [p.clave, p.valor]));
    const duracionDias = Number(parametros.get("trial.duracion_dias") ?? 5);
    // Mínimo 2: el registrante-médico más un invitado — es justo el flujo
    // que la prueba tiene que poder ejercitar (prompt urgente medico_agente).
    const medicosIncluidos = Number(parametros.get("trial.medicos_incluidos") ?? 2);

    const zonaHoraria = zonasHorariasParaPais(paisCodigo).default ?? "America/Costa_Rica";
    const passwordHash = await bcrypt.hash(password, 10);

    const client = await pool.connect();
    let tenantId: string;
    let personaId: string;
    try {
      await client.query("BEGIN");

      // estado_suscripcion es columna del modelo viejo (default de tabla
      // stale: 'trial', valor que el check constraint del modelo nuevo ya
      // no acepta) — la fijamos acá a 'prueba' para que quede consistente
      // con suscripciones.estado; el resto del alta usa exclusivamente el
      // modelo nuevo (suscripciones/saldos_ia).
      const tenantResult = await client.query(
        `INSERT INTO tenants
           (nombre, pais_codigo, zona_horaria, tipo_persona, tipo_identificacion_id,
            numero_identificacion, nombre_fiscal, medico_invitado_email, telefono, email,
            estado_suscripcion)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'prueba')
         RETURNING id`,
        [
          nombreComercial,
          paisCodigo,
          zonaHoraria,
          tipoPersona,
          tipoIdentificacionId ?? null,
          numeroIdentificacion ?? null,
          nombreFiscal ?? nombreComercial,
          esMedico ? null : correoMedicoInvitado,
          telefono ?? null,
          email,
        ]
      );
      tenantId = tenantResult.rows[0].id;

      // PASO 4 — suscripción en prueba, sin cobrar nada. periodo_inicio/fin
      // define la ventana de prueba; credito_pactado_usd arranca en 0 y lo
      // completa otorgarCreditoPruebaSiCorresponde más abajo (o, si el
      // registrante no es médico, cuando el primer médico invitado
      // complete su alta — ver POST /admin/medicos).
      const suscripcionResult = await client.query(
        `INSERT INTO suscripciones
           (tenant_id, plan_id, periodicidad, precio_pactado_usd, credito_pactado_usd,
            agentes_contratados, medicos_contratados, estado, periodo_inicio, periodo_fin)
         VALUES ($1, $2, 'mensual', 0, 0, 1, $4, 'prueba', now(), now() + ($3 || ' days')::interval)
         RETURNING id`,
        [tenantId, planPrueba.id, duracionDias, medicosIncluidos]
      );
      const suscripcionId = suscripcionResult.rows[0].id;

      await client.query(`UPDATE tenants SET suscripcion_id = $1 WHERE id = $2`, [suscripcionId, tenantId]);

      await client.query(
        `INSERT INTO saldos_ia (tenant_id, credito_plan_usd, credito_comprado_usd, colchon_usado_usd)
         VALUES ($1, 0, 0, 0)`,
        [tenantId]
      );

      await client.query(
        `INSERT INTO config_recarga (tenant_id, autorecarga_activa) VALUES ($1, true)`,
        [tenantId]
      );

      await client.query(
        `INSERT INTO tenant_agentes (tenant_id, agente_id, estado, habilitado_en)
         VALUES ($1, $2, 'habilitado', now())`,
        [tenantId, agenteId]
      );

      // PASO 3 — rol del registrante.
      const personaResult = await client.query(
        `INSERT INTO personas
           (tenant_id, nombre, email, password_hash, es_admin_clinica, es_medico,
            colegiatura, universidad_egreso, anio_graduacion, estado)
         VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, 'activo')
         RETURNING id`,
        [
          tenantId,
          nombreTitular,
          email,
          passwordHash,
          !!esMedico,
          esMedico ? colegiatura : null,
          esMedico ? universidadEgreso ?? null : null,
          esMedico ? anioGraduacion ?? null : null,
        ]
      );
      personaId = personaResult.rows[0].id;

      // emailVerificado=false — a diferencia del resto de los usuarios que
      // este backend crea en Keycloak, el admin autorregistrado todavía no
      // probó que su correo es válido (prompt de verificación de correo).
      // Se sincroniza a true recién cuando confirma el enlace que le
      // mandamos por Resend, ver verificacionCorreo.ts.
      const keycloakUserId = await crearUsuarioKeycloak({
        email,
        nombreCompleto: nombreTitular,
        password,
        tenantId,
        rol: "ADMIN",
        emailVerificado: false,
      });
      await client.query(`UPDATE personas SET keycloak_user_id = $1 WHERE id = $2`, [
        keycloakUserId,
        personaId,
      ]);

      // Capa 1/2 del prompt de verificación de correo — dispara el envío
      // dentro de la misma transacción que crea la persona, igual que la
      // invitación del primer médico un poco más abajo.
      await generarYEnviarVerificacion(client, personaId, tenantId, email, nombreComercial);

      // PASO 5 — el crédito de prueba NO se otorga todavía si nadie
      // colegiado está confirmado. Si el registrante es médico, ya lo
      // está: se otorga en el mismo alta (dentro de esta misma
      // transacción, para no dejar una ventana donde credito_prueba_otorgado_en
      // esté seteado sin el movimiento correspondiente). Si no, se crea la
      // invitación real del primer médico acá mismo (Pantallas faltantes,
      // Prompt A) — antes esto solo mandaba un correo informativo sin
      // enlace real; ahora reutiliza el mismo camino que "Invitar médico"
      // desde el panel, con el cupo siempre disponible en este punto
      // (tenant recién creado, cero médicos).
      //
      // Único caso de asignación automática de medico_agente (prompt
      // agentes/países, Paso 4): el registrante-médico es el único
      // médico que existe en este momento, así que se le asigna el
      // agente que acaba de elegir para la prueba — sin esto entraría a
      // su área de trabajo y la vería vacía. Cualquier médico que se dé
      // de alta de ahí en adelante (invitación) lo decide el
      // administrador, ver medicoAgente.ts.
      if (esMedico) {
        await asignarAgenteAlRegistrante(client, personaId, agenteId);
        await otorgarCreditoPruebaSiCorresponde(client, tenantId);
      } else if (correoMedicoInvitado) {
        await crearInvitacion(client, tenantId, nombreComercial, personaId, correoMedicoInvitado);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(
        `POST /registro-publico: falló el alta en base de datos (posiblemente quedó huérfano un usuario de Keycloak)`,
        err
      );
      throw err;
    } finally {
      client.release();
    }

    // Auto-login: no hay pago que confirmar, la cuenta ya está activa
    // (en prueba) apenas termina el COMMIT.
    try {
      const tokens = await obtenerTokenParaUsuario(email, password);
      return res.status(201).json({
        autoLogin: true,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_in: tokens.expires_in,
        nombreClinica: nombreComercial,
      });
    } catch (err) {
      console.error(
        `POST /registro-publico: la clínica ${tenantId} se creó correctamente pero falló el auto-login posterior`,
        err
      );
      return res.status(201).json({ autoLogin: false });
    }
  } catch (err: any) {
    if (err instanceof KeycloakUsuarioExistenteError) {
      return res.status(409).json({ error: "Ya existe un usuario con ese email." });
    }
    if (err?.code === "23505" && err?.constraint === "colegiatura_admin_unica") {
      return res.status(409).json({
        error: "Ese número de colegiatura ya está registrado como administrador de otra clínica.",
      });
    }
    if (err?.code === "23505") {
      return res.status(409).json({ error: "Ya existe un usuario con ese email." });
    }
    console.error("POST /registro-publico", err);
    res.status(500).json({ error: "Error al registrar la clínica." });
  }
});
