import { Component, type ErrorInfo, type ReactNode } from "react";
import { apiFetch } from "../../lib/api";
import { Button } from "./Button";
import { Card } from "./Card";
import { Icono } from "./Icono";

// ---------------------------------------------------------------------
// LA PANTALLA EN BLANCO NO ES UNA OPCIÓN — defecto del 2026-11-27.
//
// Un hook detrás de un `return` condicional en `AtencionActual.tsx` hizo
// que React abortara el árbol entero: la ficha del paciente quedaba en
// blanco, sin un mensaje, y el único rastro estaba en la consola del
// navegador. En una clínica eso es «el sistema no abre», con un cliente
// esperando en el mostrador.
//
// Ahora hay dos niveles:
//   * uno en el marco (`AppShell`), que salva el menú y la navegación:
//     si una pantalla explota, se puede ir a otra;
//   * uno por pestaña del expediente, que salva las demás pestañas: si
//     «Atención actual» falla, Vacunas y Laboratorio siguen abriéndose.
//
// POR QUÉ ES UNA CLASE y no un hook: React solo ofrece
// `componentDidCatch` en componentes de clase. No hay equivalente con
// hooks, y no se arregla con un try/catch alrededor del render.
//
// LO QUE NO HACE: no reintenta solo. Un error de render que se repite
// entraría en bucle, y la persona que está en el mostrador necesita
// decidir —reintentar, o irse a otra pantalla—, no mirar un parpadeo.
// ---------------------------------------------------------------------

interface Props {
  children: ReactNode;
  /** Qué parte es, para el registro: «pestaña vacunas», «pantalla». */
  ambito?: string;
  /** Texto propio cuando el genérico no alcanza. */
  titulo?: string;
}

interface Estado {
  error: Error | null;
  /** Cambia al reintentar: remonta el subárbol entero. */
  intento: number;
}

// Tope por carga de página: un componente que explota en cada render
// mandaría miles de filas. El tope vive acá —no en el servidor— porque
// lo que hay que cortar es el envío, no la fila.
let reportados = 0;
const TOPE_DE_REPORTES = 3;

export class LimiteDeError extends Component<Props, Estado> {
  state: Estado = { error: null, intento: 0 };

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Siempre a la consola, primero: funciona aunque no haya red, y es
    // lo que alguien va a copiar si avisa en el momento.
    console.error(`[interfaz] ${this.props.ambito ?? "pantalla"}:`, error, info.componentStack);

    if (reportados >= TOPE_DE_REPORTES) return;
    reportados += 1;

    void apiFetch("/errores-cliente", {
      method: "POST",
      body: JSON.stringify({
        pantalla: typeof window !== "undefined" ? window.location.pathname : "",
        ambito: this.props.ambito ?? null,
        mensaje: error.message,
        pila: error.stack ?? null,
        pilaReact: info.componentStack ?? null,
      }),
      // Que no se pueda registrar el error no puede tirar otro error.
    }).catch(() => undefined);
  }

  private reintentar = (): void => {
    this.setState((s) => ({ error: null, intento: s.intento + 1 }));
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) {
      // La `key` es lo que hace que «Reintentar» sirva: sin remontar, el
      // subárbol vuelve con el mismo estado roto y falla de nuevo igual.
      return <div key={this.state.intento}>{this.props.children}</div>;
    }

    return (
      <Card className="mt-4">
        <div className="flex items-start gap-3">
          <Icono nombre="aviso" className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-text-primary">
              {this.props.titulo ?? "Esta parte no se pudo mostrar"}
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              Algo falló al dibujar{this.props.ambito ? ` ${this.props.ambito}` : " esta pantalla"}.
              Lo que ya estaba guardado está guardado: esto es un problema de la pantalla, no de
              los datos. Quedó registrado para que lo corrijamos.
            </p>
            <p className="mt-2 break-words font-mono text-xs text-text-muted">{error.message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={this.reintentar}>Reintentar</Button>
              <Button variant="secondary" onClick={() => window.location.reload()}>
                Recargar la página
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }
}
