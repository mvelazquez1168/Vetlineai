import { useState } from "react";
import { Button, Modal, useToast } from "../ui";
import { AvisoDuplicado } from "./AvisoDuplicado";
import { FormularioPropietario, useFormularioPropietario } from "./FormularioPropietario";
import { ClienteParecido, PosibleDuplicado, propietariosApi } from "../../lib/propietariosApi";

// ---------------------------------------------------------------------
// ALTA DE CLIENTE DESDE EL FICHERO — anexo 07-03, A5.
//
// Hasta ahora el único camino para crear un cliente era el wizard de
// Nuevo caso, que además es solo para médicos: recepción no tenía
// ninguna forma de dar de alta a alguien que llama por teléfono. Este
// modal es ese camino, y vive en `/propietarios`, que es donde la
// persona ya está buscando al cliente que no encuentra.
// ---------------------------------------------------------------------

export function ModalNuevoPropietario({
  abierto,
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  onCerrar: () => void;
  /** El id del cliente: el nuevo, o el existente si se eligió usarlo. */
  onCreado: (propietarioId: string, nombre: string) => void;
}) {
  const toast = useToast();
  const form = useFormularioPropietario();
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ mensaje: string; candidatos: ClienteParecido[] } | null>(
    null
  );

  const cerrar = () => {
    form.reiniciar();
    setError(null);
    setDuplicado(null);
    onCerrar();
  };

  const guardar = async (confirmado: boolean) => {
    const problema = form.validar();
    if (problema) {
      setError(problema);
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      const { propietario } = await propietariosApi.crear(
        form.aCampos() as unknown as Record<string, unknown>,
        confirmado
      );
      toast.exito(`${propietario.nombre} quedó registrado.`);
      onCreado(propietario.id, propietario.nombre);
      cerrar();
    } catch (err) {
      if (err instanceof PosibleDuplicado) {
        setDuplicado({ mensaje: err.message, candidatos: err.candidatos });
      } else {
        // Inline y no en un toast: el modal sigue abierto con los datos
        // cargados, y el mensaje tiene que estar al lado de lo que hay
        // que corregir.
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
      title="Nuevo cliente"
      hayCambios={form.sucio}
      description="Lo esencial arriba. La dirección y los datos de facturación están plegados."
      ancho="lg"
      footer={
        duplicado ? undefined : (
          <>
            <Button variant="secondary" onClick={cerrar} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={() => void guardar(false)} disabled={guardando}>
              {guardando ? "Guardando…" : "Registrar cliente"}
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
            onCreado(c.id, c.nombre);
            cerrar();
          }}
          onCrearIgual={() => {
            setDuplicado(null);
            void guardar(true);
          }}
          onCancelar={() => setDuplicado(null)}
        />
      ) : (
        <>
          <FormularioPropietario form={form} deshabilitado={guardando} />
          {error && <p className="mt-3 text-sm text-error">{error}</p>}
        </>
      )}
    </Modal>
  );
}
