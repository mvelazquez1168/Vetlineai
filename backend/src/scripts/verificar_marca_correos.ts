// Arnés de verificación de prompt-code-correos-marca-del-cliente.md.
//
// NO toca ningún dato existente: crea sus propios tenants descartables,
// no sube ni borra ningún archivo del almacenamiento (reusa una clave de
// logo inventada, que nunca se lee: lo que se verifica es la URL que se
// arma, no el byte), y borra todo al final. No manda ningún correo real —
// se verifica el HTML y las cabeceras que se le pasarían al proveedor.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_marca_correos.ts
//
// Con --html <dir> además escribe cada plantilla renderizada a disco, en
// dos variantes (normal y con las imágenes quitadas) para revisarlas en
// un cliente de correo real.
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { almacenamientoPublico } from "../almacenamiento";
import { pool } from "../db";
import { config } from "../config";
import { DatosPlantilla, TipoCorreo, construirCorreo } from "../correos";
import { asuntoParaCabecera, componerRemitente, direccionValida, enviarEmail } from "../email";
import {
  LOGO_ALTO_MAX,
  LOGO_ANCHO_MAX,
  MarcaCorreo,
  TIPOS_MARCA_COMERCIO,
  escalarLogoDeEncabezado,
  marcaPlataforma,
  resolverMarca,
} from "../marcaCorreo";

// PNG mínimo con un IHDR real — es todo lo que lee dimensionesImagen().
// Sirve para probar proporciones extremas sin subir imágenes de verdad.
function pngDePrueba(ancho: number, alto: number): Buffer {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12);
  buffer.writeUInt32BE(ancho, 16);
  buffer.writeUInt32BE(alto, 20);
  return buffer;
}

let ok = 0;
let fallos = 0;

function afirmar(condicion: boolean, descripcion: string, detalle?: string): void {
  if (condicion) {
    ok++;
    console.log(`  [OK]    ${descripcion}`);
  } else {
    fallos++;
    console.log(`  [FALLA] ${descripcion}${detalle ? `\n          ${detalle}` : ""}`);
  }
}

// El bloque del encabezado — la primera celda de la tabla interna. Se
// mira aparte del resto porque el pie de un correo con marca de comercio
// SÍ nombra a la plataforma a propósito: buscar "Vetline Ai" en el HTML
// entero no distinguiría un caso del otro.
function bloqueEncabezado(html: string): string {
  const desde = html.indexOf("border-bottom:1px solid #e5e7eb");
  const hasta = html.indexOf("</td></tr>", desde);
  return desde >= 0 ? html.slice(desde, hasta) : "";
}

function sinImagenes(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (etiqueta) => {
    // Deja el texto alternativo visible, que es lo que muestra un cliente
    // de correo con las imágenes bloqueadas.
    const alt = etiqueta.match(/alt="([^"]*)"/i);
    return alt ? `[imagen bloqueada: ${alt[1]}]` : "[imagen bloqueada]";
  });
}

