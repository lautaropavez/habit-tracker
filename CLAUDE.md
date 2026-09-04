# CLAUDE.md — Habit Tracker

## Propósito del proyecto

Habit Tracker es una aplicación web estática, mobile-first, pensada
principalmente para uso personal desde iPhone.

Se publica mediante GitHub Pages como project page:

https://lautaropavez.github.io/habit-tracker/

Por lo tanto:

- debe seguir funcionando sin backend;
- debe seguir siendo compatible con GitHub Pages;
- las rutas de assets deben ser relativas;
- la experiencia principal debe funcionar correctamente en Safari/iOS;
- la simplicidad, confiabilidad y preservación de datos tienen prioridad
  sobre agregar tecnología innecesaria.

Stack actual:

- HTML;
- CSS;
- JavaScript vanilla;
- APIs web nativas.

No introducir frameworks, bundlers, package managers, servicios externos
o infraestructura adicional salvo necesidad concreta y aprobación explícita.

---

# Fuentes de verdad

Usar, en este orden:

1. La SPEC o posta activa, si existe.
2. Las decisiones explícitas dadas por el usuario para la tarea actual.
3. Este `CLAUDE.md`.
4. `HABIT_TRACKER_AUDIT.md`.
5. Los invariantes establecidos por el comportamiento existente.
6. El código actual.

Si dos fuentes relevantes se contradicen:

STOP.

Reportar:

HUMAN DECISION REQUIRED

No inventar una decisión de producto.

No reabrir auditorías ya cerradas salvo que el diff actual o evidencia nueva
revele un problema concreto.

---

# Principios generales

Orden de prioridades:

1. Seguridad del sistema.
2. Integridad y preservación de los datos del usuario.
3. Evitar regresiones.
4. Cumplir correctamente el comportamiento aprobado.
5. Mantener el proyecto simple y entendible.
6. Mejorar arquitectura o UX cuando aporte valor concreto.

Una solución más sofisticada no es automáticamente mejor.

Preferir siempre:

- cambio mínimo;
- reversible;
- comprobable;
- trazable;
- fácil de mantener.

No refactorizar por gusto mientras se corrige otra cosa.

No construir infraestructura permanente para una necesidad descartable.

No ampliar el scope por iniciativa propia.

---

# Modelo de trabajo

El Claude principal actúa como implementer.

Puede:

- leer el proyecto;
- editar archivos dentro del scope aprobado;
- crear código necesario;
- ejecutar verificaciones autorizadas;
- preparar cambios para revisión.

No debe actuar simultáneamente como implementer, reviewer independiente
y adversarial tester para declarar su propio trabajo correcto.

Los agentes especializados complementan el workflow.

No reemplazan:

- las reglas de seguridad;
- Git;
- el scope;
- los checkpoints;
- la aprobación humana.

---

# Workflow por postas

Secuencia estándar:

1. comprensión / auditoría necesaria;
2. decisiones de producto;
3. definición del scope;
4. implementación;
5. Gate A — revisión y evidencia;
6. pruebas proporcionales al riesgo;
7. STOP — aprobación humana;
8. Gate C — stage + commit;
9. STOP — control post-commit;
10. Gate D — merge, solamente si se autoriza.

No avanzar automáticamente hacia una nueva etapa que implique:

- nueva decisión de producto;
- migración;
- persistencia;
- importación/reemplazo de datos;
- nueva superficie de seguridad;
- cambio arquitectónico relevante.

---

# Checkpoint antes de editar

Antes de modificar archivos:

- verificar rama actual;
- verificar HEAD;
- verificar `git status`;
- entender el scope;
- identificar archivos permitidos;
- identificar invariantes;
- identificar explícitamente lo que queda fuera de alcance.

Cada posta debe definir, como mínimo:

- objetivo;
- archivos permitidos;
- invariantes;
- fuera de alcance;
- criterios de aceptación;
- nivel de pruebas requerido.

