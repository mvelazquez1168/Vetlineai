import { useEffect, useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { propietariosApi } from "../../lib/propietariosApi";
import { PacienteDePropietario, Propietario, workspaceApi } from "../../lib/workspaceApi";

interface FichaPropietarioModalProps {
  propietarioId: string;
  onClose: () => void;
  onGuardado?: (propietario: Propietario) => void;
}

// Sin pantalla de "ficha del paciente" tampoco existe una del propietario
// todavía — este modal cubre el pedido explícito: datos + mascotas,
// accesible desde el caso (CasoWorkspace) y desde la ficha del paciente
// (HistorialFarmacologicoModal). La identificación se muestra pero nunca
// se edita acá — ver propietarios.routes.ts, PATCH la ignora aunque venga
// en el body.
export function FichaPropietarioModal({ propietarioId, onClose, onGuardado }: FichaPropietarioModalProps) {
  const [propietario, setPropietario] = useState<Propietario | null>(null);
  const [pacientes, setPacientes] = useState<PacienteDePropietario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  }, [propietarioId]);

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

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {cargando && <p className="text-sm text-text-muted">Cargando…</p>}
          {error && <p className="text-sm text-error">{error}</p>}

          {!cargando && propietario && (
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
                <p className="text-sm font-semibold text-text-primary">
                  Mascotas ({pacientes.length})
                </p>
                {pacientes.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">Sin mascotas registradas.</p>
                ) : (
                  <ul className="mt-2 divide-y divide-black/5">
                    {pacientes.map((p) => (
                      <li key={p.id} className="py-2 text-sm text-text-primary">
                        {p.nombre}
                        <span className="text-text-muted">
                          {" "}
                          — {p.especie}
                          {p.raza ? `, ${p.raza}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
