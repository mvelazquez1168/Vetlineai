import { useEffect, useState } from "react";
import { Card, CardDescription, CardTitle } from "../ui";
import { ChartLinea } from "../ui/charts";
import { expedienteApi, TendenciaSigno } from "../../lib/expedienteApi";
import { formatearFechaCorta } from "../../lib/formatFecha";
import { useAuth } from "../../hooks/useAuth";

// ---------------------------------------------------------------------
// LAS TENDENCIAS DE LOS SIGNOS — anexo del 07, A1.
//
// Peso, temperatura y condición corporal a lo largo de las visitas, en
// la cabecera del expediente. El anexo pide el mismo componente de
// gráficos que usan los demás tableros, así que es `ChartLinea` y no un
// dibujo propio.
//
// DOS DECISIONES QUE NO SON DE ESTILO:
//
//   1. CON UN SOLO PUNTO NO SE DIBUJA UNA LÍNEA. Se muestra el número y
//      se dice que hace falta otra visita. Una línea de un punto se lee
//      como «viene estable», que es una afirmación que nadie midió.
//   2. CADA SIGNO EN SU GRÁFICO. Poner kilos, grados y una escala de 1 a
//      9 sobre el mismo eje haría que la temperatura se viera plana al
//      lado del peso de un San Bernardo.
//
// Si el paciente no tiene ninguna atención cerrada con signos, el
// componente no se dibuja: una tarjeta vacía que dice «sin datos» ocupa
// el mismo lugar que una con datos y no informa nada.
// ---------------------------------------------------------------------

export function TendenciaSignos({ pacienteId }: { pacienteId: string }) {
  const { zonaHoraria } = useAuth();
  const [tendencias, setTendencias] = useState<TendenciaSigno[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    expedienteApi
      .tendenciaSignos(pacienteId)
      .then((r) => vivo && setTendencias(r.tendencias))
      // Que no carguen las tendencias no puede romper la ficha: es
      // información de apoyo, no el expediente.
      .catch(() => vivo && setTendencias([]))
      .finally(() => vivo && setCargando(false));
    return () => {
      vivo = false;
    };
  }, [pacienteId]);

  if (cargando || tendencias.length === 0) return null;

  return (
    <Card>
      <CardTitle>Tendencias</CardTitle>
      <CardDescription>
        De las visitas firmadas. Una atención en borrador todavía no cuenta: el peso puede estar a
        medio escribir.
      </CardDescription>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        {tendencias.map((t) => {
          const ultimo = t.puntos[t.puntos.length - 1];
          return (
            <div key={t.signo}>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-semibold text-text-primary">{t.etiqueta}</span>
                <span className="text-sm font-bold text-text-primary">
                  {ultimo.valor}
                  <span className="ml-0.5 text-xs font-normal text-text-muted">{t.unidad}</span>
                </span>
              </div>
              {t.puntos.length >= 2 ? (
                <ChartLinea
                  alto={90}
                  conPuntos
                  etiquetas={t.puntos.map((p) => formatearFechaCorta(p.fecha, zonaHoraria))}
                  series={[{ nombre: t.etiqueta, valores: t.puntos.map((p) => p.valor) }]}
                />
              ) : (
                <p className="mt-2 text-xs text-text-muted">
                  Una sola medición: hace falta otra visita para ver una tendencia.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
