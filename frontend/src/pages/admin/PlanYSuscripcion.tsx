import { PageHeader, Tabs } from "../../components/ui";
import { PlanConsumo } from "./PlanConsumo";
import { Facturacion } from "./Facturacion";

// ---------------------------------------------------------------------
// PLAN Y SUSCRIPCIÓN — punto 6 del 2026-11-27.
//
// «Plan y consumo» y «Facturación de la suscripción» eran dos opciones
// del menú y son la misma pregunta: qué se paga por Vetline y cuánto se
// está usando. Juntas, además, evitan la confusión con la facturación
// electrónica de la clínica, que es otra cosa y vive en su módulo.
// ---------------------------------------------------------------------

export function PlanYSuscripcion() {
  return (
    <div>
      <PageHeader
        titulo="Plan y suscripción"
        subtitulo="Lo que la clínica paga por Vetline, lo que lleva consumido y sus comprobantes."
        icono="plan"
        modulo="admin"
      />
      <Tabs
        pestanas={[
          { clave: "plan", etiqueta: "Plan y consumo", icono: "plan" },
          { clave: "facturacion", etiqueta: "Facturación de la suscripción", icono: "comprobante" },
        ]}
        porDefecto="plan"
      >
        {(activa) =>
          activa === "facturacion" ? <Facturacion sinEncabezado /> : <PlanConsumo sinEncabezado />
        }
      </Tabs>
    </div>
  );
}
