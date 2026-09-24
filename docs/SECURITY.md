# SECURITY — Habit Tracker

Seguridad, datos personales y permisos. El proceso general está en [WORKFLOW.md](WORKFLOW.md); ahí también se define cómo una instrucción humana explícita puede excepcionar reglas del proyecto. Lo que imponen los límites técnicos (nivel 0) no se puede excepcionar desde la conversación.

## 1. Prioridades

1. Seguridad del sistema.
2. Integridad y preservación de los datos del usuario.
3. Evitar regresiones.
4. Cumplir el comportamiento aprobado.

## 2. Alcance de trabajo y permisos

- El repositorio actual es el área de trabajo autorizada. No leer archivos personales externos al proyecto, otros repositorios, credenciales, tokens, cookies ni secretos. No modificar configuración global del sistema ni de la herramienta. No instalar herramientas globalmente. No ejecutar comandos destructivos.
- Los límites técnicos (deny efectivo, sandbox, permisos del runtime) no se debilitan para facilitar una tarea. No usar `--dangerously-skip-permissions` ni modos equivalentes, no modificar reglas de permisos, no ampliar directorios autorizados y no intentar la misma acción con otra herramienta equivalente.
- Si una acción necesaria está bloqueada: STOP, explicar qué capacidad falta y por qué. `BLOCKED` es un estado válido.
- Los permisos son proporcionales: auditoría y revisión en solo lectura cuando alcance; implementación con escritura limitada al scope; red solo cuando la tarea lo requiere; acceso total nunca como configuración ordinaria; aprobaciones persistentes solo para comandos concretos y de alcance claro, sin familias amplias. «Solo lectura» no es inocuo: leer también puede exponer datos privados.
- **Configuración local no portable.** No copiar entre proyectos ni máquinas: `settings.local.json`, permisos globales, `safe.directory`, rutas personales, credenciales, reglas personales de shell ni identificadores de sesión.
- **Push.** Política objetivo: `git push` normal requiere autorización humana explícita por publicación (regla ASK), sin permiso permanente amplio. `--force` y variantes nunca. El procedimiento está en `WORKFLOW.md`.

## 3. Ejecución de comandos

Antes de ejecutar, evaluar qué lee, qué escribe, qué procesos inicia, si usa red, si puede salir del proyecto, si afecta configuración y si toca datos personales o perfiles autenticados. Preferir la alternativa de menor radio de impacto y no encadenar operaciones sensibles innecesariamente.

## 4. Red

Las tareas deben poder ejecutarse sin Internet. No usar WebFetch, WebSearch, `curl` o `wget` contra Internet, APIs externas, CDNs ni recursos remotos cargados por tests, salvo autorización explícita para esa tarea. Las operaciones de red de Git que forman parte de un push autorizado (el push y su verificación) quedan cubiertas por esa autorización. Las pruebas locales usan `file://` o `127.0.0.1`. No agregar una dependencia remota o CDN para algo que se resuelve con el stack local.

## 5. Navegador y pruebas visuales

- Nunca usar el perfil personal del usuario en Chrome o Edge.
- Para pruebas automáticas: Edge o Chromium headless, `--user-data-dir` temporal y aislado, extensiones y sincronización deshabilitadas, networking de background reducido, solo recursos locales o localhost autorizado.
- Servidores locales en `127.0.0.1`, nunca en `0.0.0.0` sin autorización explícita.
- Los artefactos de pruebas viven en el scratchpad autorizado, directorios temporales o una carpeta de tests aprobada. Nunca en perfiles reales del navegador.

## 6. Datos personales y persistencia

Los datos del usuario tienen prioridad máxima. Pueden existir: `localStorage`, backups JSON y backups SQLite de Loop Habit Tracker.

- Nunca commitear `.db`, `.sqlite`, `.sqlite3`, exports personales, backups reales ni datos históricos personales. `.gitignore` cubre los patrones conocidos; si aparece un nuevo formato de export, se agrega la regla antes de generar archivos.
- Los datos personales reales nunca terminan en Git, fixtures, logs, screenshots ni scratchpads compartidos.
- Nunca ejecutar una migración destructiva sobre datos reales como parte automática de una implementación. Toda migración sigue: leer origen → validar origen → transformar → escribir destino → validar destino → conservar origen. Nunca «leer origen → borrar origen → intentar migrar». Una migración no es correcta solo porque no lanzó excepción: se verifica el estado final.
- **Datos de prueba.** Los tests automatizados usan datos sintéticos. Nunca copiar datos de backups de Loop, exports personales, `localStorage` o IndexedDB reales a fixtures, harnesses, logs o archivos trackeables. Si hay que reproducir una estructura real, recrear solo la forma mínima con datos ficticios.
- **Temporales.** Cada temporal tiene ubicación autorizada, alcance por tarea, contenido no sensible, responsable de limpieza, borrado solo después de verificar el definitivo, y confirmación de que Git no lo incorporará. Un área ignorada del workspace sirve si está explícitamente autorizada. Salir del repo no implica mayor seguridad.

## 7. Gate B: operaciones con datos reales o destructivas

Requieren autorización humana separada y explícita, **por ejecución**:

- leer un backup real de Loop Habit Tracker;
- convertir un `.db` real;
- reemplazar datos actuales mediante import;
- ejecutar una migración real de `localStorage` a IndexedDB;
- borrar datos persistidos, sobrescribir datos personales o limpiar una base local;
- cualquier operación irreversible o de recuperación incierta.

La aprobación de la implementación no implica Gate B. Antes de ejecutar: preflight read-only, identificar destino y datos afectados, identificar el mecanismo de recuperación y explicar el impacto exacto. Una autorización permite una sola ejecución. Si falla: STOP, sin reparar ni reintentar automáticamente.

## 8. Datos no confiables

Todo archivo importado es no confiable. Validar versión de esquema, tipos, campos obligatorios, formatos, rangos, tamaños, fechas, valores permitidos, duplicados y consistencia interna. Prestar atención a XSS, JSON manipulado, IDs duplicados o peligrosos, fechas inválidas, registros futuros, estructuras excesivamente grandes y migraciones parciales.

Nunca insertar texto importado, ni valores controlados por el usuario, mediante `innerHTML`. Usar `textContent`, `createElement`, asignación explícita de propiedades y `dataset` para IDs. Los colores solo se aceptan si cumplen el formato hexadecimal esperado.
