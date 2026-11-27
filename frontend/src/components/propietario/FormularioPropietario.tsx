import { useEffect, useState } from "react";
import { Input, Select } from "../ui";
import { TipoIdentificacion, workspaceApi } from "../../lib/workspaceApi";

// ---------------------------------------------------------------------
// EL FORMULARIO DE CLIENTE — uno solo para todo el sistema.
//
// Antes del anexo 07-03 existía UNO, escrito dentro del wizard de Nuevo
// caso, y era el único camino para crear un cliente en toda la
// aplicación: ni el fichero de clientes ni el de pacientes tenían un
// botón de alta. Ahora el formulario vive acá y lo usan el wizard, el
// fichero, el alta de paciente y la ficha del propietario.
//
// QUÉ ES «ESENCIAL» Y QUÉ VA PLEGADO. Arriba, lo que hace falta para
// poder llamar al cliente y para emitirle un comprobante: nombre,
// teléfono, correo e identificación. Plegado, la dirección. El criterio
// no es la importancia del dato sino cuántas veces se usa: la dirección
// se carga en una de cada veinte altas.
//
// AQUÍ ENCHUFA EL B2. El autocompletar por número de identificación
// (consulta pública de contribuyentes) se engancha en `onIdentificacion`
// cuando el tipo y el número están completos: ese es el punto de
// extensión, y está escrito para que el día que exista no haya que
// buscar dónde ponerlo.
// ---------------------------------------------------------------------

export interface ValoresPropietario {
  nombre: string;
  telefono: string;
  email: string;
  direccion: string;
  tipoIdentificacionId: string;
  numeroIdentificacion: string;
}

const VACIO: ValoresPropietario = {
  nombre: "",
  telefono: "",
  email: "",
  direccion: "",
  tipoIdentificacionId: "",
  numeroIdentificacion: "",
};

export interface DatosPropietarioAlBackend {
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  tipoIdentificacionId: string | null;
  numeroIdentificacion: string | null;
}

export interface FormularioPropietarioEstado {
  v: ValoresPropietario;
  set: <K extends keyof ValoresPropietario>(campo: K, valor: ValoresPropietario[K]) => void;
  aCampos: () => DatosPropietarioAlBackend;
  validar: () => string | null;
  reiniciar: (inicial?: Partial<ValoresPropietario>) => void;
}

export function useFormularioPropietario(
  inicial?: Partial<ValoresPropietario>
): FormularioPropietarioEstado {
  const [v, setV] = useState<ValoresPropietario>({ ...VACIO, ...inicial });

  return {
    v,
    set: (campo, valor) => setV((prev) => ({ ...prev, [campo]: valor })),
    aCampos: () => ({
      nombre: v.nombre.trim(),
      telefono: v.telefono.trim() || null,
      email: v.email.trim() || null,
      direccion: v.direccion.trim() || null,
      tipoIdentificacionId: v.tipoIdentificacionId || null,
      numeroIdentificacion: v.numeroIdentificacion.trim() || null,
    }),
    validar: () => {
      if (!v.nombre.trim()) return "Falta el nombre del cliente.";
      // La misma regla que el CHECK de la base: tipo y número van
      // juntos o no va ninguno. Decirlo acá evita un 400 del servidor
      // que el usuario lee como «se rompió».
      if (Boolean(v.tipoIdentificacionId) !== Boolean(v.numeroIdentificacion.trim())) {
        return "La identificación lleva el tipo y el número juntos.";
      }
      return null;
    },
    reiniciar: (otro) => setV({ ...VACIO, ...otro }),
  };
}

export function FormularioPropietario({
  form,
  deshabilitado = false,
  onIdentificacionCompleta,
}: {
  form: FormularioPropietarioEstado;
  deshabilitado?: boolean;
  /**
   * Punto de extensión del B2: se llama cuando el tipo y el número
   * están los dos cargados. Hoy nadie lo pasa y el formulario funciona
   * igual; cuando exista el proveedor de identificación, se engancha acá
   * y completa nombre y datos fiscales.
   */
  onIdentificacionCompleta?: (tipoId: string, numero: string) => void;
}) {
  const { v, set } = form;
  const [tipos, setTipos] = useState<TipoIdentificacion[]>([]);
  const [masAbierto, setMasAbierto] = useState(false);

  useEffect(() => {
    let vivo = true;
    workspaceApi
      .listarTiposIdentificacion()
      .then((r) => vivo && setTipos(r.tipos))
      // Sin catálogo de identificaciones el alta sigue: la
      // identificación es opcional.
      .catch(() => vivo && setTipos([]));
    return () => {
      vivo = false;
    };
  }, []);

  const avisarSiCompleta = (tipoId: string, numero: string) => {
    if (onIdentificacionCompleta && tipoId && numero.trim().length >= 9) {
      onIdentificacionCompleta(tipoId, numero.trim());
    }
  };

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input
        label="Nombre completo"
        name="propietarioNombre"
        value={v.nombre}
        disabled={deshabilitado}
        onChange={(e) => set("nombre", e.target.value)}
      />
      <Input
        label="Teléfono"
        name="propietarioTelefono"
        value={v.telefono}
        disabled={deshabilitado}
        onChange={(e) => set("telefono", e.target.value)}
      />
      <Select
        label="Tipo de identificación"
        name="tipoIdentificacion"
        options={[
          { value: "", label: "Sin registrar" },
          ...tipos.map((t) => ({ value: t.id, label: t.etiqueta })),
        ]}
        value={v.tipoIdentificacionId}
        disabled={deshabilitado}
        onChange={(e) => {
          set("tipoIdentificacionId", e.target.value);
          avisarSiCompleta(e.target.value, v.numeroIdentificacion);
        }}
      />
      <Input
        label="Número de identificación"
        name="numeroIdentificacion"
        value={v.numeroIdentificacion}
        disabled={deshabilitado}
        onChange={(e) => set("numeroIdentificacion", e.target.value)}
        onBlur={(e) => avisarSiCompleta(v.tipoIdentificacionId, e.target.value)}
      />
      <Input
        label="Correo"
        type="email"
        name="propietarioEmail"
        value={v.email}
        disabled={deshabilitado}
        onChange={(e) => set("email", e.target.value)}
      />

      <div className="sm:col-span-2">
        <button
          type="button"
          className="text-sm font-semibold text-primary underline"
          onClick={() => setMasAbierto((a) => !a)}
        >
          {masAbierto ? "Ocultar los datos de facturación" : "+ Dirección y datos de facturación"}
        </button>
      </div>

      {masAbierto && (
        <>
          <Input
            label="Dirección"
            name="propietarioDireccion"
            className="sm:col-span-2"
            value={v.direccion}
            disabled={deshabilitado}
            onChange={(e) => set("direccion", e.target.value)}
          />
          {/* LO QUE SE DICE Y LO QUE NO. El receptor de un comprobante
              electrónico es una figura propia —puede no ser el dueño de
              la mascota, y por eso existe `fact_perfiles_facturacion`
              desde el prompt 03—. Acá se cargan los datos del cliente;
              el perfil de facturación se arma desde la factura, con el
              selector que ya existe. Decirlo es mejor que poner un
              campo que prometa algo que no hace. */}
          <p className="sm:col-span-2 text-xs text-text-muted">
            La identificación y el correo de arriba son los que usa la facturación electrónica. Si
            el comprobante va a nombre de otra persona o de una empresa, eso se elige al facturar:
            es un receptor aparte, no un dato de esta ficha.
          </p>
        </>
      )}
    </div>
  );
}