// Un ejemplar de cada uno de los 27 tipos, con datos de relleno. El
// objetivo no es el texto (ya verificado en otros arneses) sino que
// TODOS pasen por el layout nuevo sin romperse.
const MUESTRAS: { [K in TipoCorreo]: DatosPlantilla[K] } = {
  invitacion_medico: { nombreClinica: "Clínica Demo", enlace: "https://x/i", vigenciaDias: 7, nombreMedico: "Ana" },
  prueba_por_terminar: { diasRestantes: 3, enlacePlanes: "https://x/p" },
  prueba_terminada: { fechaEliminacion: "01/09/2026", enlaceExportar: "https://x/e", enlacePlanes: "https://x/p" },
  recordatorio_eliminacion: { fechaEliminacion: "01/09/2026", enlaceExportar: "https://x/e", enlacePlanes: "https://x/p" },
  verificacion_correo: { nombreClinica: "Clínica Demo", enlace: "https://x/v", vigenciaHoras: 72 },
  cuenta_no_operativa: { nombreClinica: "Clínica Demo", motivos: ["Sin médicos"], diasRestantes: 5, enlace: "https://x/c" },
  cobro_fallido: { montoUsd: 30, intentoNumero: 1, esUltimoIntento: false, proximoIntentoFecha: "05/09/2026", enlace: "https://x/m" },
  cuenta_suspendida: { montoUsd: 30, enlace: "https://x/m" },
  autorecarga_fallida: { montoUsd: 10, enlaceAutorecarga: "https://x/a", enlaceRecargarManual: "https://x/r" },
  tarjeta_por_vencer: { marca: "Visa", ultimos4: "4242", vencimiento: "09/2026", proximoCobroFecha: "05/09/2026", enlace: "https://x/m" },
  cuenta_suspendida_manual: { motivo: "Revisión", enlace: "mailto:soporte@vetlineai.com" },
  entrada_ventana_cierre: { fechaEliminacion: "01/09/2026", enlaceExportar: "https://x/e", enlacePlanes: "https://x/p" },
  recordatorio_cierre: { fechaEliminacion: "01/09/2026", enlaceExportar: "https://x/e", enlacePlanes: "https://x/p" },
  cuenta_bloqueada: { motivo: "Revisión", enlaceSoporte: "mailto:soporte@vetlineai.com" },
  restablecimiento_contrasena: { nombre: "Ana", enlace: "https://x/rc", vigenciaMinutos: 60 },
  contrasena_cambiada: { nombre: "Ana", fecha: "31/08/2026" },
  saldo_proveedor_bajo: { saldoUsd: 12.5, umbralUsd: 20 },
  recordatorio_cita: { nombrePaciente: "Toby", fecha: "01/09/2026", hora: "10:30", medicoNombre: "Dra. Ana" },
  confirmacion_cita: { nombrePaciente: "Toby", fecha: "01/09/2026", hora: "10:30", medicoNombre: "Dra. Ana" },
  cita_cancelada_o_reprogramada: { nombrePaciente: "Toby", fechaOriginal: "01/09/2026", horaOriginal: "10:30", reprogramada: true, fechaNueva: "03/09/2026", horaNueva: "11:00" },
  vacunacion_proxima: { nombrePaciente: "Toby", vacuna: "Antirrábica", fechaProxima: "10/09/2026" },
  desparasitacion_proxima: { nombrePaciente: "Toby", fechaProxima: "10/09/2026" },
  seguimiento_posterior_consulta: { nombrePaciente: "Toby" },
  informe_disponible: { nombrePaciente: "Toby" },
  cumpleanos: { nombrePaciente: "Toby" },
  seguimiento_faltante: { nombrePaciente: "Toby", estadoClinico: "en tratamiento" },
  agenda_dia_siguiente: { fecha: "01/09/2026", citas: [{ hora: "10:30", pacienteNombre: "Toby", motivoConsulta: "Control" }] },
};

const TODOS = Object.keys(MUESTRAS) as TipoCorreo[];

function render(tipo: TipoCorreo, marca: MarcaCorreo) {
  return construirCorreo(tipo, MUESTRAS[tipo] as never, marca);
}

