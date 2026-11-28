import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
  Table,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { clinicaApi, PersonaDeLaClinica, RolDeLaClinica } from "../../lib/clinicaApi";
import { formatearFechaCorta } from "../../lib/formatFecha";

// ---------------------------------------------------------------------
// EL PERSONAL DE LA CLÍNICA — prompt 04, sección 1.
//
// Antes de esta pantalla el personal se administraba en `/admin/medicos`,
// que solo sabía de médicos, y el resto del equipo —recepción, caja,
// farmacia— no existía como tal: entraba con `es_admin_clinica` en true y
// podía todo lo que puede un administrador.
//
// LA PANTALLA MUESTRA ROLES, NO PERMISOS. Qué puede cada rol se ve en
// «Roles y permisos», y es a propósito: si acá se eligieran permisos uno
// por uno, cada clínica terminaría con treinta combinaciones distintas y
// nadie podría contestar «¿qué puede la recepción?».
//
// DESACTIVAR NO BORRA. La persona sigue existiendo —su firma está en
// atenciones cerradas, su nombre en movimientos de caja— y lo que se
// corta es la entrada: estado inactivo, usuario deshabilitado en Keycloak
// y sesiones cerradas. Si tiene citas futuras se avisa: alguien tiene que
// reasignarlas, no se cancelan solas.
// ---------------------------------------------------------------------

