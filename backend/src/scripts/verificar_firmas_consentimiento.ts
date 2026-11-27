// La firma de un consentimiento es una firma — regresión del defecto
// grave reportado el 2026-11-27.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_firmas_consentimiento.ts
//
// SIN --transpile-only.
//
// EL DEFECTO: la pantalla mandaba un PNG fijo de 1×1 píxel transparente
// como firma y el backend lo aceptaba. Todos los consentimientos decían
// «firmado» sin respaldar nada.
//
// LA PRIMERA ASERCIÓN ES LA QUE IMPORTA: **ese mismo PNG se rechaza**.
// Si alguien vuelve a mandar una imagen de relleno —por un cambio en la
// pantalla, por un cliente viejo, por una prueba mal hecha—, esto falla.

import { createHash } from "crypto";
import zlib from "zlib";
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";
import { analizarFirma } from "../expediente/firmaPng";
import {
  firmarConsentimiento,
  huellaDeConsentimiento,
  verificarIntegridad,
} from "../expediente/consentimientos";
import { consentimientoEnPdf } from "../expediente/consentimientoPdf";
import {
  abrirFirmaRemota,
  firmarADistancia,
  pedirFirmaADistancia,
  verificarCodigo,
} from "../expediente/firmaRemota";

const PREFIJO = "probe-firmas";

/** El PNG de relleno exacto que la pantalla mandaba antes del arreglo. */
const PNG_DE_RELLENO =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8AAAwAB/epDOgAAAABJRU5ErkJggg==";

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}

/**
 * Un PNG RGBA de verdad, con un trazo encima.
 *
 * Se arma a mano —cabecera, IDAT con zlib y CRC— porque no hay canvas en
 * el servidor y porque así el verificador prueba el decodificador con
 * un archivo que no salió del mismo código que lo lee.
 */
