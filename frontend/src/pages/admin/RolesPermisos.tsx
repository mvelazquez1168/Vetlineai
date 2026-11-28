import { Fragment, useEffect, useMemo, useState } from "react";
import { Badge, Button, LoadingState, PageHeader, useToast } from "../../components/ui";
import { useAuth } from "../../hooks/useAuth";
import { clinicaApi, MatrizDeRoles } from "../../lib/clinicaApi";

// ---------------------------------------------------------------------
// ROLES Y PERMISOS — prompt 04, sección 1.
//
// LA MATRIZ ES DEL PRODUCTO Y SE MUESTRA COMPLETA. Lo que puede cada rol
// no es una configuración de la clínica: es parte de lo que el sistema
// es. Mostrarla igual sirve para lo más frecuente, que no es cambiarla
// sino **entenderla**: «¿por qué la recepción no ve los costos?».
//
// SOLO LOS PERMISOS CONFIGURABLES SE PUEDEN TOCAR. Son los que dependen
// de cómo trabaja cada clínica: ver costos, aplicar descuentos, anular,
// ajustar inventario y exportar datos. Los clínicos —escribir y firmar el
// expediente, emitir recetas— no se configuran, y la casilla aparece
// bloqueada con su razón en vez de no aparecer: que no se pueda es
// información, no un error.
//
// LOS NOMBRES DE LOS MÓDULOS son los de la guía rectora, no los de la
// base: «Caja y ventas» y no `caja`.
// ---------------------------------------------------------------------

const NOMBRE_MODULO: Record<string, string> = {
  expediente: "Expediente clínico",
  clientes: "Clientes y pacientes",
  agenda: "Agenda",
  caja: "Caja y ventas",
  inventario: "Inventario",
  facturacion: "Facturación electrónica",
  admin: "Administración",
};

