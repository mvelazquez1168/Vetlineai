import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";

// prompt_code_menu_colapsable — mecanismo compartido por los tres paneles
// con menú lateral (AdminLayout, PlatformAdminLayout y la lista de casos
// de CasoWorkspace, que cumple el mismo rol de "menú que se come la
// pantalla" en un teléfono aunque su contenido no sea una lista de links
// a otras rutas). No hay un solo componente de layout compartido entre
// los tres — cada uno arma su propio <aside> con contenido distinto — así
// que lo que se comparte es este hook, no el markup.
//
// Se cierra solo al cambiar de ruta: cualquier click en un link de adentro
// (un item del menú, o un caso de la lista) ya navega, así que no hace
// falta un onClick individual en cada uno — un solo efecto sobre la ruta
// cubre los tres casos por igual.
export function useMenuColapsable() {
  const [abierto, setAbierto] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setAbierto(false);
  }, [location.pathname]);

  return {
    abierto,
    alternar: () => setAbierto((a) => !a),
    cerrar: () => setAbierto(false),
  };
}
