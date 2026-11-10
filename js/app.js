const ICONS = ['🧘', '💪', '🏃', '📚', '✍️', '🥗', '💧', '😴', '🎨', '🎵', '🧹', '💼'];
const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'];

// Whitelist congelada del schema Backup v1 (5a). Copia literal e
// independiente de ICONS: cambios futuros a ICONS (paleta de la UI) NO
// deben alterar este contrato. Ampliar el conjunto exportable es una
// decisión de producto explícita y separada.
const BACKUP_V1_ICONS = ['🧘', '💪', '🏃', '📚', '✍️', '🥗', '💧', '😴', '🎨', '🎵', '🧹', '💼'];

let state = {
  habits: [],
  completions: {},
  quantities: {},
  // Backup v3: skips[fecha][habitId] === true. SKIP es un estado neutral
  // separado de completions: nunca equivale a completado ni a fallado.
  skips: {},
  selectedIcon: ICONS[0],
  selectedColor: COLORS[0],
  selectedFreq: 'daily',
  freqCount: 7,
  freqPeriod: 'week',
  currentMonth: new Date(),
  editingId: null,
  currentView: 'today',
  storageHealth: { habits: 'missing', completions: 'missing', quantities: 'missing', skips: 'missing' },
  // Hábito compartido entre Calendario y Estadísticas, para preservar la
  // selección al navegar entre ambas vistas. null hasta el primer render
  // con hábitos disponibles.
  selectedHabitId: null,
  // Si true, Estadísticas muestra todos los hábitos en vez de uno solo.
  // Nunca es el valor por defecto: arranca mostrando un único hábito.
  statsShowAll: false,
  // Posta 3 (hábitos cuantitativos): tipo y objetivo elegidos en el modal
  // de creación/edición. selectedKind solo importa al CREAR -- al editar,
  // saveHabit() siempre usa el kind del hábito existente (ver
  // resolveHabitKindForSave), nunca este valor.
  selectedKind: 'boolean',
  selectedTargetMinutes: null,
  // Fecha (YYYY-MM-DD) cuyo registro de minutos está abierto para edición
  // en la vista Calendario, o null si no hay ninguna abierta. Solo aplica
  // al hábito cuantitativo actualmente seleccionado en el calendario.
  calendarEditingDate: null
};

function toLocalDateStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getToday() {
  return toLocalDateStr(new Date());
}

