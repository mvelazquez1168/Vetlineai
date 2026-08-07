import { useEffect, useState } from "react";
import { Badge, BadgeVariant } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Table, TableColumn } from "../../components/ui/Table";
import { formatearFecha } from "../../lib/formatFecha";
import { ClinicaResumen, platformApi } from "../../lib/platformApi";
import { platformAdminApi, RegistroAuditoria } from "../../lib/platformAdminApi";

const USUARIO_TIPO_LABEL: Record<string, string> = {
  medico: "Médico",
  admin_clinica: "Admin Clínica",
  staff_plataforma: "Staff Plataforma",
  desconocido: "—",
};

// Clínica (médico/admin_clinica) vs. staff de plataforma — la distinción
// que pide el diseño — se refleja en el color; el texto ya dice el rol
// exacto dentro de cada grupo.
const USUARIO_TIPO_BADGE: Record<string, BadgeVariant> = {
  medico: "info",
  admin_clinica: "info",
  staff_plataforma: "neutral",
  desconocido: "neutral",
};

function formatearFechaHora(fecha: string) {
  // Sin tenant activo (pantalla de plataforma) — misma zona por default
  // que el resto de Platform Admin (ver formatFecha.ts).
  return formatearFecha(fecha, undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Auditoria() {
  const [clinicas, setClinicas] = useState<ClinicaResumen[]>([]);
  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [tiposAccion, setTiposAccion] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [pagina, setPagina] = useState(1);
  const [isLoading, setIsLoading] = useState(true);

  const [tenantId, setTenantId] = useState("");
  const [tipoAccion, setTipoAccion] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");

  useEffect(() => {
    platformApi.listarClinicas().then((data) => setClinicas(data.clinicas));
  }, []);

  useEffect(() => {
    setIsLoading(true);
    platformAdminApi
      .listarAuditoria({ tenantId, tipoAccion, desde, hasta, pagina })
      .then((data) => {
        setRegistros(data.registros);
        setTotal(data.total);
        setTotalPaginas(data.totalPaginas);
        setTiposAccion(data.tiposAccion);
      })
      .finally(() => setIsLoading(false));
  }, [tenantId, tipoAccion, desde, hasta, pagina]);

  // Cualquier cambio de filtro vuelve a la página 1 — quedarse en, por
  // ejemplo, la página 8 de un filtro nuevo que solo tiene 2 páginas
  // mostraría una tabla vacía sin explicación.
  const actualizarFiltro = (setter: (v: string) => void) => (valor: string) => {
    setter(valor);
    setPagina(1);
  };

  const columns: TableColumn<RegistroAuditoria>[] = [
    {
      key: "fecha",
      header: "Fecha y hora",
      render: (r) => <span className="whitespace-nowrap text-text-muted">{formatearFechaHora(r.creado_en)}</span>,
    },
    {
      key: "usuario",
      header: "Usuario",
      render: (r) => (
        <div className="flex flex-col gap-1">
          <span className="font-semibold text-primary">{r.usuario_nombre ?? "—"}</span>
          <Badge variant={USUARIO_TIPO_BADGE[r.usuario_tipo] ?? "neutral"} className="w-fit">
            {USUARIO_TIPO_LABEL[r.usuario_tipo] ?? r.usuario_tipo}
          </Badge>
        </div>
      ),
    },
    {
      key: "clinica",
      header: "Clínica",
      render: (r) => r.tenant_nombre ?? <span className="text-text-muted">—</span>,
    },
    {
      key: "accion",
      header: "Acción",
      render: (r) => <span className="font-mono text-xs text-text-primary">{r.accion}</span>,
    },
    {
      key: "entidad",
      header: "Entidad afectada",
      render: (r) => (
        <span className="text-text-muted">
          {r.entidad}
          {r.entidad_id ? ` · ${r.entidad_id.slice(0, 8)}…` : ""}
        </span>
      ),
    },
  ];

  const desde_registro = total === 0 ? 0 : (pagina - 1) * 20 + 1;
  const hasta_registro = Math.min(pagina * 20, total);

  return (
    <div>
      <h1 className="text-2xl font-bold text-primary">Bitácora de Auditoría</h1>
      <p className="mt-1 text-text-muted">
        Registro de acciones realizadas en toda la plataforma — solo lectura.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-black/5 bg-surface p-4 sm:grid-cols-4">
        <Select
          label="Clínica"
          value={tenantId}
          onChange={(e) => actualizarFiltro(setTenantId)(e.target.value)}
          options={[
            { value: "", label: "Todas las clínicas" },
            ...clinicas.map((c) => ({ value: c.id, label: c.nombre })),
          ]}
        />
        <Select
          label="Tipo de acción"
          value={tipoAccion}
          onChange={(e) => actualizarFiltro(setTipoAccion)(e.target.value)}
          options={[
            { value: "", label: "Todas las acciones" },
            ...tiposAccion.map((t) => ({ value: t, label: t })),
          ]}
        />
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Desde</label>
          <input
            type="date"
            value={desde}
            onChange={(e) => actualizarFiltro(setDesde)(e.target.value)}
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold text-text-primary">Hasta</label>
          <input
            type="date"
            value={hasta}
            onChange={(e) => actualizarFiltro(setHasta)(e.target.value)}
            className="rounded-lg border border-black/10 bg-background px-4 py-2.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </div>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table
            columns={columns}
            data={registros}
            rowKey={(r) => r.id}
            emptyMessage="No hay registros para estos filtros."
          />
        )}
      </div>

      {total > 0 && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-text-muted">
            Mostrando {desde_registro}–{hasta_registro} de {total} registros
          </p>
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => setPagina((p) => Math.max(1, p - 1))}
              disabled={pagina <= 1}
            >
              Anterior
            </Button>
            <span className="text-sm text-text-muted">
              Página {pagina} de {totalPaginas}
            </span>
            <Button
              variant="secondary"
              onClick={() => setPagina((p) => Math.min(totalPaginas, p + 1))}
              disabled={pagina >= totalPaginas}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
