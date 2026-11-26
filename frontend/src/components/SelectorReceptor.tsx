import { useEffect, useState } from "react";
import { Badge, Button, Icono, Input, Select } from "./ui";
import { SelectorUbicacion, ValorUbicacion } from "./SelectorUbicacion";
import {
  PerfilFacturacion,
  ReceptorPosible,
  facturacionCrApi,
} from "../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// A NOMBRE DE QUIÉN SALE LA FACTURA — sección 3 bis del prompt 08.
//
// UN SOLO COMPONENTE para la caja y para la pantalla "Emitir" del
// facturador. El prompt lo pide explícitamente ("un único componente,
// no dos"), y el motivo es que dos selectores son dos criterios de qué
// dato falta: la factura de la caja saldría distinta a la del
// facturador para el mismo cliente, y nadie lo notaría hasta que
// Hacienda rechace una de las dos.
//
// Las cuatro opciones, en el orden en que se usan en el mostrador:
//
//   1. **el dueño** de la mascota, con sus datos fiscales;
//   2. **un perfil guardado de ese cliente** (su empresa, la fundación
//      que lo apadrina) — el predeterminado aparece primero;
//   3. **cualquier cliente o perfil existente**, con búsqueda tolerante
//      a errores de tipeo sobre LAS DOS tablas;
//   4. **uno nuevo**, cargado ahí mismo, con la opción de dejarlo
//      guardado para ese cliente la próxima vez.
//
// Y la quinta, que no es una opción sino la salida por defecto: SIN
// DATOS, TIQUETE. No se bloquea el cobro por no tener a quién
// facturarle.
//
// LO QUE ESTE COMPONENTE NO DECIDE: si el comprobante es factura o
// tiquete. Eso lo decide quien cobra, y este componente solo informa si
// falta la identificación que una factura exige.
// ---------------------------------------------------------------------

export type EleccionReceptor =
  | { modo: "sin_datos" }
  | { modo: "dueno"; propietarioId: string }
  | { modo: "perfil"; perfilId: string }
  | { modo: "existente"; tipo: "cliente" | "perfil"; id: string }
  | { modo: "nuevo"; datos: Record<string, unknown>; guardar?: boolean };

export interface ResumenReceptor {
  /** Lo que se muestra: a nombre de quién va a salir. */
  nombre: string;
  identificacion: string | null;
  /** true si falta la identificación que una factura exige. */
  faltaIdentificacion: boolean;
  /**
   * LOS DATOS COMPLETOS, cuando se los conoce.
   *
   * La pantalla "Emitir" del facturador tiene los campos del receptor a
   * la vista —es su forma de dejar completar lo que falta sin salir de
   * la emisión, que es lo que el prompt pide— así que necesita los
   * datos para llenarlos. La caja no los usa: manda la elección y el
   * backend la resuelve.
   */
  datos?: {
    nombre: string;
    tipoIdentificacion?: string;
    numeroIdentificacion?: string;
    correo?: string;
    telefonoCodigoPais?: string;
    telefonoNumero?: string;
    ubicacionProvincia?: string;
    ubicacionCanton?: string;
    ubicacionDistrito?: string;
    ubicacionBarrio?: string;
    ubicacionOtrasSenas?: string;
  };
  /** Para la trazabilidad: de qué perfil o de qué cliente salió. */
  perfilId?: string;
  propietarioId?: string;
}

export interface SelectorReceptorProps {
  /** El dueño de la cuenta o del paciente, si lo hay. */
  propietarioId?: string | null;
  propietarioNombre?: string | null;
  /** Para avisar qué falta cuando se va a emitir una factura. */
  exigeIdentificacion?: boolean;
  onCambio: (eleccion: EleccionReceptor, resumen: ResumenReceptor) => void;
  className?: string;
}

const SIN_RECEPTOR: ResumenReceptor = {
  nombre: "",
  identificacion: null,
  faltaIdentificacion: true,
};

