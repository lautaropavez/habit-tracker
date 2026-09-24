# PROJECT_CONTEXT — Habit Tracker

Estado vigente del producto y decisiones cerradas. La secuencia de trabajo está en [ROADMAP.md](ROADMAP.md); el proceso en [WORKFLOW.md](WORKFLOW.md); la seguridad en [SECURITY.md](SECURITY.md). `HABIT_TRACKER_AUDIT.md` es historia: no es fuente de estado vigente ni documentación viva.

Las descripciones de código de la sección 2 fueron verificadas contra el commit `3e50e7a`.

## 1. Propósito y publicación

Aplicación web estática, mobile-first, de uso personal, pensada principalmente para iPhone. Se publica en GitHub Pages como project page: <https://lautaropavez.github.io/habit-tracker/>.

Consecuencias:

- funciona sin backend;
- es compatible con GitHub Pages: las rutas de assets son relativas, nunca absolutas desde `/`;
- la experiencia principal debe funcionar en Safari/iOS;
- simplicidad, confiabilidad y preservación de datos pesan más que agregar tecnología.

Stack: HTML, CSS, JavaScript vanilla y APIs web nativas. Sin frameworks, bundlers, package managers ni servicios externos (ver `WORKFLOW.md`).

## 2. Estado técnico actual (verificado)

- **Estructura.** `index.html` carga `css/styles.css` y `js/app.js` con rutas relativas. Un solo script sin módulos.
- **Persistencia.** Solo `localStorage`, con dos claves: `habits` (array de hábitos) y `completions` (objeto `{ 'YYYY-MM-DD': { [habitId]: boolean } }`).
- **Hábito.** Campos usados por la app: `id`, `name`, `icon`, `color`, `freq` (`daily` o `custom`), `freqCount`, `freqPeriod` (`week` o `month`) y `createdAt`. Los IDs se generan con `Date.now().toString()`. Hay 12 iconos y 10 colores predefinidos en `js/app.js`.
- **Estadísticas.** Se calculan por período (día, semana lunes-domingo o mes calendario) desde `createdAt` hasta hoy, con las reglas de la sección 3.
- **Protección ante corrupción.** `state.storageHealth` clasifica cada clave como `missing`, `valid` o `corrupt`. Si alguna está corrupta, la app entra en modo read-only global: no se crea, edita, elimina ni marca nada, no se migra `createdAt`, `saveData()` no escribe, se muestra un banner y los botones mutantes quedan deshabilitados. La validación de `habits` exige raíz Array con elementos objeto (no `null`, no Array); la de `completions`, raíz objeto (no `null`, no Array). No hay validación profunda de campos internos.
- **UI.** Tres vistas (Hoy, Calendario, Estadísticas), botón flotante `+`, modal de alta y edición. Se renderiza con `innerHTML` (incluye datos del hábito): es el foco de la etapa 5a.
- **No existen hoy:** IndexedDB, import/export, service worker, manifest o PWA, tests o harnesses permanentes, CI, scheduler, `qa-visual`, ni configuración de Codex.

## 3. Reglas de dominio vigentes (fechas y estadísticas)

Las fechas son parte crítica del dominio. Evitar conversiones UTC accidentales cuando la regla sea fecha local.

- El diario se evalúa por día.
- La semana va de lunes a domingo.
- La frecuencia semanal no impone días específicos: se evalúa por semana completa contra `freqCount`.
- La frecuencia mensual usa el mes calendario, evaluado por mes completo.
- Los períodos abiertos (hoy, la semana o el mes en curso) no rompen la racha. El progreso del período actual se muestra aparte y no entra en la tasa de éxito.
- La tasa de éxito y las rachas usan solo períodos cerrados.
- El primer período parcial semanal o mensual no entra en la tasa histórica ni en la racha; sus completions sí cuentan en el total; su progreso sí puede mostrarse mientras está en curso.
- Ninguna estadística cuenta antes de `createdAt`. Para hábitos sin `createdAt`, `loadData` lo infiere de la completion `true` más antigua.

