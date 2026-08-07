# NCIS Operational Manual — Índice General (NCIS-MANUAL-000)

**Propósito de este documento:** mapa de navegación entre las especificaciones que gobiernan a NCIS. No contiene contenido clínico ni de arquitectura por sí mismo — indica qué documento consultar según la tarea en curso, y documenta explícitamente qué piezas de arquitectura todavía no existen para este agente.

**Versión 2.0** — actualiza el estado de las especificaciones y de la Base de Conocimiento. La versión anterior declaraba como pendientes las seis especificaciones de arquitectura, que ya están construidas y cargadas.

---

## 1. Cómo usar este manual

Cuando trabajes en NCIS, identificá primero la tarea que estás resolviendo y consultá la especificación correspondiente en la tabla de la sección 2. No dupliques contenido entre documentos — cada especificación es la fuente única de verdad para su dominio.

## 2. Mapa de especificaciones — estado actual

| Código | Documento | Estado | Qué define |
|---|---|---|---|
| NCIS-MANUAL-000 | Operational Manual — Índice General | Este documento | Navegación entre el resto de especificaciones |
| NCIS-ARCH-001 | Clinical Components Catalog | Construido | Catálogo de componentes clínicos propios de neurología y ortopedia, adaptado desde la familia CC-xxx de ICIS |
| NCIS-DESIGN-001 | Clinical Design System | Construido | Lenguaje visual: colores, tipografía, tarjetas, badges e íconos del dashboard y los informes de NCIS |
| NCIS-REP-001 | Clinical Report Specification | Construido | Estructura, contenido y reglas de generación de los informes clínicos de NCIS |
| NCIS-DASH-001 | Dashboard Functional Specification | Construido | Estructura funcional y comportamiento del dashboard clínico de NCIS |
| NCIS-KB-001 | Knowledge Base Standard | Construido | Reglas para transformar casos clínicos en unidades de conocimiento estructuradas y reutilizables |
| NCIS-AI-001 | AI Reasoning Standard | Pendiente | Estándar de razonamiento clínico del agente: cómo construye diferenciales, expresa incertidumbre y declara información faltante |
| NCIS-KD-001 | Breed Intelligence Knowledge Base Specification | Pendiente | Predisposiciones raciales relevantes para neurología y ortopedia, a poblar dentro de la arquitectura general definida en ICIS-KD-001 |
| — | Project Instructions | Construido | System prompt de NCIS. de 14.715 caracteres. Vive en la columna `system_prompt` de la tabla `agentes`. fuera de la Base de Conocimiento |
| — | Manual de Identidad Visual | Pendiente | Aplicación de la marca Vetline Ai. Pendiente también en GCIS |
| — | Referral Engine Specification | No aplica | La derivación hacia NCIS es responsabilidad de ICIS. NCIS no necesita su propio motor de derivación entrante |
| — | Report Composer Engine Specification | Por decidir | Puede ser un motor compartido de plataforma en vez de una versión por agente. La decisión afecta a todos los agentes especializados y sigue abierta |

## 3. Base de Conocimiento — estado actual

12 documentos clínicos: epilepsia canina, status epilepticus, epilepsia felina, meningoencefalitis de origen desconocido, SRMA, síndrome vestibular, trauma craneoencefálico, enfermedad discal, espondilomielopatía cervical, mielopatía degenerativa, osteoartritis y ligamento cruzado craneal.

Más 1 documento de tipo `farmacoterapia`, que extiende la familia CC-3xx de ICIS al dominio de neurología y ortopedia.

## 4. Diferencias intencionales respecto al patrón de ICIS

- **Dominio doble**: NCIS cubre neurología y ortopedia. Esa amplitud es intencional y se refleja en la Base de Conocimiento, que incluye osteoartritis y ligamento cruzado craneal junto a las entidades neurológicas.
- **Sin motor de derivación propio**: NCIS recibe casos ya derivados por ICIS.
- **Farmacoterapia propia**: la extensión neurológica y ortopédica de la familia CC-3xx incluye el patrón de sensibilidad ABCB1, cuyo alcance excede a este agente y conviene resolver a nivel de plataforma.

## 5. Pendientes explícitos

### Arquitectura

1. **NCIS-AI-001, NCIS-KD-001 y Manual de Identidad Visual** — las tres piezas que faltan para igualar el conjunto de doce especificaciones de GCIS, que es hoy el agente más completo de la plataforma. Las Project Instructions ya existen como `system_prompt` del agente.

2. **Decisión sobre el Report Composer Engine**: si es un motor compartido de plataforma o si cada agente especializado necesita su propia versión. Afecta a todos los agentes ya creados y sigue sin resolverse.

3. **Colisión de numeración CC-xxx**: GCIS usa CC-103 como Clinical Signs Registry y CC-105 como Nutritional Assessment, mientras ICIS y OCIS usan CC-103 como Signalment Analysis. La colisión es real y conviene resolverla antes de que se propague.

### Base de Conocimiento

1. **Displasia de cadera y codo**: ausentes de la Base de Conocimiento pese a ser entidades ortopédicas frecuentes.
2. **Trauma medular y vertebral**: el documento de trauma craneoencefálico lo declara como vacío complementario.
3. **Neoplasia intracraneal**: sin cobertura.
