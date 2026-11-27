import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Tabs,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  BloqueHorario,
  clinicaApi,
  DiaDelHorario,
  ExcepcionDelHorario,
  Numeracion,
  TipoDeCita,
} from "../../lib/clinicaApi";
import { formatearFechaCorta } from "../../lib/formatFecha";

// ---------------------------------------------------------------------
// CONFIGURACIÓN DE LA AGENDA — prompt 04, sección 3.
//
// Cuatro cosas que no existían: el horario de la CLÍNICA (había uno por
// médico, y nadie lo comparaba contra la cita), los feriados y bloqueos,
// los tipos de cita y los prefijos de numeración.
//
// EL HORARIO DE LA CLÍNICA ES EL MARCO. Si la clínica abre de 8 a 17 y un
// médico declara de 7 a 20, sus citas válidas son de 8 a 17: nadie
// atiende con la clínica cerrada. El horario de cada médico se sigue
// configurando en su ficha, y esta pantalla no lo duplica.
//
// LOS FERIADOS VIENEN CARGADOS Y SE PUEDEN DESMARCAR, porque hay clínicas
// que abren el 1.º de mayo. Desmarcar no borra la fila: el feriado se
// sigue viendo en el calendario, pero deja de bloquear.
// ---------------------------------------------------------------------

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

const NOMBRE_DOCUMENTO: Record<string, string> = {
  expediente: "Expediente del paciente",
  presupuesto: "Presupuesto",
  recibo: "Recibo de caja",
  anticipo: "Anticipo",
};

const TIPOS_DE_EXCEPCION = [
  { value: "feriado", label: "Feriado" },
  { value: "vacaciones", label: "Vacaciones de un médico" },
  { value: "bloqueo", label: "Bloqueo puntual" },
];

