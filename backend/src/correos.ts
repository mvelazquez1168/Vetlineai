import { Pool, PoolClient } from "pg";
import { config } from "./config";
import { enviarEmail, resendConfigurado, AdjuntoEmail } from "./email";
import { MarcaCorreo, resolverMarca } from "./marcaCorreo";

// ---------------------------------------------------------------------
// Correos transaccionales — plantillas con identidad visual + registro
// de envíos (Paso 5: "cada envío queda registrado con destinatario,
// tipo, fecha y resultado").
//
// Los 4 correos de cobro (cobro_fallido, cuenta_suspendida,
// autorecarga_fallida, tarjeta_por_vencer — prompt_code_correos_y_logo)
// tienen un destinatario que es un veterinario, no un moroso: la mayoría
// de los fallos de cobro son inocentes (tarjeta vencida, saldo momentáneo,
// rechazo de seguridad del banco). Tono informativo, nunca conminatorio,
// UNA sola acción por correo, y en todos la aclaración de que el acceso a
// expedientes/agenda/recetas/informes NUNCA se interrumpe por un tema de
// pago — es lo que más ansiedad evita, sobre todo en cuenta_suspendida.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type TipoCorreo =
  | "invitacion_medico"
  | "prueba_por_terminar"
  | "prueba_terminada"
  | "recordatorio_eliminacion"
  | "verificacion_correo"
  | "cuenta_no_operativa"
  | "cobro_fallido"
  | "cuenta_suspendida"
  | "autorecarga_fallida"
  | "tarjeta_por_vencer"
  | "recordatorio_cita"
  | "desparasitacion_proxima"
  | "seguimiento_faltante"
  | "cuenta_suspendida_manual"
  | "entrada_ventana_cierre"
  | "recordatorio_cierre"
  | "cuenta_bloqueada"
  | "vacunacion_proxima"
  | "seguimiento_posterior_consulta"
  | "agenda_dia_siguiente"
  | "confirmacion_cita"
  | "cita_cancelada_o_reprogramada"
  | "informe_disponible"
  | "cumpleanos"
  | "saldo_proveedor_bajo"
  | "restablecimiento_contrasena"
  | "contrasena_cambiada"
  | "comprobante_electronico"
  | "receta_emitida";

export interface DatosPlantilla {
  invitacion_medico: { nombreClinica: string; enlace: string; vigenciaDias: number; nombreMedico?: string | null };
  prueba_por_terminar: { diasRestantes: number; enlacePlanes: string };
  prueba_terminada: { fechaEliminacion: string; enlaceExportar: string; enlacePlanes: string };
  recordatorio_eliminacion: { fechaEliminacion: string; enlaceExportar: string; enlacePlanes: string };
  verificacion_correo: { nombreClinica: string; enlace: string; vigenciaHoras: number };
  cuenta_no_operativa: { nombreClinica: string; motivos: string[]; diasRestantes: number; enlace: string };
  cobro_fallido: {
    montoUsd: number;
    intentoNumero: number;
    esUltimoIntento: boolean;
    proximoIntentoFecha: string | null;
    enlace: string;
  };
  cuenta_suspendida: { montoUsd: number; enlace: string };
  autorecarga_fallida: { montoUsd: number; enlaceAutorecarga: string; enlaceRecargarManual: string };
  tarjeta_por_vencer: {
    marca: string | null;
    ultimos4: string | null;
    vencimiento: string;
    proximoCobroFecha: string | null;
    enlace: string;
  };
  recordatorio_cita: { nombrePaciente: string; fecha: string; hora: string; medicoNombre: string };
  desparasitacion_proxima: { nombrePaciente: string; fechaProxima: string };
  seguimiento_faltante: { nombrePaciente: string; estadoClinico: string };
  cuenta_suspendida_manual: { motivo: string | null; enlace: string };
  entrada_ventana_cierre: { fechaEliminacion: string; enlaceExportar: string; enlacePlanes: string };
  recordatorio_cierre: { fechaEliminacion: string; enlaceExportar: string; enlacePlanes: string };
  cuenta_bloqueada: { motivo: string | null; enlaceSoporte: string };
  vacunacion_proxima: { nombrePaciente: string; vacuna: string; fechaProxima: string };
  seguimiento_posterior_consulta: { nombrePaciente: string };
  agenda_dia_siguiente: { fecha: string; citas: { hora: string; pacienteNombre: string; motivoConsulta: string | null }[] };
  confirmacion_cita: { nombrePaciente: string; fecha: string; hora: string; medicoNombre: string };
  cita_cancelada_o_reprogramada: {
    nombrePaciente: string;
    fechaOriginal: string;
    horaOriginal: string;
    reprogramada: boolean;
    fechaNueva?: string;
    horaNueva?: string;
  };
  informe_disponible: { nombrePaciente: string };
  // El comprobante electrónico que se le manda al receptor con su PDF y
  // su XML adjuntos. `estadoHacienda` va en el cuerpo a propósito: un
  // comprobante todavía no aceptado es válido para el cliente, pero si
  // Hacienda lo rechaza después hay que poder rastrear qué se le dijo.
  // La receta de la atencion, con su PDF adjunto (prompt 07c). El
  // cuerpo NO repite la posologia: esta en el PDF, que es el documento
  // que el propietario lleva a la farmacia, y dos copias del mismo
  // texto son dos textos que un dia dicen cosas distintas.
  receta_emitida: {
    nombrePaciente: string;
    medicoNombre: string;
    fecha: string;
    lineas: number;
  };
  comprobante_electronico: {
    tipoComprobanteNombre: string;
    consecutivo: string;
    clave: string;
    total: string;
    moneda: string;
    fecha: string;
    estadoHacienda: string;
  };
  cumpleanos: { nombrePaciente: string };
  saldo_proveedor_bajo: { saldoUsd: number; umbralUsd: number };
  restablecimiento_contrasena: { nombre: string | null; enlace: string; vigenciaMinutos: number };
  contrasena_cambiada: { nombre: string | null; fecha: string };
}

