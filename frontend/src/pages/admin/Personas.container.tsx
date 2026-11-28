import { PageHeader, Tabs } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { Personas } from "./Personas";
import { RolesPermisos } from "./RolesPermisos";
import { Medicos } from "./Medicos";

// ---------------------------------------------------------------------
// PERSONAS — reorganización del menú de Administración (punto 6 del
// 2026-11-27).
//
// El grupo tenía TRECE opciones y a Miguel le costó encontrar dónde
// invitar a un médico. Tres de esas trece eran la misma cosa vista
// desde lugares distintos: «Personal de la clínica» (quién trabaja
// acá), «Personal e invitaciones» (cómo entra alguien nuevo) y «Roles y
// permisos» (qué puede hacer cada uno). Son tres pestañas de una sola
// pregunta: la gente.
//
// LAS URL VIEJAS SIGUEN FUNCIONANDO y redirigen a su pestaña (ver
// App.tsx). No se rompen los enlaces de la ayuda, ni los que alguien
// tenga guardados, ni los caminos de clics del relevamiento.
// ---------------------------------------------------------------------

export function PersonasContainer() {
  const { puede } = useAuth();

  // Cada pestaña con su permiso. Quien no administra personal igual
  // entra a ver el equipo —saber quién es quién es de todos los días—,
  // pero no ve invitaciones ni roles.
  const administra = puede("personas.administrar");

  const pestanas = [
    { clave: "personal", etiqueta: "Personal", icono: "personas" as const },
    ...(administra
      ? [
          { clave: "invitaciones", etiqueta: "Invitaciones", icono: "medico" as const },
          { clave: "roles", etiqueta: "Roles y permisos", icono: "ajustes" as const },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        titulo="Personas"
        subtitulo="Quién trabaja en la clínica, cómo entra alguien nuevo y qué puede hacer cada uno."
        icono="personas"
        modulo="admin"
      />
      <Tabs pestanas={pestanas} porDefecto="personal">
        {(activa) =>
          activa === "invitaciones" ? (
            <Medicos sinEncabezado />
          ) : activa === "roles" ? (
            <RolesPermisos sinEncabezado />
          ) : (
            <Personas sinEncabezado />
          )
        }
      </Tabs>
    </div>
  );
}
