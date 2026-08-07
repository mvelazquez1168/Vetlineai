import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../../components/ui/Card";
import { useAuth } from "../../hooks/useAuth";
import { formatearFecha } from "../../lib/formatFecha";
import { ApiError } from "../../lib/apiError";
import { adminApi, Exportacion } from "../../lib/adminApi";

// Pantallas faltantes, Prompt B, Paso 3 — pantalla de exportación.
// Disponible siempre (no solo en ventana_purga/cancelada/finalizada, ver
// comentario de cabecera de POST /admin/exportaciones en el backend) — un
// cliente que se va tiene el mismo derecho a llevarse sus datos.
const ESTADO_LABEL: Record<Exportacion["estado"], string> = {
  pendiente: "En proceso",
  generando: "En proceso",
  lista: "Lista para descargar",
  descargada: "Descargada",
  fallida: "Falló",
};

const ESTADO_VARIANTE: Record<Exportacion["estado"], "success" | "warning" | "error" | "neutral"> = {
  pendiente: "warning",
  generando: "warning",
  lista: "success",
  descargada: "neutral",
  fallida: "error",
};

export function ExportacionPage() {
  const { zonaHoraria } = useAuth();
  const [exportaciones, setExportaciones] = useState<Exportacion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [solicitando, setSolicitando] = useState(false);
  const [descargandoId, setDescargandoId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervaloRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const cargar = () => {
    adminApi
      .listarExportaciones()
      .then((data) => setExportaciones(data.exportaciones))
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar las exportaciones."))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    cargar();
    return () => {
      if (intervaloRef.current) clearInterval(intervaloRef.current);
    };
  }, []);

  // Mientras haya alguna en 'pendiente'/'generando', se refresca sola cada
  // 4s hasta que todas queden resueltas — el POST responde apenas se crea
  // el registro, el .zip se arma en segundo plano (ver generarPaqueteExportacion).
  useEffect(() => {
    const hayEnProceso = exportaciones.some((e) => e.estado === "pendiente" || e.estado === "generando");
    if (hayEnProceso && !intervaloRef.current) {
      intervaloRef.current = setInterval(cargar, 4000);
    } else if (!hayEnProceso && intervaloRef.current) {
      clearInterval(intervaloRef.current);
      intervaloRef.current = null;
    }
  }, [exportaciones]);

  const solicitar = async () => {
    setSolicitando(true);
    setError(null);
    try {
      await adminApi.generarExportacion();
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos iniciar la exportación.");
    } finally {
      setSolicitando(false);
    }
  };

  const descargar = async (exportacion: Exportacion) => {
    setDescargandoId(exportacion.id);
    try {
      const { blob, filename } = await adminApi.descargarExportacion(exportacion.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? `exportacion_${exportacion.id}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No pudimos descargar la exportación.");
    } finally {
      setDescargandoId(null);
    }
  };

  if (isLoading) return <p className="text-text-muted">Cargando…</p>;

  return (
    <div className="max-w-3xl">
      <Link to="/admin/plan-consumo" className="text-sm font-medium text-accent hover:underline">
        ← Volver a Plan y consumo
      </Link>

      <div className="mt-4 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Exportar datos de la clínica</h1>
          <CardDescription>
            El archivo incluye todos tus casos con sus datos, los archivos adjuntos y los informes generados.
          </CardDescription>
        </div>
        <Button onClick={solicitar} disabled={solicitando}>
          {solicitando ? "Solicitando…" : "Solicitar exportación"}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      <Card className="mt-6">
        <CardTitle>Historial de exportaciones</CardTitle>
        {exportaciones.length === 0 ? (
          <p className="mt-4 text-sm text-text-muted">Todavía no solicitaste ninguna exportación.</p>
        ) : (
          <div className="mt-4 divide-y divide-black/5">
            {exportaciones.map((exp) => (
              <div key={exp.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="text-sm font-medium text-text-primary">
                    {formatearFecha(exp.creada_en, zonaHoraria, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                  <p className="text-xs text-text-muted">
                    {exp.casos_incluidos != null ? `${exp.casos_incluidos} casos` : "—"}
                    {exp.expira_en && exp.estado === "lista"
                      ? ` · disponible hasta ${formatearFecha(exp.expira_en, zonaHoraria, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={ESTADO_VARIANTE[exp.estado]}>{ESTADO_LABEL[exp.estado]}</Badge>
                  {(exp.estado === "lista" || exp.estado === "descargada") && (
                    <Button
                      variant="secondary"
                      onClick={() => descargar(exp)}
                      disabled={descargandoId === exp.id}
                    >
                      {descargandoId === exp.id ? "Descargando…" : "Descargar"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