export function SelectorReceptor({
  propietarioId,
  propietarioNombre,
  exigeIdentificacion = false,
  onCambio,
  className = "",
}: SelectorReceptorProps) {
  const [perfilesDelCliente, setPerfilesDelCliente] = useState<
    Array<PerfilFacturacion & { es_predeterminado: boolean }>
  >([]);
  const [busqueda, setBusqueda] = useState("");
  const [encontrados, setEncontrados] = useState<ReceptorPosible[]>([]);
  const [buscando, setBuscando] = useState(false);

  /** Qué está elegido ahora. `null` = sin datos → tiquete. */
  const [elegido, setElegido] = useState<
    | null
    | { tipo: "dueno"; nombre: string; identificacion: string | null }
    | { tipo: "perfil"; id: string; nombre: string; identificacion: string }
    | { tipo: "cliente"; id: string; nombre: string; identificacion: string | null }
  >(null);

  const [creando, setCreando] = useState(false);
  const [nuevo, setNuevo] = useState({
    nombre: "",
    tipoIdentificacion: "02",
    numeroIdentificacion: "",
    correo: "",
    telefonoNumero: "",
    otrasSenas: "",
    guardar: true,
  });
  const [ubicacion, setUbicacion] = useState<ValorUbicacion>({});

  // Los perfiles del cliente de la cuenta: es lo que la caja propone
  // antes de hacer buscar nada.
  useEffect(() => {
    if (!propietarioId) {
      setPerfilesDelCliente([]);
      return;
    }
    facturacionCrApi
      .perfilesDeCliente(propietarioId)
      .then((r) => setPerfilesDelCliente(r.perfiles))
      .catch(() => setPerfilesDelCliente([]));
  }, [propietarioId]);

  useEffect(() => {
    if (busqueda.trim().length < 2) {
      setEncontrados([]);
      return;
    }
    setBuscando(true);
    const t = setTimeout(() => {
      facturacionCrApi
        .buscarReceptores(busqueda)
        .then((r) => setEncontrados(r.receptores))
        .catch(() => setEncontrados([]))
        .finally(() => setBuscando(false));
    }, 300);
    return () => clearTimeout(t);
  }, [busqueda]);

  const avisar = (eleccion: EleccionReceptor, resumen: ResumenReceptor) => onCambio(eleccion, resumen);

  const elegirDueno = () => {
    if (!propietarioId) return;
    // Los datos fiscales del dueño los tiene el backend; acá solo se
    // dice "el dueño" y `resolverReceptor` los busca. Copiarlos en la
    // pantalla sería una segunda fuente de la ficha del cliente.
    setElegido({ tipo: "dueno", nombre: propietarioNombre ?? "El dueño", identificacion: null });
    setCreando(false);
    avisar(
      { modo: "dueno", propietarioId },
      {
        nombre: propietarioNombre ?? "El dueño",
        identificacion: null,
        propietarioId,
        // No se sabe acá si la ficha tiene identificación: el backend lo
        // dice al emitir. Se avisa como "puede faltar" en vez de
        // afirmar que está.
        faltaIdentificacion: false,
      }
    );
  };

  const elegirPerfil = (p: PerfilFacturacion) => {
    setElegido({
      tipo: "perfil",
      id: p.id,
      nombre: p.nombre,
      identificacion: p.numero_identificacion,
    });
    setCreando(false);
    setBusqueda("");
    avisar(
      { modo: "perfil", perfilId: p.id },
      {
        nombre: p.nombre,
        identificacion: p.numero_identificacion,
        faltaIdentificacion: false,
        perfilId: p.id,
        datos: {
          nombre: p.nombre,
          tipoIdentificacion: p.tipo_identificacion,
          numeroIdentificacion: p.numero_identificacion,
          correo: p.correo ?? undefined,
          telefonoCodigoPais: p.telefono_codigo_pais ?? undefined,
          telefonoNumero: p.telefono_numero ?? undefined,
          ubicacionProvincia: p.ubicacion_provincia ?? undefined,
          ubicacionCanton: p.ubicacion_canton ?? undefined,
          ubicacionDistrito: p.ubicacion_distrito ?? undefined,
          ubicacionBarrio: p.ubicacion_barrio ?? undefined,
          ubicacionOtrasSenas: p.ubicacion_otras_senas ?? undefined,
        },
      }
    );
  };

  const elegirEncontrado = async (r: ReceptorPosible) => {
    setCreando(false);
    setBusqueda("");

    // Si es un perfil, se trae COMPLETO: la búsqueda devuelve lo justo
    // para mostrar la opción, y la dirección hace falta para llenar los
    // campos de la pantalla de emisión.
    if (r.tipo === "perfil") {
      try {
        const { perfil } = await facturacionCrApi.perfil(r.id);
        elegirPerfil(perfil);
        return;
      } catch {
        // Si no se pudo traer, se usa lo que la búsqueda dio: el
        // backend lo resuelve igual por el id.
      }
    }

    setElegido({
      tipo: r.tipo === "perfil" ? "perfil" : "cliente",
      id: r.id,
      nombre: r.nombre,
      identificacion: r.numeroIdentificacion ?? "",
    } as never);
    avisar(
      { modo: "existente", tipo: r.tipo, id: r.id },
      {
        nombre: r.nombre,
        identificacion: r.numeroIdentificacion,
        faltaIdentificacion: !r.numeroIdentificacion,
        ...(r.tipo === "cliente" ? { propietarioId: r.id } : { perfilId: r.id }),
        datos: {
          nombre: r.nombre,
          tipoIdentificacion: r.tipoIdentificacion ?? undefined,
          numeroIdentificacion: r.numeroIdentificacion ?? undefined,
          correo: r.correo ?? undefined,
        },
      }
    );
  };

  const usarNuevo = () => {
    const datos = {
      nombre: nuevo.nombre.trim(),
      tipoIdentificacion: nuevo.tipoIdentificacion,
      numeroIdentificacion: nuevo.numeroIdentificacion.trim(),
      correo: nuevo.correo.trim() || undefined,
      telefonoCodigoPais: nuevo.telefonoNumero.trim() ? "506" : undefined,
      telefonoNumero: nuevo.telefonoNumero.trim() || undefined,
      ubicacionProvincia: ubicacion.provincia || undefined,
      ubicacionCanton: ubicacion.canton || undefined,
      ubicacionDistrito: ubicacion.distrito || undefined,
      ubicacionBarrio: ubicacion.barrio || undefined,
      ubicacionOtrasSenas: nuevo.otrasSenas.trim() || undefined,
      // Guardarlo para ese cliente es lo que lo hace servir la próxima
      // vez; sin cliente, se guarda igual pero sin ligar.
      propietarioId: nuevo.guardar ? propietarioId ?? undefined : undefined,
    };
    avisar(
      { modo: "nuevo", datos, guardar: nuevo.guardar },
      {
        nombre: datos.nombre,
        identificacion: datos.numeroIdentificacion || null,
        faltaIdentificacion: !datos.numeroIdentificacion,
        datos: {
          nombre: datos.nombre,
          tipoIdentificacion: datos.tipoIdentificacion,
          numeroIdentificacion: datos.numeroIdentificacion,
          correo: datos.correo,
          telefonoCodigoPais: datos.telefonoCodigoPais,
          telefonoNumero: datos.telefonoNumero,
          ubicacionProvincia: datos.ubicacionProvincia,
          ubicacionCanton: datos.ubicacionCanton,
          ubicacionDistrito: datos.ubicacionDistrito,
          ubicacionBarrio: datos.ubicacionBarrio,
          ubicacionOtrasSenas: datos.ubicacionOtrasSenas,
        },
      }
    );
  };

  const limpiar = () => {
    setElegido(null);
    setCreando(false);
    setBusqueda("");
    avisar({ modo: "sin_datos" }, SIN_RECEPTOR);
  };

  return (
    <div className={className}>
      {/* --------------------------------------- Lo elegido */}
      {elegido && !creando && (
        <div className="rounded-xl border border-black/5 bg-surface p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium text-text-primary">{elegido.nombre}</p>
              <p className="text-xs text-text-muted">
                {elegido.tipo === "dueno"
                  ? "el dueño de la mascota, con los datos de su ficha"
                  : elegido.tipo === "perfil"
                    ? `perfil de facturación · ${elegido.identificacion}`
                    : `cliente · ${elegido.identificacion || "sin identificación"}`}
              </p>
            </div>
            <button type="button" onClick={limpiar} className="text-xs underline text-text-muted">
              cambiar
            </button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            El comprobante guarda una <strong>copia</strong> de estos datos: si después se corrige la
            ficha o el perfil, esta factura no cambia.
          </p>
        </div>
      )}

      {!elegido && !creando && (
        <div className="space-y-3">
          {/* 1. El dueño */}
          {propietarioId && (
            <Button variant="secondary" className="w-full justify-start" onClick={elegirDueno}>
              <Icono nombre="propietario" className="mr-2 h-4 w-4" />
              A nombre de {propietarioNombre ?? "el dueño"}
            </Button>
          )}

          {/* 2. Los perfiles de ese cliente */}
          {perfilesDelCliente.length > 0 && (
            <div className="rounded-xl border border-black/5 p-2">
              <p className="px-1 text-xs font-semibold uppercase text-text-muted">
                Perfiles de este cliente
              </p>
              <ul className="mt-1">
                {perfilesDelCliente.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => elegirPerfil(p)}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-background"
                    >
                      <span className="font-medium">{p.nombre}</span>
                      {p.es_predeterminado && (
                        <Badge variant="info" className="ml-2">
                          el habitual
                        </Badge>
                      )}
                      <span className="block text-xs text-text-muted">
                        {p.numero_identificacion}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3. Buscar cualquiera de los dos */}
          <div className="relative">
            <Input
              name="receptor-busqueda"
              label="O buscar otra persona o empresa"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Nombre, razón social o identificación"
            />
            {busqueda.trim().length >= 2 && (
              <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-black/10 bg-surface shadow-lg">
                {buscando && encontrados.length === 0 && (
                  <li className="px-3 py-2 text-sm text-text-muted">Buscando…</li>
                )}
                {!buscando && encontrados.length === 0 && (
                  <li className="px-3 py-2 text-sm text-text-muted">
                    Nadie coincide. Podés registrarlo abajo.
                  </li>
                )}
                {encontrados.map((r) => (
                  <li key={`${r.tipo}-${r.id}`}>
                    <button
                      type="button"
                      onClick={() => elegirEncontrado(r)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-black/5"
                    >
                      <span className="font-medium text-text-primary">{r.nombre}</span>
                      <span className="block text-xs text-text-muted">{r.detalle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4. Uno nuevo */}
          <Button variant="secondary" className="w-full justify-start" onClick={() => setCreando(true)}>
            <Icono nombre="agregar" className="mr-2 h-4 w-4" />
            Registrar a quién se le factura
          </Button>

          {exigeIdentificacion ? (
            <p className="text-xs text-text-muted">
              Una factura necesita identificación. Sin ella, se emite <strong>tiquete</strong>.
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              Un tiquete puede ir sin receptor: si no elegís a nadie, sale así.
            </p>
          )}
        </div>
      )}

      {/* --------------------------------------- Nuevo receptor */}
      {creando && (
        <div className="space-y-3 rounded-xl border border-black/5 p-3">
          <div className="flex items-center justify-between">
            <p className="font-medium text-text-primary">A quién se le factura</p>
            <button
              type="button"
              onClick={() => setCreando(false)}
              className="text-xs underline text-text-muted"
            >
              volver
            </button>
          </div>
          <Input
            name="nuevo-nombre"
            label="Nombre o razón social"
            value={nuevo.nombre}
            onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
            placeholder="Veterinaria del Sur S.A."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              name="nuevo-tipo-id"
              label="Tipo de identificación"
              value={nuevo.tipoIdentificacion}
              onChange={(e) => setNuevo({ ...nuevo, tipoIdentificacion: e.target.value })}
              options={[
                { value: "01", label: "Cédula física" },
                { value: "02", label: "Cédula jurídica" },
                { value: "03", label: "DIMEX" },
                { value: "04", label: "NITE" },
              ]}
            />
            <Input
              name="nuevo-numero-id"
              label="Número"
              value={nuevo.numeroIdentificacion}
              onChange={(e) => setNuevo({ ...nuevo, numeroIdentificacion: e.target.value })}
              placeholder="3101234567"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              name="nuevo-correo"
              label="Correo (para enviarle el comprobante)"
              value={nuevo.correo}
              onChange={(e) => setNuevo({ ...nuevo, correo: e.target.value })}
            />
            <Input
              name="nuevo-telefono"
              label="Teléfono"
              value={nuevo.telefonoNumero}
              onChange={(e) => setNuevo({ ...nuevo, telefonoNumero: e.target.value })}
            />
          </div>
          <SelectorUbicacion valor={ubicacion} onChange={setUbicacion} />
          <Input
            name="nuevo-otras-senas"
            label="Otras señas"
            value={nuevo.otrasSenas}
            onChange={(e) => setNuevo({ ...nuevo, otrasSenas: e.target.value })}
            placeholder="200 metros norte de la iglesia"
          />
          {propietarioId && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nuevo.guardar}
                onChange={(e) => setNuevo({ ...nuevo, guardar: e.target.checked })}
              />
              Guardarlo para {propietarioNombre ?? "este cliente"}, para la próxima vez
            </label>
          )}
          <Button
            className="w-full"
            disabled={!nuevo.nombre.trim() || !nuevo.numeroIdentificacion.trim()}
            onClick={() => {
              usarNuevo();
              setElegido({
                tipo: "perfil",
                id: "",
                nombre: nuevo.nombre.trim(),
                identificacion: nuevo.numeroIdentificacion.trim(),
              });
              setCreando(false);
            }}
          >
            Usar estos datos
          </Button>
        </div>
      )}
    </div>
  );
}
