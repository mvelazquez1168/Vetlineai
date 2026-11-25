// Verificación end-to-end de vetline-clinic-01 (cimientos y ficha del
// paciente). Contra el backend REAL por HTTP, con un token REAL de
// Keycloak — no llamando a las funciones por dentro.
//
// Crea su propia clínica y su propio usuario de Keycloak descartables, y
// los borra al terminar. NUNCA toca un usuario existente ni sus
// credenciales.
//
//   docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_vetline_clinic_01.ts
import { pool } from "../db";
import { construirBloqueContextoCaso } from "../contextoCaso";
import { crearUsuarioKeycloak, eliminarUsuarioKeycloak, obtenerTokenParaUsuario } from "../keycloakAdmin";
import { auditarRlsPorTenant } from "../jobs/auditoriaRls.job";
import { fijarEstadoModulo } from "../tenantModulos";

const BASE = "http://localhost:4000/api";
const SUFIJO = Date.now().toString(36);
const PASSWORD = `Vp${SUFIJO}!1`;

let ok = 0;
let fail = 0;
function assert(cond: boolean, label: string, detalle?: unknown) {
  if (cond) {
    ok++;
    console.log(`OK   - ${label}`);
  } else {
    fail++;
    console.log(`FAIL - ${label}`, detalle === undefined ? "" : JSON.stringify(detalle));
  }
}

/**
 * Espera a que una fila sea visible desde OTRA conexión.
 *
 * Hace falta por el commit diferido de `withTenantClient`: la transacción
 * del request se confirma en `res.on("finish")`, o sea DESPUÉS de que la
 * respuesta salió. Un 201 no garantiza que la fila esté commiteada, así
 * que cualquier paso de esta verificación que dependa del anterior tiene
 * que esperar — si no, mide la carrera y no la funcionalidad.
 *
 * Verificado de forma aislada: `SELECT ... FROM pacientes WHERE id = <el
 * id que acaba de devolver un 201>` por el pool admin devuelve 0 filas.
 * Es un defecto sistémico del backend, ya relevado
 * (docs/relevamientos/modelo-compartido-gestion.md §5.2), no algo que
 * introduzca este prompt — pero sí hay que tenerlo en cuenta acá.
 */
async function esperarEnBase(sql: string, params: unknown[], descripcion: string): Promise<void> {
  for (let intento = 0; intento < 100; intento++) {
    const r = await pool.query(sql, params);
    if (r.rows.length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`esperarEnBase: nunca se hizo visible — ${descripcion}`);
}

async function pedir(path: string, opts: RequestInit & { token?: string } = {}) {
  const { token, ...rest } = opts;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(rest.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...rest, headers });
  const texto = await res.text();
  let json: any = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, json };
}

