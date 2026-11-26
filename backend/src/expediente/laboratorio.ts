import { PoolClient } from "pg";

// ---------------------------------------------------------------------
// LABORATORIO — sección 4 del prompt 07.
//
// UNA SOLA TABLA PARA LA ORDEN Y EL ESTUDIO. Una orden de laboratorio
// es un estudio que todavía no tiene resultado: `solicitado` →
// `muestra_enviada` → `resultado_recibido`. Tenerlas separadas
// obligaría a copiar paciente, atención, tipo y médico de la orden al
// estudio cuando llega el resultado, y ahí es donde los datos se
// desincronizan.
//
// EL RANGO DE REFERENCIA SE COPIA AL RESULTADO. El catálogo
// `exp_analitos` dice el rango por especie hoy; el resultado guarda el
// que se usó para leerlo. Si mañana el catálogo cambia, un resultado de
// hace dos años sigue interpretándose con el rango con el que el médico
// lo leyó — si no, un valor "normal" podría volverse "alto" solo porque
// alguien corrigió el catálogo.
//
// LA BANDERA SE CALCULA ACÁ y no en la pantalla: el mismo número tiene
// que estar alto en la tendencia, en la pestaña y en el PDF.
// ---------------------------------------------------------------------

export interface ResultadoCargado {
  /** El código del catálogo (`CREA`, `ALT`…) o nada si es libre. */
  codigo?: string;
  analito: string;
  valor?: number | string;
  valorTexto?: string;
  unidad?: string;
}

export interface EstudioLab {
  id: string;
  tipo_estudio: string;
  estado: string;
  es_externo: boolean;
  laboratorio: string | null;
  fecha_solicitud: string;
  fecha_resultado: string | null;
  observaciones: string | null;
  solicitado_por_nombre: string | null;
  visto_en: string | null;
  archivo_id: string | null;
  resultados: Array<{
    analito: string;
    valor: string | null;
    valor_texto: string | null;
    unidad: string | null;
    ref_min: string | null;
    ref_max: string | null;
    bandera: string | null;
  }>;
}

/** Alto, bajo o normal. Sin rango no hay bandera, y eso se dice. */
export function banderaDe(
  valor: number | null,
  refMin: number | null,
  refMax: number | null
): "alto" | "bajo" | "normal" | null {
  if (valor === null || (refMin === null && refMax === null)) return null;
  if (refMax !== null && valor > refMax) return "alto";
  if (refMin !== null && valor < refMin) return "bajo";
  return "normal";
}

/**
 * Pide un estudio. Es la ORDEN: nace sin resultado.
 *
 * `atencionId` es opcional porque un estudio puede pedirse sin visita
 * (un control que el cliente trae del laboratorio), pero cuando viene,
 * el estudio queda colgado de la visita y aparece en su línea.
 */
export async function solicitarEstudio(
  db: PoolClient,
  tenantId: string,
  datos: {
    pacienteId: string;
    tipoEstudio: string;
    atencionId?: string;
    esExterno?: boolean;
    laboratorio?: string;
    observaciones?: string;
    personaId?: string;
  }
): Promise<{ id: string }> {
  if (!datos.tipoEstudio?.trim()) {
    throw new Error("Un estudio necesita su tipo (hemograma, química, urianálisis…).");
  }
  const r = await db.query<{ id: string }>(
    `INSERT INTO exp_estudios_lab (tenant_id, paciente_id, atencion_id, tipo_estudio, es_externo,
                                   laboratorio, observaciones, solicitado_por)
     VALUES ($1,$2,$3,$4,COALESCE($5,false),$6,$7,$8) RETURNING id`,
    [
      tenantId,
      datos.pacienteId,
      datos.atencionId ?? null,
      datos.tipoEstudio.trim(),
      datos.esExterno ?? null,
      datos.laboratorio?.trim() || null,
      datos.observaciones?.trim() || null,
      datos.personaId ?? null,
    ]
  );
  return { id: r.rows[0].id };
}

export async function cambiarEstadoEstudio(
  db: PoolClient,
  estudioId: string,
  estado: "solicitado" | "muestra_enviada" | "cancelado"
): Promise<void> {
  const r = await db.query(
    `UPDATE exp_estudios_lab SET estado = $2 WHERE id = $1 AND estado <> 'resultado_recibido'`,
    [estudioId, estado]
  );
  if (r.rowCount === 0) {
    throw new Error("Ese estudio no existe o ya tiene resultado: un resultado no vuelve atrás.");
  }
}

