import { useState } from "react";
import { Button, Input, Modal, Select, useToast } from "../ui";
import { atencionApi } from "../../lib/expedienteApi";

// ---------------------------------------------------------------------
// REGISTRAR UN LABORATORIO — anexo 07-03, A6.
//
// Se llamaba «Pedir un estudio» y solo sabía crear una orden. El caso
// normal de la clínica es el contrario: el laboratorio YA SE HIZO —acá
// o afuera, o lo trae el cliente de otra clínica— y lo que hay que
// hacer es dejar su resultado en el expediente, con el PDF o la foto
// del papel.
//
// Entonces el resultado es la acción PRINCIPAL, y pedir sin resultado
// queda como opción secundaria con el nombre de lo que hace: «todavía
// no tengo el resultado».
//
// EL ARCHIVO SUBE POR EL MISMO ENDPOINT que un adjunto de un caso de
// Vetline Ai —mismo límite de 25 MB, misma tabla de tipos, mismo
// almacenamiento privado, mismo control por clínica—. Lo único que
// cambia es a qué cuelga. El estudio se crea primero porque el archivo
// necesita algo a lo que colgarse.
//
// Vive en su propio archivo y no en `AccionesClinicas.tsx`: lo usan la
// atención y la pestaña Laboratorio del expediente, que es la otra
// puerta que pide el anexo («se puede adjuntar un laboratorio fuera de
// una atención»).
// ---------------------------------------------------------------------

const ESTUDIOS_SUGERIDOS = [
  "Hemograma",
  "Química sanguínea",
  "Urianálisis",
  "Coprológico",
  "Citología",
  "Raspado cutáneo",
  "Radiografía",
  "Ecografía abdominal",
];