Si aparece la necesidad de tocar un archivo fuera del scope:

STOP.

Reportar primero.

---

# Filosofía de implementación

Antes de modificar código:

- leer el código relacionado;
- entender el comportamiento existente;
- revisar callers y dependencias relevantes;
- identificar edge cases;
- diferenciar refactor de cambio funcional;
- buscar la solución más pequeña correcta.

No:

- reemplazar código que funciona solo porque existe una alternativa moderna;
- agregar abstracciones prematuras;
- crear wrappers triviales;
- introducir clases cuando una función simple alcanza;
- duplicar fuentes de verdad;
- esconder decisiones de producto dentro de decisiones técnicas.

Decisiones técnicas internas, reversibles y de bajo riesgo pueden resolverse
autónomamente.

Decisiones de producto, seguridad, datos o arquitectura relevante vuelven
al humano.

---

# Seguridad del equipo

El repositorio actual es el área de trabajo autorizada.

No intentar ampliar deliberadamente el alcance fuera del proyecto.

Nunca:

- leer archivos personales externos al proyecto;
- acceder a otros repositorios;
- leer credenciales, tokens, cookies o secretos;
- acceder a `~/.aws/**`;
- acceder a `~/.ssh/**`;
- modificar configuración global del sistema;
- modificar configuración global de Claude;
- modificar las propias reglas de permisos;
- instalar herramientas globalmente;
- ejecutar comandos destructivos;
- acceder a cuentas autenticadas del usuario;
- intentar evadir una regla `deny` utilizando otra herramienta equivalente.

Si algo necesario está fuera del scope o bloqueado:

STOP.

Explicar exactamente qué se necesita y por qué.

Nunca intentar sortear el sistema de permisos.

---

# Ejecución de comandos

Antes de ejecutar un comando evaluar:

- qué lee;
- qué escribe;
- qué procesos inicia;
- si usa red;
- si puede salir del proyecto;
- si afecta configuración;
- si interactúa con datos personales;
- si interactúa con perfiles autenticados.

Preferir la alternativa con menor radio de impacto.

No encadenar operaciones sensibles innecesariamente.

No ocultar el exit code real mediante pipes o filtros.

No polling.

No loops de `sleep`.

No retries automáticos.

Si una ejecución falla:

- identificar primera causa raíz;
- no repetir ciegamente;
- no modificar tests o código solo para conseguir PASS.

---

# Navegador y pruebas visuales

Nunca utilizar el perfil personal del usuario en Chrome o Edge.

No usar `claude-in-chrome` salvo autorización explícita.

Para pruebas automáticas de navegador:

- usar Edge/Chromium headless;
- usar `--user-data-dir` temporal y aislado;
- deshabilitar extensiones;
- deshabilitar sync;
- reducir networking de background;
- utilizar únicamente recursos locales o localhost autorizado.

Preferir:

127.0.0.1

No exponer servidores en:

0.0.0.0

salvo autorización explícita.

Artefactos de pruebas de navegador deben vivir en:

- scratchpad autorizado;
- directorios temporales;
- o una carpeta de tests aprobada.

Nunca en perfiles reales del navegador.

---

# Git

Rama base normal del proyecto:

main

Trabajar en la rama feature autorizada.

Nunca usar:

git add .
git add -A
git add *
globs para staging

Stagear solamente archivos explícitos:

git add -- <path1> <path2>

Nunca:

- `git push`;
- force push;
- `git reset --hard`;
- `git clean`;
- rebase destructivo;
- modificar remotes;
- borrar ramas;
- reescribir historial sin autorización;
- hacer merge sin aprobación explícita.

No usar `git stash` como mecanismo para preparar gates o reconstruir estado.

No usar restore/reset/checkout para esconder diferencias durante un cierre.

Antes de commit:

