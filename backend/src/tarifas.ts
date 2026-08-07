import { Pool, PoolClient } from "pg";
import { verificarUmbralesYNotificar } from "./usoIa";
import { dispararAutorecargaSiCorresponde } from "./pagos/recargas";

// ---------------------------------------------------------------------
// Motor de crédito, Bloque 1 — resuelve tarifas_modelo, calcula el costo
// real de una llamada a la API de Anthropic y es el único punto que
// escribe en uso_api. Antes de esto había 4 copias casi idénticas
// (workspace.routes.ts, casos.routes.ts x2, recetas.routes.ts), cada una
// con su propia copia de las 4 constantes de precio hardcodeadas — la
// consolidación evita que un precio desactualizado en un archivo quede
// sin corregir en los otros tres.
// ---------------------------------------------------------------------

type EjecutorSql = Pool | PoolClient;

export type TipoConsumo = "clinico" | "regeneracion" | "operativo" | "cortesia";
export type DisparadoPor = "usuario" | "sistema";
// Latencia y costo, Cambio 1 — el chat clínico usa cache_control con TTL de
// una hora (ver workspace.routes.ts); Dashboard/Informe/Recetas siguen en
// el TTL por defecto de Anthropic (5 minutos). Anthropic cobra la escritura
// de una hora al doble que la de cinco minutos, así que cada llamada debe
// declarar cuál usó para que se le aplique la tarifa correcta — nunca un
// promedio ni la tarifa de 5 minutos por default silencioso.
export type TtlCacheEscritura = "5m" | "1h";

interface TarifaResuelta {
  id: string;
  precioUsdPorMillon: number;
}

interface TarifasModeloResueltas {
  entrada: TarifaResuelta;
  salida: TarifaResuelta;
  cacheEscritura: TarifaResuelta;
  cacheEscritura1h: TarifaResuelta | null;
  cacheLectura: TarifaResuelta;
  facturable: boolean;
}

// Cache en memoria por modelo — se consulta en cada mensaje/generación, así
// que evita una vuelta a la base en cada una.
//
// DECISIÓN EXPLÍCITA sobre el TTL: mientras Platform Admin no tenga la
// pantalla de Tarifas (ver [[project-vetplatform-disenos-nuevos-registro-platform-admin]]
// en memoria del proyecto), un cambio de precio hecho a mano en la base
// puede tardar hasta TARIFAS_CACHE_TTL_MS en reflejarse acá — durante ese
// minuto, el consumo se sigue cobrando con el precio anterior. Es
// aceptable para este bloque, pero es un costo real, no un detalle de
// implementación: cuando exista el endpoint de cambio de tarifa, debe
// llamar a invalidarCacheTarifa(modelo) (o invalidarCacheTarifasCompleta())
// exportada más abajo, para que el cambio de precio sea efectivo de
// inmediato en vez de esperar el TTL.
const TARIFAS_CACHE_TTL_MS = 60_000;
const cacheTarifas = new Map<string, { valor: TarifasModeloResueltas | null; expiraEn: number }>();

// Para que el futuro endpoint de cambio de tarifa (Platform Admin) invalide
// el caché al cerrar una vigencia y abrir una nueva, sin esperar el TTL.
export function invalidarCacheTarifa(modelo: string): void {
  cacheTarifas.delete(modelo);
}

export function invalidarCacheTarifasCompleta(): void {
  cacheTarifas.clear();
}

