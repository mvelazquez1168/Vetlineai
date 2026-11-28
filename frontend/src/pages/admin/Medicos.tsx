import { PageHeader } from "../../components/ui";
import { useCambiosSinGuardar } from "../../hooks/useCambiosSinGuardar";
import { useFormularioSucio } from "../../hooks/useFormularioSucio";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card, CardTitle } from "../../components/ui/Card";
import { Input } from "../../components/ui/Input";
import { Modal } from "../../components/ui/Modal";
import { Table, TableColumn } from "../../components/ui/Table";
import { clinicaApi, RolDeLaClinica } from "../../lib/clinicaApi";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";
import { copiarAlPortapapeles } from "../../lib/portapapeles";
import {
  AccesoAgente,
  adminApi,
  ConteoCuposMedicos,
  EstadoSuscripcionResumen,
  InvitacionMedico,
  Medico,
} from "../../lib/adminApi";

export function Medicos() {
  // NUNCA SE PIERDEN DATOS AL SALIR (guia §4.7). El `ref` va en el
  // contenedor del formulario; lo marcado con `data-sin-guardar="no"`
  // —filtros y buscadores— no cuenta como cambio.
  const { ref: refSucio, hayCambios: hayCambiosSinGuardar } = useFormularioSucio();
  const { dialogo: dialogoSalida } = useCambiosSinGuardar({
    hayCambios: hayCambiosSinGuardar,
  });

  const { zonaHoraria, puede } = useAuth();
  // El enlace de alta es una credencial: solo lo ve quien administra al
  // personal, y pedirlo queda registrado (migración 170).
  const puedeAdministrarPersonas = puede("personas.administrar");
  // Lo último que se copió, para poder MOSTRARLO cuando el portapapeles
  // del navegador no está disponible. Un «Copiado» que no copió nada es
  // la peor versión de este botón.
  const [enlaceCopiado, setEnlaceCopiado] = useState<{
    id: string;
    url: string;
    copiado: boolean;
  } | null>(null);
  // La invitación que se acaba de crear, para ofrecer el enlace ahí
  // mismo. Sin esto, el único aviso de éxito era que el modal se cerrara.
  const [recienCreada, setRecienCreada] = useState<InvitacionMedico | null>(null);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [nombreClinica, setNombreClinica] = useState("");
  const [cupos, setCupos] = useState<ConteoCuposMedicos | null>(null);
  const [estadoSuscripcion, setEstadoSuscripcion] = useState<EstadoSuscripcionResumen | null>(null);
  const [invitaciones, setInvitaciones] = useState<InvitacionMedico[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [email, setEmail] = useState("");
  const [nombreInvitacion, setNombreInvitacion] = useState("");
  const [invitando, setInvitando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accionInvitacionId, setAccionInvitacionId] = useState<string | null>(null);

  const [medicoAccesos, setMedicoAccesos] = useState<Medico | null>(null);
  const [accesos, setAccesos] = useState<AccesoAgente[]>([]);
  const [cargandoAccesos, setCargandoAccesos] = useState(false);
  const [guardandoAccesos, setGuardandoAccesos] = useState(false);
  // Para la advertencia de excedente: cupos ya consumidos por OTROS
  // médicos (no cambian al togglear en este modal) + cupos incluidos y
  // precio del cupo extra del plan vigente.
  const [limitePlan, setLimitePlan] = useState<{
    cuposIncluidos: number;
    cuposUsadosPorOtros: number;
    precioCupoExtra: number;
  } | null>(null);

  const cargar = () => {
    setIsLoading(true);
    Promise.all([
      adminApi.listarMedicos(),
      adminApi.obtenerCuposMedicos(),
      adminApi.listarInvitacionesMedicos(),
      adminApi.obtenerEstadoSuscripcion(),
      adminApi.obtenerClinica(),
    ])
      .then(([medicosData, cuposData, invitacionesData, estadoSuscripcionData, clinicaData]) => {
        setMedicos(medicosData.medicos);
        setCupos(cuposData.cupos);
        setInvitaciones(invitacionesData.invitaciones);
        setEstadoSuscripcion(estadoSuscripcionData);
        setNombreClinica(clinicaData.tenant.nombre);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(cargar, []);

  const medicosFiltrados = medicos.filter((m) =>
    m.nombre.toLowerCase().includes(busqueda.toLowerCase())
  );
  const medicosActivos = medicosFiltrados.filter((m) => m.estado === "activo");
  const medicosInactivos = medicosFiltrados.filter((m) => m.estado !== "activo");

  const sinCupo = !!cupos && cupos.disponibles <= 0;
  // Ajustes de recorrido, Paso 6 — durante la prueba el camino es
  // CONTRATAR un plan (todavía no hay ninguno pago), no CAMBIAR de uno.
  const enPrueba = estadoSuscripcion?.estado === "prueba";

  // LOS ROLES DE LA INVITACIÓN (prompt 04). Arranca en médico porque
  // esta pantalla es «Médicos e invitaciones» y ese es el caso
  // frecuente; el formulario deja elegir cualquiera de los ocho, y así
  // la invitación pasa a ser el camino de alta de TODO el personal y no
  // solo de los veterinarios.
  const [rolesInvitacion, setRolesInvitacion] = useState<string[]>(["medico"]);
  const [rolesDisponibles, setRolesDisponibles] = useState<RolDeLaClinica[]>([]);

  useEffect(() => {
    clinicaApi
      .roles()
      .then((m) => setRolesDisponibles(m.roles))
      // Sin la lista, la invitación sigue siendo de médico: es el
      // comportamiento de antes del 04, no una pantalla rota.
      .catch(() => setRolesDisponibles([]));
  }, []);

  const invitaAUnMedico = rolesInvitacion.includes("medico");

  const handleInvitar = async () => {
    if (!email.trim()) return;
    setInvitando(true);
    setError(null);
    try {
      const creada = await adminApi.invitarMedico(email.trim(), nombreInvitacion, rolesInvitacion);
      setRecienCreada(creada.invitacion);
      setEnlaceCopiado(null);
      setModalAbierto(false);
      setEmail("");
      setNombreInvitacion("");
      setRolesInvitacion(["medico"]);
      cargar();
    } catch (err: any) {
      setError(err?.message ?? "No pudimos enviar la invitación.");
    } finally {
      setInvitando(false);
    }
  };

  // EL CUPO ES DE MÉDICOS. Invitar a la recepción con el cupo de
  // médicos agotado tiene que poder hacerse: no se cobra por ella.
  const sinCupoQueImporta = sinCupo && invitaAUnMedico;

  const handleCopiarEnlace = async (id: string) => {
    setAccionInvitacionId(id);
    setError(null);
    try {
      const r = await adminApi.enlaceDeInvitacion(id);
      const copiado = await copiarAlPortapapeles(r.url);
      setEnlaceCopiado({ id, url: r.url, copiado });
    } catch (err: any) {
      setError(err?.message ?? "No pudimos obtener el enlace de esa invitación.");
    } finally {
      setAccionInvitacionId(null);
    }
  };

  const handleReenviar = async (id: string) => {
    setAccionInvitacionId(id);
    try {
      await adminApi.reenviarInvitacionMedico(id);
      cargar();
    } finally {
      setAccionInvitacionId(null);
    }
  };

  const handleCancelar = async (id: string) => {
    setAccionInvitacionId(id);
    try {
      await adminApi.cancelarInvitacionMedico(id);
      cargar();
    } finally {
      setAccionInvitacionId(null);
    }
  };

  const toggleEstado = async (medico: Medico) => {
    const nuevoEstado = medico.estado === "activo" ? "inactivo" : "activo";
    await adminApi.cambiarEstadoMedico(medico.id, nuevoEstado);
    cargar();
  };

  const abrirAccesos = async (medico: Medico) => {
    setMedicoAccesos(medico);
    setCargandoAccesos(true);
    try {
      const [accesosData, usoData] = await Promise.all([
        adminApi.obtenerAccesos(medico.id),
        adminApi.obtenerUsoFacturacion(),
      ]);
      setAccesos(accesosData.accesos);
      const habilitadosOriginal = accesosData.accesos.filter((a) => a.habilitado).length;
      setLimitePlan({
        cuposIncluidos: usoData.cupos.incluidos,
        cuposUsadosPorOtros: usoData.cupos.usados - habilitadosOriginal,
        precioCupoExtra: usoData.suscripcion.plan.precioCupoExtraUsd,
      });
    } finally {
      setCargandoAccesos(false);
    }
  };

  const toggleAcceso = (agenteId: string) => {
    setAccesos((prev) =>
      prev.map((a) => (a.agenteId === agenteId ? { ...a, habilitado: !a.habilitado } : a))
    );
  };

  const guardarAccesos = async () => {
    if (!medicoAccesos) return;
    setGuardandoAccesos(true);
    try {
      await adminApi.actualizarAccesos(
        medicoAccesos.id,
        accesos.map((a) => ({ agenteId: a.agenteId, habilitado: a.habilitado }))
      );
      setMedicoAccesos(null);
      cargar();
    } finally {
      setGuardandoAccesos(false);
    }
  };

  const columnaEspecialidades: TableColumn<Medico> = {
    key: "especialidades",
    header: "Especialidades",
    render: (m) => (
      <button
        type="button"
        onClick={() => abrirAccesos(m)}
        className="flex flex-wrap gap-2 text-left"
        title="Gestionar acceso a agentes"
      >
        {m.especialidades.length === 0 && (
          <span className="text-text-muted underline decoration-dotted">
            Gestionar accesos
          </span>
        )}
        {m.especialidades.map((e) =>
          e.habilitado ? (
            <Badge key={e.agente} variant="neutral">
              {e.agente}
            </Badge>
          ) : (
            <span key={e.agente} title="Acceso deshabilitado">
              <Badge variant="neutral" className="bg-text-muted/5 text-text-muted/50">
                {e.agente}
              </Badge>
            </span>
          )
        )}
      </button>
    ),
  };

  const columnasActivos: TableColumn<Medico>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (m) => <span className="font-semibold text-primary">{m.nombre}</span>,
    },
    { key: "colegiatura", header: "Colegiatura", render: (m) => m.colegiatura ?? "—" },
    columnaEspecialidades,
    {
      key: "acciones",
      header: "Acciones",
      render: (m) => (
        <button
          onClick={() => toggleEstado(m)}
          className="text-sm font-semibold text-accent hover:underline"
        >
          Desactivar
        </button>
      ),
    },
  ];

  const columnasInactivos: TableColumn<Medico>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (m) => <span className="font-semibold text-primary">{m.nombre}</span>,
    },
    { key: "colegiatura", header: "Colegiatura", render: (m) => m.colegiatura ?? "—" },
    {
      key: "estado",
      header: "Estado",
      render: () => (
        <Badge variant="neutral" dot>
          Inactivo — acceso de lectura
        </Badge>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      render: (m) => (
        <button
          onClick={() => toggleEstado(m)}
          className="text-sm font-semibold text-accent hover:underline"
        >
          Activar
        </button>
      ),
    },
  ];

  const columnasInvitaciones: TableColumn<InvitacionMedico>[] = [
    {
      key: "nombre",
      header: "Nombre",
      render: (i) => (i.nombre ? <span className="font-semibold text-text-primary">{i.nombre}</span> : <span className="text-text-muted">—</span>),
    },
    { key: "email", header: "Correo", render: (i) => i.email },
    {
      key: "estado",
      header: "Estado",
      render: (i) =>
        i.estado === "vencida" ? (
          <Badge variant="warning" dot>Vencida</Badge>
        ) : (
          <Badge variant="info" dot>Pendiente</Badge>
        ),
    },
    { key: "creadaEn", header: "Enviada", render: (i) => formatearFechaCorta(i.creadaEn, zonaHoraria) },
    { key: "venceEn", header: "Vence", render: (i) => formatearFechaCorta(i.venceEn, zonaHoraria) },
    {
      key: "acciones",
      header: "Acciones",
      render: (i) => (
        <div className="flex gap-3">
          {/* COPIAR EL ENLACE DE ALTA. En desarrollo el correo es
              simulado y este es el ÚNICO camino para completar el alta;
              en producción resuelve el correo que cayó en spam con la
              persona sentada al lado. Solo para quien administra al
              personal, y queda registrado quién lo copió. */}
          {puedeAdministrarPersonas && (
            <button
              onClick={() => handleCopiarEnlace(i.id)}
              disabled={accionInvitacionId === i.id}
              className="text-sm font-semibold text-accent hover:underline disabled:opacity-50"
              title="Copia el enlace de alta. Es una credencial de un solo uso: queda registrado quién lo copió."
            >
              {enlaceCopiado?.id === i.id && enlaceCopiado.copiado
                ? "Enlace copiado"
                : "Copiar enlace"}
            </button>
          )}
          <button
            onClick={() => handleReenviar(i.id)}
            disabled={accionInvitacionId === i.id}
            className="text-sm font-semibold text-accent hover:underline disabled:opacity-50"
          >
            Reenviar
          </button>
          <button
            onClick={() => handleCancelar(i.id)}
            disabled={accionInvitacionId === i.id}
            className="text-sm font-semibold text-error hover:underline disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      ),
    },
  ];

  return (
    <div ref={refSucio as React.RefObject<HTMLDivElement>}>
      {dialogoSalida}
      <PageHeader
        titulo="Personal e invitaciones"
        icono="personas"
        modulo="admin"
      />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-muted">{nombreClinica}</p>
        </div>
        <Button onClick={() => setModalAbierto(true)}>+ Invitar a alguien</Button>
      </div>

      {cupos && (
        <Card className="mt-6 flex items-center justify-between">
          <div>
            <CardTitle>Cupos de médicos</CardTitle>
            <p className="mt-1 text-sm text-text-muted">
              {cupos.medicosActivos} activo{cupos.medicosActivos === 1 ? "" : "s"}
              {cupos.invitacionesPendientes > 0 &&
                ` + ${cupos.invitacionesPendientes} invitación${cupos.invitacionesPendientes === 1 ? "" : "es"} pendiente${cupos.invitacionesPendientes === 1 ? "" : "s"}`}
              {" "}de {cupos.medicosContratados} contratado{cupos.medicosContratados === 1 ? "" : "s"}
            </p>
          </div>
          <Badge variant={sinCupo ? "warning" : "success"} dot>
            {cupos.disponibles > 0 ? `${cupos.disponibles} disponible${cupos.disponibles === 1 ? "" : "s"}` : "Sin cupo"}
          </Badge>
        </Card>
      )}

      <div className="mt-6">
        <Input
          placeholder="Buscar médico…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <div className="mt-6">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
          Activos
        </h2>
        {isLoading ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <Table
            columns={columnasActivos}
            data={medicosActivos}
            rowKey={(m) => m.id}
            emptyMessage="No hay médicos activos."
          />
        )}
      </div>

      {!isLoading && invitaciones.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Invitaciones pendientes
          </h2>
          {recienCreada && !enlaceCopiado && (
            <div className="mb-3 rounded-lg border border-primary-borde bg-primary-suave p-3">
              <p className="text-sm font-semibold text-text-primary">
                Invitación enviada a {recienCreada.email}.
              </p>
              <p className="mt-1 text-sm text-text-muted">
                Si el correo no llega —o estás en desarrollo, donde el envío es simulado—, pasale
                el enlace de alta por un canal privado.
              </p>
              {puedeAdministrarPersonas && (
                <Button
                  variant="secondary"
                  className="mt-2"
                  onClick={() => handleCopiarEnlace(recienCreada.id)}
                  disabled={accionInvitacionId === recienCreada.id}
                >
                  Copiar enlace de alta
                </Button>
              )}
            </div>
          )}
          {enlaceCopiado && (
            <div className="mb-3 rounded-lg border border-primary-borde bg-primary-suave p-3">
              <p className="text-sm font-semibold text-text-primary">
                {enlaceCopiado.copiado
                  ? "Enlace copiado al portapapeles."
                  : "No se pudo copiar automáticamente — copialo de acá:"}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-text-muted">
                {enlaceCopiado.url}
              </p>
              <p className="mt-2 text-xs text-text-muted">
                Sirve una sola vez y vence. Quien lo tenga crea la cuenta con los roles de esa
                invitación, así que mandalo por un canal privado. Quedó registrado que vos lo
                copiaste.
              </p>
            </div>
          )}
          <Table
            columns={columnasInvitaciones}
            data={invitaciones}
            rowKey={(i) => i.id}
            emptyMessage="No hay invitaciones pendientes."
          />
        </div>
      )}

      {!isLoading && medicosInactivos.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text-muted">
            Inactivos
          </h2>
          <p className="mb-2 text-sm text-text-muted">
            Conservan acceso de lectura a sus casos aunque no puedan tomar casos nuevos — por
            ejemplo, tras un downgrade de plan que redujo el cupo contratado.
          </p>
          <Table
            columns={columnasInactivos}
            data={medicosInactivos}
            rowKey={(m) => m.id}
            emptyMessage="No hay médicos inactivos."
          />
        </div>
      )}

      <Modal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        title="Invitar a alguien del equipo"
        description={
          sinCupoQueImporta
            ? enPrueba
              ? "Alcanzaste el límite de médicos de la prueba. Contratá un plan para invitar a más."
              : "Alcanzaste el límite de médicos de tu plan."
            : invitaAUnMedico
              ? "Le enviamos un enlace de un solo uso para que complete su alta con nombre, colegiatura y contraseña."
              : "Le enviamos un enlace de un solo uso para que complete su alta con nombre y contraseña. Sin rol de médico no se le pide colegiatura, y no consume cupo de tu plan."
        }
        footer={
          sinCupoQueImporta ? (
            <>
              <Button variant="secondary" onClick={() => setModalAbierto(false)}>
                Cerrar
              </Button>
              <Link to="/admin/plan-consumo/cambiar-plan">
                <Button onClick={() => setModalAbierto(false)}>{enPrueba ? "Contratar un plan" : "Ver planes"}</Button>
              </Link>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setModalAbierto(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleInvitar}
                disabled={invitando || !email.trim() || rolesInvitacion.length === 0}
              >
                {invitando ? "Enviando…" : "Enviar invitación"}
              </Button>
            </>
          )
        }
      >
        {sinCupoQueImporta ? (
          <p className="text-sm text-text-muted">
            Cambiá de plan para poder invitar más médicos a tu clínica.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {rolesDisponibles.length > 0 && (
              <div>
                <p className="text-sm font-semibold text-text-primary">Con qué rol entra</p>
                <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {rolesDisponibles.map((r) => (
                    <label
                      key={r.codigo}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border border-black/5 p-2 text-sm hover:bg-black/5"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={rolesInvitacion.includes(r.codigo)}
                        onChange={(e) =>
                          setRolesInvitacion((previos) =>
                            e.target.checked
                              ? [...previos, r.codigo]
                              : previos.filter((c) => c !== r.codigo)
                          )
                        }
                      />
                      <span>
                        <span className="block font-medium text-primary">{r.nombre}</span>
                        {r.descripcion && (
                          <span className="block text-xs text-text-muted">{r.descripcion}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
                {rolesInvitacion.length === 0 && (
                  <p className="mt-1 text-xs text-error">
                    Elegí al menos un rol: sin rol, entraría y no podría hacer nada.
                  </p>
                )}
              </div>
            )}
            <Input
              label="Nombre (opcional)"
              value={nombreInvitacion}
              onChange={(e) => setNombreInvitacion(e.target.value)}
              placeholder="Para identificarla en la lista de pendientes"
            />
            <Input
              label="Correo del médico"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {error && <p className="text-sm text-error">{error}</p>}
          </div>
        )}
      </Modal>

      <Modal
        open={!!medicoAccesos}
        onClose={() => setMedicoAccesos(null)}
        title="Gestionar acceso a agentes"
        description={medicoAccesos ? `${medicoAccesos.nombre} — agentes habilitados para la clínica.` : ""}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMedicoAccesos(null)}>
              Cancelar
            </Button>
            <Button onClick={guardarAccesos} disabled={guardandoAccesos || cargandoAccesos}>
              {guardandoAccesos ? "Guardando…" : "Guardar"}
            </Button>
          </>
        }
      >
        {cargandoAccesos ? (
          <p className="text-text-muted">Cargando…</p>
        ) : (
          <div className="flex flex-col gap-1">
            {(() => {
              if (!limitePlan) return null;
              const cuposActivos = accesos.filter((a) => a.habilitado).length;
              const cuposProyectados = limitePlan.cuposUsadosPorOtros + cuposActivos;
              const excedente = cuposProyectados - limitePlan.cuposIncluidos;
              if (excedente <= 0) return null;
              return (
                <div className="mb-3 rounded-lg bg-warning/15 px-4 py-3 text-sm font-semibold text-warning">
                  ⚠ Esto excede tu plan actual — se facturará $
                  {(excedente * limitePlan.precioCupoExtra).toFixed(2)} adicional por{" "}
                  {excedente} cupo{excedente === 1 ? "" : "s"} extra.
                </div>
              );
            })()}
            {accesos.length === 0 && (
              <p className="text-sm text-text-muted">
                Esta clínica todavía no tiene agentes habilitados.
              </p>
            )}
            {accesos.map((a) => (
              <label
                key={a.agenteId}
                className="flex items-center justify-between gap-4 border-b border-black/5 py-3 last:border-0"
              >
                <div>
                  <p className="text-sm font-semibold text-text-primary">{a.agenteNombre}</p>
                  <p className="text-xs text-text-muted">
                    {a.rol === "especialista"
                      ? "Especialista asignado"
                      : a.habilitado
                        ? "Acceso general"
                        : "Sin acceso"}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={a.habilitado}
                  onChange={() => toggleAcceso(a.agenteId)}
                  className="h-5 w-9 shrink-0 appearance-none rounded-full bg-black/10 transition-colors checked:bg-accent relative cursor-pointer before:absolute before:left-0.5 before:top-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition-transform checked:before:translate-x-4"
                />
              </label>
            ))}
            <p className="mt-4 text-xs text-text-muted">
              Deshabilitar el acceso oculta el agente del selector del médico, sin borrar su
              historial de casos ya creados. "Especialista asignado" se mantiene como referencia
              incluso si el acceso está deshabilitado.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
