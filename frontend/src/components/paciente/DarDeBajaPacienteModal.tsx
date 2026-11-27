import { useState } from "react";
import { Button, Input, Modal, Select, useToast } from "../ui";
import { useCatalogosClinicos } from "../expediente/AccionesClinicas";
import { EstadoPaciente, PacienteFicha, pacientesApi } from "../../lib/pacientesApi";

// ---------------------------------------------------------------------
// DAR DE BAJA UN PACIENTE — anexo 07-03, A5.
//
// Antes solo existía «marcar como fallecido», sin motivo. La migración
// 111 agregó extraviado, transferido y otro, y el anexo pide que la
// baja pida el motivo en los cuatro casos.
//
// POR QUÉ EL MOTIVO ES OBLIGATORIO: una ficha que dice «transferido» y
// nada más no le sirve a quien la lea en dos años. El catálogo
// `motivo_baja` de la clínica da las opciones y «otro» admite texto.
//
// NO TIENE VUELTA ATRÁS, y el texto lo dice antes de confirmar. El
// backend lo impide con un `WHERE estado = 'activo'`.
// ---------------------------------------------------------------------

const ESTADOS: Array<{ value: Exclude<EstadoPaciente, "activo">; label: string }> = [
  { value: "fallecido", label: "Falleció" },
  { value: "extraviado", label: "Se extravió" },
  { value: "transferido", label: "Se transfirió a otra clínica" },
  { value: "baja_otro", label: "Otro motivo" },
];

export function DarDeBajaPacienteModal({
  paciente,
  onCerrar,
  onDadoDeBaja,
}: {
  paciente: PacienteFicha;
  onCerrar: () => void;
  onDadoDeBaja: () => void;
}) {
  const toast = useToast();
  const cat = useCatalogosClinicos();
  const [estado, setEstado] = useState<Exclude<EstadoPaciente, "activo">>("fallecido");
  const [motivoCatalogo, setMotivoCatalogo] = useState("");
  const [motivoLibre, setMotivoLibre] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opcionesMotivo = cat.motivo_baja ?? [];
  // Con catálogo se elige; sin catálogo se escribe. La clínica que
  // borró todas sus opciones no se queda sin poder dar de baja.
  const usaTextoLibre = opcionesMotivo.length === 0 || motivoCatalogo === "__otro";
  const motivo = usaTextoLibre
    ? motivoLibre.trim()
    : opcionesMotivo.find((o) => o.codigo === motivoCatalogo)?.etiqueta ?? "";

  const confirmar = async () => {
    if (!motivo) {
      setError("Falta el motivo de la baja.");
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      await pacientesApi.darDeBaja(paciente.id, {
        estado,
        motivo,
        fecha,
        ...(estado === "fallecido" ? { fechaFallecimiento: fecha } : {}),
      });
      toast.exito(`${paciente.nombre} quedó dado de baja.`);
      onDadoDeBaja();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Dar de baja a ${paciente.nombre}`}
      description="Deja de aparecer como activo y no vuelve a recibir ningún aviso automático."
      footer={
        <>
          <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={() => void confirmar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Dar de baja"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Select
          label="Qué pasó"
          name="estadoBaja"
          options={ESTADOS}
          value={estado}
          disabled={guardando}
          onChange={(e) => setEstado(e.target.value as Exclude<EstadoPaciente, "activo">)}
        />

        {opcionesMotivo.length > 0 && (
          <Select
            label="Motivo"
            name="motivoBaja"
            options={[
              { value: "", label: "Elegí un motivo" },
              ...opcionesMotivo.map((o) => ({ value: o.codigo, label: o.etiqueta })),
              { value: "__otro", label: "Otro (lo escribo)" },
            ]}
            value={motivoCatalogo}
            disabled={guardando}
            onChange={(e) => setMotivoCatalogo(e.target.value)}
          />
        )}

        {usaTextoLibre && (
          <Input
            label="Motivo"
            name="motivoLibre"
            value={motivoLibre}
            disabled={guardando}
            onChange={(e) => setMotivoLibre(e.target.value)}
          />
        )}

        <Input
          label={estado === "fallecido" ? "Fecha del fallecimiento" : "Fecha de la baja"}
          type="date"
          name="fechaBaja"
          value={fecha}
          disabled={guardando}
          onChange={(e) => setFecha(e.target.value)}
        />

        <p className="rounded-lg bg-warning/15 px-4 py-3 text-sm text-text-primary">
          <strong>Esto no se deshace.</strong> El expediente se conserva completo y se puede
          consultar, pero el paciente deja de recibir recordatorios de citas, de vacunas y de
          desparasitación.
        </p>

        {error && <p className="text-sm text-error">{error}</p>}
      </div>
    </Modal>
  );
}
