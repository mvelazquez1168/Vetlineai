import { useEffect, useRef, useState } from "react";
import { Input, Select } from "../ui";
import { TipoIdentificacion, workspaceApi } from "../../lib/workspaceApi";
import { FuenteReferencia, propietariosApi } from "../../lib/propietariosApi";

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
  /** Cómo nos conoció (anexo 07-03, B3). */
  fuenteReferenciaId: string;
  /** Qué cliente lo trajo, cuando la fuente lo pide. */
  referidoPorPropietarioId: string;
  /** Solo para mostrar: el nombre del que lo trajo. No se manda. */
  referidoPorNombre: string;
  /** De dónde salió el nombre: lo escribió alguien o lo trajo B2. */
  datosFuente: "manual" | "hacienda" | "simulado";
}

const VACIO: ValoresPropietario = {
  nombre: "",
  telefono: "",
  email: "",
  direccion: "",
  tipoIdentificacionId: "",
  numeroIdentificacion: "",
  fuenteReferenciaId: "",
  referidoPorPropietarioId: "",
  referidoPorNombre: "",
  datosFuente: "manual",
};

export interface DatosPropietarioAlBackend {
  nombre: string;
  telefono: string | null;
  email: string | null;
  direccion: string | null;
  tipoIdentificacionId: string | null;
  numeroIdentificacion: string | null;
  fuenteReferenciaId: string | null;
  referidoPorPropietarioId: string | null;
  datosFuente: "manual" | "hacienda" | "simulado";
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
      fuenteReferenciaId: v.fuenteReferenciaId || null,
      referidoPorPropietarioId: v.referidoPorPropietarioId || null,
      datosFuente: v.datosFuente,
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
  identificacionEditable = true,
  propietarioId,
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
  /**
   * La identificación se edita solo al crear. En la ficha de un cliente
   * que ya existe queda fija —`PATCH /propietarios/:id` la ignora a
   * propósito— y por eso no se muestran los dos campos: un campo que
   * acepta lo que escribís y después no lo guarda es peor que no
   * tenerlo.
   */
  identificacionEditable?: boolean;
  /** Quién es, para no ofrecerse a sí mismo como el que lo refirió. */
  propietarioId?: string;
}) {
  const { v, set } = form;
  const [tipos, setTipos] = useState<TipoIdentificacion[]>([]);
  const [masAbierto, setMasAbierto] = useState(false);
  const [fuentes, setFuentes] = useState<FuenteReferencia[]>([]);
  const [buscaReferidor, setBuscaReferidor] = useState("");
  const [consultando, setConsultando] = useState(false);
  const [sugerencia, setSugerencia] = useState<{
    nombre: string;
    aplicado: boolean;
    proveedor?: string;
  } | null>(null);
  // La última consulta hecha, para no repetirla en cada `blur`. Es un
  // ref y no estado porque cambiarla no tiene que redibujar nada.
  const consultado = useRef<string>("");
  const [candidatos, setCandidatos] = useState<Array<{ id: string; nombre: string }>>([]);

  useEffect(() => {
    let vivo = true;
    workspaceApi
      .listarTiposIdentificacion()
      .then((r) => vivo && setTipos(r.tipos))
      // Sin catálogo de identificaciones el alta sigue: la
      // identificación es opcional.
      .catch(() => vivo && setTipos([]));
    propietariosApi
      .fuentesReferencia()
      .then((r) => vivo && setFuentes(r.fuentes))
      // Lo mismo con las fuentes: es un dato opcional y su catálogo no
      // puede ser el motivo de que no se pueda registrar un cliente.
      .catch(() => vivo && setFuentes([]));
    return () => {
      vivo = false;
    };
  }, []);

  // EL BUSCADOR DEL REFERIDOR, con la misma espera de 250 ms que el
  // selector de dueño del alta de paciente: un viaje por tecla pulsada
  // sobre la búsqueda tolerante de clientes es caro y no se nota mejor.
  useEffect(() => {
    if (buscaReferidor.trim().length < 2) {
      setCandidatos([]);
      return;
    }
    let vivo = true;
    const t = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(buscaReferidor.trim())
        .then(
          (r) =>
            vivo &&
            setCandidatos(
              r.propietarios
                .filter((p) => p.id !== propietarioId)
                .map((p) => ({ id: p.id, nombre: p.nombre }))
                .slice(0, 6)
            )
        )
        .catch(() => vivo && setCandidatos([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [buscaReferidor, propietarioId]);

  const fuenteElegida = fuentes.find((f) => f.id === v.fuenteReferenciaId);

  // ------------------------------------------------------------------
  // EL AUTOCOMPLETAR POR IDENTIFICACIÓN — anexo 07-03, B2.
  //
  // Viene enchufado al punto de extensión que el A5 dejó previsto. Quien
  // pase `onIdentificacionCompleta` lo reemplaza: el hook es de quien
  // llama y esto es el comportamiento por omisión, no una imposición.
  //
  // NO PISA LO QUE YA HAY ESCRITO. Si la recepción ya tecleó el nombre,
  // la respuesta del servicio se ofrece en un botón en vez de
  // sobrescribir: una respuesta que llega dos segundos después y le
  // cambia lo que escribió es la peor forma de ayudar.
  // ------------------------------------------------------------------
  const avisarSiCompleta = (tipoId: string, numero: string) => {
    const limpio = numero.trim();
    if (!tipoId || limpio.length < 9) return;
    if (onIdentificacionCompleta) {
      onIdentificacionCompleta(tipoId, limpio);
      return;
    }
    if (consultado.current === `${tipoId}|${limpio}`) return;
    consultado.current = `${tipoId}|${limpio}`;
    setConsultando(true);
    setSugerencia(null);
    propietariosApi
      .consultarIdentificacion(tipoId, limpio)
      .then((r) => {
        if (!r.encontrado || !r.nombre) {
          // «No está inscrito» no es un error: es la respuesta normal de
          // la mitad de los clientes de una veterinaria.
          setSugerencia(null);
          return;
        }
        if (!v.nombre.trim()) {
          set("nombre", r.nombre);
          set("datosFuente", (r.proveedor as "hacienda" | "simulado") ?? "hacienda");
          setSugerencia({ nombre: r.nombre, aplicado: true, proveedor: r.proveedor });
        } else if (v.nombre.trim() !== r.nombre) {
          setSugerencia({ nombre: r.nombre, aplicado: false, proveedor: r.proveedor });
        }
      })
      // Sin respuesta, el alta sigue a mano y en silencio: un error rojo
      // por un servicio ajeno que no contestó asusta sin servir de nada.
      .catch(() => setSugerencia(null))
      .finally(() => setConsultando(false));
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
      {identificacionEditable && (
        <>
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
        </>
      )}
      {(consultando || sugerencia) && (
        <div className="sm:col-span-2 -mt-2">
          {consultando && <p className="text-xs text-text-muted">Buscando el nombre…</p>}
          {sugerencia?.aplicado && (
            <p className="text-xs text-success">
              Nombre tomado del registro {sugerencia.proveedor === "hacienda" ? "de Hacienda" : "(simulado)"}.
              Se puede corregir.
            </p>
          )}
          {sugerencia && !sugerencia.aplicado && (
            <p className="text-xs text-text-muted">
              El registro dice «{sugerencia.nombre}».{" "}
              <button
                type="button"
                className="font-semibold text-primary underline"
                onClick={() => {
                  set("nombre", sugerencia.nombre);
                  set("datosFuente", (sugerencia.proveedor as "hacienda" | "simulado") ?? "hacienda");
                  setSugerencia({ ...sugerencia, aplicado: true });
                }}
              >
                Usar ese nombre
              </button>
            </p>
          )}
        </div>
      )}

      <Input
        label="Correo"
        type="email"
        name="propietarioEmail"
        value={v.email}
        disabled={deshabilitado}
        onChange={(e) => set("email", e.target.value)}
      />

      {/* CÓMO NOS CONOCIÓ — anexo 07-03, B3.
          VA A LA VISTA Y NO PLEGADO, al revés que la dirección. Es un
          clic, se contesta mientras el cliente está enfrente, y es la
          única oportunidad de capturarlo: plegado nadie lo abre y la
          pregunta «de dónde viene mi clientela» se queda sin datos para
          siempre. Opcional igual: «Sin registrar» es una respuesta. */}
      {fuentes.length > 0 && (
        <Select
          label="¿Cómo nos conoció?"
          name="fuenteReferencia"
          className={fuenteElegida?.pide_referidor ? "" : "sm:col-span-2"}
          options={[
            { value: "", label: "Sin registrar" },
            ...fuentes.map((f) => ({ value: f.id, label: f.etiqueta })),
          ]}
          value={v.fuenteReferenciaId}
          disabled={deshabilitado}
          onChange={(e) => {
            set("fuenteReferenciaId", e.target.value);
            // Cambiar de fuente limpia el referidor: dejar «la trajo
            // Marta» colgando de «Google» es un dato falso.
            const nueva = fuentes.find((f) => f.id === e.target.value);
            if (!nueva?.pide_referidor) {
              set("referidoPorPropietarioId", "");
              set("referidoPorNombre", "");
              setBuscaReferidor("");
            }
          }}
        />
      )}

      {fuenteElegida?.pide_referidor && (
        <div>
          {v.referidoPorPropietarioId ? (
            <div className="rounded-lg border border-black/10 bg-background px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Lo trajo
              </p>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-sm text-text-primary">{v.referidoPorNombre}</span>
                <button
                  type="button"
                  className="text-xs font-semibold text-primary underline"
                  disabled={deshabilitado}
                  onClick={() => {
                    set("referidoPorPropietarioId", "");
                    set("referidoPorNombre", "");
                  }}
                >
                  Cambiar
                </button>
              </div>
            </div>
          ) : (
            <>
              <Input
                label="¿Qué cliente lo trajo?"
                name="referidoPor"
                placeholder="Buscar por nombre o teléfono"
                value={buscaReferidor}
                disabled={deshabilitado}
                onChange={(e) => setBuscaReferidor(e.target.value)}
              />
              {candidatos.length > 0 && (
                <ul className="mt-1 divide-y divide-black/5 rounded-lg border border-black/10 bg-surface">
                  {candidatos.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm text-text-primary hover:bg-background"
                        onClick={() => {
                          set("referidoPorPropietarioId", c.id);
                          set("referidoPorNombre", c.nombre);
                          setCandidatos([]);
                          setBuscaReferidor("");
                        }}
                      >
                        {c.nombre}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {/* SE PUEDE GUARDAR SIN ELEGIRLO. El cliente dice «me
                  recomendó una señora» y no se acuerda del nombre: la
                  fuente igual queda registrada. Exigir el enlace haría
                  que la recepción elija «Otro» para poder guardar, y se
                  perdería el dato que sí se sabe. */}
              <p className="mt-1 text-xs text-text-muted">
                Si no sabés quién, dejalo vacío: la fuente queda registrada igual.
              </p>
            </>
          )}
        </div>
      )}

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
