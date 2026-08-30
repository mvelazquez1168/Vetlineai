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
  const aSintesisInf = new Map<string, string>(CONCEPTOS_UNIFICADOS.map((c) => [c.informe, c.sintesis]));
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
  const choques = CONCEPTOS_UNIFICADOS.filter((c) => d.includes(c.dashboard) && i.includes(c.informe));
  const malOrigen = choques.filter((c) => ORIGEN_DE_CAMPO[c.sintesis] !== "dashboard");
  console.log("3. ANTE UN CHOQUE, GANA LA DEFINICIÓN DEL DASHBOARD");
  for (const c of choques)
    console.log(`   ${c.sintesis.padEnd(28)}${ORIGEN_DE_CAMPO[c.sintesis] === "dashboard" ? "dashboard ✓" : "INFORME ←"}   (${c.dashboard} / ${c.informe})`);
  console.log(`   incorrectos: ${malOrigen.length}`);

  // 4. Lo que NO se unifica sigue existiendo por separado.
  console.log("4. LO QUE NO SE UNIFICA SIGUE SEPARADO");
  const perdidos = NO_UNIFICAR.filter((k) => !s.includes(k));
  for (const k of NO_UNIFICAR) console.log(`   ${k.padEnd(28)}${s.includes(k) ? "presente" : "PERDIDO ←"}`);

  // 5. Qué aportó cada esquema.
  const deDash = s.filter((k) => ORIGEN_DE_CAMPO[k] === "dashboard").length;
  const deInf = s.filter((k) => ORIGEN_DE_CAMPO[k] === "informe").length;
  console.log(`\n5. COMPOSICIÓN: ${deDash} campos vienen del dashboard, ${deInf} del informe`);
  console.log(`   Campos que la síntesis suma respecto del dashboard actual: ${deInf}`);
  console.log("\n   del informe:");
  for (const k of s.filter((x) => ORIGEN_DE_CAMPO[x] === "informe")) console.log(`      ${k}`);

  const ok = !faltanD.length && !faltanI.length && !malOrigen.length && !perdidos.length;
  console.log(`\n${ok ? "[OK] la síntesis es superconjunto de las dos vistas y el dashboard manda." : "[FALLO] revisar"}`);
  process.exit(ok ? 0 : 1);
}

main();
