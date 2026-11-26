# Punto de retome — 2026-11-25

Escrito antes de un reinicio de la máquina, para poder volver sin reconstruir el contexto.

## Dónde quedó

| | |
|---|---|
| Rama | `vetline-clinic/facturador-cr` |
| Commit | `e5446b7` — *Purga sin trabas y catalogo CABYS cargado de su fuente oficial* |
| Estado | Árbol **limpio**, en sync con `origin`. No hay nada a medias. |
| Base de la rama | `vetline-clinic/sesion-nocturna-2026-11-25` |

Nada corriendo en segundo plano. Los contenedores se pueden bajar sin perder trabajo: la base es
externa y las migraciones **091** (facturador) y **092** (purga) ya están aplicadas.

## Qué quedó cerrado

**Prompt `vetline-clinic-09a-motor-facturador.md`** — facturador electrónico de Costa Rica v4.4,
módulo `facturacion`. Migración 091, 25 tablas `fact_`. Reporte en
`docs/reportes/facturador-cr-2026-11-25.md`.

**Las dos decisiones sobre ese reporte**, en el addendum del mismo archivo:

- **D-006 — CERRADO.** No era una FK sino **42**: cada rama de la cascada de `DELETE FROM tenants`
  es su propia sentencia y `NO ACTION` se chequea al final de cada una. Migración **092** las
  difiere al COMMIT, con un bloque que falla si quedó alguna. `restablecimientos_contrasena` se
  borra a mano (diferir no la arregla: la fila sobrevive al COMMIT). La auditoría pasó a mirar toda
  FK hacia una tabla que la purga borra, no solo las que apuntan a `tenants`. La regla **no se
  debilitó**: la FK sigue siendo `NO ACTION`.
- **CABYS — CARGADO.** 20 506 códigos de la planilla del **Banco Central** (no de Hacienda), por el
  mismo `npm run cargar-catalogos-fe`. URL y fecha en `docs/facturacion/fuentes/LEEME.md`, archivo
  en `backend/catalogos/cabys/`, sha256 en `sumas.sha256`.

Detalle completo en `DEFECTOS_ABIERTOS.md` (D-006) y en el addendum del reporte del facturador.

## Comprobar en un minuto que el ambiente volvió bien

```bash
docker compose up -d

# Las fuentes oficiales no se corrompieron en el clon
cd docs/facturacion/fuentes && sha256sum -c sumas.sha256     # 24 OK

# Esquema y catálogos
docker compose exec backend npm run migrate                  # nada que aplicar
docker compose exec backend npm run cargar-catalogos-fe      # idempotente: 0 nuevos

# Los dos verificadores de lo último que se hizo
docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_purga_completa.ts   # 19 OK, 0 FAIL
docker compose exec backend npx ts-node --transpile-only src/scripts/verificar_cabys.ts            # 33 OK, 0 FAIL
```

Números de referencia del resto, para comparar si algo sale distinto:

| Verificador | Esperado |
|---|---|
| `verificar_cambio4_purga_consumo` | TODO OK |
| `verificar_auditoria_rls_reforzada` | TODO OK |
| `verificar_api_facturacion` | 91 OK, 0 FAIL |
| `verificar_facturacion_modelo` | TODO OK |
| `verificar_emision_facturacion` | TODO OK |
| `verificar_rls_correos_purga_razas_log` | TODO OK |
| `verificar_marca_correos` | 89 OK, 0 fallas |

## El punto exacto donde retomar

**`docs/prompts/vetline-clinic-06-catalogo-inventario-compras.md`** — módulo `inventario`.
**No arrancado**, y la decisión de arrancarlo está pendiente.

- Su **línea 10** pide crear **rama nueva a partir de la última versión de
  `vetline-clinic/facturador-cr`**. Por eso las cuatro cosas que se agregaron al prompt (tabla de 13
  tipos de movimiento con dirección fija, ajustes positivos y negativos con aprobación sobre umbral,
  devolución de cliente, venta de mostrador mínima) **no** se metieron en el facturador: son de
  `inventario`. Ya están escritas en el archivo del prompt, líneas 88-107 y 151-152, con su
  verificación en 172-173.
- Su **línea 56** declara que los productos llevan «código CABYS y tarifa de impuesto (usando el
  catálogo que cargó el facturador)». **Esa dependencia estaba bloqueada y se destrabó el
  2026-11-25.**
- Gobernado por `docs/prompts/vetline-clinic-00-guia-rectora.md`, como todo Vetline Clinic.

**La decisión que quedó sin tomar** fue entre tres caminos, y conviene retomar por ahí:

1. Arrancar el prompt 06 en su rama.
2. Integrar `vetline-clinic/facturador-cr` antes de encadenar otra rama encima.
3. Cerrar las salvedades del facturador (revisión visual de las 5 pantallas, codificación de
   ubicación).

## Abierto, y que no bloquea

- **El JSON Schema del `POST /recepcion`** no se consiguió. El cuerpo que arma `haciendaReal.ts` es
  una suposición informada, en **un solo objeto** marcado con advertencia. Solo la primera prueba
  contra el sandbox lo confirma o lo desmiente.
- **Las cinco pantallas del facturador no se abrieron en un navegador.** `tsc` y `vite build`
  limpios, pero sin revisión visual.
- **Codificación de ubicación** (provincia/cantón/distrito/barrio): se publica en `.rar` y no se
  descargó de forma reproducible. Los campos se validan por formato, no contra la lista.
- **`verificar_motor_cobros` en rojo** — preexistente, de la sesión nocturna: la FSM del cobro queda
  `morosa` donde espera `activa`. Nada de este trabajo toca cobros.
- **Dos errores de `tsc` en `src/scripts`** que vienen de otra rama
  (`keycloak_habilitar_edit_username.ts`, `verificar_busqueda_paleta.ts`). `src/scripts` está
  excluido de `tsconfig.build.json`, así que no rompen el build.

## Trampas del ambiente, para no redescubrirlas

- **`ts-node-dev` no siempre se auto-reinicia** en Windows + Docker. Si un cambio no se refleja,
  reiniciar el contenedor a mano antes de buscar el problema en el código.
- **Los verificadores se corren con `--transpile-only`.** Sin eso, varios fallan por tipos de
  `Express.Request` que no se resuelven desde el script, no por un defecto real.
- **`npm run purga-pendiente`** es **solo lectura** (`BEGIN TRANSACTION READ ONLY`) y es lo que hay
  que correr contra la base **antes de cualquier despliegue**: dice qué clínicas va a eliminar la
  próxima corrida de la purga y si la 092 está aplicada. **No tiene variante `:prod`** a propósito —
  `tsconfig.build.json` excluye `src/scripts`, así que `node dist/scripts/…` sería un comando roto
  justo cuando más importa que funcione.
