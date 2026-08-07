import bcrypt from "bcrypt";
import "dotenv/config";
import { Pool } from "pg";
import { asignarNumeroExpediente } from "../expediente";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const DEV_PASSWORD = "DevPassword123!";

// NOTA: este script inserta filas en tablas con RLS activo (personas, casos,
// etc.) sin ejecutar `SET app.tenant_id`. Funciona porque se conecta con el
// mismo rol que es dueño de las tablas (el rol de DATABASE_URL en desarrollo
// suele ser el superusuario/owner), y Postgres no aplica RLS al dueño de la
// tabla salvo que se use FORCE ROW LEVEL SECURITY (no la usamos). Si en el
// futuro el rol de conexión cambia a uno restringido, este seed va a
// necesitar setear app.tenant_id igual que hace withTenantClient.

async function main() {
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);
  const credencialesCreadas: { rol: string; email: string }[] = [];

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // -----------------------------------------------------------------
    // Tenant
    // -----------------------------------------------------------------
    const planProfesionalResult = await client.query(
      `SELECT id FROM planes WHERE nombre = 'Profesional'`
    );
    const planProfesionalId = planProfesionalResult.rows[0]?.id ?? null;

    const tenantResult = await client.query(
      `INSERT INTO tenants
         (nombre, pais_codigo, ciudad, idioma, plan, telefono, email, direccion, zona_horaria,
          plan_id, estado_suscripcion)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'activa')
       RETURNING id`,
      [
        "Clínica Veterinaria San Martín",
        "AR",
        "Buenos Aires",
        "es",
        "profesional",
        "+54 11 4567-8901",
        "contacto@vetsanmartin.com.ar",
        "Av. Corrientes 1234, CABA",
        "America/Argentina/Buenos_Aires",
        planProfesionalId,
      ]
    );
    const tenantId = tenantResult.rows[0].id;

    // -----------------------------------------------------------------
    // Catálogo de agentes (global, no pertenece a un tenant)
    // -----------------------------------------------------------------
    const agentesCatalogo = [
      {
        nombre: "Medicina General / Triage",
        slug: "medicina-general-triage",
        descripcion: "Evaluación inicial, triaje clínico y diagnóstico diferencial general.",
        icono: "stethoscope",
        estado_catalogo: "disponible",
      },
      {
        nombre: "Gastroenterología",
        slug: "gastroenterologia",
        descripcion: "Diagnóstico especializado del tracto gastrointestinal y patologías comunes.",
        icono: "circle-x",
        estado_catalogo: "disponible",
      },
      {
        nombre: "Dermatología",
        slug: "dermatologia",
        descripcion: "Evaluación dermatológica y diagnóstico de patologías cutáneas y alergias.",
        icono: "sun",
        estado_catalogo: "disponible",
      },
      {
        nombre: "Cardiología",
        slug: "cardiologia",
        descripcion: "Evaluación cardiovascular y análisis de estudios cardíacos especializados.",
        icono: "heart",
        estado_catalogo: "proximamente",
      },
      {
        nombre: "Oncología",
        slug: "oncologia",
        descripcion: "Apoyo diagnóstico en evaluación oncológica veterinaria e interpretación de biopsias.",
        icono: "activity",
        estado_catalogo: "proximamente",
      },
    ];

    const agenteIds: Record<string, string> = {};
    for (const agente of agentesCatalogo) {
      const result = await client.query(
        `INSERT INTO agentes (nombre, slug, descripcion, icono, estado_catalogo)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [agente.nombre, agente.slug, agente.descripcion, agente.icono, agente.estado_catalogo]
      );
      agenteIds[agente.slug] = result.rows[0].id;
    }

    // Habilitar los primeros dos agentes para el tenant
    for (const slug of ["medicina-general-triage", "gastroenterologia"]) {
      await client.query(
        `INSERT INTO tenant_agentes (tenant_id, agente_id, estado)
         VALUES ($1, $2, 'habilitado')`,
        [tenantId, agenteIds[slug]]
      );
    }

    // -----------------------------------------------------------------
    // Personas: admin de clínica y médico
    // -----------------------------------------------------------------
    const adminResult = await client.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id`,
      [tenantId, "María López", "admin@sanmartin.com", passwordHash]
    );
    credencialesCreadas.push({ rol: "Admin de clínica", email: "admin@sanmartin.com" });

    const medicoResult = await client.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_admin_clinica, colegiatura)
       VALUES ($1, $2, $3, $4, false, $5)
       RETURNING id`,
      [tenantId, "Dr. Carlos García", "dr.garcia@sanmartin.com", passwordHash, "MV-2847"]
    );
    const medicoId = medicoResult.rows[0].id;
    credencialesCreadas.push({ rol: "Médico", email: "dr.garcia@sanmartin.com" });

    // Dr. García: dos especialidades — valida el caso multi-especialidad
    await client.query(
      `INSERT INTO medico_agente (persona_id, agente_id, rol) VALUES ($1, $2, 'general')`,
      [medicoId, agenteIds["medicina-general-triage"]]
    );
    await client.query(
      `INSERT INTO medico_agente (persona_id, agente_id, rol) VALUES ($1, $2, 'especialista')`,
      [medicoId, agenteIds["gastroenterologia"]]
    );

    // -----------------------------------------------------------------
    // Staff de plataforma
    // Tres roles sembrados a propósito (no solo super_admin): la Base de
    // Conocimiento requiere probar que 'soporte' recibe 403 y que
    // 'soporte_senior' sí puede operarla, sin depender de super_admin.
    // -----------------------------------------------------------------
    const staffSuperAdminResult = await client.query(
      `INSERT INTO staff_plataforma (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'super_admin') RETURNING id`,
      ["Admin VetPlatform", "admin@vetplatform.com", passwordHash]
    );
    const staffSuperAdminId = staffSuperAdminResult.rows[0].id;
    credencialesCreadas.push({ rol: "Staff de plataforma (super_admin)", email: "admin@vetplatform.com" });

    await client.query(
      `INSERT INTO staff_plataforma (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'soporte_senior')`,
      ["Soporte Senior VetPlatform", "soporte.senior@vetplatform.com", passwordHash]
    );
    credencialesCreadas.push({
      rol: "Staff de plataforma (soporte_senior)",
      email: "soporte.senior@vetplatform.com",
    });

    await client.query(
      `INSERT INTO staff_plataforma (nombre, email, password_hash, rol)
       VALUES ($1, $2, $3, 'soporte')`,
      ["Soporte VetPlatform", "soporte@vetplatform.com", passwordHash]
    );
    credencialesCreadas.push({ rol: "Staff de plataforma (soporte)", email: "soporte@vetplatform.com" });

    // -----------------------------------------------------------------
    // Documentos de la Base de Conocimiento (ejemplo)
    // -----------------------------------------------------------------
    await client.query(
      `INSERT INTO documentos_conocimiento (nombre, descripcion, tipo, agente_id, archivo_ref, cargado_por)
       VALUES ($1, $2, 'breed_intelligence', NULL, $3, $4)`,
      [
        "Perfil de razas caninas y felinas — predisposiciones generales",
        "Referencia compartida por todos los agentes: predisposición racial a patologías comunes.",
        "breed-intelligence-general.pdf",
        staffSuperAdminId,
      ]
    );
    await client.query(
      `INSERT INTO documentos_conocimiento (nombre, descripcion, tipo, agente_id, archivo_ref, cargado_por)
       VALUES ($1, $2, 'banderas_rojas', $3, $4, $5)`,
      [
        "Banderas rojas en cuadros gastrointestinales agudos",
        "Signos de alarma que ameritan derivación inmediata en casos de Gastroenterología.",
        agenteIds["gastroenterologia"],
        "banderas-rojas-gastroenterologia.pdf",
        staffSuperAdminId,
      ]
    );

    // -----------------------------------------------------------------
    // Propietarios y pacientes de ejemplo
    // -----------------------------------------------------------------
    const propietarios = [
      { nombre: "Familia Gómez", telefono: "+54 11 5555-0001" },
      { nombre: "Familia Rossi", telefono: "+54 11 5555-0002" },
      { nombre: "Familia Fernández", telefono: "+54 11 5555-0003" },
      { nombre: "Familia Torres", telefono: "+54 11 5555-0004" },
    ];
    const propietarioIds: string[] = [];
    for (const p of propietarios) {
      const result = await client.query(
        `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1, $2, $3) RETURNING id`,
        [tenantId, p.nombre, p.telefono]
      );
      propietarioIds.push(result.rows[0].id);
    }

    // razaEspecie usa la convención 'canina'/'felina' de la tabla razas,
    // distinta de pacientes.especie ('Canino'/'Felino') — ver el mismo
    // mapeo en pacientes.routes.ts.
    const pacientes = [
      { nombre: "Toby", especie: "Canino", razaEspecie: "canina", raza: "Caniche", sexo: "Macho", edad: 5, propietario: 0 },
      { nombre: "Luna", especie: "Felino", razaEspecie: "felina", raza: "Persa", sexo: "Hembra", edad: 3, propietario: 1 },
      { nombre: "Simba", especie: "Canino", razaEspecie: "canina", raza: "Golden Retriever", sexo: "Macho", edad: 4, propietario: 2 },
      { nombre: "Rocky", especie: "Canino", razaEspecie: "canina", raza: "Pastor Alemán", sexo: "Macho", edad: 6, propietario: 3 },
    ];
    const pacienteIds: Record<string, string> = {};
    for (const p of pacientes) {
      const razaResult = await client.query(
        `SELECT id FROM razas WHERE especie = $1 AND nombre = $2`,
        [p.razaEspecie, p.raza]
      );
      const result = await client.query(
        `INSERT INTO pacientes (tenant_id, propietario_id, nombre, especie, raza_id, sexo, edad_anios)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [tenantId, propietarioIds[p.propietario], p.nombre, p.especie, razaResult.rows[0]?.id ?? null, p.sexo, p.edad]
      );
      pacienteIds[p.nombre] = result.rows[0].id;
    }

    // -----------------------------------------------------------------
    // Casos de ejemplo (para ver el workspace poblado desde el día 1)
    // -----------------------------------------------------------------
    const numeroExpedienteToby = await asignarNumeroExpediente(client, tenantId);
    const casoTobyResult = await client.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, severidad, confianza_diagnostica, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, 'en_curso', 'investigacion_en_curso', 72, $6)
       RETURNING id`,
      [
        tenantId,
        pacienteIds["Toby"],
        agenteIds["medicina-general-triage"],
        medicoId,
        "Diarrea crónica intermitente de 2 semanas, sin pérdida de peso significativa.",
        numeroExpedienteToby,
      ]
    );
    const casoTobyId = casoTobyResult.rows[0].id;

    const mensajesToby = [
      {
        remitente: "medico",
        contenido:
          "Toby presenta diarrea intermitente desde hace 2 semanas. Sin pérdida de peso significativa. Apetito conservado.",
      },
      {
        remitente: "ai",
        contenido:
          "Entendido. Basándome en la presentación clínica, considero los siguientes diagnósticos diferenciales iniciales: 1. Enfermedad inflamatoria intestinal (IBD) — más probable dada la cronicidad. 2. Insuficiencia pancreática exocrina. 3. Disbiosis intestinal. ¿Tiene resultados de laboratorio recientes?",
      },
      {
        remitente: "medico",
        contenido: "Adjunto el hemograma y la ecografía abdominal.",
      },
      {
        remitente: "ai",
        contenido:
          "Gracias. He analizado los resultados. El hemograma muestra leucocitosis leve (14.200/µL) con eosinofilia moderada. La ecografía muestra engrosamiento de pared intestinal en yeyuno. Esto refuerza la sospecha de IBD. Recomiendo ecografía de seguimiento y test de cobalamina/folato sérico.",
      },
    ];
    for (const m of mensajesToby) {
      await client.query(
        `INSERT INTO mensajes (caso_id, remitente, contenido) VALUES ($1, $2, $3)`,
        [casoTobyId, m.remitente, m.contenido]
      );
    }

    await client.query(
      `INSERT INTO derivaciones (caso_id, especialidad_sugerida, prioridad, motivo)
       VALUES ($1, 'Gastroenterología', 'media', 'Se recomienda evaluación endoscópica especializada.')`,
      [casoTobyId]
    );

    const numeroExpedienteLuna = await asignarNumeroExpediente(client, tenantId);
    const casoLunaResult = await client.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, severidad, confianza_diagnostica, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, 'completado', 'estable', 88, $6)
       RETURNING id`,
      [
        tenantId,
        pacienteIds["Luna"],
        agenteIds["medicina-general-triage"],
        medicoId,
        "Prurito constante y lesiones cutáneas leves.",
        numeroExpedienteLuna,
      ]
    );
    await client.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido) VALUES ($1, 'medico', $2)`,
      [
        casoLunaResult.rows[0].id,
        "Luna presenta prurito constante hace 5 días, con lesiones cutáneas leves en el dorso.",
      ]
    );

    const numeroExpedienteSimba = await asignarNumeroExpediente(client, tenantId);
    const casoSimbaResult = await client.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, severidad, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, 'en_curso', 'en_observacion', $6)
       RETURNING id`,
      [
        tenantId,
        pacienteIds["Simba"],
        agenteIds["medicina-general-triage"],
        medicoId,
        "Cojera en miembro posterior derecho, persistente hace una semana.",
        numeroExpedienteSimba,
      ]
    );
    await client.query(
      `INSERT INTO mensajes (caso_id, remitente, contenido) VALUES ($1, 'medico', $2)`,
      [casoSimbaResult.rows[0].id, "Simba cojea del miembro posterior derecho desde hace una semana, sin antecedente traumático claro."]
    );

    const numeroExpedienteRocky = await asignarNumeroExpediente(client, tenantId);
    await client.query(
      `INSERT INTO casos (tenant_id, paciente_id, agente_id, medico_id, motivo, estado, severidad, numero_expediente)
       VALUES ($1, $2, $3, $4, $5, 'triage', 'en_observacion', $6)`,
      [
        tenantId,
        pacienteIds["Rocky"],
        agenteIds["medicina-general-triage"],
        medicoId,
        "Sospecha de otitis bacteriana severa bilateral.",
        numeroExpedienteRocky,
      ]
    );

    await client.query("COMMIT");

    console.log("\n✅ Seed completo.\n");
    console.log("Credenciales de desarrollo (todas comparten la misma contraseña):\n");
    console.table(
      credencialesCreadas.map((c) => ({
        Rol: c.rol,
        Email: c.email,
        Contraseña: DEV_PASSWORD,
      }))
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Error al ejecutar el seed, se hizo rollback:", err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
