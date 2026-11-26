import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LA BARRA DE LA CAJA: el camino a las pantallas del módulo.
//
// Existe porque cinco pantallas construidas —cuentas corrientes,
// encargos, aprobaciones, contingencia y reportes— no se podían abrir
// desde ninguna parte: estaban en el router y nada enlazaba a ellas, así
// que la única forma de llegar era escribir la URL. Una pantalla a la
// que no se llega haciendo clic no existe para quien la usa.
//
// Va en la pantalla de caja, CON Y SIN sesión abierta: los reportes y la
// cuenta corriente de un cliente se consultan justamente cuando la caja
// está cerrada.
//
// Las aprobaciones llevan su contador —y solo las ve un administrador,
// que es quien puede resolverlas—: una aprobación pendiente detiene un
// cierre de caja o una anulación, y nadie va a entrar a mirar "por si
// hay".
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
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={() => navegar("/ventas/cuenta-corriente")}>
        Cuentas de clientes
      </Button>
      <Button variant="secondary" onClick={() => navegar("/ventas/encargos")}>
        Encargos
      </Button>
      {esAdminClinica && (
        <Button variant="secondary" onClick={() => navegar("/ventas/aprobaciones")}>
          Aprobaciones
          {pendientes > 0 && (
            <span className="ml-1.5 rounded-full bg-warning px-2 py-0.5 text-xs font-semibold text-primary">
              {pendientes}
            </span>
          )}
        </Button>
      )}
      <Button variant="secondary" onClick={() => navegar("/ventas/contingencia")}>
        Contingencia
      </Button>
      <Button variant="secondary" onClick={() => navegar("/ventas/reportes")}>
        Reportes
      </Button>
    </div>
  );
}