function parseLocalDate(dateStr) {
  if (typeof dateStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function isValidDateStr(dateStr) {
  return parseLocalDate(dateStr) !== null;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=domingo .. 6=sábado
  const diffToMonday = day === 0 ? 6 : day - 1;
  return addDays(d, -diffToMonday);
}

function getWeekEnd(date) {
  return addDays(getWeekStart(date), 6);
}

function getMonthStart(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthEnd(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

// Determina la clave/rango/objetivo del período (día, semana o mes) al que
// pertenece `date`, según la frecuencia del hábito. Diario = 1 día = objetivo 1.
function getPeriodRange(habit, date) {
  if (habit.freq === 'custom' && habit.freqPeriod === 'week') {
    return { start: getWeekStart(date), end: getWeekEnd(date) };
  }
  if (habit.freq === 'custom' && habit.freqPeriod === 'month') {
    return { start: getMonthStart(date), end: getMonthEnd(date) };
  }
  return { start: date, end: date };
}

function getPeriodKey(habit, date) {
  const { start } = getPeriodRange(habit, date);
  if (habit.freq === 'custom' && habit.freqPeriod === 'month') {
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  }
  return toLocalDateStr(start);
}

function getPeriodTarget(habit) {
  if (habit.freq === 'custom') return Math.max(1, Number(habit.freqCount) || 1);
  return 1;
}

function init() {
  const recovery = recoverInterruptedImport();
  if (recovery.state === 'blocking-recovery') {
    enterBlockingRecovery(recovery.reason);
    return;
  }
  loadData();
  if (recovery.state === 'snapshot-pending-cleanup') {
    finishStartupCleanupB();
  }
  setupEvents();
  render();
}

// Para hábitos migrados sin createdAt: usa la fecha de su primera
// completion marcada como true; si no tiene ninguna, usa hoy.
function inferCreatedAt(habitId, todayStr) {
  let earliest = null;
  for (const dateKey in state.completions) {
    if (!isValidDateStr(dateKey)) continue;
    const entry = state.completions[dateKey];
    if (entry && entry[habitId] === true) {
      if (earliest === null || dateKey < earliest) earliest = dateKey;
    }
  }
  return earliest || todayStr;
}

// Verdad unica que consultan tanto los guards de mutacion como saveData():
// true si cualquiera de las dos claves persistidas quedo marcada 'corrupt'
// en la ultima carga real.
function hasStorageCorruption() {
  return state.storageHealth.habits === 'corrupt' ||
    state.storageHealth.completions === 'corrupt' ||
    state.storageHealth.quantities === 'corrupt' ||
    state.storageHealth.skips === 'corrupt';
}

function loadData() {
  // Se reconstruye TODO desde cero en cada llamada real -- datos y salud --
  // para que una clave hoy ausente nunca arrastre memoria de una carga
  // anterior, y reload/loadData repetido sea deterministico.
  state.habits = [];
  state.completions = {};
  state.quantities = {};
  state.skips = {};
  state.storageHealth = { habits: 'missing', completions: 'missing', quantities: 'missing', skips: 'missing' };

  const h = localStorage.getItem('habits');
  if (h !== null) {
    try {
      const parsed = JSON.parse(h);
      // JSON.parse exitoso no basta: la raiz debe ser Array, y cada
      // elemento debe ser un objeto (no null, no array) -- sin validar
      // campos internos. Evita sintetizar un "habito fantasma" a partir
      // de un elemento invalido mezclado en un array por lo demas valido.
      const rootIsArray = Array.isArray(parsed);
      const elementsAreObjects = rootIsArray && parsed.every(el =>
        typeof el === 'object' && el !== null && !Array.isArray(el)
      );
      if (elementsAreObjects) {
        state.habits = parsed;
        state.storageHealth.habits = 'valid';
      } else {
        state.storageHealth.habits = 'corrupt';
      }
    } catch (e) {
      state.storageHealth.habits = 'corrupt';
    }
  }

  const c = localStorage.getItem('completions');
  if (c !== null) {
    try {
      const parsed = JSON.parse(c);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state.completions = parsed;
        state.storageHealth.completions = 'valid';
      } else {
        state.storageHealth.completions = 'corrupt';
      }
    } catch (e) {
      state.storageHealth.completions = 'corrupt';
    }
  }

  const q = localStorage.getItem('quantities');
  if (q !== null) {
    try {
      const parsed = JSON.parse(q);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state.quantities = parsed;
        state.storageHealth.quantities = 'valid';
      } else {
        state.storageHealth.quantities = 'corrupt';
      }
    } catch (e) {
      state.storageHealth.quantities = 'corrupt';
    }
  }

  const sk = localStorage.getItem('skips');
  if (sk !== null) {
    try {
      const parsed = JSON.parse(sk);
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state.skips = parsed;
        state.storageHealth.skips = 'valid';
      } else {
        state.storageHealth.skips = 'corrupt';
      }
    } catch (e) {
      state.storageHealth.skips = 'corrupt';
    }
  }

  // Backup v2: todo hábito sin `kind` explícito (legado v1) se normaliza
  // como booleano -- decisión humana, ver docs/ROADMAP.md, sección
  // "Backup v2". Solo rellena el default si `kind` está ausente; nunca
  // sobreescribe un `kind` ya presente.
  state.habits = state.habits.map(hb => ({
    freq: 'daily',
    freqCount: 7,
    freqPeriod: 'week',
    kind: 'boolean',
    // Backup v3: un hábito sin `archived` (legado v1/v2) no está archivado.
    archived: false,
    ...hb
  }));

  // Si hay cualquier corrupcion, la migracion automatica de createdAt no
  // corre en absoluto: no se infiere sobre un dataset que sabemos incompleto,
  // y no se persiste nada mientras dure el modo de proteccion.
  if (!hasStorageCorruption()) {
    const todayStr = getToday();
    let migrated = false;
    state.habits = state.habits.map(hb => {
      if (isValidDateStr(hb.createdAt)) return hb;
      migrated = true;
      return { ...hb, createdAt: inferCreatedAt(hb.id, todayStr) };
    });
    if (migrated) saveData();
  }
}

// Capa 2 (barrera final): si hay corrupcion detectada, no escribe nada y lo
// senala explicitamente en el resultado -- no depende de que cada caller
// haya aplicado bien el guard de Capa 1.
function saveData() {
  if (hasStorageCorruption()) {
    return { ok: false, reason: 'storage-corrupted' };
  }
  localStorage.setItem('habits', JSON.stringify(state.habits));
  localStorage.setItem('completions', JSON.stringify(state.completions));
  localStorage.setItem('quantities', JSON.stringify(state.quantities));
  localStorage.setItem('skips', JSON.stringify(state.skips));
  return { ok: true };
}

// ---------------------------------------------------------------------
// Validación y Backup v1 (5a)
//
// Todo dato persistido se trata como no confiable: loadData() solo valida
// la forma raíz (habits = Array de objetos, completions = objeto plano),
// nunca los campos internos. Estos validadores son la única barrera real
// antes de aplicar un valor a `style`/render o de incluirlo en un export.
// ---------------------------------------------------------------------

// Cuenta code points Unicode reales, no unidades UTF-16 (String.length
// cuenta mal los emoji fuera del plano básico, "astral").
function countCodePoints(str) {
  return Array.from(str).length;
}

// Límite de creación/edición desde la UI: 1..200 code points.
function isValidUiName(name) {
  if (typeof name !== 'string') return false;
  const n = countCodePoints(name);
  return n >= 1 && n <= 200;
}

// Límite del contrato Backup v1 / schema: 1..5000 code points. Deliberadamente
// distinto y más amplio que isValidUiName(), para no romper el export de un
// hábito histórico/legacy creado antes de que existiera el límite de la UI.
function isValidSchemaName(name) {
  if (typeof name !== 'string') return false;
  const n = countCodePoints(name);
  return n >= 1 && n <= 5000;
}

const VALID_FREQ = ['daily', 'custom'];
// 'loop-month' (Backup v3): frecuencia heredada de Loop "N de D" con D=30.
// En Loop, D=30/31 no es una ventana fija de 30 días ni un mes calendario:
// es una ventana del largo del mes (28 a 31 días) armada a partir de los
// registros manuales (EntryList.kt, buildIntervals). Acá solo se PRESERVA la
// fracción original (freqCount de freqWindowDays); no se simula ninguna
// ventana ni se convierte a mes calendario, y no hay rachas/tasas para ella.
// Solo existe en v3; v1/v2 siguen aceptando únicamente week/month.
const LOOP_MONTH_PERIOD = 'loop-month';
const LOOP_MONTH_DENOMINATOR = 30;
const VALID_FREQ_PERIOD_V2 = ['week', 'month'];
const VALID_FREQ_PERIOD = [...VALID_FREQ_PERIOD_V2, LOOP_MONTH_PERIOD];

function isLoopMonthHabit(habit) {
  return !!habit && habit.freq === 'custom' && habit.freqPeriod === LOOP_MONTH_PERIOD;
}

function isValidFreq(freq) {
  return VALID_FREQ.includes(freq);
}

function isValidFreqPeriod(freqPeriod) {
  return VALID_FREQ_PERIOD.includes(freqPeriod);
}

function isValidFreqCount(n) {
  return Number.isInteger(n) && n >= 1 && n <= 30;
}

// El denominador original solo puede ser 30 (el único que el conversor
// produce y que se verificó contra el código de Loop).
function isValidFreqWindowDays(n) {
  return n === LOOP_MONTH_DENOMINATOR;
}

// Coherencia de la frecuencia heredada 'loop-month' (Backup v3). Devuelve un
// mensaje de error o null. freqWindowDays (denominador original) existe si y
// solo si el período es 'loop-month'; un hábito 'loop-month' es siempre freq
// 'custom' y su objetivo no puede superar el denominador.
function getLoopMonthFrequencyError(habit) {
  const isLoopMonth = habit.freqPeriod === LOOP_MONTH_PERIOD;
  const hasWindow = Object.prototype.hasOwnProperty.call(habit, 'freqWindowDays');
  if (!isLoopMonth) {
    return hasWindow ? 'freqWindowDays solo se permite con período loop-month.' : null;
  }
  if (habit.freq !== 'custom') return 'un período loop-month requiere frecuencia custom.';
  if (!hasWindow || !isValidFreqWindowDays(habit.freqWindowDays)) return 'denominador original de Loop (freqWindowDays) inválido.';
  if (habit.freqCount > habit.freqWindowDays) return 'la cantidad de frecuencia supera el denominador original de Loop.';
  return null;
}

// Pura. Un hábito 'loop-month' existente conserva su frecuencia completa al
// editarse: el modal solo ofrece semana/mes y no puede representarla.
function resolveFrequencyForSave(existingHabit, uiFreq) {
  if (existingHabit && existingHabit.freqPeriod === LOOP_MONTH_PERIOD) {
    return {
      freq: existingHabit.freq,
      freqCount: existingHabit.freqCount,
      freqPeriod: existingHabit.freqPeriod,
      freqWindowDays: existingHabit.freqWindowDays
    };
  }
  return { freq: uiFreq.freq, freqCount: uiFreq.freqCount, freqPeriod: uiFreq.freqPeriod };
}

// Un hábito archivado conserva su estado al editarse (la edición no lo cambia).
function resolveArchivedForSave(existingHabit) {
  return existingHabit ? existingHabit.archived === true : false;
}

function isArchivedHabit(habit) {
  return !!habit && habit.archived === true;
}

// Hábitos de la experiencia diaria (vista Hoy): sin archivados. Los
// archivados NO se borran: siguen en state.habits con todo su historial.
function getActiveHabits() {
  return state.habits.filter(h => !isArchivedHabit(h));
}

// Hábitos para las vistas históricas (Calendario/Estadísticas): primero los
// activos y después los archivados, en su orden original.
function getHabitsForHistory() {
  return [...getActiveHabits(), ...state.habits.filter(isArchivedHabit)];
}

function getHabitDisplayName(habit) {
  return isArchivedHabit(habit) ? `${habit.name} (archivado)` : habit.name;
}

// Texto del resumen de la vista previa de importación (puro, sin DOM).
// Incluye archivados y SKIP para que el usuario vea lo que se va a reemplazar.
function buildImportSummaryText(summary) {
  const parts = [
    `${summary.habitsCount} hábitos`,
    `${summary.completionDatesCount} fechas con completados`,
    `${summary.trueEntriesCount} registros completados en total`
  ];
  if (typeof summary.archivedCount === 'number') {
    parts.push(`${summary.archivedCount} archivados`);
  }
  if (typeof summary.skipEntriesCount === 'number') {
    parts.push(`${summary.skipEntriesCount} días omitidos (SKIP) en ${summary.skipDatesCount} fechas`);
  }
  if (typeof summary.loopMonthCount === 'number' && summary.loopMonthCount > 0) {
    parts.push(`${summary.loopMonthCount} con frecuencia original de Loop (sin racha ni tasa)`);
  }
  return `${parts.join(', ')}. Exportado: ${summary.exportedAt}.`;
}

function formatStatValue(value, suffix) {
  return value === null || value === undefined ? '—' : `${value}${suffix || ''}`;
}

// Backup v2: tipo de hábito. Reemplaza la ausencia de tipo de v1, donde
// todo hábito es implícitamente booleano.
const VALID_KIND = ['boolean', 'quantitative'];
// Única unidad soportada por ahora (decisión humana, ver
// docs/ROADMAP.md, sección "Backup v2"). Cualquier otro valor es fatal,
// nunca se adivina ni se convierte.
const VALID_UNIT = ['minutes'];

function isValidKind(kind) {
  return VALID_KIND.includes(kind);
}

function isValidUnit(unit) {
  return VALID_UNIT.includes(unit);
}

// Entero genuino (nunca bool, nunca texto, nunca float) -- mismo patrón
// que is_valid_loop_id/is_valid_repetition_value del conversor Python.
function isSafeNonNegativeInt(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

function isSafePositiveInt(n) {
  return Number.isSafeInteger(n) && n >= 1;
}

// target: objetivo CONFIGURADO actual por día de registro (decisión
// humana: independiente de freqPeriod), nunca un valor realizado
// histórico. null = sin objetivo configurado.
function isValidTarget(target) {
  if (target === null) return true;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
  const keys = Object.keys(target);
  return keys.length === 1 && keys[0] === 'minutes' && isSafePositiveInt(target.minutes);
}

// Pura: determina el kind final a persistir. SIEMPRE el del hábito
// existente si se está editando -- nunca el valor elegido en la UI.
// Es la única garantía de "no permitir cambios de tipo que provoquen
// pérdida de datos" (Posta 3): el tipo de un hábito jamás puede cambiar
// una vez creado, sin importar qué haya quedado seleccionado en el modal.
function resolveHabitKindForSave(existingHabit, uiSelectedKind) {
  return existingHabit ? existingHabit.kind : uiSelectedKind;
}

// Pura: construye el target final a partir de los minutos configurados en
// la UI. null = sin objetivo configurado; nunca se inventa un valor.
function resolveQuantitativeTarget(selectedTargetMinutes) {
  return selectedTargetMinutes === null ? null : { minutes: selectedTargetMinutes };
}

// Lectura de un registro de minutos: ausencia de entrada = 0 minutos
// registrados ese día (distinto del contrato de export/import, donde
// ausencia != 0 explícito -- ver buildBackupV3). Para la UI en vivo, "no
// hay registro todavía" y "0 minutos" se muestran igual: 0.
function getActualMinutes(habitId, dateStr) {
  const entry = state.quantities[dateStr];
  return (entry && entry[habitId]) ? entry[habitId].actualMinutes : 0;
}

function getPlannedMinutes(habitId, dateStr) {
  const entry = state.quantities[dateStr];
  return (entry && entry[habitId]) ? entry[habitId].plannedMinutes : null;
}

// Cantidades de tiempo: la unidad única de v3 es 'minutes' y el dato
// persistido siempre son minutos totales. Horas/minutos son solo la forma
// de ingresar y mostrar: 135 minutos <-> 2 h 15 min.
const TIME_MAX_HOURS = 24;
const TIME_MAX_MINUTES_PART = 59;

// 0 -> "0 min", 45 -> "45 min", 60 -> "1 h", 135 -> "2 h 15 min".
function formatMinutesText(total) {
  if (!isSafeNonNegativeInt(total)) return '0 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

// Versión corta para espacios chicos (celdas del calendario, gráfico).
function formatMinutesCompact(total) {
  if (!isSafeNonNegativeInt(total)) return '0m';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

function splitMinutes(total) {
  const safe = isSafeNonNegativeInt(total) ? total : 0;
  return { hours: Math.floor(safe / 60), minutes: safe % 60 };
}

// Valida los dos campos (HH : MM) y devuelve los minutos totales. Estricto:
// hasta dos dígitos por campo (sin signo, decimales ni notación
// científica), horas 0-24, minutos 0-59 y total máximo 1440 (con 24 horas
// los minutos deben ser 00). Un campo vacío es inválido (no se asume 0,
// para no borrar un registro por accidente) y nada se trunca en silencio.
function parseHoursMinutes(hoursRaw, minutesRaw) {
  const hStr = String(hoursRaw === null || hoursRaw === undefined ? '' : hoursRaw).trim();
  const mStr = String(minutesRaw === null || minutesRaw === undefined ? '' : minutesRaw).trim();
  if (hStr === '' || mStr === '') {
    return { ok: false, error: 'Completá horas y minutos.' };
  }
  if (!/^\d{1,2}$/.test(hStr) || !/^\d{1,2}$/.test(mStr)) {
    return { ok: false, error: 'Usá hasta dos dígitos por campo, solo números.' };
  }
  const hours = Number(hStr);
  const minutes = Number(mStr);
  if (hours > TIME_MAX_HOURS) {
    return { ok: false, error: `Las horas van de 0 a ${TIME_MAX_HOURS}.` };
  }
  if (minutes > TIME_MAX_MINUTES_PART) {
    return { ok: false, error: `Los minutos van de 0 a ${TIME_MAX_MINUTES_PART}.` };
  }
  if (hours === TIME_MAX_HOURS && minutes !== 0) {
    return { ok: false, error: `Con ${TIME_MAX_HOURS} horas, los minutos deben ser 00.` };
  }
  return { ok: true, total: hours * 60 + minutes };
}

// Única vía de escritura de minutos (incrementos rápidos e ingreso manual
// convergen acá). Nunca crea un registro duplicado: siempre reemplaza el
// mismo slot quantities[dateStr][habitId]. Nunca toca plannedMinutes --
// lo relee antes de escribir y lo conserva tal cual.
function writeActualMinutes(habitId, dateStr, newActualMinutes) {
  if (hasStorageCorruption()) return false;
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit || habit.kind !== 'quantitative') return false;
  if (!isSafeNonNegativeInt(newActualMinutes)) return false;

  const plannedMinutes = getPlannedMinutes(habitId, dateStr);
  // Escribir minutos reemplaza un SKIP de ese día (nunca coexisten).
  return commitQuantitativeDay(dateStr, () => {
    if (!state.quantities[dateStr]) state.quantities[dateStr] = {};
    state.quantities[dateStr][habitId] = { actualMinutes: newActualMinutes, plannedMinutes };
    clearSkip(dateStr, habitId);
  });
}

// Aplica un cambio sobre un día de un hábito de tiempo (quantities y skips de
// esa fecha) y lo persiste. Si la persistencia falla (por ejemplo cuota
// llena), devuelve la memoria al estado exacto anterior y vuelve a intentar
// dejar el almacenamiento igual a la memoria; devuelve false.
function commitQuantitativeDay(dateStr, mutate) {
  const copy = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const prevQuantities = copy(state.quantities[dateStr]);
  const prevSkips = copy(state.skips[dateStr]);
  mutate();
  let saved;
  try {
    saved = saveData();
  } catch (e) {
    saved = { ok: false };
  }
  if (saved.ok) return true;
  if (prevQuantities === undefined) delete state.quantities[dateStr];
  else state.quantities[dateStr] = prevQuantities;
  if (prevSkips === undefined) delete state.skips[dateStr];
  else state.skips[dateStr] = prevSkips;
  try { saveData(); } catch (e) { /* queda para el próximo guardado */ }
  return false;
}

// Estado de un día de un hábito de tiempo: 'minutes' (hay un registro, aunque
// sea un cero explícito), 'skipped' (SKIP, sin registro) o 'none' (ausencia).
// Un dato inconsistente con ambos se lee como minutos.
function getQuantitativeDayState(habitId, dateStr) {
  if (hasOwnKey(state.quantities[dateStr], habitId)) return 'minutes';
  if (state.skips[dateStr]?.[habitId] === true) return 'skipped';
  return 'none';
}

function deleteQuantityEntry(dateStr, habitId) {
  const entry = state.quantities[dateStr];
  if (!entry || typeof entry !== 'object') return;
  delete entry[habitId];
  if (Object.keys(entry).length === 0) delete state.quantities[dateStr];
}

// Marca (o quita) SKIP en un día de un hábito de tiempo. Marcar SKIP elimina
// el registro de minutos de ese día (incluido un cero explícito); quitarlo
// deja el día sin registro. Valida antes de tocar nada; no admite fechas
// futuras. Las fechas anteriores a createdAt sí se pueden editar.
function setQuantitativeSkip(habitId, dateStr, skipped) {
  if (hasStorageCorruption()) return { ok: false, reason: 'storage-corrupted' };
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return { ok: false, reason: 'unknown-habit' };
  if (habit.kind !== 'quantitative') return { ok: false, reason: 'not-quantitative' };
  const date = typeof dateStr === 'string' ? parseLocalDate(dateStr) : null;
  if (!date) return { ok: false, reason: 'invalid-date' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) return { ok: false, reason: 'future-date' };

  const ok = commitQuantitativeDay(dateStr, () => {
    if (skipped) {
      deleteQuantityEntry(dateStr, habitId);
      if (!state.skips[dateStr]) state.skips[dateStr] = {};
      state.skips[dateStr][habitId] = true;
    } else {
      clearSkip(dateStr, habitId);
    }
  });
  return ok ? { ok: true } : { ok: false, reason: 'storage-error' };
}

// Incremento rápido (+5/-5 min). El piso es 0: nunca permite cantidades
// negativas, sin importar cuántas veces se presione "-5 min".
function incrementQuantity(habitId, dateStr, deltaMinutes) {
  const current = getActualMinutes(habitId, dateStr);
  // Mismo tope de 24 h que el ingreso manual. Un registro histórico que ya
  // lo supera (el conversor no impone tope) nunca se recorta ni crece con
  // +5: solo puede bajar con -5.
  const ceiling = Math.max(current, TIME_MAX_HOURS * 60);
  writeActualMinutes(habitId, dateStr, Math.min(ceiling, Math.max(0, current + deltaMinutes)));
  render();
}

// Ingreso manual: reemplaza el total del día, nunca lo suma. Un valor
// inválido (no entero seguro, negativo, NaN) no escribe nada -- el
// siguiente render() restaura el valor real ya guardado.
function setQuantityExact(habitId, dateStr, newActualMinutes) {
  writeActualMinutes(habitId, dateStr, newActualMinutes);
  render();
}

function isValidIcon(icon) {
  return BACKUP_V1_ICONS.includes(icon);
}

function isValidColorHex(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
}

// Luminancia relativa WCAG de un canal sRGB (0-255).
function srgbChannelLuminance(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function relativeLuminance(r, g, b) {
  return 0.2126 * srgbChannelLuminance(r) + 0.7152 * srgbChannelLuminance(g) + 0.0722 * srgbChannelLuminance(b);
}

function contrastRatio(l1, l2) {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// Elige, entre blanco puro y negro puro, el que da mayor contraste WCAG
// real contra el color de fondo del hábito -- nunca un umbral fijo de
// "claro/oscuro" que puede fallar para verdes/cian intermedios (ver
// revisión de UX V2 posta 1). Usar los extremos puros (no un gris como
// #1a1a1a) es lo que garantiza matemáticamente que, para cualquier color
// de fondo opaco, al menos una de las dos opciones alcance 4.5:1 -- con
// un gris intermedio existe un rango de luminancia donde ninguna de las
// dos alcanza el mínimo AA. Asume que `hex` ya pasó isValidColorHex().
function getContrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const bgLuminance = relativeLuminance(r, g, b);

  const whiteContrast = contrastRatio(bgLuminance, relativeLuminance(255, 255, 255));
  const blackContrast = contrastRatio(bgLuminance, relativeLuminance(0, 0, 0));
  return whiteContrast >= blackContrast ? '#ffffff' : '#000000';
}

const RESERVED_IDS = ['__proto__', 'constructor', 'prototype'];

function isValidIdFormat(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function isReservedId(id) {
  return RESERVED_IDS.includes(id);
}

// Genera un id de hábito con la misma base que hoy (Date.now()), pero con
// resolución determinística y acotada de colisión: nunca vuelve a llamar
// Date.now() para resolverla, y nunca reescribe un id existente.
function generateHabitId() {
  const base = Date.now().toString();
  if (!state.habits.some(h => h.id === base)) return base;
  const MAX_ATTEMPTS = 1000;
  for (let suffix = 1; suffix <= MAX_ATTEMPTS; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!state.habits.some(h => h.id === candidate)) return candidate;
  }
  throw new Error('No se pudo generar un id único para el hábito.');
}

// Preflight de export: valida TODO el estado vivo contra el contrato
// Backup v2 antes de exportar. Nunca repara, trunca ni normaliza el dato
// inválido -- solo lo reporta y aborta. Las únicas normalizaciones
// permitidas (completions false y fechas vacías) ocurren después, en
// buildBackupV3(), nunca acá.
function validateExportState() {
  if (hasStorageCorruption()) {
    return { ok: false, error: 'No se puede exportar mientras los datos guardados estén dañados.' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const seenIds = new Set();
  const habitKindById = new Map();

  for (let i = 0; i < state.habits.length; i++) {
    const habit = state.habits[i];
    const label = `hábito #${i + 1}${habit && typeof habit.name === 'string' ? ` ("${habit.name}")` : ''}`;

    if (!habit || typeof habit !== 'object' || Array.isArray(habit)) {
      return { ok: false, error: `${label}: registro inválido.` };
    }
    if (!isValidIdFormat(habit.id)) {
      return { ok: false, error: `${label}: id inválido.` };
    }
    if (isReservedId(habit.id)) {
      return { ok: false, error: `${label}: id reservado no permitido.` };
    }
    if (seenIds.has(habit.id)) {
      return { ok: false, error: `${label}: id duplicado.` };
    }
    seenIds.add(habit.id);

    if (!isValidSchemaName(habit.name)) {
      return { ok: false, error: `${label}: nombre inválido (1 a 5000 caracteres).` };
    }
    if (!isValidIcon(habit.icon)) {
      return { ok: false, error: `${label}: ícono inválido.` };
    }
    if (!isValidColorHex(habit.color)) {
      return { ok: false, error: `${label}: color inválido.` };
    }
    if (!isValidFreq(habit.freq)) {
      return { ok: false, error: `${label}: frecuencia inválida.` };
    }
    if (!isValidFreqPeriod(habit.freqPeriod)) {
      return { ok: false, error: `${label}: período de frecuencia inválido.` };
    }
    if (!isValidFreqCount(habit.freqCount)) {
      return { ok: false, error: `${label}: cantidad de frecuencia inválida (1 a 30).` };
    }
    const loopMonthError = getLoopMonthFrequencyError(habit);
    if (loopMonthError) {
      return { ok: false, error: `${label}: ${loopMonthError}` };
    }
    if (typeof habit.archived !== 'boolean') {
      return { ok: false, error: `${label}: estado archivado inválido.` };
    }
    if (!isValidKind(habit.kind)) {
      return { ok: false, error: `${label}: tipo (kind) inválido.` };
    }
    if (habit.kind === 'quantitative') {
      if (!isValidUnit(habit.unit)) {
        return { ok: false, error: `${label}: unidad inválida.` };
      }
      if (!isValidTarget(habit.target)) {
        return { ok: false, error: `${label}: objetivo (target) inválido.` };
      }
    }

    const createdAtDate = parseLocalDate(habit.createdAt);
    if (!createdAtDate) {
      return { ok: false, error: `${label}: fecha de creación inválida.` };
    }
    if (createdAtDate > today) {
      return { ok: false, error: `${label}: fecha de creación futura.` };
    }

    habitKindById.set(habit.id, habit.kind);
  }

  if (!state.completions || typeof state.completions !== 'object' || Array.isArray(state.completions)) {
    return { ok: false, error: 'Registro de días completados inválido.' };
  }

  for (const dateKey in state.completions) {
    if (!isValidDateStr(dateKey)) {
      return { ok: false, error: `Fecha de completado inválida: "${dateKey}".` };
    }
    const entry = state.completions[dateKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `Registro de completados inválido para "${dateKey}".` };
    }
    for (const habitId in entry) {
      if (entry[habitId] !== true && entry[habitId] !== false) {
        return { ok: false, error: `Valor de completado inválido para "${dateKey}".` };
      }
      // Solo las entradas true sobreviven al export (ver buildBackupV3);
      // una entrada true que referencia un hábito inexistente sería
      // exportada como dato incoherente, así que se trata como fatal.
      // Una entrada false huérfana nunca llega al export, así que no
      // bloquea el preflight.
      if (entry[habitId] === true && !seenIds.has(habitId)) {
        return { ok: false, error: `Completado huérfano: "${dateKey}" referencia un hábito inexistente.` };
      }
      if (entry[habitId] === true && habitKindById.get(habitId) !== 'boolean') {
        return { ok: false, error: `Completado "${dateKey}" referencia un hábito que no es booleano.` };
      }
    }
  }

  if (!state.quantities || typeof state.quantities !== 'object' || Array.isArray(state.quantities)) {
    return { ok: false, error: 'Registro de cantidades inválido.' };
  }

  for (const dateKey in state.quantities) {
    if (!isValidDateStr(dateKey)) {
      return { ok: false, error: `Fecha de cantidad inválida: "${dateKey}".` };
    }
    const entry = state.quantities[dateKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `Registro de cantidades inválido para "${dateKey}".` };
    }
    for (const habitId in entry) {
      const value = entry[habitId];
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: `Valor de cantidad inválido para "${dateKey}".` };
      }
      const valueKeys = Object.keys(value);
      if (valueKeys.length !== 2 || !('actualMinutes' in value) || !('plannedMinutes' in value)) {
        return { ok: false, error: `Campos de cantidad inválidos para "${dateKey}".` };
      }
      if (!isSafeNonNegativeInt(value.actualMinutes)) {
        return { ok: false, error: `actualMinutes inválido para "${dateKey}".` };
      }
      if (value.plannedMinutes !== null && !isSafeNonNegativeInt(value.plannedMinutes)) {
        return { ok: false, error: `plannedMinutes inválido para "${dateKey}".` };
      }
      if (!seenIds.has(habitId)) {
        return { ok: false, error: `Cantidad huérfana: "${dateKey}" referencia un hábito inexistente.` };
      }
      if (habitKindById.get(habitId) !== 'quantitative') {
        return { ok: false, error: `Cantidad "${dateKey}" referencia un hábito que no es cuantitativo.` };
      }
    }
  }

  if (!state.skips || typeof state.skips !== 'object' || Array.isArray(state.skips)) {
    return { ok: false, error: 'Registro de omitidos (skips) inválido.' };
  }

  for (const dateKey in state.skips) {
    const dateObj = parseLocalDate(dateKey);
    if (!dateObj) {
      return { ok: false, error: `Fecha de omitido inválida: "${dateKey}".` };
    }
    if (dateObj > today) {
      return { ok: false, error: `Fecha de omitido futura: "${dateKey}".` };
    }
    const entry = state.skips[dateKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return { ok: false, error: `Registro de omitidos inválido para "${dateKey}".` };
    }
    for (const habitId in entry) {
      if (entry[habitId] !== true) {
        return { ok: false, error: `Valor de omitido inválido para "${dateKey}".` };
      }
      if (!seenIds.has(habitId)) {
        return { ok: false, error: `Omitido huérfano: "${dateKey}" referencia un hábito inexistente.` };
      }
      if (state.completions[dateKey] && state.completions[dateKey][habitId] === true) {
        return { ok: false, error: `Omitido y completado a la vez en "${dateKey}".` };
      }
      if (habitKindById.get(habitId) === 'quantitative' && hasOwnKey(state.quantities[dateKey], habitId)) {
        return { ok: false, error: `Omitido y cantidad registrada a la vez en "${dateKey}".` };
      }
    }
  }

  return { ok: true };
}

// Pura: asume que validateExportState() ya dio ok. Construye el objeto
// final campo por campo (nunca copia el hábito vivo completo por spread),
// para que ninguna propiedad extra accidental llegue al backup.
function buildBackupV3() {
  const habits = state.habits.map(h => {
    const out = {
      id: h.id,
      name: h.name,
      icon: h.icon,
      color: h.color,
      freq: h.freq,
      freqCount: h.freqCount,
      freqPeriod: h.freqPeriod,
      createdAt: h.createdAt,
      kind: h.kind,
      archived: h.archived
    };
    if (h.freqPeriod === LOOP_MONTH_PERIOD) {
      out.freqWindowDays = h.freqWindowDays;
    }
    if (h.kind === 'quantitative') {
      out.unit = h.unit;
      out.target = h.target;
    }
    return out;
  });

  const completions = {};
  for (const dateKey in state.completions) {
    const entry = state.completions[dateKey];
    const trueIds = Object.keys(entry).filter(id => entry[id] === true);
    if (trueIds.length > 0) {
      const cleanEntry = {};
      trueIds.forEach(id => { cleanEntry[id] = true; });
      completions[dateKey] = cleanEntry;
    }
  }

  // A diferencia de completions, la AUSENCIA de una entrada en
  // `quantities` es distinta de un registro explícito de 0 minutos
  // (decisión humana, ver docs/ROADMAP.md): cada entrada presente en
  // state.quantities se exporta tal cual, sin filtrar por valor.
  const quantities = {};
  for (const dateKey in state.quantities) {
    const entry = state.quantities[dateKey];
    const habitIds = Object.keys(entry);
    if (habitIds.length > 0) {
      const cleanEntry = {};
      habitIds.forEach(id => {
        cleanEntry[id] = { actualMinutes: entry[id].actualMinutes, plannedMinutes: entry[id].plannedMinutes };
      });
      quantities[dateKey] = cleanEntry;
    }
  }

  const skips = {};
  for (const dateKey in state.skips) {
    const entry = state.skips[dateKey];
    const ids = Object.keys(entry).filter(id => entry[id] === true);
    if (ids.length > 0) {
      const cleanEntry = {};
      ids.forEach(id => { cleanEntry[id] = true; });
      skips[dateKey] = cleanEntry;
    }
  }

  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    habits,
    completions,
    quantities,
    skips
  };
}

// Orquesta el export real: preflight -> build -> nombre -> compartir/descargar.
// Nunca modifica state ni localStorage.
async function exportBackup() {
  const validation = validateExportState();
  if (!validation.ok) {
    alert(`No se pudo exportar: ${validation.error}`);
    return;
  }

  const backup = buildBackupV3();
  const json = JSON.stringify(backup, null, 2);
  const now = new Date();
  const filename = `habitos-backup-${toLocalDateStr(now)}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}.json`;
  const blob = new Blob([json], { type: 'application/json' });

  if (navigator.canShare && typeof File === 'function') {
    try {
      const file = new File([blob], filename, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });
        return;
      }
    } catch (e) {
      if (e && e.name === 'AbortError') {
        // Cancelar el Share Sheet es una acción voluntaria del usuario:
        // no es un error, no se fuerza una descarga alternativa.
        return;
      }
      // Cualquier otro fallo real de compartir cae al fallback de descarga.
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// =======================================================================
// Import v1 + Preview + Safe Replace (5b)
//
// Todo archivo importado se trata como completamente no confiable.
// validateBackup() es pura (sin DOM, sin storage, sin red). El reemplazo
// es la única operación permitida -- nunca fusión/merge.
// =======================================================================

const SNAPSHOT_KEY = 'habitTracker.import.snapshot.v1';
const MARKER_KEY = 'habitTracker.import.state.v1';
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_HABITS = 200;
const MAX_IMPORT_COMPLETION_DATES = 20000;
const MAX_IMPORT_TRUE_ENTRIES = 200000;

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

function hasControlChars(str) {
  return /[\u0000-\u001F\u007F]/.test(str);
}

// Copia sin cadena de prototipo: iterar/leer/escribir por clave externa
// (incluida una clave literal "__proto__" producida por JSON.parse) nunca
// dispara el accessor especial de Object.prototype.
function toNullProtoCopy(obj) {
  const out = Object.create(null);
  for (const key of Object.keys(obj)) {
    out[key] = obj[key];
  }
  return out;
}

// -----------------------------------------------------------------------
// validateBackup(rawText): pura. Nunca repara/trunca/normaliza en silencio
// más allá de las dos excepciones explícitas (false y fecha vacía, ambas
// con warning).
// -----------------------------------------------------------------------
function validateBackup(rawText) {
  const warnings = [];
  const fail = (fatal) => ({ ok: false, fatal, warnings, summary: null, data: null });

  if (typeof rawText !== 'string') return fail('Contenido inválido.');
  if (utf8ByteLength(rawText) > MAX_IMPORT_BYTES) return fail('El archivo supera el límite de 5 MB.');

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (e) {
    return fail('El archivo no es JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('La raíz del backup debe ser un objeto.');
  }

  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2 && parsed.schemaVersion !== 3) {
    return fail('schemaVersion no es 1, 2 ni 3.');
  }
  const schemaVersion = parsed.schemaVersion;

  const ALLOWED_ROOT = schemaVersion === 1
    ? ['schemaVersion', 'exportedAt', 'habits', 'completions']
    : schemaVersion === 2
      ? ['schemaVersion', 'exportedAt', 'habits', 'completions', 'quantities']
      : ['schemaVersion', 'exportedAt', 'habits', 'completions', 'quantities', 'skips'];
  const rootKeys = Object.keys(parsed);
  const unknownRoot = rootKeys.filter(k => !ALLOWED_ROOT.includes(k));
  if (unknownRoot.length > 0) return fail(`Campo desconocido en la raíz: "${unknownRoot[0]}".`);
  for (const k of ALLOWED_ROOT) {
    if (!(k in parsed)) return fail(`Falta el campo raíz "${k}".`);
  }

  if (typeof parsed.exportedAt !== 'string' || isNaN(Date.parse(parsed.exportedAt))) {
    return fail('exportedAt no es una fecha ISO válida.');
  }
  if (!Array.isArray(parsed.habits)) return fail('"habits" debe ser un array.');
  if (parsed.habits.length > MAX_IMPORT_HABITS) {
    return fail(`Demasiados hábitos (máximo ${MAX_IMPORT_HABITS}).`);
  }
  if (!parsed.completions || typeof parsed.completions !== 'object' || Array.isArray(parsed.completions)) {
    return fail('"completions" debe ser un objeto.');
  }
  if (schemaVersion >= 2) {
    if (!parsed.quantities || typeof parsed.quantities !== 'object' || Array.isArray(parsed.quantities)) {
      return fail('"quantities" debe ser un objeto.');
    }
  }
  if (schemaVersion === 3) {
    if (!parsed.skips || typeof parsed.skips !== 'object' || Array.isArray(parsed.skips)) {
      return fail('"skips" debe ser un objeto.');
    }
  }

  const BASE_HABIT_FIELDS = ['id', 'name', 'icon', 'color', 'freq', 'freqCount', 'freqPeriod', 'createdAt'];
  const seenIds = new Set();
  const habitKindById = new Map();
  const validHabits = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < parsed.habits.length; i++) {
    const habit = parsed.habits[i];
    const label = `hábito #${i + 1}`;
    if (!habit || typeof habit !== 'object' || Array.isArray(habit)) return fail(`${label}: registro inválido.`);

    // v1 no tiene "kind": todo hábito v1 se trata como booleano
    // (decisión humana, ver docs/ROADMAP.md, sección "Backup v2").
    // v2 exige "kind" explícito, y amplía los campos permitidos del
    // hábito solo para el caso cuantitativo.
    let kind = 'boolean';
    let allowedHabitFields = BASE_HABIT_FIELDS;
    if (schemaVersion >= 2) {
      if (!isValidKind(habit.kind)) return fail(`${label}: tipo (kind) inválido.`);
      kind = habit.kind;
      allowedHabitFields = kind === 'quantitative'
        ? [...BASE_HABIT_FIELDS, 'kind', 'unit', 'target']
        : [...BASE_HABIT_FIELDS, 'kind'];
      if (schemaVersion === 3) {
        // v3: `archived` obligatorio; `freqWindowDays` solo si el período
        // es 'loop-month' (mismo patrón que unit/target para cuantitativos).
        allowedHabitFields = [...allowedHabitFields, 'archived'];
        if (habit.freqPeriod === LOOP_MONTH_PERIOD) allowedHabitFields.push('freqWindowDays');
      }
    }

    const habitKeys = Object.keys(habit);
    const unknownHabit = habitKeys.filter(k => !allowedHabitFields.includes(k));
    if (unknownHabit.length > 0) return fail(`${label}: campo desconocido "${unknownHabit[0]}".`);
    for (const k of allowedHabitFields) {
      if (!(k in habit)) return fail(`${label}: falta el campo "${k}".`);
    }

    if (!isValidIdFormat(habit.id)) return fail(`${label}: id inválido.`);
    if (isReservedId(habit.id)) return fail(`${label}: id reservado no permitido.`);
    if (seenIds.has(habit.id)) return fail(`${label}: id duplicado.`);

    if (!isValidSchemaName(habit.name)) return fail(`${label}: nombre inválido (1 a 5000 caracteres).`);
    if (hasControlChars(habit.name)) return fail(`${label}: el nombre contiene caracteres de control.`);
    if (!isValidIcon(habit.icon)) return fail(`${label}: ícono inválido.`);
    if (countCodePoints(habit.icon) > 8) return fail(`${label}: ícono demasiado largo.`);
    if (!isValidColorHex(habit.color)) return fail(`${label}: color inválido.`);
    if (!isValidFreq(habit.freq)) return fail(`${label}: frecuencia inválida.`);
    const periodAllowed = schemaVersion === 3 ? VALID_FREQ_PERIOD : VALID_FREQ_PERIOD_V2;
    if (!periodAllowed.includes(habit.freqPeriod)) return fail(`${label}: período de frecuencia inválido.`);
    if (!isValidFreqCount(habit.freqCount)) return fail(`${label}: cantidad de frecuencia inválida (1 a 30).`);
    if (schemaVersion === 3) {
      const loopMonthError = getLoopMonthFrequencyError(habit);
      if (loopMonthError) return fail(`${label}: ${loopMonthError}`);
      if (typeof habit.archived !== 'boolean') return fail(`${label}: estado archivado inválido.`);
    }

    if (kind === 'quantitative') {
      if (!isValidUnit(habit.unit)) return fail(`${label}: unidad inválida.`);
      if (!isValidTarget(habit.target)) return fail(`${label}: objetivo (target) inválido.`);
    }

    const createdAtDate = parseLocalDate(habit.createdAt);
    if (!createdAtDate) return fail(`${label}: fecha de creación inválida.`);
    if (createdAtDate > today) return fail(`${label}: fecha de creación futura.`);

    seenIds.add(habit.id);
    habitKindById.set(habit.id, kind);
    const validHabit = {
      id: habit.id, name: habit.name, icon: habit.icon, color: habit.color,
      freq: habit.freq, freqCount: habit.freqCount, freqPeriod: habit.freqPeriod,
      createdAt: habit.createdAt, kind,
      // v1/v2 no tienen `archived`: se normaliza a no archivado.
      archived: schemaVersion === 3 ? habit.archived : false
    };
    if (habit.freqPeriod === LOOP_MONTH_PERIOD) validHabit.freqWindowDays = habit.freqWindowDays;
    if (kind === 'quantitative') {
      validHabit.unit = habit.unit;
      validHabit.target = habit.target;
    }
    validHabits.push(validHabit);
  }

  const completionsIn = toNullProtoCopy(parsed.completions);
  const dateKeys = Object.keys(completionsIn);
  if (dateKeys.length > MAX_IMPORT_COMPLETION_DATES) {
    return fail(`Demasiadas fechas de completado (máximo ${MAX_IMPORT_COMPLETION_DATES}).`);
  }

  let trueCount = 0;
  const outCompletions = Object.create(null);

  for (const dateKey of dateKeys) {
    const dateObj = parseLocalDate(dateKey);
    if (!dateObj) return fail(`Fecha de completado inválida: "${dateKey}".`);
    if (dateObj > today) return fail(`Fecha de completado futura: "${dateKey}".`);

    const entry = completionsIn[dateKey];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return fail(`Registro de completados inválido para "${dateKey}".`);
    }
    const entrySafe = toNullProtoCopy(entry);
    const outEntry = Object.create(null);
    let anyTrueThisDate = false;

    for (const habitId of Object.keys(entrySafe)) {
      const value = entrySafe[habitId];
      if (value !== true && value !== false) return fail(`Valor de completado inválido para "${dateKey}".`);

      const habitExists = seenIds.has(habitId);
      if (value === true) {
        if (!habitExists) return fail(`Completado huérfano: "${dateKey}" referencia un hábito inexistente.`);
        if (habitKindById.get(habitId) !== 'boolean') {
          return fail(`Completado "${dateKey}" referencia un hábito que no es booleano.`);
        }
        trueCount++;
        if (trueCount > MAX_IMPORT_TRUE_ENTRIES) {
          return fail(`Demasiadas entradas de completado (máximo ${MAX_IMPORT_TRUE_ENTRIES}).`);
        }
        outEntry[habitId] = true;
        anyTrueThisDate = true;
      } else {
        warnings.push(habitExists
          ? `Completado "false" descartado en "${dateKey}".`
          : `Completado "false" huérfano descartado en "${dateKey}".`);
      }
    }

    if (anyTrueThisDate) {
      outCompletions[dateKey] = outEntry;
    } else {
      warnings.push(`Fecha "${dateKey}" quedó sin completados y se omitió.`);
    }
  }

  // quantities: solo existe en v2. Un backup v1 importado queda siempre
  // con quantities={} -- no hay manera de que v1 traiga datos
  // cuantitativos, así que no hay nada que migrar ni inferir acá.
  let outQuantities = Object.create(null);
  if (schemaVersion >= 2) {
    const quantitiesIn = toNullProtoCopy(parsed.quantities);
    const qDateKeys = Object.keys(quantitiesIn);
    if (qDateKeys.length > MAX_IMPORT_COMPLETION_DATES) {
      return fail(`Demasiadas fechas de cantidad (máximo ${MAX_IMPORT_COMPLETION_DATES}).`);
    }

    let quantityEntryCount = 0;
    for (const dateKey of qDateKeys) {
      const dateObj = parseLocalDate(dateKey);
      if (!dateObj) return fail(`Fecha de cantidad inválida: "${dateKey}".`);
      if (dateObj > today) return fail(`Fecha de cantidad futura: "${dateKey}".`);

      const entry = quantitiesIn[dateKey];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return fail(`Registro de cantidades inválido para "${dateKey}".`);
      }
      const entrySafe = toNullProtoCopy(entry);
      const outEntry = Object.create(null);
      let anyThisDate = false;

      for (const habitId of Object.keys(entrySafe)) {
        const value = entrySafe[habitId];
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          return fail(`Valor de cantidad inválido para "${dateKey}".`);
        }
        const valueSafe = toNullProtoCopy(value);
        const valueKeys = Object.keys(valueSafe);
        if (valueKeys.length !== 2 || !('actualMinutes' in valueSafe) || !('plannedMinutes' in valueSafe)) {
          return fail(`Campos de cantidad inválidos para "${dateKey}".`);
        }
        if (!isSafeNonNegativeInt(valueSafe.actualMinutes)) {
          return fail(`actualMinutes inválido para "${dateKey}".`);
        }
        if (valueSafe.plannedMinutes !== null && !isSafeNonNegativeInt(valueSafe.plannedMinutes)) {
          return fail(`plannedMinutes inválido para "${dateKey}".`);
        }
        if (!seenIds.has(habitId)) {
          return fail(`Cantidad huérfana: "${dateKey}" referencia un hábito inexistente.`);
        }
        if (habitKindById.get(habitId) !== 'quantitative') {
          return fail(`Cantidad "${dateKey}" referencia un hábito que no es cuantitativo.`);
        }

        quantityEntryCount++;
        if (quantityEntryCount > MAX_IMPORT_TRUE_ENTRIES) {
          return fail(`Demasiadas entradas de cantidad (máximo ${MAX_IMPORT_TRUE_ENTRIES}).`);
        }
        outEntry[habitId] = { actualMinutes: valueSafe.actualMinutes, plannedMinutes: valueSafe.plannedMinutes };
        anyThisDate = true;
      }

      if (anyThisDate) {
        outQuantities[dateKey] = outEntry;
      }
    }
  }

  // skips: solo existe en v3. Estado neutral por fecha y hábito booleano:
  // nunca coexiste con un completado true de la misma fecha y hábito
  // (se rechaza, no se resuelve en silencio).
  const outSkips = Object.create(null);
  let skipCount = 0;
  if (schemaVersion === 3) {
    const skipsIn = toNullProtoCopy(parsed.skips);
    const sDateKeys = Object.keys(skipsIn);
    if (sDateKeys.length > MAX_IMPORT_COMPLETION_DATES) {
      return fail(`Demasiadas fechas de omitidos (máximo ${MAX_IMPORT_COMPLETION_DATES}).`);
    }
    for (const dateKey of sDateKeys) {
      const dateObj = parseLocalDate(dateKey);
      if (!dateObj) return fail(`Fecha de omitido inválida: "${dateKey}".`);
      if (dateObj > today) return fail(`Fecha de omitido futura: "${dateKey}".`);

      const entry = skipsIn[dateKey];
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return fail(`Registro de omitidos inválido para "${dateKey}".`);
      }
      const entrySafe = toNullProtoCopy(entry);
      const outEntry = Object.create(null);
      for (const habitId of Object.keys(entrySafe)) {
        if (entrySafe[habitId] !== true) return fail(`Valor de omitido inválido para "${dateKey}".`);
        if (!seenIds.has(habitId)) {
          return fail(`Omitido huérfano: "${dateKey}" referencia un hábito inexistente.`);
        }
        // SKIP vale para hábitos booleanos y de tiempo, pero nunca coexiste
        // con un registro del mismo día: ni un completado (booleano) ni una
        // cantidad, incluido un cero explícito (tiempo).
        if (outCompletions[dateKey] && outCompletions[dateKey][habitId] === true) {
          return fail(`Omitido y completado a la vez en "${dateKey}".`);
        }
        if (habitKindById.get(habitId) === 'quantitative' && outQuantities[dateKey] && hasOwnKey(outQuantities[dateKey], habitId)) {
          return fail(`Omitido y cantidad registrada a la vez en "${dateKey}".`);
        }
        skipCount++;
        if (skipCount > MAX_IMPORT_TRUE_ENTRIES) {
          return fail(`Demasiadas entradas de omitidos (máximo ${MAX_IMPORT_TRUE_ENTRIES}).`);
        }
        outEntry[habitId] = true;
      }
      if (Object.keys(outEntry).length > 0) outSkips[dateKey] = outEntry;
    }
  }

  // Normalización interna: toda importación exitosa (v1, v2 o v3) produce
  // datos ya en forma v3 (decisión humana) -- v1/v2 se tratan como v3 con
  // skips vacío, archived=false y, en v1, quantities vacío y todo hábito
  // kind="boolean".
  return {
    ok: true,
    fatal: null,
    warnings,
    summary: {
      habitsCount: validHabits.length,
      completionDatesCount: Object.keys(outCompletions).length,
      trueEntriesCount: trueCount,
      quantityDatesCount: Object.keys(outQuantities).length,
      skipDatesCount: Object.keys(outSkips).length,
      skipEntriesCount: skipCount,
      archivedCount: validHabits.filter(h => h.archived).length,
      loopMonthCount: validHabits.filter(h => h.freqPeriod === LOOP_MONTH_PERIOD).length,
      exportedAt: parsed.exportedAt
    },
    data: {
      schemaVersion: 3,
      exportedAt: parsed.exportedAt,
      habits: validHabits,
      completions: outCompletions,
      quantities: outQuantities,
      skips: outSkips
    }
  };
}