1. verificar rama;
2. verificar HEAD;
3. revisar `git status`;
4. revisar diff;
5. ejecutar `git diff --check`;
6. confirmar scope exacto;
7. confirmar evidencia vigente;
8. stagear paths explícitos;
9. revisar staged diff;
10. confirmar ausencia de datos personales o secretos.

---

# Autoría de commits

Los commits pertenecen únicamente al usuario.

Nunca agregar:

- `Co-Authored-By`;
- `Claude-Session`;
- `Signed-off-by`;
- trailers de Claude;
- URLs de sesión;
- metadata de autoría generada por Claude.

El mensaje de commit debe ser exactamente el autorizado.

No agregar cuerpo adicional salvo autorización explícita.

Nunca usar `--amend` salvo autorización explícita excepcional.

---

# Datos personales y persistencia

Los datos del usuario tienen prioridad máxima.

Actualmente pueden existir:

- localStorage;
- futuros datos IndexedDB;
- backups JSON;
- backups SQLite de Loop Habit Tracker.

Nunca commitear:

- `.db`;
- `.sqlite`;
- `.sqlite3`;
- exports personales;
- backups reales;
- datos históricos personales.

Nunca ejecutar una migración destructiva sobre datos reales como parte
automática de una implementación.

Toda migración debe seguir conceptualmente:

leer origen
→ validar origen
→ transformar
→ escribir destino
→ validar destino
→ conservar origen

Nunca:

leer origen
→ borrar origen
→ intentar migrar

Una migración no se considera correcta únicamente porque no lanzó excepción.

Debe verificarse el estado final.

---

# Gate B — operaciones sensibles o destructivas

Requieren autorización humana separada y explícita:

- leer un backup real de Loop Habit Tracker;
- convertir un `.db` real;
- reemplazar datos actuales mediante import;
- ejecutar migración real de localStorage → IndexedDB;
- borrar datos persistidos;
- sobrescribir datos personales;
- limpiar una base local;
- ejecutar cualquier operación irreversible o de recuperación incierta.

La aprobación de implementación NO implica autorización para Gate B.

Antes de ejecutar:

- hacer preflight read-only;
- identificar destino;
- identificar datos afectados;
- identificar mecanismo de recuperación;
- explicar impacto exacto.

Una autorización permite una sola ejecución.

Si falla:

STOP.

No reparar ni reintentar automáticamente.

---

# Protección contra datos no confiables

Todo archivo importado se considera no confiable.

Validar:

- versión de esquema;
- tipos;
- campos obligatorios;
- formatos;
- rangos;
- tamaños;
- fechas;
- valores permitidos;
- duplicados;
- consistencia interna.

Nunca insertar texto importado directamente mediante `innerHTML`.

Preferir:

- `textContent`;
- `createElement`;
- asignación explícita de propiedades;
- sanitización segura cuando corresponda.

Prestar especial atención a:

- XSS;
- JSON manipulado;
- IDs duplicados;
- fechas inválidas;
- registros futuros;
- estructuras excesivamente grandes;
- migraciones parciales.

---

# Fechas e invariantes actuales

Las fechas son parte crítica del dominio.

Evitar conversiones UTC accidentales cuando la regla del producto sea fecha
local.

Probar explícitamente:

- cambio de día;
- lunes/domingo;
- fin/inicio de mes;
- diciembre/enero;
- años bisiestos;
- createdAt;
- fechas futuras;
- períodos parciales;
- períodos abiertos.

Decisiones actuales:

- diario se evalúa por día;
- semana va de lunes a domingo;
- frecuencia semanal no impone días específicos;
- frecuencia mensual usa mes calendario;
- períodos abiertos no rompen racha;
- primer período parcial semanal/mensual no entra en tasa histórica ni racha;
- las completions del primer período parcial sí cuentan en total;
- el progreso del primer período parcial sí puede mostrarse;
- ninguna estadística cuenta antes de `createdAt`.

No modificar estas reglas sin decisión humana explícita.

