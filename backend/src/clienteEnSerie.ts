import type { PoolClient } from "pg";

// ---------------------------------------------------------------------
// UNA CONSULTA A LA VEZ POR CONEXIÓN — defecto del 2026-11-27, punto 8.
//
// En el log aparecía, una y otra vez:
//
//   Calling client.query() when the client is already executing a query
//   is deprecated and will be removed in pg@9.0.
//
// Lo dispara cualquier `Promise.all([db.query(...), db.query(...)])`
// sobre el MISMO cliente, y hay once en el código: el detalle de una
// atención, los catálogos de inventario, el cierre de caja, la ficha
// del paciente… Hoy funciona porque `pg` las encola por dentro; en
// `pg@9` eso desaparece y esas pantallas van a romperse todas juntas.
//
// POR QUÉ ACÁ Y NO EN LOS ONCE LUGARES: arreglarlos uno por uno deja el
// defecto listo para volver en el doceavo. Una conexión es un recurso
// secuencial —el protocolo de Postgres lo es— y el lugar donde eso se
// impone es la conexión, no cada quien que la usa. Con esto, un
// `Promise.all` de consultas sigue siendo correcto: se ejecutan en
// orden, en vez de pisarse.
//
// LO QUE ESTO NO ARREGLA, y hay que saberlo: las consultas tampoco se
// ejecutan en paralelo DESPUÉS de esto, porque nunca pudieron. Si una
// pantalla necesita paralelismo de verdad, necesita conexiones
// distintas —y entonces no comparten transacción—. `Promise.all` sobre
// un cliente nunca fue más rápido; era solo más frágil.
// ---------------------------------------------------------------------

/**
 * Devuelve el mismo cliente, con `query` encolado.
 *
 * Es un `Proxy` y no una clase envolvente para que todo lo demás del
 * cliente —`release`, `on`, los campos internos que usa `pg`— siga
 * siendo exactamente lo que era.
 */
export function enSerie(client: PoolClient): PoolClient {
  // La cola: cada consulta se engancha al final de la anterior. El
  // `catch` vacío es a propósito —el error se le entrega a QUIEN hizo
  // esa consulta, no a la siguiente de la fila—.
  let ultima: Promise<unknown> = Promise.resolve();

  const query = (...args: unknown[]) => {
    const mia = ultima.then(
      () => (client.query as (...a: unknown[]) => Promise<unknown>)(...args),
      () => (client.query as (...a: unknown[]) => Promise<unknown>)(...args)
    );
    ultima = mia.catch(() => undefined);
    return mia;
  };

  return new Proxy(client, {
    get(destino, prop, receptor) {
      if (prop === "query") return query;
      const valor = Reflect.get(destino, prop, receptor);
      // Los métodos se atan al cliente real: llamados sobre el proxy
      // perderían su `this` y `pg` se rompe de formas difíciles de leer.
      return typeof valor === "function" ? valor.bind(destino) : valor;
    },
  });
}
