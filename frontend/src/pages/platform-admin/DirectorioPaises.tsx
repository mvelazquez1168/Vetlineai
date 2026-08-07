import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { PaisDirectorio, platformAdminApi } from "../../lib/platformAdminApi";

// Prompt A (platform_admin_registro), Paso 6 — Directorio de Países.

const ESTADO_LABEL: Record<PaisDirectorio["estado"], string> = {
  no_disponible: "No disponible",
  lista_espera: "Lista de espera",
  habilitado: "Habilitado",
};

const ESTADO_BADGE: Record<PaisDirectorio["estado"], BadgeVariant> = {
  no_disponible: "neutral",
  lista_espera: "warning",
  habilitado: "success",
};

export function DirectorioPaises() {
  const [paises, setPaises] = useState<PaisDirectorio[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    platformAdminApi.listarPaisesAdmin().then((r) => setPaises(r.paises)).finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-primary">Directorio de Países y Tributación</h1>
          <p className="mt-1 text-text-muted">
            Control de pasarelas de pago, impuestos nacionales y sistemas de facturación electrónica requeridos por mercado.
          </p>
        </div>
        <Link to="/platform-admin/paises/lista-espera">
          <Button variant="secondary">Lista de espera global</Button>
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-black/5 bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-background/60">
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">País</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Estado</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Moneda</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Impuesto</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Pasarela</th>
              <th className="px-6 py-3 text-xs font-bold uppercase text-primary">Fact. electrónica</th>
              <th className="px-6 py-3" />
            </tr>
          </thead>
          <tbody>
            {paises.map((p) => (
              <tr key={p.codigoIso} className="border-b border-black/5 last:border-0 hover:bg-background/40">
                <td className="px-6 py-4 font-semibold text-text-primary">{p.nombre}</td>
                <td className="px-6 py-4">
                  <Badge variant={ESTADO_BADGE[p.estado]}>{ESTADO_LABEL[p.estado]}</Badge>
                </td>
                <td className="px-6 py-4 text-text-muted">{p.monedaLiquidacion ?? p.monedaCotizacion}</td>
                <td className="px-6 py-4 text-text-muted">
                  {p.impuesto ? `${p.impuesto.nombre} ${(p.impuesto.tasa * 100).toFixed(0)}%` : "Pendiente"}
                </td>
                <td className="px-6 py-4 text-text-muted">{p.pasarelaCodigo ?? "Pendiente"}</td>
                <td className="px-6 py-4 text-text-muted">{p.proveedorFacturacion ?? "Pendiente"}</td>
                <td className="px-6 py-4 text-right">
                  <Link to={`/platform-admin/paises/${p.codigoIso}`}>
                    <Button variant="secondary">Configurar</Button>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
