import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, CardDescription, CardTitle, Icono, useToast } from "../ui";
import { navegadorSoportaDictado, useDictado } from "../ui/DictadoVoz";
import { BorradorDictado, Dictado, dictadoApi, EstadoDictado } from "../../lib/dictadoApi";

// ---------------------------------------------------------------------
// DICTAR LA CONSULTA COMPLETA — prompt 07d, fase 2.
//
// La fase 1 dicta UN campo: se toca el micrófono del campo y el texto
// cae ahí. Esto es otra cosa: el médico habla de corrido —motivo,
// signos, examen, diagnóstico, tratamiento, control, estudios— y el
// sistema reparte.
//
// LO QUE MANDA SOBRE EL DISEÑO DE ESTA PANTALLA:
//
//   1. TODO LO QUE PROPONE LA IA ESTÁ MARCADO Y SE VE. Fondo distinto,
//      etiqueta «Propuesto por dictado», y una casilla por grupo. Nada
//      entra al expediente sin que el médico tilde.
//   2. «REVISAR» ES VISIBLE Y NO SE PUEDE TILDAR POR ERROR. Lo que la
//      IA no entendió viene vacío y marcado; el grupo arranca sin
//      tildar, y para aceptarlo hay que decidirlo.
//   3. EL TEXTO LITERAL ESTÁ A LA VISTA. Si el reparto salió mal, el
//      médico tiene que poder leer qué dijo sin salir de acá.
//   4. LO QUE ESTO NO HACE: no firma, no cobra y no agenda. Acepta
//      campos de la atención en borrador, y nada más.
//
// POR QUÉ SE GRABA Y ADEMÁS SE ESCUCHA CON LA WEB SPEECH API: el
// proveedor de transcripción de desarrollo es simulado y necesita un
// texto de entrada (ver `transcripcion.ts`). El navegador ya sabe
// reconocer español, así que se usa eso. Con el proveedor real esta
// parte sobra y el audio basta — que es justamente lo que hace que
// funcione en iPhone, donde la Web Speech API no está.
// ---------------------------------------------------------------------

interface Props {
  atencionId: string;
  /** La atención cerrada no se dicta: lo que falte va en una adenda. */
  cerrada: boolean;
  esMedico: boolean;
  /** Para recargar la atención cuando el borrador se aplica. */
  onAplicado: () => void;
}

/** Los grupos del borrador, en el orden en que se revisan. */
export interface GrupoDelBorrador {
  campo: string;
  titulo: string;
  /** Null cuando el dictado no trajo nada para este grupo. */
  contenido: React.ReactNode | null;
  revisar: string[];
}


// ---------------------------------------------------------------------
// «revisar» EN CASTELLANO, NO EN NOMBRES DE CAMPO
//
// El modelo devuelve las claves con las que trabaja: «receta[0].via»,
// «estudios[0].tipo_estudio», «dosis». Eso sirve para el código y no
// para el médico, que ve un nombre interno y no sabe qué mirar.
//
// Encontrado mirando la pantalla, no leyendo el código: el primer
// borrador real decía «Hay 2 cosas que no se entendieron: receta[0].via
// · estudios[0].tipo_estudio».
//
// Lo que NO se reconoce se muestra tal cual, sin inventarle una
// traducción: es texto del modelo y puede ser una frase entera.
// ---------------------------------------------------------------------
const CAMPOS_EN_CASTELLANO: Record<string, string> = {
  dosis: "la dosis",
  dosis_cantidad: "la dosis",
  via: "la vía de administración",
  frecuencia: "la frecuencia",
  duracion: "la duración",
  nombre: "el medicamento",
  nombre_dicho: "el medicamento",
  tipo_estudio: "qué estudio es",
  motivo_consulta: "el motivo de consulta",
  anamnesis: "la anamnesis",
  temperatura: "la temperatura",
  peso: "el peso",
  frecuencia_cardiaca: "la frecuencia cardiaca",
  frecuencia_respiratoria: "la frecuencia respiratoria",
  condicion_corporal: "la condición corporal",
  control_dias: "en cuántos días es el control",
  control_motivo: "el motivo del control",
  plan_tratamiento: "el tratamiento",
  indicaciones_cliente: "las indicaciones al cliente",
  hallazgo: "el hallazgo",
};

