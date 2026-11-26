import { useEffect, useState } from "react";
import { Input, Select } from "./ui";
import { facturacionCrApi } from "../lib/facturacionCrApi";

// ---------------------------------------------------------------------
// Provincia, cantón y distrito de la codificación oficial de Hacienda,
// como tres selectores encadenados, más el barrio.
//
// Existe como componente y no dentro de una pantalla porque LO USAN
// DOS: la ubicación del emisor (Emisor y credenciales) y la del
// receptor (Emitir un comprobante). Son el mismo trío de códigos con la
// misma dependencia entre sí, y mantener dos copias de la lógica de
// encadenado es exactamente la clase de duplicación que se desincroniza
// sin que nada falle.
//
// EL BARRIO VA COMO TEXTO, no como selector: en la versión 4.4 el campo
// `Barrio` del XML es texto libre de 5 a 50 caracteres (cambió respecto
// de 4.3, donde era un código). Se ofrece la lista oficial en un
// `datalist` para sugerir, pero se puede escribir cualquier cosa,
// porque eso es lo que el XSD admite.
//
// Al cambiar un nivel se limpian los de abajo, siempre. Sin eso, elegir
// San José / Escazú / San Rafael y después cambiar la provincia a Limón
// dejaría "San Rafael" seleccionado en una provincia donde ese distrito
// no existe, y el rechazo llegaría de la base.
// ---------------------------------------------------------------------

export interface ValorUbicacion {
  provincia?: string | null;
  canton?: string | null;
  distrito?: string | null;
  barrio?: string | null;
}

interface Props {
  valor: ValorUbicacion;
  onChange: (valor: ValorUbicacion) => void;
  disabled?: boolean;
  /** Para distinguir los `id` cuando hay dos en la misma pantalla. */
  idPrefijo?: string;
  /** El barrio no siempre se pide (el receptor de un tiquete, por ejemplo). */
  conBarrio?: boolean;
}

type Opcion = { codigo: string; nombre: string };

export function SelectorUbicacion({
  valor,
  onChange,
  disabled = false,
  idPrefijo = "ubic",
  conBarrio = true,
}: Props) {
  const [provincias, setProvincias] = useState<Opcion[]>([]);
  const [cantones, setCantones] = useState<Opcion[]>([]);
  const [distritos, setDistritos] = useState<Opcion[]>([]);
  const [barrios, setBarrios] = useState<Opcion[]>([]);
  const [vacio, setVacio] = useState(false);

  useEffect(() => {
    facturacionCrApi
      .ubicacion()
      .then((r) => {
        setProvincias(r.resultados);
        setVacio(r.catalogoVacio);
      })
      .catch(() => setProvincias([]));
  }, []);

  useEffect(() => {
    if (!valor.provincia) {
      setCantones([]);
      return;
    }
    facturacionCrApi
      .ubicacion({ provincia: valor.provincia })
      .then((r) => setCantones(r.resultados))
      .catch(() => setCantones([]));
  }, [valor.provincia]);

  useEffect(() => {
    if (!valor.provincia || !valor.canton) {
      setDistritos([]);
      return;
    }
    facturacionCrApi
      .ubicacion({ provincia: valor.provincia, canton: valor.canton })
      .then((r) => setDistritos(r.resultados))
      .catch(() => setDistritos([]));
  }, [valor.provincia, valor.canton]);

  useEffect(() => {
    if (!conBarrio || !valor.provincia || !valor.canton || !valor.distrito) {
      setBarrios([]);
      return;
    }
    facturacionCrApi
      .ubicacion({ provincia: valor.provincia, canton: valor.canton, distrito: valor.distrito })
      .then((r) => setBarrios(r.resultados))
      .catch(() => setBarrios([]));
  }, [conBarrio, valor.provincia, valor.canton, valor.distrito]);

  const opciones = (lista: Opcion[], vacioTexto: string) => [
    { value: "", label: vacioTexto },
    ...lista.map((o) => ({ value: o.codigo, label: o.nombre })),
  ];

  if (vacio) {
    return (
      <div className="sm:col-span-2 lg:col-span-4 rounded-xl border border-black/5 bg-surface p-3 text-sm text-text-muted">
        La codificación de ubicación de Hacienda no está cargada en este servidor. La carga{" "}
        <code>npm run cargar-catalogos-fe</code>.
      </div>
    );
  }

  const listaBarrios = `${idPrefijo}-barrios`;

  return (
    <>
      <Select
        label="Provincia"
        id={`${idPrefijo}-provincia`}
        value={valor.provincia ?? ""}
        disabled={disabled}
        options={opciones(provincias, "Elegí una provincia")}
        onChange={(e) =>
          onChange({ provincia: e.target.value, canton: "", distrito: "", barrio: "" })
        }
      />
      <Select
        label="Cantón"
        id={`${idPrefijo}-canton`}
        value={valor.canton ?? ""}
        disabled={disabled || !valor.provincia}
        options={opciones(cantones, valor.provincia ? "Elegí un cantón" : "Elegí la provincia primero")}
        onChange={(e) =>
          onChange({ ...valor, canton: e.target.value, distrito: "", barrio: "" })
        }
      />
      <Select
        label="Distrito"
        id={`${idPrefijo}-distrito`}
        value={valor.distrito ?? ""}
        disabled={disabled || !valor.canton}
        options={opciones(distritos, valor.canton ? "Elegí un distrito" : "Elegí el cantón primero")}
        onChange={(e) => onChange({ ...valor, distrito: e.target.value, barrio: "" })}
      />
      {conBarrio && (
        <>
          <Input
            label="Barrio"
            id={`${idPrefijo}-barrio`}
            list={listaBarrios}
            value={valor.barrio ?? ""}
            disabled={disabled}
            maxLength={50}
            placeholder={barrios.length > 0 ? "Elegí o escribí" : "Barrio Escalante"}
            onChange={(e) => onChange({ ...valor, barrio: e.target.value })}
          />
          <datalist id={listaBarrios}>
            {barrios.map((b) => (
              <option key={b.codigo} value={b.nombre} />
            ))}
          </datalist>
        </>
      )}
    </>
  );
}
