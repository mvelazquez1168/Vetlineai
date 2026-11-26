import { useState } from "react";
import { BreedCombobox, Button, Input, Select, useToast } from "../ui";
import {
  CamposFichaPaciente,
  EstadoReproductivo,
  PacienteFicha,
  SexoPaciente,
  pacientesApi,
} from "../../lib/pacientesApi";

// ---------------------------------------------------------------------
// vetline-clinic-01, punto 3.3 — edición de la ficha.
//
// Modal propio y no el `Modal` compartido. El motivo original era que
// `Modal` era `max-w-md` fijo y este formulario tiene 11 campos en dos
// columnas; desde la sesión nocturna `Modal` ACEPTA `ancho="lg"`, así
// que este archivo ya podría usarlo y queda en la lista de candidatos a
// migrar del reporte, junto con los otros 8 modales escritos a mano.
//
// No se migró en esa sesión a propósito: el prompt pedía no migrar
// pantallas existentes, y cambiar el contenedor de un formulario con 11
// campos sin poder mirarlo en el navegador es justo lo que conviene
// hacer con alguien revisando. Las clases de superposición son, de
// todos modos, las MISMAS que las de `components/ui/Modal.tsx`.
//
// `estado` no se edita acá: el fallecimiento tiene su propia acción y no
// tiene vuelta atrás.
// ---------------------------------------------------------------------

const ESPECIES = [
  { value: "Canino", label: "Canino" },
  { value: "Felino", label: "Felino" },
];

const SEXOS = [
  { value: "", label: "Sin registrar" },
  { value: "macho", label: "Macho" },
  { value: "hembra", label: "Hembra" },
];

const ESTADOS_REPRODUCTIVOS = [
  { value: "desconocido", label: "Desconocido" },
  { value: "entero", label: "Entero" },
  { value: "castrado", label: "Castrado" },
];

// Espejo del mapeo del backend (especiePaciente.ts): el combobox de razas
// habla el vocabulario de `razas.especie`, el formulario el de
// `pacientes.especie`.
const ESPECIE_A_RAZA: Record<string, "canina" | "felina"> = {
  Canino: "canina",
  Felino: "felina",
};

export interface EditarPacienteModalProps {
  paciente: PacienteFicha;
  onClose: () => void;
  onGuardado: () => void;
}

