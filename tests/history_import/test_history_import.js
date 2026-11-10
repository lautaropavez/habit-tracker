'use strict';
/**
 * Importador de historial de tiempo (JSON versión 1): validación, plan,
 * conflictos, createdAt, aplicación atómica con rollback y vista previa.
 * 100% sintético: ningún archivo ni dato real.
 *
 * Correr con: node --test tests/history_import/test_history_import.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');
const { withFakeDom, findByClass, findAllByClass, allText } = require('../helpers/fake_dom.js');

const habit = (id, extra) => ({
  id, name: 'Estudio', icon: '📚', color: '#4ECDC4', freq: 'custom', freqCount: 1, freqPeriod: 'week',
  createdAt: '2026-03-01', kind: 'quantitative', unit: 'minutes', target: { minutes: 60 }, archived: false, ...extra,
});
const boolHabit = (id, extra) => habit(id, { kind: 'boolean', freq: 'daily', unit: undefined, target: undefined, ...extra });
const seed = (habits, completions, skips, quantities) => ({
  habits: JSON.stringify(habits),
  completions: JSON.stringify(completions || {}),
  quantities: JSON.stringify(quantities || {}),
  skips: JSON.stringify(skips || {}),
});
const q = (m) => ({ actualMinutes: m, plannedMinutes: null });
const read = (ls, k) => JSON.parse(ls.getItem(k));
const plain = (v) => JSON.parse(JSON.stringify(v));
const KEYS = ['habits', 'completions', 'quantities', 'skips'];
const raw4 = (ls) => Object.fromEntries(KEYS.map(k => [k, ls.getItem(k)]));

function file(records, extra) {
  const dates = Object.keys(records).sort();
  return {
    version: 1, habit: 'Estudio', unit: 'minutes',
    range: { from: dates[0], to: dates[dates.length - 1] }, records, ...extra,
  };
}
const MIX = { '2025-10-01': 95, '2025-10-02': 0, '2025-10-03': 'SKIP', '2025-10-05': 30 };
const validate = (obj) => loadApp().sandbox.validateHistoryFile(typeof obj === 'string' ? obj : JSON.stringify(obj));
const snapOf = (app) => ({
  habits: JSON.parse(app.localStorage.getItem('habits') || '[]'),
  completions: JSON.parse(app.localStorage.getItem('completions') || '{}'),
  quantities: JSON.parse(app.localStorage.getItem('quantities') || '{}'),
  skips: JSON.parse(app.localStorage.getItem('skips') || '{}'),
});

// =======================================================================
// 1. Validación del archivo
// =======================================================================
test('archivo válido: minutos positivos, cero explícito, SKIP y mezcla', () => {
  const r = validate(file(MIX));
  assert.equal(r.ok, true, r.fatal);
  assert.deepEqual(plain(r.data.records), [
    { date: '2025-10-01', kind: 'minutes', minutes: 95 },
    { date: '2025-10-02', kind: 'minutes', minutes: 0 },
    { date: '2025-10-03', kind: 'skip', minutes: null },
    { date: '2025-10-05', kind: 'minutes', minutes: 30 },
  ]);
  assert.equal(r.data.from, '2025-10-01');
  assert.equal(r.data.habitName, 'Estudio');
  // cada tipo por separado
  assert.equal(validate(file({ '2025-10-01': 95 })).ok, true);
  assert.equal(validate(file({ '2025-10-01': 0 })).ok, true);
  assert.equal(validate(file({ '2025-10-01': 'SKIP' })).ok, true);
  assert.equal(validate('﻿' + JSON.stringify(file(MIX))).ok, true, 'tolera BOM');
});

test('archivo inválido: JSON roto, raíz o campos incorrectos se rechazan completos', () => {
  const bad = (input, re) => {
    const r = validate(input);
    assert.equal(r.ok, false, JSON.stringify(input).slice(0, 80));
    assert.equal(r.data, null);
    assert.match(r.fatal, re);
  };
  bad('{no json', /no es JSON/);
  bad('[]', /objeto/);
  bad('null', /objeto/);
  bad('"texto"', /objeto/);
  bad(file(MIX, { version: 2 }), /Versión no admitida/);
  bad(file(MIX, { version: '1' }), /Versión no admitida/);
  bad(file(MIX, { unit: 'hours' }), /minutes/);
  bad(file(MIX, { unit: undefined }), /Falta el campo "unit"/);
  bad(file(MIX, { extra: 1 }), /Campo desconocido/);
  bad(file(MIX, { habit: '' }), /nombre del hábito/);
  bad(file(MIX, { habit: 5 }), /nombre del hábito/);
  bad(file(MIX, { range: { from: '2025-10-01' } }), /exactamente "from" y "to"/);
  bad(file(MIX, { range: { from: '2025-10-09', to: '2025-10-01' } }), /posterior/);
  bad(file(MIX, { records: [] }), /"records" debe ser un objeto/);
  bad(file(MIX, { records: 'x' }), /"records" debe ser un objeto/);
  bad(file({}, { range: { from: '2025-10-01', to: '2025-10-02' } }), /no contiene registros/);
});

test('fecha inválida: calendario inexistente, formato incorrecto y claves de prototipo', () => {
  const bad = (date) => {
    const r = validate(file({ '2025-10-01': 5 }, { records: { '2025-10-01': 5, [date]: 5 }, range: { from: '2025-01-01', to: '2025-12-31' } }));
    assert.equal(r.ok, false, date);
    assert.match(r.fatal, /Fecha inválida/);
  };
  for (const d of ['2025-02-30', '2023-02-29', '2025-13-01', '2025-1-5', '05/10/2025', '20251001', 'hoy', '']) bad(d);
  const proto = validate('{"version":1,"habit":"E","unit":"minutes","range":{"from":"2025-01-01","to":"2025-12-31"},"records":{"__proto__":5}}');
  assert.equal(proto.ok, false);
  assert.equal(({}).polluted, undefined);
});

test('fecha futura: en un registro o en el rango se rechaza el archivo entero', () => {
  const future = loadApp().sandbox.toLocalDateStr(new Date(Date.now() + 3 * 86400000));
  const r1 = validate(file({ '2025-10-01': 5, [future]: 5 }));
  assert.equal(r1.ok, false);
  assert.match(r1.fatal, /futur/);
  const r2 = validate(file({ '2025-10-01': 5 }, { range: { from: '2025-10-01', to: future } }));
  assert.equal(r2.ok, false);
  assert.match(r2.fatal, /futura/);
});

test('fecha fuera del rango declarado se rechaza', () => {
  const r = validate(file({ '2025-10-01': 5, '2025-12-01': 5 }, { range: { from: '2025-10-01', to: '2025-11-01' } }));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /fuera del rango/);
});

test('valores inválidos: float, negativo, texto, null, booleano, "skip" en minúscula, más de 24 h', () => {
  for (const v of [1.5, -1, -0.5, '95', null, true, false, 'skip', 'Skip', ' SKIP', [], {}, 1441, 99999, 1e21]) {
    const r = validate(file({ '2025-10-01': 5, '2025-10-02': v }));
    assert.equal(r.ok, false, JSON.stringify(v));
    assert.equal(r.data, null);
    assert.match(r.fatal, /Valor inválido|supera las 24 horas/);
  }
  // NaN e Infinity no existen en JSON: el texto crudo también se rechaza
  assert.equal(validate('{"version":1,"habit":"E","unit":"minutes","range":{"from":"2025-10-01","to":"2025-10-02"},"records":{"2025-10-01":NaN}}').ok, false);
  // límites aceptados
  assert.equal(validate(file({ '2025-10-01': 1440 })).ok, true);
  assert.equal(validate(file({ '2025-10-01': 1439 })).ok, true);
});

test('límites razonables: demasiados registros y archivo demasiado grande', () => {
  const records = {};
  const start = new Date(1960, 0, 1);
  for (let i = 0; i < 20001; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i);
    records[loadApp().sandbox.toLocalDateStr(d)] = 1;
  }
  const dates = Object.keys(records).sort();
  const r = validate(file(records, { range: { from: dates[0], to: dates[dates.length - 1] } }));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /Demasiados registros/);
  const big = JSON.stringify(file(MIX, { habit: 'x'.repeat(3 * 1024 * 1024) }));
  assert.match(validate(big).fatal, /2 MB/);
});

// =======================================================================
// 2. Plan: conflictos, coincidencias y createdAt
// =======================================================================
function plan(app, obj, id = 't') {
  const v = app.sandbox.validateHistoryFile(JSON.stringify(obj));
  assert.equal(v.ok, true, v.fatal);
  return plain(app.sandbox.planHistoryImport(v.data, id, snapOf(app)));
}

test('plan: cuenta registros, positivos, ceros y SKIP, y todo lo libre se importa', () => {
  const app = loadApp(seed([habit('t')]));
  const p = plan(app, file(MIX));
  assert.equal(p.ok, true);
  assert.deepEqual(p.counts, { total: 4, positive: 2, zeros: 1, skips: 1 });
  assert.equal(p.toImportCount, 4);
  assert.equal(p.importMinutes, 125);
  assert.equal(p.skipsToImport, 1);
  assert.equal(p.conflicts.length, 0);
  assert.equal(p.canApply, true);
  assert.equal(p.habitName, 'Estudio');
});

test('conflictos: minutos existentes, cero existente y SKIP existente quedan intactos y se informan', () => {
  const app = loadApp(seed([habit('t')], {}, { '2025-10-03': { t: true } },
    { '2025-10-01': { t: q(10) }, '2025-10-02': { t: q(0) } }));
  const p = plan(app, file(MIX));
  // 10-01 difiere; 10-02 (cero) y 10-03 (SKIP) son idénticos al archivo: aun así son conflicto
  assert.deepEqual(p.conflicts.map(c => c.date), ['2025-10-01', '2025-10-02', '2025-10-03']);
  assert.equal(p.sameCount, 2);
  assert.deepEqual(p.conflicts.map(c => c.identical), [false, true, true]);
  assert.equal(p.conflicts[0].existing, '10 min');
  assert.match(p.conflicts[1].existing, /cero explícito/);
  assert.equal(p.conflicts[2].existing, 'SKIP');
  assert.deepEqual(p.toImport.map(r => r.date), ['2025-10-05']);
});

test('conflictos: incluso un cero entrante contra minutos, o SKIP contra un cero, es conflicto', () => {
  const app = loadApp(seed([habit('t')], {}, {}, { '2025-10-01': { t: q(10) }, '2025-10-03': { t: q(0) } }));
  const p = plan(app, file({ '2025-10-01': 0, '2025-10-03': 'SKIP' }));
  assert.equal(p.conflicts.length, 2);
  assert.equal(p.toImportCount, 0);
  assert.equal(p.canApply, false);
});

test('registros idénticos a los del archivo son conflicto igual (se cuentan aparte) y no se reescriben', () => {
  const app = loadApp(seed([habit('t')], {}, { '2025-10-03': { t: true } },
    { '2025-10-01': { t: q(95) }, '2025-10-02': { t: q(0) } }));
  const p = plan(app, file(MIX));
  assert.equal(p.sameCount, 3);
  assert.equal(p.conflicts.length, 3);
  assert.deepEqual(p.toImport.map(r => r.date), ['2025-10-05']);
});

test('un completado existente (dato ajeno al tipo) también ocupa la fecha', () => {
  const app = loadApp(seed([habit('t')], { '2025-10-01': { t: true } }));
  const p = plan(app, file({ '2025-10-01': 5, '2025-10-02': 5 }));
  assert.deepEqual(p.conflicts.map(c => c.date), ['2025-10-01']);
});

test('createdAt: se adelanta a la fecha importada más antigua y nunca se mueve hacia adelante', () => {
  const early = loadApp(seed([habit('t', { createdAt: '2026-03-01' })]));
  let p = plan(early, file(MIX));
  assert.equal(p.currentCreatedAt, '2026-03-01');
  assert.equal(p.newCreatedAt, '2025-10-01');
  assert.equal(p.createdAtChanges, true);

  const older = loadApp(seed([habit('t', { createdAt: '2024-01-01' })]));
  p = plan(older, file(MIX));
  assert.equal(p.newCreatedAt, '2024-01-01', 'un createdAt anterior no se mueve hacia adelante');
  assert.equal(p.createdAtChanges, false);

  const same = loadApp(seed([habit('t', { createdAt: '2025-10-01' })]));
  assert.equal(plan(same, file(MIX)).createdAtChanges, false);
});

test('createdAt: solo cuentan las fechas que realmente se importan (no las de conflicto)', () => {
  const app = loadApp(seed([habit('t', { createdAt: '2026-03-01' })], {}, {}, { '2025-10-01': { t: q(10) } }));
  const p = plan(app, file(MIX));
  assert.equal(p.newCreatedAt, '2025-10-02');
});

test('destino: archivado, booleano o inexistente se rechazan; el nombre no identifica al hábito', () => {
  const app = loadApp(seed([habit('t', { archived: true }), boolHabit('b'), habit('u')]));
  const v = app.sandbox.validateHistoryFile(JSON.stringify(file(MIX)));
  const planFor = (id) => plain(app.sandbox.planHistoryImport(v.data, id, snapOf(app)));
  assert.match(planFor('t').error, /archivado/);
  assert.match(planFor('b').error, /Registrar tiempo/);
  assert.match(planFor('zz').error, /Elegí el hábito/);
  assert.equal(planFor('u').ok, true);
});

// =======================================================================
// 3. Aplicación atómica
// =======================================================================
function applyOn(app, obj, id = 't') {
  const v = app.sandbox.validateHistoryFile(JSON.stringify(obj));
  assert.equal(v.ok, true, v.fatal);
  const p = app.sandbox.planHistoryImport(v.data, id, snapOf(app));
  return app.sandbox.applyHistoryImport(v.data, id, p.fingerprint);
}

test('aplicar: guarda minutos, cero explícito y SKIP; la ausencia sigue ausente; completados intactos', () => {
  const comp = { '2026-03-02': { b: true } };
  const app = loadApp(seed([habit('t'), boolHabit('b')], comp, {}, {}));
  const before = raw4(app.localStorage);
  const r = applyOn(app, file(MIX));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.imported, 4);
  assert.equal(r.minutes, 125);
  assert.equal(r.skips, 1);
  const quantities = read(app.localStorage, 'quantities');
  assert.deepEqual(quantities['2025-10-01'].t, q(95));
  assert.deepEqual(quantities['2025-10-02'].t, q(0), 'cero explícito, no ausencia');
  assert.equal(quantities['2025-10-03'], undefined, 'SKIP no se guarda como cero');
  assert.equal(quantities['2025-10-04'], undefined, 'fecha ausente sigue ausente');
  assert.deepEqual(quantities['2025-10-05'].t, q(30));
  assert.deepEqual(read(app.localStorage, 'skips'), { '2025-10-03': { t: true } });
  assert.equal(app.localStorage.getItem('completions'), before.completions, 'completions byte a byte igual');
  assert.equal(app.sandbox.validateExportState().ok, true);
  assert.equal(app.localStorage.getItem('habitTracker.import.state.v1'), null, 'sin marcador pendiente');
});

test('aplicar: createdAt se adelanta, el resto del hábito y los demás hábitos no cambian', () => {
  const app = loadApp(seed([habit('t'), boolHabit('b', { createdAt: '2026-01-01' })]));
  const beforeHabits = read(app.localStorage, 'habits');
  const r = applyOn(app, file(MIX));
  assert.equal(r.createdAtChanged, true);
  assert.equal(r.createdAt, '2025-10-01');
  const after = read(app.localStorage, 'habits');
  assert.equal(after.find(h => h.id === 't').createdAt, '2025-10-01');
  assert.deepEqual({ ...after.find(h => h.id === 't'), createdAt: 0 }, { ...beforeHabits.find(h => h.id === 't'), createdAt: 0 });
  assert.deepEqual(after.find(h => h.id === 'b'), beforeHabits.find(h => h.id === 'b'));
});

test('aplicar: si createdAt no cambia, la clave habits no se escribe', () => {
  const app = loadApp(seed([habit('t', { createdAt: '2024-01-01' })]));
  const habitsRaw = app.localStorage.getItem('habits');
  const writes = [];
  const realSet = app.localStorage.setItem.bind(app.localStorage);
  app.localStorage.setItem = (k, v) => { writes.push(k); return realSet(k, v); };
  assert.equal(applyOn(app, file(MIX)).ok, true);
  assert.equal(app.localStorage.getItem('habits'), habitsRaw);
  assert.equal(writes.includes('habits'), false);
  assert.equal(writes.includes('completions'), false);
});

test('aplicar: solo importa lo libre y deja cada conflicto exactamente como estaba', () => {
  const app = loadApp(seed([habit('t')], {}, { '2025-10-03': { t: true } }, { '2025-10-01': { t: q(10) }, '2025-10-02': { t: q(0) } }));
  const r = applyOn(app, file(MIX));
  assert.equal(r.imported, 1);
  const quantities = read(app.localStorage, 'quantities');
  assert.deepEqual(quantities['2025-10-01'].t, q(10));
  assert.deepEqual(quantities['2025-10-02'].t, q(0));
  assert.deepEqual(quantities['2025-10-05'].t, q(30));
  assert.deepEqual(read(app.localStorage, 'skips'), { '2025-10-03': { t: true } });
});

test('aplicar dos veces no suma dos veces: la segunda no encuentra nada nuevo y no escribe', () => {
  const app = loadApp(seed([habit('t')]));
  assert.equal(applyOn(app, file(MIX)).ok, true);
  // Mismo criterio que la importación de backup: tras importar, otra
  // importación en la misma sesión pide recargar.
  const sameSession = app.sandbox.applyHistoryImport(app.sandbox.validateHistoryFile(JSON.stringify(file(MIX))).data, 't');
  assert.equal(sameSession.ok, false);
  assert.match(sameSession.error, /recargá la página/);
  // Tras recargar (mismo almacenamiento):
  const reloaded = loadApp(app.localStorage._dump());
  const after = raw4(reloaded.localStorage);
  const v = reloaded.sandbox.validateHistoryFile(JSON.stringify(file(MIX)));
  const p = reloaded.sandbox.planHistoryImport(v.data, 't', snapOf(reloaded));
  assert.equal(p.canApply, false);
  assert.equal(p.sameCount, 4);
  assert.equal(p.conflicts.length, 4);
  const app2 = reloaded;
  const r2 = app2.sandbox.applyHistoryImport(v.data, 't');
  assert.equal(r2.ok, false);
  assert.match(r2.error, /No hay registros nuevos/);
  assert.deepEqual(raw4(app2.localStorage), after);
});

test('aplicar: conserva exactamente los minutos históricos (suma y registro por registro)', () => {
  const records = {};
  let expected = 0;
  const base = new Date(2025, 9, 1);
  for (let i = 0; i < 300; i++) {
    const d = new Date(base); d.setDate(d.getDate() + i);
    const key = loadApp().sandbox.toLocalDateStr(d);
    if (i % 7 === 0) records[key] = 'SKIP';
    else if (i % 3 === 0) records[key] = 0;
    else { records[key] = (i * 37) % 481; expected += records[key]; }
  }
  const app = loadApp(seed([habit('t')]));
  const r = applyOn(app, file(records));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.minutes, expected);
  const quantities = read(app.localStorage, 'quantities');
  const skips = read(app.localStorage, 'skips');
  let total = 0;
  for (const [date, value] of Object.entries(records)) {
    if (value === 'SKIP') {
      assert.equal(skips[date].t, true, date);
      assert.equal(quantities[date], undefined, date);
    } else {
      assert.equal(quantities[date].t.actualMinutes, value, date);
      assert.equal(quantities[date].t.plannedMinutes, null);
      total += quantities[date].t.actualMinutes;
    }
  }
  assert.equal(total, expected);
});

test('aplicar: dos hábitos con el mismo nombre; solo el elegido por id recibe los registros', () => {
  const app = loadApp(seed([habit('a'), habit('b')], {}, {}, { '2025-10-01': { a: q(7) } }));
  const r = applyOn(app, file({ '2025-10-02': 40 }), 'b');
  assert.equal(r.ok, true);
  const quantities = read(app.localStorage, 'quantities');
  assert.deepEqual(quantities['2025-10-02'], { b: q(40) });
  assert.deepEqual(quantities['2025-10-01'], { a: q(7) });
});

test('aplicar: una huella distinta (los datos cambiaron tras la vista previa) aborta sin escribir', () => {
  const app = loadApp(seed([habit('t')]));
  const v = app.sandbox.validateHistoryFile(JSON.stringify(file(MIX)));
  const p = app.sandbox.planHistoryImport(v.data, 't', snapOf(app));
  app.localStorage.setItem('quantities', JSON.stringify({ '2025-10-01': { t: q(1) } }));
  const before = raw4(app.localStorage);
  const r = app.sandbox.applyHistoryImport(v.data, 't', p.fingerprint);
  assert.equal(r.ok, false);
  assert.match(r.error, /cambiaron desde la vista previa/);
  assert.deepEqual(raw4(app.localStorage), before);
});

test('aplicar: modo de solo lectura, recuperación pendiente y datos ilegibles no escriben nada', () => {
  const corrupt = loadApp({ ...seed([habit('t')]), skips: '{no json' });
  const v = corrupt.sandbox.validateHistoryFile(JSON.stringify(file(MIX)));
  const before = raw4(corrupt.localStorage);
  assert.match(corrupt.sandbox.applyHistoryImport(v.data, 't').error, /solo lectura/);
  assert.deepEqual(raw4(corrupt.localStorage), before);

  const pending = loadApp(seed([habit('t')]));
  pending.localStorage.setItem('habitTracker.import.state.v1', '{}');
  const before2 = raw4(pending.localStorage);
  assert.match(pending.sandbox.applyHistoryImport(v.data, 't').error, /importación reciente o sin cerrar/);
  assert.deepEqual(raw4(pending.localStorage), before2);
});

// ---- rollback ----
function failingOn(app, key, { quota = false, times = 1 } = {}) {
  const realSet = app.localStorage.setItem.bind(app.localStorage);
  let left = times;
  app.localStorage.setItem = (k, v) => {
    if (k === key && left > 0) {
      left--;
      const e = new Error(quota ? 'The quota has been exceeded.' : 'fallo sintético');
      if (quota) e.name = 'QuotaExceededError';
      throw e;
    }
    return realSet(k, v);
  };
}

for (const key of ['quantities', 'skips', 'habits']) {
  test(`rollback: si falla la escritura de ${key} se restauran las cuatro claves y createdAt`, () => {
    const app = loadApp(seed([habit('t'), boolHabit('b')], { '2026-03-02': { b: true } }, { '2026-03-03': { b: true } },
      { '2026-03-04': { t: q(11) } }));
    const before = raw4(app.localStorage);
    failingOn(app, key);
    const r = applyOn(app, file(MIX));
    assert.equal(r.ok, false);
    assert.match(r.error, /No se pudieron escribir o verificar/);
    assert.deepEqual(raw4(app.localStorage), before, 'estado anterior exacto');
    assert.equal(read(app.localStorage, 'habits').find(h => h.id === 't').createdAt, '2026-03-01');
    assert.equal(app.localStorage.getItem('habitTracker.import.state.v1'), null, 'marcador limpiado');
  });
}

test('rollback: QuotaExceededError al escribir el historial deja todo como estaba', () => {
  const app = loadApp(seed([habit('t')], {}, {}, { '2026-03-04': { t: q(11) } }));
  const before = raw4(app.localStorage);
  failingOn(app, 'quantities', { quota: true });
  const r = applyOn(app, file(MIX));
  assert.equal(r.ok, false);
  assert.deepEqual(raw4(app.localStorage), before);
});

test('rollback: una cuota llena ya en el snapshot no modifica nada', () => {
  const app = loadApp(seed([habit('t')]));
  const before = raw4(app.localStorage);
  failingOn(app, 'habitTracker.import.snapshot.v1', { quota: true });
  const r = applyOn(app, file(MIX));
  assert.equal(r.ok, false);
  assert.match(r.error, /snapshot/);
  assert.deepEqual(raw4(app.localStorage), before);
});

test('rollback: si el rollback mismo falla no se reporta éxito (recuperación bloqueante)', () => {
  const app = loadApp(seed([habit('t')]));
  const realSet = app.localStorage.setItem.bind(app.localStorage);
  let writes = 0;
  app.localStorage.setItem = (k, v) => {
    if (k === 'quantities') { writes++; throw new Error('siempre falla'); }
    return realSet(k, v);
  };
  const r = applyOn(app, file(MIX));
  assert.equal(r.ok, false);
  assert.match(r.error, /no se pudo restaurar/);
  assert.ok(writes >= 2);
});

test('después de un rollback se puede reintentar con éxito', () => {
  const app = loadApp(seed([habit('t')]));
  failingOn(app, 'skips');
  assert.equal(applyOn(app, file(MIX)).ok, false);
  const reloaded = loadApp(app.localStorage._dump()); // recargar la página limpia el snapshot
  const r = applyOn(reloaded, file(MIX));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.imported, 4);
});

// =======================================================================
// 4. Backup tras importar
// =======================================================================
test('después de importar, exportar y reimportar conserva minutos, cero, SKIP y createdAt', () => {
  const app = loadApp(seed([habit('t')]));
  applyOn(app, file(MIX));
  const exported = plain(app.sandbox.buildBackupV3());
  const other = loadApp();
  const v = other.sandbox.validateBackup(JSON.stringify(exported));
  assert.equal(v.ok, true, v.fatal);
  assert.equal(other.sandbox.performImportReplacement(v.data).ok, true);
  const again = plain(other.sandbox.buildBackupV3());
  delete exported.exportedAt; delete again.exportedAt;
  assert.deepEqual(again, exported);
  assert.equal(again.habits[0].createdAt, '2025-10-01');
  assert.equal(again.schemaVersion, 3);
});

// =======================================================================
// 5. Vista previa
// =======================================================================
function openPreview(app, obj) {
  app.sandbox.renderHistoryImport(app.sandbox.validateHistoryFile(JSON.stringify(obj)));
  const content = app.doc.getElementById('historyImport').children[0];
  const select = findByClass(content, 'kind-select');
  const box = findByClass(content, 'history-plan');
  const buttons = findAllByClass(content, 'btn-primary').concat(findAllByClass(content, 'btn-secondary'));
  return { content, select, box, confirm: buttons.find(b => b.className === 'btn-primary'), cancel: buttons.find(b => b.className === 'btn-secondary') };
}

test('vista previa: antes de elegir hábito no se puede confirmar y el nombre del archivo es solo una pista', () => {
  const app = withFakeDom(seed([habit('t'), habit('u', { name: 'Lectura' })]));
  const ui = openPreview(app, file(MIX));
  assert.equal(ui.confirm.disabled, true);
  assert.equal(ui.select.children[0].value, '', 'sin hábito preseleccionado');
  assert.equal(ui.select.value, '');
  assert.match(allText(ui.content), /Elegí a qué hábito pertenece/);
  const labels = ui.select.children.map(o => o.textContent);
  assert.ok(labels.some(l => /Estudio · coincide con el archivo/.test(l)));
  assert.ok(labels.some(l => l.includes('Lectura') && !/coincide/.test(l)));
  assert.equal(app.doc.getElementById('historyImport').classNames.has('active'), true);
});

test('vista previa: muestra destino, rango, conteos, conflictos, nuevos y createdAt actual y resultante', () => {
  const app = withFakeDom(seed([habit('t')], {}, { '2025-10-03': { t: true } }, { '2025-10-01': { t: q(10) } }));
  const ui = openPreview(app, file(MIX));
  ui.select.value = 't';
  ui.select.onchange();
  const text = allText(ui.box);
  assert.match(text, /Hábito destino \| Estudio/);
  assert.match(text, /Rango de fechas \| 2025-10-01 a 2025-10-05/);
  assert.match(text, /Registros en el archivo \| 4/);
  assert.match(text, /Con minutos \(más de 0\) \| 2/);
  assert.match(text, /Ceros explícitos \| 1/);
  assert.match(text, /Días SKIP \| 1/);
  assert.match(text, /Nuevos para importar \| 2 \(30 min\)/);
  assert.match(text, /Conflictos \(se dejan intactos\) \| 2/);
  assert.match(text, /De ellos, idénticos al archivo \| 1/);
  assert.match(text, /Fecha de creación actual del hábito \| 2026-03-01/);
  assert.match(text, /Fecha de creación resultante \| 2025-10-02/);
  assert.match(text, /pasa de 2026-03-01 a 2025-10-02/);
  assert.equal(ui.confirm.disabled, false);
  assert.equal(ui.confirm.textContent, 'Importar 2 registros');
});

test('vista previa: sin cambio de createdAt no muestra la fila "resultante"', () => {
  const app = withFakeDom(seed([habit('t', { createdAt: '2020-01-01' })]));
  const ui = openPreview(app, file(MIX));
  ui.select.value = 't';
  ui.select.onchange();
  assert.doesNotMatch(allText(ui.box), /resultante/);
});

test('vista previa: cancelar y cerrar no escriben nada', () => {
  const app = withFakeDom(seed([habit('t')]));
  const before = raw4(app.localStorage);
  const ui = openPreview(app, file(MIX));
  ui.select.value = 't';
  ui.select.onchange();
  ui.cancel.onclick();
  assert.equal(app.doc.getElementById('historyImport').classNames.has('active'), false);
  assert.deepEqual(raw4(app.localStorage), before);
});

test('vista previa: confirmar aplica la importación y avisa el resultado', () => {
  const app = withFakeDom(seed([habit('t')]));
  const alerts = [];
  app.sandbox.alert = (m) => alerts.push(m);
  const ui = openPreview(app, file(MIX));
  ui.select.value = 't';
  ui.select.onchange();
  ui.confirm.onclick();
  assert.equal(read(app.localStorage, 'quantities')['2025-10-01'].t.actualMinutes, 95);
  assert.match(alerts[0], /Se importaron 4 registros \(2 h 5 min, 1 SKIP\)/);
  assert.match(alerts[0], /fecha de creación del hábito ahora es 2025-10-01/);
});

test('vista previa: archivo inválido muestra el motivo y solo permite cerrar', () => {
  const app = withFakeDom(seed([habit('t')]));
  app.sandbox.renderHistoryImport(app.sandbox.validateHistoryFile('{no json'));
  const content = app.doc.getElementById('historyImport').children[0];
  assert.match(allText(content), /No se puede importar: El archivo no es JSON válido/);
  assert.equal(findAllByClass(content, 'btn-primary').length, 0);
});

test('vista previa: sin hábitos de tiempo activos avisa y no ofrece importar', () => {
  const app = withFakeDom(seed([boolHabit('b'), habit('t', { archived: true })]));
  app.sandbox.renderHistoryImport(app.sandbox.validateHistoryFile(JSON.stringify(file(MIX))));
  const content = app.doc.getElementById('historyImport').children[0];
  assert.match(allText(content), /No hay hábitos de tipo "Registrar tiempo" activos/);
  assert.equal(findAllByClass(content, 'btn-primary').length, 0);
});

test('vista previa: el texto del archivo solo entra por textContent (nada de HTML)', () => {
  const app = withFakeDom(seed([habit('t')]));
  app.sandbox.renderHistoryImport(app.sandbox.validateHistoryFile(JSON.stringify(file(MIX, { habit: '<img src=x onerror=alert(1)>' }))));
  const root = app.doc.getElementById('historyImport');
  assert.equal(root.innerHTML, '', 'el contenedor nunca recibe HTML con datos del archivo');
  assert.match(allText(root.children[0]), /<img src=x onerror=alert\(1\)>/);
});

// =======================================================================
// 6. Escala del archivo real (sintético con las mismas cifras)
// =======================================================================
test('archivo sintético con las cifras del historial real: 406 / 218 / 157 / 31 / 28.815 min', () => {
  const records = {};
  const start = new Date(2025, 8, 29);
  let positives = 0, zeros = 0, skips = 0, minutes = 0;
  for (let i = 0; i < 406; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i * 1);
    const key = loadApp().sandbox.toLocalDateStr(d);
    if (i < 31) { records[key] = 'SKIP'; skips++; }
    else if (i < 31 + 157) { records[key] = 0; zeros++; }
    else { const m = i < 31 + 157 + 217 ? 132 : 171; records[key] = m; minutes += m; positives++; }
  }
  assert.deepEqual([positives, zeros, skips, minutes], [218, 157, 31, 28815]);
  const app = loadApp(seed([habit('t', { createdAt: '2026-03-01' })]));
  const v = app.sandbox.validateHistoryFile(JSON.stringify(file(records)));
  assert.equal(v.ok, true, v.fatal);
  const p = plain(app.sandbox.planHistoryImport(v.data, 't', snapOf(app)));
  assert.deepEqual(p.counts, { total: 406, positive: 218, zeros: 157, skips: 31 });
  assert.equal(p.importMinutes, 28815);
  assert.equal(app.sandbox.formatMinutesText(p.importMinutes), '480 h 15 min');
  assert.equal(p.toImportCount, 406);
  const r = app.sandbox.applyHistoryImport(v.data, 't', p.fingerprint);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.minutes, 28815);
  assert.equal(app.sandbox.validateExportState().ok, true);
});