async function main() {
  let tenantId = "";
  let personaId = "";
  let propietarioId = "";
  let kcUserId = "";
  const email = `verif.clinic01.${SUFIJO}@example.com`;

  try {
    // -----------------------------------------------------------------
    // Montaje: clínica + médico/admin + propietario, todo descartable.
    // El usuario es médico Y admin de clínica a la vez (caso normal en
    // una clínica chica) para ejercitar los dos gates con un solo token.
    // -----------------------------------------------------------------
    const tenantRes = await pool.query(
      `INSERT INTO tenants (nombre, estado_suscripcion, zona_horaria)
       VALUES ($1, 'activa', 'America/Costa_Rica') RETURNING id`,
      [`Clínica Verif Clinic01 ${SUFIJO}`]
    );
    tenantId = tenantRes.rows[0].id;

    kcUserId = await crearUsuarioKeycloak({
      email,
      nombreCompleto: `Dra. Verif Clinic01 ${SUFIJO}`,
      password: PASSWORD,
      tenantId,
      rol: "ADMIN",
    });

    const personaRes = await pool.query(
      `INSERT INTO personas (tenant_id, nombre, email, password_hash, es_medico, es_admin_clinica, keycloak_user_id, colegiatura)
       VALUES ($1, 'Dra. Verif Clinic01', $2, 'x', true, true, $3, $4)
       RETURNING id`,
      [tenantId, email, kcUserId, `COL-C01-${SUFIJO}`]
    );
    personaId = personaRes.rows[0].id;

    const propRes = await pool.query(
      `INSERT INTO propietarios (tenant_id, nombre, telefono) VALUES ($1, 'Tutor Verif Clinic01', '00000000') RETURNING id`,
      [tenantId]
    );
    propietarioId = propRes.rows[0].id;

    const token = (await obtenerTokenParaUsuario(email, PASSWORD)).access_token;

    // -----------------------------------------------------------------
    console.log("\n=== 1. Auditoría de RLS limpia sobre el esquema real ===");
    // El verificador que FALLA contra los 3 defectos vive aparte
    // (verificar_auditoria_rls_reforzada.ts, 23 aserciones). Acá solo se
    // confirma que después de las migraciones 085/086/087 — que agregaron
    // tenant_modulos y tocaron 7 tablas — el esquema sigue limpio.
    const rls = await auditarRlsPorTenant(pool);
    assert(rls.sinRls.length === 0, "0 tablas con tenant_id y RLS deshabilitado", rls.sinRls);
    assert(rls.sinForzar.length === 0, "0 tablas con tenant_id y RLS sin forzar", rls.sinForzar);
    assert(rls.sinPolitica.length === 0, "0 tablas con tenant_id y RLS sin política", rls.sinPolitica);
    assert(rls.fkSinCascada.length === 0, "0 FK a tenants sin cascada fuera de la lista de purga", rls.fkSinCascada);

    // -----------------------------------------------------------------
    console.log("\n=== 2. Gate de módulos: 403 sin habilitar, 200 habilitado ===");
    const sinModulo = await pedir("/clinic/estado", { token });
    assert(sinModulo.status === 403, "sin el módulo 'expediente' → 403", sinModulo.status);
    assert(
      sinModulo.json?.code === "MODULO_NO_HABILITADO",
      "el 403 trae code MODULO_NO_HABILITADO (para que el frontend lo distinga de un 403 de rol)",
      sinModulo.json
    );

    const meSinModulo = await pedir("/auth/me", { token });
    assert(
      Array.isArray(meSinModulo.json?.modulos) && meSinModulo.json.modulos.length === 0,
      "GET /auth/me devuelve modulos: [] (la interfaz oculta la sección)",
      meSinModulo.json?.modulos
    );

    await fijarEstadoModulo(pool, tenantId, "expediente", "habilitado");

    const conModulo = await pedir("/clinic/estado", { token });
    assert(conModulo.status === 200, "con el módulo habilitado → 200", conModulo.status);
    const meConModulo = await pedir("/auth/me", { token });
    assert(
      meConModulo.json?.modulos?.includes("expediente"),
      "GET /auth/me ahora incluye 'expediente'",
      meConModulo.json?.modulos
    );

    // Idempotencia + que deshabilitar vuelva a cerrar la puerta.
    const reHabilitar = await fijarEstadoModulo(pool, tenantId, "expediente", "habilitado");
    assert(reHabilitar.ok && reHabilitar.estadoAnterior === "habilitado", "habilitar dos veces es idempotente");
    await fijarEstadoModulo(pool, tenantId, "expediente", "deshabilitado");
    const deshabilitado = await pedir("/clinic/estado", { token });
    assert(deshabilitado.status === 403, "deshabilitar vuelve a dar 403", deshabilitado.status);
    await fijarEstadoModulo(pool, tenantId, "expediente", "habilitado");

    // -----------------------------------------------------------------
    console.log("\n=== 3. Dos altas SIMULTÁNEAS no repiten número de expediente ===");
    // Simultáneas de verdad: los dos POST salen sin await entre ellos, así
    // que las dos transacciones conviven. Lo que las serializa es el lock
    // de fila del UPDATE...RETURNING sobre tenants, no el orden en que
    // llegaron.
    const [altaA, altaB] = await Promise.all([
      pedir("/pacientes", {
        method: "POST",
        token,
        body: JSON.stringify({ propietarioId, nombre: `Simultáneo A ${SUFIJO}`, especie: "Canino" }),
      }),
      pedir("/pacientes", {
        method: "POST",
        token,
        body: JSON.stringify({ propietarioId, nombre: `Simultáneo B ${SUFIJO}`, especie: "Canino" }),
      }),
    ]);
    assert(altaA.status === 201 && altaB.status === 201, "las dos altas simultáneas responden 201", [
      altaA.status,
      altaB.status,
    ]);
    const numA = altaA.json?.paciente?.numero_expediente;
    const numB = altaB.json?.paciente?.numero_expediente;
    assert(
      typeof numA === "number" && typeof numB === "number" && numA !== numB,
      `números distintos (${numA} y ${numB})`,
      [numA, numB]
    );
    assert(
      Math.abs(numA - numB) === 1,
      "y consecutivos, sin saltear ninguno",
      [numA, numB]
    );

    // -----------------------------------------------------------------
    console.log("\n=== 4. Alta con la ficha completa y campos nuevos ===");
    const alta = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({
        propietarioId,
        nombre: `Luna ${SUFIJO}`,
        especie: "Canino",
        sexo: "hembra",
        estadoReproductivo: "castrado",
        edadAproximadaAnios: 4,
        microchip: "900123456789012",
        color: "Negro y blanco",
        alergias: "Penicilina",
        alertaManejo: "Nerviosa con desconocidos",
      }),
    });
    assert(alta.status === 201, "alta con todos los campos nuevos → 201", alta.json);
    const pacienteId = alta.json?.paciente?.id;
    assert(alta.json?.paciente?.sexo === "hembra", "sexo guardado como 'hembra'");
    assert(alta.json?.paciente?.estado_reproductivo === "castrado", "estado reproductivo guardado");
    assert(
      alta.json?.paciente?.fecha_nacimiento_estimada === true,
      "la edad aproximada se guardó como fecha de nacimiento ESTIMADA",
      alta.json?.paciente
    );
    assert(alta.json?.paciente?.fecha_nacimiento !== null, "y la fecha de nacimiento quedó completada");

    // La ida y vuelta de la edad: 4 años declarados tienen que leerse 4.
    const fichaEdad = await pedir(`/pacientes/${pacienteId}`, { token });
    assert(
      fichaEdad.json?.paciente?.edad_anios === 4,
      "la edad vuelve a leerse como 4 años (ida y vuelta del cálculo)",
      fichaEdad.json?.paciente?.edad_anios
    );

    // -----------------------------------------------------------------
    console.log("\n=== 5. PATCH: raza de otra especie se rechaza ===");
    const razaFelina = await pool.query(`SELECT id, nombre FROM razas WHERE especie = 'felina' LIMIT 1`);
    const razaCanina = await pool.query(`SELECT id, nombre FROM razas WHERE especie = 'canina' LIMIT 1`);
    assert(razaFelina.rows.length === 1 && razaCanina.rows.length === 1, "el catálogo de razas tiene ambas especies");

    const razaCruzada = await pedir(`/pacientes/${pacienteId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        nombre: `Luna ${SUFIJO}`,
        especie: "Canino",
        razaId: razaFelina.rows[0].id,
      }),
    });
    assert(razaCruzada.status === 400, "raza felina sobre un Canino → 400", razaCruzada.status);
    assert(
      razaCruzada.json?.error === "La raza seleccionada no corresponde a la especie indicada.",
      "con el mensaje de la validación compartida (la misma que usa el POST)",
      razaCruzada.json
    );

    const razaCorrecta = await pedir(`/pacientes/${pacienteId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        nombre: `Luna ${SUFIJO}`,
        especie: "Canino",
        razaId: razaCanina.rows[0].id,
        sexo: "hembra",
        estadoReproductivo: "castrado",
        edadAproximadaAnios: 4,
        alergias: "Penicilina",
        alertaManejo: "Nerviosa con desconocidos",
        // `color` se OMITE a propósito: el PATCH es reemplazo completo,
        // así que omitirlo tiene que vaciarlo (se verifica abajo).
      }),
    });
    assert(razaCorrecta.status === 200, "raza canina sobre un Canino → 200", razaCorrecta.json);
    assert(razaCorrecta.json?.paciente?.raza === razaCanina.rows[0].nombre, "y devuelve el nombre de la raza");
    assert(
      razaCorrecta.json?.paciente?.color === null,
      "el PATCH es reemplazo completo: `color`, que se omitió, quedó vacío",
      razaCorrecta.json?.paciente?.color
    );
    assert(
      razaCorrecta.json?.paciente?.alerta_manejo === "Nerviosa con desconocidos",
      "y los campos que sí viajaron se conservan"
    );

    // El POST también la rechaza — misma función, mismo mensaje.
    const altaRazaCruzada = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({
        propietarioId,
        nombre: `Cruzado ${SUFIJO}`,
        especie: "Felino",
        razaId: razaCanina.rows[0].id,
      }),
    });
    assert(
      altaRazaCruzada.status === 400 &&
        altaRazaCruzada.json?.error === "La raza seleccionada no corresponde a la especie indicada.",
      "el POST rechaza la raza cruzada con el MISMO mensaje que el PATCH",
      altaRazaCruzada.json
    );

    // -----------------------------------------------------------------
    console.log("\n=== 6. PATCH no puede revertir un fallecido ===");
    const altaFallecer = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({
        propietarioId,
        nombre: `Fallecido ${SUFIJO}`,
        especie: "Canino",
        sexo: "macho",
      }),
    });
    assert(altaFallecer.status === 201, "se crea el paciente a dar de baja", altaFallecer.json);
    const pacienteFallecidoId = altaFallecer.json?.paciente?.id;
    // El 201 ya salió pero la transacción puede no haber commiteado — ver
    // esperarEnBase. Sin esto, el PATCH siguiente abre su propia
    // transacción, no ve la fila y responde 404.
    await esperarEnBase(
      `SELECT 1 FROM pacientes WHERE id = $1`,
      [pacienteFallecidoId],
      "el paciente recién creado"
    );
    const marcar = await pedir(`/pacientes/${pacienteFallecidoId}/estado`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ estado: "fallecido", fechaFallecimiento: "2026-11-01" }),
    });
    assert(marcar.status === 200 && marcar.json?.paciente?.estado === "fallecido", "se marca fallecido", marcar.json);

    const intentoRevertir = await pedir(`/pacientes/${pacienteFallecidoId}`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        nombre: `Fallecido ${SUFIJO}`,
        especie: "Canino",
        sexo: "macho",
        estado: "activo",
        fechaFallecimiento: null,
      }),
    });
    assert(intentoRevertir.status === 200, "el PATCH de la ficha responde 200 (edita lo editable)", intentoRevertir.status);
    assert(
      intentoRevertir.json?.paciente?.estado === "fallecido",
      "pero el estado SIGUE siendo 'fallecido' — el PATCH ignora `estado`",
      intentoRevertir.json?.paciente?.estado
    );
    await esperarEnBase(
      `SELECT 1 FROM pacientes WHERE id = $1 AND estado = 'fallecido'`,
      [pacienteFallecidoId],
      "el fallecimiento ya commiteado"
    );
    const enBase = await pool.query(`SELECT estado, fecha_fallecimiento FROM pacientes WHERE id = $1`, [
      pacienteFallecidoId,
    ]);
    assert(
      enBase.rows[0].estado === "fallecido" && enBase.rows[0].fecha_fallecimiento !== null,
      "y en la base tampoco se borró la fecha de fallecimiento",
      enBase.rows[0]
    );

    // El otro camino, el dedicado, también lo rechaza.
    const revertirPorElDedicado = await pedir(`/pacientes/${pacienteFallecidoId}/estado`, {
      method: "PATCH",
      token,
      body: JSON.stringify({ estado: "activo" }),
    });
    assert(revertirPorElDedicado.status === 400, "PATCH /:id/estado con 'activo' → 400", revertirPorElDedicado.status);

    // -----------------------------------------------------------------
    console.log("\n=== 7. Listado y ficha ===");
    const listado = await pedir(`/pacientes?q=Luna ${SUFIJO}`, { token });
    assert(listado.status === 200, "GET /pacientes responde 200");
    assert(listado.json?.total === 1, "busca por nombre y encuentra 1", listado.json?.total);
    assert(listado.json?.porPagina === 20, "paginación de 20, igual que propietarios");

    const porExpediente = await pedir(`/pacientes?q=${alta.json.paciente.numero_expediente}`, { token });
    assert(
      porExpediente.json?.pacientes?.some((p: any) => p.id === pacienteId),
      "busca por número de expediente y lo encuentra",
      porExpediente.json?.total
    );

    const porPropietario = await pedir("/pacientes?q=Tutor Verif Clinic01", { token });
    assert(
      (porPropietario.json?.total ?? 0) >= 4,
      "busca por nombre del propietario y trae todas sus mascotas",
      porPropietario.json?.total
    );

    const ficha = await pedir(`/pacientes/${pacienteId}`, { token });
    assert(ficha.status === 200, "GET /pacientes/:id responde 200");
    assert(ficha.json?.paciente?.propietario_nombre === "Tutor Verif Clinic01", "la ficha trae el propietario");
    assert(ficha.json?.paciente?.alerta_manejo === "Nerviosa con desconocidos", "y la alerta de manejo");
    assert(
      Array.isArray(ficha.json?.casos) &&
        Array.isArray(ficha.json?.atenciones) &&
        Array.isArray(ficha.json?.recetas) &&
        Array.isArray(ficha.json?.cuidadosPreventivos),
      "y las cuatro colecciones del expediente"
    );

    const inexistente = await pedir(`/pacientes/00000000-0000-4000-8000-000000000000`, { token });
    assert(inexistente.status === 404, "un id inexistente da 404, no 500", inexistente.status);

    // -----------------------------------------------------------------
    console.log("\n=== 8. Cronología con los cinco orígenes ===");
    // Un cuidado preventivo, una cita + atención, un caso y su cierre.
    await pedir(`/pacientes/${pacienteId}/cuidados-preventivos`, {
      method: "POST",
      token,
      body: JSON.stringify({
        tipo: "vacunacion",
        fechaAplicacion: "2026-11-10",
        fechaProximaRecomendada: "2027-11-10",
        vacuna: "Rabia",
        lote: "L-99",
      }),
    });
    await pedir(`/pacientes/${pacienteId}/cuidados-preventivos`, {
      method: "POST",
      token,
      body: JSON.stringify({
        tipo: "desparasitacion",
        fechaAplicacion: "2026-11-11",
        fechaProximaRecomendada: "2027-02-11",
        subtipoDesparasitacion: "interna",
        productoDesparasitacion: "Milbemax",
      }),
    });

    const agenteRes = await pool.query(`SELECT id FROM agentes WHERE system_prompt IS NOT NULL LIMIT 1`);
    const agenteId = agenteRes.rows[0].id;
    await pool.query(
      `INSERT INTO tenant_agentes (tenant_id, agente_id, estado) VALUES ($1, $2, 'habilitado')
       ON CONFLICT (tenant_id, agente_id) DO UPDATE SET estado = 'habilitado'`,
      [tenantId, agenteId]
    );
    await pool.query(
      `INSERT INTO medico_agente (persona_id, agente_id, habilitado) VALUES ($1, $2, true)
       ON CONFLICT (persona_id, agente_id) DO UPDATE SET habilitado = true`,
      [personaId, agenteId]
    );

    const caso = await pedir("/casos", {
      method: "POST",
      token,
      body: JSON.stringify({ pacienteId, agenteId, motivoConsulta: "Control anual" }),
    });
    assert(caso.status === 201, "se crea un caso para el paciente", caso.json);
    const casoId = caso.json?.caso?.id;

    const cita = await pedir("/citas", {
      method: "POST",
      token,
      body: JSON.stringify({
        pacienteId,
        medicoId: personaId,
        fecha: "2026-11-12",
        horaInicio: "09:00",
        duracionMinutos: 30,
        casoId,
      }),
    });
    const citaId = cita.json?.cita?.id;
    const atencion = await pedir("/atenciones", { method: "POST", token, body: JSON.stringify({ citaId }) });
    assert(atencion.status === 200 || atencion.status === 201, "se abre la atención de esa cita", atencion.status);
    await pedir(`/atenciones/${atencion.json?.atencion?.id}`, {
      method: "PUT",
      token,
      body: JSON.stringify({ notaMedica: "Todo normal", peso: 12.5, temperatura: 38.4 }),
    });

    const crono = await pedir(`/pacientes/${pacienteId}/cronologia`, { token });
    assert(crono.status === 200, "GET /pacientes/:id/cronologia responde 200", crono.json);
    const tipos = new Set((crono.json?.eventos ?? []).map((e: any) => e.tipo));
    assert(tipos.has("vacunacion"), "la cronología incluye la vacunación", [...tipos]);
    assert(tipos.has("desparasitacion"), "incluye la desparasitación", [...tipos]);
    assert(tipos.has("caso_apertura"), "incluye la apertura del caso", [...tipos]);
    assert(tipos.has("atencion"), "incluye la atención", [...tipos]);

    const fechas = (crono.json?.eventos ?? []).map((e: any) => String(e.fecha).slice(0, 10));
    const ordenadas = [...fechas].sort().reverse();
    assert(JSON.stringify(fechas) === JSON.stringify(ordenadas), "ordenada por fecha, de la más reciente a la más vieja", fechas);

    // La atención del 2026-11-12 tiene que aparecer EN el 12, no en el 11
    // ni en el 13: es la prueba de que la fecha se resolvió en la zona
    // horaria del tenant y no en UTC.
    const eventoAtencion = (crono.json?.eventos ?? []).find((e: any) => e.tipo === "atencion");
    assert(
      String(eventoAtencion?.fecha).slice(0, 10) === "2026-11-12",
      "la atención cae en su día real en la zona del tenant (no corrida por UTC)",
      eventoAtencion?.fecha
    );

    // -----------------------------------------------------------------
    console.log("\n=== 9. El contexto del agente trae sexo, estado reproductivo y edad ===");
    const bloque = await construirBloqueContextoCaso(pool, casoId);
    console.log("--- bloque real inyectado al modelo ---");
    console.log(bloque);
    console.log("---------------------------------------");
    assert(bloque.includes("- Sexo: hembra"), "el bloque incluye el sexo");
    assert(bloque.includes("- Estado reproductivo: castrado"), "incluye el estado reproductivo");
    assert(/- Edad: 4 años \(estimada\)/.test(bloque), "incluye la edad y la marca como estimada");
    assert(bloque.includes("- Alergias registradas: Penicilina"), "incluye las alergias registradas");

    // Y que 'desconocido' NO se inyecte como ruido.
    const pacienteSinDatos = await pedir("/pacientes", {
      method: "POST",
      token,
      body: JSON.stringify({ propietarioId, nombre: `Sin datos ${SUFIJO}`, especie: "Canino" }),
    });
    const casoSinDatos = await pedir("/casos", {
      method: "POST",
      token,
      body: JSON.stringify({
        pacienteId: pacienteSinDatos.json.paciente.id,
        agenteId,
        motivoConsulta: "Primera consulta",
      }),
    });
    const bloqueSinDatos = await construirBloqueContextoCaso(pool, casoSinDatos.json.caso.id);
    assert(
      !bloqueSinDatos.includes("Estado reproductivo"),
      "un estado reproductivo 'desconocido' NO se inyecta (es la señal de que falta preguntarlo)",
      bloqueSinDatos
    );
    assert(!bloqueSinDatos.includes("- Sexo:"), "ni un sexo vacío");
  } finally {
    // -----------------------------------------------------------------
    // Limpieza. El DELETE del tenant arrastra en cascada personas,
    // pacientes, casos, citas, atenciones, recetas y tenant_modulos.
    // -----------------------------------------------------------------
    if (tenantId) {
      await pool.query(`DELETE FROM uso_api WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      await pool.query(`DELETE FROM notificaciones_uso WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      await pool.query(`DELETE FROM eventos_facturacion WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      await pool.query(`DELETE FROM documentos_fiscales WHERE tenant_id = $1`, [tenantId]).catch(() => undefined);
      await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch((err) => {
        console.error("No se pudo borrar el tenant de prueba", err.message);
      });
    }
    if (kcUserId) await eliminarUsuarioKeycloak(kcUserId).catch(() => undefined);
    void personaId;
    await pool.end();
  }

  console.log(`\n${ok} OK, ${fail} FALLO(S)`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
