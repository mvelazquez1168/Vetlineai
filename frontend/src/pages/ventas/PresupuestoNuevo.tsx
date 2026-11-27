import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Button,
  Input,
  PageHeader,
  Select,
  useToast,
} from "../../components/ui";
import { inventarioApi } from "../../lib/inventarioApi";
import { formatearMonto, MotivoDescuento, ventasApi } from "../../lib/ventasApi";
import { workspaceApi } from "../../lib/workspaceApi";

// ---------------------------------------------------------------------
// ARMAR UN PRESUPUESTO — prompt 08b, A1.
//
// Tres entradas al mismo formulario: desde la lista de presupuestos,
// desde la ficha del cliente y desde la consulta (con `?cliente=` y
// `?paciente=`, y `?atencion=` cuando lo cotiza el médico). El
// presupuesto queda ligado a la atención en ese último caso, que es el
// caso típico del prompt.
//
// EL DESCUENTO SE AUTORIZA ACÁ y no al convertir: es el momento en que
// se decide cobrar menos, con el cliente discutiendo el precio. Lo
// explica el módulo del backend y la migración 135.
// ---------------------------------------------------------------------

interface LineaEnPantalla {
  tipo: "servicio" | "producto" | "libre";
  servicioId: string;
  presentacionId: string;
  descripcion: string;
  cantidad: string;
  precio: string;
  descuento: string;
  motivoDescuentoId: string;
  nota: string;
}

const LINEA_VACIA: LineaEnPantalla = {
  tipo: "servicio",
  servicioId: "",
  presentacionId: "",
  descripcion: "",
  cantidad: "1",
  precio: "",
  descuento: "0",
  motivoDescuentoId: "",
  nota: "",
};