// -----------------------------------------------------------------------
// Primitivas de storage con verificación por igualdad literal (sin hash).
// -----------------------------------------------------------------------
// Lectura segura de una key: distingue explícitamente una excepción de
// storage (ok:false) de una clave genuinamente ausente (ok:true, value:null),
// para que ninguna excepción se confunda con "ausente" ni con un dato válido.
function readExactRaw(key) {
  try {
    return { ok: true, value: localStorage.getItem(key) };
  } catch (e) {
    return { ok: false, value: undefined };
  }
}

function writeAndVerify(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    return false;
  }
  try {
    return localStorage.getItem(key) === value;
  } catch (e) {
    return false;
  }
}

function isStructurallyValidHabitsJson(str) {
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) && parsed.every(el => typeof el === 'object' && el !== null && !Array.isArray(el));
  } catch (e) {
    return false;
  }
}

function isStructurallyValidCompletionsJson(str) {
  try {
    const parsed = JSON.parse(str);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch (e) {
    return false;
  }
}

// Misma forma raíz que completions -- quantities no tiene un chequeo
// más profundo acá, igual que completions nunca lo tuvo.
function isStructurallyValidQuantitiesJson(str) {
  try {
    const parsed = JSON.parse(str);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch (e) {
    return false;
  }
}

// Misma forma raíz que completions.
function isStructurallyValidSkipsJson(str) {
  try {
    const parsed = JSON.parse(str);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch (e) {
    return false;
  }
}

// Verificación estructural post-escritura: excepción de lectura = fallo de
// verificación (no éxito ambiguo), dispara el mismo camino de rollback que
// una discrepancia real de contenido.
function verifyStructuralWrite(newHabitsStr, newCompletionsStr, newQuantitiesStr, newSkipsStr) {
  try {
    return localStorage.getItem('habits') === newHabitsStr &&
      localStorage.getItem('completions') === newCompletionsStr &&
      localStorage.getItem('quantities') === newQuantitiesStr &&
      localStorage.getItem('skips') === newSkipsStr &&
      isStructurallyValidHabitsJson(localStorage.getItem('habits')) &&
      isStructurallyValidCompletionsJson(localStorage.getItem('completions')) &&
      isStructurallyValidQuantitiesJson(localStorage.getItem('quantities')) &&
      isStructurallyValidSkipsJson(localStorage.getItem('skips'));
  } catch (e) {
    return false;
  }
}

function restoreOneKey(key, rawValue) {
  if (rawValue === null) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      return false;
    }
    try {
      return localStorage.getItem(key) === null;
    } catch (e) {
      return false;
    }
  }
  return writeAndVerify(key, rawValue);
}

// Restaura las CUATRO claves como una sola unidad lógica. Se intentan
// todas aunque alguna falle, para dejar el menor daño posible.
function restoreExactRaw(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw) {
  const habitsOk = restoreOneKey('habits', habitsRaw);
  const completionsOk = restoreOneKey('completions', completionsRaw);
  const quantitiesOk = restoreOneKey('quantities', quantitiesRaw);
  const skipsOk = restoreOneKey('skips', skipsRaw === undefined ? null : skipsRaw);
  return { verified: habitsOk && completionsOk && quantitiesOk && skipsOk };
}

function buildSnapshot(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw) {
  return JSON.stringify({
    snapshotVersion: 3,
    createdAt: new Date().toISOString(),
    habitsRaw: habitsRaw,
    completionsRaw: completionsRaw,
    quantitiesRaw: quantitiesRaw,
    skipsRaw: skipsRaw
  });
}

function buildMarker() {
  return JSON.stringify({ stateVersion: 1, startedAt: new Date().toISOString() });
}

// snapshotVersion 2 agrega quantitiesRaw (Backup v2). Un snapshot
// snapshotVersion=1 preexistente (de antes de este cambio) nunca pasa
// este chequeo -- mismo criterio estricto de "coincidencia exacta" que
// ya usaba esta función: cae a blocking-recovery, nunca se interpreta a
// medias ni se completa el campo faltante en silencio.
function parseSnapshotShape(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  // snapshotVersion 3 agrega skipsRaw (Backup v3). Un snapshot version 2
  // (escrito por la app anterior, que no tenía skips) sigue siendo
  // restaurable: su estado previo no tenía la clave 'skips', así que se
  // restaura como ausente. La versión 1 sigue sin aceptarse.
  if (parsed.snapshotVersion !== 2 && parsed.snapshotVersion !== 3) return null;
  if (typeof parsed.createdAt !== 'string' || isNaN(Date.parse(parsed.createdAt))) return null;
  if (!(parsed.habitsRaw === null || typeof parsed.habitsRaw === 'string')) return null;
  if (!(parsed.completionsRaw === null || typeof parsed.completionsRaw === 'string')) return null;
  if (!(parsed.quantitiesRaw === null || typeof parsed.quantitiesRaw === 'string')) return null;
  if (parsed.snapshotVersion === 3 &&
      !(parsed.skipsRaw === null || typeof parsed.skipsRaw === 'string')) return null;
  if (parsed.snapshotVersion === 2) parsed.skipsRaw = null;
  return parsed;
}

function parseMarkerShape(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.stateVersion !== 1) return null;
  if (typeof parsed.startedAt !== 'string' || isNaN(Date.parse(parsed.startedAt))) return null;
  return parsed;
}

// Heurística PASIVA de capacidad: solo matemática sobre strings ya en
// memoria. Nunca escribe una key de prueba ni un relleno. No garantiza
// que los setItem() reales vayan a tener éxito -- esos, con su propia
// verificación, son la única fuente de verdad.
function estimateImportCapacity(newHabitsStr, newCompletionsStr, newQuantitiesStr, newSkipsStr, snapshotStr, markerStr) {
  const TYPICAL_ORIGIN_QUOTA = 5 * 1024 * 1024;
  const estimatedBytes = utf8ByteLength(newHabitsStr) + utf8ByteLength(newCompletionsStr) +
    utf8ByteLength(newQuantitiesStr) + utf8ByteLength(newSkipsStr) +
    utf8ByteLength(snapshotStr) + utf8ByteLength(markerStr);
  return { estimatedBytes, obviouslyTooLarge: estimatedBytes > TYPICAL_ORIGIN_QUOTA };
}

// Si no se puede leer con confianza, se asume (por seguridad) que SÍ hay una
// recuperación pendiente: bloquear un import nuevo es preferible a arriesgarse
// a pisar evidencia de un snapshot/marker que en realidad existe.
function hasPendingImportRecovery() {
  const marker = readExactRaw(MARKER_KEY);
  const snapshot = readExactRaw(SNAPSHOT_KEY);
  if (!marker.ok || !snapshot.ok) return true;
  return marker.value !== null || snapshot.value !== null;
}

