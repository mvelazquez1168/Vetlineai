import { SinPermiso } from "../components/SinPermiso";

// La pantalla suelta de «no autorizado». Queda para el caso en que NO
// hay sesión de clínica —staff de plataforma fuera de su zona, o una
// sesión a medio resolver—: cuando sí la hay, `ProtectedRoute` dibuja
// el mismo aviso dentro del marco, sin sacar a nadie de su sistema.
export function Unauthorized() {
  return <SinPermiso />;
}
