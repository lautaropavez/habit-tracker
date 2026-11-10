'use strict';
/**
 * Tests de Backup v3 (Etapa 1), 100% sobre datos sinteticos: archived,
 * skips (cuarta clave), frecuencia 'loop-month', compatibilidad v1/v2,
 * persistencia, snapshot/rollback de cuatro claves y resolvers puros.
 *
 * Correr con: node --test tests/backup_v3/test_backup_v3.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');

const MARKER_KEY = 'habitTracker.import.state.v1';
const SNAPSHOT_KEY = 'habitTracker.import.snapshot.v1';
const D1 = '2026-01-02';
const D2 = '2026-01-03';

const bool = (id, extra) => ({
  id, name: 'Hab ' + id, icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 1,
  freqPeriod: 'week', createdAt: '2026-01-01', kind: 'boolean', archived: false, ...extra,
});
const loopMonth = (id) => bool(id, { freq: 'custom', freqCount: 27, freqPeriod: 'loop-month', freqWindowDays: 30 });
const quant = (id) => bool(id, {
  freq: 'custom', freqCount: 1, kind: 'quantitative', unit: 'minutes', target: null,
});

function v3(overrides) {
  return {
    schemaVersion: 3,
    exportedAt: new Date().toISOString(),
    habits: [bool('h1'), loopMonth('h2'), bool('h3', { archived: true }), quant('h4')],
    completions: { [D1]: { h1: true } },
    quantities: { [D1]: { h4: { actualMinutes: 0, plannedMinutes: null } } },
    skips: { [D2]: { h1: true, h3: true } },
    ...overrides,
  };
}

function validate(obj) {
  const { sandbox } = loadApp();
  return sandbox.validateBackup(JSON.stringify(obj));
}

function assertFatal(obj, pattern) {
  const r = validate(obj);
  assert.equal(r.ok, false, 'se esperaba rechazo');
  assert.equal(r.data, null);
  assert.match(r.fatal, pattern);
}

// ---------------------------------------------------------------------
// Contrato v3: casos validos
// ---------------------------------------------------------------------
test('v3: backup completo (archived, loop-month, skips, cuantitativo con cero) es valido', () => {
  const r = validate(v3());
  assert.equal(r.ok, true, r.fatal);
  assert.equal(r.data.schemaVersion, 3);
  assert.equal(r.summary.archivedCount, 1);
  assert.equal(r.summary.skipEntriesCount, 2);
  const h2 = r.data.habits.find(h => h.id === 'h2');
  assert.equal(h2.freqPeriod, 'loop-month');
  assert.equal(h2.freqWindowDays, 30);
  assert.equal(r.data.habits.find(h => h.id === 'h3').archived, true);
  assert.equal(r.data.quantities[D1].h4.actualMinutes, 0);
  assert.equal(r.data.skips[D2].h1, true);
  // un skip no es un completado
  assert.equal(r.data.completions[D2], undefined);
});

test('v3: skips vacio y sin archivados es valido', () => {
  const r = validate(v3({ habits: [bool('h1')], quantities: {}, skips: {}, completions: {} }));
  assert.equal(r.ok, true, r.fatal);
});

// ---------------------------------------------------------------------
// Compatibilidad v1 / v2
// ---------------------------------------------------------------------
test('v1 se normaliza a v3: archived=false, quantities y skips vacios', () => {
  const v1 = {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    habits: [{ id: 'h1', name: 'Meditar', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }],
    completions: { [D1]: { h1: true } },
  };
  const r = validate(v1);
  assert.equal(r.ok, true, r.fatal);
  assert.equal(r.data.schemaVersion, 3);
  assert.equal(r.data.habits[0].archived, false);
  assert.equal(r.data.habits[0].kind, 'boolean');
  assert.equal(Object.keys(r.data.skips).length, 0);
  assert.equal(Object.keys(r.data.quantities).length, 0);
  assert.equal(r.data.completions[D1].h1, true);
});

test('v2 se normaliza a v3: cuantitativos intactos, archived=false, skips vacio', () => {
  const v2 = {
    schemaVersion: 2, exportedAt: new Date().toISOString(),
    habits: [
      { id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'boolean' },
      { id: 'h2', name: 'E', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes', target: { minutes: 60 } },
    ],
    completions: { [D1]: { h1: true } },
    quantities: { [D1]: { h2: { actualMinutes: 95, plannedMinutes: 240 } } },
  };
  const r = validate(v2);
  assert.equal(r.ok, true, r.fatal);
  assert.equal(r.data.schemaVersion, 3);
  assert.equal(JSON.stringify(r.data.habits.map(h => h.archived)), '[false,false]');
  assert.equal(r.data.quantities[D1].h2.plannedMinutes, 240);
  assert.equal(Object.keys(r.data.skips).length, 0);
});

test('v1 y v2 NO aceptan los campos de v3 (archived, skips, loop-month, freqWindowDays)', () => {
  const v2base = () => ({
    schemaVersion: 2, exportedAt: new Date().toISOString(),
    habits: [{ id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'boolean' }],
    completions: {}, quantities: {},
  });
  let b = v2base(); b.habits[0].archived = false; assertFatal(b, /campo desconocido "archived"/);
  b = v2base(); b.skips = {}; assertFatal(b, /Campo desconocido en la raíz: "skips"/);
  b = v2base(); b.habits[0].freq = 'custom'; b.habits[0].freqPeriod = 'loop-month'; assertFatal(b, /período de frecuencia inválido/);
  b = v2base(); b.habits[0].freqWindowDays = 30; assertFatal(b, /campo desconocido "freqWindowDays"/);
  const v1 = { schemaVersion: 1, exportedAt: new Date().toISOString(), habits: [], completions: {}, skips: {} };
  assertFatal(v1, /Campo desconocido en la raíz: "skips"/);
});

test('schemaVersion 4 y otros valores se rechazan', () => {
  assertFatal(v3({ schemaVersion: 4 }), /schemaVersion/);
  assertFatal(v3({ schemaVersion: '3' }), /schemaVersion/);
});

// ---------------------------------------------------------------------
// Contrato v3: rechazos estrictos
// ---------------------------------------------------------------------
test('v3: archived es obligatorio y debe ser booleano', () => {
  let b = v3(); delete b.habits[0].archived; assertFatal(b, /falta el campo "archived"/);
  for (const bad of ['false', 0, 1, null]) {
    b = v3(); b.habits[0].archived = bad; assertFatal(b, /estado archivado inválido/);
  }
});

test('v3: skips es obligatorio en la raiz y debe ser un objeto', () => {
  let b = v3(); delete b.skips; assertFatal(b, /Falta el campo raíz "skips"/);
  for (const bad of [[], null, 'x', 5]) {
    b = v3({ skips: bad }); assertFatal(b, /"skips" debe ser un objeto/);
  }
});

test('v3: coherencia de frecuencia loop-month', () => {
  let b = v3(); delete b.habits[1].freqWindowDays; assertFatal(b, /falta el campo "freqWindowDays"/);
  // El denominador original de Loop admitido es exactamente 30.
  for (const bad of [1, 7, 29, 31, 366, 30.5, '30', null, 0]) {
    b = v3(); b.habits[1].freqWindowDays = bad; assertFatal(b, /denominador original/);
  }
  b = v3(); b.habits[1].freq = 'daily'; assertFatal(b, /requiere frecuencia custom/);
  b = v3(); b.habits[0].freqWindowDays = 30; assertFatal(b, /campo desconocido "freqWindowDays"/);
  b = v3(); b.habits[1].freqCount = 30; b.habits[1].freqWindowDays = 30;
  assert.equal(validate(b).ok, true);
});

test('v3: un skip y un completado en la misma fecha y habito se rechazan', () => {
  assertFatal(v3({ skips: { [D1]: { h1: true } } }), /Omitido y completado a la vez/);
});

test('v3: un completado false con skip del mismo dia es valido (false no es completado)', () => {
  const r = validate(v3({ completions: { [D2]: { h1: false } } }));
  assert.equal(r.ok, true, r.fatal);
});

test('v3: skips invalidos', () => {
  assertFatal(v3({ skips: { [D2]: { h4: true } } }), /no es booleano/);
  assertFatal(v3({ skips: { [D2]: { nope: true } } }), /huérfano/);
  assertFatal(v3({ skips: { [D2]: { h1: false } } }), /Valor de omitido inválido/);
  assertFatal(v3({ skips: { [D2]: { h1: 1 } } }), /Valor de omitido inválido/);
  assertFatal(v3({ skips: { '2026-02-30': { h1: true } } }), /Fecha de omitido inválida/);
  assertFatal(v3({ skips: { 'hoy': { h1: true } } }), /Fecha de omitido inválida/);
  assertFatal(v3({ skips: { '2099-01-01': { h1: true } } }), /futura/);
  assertFatal(v3({ skips: { [D2]: [] } }), /Registro de omitidos inválido/);
  assertFatal(v3({ skips: { [D2]: null } }), /Registro de omitidos inválido/);
});

test('v3: ids reservados en skips no contaminan prototipos', () => {
  const raw = JSON.stringify(v3()).replace('"skips":{', '"skips":{"__proto__":{"h1":true},');
  const { sandbox } = loadApp();
  const r = sandbox.validateBackup(raw);
  // "__proto__" como fecha no es una fecha valida -> rechazo; nunca pollution.
  assert.equal(r.ok, false);
  assert.equal(({}).h1, undefined);
});

test('v3: un backup invalido no modifica storage', () => {
  const { sandbox, localStorage } = loadApp();
  const before = localStorage._dump();
  sandbox.validateBackup(JSON.stringify(v3({ skips: { [D1]: { h1: true } } })));
  assert.deepEqual(localStorage._dump(), before);
});

// ---------------------------------------------------------------------
// Export / roundtrip
// ---------------------------------------------------------------------
function seedFromBackup(b) {
  return {
    habits: JSON.stringify(b.habits),
    completions: JSON.stringify(b.completions),
    quantities: JSON.stringify(b.quantities),
    skips: JSON.stringify(b.skips),
  };
}

test('export: buildBackupV3 incluye archived, freqWindowDays y skips; roundtrip identico', () => {
  const source = v3();
  const { sandbox } = loadApp(seedFromBackup(source));
  const validation = sandbox.validateExportState();
  assert.equal(validation.ok, true, validation.error);
  const built = JSON.parse(JSON.stringify(sandbox.buildBackupV3()));
  assert.equal(built.schemaVersion, 3);
  assert.deepEqual(built.habits, source.habits);
  assert.deepEqual(built.completions, source.completions);
  assert.deepEqual(built.quantities, source.quantities);
  assert.deepEqual(built.skips, source.skips);
  assert.equal(built.habits.find(h => h.id === 'h1').freqWindowDays, undefined);

  const again = validate(built);
  assert.equal(again.ok, true, again.fatal);
});

test('export: v1/v2 persistidos (sin archived ni skips) se exportan como v3 normalizado', () => {
  const legacyHabits = [{ id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }];
  const { sandbox } = loadApp({ habits: JSON.stringify(legacyHabits), completions: '{}' });
  const v = sandbox.validateExportState();
  assert.equal(v.ok, true, v.error);
  const built = sandbox.buildBackupV3();
  assert.equal(built.habits[0].archived, false);
  assert.equal(built.habits[0].kind, 'boolean');
  assert.deepEqual(Object.keys(built.skips), []);
});

test('export: validateExportState rechaza datos inconsistentes de skips/archived/loop-month', () => {
  const base = v3();
  const cases = [
    [{ ...seedFromBackup(base), skips: JSON.stringify({ [D1]: { h1: true } }) }, /a la vez/],
    [{ ...seedFromBackup(base), skips: JSON.stringify({ [D2]: { h4: true } }) }, /no es booleano/],
    [{ ...seedFromBackup(base), skips: JSON.stringify({ [D2]: { zz: true } }) }, /huérfano/],
    [{ ...seedFromBackup(base), skips: JSON.stringify({ [D2]: { h1: false } }) }, /inválido/],
    [{ ...seedFromBackup(base), skips: JSON.stringify({ '2099-01-01': { h1: true } }) }, /futura/],
  ];
  for (const [seed, pattern] of cases) {
    const { sandbox } = loadApp(seed);
    const v = sandbox.validateExportState();
    assert.equal(v.ok, false);
    assert.match(v.error, pattern);
  }
  const badHabits = base.habits.map(h => ({ ...h }));
  badHabits[0].archived = 'si';
  let { sandbox } = loadApp({ ...seedFromBackup(base), habits: JSON.stringify(badHabits) });
  assert.match(sandbox.validateExportState().error, /archivado inválido/);

  const badRolling = base.habits.map(h => ({ ...h }));
  delete badRolling[1].freqWindowDays;
  ({ sandbox } = loadApp({ ...seedFromBackup(base), habits: JSON.stringify(badRolling) }));
  assert.match(sandbox.validateExportState().error, /denominador original/);
});

// ---------------------------------------------------------------------
// Persistencia de la cuarta clave
// ---------------------------------------------------------------------
test('persistencia: loadData lee skips y saveData lo escribe', () => {
  const { sandbox, localStorage } = loadApp(seedFromBackup(v3()));
  assert.equal(sandbox.hasStorageCorruption(), false);
  assert.equal(localStorage.getItem('skips'), JSON.stringify(v3().skips));
  assert.equal(sandbox.saveData().ok, true);
  assert.equal(JSON.parse(localStorage.getItem('skips'))[D2].h3, true);
});

test('persistencia: skips corrupto activa el modo de proteccion y saveData no escribe', () => {
  for (const bad of ['{no json', '[]', 'null', '"x"']) {
    const { sandbox, localStorage } = loadApp({ ...seedFromBackup(v3()), skips: bad });
    assert.equal(sandbox.hasStorageCorruption(), true, bad);
    const res = sandbox.saveData();
    assert.equal(res.ok, false);
    assert.equal(localStorage.getItem('skips'), bad);
  }
});

test('persistencia: instalacion previa sin clave skips arranca sana', () => {
  const { sandbox } = loadApp({ habits: JSON.stringify(v3().habits), completions: '{}', quantities: '{}' });
  assert.equal(sandbox.hasStorageCorruption(), false);
});

test('toggleHabit: marcar completado un dia omitido reemplaza el skip; desmarcar no lo recrea', () => {
  const { sandbox, localStorage } = loadApp(seedFromBackup(v3()));
  sandbox.toggleHabit('h1', D2);
  assert.equal(JSON.parse(localStorage.getItem('completions'))[D2].h1, true);
  const skips = JSON.parse(localStorage.getItem('skips'));
  assert.equal(skips[D2].h1, undefined);
  assert.equal(skips[D2].h3, true);   // otro habito intacto
  sandbox.toggleHabit('h1', D2);
  assert.equal(JSON.parse(localStorage.getItem('completions'))[D2].h1, false);
  assert.equal(JSON.parse(localStorage.getItem('skips'))[D2].h1, undefined);
  assert.equal(sandbox.validateExportState().ok, true);
});

test('toggleHabit: borrar el ultimo skip de una fecha elimina la fecha', () => {
  const { sandbox, localStorage } = loadApp(seedFromBackup(v3({ skips: { [D2]: { h1: true } } })));
  sandbox.toggleHabit('h1', D2);
  assert.deepEqual(JSON.parse(localStorage.getItem('skips')), {});
});

test('deleteHabit: elimina sus skips y no toca los de otros habitos', () => {
  const { sandbox, localStorage } = loadApp(seedFromBackup(v3()));
  sandbox.deleteHabit('h3');
  const skips = JSON.parse(localStorage.getItem('skips'));
  assert.equal(skips[D2].h3, undefined);
  assert.equal(skips[D2].h1, true);
  assert.equal(sandbox.validateExportState().ok, true);
});

// ---------------------------------------------------------------------
// Resolvers puros
// ---------------------------------------------------------------------
test('resolveFrequencyForSave: un habito loop-month conserva toda su frecuencia', () => {
  const { sandbox } = loadApp();
  const existing = loopMonth('h2');
  const out = sandbox.resolveFrequencyForSave(existing, { freq: 'daily', freqCount: 7, freqPeriod: 'week' });
  assert.equal(out.freq, 'custom');
  assert.equal(out.freqCount, 27);
  assert.equal(out.freqPeriod, 'loop-month');
  assert.equal(out.freqWindowDays, 30);
});

test('resolveFrequencyForSave: habito normal o nuevo usa lo elegido en la UI, sin freqWindowDays', () => {
  const { sandbox } = loadApp();
  const ui = { freq: 'custom', freqCount: 3, freqPeriod: 'month' };
  for (const existing of [null, bool('h1')]) {
    const out = sandbox.resolveFrequencyForSave(existing, ui);
    assert.equal(out.freq, 'custom');
    assert.equal(out.freqCount, 3);
    assert.equal(out.freqPeriod, 'month');
    assert.equal('freqWindowDays' in out, false);
  }
});

test('resolveArchivedForSave: conserva archived al editar; nuevo = false', () => {
  const { sandbox } = loadApp();
  assert.equal(sandbox.resolveArchivedForSave(null), false);
  assert.equal(sandbox.resolveArchivedForSave(bool('h1', { archived: true })), true);
  assert.equal(sandbox.resolveArchivedForSave(bool('h1')), false);
  assert.equal(sandbox.resolveArchivedForSave({ id: 'x' }), false);
});

// ---------------------------------------------------------------------
// Importacion atomica de cuatro claves, snapshot y rollback
// ---------------------------------------------------------------------
test('atomicidad: un import v3 exitoso escribe las cuatro claves y guarda snapshot v3', () => {
  const previous = {
    habits: JSON.stringify([bool('old')]), completions: '{}', quantities: '{}',
    skips: JSON.stringify({ [D1]: { old: true } }),
  };
  const { sandbox, localStorage } = loadApp(previous);
  const r = sandbox.validateBackup(JSON.stringify(v3()));
  assert.equal(r.ok, true, r.fatal);
  const res = sandbox.performImportReplacement(r.data);
  assert.equal(res.ok, true, res.error);
  assert.equal(JSON.parse(localStorage.getItem('habits')).length, 4);
  assert.deepEqual(JSON.parse(localStorage.getItem('skips')), JSON.parse(JSON.stringify(v3().skips)));
  assert.equal(localStorage.getItem(MARKER_KEY), null);
  const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY));
  assert.equal(snap.snapshotVersion, 3);
  assert.equal(snap.skipsRaw, previous.skips);
  assert.equal(snap.habitsRaw, previous.habits);
});

test('atomicidad: importar v1 sobre datos con skips deja skips = {} (reemplazo total)', () => {
  const { sandbox, localStorage } = loadApp(seedFromBackup(v3()));
  const v1 = {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    habits: [{ id: 'n1', name: 'N', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }],
    completions: {},
  };
  const r = sandbox.validateBackup(JSON.stringify(v1));
  assert.equal(sandbox.performImportReplacement(r.data).ok, true);
  assert.equal(localStorage.getItem('skips'), '{}');
  assert.equal(JSON.parse(localStorage.getItem('habits'))[0].archived, false);
});

function rollbackScenario(failureMode, previous) {
  const { sandbox, localStorage } = loadApp(previous);
  const r = sandbox.validateBackup(JSON.stringify(v3()));
  assert.equal(r.ok, true, r.fatal);
  const newSkipsStr = JSON.stringify(r.data.skips);
  const realSetItem = localStorage.setItem.bind(localStorage);
  let tripped = false;
  localStorage.setItem = (key, value) => {
    if (key === 'skips' && value === newSkipsStr && !tripped) {
      tripped = true;
      if (failureMode === 'throw') throw new Error('fallo sintetico en skips');
      return realSetItem(key, '"corrupto"');   // escritura silenciosamente distinta
    }
    return realSetItem(key, value);
  };
  const before = localStorage._dump();
  const result = sandbox.performImportReplacement(r.data);
  assert.equal(tripped, true);
  assert.equal(result.ok, false);
  const after = localStorage._dump();
  for (const key of ['habits', 'completions', 'quantities', 'skips']) {
    assert.equal(after[key], before[key], 'clave restaurada: ' + key);
  }
  assert.equal(after[MARKER_KEY], undefined, 'marker removido tras rollback');
  return { sandbox, localStorage };
}

test('rollback: si skips falla (excepcion) las cuatro claves vuelven a su valor anterior', () => {
  rollbackScenario('throw', {
    habits: JSON.stringify([bool('old')]), completions: JSON.stringify({ [D1]: { old: true } }),
    quantities: '{}', skips: JSON.stringify({ [D2]: { old: true } }),
  });
});

test('rollback: si skips queda escrito distinto (verificacion falla) se restauran las cuatro claves', () => {
  rollbackScenario('mismatch', {
    habits: JSON.stringify([bool('old')]), completions: '{}', quantities: '{}',
    skips: JSON.stringify({ [D2]: { old: true } }),
  });
});

test('rollback: si skips no existia antes, tras el rollback sigue sin existir', () => {
  const { localStorage } = rollbackScenario('throw', {
    habits: JSON.stringify([bool('old')]), completions: '{}', quantities: '{}',
  });
  assert.equal(localStorage.getItem('skips'), null);
});

test('rollback: si falla quantities (antes de skips) skips no queda modificado', () => {
  const previous = {
    habits: JSON.stringify([bool('old')]), completions: '{}', quantities: '{}',
    skips: JSON.stringify({ [D2]: { old: true } }),
  };
  const { sandbox, localStorage } = loadApp(previous);
  const r = sandbox.validateBackup(JSON.stringify(v3()));
  const realSetItem = localStorage.setItem.bind(localStorage);
  let tripped = false;
  localStorage.setItem = (key, value) => {
    if (key === 'quantities' && !tripped) { tripped = true; throw new Error('fallo sintetico'); }
    return realSetItem(key, value);
  };
  assert.equal(sandbox.performImportReplacement(r.data).ok, false);
  assert.equal(localStorage.getItem('skips'), previous.skips);
  assert.equal(localStorage.getItem('habits'), previous.habits);
});

test('rollback: si el rollback mismo falla en skips entra en recuperacion bloqueante (no reporta exito)', () => {
  const previous = {
    habits: JSON.stringify([bool('old')]), completions: '{}', quantities: '{}',
    skips: JSON.stringify({ [D2]: { old: true } }),
  };
  const { sandbox, localStorage } = loadApp(previous);
  const r = sandbox.validateBackup(JSON.stringify(v3()));
  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key === 'skips') throw new Error('skips siempre falla');
    return realSetItem(key, value);
  };
  const res = sandbox.performImportReplacement(r.data);
  assert.equal(res.ok, false);
  assert.match(res.error, /no se pudo restaurar/);
});

// ---------------------------------------------------------------------
// Snapshots anteriores / recuperacion de arranque
// ---------------------------------------------------------------------
const marker = JSON.stringify({ stateVersion: 1, startedAt: '2026-01-01T00:00:00.000Z' });

test('recuperacion: snapshot v3 interrumpido restaura las cuatro claves', () => {
  const snap = JSON.stringify({
    snapshotVersion: 3, createdAt: '2026-01-01T00:00:00.000Z',
    habitsRaw: JSON.stringify([bool('old')]), completionsRaw: '{}', quantitiesRaw: '{}',
    skipsRaw: JSON.stringify({ [D1]: { old: true } }),
  });
  const { sandbox, localStorage } = loadApp({
    habits: '[]', completions: '{}', quantities: '{}', skips: '{}',
    [MARKER_KEY]: marker, [SNAPSHOT_KEY]: snap,
  });
  // init() ya recupero al cargar; el estado final prueba la restauracion.
  assert.equal(localStorage.getItem('habits'), JSON.stringify([bool('old')]));
  assert.equal(localStorage.getItem('skips'), JSON.stringify({ [D1]: { old: true } }));
  assert.equal(localStorage.getItem(MARKER_KEY), null);
  assert.equal(sandbox.hasStorageCorruption(), false);
});

test('recuperacion: snapshot v3 con skipsRaw null deja skips ausente', () => {
  const snap = JSON.stringify({
    snapshotVersion: 3, createdAt: '2026-01-01T00:00:00.000Z',
    habitsRaw: '[]', completionsRaw: '{}', quantitiesRaw: '{}', skipsRaw: null,
  });
  const { localStorage } = loadApp({
    habits: '[]', completions: '{}', quantities: '{}', skips: JSON.stringify({ [D1]: { x: true } }),
    [MARKER_KEY]: marker, [SNAPSHOT_KEY]: snap,
  });
  assert.equal(localStorage.getItem('skips'), null);
});

test('compatibilidad: snapshot v2 (app anterior) sigue siendo restaurable; skips queda ausente', () => {
  const snap = JSON.stringify({
    snapshotVersion: 2, createdAt: '2026-01-01T00:00:00.000Z',
    habitsRaw: JSON.stringify([bool('old')]), completionsRaw: '{}', quantitiesRaw: '{}',
  });
  const { sandbox, localStorage } = loadApp({
    habits: '[]', completions: '{}', quantities: '{}',
    [MARKER_KEY]: marker, [SNAPSHOT_KEY]: snap,
  });
  assert.equal(localStorage.getItem('habits'), JSON.stringify([bool('old')]));
  assert.equal(localStorage.getItem('skips'), null);
  assert.equal(localStorage.getItem(MARKER_KEY), null);
  assert.equal(sandbox.hasStorageCorruption(), false);
});

test('compatibilidad: snapshot v1 y snapshots mal formados siguen bloqueando sin pisar datos', () => {
  const live = { habits: '[]', completions: '{}', quantities: '{}', skips: '{}' };
  const bads = [
    JSON.stringify({ snapshotVersion: 1, createdAt: '2026-01-01T00:00:00.000Z', habitsRaw: '[]', completionsRaw: '{}' }),
    JSON.stringify({ snapshotVersion: 3, createdAt: '2026-01-01T00:00:00.000Z', habitsRaw: '[]', completionsRaw: '{}', quantitiesRaw: '{}' }),
    JSON.stringify({ snapshotVersion: 3, createdAt: '2026-01-01T00:00:00.000Z', habitsRaw: '[]', completionsRaw: '{}', quantitiesRaw: '{}', skipsRaw: 5 }),
    JSON.stringify({ snapshotVersion: 4, createdAt: '2026-01-01T00:00:00.000Z', habitsRaw: '[]', completionsRaw: '{}', quantitiesRaw: '{}', skipsRaw: null }),
  ];
  for (const snap of bads) {
    const { sandbox, localStorage } = loadApp({ ...live, [MARKER_KEY]: marker, [SNAPSHOT_KEY]: snap });
    assert.equal(sandbox.recoverInterruptedImport().state, 'blocking-recovery');
    assert.equal(localStorage.getItem('skips'), '{}');
    assert.equal(localStorage.getItem(SNAPSHOT_KEY), snap);
  }
});

// ---------------------------------------------------------------------
// Regresion: la app v1/v2 sigue operativa
// ---------------------------------------------------------------------
test('regresion: datos v1/v2 persistidos cargan, se pueden marcar y exportar', () => {
  const { sandbox, localStorage } = loadApp({
    habits: JSON.stringify([{ id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }]),
    completions: '{}',
  });
  sandbox.toggleHabit('h1', D1);
  assert.equal(JSON.parse(localStorage.getItem('completions'))[D1].h1, true);
  assert.equal(JSON.parse(localStorage.getItem('skips')) && Object.keys(JSON.parse(localStorage.getItem('skips'))).length, 0);
  assert.equal(sandbox.validateExportState().ok, true);
});

test('regresion: calculateStats de un habito sin skips no cambia con la clave skips presente', () => {
  const habits = [bool('h1', { createdAt: '2026-01-01' })];
  const completions = { '2026-01-02': { h1: true }, '2026-01-03': { h1: true } };
  const a = loadApp({ habits: JSON.stringify(habits), completions: JSON.stringify(completions) });
  const b = loadApp({ habits: JSON.stringify(habits), completions: JSON.stringify(completions), skips: '{}' });
  assert.equal(
    JSON.stringify(a.sandbox.calculateStats(a.sandbox.state ? a.sandbox.state.habits[0] : habits[0])),
    JSON.stringify(b.sandbox.calculateStats(b.sandbox.state ? b.sandbox.state.habits[0] : habits[0]))
  );
});
