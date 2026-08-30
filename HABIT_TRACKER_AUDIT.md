# Auditoría — Mis Hábitos (habit-tracker)

Fecha: 2026-08-06
Rama de trabajo: `claude/habit-tracker` (main no se toca)
Repo remoto: `https://github.com/lautaropavez/habit-tracker` → GitHub Pages como **project page**, URL final `https://lautaropavez.github.io/habit-tracker/`. Esto importa: todas las rutas nuevas (manifest, service worker, íconos, css/js) deben ser **relativas**, nunca absolutas desde `/`, porque la app no vive en la raíz del dominio.

Método: lectura completa y estática de `index.html` (1085 líneas, único archivo trackeado además de `.gitignore`). No se pudo hacer prueba visual en navegador en esta sesión (sin extensión claude-in-chrome instalada); el usuario validará manualmente en `http://127.0.0.1:8765`, servido con `python -m http.server 8765 --bind 127.0.0.1` (ya corriendo en background).

---

## 1. Arquitectura actual

- **Un solo archivo**: `index.html` (29 KB) con HTML + `<style>` inline + `<script>` inline. Sin build step, sin dependencias externas, sin framework. Vanilla JS.
- **Persistencia**: `localStorage`, dos claves:
  - `habits`: array de objetos `{ id, name, icon, color, freq, freqCount, freqPeriod }`
  - `completions`: objeto `{ [fecha 'YYYY-MM-DD']: { [habitId]: boolean } }`
- **Estado en memoria**: objeto global `state` (habits, completions, selección de UI, mes de calendario, vista activa).
- **Render**: manual, vía `innerHTML` + reasignación de listeners en cada render (no hay virtual DOM ni framework).
- **Navegación**: 3 tabs (Hoy / Calendario / Estadísticas) controladas por índice de array, sin router, sin URL state.
- **Fechas**: `toLocalDateStr()` centraliza el formateo a fecha local (evita el bug clásico de UTC), y se usa consistentemente. Correcto.
- **Sin tests, sin linter, sin package.json, sin CI.**
- **Sin manifest, sin service worker, sin íconos** — no es PWA todavía, solo tiene dos meta tags (`apple-mobile-web-app-capable`, `theme-color`).
- **GitHub Pages**: sin workflow en `.github/`, sin `CNAME` → deploy clásico por configuración del repo (rama + carpeta), sirviendo `index.html` de la raíz. Confirma que cualquier asset nuevo debe referenciarse con rutas relativas.
- **Backups de Loop Habit Tracker** (`Loop Habits Backup *.db`) están en el directorio de trabajo pero correctamente excluidos de git vía `.gitignore` (`*.db`, `Loop Habits Backup*`). No están trackeados — confirmado con `git ls-files`.

## 2. Funcionalidades existentes (a preservar)

1. Crear hábito: nombre, ícono (12 opciones), color (10 opciones), frecuencia (diaria o "N veces por semana/mes").
2. Editar hábito (mismo modal, precargado).
3. Eliminar hábito (con `confirm()`, borra también sus completions históricas).
4. Marcar/desmarcar hábito completado en el día de hoy (tab "Hoy").
5. Vista de calendario mensual por hábito: navegación mes anterior/siguiente, marcar/desmarcar cualquier día pasado o de hoy (los días futuros están bloqueados), indicador visual de completado, resaltado del día actual.
6. Vista de estadísticas por hábito: tasa de éxito, racha actual, mejor racha, total completados, gráfico de barras de los últimos 7 días.
7. Estado vacío ("No tienes hábitos...") cuando no hay hábitos cargados.
8. Estilo dark, mobile-first, tarjetas grandes, botón flotante "+".

## 3. Errores detectados

### 3.1 Bug crítico de frecuencia — `shouldTrackOnDate()` no filtra nada
```js
function shouldTrackOnDate(habit, date) {
  if (habit.freq === 'daily') return true;
  if (habit.freq === 'custom') return true;
  return true;
}
```
Las tres ramas devuelven `true`. Esto significa que un hábito configurado como "3 veces por semana" es tratado, para todo cálculo de estadísticas y rachas, como si tuviera que cumplirse **todos los días**. Consecuencias:
- `successRate` de un hábito custom es artificialmente bajo (se penalizan como "incumplidos" los días en que el usuario nunca se comprometió a hacerlo).
- `currentStreak` / `bestStreak` se rompen con cualquier día no marcado, aunque el usuario esté cumpliendo su objetivo semanal/mensual.
- La UI ya guarda `freqCount` y `freqPeriod`, pero **ningún cálculo los usa**. Es la causa raíz pedida a corregir en el punto 6 del pedido original.

