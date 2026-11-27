import { PoolClient } from "pg";
import {
  ClaveMetrica,
  Periodo,
  atenciones,
  cargosFugados,
  clientesNuevos,
  inasistencias,
  ingresos,
  listaDeAtenciones,
  listaDeCargosFugados,
  listaDeClientesNuevos,
  listaDeInasistencias,
  listaDeIngresos,
  listaDePorCobrar,
  porCobrar,
} from "./diccionario";

// ---------------------------------------------------------------------
// EL DRILL-DOWN — prompt 12, §7: «todo número lleva a su lista».
//
// Cada lista declara de qué métrica sale y cuál de sus columnas suma.
// Con eso, el verificador puede comprobar lo único que importa acá: que
// LA SUMA DE LA LISTA SEA EL NÚMERO DE LA TARJETA. Si no coincide, la
// tarjeta y la lista se calculan distinto, y entonces una de las dos
// está mintiendo.
//
// La misma definición alimenta la pantalla, el Excel y el PDF: una
// exportación que arme sus columnas aparte volvería a abrir la puerta
// que este archivo cierra.
// ---------------------------------------------------------------------

export type TipoColumna = "texto" | "dinero" | "numero" | "fecha";

export interface ColumnaLista {
  clave: string;
  etiqueta: string;
  tipo?: TipoColumna;
}

export interface DefinicionLista {
  clave: string;
  titulo: string;
  /** La métrica cuyo número tiene que reproducir. */
  metrica: ClaveMetrica;
  columnas: ColumnaLista[];
  /** La columna que suma. `null` cuando la métrica es un conteo de filas. */
  columnaSuma: string | null;
  /** Lo que hace falta para verla (§10). */
  permiso?: string;
  /** El período no la afecta: es un saldo de hoy. */
  sinPeriodo?: boolean;
  filas(db: PoolClient, tenantId: string, p: Periodo): Promise<Array<Record<string, unknown>>>;
  /** El total que la lista tiene que reproducir. */
  total(db: PoolClient, tenantId: string, p: Periodo): Promise<number>;
  /** A qué registro lleva cada fila, para el enlace de la pantalla. */
  destino?: (fila: Record<string, unknown>) => string | null;
}

export const LISTAS: DefinicionLista[] = [
  {
    clave: "ingresos",
    titulo: "Comprobantes del período",
    metrica: "ingresos",
    columnas: [
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
      { clave: "tipo", etiqueta: "Tipo" },
      { clave: "consecutivo", etiqueta: "Consecutivo" },
      { clave: "cliente", etiqueta: "Cliente" },
      { clave: "monto", etiqueta: "Monto sin IVA", tipo: "dinero" },
    ],
    columnaSuma: "monto",
    filas: listaDeIngresos,
    total: ingresos,
    destino: (f) => `/facturacion/comprobantes/${f.id}`,
  },
  {
    clave: "atenciones",
    titulo: "Atenciones cerradas",
    metrica: "atenciones",
    columnas: [
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
      { clave: "paciente", etiqueta: "Paciente" },
      { clave: "medico", etiqueta: "Médico" },
      { clave: "tipo_consulta", etiqueta: "Tipo" },
    ],
    columnaSuma: null,
    filas: listaDeAtenciones,
    total: atenciones,
    destino: (f) => `/pacientes?atencion=${f.id}`,
  },
  {
    clave: "clientes_nuevos",
    titulo: "Clientes nuevos",
    metrica: "clientes_nuevos",
    columnas: [
      { clave: "fecha", etiqueta: "Primera visita", tipo: "fecha" },
      { clave: "cliente", etiqueta: "Cliente" },
      { clave: "telefono", etiqueta: "Teléfono" },
    ],
    columnaSuma: null,
    filas: listaDeClientesNuevos,
    total: clientesNuevos,
    destino: (f) => `/admin/propietarios?id=${f.id}`,
  },
  {
    clave: "inasistencias",
    titulo: "Citas no presentadas",
    metrica: "inasistencias",
    columnas: [
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
      { clave: "hora_inicio", etiqueta: "Hora" },
      { clave: "paciente", etiqueta: "Paciente" },
      { clave: "cliente", etiqueta: "Cliente" },
      { clave: "telefono", etiqueta: "Teléfono" },
      { clave: "medico", etiqueta: "Médico" },
    ],
    columnaSuma: null,
    filas: listaDeInasistencias,
    // El número de la tarjeta es un PORCENTAJE, pero lo que la lista
    // tiene que reproducir es el conteo de no presentadas: por eso la
    // comparación es contra `noShow` y no contra el porcentaje.
    total: async (db, t, p) => (await inasistencias(db, t, p)).noShow,
    destino: (f) => `/agenda?cita=${f.id}`,
  },
  {
    clave: "cargos_fugados",
    titulo: "Cargos sin cobrar",
    metrica: "cargos_fugados",
    columnas: [
      { clave: "fecha", etiqueta: "Fecha", tipo: "fecha" },
      { clave: "cuenta", etiqueta: "Cuenta" },
      { clave: "cliente", etiqueta: "Cliente" },
      { clave: "paciente", etiqueta: "Paciente" },
      { clave: "descripcion", etiqueta: "Concepto" },
      { clave: "monto", etiqueta: "Monto", tipo: "dinero" },
    ],
    columnaSuma: "monto",
    filas: (db, t, p) => listaDeCargosFugados(db, t, p),
    total: async (db, t, p) => (await cargosFugados(db, t, p)).total,
    destino: () => null,
  },
  {
    clave: "por_cobrar",
    metrica: "por_cobrar",
    sinPeriodo: true,
    titulo: "Clientes con saldo",
    columnas: [
      { clave: "cliente", etiqueta: "Cliente" },
      { clave: "telefono", etiqueta: "Teléfono" },
      { clave: "facturas", etiqueta: "Facturas", tipo: "numero" },
      { clave: "dias", etiqueta: "Días de la más vencida", tipo: "numero" },
      { clave: "vencido", etiqueta: "Vencido", tipo: "dinero" },
      { clave: "monto", etiqueta: "Saldo", tipo: "dinero" },
    ],
    columnaSuma: "monto",
    filas: (db, t) => listaDePorCobrar(db, t),
    total: async (db, t) => (await porCobrar(db, t)).total,
    destino: (f) => `/finanzas?tab=cobranza&cliente=${f.id}`,
  },
];

export function lista(clave: string): DefinicionLista {
  const l = LISTAS.find((x) => x.clave === clave);
  if (!l) throw new Error(`No existe la lista «${clave}».`);
  return l;
}
