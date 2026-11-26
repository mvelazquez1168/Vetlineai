import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardDescription, CardTitle, LoadingState, useToast,
  PageHeader,
} from "../../components/ui";
import { Alertas, formatearCantidad, inventarioApi } from "../../lib/inventarioApi";
import { plural } from "../../lib/plural";

// ---------------------------------------------------------------------
// Alertas de inventario: las seis del prompt, en una sola pantalla.
//
// El orden NO es alfabético, es por urgencia: lo que ya es un problema
// (vencido con existencia, envase abierto vencido, bajo mínimo) antes
// de lo que todavía es un aviso (por vencer a 30, 60, 90 días).
//
// Las listas vacías se muestran igual, diciendo que están vacías. Una
// sección que desaparece cuando no hay nada obliga a recordar cuántas
// secciones había para notar que falta una.
// ---------------------------------------------------------------------

interface Grupo {
  clave: keyof Alertas;
  titulo: string;
  descripcion: string;
  urgente?: boolean;
  columnas: Array<{ campo: string; etiqueta: string }>;
}

const GRUPOS: Grupo[] = [
  {
    clave: "lotesVencidosConExistencia",
    titulo: "Lotes vencidos que todavía tienen existencia",
    descripcion: "No se pueden vender ni aplicar. Hay que darlos de baja por vencimiento.",
    urgente: true,
    columnas: [
      { campo: "producto", etiqueta: "Producto" },
      { campo: "numero", etiqueta: "Lote" },
      { campo: "bodega", etiqueta: "Bodega" },
      { campo: "cantidad", etiqueta: "Cantidad" },
      { campo: "vencimiento_efectivo", etiqueta: "Venció" },
    ],
  },
  {
    clave: "envasesAbiertosVencidos",
    titulo: "Envases abiertos vencidos",
    descripcion:
      "Se abrieron hace más de lo que dura el producto una vez abierto. El lote puede estar en fecha; el envase no.",
    urgente: true,
    columnas: [
      { campo: "producto", etiqueta: "Producto" },
      { campo: "numero", etiqueta: "Lote" },
      { campo: "bodega", etiqueta: "Bodega" },
      { campo: "cantidad", etiqueta: "Cantidad" },
      { campo: "fecha_apertura", etiqueta: "Se abrió" },
      { campo: "vencimiento_apertura", etiqueta: "Venció" },
    ],
  },
  {
    clave: "bajoMinimo",
    titulo: "Bajo el mínimo",
    descripcion: "Hay menos de lo que la clínica definió como mínimo. Ya es tarde para pedir.",
    urgente: true,
    columnas: [
      { campo: "nombre", etiqueta: "Producto" },
      { campo: "existencia", etiqueta: "Hay" },
      { campo: "minimo", etiqueta: "Mínimo" },
    ],
  },
  {
    clave: "enPuntoReorden",
    titulo: "En punto de reorden",
    descripcion: "Todavía alcanza, pero es el momento de pedir. No incluye los que ya están bajo el mínimo.",
    columnas: [
      { campo: "nombre", etiqueta: "Producto" },
      { campo: "existencia", etiqueta: "Hay" },
      { campo: "punto_reorden", etiqueta: "Punto de reorden" },
    ],
  },
  {
    clave: "porVencer30",
    titulo: "Vencen en 30 días",
    descripcion: "",
    columnas: [
      { campo: "producto", etiqueta: "Producto" },
      { campo: "numero", etiqueta: "Lote" },
      { campo: "cantidad", etiqueta: "Cantidad" },
      { campo: "vencimiento_efectivo", etiqueta: "Vence" },
    ],
  },
  {
    clave: "porVencer60",
    titulo: "Vencen en 60 días",
    descripcion: "Incluye los de 30: es el horizonte más amplio, no un tramo aparte.",
    columnas: [
      { campo: "producto", etiqueta: "Producto" },
      { campo: "numero", etiqueta: "Lote" },
      { campo: "cantidad", etiqueta: "Cantidad" },
      { campo: "vencimiento_efectivo", etiqueta: "Vence" },
    ],
  },
  {
    clave: "porVencer90",
    titulo: "Vencen en 90 días",
    descripcion: "Incluye los de 30 y 60.",
    columnas: [
      { campo: "producto", etiqueta: "Producto" },
      { campo: "numero", etiqueta: "Lote" },
      { campo: "cantidad", etiqueta: "Cantidad" },
      { campo: "vencimiento_efectivo", etiqueta: "Vence" },
    ],
  },
];

function mostrar(valor: string | undefined, campo: string): string {
  if (valor === undefined || valor === null) return "—";
  if (campo.startsWith("venc") || campo.startsWith("fecha")) {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? valor : d.toLocaleDateString("es-CR");
  }
  if (["cantidad", "existencia", "minimo", "punto_reorden"].includes(campo)) {
    return formatearCantidad(valor);
  }
  return valor;
}

export function AlertasInventario() {
  const toast = useToast();
  const [alertas, setAlertas] = useState<Alertas | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    inventarioApi
      .alertas()
      .then(setAlertas)
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, []);

  if (cargando) return <LoadingState forma="tarjetas" cantidad={4} />;
  if (!alertas) return <p className="text-sm text-text-muted">No se pudieron cargar las alertas.</p>;

  const totalUrgentes =
    alertas.lotesVencidosConExistencia.length +
    alertas.envasesAbiertosVencidos.length +
    alertas.bajoMinimo.length;

  return (
    <div>
      <PageHeader
        titulo="Alertas de inventario"
        icono="aviso"
        modulo="inventario"
      />
      <p className="mt-1 text-sm text-text-muted">
        {totalUrgentes === 0
          ? "Nada urgente: no hay vencidos con existencia, envases abiertos vencidos ni productos bajo el mínimo."
          : `${plural(totalUrgentes, "cosa", "cosas")} para atender hoy.`}
      </p>

      <div className="mt-6 space-y-4">
        {GRUPOS.map((g) => {
          const filas = alertas[g.clave];
          return (
            <Card key={g.clave} className={g.urgente && filas.length > 0 ? "border-error/30" : ""}>
              <CardTitle>
                {g.titulo}
                <span className="ml-2 text-sm font-normal text-text-muted">({filas.length})</span>
              </CardTitle>
              {g.descripcion && <CardDescription>{g.descripcion}</CardDescription>}

              {filas.length === 0 ? (
                <p className="mt-3 text-sm text-text-muted">Nada en esta lista.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[520px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-black/5 text-xs uppercase text-text-muted">
                        {g.columnas.map((c) => (
                          <th key={c.campo} className="py-2">
                            {c.etiqueta}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={String(f.id ?? i)} className="border-b border-black/5">
                          {g.columnas.map((c) => (
                            <td key={c.campo} className="py-2">
                              {c.campo === "nombre" || c.campo === "producto" ? (
                                <span className="font-medium">{mostrar(f[c.campo], c.campo)}</span>
                              ) : (
                                mostrar(f[c.campo], c.campo)
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
