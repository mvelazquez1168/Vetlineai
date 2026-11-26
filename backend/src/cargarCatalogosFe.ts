import { pool } from "./db";
import { cargarCatalogosFacturacion } from "./facturacion/cargarCatalogos";

// ---------------------------------------------------------------------
// Comando de operación: carga los catálogos oficiales de comprobantes
// electrónicos de Costa Rica v4.4 en las tablas `fact_cat_*`.
//
//   npm run cargar-catalogos-fe
//
// En producción, con la imagen compilada:
//   node dist/cargarCatalogosFe.js
//
// Es idempotente: se vuelve a correr cada vez que Hacienda actualiza un
// catálogo. Mismo criterio que `habilitarModulo.ts` sobre por qué es un
// comando y no una migración — una migración queda aplicada para siempre
// y no se puede repetir.
//
// Usa el pool admin: los catálogos no tienen `tenant_id` y no hay sesión
// de usuario; el rol de la aplicación no debería poder escribirlos.
// ---------------------------------------------------------------------

async function main() {
  console.log("Cargando catálogos de facturación electrónica (Costa Rica v4.4)…\n");

  const { resultados, cabys, cabysMotivo, cabysVacio, ubicacion, ubicacionMotivo } =
    await cargarCatalogosFacturacion(pool);

  const ancho = Math.max(...resultados.map((r) => r.tabla.length));
  for (const r of resultados) {
    const partes = [`${r.insertados} nuevo(s)`, `${r.actualizados} actualizado(s)`];
    if (r.desactivados > 0) partes.push(`${r.desactivados} DESACTIVADO(S)`);
    console.log(`  ${r.tabla.padEnd(ancho)}  ${partes.join(", ")}`);
  }

  const total = resultados.reduce((a, r) => a + r.insertados + r.actualizados, 0);
  console.log(`\n${total} código(s) en ${resultados.length} catálogo(s).`);

  if (cabys) {
    const partes = [`${cabys.insertados} nuevo(s)`, `${cabys.actualizados} actualizado(s)`];
    if (cabys.desactivados > 0) partes.push(`${cabys.desactivados} DESACTIVADO(S)`);
    console.log(`\n  ${"fact_cat_cabys".padEnd(ancho)}  ${partes.join(", ")}`);
    console.log(
      `${cabys.leidos} código(s) CABYS leídos de la planilla del Banco Central.`
    );

    if (cabys.sinTarifaSugerida > 0) {
      // No es un error: hay códigos a los que el propio catálogo no les
      // asigna tarifa. Se dice cuántos para que nadie lo descubra cuando
      // una línea salga sin tarifa.
      console.log(
        `${cabys.sinTarifaSugerida} de ellos quedaron SIN tarifa sugerida; ahí hay que elegirla a mano.`
      );
    }

    if (cabys.tarifasDesconocidas.length > 0) {
      // Esto SÍ hay que mirarlo: el Banco Central usó un valor de
      // impuesto que este cargador no sabe traducir, así que esos códigos
      // quedaron sin tarifa sugerida sin que fuera una decisión.
      console.warn(
        "\nATENCIÓN: la planilla trae valores de impuesto que este cargador no conoce.\n" +
          "Esos códigos quedaron sin tarifa sugerida. Hay que agregarlos a TARIFA_A_CODIGO\n" +
          "en facturacion/cabys.ts, mapeados a su código de la Nota 8.1:"
      );
      for (const t of cabys.tarifasDesconocidas) {
        console.warn(`  "${t.valor}" — ${t.filas} fila(s), por ejemplo el código ${t.ejemplo}`);
      }
    }
  }

  if (ubicacion) {
    console.log(
      `
Codificación de ubicación: ${ubicacion.provincias} provincias, ` +
        `${ubicacion.cantones} cantones, ${ubicacion.distritos} distritos, ` +
        `${ubicacion.barrios} barrios.`
    );
    // Los desacuerdos de nombre de la planilla oficial se dicen en voz
    // alta en vez de resolverse en silencio, pero separados: los que
    // son solo mayúsculas se cuentan, y los que difieren de verdad se
    // listan uno por uno. Listarlos todos juntos serían 563 líneas y
    // las 30 que importan quedarían enterradas.
    const soloCaso = ubicacion.desacuerdos.filter((d) => d.soloMayusculas);
    const deVerdad = ubicacion.desacuerdos.filter((d) => !d.soloMayusculas);
    if (soloCaso.length > 0) {
      console.log(
        `  ${soloCaso.length} código(s) vienen con dos usos de mayúsculas; se cargó el más frecuente.`
      );
    }
    if (deVerdad.length > 0) {
      console.log(
        `
  ATENCIÓN: en ${deVerdad.length} código(s) la planilla oficial se contradice con algo` +
          ` más que mayúsculas (acentos, artículos, erratas). Se cargó el nombre más frecuente:`
      );
      for (const d of deVerdad) {
        console.log(
          `    ${d.nivel} ${d.codigo}: "${d.elegido}"  (también dice: ` +
            d.variantes.filter((v) => v !== d.elegido).map((v) => `"${v}"`).join(", ") +
            ")"
        );
      }
    }
    if (ubicacion.restriccionesConProblema.length > 0) {
      // La lista cargó bien, pero hay filas viejas que apuntan a una
      // ubicación que no existe en la codificación oficial. La clave
      // foránea igual rige para todo lo nuevo; lo que queda sin cerrar
      // es la revisión de lo viejo, y eso es un dato a arreglar.
      console.warn(
        "\nATENCIÓN: hay datos existentes con una ubicación que no está en la codificación:"
      );
      for (const r of ubicacion.restriccionesConProblema) {
        console.warn(`  ${r.constraint}: ${r.motivo}`);
      }
    } else {
      console.log(
        `Claves foráneas de ubicación validadas: ${ubicacion.restriccionesValidadas.join(", ")}.`
      );
    }
  } else {
    console.warn(
      [
        "",
        "ATENCIÓN: no se cargó la codificación de ubicación.",
        ubicacionMotivo ? `Motivo: ${ubicacionMotivo}` : "",
        "Sin ella, la provincia, el cantón y el distrito del emisor y del receptor",
        "se validan solo por formato y el rechazo llega desde Hacienda.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  if (cabysVacio) {
    // Sin CABYS no se puede emitir una factura ni un tiquete: el código
    // es obligatorio en cada línea de detalle.
    console.warn(
      [
        "",
        "ATENCIÓN: `fact_cat_cabys` está VACÍA.",
        cabysMotivo ? `Motivo: ${cabysMotivo}` : "",
        "La planilla la publica el Banco Central, aparte de los anexos de Hacienda.",
        "Ver 'Catálogo CABYS' en docs/facturacion/fuentes/LEEME.md.",
        "Hacienda exige el código CABYS en CADA línea de factura y tiquete.",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("Error al cargar los catálogos:", err);
  await pool.end();
  process.exit(1);
});
