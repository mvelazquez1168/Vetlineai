import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { formatearFecha } from "../../lib/formatFecha";
import { ListaEsperaPaises as ListaEsperaData, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — Lista de espera global de países.

function badgePrioridad(cantidad: number) {
  if (cantidad >= 15) return "success" as const;
  if (cantidad >= 6) return "warning" as const;
  return "error" as const;
}

export function ListaEsperaPaises() {
  const navigate = useNavigate();
  const [data, setData] = useState<ListaEsperaData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.listarListaEsperaPaises().then(setData).finally(() => setIsLoading(false));
  }, []);

  if (isLoading || !data) return <p className="text-text-muted">Cargando…</p>;

  return (
    <div>
      <button onClick={() => navigate("/platform-admin/paises")} className="text-sm font-medium text-accent hover:underline">
        ← Volver al directorio de países
      </button>

      <div className="mt-2 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Lista de Espera Global</h1>
          <p className="mt-1 text-text-muted">Interesados en países no habilitados aún, para priorizar expansión.</p>
        </div>
        <div className="rounded-xl bg-primary px-4 py-2 text-white">
          Total interesados: <span className="font-bold">{data.totalInteresados}</span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {data.porPais.map((p) => (
          <div key={p.paisCodigo} className="rounded-xl border border-black/5 bg-surface p-4">
            <p className="text-sm text-text-muted">{p.paisNombre ?? p.paisCodigo}</p>
            <p className="mt-1 text-2xl font-bold text-primary">{p.cantidad}</p>
            <Badge variant={badgePrioridad(p.cantidad)} className="mt-1">
              Prioridad
            </Badge>
          </div>
        ))}
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/5 bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-background/60">
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Correo electrónico</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">País origen</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Fecha de registro</th>
            </tr>
          </thead>
          <tbody>
            {data.interesados.map((i) => (
              <tr key={i.id} className="border-b border-black/5 last:border-0">
                <td className="px-6 py-4 font-semibold text-text-primary">{i.correo}</td>
                <td className="px-6 py-4 text-text-muted">{i.paisNombre ?? i.paisCodigo ?? "—"}</td>
                <td className="px-6 py-4 text-text-muted">
                  {formatearFecha(i.creadoEn, undefined, { day: "2-digit", month: "short", year: "numeric" })}
                </td>
              </tr>
            ))}
            {data.interesados.length === 0 && (
              <tr>
                <td colSpan={3} className="px-6 py-8 text-center text-text-muted">
                  Todavía no hay interesados registrados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
