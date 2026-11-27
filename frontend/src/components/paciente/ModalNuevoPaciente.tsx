import { useEffect, useState } from "react";
import { Button, Input, Modal, useToast } from "../ui";
import { AvisoDuplicado } from "../propietario/AvisoDuplicado";
import {
  FormularioPropietario,
  useFormularioPropietario,
} from "../propietario/FormularioPropietario";
import { FormularioPaciente, useFormularioPaciente } from "./FormularioPaciente";
import { ClienteParecido, PosibleDuplicado } from "../../lib/propietariosApi";
import { pacientesApi } from "../../lib/pacientesApi";
import { Propietario, workspaceApi } from "../../lib/workspaceApi";

// ---------------------------------------------------------------------
// ALTA DE PACIENTE — anexo 07-03, A5.
//
// Un paciente no existe sin dueño, así que el modal empieza por ahí: se
// busca el cliente, y si no está se crea **en el mismo flujo**, sin
// salir ni perder lo escrito. Es el gesto real del mostrador: llega
// alguien con su perro y es la primera vez.
//
// El dueño se crea en la MISMA transacción que el paciente (el backend
// lo hace en una sola llamada): si el paciente falla, no queda un
// cliente suelto que nadie pidió.
//
// `propietarioFijo` es para «+ Agregar mascota» desde la ficha del
// cliente: ahí el dueño ya está elegido y el selector sobra.
// ---------------------------------------------------------------------

export function ModalNuevoPaciente({
  abierto,
  onCerrar,
  onCreado,
  propietarioFijo,
}: {
  abierto: boolean;
  onCerrar: () => void;
  onCreado: (pacienteId: string) => void;
  propietarioFijo?: { id: string; nombre: string };
}) {
  const toast = useToast();
  const formPaciente = useFormularioPaciente();
  const formDueno = useFormularioPropietario();

  const [busqueda, setBusqueda] = useState("");
  const [resultados, setResultados] = useState<Propietario[]>([]);
  const [elegido, setElegido] = useState<{ id: string; nombre: string } | null>(
    propietarioFijo ?? null
  );
  const [creandoDueno, setCreandoDueno] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ mensaje: string; candidatos: ClienteParecido[] } | null>(
    null
  );

  useEffect(() => {
    if (propietarioFijo) setElegido(propietarioFijo);
  }, [propietarioFijo]);

  // Typeahead con el mismo endpoint tolerante que ya usan el wizard y la
  // cita — no se inventa otra búsqueda.
  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setResultados([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(busqueda.trim())
        .then((r) => vivo && setResultados(r.propietarios))
        .catch(() => vivo && setResultados([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busqueda]);

  const cerrar = () => {
    formPaciente.reiniciar();
    formDueno.reiniciar();
    setBusqueda("");
    setResultados([]);
    setElegido(propietarioFijo ?? null);
    setCreandoDueno(false);
    setError(null);
    setDuplicado(null);
    onCerrar();
  };

  const guardar = async (confirmado: boolean) => {
    const problemaPaciente = formPaciente.validar();
    if (problemaPaciente) {
      setError(problemaPaciente);
      return;
    }
    if (!elegido && !creandoDueno) {
      setError("Elegí el propietario o registrá uno nuevo.");
      return;
    }
    if (creandoDueno) {
      const problemaDueno = formDueno.validar();
      if (problemaDueno) {
        setError(problemaDueno);
        return;
      }
    }

    setError(null);
    setGuardando(true);
    try {
      const { paciente } = await pacientesApi.crear(
        {
          ...formPaciente.aCampos(),
          ...(elegido
            ? { propietarioId: elegido.id }
            : { propietarioNuevo: formDueno.aCampos() as unknown as Record<string, unknown> }),
        },
        confirmado
      );
      toast.exito(`${paciente.nombre} quedó registrado con el expediente N.º ${paciente.numero_expediente}.`);
      onCreado(paciente.id);
      cerrar();
    } catch (err) {
      if (err instanceof PosibleDuplicado) {
        setDuplicado({ mensaje: err.message, candidatos: err.candidatos });
      } else {
        setError((err as Error).message);
      }
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open={abierto}
      onClose={cerrar}
      title="Nuevo paciente"
      hayCambios={formPaciente.sucio || formDueno.sucio}
      description={
        propietarioFijo
          ? `Una mascota más de ${propietarioFijo.nombre}.`
          : "Primero el propietario, después la mascota."
      }
      ancho="lg"
      footer={
        duplicado ? undefined : (
          <>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={() => void guardar(false)} disabled={guardando}>
              {guardando ? "Guardando…" : "Registrar paciente"}
            </Button>
          </>
        )
      }
    >
      {duplicado ? (
        <AvisoDuplicado
          mensaje={duplicado.mensaje}
          candidatos={duplicado.candidatos}
          ocupado={guardando}
          onUsarExistente={(c) => {
            // Se usa el cliente que ya existe y el paciente se crea
            // debajo de él: el dueño nuevo se descarta.
            setElegido({ id: c.id, nombre: c.nombre });
            setCreandoDueno(false);
            setDuplicado(null);
          }}
          onCrearIgual={() => {
            setDuplicado(null);
            void guardar(true);
          }}
          onCancelar={() => setDuplicado(null)}
        />
      ) : (
        <div className="space-y-5">
          {/* ---- El propietario ---- */}
          {!propietarioFijo && (
            <section>
              <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">
                Propietario
              </h3>

              {elegido ? (
                <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-black/10 p-3">
                  <span className="text-sm font-semibold text-text-primary">{elegido.nombre}</span>
                  <button
                    type="button"
                    className="text-xs font-semibold text-primary underline"
                    onClick={() => setElegido(null)}
                  >
                    Cambiar
                  </button>
                </div>
              ) : creandoDueno ? (
                <div className="mt-2 rounded-lg border border-black/10 p-3">
                  <FormularioPropietario form={formDueno} deshabilitado={guardando} />
                  <button
                    type="button"
                    className="mt-2 text-xs font-semibold text-primary underline"
                    onClick={() => setCreandoDueno(false)}
                  >
                    Buscar uno que ya existe
                  </button>
                </div>
              ) : (
                <div className="mt-2">
                  <Input
                    label="Buscar por nombre, teléfono o identificación"
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Empezá a escribir…"
                  />
                  {resultados.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-black/10">
                      {resultados.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                            onClick={() => {
                              setElegido({ id: p.id, nombre: p.nombre });
                              setBusqueda("");
                            }}
                          >
                            <span className="font-semibold text-text-primary">{p.nombre}</span>
                            {p.telefono && (
                              <span className="ml-2 text-xs text-text-muted">{p.telefono}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button
                    type="button"
                    className="mt-2 w-full rounded-lg border border-black/15 py-2 text-sm font-semibold text-text-primary hover:bg-black/5"
                    onClick={() => setCreandoDueno(true)}
                  >
                    + Registrar un propietario nuevo
                  </button>
                </div>
              )}
            </section>
          )}

          {/* ---- La mascota ---- */}
          <section>
            <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted">Mascota</h3>
            <div className="mt-2">
              <FormularioPaciente form={formPaciente} deshabilitado={guardando} />
            </div>
          </section>

          {error && <p className="text-sm text-error">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
