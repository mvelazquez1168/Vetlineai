import { useEffect, useState } from "react";
import { Badge } from "../ui/Badge";
import { LoadingState } from "../ui/LoadingState";
import { Table } from "../ui/Table";
import { Bloque } from "./Bloque";
import { ResumenPaciente, metricasApi } from "../../lib/metricasApi";
import { colorDeLinea, ETIQUETA_LINEA_NEGOCIO, LineaNegocio } from "../../lib/paletaDatos";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// §5 — LO QUE LE FALTABA AL RESUMEN DEL PACIENTE.
//
// La pestaña «Resumen» del expediente ya tiene la cabecera, los
// problemas, la medicación activa, la ficha racial y la curva de peso.
// Esto agrega las tres cosas que el prompt 12 pide y no estaban: el
// estado de preventivos POR TIPO, el gasto acumulado y los casos de
// Vetline Ai abiertos.
//
// LA DISTINCIÓN QUE DEFINE EL BLOQUE (guía §4.4): **«sin registro» no es
// «no vacunado»**. Que el sistema no tenga el dato no significa que el
// animal no esté protegido —puede haberse vacunado en otra clínica—, y
// mostrarlo como «no vacunado» llevaría a revacunar o a asustar al
// cliente. Por eso son cuatro estados y el color de «sin registro» es
// gris y no rojo.
// ---------------------------------------------------------------------

const colones = (n: number) =>
  new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency: "CRC",
    maximumFractionDigits: 0,
  }).format(n);

const ETIQUETA_ESTADO: Record<
  ResumenPaciente["preventivos"][number]["estado"],
  { texto: string; variante: "success" | "warning" | "error" | "neutral" }
> = {
  al_dia: { texto: "Al día", variante: "success" },
  por_vencer: { texto: "Por vencer", variante: "warning" },
  vencido: { texto: "Vencido", variante: "error" },
  // Gris, nunca rojo: no saber no es lo mismo que no estar protegido.
  sin_registro: { texto: "Sin registro", variante: "neutral" },
};

const NOMBRE_TIPO: Record<string, string> = {
  vacunacion: "Vacunación",
  desparasitacion: "Desparasitación",
};

const NOMBRE_SUBTIPO: Record<string, string> = {
  interna: "interna",
  externa: "externa",
};

function etiquetaLinea(linea: string): string {
  return (
    ETIQUETA_LINEA_NEGOCIO[linea as LineaNegocio] ??
    (linea === "sin_linea" ? "Sin línea asignada" : linea)
  );
}

export function PreventivosYGasto({ pacienteId }: { pacienteId: string }) {
  const { zonaHoraria, puede } = useAuth();
  const [datos, setDatos] = useState<ResumenPaciente | null>(null);

  useEffect(() => {
    let vivo = true;
    metricasApi
      .paciente(pacienteId)
      .then((d) => vivo && setDatos(d))
      .catch(() => vivo && setDatos(null));
    return () => {
      vivo = false;
    };
  }, [pacienteId]);

  if (!datos) return <LoadingState />;

  return (
    <div className="space-y-4">
      <Bloque
        titulo="Preventivos por tipo"
        descripcion="«Sin registro» quiere decir que la clínica no tiene el dato, no que el animal no esté protegido."
      >
        <Table
          columns={[
            {
              key: "tipo",
              header: "Tipo",
              render: (p) =>
                `${NOMBRE_TIPO[p.tipo] ?? p.tipo}${
                  p.subtipo ? ` ${NOMBRE_SUBTIPO[p.subtipo] ?? p.subtipo}` : ""
                }`,
            },
            {
              key: "estado",
              header: "Estado",
              render: (p) => (
                <span className="flex items-center gap-2">
                  <Badge variant={ETIQUETA_ESTADO[p.estado].variante}>
                    {ETIQUETA_ESTADO[p.estado].texto}
                  </Badge>
                  {/* Un registro cargado a mano cuenta como registro, y
                      se dice de dónde viene. */}
                  {p.historico && <span className="text-xs text-text-muted">cargado a mano</span>}
                </span>
              ),
            },
            {
              key: "ultima",
              header: "Última",
              render: (p) => (p.ultima ? formatearFechaCorta(p.ultima, zonaHoraria) : "—"),
            },
            {
              key: "proxima",
              header: "Próxima",
              render: (p) =>
                p.proxima
                  ? `${formatearFechaCorta(p.proxima, zonaHoraria)}${
                      p.dias !== null
                        ? p.dias < 0
                          ? ` (${Math.abs(p.dias)} días vencida)`
                          : ` (en ${p.dias} días)`
                        : ""
                    }`
                  : "—",
            },
          ]}
          data={datos.preventivos}
          rowKey={(p) => `${p.tipo}-${p.subtipo ?? ""}`}
        />
      </Bloque>

      {/* El gasto del paciente solo para quien ve dinero: la recepción y
          el médico lo necesitan, el resto no cambia nada por verlo. */}
      {puede("caja.ver") && (
        <Bloque titulo="Gasto acumulado en este paciente">
          <p className="text-2xl font-bold">{colones(datos.gastoAcumulado)}</p>
          {datos.gastoPorLinea.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {datos.gastoPorLinea.map((l) => (
                <li key={l.linea} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: colorDeLinea(l.linea) }}
                  />
                  <span className="text-text-muted">{etiquetaLinea(l.linea)}</span>
                  <span className="ml-auto font-semibold tabular-nums">{colones(l.monto)}</span>
                </li>
              ))}
            </ul>
          )}
        </Bloque>
      )}

      {datos.casosAbiertos.length > 0 && (
        <Bloque titulo="Casos de Vetline Ai abiertos">
          <ul className="space-y-2 text-sm">
            {datos.casosAbiertos.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <Badge variant="info">{c.estado}</Badge>
                <span>{c.motivo}</span>
                <span className="ml-auto text-xs text-text-muted">
                  {formatearFechaCorta(c.creado, zonaHoraria)}
                </span>
              </li>
            ))}
          </ul>
        </Bloque>
      )}
    </div>
  );
}
