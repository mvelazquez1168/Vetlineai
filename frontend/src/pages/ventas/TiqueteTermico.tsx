import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button, LoadingState, useToast } from "../../components/ui";
import { formatearMonto, ventasApi } from "../../lib/ventasApi";

// ---------------------------------------------------------------------
// TIQUETE DE CAJA para impresora térmica de 80 mm.
//
// Se imprime DESDE EL NAVEGADOR con una hoja de estilos de impresión
// dedicada, no generando un PDF. El motivo es práctico: una térmica de
// 80 mm imprime lo que el navegador le manda a 80 mm de ancho sin
// márgenes, y un PDF de media carta en una térmica sale cortado o
// diminuto. Con `@page { size: 80mm auto }` el navegador hace lo
// correcto y el cajero no configura nada.
//
// `@media print` esconde todo lo que no es el tiquete —el menú, los
// botones, el encabezado de la aplicación— para que el papel no salga
// con la interfaz impresa.
//
// QUÉ DICE lo decide el servidor (`datosDeTiquete`), no esta pantalla:
// si lo armara el navegador, una reimpresión podría decir algo
// distinto del original.
// ---------------------------------------------------------------------

const ESTILOS_IMPRESION = `
@media print {
  @page { size: 80mm auto; margin: 0; }
  body * { visibility: hidden; }
  #tiquete, #tiquete * { visibility: visible; }
  #tiquete {
    position: absolute; left: 0; top: 0;
    width: 80mm; padding: 4mm 3mm;
    font-family: "Courier New", monospace; font-size: 10pt; color: #000;
    background: #fff;
  }
  .no-imprimir { display: none !important; }
}
`;

