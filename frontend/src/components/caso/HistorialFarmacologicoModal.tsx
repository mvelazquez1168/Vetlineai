import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { formatearFecha } from "../../lib/formatFecha";
import {
  CuidadoPreventivo,
  MedicamentoRepetido,
  RecetaHistorialItem,
  workspaceApi,
} from "../../lib/workspaceApi";

interface HistorialFarmacologicoModalProps {
  pacienteId: string;
  pacienteNombre: string;
  zonaHoraria: string | null | undefined;
  onClose: () => void;
  // Opcional — solo CasoWorkspace lo pasa hoy (tiene el propietarioId a
  // mano). Sin esto el botón simplemente no aparece, en vez de fallar.
  onVerPropietario?: () => void;
  // prompt_code_paciente_nacimiento_estado.md, Parte B2 — el registro del
  // fallecimiento vive acá (la única "ficha del paciente" que existe).
  // Ambos opcionales: si el caller no los pasa, el bloque simplemente no
  // se muestra, en vez de asumir 'activo' en silencio.
  pacienteEstado?: "activo" | "fallecido";
  onMarcadoFallecido?: () => void;
}

type Pestania = "farmacologico" | "preventivos";

// No existe todavía una "ficha del paciente" con pestañas en esta app
// (solo hay vista por caso) — se expone acá, accesible desde el header
// del caso, que es donde el paciente ya es visible hoy. Consulta SQL
// directa del backend (sin IA), por eso no hay estado de carga largo:
// si tarda, es señal de que algo llama a un endpoint equivocado.
export function HistorialFarmacologicoModal({
  pacienteId,
  pacienteNombre,
  zonaHoraria,
  onClose,
  onVerPropietario,
  pacienteEstado,
  onMarcadoFallecido,
}: HistorialFarmacologicoModalProps) {
  const [pestania, setPestania] = useState<Pestania>("farmacologico");
  const [recetas, setRecetas] = useState<RecetaHistorialItem[] | null>(null);
  const [repetidos, setRepetidos] = useState<MedicamentoRepetido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmandoFallecimiento, setConfirmandoFallecimiento] = useState(false);

  useEffect(() => {
    workspaceApi
      .obtenerHistorialFarmacologico(pacienteId)
      .then((data) => {
        setRecetas(data.recetas);
        setRepetidos(data.medicamentosRepetidos);
      })
      .catch((err) => {
        console.error("Error al obtener el historial farmacológico:", err);
        setError(err instanceof Error ? err.message : "No pudimos obtener el historial farmacológico.");
      });
  }, [pacienteId]);

  const vecesPorMedicamento = new Map(repetidos.map((r) => [r.medicamentoId, r.veces]));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/5 px-6 py-4">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-primary">{pacienteNombre}</h2>
            {pacienteEstado === "fallecido" && <Badge variant="neutral">Fallecido</Badge>}
          </div>
          <div className="flex items-center gap-4">
            {/* prompt_code_paciente_nacimiento_estado.md, Parte B2 — acción
                sensible, nunca a un clic de distancia: siempre pasa por el
                modal de confirmación de abajo, nunca se ejecuta directo. */}
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

        <div className="flex gap-1 border-b border-black/5 px-6 pt-3">
          {(
            [
              { id: "farmacologico" as const, label: "Historial Farmacológico" },
              { id: "preventivos" as const, label: "Cuidados Preventivos" },
            ]
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPestania(tab.id)}
              className={[
                "rounded-t-lg px-3 py-2 text-sm font-semibold",
                pestania === tab.id
                  ? "border-b-2 border-accent text-accent"
                  : "text-text-muted hover:text-text-primary",
              ].join(" ")}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {pestania === "farmacologico" && (
            <>
              {error && <p className="text-sm text-error">{error}</p>}

              {!error && recetas === null && (
                <p className="text-sm text-text-muted">Cargando…</p>
              )}

              {!error && recetas !== null && recetas.length === 0 && (
                <p className="text-sm text-text-muted">
                  Este paciente todavía no tiene recetas emitidas.
                </p>
              )}

              {!error && recetas !== null && recetas.length > 0 && (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-black/10 text-xs font-bold uppercase tracking-wide text-text-muted">
                      <th className="pb-2 pr-3">Fecha</th>
                      <th className="pb-2 pr-3">Médico</th>
                      <th className="pb-2">Medicamentos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recetas.map((receta) => (
                      <tr key={receta.id} className="border-b border-black/5 align-top">
                        <td className="whitespace-nowrap py-3 pr-3 text-text-muted">
                          {formatearFecha(receta.emitido_en, zonaHoraria, {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </td>
                        <td className="whitespace-nowrap py-3 pr-3 text-text-primary">
                          <div className="flex items-center gap-1.5">
                            <span>{receta.medico_nombre}</span>
                            {/* Discreto, solo informativo — sin alarmismo. La
                                ausencia de badge en las demás filas ya indica
                                que sí pasaron por validación IA. */}
                            {!receta.fue_validada && <Badge variant="neutral">Sin validar IA</Badge>}
                          </div>
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
                                  <Badge variant="info">
                                    ↻ Recetado {vecesPorMedicamento.get(item.medicamento_id)} veces
                                  </Badge>
                                )}
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </>
          )}

          {pestania === "preventivos" && (
            <CuidadosPreventivosSeccion pacienteId={pacienteId} zonaHoraria={zonaHoraria} />
          )}
        </div>
      </div>

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

// prompt_code_paciente_nacimiento_estado.md, Parte B2 — "es una acción
// sensible y no debe quedar a un clic de distancia por accidente": modal
// propio, separado del botón que lo abre, con la fecha obligatoria y un
// segundo clic explícito de confirmación.
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-primary/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onCancelar}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-primary">Marcar a {pacienteNombre} como fallecido</h3>
        <p className="mt-2 text-sm text-text-muted">
          Esta acción no se puede deshacer desde acá. {pacienteNombre} dejará de recibir cualquier aviso
          (citas, vacunación, desparasitación, cumpleaños).
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

// Módulo de Notificaciones (mock) — este formulario es el único punto de
// entrada de cuidados preventivos hoy (solo desparasitación, ver
// prompt_notificaciones_mock.md). El job diario lee esta misma tabla
// para disparar el aviso de "próxima a vencer" — este componente nunca
// crea notificaciones directamente, solo el registro del cuidado.
// Umbral de aviso de desparasitación (configuracion_notificaciones.
// dias_aviso_desparasitacion, default 7 en el backend) — todavía no hay
// ningún endpoint que lo exponga para lectura desde el frontend (ver
// prompt_notificaciones_frontend.md, "no lo hardcodees... o calculalo
// usando 7 como fallback si el backend todavía no devuelve el valor
// configurado"). Si en el futuro se expone, este es el único lugar a
// cambiar.
const DIAS_AVISO_DESPARASITACION_FALLBACK = 7;

// DATE puro (medianoche UTC) — se calculan los días restantes en UTC
// para no correr un día en zonas con offset negativo (mismo criterio que
// el formateo de fecha_aplicacion/fecha_proxima_recomendada más abajo).
function diasHastaUTC(fechaIso: string): number {
  const hoyUTC = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate()
  );
  const fecha = new Date(fechaIso);
  const fechaUTC = Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate());
  return Math.round((fechaUTC - hoyUTC) / (24 * 60 * 60 * 1000));
}

function BadgeVencimiento({ fechaProximaRecomendada }: { fechaProximaRecomendada: string }) {
  const dias = diasHastaUTC(fechaProximaRecomendada);
  if (dias < 0) {
    return <Badge variant="error">Vencida hace {Math.abs(dias)} día{Math.abs(dias) === 1 ? "" : "s"}</Badge>;
  }
  if (dias <= DIAS_AVISO_DESPARASITACION_FALLBACK) {
    return <Badge variant="warning">{dias === 0 ? "Vence hoy" : `Vence en ${dias} día${dias === 1 ? "" : "s"}`}</Badge>;
  }
  return null;
}

// prompt_code_notificaciones_pendientes.md, Parte A — vacuna como texto
// libre (no catálogo cerrado): los nombres varían mucho entre clínicas y
// países (múltiple, rábica, polivalente…) y un catálogo quedaría corto
// rápido. Salvedad para más adelante, señalada por el usuario y NO
// resuelta acá: cuando los cuidados preventivos entren al contexto del
// agente, el texto libre va a limitar lo que puede afirmar con confianza
// (leer "polivalente" sin saber contra qué protege no alcanza para
// descartar parvovirosis).
function CuidadosPreventivosSeccion({
  pacienteId,
  zonaHoraria,
}: {
  pacienteId: string;
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
  const [guardando, setGuardando] = useState(false);
  const [errorFormulario, setErrorFormulario] = useState<string | null>(null);

  const cargar = () => {
    workspaceApi
      .obtenerCuidadosPreventivos(pacienteId)
      .then((data) => setCuidados(data.cuidadosPreventivos))
      .catch((err) => {
        console.error("Error al obtener los cuidados preventivos:", err);
        setError(err instanceof Error ? err.message : "No pudimos obtener los cuidados preventivos.");
      });
  };

  useEffect(cargar, [pacienteId]);

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
        ...(tipo === "vacunacion" ? { vacuna: vacuna.trim(), lote: lote.trim() || undefined } : {}),
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
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">Cuidados Preventivos</h3>
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
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Vacuna aplicada" value={vacuna} onChange={(e) => setVacuna(e.target.value)} placeholder="Ej. Polivalente" />
              <Input
                label="Lote (opcional)"
                value={lote}
                onChange={(e) => setLote(e.target.value)}
                placeholder="Si la clínica lo registra"
              />
            </div>
          )}

          {/* prompt_code_paciente_nacimiento_estado.md, Parte A — interna y
              externa son clínicamente distintas (parásitos digestivos vs.
              pulgas/garrapatas), por eso el subtipo es obligatorio y no un
              detalle opcional más. Producto en texto libre, mismo criterio
              que vacuna: los nombres comerciales varían mucho. */}
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
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-black/15 p-8 text-center">
          <span className="text-3xl" aria-hidden="true">
            💉
          </span>
          <p className="text-sm text-text-muted">
            Este paciente todavía no tiene cuidados preventivos registrados.
          </p>
        </div>
      )}

      {!error && cuidados !== null && cuidados.length > 0 && (
        <ul className="space-y-2">
          {cuidados.map((c) => (
            <li key={c.id} className="rounded-lg border border-black/5 px-4 py-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    {/* Distinguibles a simple vista por color, no solo
                        por texto (pedido del prompt) — interna y externa
                        también, no solo vacunación vs. desparasitación. */}
                    <Badge
                      variant={
                        c.tipo === "vacunacion" ? "info" : c.subtipo_desparasitacion === "externa" ? "warning" : "neutral"
                      }
                    >
                      {c.tipo === "vacunacion"
                        ? "Vacunación"
                        : c.subtipo_desparasitacion === "externa"
                          ? "Desparasitación externa"
                          : c.subtipo_desparasitacion === "interna"
                            ? "Desparasitación interna"
                            : "Desparasitación"}
                    </Badge>
                    {c.tipo === "vacunacion" && c.vacuna && (
                      <span className="font-medium text-text-primary">{c.vacuna}</span>
                    )}
                    {c.tipo === "desparasitacion" && c.producto_desparasitacion && (
                      <span className="font-medium text-text-primary">{c.producto_desparasitacion}</span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {/* fecha_aplicacion/fecha_proxima_recomendada son DATE
                        puro (pg las serializa como medianoche UTC) — se
                        formatean siempre en UTC, nunca con la zona horaria
                        del tenant, para no correr el día en zonas con
                        offset negativo (mismo motivo que soloFecha() en
                        agendaApi.ts para citas/lista_espera). */}
                    Aplicada el{" "}
                    {formatearFecha(c.fecha_aplicacion, zonaHoraria, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}{" "}
                    · Próxima:{" "}
                    {formatearFecha(c.fecha_proxima_recomendada, zonaHoraria, {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                    {c.tipo === "vacunacion" && c.lote && ` · Lote: ${c.lote}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <BadgeVencimiento fechaProximaRecomendada={c.fecha_proxima_recomendada} />
                  <span className="whitespace-nowrap text-xs text-text-muted">{c.registrado_por_nombre}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
