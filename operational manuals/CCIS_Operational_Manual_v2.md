# CCIS Operational Manual — Índice General (CCIS-MANUAL-000)

**Propósito de este documento:** mapa de navegación entre las especificaciones que gobiernan a CCIS. No contiene contenido clínico ni de arquitectura por sí mismo — indica qué documento consultar según la tarea en curso, y documenta explícitamente qué piezas de arquitectura todavía no existen para este agente.

**Versión 2.0** — actualiza el estado de las especificaciones y de la Base de Conocimiento. La versión anterior declaraba como pendientes las seis especificaciones de arquitectura, que ya están construidas y cargadas.

---

## 1. Cómo usar este manual

Cuando trabajes en CCIS, identificá primero la tarea que estás resolviendo y consultá la especificación correspondiente en la tabla de la sección 2. No dupliques contenido entre documentos — cada especificación es la fuente única de verdad para su dominio.

## 2. Mapa de especificaciones — estado actual

| Código | Documento | Estado | Qué define |
|---|---|---|---|
| CCIS-MANUAL-000 | Operational Manual — Índice General | Este documento | Navegación entre el resto de especificaciones |
| CCIS-ARCH-001 | Clinical Components Catalog | Construido | Catálogo de componentes clínicos propios de cardiología, adaptado desde la familia CC-xxx de ICIS |
| CCIS-DESIGN-001 | Clinical Design System | Construido | Lenguaje visual: colores, tipografía, tarjetas, badges e íconos del dashboard y los informes de CCIS |
| CCIS-REP-001 | Clinical Report Specification | Construido | Estructura, contenido y reglas de generación de los informes clínicos de CCIS |
| CCIS-DASH-001 | Dashboard Functional Specification | Construido | Estructura funcional y comportamiento del dashboard clínico de CCIS |
| CCIS-KB-001 | Knowledge Base Standard | Construido | Reglas para transformar casos clínicos en unidades de conocimiento estructuradas y reutilizables |
| CCIS-AI-001 | AI Reasoning Standard | Pendiente | Estándar de razonamiento clínico del agente: cómo construye diferenciales, expresa incertidumbre y declara información faltante |
| CCIS-KD-001 | Breed Intelligence Knowledge Base Specification | Pendiente | Predisposiciones raciales relevantes para cardiología, a poblar dentro de la arquitectura general definida en ICIS-KD-001 |
| — | Project Instructions | Construido | System prompt de CCIS. de 17.482 caracteres. Vive en la columna `system_prompt` de la tabla `agentes`. fuera de la Base de Conocimiento |
| — | Manual de Identidad Visual | Pendiente | Aplicación de la marca Vetline Ai. Pendiente también en GCIS |
| — | Referral Engine Specification | No aplica | La derivación hacia CCIS es responsabilidad de ICIS. CCIS no necesita su propio motor de derivación entrante |
| — | Report Composer Engine Specification | Por decidir | Puede ser un motor compartido de plataforma en vez de una versión por agente. La decisión afecta a todos los agentes especializados y sigue abierta |

## 3. Base de Conocimiento — estado actual

10 documentos clínicos: enfermedad valvular mitral degenerativa, cardiomiopatía dilatada, miocardiopatías felinas, insuficiencia cardíaca congestiva aguda, arritmias, tromboembolismo arterial felino, hipertensión sistémica, hipertensión pulmonar, derrame pericárdico y dirofilariasis.

Más 1 documento de tipo `farmacoterapia`, que extiende la familia CC-3xx de ICIS al dominio de cardiología.

## 4. Diferencias intencionales respecto al patrón de ICIS

- **Sin motor de derivación propio**: CCIS recibe casos ya derivados por ICIS. El Referral Recommendation Card del Dashboard de ICIS no tiene equivalente acá.
- **Farmacoterapia propia**: la extensión cardiovascular de la familia CC-3xx cubre las clases terapéuticas del dominio y nueve patrones de interacción propios.
- **Entidad transversal**: la hipertensión sistémica pertenece a CCIS pero se manifiesta en ojo, cerebro, corazón y riñón, y su causa suele estar en ECIS o en la línea renal. El documento correspondiente declara esas conexiones.

## 5. Pendientes explícitos

### Arquitectura

1. **CCIS-AI-001, CCIS-KD-001 y Manual de Identidad Visual** — las tres piezas que faltan para igualar el conjunto de doce especificaciones de GCIS, que es hoy el agente más completo de la plataforma. Las Project Instructions ya existen como `system_prompt` del agente.

2. **Decisión sobre el Report Composer Engine**: si es un motor compartido de plataforma o si cada agente especializado necesita su propia versión. Afecta a todos los agentes ya creados y sigue sin resolverse.

3. **Colisión de numeración CC-xxx**: GCIS usa CC-103 como Clinical Signs Registry y CC-105 como Nutritional Assessment, mientras ICIS y OCIS usan CC-103 como Signalment Analysis. La colisión es real y conviene resolverla antes de que se propague.

### Base de Conocimiento

1. **Cardiopatías congénitas**: ausentes de la Base de Conocimiento.
2. **Pericarditis constrictiva y derrame pericárdico felino**: declarados como vacíos en el documento de derrame pericárdico.