export function EditarPacienteModal({ paciente, onClose, onGuardado }: EditarPacienteModalProps) {
  // El modal se cierra al guardar, así que un mensaje inline se iría con
  // él: la confirmación va por toast, que sobrevive al cierre.
  const toast = useToast();
  const [nombre, setNombre] = useState(paciente.nombre);
  const [especie, setEspecie] = useState(paciente.especie);
  const [razaId, setRazaId] = useState<string | null>(paciente.raza_id);
  const [sexo, setSexo] = useState<string>(
    // Una ficha vieja puede traer un valor que ya no está en la lista
    // ("Macho", "Macho castrado") — ver la Parte F de la migración 087.
    // En ese caso el selector arranca vacío y obliga a elegir uno
    // válido, en vez de mostrar una opción que no existe.
    paciente.sexo === "macho" || paciente.sexo === "hembra" ? paciente.sexo : ""
  );
  const [estadoReproductivo, setEstadoReproductivo] = useState<EstadoReproductivo>(
    paciente.estado_reproductivo
  );
  // Dos caminos para la edad, excluyentes: fecha exacta o edad declarada.
  const [modoEdad, setModoEdad] = useState<"fecha" | "aproximada">(
    paciente.fecha_nacimiento_estimada ? "aproximada" : "fecha"
  );
  const [fechaNacimiento, setFechaNacimiento] = useState(paciente.fecha_nacimiento?.slice(0, 10) ?? "");
  const [edadAproximada, setEdadAproximada] = useState(
    paciente.fecha_nacimiento_estimada && paciente.edad_anios !== null ? String(paciente.edad_anios) : ""
  );
  const [microchip, setMicrochip] = useState(paciente.microchip ?? "");
  const [color, setColor] = useState(paciente.color ?? "");
  const [alergias, setAlergias] = useState(paciente.alergias ?? "");
  const [alertaManejo, setAlertaManejo] = useState(paciente.alerta_manejo ?? "");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sexoViejoSinMigrar = paciente.sexo !== null && paciente.sexo !== "macho" && paciente.sexo !== "hembra";

  const guardar = async () => {
    setError(null);
    if (!nombre.trim()) {
      setError("Falta el nombre del paciente.");
      return;
    }

    const datos: CamposFichaPaciente = {
      nombre: nombre.trim(),
      especie,
      razaId: razaId ?? null,
      sexo: sexo === "" ? null : (sexo as SexoPaciente),
      estadoReproductivo,
      microchip: microchip.trim() || null,
      color: color.trim() || null,
      alergias: alergias.trim() || null,
      alertaManejo: alertaManejo.trim() || null,
      ...(modoEdad === "fecha"
        ? { fechaNacimiento: fechaNacimiento || null }
        : { edadAproximadaAnios: edadAproximada === "" ? null : Number(edadAproximada) }),
    };

    setGuardando(true);
    try {
      await pacientesApi.actualizar(paciente.id, datos);
      toast.exito(`Ficha de ${datos.nombre} guardada.`);
      onGuardado();
      onClose();
    } catch (err: any) {
      // El error se queda INLINE a propósito, no en un toast: el modal
      // sigue abierto con los datos cargados, y el mensaje tiene que
      // estar al lado del formulario que hay que corregir.
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editar-paciente-titulo"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-surface p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="editar-paciente-titulo" className="text-xl font-bold text-primary">
          Editar ficha de {paciente.nombre}
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Expediente N.º {paciente.numero_expediente}. El número de expediente y el propietario no se
          cambian desde acá.
        </p>

        {sexoViejoSinMigrar && (
          <p className="mt-4 rounded-lg bg-warning/15 px-4 py-3 text-sm text-text-primary">
            Esta ficha tiene el sexo cargado como <strong>«{paciente.sexo}»</strong>, de un formato
            anterior. Elija macho o hembra para poder guardar; si corresponde, usá además el estado
            reproductivo.
          </p>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Input label="Nombre" name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          <Select
            label="Especie"
            name="especie"
            options={ESPECIES}
            value={especie}
            onChange={(e) => {
              setEspecie(e.target.value);
              // La raza anterior pertenece a la especie anterior: dejarla
              // puesta haría que el backend rechace el guardado con "la
              // raza no corresponde a la especie indicada".
              setRazaId(null);
            }}
          />
          <BreedCombobox
            label="Raza"
            especie={ESPECIE_A_RAZA[especie] ?? "canina"}
            value={razaId}
            onChange={(id) => setRazaId(id)}
          />
          <Select
            label="Sexo"
            name="sexo"
            options={SEXOS}
            value={sexo}
            onChange={(e) => setSexo(e.target.value)}
          />
          <Select
            label="Estado reproductivo"
            name="estadoReproductivo"
            options={ESTADOS_REPRODUCTIVOS}
            value={estadoReproductivo}
            onChange={(e) => setEstadoReproductivo(e.target.value as EstadoReproductivo)}
          />
          <Select
            label="Cómo se conoce la edad"
            name="modoEdad"
            options={[
              { value: "fecha", label: "Fecha de nacimiento exacta" },
              { value: "aproximada", label: "Edad aproximada" },
            ]}
            value={modoEdad}
            onChange={(e) => setModoEdad(e.target.value as "fecha" | "aproximada")}
          />
          {modoEdad === "fecha" ? (
            <Input
              label="Fecha de nacimiento"
              name="fechaNacimiento"
              type="date"
              value={fechaNacimiento}
              onChange={(e) => setFechaNacimiento(e.target.value)}
            />
          ) : (
            <Input
              label="Edad aproximada (años)"
              name="edadAproximada"
              type="number"
              min={0}
              max={60}
              step="0.5"
              value={edadAproximada}
              onChange={(e) => setEdadAproximada(e.target.value)}
            />
          )}
          <Input
            label="Microchip"
            name="microchip"
            value={microchip}
            onChange={(e) => setMicrochip(e.target.value)}
          />
          <Input label="Color" name="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="alergias" className="text-sm font-semibold text-text-primary">
            Alergias
          </label>
          <textarea
            id="alergias"
            rows={2}
            value={alergias}
            onChange={(e) => setAlergias(e.target.value)}
            placeholder="Ej.: penicilina, ivermectina"
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="alertaManejo" className="text-sm font-semibold text-text-primary">
            Alerta de manejo
          </label>
          <Input
            id="alertaManejo"
            name="alertaManejo"
            value={alertaManejo}
            onChange={(e) => setAlertaManejo(e.target.value)}
            placeholder="Ej.: agresivo, requiere bozal"
          />
          <span className="text-xs text-text-muted">
            Se muestra destacada arriba de la ficha, para que se vea antes de atender al paciente.
          </span>
        </div>

        {error && <p className="mt-4 text-sm text-error">{error}</p>}

        <div className="mt-8 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </div>
  );
}
