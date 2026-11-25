import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Icono, NombreIcono } from "./ui/Icono";
import { misRoles, useAuth } from "../hooks/useAuth";
import { Reciente, useRecientes } from "../hooks/useRecientes";
import {
  ATAJO_AYUDA,
  ATAJO_PALETA,
  Comando,
  PREFIJO_SECUENCIA,
  comandosParaRoles,
  esCampoDeTexto,
  filtrarComandos,
} from "../lib/comandos";
import { PacienteBuscado, PropietarioBuscado, busquedaApi } from "../lib/busquedaApi";

// ---------------------------------------------------------------------
// Paleta de comandos global (Ctrl/Cmd+K) + atajos + ayuda (`?`).
//
// Está TODO en un componente porque es un solo mecanismo: el registro de
// comandos, el manejador de teclado, la paleta y el cartel de ayuda leen
// lo mismo (`lib/comandos.ts`) y comparten el estado de "hay un overlay
// abierto". Partirlo en cuatro archivos haría que cada uno tuviera que
// enterarse de los otros tres.
//
// Se monta UNA vez, arriba del router, así que funciona en las tres zonas
// (workspace, admin, agenda) sin que ningún layout tenga que incluirlo.
//
// Solo para sesiones de clínica: el staff de plataforma no tiene
// pacientes ni agenda, y la búsqueda del backend le daría 403.
// ---------------------------------------------------------------------

type Resultado =
  | { tipo: "comando"; comando: Comando }
  | { tipo: "paciente"; paciente: PacienteBuscado }
  | { tipo: "propietario"; propietario: PropietarioBuscado }
  | { tipo: "reciente"; reciente: Reciente };

const MS_DEBOUNCE = 220;