async function main() {
  const dirHtml = process.argv.includes("--html")
    ? process.argv[process.argv.indexOf("--html") + 1]
    : null;
  if (dirHtml) fs.mkdirSync(dirHtml, { recursive: true });

  const creados: string[] = [];
  // Archivos propios, con clave propia, borrados en el finally. Es lo
  // único que este arnés escribe en el almacenamiento, y nunca toca una
  // clave existente.
  const clavesLogo: string[] = [];
  // Nombre con caracteres hostiles a propósito: comillas, ampersand y un
  // intento de inyección, para que el escapado y la limpieza de la
  // cabecera se prueben con el caso feo y no con "Clínica Demo".
  const NOMBRE_HOSTIL = 'Clínica "San Roque" & Cía <script>alert(1)</script>';

  async function subirLogoDePrueba(ancho: number, alto: number): Promise<string> {
    const clave = `logos/verificacion-marca-${crypto.randomUUID()}.png`;
    await almacenamientoPublico.guardar(clave, pngDePrueba(ancho, alto), "image/png");
    clavesLogo.push(clave);
    return clave;
  }

  try {
    // -----------------------------------------------------------------
    console.log("\n1. Clasificación de las 27 plantillas");
    // -----------------------------------------------------------------
    const esperadosComercio = [
      "recordatorio_cita", "confirmacion_cita", "cita_cancelada_o_reprogramada",
      "vacunacion_proxima", "desparasitacion_proxima", "seguimiento_posterior_consulta",
      "informe_disponible", "cumpleanos", "seguimiento_faltante", "agenda_dia_siguiente",
    ].sort();
    afirmar(TODOS.length === 27, `las 27 plantillas están cubiertas por el arnés (hay ${TODOS.length})`);
    afirmar(
      JSON.stringify([...TIPOS_MARCA_COMERCIO].sort()) === JSON.stringify(esperadosComercio),
      "los 10 tipos con marca de comercio son exactamente los clasificados",
      `actual: ${[...TIPOS_MARCA_COMERCIO].sort().join(", ")}`
    );
    afirmar(
      TODOS.filter((t) => !TIPOS_MARCA_COMERCIO.has(t)).length === 17,
      "los otros 17 quedan con marca de plataforma"
    );

    // -----------------------------------------------------------------
    console.log("\n2. Tenant descartable CON logo y CON correo de contacto");
    // -----------------------------------------------------------------
    const claveNormal = await subirLogoDePrueba(400, 100); // 4:1, un logo de clínica típico
    const conLogo = await pool.query(
      `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion, logo_url, email)
       VALUES ($1, 'es', 'CR', 'activa', $2, 'contacto@sanroque.example')
       RETURNING id`,
      [NOMBRE_HOSTIL, claveNormal]
    );
    creados.push(conLogo.rows[0].id);
    const marcaConLogo = await resolverMarca(pool, "recordatorio_cita", conLogo.rows[0].id);

    afirmar(marcaConLogo.esComercio, "un tipo de comercio resuelve marca de comercio");
    afirmar(marcaConLogo.nombre === NOMBRE_HOSTIL, "el nombre del encabezado es el del tenant");
    afirmar(
      !!marcaConLogo.logoUrl && /^https?:\/\//i.test(marcaConLogo.logoUrl),
      "la URL del logo es absoluta (un cliente de correo no puede resolver una relativa)",
      `logoUrl=${marcaConLogo.logoUrl}`
    );
    afirmar(
      marcaConLogo.replyTo === "contacto@sanroque.example",
      "el Reply-To sale del correo de contacto de la clínica"
    );

    const htmlComercio = render("recordatorio_cita", marcaConLogo).html;
    const encabezadoComercio = bloqueEncabezado(htmlComercio);
    afirmar(encabezadoComercio.includes("<img"), "con logo cargado, el encabezado lleva la imagen");
    afirmar(
      !encabezadoComercio.includes("Vetline Ai"),
      "el encabezado de un correo al tutor NO nombra a la plataforma"
    );
    afirmar(
      htmlComercio.includes("a través de Vetline Ai"),
      "el pie identifica a la plataforma"
    );
    afirmar(
      /font-size:11px/.test(htmlComercio.slice(htmlComercio.indexOf("a través de Vetline Ai") - 200)),
      "el pie es discreto (texto chico, sin logo)"
    );

    // Escapado: el nombre hostil no puede salir crudo al HTML.
    afirmar(
      !htmlComercio.includes("<script>"),
      "el nombre del tenant se escapa antes de entrar al HTML"
    );
    afirmar(
      htmlComercio.includes("&lt;script&gt;") && htmlComercio.includes("&amp;"),
      "los caracteres especiales del nombre quedan escapados, no borrados"
    );

    // -----------------------------------------------------------------
    console.log("\n3. Imágenes bloqueadas");
    // -----------------------------------------------------------------
    const bloqueado = sinImagenes(htmlComercio);
    const altHeader = encabezadoComercio.match(/alt="([^"]*)"/);
    afirmar(!!altHeader, "el logo del encabezado tiene texto alternativo");
    afirmar(
      bloqueado.includes("San Roque"),
      "con las imágenes bloqueadas, el nombre de la clínica sigue visible en el encabezado"
    );
    afirmar(
      /font-size:18px;font-weight:bold/.test(encabezadoComercio),
      "el texto alternativo está estilado como título, no como etiqueta rota"
    );

    // -----------------------------------------------------------------
    console.log("\n4. Nada de datos personales en la dirección de la imagen");
    // -----------------------------------------------------------------
    const DESTINATARIO = "tutor@ejemplo.com";
    const urlsDeImagen = [...htmlComercio.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
    afirmar(urlsDeImagen.length > 0, "hay al menos una imagen que revisar");
    afirmar(
      urlsDeImagen.every((u) => !u.includes(DESTINATARIO) && !u.includes("tutor") && !u.includes("@")),
      "ninguna URL de imagen lleva el correo del destinatario",
      urlsDeImagen.join(" ")
    );
    afirmar(
      urlsDeImagen.every((u) => !u.includes(conLogo.rows[0].id)),
      "ninguna URL de imagen lleva el id del tenant ni del destinatario",
      urlsDeImagen.join(" ")
    );

    // -----------------------------------------------------------------
    console.log("\n5. Tenant descartable SIN logo y SIN correo de contacto");
    // -----------------------------------------------------------------
    const sinLogo = await pool.query(
      `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion)
       VALUES ('Veterinaria Sin Logo', 'es', 'CR', 'activa') RETURNING id`
    );
    creados.push(sinLogo.rows[0].id);
    const marcaSinLogo = await resolverMarca(pool, "cumpleanos", sinLogo.rows[0].id);

    afirmar(marcaSinLogo.logoUrl === null, "sin logo cargado, no se inventa ninguna URL");
    afirmar(marcaSinLogo.replyTo === null, "sin correo de contacto, no se manda Reply-To");

    const htmlSinLogo = render("cumpleanos", marcaSinLogo).html;
    const encabezadoSinLogo = bloqueEncabezado(htmlSinLogo);
    afirmar(!encabezadoSinLogo.includes("<img"), "sin logo, el encabezado no deja un ícono roto");
    afirmar(
      encabezadoSinLogo.includes("Veterinaria Sin Logo"),
      "sin logo, el encabezado muestra el nombre en texto"
    );
    afirmar(
      !htmlSinLogo.includes("#1e3a5f"),
      "sin color de marca no se cae en el azul de la plataforma, ni en el título ni en el botón"
    );

    // -----------------------------------------------------------------
    console.log("\n6. Correo de contacto inválido → sin Reply-To (nunca una cabecera rota)");
    // -----------------------------------------------------------------
    for (const [valor, etiqueta] of [
      ["no tengo", "texto libre"],
      ["ana@ejemplo.com\r\nBcc: espia@ejemplo.com", "con salto de línea (intento de inyección)"],
      ["ana@ejemplo", "sin dominio de primer nivel"],
      ["   ", "solo espacios"],
    ]) {
      await pool.query(`UPDATE tenants SET email = $1 WHERE id = $2`, [valor, sinLogo.rows[0].id]);
      const m = await resolverMarca(pool, "cumpleanos", sinLogo.rows[0].id);
      afirmar(m.replyTo === null, `correo de contacto ${etiqueta} → sin Reply-To`, `replyTo=${m.replyTo}`);
    }

    // -----------------------------------------------------------------
    console.log("\n7. Remitente: cambia el nombre visible, nunca el dominio");
    // -----------------------------------------------------------------
    const dominioConfigurado = config.resendFromEmail.match(/<([^>]+)>|(\S+@\S+)/);
    const direccion = (dominioConfigurado?.[1] ?? dominioConfigurado?.[2] ?? "").trim();
    const remitenteComercio = componerRemitente(NOMBRE_HOSTIL);

    afirmar(
      remitenteComercio.includes(`<${direccion}>`),
      "el dominio del remitente es exactamente el configurado (DKIM intacto)",
      `esperado <${direccion}>, obtenido ${remitenteComercio}`
    );
    afirmar(
      remitenteComercio.includes("San Roque"),
      "el nombre visible del remitente es el del comercio",
      remitenteComercio
    );
    afirmar(
      !/[\r\n]/.test(componerRemitente("Clínica\r\nBcc: espia@ejemplo.com")),
      "un nombre con salto de línea no inyecta cabeceras",
      JSON.stringify(componerRemitente("Clínica\r\nBcc: espia@ejemplo.com"))
    );
    afirmar(
      !componerRemitente('Clínica "X" <otro@dominio.com>').includes("otro@dominio.com>"),
      "un nombre con comillas o ángulos no agrega una segunda dirección",
      componerRemitente('Clínica "X" <otro@dominio.com>')
    );
    afirmar(
      componerRemitente(null) === config.resendFromEmail,
      "los correos de plataforma conservan el remitente configurado, sin tocar"
    );

    // -----------------------------------------------------------------
    console.log("\n8. Las 27 plantillas renderizan, y solo las 10 llevan pie");
    // -----------------------------------------------------------------
    let conPie = 0;
    let conLogoPlataforma = 0;
    for (const tipo of TODOS) {
      const esComercio = TIPOS_MARCA_COMERCIO.has(tipo);
      const marca = esComercio ? marcaConLogo : marcaPlataforma();
      const { asunto, texto, html } = render(tipo, marca);

      if (!asunto || !texto || !html.includes("<!DOCTYPE html>")) {
        afirmar(false, `${tipo} renderiza asunto, texto y html`);
        continue;
      }
      const tienePie = html.includes("a través de Vetline Ai");
      if (tienePie !== esComercio) {
        afirmar(false, `${tipo}: el pie ${esComercio ? "falta" : "sobra"}`);
        continue;
      }
      if (tienePie) conPie++;
      if (!esComercio) {
        if (!bloqueEncabezado(html).includes("brand/logo-horizontal-claro")) {
          afirmar(false, `${tipo}: el encabezado de plataforma perdió el logo`);
          continue;
        }
        conLogoPlataforma++;
      }
      if (dirHtml) {
        fs.writeFileSync(path.join(dirHtml, `${esComercio ? "comercio" : "plataforma"}__${tipo}.html`), html);
        fs.writeFileSync(
          path.join(dirHtml, `${esComercio ? "comercio" : "plataforma"}__${tipo}__sin-imagenes.html`),
          sinImagenes(html)
        );
      }
    }
    afirmar(conPie === 10, `las 10 plantillas de comercio llevan pie (${conPie})`);
    afirmar(conLogoPlataforma === 17, `las 17 de plataforma conservan el logo de plataforma (${conLogoPlataforma})`);
    afirmar(
      !bloqueEncabezado(render("cobro_fallido", marcaPlataforma()).html).includes("background-color:#1e3a5f"),
      "el encabezado de plataforma ya no es la banda azul"
    );

    // -----------------------------------------------------------------
    console.log("\n9. El logo queda acotado sea cual sea su proporción");
    // -----------------------------------------------------------------
    // Antes de los casos: que la caja misma entre en el encabezado. Sin
    // esto, comparar cada logo contra la caja sería una tautología —
    // pasaría igual con una caja de 900px. El ancho útil más chico es el
    // de un teléfono de 320: la tabla del cuerpo es width=480 con
    // max-width:100%, así que baja a 320, y el encabezado le descuenta
    // 32px de padding a cada lado.
    const UTIL_ESCRITORIO = 480 - 32 * 2;
    const UTIL_ANGOSTO = 320 - 32 * 2;
    afirmar(
      LOGO_ANCHO_MAX <= UTIL_ANGOSTO,
      `la caja (${LOGO_ANCHO_MAX}px) entra en el encabezado más angosto (${UTIL_ANGOSTO}px a 320 de viewport)`
    );
    afirmar(
      LOGO_ANCHO_MAX <= UTIL_ESCRITORIO,
      `y con margen en el de escritorio (${UTIL_ESCRITORIO}px)`
    );

    for (const [ancho, alto, etiqueta] of [
      [400, 100, "4:1, un logo típico"],
      [2400, 100, "24:1, una banda apaisada"],
      [100, 100, "1:1, cuadrado"],
      [100, 400, "1:4, vertical"],
      // Fuente más chica que la caja: el caso que la caja grande podría
      // ampliar y dejar borroso. Tiene que salir en sus propios píxeles.
      [90, 30, "90x30, más chico que la caja"],
    ] as [number, number, string][]) {
      const clave = await subirLogoDePrueba(ancho, alto);
      const t = await pool.query(
        `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion, logo_url)
         VALUES ('Proporción', 'es', 'CR', 'activa', $1) RETURNING id`,
        [clave]
      );
      creados.push(t.rows[0].id);
      const m = await resolverMarca(pool, "recordatorio_cita", t.rows[0].id);
      const tam = m.logoTamano!;

      afirmar(
        tam.width <= LOGO_ANCHO_MAX && tam.height <= LOGO_ALTO_MAX,
        `logo ${etiqueta} → cabe en la caja del encabezado (${tam.width}x${tam.height})`
      );
      afirmar(
        tam.width <= ancho && tam.height <= alto,
        `logo ${etiqueta} → no se amplía por encima de sus propios píxeles`,
        `fuente ${ancho}x${alto}, render ${tam.width}x${tam.height}`
      );
      // La proporción se compara contra el tamaño exacto antes de
      // redondear, no como un cociente: a 8px de alto, medio píxel de
      // redondeo son un 6% de "distorsión" que no existe. Lo que hay que
      // garantizar es que cada eje esté dentro del píxel de su valor
      // exacto — que es lo mejor que se puede hacer con enteros.
      const escala = Math.min(LOGO_ANCHO_MAX / ancho, LOGO_ALTO_MAX / alto, 1);
      afirmar(
        Math.abs(tam.width - ancho * escala) <= 1 && Math.abs(tam.height - alto * escala) <= 1,
        `logo ${etiqueta} → conserva la proporción, no se estira`,
        `exacto ${(ancho * escala).toFixed(1)}x${(alto * escala).toFixed(1)}, render ${tam.width}x${tam.height}`
      );
      const img = bloqueEncabezado(render("recordatorio_cita", m).html);
      afirmar(
        img.includes(`width="${tam.width}"`) && img.includes(`height="${tam.height}"`),
        `logo ${etiqueta} → lleva ancho Y alto como atributos (Outlook ignora max-width)`
      );
    }

    // -----------------------------------------------------------------
    console.log("\n10. Logo ilegible → nombre en texto, nunca una imagen rota");
    // -----------------------------------------------------------------
    const tSinArchivo = await pool.query(
      `INSERT INTO tenants (nombre, idioma, pais_codigo, estado_suscripcion, logo_url)
       VALUES ('Clínica Sin Archivo', 'es', 'CR', 'activa', 'logos/00000000-0000-4000-8000-0000000000aa.png')
       RETURNING id`
    );
    creados.push(tSinArchivo.rows[0].id);
    const marcaRota = await resolverMarca(pool, "recordatorio_cita", tSinArchivo.rows[0].id);
    afirmar(marcaRota.logoUrl === null && marcaRota.logoTamano === null, "un logo sin archivo detrás no se referencia");
    afirmar(
      bloqueEncabezado(render("recordatorio_cita", marcaRota).html).includes("Clínica Sin Archivo"),
      "y el encabezado cae en el nombre en texto"
    );

    // -----------------------------------------------------------------
    console.log("\n11. Inyección de cabecera — TODO lo que un usuario escribe");
    // -----------------------------------------------------------------
    // El nombre del paciente lo carga la clínica y va al asunto de 8 de
    // las 10 plantillas de comercio.
    const asuntoConPaciente = render("recordatorio_cita", marcaConLogo).asunto;
    afirmar(asuntoConPaciente.includes("Toby"), "el asunto interpola el nombre del paciente (superficie a proteger)");
    const asuntoInyectado = asuntoParaCabecera("Recordatorio — Toby\r\nBcc: espia@ejemplo.com");
    afirmar(
      !/[\r\n]/.test(asuntoInyectado),
      "un nombre de paciente con salto de línea no parte el asunto en dos cabeceras",
      JSON.stringify(asuntoInyectado)
    );
    afirmar(
      asuntoParaCabecera("Cita de \"Toby\" <el gato>") === 'Cita de "Toby" <el gato>',
      "un asunto legítimo con comillas o ángulos NO se mutila (a diferencia del nombre del remitente)"
    );

    // El correo del tutor lo carga la clínica y propietarios.routes.ts lo
    // guarda con solo .trim(), sin validar formato: puede llegar cualquier
    // cosa al campo `to`.
    for (const [valor, etiqueta] of [
      ["tutor@ejemplo.com\r\nBcc: espia@ejemplo.com", "salto de línea"],
      ["tutor@ejemplo.com, espia@ejemplo.com", "segunda dirección por coma"],
      ["tutor@ejemplo.com espia@ejemplo.com", "segunda dirección por espacio"],
      ["Tutor <tutor@ejemplo.com>", "con nombre y ángulos"],
      ["no es un correo", "texto libre"],
    ] as [string, string][]) {
      afirmar(direccionValida(valor) === null, `destinatario con ${etiqueta} → rechazado`);
      let rechazado = false;
      try {
        await enviarEmail(valor, "Asunto", "Cuerpo");
      } catch (err) {
        rechazado = (err as Error).name === "DireccionInvalidaError" || (err as Error).name === "ResendNoConfiguradoError";
      }
      afirmar(rechazado, `enviarEmail() no manda nada a un destinatario con ${etiqueta}`);
    }
    afirmar(direccionValida("tutor+aviso@ejemplo.com.ar") === "tutor+aviso@ejemplo.com.ar", "una dirección legítima con + y subdominio pasa");

    // -----------------------------------------------------------------
    console.log("\n12. Degradación: tenant ilegible o ausente → marca de plataforma");
    // -----------------------------------------------------------------
    const inexistente = await resolverMarca(pool, "recordatorio_cita", "00000000-0000-4000-8000-00000000dead");
    afirmar(!inexistente.esComercio, "tenant inexistente → marca de plataforma, no un encabezado vacío");
    const sinTenant = await resolverMarca(pool, "recordatorio_cita", null);
    afirmar(!sinTenant.esComercio, "sin tenant → marca de plataforma");
    const plataformaAunConTenant = await resolverMarca(pool, "cobro_fallido", conLogo.rows[0].id);
    afirmar(
      !plataformaAunConTenant.esComercio && plataformaAunConTenant.replyTo === null,
      "un correo de plataforma no toma la marca ni el Reply-To del tenant aunque haya tenant"
    );

    // Muestra para mirar con los ojos, no para afirmar nada: los tenants
    // descartables de arriba tienen una clave de logo inventada (a
    // propósito: este arnés no sube ni borra archivos), así que su <img>
    // apunta a un 404. Acá se rearma el mismo correo con una imagen que
    // sí existe, para poder ver el encabezado claro con el logo puesto.
    if (dirHtml) {
      const muestra: MarcaCorreo = {
        nombre: "Clínica San Roque",
        logoUrl: `${config.frontendUrl}/brand/logo-horizontal-claro@2x.png`,
        // El archivo es el nuestro, 194x100: se deja que lo escale la misma
        // función del encabezado en vez de copiar el resultado a mano, que
        // es lo que quedó desactualizado al agrandar la caja.
        logoTamano: escalarLogoDeEncabezado(194, 100),
        replyTo: "contacto@sanroque.example",
        esComercio: true,
      };
      for (const tipo of ["recordatorio_cita", "informe_disponible"] as TipoCorreo[]) {
        const html = render(tipo, muestra).html;
        fs.writeFileSync(path.join(dirHtml, `MUESTRA__${tipo}.html`), html);
        fs.writeFileSync(path.join(dirHtml, `MUESTRA__${tipo}__sin-imagenes.html`), sinImagenes(html));
      }
      console.log(`\n  HTML renderizado en ${dirHtml}`);
    }
  } finally {
    for (const id of creados) {
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    }
    for (const clave of clavesLogo) {
      await almacenamientoPublico.eliminar(clave).catch(() => {});
    }
    console.log(`\n  (${creados.length} tenants y ${clavesLogo.length} logos descartables borrados)`);
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
