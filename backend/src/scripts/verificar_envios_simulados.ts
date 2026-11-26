// En desarrollo NINGÚN mensaje sale por un proveedor real.
//
//   docker compose exec backend npx ts-node src/scripts/verificar_envios_simulados.ts
//
// POR QUÉ EXISTE ESTE VERIFICADOR. El job diario de notificaciones mandó
// dos avisos de la clínica de demostración —cumpleaños y desparasitación
// próxima— por **Resend real** desde el entorno de desarrollo. Quedó
// probado en `correos_enviados`: `resultado = 'enviado'` y un
// `proveedor_message_id` de Resend
// (`01a218b9-1aa6-7daa-b491-5a40ad7cc997`). El dominio del destinatario
// era `.invalid`, así que no llegó a ninguna persona, pero la salida
// hacia el proveedor existió y eso es lo que no puede volver a pasar.
//
// Lo que se verifica:
//
//   * el ambiente se reconoce como local;
//   * el proveedor elegido para el correo es el simulado;
//   * un correo enviado por el camino REAL de la aplicación
//     (`enviarCorreoTransaccional`) queda registrado como enviado y con
//     un identificador `sim-mail-…`, o sea que no salió;
//   * activar un proveedor de WhatsApp real se rechaza;
//   * con `ENVIOS_REALES=1` la puerta se abre, y sin eso no.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import {
  diagnosticarEntorno,
  enviosRealesHabilitados,
  esEntornoLocal,
} from "../entorno";
import { enviarEmail, proveedorDeCorreo, resendConfigurado } from "../email";
import { enviarCorreoTransaccional } from "../correos";
import { usarProveedorMensajeria } from "../crm/mensajeria";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-envios";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_envios_simulados");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // -------------------------------------------------------------------
  console.log("=== 1. El ambiente y la puerta ===");
  const diag = diagnosticarEntorno();
  assert(diag.local, "este ambiente se reconoce como LOCAL", diag.motivos);
  igual(
    enviosRealesHabilitados(),
    false,
    "y los envíos reales están cerrados (no hay ENVIOS_REALES=1)"
  );
  igual(proveedorDeCorreo(), "simulado", "el proveedor de correo elegido es el SIMULADO");
  assert(
    resendConfigurado(),
    "y el camino de envío sigue 'configurado': el flujo se puede verificar de punta a punta"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 2. Un envío directo no toca el proveedor real ===");
  const directo = await enviarEmail(
    "alguien@ejemplo.invalid",
    "Prueba de envío simulado",
    "Este correo no debería salir de la máquina."
  );
  assert(
    (directo.id ?? "").startsWith("sim-mail-"),
    "el identificador dice que fue simulado",
    directo.id
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. El camino real de la aplicación tampoco ===");
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@envios.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;

  const envio = await conAlcanceTenant(tenantId, (db) =>
    enviarCorreoTransaccional(db, tenantId, "destinatario@ejemplo.invalid", "cumpleanos", {
      nombrePropietario: "Persona de prueba",
      nombrePaciente: "Toby",
      especie: "Canino",
      nombreClinica: "Clínica de prueba",
      urlClinica: "http://localhost:5174",
    } as never)
  );
  igual(envio.resultado, "enviado", "el correo se registra como enviado");
  assert(
    (envio.proveedorMessageId ?? "").startsWith("sim-mail-"),
    "con un identificador SIMULADO: no salió de la máquina",
    envio.proveedorMessageId
  );

  const fila = await pool.query<{ resultado: string; proveedor_message_id: string }>(
    `SELECT resultado, proveedor_message_id FROM correos_enviados WHERE id = $1`,
    [envio.correoEnviadoId]
  );
  assert(
    fila.rows[0].proveedor_message_id.startsWith("sim-mail-"),
    "y en `correos_enviados` queda la prueba de que fue simulado",
    fila.rows[0]
  );

  // Que no haya UN SOLO correo con identificador de proveedor real
  // desde que esto corre. Es la aserción que de verdad cierra el
  // incidente: no mira una función, mira la tabla.
  const reales = await pool.query<{ n: string }>(
    `SELECT count(*) AS n FROM correos_enviados
      WHERE enviado_en > now() - interval '1 minute'
        AND proveedor_message_id IS NOT NULL
        AND proveedor_message_id NOT LIKE 'sim-%'`
  );
  igual(
    reales.rows[0].n,
    "0",
    "ningún correo del último minuto tiene identificador de proveedor real"
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. WhatsApp: el proveedor real se rechaza ===");
  try {
    usarProveedorMensajeria({
      nombre: "converza",
      async enviar() {
        return { entregado: true };
      },
    });
    assert(false, "activar un proveedor real de WhatsApp — NO falló, y tenía que fallar");
  } catch (err) {
    assert(true, "activar un proveedor real de WhatsApp — rechazado", (err as Error).message.slice(0, 110));
  }
  // El simulado sí se puede poner: es el que usan los verificadores.
  usarProveedorMensajeria({
    nombre: "simulado",
    async enviar() {
      return { entregado: true, proveedorMensajeId: "sim-wa-probe" };
    },
  });
  assert(true, "y el simulado se acepta sin problema");

  // -------------------------------------------------------------------
  console.log("\n=== 5. La bandera abre la puerta, y solo ella ===");
  const antes = process.env.ENVIOS_REALES;
  process.env.ENVIOS_REALES = "1";
  igual(enviosRealesHabilitados(), true, "con ENVIOS_REALES=1 la puerta se abre");
  igual(
    proveedorDeCorreo(),
    "resend",
    "y el proveedor pasa a ser Resend — por eso la bandera es un acto deliberado"
  );
  process.env.ENVIOS_REALES = antes;
  igual(enviosRealesHabilitados(), false, "sin la bandera, vuelve a cerrarse");
  igual(esEntornoLocal(), true, "y el ambiente sigue siendo local");

  // -------------------------------------------------------------------
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