async function resolverTarifasVigentes(
  db: EjecutorSql,
  modelo: string
): Promise<TarifasModeloResueltas | null> {
  const cacheado = cacheTarifas.get(modelo);
  if (cacheado && cacheado.expiraEn > Date.now()) {
    return cacheado.valor;
  }

  const result = await db.query(
    `SELECT id, tipo_token, precio_usd_por_millon, facturable
     FROM tarifas_modelo
     WHERE modelo = $1 AND vigente_hasta IS NULL`,
    [modelo]
  );

  const porTipo = new Map(result.rows.map((fila) => [fila.tipo_token as string, fila]));
  const entrada = porTipo.get("entrada");
  const salida = porTipo.get("salida");
  const cacheEscritura = porTipo.get("cache_escritura");
  const cacheEscritura1h = porTipo.get("cache_escritura_1h");
  const cacheLectura = porTipo.get("cache_lectura");

  let resuelto: TarifasModeloResueltas | null = null;
  if (entrada && salida && cacheEscritura && cacheLectura) {
    resuelto = {
      entrada: { id: entrada.id, precioUsdPorMillon: Number(entrada.precio_usd_por_millon) },
      salida: { id: salida.id, precioUsdPorMillon: Number(salida.precio_usd_por_millon) },
      cacheEscritura: {
        id: cacheEscritura.id,
        precioUsdPorMillon: Number(cacheEscritura.precio_usd_por_millon),
      },
      // Opcional a propósito (migración 033): un modelo sin cache_escritura_1h
      // cargada simplemente no puede usarse con TTL de una hora todavía — no
      // bloquea el resto de sus tarifas ni lo marca como no facturable.
      cacheEscritura1h: cacheEscritura1h
        ? { id: cacheEscritura1h.id, precioUsdPorMillon: Number(cacheEscritura1h.precio_usd_por_millon) }
        : null,
      cacheLectura: { id: cacheLectura.id, precioUsdPorMillon: Number(cacheLectura.precio_usd_por_millon) },
      // Un modelo es facturable solo si las 4 tarifas base lo son — se
      // seedean juntas (ver migraciones 025/026), así que en la práctica
      // siempre coinciden; si alguna vez no coincidieran, cualquier false
      // basta para tratar el modelo entero como no facturable.
      // cache_escritura_1h no participa de esta cuenta: es opcional (arriba).
      facturable:
        entrada.facturable && salida.facturable && cacheEscritura.facturable && cacheLectura.facturable,
    };
  }

  cacheTarifas.set(modelo, { valor: resuelto, expiraEn: Date.now() + TARIFAS_CACHE_TTL_MS });
  return resuelto;
}

interface TokensUso {
  tokensEntrada: number;
  tokensSalida: number;
  tokensCacheEscritura: number;
  tokensCacheLectura: number;
}

interface CalculoCosto {
  costoUsd: number;
  cobrable: boolean;
  tarifaEntradaId: string | null;
  tarifaSalidaId: string | null;
  tarifaCacheEscrituraId: string | null;
  tarifaCacheLecturaId: string | null;
}

