import paleta from "./paleta-datos.json";

// ---------------------------------------------------------------------
// Paleta de datos y color por línea de negocio.
//
// Los HEX viven en `paleta-datos.json`, no acá: los necesitan tres
// consumidores (tailwind.config.js para emitir los tokens, este archivo
// para los charts y las leyendas, y el verificador que los mide) y un
// valor en tres lugares es un valor que va a divergir. El JSON es la
// fuente; este archivo le pone nombre y significado.
//
// CÓMO SE ELIGIERON, porque no fue a ojo. Un primer intento a mano (una
// escalera de L* con tonos repartidos cada 36°) lo rechazó el propio
// verificador: ocho pares se confundían entre sí o con un semántico —
// `datos-9` quedaba a ΔE2000 10.9 del `accent` y `datos-10` a 10.9 del
// `success`. Así que los diez salen de una búsqueda en espacio LCh
// (`scripts/verificar-paleta-datos.mjs` los mide; la búsqueda fue un
// script descartable) que maximiza la PEOR separación perceptual sujeta
// a las restricciones duras:
//
//   - Contraste contra `surface` (#FFFFFF) y `background` (#FAF7F2): el
//     mínimo es 3:1 (WCAG 1.4.11, objetos gráficos que no son texto).
//     El peor de los diez queda en 3.39:1 sobre blanco y 3.17:1 sobre
//     el crema.
//   - Luminosidad creciente y monótona, de 0.032 a 0.260. Es lo que pide
//     la guía rectora: que se distingan también en escala de grises, no
//     solo por tono.
//   - CIEDE2000 >= 24 contra `success`, `warning`, `error` y `accent`:
//     los semánticos quedan reservados para estados y ninguna categoría
//     se les puede parecer.
//   - CIEDE2000 entre pares: 18.7 en el peor caso.
//
// EL TECHO MEDIDO, que vale conocer antes de agregar un color: exigir
// 3:1 contra BLANCO acota la luminosidad útil a L* <= 58 aprox., y
// dentro de esa banda la cantidad de colores y la separación posible se
// pelean. Medido con la misma búsqueda:
//
//      8 colores  ->  peor ΔE2000 22.6
//      9 colores  ->  peor ΔE2000 20.4
//     10 colores  ->  peor ΔE2000 18.7
//
// Los tres valores están muy por encima del umbral de percepción (~2.3)
// y del "son colores distintos" (~10). Se eligió 10 porque cada línea de
// negocio tiene que tener su color fijo (guía §3) y con 8 dos líneas
// compartirían color en el chart principal. Si algún día se prefiere el
// margen extra, bajar a 8 es una decisión informada por esa tabla.
// ---------------------------------------------------------------------

/**
 * Los diez colores de la paleta categórica, en orden de luminosidad
 * creciente. Usalos en ESE orden cuando las categorías no tienen un
 * color propio asignado (ej. top de productos): así dos series contiguas
 * siempre difieren lo más posible.
 */
export const PALETA_DATOS = [
  paleta.datos1,
  paleta.datos2,
  paleta.datos3,
  paleta.datos4,
  paleta.datos5,
  paleta.datos6,
  paleta.datos7,
  paleta.datos8,
  paleta.datos9,
  paleta.datos10,
] as const;

/**
 * Las líneas de negocio de la clínica (guía rectora, sección 3). Es la
 * dimensión sobre la que se construyen los dashboards y las
 * correlaciones.
 *
 * El orden de esta lista NO es cosmético: es el que usa el color fijo de
 * abajo, así que cambiarlo le cambia el color a todas las líneas en todas
 * las pantallas. Agregá al final.
 */
export const LINEAS_NEGOCIO = [
  "consulta",
  "cirugia",
  "hospitalizacion",
  "laboratorio",
  "imagen",
  "farmacia",
  "pet_shop",
  "grooming",
  "hotel",
  "vacunacion",
] as const;

export type LineaNegocio = (typeof LINEAS_NEGOCIO)[number];

/**
 * Etiqueta visible de cada línea. Vive junto al color por el mismo
 * motivo: una leyenda necesita las dos cosas, y tener la etiqueta en
 * cada pantalla es la forma de que una diga "Pet shop" y otra "Petshop".
 */
export const ETIQUETA_LINEA_NEGOCIO: Record<LineaNegocio, string> = {
  consulta: "Consulta",
  cirugia: "Cirugía",
  hospitalizacion: "Hospitalización",
  laboratorio: "Laboratorio",
  imagen: "Imagen",
  farmacia: "Farmacia",
  pet_shop: "Pet shop",
  grooming: "Grooming",
  hotel: "Hotel",
  vacunacion: "Vacunación",
};

/**
 * EL MAPA. Un solo lugar donde una línea de negocio tiene su color, y lo
 * usan charts, badges y leyendas por igual: la consulta es del mismo
 * color en todas las pantallas.
 *
 * Son 10 líneas y 10 colores, uno por línea. La guía pedía una paleta de
 * 8; con 8 colores dos líneas tendrían que compartir, y las dos
 * aparecerían juntas en el primer chart de ingresos por línea, que es
 * justamente el chart principal. Se extendió a 10 y queda reportado.
 */
export const COLOR_LINEA_NEGOCIO: Record<LineaNegocio, string> = {
  consulta: paleta.datos1,
  cirugia: paleta.datos2,
  hospitalizacion: paleta.datos3,
  laboratorio: paleta.datos4,
  imagen: paleta.datos5,
  farmacia: paleta.datos6,
  pet_shop: paleta.datos7,
  grooming: paleta.datos8,
  hotel: paleta.datos9,
  vacunacion: paleta.datos10,
};

/**
 * Color de una línea de negocio, tolerante a un valor que no esté en la
 * lista (puede venir de la base). Devuelve un gris neutro en vez de
 * `undefined`: un chart con un `fill` vacío se dibuja invisible, y eso
 * se ve como "no hay datos" en vez de como "falta mapear esta línea".
 */
export const COLOR_LINEA_DESCONOCIDA = "#5A6B82"; // = text-muted

export function colorDeLinea(linea: string): string {
  return COLOR_LINEA_NEGOCIO[linea as LineaNegocio] ?? COLOR_LINEA_DESCONOCIDA;
}

/**
 * Color de la categoría número `indice` cuando no hay un color fijo.
 * Cicla por la paleta — con más de 10 categorías en un mismo chart el
 * color deja de identificar nada, así que si esto cicla es señal de que
 * el chart necesita agrupar en "otros", no más colores.
 */
export function colorPorIndice(indice: number): string {
  return PALETA_DATOS[indice % PALETA_DATOS.length];
}
