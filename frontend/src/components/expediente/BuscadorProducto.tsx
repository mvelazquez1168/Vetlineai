import { useEffect, useRef, useState } from "react";
import { Badge, Input, useToast } from "../ui";
import { atencionApi, ProductoClinico, TipoClinico } from "../../lib/expedienteApi";
import { inventarioApi, TipoClinicoProducto } from "../../lib/inventarioApi";
import { formatearMonto } from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// EL BUSCADOR DE PRODUCTOS DE LA ATENCIÓN — defecto del 2026-11-27,
// punto 3.
//
// Antes había una lista desplegable con los productos de un tipo
// clínico. Con el catálogo real cargado eso era, literalmente, un
// elemento: de los 897 productos de la clínica, 891 tienen
// `tipo_clinico` en NULL, y la receta ofrecía solo la Amoxicilina. Una
// lista desplegable tampoco sirve con 900 productos, ni con 300.
//
// Así que es un buscador, y busca por lo que la gente tiene a mano:
// el nombre, el código interno, el principio activo y el CÓDIGO DE
// BARRAS —que es lo que sale del lector, y es la forma más rápida y
// menos equivocable de elegir una vacuna con la caja en la mano—.
//
// MUESTRA LOS SIN CLASIFICAR con su etiqueta, y deja clasificarlos sin
// salir de acá. Esconderlos era el defecto; mostrarlos sin poder
// arreglarlos sería dejar la tarea pendiente para siempre.
// ---------------------------------------------------------------------

const MINIMO_LETRAS = 2;
const ESPERA_MS = 300;

export function BuscadorProducto({
  tipo,
  etiqueta,
  placeholder,
  puedeClasificar,
  onElegir,
  autoFocus = true,
}: {
  /** El tipo que esta acción quiere. `undefined` = la acción «Producto». */
  tipo?: TipoClinico;
  etiqueta?: string;
  placeholder?: string;
  /** Si se ofrece «Clasificar como…» en los sin clasificar. */
  puedeClasificar: boolean;
  onElegir: (p: ProductoClinico) => void;
  autoFocus?: boolean;
}) {
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ProductoClinico[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [resaltado, setResaltado] = useState(0);
  const [clasificando, setClasificando] = useState<string | null>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  // La primera carga sin texto trae lo que la clínica YA clasificó: es
  // el atajo para la vacuna de todos los días, sin teclear nada.
  useEffect(() => {
    let vivo = true;
    const consulta = texto.trim();
    if (consulta.length > 0 && consulta.length < MINIMO_LETRAS) {
      setResultados([]);
      return;
    }
    setBuscando(true);
    const t = window.setTimeout(() => {
      atencionApi
        .catalogoClinico(tipo, consulta || undefined)
        .then((r) => {
          if (!vivo) return;
          setResultados(r.productos);
          setResaltado(0);
        })
        .catch(() => vivo && setResultados([]))
        .finally(() => vivo && setBuscando(false));
    }, consulta ? ESPERA_MS : 0);
    return () => {
      vivo = false;
      window.clearTimeout(t);
    };
  }, [texto, tipo]);

  const clasificar = async (p: ProductoClinico, comoTipo: TipoClinicoProducto) => {
    setClasificando(p.productoId);
    try {
      await inventarioApi.clasificar([p.productoId], comoTipo);
      toast.exito(`«${p.nombre}» quedó como ${comoTipo}. Ya aparece en su acción.`);
      // Se refleja en el acto sin volver a pedir la lista: el producto
      // sigue en pantalla y el usuario ve que se aplicó.
      setResultados((rs) =>
        rs.map((x) =>
          x.productoId === p.productoId ? { ...x, tipoClinico: comoTipo as TipoClinico } : x
        )
      );
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setClasificando(null);
    }
  };

  const teclas = (e: React.KeyboardEvent) => {
    if (resultados.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setResaltado((i) => Math.min(i + 1, resultados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setResaltado((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = resultados[resaltado];
      if (p) onElegir(p);
    }
  };

  // Que la fila resaltada quede visible al moverse con el teclado: sin
  // esto, con treinta resultados el teclado "funciona" y no se ve nada.
  useEffect(() => {
    const fila = listaRef.current?.children[resaltado] as HTMLElement | undefined;
    fila?.scrollIntoView({ block: "nearest" });
  }, [resaltado]);

  const tipoParaClasificar: TipoClinicoProducto =
    tipo === "vacuna" ? "vacuna" : tipo === "antiparasitario" ? "antiparasitario" : "medicamento";

  return (
    <div>
      <Input
        label={etiqueta ?? "Buscar el producto"}
        value={texto}
        autoFocus={autoFocus}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={teclas}
        placeholder={placeholder ?? "Nombre, código, principio activo o código de barras"}
      />
      <p className="mt-1 text-xs text-text-muted">
        Desde dos letras. También sirve el lector de código de barras: apuntá y disparar.
      </p>

      {buscando && resultados.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">Buscando…</p>
      ) : resultados.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          {texto.trim().length >= MINIMO_LETRAS
            ? `Nada con «${texto.trim()}» en el inventario. Probá con menos letras, con el código, o revisá que el producto esté activo.`
            : "Escribí al menos dos letras."}
        </p>
      ) : (
        <ul
          ref={listaRef}
          className="mt-3 max-h-80 overflow-auto rounded-lg border border-black/10"
        >
          {resultados.map((p, i) => (
            <li
              key={p.presentacionId}
              className={i === resaltado ? "bg-primary-suave" : undefined}
            >
              <div className="flex items-start justify-between gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => onElegir(p)}
                  onMouseEnter={() => setResaltado(i)}
                  className="min-w-0 flex-1 text-left text-sm"
                >
                  <span className="flex flex-wrap items-center gap-1.5 font-medium text-text-primary">
                    {p.nombre}
                    <span className="text-text-muted">— {p.presentacion}</span>
                    {p.tipoClinico === null && (
                      <Badge
                        variant="info"
                        title="Nadie le puso el tipo clínico en el catálogo. Se puede usar igual, y conviene clasificarlo."
                      >
                        sin clasificar
                      </Badge>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-text-muted">
                    {/* EXISTENCIA Y PRECIO: es lo que hay que saber ANTES
                        de elegir. Recetar lo que no hay es una receta
                        que el cliente no puede llenar. */}
                    {p.existencia > 0
                      ? `${Number(p.existencia.toFixed(2))} en existencia`
                      : "sin existencia"}
                    {p.precio !== null ? ` · ${formatearMonto(p.precio)}` : ""}
                    {p.codigo ? ` · ${p.codigo}` : ""}
                    {p.principioActivo ? ` · ${p.principioActivo}` : ""}
                    {p.concentracion ? ` ${p.concentracion}` : ""}
                  </span>
                </button>
                {p.tipoClinico === null && puedeClasificar && (
                  <button
                    type="button"
                    onClick={() => void clasificar(p, tipoParaClasificar)}
                    disabled={clasificando === p.productoId}
                    className="shrink-0 text-xs font-semibold text-accent hover:underline disabled:opacity-50"
                    title="Lo deja clasificado en el catálogo, para que la próxima vez aparezca sin buscar."
                  >
                    {clasificando === p.productoId
                      ? "Clasificando…"
                      : `Es ${tipoParaClasificar}`}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
