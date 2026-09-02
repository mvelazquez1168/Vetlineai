// Tanda real por Resend para revisar las plantillas en un cliente de
// correo de verdad (Outlook es donde se rompe lo que en el navegador se
// ve bien). Complementa a verificar_marca_correos.ts, que verifica la
// lógica pero no puede decir nada sobre cómo lo renderiza Word.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/enviar_tanda_marca_correos.ts destino@ejemplo.com [bandera]
//
// Sin bandera manda la tanda 1 (las 4 combinaciones de encabezado);
// --tanda2, los dos casos de degradación del logo; --comparar, el tamaño
// del logo en la caja vieja contra la nueva. Y:
//
//   --logo <ruta|url> [--nombre "Clínica X"]
//
// que manda el mismo antes/después con UN archivo concreto, mandándolo
// adjunto en línea para no depender de que esté publicado en ningún lado
// (ver el bloque de la cuarta tanda, más abajo).
//
// NO escribe nada: ni en la base (no pasa por enviarCorreoTransaccional,
// así que no deja filas en correos_enviados) ni en el almacenamiento. Las
// marcas se arman a mano acá.
//
// El logo apunta a https://app.vetlineai.com/brand/... y no a la URL que
// resolvería el backend local: `config.apiPublicUrl` es localhost, que un
// cliente de correo real no puede alcanzar. Es nuestro propio archivo de
// marca haciendo de logo de clínica — sirve para ver el encabezado con la
// imagen cargada, que es lo que no se puede probar de otra forma desde
// este entorno.
import { construirCorreo } from "../correos";
import { asuntoParaCabecera, componerRemitente, enviarEmail, resendConfigurado } from "../email";
import fs from "fs";
import { Resend } from "resend";
import { config } from "../config";
import { dimensionesImagen, escalarDentroDeCaja } from "../lib/imagenLogo";
import { MarcaCorreo, escalarLogoDeEncabezado } from "../marcaCorreo";

const LOGO_PUBLICO = "https://app.vetlineai.com/brand/logo-horizontal-claro@2x.png";

// El archivo mide 194x100. El tamaño no se escribe a mano: lo calcula la
// MISMA función que usa marcaCorreo.ts con el archivo real, así una tanda
// nunca muestra un encabezado que el backend ya no produce (fue justo lo
// que pasó al agrandar la caja del logo).
const TAMANO_LOGO_PUBLICO = escalarLogoDeEncabezado(194, 100);

const marcaComercioConLogo: MarcaCorreo = {
  nombre: "Clínica Veterinaria San Roque",
  logoUrl: LOGO_PUBLICO,
  logoTamano: TAMANO_LOGO_PUBLICO,
  replyTo: null,
  esComercio: true,
};

const marcaComercioSinLogo: MarcaCorreo = {
  nombre: "Veterinaria Los Álamos",
  logoUrl: null,
  logoTamano: null,
  replyTo: null,
  esComercio: true,
};

// El caso feo del encabezado en texto: un nombre largo tiene que envolver
// sin desarmar la caja.
const marcaNombreLargo: MarcaCorreo = {
  nombre: "Hospital Veterinario Integral de Especialidades y Urgencias 24 Horas",
  logoUrl: null,
  logoTamano: null,
  replyTo: null,
  esComercio: true,
};

const marcaDePlataforma: MarcaCorreo = {
  nombre: "Vetline Ai",
  logoUrl: LOGO_PUBLICO,
  logoTamano: TAMANO_LOGO_PUBLICO,
  replyTo: null,
  esComercio: false,
};

// ---------------------------------------------------------------------
// Segunda tanda — los dos casos del encabezado CON logo que la primera no
// cubrió, los dos sobre cómo se degrada.
//
// No hace falta que el logo salga del bucket de MinIO para probar esto:
// lo que se mira es qué pasa cuando la imagen NO se pinta, y ahí la URL
// es indiferente. El camino del bucket se verifica aparte, con
// verificar_almacenamiento_publico.ts, que sí lo ejerce de punta a punta.
// ---------------------------------------------------------------------

