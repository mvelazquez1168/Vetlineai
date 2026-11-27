import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./Button";

// ---------------------------------------------------------------------
// EL PANEL DE FIRMA — con el dedo en una tablet, con el mouse en una
// computadora.
//
// DEFECTO QUE ESTE COMPONENTE EXISTE PARA CERRAR: la pantalla de
// consentimientos mandaba **un PNG fijo de 1×1 píxel transparente** como
// «firma», siempre el mismo. Todos los consentimientos del expediente
// decían «firmado» y no respaldaban nada.
//
// DECISIONES, y por qué cada una:
//
//   * **Eventos de puntero (`pointerdown`/`move`/`up`) y no de mouse ni
//     de tacto por separado.** Un solo juego de manejadores cubre dedo,
//     lápiz y mouse; dos juegos son dos comportamientos que un día
//     difieren, y en una tablet el de mouse se dispara igual y dibuja
//     doble.
//   * **`touch-action: none`.** Sin esto, en un teléfono el gesto de
//     firmar desplaza la página en lugar de dibujar: el cliente firma y
//     ve moverse la pantalla.
//   * **El lienzo se dimensiona en píxeles reales** (`devicePixelRatio`)
//     y se escala el contexto. Un canvas con ancho CSS y sin ancho de
//     mapa de bits sale borroso, y una firma borrosa es una firma que
//     no se puede comparar.
//   * **«Aceptar» no se habilita sin trazo.** Y el servidor vuelve a
//     comprobarlo: la pantalla es justamente lo que falló antes.
//   * **El lienzo se redibuja al cambiar de tamaño sin perder el
//     trazo**: girar la tablet mientras el cliente firma no puede
//     borrarle la firma.
// ---------------------------------------------------------------------

/** Lo mismo que exige el servidor, para no ofrecer lo que va a rechazar. */
const MINIMO_TINTA = 0.002;

export interface PanelFirmaProps {
  /** Se llama con el PNG en data URL cuando la persona acepta. */
  onFirmar: (dataUrl: string) => void;
  /** Alto del recuadro en píxeles CSS. */
  alto?: number;
  /** Qué se está firmando, para la ayuda de arriba. */
  etiqueta?: string;
  deshabilitado?: boolean;
}

export function PanelFirma({
  onFirmar,
  alto = 180,
  etiqueta = "Firmá acá",
  deshabilitado = false,
}: PanelFirmaProps) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [hayTrazo, setHayTrazo] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Ajusta el mapa de bits al tamaño real, conservando lo dibujado. */
  const ajustar = useCallback(() => {
    const c = lienzo.current;
    if (!c) return;
    const anchoCss = c.clientWidth;
    const altoCss = alto;
    const ratio = window.devicePixelRatio || 1;
    const nuevoAncho = Math.round(anchoCss * ratio);
    const nuevoAlto = Math.round(altoCss * ratio);
    if (c.width === nuevoAncho && c.height === nuevoAlto) return;

    // Se guarda lo que había antes de redimensionar: cambiar `width`
    // borra el lienzo, y girar la tablet no puede borrar la firma.
    const previo = c.width > 0 && c.height > 0 ? c.toDataURL("image/png") : null;
    c.width = nuevoAncho;
    c.height = nuevoAlto;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
    if (previo) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, anchoCss, altoCss);
      img.src = previo;
    }
  }, [alto]);

  useEffect(() => {
    ajustar();
    window.addEventListener("resize", ajustar);
    return () => window.removeEventListener("resize", ajustar);
  }, [ajustar]);

  const posicion = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = lienzo.current!;
    const r = c.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const empezar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (deshabilitado) return;
    e.preventDefault();
    // `setPointerCapture`: si el dedo se sale del recuadro, el trazo
    // sigue siendo del lienzo y no se corta a mitad de la firma.
    lienzo.current?.setPointerCapture(e.pointerId);
    dibujando.current = true;
    ultimo.current = posicion(e);
    setAviso(null);
  };

  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dibujando.current || deshabilitado) return;
    e.preventDefault();
    const ctx = lienzo.current?.getContext("2d");
    if (!ctx || !ultimo.current) return;
    const p = posicion(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    if (!hayTrazo) setHayTrazo(true);
  };

  const terminar = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dibujando.current = false;
    ultimo.current = null;
    lienzo.current?.releasePointerCapture?.(e.pointerId);
  };

  const borrar = () => {
    const c = lienzo.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    setHayTrazo(false);
    setAviso(null);
  };

  /** Cuánta tinta hay, con el mismo criterio del servidor. */
  const proporcionDeTinta = (): number => {
    const c = lienzo.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return 0;
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let conTinta = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) conTinta++;
    return conTinta / (c.width * c.height);
  };

  const aceptar = () => {
    const c = lienzo.current;
    if (!c) return;
    // SE COMPRUEBA ACÁ TAMBIÉN, no para confiar en la pantalla sino para
    // no mandar al servidor algo que va a rechazar: el mensaje llega
    // antes y sin ir y volver.
    if (proporcionDeTinta() < MINIMO_TINTA) {
      setAviso("El recuadro está vacío. Firmá con el dedo o con el mouse antes de aceptar.");
      setHayTrazo(false);
      return;
    }
    onFirmar(c.toDataURL("image/png"));
  };

  return (
    <div>
      <p className="mb-1 text-sm font-semibold text-text-primary">{etiqueta}</p>
      <canvas
        ref={lienzo}
        style={{ height: alto, touchAction: "none" }}
        className="w-full cursor-crosshair rounded-xl border-2 border-dashed border-black/20 bg-white"
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        onPointerCancel={terminar}
      />
      <p className="mt-1 text-xs text-text-muted">
        Con el dedo en una tablet o un teléfono, o con el mouse en la computadora.
      </p>
      {aviso && <p className="mt-1 text-xs text-error">{aviso}</p>}
      <div className="mt-3 flex items-center gap-2">
        <Button variant="secondary" onClick={borrar} disabled={deshabilitado || !hayTrazo}>
          Borrar
        </Button>
        {/* SIN TRAZO NO SE PUEDE ACEPTAR. Es la mitad de pantalla del
            defecto: la otra mitad la cierra el servidor. */}
        <Button onClick={aceptar} disabled={deshabilitado || !hayTrazo}>
          Aceptar la firma
        </Button>
      </div>
    </div>
  );
}
