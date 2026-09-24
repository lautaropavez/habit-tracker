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
| `README.md` | Trabajo posterior, fuera de H2 |
| `H2-CODEX-SETUP` | Pendiente, posterior a H2 |
| `qa-visual` | Futuro |
| Deuda de formato en `CLAUDE.md` y `close-posta` | Registrada, sin posta abierta |

## Orden

H2 → 5a → 5b → conversor Loop → Gate B para datos reales → después, IndexedDB, PWA y backups adicionales.

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

## H2 y trabajo posterior de harness

- **H2** deja la documentación canónica y la gobernanza. Sigue pendiente aplicar a mano los cambios en `.claude/**`.
- **`H2-CODEX-SETUP`:** posta posterior. Detectar la versión instalada de Codex, validar el esquema soportado, hacer un smoke real y no copiar configuración de otros proyectos.
- **`qa-visual`** (futuro, no existe): QA determinista en navegador más revisión visual separada; datos sintéticos y perfil de navegador aislado; capturas solo en temporales o artefactos ignorados; solo lectura sobre producción; no modifica código ni se aprueba a sí mismo; evalúa contra `UX_UI.md`; el humano acepta el resultado visual. Viewports de referencia: los de `UX_UI.md`.

## Pendientes locales conocidos

- **PENDING LOCAL CONFIG:** `git push` normal debe pasar de DENY a ASK en `.claude/settings.local.json` antes de probar o publicar mediante un agente. La política objetivo ya está documentada en `SECURITY.md` y `WORKFLOW.md`.
- **Deuda de formato** (líneas en blanco intercaladas, entidades `&#x20;` en `close-posta`, fin de línea CRLF/LF en el árbol de trabajo): registrada, sin posta abierta salvo beneficio práctico demostrado.

## Sin decidir

- Si habrá tests o harnesses permanentes en el repo y con qué runner. Hoy los harnesses son temporales y descartables.
