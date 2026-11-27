import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PageHeader } from "../../components/ui/PageHeader";
import { Button } from "../../components/ui/Button";
import { ConsumoDeProducto } from "../../components/metricas/ConsumoDeProducto";
import { inventarioApi } from "../../lib/inventarioApi";

// La pestaña «Consumo» del producto (prompt 12, §6), como pantalla
// propia y no como modal: la trazabilidad se mira junto a alguien más
// —el proveedor al teléfono, el dueño en el mostrador— y una URL que se
// puede compartir vale más que un modal.
export function ConsumoDeProductoPagina() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [nombre, setNombre] = useState<string>("");

  useEffect(() => {
    inventarioApi
      .producto(id)
      .then((d) => setNombre(d.producto.nombre))
      .catch(() => setNombre(""));
  }, [id]);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={nombre ? `Consumo de ${nombre}` : "Consumo del producto"}
        subtitulo="En qué se fue, a qué pacientes y de qué lote"
        icono="producto"
        modulo="inventario"
        padre={{ a: "/inventario", etiqueta: "Inventario" }}
        secundarias={
          <Button variant="secondary" onClick={() => navigate(`/inventario/kardex?producto=${id}`)}>
            Ver kardex
          </Button>
        }
      />
      <ConsumoDeProducto productoId={id} />
    </div>
  );
}
