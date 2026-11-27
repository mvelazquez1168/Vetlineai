import { LISTAS } from "../metricas/listas";
import { METRICAS } from "../metricas/diccionario";

// ---------------------------------------------------------------------
// EL DICCIONARIO PUBLICADO — prompt 12, §1.
//
//   docker compose exec -T backend npx ts-node //     src/scripts/escribir_diccionario_metricas.ts > docs/metricas/diccionario.md
//
// ESCRIBE A LA SALIDA ESTÁNDAR y no al archivo: el contenedor del
// backend solo ve `./backend`, así que un `fs.writeFileSync` apuntando a
// `docs/` crearía el archivo ADENTRO del contenedor —donde nadie lo ve y
// se pierde al recrearlo—. Redirigir desde el repo deja el archivo donde
// va, y de paso se puede revisar el diff antes de comitearlo.
//
// SE GENERA DESDE EL CÓDIGO, no se escribe a mano. El prompt pide que el
// diccionario se publique en `docs/metricas/diccionario.md` y que además
// se pueda consultar en la interfaz. Si el documento se escribiera a
// mano serían dos diccionarios: el día que una definición cambie, el
// cálculo y el documento dirían distinto y el documento ganaría la
// discusión con el contador aunque esté desactualizado.
//
// Correr esto cuando se agregue o cambie una métrica, y comitear el
// resultado.
// ---------------------------------------------------------------------

const FORMATO: Record<string, string> = {
  dinero: "colones",
  entero: "cantidad",
  porcentaje: "porcentaje",
};

const lineas: string[] = [
  "# Diccionario de métricas de Vetline Clinic",
  "",
  "**Este archivo se genera.** Sale de `backend/src/metricas/diccionario.ts` con",
  "`escribir_diccionario_metricas.ts`; no se edita a mano. Si una definición hay",
  "que cambiarla, se cambia en el código —que es lo que calcula el número— y se",
  "vuelve a generar.",
  "",
  "Cada métrica está definida **una sola vez** y el mismo cálculo alimenta la",
  "tarjeta del dashboard, el gráfico, la lista del drill-down y la exportación. La",
  "verificación que lo sostiene es una: **la suma de la lista es igual al número de",
  "la tarjeta** (`verificar_dashboards_12.ts`).",
  "",
  "La definición de cada métrica también se ve en la interfaz: el ícono de",
  "información de cada tarjeta muestra la descripción y la fórmula.",
  "",
];

for (const m of METRICAS) {
  lineas.push(`## ${m.nombre}`);
  lineas.push("");
  lineas.push(m.descripcion);
  lineas.push("");
  lineas.push(`- **Fórmula:** ${m.formula}`);
  lineas.push(`- **Se expresa en:** ${FORMATO[m.formato] ?? m.formato}`);
  lineas.push(`- **Sale de:** ${m.fuente}`);
  lineas.push(`- **No cuenta:** ${m.excluye}`);
  lineas.push(`- **Se imputa a:** ${m.imputacion}`);
  if (m.requierePermiso) lineas.push(`- **Requiere el permiso:** \`${m.requierePermiso}\``);
  if (m.drillDown) lineas.push(`- **Al tocarla se ve:** ${m.drillDown}`);
  lineas.push("");
}

lineas.push("## Las listas del drill-down");
lineas.push("");
lineas.push("| Lista | Reproduce la métrica | Suma la columna |");
lineas.push("|---|---|---|");
for (const l of LISTAS) {
  lineas.push(
    `| ${l.titulo} | ${l.metrica} | ${l.columnaSuma ?? "—, es un conteo de filas"} |`
  );
}
lineas.push("");

// A stdout, para redirigir desde el repo. El resumen va a stderr para
// que no termine dentro del documento.
process.stdout.write(lineas.join("\n"));
console.error(`${METRICAS.length} métricas y ${LISTAS.length} listas.`);