// Caso A: el logo carga bien. Se manda para leerlo con la descarga de
// imágenes BLOQUEADA (que es el estado por omisión de Outlook para un
// remitente externo) y poder comparar activándola después.
const marcaLogoAlcanzable: MarcaCorreo = {
  nombre: "Clínica Veterinaria San Roque",
  logoUrl: LOGO_PUBLICO,
  logoTamano: TAMANO_LOGO_PUBLICO,
  replyTo: null,
  esComercio: true,
};

// Caso B: el objeto existe cuando se arma el correo (el backend lo pudo
// medir) pero el destinatario no lo puede alcanzar — el bucket dejó de
// ser público, alguien borró el objeto, o hay un firewall en el medio.
// Acá se usa a propósito la URL de MinIO local, que desde cualquier
// máquina que no sea esta no resuelve. Es el caso que dice si el
// encabezado se degrada a texto o queda un recuadro roto.
const marcaLogoInalcanzable: MarcaCorreo = {
  nombre: "Veterinaria Los Álamos",
  logoUrl: "http://localhost:9010/vetplatform-publico/logos/inexistente.png",
  logoTamano: escalarLogoDeEncabezado(400, 100),
  replyTo: null,
  esComercio: true,
};

// ---------------------------------------------------------------------
// Tercera tanda (--comparar) — el tamaño del logo, antes y después de
// agrandar la caja del encabezado.
//
// Dos proporciones distintas, cada una en las dos cajas, para poder
// juzgar el cambio con los ojos en vez de discutir números:
//
//   caja vieja 180x36   →   caja nueva 240x56
//   1.94:1   70x36              109x56
//   1:1      36x36               56x56
//
// LIMITACIÓN de esta tanda: el logo tiene que salir de una URL que un
// cliente de correo pueda alcanzar, y desde este entorno las únicas que
// cumplen son nuestros propios archivos ya publicados. El logo de una
// clínica concreta que viva solo en el MinIO local NO se puede mandar
// así: localhost no resuelve desde una bandeja de entrada. Lo que se
// compara acá es el TAMAÑO que produce la caja para cada proporción, que
// es lo que cambió; el camino del bucket ya está verificado aparte.
const LOGO_APAISADO = LOGO_PUBLICO; // 388x200 → 1.94:1
const LOGO_CUADRADO = "https://app.vetlineai.com/icon-512.png"; // 512x512 → 1:1

// El tamaño viejo se calcula con la caja vieja escrita a mano a propósito:
// es el término de comparación, no la configuración vigente.
function tamanoCajaVieja(ancho: number, alto: number) {
  return escalarDentroDeCaja(ancho, alto, 180, 36);
}

function marcaDeComparacion(
  nombre: string,
  logoUrl: string,
  tamano: { width: number; height: number }
): MarcaCorreo {
  return { nombre, logoUrl, logoTamano: tamano, replyTo: null, esComercio: true };
}

const comparacion = [
  {
    etiqueta: "1/4 apaisado 1.94:1 — ANTES (70x36)",
    marca: marcaDeComparacion("Clínica Veterinaria San Roque", LOGO_APAISADO, tamanoCajaVieja(388, 200)),
  },
  {
    etiqueta: "2/4 apaisado 1.94:1 — AHORA (109x56)",
    marca: marcaDeComparacion("Clínica Veterinaria San Roque", LOGO_APAISADO, escalarLogoDeEncabezado(388, 200)),
  },
  {
    etiqueta: "3/4 cuadrado 1:1 — ANTES (36x36)",
    marca: marcaDeComparacion("Veterinaria Los Álamos", LOGO_CUADRADO, tamanoCajaVieja(512, 512)),
  },
  {
    etiqueta: "4/4 cuadrado 1:1 — AHORA (56x56)",
    marca: marcaDeComparacion("Veterinaria Los Álamos", LOGO_CUADRADO, escalarLogoDeEncabezado(512, 512)),
  },
].map(({ etiqueta, marca }) => ({
  etiqueta,
  marca,
  // Siempre la misma plantilla y los mismos datos: si el correo cambiara
  // de contenido entre uno y otro, el título contra el que se compara el
  // logo tendría otro largo y la comparación no diría nada.
  correo: construirCorreo(
    "recordatorio_cita",
    { nombrePaciente: "Toby", fecha: "02/09/2026", hora: "10:30", medicoNombre: "Dra. Ana Pérez" },
    marca
  ),
}));

