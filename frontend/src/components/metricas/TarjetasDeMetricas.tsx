import { KpiCard } from "../ui/KpiCard";
import { NombreIcono } from "../ui/Icono";
import { DefinicionMetrica, Tarjeta } from "../../lib/metricasApi";

// ---------------------------------------------------------------------
// LAS TARJETAS DE UN DASHBOARD — prompt 12, §1 y §7.
//
// Un solo componente para los cuatro dashboards. Lo que decide por cada
// métrica es tres cosas, y las tres están acá en una tabla y no
// repartidas por las pantallas:
//
//   * CÓMO SE FORMATEA el número (dinero, entero, porcentaje), que sale
//     del diccionario del backend;
//   * QUÉ SIGNIFICA QUE SUBA. Es lo que se suele hacer mal: subir es
//     bueno en ingresos y malo en inasistencias y en cargos fugados. Un
//     dashboard que pinta de verde toda flecha hacia arriba miente;
//   * A QUÉ LISTA LLEVA el clic. Sin eso, la tarjeta es un número que no
//     se puede auditar.
// ---------------------------------------------------------------------

/** Qué significa que cada indicador suba, y a qué lista lleva. */
const COMPORTAMIENTO: Record<
  string,
  {
    sentido: "subir_es_bueno" | "subir_es_malo" | "neutro";
    icono?: NombreIcono;
    modulo?: string;
    estado?: "exito" | "aviso" | "error" | "info";
    /** La clave de la lista del drill-down. Sin esto, no es clickeable. */
    lista?: string;
  }
> = {
  ingresos: { sentido: "subir_es_bueno", icono: "caja", modulo: "caja", lista: "ingresos" },
  ticket_promedio: { sentido: "subir_es_bueno", icono: "caja", modulo: "caja" },
  atenciones: { sentido: "subir_es_bueno", icono: "clinico", modulo: "pacientes", lista: "atenciones" },
  clientes_nuevos: {
    sentido: "subir_es_bueno",
    icono: "propietario",
    modulo: "pacientes",
    lista: "clientes_nuevos",
  },
  ocupacion: { sentido: "subir_es_bueno", icono: "cita", modulo: "agenda" },
  // Más inasistencias es peor. Y más deuda y más fuga, también.
  inasistencias: { sentido: "subir_es_malo", icono: "cita", modulo: "agenda", lista: "inasistencias" },
  por_cobrar: { sentido: "subir_es_malo", icono: "caja", estado: "aviso", lista: "por_cobrar" },
  cargos_fugados: {
    sentido: "subir_es_malo",
    icono: "aviso",
    modulo: "caja",
    lista: "cargos_fugados",
  },
  facturacion_atribuida: { sentido: "subir_es_bueno", icono: "caja", modulo: "caja" },
  casos_abiertos: { sentido: "neutro", icono: "agente", modulo: "ia" },
};

const NOMBRE_SUPLENTE: Record<string, string> = {
  facturacion_atribuida: "Facturación atribuida",
  casos_abiertos: "Casos de Vetline Ai abiertos",
};

export function formatearValorDeMetrica(
  valor: number | null,
  formato: DefinicionMetrica["formato"] | undefined
): string {
  if (valor === null) return "—";
  if (formato === "dinero") {
    return new Intl.NumberFormat("es-CR", {
      style: "currency",
      currency: "CRC",
      maximumFractionDigits: 0,
    }).format(valor);
  }
  if (formato === "porcentaje") return `${valor} %`;
  return new Intl.NumberFormat("es-CR", { maximumFractionDigits: 0 }).format(valor);
}

export interface TarjetasDeMetricasProps {
  tarjetas: Tarjeta[];
  diccionario: DefinicionMetrica[];
  /** Qué hacer al tocar una tarjeta con lista. */
  alAbrirLista?: (clave: string) => void;
}

export function TarjetasDeMetricas({
  tarjetas,
  diccionario,
  alAbrirLista,
}: TarjetasDeMetricasProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tarjetas.map((t) => {
        const def = diccionario.find((d) => d.clave === t.clave);
        const comp = COMPORTAMIENTO[t.clave] ?? { sentido: "neutro" as const };
        // El formato por omisión es dinero cuando la métrica no está en
        // el diccionario (las dos del médico): es lo que son.
        const formato =
          def?.formato ?? (t.clave === "casos_abiertos" ? "entero" : "dinero");
        return (
          <KpiCard
            key={t.clave}
            titulo={def?.nombre ?? NOMBRE_SUPLENTE[t.clave] ?? t.clave}
            valor={formatearValorDeMetrica(t.valor, formato)}
            variacionPorcentaje={t.variacion}
            sentido={comp.sentido}
            tendencia={t.serie?.map((p) => p.valor)}
            detalle={t.detalle}
            icono={comp.icono}
            modulo={comp.modulo}
            estado={comp.estado}
            info={
              def
                ? {
                    descripcion: def.descripcion,
                    formula: def.formula,
                    excluye: def.excluye,
                    imputacion: def.imputacion,
                  }
                : undefined
            }
            alClic={
              comp.lista && alAbrirLista ? () => alAbrirLista(comp.lista!) : undefined
            }
          />
        );
      })}
    </div>
  );
}
