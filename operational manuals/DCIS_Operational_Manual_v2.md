# DCIS Operational Manual — Índice General (DCIS-MANUAL-000)

**Propósito de este documento:** mapa de navegación entre las especificaciones que gobiernan a DCIS. No contiene contenido clínico ni de arquitectura por sí mismo — indica qué documento consultar según la tarea en curso, y documenta explícitamente qué piezas de arquitectura todavía no existen para este agente.

**Versión 2.0** — actualiza el estado de las especificaciones y de la Base de Conocimiento. La versión anterior declaraba como pendientes las seis especificaciones de arquitectura, que ya están construidas y cargadas.

---

## 1. Cómo usar este manual

Cuando trabajes en DCIS, identificá primero la tarea que estás resolviendo y consultá la especificación correspondiente en la tabla de la sección 2. No dupliques contenido entre documentos — cada especificación es la fuente única de verdad para su dominio.

## 2. Mapa de especificaciones — estado actual

| Código | Documento | Estado | Qué define |
|---|---|---|---|
| DCIS-MANUAL-000 | Operational Manual — Índice General | Este documento | Navegación entre el resto de especificaciones |
| DCIS-ARCH-001 | Clinical Components Catalog | Construido | Catálogo de componentes clínicos propios de dermatología, adaptado desde la familia CC-xxx de ICIS |
| DCIS-DESIGN-001 | Clinical Design System | Construido | Lenguaje visual: colores, tipografía, tarjetas, badges e íconos del dashboard y los informes de DCIS |
| DCIS-REP-001 | Clinical Report Specification | Construido | Estructura, contenido y reglas de generación de los informes clínicos de DCIS |
| DCIS-DASH-001 | Dashboard Functional Specification | Construido | Estructura funcional y comportamiento del dashboard clínico de DCIS |
| DCIS-KB-001 | Knowledge Base Standard | Construido | Reglas para transformar casos clínicos en unidades de conocimiento estructuradas y reutilizables |
| DCIS-AI-001 | AI Reasoning Standard | Pendiente | Estándar de razonamiento clínico del agente: cómo construye diferenciales, expresa incertidumbre y declara información faltante |
| DCIS-KD-001 | Breed Intelligence Knowledge Base Specification | Pendiente | Predisposiciones raciales relevantes para dermatología, a poblar dentro de la arquitectura general definida en ICIS-KD-001 |
| — | Project Instructions | Construido | System prompt de DCIS. de 17.513 caracteres. Vive en la columna `system_prompt` de la tabla `agentes`. fuera de la Base de Conocimiento |
| — | Manual de Identidad Visual | Pendiente | Aplicación de la marca Vetline Ai. Pendiente también en GCIS |
| — | Referral Engine Specification | No aplica | La derivación hacia DCIS es responsabilidad de ICIS. DCIS no necesita su propio motor de derivación entrante |
| — | Report Composer Engine Specification | Por decidir | Puede ser un motor compartido de plataforma en vez de una versión por agente. La decisión afecta a todos los agentes especializados y sigue abierta |

## 3. Base de Conocimiento — estado actual

6 documentos clínicos: dermatitis atópica (diagnóstico y tratamiento), piodermia, otitis externa, demodicosis y sarna sarcóptica, y dermatitis por Malassezia.

Más 1 documento de tipo `farmacoterapia`, que extiende la familia CC-3xx de ICIS al dominio de dermatología.

## 4. Diferencias intencionales respecto al patrón de ICIS

- **La vía de administración es decisión terapéutica de primer orden**: la extensión dermatológica de la familia CC-3xx registra tópicos y sistémicos por separado, a diferencia del resto de los agentes.
- **Sin motor de derivación propio**: DCIS recibe casos ya derivados por ICIS.

## 5. Pendientes explícitos

### Arquitectura

1. **DCIS-AI-001, DCIS-KD-001 y Manual de Identidad Visual** — las tres piezas que faltan para igualar el conjunto de doce especificaciones de GCIS, que es hoy el agente más completo de la plataforma. Las Project Instructions ya existen como `system_prompt` del agente.

2. **Decisión sobre el Report Composer Engine**: si es un motor compartido de plataforma o si cada agente especializado necesita su propia versión. Afecta a todos los agentes ya creados y sigue sin resolverse.

3. **Colisión de numeración CC-xxx**: GCIS usa CC-103 como Clinical Signs Registry y CC-105 como Nutritional Assessment, mientras ICIS y OCIS usan CC-103 como Signalment Analysis. La colisión es real y conviene resolverla antes de que se propague.

### Base de Conocimiento

1. **Documento crudo pendiente de curar**: la Base de Conocimiento contiene un volcado de PDF de 261.569 caracteres sobre diagnóstico de dermatofitosis. Es el documento más extenso de la plataforma y entra en el contexto de cada caso dermatológico, lo que encarece toda generación de este agente. Curarlo es prioridad sobre agregar temas nuevos.
2. **Dermatofitosis curada**: al resolver el punto anterior, el tema queda cubierto en formato de resumen clínico.
3. **Dermatitis alérgica por picadura de pulga**: sin cobertura.
