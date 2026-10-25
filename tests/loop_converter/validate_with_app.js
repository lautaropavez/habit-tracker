'use strict';
// Lee un backup JSON por stdin y lo valida con el validateBackup() REAL de
// js/app.js (via el harness vm existente). Imprime {ok, error}; no
// reimplementa ninguna regla de validacion.
const { loadApp } = require('../backup_v2/load_app');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const { sandbox } = loadApp({});
  const result = sandbox.validateBackup(input);
  process.stdout.write(JSON.stringify({ ok: result.ok === true, error: result.ok ? null : String(result.error) }));
});
