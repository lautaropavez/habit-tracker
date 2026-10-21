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
  selectedIcon: ICONS[0],
  selectedColor: COLORS[0],
  selectedFreq: 'daily',
  freqCount: 7,
  freqPeriod: 'week',
  currentMonth: new Date(),
  editingId: null,
  currentView: 'today',
  storageHealth: { habits: 'missing', completions: 'missing', quantities: 'missing' },
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
    state.storageHealth.quantities === 'corrupt';
}

function loadData() {
  // Se reconstruye TODO desde cero en cada llamada real -- datos y salud --
  // para que una clave hoy ausente nunca arrastre memoria de una carga
  // anterior, y reload/loadData repetido sea deterministico.
  state.habits = [];
  state.completions = {};
  state.quantities = {};
  state.storageHealth = { habits: 'missing', completions: 'missing', quantities: 'missing' };

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

  // Backup v2: todo hábito sin `kind` explícito (legado v1) se normaliza
  // como booleano -- decisión humana, ver docs/ROADMAP.md, sección
  // "Backup v2". Solo rellena el default si `kind` está ausente; nunca
  // sobreescribe un `kind` ya presente.
  state.habits = state.habits.map(hb => ({
    freq: 'daily',
    freqCount: 7,
    freqPeriod: 'week',
    kind: 'boolean',
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
// ausencia != 0 explícito -- ver buildBackupV2). Para la UI en vivo, "no
// hay registro todavía" y "0 minutos" se muestran igual: 0.
function getActualMinutes(habitId, dateStr) {
  const entry = state.quantities[dateStr];
  return (entry && entry[habitId]) ? entry[habitId].actualMinutes : 0;
}

function getPlannedMinutes(habitId, dateStr) {
  const entry = state.quantities[dateStr];
  return (entry && entry[habitId]) ? entry[habitId].plannedMinutes : null;
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
  if (!state.quantities[dateStr]) state.quantities[dateStr] = {};
  state.quantities[dateStr][habitId] = { actualMinutes: newActualMinutes, plannedMinutes };
  saveData();
  return true;
}

// Incremento rápido (+5/-5 min). El piso es 0: nunca permite cantidades
// negativas, sin importar cuántas veces se presione "-5 min".
function incrementQuantity(habitId, dateStr, deltaMinutes) {
  const current = getActualMinutes(habitId, dateStr);
  writeActualMinutes(habitId, dateStr, Math.max(0, current + deltaMinutes));
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
// buildBackupV2(), nunca acá.
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
      // Solo las entradas true sobreviven al export (ver buildBackupV2);
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

  return { ok: true };
}

// Pura: asume que validateExportState() ya dio ok. Construye el objeto
// final campo por campo (nunca copia el hábito vivo completo por spread),
// para que ninguna propiedad extra accidental llegue al backup.
function buildBackupV2() {
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
      kind: h.kind
    };
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

  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    habits,
    completions,
    quantities
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

  const backup = buildBackupV2();
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

  if (parsed.schemaVersion !== 1 && parsed.schemaVersion !== 2) {
    return fail('schemaVersion no es 1 ni 2.');
  }
  const schemaVersion = parsed.schemaVersion;

  const ALLOWED_ROOT = schemaVersion === 1
    ? ['schemaVersion', 'exportedAt', 'habits', 'completions']
    : ['schemaVersion', 'exportedAt', 'habits', 'completions', 'quantities'];
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
  if (schemaVersion === 2) {
    if (!parsed.quantities || typeof parsed.quantities !== 'object' || Array.isArray(parsed.quantities)) {
      return fail('"quantities" debe ser un objeto.');
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
    if (schemaVersion === 2) {
      if (!isValidKind(habit.kind)) return fail(`${label}: tipo (kind) inválido.`);
      kind = habit.kind;
      allowedHabitFields = kind === 'quantitative'
        ? [...BASE_HABIT_FIELDS, 'kind', 'unit', 'target']
        : [...BASE_HABIT_FIELDS, 'kind'];
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
    if (!isValidFreqPeriod(habit.freqPeriod)) return fail(`${label}: período de frecuencia inválido.`);
    if (!isValidFreqCount(habit.freqCount)) return fail(`${label}: cantidad de frecuencia inválida (1 a 30).`);

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
      createdAt: habit.createdAt, kind
    };
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
  if (schemaVersion === 2) {
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

  // Normalización interna: toda importación exitosa (v1 o v2) produce
  // datos ya en forma v2 (decisión humana) -- v1 se trata como v2 con
  // quantities vacío y todo hábito kind="boolean".
  return {
    ok: true,
    fatal: null,
    warnings,
    summary: {
      habitsCount: validHabits.length,
      completionDatesCount: Object.keys(outCompletions).length,
      trueEntriesCount: trueCount,
      quantityDatesCount: Object.keys(outQuantities).length,
      exportedAt: parsed.exportedAt
    },
    data: {
      schemaVersion: 2,
      exportedAt: parsed.exportedAt,
      habits: validHabits,
      completions: outCompletions,
      quantities: outQuantities
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

// Verificación estructural post-escritura: excepción de lectura = fallo de
// verificación (no éxito ambiguo), dispara el mismo camino de rollback que
// una discrepancia real de contenido.
function verifyStructuralWrite(newHabitsStr, newCompletionsStr, newQuantitiesStr) {
  try {
    return localStorage.getItem('habits') === newHabitsStr &&
      localStorage.getItem('completions') === newCompletionsStr &&
      localStorage.getItem('quantities') === newQuantitiesStr &&
      isStructurallyValidHabitsJson(localStorage.getItem('habits')) &&
      isStructurallyValidCompletionsJson(localStorage.getItem('completions')) &&
      isStructurallyValidQuantitiesJson(localStorage.getItem('quantities'));
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

// Restaura las TRES claves como una sola unidad lógica.
function restoreExactRaw(habitsRaw, completionsRaw, quantitiesRaw) {
  const habitsOk = restoreOneKey('habits', habitsRaw);
  const completionsOk = restoreOneKey('completions', completionsRaw);
  const quantitiesOk = restoreOneKey('quantities', quantitiesRaw);
  return { verified: habitsOk && completionsOk && quantitiesOk };
}

function buildSnapshot(habitsRaw, completionsRaw, quantitiesRaw) {
  return JSON.stringify({
    snapshotVersion: 2,
    createdAt: new Date().toISOString(),
    habitsRaw: habitsRaw,
    completionsRaw: completionsRaw,
    quantitiesRaw: quantitiesRaw
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
  if (parsed.snapshotVersion !== 2) return null;
  if (typeof parsed.createdAt !== 'string' || isNaN(Date.parse(parsed.createdAt))) return null;
  if (!(parsed.habitsRaw === null || typeof parsed.habitsRaw === 'string')) return null;
  if (!(parsed.completionsRaw === null || typeof parsed.completionsRaw === 'string')) return null;
  if (!(parsed.quantitiesRaw === null || typeof parsed.quantitiesRaw === 'string')) return null;
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
function estimateImportCapacity(newHabitsStr, newCompletionsStr, newQuantitiesStr, snapshotStr, markerStr) {
  const TYPICAL_ORIGIN_QUOTA = 5 * 1024 * 1024;
  const estimatedBytes = utf8ByteLength(newHabitsStr) + utf8ByteLength(newCompletionsStr) +
    utf8ByteLength(newQuantitiesStr) + utf8ByteLength(snapshotStr) + utf8ByteLength(markerStr);
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
  const habitsRawRead = readExactRaw('habits');
  const completionsRawRead = readExactRaw('completions');
  const quantitiesRawRead = readExactRaw('quantities');
  if (!habitsRawRead.ok || !completionsRawRead.ok || !quantitiesRawRead.ok) {
    return { ok: false, error: 'No se pudo leer el estado actual antes de importar. No se modificaron tus datos.' };
  }
  const habitsRaw = habitsRawRead.value;
  const completionsRaw = completionsRawRead.value;
  const quantitiesRaw = quantitiesRawRead.value;
  const snapshotStr = buildSnapshot(habitsRaw, completionsRaw, quantitiesRaw);
  const markerStr = buildMarker();

  const capacity = estimateImportCapacity(newHabitsStr, newCompletionsStr, newQuantitiesStr, snapshotStr, markerStr);
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
  const structuralOk = quantitiesWriteOk && verifyStructuralWrite(newHabitsStr, newCompletionsStr, newQuantitiesStr);

  if (!structuralOk) {
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, 'No se pudieron escribir o verificar los datos importados.');
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
    return finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, 'La importación no pudo cerrarse de forma segura y fue revertida.');
  }

  // Éxito real. El snapshot se conserva para cleanup en el próximo
  // startup limpio (estado B), igual que 4.1 hace con storageHealth.
  loadData();
  render();
  return { ok: true };
}

function finishWithRollbackOrBlock(habitsRaw, completionsRaw, quantitiesRaw, publicMessage) {
  const restore = restoreExactRaw(habitsRaw, completionsRaw, quantitiesRaw);
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

  const restore = restoreExactRaw(snapshot.habitsRaw, snapshot.completionsRaw, snapshot.quantitiesRaw);
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

function setupEvents() {
  document.getElementById('addBtn').onclick = openModal;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('saveBtn').onclick = saveHabit;
  document.getElementById('exportBtn').onclick = exportBackup;
  document.getElementById('importBtn').onclick = openImportPicker;
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
  summary.textContent = target !== null ? `${actual} / ${target} min` : `${actual} min (sin objetivo)`;
  wrap.appendChild(summary);

  if (target !== null) {
    const barOuter = document.createElement('div');
    barOuter.className = 'progress-bar';
    const barInner = document.createElement('div');
    barInner.className = 'progress-bar-fill';
    barInner.style.width = `${pct}%`;
    if (isValidColorHex(habit.color)) barInner.style.background = habit.color;
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

  const manualInput = document.createElement('input');
  manualInput.type = 'number';
  manualInput.min = '0';
  manualInput.step = '1';
  manualInput.className = 'quantity-manual-input';
  manualInput.value = String(actual);
  manualInput.disabled = corrupted;
  manualInput.setAttribute('aria-label', `Minutos registrados para ${habit.name} el ${dateStr}`);
  manualInput.onchange = (e) => {
    const raw = e.target.value.trim();
    const num = raw === '' ? NaN : Number(raw);
    const parsed = Number.isInteger(num) ? num : NaN;
    setQuantityExact(habit.id, dateStr, parsed);
  };

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'btn btn-quantity';
  plusBtn.textContent = '+5 min';
  plusBtn.disabled = corrupted;
  plusBtn.onclick = () => incrementQuantity(habit.id, dateStr, 5);

  buttonsRow.appendChild(minusBtn);
  buttonsRow.appendChild(manualInput);
  buttonsRow.appendChild(plusBtn);
  wrap.appendChild(buttonsRow);

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
  // Sin interfaz de hábitos cuantitativos todavía: un hábito no-booleano
  // (ej. importado de un backup v2) nunca puede marcarse completado por
  // esta vía -- evita contaminar `completions` con una referencia a un
  // hábito que no es de ese tipo, lo que bloquearía un export futuro.
  const habit = state.habits.find(h => h.id === id);
  if (!habit || habit.kind !== 'boolean') return;
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
  for (const day in state.quantities) {
    if (state.quantities[day] && typeof state.quantities[day] === 'object') {
      delete state.quantities[day][id];
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

  // Tipo (Posta 3): solo seleccionable al CREAR. Al editar, se muestra
  // fijo y sin handler de click -- el tipo de un hábito existente nunca
  // puede cambiarse desde esta UI (ver resolveHabitKindForSave()).
  const kindGroup = document.getElementById('kindOptions');
  if (state.editingId) {
    const kindLabel = state.selectedKind === 'quantitative' ? 'Cuantitativo (minutos)' : 'Booleano (check diario)';
    const readonly = document.createElement('div');
    readonly.className = 'kind-option selected kind-readonly';
    readonly.textContent = kindLabel;
    const note = document.createElement('div');
    note.className = 'kind-readonly-note';
    note.textContent = 'El tipo de un hábito no se puede cambiar una vez creado.';
    kindGroup.innerHTML = '';
    kindGroup.appendChild(readonly);
    kindGroup.appendChild(note);
  } else {
    kindGroup.innerHTML = `
<div class="kind-option ${state.selectedKind === 'boolean' ? 'selected' : ''}" data-kind="boolean">
<strong>Booleano</strong>
<div class="kind-desc">Check diario (sí/no)</div>
</div>
<div class="kind-option ${state.selectedKind === 'quantitative' ? 'selected' : ''}" data-kind="quantitative">
<strong>Cuantitativo</strong>
<div class="kind-desc">Registrar minutos por día</div>
</div>
`;
    document.querySelectorAll('.kind-option').forEach(opt => {
      opt.onclick = () => {
        state.selectedKind = opt.dataset.kind;
        renderModalContent();
      };
    });
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

  const habit = {
    id: state.editingId || generateHabitId(),
    name,
    icon: state.selectedIcon,
    color: state.selectedColor,
    freq: state.selectedFreq,
    freqCount: state.freqCount,
    freqPeriod: state.freqPeriod,
    createdAt: existing ? existing.createdAt : getToday(),
    kind
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
    state.selectedHabitId = state.habits[0].id;
  }
}

function updateCalendarSelect() {
  const select = document.getElementById('calendarHabitSelect');
  const goToStatsBtn = document.getElementById('calendarGoToStatsBtn');
  ensureSelectedHabitId();

  select.innerHTML = '';
  state.habits.forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.icon} ${h.name}`;
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

  state.habits.forEach(h => {
    const option = document.createElement('option');
    option.value = h.id;
    option.textContent = `${h.icon} ${h.name}`;
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
    grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #888; padding: 20px;">Agrega un hábito primero</div>';
    return;
  }

  const habitId = state.selectedHabitId;
  const habit = state.habits.find(h => h.id === habitId);
  // Color de relleno de los días completados: el propio color del hábito
  // si es válido, o un verde de respaldo si por algún motivo no lo es
  // (nunca debería faltar para un hábito ya persistido, pero el dato
  // persistido se trata como no confiable, igual que en el resto del archivo).
  const fillColor = habit && isValidColorHex(habit.color) ? habit.color : '#4CAF50';
  const fillTextColor = getContrastTextColor(fillColor);
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

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${deco.stateClass}" data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}">${day}${deco.badgeHtml}</div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = toLocalDateStr(date);
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;
    const deco = getCalendarDayDecoration(dateStr, habit);

    html += `<div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''} ${deco.stateClass}"
data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}">${day}${deco.badgeHtml}</div>`;
  }

  const remainingDays = 42 - (startDay + daysInMonth);
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day);
    const dateStr = toLocalDateStr(date);
    const isFuture = date > today;
    const deco = getCalendarDayDecoration(dateStr, habit);

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${deco.stateClass}"
data-date="${dateStr}" data-future="${isFuture}" aria-label="${day}${deco.ariaExtra}">${day}${deco.badgeHtml}</div>`;
  }

  grid.innerHTML = html;

  // habitId sale de habit.id (dato persistido, no confiable): se asigna acá
  // por property assignment (dataset), nunca interpolado en el template de
  // arriba, para no exponer una superficie de inyección de atributos.
  document.querySelectorAll('.calendar-day').forEach(cell => {
    cell.dataset.habit = habitId;
    // Reemplaza el punto decorativo anterior: el día completado/con minutos
    // rellena todo el cuadrado con el color del hábito, con el texto del
    // número recalculado para seguir siendo legible sobre ese color exacto.
    // "quantity-partial" (minutos registrados sin alcanzar el objetivo) usa
    // el mismo color a mitad de opacidad para distinguirse visualmente de
    // "completed"/"quantity-met" sin introducir una paleta nueva.
    if (cell.classList.contains('completed') || cell.classList.contains('quantity-met')) {
      cell.style.background = fillColor;
      cell.style.color = fillTextColor;
    } else if (cell.classList.contains('quantity-partial')) {
      cell.style.background = fillColor;
      cell.style.color = fillTextColor;
      cell.style.opacity = '0.5';
    }
    cell.onclick = () => {
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
      if (!state.completions[dateStr]) state.completions[dateStr] = {};
      state.completions[dateStr][hid] = !state.completions[dateStr][hid];
      saveData();
      renderCalendar();
      renderHabits();
      renderStats();
    };
  });

  renderCalendarQuantityEditor(habit && habit.kind === 'quantitative' ? habit : null, state.calendarEditingDate);
}

// Decoración visual de una celda del calendario. Booleano usa completions
// (cumplido/no cumplido); cuantitativo usa quantities (minutos
// registrados vs. objetivo) -- nunca se mezclan ambas fuentes para el
// mismo hábito.
function getCalendarDayDecoration(dateStr, habit) {
  if (!habit) return { stateClass: '', badgeHtml: '', ariaExtra: '' };

  if (habit.kind === 'quantitative') {
    const actual = getActualMinutes(habit.id, dateStr);
    if (actual <= 0) return { stateClass: '', badgeHtml: '', ariaExtra: '' };
    const target = habit.target ? habit.target.minutes : null;
    const met = target !== null && actual >= target;
    return {
      stateClass: met ? 'quantity-met' : 'quantity-partial',
      badgeHtml: `<span class="calendar-day-check" aria-hidden="true">${actual}m</span>`,
      ariaExtra: met ? ', objetivo cumplido' : ', con minutos registrados'
    };
  }

  const isCompleted = state.completions[dateStr]?.[habit.id];
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

  for (let d = new Date(createdAtDate); d <= today; d = addDays(d, 1)) {
    totalMinutes += getActualMinutes(habit.id, toLocalDateStr(d));
  }

  const todayMinutes = getActualMinutes(habit.id, getToday());
  const todayProgressPct = target !== null ? Math.min(100, Math.round((todayMinutes / target) * 100)) : null;

  const last7Days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = toLocalDateStr(d);
    last7Days.push({ label: ['D', 'L', 'M', 'X', 'J', 'V', 'S'][d.getDay()], value: getActualMinutes(habit.id, ds) });
  }

  return { totalMinutes, todayMinutes, target, todayProgressPct, last7Days };
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
  titleSpan.textContent = habit.name;
  header.appendChild(iconSpan);
  header.appendChild(titleSpan);

  const freqDiv = document.createElement('div');
  freqDiv.className = 'habit-freq';
  freqDiv.textContent = getFreqText(habit);

  const numbersDiv = document.createElement('div');
  numbersDiv.className = 'stats-numbers';
  [
    [`${stats.todayMinutes} min`, 'Minutos hoy'],
    [stats.target !== null ? `${stats.target} min` : 'Sin objetivo', 'Objetivo diario'],
    [stats.todayProgressPct !== null ? `${stats.todayProgressPct}%` : '—', 'Progreso hoy'],
    [`${stats.totalMinutes} min`, 'Total acumulado']
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
  chartTitle.textContent = 'Últimos 7 días (minutos)';
  const chartBars = document.createElement('div');
  chartBars.className = 'chart-bars';

  const scaleBase = stats.target || Math.max(1, ...stats.last7Days.map(d => d.value));
  stats.last7Days.forEach(day => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-bar-wrapper';
    const bar = document.createElement('div');
    bar.className = 'chart-bar';
    bar.style.height = `${Math.min(100, Math.round((day.value / scaleBase) * 100))}%`;
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

function createStatsCard(habit) {
  if (habit.kind === 'quantitative') return createQuantityStatsCard(habit);
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
  const container = document.getElementById('statsCardsContainer');

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">Agrega hábitos para ver estadísticas</div>';
    return;
  }

  // Por defecto, un único hábito (el seleccionado); "Mostrar todo" es la
  // única forma de ver todas las tarjetas a la vez -- nunca el default.
  const habitsToShow = state.statsShowAll
    ? state.habits
    : state.habits.filter(h => h.id === state.selectedHabitId);

  container.innerHTML = '';
  habitsToShow.forEach(habit => {
    container.appendChild(createStatsCard(habit));
  });
}

init();
