// NINGUNA RUTA CONTESTA SIN SESIÓN — salvo las que lo declaran.
//
//   docker compose exec backend npx ts-node \
//     src/scripts/verificar_rutas_sin_sesion.ts
//
// SIN --transpile-only. Entra al conjunto que corre ANTES DE CADA
// DESPLIEGUE.
//
// POR QUÉ EXISTE. El 2026-11-27, adelgazando `citas.routes.ts`, se
// borraron dos líneas y `/api/citas` quedó sin `authenticate`: toda la
// agenda, abierta. Lo descubrió un `TypeError` en un log, no una
// prueba. La guarda de arranque (`guardaDeRutas.ts`) comprueba que cada
// ROUTER pase por `authenticate`, y eso no alcanza: un router que
// autentica por ruta puede tener una ruta que se olvidó.
//
// ESTO NO LEE EL CÓDIGO: LLAMA. Enumera las rutas que Express tiene
// registradas de verdad —no una lista escrita a mano, que envejece en la
// primera ruta nueva— y le pega a cada una SIN cabecera de sesión. La
// que no conteste 401 o 403 está abierta.
//
// LOS PARÁMETROS VAN CON UUID INVENTADOS. Si una ruta estuviera abierta
// y además escribiera, el id no existe y no hay nada que tocar; y si
// escribe igual, es justamente lo que hay que saber antes de desplegar.

import { app } from "../index";
import { rutasRegistradas, RutaRegistrada } from "../guardaDeRutas";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const API = process.env.API_URL ?? "http://localhost:4000";
const UUID_INVENTADO = "00000000-0000-0000-0000-000000000000";

/**
 * Las rutas que SÍ contestan sin sesión, con su motivo.
 *
 * Cada una es una decisión. Un prefijo cubre sus hijas: las páginas por
 * token son muchas y todas por el mismo motivo.
 */
const PUBLICAS: Array<{ prefijo: string; porque: string }> = [
  { prefijo: "/api/health", porque: "salud del servicio: la mira el orquestador, sin sesión" },
  { prefijo: "/api/auth", porque: "iniciar sesión es lo que pasa ANTES de tener sesión" },
  {
    prefijo: "/api/registro-publico",
    porque: "el alta de una clínica nueva: todavía no hay nadie adentro",
  },
  {
    prefijo: "/api/invitaciones",
    porque: "página por token: la persona invitada entra con el enlace, no con una sesión",
  },
  {
    prefijo: "/api/verificar-correo",
    porque: "página por token: confirmar el correo desde el enlace del mensaje",
  },
  {
    prefijo: "/api/restablecer-contrasena",
    porque: "página por token: quien olvidó la contraseña no puede iniciar sesión",
  },
  {
    prefijo: "/api/firma",
    porque: "página por token: el cliente firma a distancia sin cuenta en el sistema",
  },
  {
    prefijo: "/api/webhooks",
    porque: "los llama la pasarela de pagos, que no tiene sesión; se validan por firma",
  },
  { prefijo: "/api/legal", porque: "los documentos legales son públicos por definición" },
  {
    prefijo: "/api/paises",
    porque: "catálogo que necesita el formulario de registro, antes de existir la clínica",
  },
  { prefijo: "/api/planes", porque: "los planes se muestran en la página de registro" },
];

let ok = true;
function fallo(msg: string) {
  console.log(`[FALLO] ${msg}`);
  ok = false;
}

const esPublica = (ruta: string) => PUBLICAS.find((p) => ruta.startsWith(p.prefijo));

/** `/api/pacientes/:id/notas/:notaId` → `/api/pacientes/0000…/notas/0000…` */
function concretar(ruta: string): string {
  return ruta.replace(/:[A-Za-z_]+/g, UUID_INVENTADO);
}

/** Las que no se pueden llamar sin romper algo ajeno a esta prueba. */
function seOmite(r: RutaRegistrada): string | null {
  if (!r.ruta.startsWith("/api/")) return "no es de la API";
  if (r.ruta.includes("*")) return "comodín: no es una ruta concreta";
  return null;
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_rutas_sin_sesion");

  const todas = rutasRegistradas(app);
  console.log(`Rutas registradas en Express: ${todas.length}`);

  const aProbar = todas.filter((r) => !seOmite(r));
  console.log(`Se prueban: ${aProbar.length}`);

  const abiertas: Array<RutaRegistrada & { estado: number }> = [];
  const publicasVistas = new Set<string>();

  for (const r of aProbar) {
    const url = `${API}${concretar(r.ruta)}`;
    let estado = 0;
    try {
      const resp = await fetch(url, {
        method: r.metodo,
        // Cuerpo vacío válido para los métodos que lo esperan: sin esto,
        // un 400 por JSON inválido taparía el 401 que se está buscando.
        headers: r.metodo === "GET" ? {} : { "Content-Type": "application/json" },
        body: r.metodo === "GET" || r.metodo === "HEAD" ? undefined : "{}",
      });
      estado = resp.status;
    } catch (err) {
      fallo(`${r.metodo} ${r.ruta} no respondió: ${(err as Error).message}`);
      continue;
    }

    const publica = esPublica(r.ruta);
    if (publica) {
      publicasVistas.add(publica.prefijo);
      continue;
    }

    if (estado !== 401 && estado !== 403) {
      abiertas.push({ ...r, estado });
    }
  }

  if (abiertas.length > 0) {
    console.log("");
    for (const a of abiertas) {
      fallo(
        `${a.metodo} ${a.ruta} contestó ${a.estado} SIN SESIÓN. ` +
          `O le falta authenticate, o es pública a propósito y va declarada en PUBLICAS con su motivo.`
      );
    }
  } else {
    console.log("\n[OK] Ninguna ruta privada contesta sin sesión.");
  }

  // Las públicas también se revisan: una entrada que ya no corresponde a
  // ninguna ruta es una excepción que quedó abierta de más.
  const sinUso = PUBLICAS.filter((p) => !publicasVistas.has(p.prefijo));
  if (sinUso.length > 0) {
    console.log("");
    for (const p of sinUso) {
      fallo(
        `«${p.prefijo}» está declarada pública y no corresponde a ninguna ruta registrada. ` +
          `Sáquela de PUBLICAS: una excepción que no cubre nada es una excepción que va a cubrir ` +
          `cualquier cosa el día que alguien monte algo ahí.`
      );
    }
  } else {
    console.log(`[OK] Las ${PUBLICAS.length} excepciones declaradas corresponden a rutas reales.`);
  }

  console.log("\nLas públicas, con su motivo:");
  for (const p of PUBLICAS) console.log(`  · ${p.prefijo} — ${p.porque}`);

  console.log(ok ? "\nTodo OK." : "\nHAY FALLOS.");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