// ---------------------------------------------------------------------
// Cuarta tanda (--logo <ruta|url>) — el mismo antes/después pero con UN
// ARCHIVO CONCRETO, el de una clínica real.
//
// El problema que resuelve: hasta acá una tanda solo podía mostrar logos
// ya publicados en app.vetlineai.com, porque un <img src="http://..."> se
// resuelve en la máquina del destinatario y desde ahí el MinIO local no
// existe. Un logo que vive solo en el bucket de desarrollo —que son
// todos— no se podía mirar en una bandeja de entrada.
//
// Acá el archivo viaja DENTRO del mensaje, como adjunto en línea, y el
// <img> lo referencia por cid:. Eso hace innecesaria cualquier URL
// pública, así que sirve para cualquier archivo.
//
// Es un camino SOLO de este script de prueba: el envío de producción
// sigue mandando la URL del bucket y no se toca. Lo que se compara acá es
// el TAMAÑO que la caja le da a una proporción concreta, que es idéntico
// por los dos caminos —los atributos width/height del <img> son los
// mismos—; el camino de la URL ya está verificado en
// verificar_almacenamiento_publico.ts.
const CID_LOGO = "logo-clinica";

async function bytesDelLogo(ruta: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(ruta)) {
    const resp = await fetch(ruta);
    if (!resp.ok) throw new Error(`no se pudo bajar ${ruta}: HTTP ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  }
  return fs.readFileSync(ruta);
}

async function enviarConLogoAdjunto(destino: string, ruta: string, nombreClinica: string): Promise<void> {
  if (!config.resendApiKey) throw new Error("RESEND_API_KEY no está configurada");
  const bytes = await bytesDelLogo(ruta);
  const esPng = /\.png$/i.test(ruta) || bytes.subarray(0, 4).toString("hex") === "89504e47";
  const real = dimensionesImagen(bytes, esPng ? "png" : "jpg");

  const antes = escalarDentroDeCaja(real.width, real.height, 180, 36);
  const ahora = escalarLogoDeEncabezado(real.width, real.height);
  console.log(
    `  archivo ${real.width}x${real.height} (proporción ${(real.width / real.height).toFixed(2)}:1)\n` +
      `  caja vieja 180x36 → ${antes.width}x${antes.height}\n` +
      `  caja nueva 240x56 → ${ahora.width}x${ahora.height}`
  );

  // Cliente propio, no el de email.ts: enviarEmail() no manda adjuntos y
  // agregárselos sería meter en el camino de producción una capacidad que
  // solo necesita esta prueba. El saneo de cabeceras sí se reusa.
  const resend = new Resend(config.resendApiKey);

  for (const [etiqueta, tamano] of [
    ["ANTES (caja 180x36)", antes],
    ["AHORA (caja 240x56)", ahora],
  ] as [string, { width: number; height: number }][]) {
    const marca: MarcaCorreo = {
      nombre: nombreClinica,
      logoUrl: `cid:${CID_LOGO}`,
      logoTamano: tamano,
      replyTo: null,
      esComercio: true,
    };
    const correo = construirCorreo(
      "recordatorio_cita",
      { nombrePaciente: "Toby", fecha: "02/09/2026", hora: "10:30", medicoNombre: "Dra. Ana Pérez" },
      marca
    );
    const { data, error } = await resend.emails.send({
      from: componerRemitente(nombreClinica),
      to: destino,
      subject: asuntoParaCabecera(`[prueba ${etiqueta} ${tamano.width}x${tamano.height}] ${correo.asunto}`),
      text: correo.texto,
      html: correo.html,
      attachments: [
        {
          filename: esPng ? "logo.png" : "logo.jpg",
          content: bytes,
          contentType: esPng ? "image/png" : "image/jpeg",
          inlineContentId: CID_LOGO,
        },
      ],
    });
    if (error) {
      console.log(`  [FALLÓ]   ${etiqueta} — ${JSON.stringify(error)}`);
    } else {
      console.log(`  [enviado] ${etiqueta} ${tamano.width}x${tamano.height} — id ${data?.id}`);
    }
  }
}

async function main() {
  const destino = process.argv[2];
  if (!destino) {
    console.error("Falta la dirección de destino.");
    process.exit(1);
  }
  if (!resendConfigurado()) {
    console.error("RESEND_API_KEY no está configurada: no hay nada que mandar.");
    process.exit(1);
  }

  const tandaDos = [
    {
      etiqueta: "1/2 logo que carga — LEER CON IMAGENES BLOQUEADAS",
      marca: marcaLogoAlcanzable,
      correo: construirCorreo(
        "recordatorio_cita",
        { nombrePaciente: "Toby", fecha: "02/09/2026", hora: "10:30", medicoNombre: "Dra. Ana Pérez" },
        marcaLogoAlcanzable
      ),
    },
    {
      etiqueta: "2/2 logo inalcanzable (objeto borrado)",
      marca: marcaLogoInalcanzable,
      correo: construirCorreo(
        "vacunacion_proxima",
        { nombrePaciente: "Luna", vacuna: "Antirrábica", fechaProxima: "12/09/2026" },
        marcaLogoInalcanzable
      ),
    },
  ];

  const tandaUno = [
    {
      etiqueta: "1/4 comercio CON logo",
      marca: marcaComercioConLogo,
      correo: construirCorreo(
        "recordatorio_cita",
        { nombrePaciente: "Toby", fecha: "02/09/2026", hora: "10:30", medicoNombre: "Dra. Ana Pérez" },
        marcaComercioConLogo
      ),
    },
    {
      etiqueta: "2/4 comercio SIN logo (nombre en texto)",
      marca: marcaComercioSinLogo,
      correo: construirCorreo("cumpleanos", { nombrePaciente: "Toby" }, marcaComercioSinLogo),
    },
    {
      etiqueta: "3/4 comercio SIN logo, nombre largo",
      marca: marcaNombreLargo,
      correo: construirCorreo(
        "cita_cancelada_o_reprogramada",
        {
          nombrePaciente: "Luna",
          fechaOriginal: "02/09/2026",
          horaOriginal: "09:00",
          reprogramada: true,
          fechaNueva: "05/09/2026",
          horaNueva: "16:30",
        },
        marcaNombreLargo
      ),
    },
    {
      etiqueta: "4/4 plataforma (con botón)",
      marca: marcaDePlataforma,
      correo: construirCorreo(
        "cobro_fallido",
        {
          montoUsd: 30,
          intentoNumero: 1,
          esUltimoIntento: false,
          proximoIntentoFecha: "05/09/2026",
          enlace: "https://app.vetlineai.com/admin/facturacion/medio-de-pago",
        },
        marcaDePlataforma
      ),
    },
  ];

  // --logo tiene su propio camino de envío (adjunto en línea), así que
  // sale por acá y no arma una "tanda" del bucle de abajo.
  const iLogo = process.argv.indexOf("--logo");
  if (iLogo !== -1) {
    const ruta = process.argv[iLogo + 1];
    if (!ruta) {
      console.error("--logo necesita la ruta del archivo (o una URL).");
      process.exit(1);
    }
    const iNombre = process.argv.indexOf("--nombre");
    const nombreClinica = iNombre !== -1 ? process.argv[iNombre + 1] : "Clínica Veterinaria";
    await enviarConLogoAdjunto(destino, ruta, nombreClinica);
    return;
  }

  const tanda = process.argv.includes("--comparar")
    ? comparacion
    : process.argv.includes("--tanda2")
      ? tandaDos
      : tandaUno;

  for (const { etiqueta, marca, correo } of tanda) {
    // Se le antepone la etiqueta al asunto SOLO en esta tanda de prueba,
    // para poder identificar cada correo en la bandeja.
    const asunto = `[prueba ${etiqueta}] ${correo.asunto}`;
    try {
      const { id } = await enviarEmail(destino, asunto, correo.texto, correo.html, {
        nombreRemitente: marca.esComercio ? marca.nombre : null,
        replyTo: marca.replyTo,
      });
      console.log(`  [enviado] ${etiqueta} — id ${id}`);
    } catch (err) {
      console.log(`  [FALLÓ]   ${etiqueta} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
