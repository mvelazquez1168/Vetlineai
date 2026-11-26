import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { IndicadorPestana, PestanasDeRuta } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { inventarioApi } from "../../lib/inventarioApi";

// ---------------------------------------------------------------------
// LAS SECCIONES DE INVENTARIO — prompt 01c, seccion 4.
//
// Eran NUEVE BOTONES EN FILA en el catalogo, todos con el mismo peso:
// Movimientos, Toma fisica, Kardex, Aprobaciones, Alertas, Servicios,
// Precios, Compras y Nuevo producto. Ocho de los nueve no eran acciones
// sino secciones del modulo, y el noveno —el unico que de verdad hacia
// algo en esa pantalla— se perdia entre los otros ocho.
//
// Ahora: siete pestanas, dos indicadores con contador al costado
// (Alertas y Aprobaciones, que llevan a su pantalla y dicen cuantas
// hay), y «Nuevo producto» queda como la unica accion principal del
// catalogo, en su encabezado.
//
// Las pestanas se montan en la RUTA y no dentro del catalogo: asi
// tambien estan en Kardex, en Compras y en las demas, que era de donde
// no se podia volver sin el boton de atras.
// ---------------------------------------------------------------------

export function SeccionesInventario() {
  const navegar = useNavigate();
  const { esAdminClinica } = useAuth();
  const [alertas, setAlertas] = useState(0);
  const [aprobaciones, setAprobaciones] = useState(0);

  useEffect(() => {
    inventarioApi
      .alertas()
      // Lo que de verdad hay que mirar hoy: lo que falta y lo que se
      // vence en 60 dias. Las otras listas de `alertas` (punto de
      // reorden, 30 y 90 dias) se solapan con estas dos y sumarlas
      // daria un contador inflado que nadie podria cuadrar con la
      // pantalla de Alertas.
      .then((r) => setAlertas((r.bajoMinimo?.length ?? 0) + (r.porVencer60?.length ?? 0)))
      .catch(() => setAlertas(0));
  }, []);

  useEffect(() => {
    if (!esAdminClinica) return;
    inventarioApi
      .ajustes("pendiente")
      .then((r) => setAprobaciones(r.pendientes))
      .catch(() => setAprobaciones(0));
  }, [esAdminClinica]);

  return (
    <div>
      <PestanasDeRuta
        pestanas={[
          { a: "/inventario", etiqueta: "Catálogo", icono: "inventario" },
          { a: "/inventario/movimientos", etiqueta: "Movimientos", icono: "ajustes" },
          { a: "/inventario/kardex", etiqueta: "Kardex", icono: "reportes" },
          { a: "/inventario/conteos", etiqueta: "Toma física", icono: "panel" },
          { a: "/inventario/compras", etiqueta: "Compras", icono: "caja" },
          { a: "/inventario/precios", etiqueta: "Precios", icono: "plan" },
          { a: "/inventario/servicios", etiqueta: "Servicios", icono: "clinico" },
        ]}
        indicadores={
          <>
            <IndicadorPestana
              etiqueta="Alertas"
              cantidad={alertas}
              icono="aviso"
              onClick={() => navegar("/inventario/alertas")}
            />
            {esAdminClinica && (
              <IndicadorPestana
                etiqueta="Aprobaciones"
                cantidad={aprobaciones}
                icono="aviso"
                onClick={() => navegar("/inventario/movimientos?ver=aprobaciones")}
              />
            )}
          </>
        }
      />
      <Outlet />
    </div>
  );
}
