// El tema por clínica y su contraste (prompt 01c, sección 2).
//
//   docker compose exec backend npx ts-node src/scripts/verificar_tema_por_clinica.ts
//
// Lo que el prompt exige y acá se mide:
//
//   * de UN color primario se derivan todos los tonos; no se le piden
//     cinco colores al usuario;
//   * el sistema verifica el primario contra el texto blanco con WCAG AA
//     (4,5:1) y, si no cumple, lo oscurece LO JUSTO;
//   * lo mismo para el texto oscuro sobre el fondo suave;
//   * **ninguna combinación puede producir texto ilegible** — y eso no
//     se prueba con tres colores elegidos a mano, se prueba barriendo
//     todo el espacio de color;
//   * la apariencia de una clínica no afecta a otra;
//   * sin configuración, la clínica recibe «Marca de la clínica» con el
//     primario por defecto.
import { pool } from "../db";
import { conAlcanceTenant } from "../alcanceTenant";
import { apariencia, guardarApariencia, restablecerApariencia } from "../apariencia";
import { PRIMARIO_POR_DEFECTO, aRgb, calcularTema, contraste, variablesCss } from "../tema";
import { exigirEntornoDeDesarrollo } from "./guardaDesarrollo";

const PREFIJO = "probe-tema";
const AA = 4.5;

let ok = true;
function assert(cond: boolean, msg: string, detalle?: unknown) {
  console.log(`[${cond ? "OK" : "FALLO"}] ${msg}`, detalle ?? "");
  if (!cond) ok = false;
}
function igual(obtenido: unknown, esperado: unknown, msg: string) {
  const mismo = JSON.stringify(obtenido) === JSON.stringify(esperado);
  assert(mismo, msg, mismo ? `= ${JSON.stringify(obtenido)}` : { obtenido, esperado });
}

