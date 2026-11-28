import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  EmptyState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Table,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Equipo, equiposApi, Sala, salasApi } from "../../lib/agendaApi";

// ---------------------------------------------------------------------
// SALAS Y EQUIPOS — punto 2.2 de la revisión del 2026-11-27.
//
// Las salas existían desde la migración 017 y los equipos desde la 166,
// y el motor de disponibilidad del 05 usa los dos: un tipo de cita
// puede exigir una sala o un equipo, y si están ocupados el hueco no se
// ofrece. Lo que no existía era NINGUNA pantalla para cargarlos. La
// tabla de equipos estaba vacía, así que esa mitad del motor nunca se
// podía disparar, y la agenda mostraba «Sin salas configuradas» sin
// decir adónde ir.
//
// LA CANTIDAD ES EL DATO QUE IMPORTA en los equipos, y por eso esto no
// es una lista de nombres: una clínica con dos ecógrafos puede agendar
// dos ecografías a la misma hora. Con uno, la segunda no se ofrece.
//
// SE DESACTIVA, NO SE BORRA: lo borrado se lleva por delante las citas
// pasadas que lo usaron. Desactivado deja de ofrecerse y la historia
// queda. Por eso hay un interruptor para ver lo desactivado y volver a
// encenderlo — antes solo se podía apagar.
// ---------------------------------------------------------------------

const TIPOS_DE_SALA = [
  { value: "", label: "Sin tipo" },
  { value: "consulta", label: "Consulta" },
  { value: "cirugia", label: "Cirugía" },
  { value: "dental", label: "Dental" },
  { value: "imagen", label: "Imagen" },
  { value: "internamiento", label: "Internamiento" },
  { value: "estetica", label: "Estética" },
];