// Escapa lo que se interpola en el HTML desde un dato del tenant (hoy:
// su nombre, en el encabezado y en el pie). El resto de las plantillas
// interpola datos clínicos con la misma exposición, pero eso es
// preexistente y ajeno a este cambio — acá se escapa lo que este cambio
// introduce.
function esc(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Encabezado claro y neutro, con el logo haciendo el trabajo — decisión
// explícita del usuario sobre el criterio 1/3/4 del prompt: en correo un
// encabezado claro se lee mejor que una banda de color, y sin color de
// marca no hace falta ni un campo nuevo en `tenants` ni un cálculo de
// contraste. Si algún día el producto tiene color de marca en la
// interfaz, se suma acá.
//
// Tres detalles que no son cosméticos:
//   - `alt` con el nombre: la mayoría de los clientes de correo bloquea
//     imágenes por omisión, y ahí el texto alternativo ES el encabezado.
//     Va estilado para que en ese caso se lea como un título y no como
//     una etiqueta rota.
//   - sin logo cargado, el nombre en texto, nunca un hueco.
//   - la URL del logo no lleva ningún dato del destinatario (ver
//     marcaCorreo.ts): un intermediario que la vea no aprende nada.
//
// El tamaño va con ancho Y alto explícitos, ya escalados dentro de la
// caja por marcaCorreo.ts a partir de las dimensiones reales del archivo.
// El logo lo sube la clínica y puede tener cualquier proporción: con solo
// el alto fijo, un logo apaisado (12:1 y peores existen) se pasa del
// ancho del cuerpo. Acotar con `max-width` no alcanza porque Outlook lo
// ignora — usa el motor de Word, que respeta los atributos width/height y
// poco más. Dando los dos números escalados a la misma proporción, el
// logo queda acotado en todos los clientes y no se deforma en ninguno.
function encabezado(marca: MarcaCorreo): string {
  if (marca.logoUrl && marca.logoTamano) {
    const { width, height } = marca.logoTamano;
    return `<img src="${esc(marca.logoUrl)}" alt="${esc(marca.nombre)}" width="${width}" height="${height}" style="display:block;width:${width}px;height:${height}px;max-width:100%;border:0;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;color:#1f2937;text-decoration:none;">`;
  }
  return `<span style="font-size:18px;font-weight:bold;color:#1f2937;">${esc(marca.nombre)}</span>`;
}

// El pie va SOLO en los correos con marca del comercio, y no es marca:
// es honestidad y protección. Si el destinatario responde, reclama o
// denuncia el correo como no deseado, tiene que poder saber quién es
// quién; y ante una queja por correo no solicitado, que la plataforma
// esté identificada nos cubre. En los correos de plataforma sería
// redundante — el encabezado ya somos nosotros.
function pie(marca: MarcaCorreo): string {
  if (!marca.esComercio) return "";
  return `
        <tr><td style="padding:16px 32px 0;text-align:center;">
          <span style="font-size:11px;color:#9ca3af;line-height:1.5;">Enviado por ${esc(marca.nombre)} a través de Vetline Ai.</span>
        </td></tr>`;
}

// Layout único para las dos categorías (decisión del usuario): lo único
// que cambia entre una y otra es qué marca entra en el encabezado y si
// lleva pie. El botón sigue en el azul del producto porque hoy ningún
// correo con marca de comercio tiene botón — los 10 son informativos —;
// si alguna vez lo tuviera, `esComercio` lo baja a un neutro oscuro en
// vez de teñir de azul nuestro un correo que dice ser de la clínica.
function envolver(
  marca: MarcaCorreo,
  tituloInterno: string,
  cuerpoHtml: string,
  boton?: { texto: string; enlace: string }
): string {
  const colorTitulo = marca.esComercio ? "#1f2937" : "#1e3a5f";
  const colorBoton = marca.esComercio ? "#1f2937" : "#1e3a5f";
  const botonHtml = boton
    ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
            <tr><td style="border-radius:8px;background-color:${colorBoton};">
              <a href="${boton.enlace}" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;">${boton.texto}</a>
            </td></tr>
          </table>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="width:480px;max-width:100%;">
        <tr><td style="background-color:#ffffff;border-radius:12px 12px 0 0;border-bottom:1px solid #e5e7eb;padding:20px 32px;">
          ${encabezado(marca)}
        </td></tr>
        <tr><td style="background-color:#ffffff;border-radius:0 0 12px 12px;padding:32px;">
          <h1 style="font-size:18px;color:${colorTitulo};margin:0 0 16px;">${tituloInterno}</h1>
          <div style="font-size:14px;color:#333333;line-height:1.6;">${cuerpoHtml}</div>${botonHtml}
        </td></tr>${pie(marca)}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function construirCorreo<T extends TipoCorreo>(
  tipo: T,
  datos: DatosPlantilla[T],
  marca: MarcaCorreo
): { asunto: string; texto: string; html: string } {
  // Los dos envoltorios que usan los 27 casos de abajo, cerrados sobre la
  // marca de este envío — así el switch no tiene que arrastrar `marca`
  // caso por caso. `envolverLayoutInformativo` es la variante sin botón:
  // los avisos al tutor no tienen un enlace natural al que mandarlo (no
  // hay portal del propietario) y forzar un botón a un enlace inventado
  // sería peor que no tener botón.
  const envolverLayout = (titulo: string, cuerpo: string, textoBoton: string, enlace: string) =>
    envolver(marca, titulo, cuerpo, { texto: textoBoton, enlace });
  const envolverLayoutInformativo = (titulo: string, cuerpo: string) => envolver(marca, titulo, cuerpo);

  switch (tipo) {
    case "invitacion_medico": {
      const d = datos as DatosPlantilla["invitacion_medico"];
      const saludo = d.nombreMedico ? `Hola ${d.nombreMedico},` : "¡Hola!";
      const cuerpo =
        `<p>${saludo}</p>` +
        `<p>${d.nombreClinica} te invitó a sumarte como médico veterinario en Vetline Ai.</p>` +
        `<p>El enlace es válido por ${d.vigenciaDias} días.</p>`;
      return {
        asunto: `Te invitaron a trabajar con ${d.nombreClinica} en Vetline Ai`,
        texto:
          `${saludo} ${d.nombreClinica} te invitó a sumarte como médico veterinario en Vetline Ai. ` +
          `Completá tu alta en el siguiente enlace (válido por ${d.vigenciaDias} días): ${d.enlace}`,
        html: envolverLayout("Te invitaron a Vetline Ai", cuerpo, "Completar mi alta", d.enlace),
      };
    }
    case "prueba_por_terminar": {
      const d = datos as DatosPlantilla["prueba_por_terminar"];
      const dias = d.diasRestantes === 1 ? "1 día" : `${d.diasRestantes} días`;
      const cuerpo = `<p>Tu período de prueba en Vetline Ai termina en ${dias}. Elegí un plan para seguir generando con IA sin interrupciones.</p>`;
      return {
        asunto: `Tu prueba en Vetline Ai termina en ${dias}`,
        texto: `Tu período de prueba termina en ${dias}. Elegí un plan para seguir usando Vetline Ai sin interrupciones: ${d.enlacePlanes}`,
        html: envolverLayout("Tu prueba está por terminar", cuerpo, "Elegir un plan", d.enlacePlanes),
      };
    }
    case "prueba_terminada": {
      const d = datos as DatosPlantilla["prueba_terminada"];
      const cuerpo =
        `<p>Tu período de prueba terminó. Los datos de tu clínica se eliminan el <strong>${d.fechaEliminacion}</strong> si no elegís un plan antes.</p>` +
        `<p>Mientras tanto podés seguir consultando tus casos y <a href="${d.enlaceExportar}">exportar toda tu información</a>.</p>`;
      return {
        asunto: "Tu período de prueba en Vetline Ai terminó",
        texto:
          `Tu período de prueba terminó. Los datos de tu clínica se eliminan el ${d.fechaEliminacion} si no elegís un plan antes. ` +
          `Podés exportar tu información en ${d.enlaceExportar} o elegir un plan en ${d.enlacePlanes}.`,
        html: envolverLayout("Tu prueba terminó", cuerpo, "Elegir un plan", d.enlacePlanes),
      };
    }
    case "recordatorio_eliminacion": {
      const d = datos as DatosPlantilla["recordatorio_eliminacion"];
      const cuerpo =
        `<p>En pocos días vamos a eliminar definitivamente los datos de tu clínica en Vetline Ai, el <strong>${d.fechaEliminacion}</strong>.</p>` +
        `<p>Si todavía no <a href="${d.enlaceExportar}">exportaste tu información</a>, hacelo antes de esa fecha.</p>`;
      return {
        asunto: "Últimos días antes de eliminar los datos de tu clínica",
        texto:
          `En pocos días vamos a eliminar definitivamente los datos de tu clínica, el ${d.fechaEliminacion}. ` +
          `Exportá tu información en ${d.enlaceExportar} o elegí un plan en ${d.enlacePlanes} antes de esa fecha.`,
        html: envolverLayout("Últimos días antes de eliminar tus datos", cuerpo, "Exportar mis datos", d.enlaceExportar),
      };
    }
    case "verificacion_correo": {
      const d = datos as DatosPlantilla["verificacion_correo"];
      const cuerpo =
        `<p>Confirmá que este es el correo de acceso de ${d.nombreClinica} en Vetline Ai.</p>` +
        `<p>El enlace es válido por ${d.vigenciaHoras} horas. Hasta que lo confirmes, tu crédito de prueba queda retenido — el resto del producto sigue disponible.</p>`;
      return {
        asunto: "Confirmá tu correo en Vetline Ai",
        texto:
          `Confirmá que este es el correo de acceso de ${d.nombreClinica} en Vetline Ai. ` +
          `El enlace es válido por ${d.vigenciaHoras} horas: ${d.enlace}`,
        html: envolverLayout("Confirmá tu correo", cuerpo, "Confirmar mi correo", d.enlace),
      };
    }
    case "cuenta_no_operativa": {
      const d = datos as DatosPlantilla["cuenta_no_operativa"];
      const listaMotivos = d.motivos.map((m) => `<li>${m}</li>`).join("");
      const cuerpo =
        `<p>${d.nombreClinica} todavía no está operativa en Vetline Ai:</p>` +
        `<ul>${listaMotivos}</ul>` +
        `<p>Si en ${d.diasRestantes} días sigue así, la cuenta entra en ventana de eliminación, igual que una prueba vencida.</p>`;
      return {
        asunto: `${d.nombreClinica} todavía no está operativa en Vetline Ai`,
        texto:
          `${d.nombreClinica} todavía no está operativa: ${d.motivos.join("; ")}. ` +
          `Si en ${d.diasRestantes} días sigue así, la cuenta entra en ventana de eliminación. Resolvelo en ${d.enlace}`,
        html: envolverLayout("Tu clínica todavía no está operativa", cuerpo, "Resolverlo ahora", d.enlace),
      };
    }
    case "cobro_fallido": {
      const d = datos as DatosPlantilla["cobro_fallido"];
      const monto = `USD ${d.montoUsd.toFixed(2)}`;
      const parrafoServicio = `<p>Mientras tanto, tu clínica sigue funcionando con normalidad: el acceso a expedientes, agenda, recetas e informes nunca se interrumpe por un tema de pago.</p>`;
      if (d.esUltimoIntento) {
        const cuerpo =
          `<p>No pudimos procesar el cobro de tu suscripción por ${monto}.</p>` +
          `<p><strong>Este es el último intento antes de suspender la cuenta.</strong> Si tampoco procede, tu cuenta quedará suspendida: no se te otorgará el crédito del período nuevo, pero el saldo que ya tenés — incluido el comprado — sigue disponible, y el acceso a expedientes, agenda, recetas e informes no se interrumpe.</p>` +
          `<p>Revisá o actualizá tu medio de pago para evitarlo.</p>`;
        return {
          asunto: `Último intento de cobro — ${monto}`,
          texto:
            `No pudimos procesar el cobro de tu suscripción por ${monto}. Este es el último intento antes de suspender la cuenta: ` +
            `si tampoco procede, no se otorgará el crédito del período nuevo, pero tu saldo actual y el acceso a expedientes, agenda, recetas e informes siguen disponibles. ` +
            `Revisá tu medio de pago: ${d.enlace}`,
          html: envolverLayout("No pudimos procesar tu cobro", cuerpo, "Revisar medio de pago", d.enlace),
        };
      }
      const cuerpo =
        `<p>No pudimos procesar el cobro de tu suscripción por ${monto}.</p>` +
        `<p>Vamos a reintentarlo automáticamente${d.proximoIntentoFecha ? ` el <strong>${d.proximoIntentoFecha}</strong>` : " en los próximos días"}.</p>` +
        parrafoServicio +
        `<p>Si querés, podés revisar o actualizar tu medio de pago desde ahora.</p>`;
      return {
        asunto: `No pudimos procesar el cobro de tu suscripción — ${monto}`,
        texto:
          `No pudimos procesar el cobro de tu suscripción por ${monto}. Vamos a reintentarlo automáticamente` +
          `${d.proximoIntentoFecha ? ` el ${d.proximoIntentoFecha}` : " en los próximos días"}. ` +
          `Tu clínica sigue funcionando con normalidad mientras tanto. Revisá tu medio de pago: ${d.enlace}`,
        html: envolverLayout("No pudimos procesar tu cobro", cuerpo, "Revisar medio de pago", d.enlace),
      };
    }
    case "cuenta_suspendida": {
      const d = datos as DatosPlantilla["cuenta_suspendida"];
      const monto = `USD ${d.montoUsd.toFixed(2)}`;
      const cuerpo =
        `<p>Después de varios intentos, no pudimos procesar el cobro de tu suscripción por ${monto} y tu cuenta quedó suspendida.</p>` +
        `<p>Qué significa concretamente:</p>` +
        `<ul>` +
        `<li>No se otorga el crédito del período nuevo.</li>` +
        `<li>El saldo que ya tenías — incluido el comprado — sigue disponible y utilizable.</li>` +
        `<li>El acceso a expedientes, agenda, recetas e informes ya generados sigue completo.</li>` +
        `</ul>` +
        `<p>Un cobro exitoso reactiva tu suscripción de inmediato y otorga el crédito pendiente.</p>`;
      return {
        asunto: "Tu cuenta en Vetline Ai quedó suspendida",
        texto:
          `Después de varios intentos no pudimos procesar el cobro de tu suscripción por ${monto} y tu cuenta quedó suspendida. ` +
          `No se otorga el crédito del período nuevo, pero tu saldo existente y el acceso a expedientes, agenda, recetas e informes siguen disponibles. ` +
          `Actualizá tu medio de pago para reactivar: ${d.enlace}`,
        html: envolverLayout("Tu cuenta quedó suspendida", cuerpo, "Actualizar medio de pago", d.enlace),
      };
    }
    case "autorecarga_fallida": {
      const d = datos as DatosPlantilla["autorecarga_fallida"];
      const monto = `USD ${d.montoUsd.toFixed(2)}`;
      const cuerpo =
        `<p>La recarga automática de crédito por ${monto} no se pudo procesar.</p>` +
        `<p>No la vamos a reintentar sola: insistir con un cargo que ya fue rechazado puede hacer que tu banco bloquee la tarjeta.</p>` +
        `<p>Tu saldo actual sigue disponible. Podés recargar manualmente ahora, o <a href="${d.enlaceAutorecarga}">actualizar tu medio de pago</a> para que la próxima autorecarga funcione.</p>`;
      return {
        asunto: `No se pudo procesar la autorecarga — ${monto}`,
        texto:
          `La recarga automática de crédito por ${monto} no se pudo procesar y no se va a reintentar sola (para evitar que tu banco bloquee la tarjeta). ` +
          `Tu saldo actual sigue disponible. Recargá manualmente en ${d.enlaceRecargarManual} o actualizá tu medio de pago en ${d.enlaceAutorecarga}`,
        html: envolverLayout("No se pudo procesar la autorecarga", cuerpo, "Recargar manualmente", d.enlaceRecargarManual),
      };
    }
    case "tarjeta_por_vencer": {
      const d = datos as DatosPlantilla["tarjeta_por_vencer"];
      const tarjeta = d.marca && d.ultimos4 ? `${d.marca} terminada en ${d.ultimos4}` : "tu tarjeta registrada";
      const cuerpo =
        `<p>${tarjeta[0].toUpperCase()}${tarjeta.slice(1)} vence en ${d.vencimiento}.</p>` +
        `<p>${d.proximoCobroFecha ? `Tu próximo cobro previsto es el <strong>${d.proximoCobroFecha}</strong>.` : "Registrá una tarjeta nueva antes de tu próximo cobro."} Renovala antes para que ese cobro no falle.</p>`;
      return {
        asunto: `${tarjeta[0].toUpperCase()}${tarjeta.slice(1)} vence pronto`,
        texto:
          `${tarjeta} vence en ${d.vencimiento}. ` +
          `${d.proximoCobroFecha ? `Tu próximo cobro previsto es el ${d.proximoCobroFecha}. ` : ""}` +
          `Registrá una tarjeta nueva antes para que ese cobro no falle: ${d.enlace}`,
        html: envolverLayout("Tu tarjeta vence pronto", cuerpo, "Registrar tarjeta nueva", d.enlace),
      };
    }
    case "recordatorio_cita": {
      const d = datos as DatosPlantilla["recordatorio_cita"];
      const cuerpo = `<p>Le recordamos la cita de ${d.nombrePaciente} el ${d.fecha} a las ${d.hora} con ${d.medicoNombre}.</p>`;
      return {
        asunto: `Recordatorio de cita — ${d.nombrePaciente}`,
        texto: `Le recordamos la cita de ${d.nombrePaciente} el ${d.fecha} a las ${d.hora} con ${d.medicoNombre}.`,
        html: envolverLayoutInformativo("Recordatorio de cita", cuerpo),
      };
    }
    case "desparasitacion_proxima": {
      const d = datos as DatosPlantilla["desparasitacion_proxima"];
      const cuerpo = `<p>La próxima desparasitación de ${d.nombrePaciente} está recomendada para el ${d.fechaProxima}.</p>`;
      return {
        asunto: `Desparasitación próxima — ${d.nombrePaciente}`,
        texto: `La próxima desparasitación de ${d.nombrePaciente} está recomendada para el ${d.fechaProxima}.`,
        html: envolverLayoutInformativo("Desparasitación próxima", cuerpo),
      };
    }
    case "seguimiento_faltante": {
      const d = datos as DatosPlantilla["seguimiento_faltante"];
      const cuerpo =
        `<p>El caso de ${d.nombrePaciente} está en estado clínico "${d.estadoClinico}" y no tiene ` +
        `ninguna cita futura agendada — considerá programar un seguimiento.</p>`;
      return {
        asunto: `Seguimiento pendiente — ${d.nombrePaciente}`,
        texto:
          `El caso de ${d.nombrePaciente} está en estado clínico "${d.estadoClinico}" y no tiene ` +
          `ninguna cita futura agendada — considerá programar un seguimiento.`,
        html: envolverLayoutInformativo("Seguimiento pendiente", cuerpo),
      };
    }
    case "vacunacion_proxima": {
      const d = datos as DatosPlantilla["vacunacion_proxima"];
      const cuerpo = `<p>La próxima vacuna de ${d.nombrePaciente} (${d.vacuna}) está recomendada para el ${d.fechaProxima}.</p>`;
      return {
        asunto: `Vacunación próxima — ${d.nombrePaciente}`,
        texto: `La próxima vacuna de ${d.nombrePaciente} (${d.vacuna}) está recomendada para el ${d.fechaProxima}.`,
        html: envolverLayoutInformativo("Vacunación próxima", cuerpo),
      };
    }
    // prompt_code_notificaciones_pendientes.md, Parte B2 — "de cortesía",
    // al tutor. NO confundir con seguimiento_faltante, que es una alerta
    // interna al médico por severidad clínica; este pregunta cómo
    // evolucionó, sin ningún dato clínico.
    case "seguimiento_posterior_consulta": {
      const d = datos as DatosPlantilla["seguimiento_posterior_consulta"];
      const cuerpo = `<p>Esperamos que ${d.nombrePaciente} esté evolucionando bien. Si notás algo que te preocupe, no dudes en contactarnos.</p>`;
      return {
        asunto: `¿Cómo sigue ${d.nombrePaciente}?`,
        texto: `Esperamos que ${d.nombrePaciente} esté evolucionando bien. Si notás algo que te preocupe, no dudes en contactarnos.`,
        html: envolverLayoutInformativo(`¿Cómo sigue ${d.nombrePaciente}?`, cuerpo),
      };
    }
    case "agenda_dia_siguiente": {
      const d = datos as DatosPlantilla["agenda_dia_siguiente"];
      const filas = d.citas
        .map((c) => `<li>${c.hora} — ${c.pacienteNombre}${c.motivoConsulta ? ` (${c.motivoConsulta})` : ""}</li>`)
        .join("");
      const cuerpo = `<p>Tus citas para el ${d.fecha}:</p><ul>${filas}</ul>`;
      const textoLista = d.citas
        .map((c) => `${c.hora} — ${c.pacienteNombre}${c.motivoConsulta ? ` (${c.motivoConsulta})` : ""}`)
        .join(", ");
      return {
        asunto: `Tu agenda de mañana — ${d.fecha}`,
        texto: `Tus citas para el ${d.fecha}: ${textoLista}.`,
        html: envolverLayoutInformativo(`Tu agenda del ${d.fecha}`, cuerpo),
      };
    }
    case "confirmacion_cita": {
      const d = datos as DatosPlantilla["confirmacion_cita"];
      const cuerpo = `<p>Se registró la cita de ${d.nombrePaciente} para el ${d.fecha} a las ${d.hora} con ${d.medicoNombre}.</p>`;
      return {
        asunto: `Cita confirmada — ${d.nombrePaciente}`,
        texto: `Se registró la cita de ${d.nombrePaciente} para el ${d.fecha} a las ${d.hora} con ${d.medicoNombre}.`,
        html: envolverLayoutInformativo("Cita registrada", cuerpo),
      };
    }
    case "cita_cancelada_o_reprogramada": {
      const d = datos as DatosPlantilla["cita_cancelada_o_reprogramada"];
      const cuerpo = d.reprogramada
        ? `<p>La cita de ${d.nombrePaciente} del ${d.fechaOriginal} a las ${d.horaOriginal} se reprogramó ` +
          `para el <strong>${d.fechaNueva}</strong> a las <strong>${d.horaNueva}</strong>.</p>`
        : `<p>La cita de ${d.nombrePaciente} del ${d.fechaOriginal} a las ${d.horaOriginal} fue cancelada.</p>`;
      return {
        asunto: d.reprogramada ? `Cita reprogramada — ${d.nombrePaciente}` : `Cita cancelada — ${d.nombrePaciente}`,
        texto: d.reprogramada
          ? `La cita de ${d.nombrePaciente} del ${d.fechaOriginal} a las ${d.horaOriginal} se reprogramó para el ${d.fechaNueva} a las ${d.horaNueva}.`
          : `La cita de ${d.nombrePaciente} del ${d.fechaOriginal} a las ${d.horaOriginal} fue cancelada.`,
        html: envolverLayoutInformativo(d.reprogramada ? "Cita reprogramada" : "Cita cancelada", cuerpo),
      };
    }
    case "receta_emitida": {
      const d = datos as DatosPlantilla["receta_emitida"];
      const cuerpo =
        `<p>Adjuntamos la receta de ${d.nombrePaciente}, emitida el ${d.fecha} por ${d.medicoNombre}.</p>` +
        `<p>Son ${d.lineas === 1 ? "una indicación" : `${d.lineas} indicaciones`}. ` +
        `El PDF tiene la dosis, cada cuánto y por cuántos días de cada una.</p>` +
        `<p>Si algo no se entiende, consúltelo antes de administrarlo.</p>`;
      return {
        asunto: `Receta de ${d.nombrePaciente}`,
        texto:
          `Adjuntamos la receta de ${d.nombrePaciente}, emitida el ${d.fecha} por ${d.medicoNombre}.

` +
          `El PDF tiene la dosis, cada cuánto y por cuántos días de cada indicación.
` +
          `Si algo no se entiende, consúltelo antes de administrarlo.`,
        html: envolverLayoutInformativo("Receta médica", cuerpo),
      };
    }
    case "comprobante_electronico": {
      const d = datos as DatosPlantilla["comprobante_electronico"];
      const cuerpo =
        `<p>Adjuntamos tu ${d.tipoComprobanteNombre.toLowerCase()} electrónica por ${d.moneda} ${d.total}, emitida el ${d.fecha}.</p>` +
        `<p>Van dos archivos: el <strong>PDF</strong> para leerlo, y el <strong>XML</strong>, que es el documento con validez legal ` +
        `— conservalo si lo necesitás para tu contabilidad.</p>` +
        `<table style="border-collapse:collapse;font-size:14px;margin:16px 0">` +
        `<tr><td style="padding:2px 12px 2px 0;color:#5A6B82">Consecutivo</td><td style="padding:2px 0"><code>${d.consecutivo}</code></td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#5A6B82">Clave</td><td style="padding:2px 0"><code style="font-size:12px">${d.clave}</code></td></tr>` +
        `<tr><td style="padding:2px 12px 2px 0;color:#5A6B82">Estado en Hacienda</td><td style="padding:2px 0">${d.estadoHacienda}</td></tr>` +
        `</table>`;
      return {
        asunto: `${d.tipoComprobanteNombre} ${d.consecutivo} — ${d.moneda} ${d.total}`,
        texto:
          `Adjuntamos tu ${d.tipoComprobanteNombre.toLowerCase()} electrónica por ${d.moneda} ${d.total}, emitida el ${d.fecha}.

` +
          `Consecutivo: ${d.consecutivo}
Clave: ${d.clave}
Estado en Hacienda: ${d.estadoHacienda}

` +
          `Van dos archivos adjuntos: el PDF para leerlo y el XML, que es el documento con validez legal.`,
        html: envolverLayoutInformativo(d.tipoComprobanteNombre, cuerpo),
      };
    }
    case "informe_disponible": {
      const d = datos as DatosPlantilla["informe_disponible"];
      const cuerpo = `<p>El veterinario generó un nuevo informe clínico de ${d.nombrePaciente}. Consultalo en tu próxima visita a la clínica.</p>`;
      return {
        asunto: `Informe clínico disponible — ${d.nombrePaciente}`,
        texto: `El veterinario generó un nuevo informe clínico de ${d.nombrePaciente}. Consultalo en tu próxima visita a la clínica.`,
        html: envolverLayoutInformativo("Informe clínico disponible", cuerpo),
      };
    }
    // prompt_code_paciente_nacimiento_estado.md, Parte B3 — el único aviso
    // puramente comercial de los diez. Tono cálido y breve a propósito, SIN
    // ningún llamado a agendar ni mención de servicios: un saludo que
    // intenta vender pierde el efecto que lo justifica.
    case "cumpleanos": {
      const d = datos as DatosPlantilla["cumpleanos"];
      const cuerpo = `<p>¡Feliz cumpleaños, ${d.nombrePaciente}! 🎉 Todo el equipo te manda un saludo muy cariñoso.</p>`;
      return {
        asunto: `¡Feliz cumpleaños, ${d.nombrePaciente}!`,
        texto: `¡Feliz cumpleaños, ${d.nombrePaciente}! Todo el equipo te manda un saludo muy cariñoso.`,
        html: envolverLayoutInformativo(`¡Feliz cumpleaños, ${d.nombrePaciente}!`, cuerpo),
      };
    }
    case "cuenta_suspendida_manual": {
      const d = datos as DatosPlantilla["cuenta_suspendida_manual"];
      const cuerpo =
        `<p>Tu cuenta en Vetline Ai fue suspendida por nuestro equipo${d.motivo ? ` (motivo: ${d.motivo})` : ""}.</p>` +
        `<p>Qué significa concretamente:</p>` +
        `<ul>` +
        `<li>No se otorga crédito nuevo de inteligencia artificial.</li>` +
        `<li>El saldo que ya tenías — incluido el comprado — sigue disponible y utilizable.</li>` +
        `<li>El acceso a expedientes, agenda, recetas e informes no se interrumpe.</li>` +
        `</ul>` +
        `<p>Esta suspensión no se levanta automáticamente con un pago: si tenés dudas, contactanos.</p>`;
      return {
        asunto: "Tu cuenta en Vetline Ai fue suspendida",
        texto:
          `Tu cuenta en Vetline Ai fue suspendida por nuestro equipo${d.motivo ? ` (motivo: ${d.motivo})` : ""}. ` +
          `No se otorga crédito nuevo, pero tu saldo existente y el acceso a expedientes, agenda, recetas e informes siguen disponibles. ` +
          `Contactanos si tenés dudas: ${d.enlace}`,
        html: envolverLayout("Tu cuenta fue suspendida", cuerpo, "Contactar a soporte", d.enlace),
      };
    }
    case "entrada_ventana_cierre": {
      const d = datos as DatosPlantilla["entrada_ventana_cierre"];
      const cuerpo =
        `<p>Después de varios períodos sin poder procesar el cobro de tu suscripción, tu cuenta entró en ventana de cierre.</p>` +
        `<p>Los datos de tu clínica se eliminan el <strong>${d.fechaEliminacion}</strong> si no regularizás el pago antes.</p>` +
        `<p>Mientras tanto podés seguir consultando tus casos y <a href="${d.enlaceExportar}">exportar toda tu información</a>. ` +
        `Regularizar el pago cancela el cierre y restaura el acceso completo de inmediato.</p>`;
      return {
        asunto: "Tu cuenta en Vetline Ai entró en ventana de cierre",
        texto:
          `Después de varios períodos sin poder procesar el cobro de tu suscripción, tu cuenta entró en ventana de cierre. ` +
          `Tus datos se eliminan el ${d.fechaEliminacion} si no regularizás el pago antes. ` +
          `Podés exportar tu información en ${d.enlaceExportar} o regularizar tu pago en ${d.enlacePlanes}.`,
        html: envolverLayout("Tu cuenta entró en ventana de cierre", cuerpo, "Regularizar mi pago", d.enlacePlanes),
      };
    }
    case "recordatorio_cierre": {
      const d = datos as DatosPlantilla["recordatorio_cierre"];
      const cuerpo =
        `<p>En pocos días vamos a eliminar definitivamente los datos de tu clínica por impago prolongado, el <strong>${d.fechaEliminacion}</strong>.</p>` +
        `<p>Si todavía no <a href="${d.enlaceExportar}">exportaste tu información</a>, hacelo antes de esa fecha. ` +
        `Regularizar tu pago cancela el cierre y restaura el acceso completo.</p>`;
      return {
        asunto: "Últimos días antes de eliminar los datos de tu clínica",
        texto:
          `En pocos días vamos a eliminar definitivamente los datos de tu clínica por impago prolongado, el ${d.fechaEliminacion}. ` +
          `Exportá tu información en ${d.enlaceExportar} o regularizá tu pago en ${d.enlacePlanes} antes de esa fecha.`,
        html: envolverLayout("Últimos días antes de eliminar tus datos", cuerpo, "Regularizar mi pago", d.enlacePlanes),
      };
    }
    case "cuenta_bloqueada": {
      const d = datos as DatosPlantilla["cuenta_bloqueada"];
      const cuerpo =
        `<p>Tu cuenta en Vetline Ai fue bloqueada${d.motivo ? ` (motivo: ${d.motivo})` : ""}.</p>` +
        `<p>Ningún usuario de tu clínica puede acceder a la plataforma mientras dure el bloqueo. Tus datos NO fueron eliminados.</p>` +
        `<p>Si querés apelar esta decisión, contactá a nuestro equipo de soporte.</p>`;
      return {
        asunto: "Tu cuenta en Vetline Ai fue bloqueada",
        texto:
          `Tu cuenta en Vetline Ai fue bloqueada${d.motivo ? ` (motivo: ${d.motivo})` : ""}. ` +
          `Ningún usuario de tu clínica puede acceder mientras dure el bloqueo. Tus datos no fueron eliminados. ` +
          `Contactá a soporte si querés apelar: ${d.enlaceSoporte}`,
        html: envolverLayout("Tu cuenta fue bloqueada", cuerpo, "Contactar a soporte", d.enlaceSoporte),
      };
    }
    // prompt_code_panel_consumo_sin_api — aviso interno (destinatario es
    // el correo configurado en saldo_proveedor.correo_destino, no un
    // cliente). El saldo es una ESTIMACIÓN derivada (recargas menos
    // costo de uso_api), no el número real del proveedor — el correo lo
    // dice explícitamente para que no se tome como definitivo.
    case "saldo_proveedor_bajo": {
      const d = datos as DatosPlantilla["saldo_proveedor_bajo"];
      const cuerpo =
        `<p>El saldo <strong>estimado</strong> de la cuenta de Anthropic bajó de USD ${d.umbralUsd.toFixed(2)}: ` +
        `ahora está en USD ${d.saldoUsd.toFixed(2)}.</p>` +
        `<p>Este número es una derivación (recargas registradas menos el consumo ya calculado en la plataforma), ` +
        `no el saldo real del proveedor. <strong>Verificalo en la consola de Anthropic antes de decidir una recarga.</strong></p>`;
      return {
        asunto: `Saldo estimado del proveedor de IA por debajo de USD ${d.umbralUsd.toFixed(2)}`,
        texto:
          `El saldo estimado de la cuenta de Anthropic bajó de USD ${d.umbralUsd.toFixed(2)} (ahora USD ${d.saldoUsd.toFixed(2)}). ` +
          `Es una derivación, no el número real del proveedor — verificalo en la consola de Anthropic antes de decidir una recarga.`,
        html: envolverLayoutInformativo("Saldo estimado del proveedor de IA bajo", cuerpo),
      };
    }
    // prompt_code_restablecer_contrasena, Paso 3 — un solo uso, vigencia
    // corta (1h, mucho menos que las 72h de verificación de correo). El
    // párrafo "si no fuiste vos" es obligatorio: sin él, alguien que no
    // pidió esto no sabe que puede ignorarlo con tranquilidad.
    case "restablecimiento_contrasena": {
      const d = datos as DatosPlantilla["restablecimiento_contrasena"];
      const saludo = d.nombre ? `Hola ${d.nombre},` : "¡Hola!";
      const cuerpo =
        `<p>${saludo}</p>` +
        `<p>Recibimos un pedido para restablecer tu contraseña en Vetline Ai. El enlace es válido por ${d.vigenciaMinutos} minutos.</p>` +
        `<p>Si no fuiste vos quien lo pidió, no hace falta que hagas nada: tu contraseña no cambió y el enlace vence solo.</p>`;
      return {
        asunto: "Restablecé tu contraseña en Vetline Ai",
        texto:
          `${saludo} Recibimos un pedido para restablecer tu contraseña en Vetline Ai. ` +
          `El enlace es válido por ${d.vigenciaMinutos} minutos: ${d.enlace} ` +
          `Si no fuiste vos, no hace falta que hagas nada: tu contraseña no cambió y el enlace vence solo.`,
        html: envolverLayout("Restablecé tu contraseña", cuerpo, "Elegir una contraseña nueva", d.enlace),
      };
    }
    // Paso 5 — la única señal que tiene alguien cuya cuenta fue tomada:
    // si le llega este aviso sin haberlo pedido, sabe que algo pasó. Sin
    // botón/enlace a propósito: es una notificación, no una acción.
    case "contrasena_cambiada": {
      const d = datos as DatosPlantilla["contrasena_cambiada"];
      const saludo = d.nombre ? `Hola ${d.nombre},` : "¡Hola!";
      const cuerpo =
        `<p>${saludo}</p>` +
        `<p>Tu contraseña en Vetline Ai cambió el <strong>${d.fecha}</strong>.</p>` +
        `<p>Si fuiste vos, no hace falta que hagas nada más. Si no reconocés este cambio, contactá a nuestro equipo de soporte de inmediato: ${urlSoporte()}</p>`;
      return {
        asunto: "Tu contraseña en Vetline Ai cambió",
        texto:
          `${saludo} Tu contraseña en Vetline Ai cambió el ${d.fecha}. ` +
          `Si fuiste vos, no hace falta que hagas nada más. Si no reconocés este cambio, contactá a soporte de inmediato: ${urlSoporte()}`,
        html: envolverLayoutInformativo("Tu contraseña cambió", cuerpo),
      };
    }
  }
}

export function urlPlanes(): string {
  return `${config.frontendUrl}/admin/plan-consumo/cambiar-plan`;
}

export function urlExportar(): string {
  return `${config.frontendUrl}/admin/plan-consumo/exportar`;
}

export function urlVerificarCorreo(token: string): string {
  return `${config.frontendUrl}/verificar-correo/${token}`;
}

export function urlRestablecerContrasena(token: string): string {
  return `${config.frontendUrl}/restablecer-contrasena/${token}`;
}

export function urlDatosClinica(): string {
  return `${config.frontendUrl}/admin/clinica`;
}

// Canal de contacto para el correo de bloqueo (spec: "el motivo se
// comunica por correo al administrador, no en una pantalla que
// cualquier usuario de la clínica puede ver" — acá sí corresponde, es el
// admin quien recibe este correo).
export function urlSoporte(): string {
  return "mailto:soporte@vetlineai.com";
}

export function urlMedioPago(): string {
  return `${config.frontendUrl}/admin/facturacion/medio-de-pago`;
}

export function urlRecargar(): string {
  return `${config.frontendUrl}/admin/plan-consumo/recargar`;
}

export function urlInvitacion(token: string): string {
  return `${config.frontendUrl}/invitacion/${token}`;
}

// Único destinatario válido de los correos de cuenta/cobro: el admin de
// clínica, mismo criterio que purga.ts (excluye un correo que ya rebotó
// — no tiene sentido seguir intentando ahí).
export async function obtenerAdminClinica(
  db: EjecutorSql,
  tenantId: string
): Promise<{ email: string; nombreClinica: string } | null> {
  const result = await db.query(
    `SELECT p.email, t.nombre AS nombre_clinica
     FROM personas p JOIN tenants t ON t.id = p.tenant_id
     WHERE p.tenant_id = $1 AND p.es_admin_clinica = true AND p.correo_rebotado_en IS NULL
     LIMIT 1`,
    [tenantId]
  );
  const fila = result.rows[0];
  return fila ? { email: fila.email, nombreClinica: fila.nombre_clinica } : null;
}

// Best-effort, igual que el resto del proyecto (purga.ts, invitaciones.ts):
// un fallo de correo nunca debe tirar abajo el flujo que lo dispara. Cada
// intento — exitoso o no — queda en correos_enviados; ese registro es lo
// que permite demostrar que se avisó, y sobrevive a la eliminación del
// tenant (columna sin FK, ver migración 036) A PROPÓSITO — no es que
// falte la FK por descuido: purgar sus filas junto con el tenant
// destruiría exactamente la evidencia de que se avisó antes de eliminar
// los datos, que es lo que esta auditoría existe para demostrar
// (prompt_code_optimizacion_contexto, Cambio 4 — confirmado con el
// usuario explícitamente). Devuelve el id de
// correos_enviados (no el de Resend) para que el llamador pueda guardar el
// proveedor_message_id en la misma fila cuando corresponda (verificación
// de correo — ver verificacionCorreo.ts) sin otra ida y vuelta.
export async function enviarCorreoTransaccional<T extends TipoCorreo>(
  db: EjecutorSql,
  tenantId: string | null,
  destinatario: string,
  tipo: T,
  datos: DatosPlantilla[T],
  // Los adjuntos son un dato del ENVÍO, no de la plantilla: la plantilla
  // dice qué se escribe y esto qué se acompaña. De ahí que vaya como
  // parámetro aparte y opcional, en vez de meter un Buffer dentro de
  // DatosPlantilla, donde lo tendrían que ignorar las otras 27.
  adjuntos?: AdjuntoEmail[]
): Promise<{ correoEnviadoId: string | null; proveedorMessageId: string | null; resultado: "enviado" | "fallido" | "no_configurado" }> {
  if (!resendConfigurado()) return { correoEnviadoId: null, proveedorMessageId: null, resultado: "no_configurado" };
  // Quién firma este correo — ver marcaCorreo.ts. En los correos al
  // consumidor final el nombre visible del remitente también es el del
  // comercio: si el encabezado dice la clínica y la bandeja dice
  // "Vetline Ai", la incoherencia se nota más que antes. El DOMINIO no
  // cambia (es el que autentica DKIM), solo el nombre.
  const marca = await resolverMarca(db, tipo, tenantId);
  const { asunto, texto, html } = construirCorreo(tipo, datos, marca);
  try {
    const { id: proveedorMessageId } = await enviarEmail(destinatario, asunto, texto, html, {
      nombreRemitente: marca.esComercio ? marca.nombre : null,
      replyTo: marca.replyTo,
      adjuntos,
    });
    const insert = await db.query(
      `INSERT INTO correos_enviados (tenant_id, destinatario, tipo, resultado, proveedor_message_id)
       VALUES ($1, $2, $3, 'enviado', $4) RETURNING id`,
      [tenantId, destinatario, tipo, proveedorMessageId]
    );
    return { correoEnviadoId: insert.rows[0].id, proveedorMessageId, resultado: "enviado" };
  } catch (err) {
    console.error(`correos: no se pudo enviar "${tipo}" a ${destinatario}`, err);
    // RETURNING id acá también (a diferencia de la versión anterior) — un
    // llamador que necesite referenciar esta fila (ej. notificaciones.job.ts,
    // vía notificaciones.correo_enviado_id) tiene que poder hacerlo incluso
    // cuando el envío falló: es la misma fila que el webhook de rebotes
    // podría actualizar después si el fallo fue un rebote tardío.
    let correoEnviadoId: string | null = null;
    try {
      const insertFallido = await db.query(
        `INSERT INTO correos_enviados (tenant_id, destinatario, tipo, resultado, error) VALUES ($1, $2, $3, 'fallido', $4) RETURNING id`,
        [tenantId, destinatario, tipo, err instanceof Error ? err.message : String(err)]
      );
      correoEnviadoId = insertFallido.rows[0].id;
    } catch (errLog) {
      console.error("correos: no se pudo registrar el envío fallido", errLog);
    }
    return { correoEnviadoId, proveedorMessageId: null, resultado: "fallido" };
  }
}
