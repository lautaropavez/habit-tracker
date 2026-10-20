'use strict';
/**
 * Tests de Backup v2, 100% sobre datos sinteticos. Usa unicamente el
 * runner y el modulo de aserciones nativos de Node (`node:test`,
 * `node:assert/strict`) -- sin dependencias externas, sin paquetes.
 *
 * Llama exclusivamente a las funciones reales de js/app.js (via
 * load_app.js) -- no reimplementa su logica aca.
 *
 * Correr con: node --test tests/backup_v2/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./load_app.js');

function validV1Backup() {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    habits: [
      { id: 'h1', name: 'Meditar', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' },
    ],
    completions: { '2026-01-02': { h1: true } },
  };
}

function validV2Backup() {
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    habits: [
      { id: 'h1', name: 'Meditar', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'boolean' },
      { id: 'h2', name: 'Estudio', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes', target: { minutes: 60 } },
    ],
    completions: { '2026-01-02': { h1: true } },
    quantities: { '2026-01-02': { h2: { actualMinutes: 95, plannedMinutes: 240 } } },
  };
}

// =======================================================================
// Compatibilidad v1
// =======================================================================

test('v1: un backup valido se importa y se normaliza a v2 (kind="boolean", quantities={})', () => {
  const { sandbox } = loadApp();
  const r = sandbox.validateBackup(JSON.stringify(validV1Backup()));
  assert.equal(r.ok, true, 'warnings: ' + JSON.stringify(r.warnings) + ' fatal: ' + r.fatal);
  assert.equal(r.data.schemaVersion, 2);
  assert.equal(r.data.habits[0].kind, 'boolean');
  // outQuantities se construye con Object.create(null) (mismo patrón ya
  // usado por outCompletions): comparar contra "{}" por claves, no por
  // referencia/prototipo.
  assert.deepEqual(Object.keys(r.data.quantities), []);
  assert.equal(r.data.completions['2026-01-02'].h1, true);
});

test('v1: un hábito con un campo v2 ("kind") es rechazado -- v1 no admite campos extra', () => {
  const { sandbox } = loadApp();
  const backup = validV1Backup();
  backup.habits[0].kind = 'boolean';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /kind/);
});

test('v1: completion huérfana sigue siendo fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV1Backup();
  backup.completions['2026-01-03'] = { inexistente: true };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /inexistente|huérfano/);
});

test('v1: id duplicado sigue siendo fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV1Backup();
  backup.habits.push({ ...backup.habits[0] });
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /duplicado/);
});

test('v1: nombre con caracteres de control sigue siendo fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV1Backup();
  backup.habits[0].name = 'Malo\x07control';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /control/);
});

// =======================================================================
// v2: kind / unit / target
// =======================================================================

test('v2: un backup completo (boolean + quantitative) se importa correctamente', () => {
  const { sandbox } = loadApp();
  const r = sandbox.validateBackup(JSON.stringify(validV2Backup()));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
  assert.equal(r.data.schemaVersion, 2);
  const h2 = r.data.habits.find(h => h.id === 'h2');
  assert.equal(h2.kind, 'quantitative');
  assert.equal(h2.unit, 'minutes');
  assert.deepEqual(h2.target, { minutes: 60 });
  assert.equal(r.data.quantities['2026-01-02'].h2.actualMinutes, 95);
  assert.equal(r.data.quantities['2026-01-02'].h2.plannedMinutes, 240);
});

test('v2: kind ausente es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  delete backup.habits[0].kind;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /kind/);
});

test('v2: kind desconocido es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[0].kind = 'texto-libre';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /kind/);
});

test('v2: un hábito boolean con unit/target colados es fatal (campo desconocido)', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[0].unit = 'minutes';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /unit/);
});

test('v2: unit distinto de "minutes" es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[1].unit = 'hours';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /unidad/);
});

test('v2: target null es válido (sin objetivo configurado)', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[1].target = null;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
});

test('v2: target con minutes no entero es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[1].target = { minutes: 60.5 };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /objetivo/);
});

test('v2: target con minutes=0 es fatal (objetivo debe ser >= 1)', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[1].target = { minutes: 0 };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /objetivo/);
});

test('v2: target con un campo extra es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.habits[1].target = { minutes: 60, extra: 1 };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /objetivo/);
});

// =======================================================================
// v2: quantities -- referencias cruzadas, fechas, enteros
// =======================================================================

test('v2: quantities con referencia huérfana es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].inexistente = { actualMinutes: 5, plannedMinutes: null };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /inexistente|huérfano/);
});

test('v2: quantities que referencia un hábito boolean es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h1 = { actualMinutes: 5, plannedMinutes: null };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /cuantitativo/);
});

test('v2: completions que referencia un hábito quantitative es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.completions['2026-01-02'].h2 = true;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /booleano/);
});

test('v2: actualMinutes negativo es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = -1;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /actualMinutes/);
});

test('v2: actualMinutes no entero (float) es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = 95.5;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /actualMinutes/);
});

test('v2: actualMinutes como texto es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = '95';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /actualMinutes/);
});

test('v2: actualMinutes=0 es válido y distinto de ausencia de registro', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = 0;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
  assert.equal(r.data.quantities['2026-01-02'].h2.actualMinutes, 0);
});

test('v2: plannedMinutes null es válido (no verificable)', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.plannedMinutes = null;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
  assert.equal(r.data.quantities['2026-01-02'].h2.plannedMinutes, null);
});

test('v2: no hay cota de 1440 -- un valor grande y seguro es válido', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = 999999;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
});

test('v2: actualMinutes no es un entero seguro (Number.MAX_SAFE_INTEGER + 1) es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = Number.MAX_SAFE_INTEGER + 1;
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /actualMinutes/);
});

test('v2: fecha futura en quantities es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2099-01-01'] = { h2: { actualMinutes: 5, plannedMinutes: null } };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /futura/);
});

test('v2: campo faltante en el valor de cantidad (solo actualMinutes) es fatal', () => {
  const { sandbox } = loadApp();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2 = { actualMinutes: 5 };
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /[Cc]antidad/);
});

// =======================================================================
// Export: validateExportState() + buildBackupV2()
// =======================================================================

test('export: dataset vacío sigue siendo válido', () => {
  const { sandbox } = loadApp({ habits: '[]', completions: '{}', quantities: '{}' });
  const validation = sandbox.validateExportState();
  assert.equal(validation.ok, true);
  const built = sandbox.buildBackupV2();
  assert.equal(built.schemaVersion, 2);
  assert.deepEqual(built.habits, []);
  assert.deepEqual(Object.keys(built.quantities), []);
});

test('export: un hábito quantitative válido se exporta con kind/unit/target', () => {
  const habits = [
    { id: 'h2', name: 'Estudio', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes', target: { minutes: 60 } },
  ];
  const quantities = { '2026-01-02': { h2: { actualMinutes: 95, plannedMinutes: 240 } } };
  const { sandbox } = loadApp({ habits: JSON.stringify(habits), completions: '{}', quantities: JSON.stringify(quantities) });
  const validation = sandbox.validateExportState();
  assert.equal(validation.ok, true, validation.error);
  const built = sandbox.buildBackupV2();
  assert.equal(built.habits[0].kind, 'quantitative');
  assert.equal(built.quantities['2026-01-02'].h2.actualMinutes, 95);
});

test('export: actualMinutes=0 persistido no se filtra (ausencia != cero)', () => {
  const habits = [
    { id: 'h2', name: 'Estudio', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes', target: null },
  ];
  const quantities = { '2026-01-02': { h2: { actualMinutes: 0, plannedMinutes: null } } };
  const { sandbox } = loadApp({ habits: JSON.stringify(habits), completions: '{}', quantities: JSON.stringify(quantities) });
  const built = sandbox.buildBackupV2();
  assert.equal(built.quantities['2026-01-02'].h2.actualMinutes, 0);
});

test('export: completions que referencia un hábito quantitative bloquea el export (preflight)', () => {
  const habits = [
    { id: 'h2', name: 'Estudio', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes', target: null },
  ];
  const completions = { '2026-01-02': { h2: true } };
  const { sandbox } = loadApp({ habits: JSON.stringify(habits), completions: JSON.stringify(completions), quantities: '{}' });
  const validation = sandbox.validateExportState();
  assert.equal(validation.ok, false);
  assert.match(validation.error, /booleano/);
});

// =======================================================================
// Migración interna v1 -> v2 (loadData) y preservación al editar
// =======================================================================

test('migración interna: un hábito v1 sin kind se normaliza a kind="boolean" al cargar', () => {
  const habits = [
    { id: 'h1', name: 'Legacy', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' },
  ];
  const { sandbox } = loadApp({ habits: JSON.stringify(habits), completions: '{}' });
  assert.equal(sandbox.validateExportState().ok, true);
  const built = sandbox.buildBackupV2();
  assert.equal(built.habits[0].kind, 'boolean');
});

// =======================================================================
// Atomicidad
// =======================================================================

test('atomicidad: validateBackup nunca toca localStorage (es pura)', () => {
  const { sandbox, localStorage } = loadApp();
  const before = localStorage._dump();
  sandbox.validateBackup(JSON.stringify(validV2Backup()));
  sandbox.validateBackup('esto no es JSON valido {{{');
  const after = localStorage._dump();
  assert.deepEqual(before, after);
});

test('atomicidad: un import v2 exitoso escribe habits/completions/quantities de forma consistente', () => {
  const { sandbox, localStorage } = loadApp();
  const r = sandbox.validateBackup(JSON.stringify(validV2Backup()));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);
  const result = sandbox.performImportReplacement(r.data);
  assert.equal(result.ok, true, result.error);
  assert.equal(JSON.parse(localStorage.getItem('habits')).length, 2);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2026-01-02'].h2.actualMinutes, 95);
});

test('atomicidad: si quantities no puede escribirse, habits/completions/quantities no quedan a medio reemplazar', () => {
  const { sandbox, localStorage } = loadApp();
  const r = sandbox.validateBackup(JSON.stringify(validV2Backup()));
  assert.equal(r.ok, true, 'fatal: ' + r.fatal);

  const realSetItem = localStorage.setItem.bind(localStorage);
  localStorage.setItem = (key, value) => {
    if (key === 'quantities') throw new Error('fallo sintético al escribir quantities');
    return realSetItem(key, value);
  };

  const beforeHabits = localStorage.getItem('habits');
  const beforeCompletions = localStorage.getItem('completions');
  const beforeQuantities = localStorage.getItem('quantities');

  const result = sandbox.performImportReplacement(r.data);
  assert.equal(result.ok, false);

  // Rollback: las tres claves vuelven exactamente a su valor anterior,
  // nunca quedan con habits/completions nuevos pero quantities viejo.
  assert.equal(localStorage.getItem('habits'), beforeHabits);
  assert.equal(localStorage.getItem('completions'), beforeCompletions);
  assert.equal(localStorage.getItem('quantities'), beforeQuantities);
});

test('atomicidad: un backup inválido nunca llega a performImportReplacement ni modifica storage', () => {
  const { sandbox, localStorage } = loadApp();
  const before = localStorage._dump();
  const backup = validV2Backup();
  backup.quantities['2026-01-02'].h2.actualMinutes = 'no-es-numero';
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  const after = localStorage._dump();
  assert.deepEqual(before, after);
});

test('atomicidad: un snapshot snapshotVersion=1 preexistente (de antes de Backup v2) bloquea el startup sin pisar datos vivos', () => {
  const MARKER_KEY = 'habitTracker.import.state.v1';
  const SNAPSHOT_KEY = 'habitTracker.import.snapshot.v1';
  const liveHabits = JSON.stringify([{ id: 'h1', name: 'Meditar', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }]);
  const liveCompletions = JSON.stringify({ '2026-01-02': { h1: true } });
  const liveQuantities = JSON.stringify({});
  // Forma vieja (pre-Backup-v2): snapshotVersion=1, sin quantitiesRaw.
  const oldSnapshot = JSON.stringify({
    snapshotVersion: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    habitsRaw: '[]',
    completionsRaw: '{}',
  });
  const oldMarker = JSON.stringify({ stateVersion: 1, startedAt: '2026-01-01T00:00:00.000Z' });

  const { sandbox, localStorage } = loadApp({
    habits: liveHabits,
    completions: liveCompletions,
    quantities: liveQuantities,
    [MARKER_KEY]: oldMarker,
    [SNAPSHOT_KEY]: oldSnapshot,
  });

  // init() ya corrió al cargar (load_app.js) y debió entrar en
  // blocking-recovery; llamar de nuevo a recoverInterruptedImport() es
  // una lectura más (marker/snapshot no se tocaron) y expone el motivo
  // exacto sin depender de inspeccionar el DOM mockeado.
  const recovery = sandbox.recoverInterruptedImport();
  assert.equal(recovery.state, 'blocking-recovery');
  assert.equal(recovery.reason, 'snapshot-corrupt');

  // Las tres claves vivas quedan exactamente como estaban -- ni
  // sobrescritas por el snapshot viejo (que de todos modos no tiene
  // quantitiesRaw) ni tocadas de ninguna otra forma.
  assert.equal(localStorage.getItem('habits'), liveHabits);
  assert.equal(localStorage.getItem('completions'), liveCompletions);
  assert.equal(localStorage.getItem('quantities'), liveQuantities);

  // El marker y el snapshot tampoco se limpian en modo bloqueante: el
  // rescate crudo (renderBlockingRecovery) sigue pudiendo leerlos.
  assert.equal(localStorage.getItem(MARKER_KEY), oldMarker);
  assert.equal(localStorage.getItem(SNAPSHOT_KEY), oldSnapshot);
});