export function RolesPermisos({
  /**
   * Para dibujarla DENTRO de una pestaña (punto 6 del 2026-11-27).
   *
   * El encabezado lo pone el contenedor; repetirlo acá daría dos
   * títulos. Suelta, en su URL vieja, sigue trayendo el suyo.
   */
  sinEncabezado,
}: { sinEncabezado?: boolean } = {}) {
  const { puede } = useAuth();
  const toast = useToast();
  const [matriz, setMatriz] = useState<MatrizDeRoles | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<string | null>(null);

  const puedeConfigurar = puede("clinica.configurar");

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const m = await clinicaApi.roles();
        if (vivo) setMatriz(m);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "No se pudo cargar la matriz.");
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const porModulo = useMemo(() => {
    const grupos = new Map<string, MatrizDeRoles["permisos"]>();
    for (const p of matriz?.permisos ?? []) {
      const lista = grupos.get(p.modulo) ?? [];
      lista.push(p);
      grupos.set(p.modulo, lista);
    }
    return [...grupos.entries()];
  }, [matriz]);

  const concedidos = useMemo(() => new Set(matriz?.concedidos ?? []), [matriz]);
  const cambiados = useMemo(
    () => new Set((matriz?.cambiados ?? []).map((c) => `${c.rol}|${c.permiso}`)),
    [matriz]
  );

  async function alternar(rol: string, permiso: string, estaConcedido: boolean) {
    const llave = `${rol}|${permiso}`;
    setGuardando(llave);
    try {
      await clinicaApi.guardarPermisoDeRol(rol, permiso, !estaConcedido);
      // Se recarga la matriz entera y no se parchea el estado: lo que
      // rige sale de la base y acá se muestra lo que rige. Parchear a
      // mano es cómo una pantalla termina mostrando algo distinto de lo
      // que el backend aplica.
      setMatriz(await clinicaApi.roles());
      toast.exito("Permiso actualizado. Quien tenga la sesión abierta lo ve en un rato.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo cambiar el permiso.");
    } finally {
      setGuardando(null);
    }
  }

  if (cargando || !matriz) return <LoadingState forma="tabla" />;

  return (
    <div className="space-y-6">
      {!sinEncabezado && (
        <PageHeader
          titulo="Roles y permisos"
          subtitulo="Qué puede hacer cada rol. Lo clínico no se configura; lo que depende de cómo trabajan, sí."
          icono="ajustes"
          modulo="admin"
        />
      )}

      <p className="rounded-lg border border-black/5 bg-background/60 p-3 text-sm text-text-muted">
        Las casillas que no se pueden tocar son parte del producto: escribir y firmar el expediente
        es del rol médico, y eso es lo que hace que una firma signifique algo.{" "}
        {puedeConfigurar
          ? "Las demás las podés cambiar y cada cambio queda registrado."
          : "Cambiar las demás lo hace quien tenga el permiso de configurar la clínica."}
      </p>

      <div className="overflow-x-auto rounded-xl border border-black/5 bg-surface">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-black/5 bg-background/60">
              <th className="px-4 py-3 text-xs font-bold uppercase tracking-wide text-primary">
                Permiso
              </th>
              {matriz.roles.map((r) => (
                <th
                  key={r.codigo}
                  className="px-3 py-3 text-center text-xs font-bold uppercase tracking-wide text-primary"
                >
                  <div>{r.nombre}</div>
                  <div className="font-normal normal-case text-text-muted">
                    {r.personas === 0
                      ? "nadie"
                      : `${r.personas} persona${r.personas === 1 ? "" : "s"}`}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {porModulo.map(([modulo, permisos]) => (
              <Fragment key={modulo}>
                <tr className="bg-background/40">
                  <td
                    colSpan={matriz.roles.length + 1}
                    className="px-4 py-2 text-xs font-bold uppercase tracking-wide text-text-muted"
                  >
                    {NOMBRE_MODULO[modulo] ?? modulo}
                  </td>
                </tr>
                {permisos.map((p) => (
                  <tr key={p.codigo} className="border-b border-black/5">
                    <td className="px-4 py-2">
                      <div className="text-text">{p.nombre}</div>
                      <div className="font-mono text-xs text-text-muted">{p.codigo}</div>
                    </td>
                    {matriz.roles.map((r) => {
                      const llave = `${r.codigo}|${p.codigo}`;
                      const tiene = concedidos.has(llave);
                      const loCambiaronAca = cambiados.has(llave);
                      const editable = p.configurable && puedeConfigurar;
                      return (
                        <td key={r.codigo} className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => editable && alternar(r.codigo, p.codigo, tiene)}
                            disabled={!editable || guardando === llave}
                            title={
                              p.configurable
                                ? editable
                                  ? tiene
                                    ? "Quitarle este permiso a este rol"
                                    : "Darle este permiso a este rol"
                                  : "Lo cambia quien pueda configurar la clínica"
                                : "Este permiso es parte del producto y no se configura"
                            }
                            className={`h-6 w-6 rounded border text-xs ${
                              tiene
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-black/10 text-text-muted"
                            } ${editable ? "cursor-pointer hover:bg-primary/20" : "cursor-default"}`}
                          >
                            {tiene ? "✓" : p.configurable ? "" : "·"}
                          </button>
                          {loCambiaronAca && (
                            <div className="mt-0.5 text-[10px] text-text-muted">cambiado</div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-4 text-xs text-text-muted">
        <span>
          <Badge variant="info">✓</Badge> lo tiene
        </span>
        <span>
          <Badge variant="neutral">·</Badge> no lo tiene y no se configura
        </span>
        <span>«cambiado» = lo cambió esta clínica, no es el valor del producto</span>
      </div>

      {puedeConfigurar && (
        <p className="text-xs text-text-muted">
          Un cambio de permisos tarda hasta medio minuto en verse en las sesiones ya abiertas: los
          permisos se guardan en memoria un rato para no consultar la base en cada pantalla.
        </p>
      )}

      <div>
        <Button variant="ghost" onClick={() => window.print()}>
          Imprimir la matriz
        </Button>
      </div>
    </div>
  );
}
