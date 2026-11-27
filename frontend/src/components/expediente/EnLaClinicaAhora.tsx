import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge, Button, Card, CardDescription, CardTitle, useToast } from "../ui";
import { atencionApi, expedienteApi, PacienteEnLaClinica } from "../../lib/expedienteApi";
import { useAuth } from "../../hooks/useAuth";
import { formatearHora } from "../../lib/formatFecha";

// ---------------------------------------------------------------------
// QUIÉN ESTÁ EN LA CLÍNICA AHORA — anexo 07-03, A2.
//
// La pregunta que la recepción hace veinte veces por día. El endpoint y
// el cliente se entregaron con A1/A2 y quedaron **sin ninguna pantalla
// que los consumiera**: por la sección 12 de la guía, una pantalla a la
// que no se llega no existe. Ésta es esa pantalla.
//
// NO ES HOSPITALIZACIÓN y el texto lo dice: son dos marcas de tiempo y
// una bandera, no una hoja de tratamiento.
//
// Se refresca sola cada minuto porque el tiempo de estancia envejece
// mientras alguien la mira. Un minuto alcanza: nadie decide nada por
// treinta segundos de diferencia.
// ---------------------------------------------------------------------

function duracion(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function EnLaClinicaAhora() {
  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [pacientes, setPacientes] = useState<PacienteEnLaClinica[]>([]);
  const [cargado, setCargado] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const cargar = useCallback(() => {
    expedienteApi
      .enLaClinica()
      .then((r) => setPacientes(r.pacientes))
      // Que no cargue no puede romper el inicio: es información de
      // apoyo, no el tablero.
      .catch(() => setPacientes([]))
      .finally(() => setCargado(true));
  }, []);

  useEffect(() => {
    cargar();
    const t = window.setInterval(cargar, 60_000);
    return () => window.clearInterval(t);
  }, [cargar]);

  const marcarSalida = async (atencionId: string, nombre: string) => {
    setOcupado(atencionId);
    try {
      await atencionApi.registrarSalida(atencionId);
      toast.exito(`${nombre} salió de la clínica.`);
      cargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(null);
    }
  };

  // Sin nadie adentro no se dibuja: una tarjeta que dice «no hay nadie»
  // ocupa el lugar de una que sí tiene algo que mostrar. Es el mismo
  // criterio que «Para resolver» en esta pantalla.
  if (!cargado || pacientes.length === 0) return null;

  return (
    <Card>
      <CardTitle>En la clínica ahora</CardTitle>
      <CardDescription>
        Pacientes que entraron y todavía no salieron. No es hospitalización: es quién está adentro y
        desde cuándo.
      </CardDescription>

      <ul className="mt-3 space-y-2">
        {pacientes.map((p) => (
          <li
            key={p.atencionId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/5 p-2"
          >
            <div className="min-w-0">
              <Link
                to={`/pacientes/${p.pacienteId}`}
                className="text-sm font-semibold text-primary hover:underline"
              >
                {p.paciente}
              </Link>
              <p className="text-xs text-text-muted">
                {[
                  p.propietario,
                  p.medico ? `con ${p.medico}` : null,
                  `desde las ${formatearHora(p.ingresoEn, zonaHoraria)}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {p.esEstancia && p.estanciaMotivo && (
                <p className="text-xs text-text-muted">Se queda: {p.estanciaMotivo}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={p.esEstancia ? "warning" : "info"}>
                {p.esEstancia ? "En estancia" : "En consulta"} · {duracion(p.minutosAdentro)}
              </Badge>
              <Button
                variant="secondary"
                disabled={ocupado === p.atencionId}
                onClick={() => void marcarSalida(p.atencionId, p.paciente)}
              >
                Marcar salida
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
