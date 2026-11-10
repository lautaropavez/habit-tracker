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

> **Nota:** esta sección describe la base original (backup v1, dos claves de `localStorage`). Para el estado actual de datos (cuatro claves, Backup v3, archivados, SKIP y el ciclo del Calendario) ver la sección 6.

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

## 6. Backup v3, SKIP, archivados y ciclo del Calendario (estado real)

**Estado:** implementado y probado con datos sintéticos en el árbol de trabajo; **sin commit ni publicación** y **pendiente de prueba visual real** en navegador e iPhone (ver `ROADMAP.md`, P0). Las secciones 3 y 5 siguen vigentes para todo lo que no se contradice aquí; las reglas de estadísticas con SKIP, archivados y frecuencia heredada son adicionales y no cambian las de hábitos sin esos datos.

### Contrato y compatibilidad

- **Export:** la app exporta siempre `schemaVersion: 3`. **Import:** acepta v1, v2 y v3 y normaliza todo a la forma v3 (`archived: false`, `skips: {}`, y en v1 también `quantities: {}` y `kind: "boolean"`).
- **Raíz v3**, exactamente: `schemaVersion`, `exportedAt`, `habits`, `completions`, `quantities`, `skips`. v1 y v2 rechazan los campos que no les corresponden (`skips`, `archived`, `freqWindowDays`, período `loop-month`).
- **Hábito v3:** campos de v1 más `kind` (`boolean` o `quantitative`) y `archived` (booleano obligatorio). Un cuantitativo agrega `unit` (`"minutes"`) y `target` (`{ minutes }` o `null`). `quantities` conserva la regla de v2: la ausencia de entrada es distinta de `actualMinutes: 0`.
- **Frecuencia heredada de Loop:** `freqPeriod: "loop-month"` con `freqWindowDays: 30` (el denominador original) y `freq: "custom"`; `freqCount` de 1 a 30. En Loop, N/30 no es una ventana fija de 30 días ni un mes calendario; el backup solo **preserva** la fracción. No se simula una ventana ni se convierte a mes calendario. `freqWindowDays` existe únicamente con este período.
- **`skips`:** `{ "YYYY-MM-DD": { [habitId]: true } }`, solo para hábitos booleanos. Fechas reales y no futuras, sin huérfanos, solo valores `true`. **Nunca** coexiste con una completion `true` de la misma fecha y hábito (fatal al importar y al exportar).

### Persistencia y recuperación

- Cuatro claves de `localStorage`: `habits`, `completions`, `quantities`, `skips`. La salud (`missing`/`valid`/`corrupt`) se evalúa por clave; si cualquiera está corrupta rige el modo de solo lectura de la sección 2.
- El reemplazo de importación escribe y verifica las cuatro claves con snapshot y marker previos, y ante un fallo restaura las cuatro. El snapshot usa `snapshotVersion: 3` con `skipsRaw`; un snapshot `snapshotVersion: 2` de la versión anterior sigue siendo recuperable (restaura `skips` como ausente); versión 1 y formas inválidas siguen yendo a recuperación bloqueante sin tocar los datos vivos.

### SKIP, archivados y estadísticas

- **SKIP es un estado neutral:** nunca cuenta como completado ni como incumplido, y no se crea ninguna completion a partir de él.
- **Diario:** un día SKIP no forma período (no suma a la tasa y no corta ni extiende la racha). **Semanal/mensual:** un período con SKIP que no alcanzó el objetivo es neutral (ni cumplido ni fallido, no rompe la racha); si ya alcanzó el objetivo, se cumple. Si no queda ningún período puntuable por culpa de los neutrales, la tasa es "—". Un hábito sin SKIP calcula exactamente igual que antes.
- **`loop-month`:** sin tasa ni rachas ("—"); se conservan el total y los días omitidos. Texto: "N de 30 (frecuencia original de Loop, no es mes calendario)".
- **Archivados:** `archived` retira el hábito de **Hoy** sin borrar su historial. Calendario y Estadísticas lo listan al final con "(archivado)". Como el contrato no tiene `archivedAt`, tasa de éxito y rachas se muestran "—" y se conservan los totales históricos. Archivar y desarchivar desde la interfaz **no existe todavía**.
- **Edición:** guardar un hábito conserva su `archived` y, si es `loop-month`, toda su frecuencia (el modal la muestra fija, de solo lectura).
- **Vista previa de importación:** informa cantidad de archivados, de días SKIP (y fechas) y de hábitos con frecuencia heredada.

