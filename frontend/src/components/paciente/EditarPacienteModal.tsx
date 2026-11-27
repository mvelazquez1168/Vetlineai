import { useState } from "react";
import { Button, Modal, useToast } from "../ui";
import { FormularioPaciente, useFormularioPaciente, valoresDeLaFicha } from "./FormularioPaciente";
import { PacienteFicha, pacientesApi } from "../../lib/pacientesApi";

// ---------------------------------------------------------------------
// EDITAR LA FICHA DEL PACIENTE — vetline-clinic-01, punto 3.3.
//
// Tenía su propia copia de los once campos y de su validación. Desde el
// anexo 07-03 (A5) renderiza `FormularioPaciente`, el mismo que usan el
// alta del fichero, el wizard de Nuevo caso, la cita y «agregar
// mascota» desde la ficha del cliente. Lo que este archivo aporta ahora
// es lo suyo y nada más: el título, el guardado y el aviso de la ficha
// vieja.
//
// También pasó a usar el `Modal` compartido: nació con su propio
// contenedor porque `Modal` era `max-w-md` fijo, y desde la sesión
// nocturna acepta `ancho`. Era uno de los nueve modales escritos a mano
// que el reporte del 01c dejó en la lista.
//
// `estado` no se edita acá: la baja tiene su propia acción, pide motivo
// y no tiene vuelta atrás.
// ---------------------------------------------------------------------

export interface EditarPacienteModalProps {
  paciente: PacienteFicha;
  onClose: () => void;
  onGuardado: () => void;
}

export function EditarPacienteModal({ paciente, onClose, onGuardado }: EditarPacienteModalProps) {
  // El modal se cierra al guardar, así que un mensaje inline se iría con
  // él: la confirmación va por toast, que sobrevive al cierre.
  const toast = useToast();
  const form = useFormularioPaciente(valoresDeLaFicha(paciente));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sexoViejoSinMigrar =
    paciente.sexo !== null && paciente.sexo !== "macho" && paciente.sexo !== "hembra";

  const guardar = async () => {
    const problema = form.validar();
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const datos = form.aCampos();
      await pacientesApi.actualizar(paciente.id, datos);
      toast.exito(`Ficha de ${datos.nombre} guardada.`);
      onGuardado();
      onClose();
    } catch (err) {
      // El error se queda INLINE a propósito, no en un toast: el modal
      // sigue abierto con los datos cargados, y el mensaje tiene que
      // estar al lado del formulario que hay que corregir.
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Editar ficha de ${paciente.nombre}`}
      description={`Expediente N.º ${paciente.numero_expediente}. El número de expediente y el propietario no se cambian desde acá.`}
      ancho="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar cambios"}
          </Button>
        </>
      }
    >
      {sexoViejoSinMigrar && (
        <p className="mb-4 rounded-lg bg-warning/15 px-4 py-3 text-sm text-text-primary">
          Esta ficha tiene el sexo cargado como <strong>«{paciente.sexo}»</strong>, de un formato
          anterior. Elija macho o hembra para poder guardar; si corresponde, usá además el estado
          reproductivo.
        </p>
      )}

      <FormularioPaciente form={form} deshabilitado={guardando} />

      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </Modal>
  );
}