// -----------------------------------------------------------------------
// Reemplazo seguro. Nunca reporta éxito antes de confirmar que el marker
// quedó realmente ausente. Si algo falla después de escribir datos vivos,
// intenta rollback; si el rollback no puede verificarse, entra en modo
// bloqueante en la misma sesión (no espera a un reinicio).
// -----------------------------------------------------------------------
function performImportReplacement(validatedData) {
  if (hasPendingImportRecovery()) {
    return { ok: false, error: 'Hay una recuperación de importación pendiente; no se puede iniciar un nuevo reemplazo.' };
  }

  const newHabitsStr = JSON.stringify(validatedData.habits);
  const newCompletionsStr = JSON.stringify(validatedData.completions);
  const newQuantitiesStr = JSON.stringify(validatedData.quantities || {});
  const newSkipsStr = JSON.stringify(validatedData.skips || {});
  const habitsRawRead = readExactRaw('habits');
  const completionsRawRead = readExactRaw('completions');
  const quantitiesRawRead = readExactRaw('quantities');
  const skipsRawRead = readExactRaw('skips');
  if (!habitsRawRead.ok || !completionsRawRead.ok || !quantitiesRawRead.ok || !skipsRawRead.ok) {
    return { ok: false, error: 'No se pudo leer el estado actual antes de importar. No se modificaron tus datos.' };
  }
  const habitsRaw = habitsRawRead.value;
  const completionsRaw = completionsRawRead.value;
  const quantitiesRaw = quantitiesRawRead.value;
  const skipsRaw = skipsRawRead.value;
  const snapshotStr = buildSnapshot(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw);
  const markerStr = buildMarker();

  const capacity = estimateImportCapacity(newHabitsStr, newCompletionsStr, newQuantitiesStr, newSkipsStr, snapshotStr, markerStr);
  if (capacity.obviouslyTooLarge) {
    return { ok: false, error: 'El backup es demasiado grande para el almacenamiento disponible.' };
  }

  if (!writeAndVerify(SNAPSHOT_KEY, snapshotStr)) {
    return { ok: false, error: 'No se pudo escribir o verificar el snapshot de seguridad. No se modificaron tus datos.' };
  }

  if (!writeAndVerify(MARKER_KEY, markerStr)) {
    return {
      ok: false,
      error: 'No se pudo escribir o verificar el marcador de importación. No se modificaron tus datos. ' +
        'El snapshot de seguridad queda pendiente de limpieza en el próximo inicio.'
    };
  }

  const habitsWriteOk = writeAndVerify('habits', newHabitsStr);
  const completionsWriteOk = habitsWriteOk && writeAndVerify('completions', newCompletionsStr);
  const quantitiesWriteOk = completionsWriteOk && writeAndVerify('quantities', newQuantitiesStr);
  const skipsWriteOk = quantitiesWriteOk && writeAndVerify('skips', newSkipsStr);
  const structuralOk = skipsWriteOk && verifyStructuralWrite(newHabitsStr, newCompletionsStr, newQuantitiesStr, newSkipsStr);

  if (!structuralOk) {
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw, 'No se pudieron escribir o verificar los datos importados.');
  }

  let markerRemoved = false;
  try {
    localStorage.removeItem(MARKER_KEY);
    markerRemoved = localStorage.getItem(MARKER_KEY) === null;
  } catch (e) {
    markerRemoved = false;
  }

  if (!markerRemoved) {
    // Decisión humana: los datos nuevos ya están escritos y verificados,
    // pero el import NO se considera exitoso si el marker sigue presente.
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw, 'La importación no pudo cerrarse de forma segura y fue revertida.');
  }

  // Éxito real. El snapshot se conserva para cleanup en el próximo
  // startup limpio (estado B), igual que 4.1 hace con storageHealth.
  loadData();
  render();
  return { ok: true };
}

function finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw, publicMessage) {
  const restore = restoreExactRaw(habitsRaw, completionsRaw, quantitiesRaw, skipsRaw);
  if (!restore.verified) {
    enterBlockingRecovery('rollback-failed');
    return { ok: false, error: `${publicMessage} Además, no se pudo restaurar el estado anterior de forma segura.` };
  }

  let markerRemoved = false;
  try {
    localStorage.removeItem(MARKER_KEY);
    markerRemoved = localStorage.getItem(MARKER_KEY) === null;
  } catch (e) {
    markerRemoved = false;
  }

  if (!markerRemoved) {
    enterBlockingRecovery('marker-cleanup-failed-after-rollback');
    return { ok: false, error: `${publicMessage} Tus datos anteriores se restauraron, pero la app necesita reiniciarse para confirmarlo.` };
  }

  loadData();
  render();
  return { ok: false, error: publicMessage };
}

// -----------------------------------------------------------------------
// Startup recovery. Debe correr ANTES de loadData(), porque loadData()
// puede escribir (migración de createdAt).
// -----------------------------------------------------------------------
function recoverInterruptedImport() {
  const markerRead = readExactRaw(MARKER_KEY);
  const snapshotFlagRead = readExactRaw(SNAPSHOT_KEY);
  if (!markerRead.ok || !snapshotFlagRead.ok) {
    // No se puede determinar con confianza si hay una importación
    // interrumpida: un startup normal sería inseguro en este caso.
    return { state: 'blocking-recovery', reason: 'storage-read-failed' };
  }
  const markerRaw = markerRead.value;
  const snapshotExists = snapshotFlagRead.value !== null;

  if (markerRaw === null && !snapshotExists) return { state: 'normal' };
  if (markerRaw === null && snapshotExists) return { state: 'snapshot-pending-cleanup' };

  const marker = parseMarkerShape(markerRaw);
  const snapshotRead = readExactRaw(SNAPSHOT_KEY);
  if (!snapshotRead.ok) {
    return { state: 'blocking-recovery', reason: 'storage-read-failed' };
  }
  const snapshot = parseSnapshotShape(snapshotRead.value);
  if (!marker || !snapshot) {
    return { state: 'blocking-recovery', reason: !marker ? 'marker-corrupt' : 'snapshot-corrupt' };
  }

  const restore = restoreExactRaw(snapshot.habitsRaw, snapshot.completionsRaw, snapshot.quantitiesRaw, snapshot.skipsRaw);
  if (!restore.verified) {
    return { state: 'blocking-recovery', reason: 'restore-verify-failed' };
  }

  let markerRemoved = false;
  try {
    localStorage.removeItem(MARKER_KEY);
    markerRemoved = localStorage.getItem(MARKER_KEY) === null;
  } catch (e) {
    markerRemoved = false;
  }

  if (!markerRemoved) {
    return { state: 'blocking-recovery', reason: 'marker-removal-failed-after-restore' };
  }

  return { state: 'recovered' };
}

function finishStartupCleanupB() {
  if (hasStorageCorruption()) return;
  try {
    localStorage.removeItem(SNAPSHOT_KEY);
  } catch (e) {
    // best effort: queda pendiente para el próximo startup limpio.
  }
}

// -----------------------------------------------------------------------
// Blocking recovery UI: solo lectura, solo diagnóstico. Nunca repara,
// nunca parsea como válido, nunca modifica storage.
// -----------------------------------------------------------------------
function downloadRawRescue(key, raw) {
  const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filename = `habitos-rescate-crudo-${safeKey}-${toLocalDateStr(new Date())}.txt`;
  const blob = new Blob([raw], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function renderBlockingRecovery(reason) {
  document.body.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'blocking-recovery';

  const title = document.createElement('h1');
  title.textContent = 'Recuperación requerida';
  wrap.appendChild(title);

  const msg = document.createElement('p');
  msg.textContent = 'Una importación anterior quedó en un estado inconsistente y no se puede continuar ' +
    'automáticamente. Tus datos no se modificaron ni se repararon. Podés descargar una copia cruda de ' +
    'diagnóstico de cada pieza disponible más abajo.';
  wrap.appendChild(msg);

  [
    ['habits', 'habits (hábitos en vivo)'],
    ['completions', 'completions (completados en vivo)'],
    ['quantities', 'quantities (cantidades en vivo)'],
    ['skips', 'skips (omitidos en vivo)'],
    [SNAPSHOT_KEY, 'snapshot de la importación interrumpida'],
    [MARKER_KEY, 'marcador de la importación interrumpida']
  ].forEach(([key, label]) => {
    // Una excepción al leer una fila no debe tirar abajo toda la pantalla
    // de rescate: se informa esa fila puntual y se sigue con las demás.
    const rawRead = readExactRaw(key);
    const row = document.createElement('div');
    row.className = 'rescue-row';
    const rowLabel = document.createElement('span');
    rowLabel.textContent = `${label}: `;
    row.appendChild(rowLabel);

    if (!rawRead.ok) {
      const err = document.createElement('span');
      err.textContent = '(no se pudo leer)';
      row.appendChild(err);
    } else if (rawRead.value === null) {
      const none = document.createElement('span');
      none.textContent = '(vacío)';
      row.appendChild(none);
    } else {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn-secondary';
      dlBtn.textContent = 'Descargar rescate crudo';
      dlBtn.onclick = () => downloadRawRescue(key, rawRead.value);
      row.appendChild(dlBtn);
    }
    wrap.appendChild(row);
  });

  const disclaimer = document.createElement('p');
  disclaimer.className = 'rescue-disclaimer';
  disclaimer.textContent = 'Estos archivos son RESCATE CRUDO / diagnóstico: no son necesariamente un Backup v1 ' +
    'válido y no deben tratarse como tales.';
  wrap.appendChild(disclaimer);

  document.body.appendChild(wrap);
}

function enterBlockingRecovery(reason) {
  renderBlockingRecovery(reason);
}

// -----------------------------------------------------------------------
// UI de import: selector de archivo, preview read-only, segunda
// confirmación destructiva.
// -----------------------------------------------------------------------
function isImportFileSizeOk(file) {
  return typeof file.size === 'number' && file.size <= MAX_IMPORT_BYTES;
}

function closeImportPreview() {
  const container = document.getElementById('importPreview');
  container.classList.remove('active');
  container.innerHTML = '';
  document.getElementById('importFileInput').value = '';
}

function confirmImportReplacement(validatedData) {
  if (!confirm('¿Confirmás que querés reemplazar TODOS tus datos actuales con este backup? Esta acción no se puede deshacer.')) {
    return;
  }
  const result = performImportReplacement(validatedData);
  closeImportPreview();
  if (!result.ok) {
    alert(`No se pudo importar: ${result.error}`);
  }
}

// Todo dato importado se muestra vía createElement/textContent -- nunca
// innerHTML con datos importados.
function renderImportPreview(validation) {
  const container = document.getElementById('importPreview');
  container.innerHTML = '';

  const content = document.createElement('div');
  content.className = 'modal-content';

  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Importar backup';
  content.appendChild(title);

  if (!validation.ok) {
    const errorP = document.createElement('div');
    errorP.className = 'import-fatal';
    errorP.textContent = `No se puede importar: ${validation.fatal}`;
    content.appendChild(errorP);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn-secondary';
    closeBtn.textContent = 'Cerrar';
    closeBtn.onclick = closeImportPreview;
    actions.appendChild(closeBtn);
    content.appendChild(actions);
  } else {
    const summary = document.createElement('div');
    summary.className = 'import-summary';
    summary.textContent = buildImportSummaryText(validation.summary);
    content.appendChild(summary);

    if (validation.warnings.length > 0) {
      const warnTitle = document.createElement('div');
      warnTitle.className = 'import-warnings-title';
      warnTitle.textContent = `Avisos (${validation.warnings.length}):`;
      content.appendChild(warnTitle);
      const warnList = document.createElement('ul');
      warnList.className = 'import-warnings-list';
      validation.warnings.forEach(w => {
        const li = document.createElement('li');
        li.textContent = w;
        warnList.appendChild(li);
      });
      content.appendChild(warnList);
    }

    const destructiveNote = document.createElement('div');
    destructiveNote.className = 'import-destructive-note';
    destructiveNote.textContent = 'Importar este archivo REEMPLAZARÁ todos tus hábitos y días completados actuales. Esta acción no se puede deshacer.';
    content.appendChild(destructiveNote);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-secondary';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.onclick = closeImportPreview;
    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'btn-primary';
    confirmBtn.textContent = 'Reemplazar datos';
    confirmBtn.onclick = () => confirmImportReplacement(validation.data);
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    content.appendChild(actions);
  }

  container.appendChild(content);
  container.classList.add('active');
}

function handleImportFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  if (hasPendingImportRecovery()) {
    renderImportPreview({ ok: false, fatal: 'Hay una recuperación de importación pendiente. Reiniciá la app antes de intentar un nuevo import.', warnings: [], summary: null, data: null });
    return;
  }

  if (!isImportFileSizeOk(file)) {
    renderImportPreview({ ok: false, fatal: 'El archivo supera el límite de 5 MB.', warnings: [], summary: null, data: null });
    return;
  }

  file.text().then(rawText => {
    renderImportPreview(validateBackup(rawText));
  }).catch(() => {
    renderImportPreview({ ok: false, fatal: 'No se pudo leer el archivo.', warnings: [], summary: null, data: null });
  });
}

function openImportPicker() {
  if (hasPendingImportRecovery()) {
    alert('Hay una recuperación de importación pendiente. Reiniciá la app antes de intentar un nuevo import.');
    return;
  }
  document.getElementById('importFileInput').click();
}

// =======================================================================
// Importación de historial de tiempo (archivo JSON privado, versión 1)
//
// Agrega registros de minutos a UN hábito de tiempo existente sin tocar el
// esquema de Backup v3: cada registro nuevo es exactamente el que escribe la
// app al guardar minutos, quantities[fecha][id] = {actualMinutes,
// plannedMinutes: null}. Solo inserta: una fecha que ya tiene cualquier
// estado (minutos, un cero explícito, SKIP o un completado) es un conflicto
// y queda intacta. Un cero se conserva como cero; una fecha ausente sigue
// ausente.
//
// SKIP se guarda en `skips` (estructura separada, igual que en los hábitos
// booleanos); nunca coexiste con un registro de minutos del mismo día.
//
// createdAt: las estadísticas nunca cuentan antes de createdAt. Para que un
// historial antiguo no quede invisible, una importación confirmada adelanta
// (nunca atrasa) el createdAt del hábito a la fecha importada más antigua.
// Solo lo hace este importador; el Calendario manual no toca createdAt.
// =======================================================================
const HISTORY_VERSION = 1;
const HISTORY_MAX_BYTES = 2 * 1024 * 1024;
const HISTORY_MAX_DAILY_MINUTES = TIME_MAX_HOURS * 60;
const HISTORY_SKIP = 'SKIP';

function isHistoryObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwnKey(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}

function historyKeyLabel(key) {
  const text = String(key);
  return text.length > 24 ? `${text.slice(0, 24)}…` : text;
}

// Pura: no toca DOM, storage ni red. Rechaza todo lo que no sea exactamente
// la estructura esperada; nunca corrige ni trunca en silencio.
function validateHistoryFile(rawText) {
  const fail = (fatal) => ({ ok: false, fatal, data: null });
  if (typeof rawText !== 'string') return fail('Contenido inválido.');
  if (utf8ByteLength(rawText) > HISTORY_MAX_BYTES) return fail('El archivo supera el límite de 2 MB.');

  let parsed;
  try {
    parsed = JSON.parse(rawText.replace(/^﻿/, ''));
  } catch (e) {
    return fail('El archivo no es JSON válido.');
  }
  if (!isHistoryObject(parsed)) return fail('La raíz del historial debe ser un objeto.');

  const ROOT = ['version', 'habit', 'unit', 'range', 'records'];
  const unknownRoot = Object.keys(parsed).filter(k => !ROOT.includes(k));
  if (unknownRoot.length > 0) return fail(`Campo desconocido en la raíz: "${historyKeyLabel(unknownRoot[0])}".`);
  for (const k of ROOT) {
    if (!hasOwnKey(parsed, k)) return fail(`Falta el campo "${k}".`);
  }

  if (parsed.version !== HISTORY_VERSION) return fail(`Versión no admitida: "version" debe ser ${HISTORY_VERSION}.`);
  if (parsed.unit !== 'minutes') return fail('La unidad debe ser "minutes".');
  if (typeof parsed.habit !== 'string' || parsed.habit.length === 0 || countCodePoints(parsed.habit) > 200 ||
      hasControlChars(parsed.habit)) {
    return fail('El nombre del hábito del archivo no es válido (1 a 200 caracteres, sin caracteres de control).');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!isHistoryObject(parsed.range) || Object.keys(parsed.range).length !== 2 ||
      !hasOwnKey(parsed.range, 'from') || !hasOwnKey(parsed.range, 'to')) {
    return fail('"range" debe tener exactamente "from" y "to".');
  }
  const fromDate = parseLocalDate(parsed.range.from);
  const toDate = parseLocalDate(parsed.range.to);
  if (!fromDate || !toDate) return fail('El rango tiene una fecha inválida (usá AAAA-MM-DD).');
  if (fromDate > toDate) return fail('El rango es inválido: "from" es posterior a "to".');
  if (toDate > today) return fail('El rango llega a una fecha futura.');

  if (!isHistoryObject(parsed.records)) return fail('"records" debe ser un objeto.');
  const recordsIn = toNullProtoCopy(parsed.records);
  const keys = Object.keys(recordsIn);
  if (keys.length === 0) return fail('El archivo no contiene registros.');
  if (keys.length > MAX_IMPORT_COMPLETION_DATES) {
    return fail(`Demasiados registros (máximo ${MAX_IMPORT_COMPLETION_DATES}).`);
  }

  const records = [];
  for (const key of keys.sort()) {
    const label = historyKeyLabel(key);
    const date = parseLocalDate(key);
    if (!date) return fail(`Fecha inválida: "${label}" (usá AAAA-MM-DD).`);
    if (date > today) return fail(`Fecha futura: "${label}".`);
    if (key < parsed.range.from || key > parsed.range.to) return fail(`La fecha "${label}" está fuera del rango declarado.`);

    const value = recordsIn[key];
    if (value === HISTORY_SKIP) {
      records.push({ date: key, kind: 'skip', minutes: null });
    } else if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      if (value > HISTORY_MAX_DAILY_MINUTES) {
        return fail(`"${label}": ${value} min supera las 24 horas de un día.`);
      }
      records.push({ date: key, kind: 'minutes', minutes: value });
    } else {
      return fail(`Valor inválido en "${label}": debe ser un entero de minutos (0 o más) o "SKIP".`);
    }
  }

  return {
    ok: true,
    fatal: null,
    data: { habitName: parsed.habit, from: parsed.range.from, to: parsed.range.to, records }
  };
}

// Estado que ya tiene un hábito en una fecha, sobre una foto de las cuatro
// claves. Cualquier presencia cuenta (un cero explícito también): se usa
// presencia de la clave, nunca el valor.
function readHistoryDayState(snap, habitId, date) {
  const hasQuantity = hasOwnKey(snap.quantities, date) && hasOwnKey(snap.quantities[date], habitId);
  const quantity = hasQuantity ? snap.quantities[date][habitId] : null;
  return {
    hasQuantity,
    minutes: hasQuantity && quantity && Number.isSafeInteger(quantity.actualMinutes) ? quantity.actualMinutes : null,
    skipped: hasOwnKey(snap.skips, date) && hasOwnKey(snap.skips[date], habitId),
    completed: hasOwnKey(snap.completions, date) && snap.completions[date][habitId] === true
  };
}

function isHistoryDayEmpty(dayState) {
  return !dayState.hasQuantity && !dayState.skipped && !dayState.completed;
}

function describeHistoryRecord(rec) {
  if (rec.kind === 'skip') return 'SKIP';
  return rec.minutes === 0 ? '0 min (cero explícito)' : formatMinutesText(rec.minutes);
}

function describeHistoryDayState(dayState) {
  const parts = [];
  if (dayState.hasQuantity) {
    parts.push(dayState.minutes === 0 ? '0 min (cero explícito)' : formatMinutesText(dayState.minutes === null ? 0 : dayState.minutes));
  }
  if (dayState.skipped) parts.push('SKIP');
  if (dayState.completed) parts.push('completado');
  return parts.join(' + ');
}

function historyDayMatches(rec, dayState) {
  if (rec.kind === 'minutes') {
    return dayState.hasQuantity && !dayState.skipped && !dayState.completed && dayState.minutes === rec.minutes;
  }
  return dayState.skipped && !dayState.hasQuantity && !dayState.completed;
}