export function ConfiguracionAgenda() {
  const { puede, zonaHoraria } = useAuth();
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [horario, setHorario] = useState<DiaDelHorario[]>([]);
  const [excepciones, setExcepciones] = useState<ExcepcionDelHorario[]>([]);
  const [tipos, setTipos] = useState<TipoDeCita[]>([]);
  const [numeraciones, setNumeraciones] = useState<Numeracion[]>([]);
  const [trabajando, setTrabajando] = useState(false);
  const [nuevaExcepcion, setNuevaExcepcion] = useState<{
    tipo: string;
    nombre: string;
    desde: string;
    hasta: string;
    horaDesde: string;
    horaHasta: string;
  } | null>(null);
  const [tipoEnEdicion, setTipoEnEdicion] = useState<Partial<TipoDeCita> | null>(null);

  const puedeConfigurar = puede("clinica.configurar");

  async function cargar() {
    const [h, t, n] = await Promise.all([
      clinicaApi.horario(),
      clinicaApi.tiposDeCita(true),
      clinicaApi.numeraciones(),
    ]);
    setHorario(h.horario);
    setExcepciones(h.excepciones);
    setTipos(t.tipos);
    setNumeraciones(n.numeraciones);
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await cargar();
      } catch (err) {
        if (vivo) toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function guardarDia(dia: DiaDelHorario, bloques: BloqueHorario[], abierto: boolean) {
    setTrabajando(true);
    try {
      const r = await clinicaApi.guardarDia(dia.dia_semana, bloques, abierto);
      setHorario(r.horario);
      toast.exito(`${DIAS[dia.dia_semana]} actualizado.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar el día.");
    } finally {
      setTrabajando(false);
    }
  }

  async function alternarBloqueo(e: ExcepcionDelHorario) {
    setTrabajando(true);
    try {
      await clinicaApi.guardarExcepcion({
        id: e.id,
        tipo: e.tipo,
        nombre: e.nombre,
        desde: e.desde,
        hasta: e.hasta,
        horaDesde: e.hora_desde,
        horaHasta: e.hora_hasta,
        medicoId: e.medico_id,
        bloquea: !e.bloquea,
      });
      await cargar();
      toast.exito(
        e.bloquea
          ? `${e.nombre} deja de bloquear: la clínica trabaja ese día.`
          : `${e.nombre} vuelve a bloquear la agenda.`
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar.");
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarExcepcion() {
    if (!nuevaExcepcion?.nombre || !nuevaExcepcion.desde) return;
    setTrabajando(true);
    try {
      await clinicaApi.guardarExcepcion({
        tipo: nuevaExcepcion.tipo,
        nombre: nuevaExcepcion.nombre,
        desde: nuevaExcepcion.desde,
        hasta: nuevaExcepcion.hasta || nuevaExcepcion.desde,
        horaDesde: nuevaExcepcion.horaDesde || null,
        horaHasta: nuevaExcepcion.horaHasta || null,
      });
      await cargar();
      setNuevaExcepcion(null);
      toast.exito("Listo: la agenda ya no deja citar ahí.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setTrabajando(false);
    }
  }

  async function guardarTipo() {
    if (!tipoEnEdicion?.nombre) return;
    setTrabajando(true);
    try {
      await clinicaApi.guardarTipoDeCita({
        id: tipoEnEdicion.id,
        nombre: tipoEnEdicion.nombre,
        duracionMinutos: Number(tipoEnEdicion.duracion_minutos ?? 30),
        color: tipoEnEdicion.color ?? null,
        activo: tipoEnEdicion.activo ?? true,
        orden: tipoEnEdicion.orden ?? 100,
      });
      await cargar();
      setTipoEnEdicion(null);
      toast.exito("Tipo de cita guardado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setTrabajando(false);
    }
  }

  if (cargando) return <LoadingState forma="tarjetas" />;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Configuración de la agenda"
        subtitulo="El horario de la clínica, los feriados, los tipos de cita y los prefijos de numeración."
        icono="cita"
        modulo="agenda"
      />

      {!puedeConfigurar && (
        <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
          Podés ver cómo está configurada la agenda. Cambiarla lo hace quien tenga el permiso de
          configurar la clínica.
        </p>
      )}

      <Tabs
        pestanas={[
          { clave: "horario", etiqueta: "Horario" },
          { clave: "excepciones", etiqueta: "Feriados y bloqueos" },
          { clave: "tipos", etiqueta: "Tipos de cita" },
          { clave: "numeraciones", etiqueta: "Numeraciones" },
        ]}
      >
        {(pestana) => (
          <>
      {/* --- Horario --- */}
      {pestana === "horario" && (
        <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
          {horario.map((d) => (
            <FilaDeDia
              key={d.dia_semana}
              dia={d}
              editable={puedeConfigurar && !trabajando}
              onGuardar={(bloques, abierto) => guardarDia(d, bloques, abierto)}
            />
          ))}
          <p className="p-4 text-xs text-text-muted">
            Una cita tiene que empezar y terminar dentro de un bloque: con cierre a las 17:00, una
            de 30 minutos a las 16:50 no entra, y una a las 16:30 sí.
          </p>
        </div>
      )}

      {/* --- Feriados y bloqueos --- */}
      {pestana === "excepciones" && (
        <div className="space-y-3">
          {puedeConfigurar && (
            <Button
              onClick={() =>
                setNuevaExcepcion({
                  tipo: "bloqueo",
                  nombre: "",
                  desde: "",
                  hasta: "",
                  horaDesde: "",
                  horaHasta: "",
                })
              }
            >
              Agregar un feriado o bloqueo
            </Button>
          )}
          <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
            {excepciones.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">No hay nada cargado.</p>
            ) : (
              excepciones.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{e.nombre}</span>
                      <Badge variant="neutral">{e.tipo}</Badge>
                      {!e.bloquea && <Badge variant="warning">la clínica trabaja</Badge>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {formatearFechaCorta(e.desde, zonaHoraria)}
                      {e.hasta !== e.desde && ` al ${formatearFechaCorta(e.hasta, zonaHoraria)}`}
                      {e.hora_desde &&
                        ` · de ${e.hora_desde.slice(0, 5)} a ${(e.hora_hasta ?? "").slice(0, 5)}`}
                      {e.medico_nombre && ` · ${e.medico_nombre}`}
                    </div>
                  </div>
                  {puedeConfigurar && (
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => alternarBloqueo(e)}
                        disabled={trabajando}
                      >
                        {e.bloquea ? "La clínica trabaja ese día" : "Volver a bloquear"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={async () => {
                          setTrabajando(true);
                          try {
                            await clinicaApi.borrarExcepcion(e.id);
                            await cargar();
                            toast.exito("Borrado.");
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "No se pudo borrar."
                            );
                          } finally {
                            setTrabajando(false);
                          }
                        }}
                        disabled={trabajando}
                      >
                        Borrar
                      </Button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* --- Tipos de cita --- */}
      {pestana === "tipos" && (
        <div className="space-y-3">
          {puedeConfigurar && (
            <Button onClick={() => setTipoEnEdicion({ duracion_minutos: 30, activo: true })}>
              Agregar un tipo de cita
            </Button>
          )}
          <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
            {tipos.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <span
                  className="h-4 w-4 rounded"
                  style={{ backgroundColor: t.color ?? "#cbd5e1" }}
                  aria-hidden
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-text">
                    {t.nombre}
                    {!t.activo && (
                      <Badge variant="neutral" className="ml-2">
                        inactivo
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">
                    {t.duracion_minutos} min
                    {t.sala_nombre && ` · ${t.sala_nombre}`}
                    {t.servicio_nombre && ` · cobra ${t.servicio_nombre}`}
                  </div>
                </div>
                {puedeConfigurar && (
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setTipoEnEdicion(t)}>
                      Editar
                    </Button>
                    {t.activo && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={trabajando}
                        onClick={async () => {
                          setTrabajando(true);
                          try {
                            await clinicaApi.desactivarTipoDeCita(t.id);
                            await cargar();
                            toast.exito(`«${t.nombre}» ya no se ofrece al agendar.`);
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : "No se pudo desactivar."
                            );
                          } finally {
                            setTrabajando(false);
                          }
                        }}
                      >
                        Desactivar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted">
            Un tipo de cita no se borra: se desactiva. Las citas que ya se agendaron con él lo
            siguen mostrando.
          </p>
        </div>
      )}

      {/* --- Numeraciones --- */}
      {pestana === "numeraciones" && (
        <div className="space-y-3">
          <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
            {numeraciones.map((n) => (
              <FilaDeNumeracion
                key={n.documento}
                numeracion={n}
                editable={puedeConfigurar && !trabajando}
                onGuardar={async (prefijo, digitos) => {
                  setTrabajando(true);
                  try {
                    const r = await clinicaApi.guardarNumeracion(n.documento, prefijo, digitos);
                    setNumeraciones(r.numeraciones);
                    toast.exito("Numeración guardada.");
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
                  } finally {
                    setTrabajando(false);
                  }
                }}
              />
            ))}
          </div>
          <p className="text-xs text-text-muted">
            El siguiente número lo calcula cada módulo y acá se muestra, no se edita: bajarlo
            generaría números repetidos en documentos que ya se entregaron. Los consecutivos de
            Hacienda son aparte y no se tocan desde acá.
          </p>
        </div>
      )}
          </>
        )}
      </Tabs>

      {/* --- Modal de excepción --- */}
      <Modal
        open={nuevaExcepcion !== null}
        onClose={() => setNuevaExcepcion(null)}
        title="Un feriado o un bloqueo"
        description="Sin hora, bloquea todo el día. Con hora, solo esas horas."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNuevaExcepcion(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarExcepcion} disabled={trabajando}>
              Guardar
            </Button>
          </div>
        }
      >
        {nuevaExcepcion && (
          <div className="space-y-3">
            <Select
              label="Qué es"
              value={nuevaExcepcion.tipo}
              onChange={(e) => setNuevaExcepcion({ ...nuevaExcepcion, tipo: e.target.value })}
              options={TIPOS_DE_EXCEPCION}
            />
            <Input
              label="Nombre"
              placeholder="Inventario anual, Feria del pueblo…"
              value={nuevaExcepcion.nombre}
              onChange={(e) => setNuevaExcepcion({ ...nuevaExcepcion, nombre: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Desde"
                type="date"
                value={nuevaExcepcion.desde}
                onChange={(e) => setNuevaExcepcion({ ...nuevaExcepcion, desde: e.target.value })}
              />
              <Input
                label="Hasta (si es más de un día)"
                type="date"
                value={nuevaExcepcion.hasta}
                onChange={(e) => setNuevaExcepcion({ ...nuevaExcepcion, hasta: e.target.value })}
              />
              <Input
                label="Desde la hora"
                type="time"
                value={nuevaExcepcion.horaDesde}
                onChange={(e) =>
                  setNuevaExcepcion({ ...nuevaExcepcion, horaDesde: e.target.value })
                }
              />
              <Input
                label="Hasta la hora"
                type="time"
                value={nuevaExcepcion.horaHasta}
                onChange={(e) =>
                  setNuevaExcepcion({ ...nuevaExcepcion, horaHasta: e.target.value })
                }
              />
            </div>
          </div>
        )}
      </Modal>

      {/* --- Modal de tipo de cita --- */}
      <Modal
        open={tipoEnEdicion !== null}
        onClose={() => setTipoEnEdicion(null)}
        title={tipoEnEdicion?.id ? "Editar el tipo de cita" : "Un tipo de cita nuevo"}
        description="La duración es la que la agenda propone al elegirlo, y el color es el que se ve en el calendario."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTipoEnEdicion(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarTipo} disabled={trabajando}>
              Guardar
            </Button>
          </div>
        }
      >
        {tipoEnEdicion && (
          <div className="space-y-3">
            <Input
              label="Nombre"
              value={tipoEnEdicion.nombre ?? ""}
              onChange={(e) => setTipoEnEdicion({ ...tipoEnEdicion, nombre: e.target.value })}
            />
            <Input
              label="Duración (minutos)"
              type="number"
              min={5}
              value={String(tipoEnEdicion.duracion_minutos ?? 30)}
              onChange={(e) =>
                setTipoEnEdicion({ ...tipoEnEdicion, duracion_minutos: Number(e.target.value) })
              }
            />
            <Input
              label="Color"
              type="color"
              value={tipoEnEdicion.color ?? "#2563eb"}
              onChange={(e) => setTipoEnEdicion({ ...tipoEnEdicion, color: e.target.value })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------
// Un día del horario. Se edita entero y se guarda entero: los bloques de
// un día son una unidad —«de 8 a 12 y de 14 a 17»— y guardarlos de a uno
// deja estados intermedios donde la clínica cierra al mediodía para
// siempre porque alguien se fue a almorzar entre los dos guardados.
// ---------------------------------------------------------------------
function FilaDeDia({
  dia,
  editable,
  onGuardar,
}: {
  dia: DiaDelHorario;
  editable: boolean;
  onGuardar: (bloques: BloqueHorario[], abierto: boolean) => void;
}) {
  const [bloques, setBloques] = useState<BloqueHorario[]>(dia.bloques);
  const [abierto, setAbierto] = useState(dia.abierto);
  const cambio =
    abierto !== dia.abierto || JSON.stringify(bloques) !== JSON.stringify(dia.bloques);

  useEffect(() => {
    setBloques(dia.bloques);
    setAbierto(dia.abierto);
  }, [dia]);

  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <label className="flex w-32 items-center gap-2 text-sm font-medium text-text">
        <input
          type="checkbox"
          checked={abierto}
          disabled={!editable}
          onChange={(e) => setAbierto(e.target.checked)}
        />
        {DIAS[dia.dia_semana]}
      </label>

      {abierto ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {bloques.map((b, i) => (
            <div key={i} className="flex items-center gap-1">
              <Input
                type="time"
                value={b.desde}
                disabled={!editable}
                onChange={(e) =>
                  setBloques(bloques.map((x, j) => (i === j ? { ...x, desde: e.target.value } : x)))
                }
              />
              <span className="text-text-muted">a</span>
              <Input
                type="time"
                value={b.hasta}
                disabled={!editable}
                onChange={(e) =>
                  setBloques(bloques.map((x, j) => (i === j ? { ...x, hasta: e.target.value } : x)))
                }
              />
              {editable && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setBloques(bloques.filter((_, j) => j !== i))}
                >
                  Quitar
                </Button>
              )}
            </div>
          ))}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setBloques([...bloques, { desde: "14:00", hasta: "17:00" }])}
            >
              + Otro tramo
            </Button>
          )}
        </div>
      ) : (
        <span className="flex-1 text-sm text-text-muted">Cerrado</span>
      )}

      {editable && cambio && (
        <Button size="sm" onClick={() => onGuardar(bloques, abierto)}>
          Guardar
        </Button>
      )}
    </div>
  );
}

function FilaDeNumeracion({
  numeracion,
  editable,
  onGuardar,
}: {
  numeracion: Numeracion;
  editable: boolean;
  onGuardar: (prefijo: string | null, digitos: number) => void;
}) {
  const [prefijo, setPrefijo] = useState(numeracion.prefijo ?? "");
  const [digitos, setDigitos] = useState(numeracion.digitos);
  const cambio = prefijo !== (numeracion.prefijo ?? "") || digitos !== numeracion.digitos;
  const ejemplo = `${prefijo}${String(numeracion.siguiente).padStart(digitos, "0")}`;

  return (
    <div className="flex flex-wrap items-end gap-3 p-4">
      <div className="w-56">
        <div className="text-sm font-medium text-text">
          {NOMBRE_DOCUMENTO[numeracion.documento] ?? numeracion.documento}
        </div>
        <div className="text-xs text-text-muted">Se verá: {ejemplo}</div>
      </div>
      <Input
        label="Prefijo"
        value={prefijo}
        disabled={!editable}
        onChange={(e) => setPrefijo(e.target.value)}
      />
      <Input
        label="Dígitos"
        type="number"
        min={1}
        max={12}
        className="w-24"
        value={String(digitos)}
        disabled={!editable}
        onChange={(e) => setDigitos(Number(e.target.value))}
      />
      <div className="w-32">
        <div className="text-xs text-text-muted">Siguiente</div>
        <div className="text-sm text-text">{numeracion.siguiente}</div>
      </div>
      {editable && cambio && (
        <Button size="sm" onClick={() => onGuardar(prefijo || null, digitos)}>
          Guardar
        </Button>
      )}
    </div>
  );
}
