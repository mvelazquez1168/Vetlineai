import { useState } from "react";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { Badge, Button, Icono, Input, useToast } from "../ui";
import { atencionApi } from "../../lib/expedienteApi";
import { useAuth } from "../../hooks/useAuth";
import { formatearHora } from "../../lib/formatFecha";

// ---------------------------------------------------------------------
// INGRESO, SALIDA Y ESTANCIA — anexo del 07, A2.
//
// Tres datos y nada más: cuándo entró, cuándo salió y si se queda. Con
// eso alcanza para contestar «¿quién está adentro?», que es la pregunta
// que la recepción hace veinte veces por día.
//
// NO ES HOSPITALIZACIÓN, y el texto de la pantalla lo dice. El anexo lo
// deja explícito: hoja de tratamiento, jaulas y rondas son otro módulo,
// que puede colgarse de estos datos más adelante.
//
// LA HORA DE INGRESO NO SE EDITA ACÁ. Sale del check-in de la cita o de
// cuando se abrió la atención, y las dos son hechos registrados. Un
// campo editable invitaría a «corregirla» para que la estancia dé otro
// número.
//
// LA SALIDA SÍ SE DESHACE: alguien la marca, el dueño vuelve a entrar a
// preguntar algo y el paciente sigue adentro. Pasa.
// ---------------------------------------------------------------------

interface Props {
  atencionId: string;
  ingresoEn: string | null;
  salidaEn: string | null;
  esEstancia: boolean;
  estanciaMotivo: string | null;
  esMedico: boolean;
  onCambio: () => void;
}

function duracion(desde: string, hasta: string | null): string {
  const minutos = Math.max(
    0,
    Math.round(((hasta ? new Date(hasta).getTime() : Date.now()) - new Date(desde).getTime()) / 60000)
  );
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

export function IngresoYSalida({
  atencionId,
  ingresoEn,
  salidaEn,
  esEstancia,
  estanciaMotivo,
  esMedico,
  onCambio,
}: Props) {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const toast = useToast();
  const { zonaHoraria } = useAuth();
  const [editandoEstancia, setEditandoEstancia] = useState(false);
  const [motivo, setMotivo] = useState(estanciaMotivo ?? "");
  const [ocupado, setOcupado] = useState(false);

  if (!ingresoEn) return null;

  async function hacer(accion: () => Promise<unknown>, exito: string) {
    setOcupado(true);
    try {
      await accion();
      toast.exito(exito);
      onCambio();
    } catch (err) {
      toast.error((err as Error).message ?? "No se pudo completar la operación.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>} className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-black/5 pt-3 text-sm">
      {dialogoSalida}
      <span className="flex items-center gap-1 text-text-muted">
        <Icono nombre="hora" tamano={14} />
        Entró a las <strong className="text-text-primary">{formatearHora(ingresoEn, zonaHoraria)}</strong>
      </span>

      {salidaEn ? (
        <>
          <span className="text-text-muted">
            Salió a las{" "}
            <strong className="text-text-primary">{formatearHora(salidaEn, zonaHoraria)}</strong> ·
            estuvo {duracion(ingresoEn, salidaEn)}
          </span>
          <button
            type="button"
            className="text-xs font-semibold text-primary underline"
            disabled={ocupado}
            onClick={() => void hacer(() => atencionApi.deshacerSalida(atencionId), "Salida deshecha.")}
          >
            Deshacer la salida
          </button>
        </>
      ) : (
        <>
          <Badge variant={esEstancia ? "warning" : "info"}>
            {esEstancia ? "En estancia" : "En la clínica"} · {duracion(ingresoEn, null)}
          </Badge>
          <Button
            variant="secondary"
            disabled={ocupado}
            onClick={() => void hacer(() => atencionApi.registrarSalida(atencionId), "Salida registrada.")}
          >
            Marcar la salida
          </Button>
        </>
      )}

      {esEstancia && estanciaMotivo && (
        <span className="text-text-muted">Se queda: {estanciaMotivo}</span>
      )}

      {esMedico && !salidaEn && (
        <>
          {esEstancia ? (
            <button
              type="button"
              className="text-xs font-semibold text-primary underline"
              disabled={ocupado}
              onClick={() =>
                void hacer(() => atencionApi.marcarEstancia(atencionId, false), "Ya no es una estancia.")
              }
            >
              Ya no se queda
            </button>
          ) : editandoEstancia ? (
            <span className="flex items-center gap-2">
              <Input
                autoFocus
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                placeholder="Por qué se queda (observación, preparación…)"
                className="w-64"
              />
              <Button
                disabled={ocupado || !motivo.trim()}
                onClick={() =>
                  void hacer(async () => {
                    await atencionApi.marcarEstancia(atencionId, true, motivo);
                    setEditandoEstancia(false);
                  }, "Marcado como estancia.")
                }
              >
                Guardar
              </Button>
              <Button variant="secondary" onClick={() => setEditandoEstancia(false)}>
                Cancelar
              </Button>
            </span>
          ) : (
            <button
              type="button"
              className="text-xs font-semibold text-primary underline"
              onClick={() => setEditandoEstancia(true)}
            >
              Se queda en la clínica
            </button>
          )}
        </>
      )}
    </div>
  );
}
