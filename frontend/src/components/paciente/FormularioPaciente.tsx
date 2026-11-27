import { useState } from "react";
import { BreedCombobox, Input, Select } from "../ui";
import { useCatalogosClinicos } from "../expediente/AccionesClinicas";
import {
  CamposFichaPaciente,
  EstadoReproductivo,
  PacienteFicha,
  SexoPaciente,
} from "../../lib/pacientesApi";

// ---------------------------------------------------------------------
// EL FORMULARIO DE PACIENTE — uno solo para todo el sistema.
//
// Hasta el anexo 07-03 había tres formularios de paciente distintos: el
// del wizard de Nuevo caso (nombre, especie, raza, nacimiento), el del
// modal de Nueva Cita (nombre y especie) y el de editar la ficha (once
// campos). Tres listas de campos, tres validaciones y tres mapeos al
// backend, que es la forma de que un día el alta pida algo que la
// edición no sepa guardar.
//
// Ahora es este, y lo usan los cinco puntos de alta y edición. Lo que
// cambia entre ellos es el MODO, no los campos:
//
//   * `completo` — todo, con los opcionales plegados.
//   * `rapido`   — nombre y especie, y nada más. Es el de la cita: el
//                  teléfono está sonando y el paciente llega en veinte
//                  minutos. El formulario avisa que la ficha queda por
//                  completar, que es la verdad y no una disculpa.
//
// LOS OPCIONALES VAN PLEGADOS a propósito. El anexo pide que estén
// «disponibles sin estorbar el alta rápida»: desplegados, un alta normal
// pasa de seis campos a diecisiete y nadie los llena.
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

// Espejo del mapeo del backend (especiePaciente.ts): el combobox de
// razas habla el vocabulario de `razas.especie` y el formulario el de
// `pacientes.especie`.
//
// ACÁ NO SE COPIAN LOS SINÓNIMOS del backend —«perro», «canina»,
// «gato»—, y es a propósito: la base ya está normalizada (migración 165)
// y la escritura normaliza, así que el valor de este selector es siempre
// del vocabulario único. Copiar la lista de sinónimos sería la segunda
// lista que un día no coincide con la primera.
const ESPECIE_A_RAZA: Record<string, "canina" | "felina"> = {
  Canino: "canina",
  Felino: "felina",
};

/**
 * Las opciones del selector, MÁS la especie guardada cuando no está
 * entre ellas.
 *
 * DEFECTO QUE ESTO CIERRA: un `<select>` cuyo `value` no coincide con
 * ninguna opción muestra la primera, así que un paciente registrado como
 * «perro» o como «Equino» aparecía en la pantalla como **Canino**, y
 * guardar la ficha le cambiaba la especie sin que nadie se enterara.
 * Ahora se ve lo que dice el registro.
 */
function opcionesDeEspecie(guardada: string): Array<{ value: string; label: string }> {
  if (!guardada || ESPECIES.some((e) => e.value === guardada)) return ESPECIES;
  return [...ESPECIES, { value: guardada, label: `${guardada} (como está registrado)` }];
}

export interface ValoresPaciente {
  nombre: string;
  especie: string;
  razaId: string | null;
  sexo: string;
  estadoReproductivo: EstadoReproductivo;
  modoEdad: "fecha" | "aproximada";
  fechaNacimiento: string;
  edadAproximada: string;
  microchip: string;
  color: string;
  alergias: string;
  alertaManejo: string;
  pelaje: string;
  caracter: string;
  habitat: string;
  tipoDieta: string;
  alimentacionDetalle: string;
  pedigri: boolean;
  pedigriRegistro: string;
  partos: string;
}

const VACIO: ValoresPaciente = {
  nombre: "",
  especie: "Canino",
  razaId: null,
  sexo: "",
  estadoReproductivo: "desconocido",
  modoEdad: "fecha",
  fechaNacimiento: "",
  edadAproximada: "",
  microchip: "",
  color: "",
  alergias: "",
  alertaManejo: "",
  pelaje: "",
  caracter: "",
  habitat: "",
  tipoDieta: "",
  alimentacionDetalle: "",
  pedigri: false,
  pedigriRegistro: "",
  partos: "",
};

