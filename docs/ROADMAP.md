# ROADMAP — Habit Tracker

Secuencia, estado, dependencias y criterios generales de salida. Las decisiones de producto cerradas (incluido el contrato de 5a y 5b) están en [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md); aquí solo se referencian. Cuando llegue cada posta, su SPEC ejecutable se reconstruye y verifica antes de implementar. Proceso y riesgo: [WORKFLOW.md](WORKFLOW.md).

## Estado

| Ítem | Estado |
|---|---|
| Auditoría, refuerzo de `.gitignore`, separación de `index.html` en HTML/CSS/JS | Completo |
| Etapa 4: frecuencias, rachas y `createdAt` | Completa y publicada |
| Posta 4.1: protección ante `localStorage` corrupto | Completa y publicada |
| H1: ajuste del alcance del adversarial tester | Completo y publicado (`3e50e7a`) |
| H2: Harness V2 (documentación y gobernanza) | En curso. Falta incorporar los cambios manuales en `.claude/**` y la revisión documental |
| 5a | Completa y publicada |
| 5b | Completa y publicada |
| Conversor Loop → backup JSON v1 | Pendiente (depende de 5b) |
| Backup v2 (contrato cuantitativo) | Propuesto, no secuenciado. Contrato documentado y tests sintéticos preparados; sin implementar |
| Importar datos reales de Loop | Pendiente (Gate B) |
| IndexedDB, PWA y backups adicionales | Sin prioridad inmediata |
| Analytics & Charts | Futuro / no iniciado, posterior a PWA |
| `README.md` | Trabajo posterior, fuera de H2 |
| `H2-CODEX-SETUP` | Pendiente, posterior a H2 |
| `qa-visual` | Futuro |
| Deuda de formato en `CLAUDE.md` y `close-posta` | Registrada, sin posta abierta |

## Orden

H2 → 5a → 5b → conversor Loop → Gate B para datos reales → después, IndexedDB, PWA y backups adicionales → Analytics & Charts (posterior a PWA).

## 5a. Hardening de render + export JSON

- **Propósito:** cerrar los sinks XSS antes de crear la importación y exportar un backup esquema v1.
- **Depende de:** nada.
- **Nivel de riesgo esperado:** SENSIBLE.
- **Criterios de salida:** ningún valor controlado por el usuario llega a `innerHTML`; el export cumple el esquema v1 con preflight completo; las pruebas del contrato pasan; sin cambios en estadísticas; verificación en iPhone del share y del fallback de descarga.
- **Contrato:** ver `PROJECT_CONTEXT.md`, sección 5a. Al preparar el contrato ejecutable se congela la enumeración de `BACKUP_V1_ICONS` y se ajusta el scope documental a los documentos canónicos de Harness V2 (adaptación de gobernanza, no un cambio funcional).

## 5b. Import JSON con preview y reemplazo seguro

- **Propósito:** importar un backup v1 mediante reemplazo, con validación estricta, preview y recuperación ante interrupciones.
- **Depende de:** 5a.
- **Nivel de riesgo esperado:** SENSIBLE al implementar con datos sintéticos; CRÍTICO al ejecutar sobre datos reales (Gate B).
- **Criterios de salida:** `validateBackup` es pura y cubierta con casos hostiles sintéticos; el reemplazo preserva el estado original ante fallos en cada paso; la recuperación de un import interrumpido funciona antes del `loadData` normal; el modo de recuperación bloqueante impide seguir sin resolver.
- **Contrato:** ver `PROJECT_CONTEXT.md`, sección 5b. El detalle de la estimación de capacidad y de la verificación estructural se define en el SPEC ejecutable de 5b.

## Conversor Loop → backup JSON v1

- **Flujo previsto:** 5a export → 5b import seguro → conversor local de SQLite de Loop a backup JSON v1 → tests sintéticos → Gate B → recién entonces usar los `.db` reales → preview → import real.
- **Criterios de salida:** el conversor corre en local, produce un JSON válido para `validateBackup` y nada real llega a Git, fixtures, logs, capturas ni scratchpads compartidos.
- Cualquier lectura de un `.db` real requiere Gate B (`SECURITY.md`). El área privada para ese material (`/.loop-private/`) y la sanitización de diagnósticos del conversor están documentadas en `SECURITY.md`, sección 6.
- Gate B también debe verificar hábitos cuantitativos (ver `Future Product Backlog`, ítem 3) antes de decidir la conversión final de cada hábito.

