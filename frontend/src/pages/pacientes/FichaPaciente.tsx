import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditarPacienteModal } from "../../components/paciente/EditarPacienteModal";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  LoadingState,
  Icono,
  PageHeader,
} from "../../components/ui";
import { FranjaAlertas } from "../../components/expediente/FranjaAlertas";
import { PestanasExpediente } from "../../components/expediente/PestanasExpediente";
import { useAuth } from "../../hooks/useAuth";
import { EncabezadoExpediente, expedienteApi } from "../../lib/expedienteApi";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { etiqueta } from "../../lib/etiquetas";
import {
  FichaCompleta,
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
  const { zonaHoraria, esAdminClinica, esMedico } = useAuth();
  const [ficha, setFicha] = useState<FichaCompleta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  // La pestaña abierta vive acá porque el encabezado también la cambia.
  const [pestana, setPestana] = useState("resumen");
  // El expediente clínico (prompt 07): la franja de alertas, la
  // completitud y las pestañas. Se pide aparte de la ficha porque son
  // dos preguntas distintas —quién es el paciente y qué le pasó— y la
  // ficha tiene que poder dibujarse aunque el expediente tarde.
  const [expediente, setExpediente] = useState<EncabezadoExpediente | null>(null);

  const cargar = useCallback(() => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    Promise.all([pacientesApi.obtener(id), pacientesApi.cronologia(id)])
      .then(([fichaData]) => {
        // La cronología que esta pantalla pedía aparte la trae ahora la
        // línea de tiempo del expediente, con filtros y búsqueda. Se
        // sigue pidiendo `cronologia` en el Promise.all porque es el
        // endpoint que valida que el paciente es de esta clínica y
        // porque sus datos siguen siendo los de la ficha del prompt 01.
        setFicha(fichaData);
      })
      .then(() =>
        expedienteApi
          .encabezado(id)
          .then(setExpediente)
          // Si el expediente falla, la ficha se muestra igual: lo que
          // no se puede es que un error en las alertas deje al médico
          // sin los datos del paciente.
          .catch(() => setExpediente(null))
      )
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
      {/* LA FRANJA DE ALERTAS va antes de todo lo demás: su razón de ser
          es que se lea antes de tocar al animal (prompt 07 §2).
          Reemplaza a la línea suelta de "alerta de manejo" que había
          acá: la franja ya la incluye, junto con las alergias, los
          preventivos vencidos, los hallazgos del groomer y los
          resultados de laboratorio sin revisar. Mostrar las dos cosas
          sería decir dos veces lo mismo.
          Si el expediente no cargó, se cae a la línea de antes: es
          mejor una alerta sola que ninguna. */}
      {expediente ? (
        <FranjaAlertas alertas={expediente.alertas} />
      ) : (
        p.alerta_manejo && (
          <p className="mt-4 rounded-lg bg-warning/20 px-4 py-3 text-sm font-semibold text-text-primary">
            Alerta de manejo: {p.alerta_manejo}
          </p>
        )
      )}

      {/* VARIANTE COMPACTA (prompt 01c, seccion 3): el expediente es
          una pantalla de trabajo largo. Al bajar, la franja queda como
          una barra delgada con el nombre del paciente, que es el dato
          que no se puede perder de vista mientras se escribe. El
          enlace al padre va DENTRO del encabezado y reemplaza el
          «← Pacientes» suelto que habia arriba de todo. */}
      <PageHeader
        variante="compacta"
        titulo={p.nombre}
        icono="paciente"
        modulo="expediente"
        padre={{ a: "/pacientes", etiqueta: "Pacientes" }}
        contexto={
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="font-mono">N.º {p.numero_expediente}</span>
            <span aria-hidden="true">·</span>
            <span>
              {etiqueta(p.especie)}
              {p.raza ? ` · ${p.raza}` : ""} · {p.sexo ? etiqueta(p.sexo) : "Sexo sin registrar"} ·{" "}
              {ETIQUETA_ESTADO_REPRODUCTIVO[p.estado_reproductivo] ?? p.estado_reproductivo} · {edad}
            </span>
            {p.estado === "fallecido" && (
              <Badge variant="neutral">
                Fallecido{p.fecha_fallecimiento ? ` · ${formatearFechaCorta(p.fecha_fallecimiento, zonaHoraria)}` : ""}
              </Badge>
            )}
          </span>
        }
        secundarias={
          <Button variant="secondary" onClick={() => setEditando(true)}>
            Editar ficha
          </Button>
        }
        accion={
          /* ACCIÓN RÁPIDA del prompt 07 §10: registrar la atención es lo
             que el médico viene a hacer. Lleva a su pestaña en vez de
             abrir un modal con el mismo formulario: dos lugares para
             escribir la misma consulta serían dos formularios que un día
             divergen. */
          esMedico && p.estado !== "fallecido" ? (
            <Button onClick={() => setPestana("atencion")}>
              <Icono nombre="agregar" className="mr-1 h-4 w-4" />
              Registrar atención
            </Button>
          ) : null
        }
      />

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
            {/* LAS ALERGIAS SALEN DEL EXPEDIENTE, no del campo de texto
                libre de la ficha. Esta fila mostraba `p.alergias` y
                decía «Sin alergias registradas» mientras la franja de
                arriba avisaba de una alergia a penicilina cargada en el
                expediente: el mismo dato en dos lugares, y el que decía
                que no hay nada era el más visible. El texto libre sigue
                existiendo —es una nota anterior al expediente— y se
                muestra como lo que es. */}
            <div className="sm:col-span-3">
              <Dato
                etiqueta="Alergias"
                valor={
                  expediente && expediente.alergias.length > 0
                    ? expediente.alergias
                        .map(
                          (a) =>
                            `${etiqueta(a.medicamento_nombre ?? a.sustancia)}${
                              a.grupo ? ` (grupo ${a.grupo})` : ""
                            } — ${etiqueta(a.severidad)}`
                        )
                        .join(" · ")
                    : "Sin alergias registradas"
                }
              />
            </div>
            {p.alergias && (
              <div className="sm:col-span-3">
                <Dato etiqueta="Nota de alergias en la ficha" valor={p.alergias} />
              </div>
            )}
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

      {/* EL INDICADOR DE COMPLETITUD y LAS PESTAÑAS del expediente
          (prompt 07, §2 y §3).

          Las pestañas REEMPLAZAN a las cuatro secciones colapsables que
          había acá (Cronología, Cuidados preventivos, Casos y Recetas):
          mostraban lo mismo que ahora muestran la línea de tiempo y sus
          pestañas por tipo, pero sin filtros, sin búsqueda y sin
          laboratorio, grooming ni consentimientos. Dejar las dos cosas
          sería dos vistas de la misma historia, que es justo lo que la
          guía rectora no quiere. Lo único que esas secciones tenían y
          las pestañas no —el enlace al detalle del caso— se conservó en
          la línea de tiempo. */}
      {expediente && (
        <>
          {expediente.completitud.faltan.length > 0 && (
            <div className="mt-6 rounded-xl border border-black/5 bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-text-primary">
                  Expediente completo al {expediente.completitud.porcentaje}%
                </p>
                <Button variant="secondary" onClick={() => setEditando(true)}>
                  Completar la ficha
                </Button>
              </div>
              <p className="mt-1 text-sm text-text-muted">
                Faltan: {expediente.completitud.faltan.join(", ")}.
              </p>
            </div>
          )}

          <PestanasExpediente
            pacienteId={id!}
            encabezado={expediente}
            onCambio={cargar}
            pestanaActiva={pestana}
            onPestana={setPestana}
          />
        </>
      )}

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
