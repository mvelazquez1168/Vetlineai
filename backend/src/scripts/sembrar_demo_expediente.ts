// Siembra de DEMOSTRACIÓN del expediente clínico (prompt 07, bloque A):
// un paciente con historia completa.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/sembrar_demo_expediente.ts <tenantId>
//
// Deja un golden retriever con todo lo que el prompt pide ver en cada
// pestaña: visitas con su nota, vacunas y desparasitaciones con lote,
// laboratorio con DOS mediciones del mismo analito (para que la
// tendencia tenga de qué graficar) y un valor fuera de rango, un
// documento externo, una receta, grooming con un hallazgo sin atender,
// problemas, alergias y un consentimiento firmado.
//
// RE-CORRIBLE: se busca al paciente por su nombre antes de crearlo, y
// cada bloque mira si lo suyo ya está. Lo único que no se puede repetir
// son las atenciones cerradas —son registros médicos— y por eso el
// script las crea una sola vez.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  agregarAdenda,
  agregarProblema,
  cerrarYFirmarAtencion,
  registrarAlergia,
} from "../expediente/clinico";
import { cargarResultados, solicitarEstudio } from "../expediente/laboratorio";
import { registrarGrooming } from "../expediente/grooming";
import {
  firmarConsentimiento,
  prepararConsentimiento,
  sembrarPlantillasBase,
} from "../expediente/consentimientos";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const NOMBRE = "Toby";

