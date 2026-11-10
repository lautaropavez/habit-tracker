'use strict';
/**
 * Horas + minutos para hábitos cuantitativos de tiempo, formato legible y
 * regresiones de Calendario/Estadísticas tras el rediseño. 100% sintético.
 *
 * Correr con: node --test tests/ux_time/test_time_input.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp } = require('../backup_v2/load_app.js');

// `state` es un const del script (no cuelga del sandbox): se accede por vm.
const run = (sandbox, code) => vm.runInContext(code, sandbox);

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

function walk(el, fn) {
  fn(el);
  el.children.forEach(c => walk(c, fn));
}
function findByClass(el, cls) {
  let found = null;
  walk(el, (n) => {
    if (!found && String(n.className).split(/\s+/).includes(cls)) found = n;
  });
  return found;
}
function allText(el) {
  const out = [];
  walk(el, (n) => { if (n._text) out.push(n._text); });
  return out.join(' | ');
}

function makeFakeDocument() {
  const byId = new Map();
  return {
    createElement: (tag) => new FakeEl(tag),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeEl('#' + id));
      return byId.get(id);
    },
    tabs: [new FakeEl('tab'), new FakeEl('tab'), new FakeEl('tab')],
    querySelectorAll(selector) {
      if (selector === '.tab') return this.tabs;
      return [];
    },
  };
}

function withFakeDom(seedData) {
  const app = loadApp(seedData);
  const doc = makeFakeDocument();
  app.sandbox.document = doc;
  return { ...app, doc };
}

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
const quant = (id, target, extra) => habit(id, {
  freq: 'custom', kind: 'quantitative', unit: 'minutes',
  target: target === null ? null : { minutes: target }, ...extra,
});
function seed(habits, completions, skips, quantities) {
  return {
    habits: JSON.stringify(habits),
    completions: JSON.stringify(completions || {}),
    quantities: JSON.stringify(quantities || {}),
    skips: JSON.stringify(skips || {}),
  };
}
const q = (m) => ({ actualMinutes: m, plannedMinutes: null });
const D = dstr(-2);
const read = (ls, k) => JSON.parse(ls.getItem(k));

function controlsFor(app, h, date) {
  const el = app.sandbox.createQuantityControls(h, date, false);
  return {
    el,
    hours: findByClass(el, 'quantity-hours-input'),
    minutes: findByClass(el, 'quantity-minutes-input'),
    save: findByClass(el, 'btn-quantity-save'),
    error: findByClass(el, 'quantity-error'),
  };
}

// =======================================================================
// 1. Conversión y formato
// =======================================================================
test('formatMinutesText: formato legible', () => {
  const { sandbox: s } = loadApp();
  assert.equal(s.formatMinutesText(0), '0 min');
  assert.equal(s.formatMinutesText(45), '45 min');
  assert.equal(s.formatMinutesText(60), '1 h');
  assert.equal(s.formatMinutesText(135), '2 h 15 min');
  assert.equal(s.formatMinutesText(1440), '24 h');
  assert.equal(s.formatMinutesText(1501), '25 h 1 min');
  assert.equal(s.formatMinutesText(-5), '0 min');
  assert.equal(s.formatMinutesText(NaN), '0 min');
  assert.equal(s.formatMinutesText(1.5), '0 min');
});

test('formatMinutesCompact: versión corta para calendario y gráfico', () => {
  const { sandbox: s } = loadApp();
  assert.equal(s.formatMinutesCompact(45), '45m');
  assert.equal(s.formatMinutesCompact(60), '1h');
  assert.equal(s.formatMinutesCompact(135), '2h15');
  assert.equal(s.formatMinutesCompact(125), '2h05');
});

test('splitMinutes y parseHoursMinutes son inversas para 0..1440', () => {
  const { sandbox: s } = loadApp();
  for (let total = 0; total <= 1440; total++) {
    const sp = s.splitMinutes(total);
    const r = s.parseHoursMinutes(String(sp.hours), String(sp.minutes));
    assert.equal(r.ok, true);
    assert.equal(r.total, total);
  }
});

test('parseHoursMinutes: conversión explícita', () => {
  const { sandbox: s } = loadApp();
  assert.equal(s.parseHoursMinutes('2', '15').total, 135);
  assert.equal(s.parseHoursMinutes('0', '0').total, 0);
  assert.equal(s.parseHoursMinutes(1, 5).total, 65);
  assert.equal(s.parseHoursMinutes(' 3 ', ' 07 ').total, 187);
});

// =======================================================================
// 2. Límites
// =======================================================================
test('parseHoursMinutes: límites 0-24 horas y 0-59 minutos', () => {
  const { sandbox: s } = loadApp();
  assert.equal(s.parseHoursMinutes('24', '0').ok, true);
  assert.equal(s.parseHoursMinutes('24', '00').total, 1440);
  assert.equal(s.parseHoursMinutes('23', '59').total, 1439);
  assert.equal(s.parseHoursMinutes('0', '59').ok, true);
  assert.equal(s.parseHoursMinutes('25', '0').ok, false);
  assert.equal(s.parseHoursMinutes('0', '60').ok, false);
  assert.equal(s.parseHoursMinutes('-1', '0').ok, false);
  assert.equal(s.parseHoursMinutes('0', '-1').ok, false);
});

test('parseHoursMinutes: con 24 horas los minutos deben ser 00 (tope 1440 minutos)', () => {
  const { sandbox: s } = loadApp();
  for (const m of ['1', '01', '30', '59']) {
    const r = s.parseHoursMinutes('24', m);
    assert.equal(r.ok, false, `24:${m}`);
    assert.match(r.error, /24 horas/);
  }
  // Ningún par válido supera 1440 minutos.
  let max = 0;
  for (let h = 0; h <= 99; h++) for (let m = 0; m <= 99; m++) {
    const r = s.parseHoursMinutes(String(h), String(m));
    if (r.ok) max = Math.max(max, r.total);
  }
  assert.equal(max, 1440);
});

test('parseHoursMinutes: máximo dos dígitos por campo, sin truncar en silencio', () => {
  const { sandbox: s } = loadApp();
  for (const [h, m] of [['001', '0'], ['0', '000'], ['100', '0'], ['0', '100'], ['1234', '5']]) {
    const r = s.parseHoursMinutes(h, m);
    assert.equal(r.ok, false, `${h}/${m}`);
    assert.match(r.error, /dos dígitos/);
  }
  assert.equal(s.parseHoursMinutes('02', '05').total, 125);
});

test('parseHoursMinutes: rechaza vacíos, decimales, notación y basura', () => {
  const { sandbox: s } = loadApp();
  for (const [h, m] of [['', '5'], ['1', ''], ['', ''], ['1.5', '0'], ['0', '1.5'], ['1e1', '0'],
    ['0x10', '0'], ['abc', '0'], ['0', 'NaN'], ['+1', '0'], ['9999', '0'], ['1:', '0'], ['1', '1:5'], [null, '5'], [undefined, undefined]]) {
    assert.equal(s.parseHoursMinutes(h, m).ok, false, `${h}/${m} debería rechazarse`);
  }
});

// =======================================================================
// 3. Controles: guardar, validar y no perder datos
// =======================================================================
test('controles: muestran el valor existente dividido en horas y minutos', () => {
  const h = quant('t', 180);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(135) } }));
  const c = controlsFor(app, h, D);
  assert.equal(c.hours.value, '02');
  assert.equal(c.minutes.value, '15');
  assert.match(allText(c.el), /2 h 15 min \/ 3 h/);
  assert.equal(c.hours.placeholder, 'HH');
  assert.equal(c.minutes.placeholder, 'MM');
  assert.equal(c.hours.maxLength, undefined);
});

test('controles: HH : MM compactos, sin texto permanente de límites y sin error visible al inicio', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(125) } }));
  const c = controlsFor(app, h, D);
  assert.equal(c.error.hidden, true);
  assert.equal(c.error.textContent, '');
  assert.ok(findByClass(c.el, 'quantity-time-sep'));
  const text = allText(c.el);
  assert.doesNotMatch(text, /0 a 24|0 a 59|máximo|1440|segundos/i);
  assert.equal(c.hours.value, '02');
  assert.equal(c.minutes.value, '05');
});

test('controles: un error se limpia al guardar bien después de corregir', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h]));
  const c = controlsFor(app, h, D);
  c.hours.value = '24';
  c.minutes.value = '30';
  c.save.onclick();
  assert.equal(c.error.hidden, false);
  assert.equal(read(app.localStorage, 'quantities')[D], undefined);
  c.minutes.value = '00';
  c.save.onclick();
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 1440);
});

test('controles: guardar 1 h 5 min persiste 65 minutos y conserva plannedMinutes', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: { actualMinutes: 10, plannedMinutes: 30 } } }));
  const c = controlsFor(app, h, D);
  c.hours.value = '1';
  c.minutes.value = '5';
  c.save.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(read(app.localStorage, 'quantities')[D].t)),
    { actualMinutes: 65, plannedMinutes: 30 });
});

test('controles: valores inválidos no escriben nada y muestran el error', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(40) } }));
  const before = app.localStorage.getItem('quantities');
  for (const [hh, mm] of [['24', '1'], ['25', '0'], ['0', '60'], ['', '10'], ['1', ''], ['-1', '0'], ['1.5', '0']]) {
    const c = controlsFor(app, h, D);
    c.hours.value = hh;
    c.minutes.value = mm;
    c.save.onclick();
    assert.equal(c.error.hidden, false, `${hh}/${mm}`);
    assert.ok(c.error.textContent.length > 0);
    assert.equal(app.localStorage.getItem('quantities'), before);
  }
});

test('controles: Enter guarda; otras teclas no', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(10) } }));
  const c = controlsFor(app, h, D);
  c.hours.value = '0';
  c.minutes.value = '20';
  c.minutes.onkeydown({ key: 'a', preventDefault() {} });
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 10);
  c.minutes.onkeydown({ key: 'Enter', preventDefault() {} });
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 20);
});

test('controles: guardar sin cambios no escribe (no crea un 0 explícito)', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h]));
  const c = controlsFor(app, h, D);
  c.save.onclick();
  assert.deepEqual(read(app.localStorage, 'quantities'), {});
});

test('controles: se puede corregir a 0 h 0 min de forma explícita', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(30) } }));
  const c = controlsFor(app, h, D);
  c.hours.value = '0';
  c.minutes.value = '0';
  c.save.onclick();
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 0);
});

test('controles: un registro histórico mayor a 24 h se muestra y no se pierde al intentar guardarlo sin corregir', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(1530) } }));
  const c = controlsFor(app, h, D);
  assert.equal(c.hours.value, '25');
  assert.equal(c.minutes.value, '30');
  assert.match(allText(c.el), /25 h 30 min/);
  // Registros todavía mayores (3 dígitos de horas) tampoco se recortan.
  const big = controlsFor(withFakeDom(seed([h], {}, {}, { [D]: { t: q(6060) } })), h, D);
  assert.equal(big.hours.value, '101');
  c.save.onclick();
  assert.equal(c.error.hidden, false);
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 1530);
});

test('controles: con almacenamiento corrupto los campos y el botón quedan deshabilitados', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h]));
  const el = app.sandbox.createQuantityControls(h, D, true);
  assert.equal(findByClass(el, 'quantity-hours-input').disabled, true);
  assert.equal(findByClass(el, 'quantity-minutes-input').disabled, true);
  assert.equal(findByClass(el, 'btn-quantity-save').disabled, true);
});

test('controles: +5 / -5 siguen funcionando junto a los campos', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(58) } }));
  app.sandbox.incrementQuantity('t', D, 5);
  assert.equal(read(app.localStorage, 'quantities')[D].t.actualMinutes, 63);
  const c = controlsFor(app, h, D);
  assert.equal(c.hours.value, '01');
  assert.equal(c.minutes.value, '03');
});

// =======================================================================
// 4. Persistencia y compatibilidad con Backup v3
// =======================================================================
test('persistencia: la cantidad guardada sobrevive a una recarga de la app', () => {
  const h = quant('t', 90);
  const app = withFakeDom(seed([h]));
  const c = controlsFor(app, h, D);
  c.hours.value = '1';
  c.minutes.value = '45';
  c.save.onclick();
  const reloaded = loadApp(app.localStorage._dump());
  assert.equal(reloaded.sandbox.getActualMinutes('t', D), 105);
});

test('backup v3: export con horas/minutos es válido, sin campos nuevos, y reimporta idéntico', () => {
  const h = quant('t', 120);
  const app = withFakeDom(seed([h]));
  const c = controlsFor(app, h, D);
  c.hours.value = '2';
  c.minutes.value = '15';
  c.save.onclick();
  const built = JSON.parse(JSON.stringify(app.sandbox.buildBackupV3()));
  assert.equal(built.schemaVersion, 3);
  assert.deepEqual(built.quantities[D].t, { actualMinutes: 135, plannedMinutes: null });
  const raw = JSON.stringify(built);
  const v = app.sandbox.validateBackup(raw);
  assert.equal(v.ok, true);
  assert.equal(built.habits[0].unit, 'minutes');
});

test('registros históricos importados (incluido 0 explícito y más de 24 h) se muestran legibles', () => {
  const h = quant('t', null);
  const { sandbox: s } = loadApp(seed([h], {}, {}, {
    [dstr(-3)]: { t: q(0) }, [dstr(-2)]: { t: q(135) }, [dstr(-1)]: { t: q(1530) },
  }));
  assert.equal(s.formatMinutesText(s.getActualMinutes('t', dstr(-3))), '0 min');
  assert.equal(s.formatMinutesText(s.getActualMinutes('t', dstr(-2))), '2 h 15 min');
  assert.equal(s.formatMinutesText(s.getActualMinutes('t', dstr(-1))), '25 h 30 min');
});

// =======================================================================
// 5. Regresiones de Calendario y Estadísticas
// =======================================================================
test('calendario: la celda cuantitativa muestra el tiempo compacto y el número del día en su propio span', () => {
  const h = quant('t', 120);
  const app = withFakeDom(seed([h], {}, {}, { [dstr(0)]: { t: q(135) } }));
  run(app.sandbox, "state.selectedHabitId = 't'");
  app.sandbox.renderCalendar();
  const html = app.doc.getElementById('calendarGrid').innerHTML;
  assert.match(html, /calendar-day-num/);
  assert.match(html, /calendar-day-qty" aria-hidden="true">2h15</);
  assert.match(html, /quantity-met/);
});

test('calendario: tocar un día cuantitativo sigue abriendo el editor con los dos campos', () => {
  const h = quant('t', null);
  const app = withFakeDom(seed([h], {}, {}, { [D]: { t: q(75) } }));
  run(app.sandbox, `state.selectedHabitId = 't'; state.calendarEditingDate = '${D}'`);
  app.sandbox.renderCalendar();
  const editor = app.doc.getElementById('calendarQuantityEditor');
  assert.equal(editor.hidden, false);
  assert.ok(findByClass(editor, 'quantity-hours-input'));
  assert.equal(findByClass(editor, 'quantity-minutes-input').value, '15');
  assert.equal(findByClass(editor, 'quantity-hours-input').value, '01');
});

test('calendario booleano: sigue el ciclo y los símbolos conservan su badge', () => {
  const h = habit('b');
  const app = withFakeDom(seed([h]));
  assert.equal(app.sandbox.cycleBooleanDay('b', D).ok, true);
  assert.match(app.sandbox.getCalendarDayDecoration(D, h).badgeHtml, /✓/);
  assert.equal(app.sandbox.cycleBooleanDay('b', D).ok, true);
  assert.match(app.sandbox.getCalendarDayDecoration(D, h).badgeHtml, /↷/);
  assert.equal(app.sandbox.cycleBooleanDay('b', D).ok, true);
  assert.equal(app.sandbox.getCalendarDayDecoration(D, h).badgeHtml, '');
  assert.equal(app.sandbox.cycleBooleanDay('b', dstr(1)).ok, false);
});

test('estadísticas cuantitativas: tarjetas con formato legible y gráfico con valores', () => {
  const h = quant('t', 120, { createdAt: dstr(-10) });
  const app = withFakeDom(seed([h], {}, {}, {
    [dstr(0)]: { t: q(135) }, [dstr(-1)]: { t: q(60) }, [dstr(-2)]: { t: q(45) },
  }));
  const card = app.sandbox.createStatsCard(h);
  const text = allText(card);
  assert.match(text, /2 h 15 min/);
  assert.match(text, /Tiempo hoy/);
  assert.match(text, /Objetivo diario/);
  assert.match(text, /4 h/);
  assert.ok(findByClass(card, 'chart-bar-track'));
  assert.match(findByClass(card, 'chart-bars').attrs['aria-label'], /3 días con tiempo registrado, 4 h en total/);
});

test('estadísticas booleanas: loop-month y archivado siguen en "—" y SKIP se cuenta', () => {
  const lm = habit('lm', { freq: 'custom', freqCount: 27, freqPeriod: 'loop-month', freqWindowDays: 30 });
  const ar = habit('ar', { archived: true });
  const sk = habit('sk', { createdAt: dstr(-10) });
  const app = withFakeDom(seed([lm, ar, sk], { [dstr(-1)]: { lm: true, ar: true } }, { [dstr(-2)]: { sk: true } }));
  const s = app.sandbox;
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.equal(plain(s.calculateStats(lm)).successRate, null);
  assert.equal(plain(s.calculateStats(ar)).successRate, null);
  assert.equal(plain(s.calculateStats(ar)).currentStreak, null);
  assert.equal(plain(s.calculateStats(sk)).skippedDays, 1);
  assert.match(allText(s.createStatsCard(sk)), /Días omitidos \(SKIP\)/);
  assert.ok(findByClass(s.createStatsCard(sk), 'chart-bar-track'));
});

test('cantidades: la unidad única sigue siendo minutos y el esquema persistido no cambia', () => {
  const h = quant('t', 60);
  const app = withFakeDom(seed([h]));
  const c = controlsFor(app, h, D);
  c.hours.value = '0';
  c.minutes.value = '30';
  c.save.onclick();
  const stored = read(app.localStorage, 'quantities')[D].t;
  assert.deepEqual(Object.keys(stored).sort(), ['actualMinutes', 'plannedMinutes']);
  assert.equal(read(app.localStorage, 'habits')[0].unit, 'minutes');
});

// =======================================================================
// 6. Gráfico de los últimos 30 días
// =======================================================================
function chartOf(app, h) {
  const card = app.sandbox.createStatsCard(h);
  const bars = findByClass(card, 'chart-bars');
  const wrappers = bars.children;
  return {
    card, bars, wrappers,
    bar: (i) => findByClass(wrappers[i], 'chart-bar'),
    title: findByClass(card, 'chart-title').textContent,
  };
}
const barClasses = (el) => String(el.className).split(/\s+/).concat([...el.classNames]);

test('gráfico: título "Últimos 30 días" y 30 barras en orden cronológico terminando hoy', () => {
  const h = habit('a', { createdAt: dstr(-60) });
  const app = withFakeDom(seed([h], { [dstr(-29)]: { a: true }, [dstr(0)]: { a: true } }));
  const c = chartOf(app, h);
  assert.equal(c.title, 'Últimos 30 días');
  assert.doesNotMatch(allText(c.card), /Semanal|Mensual|7 días/);
  assert.equal(c.wrappers.length, 30);
  assert.equal(c.wrappers[0].title.startsWith(`${Number(dstr(-29).slice(8))} de `), true);
  assert.match(c.wrappers[0].title, /completado/);
  assert.match(c.wrappers[29].title, /completado/);
  assert.equal(c.bar(0).style.height, '100%');
  assert.equal(c.bar(29).style.height, '100%');
  assert.ok(c.wrappers[29].classNames.has('chart-bar-today'));
  assert.equal(c.wrappers.filter(w => w.classNames.has('chart-bar-today')).length, 1);
});

test('gráfico: completados, SKIP, sin registro y antes de crear se distinguen', () => {
  const h = habit('a', { createdAt: dstr(-10) });
  const app = withFakeDom(seed([h], { [dstr(-1)]: { a: true } }, { [dstr(-2)]: { a: true } }));
  const c = chartOf(app, h);
  assert.equal(c.bar(28).style.height, '100%');
  assert.ok(barClasses(c.bar(27)).includes('chart-bar-skipped'));
  assert.equal(c.bar(27).style.height, '30%');
  assert.ok(barClasses(c.bar(26)).includes('chart-bar-empty'));
  assert.ok(barClasses(c.bar(5)).includes('chart-bar-na'));
  assert.match(c.wrappers[5].title, /antes de crear/);
  assert.match(c.wrappers[26].title, /sin registro/);
  assert.match(c.wrappers[27].title, /omitido/);
});

test('gráfico: un registro anterior a createdAt no se oculta', () => {
  const h = habit('a', { createdAt: dstr(-3) });
  const app = withFakeDom(seed([h], { [dstr(-10)]: { a: true } }));
  const c = chartOf(app, h);
  assert.equal(c.bar(19).style.height, '100%');
  assert.match(c.wrappers[19].title, /completado/);
});

test('gráfico: solo 5 etiquetas de fecha, bien repartidas, la última es "Hoy"', () => {
  const h = habit('a', { createdAt: dstr(-60) });
  const app = withFakeDom(seed([h]));
  const c = chartOf(app, h);
  const ticks = c.wrappers.map((w, i) => [i, findByClass(w, 'chart-label').textContent]).filter(([, t]) => t);
  assert.deepEqual(ticks.map(([i]) => i), [0, 7, 14, 21, 29]);
  assert.equal(ticks[4][1], 'Hoy');
  assert.match(ticks[0][1], /^\d{1,2} (ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)$/);
});

test('gráfico: descripción accesible resume el período', () => {
  const h = habit('a', { createdAt: dstr(-60) });
  const app = withFakeDom(seed([h], { [dstr(-1)]: { a: true }, [dstr(-4)]: { a: true } }, { [dstr(-2)]: { a: true } }));
  const c = chartOf(app, h);
  assert.equal(c.bars.attrs.role, 'img');
  assert.equal(c.bars.attrs['aria-label'], 'Últimos 30 días: 2 días completados, 1 omitido (SKIP).');
});

test('gráfico: loop-month, semanal y archivado muestran solo el dato diario y sus métricas no cambian', () => {
  const lm = habit('lm', { freq: 'custom', freqCount: 27, freqPeriod: 'loop-month', freqWindowDays: 30, createdAt: dstr(-60) });
  const wk = habit('wk', { freq: 'custom', freqCount: 3, freqPeriod: 'week', createdAt: dstr(-60) });
  const ar = habit('ar', { archived: true, createdAt: dstr(-60) });
  const done = { [dstr(-1)]: { lm: true, wk: true, ar: true } };
  const app = withFakeDom(seed([lm, wk, ar], done));
  for (const h of [lm, wk, ar]) {
    const c = chartOf(app, h);
    assert.equal(c.wrappers.length, 30);
    assert.equal(c.bar(28).style.height, '100%');
  }
  const plain = (v) => JSON.parse(JSON.stringify(v));
  assert.equal(plain(app.sandbox.calculateStats(lm)).successRate, null);
  assert.equal(plain(app.sandbox.calculateStats(ar)).successRate, null);
  assert.equal(plain(app.sandbox.calculateStats(wk)).totalCompleted, 1);
  assert.match(allText(app.sandbox.createStatsCard(lm)), /Frecuencia original de Loop/);
  assert.match(allText(app.sandbox.createStatsCard(ar)), /Hábito archivado/);
});

test('gráfico de tiempo: escala por objetivo o por el máximo, 30 barras y resumen en tiempo legible', () => {
  const withTarget = quant('t', 120, { createdAt: dstr(-40) });
  const noTarget = quant('n', null, { createdAt: dstr(-40) });
  const app = withFakeDom(seed([withTarget, noTarget], {}, {}, {
    [dstr(0)]: { t: q(60), n: q(30) }, [dstr(-1)]: { t: q(240), n: q(90) },
  }));
  let c = chartOf(app, withTarget);
  assert.equal(c.wrappers.length, 30);
  assert.equal(c.bar(29).style.height, '50%');
  assert.equal(c.bar(28).style.height, '100%');
  assert.match(c.bars.attrs['aria-label'], /2 días con tiempo registrado, 5 h en total/);
  assert.match(c.wrappers[28].title, /4 h/);
  c = chartOf(app, noTarget);
  assert.equal(c.bar(28).style.height, '100%');
  assert.equal(c.bar(29).style.height, '33%');
});

test('gráfico: no cambia las demás métricas de la tarjeta', () => {
  const h = habit('a', { createdAt: dstr(-10) });
  const app = withFakeDom(seed([h], { [dstr(-1)]: { a: true }, [dstr(-2)]: { a: true } }, { [dstr(-3)]: { a: true } }));
  const text = allText(app.sandbox.createStatsCard(h));
  for (const label of ['Tasa de éxito', 'Racha actual', 'Mejor racha', 'Total completados', 'Días omitidos \\(SKIP\\)']) {
    assert.match(text, new RegExp(label));
  }
});

// =======================================================================
// 7. Formulario: "¿Cómo querés registrarlo?"
// =======================================================================
function kindParts(app) {
  const group = app.doc.getElementById('kindOptions');
  const select = findByClass(group, 'kind-select');
  return {
    select,
    help: findByClass(group, 'kind-help'),
    note: findByClass(group, 'kind-readonly-note'),
    options: select.children,
    text: allText(group),
  };
}

test('formulario: nuevo hábito ofrece las dos formas de registro con textos definitivos', () => {
  const app = withFakeDom(seed([]));
  app.sandbox.openModal();
  const k = kindParts(app);
  assert.deepEqual(k.options.map(o => [o.value, o.textContent]),
    [['boolean', 'Marcar como completado'], ['quantitative', 'Registrar tiempo']]);
  assert.equal(k.select.value, 'boolean');
  assert.equal(k.select.disabled, false);
  assert.equal(k.help.textContent, 'Cada día marcás si cumpliste tu hábito.');
  assert.doesNotMatch(k.text, /booleano|cuantitativo|realizado o no/i);
  assert.equal(k.select.attrs['aria-describedby'], 'kindHelp');
});

test('formulario: elegir "Registrar tiempo" cambia la ayuda, muestra el objetivo y guarda el tipo interno', () => {
  const app = withFakeDom(seed([]));
  app.sandbox.openModal();
  let k = kindParts(app);
  k.select.value = 'quantitative';
  k.select.onchange();
  k = kindParts(app);
  assert.equal(k.select.value, 'quantitative');
  assert.equal(k.help.textContent, 'Anotá las horas y minutos que le dedicaste.');
  assert.equal(app.doc.getElementById('targetGroup').hidden, false);
  app.doc.getElementById('habitName').value = 'Estudiar';
  app.sandbox.saveHabit();
  const saved = JSON.parse(app.localStorage.getItem('habits'));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].kind, 'quantitative');
  assert.equal(saved[0].unit, 'minutes');
});

test('formulario: volver a "Marcar como completado" oculta el objetivo y guarda un booleano', () => {
  const app = withFakeDom(seed([]));
  app.sandbox.openModal();
  let k = kindParts(app);
  k.select.value = 'quantitative';
  k.select.onchange();
  k = kindParts(app);
  k.select.value = 'boolean';
  k.select.onchange();
  assert.equal(app.doc.getElementById('targetGroup').hidden, true);
  app.doc.getElementById('habitName').value = 'Meditar';
  app.sandbox.saveHabit();
  const saved = JSON.parse(app.localStorage.getItem('habits'))[0];
  assert.equal(saved.kind, 'boolean');
  assert.equal('unit' in saved, false);
});

test('formulario: al editar, la forma de registro se ve pero no se puede cambiar', () => {
  const h = quant('t', 60);
  const b = habit('b');
  const app = withFakeDom(seed([h, b]));
  app.sandbox.editHabit('t');
  let k = kindParts(app);
  assert.equal(k.select.value, 'quantitative');
  assert.equal(k.select.disabled, true);
  assert.equal(k.select.onchange, undefined);
  assert.match(k.note.textContent, /no se puede cambiar/);
  assert.equal(k.help.textContent, 'Anotá las horas y minutos que le dedicaste.');
  app.sandbox.editHabit('b');
  k = kindParts(app);
  assert.equal(k.select.value, 'boolean');
  assert.equal(k.select.disabled, true);
  assert.doesNotMatch(k.text, /booleano|cuantitativo/i);
});

test('formulario: editar un hábito de tiempo conserva su tipo, unidad y objetivo', () => {
  const h = quant('t', 90);
  const app = withFakeDom(seed([h]));
  app.sandbox.editHabit('t');
  app.doc.getElementById('habitName').value = 'Estudio';
  app.sandbox.saveHabit();
  const saved = JSON.parse(app.localStorage.getItem('habits'))[0];
  assert.equal(saved.kind, 'quantitative');
  assert.equal(saved.unit, 'minutes');
  assert.deepEqual(saved.target, { minutes: 90 });
  assert.equal(saved.name, 'Estudio');
});

// =======================================================================
// 8. Auditoría: edición sin pérdida de minutos y gráfico con históricos
// =======================================================================
test('editar un hábito de tiempo no toca sus minutos, incluidos ceros explícitos y registros de más de 24 h', () => {
  const h = quant('t', 90);
  const quantities = {
    [dstr(-1)]: { t: q(135) }, [dstr(-2)]: { t: { actualMinutes: 0, plannedMinutes: null } },
    [dstr(-3)]: { t: q(1600) },
  };
  const app = withFakeDom(seed([h], {}, {}, quantities));
  const before = app.localStorage.getItem('quantities');
  app.sandbox.editHabit('t');
  app.doc.getElementById('habitName').value = 'Estudio 2';
  app.sandbox.saveHabit();
  assert.equal(app.localStorage.getItem('quantities'), before);
  assert.equal(read(app.localStorage, 'habits')[0].name, 'Estudio 2');
});

test('freqCount inválido en localStorage no llega al innerHTML del modal y no se reescribe al abrirlo', () => {
  const payload = '"><img src=x onerror=alert(1)>';
  const bad = habit('x', { freq: 'custom', freqPeriod: 'week', freqCount: payload });
  const app = withFakeDom(seed([bad]));
  const before = app.localStorage.getItem('habits');
  app.sandbox.editHabit('x');
  const html = app.doc.getElementById('freqOptions').innerHTML;
  assert.doesNotMatch(html, /onerror|<img/);
  assert.match(html, /id="freqCountInput"/);
  assert.match(html, /value="7"/);
  assert.equal(app.localStorage.getItem('habits'), before, 'abrir el modal no modifica el registro histórico');
  // aunque el estado se contamine por otra vía, solo un entero llega al atributo
  run(app.sandbox, `state.freqCount = ${JSON.stringify(payload)}; renderModalContent();`);
  const html2 = app.doc.getElementById('freqOptions').innerHTML;
  assert.doesNotMatch(html2, /onerror|<img/);
  assert.match(html2, /value=""/);
});

test('freqCount válido (1 a 30) se sigue mostrando tal cual al editar', () => {
  const ok = habit('y', { freq: 'custom', freqPeriod: 'month', freqCount: 12 });
  const app = withFakeDom(seed([ok]));
  app.sandbox.editHabit('y');
  assert.match(app.doc.getElementById('freqOptions').innerHTML, /value="12"/);
});

test('gráfico de tiempo: un registro de más de 24 h se muestra completo y no desborda la barra', () => {
  const h = quant('t', 120, { createdAt: dstr(-40) });
  const app = withFakeDom(seed([h], {}, {}, { [dstr(-1)]: { t: q(1600) } }));
  const c = chartOf(app, h);
  assert.equal(c.bar(28).style.height, '100%');
  assert.match(c.wrappers[28].title, /26 h 40 min/);
  assert.match(c.bars.attrs['aria-label'], /1 día con tiempo registrado, 26 h 40 min en total/);
});