/** Una ficha existente, para editarla con este mismo formulario. */
export function valoresDeLaFicha(p: PacienteFicha): ValoresPaciente {
  return {
    ...VACIO,
    nombre: p.nombre,
    especie: p.especie,
    razaId: p.raza_id,
    // Una ficha vieja puede traer un sexo que ya no está en la lista
    // («Macho castrado») — ver la Parte F de la migración 087. En ese
    // caso el selector arranca vacío y obliga a elegir uno válido, en
    // vez de mostrar una opción que no existe.
    sexo: p.sexo === "macho" || p.sexo === "hembra" ? p.sexo : "",
    estadoReproductivo: p.estado_reproductivo,
    modoEdad: p.fecha_nacimiento_estimada ? "aproximada" : "fecha",
    fechaNacimiento: p.fecha_nacimiento?.slice(0, 10) ?? "",
    edadAproximada:
      p.fecha_nacimiento_estimada && p.edad_anios !== null ? String(p.edad_anios) : "",
    microchip: p.microchip ?? "",
    color: p.color ?? "",
    alergias: p.alergias ?? "",
    alertaManejo: p.alerta_manejo ?? "",
    pelaje: p.pelaje ?? "",
    caracter: p.caracter ?? "",
    habitat: p.habitat ?? "",
    tipoDieta: p.tipo_dieta ?? "",
    alimentacionDetalle: p.alimentacion_detalle ?? "",
    pedigri: p.pedigri ?? false,
    pedigriRegistro: p.pedigri_registro ?? "",
    partos: p.partos === null || p.partos === undefined ? "" : String(p.partos),
  };
}

export interface FormularioPacienteEstado {
  v: ValoresPaciente;
  set: <K extends keyof ValoresPaciente>(campo: K, valor: ValoresPaciente[K]) => void;
  /** Lo que entiende el backend. Un solo mapeo para los cinco usos. */
  aCampos: () => CamposFichaPaciente;
  /** El primer problema, o null. Mismo criterio en todos los usos. */
  validar: () => string | null;
  reiniciar: (inicial?: Partial<ValoresPaciente>) => void;
}

export function useFormularioPaciente(inicial?: Partial<ValoresPaciente>): FormularioPacienteEstado {
  const [v, setV] = useState<ValoresPaciente>({ ...VACIO, ...inicial });

  const set = <K extends keyof ValoresPaciente>(campo: K, valor: ValoresPaciente[K]) => {
    setV((prev) => {
      const siguiente = { ...prev, [campo]: valor };
      // La raza pertenece a la especie: dejarla puesta al cambiar de
      // especie hace que el backend rechace el guardado con «la raza no
      // corresponde a la especie indicada».
      if (campo === "especie") siguiente.razaId = null;
      // Partos solo tiene sentido en una hembra, y el CHECK de la base
      // lo exige. Se limpia acá para que no llegue a fallar.
      if (campo === "sexo" && valor !== "hembra") siguiente.partos = "";
      return siguiente;
    });
  };

  return {
    v,
    set,
    aCampos: () => ({
      nombre: v.nombre.trim(),
      especie: v.especie,
      razaId: v.razaId ?? null,
      sexo: v.sexo === "" ? null : (v.sexo as SexoPaciente),
      estadoReproductivo: v.estadoReproductivo,
      microchip: v.microchip.trim() || null,
      color: v.color.trim() || null,
      alergias: v.alergias.trim() || null,
      alertaManejo: v.alertaManejo.trim() || null,
      pelaje: v.pelaje.trim() || null,
      caracter: v.caracter.trim() || null,
      habitat: v.habitat.trim() || null,
      tipoDieta: v.tipoDieta.trim() || null,
      alimentacionDetalle: v.alimentacionDetalle.trim() || null,
      pedigri: v.pedigri,
      pedigriRegistro: v.pedigriRegistro.trim() || null,
      partos: v.partos === "" ? null : Number(v.partos),
      ...(v.modoEdad === "fecha"
        ? { fechaNacimiento: v.fechaNacimiento || null }
        : { edadAproximadaAnios: v.edadAproximada === "" ? null : Number(v.edadAproximada) }),
    }),
    validar: () => {
      if (!v.nombre.trim()) return "Falta el nombre del paciente.";
      if (!v.especie) return "Falta la especie.";
      if (v.pedigriRegistro.trim() && !v.pedigri) {
        return "Marcá «tiene pedigrí» o quitá el número de registro.";
      }
      return null;
    },
    reiniciar: (otro) => setV({ ...VACIO, ...otro }),
  };
}

