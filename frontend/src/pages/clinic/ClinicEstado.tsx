import { PageHeader } from "../../components/ui";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge";
import { Card, CardDescription, CardTitle } from "../../components/ui/Card";
import { EstadoModulo, clinicApi } from "../../lib/clinicApi";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 2 — pantalla de aterrizaje de Vetline Clinic.
//
// Hoy solo dice qué módulos tiene la clínica; es también la prueba
// visible de que el gate del backend funciona (si el módulo `expediente`
// no está habilitado, la sección no aparece en el menú y este endpoint
// responde 403). A medida que lleguen los módulos reales, esta pantalla
// es donde van a colgarse.
// ---------------------------------------------------------------------
export function ClinicEstado() {
  const [modulos, setModulos] = useState<EstadoModulo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    clinicApi
      .estado()
      .then((data) => setModulos(data.modulos))
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        titulo="Vetline Clinic"
        subtitulo="Los módulos de gestión de la clínica. Se habilitan de a uno; los que todavía no están disponibles no muestran nada."
        icono="panel"
        modulo="admin"
      />

      {isLoading && <p className="mt-6 text-text-muted">Cargando…</p>}
      {error && <p className="mt-6 text-sm text-error">{error}</p>}

      {!isLoading && !error && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {modulos.map((m) => (
            <Card key={m.modulo}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle>{m.etiqueta}</CardTitle>
                  <CardDescription>{m.modulo}</CardDescription>
                </div>
                <Badge variant={m.habilitado ? "success" : "neutral"} dot>
                  {m.habilitado ? "Habilitado" : "No habilitado"}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
