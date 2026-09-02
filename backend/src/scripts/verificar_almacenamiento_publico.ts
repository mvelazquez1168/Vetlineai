// Verificación del camino REAL del logo: el que corre con
// ALMACENAMIENTO_PROVEEDOR=s3, donde el objeto se sirve por URL directa
// del bucket y no por express.static. Contra MinIO local — no es S3 real,
// pero los tres comportamientos que distinguen a este camino del disco se
// reproducen igual:
//
//   1. la URL pública se arma desde S3_URL_PUBLICA_BASE;
//   2. el objeto se lee SIN autenticación (y el privado NO);
//   3. el tipo de contenido queda FIJADO al subir — no recalculado en
//      cada respuesta como hace express.static. Este es el que rompe el
//      encabezado en Outlook si se guardó genérico.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_almacenamiento_publico.ts
//
// Sube por el endpoint HTTP real (POST /api/admin/clinica/logo) sobre una
// clínica descartable, y borra todo al final.
//
// Nota sobre el host: S3_URL_PUBLICA_BASE apunta a localhost:9010, que es
// como se ve MinIO DESDE AFUERA de Docker (un navegador, un cliente de
// correo). Desde adentro de este contenedor ese host no resuelve, así que
// para bajar el objeto se reemplaza solo el host por el interno. Lo que se
// verifica —que no pide credenciales y con qué tipo responde— es una
// propiedad del objeto y del bucket, no del hostname por el que se llega.
// La URL tal como se embebe en el correo se comprueba aparte, con curl
// desde el host.
import crypto from "crypto";
import { almacenamientoPrivado, almacenamientoPublico } from "../almacenamiento";
import { config } from "../config";
import { pool } from "../db";
import { resolverMarca } from "../marcaCorreo";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4000";

let ok = 0;
let fallos = 0;

function afirmar(condicion: boolean, descripcion: string, detalle?: unknown): void {
  if (condicion) {
    ok++;
    console.log(`  [OK]    ${descripcion}`);
  } else {
    fallos++;
    console.log(`  [FALLA] ${descripcion}${detalle !== undefined ? `\n          ${JSON.stringify(detalle)}` : ""}`);
  }
}

// Sustituye el host externo por el interno de la red de Docker, sin tocar
// la ruta ni agregar nada más.
function alcanzableDesdeAca(url: string): string {
  return url.replace(config.s3UrlPublicaBase!, `${config.s3Endpoint}/${config.s3BucketPublico}`);
}

// PNG real de 400x100 (IHDR + IDAT mínimos válidos) para subir por el
// endpoint, que exige un PNG/JPG de verdad.
function pngReal(): Buffer {
  const ihdrDatos = Buffer.alloc(13);
  ihdrDatos.writeUInt32BE(400, 0);
  ihdrDatos.writeUInt32BE(100, 4);
  ihdrDatos[8] = 8; // bit depth
  ihdrDatos[9] = 0; // grayscale
  const chunk = (tipo: string, datos: Buffer) => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "ascii"), datos]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(cuerpo) >>> 0);
    return Buffer.concat([largo, cuerpo, crc]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdrDatos),
    chunk("IDAT", Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c;
}

