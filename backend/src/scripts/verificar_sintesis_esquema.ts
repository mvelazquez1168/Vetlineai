import { DASHBOARD_TOOL, INFORME_TOOL } from "../herramientasAgente";
import { SINTESIS_TOOL, ORIGEN_DE_CAMPO, CONCEPTOS_UNIFICADOS, RENOMBRES, NO_UNIFICAR } from "../sintesisClinica";

// La restricción del Paso 2 no se declara: se comprueba. Ningún campo de
// ninguna de las dos vistas puede quedar sin lugar en la síntesis, y la
// definición que gana ante un choque tiene que ser la del dashboard.

const props = (t: any) => Object.keys(t.input_schema.properties);
const IGNORAR = ["meta", "tipo_reporte"];

function main() {
  const d = props(DASHBOARD_TOOL).filter((k) => !IGNORAR.includes(k));
  const i = props(INFORME_TOOL).filter((k) => !IGNORAR.includes(k));
  const s = props(SINTESIS_TOOL).filter((k) => !IGNORAR.includes(k));

  const aSintesisDash = new Map<string, string>(CONCEPTOS_UNIFICADOS.map((c) => [c.dashboard, c.sintesis]));
  const aSintesisInf = new Map<string, string>(
    CONCEPTOS_UNIFICADOS.filter((c) => c.informe).map((c) => [c.informe!, c.sintesis])
  );
  for (const r of RENOMBRES) {
    if (r.dashboard) aSintesisDash.set(r.dashboard, r.sintesis);
    if (r.informe) aSintesisInf.set(r.informe, r.sintesis);
  }

  console.log(`SÍNTESIS: ${s.length} campos de raíz  (dashboard ${d.length} · informe ${i.length})\n`);

  const faltanD = d.filter((k) => !s.includes(aSintesisDash.get(k) ?? k));
  const faltanI = i.filter((k) => !s.includes(aSintesisInf.get(k) ?? k));

  console.log("1. NINGÚN CAMPO DEL DASHBOARD SE PIERDE");
  console.log(`   faltantes: ${faltanD.length}${faltanD.length ? " ← " + faltanD.join(", ") : ""}`);
  console.log("2. NINGÚN CAMPO DEL INFORME SE PIERDE");
  console.log(`   faltantes: ${faltanI.length}${faltanI.length ? " ← " + faltanI.join(", ") : ""}`);

  // 3. Ante un choque, gana la definición del dashboard.
  const choques = CONCEPTOS_UNIFICADOS.filter((c) => !!c.informe && d.includes(c.dashboard) && i.includes(c.informe));
  const malOrigen = choques.filter((c) => ORIGEN_DE_CAMPO[c.sintesis] !== "dashboard");
  console.log("3. ANTE UN CHOQUE, GANA LA DEFINICIÓN DEL DASHBOARD");
  for (const c of choques)
    console.log(`   ${c.sintesis.padEnd(28)}${ORIGEN_DE_CAMPO[c.sintesis] === "dashboard" ? "dashboard ✓" : "INFORME ←"}   (${c.dashboard} / ${c.informe})`);
  console.log(`   incorrectos: ${malOrigen.length}`);

  // 4. Lo que NO se unifica sigue existiendo por separado.
  console.log("4. LO QUE NO SE UNIFICA SIGUE SEPARADO");
  const perdidos = NO_UNIFICAR.filter((k) => !s.includes(k));
  for (const k of NO_UNIFICAR) console.log(`   ${k.padEnd(28)}${s.includes(k) ? "presente" : "PERDIDO ←"}`);

  // 4b. Un concepto unificado tiene que tener la MISMA FORMA en las dos
  // vistas, no solo el mismo tema.
  //
  // Esta comprobación faltaba, y su ausencia dejó pasar D-005: la síntesis
  // adoptaba el `array` del dashboard para un campo que el informe define
  // como `string`, y al proyectar el informe reventaba con
  // `texto.split is not a function`. Los puntos 1 a 4 pasaban en verde
  // porque miran PRESENCIA de campos, no compatibilidad de tipos — el
  // verificador medía algo más estrecho de lo que su mensaje final decía.
  //
  // Un choque de tipos acá no es un detalle de tipado: significa que dos
  // cosas distintas se emparejaron por tema, y que una de las dos vistas va
  // a recibir algo que no sabe mostrar.
  const tipoDe = (t: any, k: string) => {
    const v = (t.input_schema.properties as any)[k];
    if (!v) return "(ausente)";
    return (Array.isArray(v.type) ? [...v.type].sort() : [v.type]).join("|");
  };
  console.log("4b. UN CONCEPTO UNIFICADO TIENE LA MISMA FORMA EN LAS DOS VISTAS");
  const conInforme = CONCEPTOS_UNIFICADOS.filter((c) => c.informe);
  const choquesDeTipo = conInforme.filter(
    (c) => tipoDe(DASHBOARD_TOOL, c.dashboard) !== tipoDe(INFORME_TOOL, c.informe!)
  );
  for (const c of conInforme) {
    const td = tipoDe(DASHBOARD_TOOL, c.dashboard);
    const ti = tipoDe(INFORME_TOOL, c.informe!);
    console.log(
      `   ${c.sintesis.padEnd(28)}${td === ti ? `${td} = ${ti}  ✓` : `${td} ≠ ${ti}  ← INCOMPATIBLES`}`
    );
  }
  console.log(`   incompatibles: ${choquesDeTipo.length}`);

  // 5. Qué aportó cada esquema.
  const deDash = s.filter((k) => ORIGEN_DE_CAMPO[k] === "dashboard").length;
  const deInf = s.filter((k) => ORIGEN_DE_CAMPO[k] === "informe").length;
  console.log(`\n5. COMPOSICIÓN: ${deDash} campos vienen del dashboard, ${deInf} del informe`);
  console.log(`   Campos que la síntesis suma respecto del dashboard actual: ${deInf}`);
  console.log("\n   del informe:");
  for (const k of s.filter((x) => ORIGEN_DE_CAMPO[x] === "informe")) console.log(`      ${k}`);

  const ok =
    !faltanD.length && !faltanI.length && !malOrigen.length && !perdidos.length && !choquesDeTipo.length;
  console.log(`\n${ok ? "[OK] la síntesis es superconjunto de las dos vistas y el dashboard manda." : "[FALLO] revisar"}`);
  process.exit(ok ? 0 : 1);
}

main();