---

# Proporcionalidad de pruebas

La intensidad depende del riesgo.

## Cambio pequeño / bajo riesgo

Ejemplos:

- documentación;
- CSS aislado;
- texto;
- refactor mecánico demostrado equivalente.

Normalmente:

- comprobación estática;
- `git diff --check`;
- revisión del diff.

## Cambio medio

Ejemplos:

- lógica UI;
- estadísticas;
- calendario;
- validaciones;
- comportamiento visible.

Requiere:

- tests dirigidos;
- casos límite relevantes;
- prueba funcional del flujo afectado.

## Cambio alto

Ejemplos:

- localStorage / IndexedDB;
- migraciones;
- import/export;
- datos personales;
- service worker;
- cache/offline;
- seguridad;
- recuperación;
- conversión de backups reales.

Requiere:

- matriz dedicada;
- reviewer;
- adversarial tester cuando exista threat model concreto;
- validación de estado final;
- Gate B si se tocan datos reales.

No repetir matrices ya cerradas sin una causa concreta.

---

# Evidencia

La evidencia pertenece al código exacto que fue probado.

Mientras haya cambios sin commit, asociarla al contenido exacto de archivos
relevantes.

Después del commit, asociarla al SHA del commit.

Un cambio documental que no afecta código no invalida evidencia funcional.

Un cambio en:

- producción;
- tests;
- persistencia;
- migración;
- service worker;
- configuración relevante

invalida únicamente la evidencia relacionada con lo modificado.

Nunca afirmar que una prueba pasó si:

- solo se razonó por lectura;
- pertenecía a una versión anterior;
- el artefacto no puede verificarse;
- el código cambió después.

No optimizar para conseguir PASS.

Optimizar para determinar si el cambio realmente está listo.

---

# Gate A — implementación y review

Después de implementar:

1. revisar el diff;
2. comprobar alcance;
3. ejecutar verificación proporcional;
4. decidir si corresponde reviewer;
5. decidir si corresponde adversarial tester.

El reviewer independiente recibe:

- SPEC / contrato activo;
- CLAUDE.md;
- diff real;
- archivos estrictamente necesarios.

No recibe:

- una lista de findings que debería encontrar;
- una conclusión predeterminada del implementer.

El reviewer:

- es read-only;
- no corrige findings;
- no stagea;
- no commitea.

Findings vuelven al implementer.

El implementer puede realizar una sola corrección automática dentro del scope
autorizado únicamente ante findings objetivos LOW o MEDIUM.

Requieren STOP humano:

- BLOCKER;
- HIGH;
- decisión de producto;
- expansión de scope;
- segundo ciclo de corrección.

El adversarial tester se utiliza ante riesgo concreto.

No por rutina.

---

# Code Reviewer

El reviewer es independiente del implementer.

Debe buscar:

- bugs reales;
- regresiones;
- corrupción o pérdida de datos;
- inconsistencias de fechas;
- problemas de persistencia;
- migraciones inseguras;
- validación insuficiente;
- XSS;
- fallos de offline/cache;
- incompatibilidades GitHub Pages;
- riesgos Safari/iOS;
- scope creep;
- código muerto.

Nunca modifica código.

Nunca ejecuta comandos.

Nunca toca Git.

---

# Adversarial Tester

El tester intenta romper el comportamiento aprobado.

Priorizar según el cambio:

- datos corruptos;
- JSON malicioso;
- migración parcial;
- duplicados;
- import repetido;
- pérdida de historial;
- fechas límite;
- semanas/meses/años;
- registros futuros;
- localStorage corrupto;
- IndexedDB fallando;
- cambio de almacenamiento;
- service worker viejo;
- cache desactualizado;
- funcionamiento offline;
- recuperación tras fallo.

No corrige producción.

No stagea.

No commitea.

No push.

Los findings vuelven al implementer.

---

# Gate C — stage + commit