> **Resuelto (decisión de producto, ver sección 7.1):** diario se calcula por días, "N veces por semana" por semanas completas, "N veces por mes" por meses completos. No se infieren días obligatorios dentro del período.

### 3.2 Racha actual: semántica no documentada, y acoplada al bug anterior
```js
if (completed) {
  ...
  if (i === 0 || currentStreak > 0) currentStreak++;
} else {
  tempStreak = 0;
  if (i === 0) currentStreak = 0;
}
```
Con `shouldTrackOnDate` arreglado, esta lógica sigue siendo puramente "días consecutivos completados desde hoy hacia atrás", válida solo para hábitos diarios. Para hábitos con frecuencia custom no hay noción de racha definida (¿racha en días? ¿en semanas donde se cumplió el objetivo?). Hay que definir explícitamente la semántica antes de corregir el cálculo (ver plan, etapa de frecuencias).

Además, si hoy (`i === 0`) todavía no se marcó, la racha actual cae a 0 inmediatamente aunque ayer haya un streak largo activo. Es una decisión de producto razonable (muchos habit trackers lo hacen así), pero no está documentada ni es evidente — hay que decidir si se mantiene o se da margen "hasta el cierre del día".

> **Resuelto (decisión de producto, ver sección 7.2):** un período abierto (hoy, para diarios; la semana o el mes en curso, para custom) nunca rompe la racha anterior hasta que ese período termine sin alcanzar el objetivo. La tasa de éxito se calcula solo con períodos ya cerrados; el período en curso se muestra aparte como progreso.

### 3.3 Ventana fija de 90 días en `calculateStats()`
Solo se analizan los últimos 90 días. Si un hábito tiene más de 90 días de antigüedad, `bestStreak` puede subestimarse si la mejor racha histórica ocurrió antes de ese corte. No es incorrecto per se, pero es una limitación a documentar (y a resolver naturalmente cuando se migre a un cálculo dirigido por rango real de datos, no por ventana fija).

### 3.4 `loadData()` sin manejo de errores
```js
const h = localStorage.getItem('habits');
if (h) state.habits = JSON.parse(h);
```
Si el JSON en `localStorage` está corrupto (edición manual, escritura parcial, futura migración fallida), `JSON.parse` lanza una excepción no capturada y la app queda en blanco sin ningún mensaje. Riesgo relevante justo antes de introducir una migración a IndexedDB.

### 3.5 IDs de hábito por `Date.now().toString()`
Colisión posible si se crean dos hábitos en el mismo milisegundo (poco probable por UI manual, pero relevante para el importador JSON y el conversor de Loop Habit Tracker, que pueden generar varios IDs en el mismo tick). Conviene pasar a un identificador más robusto (`crypto.randomUUID()`) al tocar ese código.

### 3.6 Accesibilidad / mobile menor
- Botones de acción (`✏️`, `🗑️`, check) son pequeños en pantallas angostas cuando el nombre del hábito es largo (`flex-wrap: wrap` mitiga pero no soluciona targets táctiles chicos).
- Inputs tienen `font-size: 16px` (correcto, evita el zoom automático de iOS Safari) — esto **sí está bien hecho**, mantenerlo.
- No hay `apple-touch-icon`, por lo que al agregar a pantalla de inicio en iOS actualmente se usa un ícono genérico (captura de la página).

## 4. Riesgos de pérdida de datos

