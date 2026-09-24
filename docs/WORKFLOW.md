# WORKFLOW — Habit Tracker

Contrato común de trabajo para cualquier agente (Claude Code, Codex u otro) y para el humano.

- Seguridad, datos y permisos: [SECURITY.md](SECURITY.md).
- Estado y decisiones del producto: [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md).
- Secuencia y pendientes: [ROADMAP.md](ROADMAP.md).
- Criterios visuales: [UX_UI.md](UX_UI.md).

## 1. Principio rector

Habit Tracker es un proyecto personal y deliberadamente liviano. El harness maximiza autonomía y velocidad dentro de límites seguros; no maximiza la cantidad de gates.

- Todo control nuevo debe justificar qué riesgo concreto reduce.
- Si el costo de un control supera razonablemente el riesgo que reduce, se simplifica.
- Documentación mínima suficiente. Cada regla tiene un único dueño y no se copia en otros archivos.
- Preferir cambios mínimos, reversibles, comprobables y trazables. No refactorizar por gusto, no ampliar el scope por iniciativa propia, no construir infraestructura permanente para una necesidad descartable.
- No introducir frameworks, bundlers, package managers, servicios externos ni infraestructura adicional sin necesidad concreta y aprobación explícita.

## 2. Autoridad

| Nivel | Fuente | Efecto |
|---|---|---|
| 0 | Límites técnicos: sandbox, deny efectivo, permisos del runtime, instrucciones superiores aplicables | No se levantan desde la conversación. Ante conflicto: STOP / BLOCKED. No buscar bypass ni herramienta equivalente. |
| 1 | Instrucción humana explícita y vigente para la tarea | Puede modificar cualquier regla del proyecto (ver «Excepciones»). |
| 2 | Documento canónico de la materia | Ver dueños abajo. |
| 3 | SPEC aprobado de la posta activa | Concreta dentro de lo canónico. No agrega decisiones de producto. |
| 4 | Código y configuración reales | Evidencia de implementación, no autoridad. Una discrepancia con los documentos se reporta; no se resuelve sola. |
| 5 | `HABIT_TRACKER_AUDIT.md` | Evidencia histórica. No es autoridad sobre el estado vigente. |

**Dueños por materia**

| Materia | Documento |
|---|---|
| Estado del producto, invariantes y decisiones vigentes | `PROJECT_CONTEXT.md` |
| Secuencia, estado de etapas y pendientes | `ROADMAP.md` |
| Seguridad, datos personales, permisos, Gate B, red, navegador | `SECURITY.md` |
| Proceso, riesgo, tests, evidencia, Git y gates | `WORKFLOW.md` |
| Criterios visuales y de UX | `UX_UI.md` |

**Conflictos.** Si dos fuentes relevantes de nivel 2 o 3 se contradicen: STOP y reportar `HUMAN DECISION REQUIRED`. No inventar una decisión de producto.

**Excepciones.** Una instrucción humana explícita puede modificar una regla del proyecto, sea de proceso o de seguridad/datos.

- Si el cambio es permanente, se actualiza después el documento canónico correspondiente.
- Si vale solo para una posta, queda registrada en el contrato o en la evidencia de esa posta. No exige abrir antes una posta documental.
- Ante una regla de seguridad o de datos, el agente avisa en una línea y continúa. Si la instrucción es ambigua, pregunta.
- Gate B sigue exigiéndose por ejecución con datos reales (ver `SECURITY.md`).
- Lo que impone el nivel 0 no se puede excepcionar desde la conversación.

## 3. Riesgo

Escala única: **TRIVIAL / NORMAL / SENSIBLE / CRÍTICO**. Se clasifica por impacto, datos afectados y reversibilidad. El tamaño del diff no define el nivel. Se aplica el más alto que corresponda; ante duda, el superior. Bajar de nivel requiere decisión humana registrada.

| Nivel | Criterio | Ejemplos |
|---|---|---|
| TRIVIAL | Impacto mínimo, fácilmente reversible, sin datos persistentes ni seguridad | Texto, comentarios, documentación sin reglas |
| NORMAL | Cambio funcional acotado, reversible, sin riesgo serio de pérdida de datos | Lógica de UI, estadísticas, calendario, CSS visible, validaciones |
| SENSIBLE | Persistencia, seguridad, import/export, impacto relevante o difícil de revertir | localStorage/IndexedDB, render de datos de usuario, service worker, cache, harness, permisos y gobernanza |
| CRÍTICO | Datos personales reales, operaciones destructivas, migraciones o replace con riesgo de pérdida, Gate B | Importar un backup real, migración real, leer un backup de Loop |

