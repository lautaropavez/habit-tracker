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
| 5a | Pendiente |
| 5b | Pendiente (depende de 5a) |
| Conversor Loop → backup JSON v1 | Pendiente (depende de 5b) |
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
- Cualquier lectura de un `.db` real requiere Gate B (`SECURITY.md`).

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
3. **Hábitos cuantitativos.** Además de hábitos binarios, evaluar objetivos medibles (páginas, minutos, pasos, litros, sesiones); unidades, metas y relación con frecuencias quedan por definir.
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
