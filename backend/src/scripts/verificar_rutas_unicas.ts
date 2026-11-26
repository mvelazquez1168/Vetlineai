// Ninguna URL se registra dos veces con el mismo método.
//
//   docker compose exec backend npx ts-node src/scripts/verificar_rutas_unicas.ts
//
// POR QUÉ EXISTE. El bloque A del expediente dejó un
// `POST /api/expediente/atenciones/:id/cerrar` que solo FIRMABA la
// atención. Al llegar el bloque B se agregó otro con la misma URL, que
// hace el cierre completo —los cargos a la caja, el inventario, los
// preventivos—. Express atiende la PRIMERA que coincide, así que la
// pantalla nueva firmaba la atención y los cargos se quedaban afuera: la
// atención quedaba cerrada con `cuenta_id` en NULL y la plata de esa
// consulta no existía en ninguna parte.
//
// Ningún verificador podía verlo: todos llaman a las funciones, no a las
// URL. Este recorre el árbol de routers de Express —la misma estructura
// que usa para decidir a quién le toca cada pedido— y falla si encuentra
// un método y una ruta repetidos.
//
// NO mira el código fuente con una expresión regular: mira el árbol
// ARMADO. Es la diferencia entre adivinar y preguntarle a Express.
import { app } from "../index";

interface Capa {
  name?: string;
  route?: {
    path: string | string[];
    methods: Record<string, boolean>;
  };
  handle?: { stack?: Capa[] };
  regexp?: RegExp;
  keys?: Array<{ name: string }>;
}

/**
 * De la expresión regular con la que Express monta un router, se
 * reconstruye el prefijo legible (`/api/expediente`).
 *
 * Express no guarda el `path` con el que se montó un router: guarda su
 * regexp compilada. Deshacerla es fiero pero es el único camino sin
 * reescribir cómo se montan 25 routers, y lo que importa —detectar dos
 * rutas iguales— no depende de que el prefijo quede perfecto: depende de
 * que la MISMA regexp produzca el MISMO prefijo, y eso sí se cumple.
 */
function prefijoDe(capa: Capa): string {
  if (!capa.regexp) return "";
  const fuente = capa.regexp.source;
  if (fuente === "^\\/?(?=\\/|$)") return "";
  const limpio = fuente
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\(\?:\(\[\^\\\/]\+\?\)\)/g, ":param");
  return limpio;
}

interface RutaRegistrada {
  metodo: string;
  ruta: string;
}

function recorrer(capas: Capa[], prefijo: string, salida: RutaRegistrada[]): void {
  for (const capa of capas) {
    if (capa.route) {
      const rutas = Array.isArray(capa.route.path) ? capa.route.path : [capa.route.path];
      for (const r of rutas) {
        for (const metodo of Object.keys(capa.route.methods)) {
          if (metodo === "_all") continue;
          salida.push({ metodo: metodo.toUpperCase(), ruta: `${prefijo}${r}` });
        }
      }
    } else if (capa.handle?.stack) {
      recorrer(capa.handle.stack, prefijo + prefijoDe(capa), salida);
    }
  }
}

function main(): void {
  const pila = (app as unknown as { _router?: { stack: Capa[] }; router?: { stack: Capa[] } });
  const stack = pila._router?.stack ?? pila.router?.stack;
  if (!stack) {
    console.error(
      "FALLO: no se pudo leer el árbol de rutas de Express. Si cambió la versión, acá hay que actualizar cómo se lee."
    );
    process.exit(1);
  }

  const rutas: RutaRegistrada[] = [];
  recorrer(stack, "", rutas);

  console.log(`${rutas.length} ruta(s) registradas.`);

  const vistas = new Map<string, number>();
  for (const r of rutas) {
    const clave = `${r.metodo} ${r.ruta}`;
    vistas.set(clave, (vistas.get(clave) ?? 0) + 1);
  }

  const duplicadas = [...vistas.entries()].filter(([, n]) => n > 1);

  if (duplicadas.length === 0) {
    console.log("\n[OK] ninguna URL está registrada dos veces con el mismo método.");
    console.log("\nTODO OK");
    process.exit(0);
  }

  console.error("\n[FALLO] hay rutas registradas más de una vez:\n");
  for (const [clave, n] of duplicadas) {
    console.error(`  ${n}×  ${clave}`);
  }
  console.error(
    "\nExpress atiende SOLO LA PRIMERA. La segunda es código muerto, y si hacen cosas\n" +
      "distintas —como el cierre de una atención que firma y el que además manda los\n" +
      "cargos a la caja— la que se ejecuta no es la que alguien quiso llamar.\n"
  );
  process.exit(1);
}

main();