## Backup v2 (propuesta de contrato — pendiente de implementación y decisión humana)

- **Propósito:** representar hábitos cuantitativos (caso prioritario: Estudio/duración en minutos, ver `Future Product Backlog`, ítem 3) sin perder información, sin romper la compatibilidad con Backup v1.
- **Estado:** CONTRATO PROPUESTO. Tests sintéticos preparados y corridos contra el `validateBackup()` real (evidencia abajo). No implementado: `js/app.js` no se modificó en esta posta.
- **Depende de:** nada para el contrato en sí. La migración real de hábitos cuantitativos de Loop sigue dependiendo de Gate B (ver `Conversor Loop`, arriba).

### Contrato JSON propuesto

- **Raíz:** agrega `quantities` a los campos de v1 (`schemaVersion`, `exportedAt`, `habits`, `completions`). `schemaVersion` pasa a `2`.
- **Cada hábito** conserva exactamente los campos de v1 (`id`, `name`, `icon`, `color`, `freq`, `freqCount`, `freqPeriod`, `createdAt`) y agrega:
  - `kind`: `"boolean"` o `"quantitative"`, obligatorio. Reemplaza la ausencia de tipo de v1 (donde todo hábito es implícitamente booleano).
  - Solo si `kind === "quantitative"`:
    - `unit`: obligatorio, debe ser exactamente `"minutes"` (única unidad soportada por ahora; cualquier otro valor es fatal, nunca se adivina ni convierte).
    - `target`: `{ minutes: <entero >= 1> }` o `null`. Representa el objetivo CONFIGURADO actual, nunca un valor realizado histórico. La relación exacta de `target.minutes` con `freqPeriod` queda explícitamente sin definir (igual que ya marca `Future Product Backlog`, ítem 3) — no se inventa aquí.
- **`completions`** (sin cambio de forma): sigue existiendo solo para hábitos `kind === "boolean"`. Una entrada que referencia un hábito `quantitative` es fatal (ambigüedad de esquema).
- **`quantities`** (nuevo): `{ "YYYY-MM-DD": { [habitId]: { actualMinutes: <entero >= 0>, plannedMinutes: <entero >= 0> | null } } }`.
  - Solo puede referenciar hábitos `kind === "quantitative"`; una entrada que referencia un hábito `boolean` es fatal (criterio inverso al de arriba).
  - La AUSENCIA de una entrada para una fecha+hábito es distinta de `actualMinutes: 0`: ausencia = sin registro ese día; `0` = registro explícito de cero minutos. Nunca se infiere una de la otra.
  - `plannedMinutes: null` significa "no verificable / desconocido"; nunca se omite la clave para representar eso.
  - Cota de sanidad propuesta, no confirmada: `actualMinutes`/`plannedMinutes` ≤ 1440 (minutos en un día), ya que cada entrada es por día. `target.minutes` no tiene cota propuesta porque su período no está definido.

### Compatibilidad con Backup v1

- Un archivo `schemaVersion: 1` debe seguir importándose exactamente igual que hoy. Al importarlo, cada hábito se trata como `kind: "boolean"` implícito.
- **Pendiente de decisión:** si el estado interno (`state.habits`) agrega `kind` explícito a cada hábito migrado desde v1, o se mantiene implícito mientras no exista ningún hábito cuantitativo real.
- **Pendiente de decisión:** si un nuevo export siempre usa `schemaVersion: 2`, o solo cuando existe al menos un hábito `quantitative` (y se mantiene v1 en caso contrario).

### Validación estricta (extiende la de v1, ver `PROJECT_CONTEXT.md` sección 5b)

