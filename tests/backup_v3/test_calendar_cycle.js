'use strict';
/**
 * Ciclo de tres estados del Calendario (hábitos booleanos):
 *   sin registro -> completado -> SKIP -> sin registro,
 * y estadísticas de hábitos archivados. 100% sintético.
 *
 * Correr con: node --test tests/backup_v3/test_calendar_cycle.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');

// ---------------------------------------------------------------------
// DOM falso mínimo, con celdas del calendario parseadas desde el HTML real
// que genera renderCalendar().
// ---------------------------------------------------------------------
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attrs = {};
    this.className = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.tabIndex = -1;
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
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  querySelectorAll() { return []; }
  addEventListener() {}
  focus() {}
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = String(v); this.children = []; }
}

function collectText(el) {
  return [el._text, el._html, ...el.children.map(collectText)].filter(Boolean).join(' | ');
}

const CELL_RE = /<div class="calendar-day([^"]*)"\s+data-date="([^"]+)"\s+data-future="([^"]+)"/g;

function makeFakeDocument() {
  const byId = new Map();
  const doc = {
    cells: [],
    createElement: (tag) => new FakeEl(tag),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeEl('#' + id));
      return byId.get(id);
    },
    tabs: [new FakeEl('tab'), new FakeEl('tab'), new FakeEl('tab')],
    querySelectorAll(selector) {
      if (selector === '.tab') return doc.tabs;
      if (selector !== '.calendar-day') return [];
      const html = doc.getElementById('calendarGrid')._html;
      doc.cells = [...html.matchAll(CELL_RE)].map(([, cls, date, future]) => {
        const cell = new FakeEl('div');
        cls.split(/\s+/).filter(Boolean).forEach(c => cell.classNames.add(c));
        cell.dataset.date = date;
        cell.dataset.future = future;
        return cell;
      });
      return doc.cells;
    },
  };
  return doc;
}

function withFakeDom(seedData) {
  const app = loadApp(seedData);
  const doc = makeFakeDocument();
  app.sandbox.document = doc;
  return { ...app, doc };
}

// ---------------------------------------------------------------------
// Datos sintéticos (relativos a hoy: los tests no dependen de la fecha real)
// ---------------------------------------------------------------------
const probe = loadApp().sandbox;

function dstr(offsetDays) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return probe.toLocalDateStr(d);
}

const habit = (id, extra) => ({
  id, name: 'Hab ' + id, icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 1,
  freqPeriod: 'week', createdAt: '2020-01-01', kind: 'boolean', archived: false, ...extra,
});
const quantHabit = (id, extra) => habit(id, {
  freq: 'custom', kind: 'quantitative', unit: 'minutes', target: null, ...extra,
});

function seed(habits, completions, skips, quantities) {
  return {
    habits: JSON.stringify(habits),
    completions: JSON.stringify(completions || {}),
    quantities: JSON.stringify(quantities || {}),
    skips: JSON.stringify(skips || {}),
  };
}

const read = (localStorage, key) => JSON.parse(localStorage.getItem(key));
const plain = (v) => JSON.parse(JSON.stringify(v));

function assertNeverBoth(localStorage) {
  const completions = read(localStorage, 'completions');
  const skips = read(localStorage, 'skips');
  for (const date of Object.keys(skips)) {
    for (const id of Object.keys(skips[date])) {
      assert.notEqual(completions[date]?.[id], true, `completion y skip a la vez en ${date}/${id}`);
    }
  }
}

// =======================================================================
// 1. Ciclo y persistencia de cada transición
// =======================================================================
test('ciclo completo: sin registro -> completado -> SKIP -> sin registro, persistiendo cada paso', () => {
  const D = dstr(-3);
  const { sandbox, localStorage } = loadApp(seed([habit('a')]));
  assert.equal(sandbox.getBooleanDayState('a', D), 'none');

  let r = sandbox.cycleBooleanDay('a', D);
  assert.equal(r.ok, true);
  assert.equal(r.previous, 'none');
  assert.equal(r.state, 'completed');
  assert.equal(read(localStorage, 'completions')[D].a, true);
  assert.equal(read(localStorage, 'skips')[D], undefined);
  assertNeverBoth(localStorage);
  assert.equal(sandbox.validateExportState().ok, true);

  r = sandbox.cycleBooleanDay('a', D);
  assert.equal(r.state, 'skipped');
  assert.equal(read(localStorage, 'completions')[D], undefined);
  assert.equal(read(localStorage, 'skips')[D].a, true);
  assertNeverBoth(localStorage);
  assert.equal(sandbox.validateExportState().ok, true);

  r = sandbox.cycleBooleanDay('a', D);
  assert.equal(r.state, 'none');
  assert.deepEqual(plain(read(localStorage, 'completions')), {});
  assert.deepEqual(plain(read(localStorage, 'skips')), {});
  assert.equal(sandbox.getBooleanDayState('a', D), 'none');
  assert.equal(sandbox.validateExportState().ok, true);

  // el ciclo es cerrado: un cuarto toque vuelve a completado
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'completed');
});

test('un dia importado como SKIP entra en el ciclo: SKIP -> sin registro -> completado -> SKIP', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed([habit('a')], {}, { [D]: { a: true } }));
  assert.equal(sandbox.getBooleanDayState('a', D), 'skipped');
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'none');
  assert.deepEqual(plain(read(localStorage, 'skips')), {});
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'completed');
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'skipped');
  assert.equal(read(localStorage, 'skips')[D].a, true);
  assertNeverBoth(localStorage);
});

test('un dia ya completado entra en el ciclo en su lugar: completado -> SKIP', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed([habit('a')], { [D]: { a: true } }));
  assert.equal(sandbox.getBooleanDayState('a', D), 'completed');
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'skipped');
  assert.equal(read(localStorage, 'completions')[D], undefined);
});

test('un dato inconsistente (completion y skip a la vez) se lee como completado y el ciclo lo deja solo en SKIP', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed([habit('a')], { [D]: { a: true } }, { [D]: { a: true } }));
  assert.equal(sandbox.getBooleanDayState('a', D), 'completed');
  assert.equal(sandbox.cycleBooleanDay('a', D).state, 'skipped');
  assertNeverBoth(localStorage);
  assert.equal(read(localStorage, 'skips')[D].a, true);
});

test('"sin registro" no deja entradas false ni fechas vacias, y no toca otros habitos ni fechas', () => {
  const D = dstr(-3);
  const other = dstr(-4);
  const { sandbox, localStorage } = loadApp(seed(
    [habit('a'), habit('b')],
    { [D]: { b: true }, [other]: { a: true } },
    { [other]: { b: true } },
  ));
  sandbox.cycleBooleanDay('a', D);   // completado
  sandbox.cycleBooleanDay('a', D);   // SKIP
  sandbox.cycleBooleanDay('a', D);   // sin registro
  const completions = plain(read(localStorage, 'completions'));
  const skips = plain(read(localStorage, 'skips'));
  assert.deepEqual(completions, { [D]: { b: true }, [other]: { a: true } });
  assert.deepEqual(skips, { [other]: { b: true } });
  assert.equal(JSON.stringify(completions).includes('false'), false);
});

test('el ciclo mantiene siempre la invariante en cualquier cantidad de toques', () => {
  const D = dstr(-1);
  const { sandbox, localStorage } = loadApp(seed([habit('a')]));
  for (let i = 0; i < 12; i++) {
    sandbox.cycleBooleanDay('a', D);
    assertNeverBoth(localStorage);
    assert.equal(sandbox.validateExportState().ok, true);
  }
  assert.equal(sandbox.getBooleanDayState('a', D), 'none');   // 12 es múltiplo de 3
});

// =======================================================================
// 2. Protección de fechas
// =======================================================================
test('fecha futura: rechazada, sin cambios en el almacenamiento', () => {
  const { sandbox, localStorage } = loadApp(seed([habit('a')]));
  const before = localStorage._dump();
  const r = sandbox.cycleBooleanDay('a', dstr(1));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'future-date');
  assert.deepEqual(localStorage._dump(), before);
});

test('fecha anterior a createdAt: se puede registrar y corregir; createdAt y hoy también; el hábito no cambia', () => {
  const created = dstr(-5);
  const { sandbox, localStorage } = loadApp(seed([habit('a', { createdAt: created })]));
  const habitsBefore = read(localStorage, 'habits');
  const r = sandbox.cycleBooleanDay('a', dstr(-40));
  assert.equal(r.ok, true);
  assert.equal(r.state, 'completed');
  assert.equal(read(localStorage, 'completions')[dstr(-40)].a, true);
  assert.equal(sandbox.cycleBooleanDay('a', dstr(-40)).state, 'skipped');
  assert.equal(sandbox.cycleBooleanDay('a', dstr(-40)).state, 'none');
  assert.equal(read(localStorage, 'completions')[dstr(-40)], undefined);
  assert.equal(read(localStorage, 'skips')[dstr(-40)], undefined);
  assert.deepEqual(read(localStorage, 'habits'), habitsBefore, 'createdAt y el resto del hábito no se tocan');

  assert.equal(sandbox.cycleBooleanDay('a', created).ok, true);
  assert.equal(sandbox.cycleBooleanDay('a', dstr(0)).ok, true);
});

test('un día anterior a createdAt no entra en las estadísticas aunque se registre', () => {
  const created = dstr(-5);
  const { sandbox } = loadApp(seed([habit('a', { createdAt: created })]));
  sandbox.cycleBooleanDay('a', dstr(-40));
  const stats = JSON.parse(JSON.stringify(sandbox.calculateStats(habit('a', { createdAt: created }))));
  assert.equal(stats.totalCompleted, 0);
});

test('fechas invalidas: rechazadas sin tocar nada', () => {
  const { sandbox, localStorage } = loadApp(seed([habit('a')]));
  const before = localStorage._dump();
  for (const bad of ['2026-02-30', '2026-13-01', 'abc', '', '2026-1-5', '20260105', null, undefined, 20260105, {}, [], '__proto__']) {
    const r = sandbox.cycleBooleanDay('a', bad);
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.reason, 'invalid-date', String(bad));
  }
  assert.deepEqual(localStorage._dump(), before);
});

test('habito inexistente: rechazado sin tocar nada', () => {
  const { sandbox, localStorage } = loadApp(seed([habit('a')]));
  const before = localStorage._dump();
  assert.equal(sandbox.cycleBooleanDay('zzz', dstr(-1)).reason, 'unknown-habit');
  assert.equal(sandbox.cycleBooleanDay('', dstr(-1)).reason, 'unknown-habit');
  assert.deepEqual(localStorage._dump(), before);
});

test('un createdAt invalido persistido se migra al cargar, asi que el ciclo nunca opera sobre uno', () => {
  const { sandbox } = loadApp(seed([habit('a', { createdAt: 'no-es-fecha' })]));
  assert.equal(sandbox.cycleBooleanDay('a', dstr(-1)).reason !== 'invalid-created-at', true);
});

test('almacenamiento corrupto: el ciclo no escribe nada', () => {
  const { sandbox, localStorage } = loadApp({ ...seed([habit('a')]), skips: '{no json' });
  const before = localStorage._dump();
  const r = sandbox.cycleBooleanDay('a', dstr(-1));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'storage-corrupted');
  assert.deepEqual(localStorage._dump(), before);
});

test('si la persistencia falla, el estado vuelve al anterior y no queda a medias', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed([habit('a')], { [D]: { a: true } }));
  const before = localStorage._dump();
  const realSetItem = localStorage.setItem.bind(localStorage);
  let failedOnce = false;
  localStorage.setItem = (key, value) => {
    if (key === 'skips' && !failedOnce) { failedOnce = true; throw new Error('fallo sintético'); }
    return realSetItem(key, value);
  };
  const r = sandbox.cycleBooleanDay('a', D);      // completado -> SKIP falla al guardar
  assert.equal(failedOnce, true);
  assert.equal(r.ok, false);
  assert.equal(sandbox.getBooleanDayState('a', D), 'completed');
  const after = localStorage._dump();
  assert.equal(after.completions, before.completions);
  assert.equal(after.skips, before.skips);
  assertNeverBoth(localStorage);
});

// =======================================================================
// 3. Hábitos cuantitativos: comportamiento sin cambios
// =======================================================================
test('cuantitativo: el ciclo no se aplica y no modifica completions, skips ni quantities', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed(
    [quantHabit('q')], {}, {}, { [D]: { q: { actualMinutes: 30, plannedMinutes: null } } }));
  const before = localStorage._dump();
  const r = sandbox.cycleBooleanDay('q', D);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-boolean');
  assert.deepEqual(localStorage._dump(), before);
});

test('cuantitativo: la edicion de minutos sigue funcionando igual', () => {
  const D = dstr(-2);
  const { sandbox, localStorage } = loadApp(seed([quantHabit('q')]));
  sandbox.incrementQuantity('q', D, 15);
  sandbox.setQuantityExact('q', dstr(-3), 0);
  const q = plain(read(localStorage, 'quantities'));
  assert.equal(q[D].q.actualMinutes, 15);
  assert.equal(q[dstr(-3)].q.actualMinutes, 0);
  assert.deepEqual(plain(read(localStorage, 'skips')), {});
});

// =======================================================================
// 4. Interfaz del Calendario (DOM falso)
// =======================================================================
function monthFirstDay() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return probe.toLocalDateStr(d);
}

function renderFor(seedData, habitId) {
  const app = withFakeDom(seedData);
  app.sandbox.goToHabitCalendar(habitId);
  return app;
}

const cellOf = (doc, date) => doc.cells.find(c => c.dataset.date === date);

test('calendario: cada toque en una celda avanza el ciclo y persiste', () => {
  const first = monthFirstDay();
  const { sandbox, doc, localStorage } = renderFor(seed([habit('a')]), 'a');
  assert.ok(cellOf(doc, first), 'la celda del dia 1 debe existir');

  cellOf(doc, first).onclick();
  assert.equal(read(localStorage, 'completions')[first].a, true);
  assert.match(cellOf(doc, first).getAttribute('aria-label') ?? '', /completado/);

  cellOf(doc, first).onclick();
  assert.equal(read(localStorage, 'skips')[first].a, true);
  assert.equal(read(localStorage, 'completions')[first], undefined);
  assert.match(cellOf(doc, first).getAttribute('aria-label') ?? '', /omitido/);
  assert.ok(cellOf(doc, first).classNames.has('skipped'));

  cellOf(doc, first).onclick();
  assert.deepEqual(plain(read(localStorage, 'skips')), {});
  assert.deepEqual(plain(read(localStorage, 'completions')), {});
  assert.match(cellOf(doc, first).getAttribute('aria-label') ?? '', /sin registro/);
  assertNeverBoth(localStorage);
  assert.equal(sandbox.validateExportState().ok, true);
});

test('calendario: un dia importado como SKIP responde al toque', () => {
  const first = monthFirstDay();
  const { doc, localStorage } = renderFor(seed([habit('a')], {}, { [first]: { a: true } }), 'a');
  assert.ok(cellOf(doc, first).classNames.has('skipped'));
  cellOf(doc, first).onclick();
  assert.deepEqual(plain(read(localStorage, 'skips')), {});
  assert.equal(read(localStorage, 'completions') && Object.keys(read(localStorage, 'completions')).length, 0);
});

test('calendario: etiquetas accesibles dicen el estado actual y lo que hara el toque', () => {
  const first = monthFirstDay();
  const { sandbox, doc } = renderFor(seed([habit('a')]), 'a');
  const h = habit('a');
  const label = cellOf(doc, first).getAttribute('aria-label');
  assert.match(label, /sin registro/);
  assert.match(label, /Tocar para marcar como completado/);
  assert.equal(cellOf(doc, first).getAttribute('role'), 'button');
  assert.equal(cellOf(doc, first).tabIndex, 0);

  sandbox.cycleBooleanDay('a', first);
  assert.match(sandbox.getBooleanDayAriaLabel(h, first), /completado\. Tocar para marcar como omitido/);
  sandbox.cycleBooleanDay('a', first);
  assert.match(sandbox.getBooleanDayAriaLabel(h, first), /omitido \(SKIP\)\. Tocar para quitar el registro/);
});

test('calendario: teclado (Enter y espacio) activa la celda; otras teclas no', () => {
  const first = monthFirstDay();
  const { doc, localStorage } = renderFor(seed([habit('a')]), 'a');
  const cell = cellOf(doc, first);
  cell.onkeydown({ key: 'Tab', preventDefault() {} });
  assert.deepEqual(plain(read(localStorage, 'completions')), {});
  let prevented = 0;
  cellOf(doc, first).onkeydown({ key: 'Enter', preventDefault() { prevented++; } });
  assert.equal(read(localStorage, 'completions')[first].a, true);
  cellOf(doc, first).onkeydown({ key: ' ', preventDefault() { prevented++; } });
  assert.equal(read(localStorage, 'skips')[first].a, true);
  assert.equal(prevented, 2);
});

test('calendario: las fechas pasadas (también anteriores a createdAt) son editables y las futuras no cambian al tocar', () => {
  const today = dstr(0);
  const { doc, localStorage } = renderFor(seed([habit('a', { createdAt: today })]), 'a');
  const past = doc.cells.filter(c => c.dataset.date < today);
  const future = doc.cells.filter(c => c.dataset.future === 'true');
  assert.ok(future.length > 0 && past.length > 0);
  for (const c of past) {
    assert.ok(c.classNames.has('before-created'), 'pasada anterior a createdAt lleva su tono propio');
    assert.doesNotMatch(c.getAttribute('aria-label'), /No editable/);
    assert.match(c.getAttribute('aria-label'), /no cuenta en las estadísticas/);
    assert.equal(c.getAttribute('role'), 'button');
    assert.equal(c.tabIndex, 0);
  }
  const before = localStorage._dump();
  for (const c of future) {
    assert.equal(c.classNames.has('before-created'), false);
    assert.match(c.getAttribute('aria-label'), /No editable/);
    assert.notEqual(c.getAttribute('role'), 'button');
    c.onclick();
  }
  assert.deepEqual(localStorage._dump(), before);
  cellOf(doc, dstr(-1)).onclick();
  assert.equal(read(localStorage, 'completions')[dstr(-1)].a, true);
  const todayCell = cellOf(doc, today);
  assert.equal(todayCell.classNames.has('before-created'), false);
  todayCell.onclick();
  assert.equal(read(localStorage, 'completions')[today].a, true);
});

test('calendario: la leyenda aparece para booleanos y se oculta para cuantitativos', () => {
  const first = monthFirstDay();
  let app = renderFor(seed([habit('a'), quantHabit('q')]), 'a');
  assert.equal(app.doc.getElementById('calendarLegend').hidden, false);
  app.sandbox.goToHabitCalendar('q');
  assert.equal(app.doc.getElementById('calendarLegend').hidden, true);
  app.sandbox.goToHabitCalendar('a');
  assert.equal(app.doc.getElementById('calendarLegend').hidden, false);
  assert.ok(first);
});

test('calendario: un cuantitativo sigue abriendo el editor de minutos y no entra en el ciclo', () => {
  const first = monthFirstDay();
  const { doc, localStorage } = renderFor(seed([quantHabit('q')]), 'q');
  const before = localStorage._dump();
  const cell = cellOf(doc, first);
  assert.ok(cell);
  assert.doesNotMatch(cell.getAttribute('aria-label') ?? '', /Tocar para/);
  // navegable con teclado (Enter o espacio abren el editor), igual que los booleanos
  assert.equal(cell.getAttribute('role'), 'button');
  assert.equal(cell.tabIndex, 0);
  cell.onclick();
  assert.equal(doc.getElementById('calendarQuantityEditor').hidden, false);
  assert.deepEqual(localStorage._dump(), before);   // abrir el editor no escribe nada
});

test('calendario: un cuantitativo abre el editor con el teclado y también en fechas anteriores a createdAt', () => {
  const { doc, localStorage } = renderFor(seed([quantHabit('q', { createdAt: dstr(-3) })]), 'q');
  const before = localStorage._dump();
  const cell = cellOf(doc, dstr(-1));
  cell.onkeydown({ key: 'Tab', preventDefault() {} });
  assert.equal(doc.getElementById('calendarQuantityEditor').hidden, true);
  cell.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(doc.getElementById('calendarQuantityEditor').hidden, false);
  // el futuro no es navegable ni abre nada
  const future = doc.cells.find(c => c.dataset.future === 'true');
  assert.notEqual(future.getAttribute('role'), 'button');
  assert.deepEqual(localStorage._dump(), before);
});

test('index.html declara la leyenda del ciclo con los tres estados', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'index.html'), 'utf8');
  assert.match(html, /id="calendarLegend"/);
  assert.match(html, /Sin registro/);
  assert.match(html, /Completado/);
  assert.match(html, /Omitido \(SKIP\)/);
  assert.match(html, /id="calendarLegend"[^>]*aria-label=/);
});

// =======================================================================
// 5. Estadísticas de archivados y regresión de activos
// =======================================================================
function statsOf(sandbox, h) {
  return plain(sandbox.calculateStats(h));
}

function archivedScenario(archived) {
  const created = dstr(-8);
  const done = {};
  for (const off of [-8, -7, -6, -5, -3, -2, -1]) done[dstr(off)] = { a: true };
  const h = habit('a', { createdAt: created, archived });
  const skips = { [dstr(-4)]: { a: true } };
  return { h, app: loadApp(seed([h], done, skips)) };
}

test('archivado: tasa y rachas son "—" (null) y los totales historicos se conservan', () => {
  const { h, app } = archivedScenario(true);
  const s = statsOf(app.sandbox, h);
  assert.equal(s.successRate, null);
  assert.equal(s.currentStreak, null);
  assert.equal(s.bestStreak, null);
  assert.equal(s.currentPeriod, null);
  assert.equal(s.totalCompleted, 7);
  assert.equal(s.skippedDays, 1);
  assert.equal(s.archived, true);
  assert.equal(app.sandbox.formatStatValue(s.successRate, '%'), '—');
});

test('regresion: el mismo habito ACTIVO conserva sus estadisticas numericas', () => {
  const { h, app } = archivedScenario(false);
  const s = statsOf(app.sandbox, h);
  assert.equal(s.totalCompleted, 7);
  assert.equal(s.skippedDays, 1);
  assert.equal(s.successRate, 100);        // el SKIP no cuenta como fallo
  assert.equal(s.currentStreak, 7);
  assert.equal(s.bestStreak, 7);
  assert.notEqual(s.archived, true);
});

test('regresion: habito activo sin SKIP mantiene los valores originales', () => {
  const done = {};
  for (const off of [-8, -7, -6, -5, -3, -2, -1]) done[dstr(off)] = { a: true };
  const h = habit('a', { createdAt: dstr(-8) });
  const s = statsOf(loadApp(seed([h], done)).sandbox, h);
  assert.equal(s.successRate, 88);
  assert.equal(s.currentStreak, 3);
  assert.equal(s.bestStreak, 4);
  assert.equal(s.totalCompleted, 7);
});

test('archivado: la tarjeta muestra "—" en tasa y rachas, conserva el total y explica el motivo', () => {
  const { h, app } = archivedScenario(true);
  const fake = makeFakeDocument();
  app.sandbox.document = fake;
  const text = collectText(app.sandbox.createStatsCard(h));
  assert.match(text, /\(archivado\)/);
  assert.match(text, /Hábito archivado/);
  assert.equal((text.match(/—/g) || []).length >= 3, true);
  assert.match(text, /Total completados/);
  assert.doesNotMatch(text, /NaN|undefined|null/);
});

test('activo: la tarjeta no muestra la nota de archivado', () => {
  const { h, app } = archivedScenario(false);
  app.sandbox.document = makeFakeDocument();
  const text = collectText(app.sandbox.createStatsCard(h));
  assert.doesNotMatch(text, /Hábito archivado/);
});

test('archivado: Calendario y Estadisticas siguen mostrando sus completados y SKIP', () => {
  const first = monthFirstDay();
  const { doc } = renderFor(seed([habit('a', { archived: true })], { [first]: { a: true } }), 'a');
  assert.ok(cellOf(doc, first).classNames.has('completed'));
});