1. **Todo vive únicamente en `localStorage` del navegador/dispositivo.** Borrar datos de Safari, reinstalar iOS, cambiar de dispositivo, o modo privado → pérdida total, sin backup posible hoy. Es el riesgo más alto y la motivación principal de los puntos 8 y 9 del pedido (export/import + IndexedDB).
2. **`deleteHabit()` es irreversible y sin backup previo**: borra el hábito y **todas** sus completions históricas, con un solo `confirm()` nativo. No hay export automático ni papelera.
3. **`localStorage` no tiene versionado de esquema.** Si más adelante se cambia la forma de los datos, no hay forma de detectar versión vieja vs. nueva sin un campo explícito.
4. **Migración a IndexedDB es un punto de riesgo en sí misma**: si se hace mal, puede leer `localStorage`, escribir a IndexedDB, y luego (por error) limpiar o dejar de leer `localStorage` antes de confirmar que la escritura fue exitosa. El pedido es explícito: la migración debe ser no destructiva (no borrar `localStorage` como parte del proceso, al menos no automáticamente).
5. **Archivos de backup de Loop Habit Tracker (`.db`) y cualquier export (`habits-export.json`, `habitos-loop.json`) no deben commitearse.** Hoy están bien ignorados; hay que mantener esa protección al agregar nuevas funcionalidades de export (por ejemplo, si el usuario exporta con otro nombre de archivo, `.gitignore` no lo cubre — conviene una regla más general, ej. `*-export.json` o una carpeta dedicada `/exports/` ignorada completa).
6. **El script conversor de Loop Habit Tracker leerá una base SQLite con datos personales.** Debe ejecutarse localmente, nunca commitear su output por defecto, y no se debe abrir/leer el contenido real de los `.db` del usuario durante esta sesión de asistencia (de hecho, el permiso de herramientas ya bloquea `Read`/`Edit` sobre `*.db`/`*.sqlite*`). El script se escribirá contra el esquema público conocido de Loop Habit Tracker (tablas `Habits` y `Repetitions`), no contra el contenido real del archivo del usuario.

## 5. Propuesta de estructura

Migración progresiva desde el monolito, manteniendo GitHub Pages (estático, sin build):

```
/
├── index.html                 # solo estructura + <link>/<script type="module">
├── manifest.json               # PWA manifest (rutas relativas)
├── service-worker.js           # cache offline (app shell)
├── css/
│   └── styles.css              # todo el CSS actual, extraído tal cual (luego se puede organizar)
├── js/
│   ├── app.js                  # entrypoint: init, eventos de UI, orquestación de vistas
│   ├── state.js                # estado en memoria + helpers de fecha (toLocalDateStr, getToday)
│   ├── storage.js               # capa de persistencia: localStorage actual + IndexedDB + migración automática
│   ├── stats.js                 # calculateStats, shouldTrackOnDate (corregido), lógica de rachas
│   ├── habits-view.js            # render de tab "Hoy"
│   ├── calendar-view.js          # render de tab "Calendario"
│   ├── stats-view.js             # render de tab "Estadísticas"
│   └── import-export.js          # exportar/importar JSON
├── icons/
│   └── apple-touch-icon*.png, icon-192.png, icon-512.png, etc.
├── tools/
│   └── loop_habits_to_json.py   # conversor standalone, sin dependencias de la app web
├── tests/
│   └── (node --test o similar, sin dependencias externas) dates, freq, streaks, migración
├── .gitignore                   # reforzado (exports, backups)
└── README.md
```

Notas de diseño:
- Todo con `<script type="module">` y `import`/`export` nativos del navegador — sin bundler, sigue funcionando en GitHub Pages tal cual.
- Rutas siempre relativas (`./css/styles.css`, `./manifest.json`) por el subpath del project page.
- El service worker debe registrarse con scope relativo (`navigator.serviceWorker.register('./service-worker.js')`) para no asumir raíz de dominio.
- `storage.js` es la única pieza que sabe si el backend real es `localStorage` o `IndexedDB`; el resto del código llama a una API estable (`getHabits()`, `saveHabits()`, etc.) para que la migración no obligue a tocar el resto de los módulos.

## 6. Plan de trabajo por etapas

Cada etapa: cambios acotados, commit local al terminar, sin tocar `main`, sin push.