export function Personas({
  /**
   * Para dibujarla DENTRO de una pestaña (punto 6 del 2026-11-27).
   *
   * El encabezado lo pone el contenedor; repetirlo acá daría dos
   * títulos. Suelta, en su URL vieja, sigue trayendo el suyo.
   */
  sinEncabezado,
}: { sinEncabezado?: boolean } = {}) {
  const { puede, user, zonaHoraria } = useAuth();
  const toast = useToast();
  const [cargando, setCargando] = useState(true);
  const [personas, setPersonas] = useState<PersonaDeLaClinica[]>([]);
  const [roles, setRoles] = useState<RolDeLaClinica[]>([]);
  const [editando, setEditando] = useState<PersonaDeLaClinica | null>(null);
  const [elegidos, setElegidos] = useState<string[]>([]);
  const [porDesactivar, setPorDesactivar] = useState<PersonaDeLaClinica | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [recargar, setRecargar] = useState(0);

  const puedeAdministrar = puede("personas.administrar");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, m] = await Promise.all([clinicaApi.personas(), clinicaApi.roles()]);
        if (!vivo) return;
        setPersonas(p.personas);
        setRoles(m.roles);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar el personal.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [recargar]);

  function abrirRoles(persona: PersonaDeLaClinica) {
    setEditando(persona);
    setElegidos(persona.roles);
  }

  async function guardarRoles() {
    if (!editando) return;
    setTrabajando(true);
    try {
      await clinicaApi.guardarRoles(editando.id, elegidos);
      toast.exito(`Roles de ${editando.nombre} actualizados.`);
      setEditando(null);
      setRecargar((n) => n + 1);
    } catch (err) {
      // El backend contesta 409 cuando el cambio dejaría la clínica sin
      // administrador o a la persona sin ningún rol. El mensaje ya está
      // escrito para leerse: se muestra tal cual.
      toast.error(err instanceof Error ? err.message : "No se pudieron guardar los roles.");
    } finally {
      setTrabajando(false);
    }
  }

  async function desactivar() {
    if (!porDesactivar) return;
    setTrabajando(true);
    try {
      const r = await clinicaApi.desactivar(porDesactivar.id);
      toast.exito(
        r.keycloak === "deshabilitado"
          ? `${porDesactivar.nombre} ya no puede entrar.`
          : `${porDesactivar.nombre} queda inactiva en la clínica (en Keycloak: ${r.keycloak}).`
      );
      setPorDesactivar(null);
      setRecargar((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo desactivar.");
    } finally {
      setTrabajando(false);
    }
  }

  async function reactivar(persona: PersonaDeLaClinica) {
    setTrabajando(true);
    try {
      // Vuelve con el rol más básico y no con los que tenía: los roles se
      // le quitan al desactivar, y adivinar cuáles tenía hace seis meses
      // es justo lo que no se debe adivinar con permisos.
      await clinicaApi.reactivar(persona.id, ["recepcion"]);
      toast.exito(`${persona.nombre} puede entrar otra vez. Revisá sus roles.`);
      setRecargar((n) => n + 1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo reactivar.");
    } finally {
      setTrabajando(false);
    }
  }

  const nombreDeRol = (codigo: string) => roles.find((r) => r.codigo === codigo)?.nombre ?? codigo;

  if (cargando) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-6">
      {!sinEncabezado && (
        <PageHeader
          titulo="Personal de la clínica"
          subtitulo="Quién trabaja acá, con qué rol y quién ya no entra."
          icono="personas"
          modulo="admin"
        />
      )}

      {!puedeAdministrar && (
        <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
          Podés ver el equipo. Cambiar roles o desactivar a alguien lo hace quien tenga el permiso
          de administrar personas.
        </p>
      )}

      {personas.length === 0 ? (
        <EmptyState
          titulo="Todavía no hay nadie más"
          texto="Las personas entran por invitación, desde Médicos."
        />
      ) : (
        <Table<PersonaDeLaClinica>
          columns={[
            {
              key: "nombre",
              header: "Nombre",
              render: (p) => (
                <div>
                  <div className="font-medium text-text">
                    {p.nombre}
                    {p.id === user?.userId && (
                      <span className="ml-2 text-xs text-text-muted">(vos)</span>
                    )}
                  </div>
                  <div className="text-xs text-text-muted">{p.email}</div>
                </div>
              ),
            },
            {
              key: "roles",
              header: "Roles",
              render: (p) =>
                p.roles.length === 0 ? (
                  <span className="text-xs text-text-muted">sin roles</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {p.roles.map((r) => (
                      <Badge key={r} variant="neutral">
                        {nombreDeRol(r)}
                      </Badge>
                    ))}
                  </div>
                ),
            },
            {
              key: "estado",
              header: "Estado",
              render: (p) => (
                <Badge variant={p.estado === "activo" ? "success" : "neutral"}>
                  {p.estado === "activo" ? "Activa" : "Inactiva"}
                </Badge>
              ),
            },
            {
              key: "colegiatura",
              header: "Colegiatura",
              render: (p) => p.colegiatura ?? "—",
            },
            {
              key: "creado_en",
              header: "Desde",
              render: (p) => formatearFechaCorta(p.creado_en, zonaHoraria),
            },
            {
              key: "acciones",
              header: "",
              render: (p) =>
                !puedeAdministrar ? null : (
                  <div className="flex justify-end gap-2">
                    {p.estado === "activo" ? (
                      <>
                        <Button variant="secondary" size="sm" onClick={() => abrirRoles(p)}>
                          Roles
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPorDesactivar(p)}
                          disabled={p.id === user?.userId}
                          title={
                            p.id === user?.userId ? "No podés desactivarte a vos mismo." : undefined
                          }
                        >
                          Desactivar
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => reactivar(p)}
                        disabled={trabajando}
                      >
                        Reactivar
                      </Button>
                    )}
                  </div>
                ),
            },
          ]}
          data={personas}
          rowKey={(p) => p.id}
        />
      )}

      {/* --- Los roles de una persona --- */}
      <Modal
        open={editando !== null}
        onClose={() => setEditando(null)}
        title={editando ? `Roles de ${editando.nombre}` : ""}
        description="Una persona puede tener más de un rol —en una clínica chica la misma persona es caja y recepción— y lo que puede hacer es la suma de los dos."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditando(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarRoles} disabled={trabajando}>
              Guardar roles
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          {roles.map((r) => (
            <label
              key={r.codigo}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-black/5 p-3 hover:bg-background/60"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={elegidos.includes(r.codigo)}
                onChange={(e) =>
                  setElegidos((previos) =>
                    e.target.checked
                      ? [...previos, r.codigo]
                      : previos.filter((c) => c !== r.codigo)
                  )
                }
              />
              <span>
                <span className="block text-sm font-medium text-text">
                  {r.nombre}
                  {r.esClinico && (
                    <Badge variant="info" className="ml-2">
                      clínico
                    </Badge>
                  )}
                </span>
                {r.descripcion && (
                  <span className="block text-xs text-text-muted">{r.descripcion}</span>
                )}
              </span>
            </label>
          ))}
          {elegidos.includes("medico") && !editando?.colegiatura && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              El rol de médico necesita número de colegiatura. Cargalo en la ficha de la persona
              antes de darle este rol.
            </p>
          )}
        </div>
      </Modal>

      {/* --- Desactivar --- */}
      <Modal
        open={porDesactivar !== null}
        onClose={() => setPorDesactivar(null)}
        title="Desactivar a esta persona"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPorDesactivar(null)}>
              No, dejarla activa
            </Button>
            <Button variant="danger" onClick={desactivar} disabled={trabajando}>
              Desactivar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-text-muted">
            {porDesactivar?.nombre} deja de poder entrar: se le quitan los roles, se deshabilita su
            usuario y se cierran sus sesiones abiertas. Lo que ya firmó o cobró queda como está, con
            su nombre.
          </p>
          {(porDesactivar?.citas_futuras ?? 0) > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Tiene {porDesactivar?.citas_futuras} cita
              {porDesactivar?.citas_futuras === 1 ? "" : "s"} futura
              {porDesactivar?.citas_futuras === 1 ? "" : "s"}. Alguien tiene que reasignarlas: no se
              cancelan solas.
            </p>
          )}
        </div>
      </Modal>
    </div>
  );
}
