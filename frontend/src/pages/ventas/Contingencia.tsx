import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Input,
  Select,
  Table,
  TableColumn,
  useToast,
} from "../../components/ui";
import { CuentaListada, Provisional, ventasApi } from "../../lib/ventasApi";
import { plural } from "../../lib/plural";

// ---------------------------------------------------------------------
// CONTINGENCIA SIN INTERNET.
//
// Son DOS cosas distintas y la pantalla lo dice, porque confundirlas
// lleva a usar el talonario cuando no hace falta:
//
//   * **Hacienda caída, con internet**: no hay nada que hacer acá. El
//     facturador firma, encola y reintenta solo.
//   * **Sin internet**: ahí sí, talonario en papel y regularización
//     después.
//
// La regularización emite el comprobante con la **fecha real de la
// venta** y la referencia 05 del Anexo 4.4, "Sustituye comprobante
// provisional por contingencia".
// ---------------------------------------------------------------------

export function Contingencia() {
  const toast = useToast();
  const [provisionales, setProvisionales] = useState<Provisional[]>([]);
  const [cuentas, setCuentas] = useState<CuentaListada[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const [cantidad, setCantidad] = useState("50");

  const [reg, setReg] = useState({
    numeroProvisional: "",
    cuentaId: "",
    fechaVenta: new Date().toISOString().slice(0, 16),
    tipoComprobante: "04",
  });

  const recargar = async () => {
    const [p, c] = await Promise.all([ventasApi.provisionales(), ventasApi.cuentas("abierta")]);
    setProvisionales(p.provisionales);
    setCuentas(c.cuentas);
  };

  useEffect(() => {
    recargar().catch(() => undefined);
  }, []);

  const emitir = async () => {
    setOcupado(true);
    try {
      const r = await ventasApi.emitirTalonario(Number(cantidad) || 50);
      toast.exito(`Talonario del ${r.desde} al ${r.hasta}. Imprimilo y guardalo en la caja.`);
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const regularizar = async () => {
    setOcupado(true);
    try {
      const r = await ventasApi.regularizar({
        numeroProvisional: Number(reg.numeroProvisional),
        cuentaId: reg.cuentaId,
        fechaVenta: new Date(reg.fechaVenta).toISOString(),
        tipoComprobante: reg.tipoComprobante,
      });
      toast.exito(
        `Regularizado: comprobante ${r.consecutivo} (${r.estado}), con la referencia al provisional ${reg.numeroProvisional}.`
      );
      setReg({ ...reg, numeroProvisional: "", cuentaId: "" });
      await recargar();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const columnas: TableColumn<Provisional>[] = [
    { key: "numero", header: "N.º", render: (p) => <span className="font-mono">{p.numero}</span> },
    {
      key: "estado",
      header: "Estado",
      render: (p) => (
        <Badge variant={p.estado === "disponible" ? "neutral" : "warning"} dot>
          {p.estado}
        </Badge>
      ),
    },
    { key: "caja", header: "Caja", render: (p) => p.caja ?? "—" },
  ];

  const disponibles = provisionales.filter((p) => p.estado === "disponible").length;

  return (
    <div>
      <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
        ← Caja
      </Link>
      <h2 className="mt-2 text-xl font-bold text-primary">Contingencia</h2>

      <div className="mt-4 rounded-xl border border-black/5 bg-surface p-3 text-sm">
        <p className="font-medium text-text-primary">
          Si hay internet y Hacienda no responde, acá no hay nada que hacer.
        </p>
        <p className="text-text-muted">
          El facturador firma el comprobante, lo deja en cola y lo reintenta solo. La venta no se
          bloquea. Esta pantalla es para el otro caso: <strong>cuando no hay internet</strong> y
          hubo que usar papel.
        </p>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Talonario de provisionales</CardTitle>
          <CardDescription>
            Se emiten por adelantado y se imprimen: cuando no hay internet tampoco hay sistema para
            pedir un número, así que tienen que existir en el papel antes de que haga falta.
          </CardDescription>
          <p className="mt-3 text-sm">
            <span className="text-2xl font-bold text-primary">{disponibles}</span>{" "}
            <span className="text-text-muted">números disponibles</span>
          </p>
          <div className="mt-3 flex gap-2">
            <Input
              label="Cuántos emitir"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
            <div className="flex items-end">
              <Button disabled={ocupado} onClick={emitir}>
                Emitir e imprimir
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <Table
              columns={columnas}
              data={provisionales.slice(0, 20)}
              rowKey={(p) => p.id}
              emptyMessage="Todavía no se emitió ningún talonario."
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Regularizar una venta</CardTitle>
          <CardDescription>
            El comprobante sale con la FECHA REAL de la venta y con la referencia 05 del Anexo
            4.4, que es la que Hacienda define para sustituir un provisional por contingencia.
          </CardDescription>
          <div className="mt-3 space-y-3">
            <Input
              label="Número del provisional de papel"
              value={reg.numeroProvisional}
              onChange={(e) => setReg({ ...reg, numeroProvisional: e.target.value })}
              placeholder="3"
            />
            <Select
              label="Cuenta con los cargos de esa venta"
              value={reg.cuentaId}
              onChange={(e) => setReg({ ...reg, cuentaId: e.target.value })}
              options={[
                { value: "", label: "Elegí la cuenta" },
                ...cuentas.map((c) => ({
                  value: c.id,
                  label: `#${c.numero} ${c.cliente_nombre ?? "Cliente sin registrar"} (${plural(c.cargos, "cargo", "cargos")})`,
                })),
              ]}
            />
            <div>
              <label className="text-sm font-semibold text-text-primary">
                Fecha y hora reales de la venta
              </label>
              <input
                type="datetime-local"
                className="mt-1.5 w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm"
                value={reg.fechaVenta}
                onChange={(e) => setReg({ ...reg, fechaVenta: e.target.value })}
              />
              <p className="mt-1 text-xs text-text-muted">
                No es la de hoy: emitir con la fecha de la regularización declararía mal el período.
              </p>
            </div>
            <Select
              label="Comprobante"
              value={reg.tipoComprobante}
              onChange={(e) => setReg({ ...reg, tipoComprobante: e.target.value })}
              options={[
                { value: "04", label: "Tiquete electrónico" },
                { value: "01", label: "Factura electrónica" },
              ]}
            />
            <Button
              className="w-full"
              disabled={ocupado || !reg.numeroProvisional || !reg.cuentaId}
              onClick={regularizar}
            >
              Regularizar
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
