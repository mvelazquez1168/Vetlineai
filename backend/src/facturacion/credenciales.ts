import { Pool, PoolClient } from "pg";
import { config } from "../config";
import { abrirLlaveP12, LlaveFirma } from "./firma";

// ---------------------------------------------------------------------
// Las credenciales de Hacienda de un emisor: guardarlas cifradas,
// leerlas para usarlas, y NUNCA devolverlas.
//
// Toda lectura y escritura de `fact_credenciales` pasa por acá. Es lo
// único que hace cumplible la regla del prompt —"nunca se devuelven por
// la API, nunca aparecen en logs ni en la bitácora"—: si cada ruta
// hiciera su propio SELECT, alcanzaría con que una se olvidara de
// excluir una columna.
//
// El cifrado lo hace Postgres con `pgp_sym_encrypt` (pgcrypto), no
// TypeScript. El motivo está en la migración 091: así el cifrado es el
// único camino de escritura, y un INSERT directo o un script de
// mantenimiento no puede guardar en claro sin que nada falle.
// ---------------------------------------------------------------------

type Ejecutor = Pool | PoolClient;

export type Ambiente = "pruebas" | "produccion";

/**
 * Lo único de una credencial que se puede publicar. Es el tipo que
 * devuelve la API, y está acá para que no haya forma de armar la
 * respuesta a mano con una columna de más.
 */
export interface CredencialPublica {
  ambiente: Ambiente;
  /** El usuario de la API NO es un secreto: hace falta para confirmar qué se cargó. */
  usuarioApi: string;
  llaveNombreArchivo: string | null;
  llaveVenceEn: string | null;
  /** Días que faltan para que venza la llave. Negativo si ya venció. */
  diasParaVencer: number | null;
  creadoEn: string;
  actualizadoEn: string;
}

/** Los secretos descifrados. Viven en memoria el tiempo de una operación. */
export interface CredencialDescifrada {
  ambiente: Ambiente;
  usuarioApi: string;
  passwordApi: string;
  llaveP12: Buffer;
  pinLlave: string;
}

function claveCifrado(): string {
  if (!config.feCrClaveCifrado) {
    throw new Error(
      "FE_CR_CLAVE_CIFRADO no está configurada. Sin esa clave no se pueden guardar ni leer las credenciales de Hacienda: el módulo de facturación no puede emitir."
    );
  }
  if (config.feCrClaveCifrado.length < 16) {
    // Una clave corta no es un detalle: es lo que protege la llave
    // criptográfica con la que se firman documentos fiscales.
    throw new Error(
      "FE_CR_CLAVE_CIFRADO es demasiado corta (menos de 16 caracteres). Es la clave que protege la llave de firma de cada clínica."
    );
  }
  return config.feCrClaveCifrado;
}

/**
 * Guarda (o reemplaza) las credenciales de un emisor para un ambiente.
 *
 * Valida la llave ANTES de guardarla: si el .p12 no abre con ese PIN, o
 * es RSA de 1024 bits, se rechaza acá. El alternativo sería guardarla y
 * descubrirlo al emitir la primera factura, cuando ya hay alguien
 * esperando en el mostrador.
 *
 * `llaveVenceEn` no se recibe: se lee del propio certificado. Pedirlo
 * sería tener el mismo dato en dos lugares, y el que importa —el del
 * certificado— no se puede equivocar.
 */
export async function guardarCredenciales(
  db: Ejecutor,
  datos: {
    tenantId: string;
    emisorId: string;
    ambiente: Ambiente;
    usuarioApi: string;
    passwordApi: string;
    llaveP12: Buffer;
    pinLlave: string;
    llaveNombreArchivo?: string;
  }
): Promise<{ publica: CredencialPublica; infoCertificado: LlaveFirma["info"] }> {
  const clave = claveCifrado();

  // Esto también sirve de validación de la pareja llave/PIN.
  const llave = await abrirLlaveP12(datos.llaveP12, datos.pinLlave);

  await db.query(
    `INSERT INTO fact_credenciales (
       tenant_id, emisor_id, ambiente, usuario_api,
       password_api_cifrada, llave_p12_cifrada, pin_llave_cifrado,
       llave_vence_en, llave_nombre_archivo
     ) VALUES (
       $1, $2, $3, $4,
       pgp_sym_encrypt($5, $8), pgp_sym_encrypt_bytea($6, $8), pgp_sym_encrypt($7, $8),
       $9, $10
     )
     ON CONFLICT (emisor_id, ambiente) DO UPDATE SET
       usuario_api = EXCLUDED.usuario_api,
       password_api_cifrada = EXCLUDED.password_api_cifrada,
       llave_p12_cifrada = EXCLUDED.llave_p12_cifrada,
       pin_llave_cifrado = EXCLUDED.pin_llave_cifrado,
       llave_vence_en = EXCLUDED.llave_vence_en,
       llave_nombre_archivo = EXCLUDED.llave_nombre_archivo,
       actualizado_en = now()`,
    [
      datos.tenantId,
      datos.emisorId,
      datos.ambiente,
      datos.usuarioApi,
      datos.passwordApi,
      datos.llaveP12,
      datos.pinLlave,
      clave,
      llave.info.validoHasta,
      datos.llaveNombreArchivo ?? null,
    ]
  );

  const publica = await leerCredencialPublica(db, datos.emisorId, datos.ambiente);
  if (!publica) {
    throw new Error("Las credenciales se guardaron pero no se pudieron volver a leer.");
  }
  return { publica, infoCertificado: llave.info };
}