- Mismas reglas de v1 para los campos compartidos (IDs, nombre, color, frecuencia, fecha de creación, límites de tamaño).
- `kind` obligatorio, exactamente `"boolean"` o `"quantitative"` — cualquier otro valor, `null` o ausencia es fatal.
- Para `kind === "quantitative"`: `unit` obligatorio y exactamente `"minutes"`; `target` ausente, `null`, o `{ minutes: entero >= 1 }` — cualquier otra forma es fatal.
- Fechas de `quantities` con la misma regla que las de `completions` (formato real, no futuras).
- Referencias cruzadas: toda clave de `quantities`/`completions` debe apuntar a un `habitId` existente del `kind` correspondiente — huérfanas o de tipo incorrecto son fatales, mismo criterio fail-closed que v1.
- `actualMinutes`/`plannedMinutes`/`target.minutes`: enteros genuinos (nunca booleanos, nunca texto, nunca float) — mismo patrón que `is_valid_loop_id`/`is_valid_repetition_value` del conversor Python (`type(value) is int`, excluye bool).
- Ningún dato incompatible se descarta en silencio: un archivo que no puede representarse fielmente en v2 se rechaza por completo (fail-closed), igual que hoy en v1.

### Atomicidad de importación (extiende 5b)

- Misma secuencia que hoy (`PROJECT_CONTEXT.md` sección 5b: snapshot → marker → escribir → verificación estructural → borrar marker), extendida a una tercera clave de `localStorage`, `quantities`, en paralelo exacto a `habits`/`completions`.
- Un archivo inválido (v1 o v2) no debe modificar ninguna de las tres claves — hoy esto ya es cierto para `habits`/`completions`; falta implementar la tercera clave con la misma disciplina antes de que `quantities` pueda escribirse de verdad.
- No implementado en esta posta: ni `validateBackup`, ni `buildSnapshot`/`restoreExactRaw`/`performImportReplacement` fueron modificados.

**Nota de cierre (posta de implementación posterior a esta propuesta):** el snapshot de recuperación ahora incluye una tercera clave (`quantitiesRaw`) y usa `snapshotVersion: 2`. Un snapshot `snapshotVersion: 1` que hubiera quedado pendiente de una importación interrumpida de *antes* de este cambio **no se recupera automáticamente**: `parseSnapshotShape()` exige coincidencia exacta de forma y rechaza cualquier otra, por lo que cae a recuperación bloqueante (motivo `snapshot-corrupt`) en vez de completar el campo faltante en silencio. En ese modo, `habits`/`completions`/`quantities` vigentes no se tocan y el rescate crudo de cada clave (incluida `quantities`) sigue disponible para descarga manual. No se implementó ninguna migración automática de snapshots viejos; verificado con un test sintético dedicado.

### Tests sintéticos: evidencia obtenida esta posta

Se armó y corrió un harness Node temporal (en el scratchpad de la sesión, no comprometido al repo — ver "Sin decidir" más abajo) que carga `js/app.js` real dentro de una sandbox (Node `vm`, mock mínimo de `localStorage`, proxy no-op para `document`/`navigator`), sin reimplementar su lógica. Resultado contra el código actual, sin ninguna modificación productiva:

- **7 PASS** (compatibilidad v1 intacta; la whitelist actual de `validateBackup` ya rechaza por sí sola campos v2 colados en un payload v1, como `quantities` o `kind`, sin que nadie lo haya pedido explícitamente).
- **5 FAIL esperados (rojo)**, los que definen el objetivo de la próxima implementación: un backup v2 completo no se importa; una referencia huérfana en `quantities` no se detecta como tal (hoy falla antes, por campo raíz desconocido); `completions` no distingue todavía un hábito `quantitative` mal referenciado; `unit` distinto de `"minutes"` no se valida; `actualMinutes` no entero no se valida. 0 discrepancias respecto a lo esperado.

### Pendiente de decisión humana antes de implementar

1. ¿El estado interno agrega `kind` a los hábitos migrados de v1, o se mantiene implícito?
2. ¿Un nuevo export usa siempre v2, o v1 cuando no hay hábitos cuantitativos?
3. ¿Qué significa exactamente `target.minutes` en relación a `freqPeriod`?
4. ¿Se confirma la cota de sanidad de 1440 minutos/día para `actualMinutes`/`plannedMinutes`?
5. Ya registrado en "Sin decidir" (abajo): si habrá harness de test permanente en el repo y con qué runner — esta posta no lo resuelve; por eso el harness Node de esta posta quedó en el scratchpad de la sesión, no en el repo.

## Analytics & Charts (futuro, posterior a PWA)