async function calcularCosto(
  db: EjecutorSql,
  modelo: string,
  tokens: TokensUso,
  disparadoPor: DisparadoPor,
  tipoConsumo: TipoConsumo,
  ttlCacheEscritura: TtlCacheEscritura
): Promise<CalculoCosto> {
  const tarifas = await resolverTarifasVigentes(db, modelo);

  if (!tarifas) {
    // Descuido real: un modelo en uso sin tarifa cargada en Platform Admin.
    // Nunca bloquea la respuesta al médico — perder un cobro es preferible
    // a interrumpir una consulta clínica.
    console.error(
      `[tarifas] Sin tarifa vigente para el modelo "${modelo}" — el consumo se registra con costo cero y no cobrable.`
    );
    return {
      costoUsd: 0,
      cobrable: false,
      tarifaEntradaId: null,
      tarifaSalidaId: null,
      tarifaCacheEscrituraId: null,
      tarifaCacheLecturaId: null,
    };
  }

  // Cambio 1 — la tarifa de escritura de caché depende del TTL con el que
  // se llamó a Anthropic (ver TtlCacheEscritura arriba). Si la llamada usó
  // 1h y esa tarifa todavía no está cargada, es el mismo tipo de descuido
  // que "sin tarifa vigente": nunca se sigue de largo aplicando la de 5
  // minutos en silencio, porque eso es exactamente la subestimación de
  // costo que este cambio existe para evitar.
  const tarifaCacheEscrituraUsada =
    ttlCacheEscritura === "1h" ? tarifas.cacheEscritura1h : tarifas.cacheEscritura;
  if (!tarifaCacheEscrituraUsada) {
    console.error(
      `[tarifas] Sin tarifa vigente de cache_escritura_1h para el modelo "${modelo}" — el consumo se registra con costo cero y no cobrable.`
    );
    return {
      costoUsd: 0,
      cobrable: false,
      tarifaEntradaId: tarifas.entrada.id,
      tarifaSalidaId: tarifas.salida.id,
      tarifaCacheEscrituraId: null,
      tarifaCacheLecturaId: tarifas.cacheLectura.id,
    };
  }

  const idsTarifas = {
    tarifaEntradaId: tarifas.entrada.id,
    tarifaSalidaId: tarifas.salida.id,
    tarifaCacheEscrituraId: tarifaCacheEscrituraUsada.id,
    tarifaCacheLecturaId: tarifas.cacheLectura.id,
  };

  if (!tarifas.facturable) {
    // Modelo simulado/de prueba (ej. claude-sonnet-5-mock): tiene tarifa
    // vigente a propósito en costo cero y no facturable — no es un
    // descuido, así que no se emite alerta.
    return { costoUsd: 0, cobrable: false, ...idsTarifas };
  }

  // Redondeo único, al persistir: el resultado se guarda en numeric(10,4) y
  // los montos por caso son de centavos, así que redondear antes de sumar
  // los 4 términos introduce error acumulado.
  const costoUsd =
    (tokens.tokensEntrada / 1_000_000) * tarifas.entrada.precioUsdPorMillon +
    (tokens.tokensSalida / 1_000_000) * tarifas.salida.precioUsdPorMillon +
    (tokens.tokensCacheEscritura / 1_000_000) * tarifaCacheEscrituraUsada.precioUsdPorMillon +
    (tokens.tokensCacheLectura / 1_000_000) * tarifas.cacheLectura.precioUsdPorMillon;

  // Flujo de suscripción C — el informe de cortesía generado durante la
  // ventana de purga nunca es cobrable, sin importar quién lo disparó
  // (siempre "usuario" en la práctica: el médico lo pide a mano) — es la
  // naturaleza del tipo de consumo, no de quién lo ejecutó.
  return {
    costoUsd,
    cobrable: tipoConsumo !== "cortesia" && disparadoPor === "usuario",
    ...idsTarifas,
  };
}

export type BolsaAfectada = "plan" | "comprado" | "colchon" | "ninguna";

interface ResultadoDescuento {
  bolsaAfectada: BolsaAfectada;
}