export function PresupuestoNuevo() {
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const { mostrar } = useToast();

  const [clienteId, setClienteId] = useState(params.get("cliente") ?? "");
  const [pacienteId, setPacienteId] = useState(params.get("paciente") ?? "");
  const atencionId = params.get("atencion") ?? "";
  const [busqueda, setBusqueda] = useState("");
  const [clientes, setClientes] = useState<Array<{ id: string; nombre: string }>>([]);
  const [pacientes, setPacientes] = useState<Array<{ id: string; nombre: string }>>([]);
  const [observaciones, setObservaciones] = useState("");
  const [vigencia, setVigencia] = useState("");
  const [lineas, setLineas] = useState<LineaEnPantalla[]>([{ ...LINEA_VACIA }]);
  const [servicios, setServicios] = useState<Array<{ id: string; nombre: string; precio: string }>>([]);
  // Los productos se BUSCAN, igual que en el cobro: no hay un endpoint
  // de «todas las presentaciones de venta» y traer el catálogo entero a
  // una pantalla de cotización sería peor que buscar.
  const [buscaProducto, setBuscaProducto] = useState<Record<number, string>>({});
  const [resultados, setResultados] = useState<Record<number, Array<{ id: string; nombre: string }>>>({});
  const [presentacionesDe, setPresentacionesDe] = useState<
    Record<number, Array<{ id: string; nombre: string; precio_venta: string | null }>>
  >({});
  const [motivos, setMotivos] = useState<MotivoDescuento[]>([]);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    inventarioApi
      .servicios()
      .then((r) => setServicios(r.servicios as typeof servicios))
      .catch(() => setServicios([]));
    ventasApi
      .motivosDescuento()
      .then((r) => setMotivos(r.motivos))
      .catch(() => setMotivos([]));
  }, []);

  // El typeahead de clientes, con la misma espera de 250 ms del resto.
  useEffect(() => {
    if (busqueda.trim().length < 2) return;
    let vivo = true;
    const t = setTimeout(() => {
      workspaceApi
        .buscarPropietarios(busqueda.trim())
        .then((r) => vivo && setClientes(r.propietarios.map((p) => ({ id: p.id, nombre: p.nombre }))))
        .catch(() => vivo && setClientes([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(t);
    };
  }, [busqueda]);

  useEffect(() => {
    if (!clienteId) {
      setPacientes([]);
      return;
    }
    workspaceApi
      .listarPacientesDePropietario(clienteId)
      .then((r) => setPacientes(r.pacientes.map((p) => ({ id: p.id, nombre: p.nombre }))))
      .catch(() => setPacientes([]));
  }, [clienteId]);

  const cambiar = (i: number, cambios: Partial<LineaEnPantalla>) =>
    setLineas((xs) => xs.map((x, j) => (j === i ? { ...x, ...cambios } : x)));

  const totalLinea = (l: LineaEnPantalla) =>
    (Number(l.precio.replace(",", ".")) || 0) * (Number(l.cantidad.replace(",", ".")) || 0) -
    (Number(l.descuento.replace(",", ".")) || 0);
  const total = lineas.reduce((t, l) => t + totalLinea(l), 0);

  const guardar = async () => {
    const utiles = lineas.filter(
      (l) =>
        (l.tipo === "servicio" && l.servicioId) ||
        (l.tipo === "producto" && l.presentacionId) ||
        (l.tipo === "libre" && l.descripcion.trim())
    );
    if (utiles.length === 0) {
      mostrar("aviso", "Un presupuesto necesita al menos una línea.");
      return;
    }
    setOcupado(true);
    try {
      const r = await ventasApi.crearPresupuesto({
        propietarioId: clienteId || undefined,
        pacienteId: pacienteId || undefined,
        atencionId: atencionId || undefined,
        observaciones: observaciones.trim() || undefined,
        vigenciaDias: vigencia ? Number(vigencia) : undefined,
        lineas: utiles.map((l) => ({
          servicioId: l.tipo === "servicio" ? l.servicioId : undefined,
          presentacionId: l.tipo === "producto" ? l.presentacionId : undefined,
          descripcion: l.descripcion.trim() || undefined,
          cantidad: Number(l.cantidad.replace(",", ".")) || 1,
          // Sin precio escrito, el backend lo saca del catálogo con la
          // lista de precios vigente: es el mismo precio que se va a
          // cobrar, y escribirlo acá a mano sería adivinarlo.
          precioUnitario: l.precio.trim() ? Number(l.precio.replace(",", ".")) : undefined,
          descuento: Number(l.descuento.replace(",", ".")) || undefined,
          motivoDescuentoId: l.motivoDescuentoId || undefined,
          nota: l.nota.trim() || undefined,
        })),
      });
      mostrar("exito", `Presupuesto N.º ${r.numero} creado.`);
      navegar(`/ventas/presupuestos/${r.id}`);
    } catch (err) {
      mostrar("error", err instanceof Error ? err.message : "No pudimos crear el presupuesto.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Nuevo presupuesto"
        subtitulo="Lo que se cotiza queda con su precio congelado durante la vigencia. No afecta el inventario hasta que se convierte."
        icono="comprobante"
        modulo="ventas"
        accion={
          <Button disabled={ocupado} onClick={guardar}>
            {ocupado ? "Guardando…" : "Crear el presupuesto"}
          </Button>
        }
      />

      <div className="grid gap-4 rounded-2xl border border-black/10 bg-surface p-4 sm:grid-cols-3">
        {clienteId ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Cliente</p>
            <p className="mt-1 text-sm text-text-primary">
              {clientes.find((c) => c.id === clienteId)?.nombre ?? "Cliente elegido"}
            </p>
            <button
              type="button"
              className="mt-1 text-xs text-primary underline"
              onClick={() => {
                setClienteId("");
                setPacienteId("");
              }}
            >
              Cambiar
            </button>
          </div>
        ) : (
          <div>
            <Input
              label="Cliente"
              value={busqueda}
              placeholder="Buscar por nombre o teléfono"
              onChange={(e) => setBusqueda(e.target.value)}
            />
            {clientes.length > 0 && (
              <ul className="mt-1 divide-y divide-black/5 rounded-lg border border-black/10">
                {clientes.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left text-sm hover:bg-background"
                      onClick={() => setClienteId(c.id)}
                    >
                      {c.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <Select
          label="Paciente (opcional)"
          value={pacienteId}
          disabled={!clienteId}
          onChange={(e) => setPacienteId(e.target.value)}
          options={[
            { value: "", label: "Sin paciente" },
            ...pacientes.map((p) => ({ value: p.id, label: p.nombre })),
          ]}
        />
        <Input
          label="Vigencia en días (opcional)"
          value={vigencia}
          placeholder="La de la clínica"
          onChange={(e) => setVigencia(e.target.value)}
        />
      </div>

      <div className="space-y-3">
        {lineas.map((l, i) => (
          <div key={i} className="rounded-2xl border border-black/10 bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-4">
              <Select
                label="Qué se cotiza"
                value={l.tipo}
                onChange={(e) =>
                  cambiar(i, {
                    tipo: e.target.value as LineaEnPantalla["tipo"],
                    servicioId: "",
                    presentacionId: "",
                    precio: "",
                  })
                }
                options={[
                  { value: "servicio", label: "Un servicio" },
                  { value: "producto", label: "Un producto" },
                  { value: "libre", label: "Texto libre" },
                ]}
              />
              {l.tipo === "servicio" && (
                <Select
                  label="Servicio"
                  className="sm:col-span-2"
                  value={l.servicioId}
                  onChange={(e) => {
                    const s = servicios.find((x) => x.id === e.target.value);
                    cambiar(i, {
                      servicioId: e.target.value,
                      precio: s ? String(Number(s.precio)) : "",
                    });
                  }}
                  options={[
                    { value: "", label: "Elegir…" },
                    ...servicios.map((s) => ({
                      value: s.id,
                      label: `${s.nombre} — ${formatearMonto(s.precio)}`,
                    })),
                  ]}
                />
              )}
              {l.tipo === "producto" && (
                <div className="sm:col-span-2">
                  {(presentacionesDe[i] ?? []).length === 0 ? (
                    <>
                      <Input
                        label="Producto"
                        value={buscaProducto[i] ?? ""}
                        placeholder="Buscar por nombre o código"
                        onChange={async (e) => {
                          const q = e.target.value;
                          setBuscaProducto((b) => ({ ...b, [i]: q }));
                          if (q.trim().length < 2) {
                            setResultados((r) => ({ ...r, [i]: [] }));
                            return;
                          }
                          try {
                            const r = await inventarioApi.productos({ q: q.trim() });
                            setResultados((xs) => ({
                              ...xs,
                              [i]: r.productos.slice(0, 6).map((x) => ({ id: x.id, nombre: x.nombre })),
                            }));
                          } catch {
                            setResultados((xs) => ({ ...xs, [i]: [] }));
                          }
                        }}
                      />
                      {(resultados[i] ?? []).length > 0 && (
                        <ul className="mt-1 divide-y divide-black/5 rounded-lg border border-black/10">
                          {(resultados[i] ?? []).map((prod) => (
                            <li key={prod.id}>
                              <button
                                type="button"
                                className="w-full px-3 py-2 text-left text-sm hover:bg-background"
                                onClick={async () => {
                                  try {
                                    const d = await inventarioApi.producto(prod.id);
                                    setPresentacionesDe((xs) => ({
                                      ...xs,
                                      [i]: (d.presentaciones ?? []).map((pr) => ({
                                        id: pr.id,
                                        nombre: pr.nombre,
                                        precio_venta:
                                          (pr as { precio_venta?: string | null }).precio_venta ?? null,
                                      })),
                                    }));
                                    setResultados((xs) => ({ ...xs, [i]: [] }));
                                    cambiar(i, { descripcion: prod.nombre });
                                  } catch (err) {
                                    mostrar(
                                      "error",
                                      err instanceof Error ? err.message : "No pudimos leer el producto."
                                    );
                                  }
                                }}
                              >
                                {prod.nombre}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  ) : (
                    <Select
                      label="Presentación"
                      value={l.presentacionId}
                      onChange={(e) => {
                        const pr = (presentacionesDe[i] ?? []).find((x) => x.id === e.target.value);
                        cambiar(i, {
                          presentacionId: e.target.value,
                          precio: pr?.precio_venta ? String(Number(pr.precio_venta)) : "",
                        });
                      }}
                      options={[
                        { value: "", label: "Elegir la presentación…" },
                        ...(presentacionesDe[i] ?? []).map((pr) => ({
                          value: pr.id,
                          label: `${pr.nombre}${pr.precio_venta ? ` — ${formatearMonto(pr.precio_venta)}` : ""}`,
                        })),
                      ]}
                    />
                  )}
                </div>
              )}
              {l.tipo === "libre" && (
                <Input
                  label="Concepto"
                  className="sm:col-span-2"
                  value={l.descripcion}
                  onChange={(e) => cambiar(i, { descripcion: e.target.value })}
                />
              )}
              <Input
                label="Cantidad"
                value={l.cantidad}
                inputMode="decimal"
                onChange={(e) => cambiar(i, { cantidad: e.target.value })}
              />
              <Input
                label="Precio unitario"
                value={l.precio}
                inputMode="decimal"
                placeholder="El del catálogo"
                onChange={(e) => cambiar(i, { precio: e.target.value })}
              />
              <Input
                label="Descuento"
                value={l.descuento}
                inputMode="decimal"
                onChange={(e) => cambiar(i, { descuento: e.target.value })}
              />
              {Number(l.descuento.replace(",", ".")) > 0 && (
                <Select
                  label="Motivo del descuento"
                  value={l.motivoDescuentoId}
                  onChange={(e) => cambiar(i, { motivoDescuentoId: e.target.value })}
                  options={[
                    { value: "", label: "Elegir el motivo…" },
                    ...motivos.map((m) => ({ value: m.id, label: m.etiqueta })),
                  ]}
                />
              )}
              <Input
                label="Nota de la línea (opcional)"
                className="sm:col-span-2"
                value={l.nota}
                placeholder="Incluye anestesia y el control a los ocho días"
                onChange={(e) => cambiar(i, { nota: e.target.value })}
              />
              <div className="flex items-end justify-between sm:col-span-2">
                <span className="text-sm font-semibold text-text-primary">
                  {formatearMonto(totalLinea(l))}
                </span>
                {lineas.length > 1 && (
                  <button
                    type="button"
                    className="text-xs text-error underline"
                    onClick={() => setLineas((xs) => xs.filter((_, j) => j !== i))}
                  >
                    Quitar la línea
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
        <Button variant="secondary" onClick={() => setLineas((xs) => [...xs, { ...LINEA_VACIA }])}>
          + Agregar línea
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-black/10 bg-surface p-4">
        <Input
          label="Observaciones del presupuesto"
          value={observaciones}
          placeholder="Incluye el control a los ocho días. No incluye el collar isabelino."
          onChange={(e) => setObservaciones(e.target.value)}
        />
        <p className="text-right text-lg font-bold text-primary">
          Total cotizado: {formatearMonto(total)}
        </p>
      </div>
    </div>
  );
}
