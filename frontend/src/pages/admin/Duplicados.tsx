import { useEffect, useState } from "react";
import { Badge, Button, LoadingState, PageHeader, useToast } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { crmApi, ParDeClientes, GrupoDePacientes } from "../../lib/crmApi";
import { etiqueta } from "../../lib/etiquetas";

// ---------------------------------------------------------------------
// POSIBLES DUPLICADOS — anexo 07-03, B1.
//
// LA PANTALLA NO DECIDE: PROPONE. El criterio de parecido vive en el
// backend (`crm/duplicados.ts`) y es el mismo que usa el aviso del alta
// y el script que se corrió contra la base real. Acá se muestran los
// pares y se elige, campo por campo, con qué datos se queda la ficha que
// sobrevive.
//
// POR QUÉ LA ELECCIÓN ES CAMPO POR CAMPO Y NO «quedate con esta ficha»:
// el duplicado típico tiene la mitad de los datos buenos en cada lado
// —la vieja tiene la cédula, la nueva tiene el teléfono actual—. Elegir
// una ficha entera obligaría a copiar a mano lo que la otra tenía mejor,
// que es justo el trabajo que esta pantalla existe para evitar.
//
// FUSIONAR ES DEL ADMINISTRADOR. La lista la ve todo el personal porque
// es la recepción la que reconoce al cliente repetido; el botón de
// unificar solo aparece para el administrador, igual que lo exige el
// backend.
// ---------------------------------------------------------------------

type Pestana = "clientes" | "pacientes" | "hechas";

const CAMPOS_CLIENTE: Array<{ campo: string; etiqueta: string }> = [
  { campo: "nombre", etiqueta: "Nombre" },
  { campo: "telefono", etiqueta: "Teléfono" },
  { campo: "email", etiqueta: "Correo" },
];

