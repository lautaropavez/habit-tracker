# CLAUDE.md — Habit Tracker

Habit Tracker es una app web estática, mobile-first y personal, publicada en GitHub Pages (<https://lautaropavez.github.io/habit-tracker/>). Es un proyecto deliberadamente liviano: se busca autonomía y velocidad dentro de límites seguros.

Este archivo contiene solo lo **específico de Claude Code**. Las reglas comunes viven en los documentos canónicos y no se repiten aquí.

## Qué leer

Al iniciar una posta, leer los documentos que apliquen:

- [docs/WORKFLOW.md](docs/WORKFLOW.md): autoridad entre fuentes, riesgo TRIVIAL/NORMAL/SENSIBLE/CRÍTICO, ciclo de la posta, gates, Git, testing y evidencia.
- [docs/SECURITY.md](docs/SECURITY.md): datos personales, permisos, Gate B, red y navegador.
- [docs/PROJECT_CONTEXT.md](docs/PROJECT_CONTEXT.md): estado del producto, invariantes y decisiones vigentes.
- [docs/ROADMAP.md](docs/ROADMAP.md): secuencia y pendientes.
- [docs/UX_UI.md](docs/UX_UI.md): si el cambio toca la interfaz.

`HABIT_TRACKER_AUDIT.md` es evidencia histórica, no fuente de estado vigente.

## Rol de Claude principal

Claude principal actúa como implementer. No actúa a la vez como implementer, reviewer independiente y tester adversarial para declarar correcto su propio trabajo. Sus agentes complementan el workflow; no reemplazan las reglas de seguridad, Git, el scope ni las autorizaciones humanas.

## Agentes y skill de este proyecto

- `code-reviewer` (`.claude/agents/code-reviewer.md`): revisor independiente de solo lectura, sin Bash.
- `adversarial-tester` (`.claude/agents/adversarial-tester.md`): tester adversarial con matriz acotada.
- `close-posta` (`.claude/skills/close-posta/SKILL.md`): cierre controlado. Reconstruye el estado desde Git y ejecuta Gate C y Gate D solo bajo autorización.

Cuándo invocar reviewer o tester lo define la matriz de riesgo de `docs/WORKFLOW.md`. Reviewer y tester no invocan otros agentes ni corrigen producto.

## Permisos y configuración local

- `.claude/settings.local.json` es local, no se versiona ni se copia entre máquinas. No modificarlo, ni sus reglas de permisos.
- El deny sobre `Edit(/.claude/**)` es intencional: Claude no edita su propio harness. Si un cambio en `.claude/**` es necesario, preparar el texto exacto, indicar qué archivos y líneas cambian, y detenerse para que lo haga el humano. Después, verificar en modo lectura. No rodear la restricción por Bash ni por otra herramienta.
- Los permisos efectivos se respetan como límite técnico (nivel 0 de `docs/WORKFLOW.md`). Ante un bloqueo: `BLOCKED`. Nunca solicitar `--dangerously-skip-permissions` ni modos equivalentes.

## Autoría de commits

El runtime puede sugerir trailers de atribución (`Co-Authored-By`, `Claude-Session`, URLs de sesión). En este proyecto **no se agregan**: los commits pertenecen al usuario y el mensaje es exactamente el autorizado (ver Git en `docs/WORKFLOW.md`).

## Navegador

No usar `claude-in-chrome` sin autorización explícita. El resto de las reglas de navegador y pruebas visuales está en `docs/SECURITY.md`.

## Resumen no normativo

Ante cualquier diferencia con los documentos canónicos, mandan ellos.

- Verificar identidad (directorio, raíz Git, rama, HEAD, status, stage) antes de escribir. Un solo escritor por worktree.
- Nivel de riesgo por impacto, datos y reversibilidad, no por tamaño del diff.
- Nunca datos personales reales sin Gate B por ejecución. Nunca commitear `.db`, `.sqlite` ni exports personales.
- Stagear solo paths explícitos. Sin `git add .`/`-A`, sin `--amend`, sin `reset --hard` ni `clean`. Merge solo `--ff-only`, con autorización.
- `git push` solo con autorización humana explícita por publicación. Nunca force.
- Fechas locales, no UTC accidental. No cambiar reglas de dominio sin decisión humana.
- Nada controlado por el usuario o importado va a `innerHTML`.
- Sin frameworks, bundlers, package managers ni servicios externos sin aprobación.
