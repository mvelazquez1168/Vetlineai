# OCIS Operational Manual — Índice General (OCIS-MANUAL-000)

**Propósito de este documento:** mapa de navegación entre las especificaciones que gobiernan a OCIS. No contiene contenido clínico ni de arquitectura por sí mismo — indica qué documento consultar según la tarea en curso, y documenta explícitamente qué piezas de arquitectura todavía no existen para este agente.

**Versión 2.0** — actualiza el estado de las especificaciones y de la Base de Conocimiento. La versión anterior declaraba como pendientes las seis especificaciones de arquitectura, que ya están construidas y cargadas.

---

## 1. Cómo usar este manual

Cuando trabajes en OCIS, identificá primero la tarea que estás resolviendo y consultá la especificación correspondiente en la tabla de la sección 2. No dupliques contenido entre documentos — cada especificación es la fuente única de verdad para su dominio.

## 2. Mapa de especificaciones — estado actual

| Código | Documento | Estado | Qué define |
|---|---|---|---|
| OCIS-MANUAL-000 | Operational Manual — Índice General | Este documento | Navegación entre el resto de especificaciones |
| OCIS-ARCH-001 | Clinical Components Catalog | Construido | Catálogo de componentes clínicos propios de oncología, adaptado desde la familia CC-xxx de ICIS |
| OCIS-DESIGN-001 | Clinical Design System | Construido | Lenguaje visual: colores, tipografía, tarjetas, badges e íconos del dashboard y los informes de OCIS |
| OCIS-REP-001 | Clinical Report Specification | Construido | Estructura, contenido y reglas de generación de los informes clínicos de OCIS |
| OCIS-DASH-001 | Dashboard Functional Specification | Construido | Estructura funcional y comportamiento del dashboard clínico de OCIS |
| OCIS-KB-001 | Knowledge Base Standard | Construido | Reglas para transformar casos clínicos en unidades de conocimiento estructuradas y reutilizables |
| OCIS-AI-001 | AI Reasoning Standard | Pendiente | Estándar de razonamiento clínico del agente: cómo construye diferenciales, expresa incertidumbre y declara información faltante |
| OCIS-KD-001 | Breed Intelligence Knowledge Base Specification | Pendiente | Predisposiciones raciales relevantes para oncología, a poblar dentro de la arquitectura general definida en ICIS-KD-001 |
| — | Project Instructions | Construido | System prompt de OCIS. de 15.790 caracteres. Vive en la columna `system_prompt` de la tabla `agentes`. fuera de la Base de Conocimiento |
| — | Manual de Identidad Visual | Pendiente | Aplicación de la marca Vetline Ai. Pendiente también en GCIS |
| — | Referral Engine Specification | No aplica | La derivación hacia OCIS es responsabilidad de ICIS. OCIS no necesita su propio motor de derivación entrante |
| — | Report Composer Engine Specification | Por decidir | Puede ser un motor compartido de plataforma en vez de una versión por agente. La decisión afecta a todos los agentes especializados y sigue abierta |

## 3. Base de Conocimiento — estado actual

11 documentos clínicos: tumores de mastocitos, linfoma canino, linfoma felino, hemangiosarcoma, tumores mamarios, osteosarcoma apendicular, melanoma oral, carcinoma de células escamosas felino, carcinoma urotelial, sarcoma de tejidos blandos y abordaje de la masa cutánea.

Más 1 documento de tipo `farmacoterapia`, que extiende la familia CC-3xx de ICIS al dominio de oncología.

## 4. Diferencias intencionales respecto al patrón de ICIS

- **Sin motor de derivación propio**: a diferencia de ICIS, que deriva casos *hacia* especialidades, OCIS es una especialidad que *recibe* casos ya derivados. El componente de Referral Recommendation Card, propio del Dashboard de ICIS, no tiene equivalente en OCIS.
- **Farmacoterapia propia**: OCIS cuenta con un documento de tipo `farmacoterapia` que cubre toxicidad, mielosupresión e inhibidores de tirosina cinasa. La nutrición terapéutica se mantiene exclusiva de GCIS.

## 5. Pendientes explícitos

### Arquitectura

1. **OCIS-AI-001, OCIS-KD-001 y Manual de Identidad Visual** — las tres piezas que faltan para igualar el conjunto de doce especificaciones de GCIS, que es hoy el agente más completo de la plataforma. Las Project Instructions ya existen como `system_prompt` del agente.

2. **Decisión sobre el Report Composer Engine**: si es un motor compartido de plataforma o si cada agente especializado necesita su propia versión. Afecta a todos los agentes ya creados y sigue sin resolverse.

3. **Colisión de numeración CC-xxx**: GCIS usa CC-103 como Clinical Signs Registry y CC-105 como Nutritional Assessment, mientras ICIS y OCIS usan CC-103 como Signalment Analysis. La colisión es real y conviene resolverla antes de que se propague.

### Base de Conocimiento

1. **Cobertura felina**: la Base de Conocimiento incluye linfoma felino y carcinoma de células escamosas felino. Faltan otras entidades oncológicas felinas frecuentes.
2. **Estadificación TNM detallada** y protocolos de quimioterapia por entidad: los documentos clínicos declaran estos temas como vacíos explícitos.
