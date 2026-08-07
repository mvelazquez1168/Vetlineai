// Verificación real de envío — Prompt C (correos transaccionales), Paso 6.
// Corre contra el destinatario real pasado como argumento, con un
// tenant_id descartable (correos_enviados no tiene FK a tenants a
// propósito). No hace ROLLBACK — la fila en correos_enviados queda real,
// mismo criterio que el resto de los scripts de verificación de esta sesión.
//
//   docker exec vetplatform-backend-1 npx ts-node --transpile-only src/scripts/verificar_correos_transaccionales.ts destinatario@ejemplo.com
import { randomUUID } from "crypto";
import { pool } from "../db";
import { enviarCorreoTransaccional } from "../correos";

async function main() {
  const destinatario = process.argv[2];
  if (!destinatario) {
    console.error("Uso: verificar_correos_transaccionales.ts destinatario@ejemplo.com");
    process.exit(1);
  }

  const tenantId = randomUUID();
  const mañana = new Date();
  mañana.setDate(mañana.getDate() + 30);
  const fechaEliminacion = mañana.toISOString().slice(0, 10);

  const pruebas: { tipo: string; datos: any }[] = [
    {
      tipo: "invitacion_medico",
      datos: {
        nombreClinica: "Clínica QA Verificación",
        enlace: "https://vetlineai.com/invitacion/token-de-prueba",
        vigenciaDias: 7,
        nombreMedico: "Dra. Prueba",
      },
    },
    {
      tipo: "prueba_por_terminar",
      datos: { diasRestantes: 2, enlacePlanes: "https://vetlineai.com/admin/plan-consumo/cambiar-plan" },
    },
    {
      tipo: "prueba_terminada",
      datos: {
        fechaEliminacion,
        enlaceExportar: "https://vetlineai.com/admin/exportacion",
        enlacePlanes: "https://vetlineai.com/admin/plan-consumo/cambiar-plan",
      },
    },
    {
      tipo: "recordatorio_eliminacion",
      datos: {
        fechaEliminacion,
        enlaceExportar: "https://vetlineai.com/admin/exportacion",
        enlacePlanes: "https://vetlineai.com/admin/plan-consumo/cambiar-plan",
      },
    },
  ];

  for (const { tipo, datos } of pruebas) {
    console.log(`\nEnviando "${tipo}" a ${destinatario}…`);
    await enviarCorreoTransaccional(pool, tenantId, destinatario, tipo as any, datos);
  }

  const resultado = await pool.query(
    `SELECT tipo, destinatario, resultado, error, enviado_en
     FROM correos_enviados WHERE tenant_id = $1 ORDER BY enviado_en`,
    [tenantId]
  );
  console.log("\n=== Resultado registrado en correos_enviados ===");
  console.table(resultado.rows);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