async function main() {
  exigirEntornoDeDesarrollo("verificar_tema_por_clinica");
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);

  // -------------------------------------------------------------------
  console.log("=== 1. De un color salen todos los tonos ===");
  const teal = calcularTema(PRIMARIO_POR_DEFECTO);
  assert(
    !!teal.primarioHover && !!teal.primarioSuave && !!teal.primarioOscuro && !!teal.primarioBorde,
    "el primario por defecto deriva hover, suave, oscuro y borde",
    {
      primario: teal.primario,
      hover: teal.primarioHover,
      suave: teal.primarioSuave,
      oscuro: teal.primarioOscuro,
    }
  );
  igual(teal.ajustado, false, "y no hace falta ajustarlo: el teal del prompt ya cumple AA");
  assert(
    teal.contrasteConBlanco >= AA,
    "su contraste con el texto blanco cumple AA",
    teal.contrasteConBlanco
  );
  igual(teal.sobrePrimario, "#FFFFFF", "así que el texto encima es blanco");

  // -------------------------------------------------------------------
  console.log("\n=== 2. Los dos colores extremos del prompt ===");
  // Un amarillo muy claro: con texto blanco es ilegible. El criterio es
  // NO destruir la marca oscureciéndolo hasta marrón: el texto encima
  // pasa a casi negro.
  const amarillo = calcularTema("#FFF9C4");
  igual(
    amarillo.sobrePrimario,
    "#121E36",
    "un amarillo muy claro se respeta y el texto encima pasa a casi negro"
  );
  assert(
    contraste(aRgb(amarillo.primario), aRgb(amarillo.sobrePrimario)) >= AA,
    "y esa combinación cumple AA",
    Math.round(contraste(aRgb(amarillo.primario), aRgb(amarillo.sobrePrimario)) * 100) / 100
  );

  // Un casi negro: cumple de sobra con blanco y no se toca.
  const casiNegro = calcularTema("#0A0A0A");
  igual(
    [casiNegro.ajustado, casiNegro.sobrePrimario],
    [false, "#FFFFFF"],
    "un casi negro no se ajusta y lleva texto blanco"
  );

  // UN CELESTE MEDIO (#4A90D9, el `accent` de hoy) no cumple con texto
  // blanco (3,34) pero SÍ con texto oscuro: la regla 2 lo respeta tal
  // cual y le pone texto oscuro encima. El color de la clínica no se
  // toca cuando no hace falta.
  const celeste = calcularTema("#4A90D9");
  igual(
    [celeste.ajustado, celeste.sobrePrimario],
    [false, "#121E36"],
    "un celeste medio NO se toca: cumple con texto oscuro, y ese se usa"
  );
  assert(
    contraste(aRgb(celeste.primario), aRgb(celeste.sobrePrimario)) >= AA,
    "y ese par cumple AA",
    Math.round(contraste(aRgb(celeste.primario), aRgb(celeste.sobrePrimario)) * 100) / 100
  );

  // EL TERCER CASO: un color que no se lee NI con blanco NI con oscuro.
  // Hay 399 así en el barrido de 4 096. Ahí sí hay que mover el color, y
  // se mueve lo menos posible.
  const medio = calcularTema("#0077DD");
  assert(
    medio.ajustado && medio.primarioElegido !== medio.primario,
    "un tono medio que no se lee con ninguno de los dos SÍ se ajusta",
    { elegido: medio.primarioElegido, usado: medio.primario, contraste: medio.contrasteConBlanco }
  );
  assert(
    contraste(aRgb(medio.primario), aRgb(medio.sobrePrimario)) >= AA,
    "y después del ajuste cumple AA",
    Math.round(contraste(aRgb(medio.primario), aRgb(medio.sobrePrimario)) * 100) / 100
  );
  assert(
    Math.abs(aRgb(medio.primario).b - aRgb(medio.primarioElegido).b) < 40,
    "«lo justo»: el color se mueve poco, no salta a otro color",
    { elegido: medio.primarioElegido, usado: medio.primario }
  );

  // -------------------------------------------------------------------
  console.log("\n=== 3. NINGUNA combinación produce texto ilegible ===");
  //
  // No se prueba con tres colores: se barre el espacio de color. 4 096
  // combinaciones (16 pasos por canal) y se exige AA en los dos pares
  // que el prompt nombra: el texto sobre el primario, y el texto oscuro
  // sobre el fondo suave.
  let probados = 0;
  const fallan: string[] = [];
  for (let r = 0; r < 256; r += 17) {
    for (let g = 0; g < 256; g += 17) {
      for (let b = 0; b < 256; b += 17) {
        const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
        const t = calcularTema(hex);
        probados += 1;
        const sobre = contraste(aRgb(t.primario), aRgb(t.sobrePrimario));
        const enSuave = contraste(aRgb(t.primarioOscuro), aRgb(t.primarioSuave));
        if (sobre < AA || enSuave < AA) {
          fallan.push(
            `${hex} -> sobre=${sobre.toFixed(2)} enSuave=${enSuave.toFixed(2)} (usado ${t.primario})`
          );
        }
      }
    }
  }
  assert(
    fallan.length === 0,
    `${probados} colores barridos y todos legibles en los dos pares`,
    fallan.slice(0, 5)
  );

  // -------------------------------------------------------------------
  console.log("\n=== 4. Las variables CSS que recibe el navegador ===");
  const vars = variablesCss(teal);
  igual(
    Object.keys(vars).sort(),
    [
      "--color-primary",
      "--color-primary-borde",
      "--color-primary-hover",
      "--color-primary-oscuro",
      "--color-primary-suave",
      "--color-sobre-primary",
    ],
    "son seis, y todas del primario: el resto del tema no se toca"
  );
  assert(
    Object.values(vars).every((v) => /^\d{1,3} \d{1,3} \d{1,3}$/.test(v)),
    "y vienen como «R G B», que es lo que necesita Tailwind para aplicar opacidad",
    vars["--color-primary"]
  );

  // -------------------------------------------------------------------
  console.log("\n=== 5. Sin configuración, el tema de fábrica ===");
  const unaClinica = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','probe@tema.test','CR') RETURNING id`,
      [`${PREFIJO}-clinica`]
    )
  ).rows[0].id;
  const otraClinica = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenants (nombre, estado_suscripcion, email, pais_codigo)
       VALUES ($1,'activa','otra@tema.test','CR') RETURNING id`,
      [`${PREFIJO}-otra`]
    )
  ).rows[0].id;

  const sinConfigurar = await conAlcanceTenant(unaClinica, (db) => apariencia(db, unaClinica));
  igual(
    [sinConfigurar.primario, sinConfigurar.tema],
    [PRIMARIO_POR_DEFECTO, "marca"],
    "una clínica sin fila recibe «marca» con el primario por defecto"
  );
  igual(sinConfigurar.logoUrl, null, "y sin logo, para que la interfaz muestre el ícono");

  // -------------------------------------------------------------------
  console.log("\n=== 6. La apariencia de una clínica no afecta a otra ===");
  await conAlcanceTenant(unaClinica, (db) =>
    guardarApariencia(db, unaClinica, { primario: "#B91C1C", tema: "vibrante" })
  );
  const laPrimera = await conAlcanceTenant(unaClinica, (db) => apariencia(db, unaClinica));
  const laOtra = await conAlcanceTenant(otraClinica, (db) => apariencia(db, otraClinica));
  igual(
    [laPrimera.primario, laPrimera.tema],
    ["#B91C1C", "vibrante"],
    "la primera quedó con su rojo y su tema vibrante"
  );
  igual(
    [laOtra.primario, laOtra.tema],
    [PRIMARIO_POR_DEFECTO, "marca"],
    "y la otra sigue con el de fábrica: una no pisa a la otra"
  );

  const ajena = await conAlcanceTenant(otraClinica, (db) =>
    db.query<{ n: string }>(`SELECT count(*) AS n FROM clinica_apariencia`)
  );
  igual(ajena.rows[0].n, "0", "y desde la otra clínica, RLS no deja ver ni una fila");

  // -------------------------------------------------------------------
  console.log("\n=== 7. Un tema inventado y un color inválido se rechazan ===");
  for (const [que, fn] of [
    [
      'un tema que no existe ("neon")',
      () =>
        conAlcanceTenant(unaClinica, (db) =>
          guardarApariencia(db, unaClinica, { tema: "neon" })
        ),
    ],
    [
      "un color que no es hexadecimal",
      () =>
        conAlcanceTenant(unaClinica, (db) =>
          guardarApariencia(db, unaClinica, { primario: "azul" })
        ),
    ],
  ] as const) {
    try {
      await fn();
      assert(false, `${que} — NO falló, y tenía que fallar`);
    } catch (err) {
      assert(true, `${que} — rechazado`, (err as Error).message.slice(0, 90));
    }
  }

  // -------------------------------------------------------------------
  console.log("\n=== 8. Restablecer vuelve al de fábrica y no toca el logo ===");
  await pool.query(`UPDATE tenants SET logo_url = 'logos/de-la-clinica.png' WHERE id = $1`, [
    unaClinica,
  ]);
  const restablecida = await conAlcanceTenant(unaClinica, (db) =>
    restablecerApariencia(db, unaClinica)
  );
  igual(
    [restablecida.primario, restablecida.tema],
    [PRIMARIO_POR_DEFECTO, "marca"],
    "el color y el tema vuelven al de fábrica"
  );
  assert(
    restablecida.logoUrl !== null,
    "y el logo SIGUE: es de la clínica, no del tema",
    restablecida.logoUrl
  );

  // -------------------------------------------------------------------
  await pool.query(`DELETE FROM tenants WHERE nombre LIKE $1`, [`${PREFIJO}%`]);
  console.log(ok ? "\nTODO OK" : "\nHAY FALLOS");
  await pool.end();
  process.exit(ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error("ERROR", err);
  await pool.end();
  process.exit(1);
});
