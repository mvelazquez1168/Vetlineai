import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  CambioDePolitica,
  clinicaApi,
  PoliticaDeLaClinica,
  RolDeLaClinica,
} from "../../lib/clinicaApi";
import { formatearFecha } from "../../lib/formatFecha";

// Fecha con hora: el historial de una política necesita la hora porque
// dos cambios del mismo día se leen al revés sin ella.
const CON_HORA: Intl.DateTimeFormatOptions = {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

// ---------------------------------------------------------------------
// LAS POLÍTICAS DE LA CLÍNICA — prompt 04, sección 2.
//
// Son las decisiones que cada clínica toma distinto: hasta qué descuento
// se da sin pedir permiso, cuánto margen mínimo se acepta, si una
// anulación necesita aprobación, cuánto puede hacer el agente por su
// cuenta.
//
// CADA VALOR DICE DE DÓNDE SALE, y eso es la mitad de la pantalla:
//
//   * «de la clínica» — lo configuraron acá;
//   * «de antes» — viene de la columna que este módulo usaba antes de
//     que existieran las políticas, y se respeta para que ninguna
//     clínica cambie de comportamiento el día del despliegue;
//   * «por omisión» — nadie lo tocó, rige el valor del producto.
//
// Sin eso, un 25 % en la pantalla no se distingue de un 25 % que alguien
// eligió, y la primera pregunta que hace un administrador es justamente
// «¿esto lo pusimos nosotros?».
// ---------------------------------------------------------------------

const NOMBRE_ORIGEN: Record<string, { texto: string; variante: "info" | "neutral" | "warning" }> = {
  clinica: { texto: "de la clínica", variante: "info" },
  columna_anterior: { texto: "de antes", variante: "warning" },
  por_omision: { texto: "por omisión", variante: "neutral" },
};

const NOMBRE_MODULO: Record<string, string> = {
  caja: "Caja y ventas",
  inventario: "Inventario",
  agenda: "Agenda",
  expediente: "Expediente",
  crm: "CRM",
  admin: "Administración",
  agente: "Agente administrativo",
};

export function Politicas() {
  const { puede, zonaHoraria } = useAuth();
  const toast = useToast();
  const [politicas, setPoliticas] = useState<PoliticaDeLaClinica[]>([]);
  const [roles, setRoles] = useState<RolDeLaClinica[]>([]);
  const [cargando, setCargando] = useState(true);
  const [borrador, setBorrador] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState<string | null>(null);
  const [historial, setHistorial] = useState<{
    clave: string;
    nombre: string;
    cambios: CambioDePolitica[];
  } | null>(null);
  const [porRol, setPorRol] = useState<PoliticaDeLaClinica | null>(null);
  const [rolElegido, setRolElegido] = useState("");
  const [valorDelRol, setValorDelRol] = useState("");

  const puedeConfigurar = puede("clinica.configurar");

  async function cargar() {
    const [p, m] = await Promise.all([clinicaApi.politicas(), clinicaApi.roles()]);
    setPoliticas(p.politicas);
    setRoles(m.roles);
  }

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        await cargar();
      } catch (err) {
        if (vivo) toast.error(err instanceof Error ? err.message : "No se pudo cargar.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function guardar(p: PoliticaDeLaClinica, valor: string, rol?: string | null) {
    setGuardando(p.clave);
    try {
      await clinicaApi.guardarPolitica(p.clave, valor, rol ?? null);
      await cargar();
      setBorrador((b) => {
        const copia = { ...b };
        delete copia[p.clave];
        return copia;
      });
      toast.exito(`«${p.nombre}» quedó en ${valor}.`);
    } catch (err) {
      // El 409 trae el rango: «no puede ser mayor que 100». Se muestra tal
      // cual, que es más útil que «valor inválido».
      toast.error(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setGuardando(null);
    }
  }

  async function verHistorial(p: PoliticaDeLaClinica) {
    try {
      const r = await clinicaApi.historialDePolitica(p.clave);
      setHistorial({ clave: p.clave, nombre: p.nombre, cambios: r.historial });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo leer el historial.");
    }
  }

  if (cargando) return <LoadingState forma="tarjetas" />;

  const modulos = [...new Set(politicas.map((p) => p.modulo))];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Políticas de la clínica"
        subtitulo="Las decisiones que cada clínica toma distinto, con su historial."
        icono="ajustes"
        modulo="admin"
      />

      {!puedeConfigurar && (
        <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
          Podés ver qué rige hoy y de dónde viene. Cambiarlo lo hace quien tenga el permiso de
          configurar la clínica.
        </p>
      )}

      {modulos.map((modulo) => (
        <section key={modulo} className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-text-muted">
            {NOMBRE_MODULO[modulo] ?? modulo}
          </h2>
          <div className="divide-y divide-black/5 rounded-xl border border-black/5 bg-surface">
            {politicas
              .filter((p) => p.modulo === modulo)
              .map((p) => {
                const origen = NOMBRE_ORIGEN[p.origen] ?? NOMBRE_ORIGEN.por_omision;
                const enEdicion = borrador[p.clave];
                const valor = enEdicion ?? p.valor;
                return (
                  <div key={p.clave} className="flex flex-wrap items-start gap-4 p-4">
                    <div className="min-w-[16rem] flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{p.nombre}</span>
                        <Badge variant={origen.variante}>{origen.texto}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">{p.descripcion}</p>
                      {p.ultimoCambio && (
                        <p className="mt-1 text-xs text-text-muted">
                          Último cambio:{" "}
                          {formatearFecha(p.ultimoCambio.cuando, zonaHoraria, CON_HORA)}
                          {p.ultimoCambio.quien ? `, por ${p.ultimoCambio.quien}` : ""}
                          {p.ultimoCambio.valor_anterior !== null &&
                            ` (antes: ${p.ultimoCambio.valor_anterior})`}
                        </p>
                      )}
                      {p.porRol.length > 0 && (
                        <ul className="mt-1 text-xs text-text-muted">
                          {p.porRol.map((v) => (
                            <li key={v.rol}>
                              {roles.find((r) => r.codigo === v.rol)?.nombre ?? v.rol}: {v.valor}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {p.tipo === "booleano" ? (
                        <Select
                          value={valor}
                          onChange={(e) =>
                            setBorrador((b) => ({ ...b, [p.clave]: e.target.value }))
                          }
                          disabled={!puedeConfigurar}
                          options={[
                            { value: "true", label: "Sí" },
                            { value: "false", label: "No" },
                          ]}
                        />
                      ) : p.tipo === "texto" ? (
                        <Input
                          value={valor}
                          onChange={(e) =>
                            setBorrador((b) => ({ ...b, [p.clave]: e.target.value }))
                          }
                          disabled={!puedeConfigurar}
                        />
                      ) : (
                        <Input
                          type="number"
                          className="w-28"
                          value={valor}
                          min={p.minimo ?? undefined}
                          max={p.maximo ?? undefined}
                          onChange={(e) =>
                            setBorrador((b) => ({ ...b, [p.clave]: e.target.value }))
                          }
                          disabled={!puedeConfigurar}
                        />
                      )}
                      {enEdicion !== undefined && enEdicion !== p.valor && (
                        <Button
                          size="sm"
                          onClick={() => guardar(p, enEdicion)}
                          disabled={guardando === p.clave}
                        >
                          Guardar
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => verHistorial(p)}>
                        Historial
                      </Button>
                      {puedeConfigurar && p.clave === "descuento.maximo_sin_autorizacion" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPorRol(p);
                            setRolElegido("");
                            setValorDelRol("");
                          }}
                        >
                          Por rol
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </section>
      ))}

      {/* --- El historial --- */}
      <Modal
        open={historial !== null}
        onClose={() => setHistorial(null)}
        title={historial ? `Historial de «${historial.nombre}»` : ""}
        description="Cada cambio queda registrado: quién, cuándo, de qué valor a qué valor. No se puede borrar ni editar."
        ancho="lg"
      >
        {historial?.cambios.length === 0 ? (
          <p className="text-sm text-text-muted">
            Nunca se cambió: rige el valor por omisión o el que el módulo usaba antes.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {historial?.cambios.map((c, i) => (
              <li key={i} className="rounded-lg border border-black/5 p-3">
                <div className="text-text">
                  {c.valor_anterior === null ? "Sin valor" : c.valor_anterior} → {c.valor_nuevo}
                  {c.rol && (
                    <Badge variant="neutral" className="ml-2">
                      {roles.find((r) => r.codigo === c.rol)?.nombre ?? c.rol}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-text-muted">
                  {formatearFecha(c.cambiado_en, zonaHoraria, CON_HORA)}
                  {c.cambiado_por_nombre ? `, por ${c.cambiado_por_nombre}` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* --- Un valor distinto para un rol --- */}
      <Modal
        open={porRol !== null}
        onClose={() => setPorRol(null)}
        title="Un tope distinto para un rol"
        description="Sirve para que la recepción descuente hasta 5 % y la caja hasta 15 %, por ejemplo. Un rol sin tope propio usa el general de la clínica."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPorRol(null)}>
              Cancelar
            </Button>
            <Button
              onClick={async () => {
                if (!porRol || !rolElegido || !valorDelRol) return;
                await guardar(porRol, valorDelRol, rolElegido);
                setPorRol(null);
              }}
              disabled={!rolElegido || !valorDelRol}
            >
              Guardar
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Select
            label="Rol"
            value={rolElegido}
            onChange={(e) => setRolElegido(e.target.value)}
            options={[
              { value: "", label: "Elegí un rol" },
              ...roles.map((r) => ({ value: r.codigo, label: r.nombre })),
            ]}
          />
          <Input
            label="Tope para ese rol (%)"
            type="number"
            value={valorDelRol}
            onChange={(e) => setValorDelRol(e.target.value)}
          />
          <p className="text-xs text-text-muted">
            Si alguien tiene dos roles con topes distintos, rige el más alto: su rol más permisivo
            manda.
          </p>
        </div>
      </Modal>
    </div>
  );
}
