import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Table,
  Tabs,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { apiFetchBlob } from "../../lib/api";
import { getStoredToken } from "../../hooks/useAuth";
import { guardarComoArchivo } from "../../lib/descargas";
import {
  administracionApi,
  Ausencia,
  CatalogoDeclarado,
  Credencial,
  EventoAuditoria,
  ItemCatalogo,
  Liquidacion,
  PermisoCumplimiento,
  PorVencer,
  Procedimiento,
  ReglaComision,
  Turno,
} from "../../lib/administracionApi";
import { clinicaApi, PersonaDeLaClinica } from "../../lib/clinicaApi";
import { formatearFecha, formatearFechaCorta } from "../../lib/formatFecha";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------
// ADMINISTRACIÓN COMPLETA — prompt 11.
//
// Seis pestañas, las seis secciones del prompt. Cada una con su permiso:
// lo que no se puede hacer no muestra su botón, y el backend lo vuelve a
// comprobar igual.
// ---------------------------------------------------------------------

const PESTANAS = [
  { clave: "catalogos", etiqueta: "Catálogos" },
  { clave: "personal", etiqueta: "Personal y turnos" },
  { clave: "comisiones", etiqueta: "Comisiones" },
  { clave: "cumplimiento", etiqueta: "Cumplimiento" },
  { clave: "auditoria", etiqueta: "Auditoría" },
  { clave: "procedimientos", etiqueta: "Procedimientos" },
];

const NOMBRE_GRUPO: Record<string, string> = {
  inventario: "Inventario",
  veterinaria: "Veterinaria",
  recetas: "Recetas",
  clientes: "Clientes",
  agenda: "Agenda",
  documentos: "Documentos",
};

const CON_HORA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function colones(n: number | string): string {
  const v = typeof n === "string" ? Number(n) : n;
  return `₡${v.toLocaleString("es-CR", { maximumFractionDigits: 2 })}`;
}

export function AdministracionCompleta() {
  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Administración de la clínica"
        subtitulo="Los catálogos, quién trabaja cuándo, cuánto se le paga, qué exige la ley y quién hizo qué."
        icono="clinica"
        modulo="admin"
      />
      <Tabs pestanas={PESTANAS}>
        {(activa) => (
          <>
            {activa === "catalogos" && <PanelCatalogos />}
            {activa === "personal" && <PanelPersonal />}
            {activa === "comisiones" && <PanelComisiones />}
            {activa === "cumplimiento" && <PanelCumplimiento />}
            {activa === "auditoria" && <PanelAuditoria />}
            {activa === "procedimientos" && <PanelProcedimientos />}
          </>
        )}
      </Tabs>
    </div>
  );
}

// =====================================================================
// CATÁLOGOS
// =====================================================================
function PanelCatalogos() {
  const { puede } = useAuth();
  const toast = useToast();
  const puedeEditar = puede("catalogos.editar");
  const [catalogos, setCatalogos] = useState<CatalogoDeclarado[]>([]);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [items, setItems] = useState<ItemCatalogo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nuevo, setNuevo] = useState("");
  const [trabajando, setTrabajando] = useState(false);

  useEffect(() => {
    administracionApi
      .catalogos()
      .then((r) => setCatalogos(r.catalogos))
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo cargar."))
      .finally(() => setCargando(false));
  }, []);

  async function abrir(clave: string) {
    setAbierto(clave);
    setNuevo("");
    try {
      const r = await administracionApi.items(clave, true);
      setItems(r.items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo abrir el catálogo.");
    }
  }

  async function agregar() {
    if (!abierto || !nuevo.trim()) return;
    setTrabajando(true);
    try {
      await administracionApi.guardarItem(abierto, { nombre: nuevo.trim() });
      setNuevo("");
      setItems((await administracionApi.items(abierto, true)).items);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo agregar.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) return <LoadingState forma="tarjetas" />;

  const grupos = [...new Set(catalogos.map((c) => c.grupo))];

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        Un solo lugar para encontrarlos todos. Los que ya tienen su pantalla en su módulo se{" "}
        <strong>enlazan</strong> desde acá y no se copian: dos lugares donde editar lo mismo es cómo
        una clínica termina con dos listas distintas de bodegas.
      </p>

      {grupos.map((g) => (
        <section key={g} className="space-y-2">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            {NOMBRE_GRUPO[g] ?? g}
          </h2>
          <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
            {catalogos
              .filter((c) => c.grupo === g)
              .map((c) => (
                <div key={c.clave} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-text">{c.nombre}</div>
                    <div className="text-xs text-text-muted">{c.descripcion}</div>
                  </div>
                  {c.donde === "aqui" ? (
                    <Button variant="secondary" size="sm" onClick={() => abrir(c.clave)}>
                      Abrir
                    </Button>
                  ) : (
                    <Link to={c.donde}>
                      <Button variant="ghost" size="sm">
                        Ir a su módulo
                      </Button>
                    </Link>
                  )}
                </div>
              ))}
          </div>
        </section>
      ))}

      <Modal
        open={abierto !== null}
        onClose={() => setAbierto(null)}
        title={catalogos.find((c) => c.clave === abierto)?.nombre ?? ""}
        description="Los valores se desactivan en vez de borrarse cuando algo los usa."
        ancho="lg"
      >
        <div className="space-y-3">
          {puedeEditar && (
            <div className="flex gap-2">
              <Input
                value={nuevo}
                onChange={(e) => setNuevo(e.target.value)}
                placeholder="Agregar un valor…"
              />
              <Button onClick={agregar} disabled={trabajando || !nuevo.trim()}>
                Agregar
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  if (!abierto) return;
                  try {
                    const blob = await apiFetchBlob(
                      administracionApi.urlExportarCatalogo(abierto),
                      { token: getStoredToken() }
                    );
                    guardarComoArchivo(blob, `${abierto}.xlsx`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo exportar.");
                  }
                }}
              >
                Exportar
              </Button>
            </div>
          )}
          <ul className="divide-y divide-black/5">
            {items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-sm">
                <span className={`flex-1 ${i.activo ? "text-text" : "text-text-muted line-through"}`}>
                  {i.nombre}
                </span>
                {puedeEditar && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={trabajando}
                    onClick={async () => {
                      if (!abierto) return;
                      setTrabajando(true);
                      try {
                        await administracionApi.alternarItem(abierto, i.id, !i.activo);
                        setItems((await administracionApi.items(abierto, true)).items);
                      } finally {
                        setTrabajando(false);
                      }
                    }}
                  >
                    {i.activo ? "Desactivar" : "Activar"}
                  </Button>
                )}
              </li>
            ))}
            {items.length === 0 && <li className="py-2 text-sm text-text-muted">Está vacío.</li>}
          </ul>
        </div>
      </Modal>
    </div>
  );
}

