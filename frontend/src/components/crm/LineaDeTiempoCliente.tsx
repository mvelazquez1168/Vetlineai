import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Icono, Input, LoadingState, Select, useToast } from "../ui";
import { EventoCrm, TipoEvento, crmApi } from "../../lib/crmApi";

// ---------------------------------------------------------------------
// LA LÍNEA DE TIEMPO DEL CLIENTE — prompt 03, sección 7.
//
// Un evento muestra QUÉ pasó, CUÁNDO y de qué módulo viene. El detalle
// vive en el origen, y por eso el evento no lo repite: lo que se ve acá
// es el resumen que el backend arma leyendo el registro referenciado.
//
// CUANDO EL ORIGEN YA NO EXISTE, se dice. Un evento que apunta a un
// registro borrado no se oculta —pasó— pero tampoco finge que se puede
// abrir.
// ---------------------------------------------------------------------

interface Props {
  propietarioId: string;
  /** Para filtrar por una mascota desde la ficha del paciente. */
  pacienteIdFijo?: string;
}

const COLOR_MODULO: Record<string, string> = {
  clientes: "bg-black/5 text-text-primary",
  agenda: "bg-accent/10 text-accent",
  expediente: "bg-success/10 text-success",
  vetline_ai: "bg-primary/10 text-primary",
  facturacion: "bg-warning/20 text-primary",
  caja: "bg-warning/20 text-primary",
  crm: "bg-black/5 text-text-muted",
};

export function LineaDeTiempoCliente({ propietarioId, pacienteIdFijo }: Props) {
  const toast = useToast();
  const [eventos, setEventos] = useState<EventoCrm[]>([]);
  const [tipos, setTipos] = useState<TipoEvento[]>([]);
  const [cargando, setCargando] = useState(true);
  const [modulo, setModulo] = useState("");
  const [tipo, setTipo] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [nota, setNota] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = () => {
    setCargando(true);
    crmApi
      .lineaDeCliente(propietarioId, {
        modulo,
        tipos: tipo,
        desde,
        hasta,
        paciente: pacienteIdFijo ?? "",
      })
      .then((r) => setEventos(r.eventos))
      .catch((err) => toast.error((err as Error).message))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    crmApi
      .tipos()
      .then((r) => setTipos(r.tipos))
      .catch(() => setTipos([]));
  }, []);

  useEffect(cargar, [propietarioId, modulo, tipo, desde, hasta, pacienteIdFijo]);

  const modulos = useMemo(() => {
    const unicos = Array.from(new Set(tipos.map((t) => t.modulo)));
    return unicos.map((m) => ({ value: m, label: ETIQUETA_MODULO[m] ?? m }));
  }, [tipos]);

  const tiposDelModulo = useMemo(
    () => tipos.filter((t) => !modulo || t.modulo === modulo),
    [tipos, modulo]
  );

  const guardarNota = async () => {
    if (!nota.trim()) return;
    setGuardando(true);
    try {
      await crmApi.agregarNota(propietarioId, nota.trim(), pacienteIdFijo);
      setNota("");
      cargar();
      toast.exito("Nota agregada a la línea de tiempo.");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Select
          label="Módulo"
          value={modulo}
          onChange={(e) => {
            setModulo(e.target.value);
            setTipo("");
          }}
          options={[{ value: "", label: "Todos" }, ...modulos]}
        />
        <Select
          label="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          options={[
            { value: "", label: "Todos" },
            ...tiposDelModulo.map((t) => ({ value: t.codigo, label: t.etiqueta })),
          ]}
        />
        <div>
          <label className="text-sm font-semibold text-text-primary">Desde</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div>
          <label className="text-sm font-semibold text-text-primary">Hasta</label>
          <input
            type="date"
            className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Agregar una nota"
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Llamó para preguntar por el resultado…"
          />
        </div>
        <Button onClick={guardarNota} disabled={guardando || !nota.trim()}>
          <Icono nombre="agregar" className="mr-1 h-4 w-4" />
          Agregar
        </Button>
      </div>

      {cargando ? (
        <LoadingState forma="tarjetas" cantidad={5} />
      ) : eventos.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          No hay interacciones con estos filtros.
        </p>
      ) : (
        <ol className="mt-4 space-y-2">
          {eventos.map((e) => (
            <li
              key={e.id}
              className="rounded-lg border border-black/5 p-3 text-sm"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-md px-2 py-0.5 text-xs font-semibold ${
                    COLOR_MODULO[e.modulo] ?? "bg-black/5 text-text-muted"
                  }`}
                >
                  {e.etiqueta}
                </span>
                <span className="text-xs text-text-muted">
                  {new Date(e.ocurrido_en).toLocaleString("es-CR", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                {e.paciente_nombre && <Badge variant="neutral">{e.paciente_nombre}</Badge>}
                {e.canal && <Badge variant="neutral">{e.canal}</Badge>}
                {!e.origen_existe && (
                  <Badge variant="warning">el registro de origen ya no está</Badge>
                )}
              </div>
              {e.resumen && <p className="mt-1 text-text-primary">{e.resumen}</p>}
              {e.nota && e.nota !== e.resumen && (
                <p className="mt-1 text-text-muted">{e.nota}</p>
              )}
              {e.persona_nombre && (
                <p className="mt-1 text-xs text-text-muted">{e.persona_nombre}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const ETIQUETA_MODULO: Record<string, string> = {
  clientes: "Clientes",
  agenda: "Agenda",
  expediente: "Expediente",
  vetline_ai: "Vetline Ai",
  facturacion: "Facturación",
  caja: "Caja",
  crm: "Mensajes y notas",
};
