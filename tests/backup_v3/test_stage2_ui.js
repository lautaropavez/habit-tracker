'use strict';
/**
 * Backup v3, Etapa 2: archivados, SKIP neutral, frecuencia heredada de Loop
 * ('loop-month'), edicion sin perdida y vista previa de importacion.
 * 100% sintetico. Usa un DOM falso minimo (sin navegador) para ejercer las
 * funciones reales de render de js/app.js.
 *
 * Correr con: node --test tests/backup_v3/test_stage2_ui.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');

// ---------------------------------------------------------------------
// DOM falso minimo
// ---------------------------------------------------------------------
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this._text = '';
    this._html = '';
    this.classNames = new Set();
    this.classList = {
      add: (c) => this.classNames.add(c),
      remove: (c) => this.classNames.delete(c),
      contains: (c) => this.classNames.has(c),
    };
  }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute() {}
  querySelectorAll() { return []; }
  addEventListener() {}
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
}

function collectText(el) {
  return [el._text, el._html, ...el.children.map(collectText)].filter(Boolean).join(' | ');
}

function collectClasses(el) {
  return [el.className, ...el.classNames, ...el.children.flatMap(c => [collectClasses(c)])].join(' ');
}

function makeFakeDocument() {
  const byId = new Map();
  return {
    byId,
    createElement: (tag) => new FakeEl(tag),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeEl('#' + id));
      return byId.get(id);
    },
    querySelectorAll: () => [],
  };
}

function withFakeDom(seed) {
  const app = loadApp(seed);
  const doc = makeFakeDocument();
  app.sandbox.document = doc;
  return { ...app, doc };
}

// ---------------------------------------------------------------------
// Datos sinteticos relativos a hoy (los tests no dependen de la fecha real)
// ---------------------------------------------------------------------
function dstr(sandbox, offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return sandbox.toLocalDateStr(d);
}

const habit = (id, extra) => ({
  id, name: 'Hab ' + id, icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 1,
  freqPeriod: 'week', createdAt: '2025-01-01', kind: 'boolean', archived: false, ...extra,
});
const loopMonth = (id, extra) => habit(id, {
  freq: 'custom', freqCount: 27, freqPeriod: 'loop-month', freqWindowDays: 30, ...extra,
});

function seed(habits, completions, skips, quantities) {
  return {
    habits: JSON.stringify(habits),
    completions: JSON.stringify(completions || {}),
    quantities: JSON.stringify(quantities || {}),
    skips: JSON.stringify(skips || {}),
  };
}

function statsOf(sandbox, habitObj) {
  return JSON.parse(JSON.stringify(sandbox.calculateStats(habitObj)));
}

// ---------------------------------------------------------------------
// 1. Archivados: ocultos en Hoy, visibles en vistas historicas
// ---------------------------------------------------------------------
test('Hoy: renderHabits oculta los archivados y no los borra', () => {
  const habits = [habit('a'), habit('b', { archived: true }), habit('c')];
  const { sandbox, doc, localStorage } = withFakeDom(seed(habits));
  sandbox.renderHabits();
  const container = doc.getElementById('todayView');
  assert.equal(container.children.length, 2);
  const text = collectText(container);
  assert.match(text, /Hab a/);
  assert.match(text, /Hab c/);
  assert.doesNotMatch(text, /Hab b/);
  // el historial sigue intacto
  assert.equal(JSON.parse(localStorage.getItem('habits')).length, 3);
});

test('Hoy: si todos estan archivados muestra un mensaje propio; sin habitos, el original', () => {
  let { sandbox, doc } = withFakeDom(seed([habit('a', { archived: true })]));
  sandbox.renderHabits();
  assert.equal(doc.getElementById('todayView').children.length, 0);
  assert.match(doc.getElementById('todayView').innerHTML, /No hay hábitos activos/);

  ({ sandbox, doc } = withFakeDom(seed([])));
  sandbox.renderHabits();
  assert.match(doc.getElementById('todayView').innerHTML, /No tienes hábitos/);
});

test('Hoy: un cuantitativo archivado tambien se oculta', () => {
  const q = habit('q', { kind: 'quantitative', unit: 'minutes', target: null, freq: 'custom', archived: true });
  const { sandbox, doc } = withFakeDom(seed([habit('a'), q]));
  sandbox.renderHabits();
  assert.equal(doc.getElementById('todayView').children.length, 1);
});

test('Calendario y Estadisticas: los archivados se pueden elegir, al final y marcados', () => {
  const habits = [habit('a', { archived: true, name: 'Viejo' }), habit('b', { name: 'Nuevo' })];
  const { sandbox, doc } = withFakeDom(seed(habits));
  assert.equal(JSON.stringify(sandbox.getHabitsForHistory().map(h => h.id)), '["b","a"]');
  sandbox.updateCalendarSelect();
  const calSel = doc.getElementById('calendarHabitSelect');
  assert.equal(calSel.children.length, 2);
  assert.match(calSel.children[0].textContent, /Nuevo/);
  assert.match(calSel.children[1].textContent, /Viejo \(archivado\)/);
  assert.equal(calSel.value, 'b');            // el default es el primer activo
  sandbox.updateStatsSelect();
  const stSel = doc.getElementById('statsHabitSelect');
  assert.equal(stSel.children.length, 3);       // 2 hábitos + "Mostrar todo"
  assert.match(stSel.children[1].textContent, /\(archivado\)/);
});

test('Calendario: si todos estan archivados igual se puede consultar el primero', () => {
  const { sandbox, doc } = withFakeDom(seed([habit('a', { archived: true }), habit('b', { archived: true })]));
  sandbox.updateCalendarSelect();
  assert.equal(doc.getElementById('calendarHabitSelect').value, 'a');
});

test('Estadisticas: un archivado muestra su tarjeta con su historial y la marca (archivado)', () => {
  const h = habit('a', { archived: true, createdAt: '2026-01-01' });
  const { sandbox } = withFakeDom(seed([h], { '2026-01-02': { a: true }, '2026-01-03': { a: true } }));
  const card = sandbox.createStatsCard(h);
  const text = collectText(card);
  assert.match(text, /Hab a \(archivado\)/);
  assert.match(text, /Total completados/);
});

// ---------------------------------------------------------------------
// 2. SKIP en Calendario y Estadisticas
// ---------------------------------------------------------------------
test('Calendario: un dia SKIP se identifica y se distingue de completado y de sin registro', () => {
  const h = habit('a');
  const { sandbox } = loadApp(seed([h], { '2026-01-02': { a: true } }, { '2026-01-03': { a: true } }));
  const deco = (d) => JSON.parse(JSON.stringify(sandbox.getCalendarDayDecoration(d, h)));
  assert.equal(deco('2026-01-03').stateClass, 'skipped');
  assert.match(deco('2026-01-03').ariaExtra, /omitido/);
  assert.ok(deco('2026-01-03').badgeHtml.includes('↷'));
  assert.equal(deco('2026-01-02').stateClass, 'completed');
  assert.equal(deco('2026-01-04').stateClass, '');
  assert.equal(deco('2026-01-04').badgeHtml, '');
});

test('Calendario: SKIP de otro habito o de un archivado se resuelve por habito', () => {
  const a = habit('a');
  const b = habit('b', { archived: true });
  const { sandbox } = loadApp(seed([a, b], {}, { '2026-01-03': { b: true } }));
  assert.equal(sandbox.getCalendarDayDecoration('2026-01-03', a).stateClass, '');
  assert.equal(sandbox.getCalendarDayDecoration('2026-01-03', b).stateClass, 'skipped');
});

test('Estadisticas: se distingue SKIP de dias sin registro (caja propia + barra marcada)', () => {
  const h = habit('a', { createdAt: dstr(loadApp().sandbox, -10) });
  const probe = loadApp().sandbox;
  const skips = { [dstr(probe, -2)]: { a: true } };
  const completions = { [dstr(probe, -1)]: { a: true } };
  const { sandbox } = withFakeDom(seed([h], completions, skips));
  const card = sandbox.createStatsCard(h);
  const text = collectText(card);
  assert.match(text, /Días omitidos \(SKIP\)/);
  assert.match(collectClasses(card), /chart-bar-skipped/);
  assert.equal(statsOf(sandbox, h).skippedDays, 1);
});

// ---------------------------------------------------------------------
// 3. Rachas y tasas con SKIP: ni exito ni fracaso
// ---------------------------------------------------------------------
test('diario: un SKIP no corta la racha, no suma completados y no entra en la tasa', () => {
  const probe = loadApp().sandbox;
  const created = dstr(probe, -8);
  const done = {};
  for (const off of [-8, -7, -6, -5, -3, -2, -1]) done[dstr(probe, off)] = { a: true };
  const h = habit('a', { createdAt: created });

  const withSkip = loadApp(seed([h], done, { [dstr(probe, -4)]: { a: true } })).sandbox;
  const s = statsOf(withSkip, h);
  assert.equal(s.totalCompleted, 7);
  assert.equal(s.skippedDays, 1);
  assert.equal(s.successRate, 100);
  assert.equal(s.currentStreak, 7);
  assert.equal(s.bestStreak, 7);

  // Control: el mismo dia SIN registro si es un fallo (comportamiento original).
  const withoutSkip = loadApp(seed([h], done)).sandbox;
  const c = statsOf(withoutSkip, h);
  assert.equal(c.totalCompleted, 7);
  assert.equal(c.successRate, 88);       // 7 de 8 dias cerrados
  assert.equal(c.currentStreak, 3);
  assert.equal(c.bestStreak, 4);
});

test('diario: SKIP hoy no crea ni rompe nada', () => {
  const probe = loadApp().sandbox;
  const h = habit('a', { createdAt: dstr(probe, -3) });
  const done = {};
  for (const off of [-3, -2, -1]) done[dstr(probe, off)] = { a: true };
  const { sandbox } = loadApp(seed([h], done, { [dstr(probe, 0)]: { a: true } }));
  const s = statsOf(sandbox, h);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.successRate, 100);
  assert.equal(s.skippedDays, 1);
});

test('diario: solo dias SKIP => sin tasa (—), nunca un 0 % enganoso', () => {
  const probe = loadApp().sandbox;
  const h = habit('a', { createdAt: dstr(probe, -2) });
  const skips = { [dstr(probe, -2)]: { a: true }, [dstr(probe, -1)]: { a: true } };
  const { sandbox } = loadApp(seed([h], {}, skips));
  const s = statsOf(sandbox, h);
  assert.equal(s.successRate, null);
  assert.equal(s.currentStreak, 0);
  assert.equal(sandbox.formatStatValue(s.successRate, '%'), '—');
});

function weekScenario(probe, perWeek) {
  // perWeek: arreglo [ {done, skip} ] para las semanas cerradas, de la mas vieja a la mas nueva.
  const monday = probe.getWeekStart(new Date());
  const startOffset = -(perWeek.length * 7);
  const firstMonday = probe.addDays(monday, startOffset);
  const completions = {};
  const skips = {};
  perWeek.forEach((w, i) => {
    const base = i * 7;
    for (let k = 0; k < w.done; k++) {
      completions[probe.toLocalDateStr(probe.addDays(firstMonday, base + k))] = { a: true };
    }
    for (let k = 0; k < w.skip; k++) {
      skips[probe.toLocalDateStr(probe.addDays(firstMonday, base + 6 - k))] = { a: true };
    }
  });
  const h = habit('a', {
    freq: 'custom', freqCount: 3, freqPeriod: 'week',
    createdAt: probe.toLocalDateStr(firstMonday),
  });
  return { h, completions, skips };
}

test('semanal: una semana con SKIP que no llega al objetivo es neutral (no corta la racha ni baja la tasa)', () => {
  const probe = loadApp().sandbox;
  const sc = weekScenario(probe, [{ done: 3, skip: 0 }, { done: 1, skip: 1 }, { done: 3, skip: 0 }]);
  const { sandbox } = loadApp(seed([sc.h], sc.completions, sc.skips));
  const s = statsOf(sandbox, sc.h);
  assert.equal(s.successRate, 100);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.currentStreak, 2);

  // Control sin SKIP: esa semana (1 de 3) si es un fallo (comportamiento original).
  const sc2 = weekScenario(probe, [{ done: 3, skip: 0 }, { done: 1, skip: 0 }, { done: 3, skip: 0 }]);
  const c = statsOf(loadApp(seed([sc2.h], sc2.completions, sc2.skips)).sandbox, sc2.h);
  assert.equal(c.successRate, 67);
  assert.equal(c.bestStreak, 1);
  assert.equal(c.currentStreak, 1);
});

test('semanal: una semana que ya llego al objetivo se cumple aunque tenga SKIP', () => {
  const probe = loadApp().sandbox;
  const sc = weekScenario(probe, [{ done: 3, skip: 1 }, { done: 3, skip: 0 }]);
  const s = statsOf(loadApp(seed([sc.h], sc.completions, sc.skips)).sandbox, sc.h);
  assert.equal(s.successRate, 100);
  assert.equal(s.bestStreak, 2);
  assert.equal(s.totalCompleted, 6);
});

test('semanal: solo semanas neutrales => sin tasa (—)', () => {
  const probe = loadApp().sandbox;
  const sc = weekScenario(probe, [{ done: 1, skip: 1 }]);
  const s = statsOf(loadApp(seed([sc.h], sc.completions, sc.skips)).sandbox, sc.h);
  assert.equal(s.successRate, null);
  assert.equal(s.bestStreak, 0);
});

test('un SKIP nunca crea completions ni cambia el total', () => {
  const probe = loadApp().sandbox;
  const h = habit('a', { createdAt: dstr(probe, -5) });
  const { sandbox, localStorage } = loadApp(seed([h], {}, { [dstr(probe, -2)]: { a: true } }));
  assert.equal(statsOf(sandbox, h).totalCompleted, 0);
  sandbox.saveData();
  assert.equal(localStorage.getItem('completions'), '{}');
});

// ---------------------------------------------------------------------
// 4. Frecuencia heredada de Loop (N de 30)
// ---------------------------------------------------------------------
test('loop-month: el texto aclara que es la frecuencia original de Loop y no mes calendario', () => {
  const { sandbox } = loadApp();
  const text = sandbox.getFreqText(loopMonth('x'));
  assert.match(text, /27 de 30/);
  assert.match(text, /frecuencia original de Loop/);
  assert.match(text, /no es mes calendario/);
  assert.equal(sandbox.getPeriodProgressText(loopMonth('x'), { currentPeriod: { count: 1, target: 27 } }), '');
});

test('loop-month: ni tasa ni rachas inventadas ("—"), pero si total y omitidos', () => {
  const probe = loadApp().sandbox;
  const h = loopMonth('a', { createdAt: dstr(probe, -10) });
  const { sandbox } = loadApp(seed([h], { [dstr(probe, -3)]: { a: true }, [dstr(probe, -2)]: { a: true } },
    { [dstr(probe, -1)]: { a: true } }));
  const s = statsOf(sandbox, h);
  assert.equal(s.successRate, null);
  assert.equal(s.currentStreak, null);
  assert.equal(s.bestStreak, null);
  assert.equal(s.currentPeriod, null);
  assert.equal(s.totalCompleted, 2);
  assert.equal(s.skippedDays, 1);
});

test('loop-month: la tarjeta de Hoy y la de Estadisticas muestran "—" y la nota', () => {
  const h = loopMonth('a', { createdAt: '2026-01-01' });
  const { sandbox } = withFakeDom(seed([h], { '2026-01-02': { a: true } }));
  const today = sandbox.createHabitCard(h, '2026-01-05');
  const todayText = collectText(today);
  assert.match(todayText, /Tasa éxito/);
  assert.match(todayText, /—/);
  assert.doesNotMatch(todayText, /NaN|undefined|null/);
  const statsText = collectText(sandbox.createStatsCard(h));
  assert.match(statsText, /—/);
  assert.match(statsText, /no se calcula como mes calendario/);
  assert.doesNotMatch(statsText, /NaN|undefined|null/);
});

test('un habito semanal o diario normal no muestra la aclaracion ni "—" sin motivo', () => {
  const probe = loadApp().sandbox;
  const h = habit('a', { createdAt: dstr(probe, -5) });
  const { sandbox } = withFakeDom(seed([h], { [dstr(probe, -3)]: { a: true } }));
  const text = collectText(sandbox.createStatsCard(h));
  assert.doesNotMatch(text, /frecuencia original de Loop/);
  assert.doesNotMatch(text, /—/);
});

// ---------------------------------------------------------------------
// 5. Edicion sin perdida de configuracion
// ---------------------------------------------------------------------
function editAndSave(h, extraSeed) {
  const { sandbox, doc, localStorage } = withFakeDom(seed([h], ...(extraSeed || [])));
  sandbox.editHabit(h.id);
  doc.getElementById('habitName').value = 'Renombrado';
  sandbox.saveHabit();
  return { saved: JSON.parse(localStorage.getItem('habits'))[0], doc, sandbox };
}

test('editar un habito loop-month conserva freq, freqCount, freqPeriod y freqWindowDays', () => {
  const { saved } = editAndSave(loopMonth('a'));
  assert.equal(saved.name, 'Renombrado');
  assert.equal(saved.freq, 'custom');
  assert.equal(saved.freqCount, 27);
  assert.equal(saved.freqPeriod, 'loop-month');
  assert.equal(saved.freqWindowDays, 30);
  assert.equal(saved.archived, false);
});

test('editar un habito archivado conserva archived (y la frecuencia heredada)', () => {
  const { saved } = editAndSave(loopMonth('a', { archived: true }));
  assert.equal(saved.archived, true);
  assert.equal(saved.freqPeriod, 'loop-month');
  assert.equal(saved.freqWindowDays, 30);
});

test('editar un habito normal no agrega freqWindowDays y conserva archived=false', () => {
  const { saved } = editAndSave(habit('a'));
  assert.equal('freqWindowDays' in saved, false);
  assert.equal(saved.archived, false);
  assert.equal(saved.freqPeriod, 'week');
});

test('el modal muestra la frecuencia heredada fija (solo lectura) y no el selector semana/mes', () => {
  const h = loopMonth('a');
  const { sandbox, doc } = withFakeDom(seed([h]));
  sandbox.editHabit('a');
  const freq = doc.getElementById('freqOptions');
  const text = collectText(freq);
  assert.match(text, /27 de 30/);
  assert.match(text, /no se puede editar/);
  assert.doesNotMatch(text, /freqPeriodInput/);
});

test('editar un habito semanal normal sigue mostrando el selector de frecuencia', () => {
  const h = habit('a', { freq: 'custom', freqCount: 3, freqPeriod: 'week' });
  const { sandbox, doc } = withFakeDom(seed([h]));
  sandbox.editHabit('a');
  assert.match(doc.getElementById('freqOptions').innerHTML, /freqPeriodInput/);
});

test('editar un habito con skips no toca los skips', () => {
  const h = habit('a');
  const { sandbox, doc, localStorage } = withFakeDom(seed([h], {}, { '2026-01-03': { a: true } }));
  sandbox.editHabit('a');
  doc.getElementById('habitName').value = 'Otro';
  sandbox.saveHabit();
  assert.equal(JSON.parse(localStorage.getItem('skips'))['2026-01-03'].a, true);
});

// ---------------------------------------------------------------------
// 6. Vista previa de importacion
// ---------------------------------------------------------------------
function v3Backup() {
  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    habits: [habit('h1'), habit('h2', { archived: true }), loopMonth('h3')],
    completions: { '2026-01-02': { h1: true } },
    quantities: {},
    skips: { '2026-01-03': { h1: true, h2: true }, '2026-01-04': { h2: true } },
  };
}

test('vista previa: incluye cantidad de archivados y de SKIP (y de frecuencias heredadas)', () => {
  const { sandbox } = loadApp();
  const r = sandbox.validateBackup(JSON.stringify(v3Backup()));
  assert.equal(r.ok, true, r.fatal);
  const text = sandbox.buildImportSummaryText(r.summary);
  assert.match(text, /3 hábitos/);
  assert.match(text, /1 archivados/);
  assert.match(text, /3 días omitidos \(SKIP\) en 2 fechas/);
  assert.match(text, /1 con frecuencia original de Loop/);
});

test('vista previa renderizada: el texto del resumen llega al DOM de la vista previa', () => {
  const { sandbox, doc } = withFakeDom();
  const r = sandbox.validateBackup(JSON.stringify(v3Backup()));
  sandbox.renderImportPreview(r);
  const text = collectText(doc.getElementById('importPreview'));
  assert.match(text, /1 archivados/);
  assert.match(text, /3 días omitidos \(SKIP\)/);
});

test('vista previa: v1 y v2 siguen mostrando un resumen valido (0 archivados, 0 SKIP)', () => {
  const { sandbox } = loadApp();
  const v1 = {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    habits: [{ id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }],
    completions: { '2026-01-02': { h1: true } },
  };
  const r = sandbox.validateBackup(JSON.stringify(v1));
  assert.equal(r.ok, true, r.fatal);
  const text = sandbox.buildImportSummaryText(r.summary);
  assert.match(text, /1 hábitos/);
  assert.match(text, /0 archivados/);
  assert.match(text, /0 días omitidos \(SKIP\) en 0 fechas/);
  assert.doesNotMatch(text, /frecuencia original de Loop/);
});

test('vista previa: un resumen viejo sin campos v3 no rompe', () => {
  const { sandbox } = loadApp();
  const text = sandbox.buildImportSummaryText({
    habitsCount: 2, completionDatesCount: 1, trueEntriesCount: 1, exportedAt: 'x',
  });
  assert.match(text, /2 hábitos/);
  assert.doesNotMatch(text, /archivados/);
});

// ---------------------------------------------------------------------
// 7. Regresion
// ---------------------------------------------------------------------
test('regresion: formatStatValue conserva numeros y solo convierte null en "—"', () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.formatStatValue(0, '%'), '0%');
  assert.equal(sandbox.formatStatValue(88, '%'), '88%');
  assert.equal(sandbox.formatStatValue(3), '3');
  assert.equal(sandbox.formatStatValue(null, '%'), '—');
  assert.equal(sandbox.formatStatValue(undefined), '—');
});

test('regresion: estadisticas de un habito sin skips (v1/v2) no cambian', () => {
  const probe = loadApp().sandbox;
  const h = habit('a', { createdAt: dstr(probe, -6) });
  const done = {};
  for (const off of [-6, -5, -4, -2, -1]) done[dstr(probe, off)] = { a: true };
  const v2Style = loadApp({
    habits: JSON.stringify([{ ...h, archived: undefined }]),
    completions: JSON.stringify(done),
  }).sandbox;
  const s = statsOf(v2Style, h);
  assert.equal(s.totalCompleted, 5);
  assert.equal(s.skippedDays, 0);
  assert.equal(s.successRate, 83);       // 5 de 6 dias cerrados
  assert.equal(s.currentStreak, 2);
  assert.equal(s.bestStreak, 3);
});

test('regresion: marcar completado desde Hoy sigue funcionando con la lista filtrada', () => {
  const probe = loadApp().sandbox;
  const { sandbox, localStorage } = withFakeDom(seed([habit('a'), habit('b', { archived: true })]));
  sandbox.toggleHabit('a', dstr(probe, 0));
  assert.equal(JSON.parse(localStorage.getItem('completions'))[dstr(probe, 0)].a, true);
});
