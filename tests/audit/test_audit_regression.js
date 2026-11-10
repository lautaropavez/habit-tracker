'use strict';
/**
 * Auditoría técnica remota: regresiones de fechas (límites de mes y año,
 * bisiestos, anterior a createdAt), tope de 24 h, registros históricos de
 * más de 24 h e importación inválida sin cambios parciales. 100% sintético,
 * sin DOM real y con reloj fijo (la zona horaria del equipo no importa:
 * todo se arma con fechas locales).
 *
 * Correr con: node --test tests/audit/test_audit_regression.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadApp } = require('../backup_v2/load_app.js');

const RealDate = Date;

// Reloj local fijo: `new Date()` y `Date.now()` devuelven este instante; el
// resto del comportamiento de Date (fechas locales, setDate, etc.) es real.
function fixedDateClass(y, m, d) {
  const nowMs = new RealDate(y, m - 1, d, 12, 0, 0).getTime();
  return class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() { return nowMs; }
  };
}

function appAt(y, m, d, seed) {
  const app = loadApp(seed);
  app.sandbox.Date = fixedDateClass(y, m, d);
  return app;
}

const habit = (id, extra) => ({
  id, name: 'Hab ' + id, icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 1,
  freqPeriod: 'week', createdAt: '2020-01-01', kind: 'boolean', archived: false, ...extra,
});
const quant = (id, extra) => habit(id, {
  freq: 'custom', kind: 'quantitative', unit: 'minutes', target: { minutes: 120 }, ...extra,
});
const seed = (habits, completions, skips, quantities) => ({
  habits: JSON.stringify(habits),
  completions: JSON.stringify(completions || {}),
  quantities: JSON.stringify(quantities || {}),
  skips: JSON.stringify(skips || {}),
});
const q = (m) => ({ actualMinutes: m, plannedMinutes: null });
const plain = (v) => JSON.parse(JSON.stringify(v));
const run = (sandbox, code) => vm.runInContext(code, sandbox);

// =======================================================================
// 1. Fechas: bisiestos y límites de mes/año
// =======================================================================
test('parseLocalDate: bisiestos y fines de mes (2024 y 2000 sí; 2023 y 2100 no)', () => {
  const { sandbox: s } = loadApp();
  for (const ok of ['2024-02-29', '2000-02-29', '2025-12-31', '2026-01-01', '2024-04-30']) {
    assert.ok(s.parseLocalDate(ok), ok);
    assert.equal(s.toLocalDateStr(s.parseLocalDate(ok)), ok);
  }
  for (const bad of ['2023-02-29', '2100-02-29', '2024-04-31', '2024-13-01', '2024-00-10', '2024-02-00', '2024-2-9']) {
    assert.equal(s.parseLocalDate(bad), null, bad);
  }
});

test('importar: un 29 de febrero real se acepta y uno inexistente se rechaza sin tocar el storage', () => {
  const base = (date) => JSON.stringify({
    schemaVersion: 3, exportedAt: '2026-01-02T00:00:00.000Z',
    habits: [{ id: 'h1', name: 'M', icon: '🧘', color: '#4ECDC4', freq: 'daily', freqCount: 7, freqPeriod: 'week', createdAt: '2020-01-01', kind: 'boolean', archived: false }],
    completions: { [date]: { h1: true } }, quantities: {}, skips: {},
  });
  const live = seed([habit('live')], { '2025-05-05': { live: true } });
  const { sandbox, localStorage } = loadApp(live);
  const before = JSON.stringify(localStorage._dump());
  assert.equal(sandbox.validateBackup(base('2024-02-29')).ok, true);
  const bad = sandbox.validateBackup(base('2023-02-29'));
  assert.equal(bad.ok, false);
  assert.equal(bad.data, null);
  assert.match(bad.fatal, /inválida/);
  assert.equal(JSON.stringify(localStorage._dump()), before);
});

test('importar: un error en la última sección (omitidos) no deja datos parciales ni toca el storage', () => {
  const backup = {
    schemaVersion: 3, exportedAt: '2026-01-02T00:00:00.000Z',
    habits: [habit('h1'), quant('h2')],
    completions: { '2025-03-01': { h1: true } },
    quantities: { '2025-03-01': { h2: q(30) } },
    skips: { '2025-03-02': { h1: true }, '2099-01-01': { h1: true } },
  };
  const live = seed([habit('live')], { '2025-05-05': { live: true } });
  const { sandbox, localStorage } = loadApp(live);
  const before = JSON.stringify(localStorage._dump());
  const r = sandbox.validateBackup(JSON.stringify(backup));
  assert.equal(r.ok, false);
  assert.equal(r.data, null);
  assert.match(r.fatal, /futura/);
  assert.equal(JSON.stringify(localStorage._dump()), before);
});

test('gráfico: al día siguiente de un 29 de febrero los 30 días son contiguos e incluyen el bisiesto', () => {
  const h = habit('a', { createdAt: '2023-01-01' });
  const { sandbox } = appAt(2024, 3, 1, seed([h], { '2024-02-29': { a: true } }));
  const days = plain(run(sandbox, "getChartDays(state.habits[0])"));
  assert.equal(days.length, 30);
  assert.equal(days[29].dateStr, '2024-03-01');
  assert.equal(days[29].isToday, true);
  assert.equal(days[0].dateStr, '2024-02-01');
  assert.equal(days[28].dateStr, '2024-02-29');
  assert.equal(days[28].value, 1);
  for (let i = 1; i < days.length; i++) {
    const prev = new RealDate(days[i - 1].dateStr + 'T12:00:00');
    prev.setDate(prev.getDate() + 1);
    assert.equal(sandbox.toLocalDateStr(prev), days[i].dateStr);
  }
});

test('gráfico: cruza el fin de año sin saltos y excluye el día 31 hacia atrás (hoy-30)', () => {
  const h = habit('a', { createdAt: '2025-01-01' });
  const { sandbox } = appAt(2026, 1, 5, seed([h], {
    '2025-12-31': { a: true }, '2026-01-01': { a: true }, '2025-12-06': { a: true }, '2025-12-07': { a: true },
  }));
  const days = plain(run(sandbox, "getChartDays(state.habits[0])"));
  assert.equal(days[0].dateStr, '2025-12-07');
  assert.equal(days[29].dateStr, '2026-01-05');
  const byDate = Object.fromEntries(days.map(d => [d.dateStr, d.value]));
  assert.equal(byDate['2025-12-31'], 1);
  assert.equal(byDate['2026-01-01'], 1);
  assert.equal(byDate['2025-12-07'], 1);
  assert.equal('2025-12-06' in byDate, false, 'hoy-30 queda fuera del gráfico');
  assert.equal(new Set(days.map(d => d.dateStr)).size, 30);
});

test('estadísticas diarias: el 29 de febrero cuenta como un día más (tasa y total)', () => {
  const h = habit('a', { createdAt: '2024-02-27' });
  const { sandbox } = appAt(2024, 3, 2, seed([h], {
    '2024-02-26': { a: true }, // anterior a createdAt: no cuenta
    '2024-02-28': { a: true }, '2024-02-29': { a: true },
  }));
  const st = plain(run(sandbox, "calculateStats(state.habits[0])"));
  assert.equal(st.totalCompleted, 2);
  // períodos cerrados: 27, 28, 29/02 y 01/03 -> 2 de 4
  assert.equal(st.successRate, 50);
  assert.equal(st.bestStreak, 2);
  assert.equal(st.currentStreak, 0);
});

test('estadísticas semanales: una semana lunes-domingo que cruza el año agrupa ambos lados', () => {
  // semana 29/12/2025 (lun) - 04/01/2026 (dom); createdAt es lunes
  const h = habit('w', { freq: 'custom', freqCount: 2, freqPeriod: 'week', createdAt: '2025-12-01' });
  const { sandbox } = appAt(2026, 1, 7, seed([h], { '2025-12-30': { w: true }, '2026-01-02': { w: true } }));
  const st = plain(run(sandbox, "calculateStats(state.habits[0])"));
  assert.equal(st.totalCompleted, 2);
  // semanas cerradas desde 01/12: 01, 08, 15, 22 y 29/12 -> solo la última cumple
  assert.equal(st.successRate, 20);
  assert.equal(st.bestStreak, 1);
  // la semana en curso (05/01) está abierta: no corta la racha de la anterior
  assert.equal(st.currentStreak, 1);
  assert.deepEqual(st.currentPeriod, { count: 0, target: 2 });
});

test('estadísticas mensuales: dic y ene son períodos distintos (no se suman entre sí)', () => {
  const h = habit('m', { freq: 'custom', freqCount: 2, freqPeriod: 'month', createdAt: '2025-10-01' });
  const { sandbox } = appAt(2026, 2, 10, seed([h], { '2025-12-31': { m: true }, '2026-01-01': { m: true } }));
  const st = plain(run(sandbox, "calculateStats(state.habits[0])"));
  // oct, nov, dic y ene cerrados; ninguno llega a 2
  assert.equal(st.successRate, 0);
  assert.equal(st.totalCompleted, 2);
});

test('gráfico y estadísticas: SKIP anterior a createdAt no cambia las métricas, pero se muestra', () => {
  const h = habit('a', { createdAt: '2026-03-10' });
  const { sandbox } = appAt(2026, 3, 12, seed([h], {}, { '2026-03-05': { a: true } }));
  const st = plain(run(sandbox, "calculateStats(state.habits[0])"));
  assert.equal(st.skippedDays, 0);
  const days = plain(run(sandbox, "getChartDays(state.habits[0])"));
  const d = days.find(x => x.dateStr === '2026-03-05');
  assert.equal(d.skipped, true);
  assert.equal(d.beforeCreated, false);
  assert.equal(days.find(x => x.dateStr === '2026-03-04').beforeCreated, true);
});

// =======================================================================
// 2. Tope de 24 h y registros históricos
// =======================================================================
test('+5 min respeta el tope de 24:00 (1440) igual que el ingreso manual', () => {
  const h = quant('t');
  const { sandbox, localStorage } = loadApp(seed([h], {}, {}, { '2025-05-05': { t: q(1438) } }));
  sandbox.incrementQuantity('t', '2025-05-05', 5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1440);
  sandbox.incrementQuantity('t', '2025-05-05', 5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1440);
  sandbox.incrementQuantity('t', '2025-05-05', -5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1435);
});

test('un registro histórico de más de 24 h no se recorta con +5 y baja normalmente con -5', () => {
  const h = quant('t');
  const { sandbox, localStorage } = loadApp(seed([h], {}, {}, { '2025-05-05': { t: q(1600) } }));
  sandbox.incrementQuantity('t', '2025-05-05', 5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1600);
  sandbox.incrementQuantity('t', '2025-05-05', -5);
  assert.equal(JSON.parse(localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1595);
});

test('un registro histórico de más de 24 h sobrevive al ciclo exportar -> validar -> reemplazar', () => {
  const h = quant('t');
  const src = loadApp(seed([h], {}, {}, { '2025-05-05': { t: q(1600) }, '2025-05-06': { t: q(0) } }));
  assert.equal(src.sandbox.validateExportState().ok, true);
  const json = JSON.stringify(src.sandbox.buildBackupV3());
  const dst = loadApp();
  const r = dst.sandbox.validateBackup(json);
  assert.equal(r.ok, true);
  assert.equal(r.data.quantities['2025-05-05'].t.actualMinutes, 1600);
  assert.equal(r.data.quantities['2025-05-06'].t.actualMinutes, 0, 'un 0 explícito no es ausencia');
  assert.equal(dst.sandbox.performImportReplacement(r.data).ok, true);
  assert.equal(JSON.parse(dst.localStorage.getItem('quantities'))['2025-05-05'].t.actualMinutes, 1600);
});

test('24:01 se rechaza y 23:59 / 24:00 se aceptan en el ingreso manual', () => {
  const { sandbox: s } = loadApp();
  assert.equal(s.parseHoursMinutes('23', '59').total, 1439);
  assert.equal(s.parseHoursMinutes('24', '00').total, 1440);
  assert.equal(s.parseHoursMinutes('24', '01').ok, false);
  assert.equal(s.parseHoursMinutes('25', '00').ok, false);
});

test('setQuantityExact: un valor inválido no escribe y no pisa el registro existente', () => {
  const h = quant('t');
  const { sandbox, localStorage } = loadApp(seed([h], {}, {}, { '2025-05-05': { t: q(90) } }));
  const before = localStorage.getItem('quantities');
  for (const bad of [-1, 1.5, NaN, Infinity, '30', null, undefined]) {
    sandbox.setQuantityExact('t', '2025-05-05', bad);
  }
  assert.equal(localStorage.getItem('quantities'), before);
});

// =======================================================================
// 3. SKIP y completado mutuamente excluyentes en la vía de Hoy
// =======================================================================
test('Hoy: marcar completado un día SKIP reemplaza el SKIP y desmarcar no deja SKIP ni true', () => {
  const h = habit('a');
  const { sandbox, localStorage } = loadApp(seed([h], {}, { '2025-05-05': { a: true } }));
  sandbox.toggleHabit('a', '2025-05-05');
  let c = JSON.parse(localStorage.getItem('completions'));
  let sk = JSON.parse(localStorage.getItem('skips'));
  assert.equal(c['2025-05-05'].a, true);
  assert.equal(sk['2025-05-05'], undefined);
  sandbox.toggleHabit('a', '2025-05-05');
  c = JSON.parse(localStorage.getItem('completions'));
  sk = JSON.parse(localStorage.getItem('skips'));
  assert.notEqual(c['2025-05-05']?.a, true);
  assert.equal(sk['2025-05-05'], undefined);
  // el estado resultante es exportable (sin completion/skip simultáneos)
  assert.equal(sandbox.validateExportState().ok, true);
});