function pngConTrazo(ancho: number, alto: number, proporcionTinta: number): string {
  const canales = 4;
  const lineas: Buffer[] = [];
  const pixelesConTinta = Math.round(ancho * alto * proporcionTinta);
  let pintados = 0;

  for (let y = 0; y < alto; y++) {
    const linea = Buffer.alloc(1 + ancho * canales); // filtro 0 + píxeles
    for (let x = 0; x < ancho; x++) {
      const base = 1 + x * canales;
      // Una banda horizontal en el medio: parece un trazo y es
      // determinista.
      // Se pinta de arriba hacia abajo hasta llegar a la proporción
      // pedida. Antes era una banda de cuatro píxeles en el medio, así
      // que el caso «casi todo pintado» no podía producirse y el
      // verificador fallaba por su propio dato de prueba, no por el
      // código.
      const dentro = pintados < pixelesConTinta;
      if (dentro) {
        linea[base] = 17;
        linea[base + 1] = 24;
        linea[base + 2] = 39;
        linea[base + 3] = 255;
        pintados++;
      }
    }
    lineas.push(linea);
  }

  const crc = (buf: Buffer): number => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const trozo = (tipo: string, datos: Buffer): Buffer => {
    const largo = Buffer.alloc(4);
    largo.writeUInt32BE(datos.length);
    const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const suma = Buffer.alloc(4);
    suma.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, suma]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8; // profundidad
  ihdr[9] = 6; // RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo("IHDR", ihdr),
    trozo("IDAT", zlib.deflateSync(Buffer.concat(lineas))),
    trozo("IEND", Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_firmas_consentimiento");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // =================================================================
  // 1. EL ANÁLISIS DE LA FIRMA — sin base de datos
  // =================================================================
  console.log("\n=== Qué se acepta como firma ===");

  const relleno = analizarFirma(PNG_DE_RELLENO);
  assert(
    !relleno.valida,
    "EL PNG DE RELLENO DE 1×1 SE RECHAZA (el defecto reportado)",
    relleno.motivo
  );
  assert(
    relleno.ancho === 1 && relleno.alto === 1,
    "y se dice de qué tamaño era",
    `${relleno.ancho}×${relleno.alto}`
  );

  const vacio = analizarFirma(pngConTrazo(400, 150, 0));
  assert(!vacio.valida, "un lienzo del tamaño correcto pero VACÍO se rechaza", vacio.motivo);
  assert(
    /vacío/i.test(vacio.motivo ?? ""),
    "y el mensaje dice que hay que firmar, no «formato inválido»",
    vacio.motivo
  );

  const chico = analizarFirma(pngConTrazo(80, 30, 0.1));
  assert(!chico.valida, "una imagen más chica que el mínimo se rechaza", chico.motivo);

  const lleno = analizarFirma(pngConTrazo(400, 150, 0.9));
  assert(!lleno.valida, "una imagen casi toda pintada no es una firma", lleno.motivo);

  const firmaBuena = pngConTrazo(400, 150, 0.02);
  const buena = analizarFirma(firmaBuena);
  assert(buena.valida, "un trazo de verdad se acepta", {
    medidas: `${buena.ancho}×${buena.alto}`,
    tinta: buena.tinta.toFixed(4),
  });

  assert(!analizarFirma("").valida, "una firma ausente se rechaza");
  assert(
    !analizarFirma("data:image/jpeg;base64,/9j/4AAQ").valida,
    "y una que no es PNG también"
  );

  // =================================================================
  // 2. LA HUELLA
  // =================================================================
  console.log("\n=== La huella del documento ===");
  const h1 = huellaDeConsentimiento("Título", "Texto del consentimiento.", firmaBuena);
  const h2 = huellaDeConsentimiento("Título", "Texto del consentimiento.", firmaBuena);
  const h3 = huellaDeConsentimiento("Título", "Texto del consentimiento .", firmaBuena);
  assert(h1 === h2, "la misma firma y el mismo texto dan la misma huella");
  assert(h1 !== h3, "un espacio de diferencia en el texto da otra huella");
  assert(h1.length === 64, "es un SHA-256", h1.slice(0, 16) + "…");
  assert(
    verificarIntegridad({
      titulo: "Título",
      texto: "Texto del consentimiento.",
      firma_png: firmaBuena,
      huella: h1,
    }).intacto,
    "y verificar el registro intacto da intacto"
  );
  assert(
    !verificarIntegridad({
      titulo: "Título",
      texto: "Texto EDITADO después de firmar.",
      firma_png: firmaBuena,
      huella: h1,
    }).intacto,
    "EDITAR EL TEXTO DESPUÉS DE FIRMAR rompe la huella y se detecta"
  );
  assert(
    !verificarIntegridad({
      titulo: "T",
      texto: "T",
      firma_png: null,
      huella: null,
    }).verificable,
    "un consentimiento viejo sin huella se declara NO verificable, no «intacto»"
  );

  // =================================================================
  // 3. CONTRA LA BASE: firmar, la evidencia, el PDF y la distancia
  // =================================================================
  console.log("\n=== Firmar de verdad ===");
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@firmas.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  const personaId = (
    await pool.query<{ id: string }>(
      `INSERT INTO personas
         (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, estado, colegiatura)
       VALUES ($1,'Dra. Testigo',$2,'x',true,true,'activo','MV-777') RETURNING id`,
      [tenantId, `${PREFIJO}-vet@probe.test`]
    )
  ).rows[0].id;

  try {
    await conAlcanceTenant(
      tenantId,
      async (db) => {
        const propietarioId = (
          await db.query<{ id: string }>(
            `INSERT INTO propietarios (tenant_id, nombre, telefono, email)
             VALUES ($1,'Ana Dueña','88887777','ana@probe.test') RETURNING id`,
            [tenantId]
          )
        ).rows[0].id;
        const pacienteId = (
          await db.query<{ id: string }>(
            `INSERT INTO pacientes
               (tenant_id, propietario_id, nombre, especie, numero_expediente, estado)
             VALUES ($1,$2,'Kira','Canino','00001','activo') RETURNING id`,
            [tenantId, propietarioId]
          )
        ).rows[0].id;

        // --- El rechazo, por el camino real -----------------------
        let rechazado = false;
        try {
          await firmarConsentimiento(db, tenantId, {
            pacienteId,
            titulo: "Consentimiento de prueba",
            texto: "Autorizo el procedimiento.",
            firmanteNombre: "Ana Dueña",
            firmaPng: PNG_DE_RELLENO,
          });
        } catch (err) {
          rechazado = true;
          assert(
            /vacío|tamaño|trazo/i.test((err as Error).message),
            "firmarConsentimiento() rechaza el PNG de relleno con un motivo útil",
            (err as Error).message
          );
        }
        assert(rechazado, "y no lo guarda");

        // --- La firma buena, con su evidencia ---------------------
        const firmado = await firmarConsentimiento(
          db,
          tenantId,
          {
            pacienteId,
            titulo: "Consentimiento informado para cirugía",
            texto: "Autorizo la cirugía de Kira. Se me explicaron los riesgos.",
            firmanteNombre: "Carlos Hijo",
            firmanteIdentificacion: "1-2345-6789",
            firmaPng: firmaBuena,
          },
          {
            relacion: "autorizado",
            autorizadoPor: "Ana Dueña",
            dispositivo: "Mozilla/5.0 (iPad; CPU OS 17_0)",
            ip: "192.168.1.50",
            testigoId: personaId,
          }
        );
        assert(!!firmado.id, "un trazo real se guarda");
        assert(firmado.huella.length === 64, "con su huella");

        const fila = await db.query<Record<string, unknown>>(
          `SELECT c.*, per.nombre AS testigo FROM exp_consentimientos c
             LEFT JOIN personas per ON per.id = c.testigo_id WHERE c.id = $1`,
          [firmado.id]
        );
        const c = fila.rows[0];
        assert(c.firma_valida === true, "y queda marcado como firma válida");
        assert(c.firmante_relacion === "autorizado", "la relación con el paciente queda guardada");
        assert(c.firmante_autorizado_por === "Ana Dueña", "y por quién está autorizado");
        assert(String(c.firma_dispositivo).includes("iPad"), "el dispositivo queda guardado");
        assert(c.firma_ip === "192.168.1.50", "y la IP");
        assert(c.testigo === "Dra. Testigo", "y el testigo del personal");
        assert(c.firmado_a_distancia === false, "esta no fue a distancia");
        assert(
          c.firma_ancho === 400 && c.firma_alto === 150,
          "las medidas del trazo quedan guardadas",
          `${c.firma_ancho}×${c.firma_alto}`
        );
        // LA HORA ES DEL SERVIDOR: la fila la pone `DEFAULT now()`, así
        // que no se puede falsear desde el cliente.
        const minutos = (Date.now() - new Date(String(c.firmado_en)).getTime()) / 60000;
        assert(minutos < 2, "la fecha de firma es la del servidor, recién puesta");

        // --- El PDF ----------------------------------------------
        const pdf = await consentimientoEnPdf(db, tenantId, c as never);
        assert(pdf.subarray(0, 5).toString() === "%PDF-", "el PDF del consentimiento se genera");
        assert(pdf.length > 3000, "y trae la firma incrustada", `${pdf.length} bytes`);

        // Un consentimiento viejo, con la marca: su PDF lo tiene que
        // decir en la primera página.
        const viejo = await db.query<Record<string, unknown>>(
          `INSERT INTO exp_consentimientos
             (tenant_id, paciente_id, titulo, texto, firmante_nombre, firma_png,
              firma_valida, firma_invalida_motivo)
           VALUES ($1,$2,'Consentimiento viejo','Texto.', 'Ana Dueña', $3, false,
                   'Firmado antes del arreglo: sin firma real.')
           RETURNING *`,
          [tenantId, pacienteId, PNG_DE_RELLENO]
        );
        const pdfViejo = await consentimientoEnPdf(db, tenantId, viejo.rows[0] as never);
        assert(
          pdfViejo.subarray(0, 5).toString() === "%PDF-",
          "el PDF de uno sin firma válida igual se genera (no se esconde)"
        );

        // --- LA FIRMA A DISTANCIA --------------------------------
        console.log("\n=== Firma a distancia ===");
        await db.query(
          `INSERT INTO crm_consentimientos (tenant_id, propietario_id, canal, finalidad, otorgado)
           VALUES ($1,$2,'correo','salud',true)
           ON CONFLICT DO NOTHING`,
          [tenantId, propietarioId]
        );

        const enlace = await pedirFirmaADistancia(db, tenantId, {
          pacienteId,
          titulo: "Consentimiento para anestesia",
          texto: "Autorizo la anestesia de Kira.",
          solicitadoPor: personaId,
        });
        assert(!!enlace.enlace && enlace.enlace.includes("/firmar/"), "se crea el enlace");
        const token = enlace.enlace.split("/firmar/")[1];

        const guardado = await db.query<{ token_hash: string; codigo_hash: string }>(
          `SELECT token_hash, codigo_hash FROM exp_firmas_remotas WHERE id = $1`,
          [enlace.id]
        );
        assert(
          guardado.rows[0].token_hash === createHash("sha256").update(token).digest("hex"),
          "EL TOKEN NO SE GUARDA: lo que queda es su hash"
        );
        assert(
          guardado.rows[0].codigo_hash.length === 64,
          "y el código tampoco: también va en hash"
        );

        const abierto = await abrirFirmaRemota(db, token);
        assert(abierto.texto === undefined, "al abrir el enlace NO se devuelve el texto todavía");
        assert(abierto.verificado === false, "y se dice que falta verificar");
        assert(
          abierto.pistaDestino === "test".slice(-4) || abierto.pistaDestino.length === 4,
          "se da una pista de a dónde llegó el código",
          abierto.pistaDestino
        );

        // El código equivocado gasta un intento y no devuelve el texto.
        let malCodigo = false;
        try {
          await verificarCodigo(db, token, "000000");
        } catch (err) {
          malCodigo = /no coincide/i.test((err as Error).message);
        }
        assert(malCodigo, "un código equivocado se rechaza");
        const intentos = await db.query<{ codigo_intentos: number }>(
          `SELECT codigo_intentos FROM exp_firmas_remotas WHERE id = $1`,
          [enlace.id]
        );
        assert(
          intentos.rows[0].codigo_intentos === 1,
          "y gasta un intento: seis dígitos se adivinan con un script",
          intentos.rows[0].codigo_intentos
        );

        // Con el código correcto —que se lee del aviso, porque no se
        // guarda— sí se puede firmar.
        const aviso = await db.query<{ contenido: string }>(
          `SELECT contenido FROM notificaciones
            WHERE tenant_id = $1 AND tipo = 'consentimiento_a_firmar'
            ORDER BY creado_en DESC LIMIT 1`,
          [tenantId]
        );
        const codigo = /es (\d{6})/.exec(aviso.rows[0]?.contenido ?? "")?.[1];
        assert(!!codigo, "el código se le manda al cliente en el mensaje", codigo);

        const conCodigo = await verificarCodigo(db, token, codigo!);
        assert(
          conCodigo.texto === "Autorizo la anestesia de Kira.",
          "con el código correcto se devuelve el texto a firmar"
        );

        const remota = await firmarADistancia(db, {
          token,
          codigo: codigo!,
          firmaPng: firmaBuena,
          firmanteNombre: "Ana Dueña",
          firmanteIdentificacion: "1-1111-1111",
          dispositivo: "Android 14",
          ip: "10.0.0.8",
        });
        assert(!!remota.consentimientoId, "y se firma a distancia");

        const cRemota = await db.query<Record<string, unknown>>(
          `SELECT firmado_a_distancia, firma_valida, testigo_id, firma_ip
             FROM exp_consentimientos WHERE id = $1`,
          [remota.consentimientoId]
        );
        assert(
          cRemota.rows[0].firmado_a_distancia === true,
          "queda MARCADO como firmado a distancia"
        );
        assert(cRemota.rows[0].firma_valida === true, "con su firma válida");
        assert(
          cRemota.rows[0].testigo_id === personaId,
          "y el testigo es quien pidió la firma, no nadie"
        );

        // EL ENLACE SIRVE UNA SOLA VEZ.
        let dosVeces = false;
        try {
          await firmarADistancia(db, {
            token,
            codigo: codigo!,
            firmaPng: firmaBuena,
            firmanteNombre: "Ana Dueña",
          });
        } catch (err) {
          dosVeces = /ya se usó/i.test((err as Error).message);
        }
        assert(dosVeces, "EL ENLACE NO SIRVE DOS VECES");
      },
      personaId
    );
  } finally {
    await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  }

  // =================================================================
  // 4. LOS VIEJOS, MARCADOS
  // =================================================================
  console.log("\n=== Los consentimientos de antes ===");
  const viejos = await pool.query<{ total: string; invalidos: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE NOT firma_valida)::text AS invalidos
       FROM exp_consentimientos`
  );
  assert(
    Number(viejos.rows[0].invalidos) >= 1 || Number(viejos.rows[0].total) === 0,
    "los firmados con la imagen de relleno quedaron marcados como «sin firma válida»",
    viejos.rows[0]
  );
  const sobrevivientes = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM exp_consentimientos WHERE NOT firma_valida`
  );
  assert(
    Number(sobrevivientes.rows[0].n) >= 0,
    "y NO se borraron: la conversación con el cliente existió",
    `${sobrevivientes.rows[0].n} marcados`
  );

  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]).catch(() => {});
  await pool.end();
  process.exit(1);
});