No modificar estas reglas sin decisión humana explícita.

## 4. Decisiones de producto vigentes

- Los backups son un export JSON manual, sin nube. Quedan fuera de alcance OAuth, APIs externas y sincronización automática; subir archivos a un servicio queda como decisión aparte.
- Sin backend, sin cuentas ni login, sin servicios externos ni pagos.
- Sin sobreingeniería: capas finas, sin ORM, service worker solo para el app shell si llega a hacerse, conversor de Loop como script simple.
- Historial real de Loop Habit Tracker: se importará mediante conversión local a backup JSON v1 (ver ROADMAP). Los datos reales nunca entran a Git.

## 5. Decisiones cerradas de las etapas 5a y 5b

Transcritas del contrato congelado. Cada posta reconstruye y verifica su SPEC ejecutable antes de implementar. No hay decisiones de producto abiertas en esta sección; los detalles que se definen en cada SPEC están al final.

### Schema público del backup v1

- **Raíz**, exactamente: `schemaVersion` (`1`), `exportedAt`, `habits`, `completions`. `exportedAt` es un ISO UTC informativo.
- **Cada hábito**, exactamente: `id`, `name`, `icon`, `color`, `freq`, `freqCount`, `freqPeriod`, `createdAt`. El campo se llama `freqPeriod` (no `period`).
- `createdAt` es obligatorio: `YYYY-MM-DD`, fecha real y no futura.
- `completions` contiene solo valores `true`; las fechas vacías se eliminan.
- **`name` tiene dos límites distintos, sin contradicción:** creación y edición desde la UI, máximo 200 code points; schema de backup v1 e importación, máximo 5000 code points. Un hábito legacy o importado puede superar los 200 code points aunque la UI no permita crear uno nuevo así. Nunca se trunca, acota ni normaliza en silencio.
- **IDs:** `^[A-Za-z0-9_-]{1,64}$`. Los IDs duplicados son fatales. Se rechazan `__proto__`, `constructor` y `prototype`.
- **`BACKUP_V1_ICONS`** es una whitelist congelada del schema v1, independiente de la constante `ICONS` de la UI y sin depender automáticamente de futuros cambios de UI. Su enumeración exacta se congela al preparar 5a (ver pendientes).

### 5a. Hardening de render + export JSON

Objetivo: cerrar los sinks XSS **antes** de crear la importación, y exportar un backup esquema v1.

- Valores controlados por el usuario no se interpolan con `innerHTML`: se usa `createElement`, `textContent` y asignación de propiedades. El color se valida con regex hexadecimal. Los IDs viajan por `dataset`.
- No se agregan archivos nuevos sin una decisión nueva. Sin cambios en las estadísticas.
- **Formato del export:** el schema público descrito arriba. Se exportan solo esos campos.
- Nombre del archivo: `habitos-backup-YYYY-MM-DD-HHmm.json`.
- En iPhone: `navigator.canShare({ files })` más `navigator.share` cuando funcione; si no, fallback a `<a download>` con ObjectURL y `revoke`.
- El export es read-only. Un dataset vacío es válido.
- Validadores compartidos: `freqCount` entero de 1 a 30; `icon` dentro de `BACKUP_V1_ICONS`; IDs únicos. La UI limita `name` a 200 code points al crear o editar. La generación de IDs actual (`Date.now()`) incorpora una guardia de unicidad: ante una colisión se genera otro ID. Los IDs existentes no se reescriben.
- **Preflight de export:** se valida todo el estado vivo contra el schema v1. Si algo es inválido: se aborta el export con un error concreto (hábito y campo), sin reparar, truncar ni acotar valores. Las únicas normalizaciones permitidas son eliminar completions `false` y eliminar objetos de fecha vacíos.
- Pruebas exigidas: límite de 200 y 201 code points de la UI (incluyendo emoji astral), `freqCount` inválido, colisión de ID, preflight inválido, y export exitoso después de corregir.