// ---------------------------------------------------------------------
// Motor de crédito, Bloque 2 — descuento del saldo. Se ejecuta dentro de
// la misma transacción que ya trae `db` (el request completo, vía
// withTenantClient), después de insertar la fila de uso_api.
//
// Orden de descuento: primero la bolsa del plan (expira a fin de mes),
// después la comprada (no expira) — es la regla que más favorece al
// cliente, porque agota primero lo que de todos modos iba a perder.
// credito_comprado_usd puede terminar negativo si ambas bolsas no
// alcanzan: la verificación previa y el colchón de gracia son del bloque
// 3, acá el saldo negativo simplemente se registra.
//
// CONCURRENCIA: dos generaciones simultáneas de la misma clínica (varios
// médicos trabajando a la vez es el caso normal, no el excepcional) no
// deben leer el mismo saldo y descontar dos veces sobre él. Se resuelve
// con `SELECT ... FOR UPDATE` sobre la fila de saldos_ia del tenant, no
// con actualización condicional + reintento. Motivo: esta operación no es
// un simple "flip" de un campo (como el guard `WHERE estado = 'pendiente'`
// que ya se usó en otro punto de este proyecto para un problema de
// concurrencia distinto) — es una lectura de dos columnas, un cálculo con
// ramas (cuánto sale de cada bolsa) y hasta 3 escrituras relacionadas
// (saldos_ia + hasta 2 filas de movimientos_credito + el UPDATE de
// bolsa_afectada en uso_api) que tienen que quedar consistentes entre sí.
// Expresar eso como una única sentencia UPDATE con guard de reintento es
// mucho más frágil que bloquear la fila: con FOR UPDATE, Postgres hace
// esperar a la segunda transacción hasta que la primera termine (COMMIT o
// ROLLBACK) y después lee el saldo ya actualizado — sin lazos de
// reintento, y con la garantía de Postgres, no una que haya que mantener
// a mano. El costo es que la segunda generación espera unos milisegundos
// (lo que dura la transacción del primer request) — aceptable para la
// concurrencia real de una sola clínica.
async function descontarSaldo(
  db: PoolClient,
  tenantId: string,
  costoUsd: number,
  usoApiId: string,
  creadoPor: string | null
): Promise<ResultadoDescuento> {
  const saldoResult = await db.query(
    `SELECT credito_plan_usd, credito_comprado_usd FROM saldos_ia WHERE tenant_id = $1 FOR UPDATE`,
    [tenantId]
  );
  if (saldoResult.rows.length === 0) {
    // No debería pasar (todo tenant activo tiene su fila de saldos_ia
    // sembrada), pero si pasa no hay saldo del que descontar.
    console.error(`[tarifas] No existe fila de saldos_ia para el tenant ${tenantId} — no se pudo descontar.`);
    return { bolsaAfectada: "ninguna" };
  }

  const creditoPlanActual = Number(saldoResult.rows[0].credito_plan_usd);
  const creditoCompradoActual = Number(saldoResult.rows[0].credito_comprado_usd);

  const debitoPlan = Math.min(costoUsd, Math.max(creditoPlanActual, 0));
  const debitoComprado = costoUsd - debitoPlan;

  const nuevoCreditoPlan = creditoPlanActual - debitoPlan;
  const nuevoCreditoComprado = creditoCompradoActual - debitoComprado;

  await db.query(
    `UPDATE saldos_ia SET credito_plan_usd = $1, credito_comprado_usd = $2, actualizado_en = now()
     WHERE tenant_id = $3`,
    [nuevoCreditoPlan.toFixed(4), nuevoCreditoComprado.toFixed(4), tenantId]
  );

  // Un movimiento por bolsa efectivamente afectada, monto_usd con signo
  // (negativo = salida) para que el saldo se pueda reconciliar sumando el
  // libro mayor sin tener que consultar `tipo` para saber la dirección.
  // Los dos, si hay dos, comparten el mismo saldo_plan_post/saldo_comprado_post
  // — el estado final de ambas bolsas después de esta operación completa,
  // igual que ya se hacía en el ajuste manual de San Martín 2.
  if (debitoPlan > 0) {
    await db.query(
      `INSERT INTO movimientos_credito
         (tenant_id, tipo, bolsa, monto_usd, referencia_tabla, referencia_id,
          saldo_plan_post, saldo_comprado_post, descripcion, creado_por)
       VALUES ($1, 'consumo', 'plan', $2, 'uso_api', $3, $4, $5, $6, $7)`,
      [
        tenantId,
        (-debitoPlan).toFixed(4),
        usoApiId,
        nuevoCreditoPlan.toFixed(4),
        nuevoCreditoComprado.toFixed(4),
        "Consumo de IA",
        creadoPor,
      ]
    );
  }
  if (debitoComprado > 0) {
    await db.query(
      `INSERT INTO movimientos_credito
         (tenant_id, tipo, bolsa, monto_usd, referencia_tabla, referencia_id,
          saldo_plan_post, saldo_comprado_post, descripcion, creado_por)
       VALUES ($1, 'consumo', 'comprado', $2, 'uso_api', $3, $4, $5, $6, $7)`,
      [
        tenantId,
        (-debitoComprado).toFixed(4),
        usoApiId,
        nuevoCreditoPlan.toFixed(4),
        nuevoCreditoComprado.toFixed(4),
        "Consumo de IA",
        creadoPor,
      ]
    );
  }

  // Si el consumo tocó ambas bolsas (el plan no alcanzó y se completó con
  // lo comprado), bolsa_afectada en uso_api registra 'comprado': es la
  // bolsa que terminó de cubrir el costo, y la señal operativamente más
  // relevante (indica que el crédito del plan ya se agotó). El detalle de
  // cuánto salió de cada bolsa por separado vive en movimientos_credito,
  // que si soporta las dos filas.
  const bolsaAfectada: BolsaAfectada = debitoComprado > 0 ? "comprado" : "plan";
  return { bolsaAfectada };
}

