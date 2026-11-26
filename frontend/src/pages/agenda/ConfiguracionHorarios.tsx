import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Select } from "../../components/ui/Select";
import { useAuth } from "../../hooks/useAuth";
import {
  BloqueHorario,
  DiaConfigInput,
  horariosApi,
  listarMedicosLigero,
  MedicoLigero,
  TipoBloqueHorario,
} from "../../lib/agendaApi";
import { workspaceApi } from "../../lib/workspaceApi";

// Orden de despliegue Lunes→Domingo, aunque la convención de dia_semana
// en la DB (y en el backend, ver agenda.routes.ts) es 0=domingo…6=sábado
// — mismo criterio que Postgres EXTRACT(DOW) y JS Date.getDay().
const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
const DIA_LABEL: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};
const TIPO_LABEL: Record<TipoBloqueHorario, string> = {
  disponible: "Disponible",
  almuerzo: "Almuerzo",
  bloqueado: "Bloqueado",
};

interface DiaEstado {
  activo: boolean;
  bloques: BloqueHorario[];
}

function diaVacio(): DiaEstado {
  return { activo: true, bloques: [] };
}

export function ConfiguracionHorarios() {
  const { rol, user } = useAuth();
  const esAdminClinica = rol === "admin_clinica";

  const [medicos, setMedicos] = useState<MedicoLigero[]>([]);
  const [medicoId, setMedicoId] = useState("");
  const [dias, setDias] = useState<Record<number, DiaEstado>>(() =>
    Object.fromEntries(DIAS_ORDEN.map((d) => [d, diaVacio()]))
  );
  const [maxCitasDia, setMaxCitasDia] = useState<string>("");
  const [duracionDefault, setDuracionDefault] = useState(30);
  const [bufferMinutos, setBufferMinutos] = useState(0);
  const [aceptaEmergencias, setAceptaEmergencias] = useState(true);

  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardadoOk, setGuardadoOk] = useState(false);

  useEffect(() => {
    let cancelado = false;
    async function init() {
      let nombrePropio: string | null = null;
      if (!esAdminClinica) {
        try {
          const me = await workspaceApi.obtenerMe();
          nombrePropio = me.persona?.persona_nombre ?? null;
        } catch {
          nombrePropio = null;
        }
      }
      const lista = await listarMedicosLigero(
        esAdminClinica,
        user ? { id: user.userId, nombre: nombrePropio ? `${nombrePropio} (usted)` : "Usted" } : null
      );
      if (cancelado) return;
      setMedicos(lista);
      // Un médico solo puede ver/editar su propia configuración — ver
      // el calendario general (ya arreglado) no implica poder tocar el
      // horario de otro médico (ver prompt_fix_agenda_permisos_paciente.md).
      // El backend ahora también lo rechaza (403), esto es solo para no
      // ni siquiera ofrecer la opción en la UI.
      if (!esAdminClinica && user) {
        setMedicoId(user.userId);
      } else if (lista.length > 0) {
        setMedicoId(lista[0].id);
      }
    }
    init();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!medicoId) return;
    setCargando(true);
    setError(null);
    setGuardadoOk(false);
    horariosApi
      .listar(medicoId)
      .then((data) => {
        const nuevo = Object.fromEntries(DIAS_ORDEN.map((d) => [d, diaVacio()])) as Record<number, DiaEstado>;
        for (const fila of data.horarios) {
          nuevo[fila.dia_semana] = { activo: fila.activo, bloques: fila.bloques };
        }
        setDias(nuevo);
        const primero = data.horarios[0];
        setMaxCitasDia(primero?.max_citas_dia != null ? String(primero.max_citas_dia) : "");
        setDuracionDefault(primero?.duracion_default_minutos ?? 30);
        setBufferMinutos(primero?.buffer_minutos ?? 0);
        setAceptaEmergencias(primero?.acepta_emergencias ?? true);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos cargar los horarios."))
      .finally(() => setCargando(false));
  }, [medicoId]);

  const actualizarDia = (dia: number, cambios: Partial<DiaEstado>) => {
    setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], ...cambios } }));
    setGuardadoOk(false);
  };

  const agregarBloque = (dia: number) => {
    actualizarDia(dia, {
      bloques: [...dias[dia].bloques, { hora_inicio: "09:00", hora_fin: "12:00", tipo: "disponible" }],
    });
  };

  const quitarBloque = (dia: number, idx: number) => {
    actualizarDia(dia, { bloques: dias[dia].bloques.filter((_, i) => i !== idx) });
  };

  const actualizarBloque = (dia: number, idx: number, cambios: Partial<BloqueHorario>) => {
    actualizarDia(dia, {
      bloques: dias[dia].bloques.map((b, i) => (i === idx ? { ...b, ...cambios } : b)),
    });
  };

  const guardar = async () => {
    if (!medicoId) return;
    setGuardando(true);
    setError(null);
    setGuardadoOk(false);
    try {
      const payload: DiaConfigInput[] = DIAS_ORDEN.map((dia) => ({
        diaSemana: dia,
        bloques: dias[dia].bloques,
        activo: dias[dia].activo,
        maxCitasDia: maxCitasDia.trim() ? Number(maxCitasDia) : null,
        duracionDefaultMinutos: duracionDefault,
        bufferMinutos,
        aceptaEmergencias,
      }));
      await horariosApi.guardar(medicoId, payload);
      setGuardadoOk(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos guardar la configuración.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-primary">Configuración de Horarios</h1>
        <div className="w-64">
          {esAdminClinica ? (
            <Select
              value={medicoId}
              onChange={(e) => setMedicoId(e.target.value)}
              options={medicos.map((m) => ({ value: m.id, label: m.nombre }))}
            />
          ) : (
            <p className="rounded-lg bg-background px-4 py-2.5 text-sm font-medium text-text-primary">
              {medicos.find((m) => m.id === medicoId)?.nombre ?? "Usted"}
            </p>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}
      {guardadoOk && <p className="text-sm font-semibold text-success">Configuración guardada.</p>}
      {cargando && <p className="text-sm text-text-muted">Cargando…</p>}

      {!cargando && medicoId && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-4">
            {DIAS_ORDEN.map((dia) => (
              <Card key={dia}>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm font-bold text-primary">
                    <input
                      type="checkbox"
                      checked={dias[dia].activo}
                      onChange={(e) => actualizarDia(dia, { activo: e.target.checked })}
                    />
                    {DIA_LABEL[dia]}
                  </label>
                  {dias[dia].activo && (
                    <button
                      type="button"
                      onClick={() => agregarBloque(dia)}
                      className="text-xs font-semibold text-accent hover:underline"
                    >
                      + Agregar franja
                    </button>
                  )}
                </div>

                {dias[dia].activo ? (
                  <div className="mt-3 flex flex-col gap-2">
                    {dias[dia].bloques.length === 0 && (
                      <p className="text-xs text-text-muted">Sin franjas configuradas.</p>
                    )}
                    {dias[dia].bloques.map((bloque, idx) => (
                      <div key={idx} className="flex flex-wrap items-center gap-2 rounded-lg bg-background p-2">
                        <input
                          type="time"
                          value={bloque.hora_inicio}
                          onChange={(e) => actualizarBloque(dia, idx, { hora_inicio: e.target.value })}
                          className="rounded-md border border-black/10 bg-surface px-2 py-1 text-xs"
                        />
                        <span className="text-xs text-text-muted">a</span>
                        <input
                          type="time"
                          value={bloque.hora_fin}
                          onChange={(e) => actualizarBloque(dia, idx, { hora_fin: e.target.value })}
                          className="rounded-md border border-black/10 bg-surface px-2 py-1 text-xs"
                        />
                        <select
                          value={bloque.tipo}
                          onChange={(e) => actualizarBloque(dia, idx, { tipo: e.target.value as TipoBloqueHorario })}
                          className="rounded-md border border-black/10 bg-surface px-2 py-1 text-xs"
                        >
                          {(Object.keys(TIPO_LABEL) as TipoBloqueHorario[]).map((t) => (
                            <option key={t} value={t}>
                              {TIPO_LABEL[t]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => quitarBloque(dia, idx)}
                          className="ml-auto text-error hover:opacity-70"
                          aria-label="Quitar franja"
                        >
                          🗑
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-text-muted">Día no laboral.</p>
                )}
              </Card>
            ))}
          </div>

          <Card className="h-fit">
            <p className="text-sm font-bold text-primary">Parámetros de Reglas</p>
            <div className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-text-muted">Máximo de citas por día</label>
                <input
                  type="number"
                  min={0}
                  placeholder="Sin límite explícito (usa el default de la clínica)"
                  value={maxCitasDia}
                  onChange={(e) => setMaxCitasDia(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted">Duración de consulta por defecto (min)</label>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={duracionDefault}
                  onChange={(e) => setDuracionDefault(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-text-muted">Buffer entre citas (min)</label>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={bufferMinutos}
                  onChange={(e) => setBufferMinutos(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-black/10 bg-background px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={aceptaEmergencias}
                  onChange={(e) => setAceptaEmergencias(e.target.checked)}
                />
                Aceptar Citas de Emergencia
              </label>

              <Button onClick={guardar} disabled={guardando} fullWidth>
                {guardando ? "Guardando…" : "Aplicar Configuración"}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
