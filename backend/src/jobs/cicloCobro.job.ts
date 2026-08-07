import cron from "node-cron";
import { pool } from "../db";
import { ejecutarJobCicloCobro } from "../pagos/cicloCobro";

// ---------------------------------------------------------------------
// Motor de cobros, Pasos 3-4 — trabajo programado del ciclo de cobro
// recurrente. Corre DESPUÉS del ciclo de crédito (jobs/ciclo.job.ts,
// 5:00 AM) a propósito, aunque los dos estén diseñados para no depender
// del orden entre sí (el otorgamiento de crédito nunca se acopla al
// cobro) — evita que el mismo tick vea a una suscripción con periodo_fin
// recién vencido antes de que el motor de crédito termine de procesarla.
//
// Una vez al día alcanza: la política de reintentos se mide en DÍAS
// (0/3/7/10), no en horas.
// ---------------------------------------------------------------------
export function iniciarJobCicloCobro() {
  cron.schedule("0 7 * * *", () => {
    ejecutarJobCicloCobro(pool).catch((err) => console.error("[cicloCobro.job] Error en el job de cobro", err));
  });
}
