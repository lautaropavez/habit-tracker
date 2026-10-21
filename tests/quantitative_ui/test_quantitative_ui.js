'use strict';
/**
 * Tests de Posta 3 (interfaz de hábitos cuantitativos), 100% sobre datos
 * sintéticos. Usa únicamente el runner y el módulo de aserciones nativos
 * de Node (`node:test`, `node:assert/strict`) -- sin dependencias
 * externas, sin paquetes.
 *
 * Reutiliza el mismo harness de Backup v2 (carga js/app.js real dentro de
 * una sandbox `vm`, sin reimplementar su lógica) -- no se duplica el
 * harness, solo se importa desde su ubicación original.
 *
 * Correr con: node --test tests/quantitative_ui/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');

function booleanHabit(id) {
  return { id, name: 'Leer', icon: '📚', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01', kind: 'boolean' };
}

function quantitativeHabit(id, targetMinutes) {
  return {
    id, name: 'Estudio', icon: '📚', color: '#45B7D1', freq: 'daily', freqCount: 7, freqPeriod: 'week',
    createdAt: '2026-01-01', kind: 'quantitative', unit: 'minutes',
    target: targetMinutes === null ? null : { minutes: targetMinutes }
  };
}

function seedWith(habits, quantities, completions) {
  return {
    habits: JSON.stringify(habits),
    completions: JSON.stringify(completions || {}),
    quantities: JSON.stringify(quantities || {}),
  };
}

const PAST_DATE = '2026-01-10';
const PAST_DATE_2 = '2026-01-11';

// =======================================================================
// Incrementos y decrementos de 5 minutos
// =======================================================================

test('incrementQuantity: +5 suma minutos sobre un total ausente (arranca en 0)', () => {
  const { sandbox, localStorage } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))[PAST_DATE].h1.actualMinutes, 5);
});

test('incrementQuantity: -5 nunca baja de 0 (límite inferior)', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.incrementQuantity('h1', PAST_DATE, -5);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 0);
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.incrementQuantity('h1', PAST_DATE, -100);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 0);
});

test('incrementQuantity: múltiples incrementos acumulan correctamente', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 15);
  sandbox.incrementQuantity('h1', PAST_DATE, -5);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 10);
});

// =======================================================================
// Ingreso manual exacto
// =======================================================================

test('setQuantityExact: reemplaza el total exacto, no lo suma', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 20, plannedMinutes: null } } }));
  sandbox.setQuantityExact('h1', PAST_DATE, 73);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 73);
});

test('setQuantityExact: permite registrar 0 explícitamente', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 45, plannedMinutes: null } } }));
  sandbox.setQuantityExact('h1', PAST_DATE, 0);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 0);
});

test('setQuantityExact: rechaza un valor negativo (no escribe nada)', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 30, plannedMinutes: null } } }));
  sandbox.setQuantityExact('h1', PAST_DATE, -10);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 30);
});

test('setQuantityExact: rechaza un valor no entero (float) (no escribe nada)', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 30, plannedMinutes: null } } }));
  sandbox.setQuantityExact('h1', PAST_DATE, 30.5);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 30);
});

test('setQuantityExact: rechaza NaN (no escribe nada)', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 30, plannedMinutes: null } } }));
  sandbox.setQuantityExact('h1', PAST_DATE, NaN);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 30);
});

// =======================================================================
// writeActualMinutes: invariantes compartidos por ambos métodos de registro
// =======================================================================

test('writeActualMinutes: nunca crea una entrada duplicada -- misma fecha+hábito se sobreescribe en el mismo slot', () => {
  const { sandbox, localStorage } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  const stored = JSON.parse(localStorage.getItem('quantities'));
  assert.deepEqual(Object.keys(stored), [PAST_DATE]);
  assert.deepEqual(Object.keys(stored[PAST_DATE]), ['h1']);
  assert.equal(stored[PAST_DATE].h1.actualMinutes, 10);
});

test('writeActualMinutes: preserva plannedMinutes existente sin modificarlo', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)], { [PAST_DATE]: { h1: { actualMinutes: 10, plannedMinutes: 240 } } }));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  assert.equal(sandbox.getPlannedMinutes('h1', PAST_DATE), 240);
  sandbox.setQuantityExact('h1', PAST_DATE, 99);
  assert.equal(sandbox.getPlannedMinutes('h1', PAST_DATE), 240);
});

test('writeActualMinutes: rechaza un hábito booleano (solo cuantitativos registran minutos)', () => {
  const { sandbox } = loadApp(seedWith([booleanHabit('h1')]));
  const ok = sandbox.writeActualMinutes('h1', PAST_DATE, 30);
  assert.equal(ok, false);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 0);
});

test('writeActualMinutes: no escribe nada si hasStorageCorruption() es true', () => {
  const { sandbox, localStorage } = loadApp({ habits: 'esto-no-es-json-valido {{{', completions: '{}', quantities: '{}' });
  assert.equal(sandbox.hasStorageCorruption(), true);
  const ok = sandbox.writeActualMinutes('h1', PAST_DATE, 30);
  assert.equal(ok, false);
  assert.equal(localStorage.getItem('quantities'), '{}');
});

// =======================================================================
// Persistencia y restauración
// =======================================================================

test('persistencia: los minutos registrados sobreviven a un reload simulado (nueva carga de la app desde el mismo localStorage)', () => {
  const first = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  first.sandbox.incrementQuantity('h1', PAST_DATE, 5);
  first.sandbox.incrementQuantity('h1', PAST_DATE, 5);
  const dump = first.localStorage._dump();

  // Simula un reinicio real: una instancia nueva de la app (init() corre
  // de nuevo, exactamente como al recargar la página) cargando desde el
  // mismo localStorage -- no reimplementa persistencia, usa loadApp()
  // igual que cualquier otro test.
  const second = loadApp(dump);
  assert.equal(second.sandbox.getActualMinutes('h1', PAST_DATE), 10);
  const storedQuantities = JSON.parse(second.localStorage.getItem('quantities'));
  assert.equal(storedQuantities[PAST_DATE].h1.actualMinutes, 10);
});

// =======================================================================
// Edición de fechas anteriores
// =======================================================================

test('edición de fecha anterior: incrementQuantity sobre una fecha pasada no modifica otras fechas', () => {
  const { sandbox } = loadApp(seedWith(
    [quantitativeHabit('h1', 60)],
    { [PAST_DATE]: { h1: { actualMinutes: 15, plannedMinutes: null } } }
  ));
  sandbox.incrementQuantity('h1', PAST_DATE_2, 20);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 15, 'la fecha original no debe cambiar');
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE_2), 20);
});

test('edición de fecha anterior: setQuantityExact sobre una fecha pasada no modifica otro hábito cuantitativo', () => {
  const { sandbox } = loadApp(seedWith(
    [quantitativeHabit('h1', 60), quantitativeHabit('h2', 30)],
    { [PAST_DATE]: { h1: { actualMinutes: 15, plannedMinutes: null }, h2: { actualMinutes: 8, plannedMinutes: null } } }
  ));
  sandbox.setQuantityExact('h1', PAST_DATE, 55);
  assert.equal(sandbox.getActualMinutes('h1', PAST_DATE), 55);
  assert.equal(sandbox.getActualMinutes('h2', PAST_DATE), 8, 'otro hábito en la misma fecha no debe cambiar');
});

// =======================================================================
// Convivencia entre hábitos booleanos y cuantitativos
// =======================================================================

test('convivencia: togglear un hábito booleano no afecta quantities', () => {
  const { sandbox, localStorage } = loadApp(seedWith([booleanHabit('hBool'), quantitativeHabit('hQuant', 60)]));
  sandbox.toggleHabit('hBool', PAST_DATE);
  const completions = JSON.parse(localStorage.getItem('completions'));
  assert.equal(completions[PAST_DATE].hBool, true);
  assert.equal(sandbox.getActualMinutes('hQuant', PAST_DATE), 0);
  assert.equal(localStorage.getItem('quantities'), '{}');
});

test('convivencia: incrementar un hábito cuantitativo no afecta completions', () => {
  const { sandbox, localStorage } = loadApp(seedWith([booleanHabit('hBool'), quantitativeHabit('hQuant', 60)]));
  sandbox.incrementQuantity('hQuant', PAST_DATE, 5);
  assert.equal(sandbox.getActualMinutes('hQuant', PAST_DATE), 5);
  assert.equal(localStorage.getItem('completions'), '{}');
});

test('convivencia: toggleHabit() se sigue rechazando para un hábito cuantitativo (guard preexistente de Backup v2)', () => {
  const { sandbox, localStorage } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.toggleHabit('h1', PAST_DATE);
  assert.equal(localStorage.getItem('completions'), '{}', 'un hábito cuantitativo nunca debe poder marcarse vía completions');
});

test('convivencia: deleteHabit de un hábito cuantitativo limpia quantities sin tocar completions ni quantities de otros hábitos', () => {
  const { sandbox, localStorage } = loadApp(seedWith(
    [booleanHabit('hBool'), quantitativeHabit('hQuant', 60), quantitativeHabit('hQuant2', 30)],
    { [PAST_DATE]: { hQuant: { actualMinutes: 40, plannedMinutes: null }, hQuant2: { actualMinutes: 10, plannedMinutes: null } } },
    { [PAST_DATE]: { hBool: true } }
  ));
  sandbox.deleteHabit('hQuant');

  const habits = JSON.parse(localStorage.getItem('habits'));
  const quantities = JSON.parse(localStorage.getItem('quantities'));
  const completions = JSON.parse(localStorage.getItem('completions'));

  assert.equal(habits.some(h => h.id === 'hQuant'), false);
  assert.equal(PAST_DATE in quantities ? ('hQuant' in quantities[PAST_DATE]) : false, false);
  assert.equal(quantities[PAST_DATE].hQuant2.actualMinutes, 10, 'otro hábito cuantitativo no debe perder su registro');
  assert.equal(completions[PAST_DATE].hBool, true, 'el historial booleano no debe verse afectado');
});

// =======================================================================
// Exportación / importación Backup v2 (reutiliza el modelo y los
// validadores ya implementados -- no se modifica ninguno acá)
// =======================================================================

test('export: un hábito cuantitativo con minutos registrados vía incrementQuantity se exporta correctamente', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.incrementQuantity('h1', PAST_DATE, 5);

  const validation = sandbox.validateExportState();
  assert.equal(validation.ok, true, validation.error);
  const built = sandbox.buildBackupV2();
  assert.equal(built.quantities[PAST_DATE].h1.actualMinutes, 10);
  assert.equal(built.habits[0].kind, 'quantitative');
  assert.equal(built.habits[0].target.minutes, 60);
});

test('import: un backup v2 con minutos registrados a través de la UI se reimporta con los mismos valores (roundtrip)', () => {
  const { sandbox } = loadApp(seedWith([quantitativeHabit('h1', 60), booleanHabit('h2')]));
  sandbox.incrementQuantity('h1', PAST_DATE, 5);
  sandbox.setQuantityExact('h1', PAST_DATE_2, 42);
  sandbox.toggleHabit('h2', PAST_DATE);

  const built = sandbox.buildBackupV2();
  const result = sandbox.validateBackup(JSON.stringify(built));
  assert.equal(result.ok, true, result.fatal);
  assert.equal(result.data.quantities[PAST_DATE].h1.actualMinutes, 5);
  assert.equal(result.data.quantities[PAST_DATE_2].h1.actualMinutes, 42);
  assert.equal(result.data.completions[PAST_DATE].h2, true);
});

// =======================================================================
// Resolución pura de kind/target al guardar (invariante central de la
// Posta 3: "no permitir cambios de tipo que provoquen pérdida de datos")
// =======================================================================

test('resolveHabitKindForSave: al editar, siempre devuelve el kind existente, nunca el elegido en la UI', () => {
  const { sandbox, localStorage } = loadApp(seedWith([quantitativeHabit('h1', 60)]));
  const existing = JSON.parse(localStorage.getItem('habits')).find(h => h.id === 'h1');
  // Aunque la UI "quedara" en boolean por cualquier motivo, el resultado
  // debe seguir siendo el kind real del hábito.
  assert.equal(sandbox.resolveHabitKindForSave(existing, 'boolean'), 'quantitative');
  assert.equal(sandbox.resolveHabitKindForSave(existing, 'quantitative'), 'quantitative');
});

test('resolveHabitKindForSave: al crear (sin hábito existente), devuelve el kind elegido en la UI', () => {
  const { sandbox } = loadApp(seedWith([]));
  assert.equal(sandbox.resolveHabitKindForSave(null, 'quantitative'), 'quantitative');
  assert.equal(sandbox.resolveHabitKindForSave(null, 'boolean'), 'boolean');
});

test('resolveQuantitativeTarget: null cuando no hay objetivo configurado', () => {
  const { sandbox } = loadApp(seedWith([]));
  assert.equal(sandbox.resolveQuantitativeTarget(null), null);
});

test('resolveQuantitativeTarget: {minutes: N} cuando se configura un objetivo', () => {
  const { sandbox } = loadApp(seedWith([]));
  // JSON.stringify en vez de deepEqual: el objeto devuelto se crea dentro
  // de la sandbox vm (otro realm), con su propio Object.prototype --
  // deepEqual/deepStrictEqual lo trataría como no-equivalente por
  // identidad de prototipo aunque la forma sea idéntica. Mismo patrón que
  // ya usa tests/backup_v2/test_backup_v2.js para el mismo problema.
  assert.equal(JSON.stringify(sandbox.resolveQuantitativeTarget(90)), JSON.stringify({ minutes: 90 }));
});

// =======================================================================
// Estadísticas: minutos nunca se confunden con hábitos completados
// =======================================================================

test('calculateQuantityStats: minutos de hoy, objetivo y total no se confunden con completions booleanas', () => {
  const { sandbox, localStorage } = loadApp(seedWith([quantitativeHabit('h1', 60), booleanHabit('h2')]));
  const todayStr = sandbox.getToday();
  sandbox.incrementQuantity('h1', todayStr, 5);
  sandbox.incrementQuantity('h1', todayStr, 5);
  sandbox.toggleHabit('h2', todayStr);

  const habit = JSON.parse(localStorage.getItem('habits')).find(h => h.id === 'h1');
  const stats = sandbox.calculateQuantityStats(habit);
  assert.equal(stats.todayMinutes, 10);
  assert.equal(stats.target, 60);
  assert.equal(stats.todayProgressPct, Math.round((10 / 60) * 100));
  assert.equal(typeof stats.totalCompleted, 'undefined', 'las estadísticas cuantitativas no deben traer un concepto de completados booleanos');
});

// =======================================================================
// Regresión
// =======================================================================

test('regresión: toggleHabit sigue funcionando igual para hábitos booleanos tras los cambios de Posta 3', () => {
  const { sandbox, localStorage } = loadApp(seedWith([booleanHabit('h1')]));
  sandbox.toggleHabit('h1', PAST_DATE);
  assert.equal(JSON.parse(localStorage.getItem('completions'))[PAST_DATE].h1, true);
  sandbox.toggleHabit('h1', PAST_DATE);
  assert.equal(JSON.parse(localStorage.getItem('completions'))[PAST_DATE].h1, false);
});

test('regresión: validateBackup v1 sigue aceptando e importando backups sin ningún campo de Posta 3', () => {
  const { sandbox } = loadApp(seedWith([]));
  const v1Backup = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    habits: [{ id: 'h1', name: 'Meditar', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2026-01-01' }],
    completions: { [PAST_DATE]: { h1: true } }
  };
  const result = sandbox.validateBackup(JSON.stringify(v1Backup));
  assert.equal(result.ok, true, result.fatal);
  assert.equal(result.data.habits[0].kind, 'boolean');
});