export function FormularioPaciente({
  form,
  modo = "completo",
  deshabilitado = false,
}: {
  form: FormularioPacienteEstado;
  modo?: "completo" | "rapido";
  deshabilitado?: boolean;
}) {
  const { v, set } = form;
  const cat = useCatalogosClinicos();
  const [masAbierto, setMasAbierto] = useState(false);

  const opciones = (tipo: string, vacio: string) => [
    { value: "", label: vacio },
    ...(cat[tipo] ?? []).map((o) => ({ value: o.codigo, label: o.etiqueta })),
  ];

  if (modo === "rapido") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Nombre"
          name="nombre"
          value={v.nombre}
          disabled={deshabilitado}
          onChange={(e) => set("nombre", e.target.value)}
        />
        <Select
          label="Especie"
          name="especie"
          options={opcionesDeEspecie(v.especie)}
          value={v.especie}
          disabled={deshabilitado}
          onChange={(e) => set("especie", e.target.value)}
        />
        {/* LA VERDAD, DICHA EN EL MOMENTO. Un alta de dos campos deja una
            ficha a medias; lo que no puede pasar es que nadie se entere.
            El fichero la va a mostrar con el mismo aviso. */}
        <p className="sm:col-span-2 text-xs text-text-muted">
          Alta rápida: la ficha va a quedar marcada como <strong>por completar</strong> hasta que se
          carguen la raza, el sexo y la edad.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input
        label="Nombre"
        name="nombre"
        value={v.nombre}
        disabled={deshabilitado}
        onChange={(e) => set("nombre", e.target.value)}
      />
      <Select
        label="Especie"
        name="especie"
        options={opcionesDeEspecie(v.especie)}
        value={v.especie}
        disabled={deshabilitado}
        onChange={(e) => set("especie", e.target.value)}
      />
      {/* LA RAZA NECESITA SABER LA ESPECIE. Si la guardada no es del
          vocabulario, no se asume perro: se dice qué falta. Mostrar
          razas caninas para un paciente cuya especie dice otra cosa es
          cómo se llegó al defecto que esto arregla. */}
      {ESPECIE_A_RAZA[v.especie] ? (
        <BreedCombobox
          label="Raza"
          especie={ESPECIE_A_RAZA[v.especie]}
          value={v.razaId}
          onChange={(id) => set("razaId", id)}
        />
      ) : (
        <div>
          <p className="mb-1 text-sm font-semibold text-text-primary">Raza</p>
          <p className="rounded-lg bg-warning/10 p-3 text-xs text-text-secondary">
            Este paciente está registrado como <strong>{v.especie || "sin especie"}</strong>, que no
            es ninguna de las especies con catálogo de razas. Elegí <em>Canino</em> o{" "}
            <em>Felino</em> arriba para poder elegir la raza.
          </p>
        </div>
      )}
      <Select
        label="Sexo"
        name="sexo"
        options={SEXOS}
        value={v.sexo}
        disabled={deshabilitado}
        onChange={(e) => set("sexo", e.target.value)}
      />
      <Select
        label="Estado reproductivo"
        name="estadoReproductivo"
        options={ESTADOS_REPRODUCTIVOS}
        value={v.estadoReproductivo}
        disabled={deshabilitado}
        onChange={(e) => set("estadoReproductivo", e.target.value as EstadoReproductivo)}
      />

      {/* LA EDAD, POR UN CAMINO O POR EL OTRO, nunca los dos: una fecha
          exacta y una edad declarada en la misma ficha son dos verdades
          distintas sobre lo mismo. */}
      <div>
        <span className="mb-1 block text-sm font-semibold text-text-primary">Edad</span>
        <div className="flex gap-3 text-sm">
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={v.modoEdad === "fecha"}
              disabled={deshabilitado}
              onChange={() => set("modoEdad", "fecha")}
            />
            Fecha de nacimiento
          </label>
          <label className="flex items-center gap-1">
            <input
              type="radio"
              checked={v.modoEdad === "aproximada"}
              disabled={deshabilitado}
              onChange={() => set("modoEdad", "aproximada")}
            />
            Edad aproximada
          </label>
        </div>
        {v.modoEdad === "fecha" ? (
          <Input
            type="date"
            name="fechaNacimiento"
            className="mt-2"
            value={v.fechaNacimiento}
            disabled={deshabilitado}
            onChange={(e) => set("fechaNacimiento", e.target.value)}
          />
        ) : (
          <Input
            type="number"
            min={0}
            max={40}
            name="edadAproximada"
            className="mt-2"
            placeholder="Años"
            value={v.edadAproximada}
            disabled={deshabilitado}
            onChange={(e) => set("edadAproximada", e.target.value)}
          />
        )}
      </div>

      <div className="sm:col-span-2">
        <button
          type="button"
          className="text-sm font-semibold text-primary underline"
          onClick={() => setMasAbierto((a) => !a)}
        >
          {masAbierto ? "Ocultar los datos opcionales" : "+ Más datos del paciente (opcional)"}
        </button>
      </div>

      {masAbierto && (
        <>
          <Input
            label="Microchip"
            name="microchip"
            value={v.microchip}
            disabled={deshabilitado}
            onChange={(e) => set("microchip", e.target.value)}
          />
          <Input
            label="Color"
            name="color"
            value={v.color}
            disabled={deshabilitado}
            onChange={(e) => set("color", e.target.value)}
          />
          <Select
            label="Pelaje"
            name="pelaje"
            options={opciones("pelaje", "Sin registrar")}
            value={v.pelaje}
            disabled={deshabilitado}
            onChange={(e) => set("pelaje", e.target.value)}
          />
          <Select
            label="Carácter"
            name="caracter"
            options={opciones("caracter", "Sin registrar")}
            value={v.caracter}
            disabled={deshabilitado}
            onChange={(e) => set("caracter", e.target.value)}
          />
          <Select
            label="Hábitat"
            name="habitat"
            options={opciones("habitat", "Sin registrar")}
            value={v.habitat}
            disabled={deshabilitado}
            onChange={(e) => set("habitat", e.target.value)}
          />
          <Select
            label="Tipo de dieta"
            name="tipoDieta"
            options={opciones("tipo_dieta", "Sin registrar")}
            value={v.tipoDieta}
            disabled={deshabilitado}
            onChange={(e) => set("tipoDieta", e.target.value)}
          />
          <Input
            label="Alimentación (marca o detalle)"
            name="alimentacionDetalle"
            value={v.alimentacionDetalle}
            disabled={deshabilitado}
            onChange={(e) => set("alimentacionDetalle", e.target.value)}
          />
          <div>
            <span className="mb-1 block text-sm font-semibold text-text-primary">Pedigrí</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={v.pedigri}
                disabled={deshabilitado}
                onChange={(e) => set("pedigri", e.target.checked)}
              />
              Tiene pedigrí
            </label>
            {v.pedigri && (
              <Input
                className="mt-2"
                name="pedigriRegistro"
                placeholder="Número de registro (opcional)"
                value={v.pedigriRegistro}
                disabled={deshabilitado}
                onChange={(e) => set("pedigriRegistro", e.target.value)}
              />
            )}
          </div>
          {/* Partos solo aparece en una hembra: el CHECK de la base lo
              exige y mostrarlo en un macho invita a cargar un dato que
              después no se puede guardar. */}
          {v.sexo === "hembra" && (
            <Input
              label="Partos"
              type="number"
              min={0}
              name="partos"
              value={v.partos}
              disabled={deshabilitado}
              onChange={(e) => set("partos", e.target.value)}
            />
          )}
          <Input
            label="Alergias (nota libre)"
            name="alergias"
            value={v.alergias}
            disabled={deshabilitado}
            onChange={(e) => set("alergias", e.target.value)}
          />
          <Input
            label="Alerta de manejo"
            name="alertaManejo"
            value={v.alertaManejo}
            disabled={deshabilitado}
            onChange={(e) => set("alertaManejo", e.target.value)}
          />
        </>
      )}
    </div>
  );
}