### Ciclo del Calendario (hábitos booleanos)

- Cada toque en una fecha editable avanza: **sin registro → completado → SKIP → sin registro**. "Sin registro" elimina completion y skip (no deja entradas `false`). Funciona también sobre días importados como SKIP o como completado.
- **Fechas editables:** cualquier fecha real, pasada o actual; las futuras no cambian al tocarlas. Esto incluye los días anteriores a `createdAt`: se pueden registrar y corregir (con un tono propio y una etiqueta accesible que avisa que **no cuentan en las estadísticas**, porque ninguna estadística cuenta antes de `createdAt`); `createdAt` y el resto del hábito nunca se modifican. Los hábitos de tiempo ya abrían el editor en cualquier fecha no futura, y sus celdas ahora también se operan con teclado.
- **Invariante:** nunca completion y skip a la vez. Un dato inconsistente se lee como completado y el siguiente paso lo deja solo en SKIP. Si la persistencia falla, el estado vuelve al anterior.
- **Hoy** no cambia: el botón alterna completado y no completado; marcar completado un día SKIP reemplaza el SKIP.
- **Cuantitativos:** no usan el ciclo; el Calendario sigue abriendo el editor de minutos.
- **Accesibilidad:** cada celda editable es un botón (teclado con Enter o espacio) con etiqueta que dice el estado actual y qué hará el toque. Hay una leyenda breve con los tres estados, visible solo para hábitos booleanos.

### Conversor Loop → Backup v3 (`tools/loop_habits_to_json.py`)

- **Fechas:** `Repetitions.timestamp` es la medianoche UTC de una fecha de calendario, sin zona horaria (semántica de `LocalDate` en Loop); se convierte con aritmética de días, sin usar la zona local. Un timestamp que no sea múltiplo exacto de 86400000 ms se rechaza.
- **Booleanos:** valores 1 y 2 → completion; 0 → sin registro (no se exporta); 3 (SKIP) → `skips`; −1 (UNKNOWN) → fatal. Un SKIP y otro valor el mismo día para el mismo hábito es un duplicado ambiguo y fatal. `createdAt` es la fecha del registro exportado más antiguo del hábito (completion, SKIP o cantidad); sin ningún registro, la fecha de conversión.
- **Archivados** se exportan con `archived: true`; un flag distinto de 0/1 es fatal.
- **Frecuencias:** 1/1, N/7 y N/30 (→ `loop-month`); cualquier otra es fatal.
- **Cuantitativo:** única configuración admitida `unit` `hs`, `target_type` 0, frecuencia 1/7, valor almacenado ×1000 → minutos enteros (una conversión inexacta es fatal); `target: null`, `plannedMinutes: null`, ceros explícitos conservados, sin tope diario de 1440. Los valores especiales (−1 y 3) son fatales.
- La conversión es todo o nada: ante cualquier problema no se escribe ningún archivo. La conversión real a Backup v3 se generó de forma privada (Gate B-7) y **no se importó**; los datos reales nunca entran a Git.

### Cantidades de tiempo (entrada y presentación)

- La única unidad de v3 es `minutes`; el dato persistido sigue siendo `actualMinutes` en minutos totales (sin campos nuevos, sin cambios en Backup v3 ni en el conversor).
- Hoy y el editor del Calendario usan dos campos compactos **HH : MM** y un botón **Guardar** (o Enter). Se valida al guardar (`parseHoursMinutes`): hasta dos dígitos por campo, horas 0–24, minutos 0–59, y con 24 horas los minutos deben ser 00 (máximo 1440 minutos). Campo vacío, signos, decimales o más de dos dígitos son errores que se muestran solo cuando ocurren (sin texto permanente de límites); nada se trunca en silencio y un valor inválido no escribe. Guardar sin cambios no escribe. Los botones −5 / +5 min se mantienen.
- Los minutos se muestran como `2 h 15 min` (`formatMinutesText`) y como `2h15` en espacios chicos (`formatMinutesCompact`). El objetivo del modal sigue ingresándose en minutos.
- Un registro histórico de más de 24 h (el conversor no impone tope) se conserva y se muestra completo, pero para editarlo hay que dejarlo dentro de 00:00–24:00.

