import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Select } from "../../components/ui/Select";
import { Table, TableColumn } from "../../components/ui/Table";
import { AtencionReporte, Medico, ReporteAtenciones as ReporteAtencionesData, adminApi } from "../../lib/adminApi";

function formatoFechaISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function primerDiaDelMes(offsetMeses: number): Date {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + offsetMeses, 1));
}

function ultimoDiaDelMes(offsetMeses: number): Date {
  const hoy = new Date();
  return new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + offsetMeses + 1, 0));
}

function formatearFechaCorta(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-CR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatearHora(hora: string): string {
  return hora.slice(0, 5);
}

// prompt_code_reporte_atenciones — respaldo ante el colegio de médicos
// veterinarios. La cita completada es la fila principal (tiene horario);
// los casos del rango sin cita asociada van como nota aparte, nunca
// omitidos — mismo criterio que el PDF, ver reporteAtencionesPdf.ts.
//
// prompt: vincular caso↔cita — el vínculo ahora se carga desde el wizard
// "Nuevo Caso" (CasoWorkspace.tsx), así que esta sección deja de ser el
// 100% de los casos por defecto. Columnas de la tabla principal: EXACTAS
// cinco (fecha de atención, hora de inicio, hora de fin, N.º expediente,
// N.º colegiado) — sin nombre de médico ni de paciente.
export function ReporteAtenciones() {
  const [desde, setDesde] = useState(formatoFechaISO(primerDiaDelMes(0)));
  const [hasta, setHasta] = useState(formatoFechaISO(ultimoDiaDelMes(0)));
  const [medicoId, setMedicoId] = useState("");
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [datos, setDatos] = useState<ReporteAtencionesData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descargando, setDescargando] = useState(false);

  useEffect(() => {
    adminApi.listarMedicos().then((data) => setMedicos(data.medicos));
  }, []);

  const cargar = () => {
    setCargando(true);
    setError(null);
    adminApi
      .obtenerReporteAtenciones(desde, hasta, medicoId || undefined)
      .then(setDatos)
      .catch((err) => setError(err instanceof Error ? err.message : "No pudimos generar el reporte."))
      .finally(() => setCargando(false));
  };

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, medicoId]);

  const aplicarAtajo = (offsetMeses: number) => {
    setDesde(formatoFechaISO(primerDiaDelMes(offsetMeses)));
    setHasta(formatoFechaISO(ultimoDiaDelMes(offsetMeses)));
  };

  const descargarPdf = async () => {
    setDescargando(true);
    try {
      const { blob, filename } = await adminApi.descargarReporteAtencionesPdf(desde, hasta, medicoId || undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename ?? "reporte-atenciones.pdf";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pudimos generar el PDF.");
    } finally {
      setDescargando(false);
    }
  };

  const columns: TableColumn<AtencionReporte>[] = [
    { key: "fecha", header: "Fecha de atención", render: (a) => formatearFechaCorta(a.fecha) },
    { key: "inicio", header: "Hora de inicio", render: (a) => formatearHora(a.hora_inicio) },
    { key: "fin", header: "Hora de fin", render: (a) => formatearHora(a.hora_fin) },
    {
      key: "expediente",
      header: "N.º Expediente",
      render: (a) => (a.numero_expediente != null ? a.numero_expediente : "—"),
    },
    {
      key: "colegiatura",
      header: "N.º Colegiado",
      render: (a) => (
        <span className={a.colegiatura ? "" : "font-semibold text-error"}>{a.colegiatura ?? "Falta colegiatura"}</span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Reporte de Atenciones</h1>
      <p className="mt-1 text-text-muted">
        Respaldo de atenciones realizadas, listo para presentar ante el colegio de médicos veterinarios si lo
        solicita.
      </p>

      <div className="mt-6 flex flex-wrap items-end gap-4 rounded-2xl border border-black/5 bg-surface p-4">
        <Input label="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        <Input label="Hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => aplicarAtajo(0)}>
            Mes en curso
          </Button>
          <Button variant="secondary" onClick={() => aplicarAtajo(-1)}>
            Mes anterior
          </Button>
        </div>
        <Select
          label="Médico"
          value={medicoId}
          onChange={(e) => setMedicoId(e.target.value)}
          options={[{ value: "", label: "Todos los médicos" }, ...medicos.map((m) => ({ value: m.id, label: m.nombre }))]}
        />
        <Button onClick={descargarPdf} disabled={descargando || cargando} className="ml-auto">
          {descargando ? "Generando PDF…" : "Descargar PDF"}
        </Button>
      </div>

      {error && <p className="mt-4 text-sm text-error">{error}</p>}

      {cargando ? (
        <p className="mt-6 text-text-muted">Cargando…</p>
      ) : datos ? (
        <>
          <div className="mt-6">
            <Table
              columns={columns}
              data={datos.atenciones}
              rowKey={(a) => a.id}
              emptyMessage="Sin atenciones en este rango."
            />
          </div>

          <div className="mt-4 rounded-2xl border border-black/5 bg-surface p-4">
            <p className="font-semibold text-primary">Total de atenciones: {datos.totalAtenciones}</p>
            {datos.totalesPorMedico.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-text-muted">
                {datos.totalesPorMedico.map((t) => (
                  <li key={t.medicoNombre}>
                    {t.medicoNombre}: {t.total}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-8 rounded-2xl border border-error/20 bg-error/5 p-4">
            <h2 className="text-sm font-bold text-error">Casos del rango sin cita asociada</h2>
            <p className="mt-1 text-sm text-text-muted">
              No tienen ninguna cita vinculada — no cuentan con horario registrado, así que no aparecen en la tabla
              de arriba. No se omiten del reporte.
            </p>
            <p className="mt-2 text-sm">
              {datos.casosSinCita.length === 0 ? (
                <span className="text-text-muted">No hay casos sin cita en este rango.</span>
              ) : (
                <>
                  <span className="font-semibold text-text-primary">N.º de expediente: </span>
                  {datos.casosSinCita.map((c) => (c.numero_expediente != null ? c.numero_expediente : "—")).join(", ")}
                </>
              )}
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}