export function ModalLaboratorio({
  abierto,
  onCerrar,
  onRegistrado,
  /** Desde la atención: el estudio queda ligado a la visita y puede cobrar. */
  atencionId,
  /** Desde la pestaña Laboratorio: sin atención y sin cargo. */
  pacienteId,
  servicios = [],
}: {
  abierto: boolean;
  onCerrar: () => void;
  onRegistrado: () => void;
  atencionId?: string;
  pacienteId?: string;
  servicios?: Array<{ id: string; nombre: string; precio: number | null }>;
}) {
  const toast = useToast();
  const [tipoEstudio, setTipoEstudio] = useState("");
  const [esExterno, setEsExterno] = useState(false);
  const [laboratorio, setLaboratorio] = useState("");
  const [servicioId, setServicioId] = useState("");
  const [observaciones, setObservaciones] = useState("");
  const [fechaMuestra, setFechaMuestra] = useState(new Date().toISOString().slice(0, 10));
  const [archivos, setArchivos] = useState<File[]>([]);
  const [sinResultado, setSinResultado] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const limpiar = () => {
    setTipoEstudio("");
    setObservaciones("");
    setArchivos([]);
    setSinResultado(false);
  };

  const registrar = async () => {
    setOcupado(true);
    try {
      const datos = {
        tipoEstudio,
        esExterno,
        laboratorio: esExterno ? laboratorio : null,
        servicioId: esExterno || !atencionId ? null : servicioId || null,
        observaciones: observaciones || null,
        conResultado: !sinResultado,
        fechaMuestra: sinResultado ? null : fechaMuestra,
      };
      const r = atencionId
        ? await atencionApi.pedirEstudio(atencionId, datos)
        : await atencionApi.registrarLaboratorioDePaciente(pacienteId!, datos);

      // Los archivos van DESPUÉS y de a uno: cada subida es
      // independiente, así una foto que falla no se lleva puesta a la
      // anterior ni al estudio, que ya quedó guardado.
      let fallados = 0;
      for (const archivo of archivos) {
        try {
          await atencionApi.adjuntarAlEstudio(r.id, archivo);
        } catch {
          fallados++;
        }
      }

      if (fallados > 0) {
        toast.error(
          `El laboratorio quedó registrado, pero ${fallados} de ${archivos.length} archivos no se subieron. Adjuntalos de nuevo desde la pestaña Laboratorio.`
        );
      } else if (sinResultado) {
        toast.exito("Queda pendiente de resultado.");
      } else {
        toast.exito(
          "conCargo" in r && r.conCargo
            ? "Laboratorio registrado, con su cargo en la cuenta."
            : "Laboratorio registrado."
        );
      }
      limpiar();
      onRegistrado();
      onCerrar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      open={abierto}
      onClose={onCerrar}
      title="Registrar laboratorio"
      description="Para un estudio que ya se hizo, acá o afuera. Queda en el expediente con su archivo."
      ancho="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={() => void registrar()} disabled={ocupado || !tipoEstudio.trim()}>
            {ocupado ? "Guardando…" : sinResultado ? "Dejar pendiente" : "Registrar"}
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          label="Estudio"
          value={tipoEstudio}
          onChange={(e) => setTipoEstudio(e.target.value)}
          placeholder="Hemograma, química sanguínea, radiografía…"
          list="estudios-sugeridos"
        />
        {/* Sugerencias, no una lista cerrada: el texto libre sigue
            valiendo porque ninguna lista cubre todo lo que se pide. */}
        <datalist id="estudios-sugeridos">
          {ESTUDIOS_SUGERIDOS.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>

        <label className="flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={esExterno}
            onChange={(e) => setEsExterno(e.target.checked)}
            className="h-4 w-4 rounded border-black/20"
          />
          Lo hizo un laboratorio externo
        </label>

        {esExterno ? (
          <Input
            label="Laboratorio"
            value={laboratorio}
            onChange={(e) => setLaboratorio(e.target.value)}
            placeholder="Cuál"
          />
        ) : atencionId ? (
          <>
            <Select
              label="Servicio del catálogo (para cobrarlo)"
              value={servicioId}
              onChange={(e) => setServicioId(e.target.value)}
              options={[
                { value: "", label: "Sin cargo: no se cobra aparte" },
                ...servicios.map((s) => ({ value: s.id, label: s.nombre })),
              ]}
            />
            <p className="text-xs text-text-muted">
              Si elige un servicio, su cargo entra a la cuenta de esta atención como cualquier otra
              cosa que se hizo.
            </p>
          </>
        ) : (
          <p className="text-xs text-text-muted">
            Registrado fuera de una atención: no genera cargo. Para cobrarlo, registralo desde la
            atención del paciente.
          </p>
        )}

        {!sinResultado && (
          <>
            <Input
              label="Fecha de la toma de la muestra"
              type="date"
              value={fechaMuestra}
              onChange={(e) => setFechaMuestra(e.target.value)}
            />
            <div>
              <span className="mb-1 block text-sm font-semibold text-text-primary">
                Resultado (PDF o foto)
              </span>
              <input
                type="file"
                multiple
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setArchivos(Array.from(e.target.files ?? []))}
                className="block w-full text-sm text-text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-sobre-primary"
              />
              {archivos.length > 0 && (
                <p className="mt-1 text-xs text-text-muted">
                  {archivos.length === 1
                    ? archivos[0].name
                    : `${archivos.length} archivos seleccionados`}
                </p>
              )}
            </div>
          </>
        )}

        <Input
          label={sinResultado ? "Observaciones" : "Comentario o interpretación"}
          value={observaciones}
          onChange={(e) => setObservaciones(e.target.value)}
        />

        {/* LA OPCIÓN SECUNDARIA, con el nombre de lo que deja. */}
        <label className="flex items-center gap-2 border-t border-black/5 pt-3 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={sinResultado}
            onChange={(e) => setSinResultado(e.target.checked)}
            className="h-4 w-4 rounded border-black/20"
          />
          Todavía no tengo el resultado: dejarlo pendiente
        </label>
        {sinResultado && (
          <p className="text-xs text-text-muted">
            Va a quedar visible como <strong>pendiente de resultado</strong>. Al adjuntar el
            resultado después, este mismo estudio se cierra: no se crea otro.
          </p>
        )}
      </div>
    </Modal>
  );
}
