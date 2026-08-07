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
  currentView: 'today'
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

function init() {
  loadData();
  setupEvents();
  render();
}

function loadData() {
  const h = localStorage.getItem('habits');
  const c = localStorage.getItem('completions');
  if (h) state.habits = JSON.parse(h);
  if (c) state.completions = JSON.parse(c);

  state.habits = state.habits.map(hb => ({
    freq: 'daily',
    freqCount: 7,
    freqPeriod: 'week',
    ...hb
  }));
}

function saveData() {
  localStorage.setItem('habits', JSON.stringify(state.habits));
  localStorage.setItem('completions', JSON.stringify(state.completions));
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

function render() {
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
            <div class="habit-freq">${getFreqText(habit)}</div>
          </div>
          <button class="btn btn-check ${isCompleted ? 'completed' : ''}" data-action="toggle" data-id="${habit.id}" data-date="${today}">
            ${isCompleted ? '✓' : '○'}
          </button>
          <button class="btn btn-edit" data-action="edit" data-id="${habit.id}">✏️</button>
          <button class="btn btn-delete" data-action="delete" data-id="${habit.id}">🗑️</button>
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
function calculateStats(habit) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let totalDays = 0;
  let completedDays = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  let tempStreak = 0;

  // Últimos 90 días para calcular estadísticas
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const ds = toLocalDateStr(d);

    // Solo contar días donde el hábito aplica según frecuencia
    if (shouldTrackOnDate(habit, d)) {
      totalDays++;
      const completed = state.completions[ds]?.[habit.id] || false;

      if (completed) {
        completedDays++;
        tempStreak++;
        // Solo cuenta para racha actual si es consecutivo desde hoy
        if (i === 0 || currentStreak > 0) {
          currentStreak++;
        }
      } else {
        tempStreak = 0;
        if (i === 0) currentStreak = 0;
      }

      bestStreak = Math.max(bestStreak, tempStreak);
    }
  }

  return {
    successRate: totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0,
    currentStreak,
    bestStreak,
    totalCompleted: completedDays
  };
}

function shouldTrackOnDate(habit, date) {
  if (habit.freq === 'daily') return true;
  if (habit.freq === 'custom') return true;
  return true;
}

function toggleHabit(id, date) {
  if (!state.completions[date]) state.completions[date] = {};
  state.completions[date][id] = !state.completions[date][id];
  saveData();
  render();
}

function deleteHabit(id) {
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
  const name = document.getElementById('habitName').value.trim();
  if (!name) { alert('Ingresa un nombre'); return; }

  const habit = {
    id: state.editingId || Date.now().toString(),
    name,
    icon: state.selectedIcon,
    color: state.selectedColor,
    freq: state.selectedFreq,
    freqCount: state.freqCount,
    freqPeriod: state.freqPeriod
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
