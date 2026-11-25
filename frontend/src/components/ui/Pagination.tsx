import { Button } from "./Button";
import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// Pagination — reemplaza el bloque que estaba copiado a mano.
//
// El patrón "Mostrando X–Y de Z" + Anterior/Siguiente estaba escrito
// literal en cada pantalla paginada, con su propia constante POR_PAGINA
// y su propio cálculo de `desde`/`hasta`. Tres copias hoy
// (admin/Propietarios, pacientes/Pacientes, admin/Casos) y una por cada
// pantalla futura de Vetline Clinic. El cálculo del rango no es difícil,
// pero es exactamente la clase de cosa donde una copia dice "Mostrando
// 0–0 de 0" y las otras no.
//
// `porPagina` viene del BACKEND (`porPagina` de la respuesta), no de una
// constante del frontend: hoy las dos coinciden en 20, y el día que el
// backend cambie, una constante local haría que la pantalla calcule un
// rango distinto del que el servidor devolvió.
// ---------------------------------------------------------------------

export interface PaginationProps {
  /** Página actual, empezando en 1. */
  pagina: number;
  /** Total de registros, no de páginas. */
  total: number;
  /** Cuántos trae cada página — el valor que devolvió el backend. */
  porPagina: number;
  onPagina: (pagina: number) => void;
  /** Para el texto: "de 42 propietarios". Singular y plural. */
  sustantivo?: { singular: string; plural: string };
  className?: string;
}

export function Pagination({
  pagina,
  total,
  porPagina,
  onPagina,
  sustantivo = { singular: "registro", plural: "registros" },
  className = "",
}: PaginationProps) {
  // Sin registros no hay nada que paginar, y una barra que dice
  // "Mostrando 0–0 de 0" al lado de un estado vacío es ruido. Quien
  // muestra el EmptyState es la pantalla.
  if (total === 0) return null;

  const totalPaginas = Math.max(1, Math.ceil(total / porPagina));
  const desde = (pagina - 1) * porPagina + 1;
  const hasta = Math.min(pagina * porPagina, total);
  const etiqueta = total === 1 ? sustantivo.singular : sustantivo.plural;

  return (
    <div className={["mt-4 flex flex-wrap items-center justify-between gap-3", className].join(" ")}>
      <p className="text-sm text-text-muted">
        Mostrando {desde}–{hasta} de {total} {etiqueta}
      </p>
      <div className="flex items-center gap-3">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPagina(Math.max(1, pagina - 1))}
          disabled={pagina <= 1}
        >
          <Icono nombre="chevron-izquierda" tamano={16} />
          Anterior
        </Button>
        <span className="text-sm text-text-muted">
          Página {pagina} de {totalPaginas}
        </span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPagina(Math.min(totalPaginas, pagina + 1))}
          disabled={pagina >= totalPaginas}
        >
          Siguiente
          <Icono nombre="chevron-derecha" tamano={16} />
        </Button>
      </div>
    </div>
  );
}