| Nivel | Autonomía y verificación | Reviewer | Tester | Cierre local |
|---|---|---|---|---|
| TRIVIAL | Alta. Verificación mínima: `git diff --check` y revisión del diff | No | No | Una autorización cubre commit + merge `--ff-only` |
| NORMAL | Dentro del scope aprobado. Tests dirigidos, casos límite y flujo afectado. Sin STOP humano entre pasos rutinarios | Solo si la naturaleza del cambio lo justifica (lógica de datos o fechas) | No, salvo hallazgo concreto | Una autorización cubre commit + merge `--ff-only` |
| SENSIBLE | Matriz dedicada, estado final verificado, evidencia más fuerte | Obligatorio | Solo ante una amenaza concreta | Commit y merge con gates separados |
| CRÍTICO | Preflight read-only más todo lo de SENSIBLE | Obligatorio | Acotado, con datos sintéticos, cuando corresponda | Gate B por ejecución más controles humanos previos |

## 4. Ciclo de una posta

1. **Identidad.** Directorio, raíz Git, rama, HEAD, status y stage. No asumir el proyecto por la conversación ni por una sesión anterior. Si no coincide con lo esperado: STOP.
2. **Comprender.** Leer el código relacionado, callers y dependencias; identificar edge cases; distinguir refactor de cambio funcional.
3. **Clasificar el riesgo** (sección 3) y cerrar las decisiones humanas necesarias.
4. **Contrato.** Objetivo, archivos permitidos, invariantes, fuera de alcance, criterios de aceptación, nivel de pruebas y mensaje de commit propuesto. En TRIVIAL y NORMAL puede ser breve y vivir en la conversación.
5. **Checkpoint previo a editar.** Verificar rama, HEAD y status. Si hace falta tocar un archivo fuera del scope: STOP y reportar.
6. **Implementar.** Un solo escritor por worktree.
7. **Verificar** con pruebas proporcionales al riesgo (sección 8).
8. **Gate A** (sección 6).
9. **Cierre local:** Gate C (commit) y Gate D (merge), sección 6.
10. **Push**, solo con autorización explícita (sección 6).
11. **Verificación posterior** read-only.

Es decisión humana, no técnica, cualquier avance que implique nueva decisión de producto o de seguridad, migración, persistencia, importación o reemplazo de datos, o un cambio arquitectónico relevante.

## 5. Coordinación de agentes

- Un responsable por posta y **un solo escritor por worktree**. Claude principal, Codex y subagentes no escriben a la vez sobre el mismo árbol.
- El agente principal implementa. No actúa a la vez como implementer, reviewer independiente y tester adversarial para declarar correcto su propio trabajo.
- Reviewer y tester no corrigen producto, no stagean, no commitean, no hacen push, no invocan otros agentes y no delegan su rol. Sus findings vuelven al implementer. No se crean cadenas recursivas de agentes.
- Un tester ejecutable puede escribir únicamente artefactos y fixtures sintéticos en un área explícitamente autorizada.
- Se revisa sobre contenido estable: nadie modifica lo que otro agente está evaluando. Tras un agente que pueda alterar estado, comparar Git antes y después.
- No usar multiagente por defecto. Se invoca reviewer o tester solo cuando el nivel de riesgo lo indica (sección 3).
- El reviewer recibe el contrato, `WORKFLOW.md`/`SECURITY.md` aplicables, el diff real y los archivos estrictamente necesarios, más hipótesis concretas: invariantes, riesgos, casos a intentar romper, decisiones humanas ya cerradas y falsos positivos ya descartados. No recibe conclusiones predeterminadas.
- El tester recibe el mismo contrato y una matriz acotada según el riesgo; ver su definición de agente.
- El implementer puede hacer **una** corrección automática, dentro del scope, ante findings objetivos LOW o MEDIUM. Requieren STOP humano: BLOCKER, HIGH, decisión de producto o de seguridad, expansión de scope y un segundo ciclo de corrección.
- Claude y Codex se coordinan a través del estado de Git, no de la memoria de la conversación. Cada runtime reconstruye la identidad antes de escribir. La configuración específica de cada runtime no está definida en este documento.

## 6. Gates

**Gate A: revisión y evidencia.** Después de implementar: revisar el diff, comprobar el scope, ejecutar la verificación proporcional y decidir reviewer o tester según la sección 3. En TRIVIAL y NORMAL no implica STOP humano si la autorización de cierre ya cubre la continuación y no aparece ninguno de estos disparadores: BLOCKER o HIGH, decisión de producto, decisión de seguridad, conflicto entre fuentes, cambio de scope o escalamiento de riesgo.

**Gate B: datos reales.** Definido en `SECURITY.md`.

**Gate C: stage + commit.** Requiere autorización humana vigente con rama, paths exactos y mensaje exacto. En TRIVIAL y NORMAL, esa autorización puede darse una vez sobre el contrato y cubrir Gate C y Gate D. En SENSIBLE y CRÍTICO se dan por separado. Una autorización no se reutiliza para otra posta.

Antes de commitear:

