'use strict';
/**
 * Encabezado: menú ⋮ (Exportar / Importar backup) y selector de tema
 * (Natural Linen / Noir Editorial). DOM falso mínimo, datos sintéticos.
 *
 * Correr con: node --test tests/ux_header/test_menu_theme.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('../backup_v2/load_app.js');

const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');

class FakeEl {
  constructor(id) {
    this.id = id;
    this.attrs = {};
    this.hidden = false;
    this.textContent = '';
    this.focused = 0;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { add() {}, remove() {}, contains() { return false; } };
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  focus() { this.focused++; FakeEl.active = this; }
  contains(node) { return node === this || this.children.includes(node); }
  addEventListener() {}
  appendChild(c) { this.children.push(c); return c; }
  querySelectorAll() { return []; }
}

function makeDoc() {
  const byId = new Map();
  const listeners = {};
  const meta = new FakeEl('meta');
  const doc = {
    documentElement: new FakeEl('html'),
    listeners,
    meta,
    createElement: () => new FakeEl('x'),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, new FakeEl(id));
      return byId.get(id);
    },
    querySelector(sel) { return sel.includes('theme-color') ? meta : null; },
    querySelectorAll(sel) { return sel === '.tab' ? [new FakeEl('t'), new FakeEl('t'), new FakeEl('t')] : []; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
  };
  // el menú nace oculto y la cuña contiene a sus botones
  doc.getElementById('headerMenu').hidden = true;
  doc.getElementById('headerMenuWrap').children.push(
    doc.getElementById('menuBtn'), doc.getElementById('headerMenu'),
    doc.getElementById('exportBtn'), doc.getElementById('importBtn'));
  return doc;
}

function boot(seed) {
  const app = loadApp(seed);
  const doc = makeDoc();
  const calls = [];
  app.sandbox.document = doc;
  app.sandbox.exportBackup = () => calls.push('export');
  app.sandbox.openImportPicker = () => calls.push('import');
  app.sandbox.setupEvents();
  return { ...app, doc, calls };
}
const fire = (doc, type, e) => (doc.listeners[type] || []).forEach(fn => fn(e));

// =======================================================================
// Menú ⋮
// =======================================================================
test('index.html: el encabezado ya no muestra Exportar/Importar; viven dentro del menú ⋮ con roles accesibles', () => {
  const header = html.slice(html.indexOf('class="header-row"'), html.indexOf('id="storageWarning"'));
  const menu = header.slice(header.indexOf('id="headerMenu"'));
  assert.match(menu, /id="exportBtn"[^>]*role="menuitem"[^>]*>Exportar backup</);
  assert.match(menu, /id="importBtn"[^>]*role="menuitem"[^>]*>Importar backup</);
  assert.match(menu, /id="historyBtn"[^>]*role="menuitem"[^>]*>Importar historial de tiempo</);
  assert.match(html, /id="historyFileInput"[^>]*accept="application\/json,\.json"[^>]*hidden/);
  assert.match(html, /id="historyImport" class="modal"/);
  assert.doesNotMatch(header.slice(0, header.indexOf('id="headerMenu"')), /Exportar backup|Importar backup/);
  assert.match(header, /id="menuBtn"[^>]*aria-label="Más opciones"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="headerMenu"/);
  assert.match(header, /id="headerMenu" role="menu"[^>]*hidden/);
  assert.doesNotMatch(html, /btn-export/);
});

test('menú: el botón ⋮ abre y cierra, actualiza aria-expanded y manda el foco a la primera opción', () => {
  const { doc } = boot();
  const btn = doc.getElementById('menuBtn');
  const menu = doc.getElementById('headerMenu');
  btn.onclick();
  assert.equal(menu.hidden, false);
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(FakeEl.active, doc.getElementById('exportBtn'));
  btn.onclick();
  assert.equal(menu.hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
});

test('menú: Escape cierra y devuelve el foco al botón; sin menú abierto no hace nada', () => {
  const { doc } = boot();
  const btn = doc.getElementById('menuBtn');
  let prevented = 0;
  fire(doc, 'keydown', { key: 'Escape', preventDefault() { prevented++; } });
  assert.equal(prevented, 0);
  btn.onclick();
  fire(doc, 'keydown', { key: 'Escape', target: doc.getElementById('exportBtn'), preventDefault() { prevented++; } });
  assert.equal(doc.getElementById('headerMenu').hidden, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(FakeEl.active, btn);
  assert.equal(prevented, 1);
});

test('menú: flechas, Inicio y Fin recorren las opciones; Tab cierra', () => {
  const { doc } = boot();
  const exp = doc.getElementById('exportBtn');
  const imp = doc.getElementById('importBtn');
  const his = doc.getElementById('historyBtn');
  doc.getElementById('menuBtn').onclick();
  const key = (k, target) => fire(doc, 'keydown', { key: k, target, preventDefault() {} });
  key('ArrowDown', exp);
  assert.equal(FakeEl.active, imp);
  key('ArrowDown', imp);
  assert.equal(FakeEl.active, his);
  key('ArrowDown', his);
  assert.equal(FakeEl.active, exp, 'da la vuelta');
  key('ArrowUp', exp);
  assert.equal(FakeEl.active, his);
  key('Home', his);
  assert.equal(FakeEl.active, exp);
  key('End', exp);
  assert.equal(FakeEl.active, his);
  key('Tab', his);
  assert.equal(doc.getElementById('headerMenu').hidden, true);
});

test('menú: un clic fuera lo cierra; un clic dentro no', () => {
  const { doc } = boot();
  doc.getElementById('menuBtn').onclick();
  fire(doc, 'click', { target: doc.getElementById('headerMenu') });
  assert.equal(doc.getElementById('headerMenu').hidden, false);
  fire(doc, 'click', { target: new FakeEl('afuera') });
  assert.equal(doc.getElementById('headerMenu').hidden, true);
});

test('menú: elegir una opción cierra el menú y ejecuta exactamente la misma función de siempre', () => {
  const { doc, calls } = boot();
  doc.getElementById('menuBtn').onclick();
  doc.getElementById('exportBtn').onclick();
  assert.deepEqual(calls, ['export']);
  assert.equal(doc.getElementById('headerMenu').hidden, true);
  doc.getElementById('menuBtn').onclick();
  doc.getElementById('importBtn').onclick();
  assert.deepEqual(calls, ['export', 'import']);
  assert.equal(doc.getElementById('headerMenu').hidden, true);
});

test('menú: no toca los datos (abrir, cerrar y elegir no escriben en localStorage)', () => {
  const seedData = { habits: '[]', completions: '{}', quantities: '{}', skips: '{}' };
  const { doc, localStorage } = boot(seedData);
  const before = JSON.stringify(localStorage._dump());
  doc.getElementById('menuBtn').onclick();
  doc.getElementById('exportBtn').onclick();
  doc.getElementById('menuBtn').onclick();
  fire(doc, 'keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(JSON.stringify(localStorage._dump()), before);
});

// =======================================================================
// Tema
// =======================================================================
test('tema: sin preferencia arranca claro y el botón ofrece el tema oscuro', () => {
  const { doc } = boot();
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  const btn = doc.getElementById('themeBtn');
  assert.equal(btn.getAttribute('aria-label'), 'Activar tema Noir Editorial (oscuro)');
  assert.equal(btn.getAttribute('title'), 'Activar tema Noir Editorial (oscuro)');
  assert.equal(doc.getElementById('themeBtnLabel').textContent, 'Oscuro');
  assert.equal(doc.meta.getAttribute('content'), '#F6F3EA');
});

test('tema: alternar guarda la preferencia en su propia clave y vuelve a claro', () => {
  const { doc, localStorage } = boot();
  const btn = doc.getElementById('themeBtn');
  btn.onclick();
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(localStorage.getItem('habitTracker.theme'), 'dark');
  assert.equal(btn.getAttribute('aria-label'), 'Activar tema Natural Linen (claro)');
  assert.equal(doc.getElementById('themeBtnLabel').textContent, 'Claro');
  assert.equal(doc.meta.getAttribute('content'), '#0A0A0A');
  btn.onclick();
  assert.equal(doc.documentElement.getAttribute('data-theme'), null);
  assert.equal(localStorage.getItem('habitTracker.theme'), 'light');
  assert.equal(doc.meta.getAttribute('content'), '#F6F3EA');
});

test('tema: una preferencia guardada oscura se aplica al iniciar; un valor desconocido cae a claro', () => {
  assert.equal(boot({ 'habitTracker.theme': 'dark' }).doc.documentElement.getAttribute('data-theme'), 'dark');
  for (const junk of ['', 'DARK', 'blue', '1', 'null', '<script>']) {
    assert.equal(boot({ 'habitTracker.theme': junk }).doc.documentElement.getAttribute('data-theme'), null, junk);
  }
});

test('tema: sin storage disponible el cambio igual vale para la sesión y no lanza', () => {
  const { sandbox, doc } = boot();
  sandbox.localStorage = {
    getItem() { throw new Error('bloqueado'); },
    setItem() { throw new Error('bloqueado'); },
    removeItem() {},
  };
  assert.doesNotThrow(() => doc.getElementById('themeBtn').onclick());
  assert.equal(doc.documentElement.getAttribute('data-theme'), 'dark');
  assert.equal(sandbox.readThemePreference(), 'light');
});

test('tema: la preferencia no entra al backup, al snapshot ni a las cuatro claves de datos', () => {
  const seedData = { habits: '[]', completions: '{}', quantities: '{}', skips: '{}' };
  const { sandbox, doc, localStorage } = boot(seedData);
  doc.getElementById('themeBtn').onclick();
  const backup = sandbox.buildBackupV3();
  assert.deepEqual(Object.keys(backup).sort(), ['completions', 'exportedAt', 'habits', 'quantities', 'schemaVersion', 'skips']);
  assert.equal(backup.schemaVersion, 3);
  assert.doesNotMatch(JSON.stringify(backup), /theme|dark/);
  assert.equal(localStorage.getItem('habits'), '[]');
  const snapshot = sandbox.buildSnapshot('[]', '{}', '{}', '{}');
  assert.doesNotMatch(snapshot, /theme|dark/);
});

test('tema: importar un backup válido no cambia la preferencia de tema', () => {
  const { sandbox, doc, localStorage } = boot();
  doc.getElementById('themeBtn').onclick();
  const r = sandbox.validateBackup(JSON.stringify({
    schemaVersion: 3, exportedAt: '2026-01-02T00:00:00.000Z', habits: [], completions: {}, quantities: {}, skips: {},
  }));
  assert.equal(r.ok, true);
  sandbox.performImportReplacement(r.data);
  assert.equal(localStorage.getItem('habitTracker.theme'), 'dark');
});
