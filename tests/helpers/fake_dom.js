'use strict';
/**
 * DOM falso mínimo (sin dependencias) para tests de interfaz que arman nodos
 * con createElement/textContent. Datos sintéticos únicamente.
 */
const { loadApp } = require('../backup_v2/load_app.js');

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
function findAllByClass(el, cls) {
  const out = [];
  walk(el, (n) => { if (String(n.className).split(/\s+/).includes(cls)) out.push(n); });
  return out;
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

module.exports = { FakeEl, walk, findByClass, findAllByClass, allText, makeFakeDocument, withFakeDom };
