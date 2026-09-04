const ICONS = ['🧘', '💪', '🏃', '📚', '✍️', '🥗', '💧', '😴', '🎨', '🎵', '🧹', '💼'];
const COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788'];

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
  loadData();
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

function setupEvents() {
  document.getElementById('addBtn').onclick = openModal;
  document.getElementById('cancelBtn').onclick = closeModal;
  document.getElementById('saveBtn').onclick = saveHabit;

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

function renderHabits() {
  const container = document.getElementById('todayView');
  const today = getToday();

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">No tienes hábitos.<br>Presiona + para agregar uno.</div>';
    return;
  }

  container.innerHTML = state.habits.map(habit => {
    const isCompleted = state.completions[today]?.[habit.id] || false;
    const stats = calculateStats(habit);

    return `
      <div class="habit-card" style="border-left-color: ${habit.color}">
        <div class="habit-header">
          <span class="habit-icon">${habit.icon}</span>
          <div class="habit-info">
            <div class="habit-name">${habit.name}</div>
            <div class="habit-freq">${getFreqText(habit)}${getPeriodProgressText(habit, stats)}</div>
          </div>
          <button class="btn btn-check ${isCompleted ? 'completed' : ''}" data-action="toggle" data-id="${habit.id}" data-date="${today}" ${hasStorageCorruption() ? 'disabled' : ''}>
            ${isCompleted ? '✓' : '○'}
          </button>
          <button class="btn btn-edit" data-action="edit" data-id="${habit.id}" ${hasStorageCorruption() ? 'disabled' : ''}>✏️</button>
          <button class="btn btn-delete" data-action="delete" data-id="${habit.id}" ${hasStorageCorruption() ? 'disabled' : ''}>🗑️</button>
        </div>
        <div class="stats">
          <div class="stat">
            <div class="stat-label">Tasa éxito</div>
            <div class="stat-value">${stats.successRate}%</div>
          </div>
          <div class="stat">
            <div class="stat-label">Racha</div>
            <div class="stat-value">${stats.currentStreak}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Mejor racha</div>
            <div class="stat-value">${stats.bestStreak}</div>
          </div>
          <div class="stat">
            <div class="stat-label">Total</div>
            <div class="stat-value">${stats.totalCompleted}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');

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
  if (!name) { alert('Ingresa un nombre'); return; }

  const existing = state.editingId ? state.habits.find(h => h.id === state.editingId) : null;

  const habit = {
    id: state.editingId || Date.now().toString(),
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

  if (state.habits.length === 0) {
    select.innerHTML = '';
    return;
  }

  select.innerHTML = state.habits.map(h =>
    `<option value="${h.id}">${h.icon} ${h.name}</option>`
  ).join('');

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

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}" data-date="${dateStr}" data-habit="${habitId}" data-future="${isFuture}">${day}</div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateStr = toLocalDateStr(date);
    const isCompleted = state.completions[dateStr]?.[habitId];
    const isToday = date.getTime() === today.getTime();
    const isFuture = date > today;

    html += `<div class="calendar-day ${isToday ? 'today' : ''} ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}"
data-date="${dateStr}" data-habit="${habitId}" data-future="${isFuture}">${day}</div>`;
  }

  const remainingDays = 42 - (startDay + daysInMonth);
  for (let day = 1; day <= remainingDays; day++) {
    const date = new Date(year, month + 1, day);
    const dateStr = toLocalDateStr(date);
    const isCompleted = state.completions[dateStr]?.[habitId];
    const isFuture = date > today;

    html += `<div class="calendar-day other-month ${isFuture ? 'future' : ''} ${isCompleted ? 'completed' : ''}"
data-date="${dateStr}" data-habit="${habitId}" data-future="${isFuture}">${day}</div>`;
  }

  grid.innerHTML = html;

  document.querySelectorAll('.calendar-day').forEach(cell => {
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

function renderStats() {
  const container = document.getElementById('statsView');

  if (state.habits.length === 0) {
    container.innerHTML = '<div class="empty-state">Agrega hábitos para ver estadísticas</div>';
    return;
  }

  container.innerHTML = state.habits.map(habit => {
    const stats = calculateStats(habit);
    const last7Days = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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

    const barsHtml = last7Days.map(day => `
<div class="chart-bar-wrapper">
<div class="chart-bar" style="height: ${day.value * 100}%; background: ${habit.color};"></div>
<div class="chart-label">${day.label}</div>
</div>
`).join('');

    return `
<div class="stats-card" style="border-left-color: ${habit.color}">
<div class="stats-header">
<span class="habit-icon">${habit.icon}</span>
<span class="stats-title">${habit.name}</span>
</div>
<div class="habit-freq">${getFreqText(habit)}${getPeriodProgressText(habit, stats)}</div>

<div class="stats-numbers">
<div class="stat-box">
<div class="stat-box-value">${stats.successRate}%</div>
<div class="stat-box-label">Tasa de éxito</div>
</div>
<div class="stat-box">
<div class="stat-box-value">${stats.currentStreak}</div>
<div class="stat-box-label">Racha actual</div>
</div>
<div class="stat-box">
<div class="stat-box-value">${stats.bestStreak}</div>
<div class="stat-box-label">Mejor racha</div>
</div>
<div class="stat-box">
<div class="stat-box-value">${stats.totalCompleted}</div>
<div class="stat-box-label">Total completados</div>
</div>
</div>

<div class="chart">
<div class="chart-title">Últimos 7 días</div>
<div class="chart-bars">
${barsHtml}
</div>
</div>
</div>
`;
  }).join('');
}

init();
