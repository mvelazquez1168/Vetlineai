import { Outlet } from "react-router-dom";
import { PestanasDeRuta } from "../../components/ui";

// ---------------------------------------------------------------------
// LAS SEIS SECCIONES DE LA AGENDA — prompt 01c.
//
// La Agenda tenia su propio marco (`AgendaLayout`), con su encabezado
// «← Volver», su propia campana y su propio «Cerrar sesion». Eso se fue
// al marco unico. LO QUE NO SE PUEDE IR son sus seis secciones: el menu
// lateral lleva a «Agenda», no a «Lista de Espera», asi que sin estas
// pestanas cinco pantallas quedaban sin camino de clic.
// ---------------------------------------------------------------------

export function SeccionesAgenda() {
  return (
    <div>
      <PestanasDeRuta
        pestanas={[
          { a: "/agenda/calendario", etiqueta: "Calendario", icono: "cita" },
          { a: "/agenda/centro-comando", etiqueta: "Centro de comando", icono: "panel" },
          { a: "/agenda/lista-espera", etiqueta: "Lista de espera", icono: "hora" },
          { a: "/agenda/horarios", etiqueta: "Horarios", icono: "clinica" },
          { a: "/agenda/analiticas", etiqueta: "Analíticas", icono: "reportes" },
          { a: "/agenda/notificaciones", etiqueta: "Notificaciones", icono: "campana" },
        ]}
      />
      <Outlet />
    </div>
  );
}
