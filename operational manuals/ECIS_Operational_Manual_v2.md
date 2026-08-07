# ECIS Operational Manual — Índice General (ECIS-MANUAL-000)

**Propósito de este documento:** mapa de navegación entre las especificaciones que gobiernan a ECIS. No contiene contenido clínico ni de arquitectura por sí mismo — indica qué documento consultar según la tarea en curso, y documenta explícitamente qué piezas de arquitectura todavía no existen para este agente.

**Versión 2.0** — actualiza el estado de las especificaciones y de la Base de Conocimiento. La versión anterior declaraba como pendientes las seis especificaciones de arquitectura, que ya están construidas y cargadas.

---

## 1. Cómo usar este manual

Cuando trabajes en ECIS, identificá primero la tarea que estás resolviendo y consultá la especificación correspondiente en la tabla de la sección 2. No dupliques contenido entre documentos — cada especificación es la fuente única de verdad para su dominio.

## 2. Mapa de especificaciones — estado actual

| Código | Documento | Estado | Qué define |
|---|---|---|---|
| ECIS-MANUAL-000 | Operational Manual — Índice General | Este documento | Navegación entre el resto de especificaciones |
| ECIS-ARCH-001 | Clinical Components Catalog | Construido | Catálogo de componentes clínicos propios de endocrinología, adaptado desde la familia CC-xxx de ICIS |
| ECIS-DESIGN-001 | Clinical Design System | Construido | Lenguaje visual: colores, tipografía, tarjetas, badges e íconos del dashboard y los informes de ECIS |
| ECIS-REP-001 | Clinical Report Specification | Construido | Estructura, contenido y reglas de generación de los informes clínicos de ECIS |
| ECIS-DASH-001 | Dashboard Functional Specification | Construido | Estructura funcional y comportamiento del dashboard clínico de ECIS |
| ECIS-KB-001 | Knowledge Base Standard | Construido | Reglas para transformar casos clínicos en unidades de conocimiento estructuradas y reutilizables |
| ECIS-AI-001 | AI Reasoning Standard | Pendiente | Estándar de razonamiento clínico del agente: cómo construye diferenciales, expresa incertidumbre y declara información faltante |
| ECIS-KD-001 | Breed Intelligence Knowledge Base Specification | Pendiente | Predisposiciones raciales relevantes para endocrinología, a poblar dentro de la arquitectura general definida en ICIS-KD-001 |
| — | Project Instructions | Construido | System prompt de ECIS. de 17.765 caracteres. Vive en la columna `system_prompt` de la tabla `agentes`. fuera de la Base de Conocimiento |
| — | Manual de Identidad Visual | Pendiente | Aplicación de la marca Vetline Ai. Pendiente también en GCIS |
| — | Referral Engine Specification | No aplica | La derivación hacia ECIS es responsabilidad de ICIS. ECIS no necesita su propio motor de derivación entrante |
| — | Report Composer Engine Specification | Por decidir | Puede ser un motor compartido de plataforma en vez de una versión por agente. La decisión afecta a todos los agentes especializados y sigue abierta |

## 3. Base de Conocimiento — estado actual

6 documentos clínicos: diabetes mellitus, cetoacidosis diabética, enfermedad tiroidea, hiperadrenocorticismo, hipoadrenocorticismo e hipercalcemia.

Más 1 documento de tipo `farmacoterapia`, que extiende la familia CC-3xx de ICIS al dominio de endocrinología.

## 4. Diferencias intencionales respecto al patrón de ICIS

- **Dominio más acotado**: endocrinología cubre menos entidades que otros agentes, y las guías de referencia del campo reconocen cuatro endocrinopatías principales, todas presentes en la Base de Conocimiento.
- **Farmacoterapia con peso en el seguimiento**: a diferencia de las demás extensiones CC-3xx, el valor de la extensión endocrina reside en el Response Tracking y no en el Drug Interaction Engine, porque el error frecuente del dominio no es la interacción entre fármacos sino el ajuste mal fundado de uno solo.
- **Sin motor de derivación propio**: ECIS recibe casos ya derivados por ICIS.

## 5. Pendientes explícitos

### Arquitectura

1. **ECIS-AI-001, ECIS-KD-001 y Manual de Identidad Visual** — las tres piezas que faltan para igualar el conjunto de doce especificaciones de GCIS, que es hoy el agente más completo de la plataforma. Las Project Instructions ya existen como `system_prompt` del agente.

2. **Decisión sobre el Report Composer Engine**: si es un motor compartido de plataforma o si cada agente especializado necesita su propia versión. Afecta a todos los agentes ya creados y sigue sin resolverse.

3. **Colisión de numeración CC-xxx**: GCIS usa CC-103 como Clinical Signs Registry y CC-105 como Nutritional Assessment, mientras ICIS y OCIS usan CC-103 como Signalment Analysis. La colisión es real y conviene resolverla antes de que se propague.

### Base de Conocimiento

1. **Hipotiroidismo canino**: cubierto solo a nivel de marco dentro del documento de enfermedad tiroidea, sin algoritmo diagnóstico ni umbrales. Es la endocrinopatía canina más frecuente y corresponde separarla en documento propio.
2. **Acromegalia felina**: causa relevante de diabetes resistente a insulina, sin cobertura.
3. **Insulinoma e hipoglucemia**: sin cobertura.