// Pura: calcula qué se importaría en el hábito `habitId` sin escribir nada.
// `snap` = { habits, completions, quantities, skips }.
function planHistoryImport(data, habitId, snap) {
  const habit = Array.isArray(snap.habits) ? snap.habits.find(h => h && h.id === habitId) : null;
  if (!habit) return { ok: false, error: 'Elegí el hábito donde se van a importar los registros.' };
  if (habit.kind !== 'quantitative') return { ok: false, error: 'El hábito destino debe ser de tipo "Registrar tiempo".' };
  if (habit.archived === true) return { ok: false, error: 'El hábito destino está archivado.' };

  const counts = { total: data.records.length, positive: 0, zeros: 0, skips: 0 };
  const toImport = [];
  const conflicts = [];
  let sameCount = 0;
  let beforeCreated = 0;
  let importMinutes = 0;

  for (const rec of data.records) {
    if (rec.kind === 'skip') counts.skips++;
    else if (rec.minutes === 0) counts.zeros++;
    else counts.positive++;

    const dayState = readHistoryDayState(snap, habitId, rec.date);
    if (isHistoryDayEmpty(dayState)) {
      toImport.push(rec);
      if (rec.kind === 'minutes') importMinutes += rec.minutes;
      if (typeof habit.createdAt === 'string' && rec.date < habit.createdAt) beforeCreated++;
    } else {
      // Cualquier estado existente (minutos, cero explícito, SKIP) es un
      // conflicto y queda intacto, aunque coincida con el archivo.
      const identical = historyDayMatches(rec, dayState);
      if (identical) sameCount++;
      conflicts.push({
        date: rec.date,
        incoming: describeHistoryRecord(rec),
        existing: describeHistoryDayState(dayState),
        identical
      });
    }
  }

  // createdAt solo se mueve hacia atrás, hasta la fecha importada más antigua.
  const currentCreatedAt = typeof habit.createdAt === 'string' ? habit.createdAt : null;
  const earliest = toImport.length > 0 ? toImport[0].date : null; // records ya viene ordenado
  const newCreatedAt = earliest !== null && currentCreatedAt !== null && earliest < currentCreatedAt
    ? earliest
    : currentCreatedAt;
  return {
    ok: true,
    habitId,
    habitName: habit.name,
    from: data.from,
    to: data.to,
    counts,
    toImport,
    toImportCount: toImport.length,
    importMinutes,
    skipsToImport: toImport.filter(r => r.kind === 'skip').length,
    sameCount,
    conflicts,
    beforeCreated,
    currentCreatedAt,
    newCreatedAt,
    createdAtChanges: newCreatedAt !== currentCreatedAt,
    canApply: toImport.length > 0,
    fingerprint: JSON.stringify([habitId, toImport, conflicts.map(c => c.date), sameCount, newCreatedAt])
  };
}

function parseHistoryRaw(raw, isHabits) {
  if (raw === null) return { ok: true, value: isHabits ? [] : {} };
  try {
    const value = JSON.parse(raw);
    const valid = isHabits ? Array.isArray(value) : isHistoryObject(value);
    return valid ? { ok: true, value } : { ok: false };
  } catch (e) {
    return { ok: false };
  }
}

function sumHabitMinutes(quantities, habitId) {
  let count = 0;
  let minutes = 0;
  for (const date of Object.keys(quantities)) {
    if (hasOwnKey(quantities[date], habitId)) {
      count++;
      minutes += quantities[date][habitId].actualMinutes;
    }
  }
  return { count, minutes };
}

function sumHabitSkips(skips, habitId) {
  let count = 0;
  for (const date of Object.keys(skips)) {
    if (hasOwnKey(skips[date], habitId)) count++;
  }
  return count;
}

// Aplica el historial de forma atómica. Escribe solo las claves que cambian
// (quantities, skips y, si createdAt se adelanta, habits); completions queda
// byte a byte igual (se verifica). Usa el mismo snapshot + marcador +
// rollback que la importación de backup: el snapshot guarda las cuatro
// claves crudas (incluido createdAt dentro de habits) y ante cualquier fallo,
// también una cuota llena, se restauran tal como estaban.
function applyHistoryImport(data, habitId, expectedFingerprint) {
  const fail = (error) => ({ ok: false, error });
  if (hasStorageCorruption()) return fail('El almacenamiento está en modo solo lectura. No se importó nada.');
  if (hasPendingImportRecovery()) {
    return fail('Hay una importación reciente o sin cerrar: recargá la página y volvé a intentar. No se modificaron tus datos.');
  }

  const keys = ['habits', 'completions', 'quantities', 'skips'];
  const raws = {};
  for (const key of keys) {
    const read = readExactRaw(key);
    if (!read.ok) return fail('No se pudo leer el estado actual antes de importar. No se modificaron tus datos.');
    raws[key] = read.value;
  }
  const parsedKeys = {};
  for (const key of keys) {
    const parsed = parseHistoryRaw(raws[key], key === 'habits');
    if (!parsed.ok) return fail('Tus datos guardados no se pudieron leer con seguridad. No se importó nada.');
    parsedKeys[key] = parsed.value;
  }

  const plan = planHistoryImport(data, habitId, parsedKeys);
  if (!plan.ok) return fail(plan.error);
  if (expectedFingerprint !== undefined && plan.fingerprint !== expectedFingerprint) {
    return fail('Tus datos cambiaron desde la vista previa. No se importó nada; abrí la importación de nuevo.');
  }
  if (plan.toImport.length === 0) return fail('No hay registros nuevos para importar.');

  const nextQuantities = JSON.parse(JSON.stringify(parsedKeys.quantities));
  const nextSkips = JSON.parse(JSON.stringify(parsedKeys.skips));
  let quantitiesChanged = false;
  let skipsChanged = false;
  for (const rec of plan.toImport) {
    const occupied = hasOwnKey(nextQuantities[rec.date], habitId) || hasOwnKey(nextSkips[rec.date], habitId);
    if (occupied) return fail('Tus datos guardados cambiaron de forma inesperada. No se importó nada.');
    if (rec.kind === 'minutes') {
      if (!hasOwnKey(nextQuantities, rec.date)) nextQuantities[rec.date] = {};
      if (!isHistoryObject(nextQuantities[rec.date])) return fail('Tus datos guardados cambiaron de forma inesperada. No se importó nada.');
      nextQuantities[rec.date][habitId] = { actualMinutes: rec.minutes, plannedMinutes: null };
      quantitiesChanged = true;
    } else {
      if (!hasOwnKey(nextSkips, rec.date)) nextSkips[rec.date] = {};
      if (!isHistoryObject(nextSkips[rec.date])) return fail('Tus datos guardados cambiaron de forma inesperada. No se importó nada.');
      nextSkips[rec.date][habitId] = true;
      skipsChanged = true;
    }
  }
  let nextHabits = null;
  if (plan.createdAtChanges) {
    nextHabits = JSON.parse(JSON.stringify(parsedKeys.habits));
    nextHabits.find(h => h && h.id === habitId).createdAt = plan.newCreatedAt;
  }

  const qBefore = sumHabitMinutes(parsedKeys.quantities, habitId);
  const expectedQ = { count: qBefore.count + plan.toImport.filter(r => r.kind === 'minutes').length, minutes: qBefore.minutes + plan.importMinutes };
  const expectedSkips = sumHabitSkips(parsedKeys.skips, habitId) + plan.skipsToImport;

  const newStrings = {
    habits: nextHabits ? JSON.stringify(nextHabits) : raws.habits,
    quantities: quantitiesChanged ? JSON.stringify(nextQuantities) : raws.quantities,
    skips: skipsChanged ? JSON.stringify(nextSkips) : raws.skips
  };
  const snapshotStr = buildSnapshot(raws.habits, raws.completions, raws.quantities, raws.skips);
  const markerStr = buildMarker();
  const capacity = estimateImportCapacity(newStrings.habits || '', raws.completions || '', newStrings.quantities || '',
    newStrings.skips || '', snapshotStr, markerStr);
  if (capacity.obviouslyTooLarge) return fail('El historial es demasiado grande para el almacenamiento disponible.');

  if (!writeAndVerify(SNAPSHOT_KEY, snapshotStr)) {
    return fail('No se pudo escribir o verificar el snapshot de seguridad. No se modificaron tus datos.');
  }
  if (!writeAndVerify(MARKER_KEY, markerStr)) {
    return fail('No se pudo escribir o verificar el marcador de importación. No se modificaron tus datos. ' +
      'El snapshot de seguridad queda pendiente de limpieza en el próximo inicio.');
  }

  let writeOk = true;
  if (quantitiesChanged) writeOk = writeAndVerify('quantities', newStrings.quantities);
  if (writeOk && skipsChanged) writeOk = writeAndVerify('skips', newStrings.skips);
  if (writeOk && nextHabits) writeOk = writeAndVerify('habits', newStrings.habits);
  if (writeOk) {
    // Lo que no se escribió debe seguir idéntico (completions siempre).
    for (const key of keys) {
      if (key === 'habits' && nextHabits) continue;
      if (key === 'quantities' && quantitiesChanged) continue;
      if (key === 'skips' && skipsChanged) continue;
      const again = readExactRaw(key);
      if (!again.ok || again.value !== raws[key]) writeOk = false;
    }
  }
  if (writeOk) {
    // Verificación de totales sobre lo realmente guardado.
    const storedQ = parseHistoryRaw(readExactRaw('quantities').value, false);
    const storedS = parseHistoryRaw(readExactRaw('skips').value, false);
    const storedH = parseHistoryRaw(readExactRaw('habits').value, true);
    const afterQ = storedQ.ok ? sumHabitMinutes(storedQ.value, habitId) : null;
    const storedHabit = storedH.ok ? storedH.value.find(h => h && h.id === habitId) : null;
    writeOk = !!afterQ && afterQ.count === expectedQ.count && afterQ.minutes === expectedQ.minutes &&
      storedS.ok && sumHabitSkips(storedS.value, habitId) === expectedSkips &&
      !!storedHabit && storedHabit.createdAt === plan.newCreatedAt;
  }
  if (!writeOk) {
    return finishWithRollbackOrBlock(raws.habits, raws.completions, raws.quantities, raws.skips,
      'No se pudieron escribir o verificar los datos importados.');
  }

  let markerRemoved = false;
  try {
    localStorage.removeItem(MARKER_KEY);
    markerRemoved = localStorage.getItem(MARKER_KEY) === null;
  } catch (e) {
    markerRemoved = false;
  }
  if (!markerRemoved) {
    return finishWithRollbackOrBlock(raws.habits, raws.completions, raws.quantities, raws.skips,
      'La importación no pudo cerrarse de forma segura y fue revertida.');
  }

  loadData();
  render();
  return {
    ok: true,
    imported: plan.toImport.length,
    minutes: plan.importMinutes,
    skips: plan.skipsToImport,
    createdAt: plan.newCreatedAt,
    createdAtChanged: plan.createdAtChanges
  };
}

// ---- Interfaz: vista previa antes de aplicar. Todo dato del archivo se
// muestra con textContent, nunca con innerHTML. ----
function closeHistoryImport() {
  const container = document.getElementById('historyImport');
  container.classList.remove('active');
  container.innerHTML = '';
  document.getElementById('historyFileInput').value = '';
}

function getEligibleHistoryTargets() {
  return state.habits.filter(h => h.kind === 'quantitative' && h.archived !== true);
}

function addHistoryRow(parent, label, value) {
  const row = document.createElement('div');
  row.className = 'history-row';
  const labelEl = document.createElement('span');
  labelEl.textContent = label;
  const valueEl = document.createElement('strong');
  valueEl.textContent = String(value);
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  parent.appendChild(row);
}

const HISTORY_CONFLICTS_SHOWN = 20;

function renderHistoryPlan(box, confirmBtn, data, habitId) {
  box.innerHTML = '';
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Importar';
  confirmBtn.onclick = null;

  if (!habitId) {
    const hint = document.createElement('div');
    hint.className = 'history-note';
    hint.textContent = 'Elegí el hábito donde se van a importar los registros.';
    box.appendChild(hint);
    return;
  }
  const plan = planHistoryImport(data, habitId, {
    habits: state.habits, completions: state.completions, quantities: state.quantities, skips: state.skips
  });
  if (!plan.ok) {
    const err = document.createElement('div');
    err.className = 'import-fatal';
    err.textContent = plan.error;
    box.appendChild(err);
    return;
  }

  addHistoryRow(box, 'Hábito destino', plan.habitName);
  addHistoryRow(box, 'Rango de fechas', `${plan.from} a ${plan.to}`);
  addHistoryRow(box, 'Registros en el archivo', plan.counts.total);
  addHistoryRow(box, 'Con minutos (más de 0)', plan.counts.positive);
  addHistoryRow(box, 'Ceros explícitos', plan.counts.zeros);
  addHistoryRow(box, 'Días SKIP', plan.counts.skips);
  addHistoryRow(box, 'Nuevos para importar', `${plan.toImportCount} (${formatMinutesText(plan.importMinutes)})`);
  addHistoryRow(box, 'Conflictos (se dejan intactos)', plan.conflicts.length);
  if (plan.conflicts.length > 0) {
    addHistoryRow(box, 'De ellos, idénticos al archivo', plan.sameCount);
  }
  addHistoryRow(box, 'Fecha de creación actual del hábito', plan.currentCreatedAt || '—');
  if (plan.createdAtChanges) {
    addHistoryRow(box, 'Fecha de creación resultante', plan.newCreatedAt);
  }

  if (plan.conflicts.length > 0) {
    const title = document.createElement('div');
    title.className = 'import-warnings-title';
    title.textContent = 'Fechas que ya tienen un registro y no se modifican:';
    box.appendChild(title);
    const list = document.createElement('ul');
    list.className = 'import-warnings-list';
    plan.conflicts.slice(0, HISTORY_CONFLICTS_SHOWN).forEach(c => {
      const li = document.createElement('li');
      li.textContent = c.identical
        ? `${c.date}: ya está registrado igual que en el archivo (${c.existing})`
        : `${c.date}: el archivo dice ${c.incoming}; ahora hay ${c.existing}`;
      list.appendChild(li);
    });
    if (plan.conflicts.length > HISTORY_CONFLICTS_SHOWN) {
      const more = document.createElement('li');
      more.textContent = `y ${plan.conflicts.length - HISTORY_CONFLICTS_SHOWN} más`;
      list.appendChild(more);
    }
    box.appendChild(list);
  }

  const note = document.createElement('div');
  note.className = 'history-note';
  if (plan.toImportCount === 0) {
    note.textContent = 'No hay nada nuevo para importar.';
  } else {
    note.textContent = plan.createdAtChanges
      ? `No se modifica ningún registro existente. Al confirmar, la fecha de creación del hábito pasa de ${plan.currentCreatedAt} a ${plan.newCreatedAt} para que el historial importado cuente en las estadísticas.`
      : 'No se modifica ningún registro existente.';
  }
  box.appendChild(note);

  if (plan.canApply) {
    confirmBtn.disabled = false;
    confirmBtn.textContent = `Importar ${plan.toImportCount} registros`;
    confirmBtn.onclick = () => {
      const result = applyHistoryImport(data, habitId, plan.fingerprint);
      closeHistoryImport();
      if (result.ok) {
        alert(`Se importaron ${result.imported} registros (${formatMinutesText(result.minutes)}, ${result.skips} SKIP). No se modificó ningún registro existente.` +
          (result.createdAtChanged ? ` La fecha de creación del hábito ahora es ${result.createdAt}.` : ''));
      } else {
        alert(`No se pudo importar: ${result.error}`);
      }
    };
  }
}

function renderHistoryImport(validation) {
  const container = document.getElementById('historyImport');
  container.innerHTML = '';
  const content = document.createElement('div');
  content.className = 'modal-content';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = 'Importar historial de tiempo';
  content.appendChild(title);

  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn-secondary';
  cancelBtn.onclick = closeHistoryImport;

  const targets = validation.ok ? getEligibleHistoryTargets() : [];
  if (!validation.ok || targets.length === 0) {
    const errorP = document.createElement('div');
    errorP.className = 'import-fatal';
    errorP.textContent = validation.ok
      ? 'No hay hábitos de tipo "Registrar tiempo" activos donde importar. Creá uno primero.'
      : `No se puede importar: ${validation.fatal}`;
    content.appendChild(errorP);
    cancelBtn.textContent = 'Cerrar';
    actions.appendChild(cancelBtn);
  } else {
    const data = validation.data;
    const intro = document.createElement('div');
    intro.className = 'history-note';
    intro.textContent = `El archivo dice «${data.habitName}». Elegí a qué hábito pertenece: el nombre solo es una pista.`;
    content.appendChild(intro);

    const label = document.createElement('label');
    label.setAttribute('for', 'historyTargetSelect');
    label.textContent = 'Hábito destino';
    const select = document.createElement('select');
    select.id = 'historyTargetSelect';
    select.className = 'kind-select';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Elegí un hábito…';
    select.appendChild(placeholder);
    targets.forEach(h => {
      const option = document.createElement('option');
      option.value = h.id;
      option.textContent = `${h.icon} ${h.name}${h.name === data.habitName ? ' · coincide con el archivo' : ''}`;
      select.appendChild(option);
    });
    const group = document.createElement('div');
    group.className = 'form-group';
    group.appendChild(label);
    group.appendChild(select);
    content.appendChild(group);

    const box = document.createElement('div');
    box.className = 'history-plan';
    box.setAttribute('aria-live', 'polite');
    content.appendChild(box);

    cancelBtn.textContent = 'Cancelar';
    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'btn-primary';
    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    select.onchange = () => renderHistoryPlan(box, confirmBtn, data, select.value);
    renderHistoryPlan(box, confirmBtn, data, '');
  }

  content.appendChild(actions);
  container.appendChild(content);
  container.classList.add('active');
}

function handleHistoryFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (typeof file.size !== 'number' || file.size > HISTORY_MAX_BYTES) {
    renderHistoryImport({ ok: false, fatal: 'El archivo supera el límite de 2 MB.' });
    return;
  }
  file.text().then(rawText => {
    renderHistoryImport(validateHistoryFile(rawText));
  }).catch(() => {
    renderHistoryImport({ ok: false, fatal: 'No se pudo leer el archivo.' });
  });
}

function openHistoryImportPicker() {
  if (hasStorageCorruption()) {
    alert('El almacenamiento está en modo solo lectura; no se puede importar ahora.');
    return;
  }
  if (hasPendingImportRecovery()) {
    alert('Hay una importación reciente o sin cerrar: recargá la página antes de importar de nuevo.');
    return;
  }
  document.getElementById('historyFileInput').click();
}

// Nombres de vista en el mismo orden que las pestañas/los contenedores del
// DOM. Única fuente de verdad para traducir índice de pestaña <-> nombre.
const VIEW_NAMES = ['today', 'calendar', 'stats'];
const VIEW_IDS = ['todayView', 'calendarView', 'statsView'];

// Centinela de "Mostrar todo" en el selector de Estadísticas. Debe fallar
// isValidIdFormat() (por el '*') para que NUNCA pueda coincidir con un id
// real de hábito -- un hábito legítimo podría llamarse "__all__" si
// alguna vez se usara ese valor, ya que esa cadena sí es un id válido.
const STATS_SHOW_ALL_VALUE = '*ALL*';

// Cambia de pestaña/vista de forma programática (no solo por click directo
// en la pestaña), para que la navegación cruzada desde una tarjeta de hábito
// o desde el calendario reutilice exactamente la misma lógica que las
// pestañas, en vez de duplicarla.
function switchToView(viewName) {
  const idx = VIEW_NAMES.indexOf(viewName);
  if (idx === -1) return;

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(t => t.classList.remove('active'));
  tabs[idx].classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(VIEW_IDS[idx]).classList.add('active');
  state.currentView = viewName;

  if (viewName === 'calendar') { updateCalendarSelect(); renderCalendar(); }
  if (viewName === 'stats') { updateStatsSelect(); renderStats(); }
}

// Entradas de navegación cruzada: tocar el nombre de un hábito en "Hoy"
// abre su calendario; el enlace del calendario abre sus estadísticas.
// Ambas comparten state.selectedHabitId con los selectores de Calendario
// y Estadísticas, así la selección se preserva al navegar entre vistas.
function goToHabitCalendar(habitId) {
  state.selectedHabitId = habitId;
  switchToView('calendar');
}

function goToHabitStats(habitId) {
  state.selectedHabitId = habitId;
  state.statsShowAll = false;
  switchToView('stats');
}

// ---------------------------------------------------------------------
// Tema (Natural Linen claro / Noir Editorial oscuro)
//
// La preferencia vive en su propia clave de localStorage, fuera de las
// cuatro claves de datos: no forma parte del backup v3 ni del snapshot de
// importación. Cualquier valor desconocido o un storage que falla cae en el
// tema claro. El mismo valor lo aplica un script mínimo en <head> antes del
// primer render (para no parpadear).
// ---------------------------------------------------------------------
const THEME_KEY = 'habitTracker.theme';
const THEME_LIGHT = 'light';
const THEME_DARK = 'dark';
const THEME_COLORS = { light: '#F6F3EA', dark: '#0A0A0A' };

function readThemePreference() {
  try {
    return localStorage.getItem(THEME_KEY) === THEME_DARK ? THEME_DARK : THEME_LIGHT;
  } catch (e) {
    return THEME_LIGHT;
  }
}

function saveThemePreference(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
    return true;
  } catch (e) {
    return false;
  }
}

function applyTheme(theme) {
  const dark = theme === THEME_DARK;
  const root = document.documentElement;
  if (dark) root.setAttribute('data-theme', THEME_DARK);
  else root.removeAttribute('data-theme');

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? THEME_COLORS.dark : THEME_COLORS.light);

  // El botón dice qué tema activa al tocarlo (no el actual).
  const btn = document.getElementById('themeBtn');
  const label = document.getElementById('themeBtnLabel');
  const next = dark ? 'Natural Linen (claro)' : 'Noir Editorial (oscuro)';
  btn.setAttribute('aria-label', `Activar tema ${next}`);
  btn.setAttribute('title', `Activar tema ${next}`);
  btn.setAttribute('data-next-theme', dark ? THEME_LIGHT : THEME_DARK);
  label.textContent = dark ? 'Claro' : 'Oscuro';
}

