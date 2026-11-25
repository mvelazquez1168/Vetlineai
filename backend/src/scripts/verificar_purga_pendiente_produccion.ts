// SOLO LECTURA. Clínicas en ventana de purga o con la purga trabada.
//
// Se corre ANTES de desplegar la migración 092, contra producción, para
// saber qué va a pasar cuando la purga deje de trabarse. Mismo criterio
// que `verificar_sexo_paciente_normalizable.ts`: una migración que cambia
// el comportamiento sobre datos reales se mira antes, no después.
//
// **NO ESCRIBE NADA.** No hay un solo INSERT, UPDATE ni DELETE en este
// archivo, y la conexión se abre en una transacción `READ ONLY` para que
// eso no dependa de que alguien lo lea: si una consulta intentara
// escribir, Postgres la rechaza.
//
// QUÉ MIRAR EN LA SALIDA. La migración 092 no borra nada por sí sola:
// destraba el `DELETE FROM tenants` que la purga ya intentaba hacer. Las
// clínicas que aparezcan en "YA VENCIDAS" son las que el job va a
// eliminar —de verdad y sin vuelta atrás— en su próxima corrida después
// del despliegue. Si alguna no debería eliminarse, hay que sacarla de la
// ventana de purga ANTES de desplegar.
//
//   npm run purga-pendiente
//
// NO hay variante `:prod` compilada, y es a propósito: `tsconfig.build.json`
// excluye `src/scripts`, así que un `node dist/scripts/...` sería un comando
// roto justo en el momento en que más importa que funcione. Se corre con
// ts-node, igual que la compuerta previa de la migración 089
// (`verificar_sexo_paciente_normalizable.ts`).
import { pool } from "../db";

interface FilaClinica {
  id: string;
  nombre: string;
  estado_suscripcion: string;
  estado_suscripcion_tabla: string | null;
  purga_programada_para: string | null;
  dias: string | null;
  purgado_en: string | null;
  medicos: string;
  pacientes: string;
  casos: string;
  mensajes: string;
  comprobantes: string;
  restablecimientos: string;
}

function fmt(f: FilaClinica): string {
  const cuando = f.purga_programada_para
    ? `${f.purga_programada_para.slice(0, 16).replace("T", " ")} (${Number(f.dias) >= 0 ? `en ${f.dias} días` : `VENCIDA hace ${-Number(f.dias)} días`})`
    : "sin fecha de purga";
  return [
    `  ${f.nombre}`,
    `    id: ${f.id}`,
    `    purga: ${cuando}`,
    `    estado: tenants=${f.estado_suscripcion} · suscripciones=${f.estado_suscripcion_tabla ?? "(sin suscripción)"}`,
    `    datos: ${f.medicos} médico(s), ${f.pacientes} paciente(s), ${f.casos} caso(s), ` +
      `${f.mensajes} mensaje(s), ${f.comprobantes} comprobante(s) fiscal(es), ` +
      `${f.restablecimientos} restablecimiento(s) de contraseña`,
  ].join("\n");
}