// ---------------------------------------------------------------------
// Motor de crédito, Bloque 3 — verificación previa a cada generación con
// IA y colchón de gracia. Se ejecuta ANTES de invocar el modelo (a
// diferencia de registrarUsoApi, que corre después). Vive en este mismo
// módulo porque es el punto consolidado de la lógica de crédito, aunque
// no dentro de registrarUsoApi — no puede estarlo, ya que esa función
// necesita el uso real (tokens) que solo existe después de la llamada.
//
// CONCURRENCIA — deliberadamente NO usa FOR UPDATE como descontarSaldo
// (Bloque 2). Esta verificación corre al principio del request, antes de
// la llamada a Anthropic — que puede tardar varios segundos. Si tomara
// el lock de saldos_ia acá, lo mantendría abierto durante toda esa
// llamada (withTenantClient no libera el client hasta el COMMIT al
// final del request), serializando a todos los médicos de la misma
// clínica generando en simultáneo detrás de la respuesta de Claude de
// uno solo. Para el camino común (saldo > 0) una lectura no bloqueante
// es suficiente: no se estima costo, solo se confirma que hay saldo, y
// el descuento real y su propio lock ya lo garantiza Bloque 2 después.
// Para el camino raro (saldo en cero, consumir el colchón) sí hace falta
// atomicidad para no registrar el colchón dos veces si dos requests
// llegan a la vez con saldo en cero — pero a diferencia del descuento
// del Bloque 2 (multi-columna, con escritura cruzada), esto SÍ es un
// simple flip de una columna (colchon_usado_usd: 0 -> gracia), el mismo
// tipo de operación para la que Bloque 2 dijo que un UPDATE condicional
// alcanza. Se resuelve con un UPDATE ... WHERE colchon_usado_usd = 0,
// sin mantener ningún lock abierto durante la llamada al modelo.
// ---------------------------------------------------------------------

export type TipoOperacionGeneracion = "chat" | "dashboard" | "informe" | "receta";

export type MotivoRechazoGeneracion =
  | "sin_saldo"
  | "colchon_agotado"
  | "agente_no_habilitado"
  | "agente_en_mantenimiento"
  | "suscripcion_finalizada"
  | "fuera_de_ventana";

export interface VerificacionPrevia {
  permitido: boolean;
  motivo?: MotivoRechazoGeneracion;
}

export interface VerificarAntesDeGenerarParams {
  tenantId: string;
  agenteId: string;
  tipoOperacion: TipoOperacionGeneracion;
  disparadoPor: DisparadoPor;
}

