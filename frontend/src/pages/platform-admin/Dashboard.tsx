import { useEffect, useState } from "react";
import { Card } from "../../components/ui/Card";
import { Overview, platformApi } from "../../lib/platformApi";

export function Dashboard() {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    platformApi.obtenerOverview().then(setOverview);
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Dashboard</h1>
      <p className="mt-1 text-text-muted">Resumen general de la plataforma.</p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-3xl font-bold text-primary">{overview?.clinicasActivas ?? "—"}</p>
          <p className="text-sm text-text-muted">Clínicas activas</p>
        </Card>
        <Card>
          <p className="text-3xl font-bold text-primary">{overview?.agentesHabilitados ?? "—"}</p>
          <p className="text-sm text-text-muted">Agentes habilitados</p>
        </Card>
      </div>
    </div>
  );
}