1. **Auditoría** *(completa)* — este documento. Sin cambios de código funcional.
2. **Refuerzo de `.gitignore`** *(completa)* — patrones de export (nombre variable) además de los backups ya ignorados (ítems 11/12 del pedido), antes de tocar código que genere esos archivos.
3. **Separación de archivos (sin cambiar comportamiento)** *(completa)* — extraer `<style>` a `css/styles.css` y `<script>` a `js/app.js`. Commit de refactor puro, cero lógica nueva.
4. **Corrección de frecuencias y rachas** *(completa, ver sección 9)* — implementar cálculo por período según la semántica de 7.1 (días para diario, semanas/meses completos para custom), agregar `createdAt` (7.3) para que ninguna estadística cuente antes de la creación del hábito, aplicar la regla de "período abierto no rompe racha" (7.2), y agregar manejo de errores en `loadData`.
5. **Exportar / Importar JSON** — export: botón que descarga un `.json` (habits + completions + `createdAt` + versión de esquema) pensado para que el usuario lo guarde/comparta manualmente (p. ej. a Google Drive desde el iPhone vía el share sheet de iOS) — sin OAuth, sin API de Google, sin sincronización automática (7.4). Import: validación estricta de esquema (7.5) y flujo con vista previa, elección reemplazar/fusionar, detección de duplicados y backup automático antes de sobrescribir (7.6).
6. **IndexedDB + migración automática** — capa `storage.js` con IndexedDB como almacenamiento primario y migración de `localStorage` → IndexedDB al iniciar, sin borrar `localStorage` automáticamente (se conserva como respaldo pasivo).
7. **PWA** — `manifest.json`, `service-worker.js` (cache de app shell, funcionamiento offline), íconos iOS (`apple-touch-icon`, `apple-mobile-web-app-*`), verificación de instalación.
8. **Script Python conversor de Loop Habit Tracker** — `tools/loop_habits_to_json.py`, standalone (sin tocar la app web), lee un SQLite de Loop Habit Tracker (esquema `Habits`/`Repetitions`) y genera un JSON compatible con el importador de la etapa 5. Sin dependencias externas (solo `sqlite3` de stdlib).
9. **Tests** — fechas (`toLocalDateStr`, zona horaria), frecuencias (`shouldTrackOnDate`), rachas (`calculateStats` con casos diarios y custom), migración (`localStorage` → IndexedDB) y el conversor Python. Usando runners sin dependencias (`node --test` para JS si hay Node disponible, `unittest`/`pytest` para Python si están disponibles en el entorno).
10. **README** — instalación local, publicación en GitHub Pages, instalación en iOS (Safari → compartir → agregar a inicio), export/import de datos, cómo correr el conversor de Loop Habit Tracker.

Cada etapa termina con: archivos modificados, decisiones tomadas, pruebas ejecutadas, pendientes y el commit local correspondiente, tal como se pidió.

## 7. Decisiones de producto confirmadas (2026-08-06)

Estas decisiones fijan la semántica antes de tocar `calculateStats`/`shouldTrackOnDate` (etapa 4) y el flujo de import/export (etapa 5). No son inferencias del auditor: fueron definidas explícitamente por el usuario.

### 7.1 Semántica de frecuencia por tipo de período
- **Diario**: estadísticas y racha calculadas por día (comportamiento actual, sin cambios de unidad).
- **N veces por semana**: cumplimiento y racha calculados por **semana completa** — se evalúa si el hábito llegó a `freqCount` completions dentro de la semana, no día a día.
- **N veces por mes**: cumplimiento y racha calculados por **mes completo**, misma lógica a nivel mensual.
- **No se asignan días obligatorios automáticamente** dentro del período (p. ej. "3 veces por semana" no se traduce a "lunes, miércoles, viernes"). El usuario elige libremente qué días cumple, mientras llegue al total del período.

### 7.2 Períodos abiertos no cuentan como fallidos
- Un hábito diario pendiente **hoy** no rompe la racha anterior hasta que el día termine.
- Una semana o mes en curso no rompe la racha hasta que el período haya cerrado sin alcanzar el objetivo.
- La **tasa de éxito** se calcula solo con períodos ya cerrados (días pasados completos / semanas pasadas completas / meses pasados completos, según el tipo de hábito).
- El progreso del período actual (p. ej. "2 de 3 esta semana") se muestra **aparte**, no mezclado en la tasa de éxito ni usado para romper la racha.

### 7.3 `createdAt` por hábito
- Cada hábito incorpora `createdAt` (fecha de creación). Ninguna estadística (tasa de éxito, racha, totales) debe contar fechas anteriores a esa fecha.
- Para hábitos ya existentes en `localStorage` (sin `createdAt`) o importados desde el conversor de Loop Habit Tracker, la fecha se infiere durante la migración a partir de su **primera repetición disponible**; si no hay ninguna repetición, se define en el momento de la migración/import.

### 7.4 Backups: primera versión es export JSON manual (sin nube)
- El export es un archivo `.json` descargado localmente. El usuario lo guarda o comparte a mano (p. ej. a Google Drive desde el share sheet de iOS).
- **Explícitamente fuera de alcance**: autenticación de Google, OAuth, cualquier API externa o sincronización automática. Si en el futuro se quiere subir automáticamente, es una decisión aparte y posterior.