async function main() {
  exigirEntornoDeDesarrollo("sembrar_demo_expediente");

  const tenantId = process.argv[2];
  if (!tenantId) {
    console.error("Uso: … sembrar_demo_expediente.ts <tenantId>");
    process.exit(1);
  }
  const t = await pool.query<{ nombre: string }>(`SELECT nombre FROM tenants WHERE id = $1`, [
    tenantId,
  ]);
  if (t.rows.length === 0) {
    console.error(`No existe la clínica ${tenantId}.`);
    process.exit(1);
  }
  console.log(`Clínica: ${t.rows[0].nombre}`);

  const cliente = (
    await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM propietarios WHERE tenant_id = $1 ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0];
  if (!cliente) {
    console.error("Esta clínica no tiene clientes: un paciente necesita su dueño.");
    process.exit(1);
  }

  const medico = (
    await pool.query<{ id: string; nombre: string }>(
      `SELECT id, nombre FROM personas WHERE tenant_id = $1 AND es_medico ORDER BY creado_en LIMIT 1`,
      [tenantId]
    )
  ).rows[0];

  // -------------------------------------------------------------------
  // El paciente
  // -------------------------------------------------------------------
  let paciente = (
    await pool.query<{ id: string }>(
      `SELECT id FROM pacientes WHERE tenant_id = $1 AND nombre = $2`,
      [tenantId, NOMBRE]
    )
  ).rows[0];

  if (paciente) {
    console.log(`${NOMBRE} ya existe: se completa lo que falte.`);
  } else {
    const raza = await pool.query<{ id: string }>(
      `SELECT id FROM razas WHERE especie = 'canina' AND nombre ILIKE '%golden%' LIMIT 1`
    );
    const numero = await pool.query<{ n: number }>(
      `SELECT COALESCE(max(numero_expediente), 0) + 1 AS n FROM pacientes WHERE tenant_id = $1`,
      [tenantId]
    );
    paciente = (
      await pool.query<{ id: string }>(
        `INSERT INTO pacientes (tenant_id, propietario_id, numero_expediente, nombre, especie, raza,
                                raza_id, sexo, estado_reproductivo, fecha_nacimiento,
                                microchip, color, alerta_manejo)
         VALUES ($1,$2,$3,$4,'Canino','Golden Retriever',$5,'macho','entero',
                 CURRENT_DATE - interval '5 years', '900111222333444', 'Dorado',
                 'Muerde cuando le cortan las uñas: sedación suave para grooming')
         RETURNING id`,
        [tenantId, cliente.id, numero.rows[0].n, NOMBRE, raza.rows[0]?.id ?? null]
      )
    ).rows[0];
    console.log(`${NOMBRE} creado (golden retriever de 5 años) — ${paciente.id}`);
  }

  const pacienteId = paciente.id;

  // -------------------------------------------------------------------
  // Dos visitas, una con adenda
  // -------------------------------------------------------------------
  const yaHayVisitas = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM atenciones WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );

  let primeraAtencion: string | null = null;
  if (yaHayVisitas > 0) {
    console.log("Ya tiene visitas registradas: no se agregan otras.");
    primeraAtencion = (
      await pool.query<{ id: string }>(
        `SELECT id FROM atenciones WHERE paciente_id = $1 ORDER BY creado_en LIMIT 1`,
        [pacienteId]
      )
    ).rows[0].id;
  } else {
    const visitas = [
      {
        dias: 120,
        motivo: "Vómito de dos días y poco apetito",
        nota:
          "Paciente alerta, mucosas rosadas. Abdomen sensible a la palpación craneal. Se indica " +
          "dieta blanda por 3 días y control en una semana. Se tomó muestra para química.",
        peso: 31.8,
        temp: 38.9,
      },
      {
        dias: 35,
        motivo: "Control y vacunación anual",
        nota:
          "Buena evolución del cuadro digestivo. Peso estable. Se aplica refuerzo anual y " +
          "desparasitación interna. Se recomienda control de peso en 6 meses.",
        peso: 32.4,
        temp: 38.4,
      },
    ];

    for (const v of visitas) {
      const cita = await pool.query<{ id: string }>(
        `INSERT INTO citas (tenant_id, paciente_id, medico_id, fecha, hora_inicio, hora_fin,
                            duracion_minutos, motivo_consulta, estado)
         VALUES ($1,$2,$3,CURRENT_DATE - $4::int,'09:00','09:30',30,$5,'completada') RETURNING id`,
        [tenantId, pacienteId, medico?.id ?? null, v.dias, v.motivo]
      );
      const a = await pool.query<{ id: string }>(
        `INSERT INTO atenciones (tenant_id, cita_id, paciente_id, medico_id, nota_medica, peso,
                                 temperatura, creado_en)
         VALUES ($1,$2,$3,$4,$5,$6,$7, now() - ($8::int || ' days')::interval) RETURNING id`,
        [tenantId, cita.rows[0].id, pacienteId, medico?.id ?? null, v.nota, v.peso, v.temp, v.dias]
      );
      if (medico) {
        await conAlcanceTenant(tenantId, (db) => cerrarYFirmarAtencion(db, a.rows[0].id, medico.id));
      }
      if (primeraAtencion === null) primeraAtencion = a.rows[0].id;
      console.log(`Visita de hace ${v.dias} días: ${v.motivo}`);
    }

    if (medico && primeraAtencion) {
      await conAlcanceTenant(tenantId, (db) =>
        agregarAdenda(db, tenantId, {
          atencionId: primeraAtencion!,
          motivo: "Resultado de laboratorio posterior a la consulta",
          texto:
            "La química mostró creatinina en 2,9 mg/dL (alta). Se cita control en 15 días y se " +
            "sugiere dieta renal si se mantiene.",
          personaId: medico.id,
        })
      );
      console.log("Adenda agregada a la primera visita (la nota original queda intacta).");
    }
  }

  // -------------------------------------------------------------------
  // Preventivos
  // -------------------------------------------------------------------
  const yaHayPreventivos = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM cuidados_preventivos WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayPreventivos === 0) {
    await pool.query(
      `INSERT INTO cuidados_preventivos (tenant_id, paciente_id, tipo, fecha_aplicacion,
                                         fecha_proxima_recomendada, registrado_por, vacuna, lote)
       VALUES ($1,$2,'vacunacion',CURRENT_DATE - 35, CURRENT_DATE + 330,$3,'Quíntuple canina',
               'L-2026-114')`,
      [tenantId, pacienteId, medico?.id ?? null]
    );
    // Una desparasitación VENCIDA a propósito: así la franja de alertas
    // tiene algo real que mostrar.
    await pool.query(
      `INSERT INTO cuidados_preventivos (tenant_id, paciente_id, tipo, fecha_aplicacion,
                                         fecha_proxima_recomendada, registrado_por,
                                         subtipo_desparasitacion, producto_desparasitacion)
       VALUES ($1,$2,'desparasitacion',CURRENT_DATE - 200, CURRENT_DATE - 20,$3,'interna',
               'Praziquantel + pirantel')`,
      [tenantId, pacienteId, medico?.id ?? null]
    );
    console.log("Vacuna al día y desparasitación VENCIDA (para ver la alerta).");
  }

  // -------------------------------------------------------------------
  // Problemas y alergias
  // -------------------------------------------------------------------
  const yaHayProblemas = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM exp_problemas WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayProblemas === 0) {
    await conAlcanceTenant(tenantId, async (db) => {
      await agregarProblema(db, tenantId, {
        pacienteId,
        descripcion: "Enfermedad renal crónica (estadio 1, en seguimiento)",
        estado: "cronico",
        atencionOrigenId: primeraAtencion ?? undefined,
        personaId: medico?.id,
      });
      await agregarProblema(db, tenantId, {
        pacienteId,
        descripcion: "Gastroenteritis aguda",
        estado: "activo",
        atencionOrigenId: primeraAtencion ?? undefined,
        personaId: medico?.id,
      });
      await registrarAlergia(db, tenantId, {
        pacienteId,
        sustancia: "Penicilina",
        grupo: "penicilinas",
        severidad: "grave",
        reaccion: "Edema facial a los 20 minutos",
        personaId: medico?.id,
      });
    });
    console.log("Dos problemas (uno crónico) y una alergia grave a penicilinas.");
  }

  // -------------------------------------------------------------------
  // Laboratorio: dos mediciones del mismo analito, una fuera de rango
  // -------------------------------------------------------------------
  const yaHayLab = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM exp_estudios_lab WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayLab === 0) {
    await conAlcanceTenant(tenantId, async (db) => {
      const e1 = await solicitarEstudio(db, tenantId, {
        pacienteId,
        tipoEstudio: "quimica",
        atencionId: primeraAtencion ?? undefined,
        personaId: medico?.id,
      });
      await cargarResultados(db, tenantId, e1.id, [
        { codigo: "CREA", analito: "Creatinina", valor: 2.9 },
        { codigo: "BUN", analito: "BUN", valor: 34 },
        { codigo: "ALT", analito: "ALT", valor: 56 },
        { codigo: "ALB", analito: "Albúmina", valor: 3.1 },
      ]);

      const e2 = await solicitarEstudio(db, tenantId, {
        pacienteId,
        tipoEstudio: "quimica",
        esExterno: true,
        laboratorio: "Laboratorio Veterinario Central",
        personaId: medico?.id,
      });
      await cargarResultados(db, tenantId, e2.id, [
        { codigo: "CREA", analito: "Creatinina", valor: 1.9 },
        { codigo: "BUN", analito: "BUN", valor: 25 },
      ]);

      const e3 = await solicitarEstudio(db, tenantId, {
        pacienteId,
        tipoEstudio: "hemograma",
        personaId: medico?.id,
      });
      await cargarResultados(db, tenantId, e3.id, [
        { codigo: "HTO", analito: "Hematocrito", valor: 44 },
        { codigo: "LEU", analito: "Leucocitos", valor: 19.4 },
        { codigo: "PLQ", analito: "Plaquetas", valor: 310 },
        { analito: "Hemoparásitos", valorTexto: "negativo" },
      ]);

      // Y uno pedido que todavía no tiene resultado: la orden abierta.
      await solicitarEstudio(db, tenantId, {
        pacienteId,
        tipoEstudio: "urianalisis",
        personaId: medico?.id,
        observaciones: "Para evaluar densidad urinaria con la creatinina alta.",
      });
    });
    console.log(
      "Tres estudios con resultados (creatinina 2,9 → 1,9: tendencia con un valor alto) y una orden abierta."
    );
  }

  // -------------------------------------------------------------------
  // Un documento externo
  // -------------------------------------------------------------------
  const yaHayDoc = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM archivos WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayDoc === 0) {
    await pool.query(
      `INSERT INTO archivos (nombre_archivo, tipo, url, paciente_id, tipo_documento, es_externo,
                             descripcion, fecha_documento)
       VALUES ('radiografia-abdomen-2026.pdf','application/pdf','/uploads/demo/radiografia.pdf',
               $1,'radiografia',true,
               'Radiografía abdominal tomada en otra clínica, traída por el cliente',
               CURRENT_DATE - 118)`,
      [pacienteId]
    );
    console.log("Un documento EXTERNO (radiografía de otra clínica).");
  }

  // -------------------------------------------------------------------
  // Grooming con un hallazgo sin atender
  // -------------------------------------------------------------------
  const yaHayGroom = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM exp_grooming WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayGroom === 0) {
    await conAlcanceTenant(tenantId, (db) =>
      registrarGrooming(db, tenantId, {
        pacienteId,
        tipoCorte: "Corte verano, sin rapar lomo",
        comportamiento: "nervioso",
        observaciones:
          "Se dejó bañar bien. No permitió el corte de uñas traseras; se hizo solo delanteras.",
        servicios: [
          { descripcion: "Baño medicado" },
          { descripcion: "Corte de pelo" },
          { descripcion: "Limpieza de oídos" },
        ],
        hallazgos: [
          {
            tipo: "bulto",
            descripcion: "Bulto firme de ~1 cm en el flanco derecho, no doloroso al tacto",
          },
        ],
      })
    );
    console.log("Grooming con un HALLAZGO sin atender (va a la franja de alertas).");
  }

  // -------------------------------------------------------------------
  // Un consentimiento firmado
  // -------------------------------------------------------------------
  const yaHayConsent = Number(
    (
      await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM exp_consentimientos WHERE paciente_id = $1`,
        [pacienteId]
      )
    ).rows[0].n
  );
  if (yaHayConsent === 0) {
    await conAlcanceTenant(tenantId, async (db) => {
      await sembrarPlantillasBase(db, tenantId);
      const pl = await db.query<{ id: string }>(
        `SELECT id FROM exp_plantillas_consentimiento
          WHERE tenant_id = $1 AND tipo = 'anestesia' LIMIT 1`,
        [tenantId]
      );
      const preparado = await prepararConsentimiento(db, tenantId, {
        plantillaId: pl.rows[0].id,
        pacienteId,
        procedimiento: "extracción del bulto del flanco derecho",
        medicoId: medico?.id,
      });
      await firmarConsentimiento(db, tenantId, {
        pacienteId,
        plantillaId: pl.rows[0].id,
        atencionId: primeraAtencion ?? undefined,
        titulo: preparado.titulo,
        texto: preparado.texto,
        firmanteNombre: cliente.nombre,
        firmanteIdentificacion: "112345678",
        firmaPng:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8AAAwAB/epDOgAAAABJRU5ErkJggg==",
        testigoId: medico?.id,
      });
    });
    console.log("Un consentimiento de anestesia FIRMADO, con el texto congelado.");
  }

  console.log("\nListo. Pantalla: Pacientes → Toby");
  console.log(`URL directa: /pacientes/${pacienteId}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
