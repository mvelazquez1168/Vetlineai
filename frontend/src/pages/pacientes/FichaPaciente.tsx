import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditarPacienteModal } from "../../components/paciente/EditarPacienteModal";
import {
  Badge,
  BadgeVariant,
  Button,
  Card,
  CardTitle,
  CollapsibleSection,
  EmptyState,
  LoadingState,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { formatearFechaCorta } from "../../lib/formatFecha";
import {
  EventoCronologiaPaciente,
  FichaCompleta,
  TipoEventoCronologia,
  pacientesApi,
} from "../../lib/pacientesApi";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 3.3 — la ficha del paciente.
//
// Es la pantalla que no existía: hasta ahora el paciente solo se veía
// como fila de un wizard, dato de un caso o columna de una cita (ver el
// relevamiento §9.2).
//
// Accesible para médico y admin de clínica, el mismo gate que tiene
// `/api/pacientes` en el backend.
// ---------------------------------------------------------------------

const ETIQUETA_TIPO_EVENTO: Record<TipoEventoCronologia, string> = {
  atencion: "Atención",
  caso_apertura: "Caso abierto",
  caso_cierre: "Caso cerrado",
  vacunacion: "Vacunación",
  desparasitacion: "Desparasitación",
  receta: "Receta",
};

// Las variantes son las genéricas del Badge compartido, no colores
// propios de esta pantalla.
const VARIANTE_TIPO_EVENTO: Record<TipoEventoCronologia, BadgeVariant> = {
  atencion: "info",
  caso_apertura: "warning",
  caso_cierre: "success",
  vacunacion: "success",
  desparasitacion: "success",
  receta: "neutral",
};

const ETIQUETA_ESTADO_REPRODUCTIVO: Record<string, string> = {
  entero: "Entero",
  castrado: "Castrado",
  desconocido: "Desconocido",
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-wide text-text-muted">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-text-primary">{valor}</dd>
    </div>
  );
}