async function main() {
  const sufijo = Date.now().toString().slice(-8);
  let tenantId: string | null = null;
  const clavesPropias: string[] = [];

  try {
    console.log("\n0. El entorno está en el camino de producción, no en el de disco");
    afirmar(config.almacenamientoProveedor === "s3", "ALMACENAMIENTO_PROVEEDOR = s3", config.almacenamientoProveedor);
    afirmar(!!config.s3UrlPublicaBase, "S3_URL_PUBLICA_BASE configurada", config.s3UrlPublicaBase);
    afirmar(
      config.s3BucketPrivado !== config.s3BucketPublico,
      "el bucket privado y el público son distintos",
      { privado: config.s3BucketPrivado, publico: config.s3BucketPublico }
    );

    // ---------------------------------------------------------------
    console.log("\n1. Subida por el endpoint HTTP real de la clínica");
    // ---------------------------------------------------------------
    const tipoId = await pool.query(
      `SELECT id FROM tipos_identificacion WHERE pais_codigo = 'CR' AND aplica_persona_fisica = true LIMIT 1`
    );
    const agente = await pool.query(`SELECT id FROM agentes LIMIT 1`);
    const respReg = await fetch(`${BASE_URL}/api/registro-publico`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paisCodigo: "CR",
        nombreComercial: `Clinica Almacen ${sufijo}`,
        tipoPersona: "fisica",
        tipoIdentificacionId: tipoId.rows[0].id,
        numeroIdentificacion: `1-${sufijo}-2222`,
        nombreFiscal: `Clinica Almacen ${sufijo}`,
        nombreTitular: "Dra. Almacen",
        email: `almacen+${sufijo}@ejemplo.com`,
        telefono: "88889999",
        password: "ClaveTest123!",
        esMedico: true,
        colegiatura: `COL-ALM-${sufijo}`,
        agenteId: agente.rows[0].id,
      }),
    });
    const dataReg = (await respReg.json()) as any;
    afirmar(respReg.status === 201, "clínica descartable creada", { status: respReg.status });
    if (respReg.status !== 201) throw new Error("no se pudo registrar");
    const token: string = dataReg.access_token;
    const me = await fetch(`${BASE_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
    tenantId = ((await me.json()) as any).auth.tenantId;

    const bytes = pngReal();
    const form = new FormData();
    form.append("logo", new Blob([bytes], { type: "image/png" }), "logo-clinica.png");
    const subida = await fetch(`${BASE_URL}/api/admin/clinica/logo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const datosSubida = (await subida.json()) as any;
    afirmar(subida.status === 200, "POST /admin/clinica/logo → 200", { status: subida.status, datosSubida });
    if (subida.status !== 200) throw new Error("no se pudo subir el logo");

    const filaLogo = await pool.query(`SELECT logo_url FROM tenants WHERE id = $1`, [tenantId]);
    const clave: string = filaLogo.rows[0].logo_url;
    clavesPropias.push(clave);
    afirmar(/^logos\/[0-9a-f-]{36}\.png$/.test(clave), "la clave guardada es logos/<uuid>.png", clave);

    // ---------------------------------------------------------------
    console.log("\n2. La dirección pública se arma desde el bucket");
    // ---------------------------------------------------------------
    const urlPublica = almacenamientoPublico.url(clave);
    afirmar(
      urlPublica.startsWith(config.s3UrlPublicaBase!),
      "la URL sale de S3_URL_PUBLICA_BASE, no del origen de la API",
      urlPublica
    );
    afirmar(!urlPublica.includes("/uploads/"), "y no conserva la ruta del disco local", urlPublica);
    afirmar(datosSubida.logoUrl === urlPublica, "la URL que devuelve el endpoint es la misma", datosSubida.logoUrl);

    // ---------------------------------------------------------------
    console.log("\n3. El objeto se lee SIN autenticación, y con el tipo correcto");
    // ---------------------------------------------------------------
    const respPublica = await fetch(alcanzableDesdeAca(urlPublica));
    afirmar(respPublica.status === 200, "GET anónimo al objeto público → 200", { status: respPublica.status });
    const tipo = respPublica.headers.get("content-type");
    afirmar(tipo === "image/png", "el tipo de contenido es image/png, NO binary/octet-stream", tipo);
    const descargado = Buffer.from(await respPublica.arrayBuffer());
    afirmar(descargado.equals(bytes), "los bytes son los mismos que se subieron");

    // ---------------------------------------------------------------
    console.log("\n4. El bucket privado NO es público (el reparto se sostiene)");
    // ---------------------------------------------------------------
    const clavePrivada = `verificacion/${crypto.randomUUID()}.txt`;
    await almacenamientoPrivado.guardar(clavePrivada, Buffer.from("secreto"), "text/plain");
    const urlPrivadaAdivinada = `${config.s3Endpoint}/${config.s3BucketPrivado}/${clavePrivada}`;
    const respPrivada = await fetch(urlPrivadaAdivinada);
    afirmar(
      respPrivada.status === 403 || respPrivada.status === 401,
      `un objeto del bucket privado NO se puede leer sin credenciales (${respPrivada.status})`,
      { status: respPrivada.status }
    );
    await almacenamientoPrivado.eliminar(clavePrivada);

    // ---------------------------------------------------------------
    console.log("\n5. Los logos ya migrados también quedaron con tipo correcto");
    // ---------------------------------------------------------------
    // Esta es la regresión concreta: migrar_archivos_a_almacenamiento
    // subía sin tipo, y en S3 eso queda congelado como
    // binary/octet-stream. Se revisan TODOS los logos de la base.
    const logos = await pool.query(
      `SELECT id, logo_url FROM tenants WHERE logo_url IS NOT NULL AND id <> $1`,
      [tenantId]
    );
    let genericos = 0;
    for (const fila of logos.rows) {
      const url = almacenamientoPublico.url(fila.logo_url.replace(/^\/uploads\//, ""));
      const r = await fetch(alcanzableDesdeAca(url), { method: "HEAD" });
      const t = r.headers.get("content-type");
      if (r.status === 200 && (!t || t.startsWith("binary/") || t === "application/octet-stream")) {
        genericos++;
        console.log(`          ${fila.id} → ${t}`);
      }
    }
    afirmar(genericos === 0, `ningún logo de la base quedó con tipo genérico (${logos.rows.length} revisados)`);

    // ---------------------------------------------------------------
    console.log("\n6. El encabezado del correo usa esa URL y mide el archivo");
    // ---------------------------------------------------------------
    const marca = await resolverMarca(pool, "recordatorio_cita", tenantId!);
    afirmar(marca.logoUrl === urlPublica, "la marca del correo apunta a la URL del bucket", marca.logoUrl);
    afirmar(
      marca.logoTamano?.width === 224 && marca.logoTamano?.height === 56,
      "y el logo 400x100 se escaló a 224x56 leyéndolo del bucket",
      marca.logoTamano
    );

    console.log(`\n  URL pública del logo de prueba (para curl desde el host):\n  ${urlPublica}`);
  } finally {
    for (const clave of clavesPropias) {
      await almacenamientoPublico.eliminar(clave).catch(() => {});
    }
    if (tenantId) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
      console.log("\n  (clínica y logo descartables borrados)");
    }
  }

  console.log(`\n=== ${ok} OK, ${fallos} fallas ===`);
  await pool.end();
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