export async function verificarAntesDeGenerar(
  db: EjecutorSql,
  params: VerificarAntesDeGenerarParams
): Promise<VerificacionPrevia> {
  // Estado de la suscripción — fuente de verdad es suscripciones.estado
  // (el modelo nuevo, ver migraciones 024/025), no tenants.estado_suscripcion
  // (columna heredada, todavía referenciada por código viejo pendiente de
  // adaptar — ver memoria del proyecto sobre la migración 026 retenida).
  const suscripcionResult = await db.query(
    `SELECT s.estado, s.periodo_fin
     FROM tenants t JOIN suscripciones s ON s.id = t.suscripcion_id
     WHERE t.id = $1`,
    [params.tenantId]
  );
  const suscripcion = suscripcionResult.rows[0];
  if (!suscripcion || suscripcion.estado === "finalizada") {
    return { permitido: false, motivo: "suscripcion_finalizada" };
  }
  if (suscripcion.estado === "cancelada" && new Date(suscripcion.periodo_fin) <= new Date()) {
    // Cancelada pero ya venció el período que todavía tenía derecho a
    // consumir — en la práctica el job de ciclo (bloque 5) debería haber
    // movido esto a 'finalizada', pero no depende de que haya corrido.
    return { permitido: false, motivo: "suscripcion_finalizada" };
  }
  if (suscripcion.estado === "ventana_purga" && params.tipoOperacion !== "informe") {
    // Durante la ventana de purga, solo se permite generar el Informe —
    // para que el médico pueda exportar el historial clínico antes de que
    // se elimine. El resto de la generación con IA queda fuera.
    return { permitido: false, motivo: "fuera_de_ventana" };
  }
  // activa, prueba, morosa, suspendida, cancelada-vigente, o
  // ventana_purga+informe: sigue. La morosidad/suspensión afectan el
  // cobro, no el consumo del saldo de IA ya adquirido.

  // El estado GLOBAL del agente (activo/discontinuado/mantenimiento) se
  // chequea antes y por separado del estado por-clínica: un agente en
  // mantenimiento se detiene para TODAS las clínicas que lo tienen, no es
  // algo que el administrador de la clínica pueda resolver deshabilitando
  // y volviendo a habilitar — de ahí el motivo distinto (ver prompt
  // agentes_paises_v2, Paso 2).
  const agenteGlobalResult = await db.query(`SELECT estado FROM agentes WHERE id = $1`, [params.agenteId]);
  if (agenteGlobalResult.rows[0]?.estado === "mantenimiento") {
    return { permitido: false, motivo: "agente_en_mantenimiento" };
  }

  const agenteResult = await db.query(
    `SELECT estado FROM tenant_agentes WHERE tenant_id = $1 AND agente_id = $2`,
    [params.tenantId, params.agenteId]
  );
  if (agenteResult.rows[0]?.estado !== "habilitado") {
    return { permitido: false, motivo: "agente_no_habilitado" };
  }

  if (params.disparadoPor !== "usuario") {
    // Operación no cobrable (disparada por el sistema): se permite sin
    // verificar saldo — no hay nada que descontar.
    return { permitido: true };
  }

  const saldoResult = await db.query(
    `SELECT credito_plan_usd, credito_comprado_usd, colchon_usado_usd FROM saldos_ia WHERE tenant_id = $1`,
    [params.tenantId]
  );
  const saldo = saldoResult.rows[0];
  if (!saldo) {
    console.error(
      `[tarifas] No existe fila de saldos_ia para el tenant ${params.tenantId} — verificación previa rechaza por seguridad.`
    );
    return { permitido: false, motivo: "sin_saldo" };
  }

  const saldoDisponible = Number(saldo.credito_plan_usd) + Number(saldo.credito_comprado_usd);
  if (saldoDisponible > 0) {
    return { permitido: true };
  }

  if (Number(saldo.colchon_usado_usd) > 0) {
    // Saldo en cero y colchón ya consumido en este ciclo — rechaza hasta
    // que el bloque 5 lo salde contra el crédito nuevo del próximo período.
    return { permitido: false, motivo: "colchon_agotado" };
  }

  // Saldo en cero, colchón sin consumir: se consume ahora, íntegro (no se
  // prorratea) — permite completar esta generación y las que lleguen
  // hasta que el bloque 5 lo salde. El UPDATE condicional (WHERE
  // colchon_usado_usd = 0) es el punto atómico: si dos requests concurrentes
  // llegan acá con saldo en cero, solo uno actualiza 1 fila y registra el
  // movimiento; el otro ve 0 filas afectadas y cae al camino de rechazo,
  // sin necesidad de mantener ningún lock mientras tanto.
  const parametroResult = await db.query(
    `SELECT valor FROM parametros_plataforma WHERE clave = 'saldo.colchon_gracia_usd'`
  );
  const colchonGraciaUsd = Number(parametroResult.rows[0]?.valor ?? 0);

  const consumoResult = await db.query(
    `UPDATE saldos_ia SET colchon_usado_usd = $1, actualizado_en = now()
     WHERE tenant_id = $2 AND colchon_usado_usd = 0
     RETURNING credito_plan_usd, credito_comprado_usd`,
    [colchonGraciaUsd.toFixed(4), params.tenantId]
  );

  if (consumoResult.rows.length === 0) {
    // Perdió la carrera: otro request concurrente ya lo consumió entre la
    // lectura de arriba y este UPDATE.
    return { permitido: false, motivo: "colchon_agotado" };
  }

  await db.query(
    `INSERT INTO movimientos_credito
       (tenant_id, tipo, bolsa, monto_usd, saldo_plan_post, saldo_comprado_post, descripcion)
     VALUES ($1, 'colchon', 'colchon', $2, $3, $4, 'Colchón de gracia consumido')`,
    [
      params.tenantId,
      (-colchonGraciaUsd).toFixed(4),
      Number(consumoResult.rows[0].credito_plan_usd).toFixed(4),
      Number(consumoResult.rows[0].credito_comprado_usd).toFixed(4),
    ]
  );

  return { permitido: true };
}

