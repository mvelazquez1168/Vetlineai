import { useEffect, useState } from "react";
import { LineaDeTiempoCliente } from "../crm/LineaDeTiempoCliente";
import { PanelConsentimientos } from "../crm/PanelConsentimientos";
import { Link } from "react-router-dom";
import { ModalNuevoPaciente } from "../paciente/ModalNuevoPaciente";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { useAuth } from "../../hooks/useAuth";
import { propietariosApi } from "../../lib/propietariosApi";
import { PacienteDePropietario, Propietario, workspaceApi } from "../../lib/workspaceApi";
import { RegistroAtencionModal } from "./RegistroAtencionModal";
import { ResolverCitaModal } from "./ResolverCitaModal";
import { etiqueta } from "../../lib/etiquetas";

interface FichaPropietarioModalProps {
  propietarioId: string;
  onClose: () => void;
  onGuardado?: (propietario: Propietario) => void;
}

// Ficha del propietario: datos + mascotas, accesible desde el caso
// (CasoWorkspace), desde el Registro de Atención (RegistroAtencionModal)
// y desde el listado de propietarios (admin). La identificación se
// muestra pero nunca se edita acá — ver propietarios.routes.ts, PATCH la
// ignora aunque venga en el body.
//
// Cada mascota enlaza a su ficha (/pacientes/:id), que existe desde
// vetline-clinic-01. Antes no había adónde ir y este modal era lo único
// parecido a una ficha de paciente.
export function FichaPropietarioModal({ propietarioId, onClose, onGuardado }: FichaPropietarioModalProps) {
  const { esMedico, user, zonaHoraria } = useAuth();
  const [propietario, setPropietario] = useState<Propietario | null>(null);
  const [pacientes, setPacientes] = useState<PacienteDePropietario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // prompt_code_registro_atencion.md, Paso 6 — "desde el paciente". Se
  // resuelve la cita primero (elegir/crear) y recién entonces se abre el
  // registro — mismo flujo de dos pasos que la puerta del caso.
  const [altaMascotaAbierta, setAltaMascotaAbierta] = useState(false);
  const [pacienteParaAtencion, setPacienteParaAtencion] = useState<PacienteDePropietario | null>(null);
  const [registroAtencionCitaId, setRegistroAtencionCitaId] = useState<string | null>(null);
  const [pestana, setPestana] = useState<"datos" | "linea" | "consentimientos">("datos");
  const [recargarPacientes, setRecargarPacientes] = useState(0);

  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [email, setEmail] = useState("");
  const [direccion, setDireccion] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  useEffect(() => {
    setCargando(true);
    Promise.all([propietariosApi.obtener(propietarioId), workspaceApi.listarPacientesDePropietario(propietarioId)])
      .then(([datosPropietario, datosPacientes]) => {
        setPropietario(datosPropietario.propietario);
        setNombre(datosPropietario.propietario.nombre);
        setTelefono(datosPropietario.propietario.telefono ?? "");
        setEmail(datosPropietario.propietario.email ?? "");
        setDireccion(datosPropietario.propietario.direccion ?? "");
        setPacientes(datosPacientes.pacientes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar el propietario."))
      .finally(() => setCargando(false));
  }, [propietarioId, recargarPacientes]);

  const guardar = async () => {
    if (!nombre.trim()) {
      setErrorGuardar("Falta el nombre.");
      return;
    }
    setGuardando(true);
    setErrorGuardar(null);
    setGuardadoOk(false);
    try {
      const { propietario: actualizado } = await propietariosApi.actualizar(propietarioId, {
        nombre: nombre.trim(),
        telefono: telefono.trim() || undefined,
        email: email.trim() || undefined,
        direccion: direccion.trim() || undefined,
      });
      setPropietario((prev) => (prev ? { ...prev, ...actualizado } : prev));
      setGuardadoOk(true);
      onGuardado?.(actualizado);
    } catch (err) {
      setErrorGuardar(err instanceof Error ? err.message : "No pudimos guardar los cambios.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <h2 className="text-lg font-bold text-primary">Ficha del propietario</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
            ✕
          </button>
        </div>

        {/* LAS PESTAÑAS DEL CLIENTE (prompt 03, seccion 7). La ficha ya
            era el lugar donde se mira un cliente; la linea de tiempo y
            los consentimientos entran aca y no en una pantalla aparte,
            porque son del mismo cliente y abrir dos lugares para ver a
            la misma persona es lo que hace que uno de los dos quede
            desactualizado. */}
        {!cargando && propietario && (
          <div className="flex gap-1 border-b border-black/5 px-6">
            {([
              ["datos", "Datos y mascotas"],
              ["linea", "Linea de tiempo"],
              ["consentimientos", "Consentimientos"],
            ] as const).map(([clave, etiqueta]) => (
              <button
                key={clave}
                type="button"
                onClick={() => setPestana(clave)}
                className={[
                  "whitespace-nowrap px-3 py-2 text-sm",
                  pestana === clave
                    ? "border-b-2 border-primary font-semibold text-primary"
                    : "text-text-muted hover:text-text-primary",
                ].join(" ")}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {cargando && <p className="text-sm text-text-muted">Cargando…</p>}
          {error && <p className="text-sm text-error">{error}</p>}

          {!cargando && propietario && pestana === "linea" && (
            <LineaDeTiempoCliente propietarioId={propietarioId} />
          )}
          {!cargando && propietario && pestana === "consentimientos" && (
            <PanelConsentimientos propietarioId={propietarioId} puedeEditar />
          )}

          {!cargando && propietario && pestana === "datos" && (
            <div className="flex flex-col gap-5">
              {propietario.numero_identificacion && (
                <div className="rounded-lg bg-background px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Identificación (no editable)
                  </p>
                  <p className="mt-1 text-sm text-text-primary">
                    {propietario.tipo_identificacion_etiqueta}: {propietario.numero_identificacion}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                <Input label="Teléfono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
                <Input label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                <Input label="Dirección" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
              </div>

              {errorGuardar && <p className="text-sm text-error">{errorGuardar}</p>}
              {guardadoOk && <p className="text-sm font-semibold text-success">✓ Cambios guardados</p>}

              <div className="flex justify-end">
                <Button onClick={guardar} disabled={guardando}>
                  {guardando ? "Guardando…" : "Guardar cambios"}
                </Button>
              </div>

              <div className="border-t border-black/5 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text-primary">
                    Mascotas ({pacientes.length})
                  </p>
                  {/* Anexo 07-03, A5: agregar una mascota desde la ficha
                      del cliente. Es el gesto natural y hasta ahora no
                      existía: había que abrir un caso o una cita. */}
                  <Button variant="secondary" onClick={() => setAltaMascotaAbierta(true)}>
                    + Agregar mascota
                  </Button>
                </div>
                {pacientes.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">Sin mascotas registradas.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-black/5">
                    {pacientes.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm text-text-primary">
                        <span>
                          {/* vetline-clinic-01, punto 3.3 — enlace a la
                              ficha del paciente, que antes no existía. */}
                          <Link to={`/pacientes/${p.id}`} className="font-semibold text-primary hover:underline">
                            {p.nombre}
                          </Link>
                          <span className="text-text-muted">
                            {" "}
                            — {etiqueta(p.especie)}
                            {p.raza ? `, ${p.raza}` : ""}
                          </span>
                        </span>
                        {esMedico && (
                          <button
                            type="button"
                            onClick={() => setPacienteParaAtencion(p)}
                            className="shrink-0 text-xs font-semibold text-accent hover:underline"
                          >
                            Registrar atención
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {pacienteParaAtencion && !registroAtencionCitaId && user?.userId && (
        <ResolverCitaModal
          pacienteId={pacienteParaAtencion.id}
          medicoId={user.userId}
          zonaHoraria={zonaHoraria}
          onClose={() => setPacienteParaAtencion(null)}
          onResuelto={(citaId) => {
            setRegistroAtencionCitaId(citaId);
          }}
        />
      )}

      {registroAtencionCitaId && pacienteParaAtencion && (
        <RegistroAtencionModal
          citaId={registroAtencionCitaId}
          pacienteId={pacienteParaAtencion.id}
          pacienteNombre={pacienteParaAtencion.nombre}
          especie={pacienteParaAtencion.especie}
          zonaHoraria={zonaHoraria}
          onClose={() => {
            setRegistroAtencionCitaId(null);
            setPacienteParaAtencion(null);
          }}
        />
      )}
      {propietario && (
        <ModalNuevoPaciente
          abierto={altaMascotaAbierta}
          onCerrar={() => setAltaMascotaAbierta(false)}
          propietarioFijo={{ id: propietario.id, nombre: propietario.nombre }}
          onCreado={() => {
            setAltaMascotaAbierta(false);
            // La lista de mascotas se recarga sola; `onGuardado` es
            // para cambios del CLIENTE y acá no cambió ninguno.
            setRecargarPacientes((n) => n + 1);
          }}
        />
      )}

    </div>
  );
}