function toggleTheme() {
  const next = readThemePreference() === THEME_DARK ? THEME_LIGHT : THEME_DARK;
  saveThemePreference(next);
  // Si el storage no deja guardar, el cambio vale igual para esta sesión.
  applyTheme(next);
}

// ---------------------------------------------------------------------
// Menú ⋮ del encabezado (Exportar / Importar backup)
//
// Solo cambia dónde viven los dos botones: las funciones que ejecutan
// (exportBackup, openImportPicker) y toda su validación quedan intactas.
// ---------------------------------------------------------------------
function getHeaderMenuItems() {
  return [document.getElementById('exportBtn'), document.getElementById('importBtn'), document.getElementById('historyBtn')];
}

function isHeaderMenuOpen() {
  return !document.getElementById('headerMenu').hidden;
}

function setHeaderMenuOpen(open, restoreFocus) {
  const menu = document.getElementById('headerMenu');
  const btn = document.getElementById('menuBtn');
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) getHeaderMenuItems()[0].focus();
  else if (restoreFocus) btn.focus();
}

function toggleHeaderMenu() {
  setHeaderMenuOpen(!isHeaderMenuOpen(), false);
}

// Teclado: Escape cierra y devuelve el foco al botón; flechas, Inicio y Fin
// recorren las opciones; Tab saca el foco del menú y lo cierra.
function handleHeaderMenuKeydown(e) {
  if (!isHeaderMenuOpen()) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    setHeaderMenuOpen(false, true);
    return;
  }
  if (e.key === 'Tab') {
    setHeaderMenuOpen(false, false);
    return;
  }
  const items = getHeaderMenuItems();
  const current = items.indexOf(e.target);
  let target = null;
  if (e.key === 'ArrowDown') target = items[(current + 1) % items.length];
  else if (e.key === 'ArrowUp') target = items[(current - 1 + items.length) % items.length];
  else if (e.key === 'Home') target = items[0];
  else if (e.key === 'End') target = items[items.length - 1];
  if (target) {
    e.preventDefault();
    target.focus();
  }
}

// Tocar o hacer clic fuera del menú lo cierra.
function handleHeaderMenuOutsideClick(e) {
  if (!isHeaderMenuOpen()) return;
  const wrap = document.getElementById('headerMenuWrap');
  if (wrap.contains(e.target)) return;
  setHeaderMenuOpen(false, false);
}

function setupHeaderControls() {
  applyTheme(readThemePreference());
  document.getElementById('themeBtn').onclick = toggleTheme;

  document.getElementById('menuBtn').onclick = toggleHeaderMenu;
  // Elegir una opción cierra el menú y ejecuta exactamente la misma acción
  // de antes.
  document.getElementById('exportBtn').onclick = () => {
    setHeaderMenuOpen(false, false);
    exportBackup();
  };
  document.getElementById('importBtn').onclick = () => {
    setHeaderMenuOpen(false, false);
    openImportPicker();
  };
  document.getElementById('historyBtn').onclick = () => {
    setHeaderMenuOpen(false, false);
    openHistoryImportPicker();
  };
  document.getElementById('historyFileInput').onchange = handleHistoryFileChange;
  document.addEventListener('keydown', handleHeaderMenuKeydown);
  document.addEventListener('click', handleHeaderMenuOutsideClick);
}

function setupEvents() {
  document.getElementById('addBtn').onclick = openModal;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('saveBtn').onclick = saveHabit;
  setupHeaderControls();
  document.getElementById('importFileInput').onchange = handleImportFileChange;

  // Construye una fecha nueva con día=1 en vez de mutar currentMonth con
  // setMonth(): si el día previo era 29/30/31, setMonth() podía "rebotar"
  // a un mes siguiente que no tiene ese día (ej. 31 ene -1 mes -> 3 mar en
  // vez de 28/29 feb), avanzando o retrocediendo más de un mes. El día
  // exacto dentro del mes no se usa para nada en renderCalendar().
  document.getElementById('prevMonth').onclick = () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() - 1, 1);
    renderCalendar();
  };
  document.getElementById('nextMonth').onclick = () => {
    state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + 1, 1);
    renderCalendar();
  };

  document.getElementById('calendarHabitSelect').onchange = (e) => {
    state.selectedHabitId = e.target.value;
    // Elegir un hábito explícito en el calendario deja de ser "mostrar
    // todo" en Estadísticas si el usuario navega ahí después.
    state.statsShowAll = false;
    // El editor de minutos abierto pertenecía al hábito anterior.
    state.calendarEditingDate = null;
    renderCalendar();
  };
  document.getElementById('calendarGoToStatsBtn').onclick = () => {
    if (state.habits.length === 0) return;
    goToHabitStats(state.selectedHabitId);
  };

  document.getElementById('statsHabitSelect').onchange = (e) => {
    if (e.target.value === STATS_SHOW_ALL_VALUE) {
      state.statsShowAll = true;
    } else {
      state.statsShowAll = false;
      state.selectedHabitId = e.target.value;
    }
    renderStats();
  };

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab, i) => {
    tab.onclick = () => switchToView(VIEW_NAMES[i]);
  });
}

function getFreqText(habit) {
  if (habit.freq === 'daily') return 'Todos los días';
  if (isLoopMonthHabit(habit)) {
    return `${habit.freqCount} de ${habit.freqWindowDays} (frecuencia original de Loop, no es mes calendario)`;
  }
  if (habit.freq === 'custom') {
    const period = habit.freqPeriod === 'week' ? 'semana' : 'mes';
    return `${habit.freqCount} veces por ${period}`;
  }
  return '';
}

// Progreso del período actual (abierto) para hábitos con frecuencia
// personalizada, ej. "2 de 3 esta semana". Los diarios no lo necesitan:
// el check de "Hoy" ya muestra su estado del día.
function getPeriodProgressText(habit, stats) {
  if (habit.freq !== 'custom' || !stats.currentPeriod || isLoopMonthHabit(habit)) return '';
  const period = habit.freqPeriod === 'week' ? 'esta semana' : 'este mes';
  return ` · ${stats.currentPeriod.count} de ${stats.currentPeriod.target} ${period}`;
}

// Banner fijo de aviso + deshabilitado del boton "+": unica fuente visible
// del modo de proteccion, gobernada por hasStorageCorruption(). No repara
// ni descarta nada -- solo informa y bloquea la entrada a mutaciones.
function renderStorageWarning() {
  const el = document.getElementById('storageWarning');
  const addBtn = document.getElementById('addBtn');
  const corrupted = hasStorageCorruption();

  addBtn.disabled = corrupted;

  if (!corrupted) {
    el.hidden = true;
    el.textContent = '';
    return;
  }

  const partes = [];
  if (state.storageHealth.habits === 'corrupt') partes.push('tus hábitos');
  if (state.storageHealth.completions === 'corrupt') partes.push('tu historial de días completados');

  el.textContent = `No se pudieron leer ${partes.join(' ni ')} guardados en este dispositivo. ` +
    'Los datos originales no fueron sobrescritos y siguen intactos. ' +
    'Mientras esto no se resuelva, la app queda temporalmente en modo solo lectura: no se puede crear, editar, eliminar ni marcar hábitos.';
  el.hidden = false;
}

function render() {
  renderStorageWarning();
  renderHabits();
  updateCalendarSelect();
  updateStatsSelect();
  if (state.currentView === 'calendar') renderCalendar();
  if (state.currentView === 'stats') renderStats();
}

// Controles de registro de minutos para un hábito cuantitativo en una
// fecha dada: resumen (minutos/objetivo), barra de progreso (limitada
// visualmente a 100%, aunque el total real puede superarlo) y los dos
// métodos de registro (incrementos +5/-5 e ingreso manual exacto).
// Reutilizado tanto en la tarjeta de "Hoy" como en el editor del
// Calendario -- misma UI, distinta fecha.
function createQuantityControls(habit, dateStr, corrupted) {
  const actual = getActualMinutes(habit.id, dateStr);
  const target = habit.target ? habit.target.minutes : null;
  const pct = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;

  const wrap = document.createElement('div');
  wrap.className = 'quantity-controls';

  const summary = document.createElement('div');
  summary.className = 'quantity-summary';
  const dayStateNow = getQuantitativeDayState(habit.id, dateStr);
  if (dayStateNow === 'skipped') {
    summary.textContent = 'Día omitido (SKIP): no suma minutos ni cuenta como cero';
  } else {
    summary.textContent = target !== null
      ? `${formatMinutesText(actual)} / ${formatMinutesText(target)}`
      : `${formatMinutesText(actual)} (sin objetivo)`;
  }
  wrap.appendChild(summary);

  if (target !== null) {
    const barOuter = document.createElement('div');
    barOuter.className = 'progress-bar';
    const barInner = document.createElement('div');
    barInner.className = 'progress-bar-fill';
    barInner.style.width = `${pct}%`;
    barOuter.appendChild(barInner);
    wrap.appendChild(barOuter);
  }

  const buttonsRow = document.createElement('div');
  buttonsRow.className = 'quantity-buttons';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'btn btn-quantity';
  minusBtn.textContent = '−5 min';
  minusBtn.disabled = corrupted;
  minusBtn.onclick = () => incrementQuantity(habit.id, dateStr, -5);

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'btn btn-quantity';
  plusBtn.textContent = '+5 min';
  plusBtn.disabled = corrupted;
  plusBtn.onclick = () => incrementQuantity(habit.id, dateStr, 5);

  buttonsRow.appendChild(minusBtn);
  buttonsRow.appendChild(plusBtn);

  // Ingreso exacto: Horas (0-24) + Minutos (0-59). Se guarda solo con el
  // botón (o Enter), nunca al salir de un campo: así no se escribe un valor
  // a medias ni se pierde el foco al pasar de Horas a Minutos.
  const split = splitMinutes(actual);
  const form = document.createElement('div');
  form.className = 'quantity-time-form';

  const makeInput = (className, value, placeholder, ariaKind) => {
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.placeholder = placeholder;
    input.className = className;
    input.value = String(value).padStart(2, '0');
    input.disabled = corrupted;
    input.setAttribute('aria-label', `${ariaKind} registradas para ${habit.name} el ${dateStr}`);
    return input;
  };
  const hoursInput = makeInput('quantity-hours-input', split.hours, 'HH', 'Horas');
  const minutesInput = makeInput('quantity-minutes-input', split.minutes, 'MM', 'Minutos');
  const separator = document.createElement('span');
  separator.className = 'quantity-time-sep';
  separator.setAttribute('aria-hidden', 'true');
  separator.textContent = ':';
  const hoursField = { input: hoursInput };
  const minutesField = { input: minutesInput };

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn btn-quantity btn-quantity-save';
  saveBtn.textContent = 'Guardar';
  saveBtn.disabled = corrupted;

  const errorBox = document.createElement('div');
  errorBox.className = 'quantity-error';
  errorBox.setAttribute('role', 'alert');
  errorBox.hidden = true;

  const submitTime = () => {
    const parsed = parseHoursMinutes(hoursField.input.value, minutesField.input.value);
    if (!parsed.ok) {
      errorBox.textContent = parsed.error;
      errorBox.hidden = false;
      hoursField.input.setAttribute('aria-invalid', 'true');
      minutesField.input.setAttribute('aria-invalid', 'true');
      return;
    }
    // Sin cambio real no se escribe nada (evita crear un 0 explícito). Un día
    // en SKIP siempre es un cambio: guardar reemplaza el SKIP por ese valor.
    if (getQuantitativeDayState(habit.id, dateStr) !== 'skipped' && parsed.total === getActualMinutes(habit.id, dateStr)) {
      errorBox.hidden = true;
      return;
    }
    setQuantityExact(habit.id, dateStr, parsed.total);
  };
  saveBtn.onclick = submitTime;
  [hoursField.input, minutesField.input].forEach(input => {
    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitTime();
      }
    };
  });

  form.appendChild(hoursInput);
  form.appendChild(separator);
  form.appendChild(minutesInput);
  form.appendChild(saveBtn);
  wrap.appendChild(form);
  wrap.appendChild(errorBox);
  wrap.appendChild(buttonsRow);

  // SKIP: día justificado, distinto de un cero. Marcarlo reemplaza los
  // minutos de ese día (se pide confirmación si había un registro).
  const skipBtn = document.createElement('button');
  skipBtn.type = 'button';
  skipBtn.className = 'btn btn-quantity btn-quantity-skip';
  skipBtn.textContent = dayStateNow === 'skipped' ? 'Quitar SKIP' : 'Omitir día (SKIP)';
  skipBtn.disabled = corrupted;
  skipBtn.onclick = () => {
    const markSkip = getQuantitativeDayState(habit.id, dateStr) !== 'skipped';
    if (markSkip && getQuantitativeDayState(habit.id, dateStr) === 'minutes' &&
        !confirm('Este día tiene un registro de tiempo. Marcarlo como SKIP lo reemplaza. ¿Continuar?')) {
      return;
    }
    setQuantitativeSkip(habit.id, dateStr, markSkip);
    render();
  };
  wrap.appendChild(skipBtn);

  return wrap;
}

// Construye la tarjeta de un hábito con DOM API segura: habit.name/icon/color
// y habit.id (dato persistido, no confiable) nunca se interpolan en innerHTML.
// El color se valida contra el formato hex antes de aplicarse a style.
// Booleano y cuantitativo comparten encabezado (nombre/ícono/editar/eliminar)
// pero difieren en el control de registro y en las estadísticas mostradas
// (Posta 3): nunca se mezcla completions con quantities para un mismo hábito.
function createHabitCard(habit, today) {
  const corrupted = hasStorageCorruption();
  const isBoolean = habit.kind === 'boolean';
  const stats = isBoolean ? calculateStats(habit) : null;

  const card = document.createElement('div');
  card.className = 'habit-card';
  if (isValidColorHex(habit.color)) card.style.borderLeftColor = habit.color;

  const header = document.createElement('div');
  header.className = 'habit-header';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'habit-icon';
  iconSpan.textContent = habit.icon;

  const info = document.createElement('div');
  info.className = 'habit-info';
  const nameDiv = document.createElement('div');
  nameDiv.className = 'habit-name habit-name-link';
  nameDiv.textContent = habit.name;
  nameDiv.setAttribute('role', 'button');
  nameDiv.tabIndex = 0;
  nameDiv.onclick = () => goToHabitCalendar(habit.id);
  nameDiv.onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goToHabitCalendar(habit.id);
    }
  };
  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = isBoolean
    ? `${getFreqText(habit)}${getPeriodProgressText(habit, stats)}`
    : getFreqText(habit);
  info.appendChild(nameDiv);
  info.appendChild(freqDiv);

  header.appendChild(iconSpan);
  header.appendChild(info);

  if (isBoolean) {
    const isCompleted = state.completions[today]?.[habit.id] || false;
    const checkBtn = document.createElement('button');
    checkBtn.className = `btn btn-check ${isCompleted ? 'completed' : ''}`;
    checkBtn.dataset.action = 'toggle';
    checkBtn.dataset.id = habit.id;
    checkBtn.dataset.date = today;
    checkBtn.disabled = corrupted;
    checkBtn.textContent = isCompleted ? '✓' : '○';
    header.appendChild(checkBtn);
  }

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-edit';
  editBtn.dataset.action = 'edit';
  editBtn.dataset.id = habit.id;
  editBtn.disabled = corrupted;
  editBtn.textContent = '🖊️';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-delete';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.dataset.id = habit.id;
  deleteBtn.disabled = corrupted;
  deleteBtn.textContent = '🗑️';

  header.appendChild(editBtn);
  header.appendChild(deleteBtn);
  card.appendChild(header);

  if (!isBoolean) {
    card.appendChild(createQuantityControls(habit, today, corrupted));
    return card;
  }

  const statsDiv = document.createElement('div');
  statsDiv.className = 'stats';
  [
    ['Tasa éxito', formatStatValue(stats.successRate, '%')],
    ['Racha', formatStatValue(stats.currentStreak)],
    ['Mejor racha', formatStatValue(stats.bestStreak)],
    ['Total', stats.totalCompleted]
  ].forEach(([label, value]) => {
    const stat = document.createElement('div');
    stat.className = 'stat';
    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-label';
    labelDiv.textContent = label;
    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-value';
    valueDiv.textContent = value;
    stat.appendChild(labelDiv);
    stat.appendChild(valueDiv);
    statsDiv.appendChild(stat);
  });

  card.appendChild(statsDiv);
  return card;
}

function renderHabits() {
  const container = document.getElementById('todayView');
  const today = getToday();

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">No tienes hábitos.<br>Presiona + para agregar uno.</div>';
    return;
  }

  // Hoy solo muestra hábitos activos; los archivados conservan su historial
  // y se consultan en Calendario y Estadísticas.
  const activeHabits = getActiveHabits();
  if (activeHabits.length === 0) {
    container.innerHTML = '<div class="empty-state">No hay hábitos activos.<br>Los hábitos archivados se consultan en Calendario y Estadísticas.</div>';
    return;
  }

  container.innerHTML = '';
  activeHabits.forEach(habit => {
    container.appendChild(createHabitCard(habit, today));
  });

  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.onclick = (e) => {
      const action = e.currentTarget.dataset.action;
      const id = e.currentTarget.dataset.id;
      if (action === 'toggle') toggleHabit(id, e.currentTarget.dataset.date);
      if (action === 'edit') editHabit(id);
      if (action === 'delete') deleteHabit(id);
    };
  });
}
// Para hábitos con frecuencia personalizada creados a mitad de una semana/mes,
// ese primer período está incompleto por construcción (menos días disponibles
// que el resto) y no debe poder contar como fallido ni como cumplido. El
// seguimiento por períodos arranca en el primer período completo posterior
// a createdAt. Para hábitos diarios no existe esta noción: cada día ya es un
// período completo, así que se cuenta desde createdAt sin ajuste.
function getFirstFullPeriodStart(habit, createdAtDate) {
  if (habit.freq !== 'custom') return createdAtDate;
  const { start, end } = getPeriodRange(habit, createdAtDate);
  if (start.getTime() === createdAtDate.getTime()) return createdAtDate;
  return addDays(end, 1);
}