### 7.5 Validación estricta en la importación
- Antes de aceptar un JSON importado: validar esquema, tipos de cada campo, tamaños razonables (longitud de nombre, cantidad de hábitos/registros) y valores permitidos (`freq` en el set conocido, colores/íconos válidos, fechas con formato correcto).
- **Nunca insertar datos importados vía `innerHTML`.** Nombres de hábitos y cualquier texto proveniente del JSON importado se insertan con `textContent`, creación segura de nodos (`createElement` + asignar propiedades), o pasando por una función de escape — para evitar XSS a través de un JSON importado manipulado.

### 7.6 Flujo de importación con vista previa
- Antes de aplicar la importación, mostrar una vista previa: cantidad de hábitos y cantidad de registros (completions) detectados en el archivo.
- Ofrecer explícitamente **reemplazar** todo o **fusionar** con los datos actuales.
- Detectar duplicados (mismo hábito ya existente) antes de fusionar.
- Crear automáticamente un backup (export local) de los datos actuales **antes** de sobrescribir, para poder deshacer.

## 8. Restricciones confirmadas para todo el trabajo

- Sin backend, sin cuentas/login, sin servicios pagos ni externos.
- Sin `git push`, sin tocar `main`, sin comandos destructivos (`reset --hard`, `clean`, etc.).
- No commitear `.db`, exports JSON personales, ni ningún archivo con datos reales del usuario.
- No leer el contenido de los archivos `.db` del usuario (bloqueado además a nivel de permisos de herramientas).
- No sobreingeniería: se manda a IndexedDB con una capa fina, no un ORM; el service worker cachea el app shell, no implementa estrategias de sync complejas; el conversor Python es un script simple, no un paquete instalable.

## 9. Etapa 4 completada (2026-08-27) — frecuencias, rachas y `createdAt`

Implementado en `js/app.js`, sobre la semántica fijada en 7.1–7.3:

- **Cálculo por período**: nuevas funciones puras `getPeriodRange`, `getPeriodKey`, `getPeriodTarget`, `getFirstFullPeriodStart` agrupan las completions en días (diario), semanas (lunes–domingo) o meses calendario (custom), según `habit.freqPeriod`.
- **`calculateStats` reescrita**: reemplaza la ventana fija de 90 días (3.3) y el `shouldTrackOnDate` que siempre devolvía `true` (3.1, bug crítico original) por un recorrido desde `habit.createdAt` hasta hoy. `successRate` y rachas se calculan solo con períodos **cerrados**; el período en curso se expone aparte en `currentPeriod` (`{ count, target }`) y se muestra en la UI como "X de Y esta semana/mes" (`getPeriodProgressText`), sin romper la racha ni afectar la tasa de éxito (7.2).
- **`createdAt` por hábito** (7.3): se agrega al crear un hábito nuevo (`saveHabit`); para hábitos existentes sin el campo, `loadData` lo infiere de la completion `true` más antigua (`inferCreatedAt`) y persiste la migración una sola vez.
- **Primer período parcial**: si un hábito custom se crea a mitad de semana/mes, ese período parcial nunca entra en el cálculo de racha/tasa de éxito (nunca se evalúa como cumplido ni fallido), pero sus completions sí suman al total. **Actualizado el 2026-08-28** (ver más abajo): el progreso de ese período parcial ("X de Y esta semana/mes") sí se muestra mientras sigue en curso — versión inicial lo ocultaba, decisión de producto revisada explícitamente por el usuario.
- **Bug encontrado y corregido en la misma etapa** (no estaba en la auditoría original): el manejo de errores agregado a `loadData` envolvía el parseo de `habits` y `completions` en un único `try/catch`. Si una sola clave tenía JSON corrupto, el `catch` vaciaba **ambas**, arriesgando borrar datos sanos en el siguiente `saveData()` — violación directa de la regla de protección de datos del proyecto. Se corrigió parseando cada clave en su propio `try/catch`, aislado.

**Pruebas ejecutadas (2026-08-28):** el proyecto todavía no tiene un test runner formal instalado (etapa 9 del plan sigue pendiente como tal), pero para verificar esta etapa se armaron dos harnesses temporales y autocontenidos (descartados al terminar, nunca commiteados), ejecutados contra el `js/app.js`/`index.html`/`css/styles.css` reales del repo — no reimplementaciones paralelas de la lógica ni de la UI.

