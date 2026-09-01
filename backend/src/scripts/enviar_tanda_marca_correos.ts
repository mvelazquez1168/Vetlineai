// Tanda real por Resend para revisar las plantillas en un cliente de
// correo de verdad (Outlook es donde se rompe lo que en el navegador se
// ve bien). Complementa a verificar_marca_correos.ts, que verifica la
// lógica pero no puede decir nada sobre cómo lo renderiza Word.
//
//   docker compose exec backend npx ts-node --transpile-only \
//     src/scripts/enviar_tanda_marca_correos.ts destino@ejemplo.com
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
import { enviarEmail, resendConfigurado } from "../email";
import { MarcaCorreo } from "../marcaCorreo";

const LOGO_PUBLICO = "https://app.vetlineai.com/brand/logo-horizontal-claro@2x.png";

// 194x100 escalado a la caja 180x36 → 70x36, el mismo cálculo que hace
// marcaCorreo.ts a partir del archivo real.
const marcaComercioConLogo: MarcaCorreo = {
  nombre: "Clínica Veterinaria San Roque",
  logoUrl: LOGO_PUBLICO,
  logoTamano: { width: 70, height: 36 },
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
  logoTamano: { width: 70, height: 36 },
  replyTo: null,
  esComercio: false,
};

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

  const tanda = [
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