// Calcula estadísticas agrupando por período (día para hábitos diarios,
// semana de lunes a domingo o mes calendario para hábitos personalizados).
// Nunca cuenta antes de habit.createdAt ni después de hoy. El período
// actual (todavía abierto) nunca rompe la racha ni cuenta en la tasa de
// éxito; su progreso se devuelve aparte en `currentPeriod`. El primer
// período parcial (si createdAt cae a mitad de semana/mes) queda fuera del
// cálculo de racha/tasa de éxito -nunca cuenta como cumplido ni fallido-,
// pero sus completions sí suman al total, y su progreso también se muestra
// en `currentPeriod` mientras ese período parcial siga en curso.
function calculateStats(habit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let createdAtDate = parseLocalDate(habit.createdAt) || today;
  if (createdAtDate > today) createdAtDate = today;

  const target = getPeriodTarget(habit);

  let totalCompleted = 0;
  let skippedDays = 0;
  for (let d = new Date(createdAtDate); d <= today; d = addDays(d, 1)) {
    const ds = toLocalDateStr(d);
    if (state.completions[ds]?.[habit.id] === true) totalCompleted++;
    else if (state.skips[ds]?.[habit.id] === true) skippedDays++;
  }

  // Frecuencia heredada de Loop (N de 30): no tiene una semántica de
  // períodos implementada y verificada en esta app. Se conserva el total y
  // los días omitidos, pero NO se inventan tasa ni rachas (null => "—").
  //
  // Hábito archivado: el contrato no tiene fecha de archivado (archivedAt),
  // así que los días posteriores al archivado contarían como fallos y la tasa
  // y las rachas decaerían con el tiempo. Se conservan los totales históricos
  // y tasa/rachas se muestran como "—" (null) hasta que exista archivedAt.
  if (isLoopMonthHabit(habit) || isArchivedHabit(habit)) {
    return {
      successRate: null,
      currentStreak: null,
      bestStreak: null,
      totalCompleted,
      skippedDays,
      currentPeriod: null,
      loopMonth: isLoopMonthHabit(habit),
      archived: isArchivedHabit(habit)
    };
  }

  const periodsStart = getFirstFullPeriodStart(habit, createdAtDate);
  const periodOrder = [];
  const periodsByKey = new Map();
  let neutralDailySkips = 0;

  if (periodsStart <= today) {
    for (let d = new Date(periodsStart); d <= today; d = addDays(d, 1)) {
      const ds = toLocalDateStr(d);
      const completed = state.completions[ds]?.[habit.id] === true;
      // SKIP es neutral: ni éxito ni fracaso. Un completado siempre tiene
      // prioridad (el contrato impide ambos a la vez).
      const skipped = !completed && state.skips[ds]?.[habit.id] === true;

      // Hábito diario: un día omitido no forma período (no suma a la tasa,
      // no corta ni extiende la racha).
      if (skipped && habit.freq !== 'custom') {
        neutralDailySkips++;
        continue;
      }

      const key = getPeriodKey(habit, d);
      if (!periodsByKey.has(key)) {
        const { start, end } = getPeriodRange(habit, d);
        periodsByKey.set(key, { start, end, count: 0, skips: 0 });
        periodOrder.push(key);
      }
      if (completed) periodsByKey.get(key).count++;
      if (skipped) periodsByKey.get(key).skips++;
    }
  }

  // Un período semanal/mensual con días omitidos que no alcanzó el objetivo
  // es NEUTRAL: no se puede saber si lo habría cumplido, así que no cuenta
  // como fallido ni como cumplido, y no rompe la racha. Si ya alcanzó el
  // objetivo, se cumple igual (un skip no puede quitarle el éxito).
  const periods = periodOrder.map(key => {
    const p = periodsByKey.get(key);
    const met = p.count >= target;
    return { ...p, met, neutral: !met && p.skips > 0, closed: p.end < today };
  });

  const closedPeriods = periods.filter(p => p.closed);
  const scoredPeriods = closedPeriods.filter(p => !p.neutral);
  // Sin períodos puntuables por culpa de los neutrales: no hay tasa que
  // mostrar ("—"), nunca un 0 % engañoso. Sin skips el resultado no cambia.
  const successRate = scoredPeriods.length
    ? Math.round((scoredPeriods.filter(p => p.met).length / scoredPeriods.length) * 100)
    : ((closedPeriods.length > 0 || neutralDailySkips > 0) ? null : 0);

  let tempStreak = 0;
  let bestStreak = 0;
  closedPeriods.forEach(p => {
    if (p.neutral) return;
    tempStreak = p.met ? tempStreak + 1 : 0;
    bestStreak = Math.max(bestStreak, tempStreak);
  });

  let currentStreak = tempStreak;
  const currentPeriod = periods.length ? periods[periods.length - 1] : null;
  const currentPeriodOpen = currentPeriod ? !currentPeriod.closed : false;
  if (currentPeriodOpen && currentPeriod.met) {
    currentStreak += 1;
    bestStreak = Math.max(bestStreak, currentStreak);
  }

  // Progreso del primer período parcial (createdAt cae a mitad de semana/mes):
  // no forma parte de `periods`, así que nunca se evalúa como cumplido/fallido
  // ni afecta racha o tasa de éxito, pero se expone igual para mostrar "X de Y"
  // mientras ese período parcial sigue en curso (equivale al total acumulado,
  // ya que todavía no pasó ningún período completo).
  const partialPeriodProgress = periodsStart > today ? { count: totalCompleted, target } : null;

  return {
    successRate,
    currentStreak,
    bestStreak,
    totalCompleted,
    skippedDays,
    currentPeriod: currentPeriodOpen ? { count: currentPeriod.count, target } : partialPeriodProgress
  };
}

function toggleHabit(id, date) {
  if (hasStorageCorruption()) return;
  // Sin interfaz de hábitos cuantitativos todavía: un hábito no-booleano
  // (ej. importado de un backup v2) nunca puede marcarse completado por
  // esta vía -- evita contaminar `completions` con una referencia a un
  // hábito que no es de ese tipo, lo que bloquearía un export futuro.
  const habit = state.habits.find(h => h.id === id);
  if (!habit || habit.kind !== 'boolean') return;
  if (!state.completions[date]) state.completions[date] = {};
  state.completions[date][id] = !state.completions[date][id];
  if (state.completions[date][id] === true) clearSkip(date, id);
  saveData();
  render();
}

// Invariante v3: una fecha/hábito nunca está a la vez completada y omitida.
// Marcar completado reemplaza el skip (decisión explícita, no silenciosa
// para el modelo: el usuario eligió "completado" sobre ese día).
function clearSkip(dateStr, habitId) {
  const entry = state.skips[dateStr];
  if (!entry || typeof entry !== 'object') return;
  delete entry[habitId];
  if (Object.keys(entry).length === 0) delete state.skips[dateStr];
}

function clearCompletion(dateStr, habitId) {
  const entry = state.completions[dateStr];
  if (!entry || typeof entry !== 'object') return;
  delete entry[habitId];
  if (Object.keys(entry).length === 0) delete state.completions[dateStr];
}

// Ciclo de tres estados del Calendario para hábitos booleanos:
//   sin registro -> completado -> SKIP -> sin registro.
// Un día con completion Y skip a la vez (dato inconsistente) se lee como
// completado, y el siguiente paso del ciclo lo deja solo en SKIP.
const BOOLEAN_DAY_STATES = ['none', 'completed', 'skipped'];

function getBooleanDayState(habitId, dateStr) {
  if (state.completions[dateStr]?.[habitId] === true) return 'completed';
  if (state.skips[dateStr]?.[habitId] === true) return 'skipped';
  return 'none';
}

function getNextBooleanDayState(current) {
  const i = BOOLEAN_DAY_STATES.indexOf(current);
  return BOOLEAN_DAY_STATES[(i + 1) % BOOLEAN_DAY_STATES.length];
}

// Aplica un estado a una fecha manteniendo la invariante: nunca completion
// y skip a la vez. 'none' elimina ambos registros (no deja un false).
function applyBooleanDayState(habitId, dateStr, newState) {
  if (newState === 'completed') {
    if (!state.completions[dateStr]) state.completions[dateStr] = {};
    state.completions[dateStr][habitId] = true;
    clearSkip(dateStr, habitId);
  } else if (newState === 'skipped') {
    clearCompletion(dateStr, habitId);
    if (!state.skips[dateStr]) state.skips[dateStr] = {};
    state.skips[dateStr][habitId] = true;
  } else {
    clearCompletion(dateStr, habitId);
    clearSkip(dateStr, habitId);
  }
}

// Avanza un paso el ciclo de un día. Valida antes de tocar nada: almacenamiento
// sano, hábito booleano existente, fecha real, no futura y no anterior a
// createdAt. Persiste con saveData(); si la persistencia falla, revierte el
// estado en memoria y no deja la fecha a medias.
function cycleBooleanDay(habitId, dateStr) {
  if (hasStorageCorruption()) return { ok: false, reason: 'storage-corrupted' };
  const habit = state.habits.find(h => h.id === habitId);
  if (!habit) return { ok: false, reason: 'unknown-habit' };
  if (habit.kind !== 'boolean') return { ok: false, reason: 'not-boolean' };
  const date = typeof dateStr === 'string' ? parseLocalDate(dateStr) : null;
  if (!date) return { ok: false, reason: 'invalid-date' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (date > today) return { ok: false, reason: 'future-date' };
  // Cualquier fecha pasada o actual es editable, también las anteriores a
  // createdAt (esas no cuentan en las estadísticas, pero se conservan y se
  // pueden corregir). Solo se rechazan las futuras.

  const previous = getBooleanDayState(habitId, dateStr);
  const hadCompletion = state.completions[dateStr]?.[habitId];
  const hadSkip = state.skips[dateStr]?.[habitId];
  const next = getNextBooleanDayState(previous);
  applyBooleanDayState(habitId, dateStr, next);
  let saved;
  try {
    saved = saveData();
  } catch (e) {
    saved = { ok: false, reason: 'storage-error' };
  }
  if (!saved.ok) {
    // Rollback en memoria al estado exacto anterior.
    clearCompletion(dateStr, habitId);
    clearSkip(dateStr, habitId);
    if (hadCompletion !== undefined) {
      if (!state.completions[dateStr]) state.completions[dateStr] = {};
      state.completions[dateStr][habitId] = hadCompletion;
    }
    if (hadSkip !== undefined) {
      if (!state.skips[dateStr]) state.skips[dateStr] = {};
      state.skips[dateStr][habitId] = hadSkip;
    }
    // Mejor esfuerzo: si saveData() alcanzó a escribir alguna clave antes de
    // fallar, vuelve a dejar el almacenamiento igual a la memoria revertida.
    try { saveData(); } catch (e) { /* queda para el próximo guardado */ }
    return { ok: false, reason: saved.reason || 'storage-error' };
  }
  return { ok: true, previous, state: next };
}

// ¿Se puede editar esta fecha en el Calendario? Misma regla que cycleBooleanDay
// y que el editor de minutos: fecha real y no futura (las anteriores a
// createdAt también se pueden registrar y corregir).
function isCalendarDateEditable(habit, dateStr) {
  const date = parseLocalDate(dateStr);
  if (!date || !habit) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date <= today;
}

// Día anterior a la creación del hábito: editable, pero fuera de las
// estadísticas (que nunca cuentan antes de createdAt).
function isBeforeCreated(habit, dateStr) {
  return !!habit && typeof habit.createdAt === 'string' && dateStr < habit.createdAt;
}

const BOOLEAN_DAY_STATE_LABELS = { none: 'sin registro', completed: 'completado', skipped: 'omitido (SKIP)' };
const BOOLEAN_DAY_ACTION_LABELS = {
  completed: 'marcar como completado',
  skipped: 'marcar como omitido',
  none: 'quitar el registro'
};

// Etiqueta accesible de una celda booleana: estado actual y qué hará el toque.
function getBooleanDayAriaLabel(habit, dateStr) {
  const day = Number(dateStr.slice(8, 10));
  const current = getBooleanDayState(habit.id, dateStr);
  let label = `${day}, ${BOOLEAN_DAY_STATE_LABELS[current]}`;
  if (isCalendarDateEditable(habit, dateStr)) {
    label += `. Tocar para ${BOOLEAN_DAY_ACTION_LABELS[getNextBooleanDayState(current)]}`;
    if (isBeforeCreated(habit, dateStr)) label += '. Anterior a la creación del hábito: no cuenta en las estadísticas';
  } else {
    label += '. No editable';
  }
  return label;
}

function deleteHabit(id) {
  if (hasStorageCorruption()) return;
  if (!confirm('¿Eliminar este hábito?')) return;
  state.habits = state.habits.filter(h => h.id !== id);

  for (const day in state.completions) {
    if (state.completions[day] && typeof state.completions[day] === 'object') {
      delete state.completions[day][id];
    }
  }
  for (const day in state.quantities) {
    if (state.quantities[day] && typeof state.quantities[day] === 'object') {
      delete state.quantities[day][id];
    }
  }
  for (const day in state.skips) {
    if (state.skips[day] && typeof state.skips[day] === 'object') {
      delete state.skips[day][id];
    }
  }

  saveData();
  render();
}

function editHabit(id) {
  const habit = state.habits.find(h => h.id === id);
  if (!habit) return;

  state.editingId = id;
  document.getElementById('modalTitle').textContent = 'Editar Hábito';
  document.getElementById('habitName').value = habit.name;
  state.selectedIcon = habit.icon;
  state.selectedColor = habit.color;
  state.selectedFreq = habit.freq;
  // freqCount viene de localStorage (no confiable): un valor que no sea un
  // entero 1-30 no entra al estado del modal. El registro guardado no se
  // toca hasta que el usuario guarde (y saveHabit lo vuelve a validar).
  state.freqCount = isValidFreqCount(habit.freqCount) ? habit.freqCount : 7;
  state.freqPeriod = habit.freqPeriod || 'week';
  state.selectedKind = habit.kind;
  state.selectedTargetMinutes = (habit.kind === 'quantitative' && habit.target) ? habit.target.minutes : null;

  renderModalContent();
  document.getElementById('modal').classList.add('active');
}

function openModal() {
  state.editingId = null;
  document.getElementById('modalTitle').textContent = 'Nuevo Hábito';
  document.getElementById('habitName').value = '';
  state.selectedIcon = ICONS[0];
  state.selectedColor = COLORS[0];
  state.selectedFreq = 'daily';
  state.freqCount = 7;
  state.freqPeriod = 'week';
  state.selectedKind = 'boolean';
  state.selectedTargetMinutes = null;

  renderModalContent();
  document.getElementById('modal').classList.add('active');
}

function renderModalContent() {
  document.getElementById('iconGrid').innerHTML = ICONS.map(icon =>
    `<button type="button" class="icon-btn ${icon === state.selectedIcon ? 'selected' : ''}" data-icon="${icon}">${icon}</button>`
  ).join('');

  document.querySelectorAll('.icon-btn').forEach(btn => {
    btn.onclick = () => {
      state.selectedIcon = btn.dataset.icon;
      renderModalContent();
    };
  });

  document.getElementById('colorGrid').innerHTML = COLORS.map(color =>
    `<button type="button" class="color-btn ${color === state.selectedColor ? 'selected' : ''}" style="background: ${color}" data-color="${color}"></button>`
  ).join('');

  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.onclick = () => {
      state.selectedColor = btn.dataset.color;
      renderModalContent();
    };
  });

  // Frecuencia heredada de Loop (N de 30): el modal no puede representarla ni
  // editarla; se muestra fija (solo lectura) y se conserva intacta al guardar
  // (ver resolveFrequencyForSave).
  const lockedFreq = !!state.editingId && state.freqPeriod === LOOP_MONTH_PERIOD;
  const freqGroup = document.getElementById('freqOptions');
  if (lockedFreq) {
    const editingHabit = state.habits.find(h => h.id === state.editingId);
    freqGroup.innerHTML = '';
    const fixed = document.createElement('div');
    fixed.className = 'freq-option selected freq-readonly';
    fixed.textContent = editingHabit ? getFreqText(editingHabit) : '';
    const fixedNote = document.createElement('div');
    fixedNote.className = 'kind-readonly-note';
    fixedNote.textContent = 'Esta frecuencia viene de Loop y no se puede editar; se conserva tal cual.';
    freqGroup.appendChild(fixed);
    freqGroup.appendChild(fixedNote);
  } else {
    // Solo un entero llega al atributo value; cualquier otra cosa queda vacía.
    const freqCountAttr = Number.isInteger(state.freqCount) ? String(state.freqCount) : '';
    freqGroup.innerHTML = `
<div class="freq-option ${state.selectedFreq === 'daily' ? 'selected' : ''}" data-freq="daily">
<strong>Todos los días</strong>
</div>
<div class="freq-option ${state.selectedFreq === 'custom' ? 'selected' : ''}" data-freq="custom">
<strong>Personalizado</strong>
${state.selectedFreq === 'custom' ? `
<div class="freq-details">
<input type="number" min="1" max="30" value="${freqCountAttr}" id="freqCountInput">
<span>veces por</span>
<select id="freqPeriodInput">
<option value="week" ${state.freqPeriod === 'week' ? 'selected' : ''}>semana</option>
<option value="month" ${state.freqPeriod === 'month' ? 'selected' : ''}>mes</option>
</select>
</div>
` : ''}
</div>
`;

    document.querySelectorAll('.freq-option').forEach(opt => {
      opt.onclick = () => {
        state.selectedFreq = opt.dataset.freq;
        renderModalContent();
      };
    });
  }

  if (!lockedFreq && state.selectedFreq === 'custom') {
    document.getElementById('freqCountInput').onchange = (e) => {
      state.freqCount = parseInt(e.target.value || '1', 10);
    };
    document.getElementById('freqPeriodInput').onchange = (e) => {
      state.freqPeriod = e.target.value;
    };
  }

  // Tipo (Posta 3): solo seleccionable al CREAR. Al editar, se muestra
  // fijo y sin handler de click -- el tipo de un hábito existente nunca
  // puede cambiarse desde esta UI (ver resolveHabitKindForSave()).
  const kindGroup = document.getElementById('kindOptions');
  kindGroup.innerHTML = '';
  const kindSelect = document.createElement('select');
  kindSelect.id = 'kindSelect';
  kindSelect.className = 'kind-select';
  kindSelect.setAttribute('aria-describedby', 'kindHelp');
  HABIT_KIND_CHOICES.forEach(choice => {
    const option = document.createElement('option');
    option.value = choice.kind;
    option.textContent = choice.label;
    kindSelect.appendChild(option);
  });
  kindSelect.value = state.selectedKind;
  const kindHelp = document.createElement('div');
  kindHelp.id = 'kindHelp';
  kindHelp.className = 'kind-help';
  kindHelp.textContent = getHabitKindChoice(state.selectedKind).help;
  kindGroup.appendChild(kindSelect);
  kindGroup.appendChild(kindHelp);
  if (state.editingId) {
    kindSelect.disabled = true;
    const note = document.createElement('div');
    note.className = 'kind-readonly-note';
    note.textContent = 'Esta forma de registro no se puede cambiar una vez creado el hábito.';
    kindGroup.appendChild(note);
  } else {
    kindSelect.onchange = () => {
      state.selectedKind = getHabitKindChoice(kindSelect.value).kind;
      renderModalContent();
    };
  }

  const targetGroup = document.getElementById('targetGroup');
  if (state.selectedKind === 'quantitative') {
    targetGroup.hidden = false;
    const targetInput = document.getElementById('targetMinutesInput');
    targetInput.value = state.selectedTargetMinutes === null ? '' : String(state.selectedTargetMinutes);
    targetInput.onchange = (e) => {
      const raw = e.target.value.trim();
      if (raw === '') { state.selectedTargetMinutes = null; return; }
      const num = Number(raw);
      state.selectedTargetMinutes = (Number.isInteger(num) && num >= 1) ? num : null;
    };
  } else {
    targetGroup.hidden = true;
  }
}

// Formas de registro que ve el usuario. Los valores internos siguen siendo
// los tipos persistidos ('boolean' / 'quantitative'); esos términos técnicos
// no se muestran en el formulario.
const HABIT_KIND_CHOICES = [
  { kind: 'boolean', label: 'Marcar como completado', help: 'Cada día marcás si cumpliste tu hábito.' },
  { kind: 'quantitative', label: 'Registrar tiempo', help: 'Anotá las horas y minutos que le dedicaste.' }
];

function getHabitKindChoice(kind) {
  return HABIT_KIND_CHOICES.find(c => c.kind === kind) || HABIT_KIND_CHOICES[0];
}

function closeModal() {
  document.getElementById('modal').classList.remove('active');
}

function saveHabit() {
  if (hasStorageCorruption()) return;
  const name = document.getElementById('habitName').value.trim();

  if (!isValidUiName(name)) {
    alert(name.length === 0 ? 'Ingresa un nombre' : 'El nombre no puede superar 200 caracteres');
    return;
  }
  if (!isValidFreq(state.selectedFreq)) { alert('Frecuencia inválida'); return; }
  if (!isValidFreqPeriod(state.freqPeriod)) { alert('Período de frecuencia inválido'); return; }
  if (!isValidFreqCount(state.freqCount)) {
    alert('La frecuencia personalizada debe ser un número entero entre 1 y 30');
    return;
  }
  if (!isValidIcon(state.selectedIcon)) { alert('Ícono inválido'); return; }
  if (!isValidColorHex(state.selectedColor)) { alert('Color inválido'); return; }

  const existing = state.editingId ? state.habits.find(h => h.id === state.editingId) : null;

  // kind SIEMPRE se resuelve vía resolveHabitKindForSave(): al editar, es
  // el del hábito existente, nunca el de la UI -- el tipo de un hábito no
  // puede cambiar una vez creado (Posta 3).
  const kind = resolveHabitKindForSave(existing, state.selectedKind);
  if (!isValidKind(kind)) { alert('Tipo de hábito inválido'); return; }

  // La frecuencia y el estado archivado de un hábito existente nunca se
  // pierden al editarlo (Backup v3): el modal no puede representar 'loop-month'
  // ni archivado, así que se conservan vía resolvers puros.
  const habit = {
    id: state.editingId || generateHabitId(),
    name,
    icon: state.selectedIcon,
    color: state.selectedColor,
    ...resolveFrequencyForSave(existing, {
      freq: state.selectedFreq,
      freqCount: state.freqCount,
      freqPeriod: state.freqPeriod
    }),
    createdAt: existing ? existing.createdAt : getToday(),
    kind,
    archived: resolveArchivedForSave(existing)
  };

  if (kind === 'quantitative') {
    habit.unit = 'minutes';
    habit.target = resolveQuantitativeTarget(state.selectedTargetMinutes);
    if (!isValidUnit(habit.unit)) { alert('Unidad inválida'); return; }
    if (!isValidTarget(habit.target)) {
      alert('Objetivo diario inválido (debe ser un entero mayor o igual a 1, o quedar vacío).');
      return;
    }
  }

  if (state.editingId) {
    const index = state.habits.findIndex(h => h.id === state.editingId);
    state.habits[index] = habit;
  } else {
    state.habits.push(habit);
  }

  saveData();
  closeModal();
  render();
}

