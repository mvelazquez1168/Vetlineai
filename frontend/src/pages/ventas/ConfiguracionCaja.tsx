import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import {
  ComisionTarjeta,
  Denominacion,
  MotivoDescuento,
  TopeDescuento,
  ventasApi,
} from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// LO QUE LA CLÍNICA CONFIGURA DE SU CAJA — prompt 08b, A2, A3 y A4.
//
// Cuatro cosas que antes no se podían tocar desde ninguna parte: hasta
// cuánto descuenta cada rol, por qué motivos, qué billetes se cuentan en
// el arqueo, y cuánto cobra el banco por cada tarjeta.
//
// ESTÁ EN CAJA Y NO EN «CLÍNICA Y USUARIOS» porque son decisiones de la
// operación del mostrador: las toma quien responde por la caja, y las
// consulta cuando está cerrando. Ponerlas en la administración general
// las dejaría a tres clics de donde se usan.
// ---------------------------------------------------------------------

export function ConfiguracionCaja() {
  const { esAdminClinica } = useAuth();
  const { mostrar } = useToast();
  const [cargando, setCargando] = useState(true);
  const [topes, setTopes] = useState<TopeDescuento[]>([]);
  const [motivos, setMotivos] = useState<MotivoDescuento[]>([]);
  const [denominaciones, setDenominaciones] = useState<Denominacion[]>([]);
  const [comisiones, setComisiones] = useState<ComisionTarjeta[]>([]);
  const [recargar, setRecargar] = useState(0);
  const [porDenominacion, setPorDenominacion] = useState(false);

  // Alta de comisión.
  const [nueva, setNueva] = useState({
    banco: "",
    tipoTarjeta: "credito",
    marca: "",
    comisionPct: "",
    comisionFija: "0",
    vigenteDesde: new Date().toISOString().slice(0, 10),
  });

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    Promise.all([
      ventasApi.topesDescuento().catch(() => ({ topes: [] })),
      ventasApi.motivosDescuento(),
      ventasApi.denominaciones(),
      ventasApi.comisionesTarjeta(),
      ventasApi.parametros(),
    ])
      .then(([t, m, d, c, p]) => {
        if (!vivo) return;
        setTopes(t.topes);
        setMotivos(m.motivos);
        setDenominaciones(d.denominaciones);
        setComisiones(c.comisiones);
        setPorDenominacion(p.parametros.arqueo_por_denominacion === true);
      })
      .catch((err) =>
        mostrar("error", err instanceof Error ? err.message : "No pudimos cargar la configuración.")
      )
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [recargar, mostrar]);

  const guardarTope = async (rol: string, topePct: string, puedeAutorizar: boolean) => {
    try {
      await ventasApi.guardarTopeDescuento({
        rol,
        // VACÍO SIGNIFICA «SIN TOPE», y es una decisión que se guarda:
        // no es lo mismo que no haber configurado nada.
        topePct: topePct.trim() === "" ? null : Number(topePct),
        puedeAutorizar,
      });
      mostrar("exito", "Tope guardado.");
      setRecargar((n) => n + 1);
    } catch (err) {
      mostrar("error", err instanceof Error ? err.message : "No pudimos guardar el tope.");
    }
  };

  const columnasComision: TableColumn<ComisionTarjeta>[] = [
    { key: "banco", header: "Banco", render: (c) => c.banco },
    { key: "tipo", header: "Tipo", render: (c) => c.tipo_tarjeta },
    { key: "marca", header: "Marca", render: (c) => c.marca ?? "cualquiera" },
    { key: "pct", header: "Comisión", render: (c) => `${Number(c.comision_pct)} %` },
    {
      key: "fija",
      header: "Fijo por transacción",
      render: (c) => (Number(c.comision_fija) > 0 ? `₡${Number(c.comision_fija)}` : "—"),
    },
    { key: "desde", header: "Rige desde", render: (c) => c.vigente_desde },
  ];

  if (cargando) return <LoadingState forma="tarjetas" cantidad={4} etiqueta="Cargando la configuración" />;

  return (
    <div className="space-y-8">
      <PageHeader
        titulo="Configuración de la caja"
        subtitulo="Topes de descuento, motivos, denominaciones del arqueo y comisiones del datáfono."
        icono="caja"
        modulo="ventas"
      />

      {!esAdminClinica && (
        <p className="rounded-lg bg-warning/10 px-4 py-3 text-sm text-warning">
          Podés mirar esta pantalla, pero guardar los cambios es de un administrador de la clínica.
        </p>
      )}

      {/* ------------------------------------------------ A3: los topes */}
      <section>
        <h2 className="text-base font-bold text-primary">Hasta cuánto puede descontar cada rol</h2>
        <p className="mt-1 text-sm text-text-muted">
          Vale el <strong>menor</strong> de tres: el del producto o servicio, el del rol, y el
          general de la clínica. Dejar el tope vacío significa «sin tope propio».
        </p>
        <div className="mt-3 space-y-2">
          {topes.length === 0 && (
            <p className="text-sm text-text-muted">
              Todavía no hay topes por rol: rige solo el general de la clínica.
            </p>
          )}
          {topes.map((t) => (
            <FilaTope key={t.id} tope={t} onGuardar={guardarTope} editable={esAdminClinica} />
          ))}
        </div>
      </section>

      {/* ---------------------------------------------- A3: los motivos */}
      <section>
        <h2 className="text-base font-bold text-primary">Por qué se da un descuento</h2>
        <p className="mt-1 text-sm text-text-muted">
          El cajero elige el motivo y el comprobante electrónico sale con el código que Hacienda
          exige. Nadie en el mostrador tiene que conocer esos códigos.
        </p>
        <ul className="mt-3 divide-y divide-black/5 rounded-xl border border-black/10 bg-surface">
          {motivos.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="text-text-primary">{m.etiqueta}</span>
              <span className="flex items-center gap-2">
                {m.exige_autorizacion && <Badge variant="warning">Siempre con autorización</Badge>}
                <span className="font-mono text-xs text-text-muted">
                  código {m.codigo_hacienda}
                  {m.codigo_hacienda_otro ? ` · «${m.codigo_hacienda_otro}»` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ----------------------------------------- A2: las denominaciones */}
      <section>
        <h2 className="text-base font-bold text-primary">Billetes y monedas del arqueo</h2>
        <p className="mt-1 text-sm text-text-muted">
          Las que trae el sistema son la emisión vigente del BCCR. La clínica puede agregar o quitar
          las que no usa: una que no recibe billetes de ₡20 000 no quiere esa línea en su planilla
          de conteo.
        </p>
        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-black/20"
            checked={porDenominacion}
            disabled={!esAdminClinica}
            onChange={async (e) => {
              setPorDenominacion(e.target.checked);
              try {
                await ventasApi.guardarParametros({ arqueoPorDenominacion: e.target.checked });
                mostrar("exito", "Guardado.");
              } catch (err) {
                mostrar("error", err instanceof Error ? err.message : "No pudimos guardarlo.");
              }
            }}
          />
          El cierre de caja abre contando por denominación
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {denominaciones.map((d) => (
            <span
              key={d.id}
              className="rounded-lg border border-black/10 bg-surface px-3 py-1 text-sm text-text-primary"
            >
              {d.moneda} {Number(d.valor).toLocaleString("es-CR")}
              <span className="ml-1 text-xs text-text-muted">
                {d.especie}
                {d.de_la_clinica ? " · propia" : ""}
              </span>
            </span>
          ))}
        </div>
      </section>

      {/* -------------------------------------------- A4: las comisiones */}
      <section>
        <h2 className="text-base font-bold text-primary">Lo que cobra el banco por cada tarjeta</h2>
        <p className="mt-1 text-sm text-text-muted">
          Es el costo financiero de cobrar con tarjeta: la clínica cobra ₡50 000 y el banco le
          deposita menos. Cada cobro guarda la comisión vigente del día, así que cambiarla acá{" "}
          <strong>no altera los cobros ya hechos</strong>.
        </p>
        <div className="mt-3">
          <Table columns={columnasComision} data={comisiones} rowKey={(c) => c.id} />
        </div>

        {esAdminClinica && (
          <div className="mt-4 grid gap-3 rounded-xl border border-black/10 bg-background p-4 sm:grid-cols-3">
            <Input
              label="Banco"
              value={nueva.banco}
              placeholder="BAC, BN, Promérica…"
              onChange={(e) => setNueva({ ...nueva, banco: e.target.value })}
            />
            <Select
              label="Tipo de tarjeta"
              value={nueva.tipoTarjeta}
              onChange={(e) => setNueva({ ...nueva, tipoTarjeta: e.target.value })}
              options={[
                { value: "credito", label: "Crédito" },
                { value: "debito", label: "Débito" },
              ]}
            />
            <Input
              label="Marca (opcional)"
              value={nueva.marca}
              placeholder="Visa, Mastercard…"
              onChange={(e) => setNueva({ ...nueva, marca: e.target.value })}
            />
            <Input
              label="Comisión %"
              value={nueva.comisionPct}
              onChange={(e) => setNueva({ ...nueva, comisionPct: e.target.value })}
            />
            <Input
              label="Fijo por transacción"
              value={nueva.comisionFija}
              onChange={(e) => setNueva({ ...nueva, comisionFija: e.target.value })}
            />
            <div>
              <label className="text-sm font-semibold text-text-primary">Rige desde</label>
              <input
                type="date"
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                value={nueva.vigenteDesde}
                onChange={(e) => setNueva({ ...nueva, vigenteDesde: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3 flex justify-end">
              <Button
                onClick={async () => {
                  try {
                    await ventasApi.crearComisionTarjeta({
                      banco: nueva.banco,
                      tipoTarjeta: nueva.tipoTarjeta,
                      marca: nueva.marca || undefined,
                      comisionPct: Number(nueva.comisionPct),
                      comisionFija: Number(nueva.comisionFija || 0),
                      vigenteDesde: nueva.vigenteDesde,
                    });
                    mostrar("exito", "Comisión guardada.");
                    setNueva({ ...nueva, banco: "", marca: "", comisionPct: "" });
                    setRecargar((n) => n + 1);
                  } catch (err) {
                    mostrar(
                      "error",
                      err instanceof Error ? err.message : "No pudimos guardar la comisión."
                    );
                  }
                }}
              >
                Agregar comisión
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function FilaTope({
  tope,
  onGuardar,
  editable,
}: {
  tope: TopeDescuento;
  onGuardar: (rol: string, topePct: string, puedeAutorizar: boolean) => void;
  editable: boolean;
}) {
  const [pct, setPct] = useState(tope.tope_pct ?? "");
  const [autoriza, setAutoriza] = useState(tope.puede_autorizar);
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-black/10 bg-surface p-3">
      <span className="min-w-28 text-sm font-semibold text-text-primary">
        {tope.rol === "admin_clinica" ? "Administrador" : tope.rol === "medico" ? "Médico" : tope.rol}
      </span>
      <Input
        label="Tope %"
        className="w-28"
        value={pct}
        placeholder="sin tope"
        disabled={!editable}
        onChange={(e) => setPct(e.target.value)}
      />
      <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-text-primary">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-black/20"
          checked={autoriza}
          disabled={!editable}
          onChange={(e) => setAutoriza(e.target.checked)}
        />
        Puede autorizar por encima del tope de otros
      </label>
      {editable && (
        <Button variant="secondary" onClick={() => onGuardar(tope.rol, String(pct), autoriza)}>
          Guardar
        </Button>
      )}
    </div>
  );
}