/**
 * Carga el resultado.
 *
 * Al cargarlo el estudio pasa a `resultado_recibido` y queda como AVISO
 * PENDIENTE para el médico (`visto_en` en NULL) — el prompt pide avisar
 * cuando llega el resultado, y un resultado que nadie marcó como visto
 * es exactamente eso.
 *
 * Los valores se resuelven contra el catálogo POR ESPECIE del paciente.
 * Un analito que no está en el catálogo se guarda igual con su nombre
 * tal como vino: un resultado que no se puede graficar sigue siendo un
 * resultado.
 */
export async function cargarResultados(
  db: PoolClient,
  tenantId: string,
  estudioId: string,
  resultados: ResultadoCargado[],
  opciones: { archivoId?: string; observaciones?: string } = {}
): Promise<{ cargados: number; conBandera: number }> {
  const e = await db.query<{ paciente_id: string; estado: string }>(
    `SELECT paciente_id, estado FROM exp_estudios_lab WHERE id = $1 AND tenant_id = $2`,
    [estudioId, tenantId]
  );
  if (e.rows.length === 0) throw new Error("Ese estudio no existe.");

  const p = await db.query<{ especie: string }>(`SELECT especie FROM pacientes WHERE id = $1`, [
    e.rows[0].paciente_id,
  ]);
  const especie = p.rows[0]?.especie ?? "perro";

  // Se reemplazan los resultados del estudio: cargar dos veces el mismo
  // PDF no tiene que duplicar las filas (y pasa, porque el laboratorio
  // manda el mismo correo dos veces).
  await db.query(`DELETE FROM exp_lab_resultados WHERE estudio_id = $1`, [estudioId]);

  let conBandera = 0;
  let orden = 0;
  for (const r of resultados) {
    const valorNumero =
      r.valor === undefined || r.valor === null || r.valor === ""
        ? null
        : Number(String(r.valor).replace(",", "."));
    if (valorNumero !== null && !Number.isFinite(valorNumero)) {
      throw new Error(`El valor de ${r.analito} no es un número: "${r.valor}".`);
    }
    if (valorNumero === null && !r.valorTexto?.trim()) {
      throw new Error(`${r.analito} no trae ni valor ni texto: no hay resultado que guardar.`);
    }

    const cat = r.codigo
      ? await db.query<{
          id: string;
          nombre: string;
          unidad: string;
          ref_min: string | null;
          ref_max: string | null;
        }>(
          `SELECT id, nombre, unidad, ref_min, ref_max FROM exp_analitos
            WHERE codigo = $1 AND especie = $2 AND activo`,
          [r.codigo, especie]
        )
      : null;
    const a = cat?.rows[0];
    const refMin = a?.ref_min !== undefined && a?.ref_min !== null ? Number(a.ref_min) : null;
    const refMax = a?.ref_max !== undefined && a?.ref_max !== null ? Number(a.ref_max) : null;
    const bandera = banderaDe(valorNumero, refMin, refMax);
    if (bandera === "alto" || bandera === "bajo") conBandera++;

    await db.query(
      `INSERT INTO exp_lab_resultados (tenant_id, estudio_id, analito_id, analito_texto, valor,
                                       valor_texto, unidad, ref_min, ref_max, bandera, orden)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        tenantId,
        estudioId,
        a?.id ?? null,
        a?.nombre ?? r.analito,
        valorNumero,
        r.valorTexto?.trim() || null,
        r.unidad ?? a?.unidad ?? null,
        refMin,
        refMax,
        bandera,
        orden++,
      ]
    );
  }

  await db.query(
    `UPDATE exp_estudios_lab
        SET estado = 'resultado_recibido', fecha_resultado = now(),
            archivo_id = COALESCE($2, archivo_id),
            observaciones = COALESCE($3, observaciones),
            visto_en = NULL, visto_por = NULL
      WHERE id = $1`,
    [estudioId, opciones.archivoId ?? null, opciones.observaciones?.trim() || null]
  );

  return { cargados: resultados.length, conBandera };
}

/** El médico marca que lo vio: deja de ser un aviso pendiente. */
export async function marcarEstudioVisto(
  db: PoolClient,
  estudioId: string,
  personaId: string
): Promise<void> {
  await db.query(
    `UPDATE exp_estudios_lab SET visto_en = now(), visto_por = $2
      WHERE id = $1 AND estado = 'resultado_recibido'`,
    [estudioId, personaId]
  );
}

export async function estudiosDePaciente(
  db: PoolClient,
  pacienteId: string
): Promise<EstudioLab[]> {
  const r = await db.query<EstudioLab>(
    `SELECT e.id, e.tipo_estudio, e.estado, e.es_externo, e.laboratorio, e.fecha_solicitud,
            e.fecha_resultado, e.observaciones, e.visto_en, e.archivo_id,
            per.nombre AS solicitado_por_nombre,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'analito', r.analito_texto, 'valor', r.valor, 'valor_texto', r.valor_texto,
                       'unidad', r.unidad, 'ref_min', r.ref_min, 'ref_max', r.ref_max,
                       'bandera', r.bandera) ORDER BY r.orden)
                FROM exp_lab_resultados r WHERE r.estudio_id = e.id
            ), '[]'::json) AS resultados
       FROM exp_estudios_lab e
       LEFT JOIN personas per ON per.id = e.solicitado_por
      WHERE e.paciente_id = $1
      ORDER BY e.fecha_solicitud DESC`,
    [pacienteId]
  );
  return r.rows;
}

/**
 * La TENDENCIA de un analito: sus valores en el tiempo con el rango.
 *
 * Se consulta por el código del catálogo y no por el nombre libre: dos
 * laboratorios escriben "Creatinina" y "CREATININA SERICA", y una
 * tendencia que los mezcla por texto suma peras con manzanas.
 */
export async function tendenciaDeAnalito(
  db: PoolClient,
  pacienteId: string,
  codigo: string
): Promise<{
  codigo: string;
  nombre: string | null;
  unidad: string | null;
  refMin: number | null;
  refMax: number | null;
  puntos: Array<{ fecha: string; valor: number; bandera: string | null; estudioId: string }>;
}> {
  const r = await db.query<{
    fecha: string;
    valor: string;
    bandera: string | null;
    estudio_id: string;
    nombre: string;
    unidad: string | null;
    ref_min: string | null;
    ref_max: string | null;
  }>(
    `SELECT COALESCE(e.fecha_resultado, e.fecha_solicitud) AS fecha, res.valor, res.bandera,
            e.id AS estudio_id, res.analito_texto AS nombre, res.unidad, res.ref_min, res.ref_max
       FROM exp_lab_resultados res
       JOIN exp_estudios_lab e ON e.id = res.estudio_id
       JOIN exp_analitos a ON a.id = res.analito_id
      WHERE e.paciente_id = $1 AND a.codigo = $2 AND res.valor IS NOT NULL
      ORDER BY fecha`,
    [pacienteId, codigo]
  );

  const primera = r.rows[0];
  return {
    codigo,
    nombre: primera?.nombre ?? null,
    unidad: primera?.unidad ?? null,
    refMin: primera?.ref_min !== undefined && primera?.ref_min !== null ? Number(primera.ref_min) : null,
    refMax: primera?.ref_max !== undefined && primera?.ref_max !== null ? Number(primera.ref_max) : null,
    puntos: r.rows.map((f) => ({
      fecha: String(f.fecha),
      valor: Number(f.valor),
      bandera: f.bandera,
      estudioId: f.estudio_id,
    })),
  };
}

/** Qué analitos tiene este paciente medidos, para ofrecer la tendencia. */
export async function analitosConHistoria(db: PoolClient, pacienteId: string) {
  const r = await db.query(
    `SELECT a.codigo, a.nombre, a.unidad, count(*)::int AS mediciones
       FROM exp_lab_resultados res
       JOIN exp_estudios_lab e ON e.id = res.estudio_id
       JOIN exp_analitos a ON a.id = res.analito_id
      WHERE e.paciente_id = $1 AND res.valor IS NOT NULL
      GROUP BY a.codigo, a.nombre, a.unidad
     HAVING count(*) > 0
      ORDER BY count(*) DESC, a.nombre`,
    [pacienteId]
  );
  return r.rows;
}

/** Los resultados que llegaron y nadie miró. Es el aviso al médico. */
export async function estudiosSinVer(db: PoolClient) {
  const r = await db.query(
    `SELECT e.id, e.tipo_estudio, e.fecha_resultado, p.nombre AS paciente, p.id AS paciente_id,
            (SELECT count(*) FROM exp_lab_resultados r
              WHERE r.estudio_id = e.id AND r.bandera IN ('alto','bajo'))::int AS alterados
       FROM exp_estudios_lab e
       JOIN pacientes p ON p.id = e.paciente_id
      WHERE e.estado = 'resultado_recibido' AND e.visto_en IS NULL
      ORDER BY e.fecha_resultado DESC
      LIMIT 100`
  );
  return r.rows;
}