- **Propósito:** aprovechar el historial real de hábitos para incorporar estadísticas y visualizaciones útiles, evitando gráficos decorativos o métricas sin una pregunta concreta.
- **Depende de:** import/export seguro terminado; conversor Loop terminado; datos históricos reales importados y validados; UX/UI V2 terminada; PWA terminada.
- **Estado:** FUTURO / NO INICIADO.
- **Estimación orientativa:** 8–15 horas efectivas, a revisar cuando existan datos reales y se defina el alcance final.

Dos líneas conceptuales, sin contrato cerrado:

1. **Analytics dentro de Habit Tracker.** Candidatos iniciales, no cerrados: heatmap/calendario anual de consistencia; evolución mensual de cumplimiento; porcentaje de cumplimiento por hábito; racha actual vs. récord histórico; consistencia en los últimos 30/90/365 días; comportamiento por día de la semana; evolución histórica individual de un hábito. Priorizar aproximadamente 5 a 8 visualizaciones realmente útiles; la selección definitiva se hace después de observar los datos reales.
2. **Personal Data Analysis.** Análisis más profundo fuera de la UI principal, inicialmente con Python/pandas cuando resulte apropiado. Preguntas candidatas: qué hábitos fueron más sostenibles a largo plazo; meses o períodos con más abandono; días de mayor o menor consistencia; tiempo aproximado hasta estabilizar hábitos nuevos; hábitos que desaparecen, vuelven y se consolidan; períodos donde varios hábitos mejoran o empeoran simultáneamente; cohortes de hábitos y supervivencia aproximada a 30/90/180/365 días. Estos análisis no implican que todas esas métricas deban incorporarse después a la app.

Principios: datos reales antes de decidir visualizaciones definitivas; utilidad antes que cantidad; no agregar gráficos solo porque los datos lo permiten; separar métricas de producto de exploración analítica personal; mantener privacidad/local-first; no introducir backend/cloud en esta etapa; cualquier métrica nueva debe tener definición reproducible; la UX/UI de los gráficos sigue `UX_UI.md`.

Los candidatos listados arriba no son SPEC congelada.

## Future Product Backlog (futuro, sin comprometer secuencia)

Este bloque no es una secuencia comprometida ni una SPEC. Son candidatos aprobados conceptualmente para evaluar después de tener el producto base terminado y experiencia real de uso. No se fija todavía implementación, arquitectura ni orden definitivo interno.

1. **Notas/contexto por hábito y fecha.** Permitir asociar una nota breve a una entrada (ejemplos: viaje, enfermedad, entrenamiento liviano, contexto excepcional), preservando potencial analítico futuro.
2. **Skip / pausa justificada.** Distinguir conceptualmente entre completado, incumplido y omitido, contemplando vacaciones, enfermedad, lesión u otras excepciones. Un skip no debe convertirse automáticamente en un éxito; el impacto exacto sobre estadísticas y rachas se define antes de implementar.
3. **Hábitos cuantitativos.** Además de hábitos binarios, evaluar objetivos medibles (páginas, minutos, pasos, litros, sesiones); unidades, metas y relación con frecuencias quedan por definir. Ver la propuesta de contrato detallada en "Backup v2", más arriba.
   - **Caso prioritario inicial: Estudio / duración.** Unidad canónica interna: minutos enteros. La UI debe permitir ingresar horas y minutos, convirtiendo automáticamente a minutos totales al guardar y de minutos totales a horas+minutos al mostrar (ej.: 2 h 35 min → 155 min almacenados; 90 min → mostrar 1 h 30 min; 185 min → mostrar 3 h 5 min; 240 min → mostrar 4 h). Evitar horas y minutos como dos fuentes de verdad independientes.
   - **Histórico manual.** Existen registros históricos reales de estudio con duración real y, en algunos casos, duración planificada/estimada (ejemplo: 2025-10-01 real 1h35min / planificado 4h). El usuario no quiere cargarlos día por día: se planifica una futura importación batch. Como mínimo preservar `actualMinutes`; cuando exista dato planificado y el modelo final lo permita razonablemente, preservar también `plannedMinutes` (ejemplo conceptual: `{actualMinutes: 95, plannedMinutes: 240}`). El schema definitivo (Backup v2 o equivalente) no está definido todavía; Backup v1 no se modifica por esta decisión.
   - **Relación con Gate B / Loop.** El usuario cree, sin confirmar, que su base real de Loop puede registrar Estudio de forma cuantitativa (horas/cantidad) en vez de binaria. Antes de migrar la base real de Loop, Gate B debe verificar específicamente para hábitos cuantitativos: cómo los identifica Loop, valor almacenado, unidad real, precisión, codificación, significado del valor, comportamiento de timestamps/fechas y cualquier metadata necesaria. No asumir que Loop almacena horas. No convertir un valor cuantitativo a boolean true/false perdiendo información (el Conversor Loop → backup JSON v1 ya trata hoy los hábitos cuantitativos como UNSUPPORTED y aborta identificándolos, en vez de convertirlos silenciosamente). Si Gate B confirma historial cuantitativo relevante, el soporte de hábitos cuantitativos debe implementarse antes de la migración histórica definitiva de esos hábitos.
