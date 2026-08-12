import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { formatearFecha } from "../../lib/formatFecha";
import {
  Atencion,
  CuidadoPreventivo,
  EnfermedadVacuna,
  MedicamentoRepetido,
  RecetaHistorialItem,
  workspaceApi,
} from "../../lib/workspaceApi";
import { RecetaPanel } from "./RecetaPanel";

interface RegistroAtencionModalProps {
  citaId: string;
  pacienteId: string;
  pacienteNombre: string;
  especie: string;
  zonaHoraria: string | null | undefined;
  onClose: () => void;
  // El padre decide qué refrescar (cita, cronología del caso, agenda) —
  // este modal no sabe ni le importa desde qué puerta lo abrieron.
  onGuardado?: () => void;
  // Portados tal cual desde HistorialFarmacologicoModal (eliminado en
  // este prompt) — mismo criterio: ambos opcionales, si el caller no los
  // pasa el bloque correspondiente simplemente no se muestra.
  onVerPropietario?: () => void;
  pacienteEstado?: "activo" | "fallecido";
  onMarcadoFallecido?: () => void;
}

// prompt_code_registro_atencion.md — reemplaza HistorialFarmacologicoModal.
// Todo lo que pasó en una visita, en un solo lugar: nota médica, peso,
// temperatura, vacunas/desparasitaciones, receta, e historial
// farmacológico de solo lectura como contexto para decidir qué recetar.
// Siempre cuelga de una cita — no existe atención sin cita (Paso 2).
export function RegistroAtencionModal({
  citaId,
  pacienteId,
  pacienteNombre,
  especie,
  zonaHoraria,
  onClose,
  onGuardado,
  onVerPropietario,
  pacienteEstado,
  onMarcadoFallecido,
}: RegistroAtencionModalProps) {
  const [atencion, setAtencion] = useState<Atencion | null>(null);
  const [casoId, setCasoId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [confirmandoFallecimiento, setConfirmandoFallecimiento] = useState(false);

  const [notaMedica, setNotaMedica] = useState("");
  const [peso, setPeso] = useState("");
  const [temperatura, setTemperatura] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [guardadoOk, setGuardadoOk] = useState(false);
  const [errorGuardar, setErrorGuardar] = useState<string | null>(null);

  const [recetaPanelAbierto, setRecetaPanelAbierto] = useState(false);

  useEffect(() => {
    let cancelado = false;
    workspaceApi
      .obtenerOCrearAtencion(citaId)
      .then(({ atencion: a, cita }) => {
        if (cancelado) return;
        setAtencion(a);
        setCasoId(cita.caso_id);
        setNotaMedica(a.nota_medica ?? "");
        setPeso(a.peso ?? "");
        setTemperatura(a.temperatura ?? "");
      })
      .catch((err) => {
        if (!cancelado) setErrorCarga(err instanceof Error ? err.message : "No pudimos abrir el registro de atención.");
      })
      .finally(() => {
        if (!cancelado) setCargando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [citaId]);

  const guardar = async () => {
    if (!atencion || !notaMedica.trim()) return;
    setGuardando(true);
    setErrorGuardar(null);
    setGuardadoOk(false);
    try {
      const { atencion: actualizada } = await workspaceApi.guardarAtencion(atencion.id, {
        notaMedica: notaMedica.trim(),
        peso: peso.trim() ? Number(peso) : null,
        temperatura: temperatura.trim() ? Number(temperatura) : null,
      });
      setAtencion(actualizada);
      setGuardadoOk(true);
      onGuardado?.();
    } catch (err) {
      setErrorGuardar(err instanceof Error ? err.message : "No pudimos guardar la atención.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="text-lg font-bold text-primary">Registro de atención</h2>
              <p className="text-sm text-text-muted">{pacienteNombre}</p>
            </div>
            {pacienteEstado === "fallecido" && <Badge variant="neutral">Fallecido</Badge>}
          </div>
          <div className="flex items-center gap-4">
            {pacienteEstado === "activo" && (
              <button
                type="button"
                onClick={() => setConfirmandoFallecimiento(true)}
                className="text-sm font-semibold text-error hover:underline"
              >
                Marcar como fallecido
              </button>
            )}
            {onVerPropietario && (
              <button
                type="button"
                onClick={onVerPropietario}
                className="text-sm font-semibold text-accent hover:underline"
              >
                Ficha del propietario
              </button>
            )}
            <button type="button" onClick={onClose} className="text-text-muted hover:text-error" aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {cargando && <p className="text-sm text-text-muted">Cargando…</p>}
          {errorCarga && <p className="text-sm text-error">{errorCarga}</p>}

          {!cargando && !errorCarga && atencion && (
            <div className="space-y-6">
              <div>
                <label className="text-sm font-semibold text-text-primary">Nota médica</label>
                <textarea
                  className="mt-1.5 w-full rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                  rows={4}
                  value={notaMedica}
                  onChange={(e) => setNotaMedica(e.target.value)}
                  placeholder="Lo único obligatorio para guardar — el resto es opcional."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="number"
                  label="Peso (kg)"
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                  placeholder="Opcional"
                />
                <Input
                  type="number"
                  label="Temperatura (°C)"
                  value={temperatura}
                  onChange={(e) => setTemperatura(e.target.value)}
                  placeholder="Opcional"
                />
              </div>

              {errorGuardar && <p className="text-xs text-error">{errorGuardar}</p>}
              <div className="flex items-center gap-3">
                <Button onClick={guardar} disabled={guardando || !notaMedica.trim()}>
                  {guardando ? "Guardando…" : "Guardar"}
                </Button>
                {guardadoOk && <span className="text-xs font-semibold text-success">Guardado</span>}
              </div>

              <div className="border-t border-black/5 pt-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Receta</h3>
                  <Button type="button" variant="secondary" onClick={() => setRecetaPanelAbierto(true)}>
                    + Nueva receta
                  </Button>
                </div>
              </div>

              <div className="border-t border-black/5 pt-5">
                <CuidadosPreventivosAtencion
                  pacienteId={pacienteId}
                  atencionId={atencion.id}
                  especie={especie}
                  zonaHoraria={zonaHoraria}
                />
              </div>

              <div className="border-t border-black/5 pt-5">
                <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-text-muted">
                  Historial farmacológico (solo lectura)
                </h3>
                <HistorialFarmacologicoSoloLectura pacienteId={pacienteId} zonaHoraria={zonaHoraria} />
              </div>
            </div>
          )}
        </div>
      </div>

      {recetaPanelAbierto && atencion && (
        <RecetaPanel
          origen={{ tipo: "atencion", atencionId: atencion.id, tieneCaso: !!casoId }}
          pacienteNombre={pacienteNombre}
          onClose={() => {
            setRecetaPanelAbierto(false);
            onGuardado?.();
          }}
        />
      )}

      {confirmandoFallecimiento && (
        <ConfirmarFallecimientoModal
          pacienteId={pacienteId}
          pacienteNombre={pacienteNombre}
          onCancelar={() => setConfirmandoFallecimiento(false)}
          onConfirmado={() => {
            setConfirmandoFallecimiento(false);
            onMarcadoFallecido?.();
          }}
        />
      )}
    </div>
  );
}

// prompt_code_registro_atencion.md — portado tal cual desde
// HistorialFarmacologicoModal (eliminado en este prompt). "Acción
// sensible, nunca a un clic de distancia": modal propio, fecha
// obligatoria, segundo clic explícito de confirmación.
function ConfirmarFallecimientoModal({
  pacienteId,
  pacienteNombre,
  onCancelar,
  onConfirmado,
}: {
  pacienteId: string;
  pacienteNombre: string;
  onCancelar: () => void;
  onConfirmado: () => void;
}) {
  const [fechaFallecimiento, setFechaFallecimiento] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirmar = async () => {
    if (!fechaFallecimiento) {
      setError("Indicá la fecha de fallecimiento.");
      return;
    }
    setError(null);
    setGuardando(true);
    try {
      await workspaceApi.marcarPacienteFallecido(pacienteId, fechaFallecimiento);
      onConfirmado();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos registrar el fallecimiento.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancelar}
    >
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-bold text-primary">Marcar a {pacienteNombre} como fallecido</h3>
        <p className="mt-2 text-sm text-text-muted">
          Esta acción no se puede deshacer desde acá. {pacienteNombre} dejará de recibir cualquier aviso (citas,
          vacunación, desparasitación, cumpleaños).
        </p>
        <div className="mt-4">
          <Input
            type="date"
            label="Fecha de fallecimiento"
            value={fechaFallecimiento}
            onChange={(e) => setFechaFallecimiento(e.target.value)}
          />
        </div>
        {error && <p className="mt-2 text-xs text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variant="danger" onClick={confirmar} disabled={guardando}>
            {guardando ? "Guardando…" : "Confirmar fallecimiento"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// prompt_code_registro_atencion.md, Paso 5 — contexto clínico en el
// momento de decidir qué recetar, no comodidad. Se consulta, no se
// edita. Copia reducida de la pestaña "farmacológico" de
// HistorialFarmacologicoModal (mismo endpoint, mismo criterio de
// "sin validar" — se elimina ese modal completo en este mismo prompt).
function HistorialFarmacologicoSoloLectura({
  pacienteId,
  zonaHoraria,
}: {
  pacienteId: string;
  zonaHoraria: string | null | undefined;
}) {
  const [recetas, setRecetas] = useState<RecetaHistorialItem[] | null>(null);
  const [repetidos, setRepetidos] = useState<MedicamentoRepetido[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    workspaceApi
      .obtenerHistorialFarmacologico(pacienteId)
      .then((data) => {
        setRecetas(data.recetas);
        setRepetidos(data.medicamentosRepetidos);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos obtener el historial farmacológico."));
  }, [pacienteId]);

  const vecesPorMedicamento = new Map(repetidos.map((r) => [r.medicamentoId, r.veces]));

  if (error) return <p className="text-sm text-error">{error}</p>;
  if (recetas === null) return <p className="text-sm text-text-muted">Cargando…</p>;
  if (recetas.length === 0) {
    return <p className="text-sm text-text-muted">Este paciente todavía no tiene recetas emitidas.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-black/10 text-xs font-bold uppercase tracking-wide text-text-muted">
          <th className="pb-2 pr-3">Fecha</th>
          <th className="pb-2 pr-3">Médico</th>
          <th className="pb-2 pr-3">Origen</th>
          <th className="pb-2">Medicamentos</th>
        </tr>
      </thead>
      <tbody>
        {recetas.map((receta) => (
          <tr key={receta.id} className="border-b border-black/5 align-top">
            <td className="whitespace-nowrap py-3 pr-3 text-text-muted">
              {formatearFecha(receta.emitido_en, zonaHoraria, { day: "2-digit", month: "short", year: "numeric" })}
            </td>
            <td className="whitespace-nowrap py-3 pr-3 text-text-primary">
              <div className="flex items-center gap-1.5">
                <span>{receta.medico_nombre}</span>
                {!receta.fue_validada && <Badge variant="neutral">Sin validar IA</Badge>}
              </div>
            </td>
            <td className="whitespace-nowrap py-3 pr-3">
              {/* prompt_code_registro_atencion.md, respuesta del usuario
                  — distinción visible entre las dos formas de recetar. */}
              <Badge variant={receta.con_visita ? "info" : "neutral"}>
                {receta.con_visita ? "Con visita" : "Ajuste sin visita"}
              </Badge>
            </td>
            <td className="py-3">
              <ul className="space-y-1.5">
                {receta.items.map((item, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{item.medicamento_nombre}</span>
                    <span className="text-xs text-text-muted">
                      {item.dosis}, {item.frecuencia}, {item.duracion}
                    </span>
                    {(vecesPorMedicamento.get(item.medicamento_id) ?? 0) > 1 && (
                      <Badge variant="info">↻ Recetado {vecesPorMedicamento.get(item.medicamento_id)} veces</Badge>
                    )}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// prompt_code_registro_atencion.md, Paso 4 — mismo formulario que ya
// existía (ver HistorialFarmacologicoModal, eliminado en este prompt),
// con atencionId (vínculo nuevo) y, cuando tipo='vacunacion', selección
// múltiple de enfermedades cubiertas filtrada por especie. Opcional: sin
// eso el sistema no puede razonar sobre la vacuna en un caso futuro,
// pero no bloquea el registro.
function CuidadosPreventivosAtencion({
  pacienteId,
  atencionId,
  especie,
  zonaHoraria,
}: {
  pacienteId: string;
  atencionId: string;
  especie: string;
  zonaHoraria: string | null | undefined;
}) {
  const [cuidados, setCuidados] = useState<CuidadoPreventivo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formAbierto, setFormAbierto] = useState(false);
  const [tipo, setTipo] = useState<"desparasitacion" | "vacunacion">("desparasitacion");
  const [fechaAplicacion, setFechaAplicacion] = useState("");
  const [fechaProximaRecomendada, setFechaProximaRecomendada] = useState("");
  const [vacuna, setVacuna] = useState("");
  const [lote, setLote] = useState("");
  const [subtipoDesparasitacion, setSubtipoDesparasitacion] = useState<"interna" | "externa" | "">("");
  const [productoDesparasitacion, setProductoDesparasitacion] = useState("");
  const [enfermedades, setEnfermedades] = useState<EnfermedadVacuna[]>([]);
  const [enfermedadesSeleccionadas, setEnfermedadesSeleccionadas] = useState<string[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);

  const especieCatalogo = especie.toLowerCase() === "felino" ? "felino" : "canino";

  const cargar = () => {
    workspaceApi
      .obtenerCuidadosPreventivos(pacienteId)
      .then((data) => setCuidados(data.cuidadosPreventivos))
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos obtener los cuidados preventivos."));
  };

  useEffect(cargar, [pacienteId]);

  useEffect(() => {
    if (tipo !== "vacunacion" || !formAbierto) return;
    workspaceApi
      .listarEnfermedadesVacuna(especieCatalogo)
      .then((data) => setEnfermedades(data.enfermedades))
      .catch(() => setEnfermedades([]));
  }, [tipo, formAbierto, especieCatalogo]);

  const alternarEnfermedad = (id: string) => {
    setEnfermedadesSeleccionadas((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fechaAplicacion || !fechaProximaRecomendada) {
      setErrorFormulario("Completá ambas fechas.");
      return;
    }
    if (tipo === "vacunacion" && !vacuna.trim()) {
      setErrorFormulario("Indicá qué vacuna se aplicó.");
      return;
    }
    if (tipo === "desparasitacion" && !subtipoDesparasitacion) {
      setErrorFormulario("Indicá si la desparasitación es interna o externa.");
      return;
    }
    setErrorFormulario(null);
    setGuardando(true);
    try {
      await workspaceApi.registrarCuidadoPreventivo(pacienteId, {
        tipo,
        fechaAplicacion,
        fechaProximaRecomendada,
        atencionId,
        ...(tipo === "vacunacion"
          ? {
              vacuna: vacuna.trim(),
              lote: lote.trim() || undefined,
              enfermedadIds: enfermedadesSeleccionadas.length > 0 ? enfermedadesSeleccionadas : undefined,
            }
          : {}),
        ...(tipo === "desparasitacion"
          ? {
              subtipoDesparasitacion: subtipoDesparasitacion as "interna" | "externa",
              productoDesparasitacion: productoDesparasitacion.trim() || undefined,
            }
          : {}),
      });
      setFechaAplicacion("");
      setFechaProximaRecomendada("");
      setVacuna("");
      setLote("");
      setSubtipoDesparasitacion("");
      setProductoDesparasitacion("");
      setEnfermedadesSeleccionadas([]);
      setFormAbierto(false);
      cargar();
    } catch (err) {
      setErrorFormulario(err instanceof Error ? err.message : "No pudimos registrar el cuidado preventivo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Vacunas y desparasitaciones</h3>
        <Button type="button" variant={formAbierto ? "secondary" : "primary"} onClick={() => setFormAbierto((v) => !v)}>
          {formAbierto ? "Cerrar" : "+ Registrar"}
        </Button>
      </div>

      {formAbierto && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-black/5 bg-background p-4">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTipo("desparasitacion")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                tipo === "desparasitacion" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
              }`}
            >
              Desparasitación
            </button>
            <button
              type="button"
              onClick={() => setTipo("vacunacion")}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                tipo === "vacunacion" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
              }`}
            >
              Vacunación
            </button>
          </div>

          {tipo === "vacunacion" && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="Vacuna aplicada" value={vacuna} onChange={(e) => setVacuna(e.target.value)} placeholder="Ej. Polivalente" />
                <Input
                  label="Lote (opcional)"
                  value={lote}
                  onChange={(e) => setLote(e.target.value)}
                  placeholder="Si la clínica lo registra"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted">
                  Enfermedades cubiertas (opcional)
                </label>
                <p className="mt-0.5 text-xs text-text-muted">
                  Sin esto, el sistema no puede razonar sobre esta vacuna en un caso futuro.
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {enfermedades.length === 0 && (
                    <span className="text-xs text-text-muted">Cargando catálogo…</span>
                  )}
                  {enfermedades.map((en) => (
                    <button
                      key={en.id}
                      type="button"
                      onClick={() => alternarEnfermedad(en.id)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        enfermedadesSeleccionadas.includes(en.id)
                          ? "bg-accent text-white"
                          : "bg-black/5 text-text-muted hover:bg-black/10"
                      }`}
                    >
                      {en.nombre}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {tipo === "desparasitacion" && (
            <div className="mt-3 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSubtipoDesparasitacion("interna")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    subtipoDesparasitacion === "interna" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                  }`}
                >
                  Interna
                </button>
                <button
                  type="button"
                  onClick={() => setSubtipoDesparasitacion("externa")}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                    subtipoDesparasitacion === "externa" ? "bg-primary text-white" : "bg-black/5 text-text-muted"
                  }`}
                >
                  Externa
                </button>
              </div>
              <Input
                label="Producto aplicado (opcional)"
                value={productoDesparasitacion}
                onChange={(e) => setProductoDesparasitacion(e.target.value)}
                placeholder="Ej. Drontal, Nexgard"
              />
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              type="date"
              label="Fecha de aplicación"
              value={fechaAplicacion}
              onChange={(e) => setFechaAplicacion(e.target.value)}
            />
            <Input
              type="date"
              label="Fecha próxima recomendada"
              value={fechaProximaRecomendada}
              onChange={(e) => setFechaProximaRecomendada(e.target.value)}
            />
          </div>
          {errorFormulario && <p className="mt-2 text-xs text-error">{errorFormulario}</p>}
          <Button type="submit" disabled={guardando} className="mt-3">
            {guardando ? "Guardando…" : "Guardar"}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-error">{error}</p>}
      {!error && cuidados === null && <p className="text-sm text-text-muted">Cargando…</p>}
      {!error && cuidados !== null && cuidados.length === 0 && (
        <p className="text-sm text-text-muted">Este paciente todavía no tiene cuidados preventivos registrados.</p>
      )}
      {!error && cuidados !== null && cuidados.length > 0 && (
        <ul className="space-y-2">
          {cuidados.map((c) => (
            <li key={c.id} className="rounded-lg border border-black/5 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-2">
                <Badge
                  variant={c.tipo === "vacunacion" ? "info" : c.subtipo_desparasitacion === "externa" ? "warning" : "neutral"}
                >
                  {c.tipo === "vacunacion"
                    ? "Vacunación"
                    : c.subtipo_desparasitacion === "externa"
                      ? "Desparasitación externa"
                      : "Desparasitación interna"}
                </Badge>
                {c.tipo === "vacunacion" && c.vacuna && <span className="font-medium text-text-primary">{c.vacuna}</span>}
                {c.tipo === "desparasitacion" && c.producto_desparasitacion && (
                  <span className="font-medium text-text-primary">{c.producto_desparasitacion}</span>
                )}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Aplicada el{" "}
                {formatearFecha(c.fecha_aplicacion, zonaHoraria, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}
                {c.tipo === "vacunacion" && c.enfermedades_cubiertas.length > 0 && (
                  <> · Cubre: {c.enfermedades_cubiertas.join(", ")}</>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