1. verificar rama, HEAD y status;
2. revisar el diff y ejecutar `git diff --check`;
3. confirmar el scope exacto y que la evidencia sigue vigente;
4. confirmar ausencia de datos personales y secretos;
5. stagear solo paths explícitos con `git add -- <path...>`;
6. revisar el staged diff y ejecutar `git diff --cached --check`;
7. crear un commit con el mensaje exacto autorizado, sin cuerpo adicional;
8. verificar en modo lectura: HEAD, mensaje, archivos incluidos y status.

**Gate D: merge.** Requiere autorización vigente con base (normalmente `main`) y feature. Usar únicamente `git merge --ff-only <feature>`. Si el fast-forward no es posible: STOP. No hay merge commit, rebase, squash, cherry-pick ni borrado de ramas.

**Push.** Es una operación externa con autorización humana explícita por publicación. Una vez autorizada, el agente puede ejecutarla y verificarla.

- La autorización corresponde a la posta y al estado que se publica. Puede darse junto con la de cierre; no es permanente y no cubre otras publicaciones.
- Preflight: rama, HEAD, status y relación con `origin`. Deben publicarse solo los commits de esa posta.
- Usar `git push` normal hacia `origin`. Nunca `--force` ni variantes (`--force-with-lease`, `+refspec`), ni borrar refs remotas. No cambiar remotes ni configuración Git, ni ampliar permisos.
- Si el push es rechazado (por ejemplo, no fast-forward): STOP. Sin `pull`, `fetch` ni force.
- Después: verificar en modo lectura que el remoto quedó en el commit esperado.
- Si el nivel 0 bloquea o pide confirmación, se respeta. Si lo bloquea: BLOCKED.

## 7. Git

- Nunca `git add .`, `git add -A`, `git add *` ni globs para stagear.
- Nunca `git reset --hard`, `git clean`, rebase destructivo, borrar ramas, modificar remotes ni reescribir historial sin autorización.
- No usar `git stash`, restore, reset ni checkout para preparar un gate o esconder diferencias.
- Nunca `--amend` sin autorización explícita.
- Los commits pertenecen al usuario: sin `Co-Authored-By`, `Claude-Session`, `Signed-off-by`, URLs de sesión ni metadata de autoría generada por un agente.
- Merge solo `--ff-only` y con autorización (Gate D).
- No ocultar el exit code real mediante pipes o filtros. Sin polling, sin loops de `sleep` y sin retries automáticos. Si algo falla, identificar la causa raíz antes de reintentar.

## 8. Testing y evidencia

**Proporcionalidad.** La profundidad de las pruebas depende del nivel de riesgo. No repetir matrices ya cerradas sin causa concreta.

- Las pruebas usan datos sintéticos (`SECURITY.md`).
- Un harness temporal debe ejecutar el código de producción real, no una reimplementación paralela. No modifica producción ni queda como infraestructura permanente sin decisión explícita.
- Ante cambios de fechas, cubrir los casos relevantes: cambio de día, lunes/domingo, fin/inicio de mes, diciembre/enero, años bisiestos, `createdAt`, fechas futuras, períodos parciales y períodos abiertos.
- No modificar tests ni código solo para conseguir PASS. Un test que falla es evidencia a investigar.

**La evidencia pertenece al contenido exacto probado.**

- Antes del commit se asocia al contenido exacto de los archivos relevantes (HEAD por sí solo no lo identifica si hay cambios sin commit). Después del commit, al SHA.
- Al reutilizarla registrar: contenido exacto, mecanismo, resultado, limitaciones, cuándo caduca y qué cambios obligan a repetirla.
- Un cambio documental no invalida evidencia funcional. Un cambio en producción, tests, persistencia, migración, service worker o configuración relevante invalida solo la evidencia asociada a lo modificado.
- Nunca afirmar que algo pasó si solo se razonó por lectura, si pertenece a una versión anterior o si el artefacto no puede verificarse.
- Configuración de agentes o permisos: distinguir **A** (el archivo parsea), **B** (el runtime la carga) y **C** (el agente demuestra el comportamiento). Un PASS indica qué nivel quedó demostrado.

## 9. Cierre de posta

Informar solo lo aplicable, sin narrar cada comando: archivos modificados, comportamiento cambiado y preservado, pruebas y resultados, findings, riesgos residuales, estado de Git, commit si existe, y siguiente gate. Lo no verificado se dice explícitamente. Si el reporte necesita evidencia extensa, guardarla como artefacto temporal.

## 10. Medición del piloto

En las primeras postas con este harness, registrar solo lo observable: tiempo, autorizaciones, reintentos, hallazgos útiles, falsos positivos, bloqueos y fricción. Tokens o costo solo si la herramienta entrega una medición fiable. No estimar. Si el harness cuesta sistemáticamente más trabajo que el cambio que protege, se simplifica.