// Mensaje al médico por motivo de rechazo — centralizado acá para que los
// 4 endpoints que llaman a verificarAntesDeGenerar no dupliquen el texto.
// El médico nunca puede recargar ni cambiar el estado de la suscripción,
// así que ningún mensaje le ofrece una acción que no puede ejecutar —
// todos derivan al administrador de la clínica.
export function mensajeRechazoGeneracion(motivo: MotivoRechazoGeneracion): string {
  switch (motivo) {
    case "sin_saldo":
      return "La clínica no tiene saldo de IA disponible — avisale al administrador de tu clínica para recargar.";
    case "colchon_agotado":
      return "La clínica agotó el margen de gracia para este ciclo — avisale al administrador de tu clínica para recargar.";
    case "agente_no_habilitado":
      return "Este agente no está habilitado para tu clínica — consultá con tu administrador.";
    case "agente_en_mantenimiento":
      return "Este agente está temporalmente en mantenimiento — no depende de tu clínica, va a volver a estar disponible pronto.";
    case "suscripcion_finalizada":
      return "La suscripción de tu clínica no está activa — consultá con tu administrador.";
    case "fuera_de_ventana":
      return "Tu clínica está en período de cierre — solo se puede generar el Informe para exportar el historial.";
  }
}

export interface RegistrarUsoApiParams {
  tenantId: string;
  casoId: string;
  medicoAgenteId: string | null;
  personaId: string | null;
  modelo: string;
  tokensEntrada: number;
  tokensSalida: number;
  tokensCacheEscritura: number;
  tokensCacheLectura: number;
  tipoConsumo: TipoConsumo;
  disparadoPor: DisparadoPor;
  // Cambio 1 — default "5m" a propósito: es el TTL que ya usaban las 4
  // llamadas antes de este cambio (Dashboard/Informe/Recetas se quedan
  // ahí), así que los 3 call sites que no lo pasan explícitamente siguen
  // funcionando igual que antes. Solo el chat clínico (workspace.routes.ts)
  // pasa "1h".
  ttlCacheEscritura?: TtlCacheEscritura;
}