### 5b. Import JSON con preview y reemplazo seguro (depende de 5a)

- **Solo reemplazo. No hay merge ni fusión.** (Reemplaza lo dicho en la auditoría §7.6, que hablaba de fusionar.)
- `validateBackup(rawText)` es pura: sin storage, sin DOM, sin red. Devuelve `{ ok, fatal, warnings, summary, data }`.
- Límites: `schemaVersion` exactamente 1; `exportedAt` ISO parseable; campos desconocidos en la raíz o en un hábito son fatales; máximo 200 hábitos; máximo 20 000 claves de fecha de completions; máximo 200 000 entradas `true`; archivo de hasta 5 MB.
- Campos del hábito según el schema público: `id` (regla de IDs y protección contra prototype pollution), `name` de 1 a 5000 code points sin caracteres de control, `icon` dentro de `BACKUP_V1_ICONS` y de hasta 8 code points, `color` con `^#[0-9A-Fa-f]{6}$`, `freq` `daily` o `custom`, `freqCount` entero de 1 a 30, `freqPeriod` `week` o `month`, `createdAt` obligatorio y válido. Las fechas de completions deben ser válidas y no futuras. Las completions huérfanas son fatales.
- Warnings permitidos: completion `false` descartada y fecha vacía descartada.
- **Preview** read-only, con `textContent`: muestra los paths fatales y una advertencia clara de reemplazo.
- **Recovery.** Snapshot interno, separado del backup público, en la clave `habitTracker.import.snapshot.v1` con forma `{ snapshotVersion: 1, createdAt, habitsRaw, completionsRaw }`: strings crudos exactos, preservando `null`. Marker en `habitTracker.import.state.v1`. El snapshot y el marker se escriben y verifican **antes** de tocar datos vivos.
- **Secuencia de reemplazo:** datos validados → serializar los strings nuevos → capturar el crudo actual → estimación de capacidad → escribir y verificar snapshot → escribir y verificar marker → escribir `habits` → escribir `completions` → verificación estructural → borrar marker → `loadData` y render.
- **Invariantes del reemplazo:** la estimación de capacidad es solo heurística y no demuestra que la escritura vaya a caber; después del reemplazo existe una verificación estructural; ante un fallo se aplica rollback y recovery; no se usa un fingerprint gigante como sustituto de la verificación estructural.
- **Rollback:** restaurar los strings crudos exactos. Si el rollback falla, no se borra el snapshot.
- **Estados al arrancar:**
  - sin marker ni snapshot: normal;
  - sin marker y con snapshot: limpieza pendiente después de un arranque limpio verificado (el snapshot se retiene hasta entonces);
  - marker con snapshot válido: import interrumpido; `recoverInterruptedImport` recupera **antes** del `loadData` normal;
  - marker con snapshot ausente o corrupto: modo de recuperación bloqueante: sin `loadData` normal, sin normalización, sin borrar el marker, sin auto-reparación y sin «continuar de todos modos».
- Los tests son sintéticos primero. Usar datos reales requiere Gate B separado (`SECURITY.md`).

### Detalles que se definen en cada SPEC ejecutable

No son decisiones de producto abiertas; no se inventan aquí.

- **5a:** enumeración exacta de `BACKUP_V1_ICONS`, congelada al preparar 5a a partir del conjunto aprobado entonces. Ajuste del scope documental de 5a a los documentos canónicos de Harness V2 (`PROJECT_CONTEXT`, `ROADMAP` y `WORKFLOW` cuando corresponda): la antigua lista de archivos permitidos, que incluía `HABIT_TRACKER_AUDIT.md`, pertenece a la gobernanza anterior a H2.
- **5b:** detalle exacto de la estimación de capacidad y de la verificación estructural.
