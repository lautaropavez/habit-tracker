# AGENTS.md — Habit Tracker

Entrada común para cualquier agente de código. Este archivo solo orienta; las reglas viven en los documentos canónicos.

Habit Tracker es una app web estática y personal (HTML, CSS y JavaScript vanilla, GitHub Pages), pensada para iPhone. Es un proyecto deliberadamente liviano: se busca autonomía y velocidad dentro de límites seguros.

## Qué leer

1. [docs/WORKFLOW.md](docs/WORKFLOW.md): autoridad entre fuentes, riesgo, ciclo de una posta, gates, Git, testing y evidencia.
2. [docs/SECURITY.md](docs/SECURITY.md): datos personales, permisos, Gate B, red y navegador.
3. [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md): estado del producto, invariantes y decisiones vigentes.
4. [docs/ROADMAP.md](docs/ROADMAP.md): secuencia y pendientes.
5. [docs/UX_UI.md](docs/UX_UI.md): solo si el cambio toca la interfaz.

`HABIT_TRACKER_AUDIT.md` es historia; no es fuente de estado vigente.

## Puntos que no se negocian por omisión

Resumen no normativo; ante cualquier diferencia manda el documento canónico.

- Verificar identidad (directorio, raíz Git, rama, HEAD, status, stage) antes de escribir.
- Un solo escritor por worktree.
- Nunca datos personales reales sin Gate B; nunca commitear `.db` ni exports personales.
- Stagear solo paths explícitos; sin `--amend` ni force push sin autorización explícita.
- `git push` solo con autorización humana explícita por publicación.
- Los límites técnicos del runtime no se rodean: ante un bloqueo, reportar `BLOCKED`.

## Runtime

Esta configuración es neutral. Las particularidades de cada herramienta viven aparte: la carpeta `.claude/` es configuración de Claude Code y otros runtimes no la editan. La configuración específica de Codex todavía no existe (ver `docs/ROADMAP.md`).