// Si el hábito seleccionado ya no existe (eliminado) o todavía no hay
// ninguno elegido, cae de forma determinística al primero disponible.
// Única función que decide ese fallback -- la consultan tanto el selector
// de Calendario como el de Estadísticas, para no duplicar el criterio.
function ensureSelectedHabitId() {
  if (state.habits.length === 0) {
    state.selectedHabitId = null;
    return;
  }
  if (!state.selectedHabitId || !state.habits.some(h => h.id === state.selectedHabitId)) {
    // Primero un activo si hay; si todos están archivados, el primero.
    state.selectedHabitId = getHabitsForHistory()[0].id;
  }
}

function updateCalendarSelect() {
  const select = document.getElementById('calendarHabitSelect');
  const goToStatsBtn = document.getElementById('calendarGoToStatsBtn');
  ensureSelectedHabitId();

  select.innerHTML = '';
  getHabitsForHistory().forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.icon} ${getHabitDisplayName(h)}`;
    select.appendChild(option);
  });

  if (state.selectedHabitId) select.value = state.selectedHabitId;
  goToStatsBtn.disabled = state.habits.length === 0;
}

function updateStatsSelect() {
  const select = document.getElementById('statsHabitSelect');
  ensureSelectedHabitId();

  select.innerHTML = '';
  if (state.habits.length === 0) return;

  getHabitsForHistory().forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.icon} ${getHabitDisplayName(h)}`;
    select.appendChild(option);
  });
  const allOption = document.createElement('option');
  allOption.value = STATS_SHOW_ALL_VALUE;
  allOption.textContent = 'Mostrar todo';
  select.appendChild(allOption);

  select.value = state.statsShowAll ? STATS_SHOW_ALL_VALUE : state.selectedHabitId;
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');

  if (state.habits.length === 0) {
    grid.innerHTML = '<div class="calendar-empty">Agrega un hábito primero</div>';
    return;
  }

  const habitId = state.selectedHabitId;
  const habit = state.habits.find(h => h.id === habitId);
  const year = state.currentMonth.getFullYear();
  const month = state.currentMonth.getMonth();

  const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDay = firstDay.getDay();
  const daysInMonth = lastDay.getDate();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let html = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    .map(d => `<div class="calendar-day-header">${d}</div>`)
    .join('');

  const prevMonth = new Date(year, month, 0);
  const prevMonthDays = prevMonth.getDate();

  for (let i = startDay - 1; i >= 0; i--) {
    const day = prevMonthDays - i;
    const date = new Date(year, month - 1, day);
    const dateStr = toLocalDateStr(date);
    const isFuture = date > today;
    const deco = getCalendarDayDecoration(dateStr, habit);

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${deco.stateClass}" data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}"><span class="calendar-day-num">${day}</span>${deco.badgeHtml}</div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = toLocalDateStr(date);
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;
    const deco = getCalendarDayDecoration(dateStr, habit);

    html += `<div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''} ${deco.stateClass}"
data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}"><span class="calendar-day-num">${day}</span>${deco.badgeHtml}</div>`;
  }

  const remainingDays = 42 - (startDay + daysInMonth);
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day);
    const dateStr = toLocalDateStr(date);
    const isFuture = date > today;
    const deco = getCalendarDayDecoration(dateStr, habit);

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${deco.stateClass}"
data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}"><span class="calendar-day-num">${day}</span>${deco.badgeHtml}</div>`;
  }

  grid.innerHTML = html;

  // habitId sale de habit.id (dato persistido, no confiable): se asigna acá
  // por property assignment (dataset), nunca interpolado en el template de
  // arriba, para no exponer una superficie de inyección de atributos.
  document.querySelectorAll('.calendar-day').forEach(cell => {
    cell.dataset.habit = habitId;
    // Los estados (completado, minutos, SKIP) se pintan solo con clases CSS:
    // paleta fija con contraste verificado, sin colores inline por hábito.
    const onCellActivate = () => {
      if (hasStorageCorruption()) return;
      if (cell.dataset.future === 'true') return;
      const dateStr = cell.dataset.date;
      const hid = cell.dataset.habit;

      if (habit.kind === 'quantitative') {
        // Abre (o cambia) el editor de minutos para esta fecha puntual.
        // No modifica ninguna otra fecha ni ningún otro hábito.
        state.calendarEditingDate = dateStr;
        renderCalendar();
        return;
      }
      if (habit.kind !== 'boolean') return;
      // Ciclo sin registro -> completado -> SKIP -> sin registro, con las
      // validaciones de fecha (real, no futura, no anterior a createdAt).
      const result = cycleBooleanDay(hid, dateStr);
      if (!result.ok) return;
      renderCalendar();
      renderHabits();
      renderStats();
    };
    cell.onclick = onCellActivate;

    // Accesibilidad de las celdas editables: botón con foco de teclado
    // (Enter o espacio). En hábitos booleanos la etiqueta dice el estado
    // actual y qué hará el toque.
    const editable = cell.dataset.future !== 'true' && isCalendarDateEditable(habit, cell.dataset.date);
    if (habit.kind === 'boolean') {
      cell.setAttribute('aria-label', getBooleanDayAriaLabel(habit, cell.dataset.date));
    }
    if (editable && (habit.kind === 'boolean' || habit.kind === 'quantitative')) {
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      cell.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onCellActivate();
        }
      };
    }
    // Anterior a la creación: editable, solo con un tono propio (no cuenta
    // en las estadísticas). Las futuras ya tienen su estilo.
    if (editable && isBeforeCreated(habit, cell.dataset.date)) {
      cell.classList.add('before-created');
    }
  });

  // Leyenda del ciclo: solo para hábitos booleanos (los cuantitativos editan
  // minutos y no usan estos estados).
  const legend = document.getElementById('calendarLegend');
  if (legend) legend.hidden = !(habit && habit.kind === 'boolean');

  renderCalendarQuantityEditor(habit && habit.kind === 'quantitative' ? habit : null, state.calendarEditingDate);
}

// Decoración visual de una celda del calendario. Booleano usa completions
// (cumplido/no cumplido); cuantitativo usa quantities (minutos
// registrados vs. objetivo) -- nunca se mezclan ambas fuentes para el
// mismo hábito.
function getCalendarDayDecoration(dateStr, habit) {
  if (!habit) return { stateClass: '', badgeHtml: '', ariaExtra: '' };

  if (habit.kind === 'quantitative') {
    // Cuatro estados distinguibles: ausencia (celda neutra), cero explícito
    // ("0"), minutos (tiempo) y SKIP (↷, borde punteado).
    const dayState = getQuantitativeDayState(habit.id, dateStr);
    if (dayState === 'none') return { stateClass: '', badgeHtml: '', ariaExtra: '' };
    if (dayState === 'skipped') {
      return {
        stateClass: 'skipped',
        badgeHtml: '<span class="calendar-day-check" aria-hidden="true">↷</span>',
        ariaExtra: ', omitido'
      };
    }
    const actual = getActualMinutes(habit.id, dateStr);
    if (actual === 0) {
      return {
        stateClass: 'quantity-zero',
        badgeHtml: '<span class="calendar-day-check calendar-day-qty" aria-hidden="true">0</span>',
        ariaExtra: ', cero minutos registrados'
      };
    }
    const target = habit.target ? habit.target.minutes : null;
    const met = target !== null && actual >= target;
    return {
      stateClass: met ? 'quantity-met' : 'quantity-partial',
      badgeHtml: `<span class="calendar-day-check calendar-day-qty" aria-hidden="true">${formatMinutesCompact(actual)}</span>`,
      ariaExtra: met ? ', objetivo cumplido' : ', con minutos registrados'
    };
  }

  const isCompleted = state.completions[dateStr]?.[habit.id];
  // SKIP (neutral): se muestra distinto de completado y de día sin registro.
  // Un completado siempre tiene prioridad (el contrato impide ambos a la vez).
  if (!isCompleted && state.skips[dateStr]?.[habit.id] === true) {
    return {
      stateClass: 'skipped',
      badgeHtml: '<span class="calendar-day-check" aria-hidden="true">↷</span>',
      ariaExtra: ', omitido'
    };
  }
  return {
    stateClass: isCompleted ? 'completed' : '',
    badgeHtml: isCompleted ? '<span class="calendar-day-check" aria-hidden="true">✓</span>' : '',
    ariaExtra: isCompleted ? ', completado' : ''
  };
}

// Editor inline de minutos para una fecha puntual del Calendario (hábito
// cuantitativo seleccionado). Reutiliza createQuantityControls() tal cual
// se usa en la vista Hoy, solo que con la fecha elegida en vez de hoy.
function renderCalendarQuantityEditor(habit, dateStr) {
  const container = document.getElementById('calendarQuantityEditor');
  if (!habit || !dateStr) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'quantity-editor-title';
  title.textContent = `Editar minutos — ${dateStr}`;
  container.appendChild(title);
  container.appendChild(createQuantityControls(habit, dateStr, hasStorageCorruption()));
}

// Estadísticas de un hábito cuantitativo: minutos registrados hoy,
// objetivo, progreso del día y acumulado histórico. Nunca mezcla minutos
// con cantidad de hábitos completados -- ese concepto (racha, tasa de
// éxito por período) es exclusivo de calculateStats()/hábitos booleanos.
function calculateQuantityStats(habit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let createdAtDate = parseLocalDate(habit.createdAt) || today;
  if (createdAtDate > today) createdAtDate = today;

  const target = habit.target ? habit.target.minutes : null;
  let totalMinutes = 0;
  let skippedDays = 0;

  // SKIP es neutral: no suma minutos, no cuenta como cero y no entra en
  // ningún promedio. Los hábitos de tiempo no tienen tasa ni rachas por
  // período (solo minutos), así que no hay nada más que proteger.
  for (let d = new Date(createdAtDate); d <= today; d = addDays(d, 1)) {
    const ds = toLocalDateStr(d);
    if (getQuantitativeDayState(habit.id, ds) === 'skipped') skippedDays++;
    else totalMinutes += getActualMinutes(habit.id, ds);
  }

  const todayMinutes = getActualMinutes(habit.id, getToday());
  const todaySkipped = getQuantitativeDayState(habit.id, getToday()) === 'skipped';
  const todayProgressPct = target !== null && !todaySkipped
    ? Math.min(100, Math.round((todayMinutes / target) * 100))
    : null;

  return { totalMinutes, todayMinutes, target, todayProgressPct, skippedDays, todaySkipped };
}

// Gráfico de "Últimos 30 días": hoy y los 29 anteriores, en orden
// cronológico. Mismo criterio diario que usaba el gráfico de 7 días: un día
// booleano es completado / SKIP / sin registro y un día de tiempo son sus
// minutos registrados; no infiere períodos ni métricas (frecuencias
// semanales, loop-month y archivados muestran solo el dato diario). Un día
// anterior a createdAt sin ningún registro se marca como "antes de crear".
const CHART_DAYS = 30;
const CHART_TICK_INDEXES = [0, 7, 14, 21, CHART_DAYS - 1];
const CHART_MONTH_ABBR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

function getChartDays(habit, count = CHART_DAYS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDateStr(d);
    const entry = { dateStr, day: d.getDate(), month: d.getMonth(), isToday: i === 0 };
    if (habit.kind === 'quantitative') {
      entry.value = getActualMinutes(habit.id, dateStr);
      const hasQuantity = hasOwnKey(state.quantities[dateStr], habit.id);
      // SKIP es un estado distinto de un cero explícito; con un registro de
      // minutos (dato inconsistente) manda el registro.
      entry.skipped = !hasQuantity && state.skips[dateStr]?.[habit.id] === true;
      entry.hasRecord = hasQuantity || entry.skipped;
    } else {
      const done = !!state.completions[dateStr]?.[habit.id];
      entry.value = done ? 1 : 0;
      // SKIP se distingue de un día sin registro.
      entry.skipped = !done && state.skips[dateStr]?.[habit.id] === true;
      entry.hasRecord = done || entry.skipped;
    }
    entry.beforeCreated = !entry.hasRecord && typeof habit.createdAt === 'string' && dateStr < habit.createdAt;
    days.push(entry);
  }
  return days;
}

function describeChartDay(habit, day) {
  const date = `${day.day} de ${CHART_MONTH_ABBR[day.month]}`;
  if (habit.kind === 'quantitative') {
    if (day.skipped) return `${date}: omitido (SKIP)`;
    if (day.hasRecord || day.value > 0) return `${date}: ${formatMinutesText(day.value)}`;
    return `${date}: ${day.beforeCreated ? 'antes de crear el hábito' : 'sin registro'}`;
  }
  if (day.skipped) return `${date}: omitido (SKIP)`;
  if (day.value === 1) return `${date}: completado`;
  return `${date}: ${day.beforeCreated ? 'antes de crear el hábito' : 'sin registro'}`;
}

// Resumen para lectores de pantalla: el gráfico entero es una imagen con
// descripción; el detalle por día queda en el tooltip de cada barra.
function summarizeChartDays(habit, days) {
  if (habit.kind === 'quantitative') {
    const total = days.reduce((sum, d) => sum + d.value, 0);
    const withTime = days.filter(d => d.value > 0).length;
    const skippedQ = days.filter(d => d.skipped).length;
    const skipText = skippedQ > 0 ? `, ${skippedQ} ${skippedQ === 1 ? 'omitido' : 'omitidos'} (SKIP)` : '';
    return `Últimos ${days.length} días: ${withTime} ${withTime === 1 ? 'día' : 'días'} con tiempo registrado, ${formatMinutesText(total)} en total${skipText}.`;
  }
  const done = days.filter(d => d.value === 1).length;
  const skipped = days.filter(d => d.skipped).length;
  return `Últimos ${days.length} días: ${done} ${done === 1 ? 'día completado' : 'días completados'}, ${skipped} ${skipped === 1 ? 'omitido' : 'omitidos'} (SKIP).`;
}

function createLastDaysChart(habit) {
  const days = getChartDays(habit);
  const chart = document.createElement('div');
  chart.className = 'chart';
  const chartTitle = document.createElement('div');
  chartTitle.className = 'chart-title';
  chartTitle.textContent = `Últimos ${CHART_DAYS} días`;
  const chartBars = document.createElement('div');
  chartBars.className = 'chart-bars chart-bars-30';
  chartBars.setAttribute('role', 'img');
  chartBars.setAttribute('aria-label', summarizeChartDays(habit, days));

  const scaleBase = habit.kind === 'quantitative'
    ? ((habit.target && habit.target.minutes) || Math.max(1, ...days.map(d => d.value)))
    : 1;

  days.forEach((day, index) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-bar-wrapper';
    wrapper.title = describeChartDay(habit, day);
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    if (day.skipped) {
      bar.style.height = '30%';
      bar.classList.add('chart-bar-skipped');
    } else if (day.value > 0) {
      bar.style.height = `${Math.min(100, Math.round((day.value / scaleBase) * 100))}%`;
    } else {
      bar.style.height = '0%';
      bar.classList.add(day.beforeCreated ? 'chart-bar-na' : 'chart-bar-empty');
    }
    if (day.isToday) wrapper.classList.add('chart-bar-today');
    const track = document.createElement('div');
    track.className = 'chart-bar-track';
    track.appendChild(bar);
    wrapper.appendChild(track);
    const label = document.createElement('div');
    label.className = 'chart-label';
    if (CHART_TICK_INDEXES.includes(index)) {
      label.classList.add('chart-tick');
      if (index === 0) label.classList.add('chart-tick-first');
      if (index === days.length - 1) label.classList.add('chart-tick-last');
      label.textContent = day.isToday ? 'Hoy' : `${day.day} ${CHART_MONTH_ABBR[day.month]}`;
    }
    wrapper.appendChild(label);
    chartBars.appendChild(wrapper);
  });

  chart.appendChild(chartTitle);
  chart.appendChild(chartBars);
  return chart;
}

// habit.name/icon/color son datos persistidos, no confiables: se asignan vía
// textContent/property, nunca interpolados en innerHTML. color se valida
// contra el formato hex antes de aplicarse a cualquier style.
function createQuantityStatsCard(habit) {
  const stats = calculateQuantityStats(habit);
  const safeColor = isValidColorHex(habit.color) ? habit.color : null;

  const card = document.createElement('div');
  card.className = 'stats-card';
  if (safeColor) card.style.borderLeftColor = safeColor;

  const header = document.createElement('div');
  header.className = 'stats-header';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'habit-icon';
  iconSpan.textContent = habit.icon;
  const titleSpan = document.createElement('span');
  titleSpan.className = 'stats-title';
  titleSpan.textContent = getHabitDisplayName(habit);
  header.appendChild(iconSpan);
  header.appendChild(titleSpan);

  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = getFreqText(habit);

  const numbersDiv = document.createElement('div');
  numbersDiv.className = 'stats-numbers';
  [
    [stats.todaySkipped ? 'Omitido' : formatMinutesText(stats.todayMinutes), 'Tiempo hoy'],
    [stats.target !== null ? formatMinutesText(stats.target) : 'Sin objetivo', 'Objetivo diario'],
    [stats.todayProgressPct !== null ? `${stats.todayProgressPct}%` : '—', 'Progreso hoy'],
    [formatMinutesText(stats.totalMinutes), 'Total acumulado'],
    [String(stats.skippedDays), 'Días omitidos (SKIP)']
  ].forEach(([value, label]) => {
    const box = document.createElement('div');
    box.className = 'stat-box';
    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-box-value';
    valueDiv.textContent = value;
    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-box-label';
    labelDiv.textContent = label;
    box.appendChild(valueDiv);
    box.appendChild(labelDiv);
    numbersDiv.appendChild(box);
  });

  const chart = createLastDaysChart(habit);

  card.appendChild(header);
  card.appendChild(freqDiv);
  card.appendChild(numbersDiv);
  card.appendChild(chart);
  return card;
}

function createStatsCard(habit) {
  if (habit.kind === 'quantitative') return createQuantityStatsCard(habit);
  const stats = calculateStats(habit);
  const safeColor = isValidColorHex(habit.color) ? habit.color : null;

  const card = document.createElement('div');
  card.className = 'stats-card';
  if (safeColor) card.style.borderLeftColor = safeColor;

  const header = document.createElement('div');
  header.className = 'stats-header';
  const iconSpan = document.createElement('span');
  iconSpan.className = 'habit-icon';
  iconSpan.textContent = habit.icon;
  const titleSpan = document.createElement('span');
  titleSpan.className = 'stats-title';
  titleSpan.textContent = getHabitDisplayName(habit);
  header.appendChild(iconSpan);
  header.appendChild(titleSpan);

  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = `${getFreqText(habit)}${getPeriodProgressText(habit, stats)}`;

  const numbersDiv = document.createElement('div');
  numbersDiv.className = 'stats-numbers';
  [
    [formatStatValue(stats.successRate, '%'), 'Tasa de éxito'],
    [formatStatValue(stats.currentStreak), 'Racha actual'],
    [formatStatValue(stats.bestStreak), 'Mejor racha'],
    [stats.totalCompleted, 'Total completados'],
    [stats.skippedDays, 'Días omitidos (SKIP)']
  ].forEach(([value, label]) => {
    const box = document.createElement('div');
    box.className = 'stat-box';
    const valueDiv = document.createElement('div');
    valueDiv.className = 'stat-box-value';
    valueDiv.textContent = value;
    const labelDiv = document.createElement('div');
    labelDiv.className = 'stat-box-label';
    labelDiv.textContent = label;
    box.appendChild(valueDiv);
    box.appendChild(labelDiv);
    numbersDiv.appendChild(box);
  });

  const chart = createLastDaysChart(habit);

  card.appendChild(header);
  card.appendChild(freqDiv);
  card.appendChild(numbersDiv);
  if (stats.loopMonth) {
    const note = document.createElement('div');
    note.className = 'stats-note';
    note.textContent = 'Frecuencia original de Loop: no se calcula como mes calendario, por eso no hay tasa ni racha (—).';
    card.appendChild(note);
  }
  if (stats.archived) {
    const note = document.createElement('div');
    note.className = 'stats-note';
    note.textContent = 'Hábito archivado: sin fecha de archivado no se calculan tasa ni rachas (—); los totales históricos se conservan.';
    card.appendChild(note);
  }
  card.appendChild(chart);
  return card;
}

function renderStats() {
  const container = document.getElementById('statsCardsContainer');

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">Agrega hábitos para ver estadísticas</div>';
    return;
  }

  // Por defecto, un único hábito (el seleccionado); "Mostrar todo" es la
  // única forma de ver todas las tarjetas a la vez -- nunca el default.
  const habitsToShow = state.statsShowAll
    ? getHabitsForHistory()
    : state.habits.filter(h => h.id === state.selectedHabitId);

  container.innerHTML = '';
  habitsToShow.forEach(habit => {
    container.appendChild(createStatsCard(habit));
  });
}

init();