export function TiqueteTermico() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [datos, setDatos] = useState<Awaited<ReturnType<typeof ventasApi.tiquete>> | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    ventasApi
      .tiquete(id)
      .then(setDatos)
      .catch((err) => toast.error(err.message))
      .finally(() => setCargando(false));
  }, [id]);

  if (cargando) return <LoadingState forma="tarjetas" cantidad={1} />;
  if (!datos) return <p className="text-sm text-text-muted">No se pudo cargar el tiquete.</p>;

  const c = datos.cobro as Record<string, string | number | null>;
  const linea = "-".repeat(42);

  return (
    <div>
      <style>{ESTILOS_IMPRESION}</style>

      <div className="no-imprimir">
        <Link to="/ventas" className="text-sm text-text-muted hover:text-primary">
          ← Caja
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <h2 className="text-xl font-bold text-primary">Tiquete de caja</h2>
          <Button onClick={() => window.print()}>Imprimir</Button>
        </div>
        <p className="mt-1 text-sm text-text-muted">
          Sale a 80 mm. Cualquier tiquete se puede reimprimir desde acá, y dice lo mismo que el
          original porque el contenido lo arma el servidor.
        </p>
      </div>

      {/* El tiquete. En pantalla se ve con el mismo ancho que en papel. */}
      <div
        id="tiquete"
        className="mx-auto mt-6 w-[320px] border border-black/10 bg-white p-4 font-mono text-[11px] leading-tight text-black"
      >
        <div className="text-center">
          <p className="text-[13px] font-bold">{String(c.emisor_nombre ?? c.clinica ?? "")}</p>
          <p>Céd. {String(c.emisor_identificacion ?? "")}</p>
          {c.ubicacion_otras_senas && <p>{String(c.ubicacion_otras_senas)}</p>}
          {c.telefono_numero && <p>Tel. {String(c.telefono_numero)}</p>}
          {c.emisor_correo && <p>{String(c.emisor_correo)}</p>}
        </div>

        <p className="mt-2">{linea}</p>
        <div className="flex justify-between">
          <span>Caja</span>
          <span>{String(c.caja ?? "")}</span>
        </div>
        <div className="flex justify-between">
          <span>Cajero</span>
          <span>{String(c.cajero ?? "—")}</span>
        </div>
        <div className="flex justify-between">
          <span>Fecha</span>
          <span>{new Date(String(c.creado_en)).toLocaleString("es-CR")}</span>
        </div>
        {c.cuenta_numero !== null && (
          <div className="flex justify-between">
            <span>Cuenta</span>
            <span>#{String(c.cuenta_numero)}</span>
          </div>
        )}
        {c.cliente_nombre && (
          <div className="flex justify-between">
            <span>Cliente</span>
            <span>{String(c.cliente_nombre)}</span>
          </div>
        )}

        <p className="mt-2">{linea}</p>
        {datos.lineas.map((l, i) => {
          const cant = Number(l.cantidad);
          const precio = Number(l.precio_unitario);
          const desc = Number(l.descuento ?? 0);
          return (
            <div key={i} className="mt-1">
              <p>{String(l.descripcion)}</p>
              <div className="flex justify-between">
                <span>
                  {cant} x {formatearMonto(precio)}
                  {desc > 0 ? ` −${formatearMonto(desc)}` : ""}
                </span>
                <span>{formatearMonto(cant * precio - desc)}</span>
              </div>
            </div>
          );
        })}

        <p className="mt-2">{linea}</p>
        {c.total_venta_neta !== null && c.total_venta_neta !== undefined && (
          <div className="flex justify-between">
            <span>Venta neta</span>
            <span>{formatearMonto(String(c.total_venta_neta))}</span>
          </div>
        )}
        {Number(c.total_descuentos ?? 0) > 0 && (
          <div className="flex justify-between">
            <span>Descuentos</span>
            <span>−{formatearMonto(String(c.total_descuentos))}</span>
          </div>
        )}
        {c.total_impuesto !== null && c.total_impuesto !== undefined && (
          <div className="flex justify-between">
            <span>Impuesto</span>
            <span>{formatearMonto(String(c.total_impuesto))}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between text-[13px] font-bold">
          <span>TOTAL</span>
          <span>{formatearMonto(String(c.total))}</span>
        </div>

        <p className="mt-2">{linea}</p>
        {datos.medios.map((m, i) => (
          <div key={i}>
            <div className="flex justify-between">
              <span>{String(m.medio_nombre ?? m.medio)}</span>
              <span>
                {formatearMonto(String(m.monto), String(m.moneda))}
                {m.moneda !== "CRC" && ` = ${formatearMonto(String(m.monto_crc))}`}
              </span>
            </div>
            {m.referencia && <p className="text-[10px]">Ref. {String(m.referencia)}</p>}
          </div>
        ))}
        {Number(c.vuelto_crc ?? 0) > 0 && (
          <div className="mt-1 flex justify-between font-bold">
            <span>VUELTO</span>
            <span>{formatearMonto(String(c.vuelto_crc))}</span>
          </div>
        )}

        {c.clave && (
          <>
            <p className="mt-2">{linea}</p>
            <p className="text-center text-[10px]">Comprobante electrónico</p>
            <p className="text-center text-[10px]">{String(c.consecutivo)}</p>
            <p className="break-all text-center text-[9px]">{String(c.clave)}</p>
            {/* LA MONEDA DE EMISIÓN, cuando no es la de la caja. El
                tiquete está todo en colones —es lo que entró al cajón—,
                pero el comprobante puede estar emitido en dólares, y el
                cliente que lo va a consultar en el portal de Hacienda
                tiene que poder reconocer el monto que va a ver ahí. */}
            {c.moneda_comprobante && String(c.moneda_comprobante) !== "CRC" && (
              <p className="mt-1 text-center text-[9px]">
                Emitido en {String(c.moneda_comprobante)} por{" "}
                {formatearMonto(String(c.total_comprobante), String(c.moneda_comprobante))} · tipo
                de cambio {formatearMonto(String(c.tipo_cambio))}
              </p>
            )}
            <p className="mt-1 text-center text-[9px]">
              {String(c.estado_comprobante) === "aceptado"
                ? "Aceptado por Hacienda"
                : `Estado: ${String(c.estado_comprobante ?? "")}`}
            </p>
            {/* El QR lo genera el facturador en su PDF. Acá va la clave
                en texto, que es lo que la consulta pública necesita:
                dibujar un QR distinto del que ya existe sería tener dos
                formas del mismo dato. */}
            <p className="mt-1 text-center text-[9px]">
              Consultá el comprobante con esta clave en el portal de Hacienda.
            </p>
          </>
        )}

        <p className="mt-2 text-center">¡Gracias!</p>
      </div>
    </div>
  );
}