// =====================================================================
// PERSONAL Y TURNOS
// =====================================================================
function PanelPersonal() {
  const { puede, zonaHoraria, user } = useAuth();
  const toast = useToast();
  const puedeGestionar = puede("personal.gestionar");
  const [personas, setPersonas] = useState<PersonaDeLaClinica[]>([]);
  const [lunes, setLunes] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  });
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [credenciales, setCredenciales] = useState<Credencial[]>([]);
  const [porVencer, setPorVencer] = useState<PorVencer[]>([]);
  const [cargando, setCargando] = useState(true);
  const [recargar, setRecargar] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [nuevoTurno, setNuevoTurno] = useState<{
    personaId: string;
    fecha: string;
    horaDesde: string;
    horaHasta: string;
    tipo: string;
  } | null>(null);
  const [nuevaAusencia, setNuevaAusencia] = useState<{
    personaId: string;
    tipo: string;
    desde: string;
    hasta: string;
    nota: string;
  } | null>(null);

  const domingo = new Date(new Date(lunes).getTime() + 6 * 86400000).toISOString().slice(0, 10);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, t, a, c] = await Promise.all([
          clinicaApi.personas(),
          administracionApi.turnos(lunes, domingo),
          administracionApi.ausencias(),
          administracionApi.credenciales(),
        ]);
        if (!vivo) return;
        setPersonas(p.personas.filter((x) => x.estado === "activo"));
        setTurnos(t.turnos);
        setAusencias(a.ausencias);
        setCredenciales(c.credenciales);
        setPorVencer(c.porVencer);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [lunes, recargar]);

  if (cargando) return <LoadingState forma="tabla" />;

  const dias = Array.from({ length: 7 }, (_, i) =>
    new Date(new Date(lunes).getTime() + i * 86400000).toISOString().slice(0, 10)
  );

  return (
    <div className="space-y-6">
      {porVencer.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-bold text-amber-900">Vence pronto</h3>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {porVencer.map((v) => (
              <li key={`${v.clase}-${v.id}`}>
                {v.titulo}
                {v.de_quien ? ` — ${v.de_quien}` : ""}:{" "}
                {v.dias_para_vencer < 0
                  ? `venció hace ${-v.dias_para_vencer} días`
                  : `en ${v.dias_para_vencer} días`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* --- La semana --- */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Input
            label="Semana del"
            type="date"
            value={lunes}
            onChange={(e) => setLunes(e.target.value)}
          />
          {puedeGestionar && (
            <>
              <Button
                variant="secondary"
                disabled={trabajando}
                onClick={async () => {
                  setTrabajando(true);
                  try {
                    const siguiente = new Date(new Date(lunes).getTime() + 7 * 86400000)
                      .toISOString()
                      .slice(0, 10);
                    const r = await administracionApi.copiarSemana(lunes, siguiente);
                    toast.exito(`${r.copiados} turno(s) copiados a la semana siguiente.`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo copiar.");
                  } finally {
                    setTrabajando(false);
                  }
                }}
              >
                Copiar a la semana siguiente
              </Button>
              <Button
                onClick={() =>
                  setNuevoTurno({
                    personaId: personas[0]?.id ?? "",
                    fecha: lunes,
                    horaDesde: "08:00",
                    horaHasta: "13:00",
                    tipo: "turno",
                  })
                }
              >
                Agregar turno
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  try {
                    const blob = await apiFetchBlob(
                      administracionApi.urlPlanilla(lunes, domingo),
                      { token: getStoredToken() }
                    );
                    guardarComoArchivo(blob, `horas-${lunes}.xlsx`);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo exportar.");
                  }
                }}
              >
                Horas para el contador
              </Button>
            </>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-black/5 bg-surface">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-black/5 bg-background/60">
                <th className="px-3 py-2 text-xs font-bold uppercase text-primary">Persona</th>
                {dias.map((d) => (
                  <th key={d} className="px-3 py-2 text-xs font-bold uppercase text-primary">
                    {formatearFechaCorta(d, zonaHoraria)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => (
                <tr key={p.id} className="border-b border-black/5">
                  <td className="px-3 py-2 font-medium text-text">{p.nombre}</td>
                  {dias.map((d) => {
                    const delDia = turnos.filter((t) => t.persona_id === p.id && t.fecha === d);
                    return (
                      <td key={d} className="px-3 py-2 text-xs">
                        {delDia.map((t) => (
                          <div key={t.id} className="flex items-center gap-1">
                            <span className={t.tipo === "guardia" ? "text-amber-700" : "text-text"}>
                              {t.hora_desde.slice(0, 5)}–{t.hora_hasta.slice(0, 5)}
                            </span>
                            {puedeGestionar && (
                              <button
                                className="text-text-muted hover:text-error"
                                onClick={async () => {
                                  await administracionApi.borrarTurno(t.id);
                                  setRecargar((n) => n + 1);
                                }}
                                aria-label="Quitar el turno"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        ))}
                        {delDia.length === 0 && <span className="text-text-muted">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Ausencias --- */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Ausencias</h3>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setNuevaAusencia({
                personaId: user?.userId ?? "",
                tipo: "vacaciones",
                desde: hoyISO(),
                hasta: hoyISO(),
                nota: "",
              })
            }
          >
            Pedir una ausencia
          </Button>
        </div>
        <Table<Ausencia>
          columns={[
            { key: "quien", header: "Quién", render: (a) => a.medico_nombre ?? "—" },
            { key: "que", header: "Qué", render: (a) => a.nombre },
            {
              key: "cuando",
              header: "Cuándo",
              render: (a) =>
                `${formatearFechaCorta(a.desde, zonaHoraria)} – ${formatearFechaCorta(a.hasta, zonaHoraria)}`,
            },
            {
              key: "estado",
              header: "Estado",
              render: (a) => (
                <Badge
                  variant={
                    a.estado === "aprobada" ? "success" : a.estado === "pendiente" ? "warning" : "neutral"
                  }
                >
                  {a.estado}
                </Badge>
              ),
            },
            {
              key: "citas",
              header: "Citas",
              render: (a) =>
                a.citas_afectadas > 0 ? (
                  <span className="text-amber-700">
                    {a.citas_afectadas} por reasignar
                  </span>
                ) : (
                  "—"
                ),
            },
            {
              key: "acciones",
              header: "",
              render: (a) =>
                puedeGestionar && a.estado === "pendiente" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        await administracionApi.resolverAusencia(a.id, true);
                        toast.exito("Aprobada. La agenda ya no deja citar a esa persona.");
                        setRecargar((n) => n + 1);
                      }}
                    >
                      Aprobar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        await administracionApi.resolverAusencia(a.id, false);
                        setRecargar((n) => n + 1);
                      }}
                    >
                      Rechazar
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          data={ausencias}
          rowKey={(a) => a.id}
          emptyMessage="No hay ausencias registradas."
        />
      </section>

      {/* --- Credenciales --- */}
      <section className="space-y-2">
        <h3 className="text-sm font-bold text-primary">Credenciales</h3>
        <Table<Credencial>
          columns={[
            { key: "persona", header: "Persona", render: (c) => c.persona_nombre },
            { key: "tipo", header: "Credencial", render: (c) => c.tipo },
            { key: "numero", header: "Número", render: (c) => c.numero ?? "—" },
            {
              key: "vence",
              header: "Vence",
              render: (c) =>
                c.vence_el ? (
                  <span className={(c.dias_para_vencer ?? 999) < 30 ? "text-error" : ""}>
                    {formatearFechaCorta(c.vence_el, zonaHoraria)}
                  </span>
                ) : (
                  "sin vencimiento"
                ),
            },
          ]}
          data={credenciales}
          rowKey={(c) => c.id}
          emptyMessage="No hay credenciales cargadas."
        />
      </section>

      {/* --- Modales --- */}
      <Modal
        open={nuevoTurno !== null}
        onClose={() => setNuevoTurno(null)}
        title="Agregar un turno"
        description="El turno dice cuándo le toca a alguien. El horario de la clínica dice cuándo se puede atender: son dos cosas."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevoTurno(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!nuevoTurno) return;
                setTrabajando(true);
                try {
                  await administracionApi.guardarTurno(nuevoTurno);
                  setNuevoTurno(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {nuevoTurno && (
          <div className="space-y-3">
            <Select
              label="Persona"
              value={nuevoTurno.personaId}
              onChange={(e) => setNuevoTurno({ ...nuevoTurno, personaId: e.target.value })}
              options={personas.map((p) => ({ value: p.id, label: p.nombre }))}
            />
            <Input
              label="Fecha"
              type="date"
              value={nuevoTurno.fecha}
              onChange={(e) => setNuevoTurno({ ...nuevoTurno, fecha: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Desde"
                type="time"
                value={nuevoTurno.horaDesde}
                onChange={(e) => setNuevoTurno({ ...nuevoTurno, horaDesde: e.target.value })}
              />
              <Input
                label="Hasta"
                type="time"
                value={nuevoTurno.horaHasta}
                onChange={(e) => setNuevoTurno({ ...nuevoTurno, horaHasta: e.target.value })}
              />
            </div>
            <Select
              label="Tipo"
              value={nuevoTurno.tipo}
              onChange={(e) => setNuevoTurno({ ...nuevoTurno, tipo: e.target.value })}
              options={[
                { value: "turno", label: "Turno" },
                { value: "guardia", label: "Guardia (no abre la agenda)" },
              ]}
            />
          </div>
        )}
      </Modal>

      <Modal
        open={nuevaAusencia !== null}
        onClose={() => setNuevaAusencia(null)}
        title="Pedir una ausencia"
        description="Solo el tipo y las fechas. De una incapacidad no se guarda el diagnóstico: es dato de salud y la clínica no lo necesita para organizar la agenda."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevaAusencia(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!nuevaAusencia) return;
                setTrabajando(true);
                try {
                  const r = await administracionApi.pedirAusencia(nuevaAusencia);
                  toast.exito(
                    r.citasAfectadas > 0
                      ? `Registrada. Hay ${r.citasAfectadas} cita(s) en esas fechas que alguien tiene que reasignar.`
                      : "Registrada."
                  );
                  setNuevaAusencia(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo registrar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {nuevaAusencia && (
          <div className="space-y-3">
            {puedeGestionar && (
              <Select
                label="Persona"
                value={nuevaAusencia.personaId}
                onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, personaId: e.target.value })}
                options={personas.map((p) => ({ value: p.id, label: p.nombre }))}
              />
            )}
            <Select
              label="Tipo"
              value={nuevaAusencia.tipo}
              onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, tipo: e.target.value })}
              options={[
                { value: "vacaciones", label: "Vacaciones" },
                { value: "incapacidad", label: "Incapacidad" },
                { value: "permiso", label: "Permiso" },
              ]}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Desde"
                type="date"
                value={nuevaAusencia.desde}
                onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, desde: e.target.value })}
              />
              <Input
                label="Hasta"
                type="date"
                value={nuevaAusencia.hasta}
                onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, hasta: e.target.value })}
              />
            </div>
            <Input
              label="Nota (opcional)"
              value={nuevaAusencia.nota}
              onChange={(e) => setNuevaAusencia({ ...nuevaAusencia, nota: e.target.value })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================
// COMISIONES
// =====================================================================
function PanelComisiones() {
  const { puede, zonaHoraria } = useAuth();
  const toast = useToast();
  const puedeAprobar = puede("comisiones.aprobar");
  const puedeVerTodas = puede("comisiones.ver_todas");
  const [reglas, setReglas] = useState<ReglaComision[]>([]);
  const [liquidaciones, setLiquidaciones] = useState<Liquidacion[]>([]);
  const [personas, setPersonas] = useState<PersonaDeLaClinica[]>([]);
  const [cargando, setCargando] = useState(true);
  const [recargar, setRecargar] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [detalle, setDetalle] = useState<{
    liquidacion: Liquidacion;
    lineas: Array<{
      id: string;
      descripcion: string;
      base: string;
      porcentaje: string | null;
      monto: string;
      es_ajuste: boolean;
      motivo: string | null;
    }>;
  } | null>(null);
  const [nuevaRegla, setNuevaRegla] = useState<{
    personaId: string;
    tipo: string;
    valor: string;
    base: string;
    rolEnElCargo: string;
  } | null>(null);
  const [generando, setGenerando] = useState<{ personaId: string; desde: string; hasta: string } | null>(
    null
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [l, p] = await Promise.all([
          administracionApi.liquidaciones(),
          puedeVerTodas ? clinicaApi.personas() : Promise.resolve({ personas: [] }),
        ]);
        if (!vivo) return;
        setLiquidaciones(l.liquidaciones);
        setPersonas(p.personas.filter((x) => x.estado === "activo"));
        if (puedeVerTodas) setReglas((await administracionApi.reglas()).reglas);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recargar]);

  if (cargando) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-6">
      {!puedeVerTodas && (
        <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
          Estás viendo tus propias comisiones.
        </p>
      )}

      {puedeVerTodas && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-primary">Reglas</h3>
            {puedeAprobar && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setNuevaRegla({
                    personaId: "",
                    tipo: "porcentaje",
                    valor: "10",
                    base: "cobrado",
                    rolEnElCargo: "realizado",
                  })
                }
              >
                Agregar una regla
              </Button>
            )}
          </div>
          <Table<ReglaComision>
            columns={[
              {
                key: "quien",
                header: "A quién",
                render: (r) => r.persona_nombre ?? "todo el personal",
              },
              {
                key: "sobre",
                header: "Sobre qué",
                render: (r) =>
                  r.servicio_nombre ??
                  r.familia_nombre ??
                  r.linea_negocio ??
                  "todo",
              },
              {
                key: "valor",
                header: "Cuánto",
                render: (r) =>
                  r.tipo === "porcentaje" ? `${Number(r.valor)} %` : colones(r.valor),
              },
              { key: "base", header: "Sobre", render: (r) => `lo ${r.base}` },
              { key: "rol", header: "Por", render: (r) => r.rol_en_el_cargo },
              {
                key: "estado",
                header: "",
                render: (r) => (r.activo ? null : <Badge variant="neutral">inactiva</Badge>),
              },
            ]}
            data={reglas}
            rowKey={(r) => r.id}
            emptyMessage="No hay reglas. Sin reglas no se calcula ninguna comisión."
          />
        </section>
      )}

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-primary">Liquidaciones</h3>
          {puedeAprobar && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setGenerando({
                  personaId: personas[0]?.id ?? "",
                  desde: `${hoyISO().slice(0, 7)}-01`,
                  hasta: hoyISO(),
                })
              }
            >
              Calcular un período
            </Button>
          )}
        </div>
        <Table<Liquidacion>
          columns={[
            { key: "persona", header: "Persona", render: (l) => l.persona },
            {
              key: "periodo",
              header: "Período",
              render: (l) =>
                `${formatearFechaCorta(l.desde, zonaHoraria)} – ${formatearFechaCorta(l.hasta, zonaHoraria)}`,
            },
            { key: "lineas", header: "Líneas", render: (l) => l.lineas },
            { key: "total", header: "Total", render: (l) => colones(l.total) },
            {
              key: "estado",
              header: "Estado",
              render: (l) => (
                <Badge variant={l.estado === "aprobada" ? "success" : "warning"}>{l.estado}</Badge>
              ),
            },
            {
              key: "acciones",
              header: "",
              render: (l) => (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => setDetalle(await administracionApi.liquidacion(l.id))}
                  >
                    Ver
                  </Button>
                  {puedeAprobar && l.estado === "borrador" && (
                    <Button
                      size="sm"
                      disabled={trabajando}
                      onClick={async () => {
                        setTrabajando(true);
                        try {
                          const r = await administracionApi.aprobarLiquidacion(l.id);
                          toast.exito(
                            `Liquidación aprobada por ${colones(r.total)}. Ya no se puede editar.`
                          );
                          setRecargar((n) => n + 1);
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "No se pudo aprobar.");
                        } finally {
                          setTrabajando(false);
                        }
                      }}
                    >
                      Aprobar
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
          data={liquidaciones}
          rowKey={(l) => l.id}
          emptyMessage="Todavía no hay liquidaciones."
        />
      </section>

      <Modal
        open={detalle !== null}
        onClose={() => setDetalle(null)}
        // De consulta: es el detalle de una liquidación, solo lectura.
        tipo="consulta"
        title={detalle ? `Comisiones de ${detalle.liquidacion.persona}` : ""}
        description="Cada línea dice de qué cargo salió y con qué porcentaje."
        ancho="lg"
      >
        <ul className="divide-y divide-black/5 text-sm">
          {detalle?.lineas.map((l) => (
            <li key={l.id} className="flex items-start gap-3 py-2">
              <span className="flex-1">
                <span className="text-text">{l.descripcion}</span>
                <span className="block text-xs text-text-muted">
                  {l.es_ajuste
                    ? l.motivo
                    : `${colones(l.base)}${l.porcentaje ? ` × ${Number(l.porcentaje)} %` : ""}`}
                </span>
              </span>
              <span className={Number(l.monto) < 0 ? "text-error" : "text-text"}>
                {colones(l.monto)}
              </span>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        open={nuevaRegla !== null}
        onClose={() => setNuevaRegla(null)}
        title="Una regla de comisión"
        description="Gana la más específica: si hay una para esta persona y este servicio, esa manda sobre la general."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevaRegla(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!nuevaRegla) return;
                setTrabajando(true);
                try {
                  await administracionApi.guardarRegla({
                    personaId: nuevaRegla.personaId || null,
                    tipo: nuevaRegla.tipo,
                    valor: Number(nuevaRegla.valor),
                    base: nuevaRegla.base,
                    rolEnElCargo: nuevaRegla.rolEnElCargo,
                  });
                  setNuevaRegla(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {nuevaRegla && (
          <div className="space-y-3">
            <Select
              label="A quién"
              value={nuevaRegla.personaId}
              onChange={(e) => setNuevaRegla({ ...nuevaRegla, personaId: e.target.value })}
              options={[
                { value: "", label: "A todo el personal" },
                ...personas.map((p) => ({ value: p.id, label: p.nombre })),
              ]}
            />
            <Select
              label="Tipo"
              value={nuevaRegla.tipo}
              onChange={(e) => setNuevaRegla({ ...nuevaRegla, tipo: e.target.value })}
              options={[
                { value: "porcentaje", label: "Porcentaje" },
                { value: "monto", label: "Monto fijo" },
              ]}
            />
            <Input
              label={nuevaRegla.tipo === "porcentaje" ? "Porcentaje" : "Monto"}
              type="number"
              value={nuevaRegla.valor}
              onChange={(e) => setNuevaRegla({ ...nuevaRegla, valor: e.target.value })}
            />
            <Select
              label="Se calcula sobre"
              value={nuevaRegla.base}
              onChange={(e) => setNuevaRegla({ ...nuevaRegla, base: e.target.value })}
              options={[
                { value: "cobrado", label: "Lo cobrado (recomendado)" },
                { value: "facturado", label: "Lo facturado" },
              ]}
            />
            <p className="text-xs text-text-muted">
              Sobre lo facturado se paga una comisión aunque el cliente no haya pagado: esa plata la
              pone la clínica.
            </p>
          </div>
        )}
      </Modal>

      <Modal
        open={generando !== null}
        onClose={() => setGenerando(null)}
        title="Calcular el período"
        description="Arma el borrador con los cargos de ese período. Un cargo que ya se liquidó no entra dos veces."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGenerando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!generando) return;
                setTrabajando(true);
                try {
                  const r = await administracionApi.generarBorrador(
                    generando.personaId,
                    generando.desde,
                    generando.hasta
                  );
                  toast.exito(
                    `Borrador por ${colones(r.total)} con ${r.lineas} línea(s).` +
                      (r.yaLiquidados > 0
                        ? ` ${r.yaLiquidados} cargo(s) ya estaban liquidados y no se repiten.`
                        : "")
                  );
                  setGenerando(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo calcular.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Calcular
            </Button>
          </div>
        }
      >
        {generando && (
          <div className="space-y-3">
            <Select
              label="Persona"
              value={generando.personaId}
              onChange={(e) => setGenerando({ ...generando, personaId: e.target.value })}
              options={personas.map((p) => ({ value: p.id, label: p.nombre }))}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Desde"
                type="date"
                value={generando.desde}
                onChange={(e) => setGenerando({ ...generando, desde: e.target.value })}
              />
              <Input
                label="Hasta"
                type="date"
                value={generando.hasta}
                onChange={(e) => setGenerando({ ...generando, hasta: e.target.value })}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================
// CUMPLIMIENTO
// =====================================================================
function PanelCumplimiento() {
  const { puede, zonaHoraria } = useAuth();
  const toast = useToast();
  const puedeGestionar = puede("cumplimiento.gestionar");
  const puedeFirmar = puede("controlados.firmar_cierre");
  const puedeVerControlados = puede("controlados.registrar") || puedeFirmar;
  const [permisos, setPermisos] = useState<PermisoCumplimiento[]>([]);
  const [libro, setLibro] = useState<Awaited<
    ReturnType<typeof administracionApi.libroControlados>
  > | null>(null);
  const [cargando, setCargando] = useState(true);
  const [recargar, setRecargar] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [editando, setEditando] = useState<PermisoCumplimiento | null>(null);

  const primerDia = `${hoyISO().slice(0, 7)}-01`;

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const p = await administracionApi.permisosCumplimiento();
        if (!vivo) return;
        setPermisos(p.permisos);
        if (puedeVerControlados) {
          setLibro(await administracionApi.libroControlados(primerDia, hoyISO()));
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recargar]);

  if (cargando) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        La lista de permisos viene <strong>sugerida</strong>, no confirmada: no se presenta como
        obligación legal lo que nadie verificó contra la fuente oficial. Confirmá cuáles le aplican a
        tu clínica y desactivá los demás.
      </p>

      <Table<PermisoCumplimiento>
        columns={[
          {
            key: "nombre",
            header: "Permiso",
            render: (p) => (
              <div>
                <div className="text-text">{p.nombre}</div>
                <div className="text-xs text-text-muted">
                  {p.organismo}
                  {p.sugerido && " · sugerido por el sistema"}
                </div>
              </div>
            ),
          },
          { key: "numero", header: "Número", render: (p) => p.numero ?? "—" },
          {
            key: "vence",
            header: "Vence",
            render: (p) =>
              p.vence_el ? (
                <span className={(p.dias_para_vencer ?? 999) < p.dias_aviso ? "text-error" : ""}>
                  {formatearFechaCorta(p.vence_el, zonaHoraria)}
                </span>
              ) : (
                "sin cargar"
              ),
          },
          { key: "responsable", header: "Responsable", render: (p) => p.responsable ?? "—" },
          {
            key: "acciones",
            header: "",
            render: (p) =>
              puedeGestionar ? (
                <Button variant="ghost" size="sm" onClick={() => setEditando(p)}>
                  Editar
                </Button>
              ) : null,
          },
        ]}
        data={permisos}
        rowKey={(p) => p.id}
      />

      {puedeVerControlados && libro && (
        <section className="space-y-3">
          <h3 className="text-sm font-bold text-primary">Libro de medicamentos controlados</h3>
          <p className="text-xs text-text-muted">
            Se arma con los movimientos de inventario: no hay un segundo registro que pueda no
            coincidir.
          </p>

          <div className="rounded-xl border border-black/5 bg-surface p-4">
            <h4 className="text-xs font-bold uppercase text-text-muted">Saldos</h4>
            <ul className="mt-2 space-y-1 text-sm">
              {libro.saldos.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span className="text-text-muted">
                    {s.producto}
                    {s.lote ? ` · lote ${s.lote}` : ""}
                  </span>
                  <span className="text-text">{s.saldo}</span>
                </li>
              ))}
              {libro.saldos.length === 0 && (
                <li className="text-text-muted">No hay productos controlados con saldo.</li>
              )}
            </ul>
          </div>

          <Table
            columns={[
              { key: "fecha", header: "Fecha", render: (a: { fecha: string }) => a.fecha },
              { key: "producto", header: "Producto", render: (a: { producto: string }) => a.producto },
              { key: "lote", header: "Lote", render: (a: { lote: string | null }) => a.lote ?? "—" },
              { key: "motivo", header: "Motivo", render: (a: { motivo: string }) => a.motivo },
              {
                key: "cantidad",
                header: "Cantidad",
                render: (a: { cantidad: string }) => (
                  <span className={Number(a.cantidad) < 0 ? "text-error" : "text-text"}>
                    {a.cantidad}
                  </span>
                ),
              },
              {
                key: "paciente",
                header: "Paciente",
                render: (a: { paciente: string | null }) => a.paciente ?? "—",
              },
              { key: "medico", header: "Indicó", render: (a: { medico: string | null }) => a.medico ?? "—" },
            ]}
            data={libro.asientos}
            rowKey={(a: { fecha: string; producto: string; cantidad: string }) =>
              `${a.fecha}-${a.producto}-${a.cantidad}`
            }
            emptyMessage="No hay movimientos de controlados en el período."
          />

          {puedeFirmar && (
            <Button
              disabled={trabajando}
              onClick={async () => {
                setTrabajando(true);
                try {
                  const r = await administracionApi.cerrarLibro(primerDia, hoyISO());
                  toast.exito(
                    `Libro cerrado con ${r.productos} producto(s). Queda firmado y no se puede editar.`
                  );
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo cerrar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Cerrar y firmar el período
            </Button>
          )}

          {libro.cierres.length > 0 && (
            <ul className="text-xs text-text-muted">
              {libro.cierres.map((c) => (
                <li key={c.id}>
                  Cerrado del {c.desde} al {c.hasta} por {c.firmado_por}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando?.nombre ?? ""}
        description="Al cargarlo deja de ser una sugerencia del sistema y pasa a ser un dato de la clínica."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!editando) return;
                setTrabajando(true);
                try {
                  await administracionApi.guardarPermisoCumplimiento({
                    id: editando.id,
                    nombre: editando.nombre,
                    organismo: editando.organismo ?? undefined,
                    numero: editando.numero ?? undefined,
                    venceEl: editando.vence_el ?? undefined,
                    diasAviso: editando.dias_aviso,
                    activo: editando.activo,
                  });
                  setEditando(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {editando && (
          <div className="space-y-3">
            <Input
              label="Número"
              value={editando.numero ?? ""}
              onChange={(e) => setEditando({ ...editando, numero: e.target.value })}
            />
            <Input
              label="Vence el"
              type="date"
              value={editando.vence_el ?? ""}
              onChange={(e) => setEditando({ ...editando, vence_el: e.target.value })}
            />
            <Input
              label="Avisar con cuántos días"
              type="number"
              value={String(editando.dias_aviso)}
              onChange={(e) => setEditando({ ...editando, dias_aviso: Number(e.target.value) })}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editando.activo}
                onChange={(e) => setEditando({ ...editando, activo: e.target.checked })}
              />
              Le aplica a esta clínica
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

// =====================================================================
// AUDITORÍA
// =====================================================================
function PanelAuditoria() {
  const { puede, zonaHoraria } = useAuth();
  const toast = useToast();
  const [eventos, setEventos] = useState<EventoAuditoria[]>([]);
  const [tipos, setTipos] = useState<Array<{ tipo: string; modulo: string; cantidad: number }>>([]);
  const [filtros, setFiltros] = useState<{ desde: string; hasta: string; modulo: string; tipo: string }>(
    { desde: "", hasta: "", modulo: "", tipo: "" }
  );
  const [cargando, setCargando] = useState(true);

  const puedeVer = puede("auditoria.ver");

  useEffect(() => {
    if (!puedeVer) {
      setCargando(false);
      return;
    }
    let vivo = true;
    (async () => {
      try {
        const r = await administracionApi.auditoria({
          desde: filtros.desde || undefined,
          hasta: filtros.hasta || undefined,
          modulo: filtros.modulo || undefined,
          tipo: filtros.tipo || undefined,
        });
        if (!vivo) return;
        setEventos(r.eventos);
        setTipos(r.tipos);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar la auditoría.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [filtros]);

  if (!puedeVer) {
    return (
      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        La auditoría la ve quien tenga el permiso «Ver la auditoría del sistema».
      </p>
    );
  }
  if (cargando) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        Lo que pasó en el sistema, de todas las fuentes: anulaciones y descuentos autorizados,
        cambios de política y de precio, ajustes de inventario, fusiones de clientes, cambios de
        roles y exportaciones.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <Input
          label="Desde"
          type="date"
          value={filtros.desde}
          onChange={(e) => setFiltros({ ...filtros, desde: e.target.value })}
        />
        <Input
          label="Hasta"
          type="date"
          value={filtros.hasta}
          onChange={(e) => setFiltros({ ...filtros, hasta: e.target.value })}
        />
        <Select
          label="Qué pasó"
          value={filtros.tipo}
          onChange={(e) => setFiltros({ ...filtros, tipo: e.target.value })}
          options={[
            { value: "", label: "Todo" },
            ...tipos.map((t) => ({ value: t.tipo, label: `${t.tipo} (${t.cantidad})` })),
          ]}
        />
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              const blob = await apiFetchBlob(
                administracionApi.urlAuditoriaExcel(filtros.desde || "", filtros.hasta || ""),
                { token: getStoredToken() }
              );
              guardarComoArchivo(blob, `auditoria.xlsx`);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "No se pudo exportar.");
            }
          }}
        >
          Exportar
        </Button>
      </div>

      <Table<EventoAuditoria>
        columns={[
          {
            key: "cuando",
            header: "Cuándo",
            render: (e) => formatearFecha(e.cuando, zonaHoraria, CON_HORA),
          },
          { key: "quien", header: "Quién", render: (e) => e.quien ?? "—" },
          { key: "modulo", header: "Módulo", render: (e) => e.modulo },
          { key: "tipo", header: "Qué pasó", render: (e) => e.tipo },
          { key: "sobre", header: "Sobre", render: (e) => e.sobre ?? "—" },
          {
            key: "cambio",
            header: "Cambio",
            render: (e) =>
              e.valor_anterior || e.valor_nuevo ? (
                <span className="text-xs">
                  {e.valor_anterior ?? "—"} → {e.valor_nuevo ?? "—"}
                </span>
              ) : (
                <span className="text-xs text-text-muted">{e.detalle ?? "—"}</span>
              ),
          },
        ]}
        data={eventos}
        rowKey={(e) => `${e.fuente}-${e.entidad_id}-${e.cuando}`}
        emptyMessage="No hay eventos en ese período."
      />
    </div>
  );
}

// =====================================================================
// PROCEDIMIENTOS
// =====================================================================
function PanelProcedimientos() {
  const { puede } = useAuth();
  const toast = useToast();
  const puedeEditar = puede("procedimientos.editar");
  const [lista, setLista] = useState<Procedimiento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [recargar, setRecargar] = useState(0);
  const [trabajando, setTrabajando] = useState(false);
  const [nuevo, setNuevo] = useState<{
    categoria: string;
    titulo: string;
    contenido: string;
    exigeLectura: boolean;
  } | null>(null);
  const [viendo, setViendo] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    administracionApi
      .procedimientos()
      .then((r) => setLista(r.procedimientos))
      .catch((err) => toast.error(err instanceof Error ? err.message : "No se pudo cargar."))
      .finally(() => setCargando(false));
  }, [recargar]);

  if (cargando) return <LoadingState forma="tarjetas" />;

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        Los manuales de la clínica: limpieza del quirófano, emergencias, cierre de caja, manejo de
        controlados. El agente de ayuda los va a poder citar.
      </p>

      {puedeEditar && (
        <Button
          onClick={() =>
            setNuevo({ categoria: "General", titulo: "", contenido: "", exigeLectura: false })
          }
        >
          Agregar un procedimiento
        </Button>
      )}

      <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
        {lista.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1">
              <div className="text-sm font-medium text-text">
                {p.titulo}{" "}
                <span className="text-xs text-text-muted">v{p.version}</span>
              </div>
              <div className="text-xs text-text-muted">
                {p.categoria}
                {p.roles.length > 0 && ` · para ${p.roles.join(", ")}`}
                {p.exige_lectura && ` · ${p.lecturas} confirmaron que lo leyeron`}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                const r = await administracionApi.procedimiento(p.id);
                setViendo(r.procedimiento);
              }}
            >
              Leer
            </Button>
            {p.exige_lectura && (
              <Button
                variant="secondary"
                size="sm"
                disabled={trabajando}
                onClick={async () => {
                  setTrabajando(true);
                  try {
                    const r = await administracionApi.marcarLeido(p.id);
                    toast.exito(`Anotado: leíste la versión ${r.version}.`);
                    setRecargar((n) => n + 1);
                  } finally {
                    setTrabajando(false);
                  }
                }}
              >
                Lo leí
              </Button>
            )}
          </div>
        ))}
        {lista.length === 0 && (
          <p className="p-4 text-sm text-text-muted">Todavía no hay procedimientos cargados.</p>
        )}
      </div>

      <Modal
        open={viendo !== null}
        onClose={() => setViendo(null)}
        title={String(viendo?.titulo ?? "")}
        ancho="lg"
      >
        <pre className="whitespace-pre-wrap text-sm text-text">
          {String(viendo?.contenido ?? "Este procedimiento está en un archivo adjunto.")}
        </pre>
      </Modal>

      <Modal
        open={nuevo !== null}
        onClose={() => setNuevo(null)}
        title="Un procedimiento de la clínica"
        description="Escribilo como texto siempre que puedas: un PDF escaneado no se puede citar."
        ancho="lg"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevo(null)}>
              Cancelar
            </Button>
            <Button
              disabled={trabajando}
              onClick={async () => {
                if (!nuevo) return;
                setTrabajando(true);
                try {
                  await administracionApi.guardarProcedimiento(nuevo);
                  setNuevo(null);
                  setRecargar((n) => n + 1);
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
                } finally {
                  setTrabajando(false);
                }
              }}
            >
              Guardar
            </Button>
          </div>
        }
      >
        {nuevo && (
          <div className="space-y-3">
            <Input
              label="Categoría"
              value={nuevo.categoria}
              onChange={(e) => setNuevo({ ...nuevo, categoria: e.target.value })}
            />
            <Input
              label="Título"
              value={nuevo.titulo}
              onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })}
            />
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-text">Contenido</span>
              <textarea
                className="h-48 w-full rounded-lg border border-black/10 bg-background p-3 text-sm"
                value={nuevo.contenido}
                onChange={(e) => setNuevo({ ...nuevo, contenido: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={nuevo.exigeLectura}
                onChange={(e) => setNuevo({ ...nuevo, exigeLectura: e.target.checked })}
              />
              Pedir que cada persona confirme que lo leyó
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}