4. **Archivado de hábitos.** Retirar hábitos de la experiencia diaria sin destruir su historial, preservando estadísticas y análisis históricos. Archivar se diferencia claramente de eliminar.
5. **Widgets / acceso ultrarrápido.** Investigar capacidades reales de iOS/PWA antes de comprometer una solución. Objetivo de producto: minimizar pasos para consultar o marcar un hábito. No prometer widget nativo hasta verificar soporte técnico real.
6. **Recordatorios y habit stacking.** Si se implementa, comenzar por recordatorios simples. Evaluar después relaciones del tipo "después de completar X → recordar Y", evitando inicialmente automatizaciones complejas o dependencias innecesarias.
7. **Organización por áreas o momentos.** Permitir eventualmente organizar hábitos (por ejemplo mañana/día/noche, o salud/estudio/personal). Tiene valor conocido para el usuario por experiencia previa con una organización similar en Loop Habit Tracker en Android; el modelo exacto se define solo después de importar y observar el dataset real.
8. **Year in Review.** Resumen anual personal. Candidatos: hábitos más consistentes, completados totales, mejor mes, racha récord, heatmap anual, comparación con períodos o años anteriores cuando sea válida. Se diseña como resumen útil y visual, no como gamificación obligatoria.

**Principios del backlog futuro:** local-first y privacidad por defecto; no agregar backend/cloud solamente para soportar estas ideas; simplicidad antes que feature count; no introducir red social, rankings ni gamificación compleja sin una razón futura concreta; evaluar cada candidato según uso real; las features pueden descartarse si no aportan suficiente valor; no permitir que este backlog retrase 5a, 5b, Loop, UX/UI V2 ni PWA; cualquier cambio de modelo de datos se diseña explícitamente antes de implementación; preservar compatibilidad/migración de datos existentes cuando corresponda.

**Estado:** FUTURO / NO INICIADO.

## H2 y trabajo posterior de harness

- **H2** deja la documentación canónica y la gobernanza. Sigue pendiente aplicar a mano los cambios en `.claude/**`.
- **`H2-CODEX-SETUP`:** posta posterior. Detectar la versión instalada de Codex, validar el esquema soportado, hacer un smoke real y no copiar configuración de otros proyectos.
- **`qa-visual`** (futuro, no existe): QA determinista en navegador más revisión visual separada; datos sintéticos y perfil de navegador aislado; capturas solo en temporales o artefactos ignorados; solo lectura sobre producción; no modifica código ni se aprueba a sí mismo; evalúa contra `UX_UI.md`; el humano acepta el resultado visual. Viewports de referencia: los de `UX_UI.md`.

## Pendientes locales conocidos

- **PENDING LOCAL CONFIG:** `git push` normal debe pasar de DENY a ASK en `.claude/settings.local.json` antes de probar o publicar mediante un agente. La política objetivo ya está documentada en `SECURITY.md` y `WORKFLOW.md`.
- **Deuda de formato** (líneas en blanco intercaladas, entidades `&#x20;` en `close-posta`, fin de línea CRLF/LF en el árbol de trabajo): registrada, sin posta abierta salvo beneficio práctico demostrado.

## Sin decidir

- Si habrá tests o harnesses permanentes en el repo y con qué runner. Hoy los harnesses son temporales y descartables.
