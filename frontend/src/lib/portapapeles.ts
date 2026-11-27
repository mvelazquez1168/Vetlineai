// ---------------------------------------------------------------------
// COPIAR AL PORTAPAPELES, CON SU PLAN B
//
// `navigator.clipboard` solo existe en un contexto seguro (HTTPS, o
// localhost). En producción hay HTTPS y en desarrollo es localhost, así
// que el camino normal alcanza; pero si alguien abre la interfaz por la
// IP de la red local —que es lo que pasó con `FRONTEND_URL`— el objeto
// no está, y un botón «Copiar» que no hace nada y no dice nada es peor
// que no tener el botón.
//
// Devuelve si se pudo, para que quien llama muestre el enlace a mano en
// vez de afirmar que lo copió.
// ---------------------------------------------------------------------

export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Puede fallar por permiso del navegador; se intenta el plan B.
  }

  // Plan B: un textarea fuera de la vista y el comando viejo. Está
  // obsoleto y funciona en todos los navegadores que nos importan.
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const copiado = document.execCommand("copy");
    document.body.removeChild(area);
    return copiado;
  } catch {
    return false;
  }
}