**A) Suite de lógica** (llama directamente a `calculateStats`, `getWeekStart`, `getFirstFullPeriodStart`, `loadData`, `inferCreatedAt`, etc., las funciones reales):
- **Método**: Microsoft Edge `--headless=new`, `--user-data-dir` temporal aislado (descartable, ajeno al perfil personal), `--disable-extensions`, `--disable-sync`, `--disable-background-networking`, `--disable-component-update`, sin acceso a Internet — solo `file://` local.
- **Resultado final: 62/62 PASS, 0 FAIL** (incluye 8 casos nuevos agregados el 2026-08-28 para el ajuste de período parcial en curso, ver abajo).
- **Cobertura**: parseo/validación de fechas; `getWeekStart`/`getWeekEnd`/`getMonthStart`/`getMonthEnd` (rollover diciembre→enero, bisiesto/no bisiesto); `getPeriodTarget` con valores límite; primer período parcial semanal/mensual (excluido de racha/tasa) tanto ya cerrado como **en curso** (con progreso visible); `calculateStats` diario (gap, creado/marcado hoy) y semanal (semanas mixtas, período abierto, racha, tasa de éxito, total); aislamiento de `loadData` ante JSON corrupto en una sola clave; `inferCreatedAt`.
- **Primera corrida (previa a este ajuste): 53 tests, 3 FAIL**, investigados antes de tocar nada: un test de consistencia semanal comparaba semana domingo-a-sábado contra el criterio lunes-a-domingo real de la app, y dos tests de `loadData` no contemplaban que `loadData` completa `freqCount`/`freqPeriod` por defecto (comportamiento preexistente). **Los 3 eran defectos del test**, corregidos sin tocar `js/app.js`.

**B) Validación funcional de UI** (clicks/eventos DOM reales sobre `index.html` cargado por `file://`, sin modificar el archivo):
- **Método**: mismo Edge headless aislado; el `localStorage` de `file://` resulta compartido entre directorios en este navegador (verificado empíricamente antes de depender de eso), por lo que el harness de UI vivió en un directorio temporal separado del repo sin necesidad de copiar ni tocar archivos del proyecto.
- **Resultado final: 16/16 PASS**, cubriendo: hábito diario marcado hoy (racha 1); hábito semanal 3x creado a mitad de semana (progreso "1 de 3 esta semana" visible en período parcial en curso); hábito mensual 8x creado a mitad de mes (progreso "1 de 8 este mes" visible); calendario — marcar un día pasado cambia Estadísticas; editar hábito conserva racha/total/completions.
- **Primera corrida de UI: 11/13 PASS, 2 FAIL**, investigados antes de tocar nada: un caso probaba "marcar un día pasado" con un hábito recién creado hoy mismo, cuyo `createdAt` excluye por diseño (regla 7.3) cualquier fecha anterior — el test necesitaba un hábito con historial previo, no lo tenía. El otro caso probaba el texto de progreso semanal en un escenario que, con la regla *anterior* al ajuste de hoy, correctamente no lo mostraba (período parcial). **Ambos eran defectos de configuración del test** (no del código de la app), corregidos ajustando el escenario de cada test.
- **Persistencia (recarga real)**: se cerró el proceso de Edge y se abrió uno **nuevo**, mismo perfil aislado, apuntando directo al `index.html` real (sin ningún script de test) — confirmó los 3 hábitos, sus nombres editados, estados marcados y textos de progreso reconstruidos correctamente desde `localStorage` en un proceso de navegador nuevo.

**Ajuste de UX del 2026-08-28** (a pedido explícito del usuario, sobre la regla 7.2): durante el primer período parcial de un hábito semanal/mensual, el progreso actual ("X de Y") ahora **sí se muestra** mientras ese período sigue en curso — antes se ocultaba por completo hasta el primer período completo. Sin cambios en lo demás: ese período parcial sigue sin poder contar como éxito ni fallo histórico (no entra en `successRate` ni en racha), y sus completions siguen sumando al total. Cambio acotado a `calculateStats` (nueva variable `partialPeriodProgress`, expuesta en `currentPeriod` solo cuando el primer período todavía no cerró), sin tocar ninguna otra regla.

**No cubierto por ninguno de los dos harnesses**: capturas de pantalla o verificación de layout/CSS real (tamaño de targets táctiles, overflow en nombres largos, etc.) — las pruebas validan comportamiento funcional (clicks disparan los handlers correctos, el DOM se actualiza con los valores correctos), no apariencia visual pixel a pixel.

**Riesgos/pendientes:** etapas 5–10 sin empezar (export/import, IndexedDB, PWA, conversor Loop Habit Tracker, test runner formal, README).
