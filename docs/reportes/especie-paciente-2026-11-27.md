# Arreglo corto — la especie del paciente, en un solo vocabulario

Rama `fix/especie-paciente-y-raza`, partiendo de la rama del 12. Migración **165**.
Verificador `verificar_especie_y_raza.ts`: **TODO OK**, 36 aserciones.

## El defecto, y por qué era más grande de lo que parecía

Reportado así: editar la ficha de **Kira (Canino, Golden Retriever)** contestaba *«La raza
seleccionada no corresponde a la especie indicada»*.

La raza no tenía nada que ver. `pacientes.especie` era texto libre y la base tenía **cinco
escrituras del mismo concepto**:

| Valor | Pacientes |
|---|---|
| `perro` | 45 |
| `gato` | 32 |
| `Canino` | 16 |
| `Felino` | 3 |
| `canino` | 1 |

El cruce con `razas.especie` (`especiePaciente.ts`) aceptaba **exactamente** `Canino` y `Felino`, así
que **78 de 97 pacientes no podían guardar su raza**. Y el mensaje culpaba al usuario de un
desajuste nuestro.

Una de las fuentes de `perro`/`gato` era mía: el generador de historial del prompt 12, de ayer.
Quedó corregido.

## Cómo quedó resuelto: por tres lados, no por uno

Arreglar solo la comparación habría dejado los datos sucios; arreglar solo los datos habría dejado
que el próximo alta los vuelva a ensuciar.

1. **La comparación tolera** mayúsculas, tildes, espacios y sinónimos. `especieCanonica()` tiene la
   lista de las formas reales —«canino», «canina», «perro», «perra», «cachorro», «gato», «gata»,
   «minino»…— en un solo lugar.
2. **La escritura normaliza.** El `POST` y el `PATCH` de pacientes guardan el vocabulario único, así
   que lo que entre como «perro» queda como «Canino».
3. **La migración 165 normaliza lo existente.** Las 97 filas quedaron en `Canino` (62) y `Felino`
   (35).

## Las dos decisiones que vale explicar

**Lo que no se reconoce devuelve `null`, no «Canino».** Era el segundo defecto, y el más silencioso:
un `<select>` cuyo valor no coincide con ninguna opción muestra **la primera**, así que un paciente
registrado como «perro» —o como «Equino»— aparecía en la pantalla como **Canino**, y guardar la ficha
**le cambiaba la especie al animal** sin que nadie se enterara. Ahora:

- el selector agrega la especie guardada como opción, etiquetada *«(como está registrado)»*;
- el combobox de razas **no aparece** y en su lugar se explica que hay que elegir Canino o Felino
  para poder elegir la raza. Mostrar razas caninas para un paciente cuya especie dice otra cosa es
  cómo se llegó al defecto.

**No se agregó un `CHECK (especie IN ('Canino','Felino'))`.** Convertiría cualquier especie futura
—un conejo, un ave, un equino— en un error de base de datos en vez de un dato nuevo, y Vetline ya
tiene clínicas que atienden más que perros y gatos. Lo que gobierna es `especieCanonica()`: traduce
lo que reconoce y **deja pasar tal cual lo que no**.

## Qué se verificó

| Qué | Cómo |
|---|---|
| 8 formas de escribir «Canino» y 7 de «Felino» se reconocen | verificador |
| 7 textos que no son ninguna de las dos devuelven `null`, no «Canino» | idem |
| **Ninguna fila de `pacientes.especie` quedó fuera del vocabulario** | idem, contra la base |
| Un golden retriever se guarda con la especie escrita «Canino», «canino», «perro» o «canina» | idem, con la raza real del catálogo y la **misma función que llama la ruta** |
| **Una raza felina en un perro sigue rechazándose** | idem: tolerar no es dejar pasar cualquier cosa |
| El mensaje dice de qué especie es la raza, en vez de culpar al usuario | idem |
| Un alta que manda «perro» queda guardada como «Canino» | idem, leyendo la fila insertada |
| Sin regresiones | `rutas_unicas` **TODO OK**; `tsc --noEmit` limpio en los dos lados |

**No se probó en el navegador ni por HTTP.** Lo que está probado es `validarRazaParaEspecie` —la
función exacta que llama el endpoint—, la normalización al escribir leyendo la fila guardada, y el
estado de las 97 filas de la base. El recorrido en pantalla sobre la ficha de Kira queda pendiente.