Gate C debe ejecutarse mediante la skill `close-posta` cuando corresponda.

Requiere autorización humana actual con:

- rama;
- paths exactos;
- mensaje exacto de commit.

La autorización anterior no se reutiliza automáticamente.

Antes de stagear:

- reconstruir estado desde Git;
- verificar scope;
- verificar evidencia;
- confirmar ausencia de archivos inesperados.

Stagear únicamente paths exactos.

Después:

- revisar staged file list;
- `git diff --cached --check`;
- commit exacto;
- post-commit read-only.

No push.

---

# Gate D — merge

Merge solamente con autorización humana explícita actual.

Rama base normal:

main

Usar únicamente:

git merge --ff-only <feature>

Nunca:

- merge commit;
- rebase;
- squash automático;
- cherry-pick;
- borrar rama;
- push.

Si fast-forward no es posible:

STOP.

No intentar otra estrategia.

---

# Cierre de posta

Antes de declarar una posta terminada informar:

- archivos modificados;
- comportamiento cambiado;
- comportamiento preservado;
- decisiones técnicas;
- pruebas ejecutadas;
- resultados;
- findings;
- riesgos residuales;
- estado de Git;
- commit, si existe;
- siguiente gate.

Si algo no fue verificado, decirlo explícitamente.

No describir como probado algo inferido únicamente por lectura.

---

# Jerarquía de seguridad y permisos

Las instrucciones de este archivo nunca reemplazan ni debilitan las
restricciones técnicas de `.claude/settings.local.json` o de la configuración
global de Claude Code.

Si una tarea requiere una acción bloqueada por permisos:

- no intentar una herramienta equivalente;
- no proponer desactivar el bloqueo como primera solución;
- no modificar archivos de permisos;
- no ampliar directorios autorizados;
- STOP y explicar qué capacidad falta y por qué.

Nunca solicitar `--dangerously-skip-permissions`, bypass de permisos ni modos
equivalentes para completar una posta.

La imposibilidad de ejecutar una acción es un estado BLOCKED válido; no es una
razón para reducir la seguridad.

# Acceso a red

Por defecto, las tareas del proyecto deben poder ejecutarse sin acceso a
Internet.

No usar:

- WebFetch;
- WebSearch;
- curl/wget contra Internet;
- APIs externas;
- CDNs;
- recursos remotos cargados por tests;

salvo autorización explícita para esa tarea.

Las pruebas locales deben preferir `file://` o `127.0.0.1`.

Nunca agregar una dependencia remota o CDN para resolver algo que puede
resolverse con el stack local existente sin una decisión explícita.

# Invocación de agentes

No usar multiagente por defecto.

El implementer puede invocar `code-reviewer` o `adversarial-tester` solamente
cuando el workflow/Gate A lo justifique.

Reviewer y tester:

- no pueden invocar otros agentes;
- no pueden delegar sus responsabilidades;
- no pueden transformar su rol read-only/tester en implementer;
- no pueden iniciar otro ciclo autónomo de implementación.

Un finding vuelve al implementer principal.

No crear cadenas recursivas de agentes.

# Datos de prueba

Los tests automatizados deben utilizar datos sintéticos.

Nunca copiar datos reales de:

- backups de Loop Habit Tracker;
- exports personales;
- localStorage real del usuario;
- IndexedDB real del usuario;

a fixtures, harnesses, logs o archivos trackeables.

Si una prueba necesita reproducir una estructura real, recrear únicamente la
forma mínima necesaria con datos ficticios.

El acceso a datos personales reales requiere Gate B cuando corresponda.

---

# Regla final

Actuar como si una regresión, pérdida de datos o incidente de seguridad
fuera responsabilidad propia.

Autonomía alta dentro del scope aprobado.

Radio de impacto mínimo fuera de él.

Ante varias soluciones correctas elegir la más:

- simple;
- segura;
- reversible;
- verificable;
- mantenible.