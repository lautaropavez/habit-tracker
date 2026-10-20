'use strict';
/**
 * Harness minimo para cargar js/app.js real (sin reimplementar su
 * logica) dentro de una sandbox de Node (`vm` nativo), con un mock de
 * `localStorage` y un proxy no-op universal para `document`/`navigator`
 * -- sin DOM real, sin dependencias externas, solo módulos nativos de
 * Node (`vm`, `fs`, `path`).
 *
 * `document`/`navigator` se mockean con un proxy que nunca lanza
 * excepcion ante ninguna propiedad o llamada, para que init() (que
 * corre automaticamente al cargar app.js) pueda ejecutar
 * setupEvents()/render() sin una UI real -- esos tests no verifican
 * UI, solo las funciones puras de datos/contrato (validateBackup,
 * buildBackupV2, validateExportState, performImportReplacement, etc.).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS_PATH = path.join(__dirname, '..', '..', 'js', 'app.js');

function makeNoopProxy(label) {
  const target = function noop() { return makeNoopProxy(label + '()'); };
  const proxy = new Proxy(target, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return (hint) => (hint === 'number' ? 0 : '');
      if (prop === 'valueOf') return () => 0;
      if (prop === 'toString') return () => '';
      if (prop === Symbol.iterator) return function* () {};
      if (prop === 'length') return 0;
      if (prop === 'then') return undefined;
      return makeNoopProxy(label + '.' + String(prop));
    },
    set() { return true; },
    apply() { return makeNoopProxy(label + '(call)'); },
    has() { return true; },
  });
  return proxy;
}

function makeLocalStorageMock(seed) {
  const store = new Map(Object.entries(seed || {}));
  return {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); },
    removeItem(k) { store.delete(k); },
    clear() { store.clear(); },
    _dump() { return Object.fromEntries(store); },
  };
}

/**
 * Carga una instancia FRESCA de la app (corre init() de nuevo) con el
 * localStorage que se le pase -- cada test parte de un estado limpio y
 * controlado, sin contaminarse entre tests.
 */
function loadApp(localStorageSeed) {
  const code = fs.readFileSync(APP_JS_PATH, 'utf8');
  const localStorage = makeLocalStorageMock(localStorageSeed);
  const sandbox = {
    console,
    Date, JSON, Array, Object, Math, Number, String, Boolean, Set, Map, Symbol,
    TextEncoder,
    localStorage,
    document: makeNoopProxy('document'),
    navigator: { canShare: undefined },
    alert: () => {},
    Blob: function Blob() {},
    File: undefined,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'app.js' });
  return { sandbox, localStorage };
}

module.exports = { loadApp, makeLocalStorageMock };