/**
 * Lo publicable de las credenciales de un emisor. Esta consulta nombra
 * las columnas una por una y NUNCA usa `SELECT *`: con un asterisco,
 * agregar una columna cifrada en el futuro la expondría por la API sin
 * que nadie toque este archivo.
 */
export async function leerCredencialPublica(
  db: Ejecutor,
  emisorId: string,
  ambiente: Ambiente
): Promise<CredencialPublica | null> {
  const r = await db.query<{
    ambiente: Ambiente;
    usuario_api: string;
    llave_nombre_archivo: string | null;
    llave_vence_en: string | null;
    dias_para_vencer: string | null;
    creado_en: string;
    actualizado_en: string;
  }>(
    `SELECT ambiente, usuario_api, llave_nombre_archivo,
            to_char(llave_vence_en, 'YYYY-MM-DD') AS llave_vence_en,
            (llave_vence_en - CURRENT_DATE)::text AS dias_para_vencer,
            creado_en, actualizado_en
       FROM fact_credenciales
      WHERE emisor_id = $1 AND ambiente = $2`,
    [emisorId, ambiente]
  );
  const f = r.rows[0];
  if (!f) return null;
  return {
    ambiente: f.ambiente,
    usuarioApi: f.usuario_api,
    llaveNombreArchivo: f.llave_nombre_archivo,
    llaveVenceEn: f.llave_vence_en,
    diasParaVencer: f.dias_para_vencer === null ? null : Number(f.dias_para_vencer),
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
  };
}

/** Las dos credenciales de un emisor (pruebas y producción), solo lo publicable. */
export async function listarCredencialesPublicas(
  db: Ejecutor,
  emisorId: string
): Promise<CredencialPublica[]> {
  const ambientes: Ambiente[] = ["pruebas", "produccion"];
  const salida: CredencialPublica[] = [];
  for (const a of ambientes) {
    const c = await leerCredencialPublica(db, emisorId, a);
    if (c) salida.push(c);
  }
  return salida;
}

/**
 * Las credenciales DESCIFRADAS. Solo el motor de emisión y el de firma
 * las piden, y solo mientras emiten.
 *
 * El nombre dice lo que hace: `obtenerSecretos`. No es `getCredenciales`
 * ni `leerCredencial` — quien lo escriba en una ruta que devuelve algo al
 * cliente tiene que leer la palabra "secretos".
 */
export async function obtenerSecretos(
  db: Ejecutor,
  emisorId: string,
  ambiente: Ambiente
): Promise<CredencialDescifrada> {
  const clave = claveCifrado();
  const r = await db.query<{
    ambiente: Ambiente;
    usuario_api: string;
    password_api: string;
    llave_p12: Buffer;
    pin_llave: string;
  }>(
    `SELECT ambiente, usuario_api,
            pgp_sym_decrypt(password_api_cifrada, $3) AS password_api,
            pgp_sym_decrypt_bytea(llave_p12_cifrada, $3) AS llave_p12,
            pgp_sym_decrypt(pin_llave_cifrado, $3) AS pin_llave
       FROM fact_credenciales
      WHERE emisor_id = $1 AND ambiente = $2`,
    [emisorId, ambiente, clave]
  );
  const f = r.rows[0];
  if (!f) {
    throw new Error(
      `El emisor no tiene credenciales de Hacienda cargadas para el ambiente "${ambiente}". No se puede emitir hasta cargarlas.`
    );
  }
  return {
    ambiente: f.ambiente,
    usuarioApi: f.usuario_api,
    passwordApi: f.password_api,
    llaveP12: f.llave_p12,
    pinLlave: f.pin_llave,
  };
}

/** La llave lista para firmar, a partir de los secretos guardados. */
export async function obtenerLlaveFirma(
  db: Ejecutor,
  emisorId: string,
  ambiente: Ambiente
): Promise<LlaveFirma> {
  const secretos = await obtenerSecretos(db, emisorId, ambiente);
  return abrirLlaveP12(secretos.llaveP12, secretos.pinLlave);
}

export async function borrarCredenciales(
  db: Ejecutor,
  emisorId: string,
  ambiente: Ambiente
): Promise<boolean> {
  const r = await db.query(`DELETE FROM fact_credenciales WHERE emisor_id = $1 AND ambiente = $2`, [
    emisorId,
    ambiente,
  ]);
  return (r.rowCount ?? 0) > 0;
}

/**
 * Los emisores con una llave que vence pronto o ya venció.
 *
 * Recorre TODOS los tenants a propósito (lo llama un job), así que
 * recibe el pool admin. Devuelve solo datos publicables.
 */
export async function llavesPorVencer(
  db: Pool,
  diasAviso = 30
): Promise<Array<{ tenantId: string; emisorId: string; ambiente: Ambiente; venceEn: string; dias: number }>> {
  const r = await db.query<{
    tenant_id: string;
    emisor_id: string;
    ambiente: Ambiente;
    vence_en: string;
    dias: string;
  }>(
    `SELECT tenant_id, emisor_id, ambiente,
            to_char(llave_vence_en, 'YYYY-MM-DD') AS vence_en,
            (llave_vence_en - CURRENT_DATE)::text AS dias
       FROM fact_credenciales
      WHERE llave_vence_en IS NOT NULL
        AND llave_vence_en <= CURRENT_DATE + ($1 || ' days')::interval
      ORDER BY llave_vence_en ASC`,
    [String(diasAviso)]
  );
  return r.rows.map((f) => ({
    tenantId: f.tenant_id,
    emisorId: f.emisor_id,
    ambiente: f.ambiente,
    venceEn: f.vence_en,
    dias: Number(f.dias),
  }));
}