### Temas visuales: Natural Linen y Noir Editorial

- Dos temas con las mismas variables CSS y la misma estructura: **Natural Linen** (claro, por defecto) y **Noir Editorial** (oscuro: fondo `#0A0A0A`, superficies `#171717`, separadores `#34312E`, acentos piedra `#B5B0A5`, texto marfil `#F0EBE2`; sin brillos, gradientes ni sombras). Un botón luna/sol arriba a la derecha alterna entre ambos y dice qué tema activa. La preferencia se guarda en su propia clave de `localStorage` (`habitTracker.theme`), fuera de las cuatro claves de datos: no forma parte del backup v3 ni del snapshot de importación. Un script mínimo en `<head>` la aplica antes del primer render. No hay tema automático del sistema. Paleta clara como variables CSS en `css/styles.css`: lino `#F6F3EA` (fondo), marfil `#FFFEFA` (tarjetas), piedra `#E4E3D9` (separadores), salvia `#9BAB91`, verde `#788C70`, tinta `#292E26`. Por contraste WCAG se usan derivados: texto secundario `#5F695C` (el sugerido `#697366` da 4,46:1 sobre lino), `#4F6249` para texto y botones verdes (blanco sobre `#788C70` da solo 3,6:1) y bordes de control `#7F8A79`. `#788C70` queda para rellenos y trazos. Los pares de texto/fondo de ambos temas se verifican con WCAG en `tests/ux_time/test_theme.js`.
- Sin fuentes externas (títulos y cifras con serif del sistema), sin gradientes y con sombras mínimas.
- Completado, SKIP y minutos se pintan solo con clases (paleta fija, sin color inline por hábito); el color del hábito queda en el borde izquierdo de las tarjetas. SKIP se distingue por borde punteado y ↷, los días futuros por borde punteado fino y los anteriores a `createdAt` por fondo tierra. Columna de escritorio de 760 px (Calendario 520 px) y regla para ≤ 480 px.
- `tests/ux_time/test_theme.js` verifica paleta y contrastes sobre el CSS; no sustituye la prueba visual en navegador.

### Menú ⋮ del encabezado

- Exportar e Importar backup viven en un menú ⋮ (junto al botón de tema); ya no hay botones visibles en el encabezado. Solo cambió dónde están: ejecutan las mismas funciones, con la misma validación, vista previa, reemplazo atómico y rollback. Se opera con mouse, teclado (flechas, Inicio, Fin, Escape, Tab) y táctil; se cierra con Escape, al elegir una opción y al tocar fuera. −5 min y +5 min van juntos, uno al lado del otro.

### Formulario de hábitos y gráfico de 30 días

- El formulario pregunta «¿Cómo querés registrarlo?» con un desplegable: **Marcar como completado** (tipo interno `boolean`) y **Registrar tiempo** (tipo interno `quantitative`, unidad `minutes`), con una ayuda breve que cambia según la opción. Los términos técnicos no se muestran. Al editar, la opción se ve deshabilitada (el tipo no se cambia). No hay unidades nuevas ni cambios de esquema o backup.
- Estadísticas muestra «Últimos 30 días» (hoy y los 29 anteriores, en orden cronológico, para hábitos de ambos tipos) en lugar del gráfico de 7 días. Mismo criterio diario que antes: completado / SKIP / sin registro (o minutos registrados); no infiere períodos, así que frecuencias semanales, `loop-month` y archivados muestran solo el dato diario y sus métricas no cambian. Un día sin registro anterior a `createdAt` se marca aparte (línea punteada); un registro anterior a `createdAt` nunca se oculta. Eje con 5 fechas (`Hoy` al final), descripción accesible del conjunto y detalle por día en el tooltip. Las barras se reparten el ancho disponible (sin scroll horizontal).

### Limitaciones conocidas

- Sin `archivedAt` y sin interfaz para archivar o desarchivar.
- Un 0 booleano de Loop no se distingue de un día sin registro después de importar.
- Sin tests de render en navegador real: los tests de interfaz usan un DOM falso.
