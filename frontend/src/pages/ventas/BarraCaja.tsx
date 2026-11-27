import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { IndicadorPestana, PestanasDeRuta } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LAS SECCIONES DE CAJA — prompt 01c, sección 4.
//
// Existe porque cinco pantallas construidas —cuentas corrientes,
// encargos, aprobaciones, contingencia y reportes— no se podían abrir
// desde ninguna parte: estaban en el router y nada enlazaba a ellas, así
// que la única forma de llegar era escribir la URL. Una pantalla a la
// que no se llega haciendo clic no existe para quien la usa.
//
// ERA UNA FILA DE CINCO BOTONES IGUALES, que es exactamente lo que el
// prompt llama «un menú disfrazado»: cinco secciones del módulo con el
// peso visual de cinco acciones. Ahora son pestañas, y la activa se ve.
//
// Las aprobaciones NO son una pestaña más: son un indicador con
// contador, al costado. Solo las ve un administrador, que es quien puede
// resolverlas, y el contador en cero no se dibuja. Una aprobación
// pendiente detiene un cierre de caja o una anulación, y nadie va a
// entrar a mirar «por si hay».
// ---------------------------------------------------------------------

export function BarraCaja() {
  const navegar = useNavigate();
  const { esAdminClinica } = useAuth();
  const [pendientes, setPendientes] = useState(0);

  useEffect(() => {
    if (!esAdminClinica) return;
    ventasApi
      .aprobaciones()
      .then((r) => setPendientes(r.aprobaciones.filter((a) => a.estado === "pendiente").length))
      .catch(() => setPendientes(0));
  }, [esAdminClinica]);

  return (
    <PestanasDeRuta
      pestanas={[
        { a: "/ventas", etiqueta: "Caja del día", icono: "caja" },
        { a: "/ventas/cuenta-corriente", etiqueta: "Cuentas de clientes", icono: "propietario" },
        { a: "/ventas/presupuestos", etiqueta: "Presupuestos", icono: "comprobante" },
        { a: "/ventas/encargos", etiqueta: "Encargos", icono: "inventario" },
        { a: "/ventas/contingencia", etiqueta: "Contingencia", icono: "aviso" },
        { a: "/ventas/reportes", etiqueta: "Reportes", icono: "reportes" },
        // Prompt 08b: topes de descuento, motivos, denominaciones del
        // arqueo y comisiones del datáfono. Van en caja y no en la
        // administración general porque se consultan cerrando.
        { a: "/ventas/configuracion", etiqueta: "Configuración", icono: "ajustes" },
      ]}
      indicadores={
        esAdminClinica ? (
          <IndicadorPestana
            etiqueta="Aprobaciones"
            cantidad={pendientes}
            icono="aviso"
            onClick={() => navegar("/ventas/aprobaciones")}
          />
        ) : null
      }
    />
  );
}
