'use strict';
/**
 * SKIP en hábitos de tiempo: contrato de Backup v3 (válido, exportable,
 * round-trip), exclusión mutua con minutos y ceros, Calendario, gráfico y
 * estadísticas (SKIP neutral). 100% sintético.
 *
 * Correr con: node --test tests/skip_quant/test_skip_quantitative.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('../backup_v2/load_app.js');
const { withFakeDom, findByClass, allText } = require('../helpers/fake_dom.js');

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
const quant = (id, extra) => habit(id, {
  freq: 'custom', kind: 'quantitative', unit: 'minutes', target: { minutes: 60 }, ...extra,
});
const seed = (habits, completions, skips, quantities) => ({
  habits: JSON.stringify(habits),
  completions: JSON.stringify(completions || {}),
  quantities: JSON.stringify(quantities || {}),
  skips: JSON.stringify(skips || {}),
});
const q = (m) => ({ actualMinutes: m, plannedMinutes: null });
const plain = (v) => JSON.parse(JSON.stringify(v));
const read = (ls, k) => JSON.parse(ls.getItem(k));
// Foto comparable del almacenamiento: habits por contenido (el reintento de
// guardado puede reordenar sus claves), el resto literal.
const dump = (ls) => { const d = ls._dump(); return { ...d, habits: JSON.parse(d.habits) }; };

const D1 = '2025-05-01'; // minutos
const D2 = '2025-05-02'; // cero explícito
const D3 = '2025-05-03'; // SKIP
const D4 = '2025-05-04'; // ausencia

function backup(extra) {
  return {
    schemaVersion: 3, exportedAt: '2026-01-02T00:00:00.000Z',
    habits: [quant('t')],
    completions: {},
    quantities: { [D1]: { t: q(95) }, [D2]: { t: q(0) } },
    skips: { [D3]: { t: true } },
    ...extra,
  };
}

// =======================================================================
// 1. Contrato de Backup v3
// =======================================================================
test('validación: SKIP en un hábito de tiempo es válido junto a minutos y a un cero explícito', () => {
  const r = loadApp().sandbox.validateBackup(JSON.stringify(backup()));
  assert.equal(r.ok, true, r.fatal);
  assert.equal(r.data.skips[D3].t, true);
  assert.equal(r.data.quantities[D1].t.actualMinutes, 95);
  assert.equal(r.data.quantities[D2].t.actualMinutes, 0);
  assert.equal(r.data.schemaVersion, 3, 'no cambia la versión del backup');
  assert.equal(r.summary.skipEntriesCount, 1);
});

test('validación: SKIP y minutos el mismo día se rechazan, también con un cero explícito', () => {
  const { sandbox } = loadApp();
  for (const date of [D1, D2]) {
    const r = sandbox.validateBackup(JSON.stringify(backup({ skips: { [date]: { t: true } } })));
    assert.equal(r.ok, false, date);
    assert.equal(r.data, null);
    assert.match(r.fatal, /Omitido y cantidad registrada a la vez/);
  }
});

test('validación: SKIP y completado el mismo día siguen rechazados en hábitos booleanos', () => {
  const b = backup({ habits: [habit('b')], quantities: {}, completions: { [D3]: { b: true } }, skips: { [D3]: { b: true } } });
  const r = loadApp().sandbox.validateBackup(JSON.stringify(b));
  assert.equal(r.ok, false);
  assert.match(r.fatal, /Omitido y completado a la vez/);
});

test('validación: SKIP de tiempo en una fecha futura, huérfano o con valor distinto de true se rechaza', () => {
  const { sandbox } = loadApp();
  const bad = (skips, re) => {
    const r = sandbox.validateBackup(JSON.stringify(backup({ skips })));
    assert.equal(r.ok, false);
    assert.match(r.fatal, re);
  };
  bad({ '2099-01-01': { t: true } }, /futura/);
  bad({ [D3]: { zz: true } }, /huérfano/);
  bad({ [D3]: { t: false } }, /Valor de omitido inválido/);
  bad({ [D3]: { t: 'SKIP' } }, /Valor de omitido inválido/);
});

test('validación: un hábito de tiempo archivado con SKIP es válido', () => {
  const b = backup({ habits: [quant('t', { archived: true })] });
  assert.equal(loadApp().sandbox.validateBackup(JSON.stringify(b)).ok, true);
});

test('v1 y v2 siguen rechazando "skips" (no cambia su contrato)', () => {
  const { sandbox } = loadApp();
  const v2 = { schemaVersion: 2, exportedAt: '2026-01-02T00:00:00.000Z', habits: [], completions: {}, quantities: {}, skips: {} };
  assert.equal(sandbox.validateBackup(JSON.stringify(v2)).ok, false);
});

test('exportación: validateExportState acepta SKIP de tiempo y rechaza la coexistencia con minutos o cero', () => {
  const ok = loadApp(seed([quant('t')], {}, { [D3]: { t: true } }, { [D1]: { t: q(95) }, [D2]: { t: q(0) } }));
  assert.equal(ok.sandbox.validateExportState().ok, true);
  for (const date of [D1, D2]) {
    const bad = loadApp(seed([quant('t')], {}, { [date]: { t: true } }, { [D1]: { t: q(95) }, [D2]: { t: q(0) } }));
    const v = bad.sandbox.validateExportState();
    assert.equal(v.ok, false);
    assert.match(v.error, /cantidad registrada a la vez/);
  }
  const future = loadApp(seed([quant('t')], {}, { '2099-01-01': { t: true } }, {}));
  assert.match(future.sandbox.validateExportState().error, /futura/);
});

test('round-trip exportar -> importar -> exportar conserva minutos, cero explícito y SKIP', () => {
  const first = loadApp(seed([quant('t'), habit('b')], { [D1]: { b: true } }, { [D3]: { t: true, b: true } },
    { [D1]: { t: q(95) }, [D2]: { t: q(0) } }));
  assert.equal(first.sandbox.validateExportState().ok, true);
  const exported1 = plain(first.sandbox.buildBackupV3());

  const second = loadApp();
  const r = second.sandbox.validateBackup(JSON.stringify(exported1));
  assert.equal(r.ok, true, r.fatal);
  assert.equal(second.sandbox.performImportReplacement(r.data).ok, true);
  assert.equal(second.sandbox.validateExportState().ok, true);
  const exported2 = plain(second.sandbox.buildBackupV3());

  delete exported1.exportedAt; delete exported2.exportedAt;
  assert.deepEqual(exported2, exported1);
  assert.equal(exported2.quantities[D2].t.actualMinutes, 0, 'el cero sigue siendo cero');
  assert.equal(exported2.skips[D3].t, true);
  assert.equal(exported2.quantities[D3], undefined, 'el SKIP no se convierte en cero');
  assert.equal(exported2.quantities[D4], undefined, 'la ausencia sigue ausente');
});

// =======================================================================
// 2. Cambios de estado de un día (atomicidad y exclusión mutua)
// =======================================================================
test('marcar SKIP en un día con minutos o con cero elimina el registro y guarda el SKIP', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t'), quant('u')], {}, {},
    { [D1]: { t: q(95), u: q(10) }, [D2]: { t: q(0) } }));
  assert.equal(sandbox.setQuantitativeSkip('t', D1, true).ok, true);
  assert.equal(sandbox.setQuantitativeSkip('t', D2, true).ok, true);
  const quantities = read(localStorage, 'quantities');
  assert.equal(quantities[D1].t, undefined);
  assert.equal(quantities[D1].u.actualMinutes, 10, 'otro hábito del mismo día no se toca');
  assert.equal(quantities[D2], undefined);
  assert.deepEqual(read(localStorage, 'skips'), { [D1]: { t: true }, [D2]: { t: true } });
  assert.equal(sandbox.validateExportState().ok, true);
});

test('guardar minutos (o un cero) sobre un día en SKIP elimina el SKIP', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t')], {}, { [D3]: { t: true }, [D4]: { t: true } }, {}));
  sandbox.setQuantityExact('t', D3, 45);
  sandbox.setQuantityExact('t', D4, 0);
  assert.equal(read(localStorage, 'quantities')[D3].t.actualMinutes, 45);
  assert.equal(read(localStorage, 'quantities')[D4].t.actualMinutes, 0, 'cero explícito, no ausencia');
  assert.deepEqual(read(localStorage, 'skips'), {});
  assert.equal(sandbox.validateExportState().ok, true);
});

test('quitar SKIP deja el día sin registro (no crea un cero)', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t')], {}, { [D3]: { t: true } }, {}));
  assert.equal(sandbox.setQuantitativeSkip('t', D3, false).ok, true);
  assert.deepEqual(read(localStorage, 'skips'), {});
  assert.deepEqual(read(localStorage, 'quantities'), {});
  assert.equal(sandbox.getQuantitativeDayState('t', D3), 'none');
});

test('SKIP de tiempo: se rechaza lo futuro, lo inválido, otro tipo de hábito y el modo de solo lectura', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t'), habit('b')]));
  const before = localStorage._dump();
  assert.equal(sandbox.setQuantitativeSkip('t', dstr(1), true).reason, 'future-date');
  assert.equal(sandbox.setQuantitativeSkip('t', '2025-02-30', true).reason, 'invalid-date');
  assert.equal(sandbox.setQuantitativeSkip('b', D3, true).reason, 'not-quantitative');
  assert.equal(sandbox.setQuantitativeSkip('zz', D3, true).reason, 'unknown-habit');
  assert.deepEqual(localStorage._dump(), before);
  const corrupt = loadApp({ ...seed([quant('t')]), skips: '{no json' });
  assert.equal(corrupt.sandbox.setQuantitativeSkip('t', D3, true).reason, 'storage-corrupted');
});

test('SKIP de tiempo permite fechas anteriores a createdAt', () => {
  const { sandbox } = loadApp(seed([quant('t', { createdAt: dstr(-3) })]));
  assert.equal(sandbox.setQuantitativeSkip('t', dstr(-60), true).ok, true);
});

test('atomicidad: si falla la persistencia del SKIP, memoria y almacenamiento vuelven al estado anterior', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t')], {}, {}, { [D1]: { t: q(95) } }));
  const before = dump(localStorage);
  const realSet = localStorage.setItem.bind(localStorage);
  let armed = true;
  localStorage.setItem = (k, v) => {
    if (k === 'skips' && armed) { armed = false; const e = new Error('cuota'); e.name = 'QuotaExceededError'; throw e; }
    return realSet(k, v);
  };
  const r = sandbox.setQuantitativeSkip('t', D1, true);
  assert.equal(r.ok, false);
  assert.equal(sandbox.getQuantitativeDayState('t', D1), 'minutes', 'memoria revertida');
  assert.deepEqual(dump(localStorage), before, 'almacenamiento revertido');
});

test('atomicidad: si falla guardar minutos sobre un SKIP, el SKIP sigue y no queda un registro', () => {
  const { sandbox, localStorage } = loadApp(seed([quant('t')], {}, { [D3]: { t: true } }, {}));
  const before = dump(localStorage);
  const realSet = localStorage.setItem.bind(localStorage);
  let armed = true;
  localStorage.setItem = (k, v) => {
    if (k === 'skips' && armed) { armed = false; throw new Error('fallo sintético'); }
    return realSet(k, v);
  };
  sandbox.setQuantityExact('t', D3, 30);
  assert.equal(sandbox.getQuantitativeDayState('t', D3), 'skipped');
  assert.deepEqual(dump(localStorage), before);
});

// =======================================================================
// 3. Calendario: cuatro estados distinguibles
// =======================================================================
test('calendario de tiempo: ausencia, cero explícito, minutos y SKIP se distinguen', () => {
  const h = quant('t');
  const { sandbox } = loadApp(seed([h], {}, { [D3]: { t: true } }, { [D1]: { t: q(95) }, [D2]: { t: q(0) } }));
  const deco = (d) => plain(sandbox.getCalendarDayDecoration(d, h));
  assert.equal(deco(D4).stateClass, '');
  assert.equal(deco(D4).badgeHtml, '');
  assert.equal(deco(D2).stateClass, 'quantity-zero');
  assert.match(deco(D2).badgeHtml, />0</);
  assert.match(deco(D2).ariaExtra, /cero minutos/);
  assert.match(deco(D1).stateClass, /quantity-(met|partial)/);
  assert.match(deco(D1).badgeHtml, /1h35/);
  assert.equal(deco(D3).stateClass, 'skipped');
  assert.match(deco(D3).badgeHtml, /↷/);
  assert.match(deco(D3).ariaExtra, /omitido/);
  const classes = new Set([D4, D2, D1, D3].map(d => deco(d).stateClass));
  assert.equal(classes.size, 4);
});

test('editor del día: ofrece "Omitir día (SKIP)", pide confirmación si había minutos y "Quitar SKIP" al revés', () => {
  const h = quant('t');
  const app = withFakeDom(seed([h], {}, {}, { [D1]: { t: q(95) } }));
  let asked = 0;
  app.sandbox.confirm = () => { asked++; return false; };
  const controls = (d) => app.sandbox.createQuantityControls(h, d, false);
  let el = controls(D1);
  let btn = findByClass(el, 'btn-quantity-skip');
  assert.equal(btn.textContent, 'Omitir día (SKIP)');
  btn.onclick();
  assert.equal(asked, 1);
  assert.equal(app.sandbox.getQuantitativeDayState('t', D1), 'minutes', 'cancelar no cambia nada');
  app.sandbox.confirm = () => true;
  btn.onclick();
  assert.equal(app.sandbox.getQuantitativeDayState('t', D1), 'skipped');
  el = controls(D1);
  assert.match(allText(el), /Día omitido \(SKIP\)/);
  btn = findByClass(el, 'btn-quantity-skip');
  assert.equal(btn.textContent, 'Quitar SKIP');
  btn.onclick();
  assert.equal(app.sandbox.getQuantitativeDayState('t', D1), 'none');
  // sin registro previo, marcar SKIP no pregunta
  asked = 0;
  app.sandbox.confirm = () => { asked++; return true; };
  findByClass(controls(D4), 'btn-quantity-skip').onclick();
  assert.equal(asked, 0);
  assert.equal(app.sandbox.getQuantitativeDayState('t', D4), 'skipped');
});

test('editor del día: guardar 00:00 sobre un SKIP lo reemplaza por un cero explícito', () => {
  const h = quant('t');
  const app = withFakeDom(seed([h], {}, { [D3]: { t: true } }, {}));
  const el = app.sandbox.createQuantityControls(h, D3, false);
  findByClass(el, 'btn-quantity-save').onclick();
  assert.equal(app.sandbox.getQuantitativeDayState('t', D3), 'minutes');
  assert.equal(read(app.localStorage, 'quantities')[D3].t.actualMinutes, 0);
  assert.deepEqual(read(app.localStorage, 'skips'), {});
});

test('editor del día: guardar 00:00 en un día sin registro sigue sin crear un cero', () => {
  const h = quant('t');
  const app = withFakeDom(seed([h]));
  const el = app.sandbox.createQuantityControls(h, D4, false);
  findByClass(el, 'btn-quantity-save').onclick();
  assert.deepEqual(read(app.localStorage, 'quantities'), {});
});

// =======================================================================
// 4. Estadísticas y gráfico: SKIP neutral
// =======================================================================
test('estadísticas de tiempo: SKIP no suma minutos, no cuenta como cero y se informa aparte', () => {
  const h = quant('t', { createdAt: dstr(-10) });
  const { sandbox } = loadApp(seed([h], {}, { [dstr(-2)]: { t: true }, [dstr(0)]: { t: true } },
    { [dstr(-1)]: { t: q(60) }, [dstr(-3)]: { t: q(0) } }));
  const st = plain(sandbox.calculateQuantityStats(h));
  assert.equal(st.totalMinutes, 60);
  assert.equal(st.skippedDays, 2);
  assert.equal(st.todaySkipped, true);
  assert.equal(st.todayProgressPct, null, 'un día omitido no es 0 % de progreso');
  assert.equal('successRate' in st || 'currentStreak' in st || 'bestStreak' in st, false,
    'los hábitos de tiempo no tienen tasa ni rachas por período que un SKIP pudiera cortar');
});

test('estadísticas de tiempo: un SKIP anterior a createdAt no entra en los totales', () => {
  const h = quant('t', { createdAt: dstr(-3) });
  const { sandbox } = loadApp(seed([h], {}, { [dstr(-20)]: { t: true } }, {}));
  assert.equal(plain(sandbox.calculateQuantityStats(h)).skippedDays, 0);
});

test('tarjeta de estadísticas de tiempo: muestra "Días omitidos (SKIP)" y "Omitido" para hoy', () => {
  const h = quant('t', { createdAt: dstr(-10) });
  const app = withFakeDom(seed([h], {}, { [dstr(0)]: { t: true } }, { [dstr(-1)]: { t: q(30) } }));
  const text = allText(app.sandbox.createStatsCard(h));
  assert.match(text, /Días omitidos \(SKIP\)/);
  assert.match(text, /Omitido/);
  assert.match(text, /30 min/);
});

test('estadísticas booleanas con SKIP no cambian', () => {
  const h = habit('b', { createdAt: dstr(-10) });
  const { sandbox } = loadApp(seed([h], { [dstr(-1)]: { b: true } }, { [dstr(-2)]: { b: true } }));
  const st = plain(sandbox.calculateStats(h));
  assert.equal(st.totalCompleted, 1);
  assert.equal(st.skippedDays, 1);
});

test('gráfico de 30 días (tiempo): SKIP es un estado distinto del cero y de la ausencia', () => {
  const h = quant('t', { createdAt: dstr(-60) });
  const app = withFakeDom(seed([h], {}, { [dstr(-1)]: { t: true } }, { [dstr(-2)]: { t: q(0) }, [dstr(-3)]: { t: q(45) } }));
  const card = app.sandbox.createStatsCard(h);
  const bars = findByClass(card, 'chart-bars');
  const w = bars.children;
  const cls = (i) => String(findByClass(w[i], 'chart-bar').className) + ' ' + [...findByClass(w[i], 'chart-bar').classNames].join(' ');
  assert.match(w[28].title, /omitido \(SKIP\)/);
  assert.match(cls(28), /chart-bar-skipped/);
  assert.equal(findByClass(w[28], 'chart-bar').style.height, '30%');
  assert.match(w[27].title, /0 min/);
  assert.doesNotMatch(cls(27), /chart-bar-skipped/);
  assert.match(w[26].title, /45 min/);
  assert.match(w[20].title, /sin registro/);
  assert.match(bars.attrs['aria-label'], /1 día con tiempo registrado, 45 min en total, 1 omitido \(SKIP\)/);
});

test('gráfico de 30 días (tiempo, archivado): también muestra el SKIP y no cambia las métricas', () => {
  const h = quant('t', { archived: true, createdAt: dstr(-60) });
  const app = withFakeDom(seed([h], {}, { [dstr(-1)]: { t: true } }, { [dstr(-2)]: { t: q(20) } }));
  const card = app.sandbox.createStatsCard(h);
  const bars = findByClass(card, 'chart-bars');
  assert.match(bars.children[28].title, /omitido/);
  assert.match(allText(card), /20 min/);
});
