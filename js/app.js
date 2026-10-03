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
  selectedIcon: ICONS[0],
  selectedColor: COLORS[0],
  selectedFreq: 'daily',
  freqCount: 7,
  freqPeriod: 'week',
  currentMonth: new Date(),
  editingId: null,
  currentView: 'today',
  storageHealth: { habits: 'missing', completions: 'missing' }
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
  return state.storageHealth.habits === 'corrupt' || state.storageHealth.completions === 'corrupt';
}

function loadData() {
  // Se reconstruye TODO desde cero en cada llamada real -- datos y salud --
  // para que una clave hoy ausente nunca arrastre memoria de una carga
  // anterior, y reload/loadData repetido sea deterministico.
  state.habits = [];
  state.completions = {};
  state.storageHealth = { habits: 'missing', completions: 'missing' };

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

  state.habits = state.habits.map(hb => ({
    freq: 'daily',
    freqCount: 7,
    freqPeriod: 'week',
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
const VALID_FREQ_PERIOD = ['week', 'month'];

function isValidFreq(freq) {
  return VALID_FREQ.includes(freq);
}

function isValidFreqPeriod(freqPeriod) {
  return VALID_FREQ_PERIOD.includes(freqPeriod);
}

function isValidFreqCount(n) {
  return Number.isInteger(n) && n >= 1 && n <= 30;
}

function isValidIcon(icon) {
  return BACKUP_V1_ICONS.includes(icon);
}

function isValidColorHex(color) {
  return typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color);
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
// Backup v1 antes de exportar. Nunca repara, trunca ni normaliza el dato
// inválido -- solo lo reporta y aborta. Las únicas normalizaciones
// permitidas (completions false y fechas vacías) ocurren después, en
// buildBackupV1(), nunca acá.
function validateExportState() {
  if (hasStorageCorruption()) {
    return { ok: false, error: 'No se puede exportar mientras los datos guardados estén dañados.' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const seenIds = new Set();

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

    const createdAtDate = parseLocalDate(habit.createdAt);
    if (!createdAtDate) {
      return { ok: false, error: `${label}: fecha de creación inválida.` };
    }
    if (createdAtDate > today) {
      return { ok: false, error: `${label}: fecha de creación futura.` };
    }
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
      // Solo las entradas true sobreviven al export (ver buildBackupV1);
      // una entrada true que referencia un hábito inexistente sería
      // exportada como dato incoherente, así que se trata como fatal.
      // Una entrada false huérfana nunca llega al export, así que no
      // bloquea el preflight.
      if (entry[habitId] === true && !seenIds.has(habitId)) {
        return { ok: false, error: `Completado huérfano: "${dateKey}" referencia un hábito inexistente.` };
      }
    }
  }

  return { ok: true };
}

// Pura: asume que validateExportState() ya dio ok. Construye el objeto
// final campo por campo (nunca copia el hábito vivo completo por spread),
// para que ninguna propiedad extra accidental llegue al backup.
function buildBackupV1() {
  const habits = state.habits.map(h => ({
    id: h.id,
    name: h.name,
    icon: h.icon,
    color: h.color,
    freq: h.freq,
    freqCount: h.freqCount,
    freqPeriod: h.freqPeriod,
    createdAt: h.createdAt
  }));

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

  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    habits,
    completions
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

  const backup = buildBackupV1();
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

  const ALLOWED_ROOT = ['schemaVersion', 'exportedAt', 'habits', 'completions'];
  const rootKeys = Object.keys(parsed);
  const unknownRoot = rootKeys.filter(k => !ALLOWED_ROOT.includes(k));
  if (unknownRoot.length > 0) return fail(`Campo desconocido en la raíz: "${unknownRoot[0]}".`);
  for (const k of ALLOWED_ROOT) {
    if (!(k in parsed)) return fail(`Falta el campo raíz "${k}".`);
  }

  if (parsed.schemaVersion !== 1) return fail('schemaVersion no es 1.');
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

  const ALLOWED_HABIT = ['id', 'name', 'icon', 'color', 'freq', 'freqCount', 'freqPeriod', 'createdAt'];
  const seenIds = new Set();
  const validHabits = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < parsed.habits.length; i++) {
    const habit = parsed.habits[i];
    const label = `hábito #${i + 1}`;
    if (!habit || typeof habit !== 'object' || Array.isArray(habit)) return fail(`${label}: registro inválido.`);

    const habitKeys = Object.keys(habit);
    const unknownHabit = habitKeys.filter(k => !ALLOWED_HABIT.includes(k));
    if (unknownHabit.length > 0) return fail(`${label}: campo desconocido "${unknownHabit[0]}".`);
    for (const k of ALLOWED_HABIT) {
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
    if (!isValidFreqPeriod(habit.freqPeriod)) return fail(`${label}: período de frecuencia inválido.`);
    if (!isValidFreqCount(habit.freqCount)) return fail(`${label}: cantidad de frecuencia inválida (1 a 30).`);

    const createdAtDate = parseLocalDate(habit.createdAt);
    if (!createdAtDate) return fail(`${label}: fecha de creación inválida.`);
    if (createdAtDate > today) return fail(`${label}: fecha de creación futura.`);

    seenIds.add(habit.id);
    validHabits.push({
      id: habit.id, name: habit.name, icon: habit.icon, color: habit.color,
      freq: habit.freq, freqCount: habit.freqCount, freqPeriod: habit.freqPeriod,
      createdAt: habit.createdAt
    });
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

  return {
    ok: true,
    fatal: null,
    warnings,
    summary: {
      habitsCount: validHabits.length,
      completionDatesCount: Object.keys(outCompletions).length,
      trueEntriesCount: trueCount,
      exportedAt: parsed.exportedAt
    },
    data: { schemaVersion: 1, exportedAt: parsed.exportedAt, habits: validHabits, completions: outCompletions }
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

// Verificación estructural post-escritura: excepción de lectura = fallo de
// verificación (no éxito ambiguo), dispara el mismo camino de rollback que
// una discrepancia real de contenido.
function verifyStructuralWrite(newHabitsStr, newCompletionsStr) {
  try {
    return localStorage.getItem('habits') === newHabitsStr &&
      localStorage.getItem('completions') === newCompletionsStr &&
      isStructurallyValidHabitsJson(localStorage.getItem('habits')) &&
      isStructurallyValidCompletionsJson(localStorage.getItem('completions'));
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

// Restaura AMBAS claves como una sola unidad lógica.
function restoreExactRaw(habitsRaw, completionsRaw) {
  const habitsOk = restoreOneKey('habits', habitsRaw);
  const completionsOk = restoreOneKey('completions', completionsRaw);
  return { verified: habitsOk && completionsOk };
}

function buildSnapshot(habitsRaw, completionsRaw) {
  return JSON.stringify({
    snapshotVersion: 1,
    createdAt: new Date().toISOString(),
    habitsRaw: habitsRaw,
    completionsRaw: completionsRaw
  });
}

function buildMarker() {
  return JSON.stringify({ stateVersion: 1, startedAt: new Date().toISOString() });
}

function parseSnapshotShape(raw) {
  if (typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.snapshotVersion !== 1) return null;
  if (typeof parsed.createdAt !== 'string' || isNaN(Date.parse(parsed.createdAt))) return null;
  if (!(parsed.habitsRaw === null || typeof parsed.habitsRaw === 'string')) return null;
  if (!(parsed.completionsRaw === null || typeof parsed.completionsRaw === 'string')) return null;
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
function estimateImportCapacity(newHabitsStr, newCompletionsStr, snapshotStr, markerStr) {
  const TYPICAL_ORIGIN_QUOTA = 5 * 1024 * 1024;
  const estimatedBytes = utf8ByteLength(newHabitsStr) + utf8ByteLength(newCompletionsStr) +
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
  const habitsRawRead = readExactRaw('habits');
  const completionsRawRead = readExactRaw('completions');
  if (!habitsRawRead.ok || !completionsRawRead.ok) {
    return { ok: false, error: 'No se pudo leer el estado actual antes de importar. No se modificaron tus datos.' };
  }
  const habitsRaw = habitsRawRead.value;
  const completionsRaw = completionsRawRead.value;
  const snapshotStr = buildSnapshot(habitsRaw, completionsRaw);
  const markerStr = buildMarker();

  const capacity = estimateImportCapacity(newHabitsStr, newCompletionsStr, snapshotStr, markerStr);
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
  const structuralOk = habitsWriteOk && completionsWriteOk && verifyStructuralWrite(newHabitsStr, newCompletionsStr);

  if (!structuralOk) {
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, 'No se pudieron escribir o verificar los datos importados.');
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
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, 'La importación no pudo cerrarse de forma segura y fue revertida.');
  }

  // Éxito real. El snapshot se conserva para cleanup en el próximo
  // startup limpio (estado B), igual que 4.1 hace con storageHealth.
  loadData();
  render();
  return { ok: true };
}

function finishWithRollbackOrBlock(habitsRaw, completionsRaw, publicMessage) {
  const restore = restoreExactRaw(habitsRaw, completionsRaw);
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

  const restore = restoreExactRaw(snapshot.habitsRaw, snapshot.completionsRaw);
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
    summary.textContent = `${validation.summary.habitsCount} hábitos, ` +
      `${validation.summary.completionDatesCount} fechas con completados, ` +
      `${validation.summary.trueEntriesCount} registros completados en total. ` +
      `Exportado: ${validation.summary.exportedAt}.`;
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

function setupEvents() {
  document.getElementById('addBtn').onclick = openModal;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('saveBtn').onclick = saveHabit;
  document.getElementById('exportBtn').onclick = exportBackup;
  document.getElementById('importBtn').onclick = openImportPicker;
  document.getElementById('importFileInput').onchange = handleImportFileChange;

  document.getElementById('prevMonth').onclick = () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
    renderCalendar();
  };
  document.getElementById('nextMonth').onclick = () => {
    state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
    renderCalendar();
  };

  document.getElementById('calendarHabitSelect').onchange = renderCalendar;

  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((tab, i) => {
    tab.onclick = () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      const views = ['todayView', 'calendarView', 'statsView'];
      document.getElementById(views[i]).classList.add('active');
      state.currentView = ['today', 'calendar', 'stats'][i];
      if (state.currentView === 'calendar') renderCalendar();
      if (state.currentView === 'stats') renderStats();
    };
  });
}

function getFreqText(habit) {
  if (habit.freq === 'daily') return 'Todos los días';
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
  if (habit.freq !== 'custom' || !stats.currentPeriod) return '';
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
  if (state.currentView === 'calendar') renderCalendar();
  if (state.currentView === 'stats') renderStats();
}

// Construye la tarjeta de un hábito con DOM API segura: habit.name/icon/color
// y habit.id (dato persistido, no confiable) nunca se interpolan en innerHTML.
// El color se valida contra el formato hex antes de aplicarse a style.
function createHabitCard(habit, today) {
  const isCompleted = state.completions[today]?.[habit.id] || false;
  const stats = calculateStats(habit);
  const corrupted = hasStorageCorruption();

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
  nameDiv.className = 'habit-name';
  nameDiv.textContent = habit.name;
  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = `${getFreqText(habit)}${getPeriodProgressText(habit, stats)}`;
  info.appendChild(nameDiv);
  info.appendChild(freqDiv);

  const checkBtn = document.createElement('button');
  checkBtn.className = `btn btn-check ${isCompleted ? 'completed' : ''}`;
  checkBtn.dataset.action = 'toggle';
  checkBtn.dataset.id = habit.id;
  checkBtn.dataset.date = today;
  checkBtn.disabled = corrupted;
  checkBtn.textContent = isCompleted ? '✓' : '○';

  const editBtn = document.createElement('button');
  editBtn.className = 'btn btn-edit';
  editBtn.dataset.action = 'edit';
  editBtn.dataset.id = habit.id;
  editBtn.disabled = corrupted;
  editBtn.textContent = '✏️';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn btn-delete';
  deleteBtn.dataset.action = 'delete';
  deleteBtn.dataset.id = habit.id;
  deleteBtn.disabled = corrupted;
  deleteBtn.textContent = '🗑️';

  header.appendChild(iconSpan);
  header.appendChild(info);
  header.appendChild(checkBtn);
  header.appendChild(editBtn);
  header.appendChild(deleteBtn);

  const statsDiv = document.createElement('div');
  statsDiv.className = 'stats';
  [
    ['Tasa éxito', `${stats.successRate}%`],
    ['Racha', stats.currentStreak],
    ['Mejor racha', stats.bestStreak],
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

  card.appendChild(header);
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

  container.innerHTML = '';
  state.habits.forEach(habit => {
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
  for (let d = new Date(createdAtDate); d <= today; d = addDays(d, 1)) {
    if (state.completions[toLocalDateStr(d)]?.[habit.id] === true) totalCompleted++;
  }

  const periodsStart = getFirstFullPeriodStart(habit, createdAtDate);
  const periodOrder = [];
  const periodsByKey = new Map();

  if (periodsStart <= today) {
    for (let d = new Date(periodsStart); d <= today; d = addDays(d, 1)) {
      const ds = toLocalDateStr(d);
      const completed = state.completions[ds]?.[habit.id] === true;

      const key = getPeriodKey(habit, d);
      if (!periodsByKey.has(key)) {
        const { start, end } = getPeriodRange(habit, d);
        periodsByKey.set(key, { start, end, count: 0 });
        periodOrder.push(key);
      }
      if (completed) periodsByKey.get(key).count++;
    }
  }

  const periods = periodOrder.map(key => {
    const p = periodsByKey.get(key);
    return { ...p, met: p.count >= target, closed: p.end < today };
  });

  const closedPeriods = periods.filter(p => p.closed);
  const successRate = closedPeriods.length
    ? Math.round((closedPeriods.filter(p => p.met).length / closedPeriods.length) * 100)
    : 0;

  let tempStreak = 0;
  let bestStreak = 0;
  closedPeriods.forEach(p => {
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
    currentPeriod: currentPeriodOpen ? { count: currentPeriod.count, target } : partialPeriodProgress
  };
}

function toggleHabit(id, date) {
  if (hasStorageCorruption()) return;
  if (!state.completions[date]) state.completions[date] = {};
  state.completions[date][id] = !state.completions[date][id];
  saveData();
  render();
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
  state.freqCount = habit.freqCount || 7;
  state.freqPeriod = habit.freqPeriod || 'week';

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

  document.getElementById('freqOptions').innerHTML = `
<div class="freq-option ${state.selectedFreq === 'daily' ? 'selected' : ''}" data-freq="daily">
<strong>Todos los días</strong>
</div>
<div class="freq-option ${state.selectedFreq === 'custom' ? 'selected' : ''}" data-freq="custom">
<strong>Personalizado</strong>
${state.selectedFreq === 'custom' ? `
<div class="freq-details">
<input type="number" min="1" max="30" value="${state.freqCount}" id="freqCountInput">
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

  if (state.selectedFreq === 'custom') {
    document.getElementById('freqCountInput').onchange = (e) => {
      state.freqCount = parseInt(e.target.value || '1', 10);
    };
    document.getElementById('freqPeriodInput').onchange = (e) => {
      state.freqPeriod = e.target.value;
    };
  }
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

  const habit = {
    id: state.editingId || generateHabitId(),
    name,
    icon: state.selectedIcon,
    color: state.selectedColor,
    freq: state.selectedFreq,
    freqCount: state.freqCount,
    freqPeriod: state.freqPeriod,
    createdAt: existing ? existing.createdAt : getToday()
  };

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

function updateCalendarSelect() {
  const select = document.getElementById('calendarHabitSelect');
  const prev = select.value;

  select.innerHTML = '';
  state.habits.forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.icon} ${h.name}`;
    select.appendChild(option);
  });

  if (prev && state.habits.some(h => h.id === prev)) {
    select.value = prev;
  }
}

function renderCalendar() {
  const grid = document.getElementById('calendarGrid');

  if (state.habits.length === 0) {
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">Agrega un hábito primero</div>';
    return;
  }

  const habitId = document.getElementById('calendarHabitSelect').value;
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
    const isCompleted = state.completions[dateStr]?.[habitId];
    const isFuture = date > today;

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}" data-date="${dateStr}" data-future="${isFuture}">${day}</div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = toLocalDateStr(date);
    const isCompleted = state.completions[dateStr]?.[habitId];
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;

    html += `<div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}"
data-date="${dateStr}" data-future="${isFuture}">${day}</div>`;
  }

  const remainingDays = 42 - (startDay + daysInMonth);
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day);
    const dateStr = toLocalDateStr(date);
    const isCompleted = state.completions[dateStr]?.[habitId];
    const isFuture = date > today;

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}"
data-date="${dateStr}" data-future="${isFuture}">${day}</div>`;
  }

  grid.innerHTML = html;

  // habitId sale de habit.id (dato persistido, no confiable): se asigna acá
  // por property assignment (dataset), nunca interpolado en el template de
  // arriba, para no exponer una superficie de inyección de atributos.
  document.querySelectorAll('.calendar-day').forEach(cell => {
    cell.dataset.habit = habitId;
    cell.onclick = () => {
      if (hasStorageCorruption()) return;
      if (cell.dataset.future === 'true') return;
      const dateStr = cell.dataset.date;
      const hid = cell.dataset.habit;
      if (!state.completions[dateStr]) state.completions[dateStr] = {};
      state.completions[dateStr][hid] = !state.completions[dateStr][hid];
      saveData();
      renderCalendar();
      renderHabits();
      renderStats();
    };
  });
}

// habit.name/icon/color son datos persistidos, no confiables: se asignan vía
// textContent/property, nunca interpolados en innerHTML. color se valida
// contra el formato hex antes de aplicarse a cualquier style.
function createStatsCard(habit) {
  const stats = calculateStats(habit);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = toLocalDateStr(d);
    const dayName = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()];
    last7Days.push({
      label: dayName,
      value: state.completions[dateStr]?.[habit.id] ? 1 : 0
    });
  }

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
  titleSpan.textContent = habit.name;
  header.appendChild(iconSpan);
  header.appendChild(titleSpan);

  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = `${getFreqText(habit)}${getPeriodProgressText(habit, stats)}`;

  const numbersDiv = document.createElement('div');
  numbersDiv.className = 'stats-numbers';
  [
    [`${stats.successRate}%`, 'Tasa de éxito'],
    [stats.currentStreak, 'Racha actual'],
    [stats.bestStreak, 'Mejor racha'],
    [stats.totalCompleted, 'Total completados']
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

  const chart = document.createElement('div');
  chart.className = 'chart';
  const chartTitle = document.createElement('div');
  chartTitle.className = 'chart-title';
  chartTitle.textContent = 'Últimos 7 días';
  const chartBars = document.createElement('div');
  chartBars.className = 'chart-bars';

  last7Days.forEach(day => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-bar-wrapper';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${day.value * 100}%`;
    if (safeColor) bar.style.background = safeColor;
    const label = document.createElement('div');
    label.className = 'chart-label';
    label.textContent = day.label;
    wrapper.appendChild(bar);
    wrapper.appendChild(label);
    chartBars.appendChild(wrapper);
  });

  chart.appendChild(chartTitle);
  chart.appendChild(chartBars);

  card.appendChild(header);
  card.appendChild(freqDiv);
  card.appendChild(numbersDiv);
  card.appendChild(chart);
  return card;
}

function renderStats() {
  const container = document.getElementById('statsView');

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">Agrega hábitos para ver estadísticas</div>';
    return;
  }

  container.innerHTML = '';
  state.habits.forEach(habit => {
    container.appendChild(createStatsCard(habit));
  });
}

init();