function Fila({
  icono,
  titulo,
  detalle,
  activa,
  onClick,
  onMouseEnter,
  insignia,
}: {
  icono: NombreIcono;
  titulo: string;
  detalle?: string;
  activa: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  insignia?: string;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={activa}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={[
        "flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm",
        activa ? "bg-background" : "hover:bg-background/60",
      ].join(" ")}
    >
      <span className="flex-shrink-0 text-text-muted">
        <Icono nombre={icono} tamano={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-text-primary">{titulo}</span>
        {detalle && <span className="block truncate text-xs text-text-muted">{detalle}</span>}
      </span>
      {insignia && (
        <span className="flex-shrink-0 rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs text-text-muted">
          {insignia}
        </span>
      )}
    </button>
  );
}

function Tecla({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-black/10 bg-background px-1.5 py-0.5 font-mono text-xs text-text-muted">
      {children}
    </kbd>
  );
}

export function PaletaComandos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [abierta, setAbierta] = useState(false);
  const [ayudaAbierta, setAyudaAbierta] = useState(false);
  const [consulta, setConsulta] = useState("");
  const [indice, setIndice] = useState(0);
  const [pacientes, setPacientes] = useState<PacienteBuscado[]>([]);
  const [propietarios, setPropietarios] = useState<PropietarioBuscado[]>([]);
  const [buscando, setBuscando] = useState(false);

  const campo = useRef<HTMLInputElement>(null);
  // La secuencia `g` + tecla: guarda si `g` se apretó hace poco.
  const esperandoSecuencia = useRef(false);
  const temporizadorSecuencia = useRef<number | undefined>(undefined);

  const { recientes, registrar } = useRecientes(user?.userId ?? null);
  const esClinica = Boolean(user?.tenantId);
  const comandos = useMemo(() => (user ? comandosParaRoles(misRoles(user)) : []), [user]);

  // --- registrar la pantalla visitada como reciente --------------------
  useEffect(() => {
    if (!esClinica) return;
    const comando = comandos.find((c) => c.a === location.pathname);
    if (comando) registrar({ tipo: "pantalla", a: comando.a, titulo: comando.titulo });
    // `registrar` es estable (useCallback con userId), pero incluirlo en
    // las dependencias volvería a correr esto en cada render del padre.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, esClinica]);

  const cerrar = useCallback(() => {
    setAbierta(false);
    setConsulta("");
    setIndice(0);
    setPacientes([]);
    setPropietarios([]);
  }, []);

  // --- teclado global --------------------------------------------------
  useEffect(() => {
    if (!esClinica) return;

    function alPresionar(e: KeyboardEvent) {
      const modificador = e.metaKey || e.ctrlKey;

      // Ctrl/Cmd+K abre la paleta. Es el ÚNICO atajo que funciona
      // también dentro de un campo de texto: estando escribiendo en un
      // formulario uno igual quiere poder saltar a otro lado.
      if (modificador && e.key.toLowerCase() === ATAJO_PALETA.tecla) {
        e.preventDefault();
        setAyudaAbierta(false);
        setAbierta((a) => !a);
        return;
      }

      if (e.key === "Escape") {
        if (ayudaAbierta) setAyudaAbierta(false);
        else if (abierta) cerrar();
        return;
      }

      // De acá para abajo, nada se dispara mientras se escribe ni con un
      // modificador apretado (que sería un atajo del navegador).
      if (esCampoDeTexto(e.target) || modificador || e.altKey) return;
      if (abierta) return; // dentro de la paleta manda su propio manejador

      if (e.key === ATAJO_AYUDA.tecla) {
        e.preventDefault();
        setAyudaAbierta((a) => !a);
        return;
      }

      // Secuencia `g` + tecla.
      if (!esperandoSecuencia.current && e.key.toLowerCase() === PREFIJO_SECUENCIA) {
        esperandoSecuencia.current = true;
        // Ventana de 1,2 s: suficiente para una secuencia intencional,
        // corta para que una `g` olvidada no capture una tecla futura.
        window.clearTimeout(temporizadorSecuencia.current);
        temporizadorSecuencia.current = window.setTimeout(() => {
          esperandoSecuencia.current = false;
        }, 1200);
        return;
      }

      if (esperandoSecuencia.current) {
        esperandoSecuencia.current = false;
        window.clearTimeout(temporizadorSecuencia.current);
        const comando = comandos.find((c) => c.atajo === e.key.toLowerCase());
        if (comando) {
          e.preventDefault();
          navigate(comando.a);
        }
      }
    }

    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [abierta, ayudaAbierta, cerrar, comandos, esClinica, navigate]);

  useEffect(() => {
    if (abierta) campo.current?.focus();
  }, [abierta]);

  // --- búsqueda en el backend, con debounce ---------------------------
  useEffect(() => {
    if (!abierta) return;
    const q = consulta.trim();
    // Misma regla que el backend (ver busqueda.routes.ts): dos letras
    // como mínimo, pero UN dígito ya sirve — un expediente "7" es una
    // búsqueda exacta, no difusa. Con el mínimo en 2 a secas, los
    // expedientes del 1 al 9 eran inalcanzables.
    if (q.length === 0 || (!/^\d+$/.test(q) && q.length < 2)) {
      setPacientes([]);
      setPropietarios([]);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const timer = window.setTimeout(() => {
      busquedaApi
        .global(q)
        .then((r) => {
          // Si la persona siguió escribiendo, este resultado ya es viejo.
          if (r.consulta !== consulta.trim()) return;
          setPacientes(r.pacientes);
          setPropietarios(r.propietarios);
        })
        .catch(() => {
          setPacientes([]);
          setPropietarios([]);
        })
        .finally(() => setBuscando(false));
    }, MS_DEBOUNCE);
    return () => window.clearTimeout(timer);
  }, [consulta, abierta]);

  // --- lista de resultados --------------------------------------------
  const resultados: Resultado[] = useMemo(() => {
    const q = consulta.trim();
    if (!q) {
      // Paleta vacía: primero los recientes, después todos los comandos.
      return [
        ...recientes.map((reciente) => ({ tipo: "reciente" as const, reciente })),
        ...comandos.map((comando) => ({ tipo: "comando" as const, comando })),
      ];
    }
    return [
      ...filtrarComandos(comandos, q).map((comando) => ({ tipo: "comando" as const, comando })),
      ...pacientes.map((paciente) => ({ tipo: "paciente" as const, paciente })),
      ...propietarios.map((propietario) => ({ tipo: "propietario" as const, propietario })),
    ];
  }, [consulta, comandos, pacientes, propietarios, recientes]);

  useEffect(() => setIndice(0), [consulta]);

  const ejecutar = useCallback(
    (resultado: Resultado) => {
      cerrar();
      switch (resultado.tipo) {
        case "comando":
          navigate(resultado.comando.a);
          break;
        case "reciente":
          navigate(resultado.reciente.a);
          break;
        case "paciente": {
          const a = `/pacientes/${resultado.paciente.id}`;
          registrar({
            tipo: "paciente",
            a,
            titulo: resultado.paciente.nombre,
            detalle: `Expediente N.º ${resultado.paciente.numero_expediente}`,
          });
          navigate(a);
          break;
        }
        case "propietario":
          // No hay pantalla de ficha de propietario todavía: el listado
          // de admin con la búsqueda por su nombre es lo más cerca que
          // se puede llevar a alguien hoy, y es mejor que no ofrecerlo.
          navigate(`/admin/propietarios?q=${encodeURIComponent(resultado.propietario.nombre)}`);
          break;
      }
    },
    [cerrar, navigate, registrar]
  );

  if (!esClinica) return null;

  return (
    <>
      {abierta && (
        <div
          className="fixed inset-0 z-[90] flex items-start justify-center bg-primary/60 p-4 pt-[12vh]"
          onClick={cerrar}
          role="dialog"
          aria-modal="true"
          aria-label="Paleta de comandos"
        >
          <div
            className="w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-black/5 px-4 py-3">
              <span className="text-text-muted">
                <Icono nombre="buscar" tamano={20} />
              </span>
              <input
                ref={campo}
                value={consulta}
                onChange={(e) => setConsulta(e.target.value)}
                placeholder="Buscar pacientes, propietarios o pantallas…"
                aria-label="Buscar"
                role="combobox"
                aria-expanded
                aria-controls="paleta-resultados"
                className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setIndice((i) => Math.min(resultados.length - 1, i + 1));
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setIndice((i) => Math.max(0, i - 1));
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const elegido = resultados[indice];
                    if (elegido) ejecutar(elegido);
                  }
                }}
              />
              {buscando && <span className="text-xs text-text-muted">Buscando…</span>}
            </div>

            <div id="paleta-resultados" role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
              {resultados.length === 0 && (
                <p className="px-4 py-6 text-center text-sm text-text-muted">
                  {consulta.trim().length === 0
                    ? "Escribí para buscar, o elegí algo de la lista."
                    : !/^\d+$/.test(consulta.trim()) && consulta.trim().length < 2
                      ? "Escribí al menos dos letras."
                      : "No encontramos nada con eso."}
                </p>
              )}

              {resultados.map((r, i) => {
                const activa = i === indice;
                const alEntrar = () => setIndice(i);
                if (r.tipo === "comando") {
                  return (
                    <Fila
                      key={`c-${r.comando.id}`}
                      icono={r.comando.icono}
                      titulo={r.comando.titulo}
                      detalle={r.comando.grupo}
                      insignia={r.comando.atajo ? `g ${r.comando.atajo}` : undefined}
                      activa={activa}
                      onClick={() => ejecutar(r)}
                      onMouseEnter={alEntrar}
                    />
                  );
                }
                if (r.tipo === "reciente") {
                  return (
                    <Fila
                      key={`r-${r.reciente.a}`}
                      icono={r.reciente.tipo === "paciente" ? "paciente" : "panel"}
                      titulo={r.reciente.titulo}
                      detalle={r.reciente.detalle ?? "Reciente"}
                      activa={activa}
                      onClick={() => ejecutar(r)}
                      onMouseEnter={alEntrar}
                    />
                  );
                }
                if (r.tipo === "paciente") {
                  const p = r.paciente;
                  return (
                    <Fila
                      key={`p-${p.id}`}
                      icono="paciente"
                      titulo={p.nombre}
                      detalle={[
                        `N.º ${p.numero_expediente}`,
                        p.raza ? `${p.especie} · ${p.raza}` : p.especie,
                        p.propietario_nombre,
                        p.estado === "fallecido" ? "fallecido" : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      activa={activa}
                      onClick={() => ejecutar(r)}
                      onMouseEnter={alEntrar}
                    />
                  );
                }
                const pr = r.propietario;
                return (
                  <Fila
                    key={`t-${pr.id}`}
                    icono="propietario"
                    titulo={pr.nombre}
                    detalle={[
                      pr.telefono,
                      pr.numero_identificacion
                        ? `${pr.tipo_identificacion_etiqueta}: ${pr.numero_identificacion}`
                        : null,
                      `${pr.cantidad_pacientes} ${pr.cantidad_pacientes === 1 ? "mascota" : "mascotas"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    activa={activa}
                    onClick={() => ejecutar(r)}
                    onMouseEnter={alEntrar}
                  />
                );
              })}
            </div>

            <div className="flex items-center gap-4 border-t border-black/5 px-4 py-2 text-xs text-text-muted">
              <span className="flex items-center gap-1">
                <Tecla>↑</Tecla>
                <Tecla>↓</Tecla> moverse
              </span>
              <span className="flex items-center gap-1">
                <Tecla>Enter</Tecla> abrir
              </span>
              <span className="flex items-center gap-1">
                <Tecla>Esc</Tecla> cerrar
              </span>
              <span className="ml-auto flex items-center gap-1">
                <Tecla>?</Tecla> atajos
              </span>
            </div>
          </div>
        </div>
      )}

      {ayudaAbierta && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-primary/60 p-4"
          onClick={() => setAyudaAbierta(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Atajos de teclado"
        >
          <div
            className="w-full max-w-lg rounded-2xl bg-surface p-8 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-xl font-bold text-primary">Atajos de teclado</h2>
            <p className="mt-1 text-sm text-text-muted">
              Los atajos no funcionan mientras escribís en un campo, y ninguno pisa un atajo del
              navegador.
            </p>

            <dl className="mt-6 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-4 border-b border-black/5 pb-2">
                <dt className="text-text-primary">Abrir la paleta de comandos</dt>
                <dd className="flex gap-1">
                  <Tecla>Ctrl</Tecla>
                  <span className="text-text-muted">o</span>
                  <Tecla>⌘</Tecla>
                  <span className="text-text-muted">+</span>
                  <Tecla>K</Tecla>
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4 border-b border-black/5 pb-2">
                <dt className="text-text-primary">Mostrar u ocultar esta ayuda</dt>
                <dd>
                  <Tecla>?</Tecla>
                </dd>
              </div>

              {/* La lista sale del MISMO registro que usa la paleta: no
                  puede anunciar un atajo que no exista. */}
              {comandos
                .filter((c) => c.atajo)
                .map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-4 border-b border-black/5 pb-2 last:border-0"
                  >
                    <dt className="flex items-center gap-2 text-text-primary">
                      <span className="text-text-muted">
                        <Icono nombre={c.icono} tamano={16} />
                      </span>
                      {c.grupo === "Crear" ? c.titulo : `Ir a ${c.titulo}`}
                    </dt>
                    <dd className="flex gap-1">
                      <Tecla>G</Tecla>
                      <Tecla>{c.atajo!.toUpperCase()}</Tecla>
                    </dd>
                  </div>
                ))}
            </dl>

            <p className="mt-6 text-xs text-text-muted">
              Los atajos de dos teclas se escriben en secuencia: primero <Tecla>G</Tecla>, después la
              segunda. Tenés poco más de un segundo entre las dos.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