export function FichaPaciente() {
  const { id } = useParams<{ id: string }>();
  // El detalle de un caso vive en /admin/casos/:id, que es solo para
  // admin_clinica (el médico entra a sus casos por su área de trabajo,
  // con una ruta que necesita el agenteId y que la cronología no tiene).
  // Para un médico el caso se muestra como texto: mandarlo a una ruta
  // que lo va a rebotar a /unauthorized es peor que no enlazar.
  const { zonaHoraria, esAdminClinica } = useAuth();
  const [ficha, setFicha] = useState<FichaCompleta | null>(null);
  const [eventos, setEventos] = useState<EventoCronologiaPaciente[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);

  const cargar = useCallback(() => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    Promise.all([pacientesApi.obtener(id), pacientesApi.cronologia(id)])
      .then(([fichaData, cronoData]) => {
        setFicha(fichaData);
        setEventos(cronoData.eventos);
      })
      .catch((err) => setError(err.message))
      .finally(() => setIsLoading(false));
  }, [id]);

  useEffect(cargar, [cargar]);

  // Esqueleto en vez de "Cargando…": la ficha tiene encabezado, dos
  // tarjetas y cuatro secciones, así que la espera se siente como un
  // salto si no se ocupa el lugar de lo que viene.
  if (isLoading) {
    return (
      <div className="space-y-4">
        <LoadingState forma="lineas" cantidad={2} etiqueta="Cargando la ficha del paciente…" />
        <LoadingState forma="tarjetas" cantidad={3} />
      </div>
    );
  }
  if (error) return <p className="text-sm text-error">{error}</p>;
  if (!ficha) return null;

  const p = ficha.paciente;
  const edad =
    p.edad_anios === null
      ? "No registrada"
      : `${p.edad_anios} años${p.fecha_nacimiento_estimada ? " (estimada)" : ""}`;

  return (
    <div>
      <Link to="/pacientes" className="text-sm text-text-muted hover:text-primary">
        ← Pacientes
      </Link>

      {/* La alerta de manejo va ANTES de todo lo demás: su razón de ser es
          que se lea antes de tocar al animal. */}
      {p.alerta_manejo && (
        <p className="mt-4 rounded-lg bg-warning/20 px-4 py-3 text-sm font-semibold text-text-primary">
          Alerta de manejo: {p.alerta_manejo}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-primary">{p.nombre}</h1>
            <span className="font-mono text-sm text-text-muted">Expediente N.º {p.numero_expediente}</span>
            {p.estado === "fallecido" && (
              <Badge variant="neutral">
                Fallecido{p.fecha_fallecimiento ? ` · ${formatearFechaCorta(p.fecha_fallecimiento, zonaHoraria)}` : ""}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-text-muted">
            {p.especie}
            {p.raza ? ` · ${p.raza}` : ""} · {p.sexo ?? "sexo sin registrar"} ·{" "}
            {ETIQUETA_ESTADO_REPRODUCTIVO[p.estado_reproductivo] ?? p.estado_reproductivo} · {edad}
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditando(true)}>
          Editar ficha
        </Button>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle>Datos del paciente</CardTitle>
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            <Dato
              etiqueta="Fecha de nacimiento"
              valor={
                p.fecha_nacimiento
                  ? `${formatearFechaCorta(p.fecha_nacimiento, zonaHoraria)}${
                      p.fecha_nacimiento_estimada ? " (estimada)" : ""
                    }`
                  : "—"
              }
            />
            <Dato etiqueta="Microchip" valor={p.microchip ?? "—"} />
            <Dato etiqueta="Color" valor={p.color ?? "—"} />
            <div className="sm:col-span-3">
              <Dato etiqueta="Alergias" valor={p.alergias ?? "Sin alergias registradas"} />
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>Propietario</CardTitle>
          <dl className="mt-4 space-y-3">
            <Dato
              etiqueta="Nombre"
              valor={
                <Link to="/admin/propietarios" className="text-primary hover:underline">
                  {p.propietario_nombre}
                </Link>
              }
            />
            <Dato
              etiqueta="Identificación"
              valor={
                p.propietario_numero_identificacion
                  ? `${p.propietario_tipo_identificacion_etiqueta}: ${p.propietario_numero_identificacion}`
                  : "—"
              }
            />
            <Dato etiqueta="Teléfono" valor={p.propietario_telefono ?? "—"} />
            <Dato etiqueta="Correo" valor={p.propietario_email ?? "—"} />
          </dl>
        </Card>
      </div>

      <div className="mt-6 space-y-4">
        <CollapsibleSection titulo="Cronología">
          {eventos.length === 0 ? (
            <EmptyState
              icono="hora"
              titulo="Todavía no hay nada registrado"
              texto="Las atenciones, los casos, las vacunas, las desparasitaciones y las recetas emitidas de este paciente van a aparecer acá, en una sola línea de tiempo."
            />
          ) : (
            <ol className="space-y-3">
              {eventos.map((e) => (
                <li
                  key={`${e.tipo}-${e.referencia_id}`}
                  className="flex flex-wrap items-start gap-3 border-b border-black/5 pb-3 last:border-0 last:pb-0"
                >
                  <span className="w-28 flex-shrink-0 font-mono text-xs text-text-muted">
                    {formatearFechaCorta(e.fecha, zonaHoraria)}
                  </span>
                  <Badge variant={VARIANTE_TIPO_EVENTO[e.tipo]}>{ETIQUETA_TIPO_EVENTO[e.tipo]}</Badge>
                  <div className="min-w-[200px] flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      {e.caso_id && esAdminClinica ? (
                        <Link to={`/admin/casos/${e.caso_id}`} className="hover:underline">
                          {e.titulo}
                        </Link>
                      ) : (
                        e.titulo
                      )}
                    </p>
                    {e.detalle && <p className="text-sm text-text-muted">{e.detalle}</p>}
                    {e.medico_nombre && <p className="text-xs text-text-muted">{e.medico_nombre}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CollapsibleSection>

        <CollapsibleSection titulo={`Cuidados preventivos (${ficha.cuidadosPreventivos.length})`} defaultAbierto={false}>
          {ficha.cuidadosPreventivos.length === 0 ? (
            <p className="text-sm text-text-muted">No hay vacunas ni desparasitaciones registradas.</p>
          ) : (
            <ul className="space-y-2">
              {ficha.cuidadosPreventivos.map((c) => (
                <li key={c.id} className="text-sm text-text-primary">
                  <span className="font-semibold">
                    {c.tipo === "vacunacion" ? c.vacuna : `Desparasitación ${c.subtipo_desparasitacion ?? ""}`}
                  </span>{" "}
                  <span className="text-text-muted">
                    · aplicada {formatearFechaCorta(c.fecha_aplicacion, zonaHoraria)} · próxima{" "}
                    {formatearFechaCorta(c.fecha_proxima_recomendada, zonaHoraria)} · {c.registrado_por_nombre}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection titulo={`Casos (${ficha.casos.length})`} defaultAbierto={false}>
          {ficha.casos.length === 0 ? (
            <p className="text-sm text-text-muted">Este paciente todavía no tiene casos clínicos.</p>
          ) : (
            <ul className="space-y-2">
              {ficha.casos.map((c) => (
                <li key={c.id} className="text-sm">
                  {esAdminClinica ? (
                    <Link to={`/admin/casos/${c.id}`} className="font-semibold text-primary hover:underline">
                      Caso N.º {c.numero_expediente}
                    </Link>
                  ) : (
                    <span className="font-semibold text-text-primary">Caso N.º {c.numero_expediente}</span>
                  )}{" "}
                  <span className="text-text-muted">
                    · {c.agente_nombre} · {c.motivo}
                    {c.cerrado_en
                      ? ` · cerrado ${formatearFechaCorta(c.cerrado_en, zonaHoraria)}${
                          c.diagnostico_final ? `: ${c.diagnostico_final}` : ""
                        }${c.desenlace ? ` (${c.desenlace})` : ""}`
                      : ` · ${c.estado}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>

        <CollapsibleSection titulo={`Recetas emitidas (${ficha.recetas.length})`} defaultAbierto={false}>
          {ficha.recetas.length === 0 ? (
            <p className="text-sm text-text-muted">No hay recetas emitidas para este paciente.</p>
          ) : (
            <ul className="space-y-2">
              {ficha.recetas.map((r) => (
                <li key={r.id} className="text-sm text-text-primary">
                  <span className="font-semibold">{formatearFechaCorta(r.emitido_en, zonaHoraria)}</span>{" "}
                  <span className="text-text-muted">
                    · {r.medicamentos ?? "sin items"} · {r.medico_nombre} ·{" "}
                    {r.con_visita ? "con visita" : "sin visita"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CollapsibleSection>
      </div>

      {editando && (
        <EditarPacienteModal
          paciente={p}
          onClose={() => setEditando(false)}
          onGuardado={cargar}
        />
      )}
    </div>
  );
}
