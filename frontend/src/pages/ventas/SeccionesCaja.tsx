import { Outlet } from "react-router-dom";
import { BarraCaja } from "./BarraCaja";

// ---------------------------------------------------------------------
// EL MARCO DEL MODULO DE CAJA — prompt 01c.
//
// Las pestanas se montan UNA VEZ, en la ruta, y no dentro de cada
// pantalla: antes `BarraCaja` se dibujaba desde CajaDelDia, asi que las
// otras cinco pantallas del modulo —a las que llevaba— no la tenian, y
// desde "Encargos" no habia como volver a "Caja del dia" sin el boton
// de atras del navegador.
//
// El cobro y el tiquete NO llevan pestanas: son pantallas de trabajo
// con un solo camino de salida, y una barra de secciones ahi invita a
// irse en medio de un cobro.
// ---------------------------------------------------------------------

export function SeccionesCaja() {
  return (
    <div>
      <BarraCaja />
      <Outlet />
    </div>
  );
}