async function main() {
  const client = await pool.connect();
  try {
    // La transacción de solo lectura es la garantía real de que esto no
    // escribe, no el hecho de que las consultas "sean SELECT".
    await client.query("BEGIN TRANSACTION READ ONLY");

    // -----------------------------------------------------------------
    // 1. Las clínicas que la purga considera candidatas, con el MISMO
    //    criterio que `purga.ts::ejecutarPurgas`. Si acá el criterio
    //    fuera otro, el script mediría algo distinto de lo que va a
    //    pasar — que es el modo de falla más caro de un script así.
    // -----------------------------------------------------------------
    const candidatas = await client.query<FilaClinica>(
      `SELECT t.id, t.nombre, t.estado_suscripcion,
              s.estado AS estado_suscripcion_tabla,
              t.purga_programada_para::text AS purga_programada_para,
              EXTRACT(DAY FROM (t.purga_programada_para - now()))::text AS dias,
              t.purgado_en::text AS purgado_en,
              (SELECT count(*)::text FROM personas p WHERE p.tenant_id = t.id) AS medicos,
              (SELECT count(*)::text FROM pacientes pa WHERE pa.tenant_id = t.id) AS pacientes,
              (SELECT count(*)::text FROM casos c WHERE c.tenant_id = t.id) AS casos,
              (SELECT count(*)::text FROM mensajes m
                 JOIN casos c2 ON c2.id = m.caso_id WHERE c2.tenant_id = t.id) AS mensajes,
              (SELECT count(*)::text FROM fact_comprobantes fc WHERE fc.tenant_id = t.id) AS comprobantes,
              (SELECT count(*)::text FROM restablecimientos_contrasena r
                 JOIN personas p2 ON p2.id = r.persona_id WHERE p2.tenant_id = t.id) AS restablecimientos
         FROM tenants t
         LEFT JOIN suscripciones s ON s.id = t.suscripcion_id
        WHERE s.estado = 'ventana_purga'
          AND t.purga_programada_para IS NOT NULL
        ORDER BY t.purga_programada_para`
    );

    const vencidas = candidatas.rows.filter((f) => Number(f.dias) < 0);
    const futuras = candidatas.rows.filter((f) => Number(f.dias) >= 0);

    console.log("=".repeat(72));
    console.log("CLÍNICAS QUE LA PURGA VA A ELIMINAR EN SU PRÓXIMA CORRIDA");
    console.log("=".repeat(72));
    if (vencidas.length === 0) {
      console.log("  Ninguna. El despliegue de la migración 092 no elimina nada hoy.");
    } else {
      console.log(
        `  ${vencidas.length} clínica(s) con la fecha de purga ya vencida.\n` +
          `  Tras desplegar la 092, el job las va a ELIMINAR de forma definitiva.\n`
      );
      for (const f of vencidas) console.log(fmt(f) + "\n");
    }

    console.log("-".repeat(72));
    console.log("EN VENTANA DE PURGA, CON FECHA FUTURA");
    console.log("-".repeat(72));
    if (futuras.length === 0) console.log("  Ninguna.");
    else for (const f of futuras) console.log(fmt(f) + "\n");

    // -----------------------------------------------------------------
    // 2. Purgas que ya fallaron. `purgado_en` se llena recién al final,
    //    así que una clínica marcada para purgar, con fecha vencida y
    //    sin `purgado_en`, es una que el job intentó y no pudo — que es
    //    exactamente el síntoma de D-006.
    // -----------------------------------------------------------------
    console.log("-".repeat(72));
    console.log("SÍNTOMA DE D-006: VENCIDAS Y TODAVÍA PRESENTES");
    console.log("-".repeat(72));
    if (vencidas.length === 0) {
      console.log("  Ninguna: no hay evidencia de que la purga se haya trabado.");
    } else {
      // Que sigan existiendo Y tengan mensajes es la firma del defecto.
      const conMensajes = vencidas.filter((f) => Number(f.mensajes) > 0);
      console.log(
        `  ${vencidas.length} clínica(s) vencidas siguen en la base.\n` +
          `  ${conMensajes.length} de ellas tienen mensajes, que es lo que las trababa.`
      );
      if (conMensajes.length > 0) {
        console.log(
          "\n  Estas son las que la migración 092 destraba. Revisá arriba que\n" +
            "  todas DEBAN eliminarse antes de desplegar."
        );
      }
    }

    // -----------------------------------------------------------------
    // 3. El estado del esquema: ¿la 092 ya está aplicada?
    // -----------------------------------------------------------------
    const sinDiferir = await client.query<{ n: string; cuales: string | null }>(
      `WITH RECURSIVE cascada AS (
         SELECT 'tenants'::regclass AS tabla
         UNION
         SELECT con.conrelid FROM pg_constraint con
           JOIN cascada c ON c.tabla = con.confrelid
          WHERE con.contype = 'f' AND con.confdeltype = 'c'
       )
       SELECT count(*)::text AS n,
              string_agg(con.conrelid::regclass::text || '.' || con.conname, ', ') AS cuales
         FROM pg_constraint con
         JOIN pg_class cl ON cl.oid = con.conrelid
         JOIN pg_namespace ns ON ns.oid = cl.relnamespace
        WHERE con.contype = 'f' AND ns.nspname = 'public'
          AND con.confdeltype <> 'c' AND NOT con.condeferrable
          AND con.conrelid IN (SELECT tabla FROM cascada)
          AND con.confrelid IN (SELECT tabla FROM cascada)`
    );

    console.log("-".repeat(72));
    console.log("ESTADO DEL ESQUEMA");
    console.log("-".repeat(72));
    const pendientes = Number(sinDiferir.rows[0].n);
    if (pendientes === 0) {
      console.log("  La migración 092 YA está aplicada: no quedan FK sin diferir que traben la purga.");
    } else {
      console.log(
        `  La migración 092 NO está aplicada todavía: ${pendientes} FK sin diferir\n` +
          `  entre tablas que la purga borra. La purga se va a seguir trabando.`
      );
      console.log(`\n  ${sinDiferir.rows[0].cuales}`);
    }

    await client.query("COMMIT");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