// ---------------------------------------------------------------------
// Único punto de escritura en uso_api. Antes de esto, cada endpoint que
// llamaba a la API de Anthropic (mensajes de chat, Dashboard, Informe,
// validación de receta) tenía su propia copia casi idéntica de esta
// función y de las 4 constantes de precio — consolidado acá por
// instrucción explícita (motor de crédito, bloque 1).
//
// bolsa_afectada se resuelve en dos tiempos: se inserta la fila primero
// (con 'ninguna' si no es cobrable, o sin valor todavía si sí lo es,
// porque para saber qué bolsa se afecta primero hay que descontar), y
// recién después del descuento se completa con un UPDATE puntual por id.
// La alternativa — generar el id de la fila en el cliente para poder
// pasarlo a descontarSaldo() antes del INSERT — evitaría ese segundo
// viaje a la base, pero acá se prefirió no introducir generación de UUIDs
// del lado de la aplicación solo para ahorrar una consulta.
// ---------------------------------------------------------------------
export async function registrarUsoApi(db: PoolClient, params: RegistrarUsoApiParams): Promise<void> {
  const calculo = await calcularCosto(
    db,
    params.modelo,
    {
      tokensEntrada: params.tokensEntrada,
      tokensSalida: params.tokensSalida,
      tokensCacheEscritura: params.tokensCacheEscritura,
      tokensCacheLectura: params.tokensCacheLectura,
    },
    params.disparadoPor,
    params.tipoConsumo,
    params.ttlCacheEscritura ?? "5m"
  );

  const hayAlgoQueDescontar = calculo.cobrable && calculo.costoUsd > 0;

  let usoApiId: string;
  try {
    const insertResult = await db.query(
      `INSERT INTO uso_api
         (tenant_id, caso_id, medico_agente_id, persona_id, tokens_entrada, tokens_salida,
          tokens_cache_escritura, tokens_cache_lectura, costo_usd_calculado, modelo,
          tipo_consumo, disparado_por, cobrable, bolsa_afectada,
          tarifa_entrada_id, tarifa_salida_id, tarifa_cache_escritura_id, tarifa_cache_lectura_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       RETURNING id`,
      [
        params.tenantId,
        params.casoId,
        params.medicoAgenteId,
        params.personaId,
        params.tokensEntrada,
        params.tokensSalida,
        params.tokensCacheEscritura,
        params.tokensCacheLectura,
        calculo.costoUsd.toFixed(4),
        params.modelo,
        params.tipoConsumo,
        params.disparadoPor,
        calculo.cobrable,
        hayAlgoQueDescontar ? null : "ninguna",
        calculo.tarifaEntradaId,
        calculo.tarifaSalidaId,
        calculo.tarifaCacheEscrituraId,
        calculo.tarifaCacheLecturaId,
      ]
    );
    usoApiId = insertResult.rows[0].id;
  } catch (err) {
    console.error("Error al registrar uso_api", err);
    return;
  }

  // El descuento de saldo se trata como best-effort, igual que el resto de
  // esta función (registrar uso_api arriba, verificar umbrales abajo): si
  // fallara, se loguea y se sigue, en vez de relanzar. La alternativa —
  // dejar que el error suba — haría que el catch del endpoint que llamó a
  // esto responda 500 y, al ser todo una sola transacción de request
  // (withTenantClient), revierta TAMBIÉN el mensaje del médico y la
  // respuesta real ya generada por Claude, que la clínica ya pagó en
  // Anthropic aunque el descuento interno falle. Es el mismo criterio que
  // ya eligió el bloque 1: perder el registro de un cobro puntual es
  // preferible a descartar una consulta clínica real. El costo es que
  // bolsa_afectada puede quedar en NULL (no en 'ninguna') cuando esto pasa
  // — una señal distinguible de "hubo que descontar y falló", para
  // reconciliar a mano si se repite.
  if (hayAlgoQueDescontar) {
    try {
      const { bolsaAfectada } = await descontarSaldo(
        db,
        params.tenantId,
        calculo.costoUsd,
        usoApiId,
        params.personaId
      );
      await db.query(`UPDATE uso_api SET bolsa_afectada = $1 WHERE id = $2`, [bolsaAfectada, usoApiId]);
    } catch (err) {
      console.error("Error al descontar el saldo de la clínica — revisar movimientos_credito a mano", err);
    }

    // Motor de cobros, Paso 6 — chequeo de autorecarga en la MISMA
    // transacción que el descuento de arriba (misma fila de saldos_ia
    // bloqueada), así el guard de "ya hay una en curso" ve un saldo
    // consistente con lo que se acaba de descontar. Best-effort, aparte:
    // si falla, no debe interferir con el descuento ya aplicado.
    try {
      await dispararAutorecargaSiCorresponde(db, params.tenantId, params.personaId);
    } catch (err) {
      console.error("Error al evaluar la autorecarga de la clínica", err);
    }
  }

  try {
    await verificarUmbralesYNotificar(db, params.tenantId);
  } catch (err) {
    console.error("Error al verificar umbrales de uso", err);
  }
}