export function SalasYEquipos({
  /** Para dibujarla dentro de una pestaña (Clínica). */
  sinEncabezado,
}: { sinEncabezado?: boolean } = {}) {
  const toast = useToast();
  const { puede } = useAuth();
  const puedeEditar = puede("clinica.configurar");

  const [salas, setSalas] = useState<Sala[]>([]);
  const [equipos, setEquipos] = useState<Equipo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [verApagados, setVerApagados] = useState(false);

  const [salaEnEdicion, setSalaEnEdicion] = useState<Partial<Sala> | null>(null);
  const [equipoEnEdicion, setEquipoEnEdicion] = useState<Partial<Equipo> | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = (conApagados: boolean) => {
    setCargando(true);
    Promise.all([salasApi.listar(conApagados), equiposApi.listar(conApagados)])
      .then(([s, e]) => {
        setSalas(s.salas);
        setEquipos(e.equipos);
      })
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    cargar(verApagados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verApagados]);

  const guardarSala = async () => {
    if (!salaEnEdicion?.nombre?.trim()) return;
    setGuardando(true);
    try {
      const datos = { nombre: salaEnEdicion.nombre.trim(), tipo: salaEnEdicion.tipo ?? undefined };
      if (salaEnEdicion.id) await salasApi.editar(salaEnEdicion.id, datos);
      else await salasApi.crear(datos);
      toast.exito(salaEnEdicion.id ? "Sala guardada." : "Sala creada.");
      setSalaEnEdicion(null);
      cargar(verApagados);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const guardarEquipo = async () => {
    if (!equipoEnEdicion?.nombre?.trim()) return;
    setGuardando(true);
    try {
      const datos = {
        nombre: equipoEnEdicion.nombre.trim(),
        categoria: equipoEnEdicion.categoria ?? undefined,
        cantidad: Number(equipoEnEdicion.cantidad ?? 1),
      };
      if (equipoEnEdicion.id) await equiposApi.editar(equipoEnEdicion.id, datos);
      else await equiposApi.crear(datos);
      toast.exito(equipoEnEdicion.id ? "Equipo guardado." : "Equipo agregado.");
      setEquipoEnEdicion(null);
      cargar(verApagados);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  const alternarSala = async (s: Sala) => {
    try {
      await salasApi.activar(s.id, !s.activa);
      cargar(verApagados);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const alternarEquipo = async (e: Equipo) => {
    try {
      await equiposApi.activar(e.id, !e.activo);
      cargar(verApagados);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (cargando) return <LoadingState forma="tabla" cantidad={6} />;

  return (
    <div>
      {!sinEncabezado && (
        <PageHeader
          titulo="Salas y equipos"
          subtitulo="Dónde se atiende y con qué. La agenda usa los dos para saber si un horario se puede ofrecer."
          icono="clinica"
          modulo="admin"
          padre={{ a: "/admin/clinica", etiqueta: "Clínica" }}
        />
      )}

      <Card>
        <CardTitle>Para qué sirven</CardTitle>
        <CardDescription>
          Un tipo de cita puede <strong>exigir una sala o un equipo</strong>. Cuando los que hay
          están ocupados, ese horario no se ofrece: es lo que evita agendar dos cirugías en el
          único quirófano. La <strong>cantidad</strong> de un equipo es cuántos hay — con dos
          ecógrafos se pueden agendar dos ecografías a la misma hora.
        </CardDescription>
        <label className="mt-4 flex items-center gap-2 text-sm text-text-muted">
          <input
            type="checkbox"
            checked={verApagados}
            onChange={(e) => setVerApagados(e.target.checked)}
            data-sin-guardar="no"
          />
          Ver también los desactivados
        </label>
      </Card>

      {/* ------------------------------------------------- SALAS */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Salas</CardTitle>
          {puedeEditar && (
            <Button onClick={() => setSalaEnEdicion({ nombre: "", tipo: "" })}>+ Nueva sala</Button>
          )}
        </div>
        {salas.length === 0 ? (
          <EmptyState
            icono="clinica"
            titulo="Todavía no hay salas"
            texto="Sin salas, la agenda no puede reservar el quirófano ni avisar que está ocupado. Agregue las que usa la clínica."
          />
        ) : (
          <Table
            columns={[
              { key: "nombre", header: "Nombre", render: (s: Sala) => s.nombre },
              {
                key: "tipo",
                header: "Tipo",
                render: (s: Sala) =>
                  TIPOS_DE_SALA.find((t) => t.value === (s.tipo ?? ""))?.label ?? s.tipo ?? "—",
              },
              {
                key: "estado",
                header: "Estado",
                render: (s: Sala) =>
                  s.activa ? (
                    <Badge variant="success" dot>
                      Activa
                    </Badge>
                  ) : (
                    <Badge variant="neutral" dot>
                      Desactivada
                    </Badge>
                  ),
              },
              {
                key: "acciones",
                header: "Acciones",
                render: (s: Sala) =>
                  puedeEditar ? (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setSalaEnEdicion(s)}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void alternarSala(s)}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        {s.activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  ) : null,
              },
            ]}
            data={salas}
            rowKey={(s) => s.id}
            emptyMessage="Sin salas."
          />
        )}
      </Card>

      {/* ----------------------------------------------- EQUIPOS */}
      <Card className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Equipos</CardTitle>
          {puedeEditar && (
            <Button onClick={() => setEquipoEnEdicion({ nombre: "", categoria: "", cantidad: 1 })}>
              + Nuevo equipo
            </Button>
          )}
        </div>
        {equipos.length === 0 ? (
          <EmptyState
            icono="producto"
            titulo="Todavía no hay equipos"
            texto="El rayos X, el ecógrafo, el equipo dental. Si un tipo de cita los necesita, la agenda no ofrece el horario cuando están ocupados."
          />
        ) : (
          <Table
            columns={[
              { key: "nombre", header: "Nombre", render: (e: Equipo) => e.nombre },
              { key: "categoria", header: "Categoría", render: (e: Equipo) => e.categoria ?? "—" },
              {
                key: "cantidad",
                header: "Cuántos hay",
                render: (e: Equipo) => String(e.cantidad),
              },
              {
                key: "tipos",
                header: "Lo exigen",
                render: (e: Equipo) =>
                  e.tipos_de_cita > 0
                    ? `${e.tipos_de_cita} tipo(s) de cita`
                    : "ningún tipo de cita",
              },
              {
                key: "estado",
                header: "Estado",
                render: (e: Equipo) =>
                  e.activo ? (
                    <Badge variant="success" dot>
                      Activo
                    </Badge>
                  ) : (
                    <Badge variant="neutral" dot>
                      Desactivado
                    </Badge>
                  ),
              },
              {
                key: "acciones",
                header: "Acciones",
                render: (e: Equipo) =>
                  puedeEditar ? (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => setEquipoEnEdicion(e)}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void alternarEquipo(e)}
                        className="text-sm font-semibold text-accent hover:underline"
                      >
                        {e.activo ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  ) : null,
              },
            ]}
            data={equipos}
            rowKey={(e) => e.id}
            emptyMessage="Sin equipos."
          />
        )}
      </Card>

      {salaEnEdicion && (
        <Modal
          open
          onClose={() => setSalaEnEdicion(null)}
          title={salaEnEdicion.id ? "Editar la sala" : "Nueva sala"}
          hayCambios={!!salaEnEdicion.nombre?.trim()}
          onGuardar={guardarSala}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setSalaEnEdicion(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void guardarSala()}
                disabled={guardando || !salaEnEdicion.nombre?.trim()}
              >
                Guardar
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Input
              label="Nombre"
              value={salaEnEdicion.nombre ?? ""}
              onChange={(e) => setSalaEnEdicion({ ...salaEnEdicion, nombre: e.target.value })}
              placeholder="Quirófano 1"
            />
            <Select
              label="Tipo"
              value={salaEnEdicion.tipo ?? ""}
              onChange={(e) => setSalaEnEdicion({ ...salaEnEdicion, tipo: e.target.value })}
              options={TIPOS_DE_SALA}
            />
          </div>
        </Modal>
      )}

      {equipoEnEdicion && (
        <Modal
          open
          onClose={() => setEquipoEnEdicion(null)}
          title={equipoEnEdicion.id ? "Editar el equipo" : "Nuevo equipo"}
          hayCambios={!!equipoEnEdicion.nombre?.trim()}
          onGuardar={guardarEquipo}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEquipoEnEdicion(null)}>
                Cancelar
              </Button>
              <Button
                onClick={() => void guardarEquipo()}
                disabled={guardando || !equipoEnEdicion.nombre?.trim()}
              >
                Guardar
              </Button>
            </div>
          }
        >
          <div className="space-y-3">
            <Input
              label="Nombre"
              value={equipoEnEdicion.nombre ?? ""}
              onChange={(e) => setEquipoEnEdicion({ ...equipoEnEdicion, nombre: e.target.value })}
              placeholder="Ecógrafo"
            />
            <Input
              label="Categoría"
              value={equipoEnEdicion.categoria ?? ""}
              onChange={(e) =>
                setEquipoEnEdicion({ ...equipoEnEdicion, categoria: e.target.value })
              }
              placeholder="Imagen"
            />
            <Input
              label="Cuántos hay"
              type="number"
              min={1}
              value={String(equipoEnEdicion.cantidad ?? 1)}
              onChange={(e) =>
                setEquipoEnEdicion({ ...equipoEnEdicion, cantidad: Number(e.target.value) })
              }
            />
            <p className="text-xs text-text-muted">
              Con dos de un mismo equipo, la agenda puede ofrecer dos citas que lo necesiten a la
              misma hora. Con uno, la segunda no se ofrece.
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