const GRUPOS_EN_CASTELLANO: Record<string, string> = {
  receta: "la receta",
  estudios: "los estudios",
  signos: "los signos",
  sistemas: "el examen por sistemas",
  diagnosticos: "la evaluación",
};

export function revisarEnCastellano(clave: string): string {
  // «receta[0].via» -> grupo «receta», campo «via».
  const partes = clave.split(".");
  const campo = partes[partes.length - 1].trim();
  const traducido = CAMPOS_EN_CASTELLANO[campo];
  if (!traducido) return clave;
  if (partes.length === 1) return traducido;
  const grupo = GRUPOS_EN_CASTELLANO[partes[0].replace(/\[\d+\]$/, "")];
  return grupo ? `${traducido} (${grupo})` : traducido;
}

export function DictadoConsulta({ atencionId, cerrada, esMedico, onAplicado }: Props) {
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoDictado | null>(null);
  const [dictado, setDictado] = useState<Dictado | null>(null);
  const [grabando, setGrabando] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [verTexto, setVerTexto] = useState(false);

  const grabador = useRef<MediaRecorder | null>(null);
  const trozos = useRef<Blob[]>([]);
  const cronometro = useRef<number | null>(null);
  const pista = useRef<MediaStream | null>(null);

  // El texto que va reconociendo el navegador, para el proveedor
  // simulado. En una ref y no en estado: lo lee el `onstop` del
  // grabador, que es un closure creado al empezar a grabar.
  const textoReconocido = useRef("");
  const [textoEnVivo, setTextoEnVivo] = useState("");
  const vozDelNavegador = useDictado(
    () => "",
    (valor) => {
      textoReconocido.current = valor;
      setTextoEnVivo(valor);
    }
  );

  useEffect(() => {
    let vivo = true;
    dictadoApi
      .estado()
      .then((e) => vivo && setEstado(e))
      // Que no se pueda leer el estado no puede romper la atención: el
      // dictado simplemente no aparece.
      .catch(() => vivo && setEstado(null));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    let vivo = true;
    dictadoApi
      .deLaAtencion(atencionId)
      .then((r) => {
        if (!vivo) return;
        setDictado(r.dictado);
        if (r.dictado?.borrador) setAbierto(true);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [atencionId]);

  // El micrófono se cierra pase lo que pase, igual que en la fase 1.
  useEffect(() => {
    return () => {
      if (cronometro.current) window.clearInterval(cronometro.current);
      grabador.current?.state === "recording" && grabador.current.stop();
      pista.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const marcarPorOmision = useCallback((borrador: BorradorDictado, grupos: GrupoDelBorrador[]) => {
    // SE TILDA LO QUE TIENE CONTENIDO Y NO TIENE NADA QUE REVISAR. Lo
    // que hay que revisar arranca sin tildar: tildarlo por omisión sería
    // invitar a aceptar sin leer justo lo que no se entendió.
    const inicial = new Set<string>();
    for (const g of grupos) {
      if (g.contenido && g.revisar.length === 0) inicial.add(g.campo);
    }
    // «El resto normal» nunca arranca tildado: es la única parte del
    // borrador que afirma algo que el médico no dijo sistema por
    // sistema.
    inicial.delete("resto_normal");
    void borrador;
    return inicial;
  }, []);

  async function empezar() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      pista.current = stream;
      trozos.current = [];
      textoReconocido.current = "";
      setTextoEnVivo("");
      const mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) trozos.current.push(e.data);
      };
      mr.onstop = () => {
        pista.current?.getTracks().forEach((t) => t.stop());
        pista.current = null;
        void enviar(new Blob(trozos.current, { type: mr.mimeType || "audio/webm" }));
      };
      grabador.current = mr;
      mr.start();
      setGrabando(true);
      setSegundos(0);
      cronometro.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
      // El reconocimiento del navegador corre en paralelo solo si hace
      // falta (proveedor simulado) y si el navegador lo tiene.
      if (estado?.necesitaTextoDelNavegador && navegadorSoportaDictado()) {
        vozDelNavegador.alternar();
      }
    } catch {
      toast.error("No se pudo acceder al micrófono. Revise los permisos del navegador.");
    }
  }

  function detener() {
    if (cronometro.current) {
      window.clearInterval(cronometro.current);
      cronometro.current = null;
    }
    if (vozDelNavegador.grabando) vozDelNavegador.alternar();
    setGrabando(false);
    if (grabador.current?.state === "recording") grabador.current.stop();
  }

  async function enviar(audio: Blob) {
    setProcesando(true);
    try {
      const r = await dictadoApi.transcribir(atencionId, {
        audio,
        texto: textoReconocido.current || null,
        segundos,
      });
      setDictado(r.dictado);
      setAbierto(true);
      if (r.aviso) toast.error(r.aviso);
      else toast.exito("Dictado ordenado. Revise el borrador antes de aceptarlo.");
    } catch (err) {
      toast.error((err as Error).message ?? "No se pudo procesar el dictado.");
    } finally {
      setProcesando(false);
    }
  }

  async function aceptar() {
    if (!dictado) return;
    const campos = [...marcados];
    if (campos.length === 0) {
      toast.error("No hay nada marcado para aceptar.");
      return;
    }
    try {
      const r = await dictadoApi.aplicar(dictado.id, campos);
      if (r.problemas.length > 0) {
        // LOS PROBLEMAS SE MUESTRAN TAL CUAL. Si una línea de receta no
        // entró porque el 07c la rechazó, el médico necesita el motivo,
        // no un «no se pudo».
        toast.error(r.problemas.map((p) => `${p.campo}: ${p.detalle}`).join(" · "));
      } else {
        toast.exito(`Se aceptó ${r.aplicados.length === 1 ? "1 grupo" : `${r.aplicados.length} grupos`}.`);
      }
      setAbierto(false);
      onAplicado();
      const actualizado = await dictadoApi.deLaAtencion(atencionId);
      setDictado(actualizado.dictado);
    } catch (err) {
      toast.error((err as Error).message ?? "No se pudo aceptar el borrador.");
    }
  }

  async function descartar() {
    if (!dictado) return;
    try {
      await dictadoApi.descartar(dictado.id);
      setDictado(null);
      setAbierto(false);
      toast.exito("Borrador descartado. El texto dictado queda guardado como respaldo.");
    } catch (err) {
      toast.error((err as Error).message ?? "No se pudo descartar el dictado.");
    }
  }

  // --- Qué se dibuja --------------------------------------------------

  // Si la clínica no lo tiene activo, acá no hay nada: el control que no
  // existe no se dibuja apagado (misma regla que el botón de la fase 1).
  if (!estado?.activo || !esMedico || cerrada) return null;

  const grupos = dictado?.borrador ? gruposDelBorrador(dictado.borrador) : [];
  const yaAplicados = new Set(dictado?.camposAplicados ?? []);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle>Dictar la consulta</CardTitle>
          <CardDescription>
            Hable de corrido: motivo, signos, examen, diagnóstico, tratamiento y control. La IA lo
            ordena como <strong>borrador</strong>; nada se registra hasta que usted lo acepte.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!estado.proveedorListo && (
            <Badge variant="warning">{estado.motivoNoListo ?? "Proveedor no disponible"}</Badge>
          )}
          {grabando ? (
            <Button onClick={detener}>
              <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-sobre-primary" />
              Detener ({Math.floor(segundos / 60)}:{String(segundos % 60).padStart(2, "0")})
            </Button>
          ) : (
            <Button onClick={() => void empezar()} disabled={procesando || !estado.proveedorListo}>
              <Icono nombre="microfono" tamano={16} className="mr-2" />
              {procesando ? "Procesando…" : "Dictar la consulta"}
            </Button>
          )}
        </div>
      </div>

      {grabando && (
        <div className="mt-3 rounded-lg border border-error/30 bg-error/5 p-3">
          <p className="text-xs font-semibold text-error">
            Micrófono abierto. Toque «Detener» cuando termine de dictar.
          </p>
          {textoEnVivo && <p className="mt-2 text-sm text-text-primary">{textoEnVivo}</p>}
        </div>
      )}

      {procesando && (
        <p className="mt-3 text-sm text-text-muted">
          Transcribiendo y ordenando el dictado… puede tardar unos segundos.
        </p>
      )}

      {dictado && !grabando && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="info">Propuesto por dictado</Badge>
            <span className="text-xs text-text-muted">
              {Math.round(dictado.segundosAudio)} s de audio · proveedor {dictado.proveedor}
              {dictado.costoUsd !== null && dictado.costoUsd > 0
                ? ` · ${dictado.costoUsd.toFixed(4)} USD de transcripción`
                : ""}
            </span>
            <button
              type="button"
              className="text-xs font-semibold text-primary underline"
              onClick={() => setVerTexto((v) => !v)}
            >
              {verTexto ? "Ocultar lo que dicté" : "Ver lo que dicté"}
            </button>
            {dictado.borrador && (
              <button
                type="button"
                className="text-xs font-semibold text-primary underline"
                onClick={() => setAbierto((a) => !a)}
              >
                {abierto ? "Ocultar el borrador" : "Ver el borrador"}
              </button>
            )}
          </div>

          {verTexto && (
            <div className="rounded-lg border border-black/10 bg-black/5 p-3">
              <p className="whitespace-pre-wrap text-sm text-text-primary">{dictado.textoTranscrito}</p>
              <p className="mt-2 text-xs text-text-muted">
                Este es el texto literal del dictado. Se conserva como respaldo aunque el borrador se
                acepte o se descarte.
              </p>
            </div>
          )}

          {abierto && dictado.borrador && (
            <BorradorRevisable
              grupos={grupos}
              borrador={dictado.borrador}
              marcados={marcados}
              yaAplicados={yaAplicados}
              onMarcar={(campo) =>
                setMarcados((m) => {
                  const nuevo = new Set(m);
                  nuevo.has(campo) ? nuevo.delete(campo) : nuevo.add(campo);
                  return nuevo;
                })
              }
              onTildarSugeridos={() => setMarcados(marcarPorOmision(dictado.borrador!, grupos))}
              onAceptar={() => void aceptar()}
              onDescartar={() => void descartar()}
            />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// EL BORRADOR, GRUPO POR GRUPO
// ---------------------------------------------------------------------
function BorradorRevisable({
  grupos,
  borrador,
  marcados,
  yaAplicados,
  onMarcar,
  onTildarSugeridos,
  onAceptar,
  onDescartar,
}: {
  grupos: GrupoDelBorrador[];
  borrador: BorradorDictado;
  marcados: Set<string>;
  yaAplicados: Set<string>;
  onMarcar: (campo: string) => void;
  onTildarSugeridos: () => void;
  onAceptar: () => void;
  onDescartar: () => void;
}) {
  const conContenido = grupos.filter((g) => g.contenido !== null);

  return (
    <div className="rounded-lg border-2 border-info/40 bg-info/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text-primary">
          Revise y marque lo que quiere registrar
        </p>
        <Button variant="secondary" onClick={onTildarSugeridos}>
          Marcar lo que está completo
        </Button>
      </div>

      {borrador.revisar.length > 0 && (
        <div className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2">
          <p className="text-xs font-semibold text-warning">
            Hay {borrador.revisar.length === 1 ? "1 cosa" : `${borrador.revisar.length} cosas`} que no
            se entendieron del dictado y quedaron sin completar:
          </p>
          <p className="mt-1 text-xs text-text-primary">
            {borrador.revisar.map(revisarEnCastellano).join(" · ")}
          </p>
        </div>
      )}

      {conContenido.length === 0 && (
        <p className="mt-3 text-sm text-text-muted">
          El dictado no se pudo repartir en ningún campo. Lea lo que dictó y escríbalo a mano, o
          dicte de nuevo con más detalle.
        </p>
      )}

      <div className="mt-3 space-y-2">
        {conContenido.map((g) => {
          const aplicado = yaAplicados.has(g.campo);
          return (
            <label
              key={g.campo}
              className={[
                "flex cursor-pointer gap-3 rounded-md border p-2",
                aplicado
                  ? "border-success/40 bg-success/5"
                  : marcados.has(g.campo)
                    ? "border-primary/40 bg-white"
                    : "border-black/10 bg-white/60",
              ].join(" ")}
            >
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={marcados.has(g.campo)}
                disabled={aplicado}
                onChange={() => onMarcar(g.campo)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary">{g.titulo}</span>
                  {aplicado && <Badge variant="success">Ya registrado</Badge>}
                  {g.revisar.length > 0 && (
                    <Badge variant="warning">
                      Revisar: {g.revisar.map(revisarEnCastellano).join(", ")}
                    </Badge>
                  )}
                </div>
                <div className="mt-1 text-sm text-text-primary">{g.contenido}</div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button variant="secondary" onClick={onDescartar}>
          Descartar el borrador
        </Button>
        <Button onClick={onAceptar} disabled={marcados.size === 0}>
          Aceptar lo marcado
        </Button>
      </div>
      <p className="mt-2 text-right text-xs text-text-muted">
        Aceptar no firma ni cobra nada: la atención se cierra aparte, como siempre.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// De borrador a grupos revisables.
//
// Función aparte —y exportada— para que el orden de revisión y qué
// cuenta como «hay contenido» se lean en un solo lugar, en vez de
// quedar desparramados en el JSX del panel.
// ---------------------------------------------------------------------
export function gruposDelBorrador(b: BorradorDictado): GrupoDelBorrador[] {
  const signos: string[] = [];
  if (b.signos.temperatura !== null) signos.push(`${b.signos.temperatura} °C`);
  if (b.signos.frecuenciaCardiaca !== null) signos.push(`${b.signos.frecuenciaCardiaca} lpm`);
  if (b.signos.frecuenciaRespiratoria !== null) signos.push(`${b.signos.frecuenciaRespiratoria} rpm`);
  if (b.signos.peso !== null) signos.push(`${b.signos.peso} kg`);
  if (b.signos.condicionCorporal !== null) signos.push(`condición corporal ${b.signos.condicionCorporal}/9`);

  const revisarDe = (prefijo: string) =>
    b.revisar.filter((r) => r.toLowerCase().includes(prefijo)).map((r) => r);

  return [
    {
      campo: "motivo_consulta",
      titulo: "Motivo de consulta",
      contenido: b.motivoConsulta,
      revisar: revisarDe("motivo"),
    },
    {
      campo: "anamnesis",
      titulo: "Anamnesis",
      contenido: b.anamnesis,
      revisar: revisarDe("anamnesis"),
    },
    {
      campo: "signos",
      titulo: "Signos",
      contenido: signos.length > 0 ? signos.join(" · ") : null,
      revisar: revisarDe("signo"),
    },
    {
      campo: "sistemas",
      titulo: "Examen por sistemas",
      contenido:
        b.sistemas.length > 0 ? (
          <ul className="list-disc pl-4">
            {b.sistemas.map((s) => (
              <li key={s.sistema}>
                <strong>{s.etiqueta}</strong>: {s.estado === "anormal" ? "anormal" : "normal"}
                {s.hallazgo ? ` — ${s.hallazgo}` : ""}
              </li>
            ))}
          </ul>
        ) : null,
      revisar: revisarDe("hallazgo"),
    },
    {
      campo: "resto_normal",
      titulo: "Marcar el resto de los sistemas como normales",
      contenido: b.restoNormal
        ? "Dijo «el resto normal». Se propone marcar Normal los sistemas que no nombró."
        : null,
      // No lleva «revisar» pero sí arranca sin tildar: ver
      // marcarPorOmision.
      revisar: [],
    },
    {
      campo: "diagnosticos",
      titulo: "Evaluación",
      contenido:
        b.diagnosticos.length > 0 ? (
          <ul className="list-disc pl-4">
            {b.diagnosticos.map((d, i) => (
              <li key={i}>
                {d.descripcion} <span className="text-text-muted">({d.tipo})</span>
              </li>
            ))}
          </ul>
        ) : null,
      revisar: revisarDe("diagn"),
    },
    {
      campo: "plan_tratamiento",
      titulo: "Plan de tratamiento",
      contenido: b.planTratamiento,
      revisar: revisarDe("tratamiento"),
    },
    {
      campo: "indicaciones_cliente",
      titulo: "Indicaciones al cliente",
      contenido: b.indicacionesCliente,
      revisar: revisarDe("indicacion"),
    },
    {
      campo: "control",
      titulo: "Control",
      contenido:
        b.controlDias !== null
          ? `En ${b.controlDias} ${b.controlDias === 1 ? "día" : "días"}${
              b.controlMotivo ? ` — ${b.controlMotivo}` : ""
            }. Se propone la fecha; la cita la agenda el cierre.`
          : null,
      revisar: revisarDe("control"),
    },
    {
      campo: "receta",
      titulo: "Receta",
      contenido:
        b.receta.length > 0 ? (
          <ul className="space-y-1">
            {b.receta.map((l, i) => (
              <li key={i} className="rounded border border-black/10 bg-white p-2">
                <div className="font-semibold">
                  {l.nombreEnCatalogo ?? l.nombreDicho}
                  {!l.nombreEnCatalogo && (
                    <span className="ml-2 text-xs font-normal text-text-muted">
                      (no está en el catálogo: va como texto libre)
                    </span>
                  )}
                </div>
                <div className="text-xs text-text-muted">
                  {[
                    l.dosisCantidad !== null
                      ? `${l.dosisCantidad} ${l.dosisUnidad ?? ""}${l.dosisPorKg ? "/kg" : ""}`
                      : "dosis sin definir",
                    l.viaCodigo ?? "vía sin definir",
                    l.frecuenciaCodigo ?? "frecuencia sin definir",
                    l.duracionCantidad !== null
                      ? `${l.duracionCantidad} ${l.duracionUnidad ?? "dias"}`
                      : "duración sin definir",
                  ].join(" · ")}
                </div>
                {l.explicacionDosis && (
                  <div className="mt-1 text-xs font-semibold text-text-primary">
                    {l.explicacionDosis}
                    {/* SI EL PESO VIENE DEL DICTADO HAY QUE DECIRLO: la
                        cuenta es correcta, pero el expediente todavia
                        tiene el peso de la visita anterior hasta que se
                        acepte el grupo Signos. */}
                    {l.pesoDelDictado && (
                      <span className="ml-1 font-normal text-text-muted">
                        — con el peso dictado ({l.pesoUsadoKg} kg), que se registra al aceptar «Signos»
                      </span>
                    )}
                  </div>
                )}
                {l.revisar.length > 0 && (
                  <Badge variant="warning">Revisar: {l.revisar.map(revisarEnCastellano).join(", ")}</Badge>
                )}
                {l.avisos.map((av, j) => (
                  <p key={j} className="mt-1 text-xs font-semibold text-error">
                    Alergia registrada ({av.porque}, {av.severidad}): {av.detalle}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        ) : null,
      revisar: b.receta.flatMap((l) => l.revisar),
    },
    {
      campo: "estudios",
      titulo: "Estudios",
      contenido:
        b.estudios.length > 0 ? (
          <ul className="list-disc pl-4">
            {b.estudios.map((e, i) => (
              <li key={i}>
                {e.tipoEstudio}
                {e.observaciones ? ` — ${e.observaciones}` : ""}
                <span className="ml-1 text-xs text-text-muted">(sin servicio: no genera cargo)</span>
              </li>
            ))}
          </ul>
        ) : null,
      revisar: revisarDe("estudio"),
    },
  ];
}