export function Duplicados() {
  const { esAdminClinica } = useAuth();
  const { mostrar } = useToast();
  const [pestana, setPestana] = useState<Pestana>("clientes");
  const [cargando, setCargando] = useState(true);
  const [pares, setPares] = useState<ParDeClientes[]>([]);
  const [grupos, setGrupos] = useState<GrupoDePacientes[]>([]);
  const [hechas, setHechas] = useState<
    Array<{
      id: string;
      entidad: string;
      sobreviviente_nombre: string;
      absorbido_nombre: string;
      hecho_en: string;
      hecho_por_nombre: string | null;
    }>
  >([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  // La ficha que sobrevive y, por cada campo, de cuál de las dos se toma
  // el valor. Se guarda el valor y no el lado: lo que se manda al
  // backend es el dato final.
  const [sobreviviente, setSobreviviente] = useState<string | null>(null);
  const [elegido, setElegido] = useState<Record<string, unknown>>({});
  const [trabajando, setTrabajando] = useState(false);
  const [recargar, setRecargar] = useState(0);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      crmApi.duplicadosClientes(),
      crmApi.duplicadosPacientes(),
      crmApi.unificaciones(),
    ])
      .then(([c, p, h]) => {
        if (!vivo) return;
        setPares(c.pares);
        setGrupos(p.grupos);
        setHechas(h.unificaciones);
      })
      .catch((err) => vivo && mostrar("error", err instanceof Error ? err.message : "No pudimos cargar los duplicados."))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [recargar, mostrar]);

  const abrirPar = (clave: string, idSugerido: string, valores: Record<string, unknown>) => {
    setAbierto(clave);
    setSobreviviente(idSugerido);
    setElegido(valores);
  };

  const unificar = async (entidad: "clientes" | "pacientes", a: string, b: string) => {
    if (!sobreviviente) return;
    const absorbido = sobreviviente === a ? b : a;
    setTrabajando(true);
    try {
      const r = await crmApi.unificar(entidad, {
        sobrevivienteId: sobreviviente,
        absorbidoId: absorbido,
        elegido,
      });
      mostrar(
        "exito",
        r.conflictos.length > 0
          ? `Fichas unificadas. ${r.conflictos.join(" ")}`
          : "Fichas unificadas."
      );
      setAbierto(null);
      setRecargar((n) => n + 1);
    } catch (err) {
      // El 409 trae el motivo en castellano y dice qué hacer antes de
      // reintentar: se muestra tal cual, sin traducirlo otra vez.
      mostrar("error", err instanceof Error ? err.message : "No pudimos unificar las fichas.");
    } finally {
      setTrabajando(false);
    }
  };

  if (cargando) return <LoadingState forma="tarjetas" etiqueta="Buscando posibles duplicados" />;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Posibles duplicados"
        subtitulo="El mismo cliente o la misma mascota cargados dos veces. Unificar junta la historia en una sola ficha y no se deshace con un botón."
        icono="propietario"
      />

      <div className="flex gap-1 border-b border-black/5">
        {(
          [
            ["clientes", `Clientes (${pares.length})`],
            ["pacientes", `Pacientes (${grupos.length})`],
            ["hechas", "Ya unificadas"],
          ] as Array<[Pestana, string]>
        ).map(([valor, titulo]) => (
          <button
            key={valor}
            type="button"
            onClick={() => setPestana(valor)}
            className={`px-4 py-2 text-sm font-semibold ${
              pestana === valor
                ? "border-b-2 border-primary text-primary"
                : "text-text-muted hover:text-text-primary"
            }`}
          >
            {titulo}
          </button>
        ))}
      </div>

      {pestana === "clientes" &&
        (pares.length === 0 ? (
          <p className="text-sm text-text-muted">
            No hay clientes que se parezcan entre sí. Es la respuesta buena.
          </p>
        ) : (
          <ul className="space-y-3">
            {pares.map((par) => {
              const clave = `${par.a.id}|${par.b.id}`;
              const esteAbierto = abierto === clave;
              return (
                <li key={clave} className="rounded-2xl border border-black/10 bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-text-primary">
                        {par.a.nombre} · {par.b.nombre}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        Coincide por {par.b.criterios.map((c) => etiqueta(c).toLowerCase()).join(", ")}.
                        {" "}
                        {par.a.pacientes} y {par.b.pacientes} mascotas.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={par.puntaje >= 100 ? "error" : par.puntaje >= 70 ? "warning" : "neutral"}>
                        {par.puntaje}
                      </Badge>
                      {esAdminClinica && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            esteAbierto
                              ? setAbierto(null)
                              : abrirPar(clave, par.a.pacientes >= par.b.pacientes ? par.a.id : par.b.id, {
                                  nombre: par.a.nombre,
                                  telefono: par.a.telefono ?? "",
                                  email: par.a.email ?? "",
                                })
                          }
                        >
                          {esteAbierto ? "Cerrar" : "Revisar"}
                        </Button>
                      )}
                    </div>
                  </div>

                  {esteAbierto && (
                    <div className="mt-4 space-y-4 border-t border-black/5 pt-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                          ¿Cuál ficha se queda?
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {[par.a, par.b].map((lado) => (
                            <label
                              key={lado.id}
                              className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                                sobreviviente === lado.id
                                  ? "border-primary bg-primary/5"
                                  : "border-black/10"
                              }`}
                            >
                              <input
                                type="radio"
                                className="mt-1"
                                checked={sobreviviente === lado.id}
                                onChange={() => setSobreviviente(lado.id)}
                              />
                              <span>
                                <span className="font-semibold text-text-primary">{lado.nombre}</span>
                                <br />
                                <span className="text-xs text-text-muted">
                                  {lado.telefono ?? "sin teléfono"} · {lado.pacientes} mascotas
                                  {lado.numeroIdentificacion ? ` · ${lado.numeroIdentificacion}` : ""}
                                </span>
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                          Con qué datos se queda
                        </p>
                        <table className="mt-2 w-full text-sm">
                          <tbody>
                            {CAMPOS_CLIENTE.map(({ campo, etiqueta: titulo }) => {
                              const valorA = (par.a as unknown as Record<string, string | null>)[campo] ?? "";
                              const valorB = (par.b as unknown as Record<string, string | null>)[campo] ?? "";
                              return (
                                <tr key={campo} className="border-t border-black/5">
                                  <th className="w-28 py-2 text-left font-semibold text-text-muted">
                                    {titulo}
                                  </th>
                                  {[valorA, valorB].map((v, i) => (
                                    <td key={i} className="py-2">
                                      <label className="flex cursor-pointer items-center gap-2">
                                        <input
                                          type="radio"
                                          checked={(elegido[campo] ?? "") === v}
                                          onChange={() => setElegido((e) => ({ ...e, [campo]: v }))}
                                        />
                                        <span className={v ? "text-text-primary" : "text-text-muted"}>
                                          {v || "—"}
                                        </span>
                                      </label>
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* LO QUE VA A PASAR, ANTES DE CONFIRMAR. No es
                          decorativo: la fusión no se deshace con un
                          botón, y quien la confirma tiene que saber qué
                          se mueve y qué no. */}
                      <div className="rounded-lg bg-background p-3 text-xs text-text-muted">
                        Las mascotas, las citas, los comprobantes y los movimientos de caja de la
                        ficha absorbida pasan a la que se queda. Si una decía que no a un
                        consentimiento, queda el NO. El historial del cliente no se reescribe: la
                        ficha que se queda muestra la historia de las dos.
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setAbierto(null)}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={() => unificar("clientes", par.a.id, par.b.id)}
                          disabled={trabajando || !sobreviviente}
                        >
                          {trabajando ? "Unificando…" : "Unificar las dos fichas"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}

      {pestana === "pacientes" &&
        (grupos.length === 0 ? (
          <p className="text-sm text-text-muted">
            No hay mascotas repetidas del mismo dueño.
          </p>
        ) : (
          <ul className="space-y-3">
            {grupos.map((g) => {
              const clave = g.grupo.map((x) => x.id).join("|");
              const esteAbierto = abierto === clave;
              const [uno, dos] = g.grupo;
              return (
                <li key={clave} className="rounded-2xl border border-black/10 bg-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-text-primary">
                        {g.grupo.map((x) => `${x.nombre} (exp. ${x.numeroExpediente ?? "—"})`).join(" · ")}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        Mismo dueño: {g.propietarioNombre} · {etiqueta(uno.especie)}
                      </p>
                    </div>
                    {esAdminClinica && g.grupo.length === 2 && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          esteAbierto
                            ? setAbierto(null)
                            : abrirPar(
                                clave,
                                uno.atenciones >= dos.atenciones ? uno.id : dos.id,
                                { nombre: uno.nombre }
                              )
                        }
                      >
                        {esteAbierto ? "Cerrar" : "Revisar"}
                      </Button>
                    )}
                  </div>

                  {/* TRES O MÁS NO SE UNIFICAN DE UNA. Se hace de dos en
                      dos, y la segunda vuelta toma al que ya sobrevivió:
                      así cada paso queda auditado por separado y se
                      puede parar en el medio. */}
                  {g.grupo.length > 2 && (
                    <p className="mt-2 text-xs text-text-muted">
                      Son {g.grupo.length} expedientes. Se unifican de dos en dos: unificá dos y
                      volvé a esta pantalla.
                    </p>
                  )}

                  {esteAbierto && (
                    <div className="mt-4 space-y-4 border-t border-black/5 pt-4">
                      <div className="grid gap-2 sm:grid-cols-2">
                        {g.grupo.map((lado) => (
                          <label
                            key={lado.id}
                            className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${
                              sobreviviente === lado.id ? "border-primary bg-primary/5" : "border-black/10"
                            }`}
                          >
                            <input
                              type="radio"
                              className="mt-1"
                              checked={sobreviviente === lado.id}
                              onChange={() => {
                                setSobreviviente(lado.id);
                                setElegido({ nombre: lado.nombre });
                              }}
                            />
                            <span>
                              <span className="font-semibold text-text-primary">{lado.nombre}</span>
                              <br />
                              <span className="text-xs text-text-muted">
                                exp. {lado.numeroExpediente ?? "—"} · {lado.atenciones} atenciones ·{" "}
                                {lado.casos} casos
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <div className="rounded-lg bg-background p-3 text-xs text-text-muted">
                        La historia clínica, las recetas, los estudios y los cargos del expediente
                        absorbido pasan al que se queda, y su número de expediente sigue
                        encontrándolo. El absorbido queda dado de baja, no se borra.
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="secondary" onClick={() => setAbierto(null)}>
                          Cancelar
                        </Button>
                        <Button
                          onClick={() => unificar("pacientes", uno.id, dos.id)}
                          disabled={trabajando || !sobreviviente}
                        >
                          {trabajando ? "Unificando…" : "Unificar los dos expedientes"}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}

      {pestana === "hechas" &&
        (hechas.length === 0 ? (
          <p className="text-sm text-text-muted">Todavía no se unificó ninguna ficha.</p>
        ) : (
          <ul className="divide-y divide-black/5 rounded-2xl border border-black/10 bg-surface">
            {hechas.map((u) => (
              <li key={u.id} className="px-4 py-3 text-sm">
                <span className="font-semibold text-text-primary">{u.sobreviviente_nombre}</span>{" "}
                absorbió a <span className="text-text-primary">{u.absorbido_nombre}</span>
                <span className="text-text-muted">
                  {" "}
                  · {etiqueta(u.entidad)} · {new Date(u.hecho_en).toLocaleString("es-CR")}
                  {u.hecho_por_nombre ? ` · ${u.hecho_por_nombre}` : ""}
                </span>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
