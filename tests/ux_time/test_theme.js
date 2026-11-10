'use strict';
/**
 * Tema Natural Linen: verificaciones estáticas sobre css/styles.css e
 * index.html (paleta, contraste WCAG de los pares de color usados, sin
 * recursos externos, foco visible). No reemplaza la prueba visual real.
 *
 * Correr con: node --test tests/ux_time/test_theme.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const css = fs.readFileSync(path.join(root, 'css', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'js', 'app.js'), 'utf8');

function parseTokens(block) {
  const out = {};
  for (const [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) {
    out[name] = value.toUpperCase();
  }
  return out;
}
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, '');
const lightBlock = (cssCode.match(/:root\s*\{([^}]*)\}/) || [])[1] || '';
const darkBlock = (cssCode.match(/:root\[data-theme="dark"\]\s*\{([^}]*)\}/) || [])[1] || '';
const tokens = parseTokens(lightBlock);
const darkTokens = { ...tokens, ...parseTokens(darkBlock) };

function lum(hex) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(x => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('paleta de referencia presente', () => {
  assert.equal(tokens.linen, '#F6F3EA');
  assert.equal(tokens.ivory, '#FFFEFA');
  assert.equal(tokens.stone, '#E4E3D9');
  assert.equal(tokens.sage, '#9BAB91');
  assert.equal(tokens.green, '#788C70');
  assert.equal(tokens.ink, '#292E26');
});

const TEXT_PAIRS = [['ink', 'linen'], ['ink', 'ivory'], ['text-2', 'linen'], ['text-2', 'ivory'],
  ['text-2', 'locked-bg'], ['ink', 'sage-soft'], ['green-deep', 'sage-soft'], ['green-deep', 'sage-faint'],
  ['green-deep', 'linen'], ['danger', 'ivory'], ['danger', 'linen'], ['ivory', 'green-deep']];
const GRAPHIC_PAIRS = [['green', 'ivory'], ['green', 'linen'], ['control-border', 'ivory'],
  ['control-border', 'linen'], ['text-3', 'linen'], ['text-3', 'ivory']];

test('contraste de texto >= 4.5:1 sobre lino, marfil y superficies de estado (Natural Linen)', () => {
  for (const [fg, bg] of TEXT_PAIRS) {
    assert.ok(ratio(tokens[fg], tokens[bg]) >= 4.5, `${fg} sobre ${bg}: ${ratio(tokens[fg], tokens[bg]).toFixed(2)}`);
  }
});

test('contraste de componentes gráficos y bordes de control >= 3:1 (Natural Linen)', () => {
  for (const [fg, bg] of GRAPHIC_PAIRS) {
    assert.ok(ratio(tokens[fg], tokens[bg]) >= 3, `${fg} sobre ${bg}: ${ratio(tokens[fg], tokens[bg]).toFixed(2)}`);
  }
});

test('Noir Editorial: paleta de referencia presente', () => {
  assert.equal(darkTokens.linen, '#0A0A0A');
  assert.equal(darkTokens.ivory, '#171717');
  assert.equal(darkTokens.stone, '#34312E');
  assert.equal(darkTokens.green, '#B5B0A5');
  assert.equal(darkTokens.ink, '#F0EBE2');
});

test('Noir Editorial: contraste de texto >= 4.5:1 y de componentes >= 3:1', () => {
  const t = darkTokens;
  for (const [fg, bg] of TEXT_PAIRS) {
    assert.ok(ratio(t[fg], t[bg]) >= 4.5, `oscuro ${fg} sobre ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
  }
  for (const [fg, bg] of GRAPHIC_PAIRS) {
    assert.ok(ratio(t[fg], t[bg]) >= 3, `oscuro ${fg} sobre ${bg}: ${ratio(t[fg], t[bg]).toFixed(2)}`);
  }
  // sage (bordes de estados parciales) distinguible del fondo de la tarjeta
  assert.ok(ratio(t.sage, t.ivory) >= 3, `oscuro sage sobre ivory: ${ratio(t.sage, t.ivory).toFixed(2)}`);
});

test('Noir Editorial: mismos tokens que Natural Linen (misma estructura en ambos temas)', () => {
  const lightNames = Object.keys(tokens).sort();
  const darkNames = Object.keys(parseTokens(darkBlock)).sort();
  assert.deepEqual(darkNames, lightNames);
  for (const name of ['danger-border', 'overlay', 'shadow-soft']) {
    assert.match(lightBlock, new RegExp('--' + name + ':'));
    assert.match(darkBlock, new RegExp('--' + name + ':'));
  }
});

test('sin gris frío, gradientes, sombras fuertes ni recursos externos en ningún tema', () => {
  assert.doesNotMatch(css, /#000(000)?\b/i);
  assert.doesNotMatch(css, /#(1a1a1a|2a2a2a|3a3a3a|4CAF50|888)\b/i);
  assert.doesNotMatch(css, /gradient\(/i);
  assert.doesNotMatch(css, /@import|url\(|https?:\/\//i);
  assert.doesNotMatch(css, /prefers-color-scheme/);
  assert.doesNotMatch(css, /neon|blur\(|text-shadow/i);
  // las sombras solo salen del token --shadow-soft: suave en claro y ninguna en oscuro
  for (const [, shadow] of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
    assert.equal(shadow.trim(), 'var(--shadow-soft)');
  }
  assert.match(lightBlock, /--shadow-soft:\s*0 1px 4px rgba\(41, 46, 38, 0?\.[0-3]\)/);
  assert.match(darkBlock, /--shadow-soft:\s*none/);
  // no quedan colores sueltos fuera de los bloques de tokens
  const outside = cssCode.replace(lightBlock, '').replace(darkBlock, '');
  assert.deepEqual(outside.match(/#[0-9A-Fa-f]{3,8}\b/g) || [], [], 'colores fijos fuera de los tokens');
});

test('selector de tema: theme-color inicial de lino, sin tema automático del sistema', () => {
  assert.match(html, /<meta name="theme-color" content="#F6F3EA"/);
  assert.doesNotMatch(html + appJs, /prefers-color-scheme/);
  assert.match(appJs, /THEME_COLORS = \{ light: '#F6F3EA', dark: '#0A0A0A' \}/);
  // el script inicial de <head> aplica solo el valor guardado (sin red ni recursos externos)
  const inline = (html.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || '';
  assert.match(inline, /habitTracker\.theme/);
  assert.doesNotMatch(inline, /fetch|XMLHttpRequest|https?:/);
});

test('botones del encabezado: tema y menú ⋮ táctiles; −5/+5 juntos', () => {
  assert.match(css, /\.icon-action\s*\{[^}]*min-height:\s*44px[^}]*min-width:\s*44px/);
  assert.match(css, /\.header-menu-item\s*\{[^}]*min-height:\s*44px/);
  const qb = (css.match(/\.quantity-buttons\s*\{([^}]*)\}/) || [])[1] || '';
  assert.match(qb, /justify-content:\s*flex-start/);
  assert.doesNotMatch(qb, /space-between/);
  assert.match(css, /\.calendar-day\.before-created\s*\{/);
  assert.doesNotMatch(css, /\.calendar-day\.locked/);
});

test('foco visible, objetivos táctiles de 44 px y regla para pantallas angostas', () => {
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*2px solid/);
  assert.match(css, /\.calendar-day\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /\.btn\s*\{[^}]*min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 480px\)/);
});

test('los estados del Calendario no dependen solo del color', () => {
  assert.match(css, /\.calendar-day\.skipped\s*\{[^}]*dashed/);
  assert.match(css, /\.legend-skipped\s*\{[^}]*dashed/);
  assert.match(css, /\.calendar-day\.future\s*\{[^}]*dotted/);
  assert.match(css, /\.chart-bar\.chart-bar-skipped\s*\{[^}]*dashed/);
});

test('app.js ya no pinta celdas ni barras con el color del hábito (solo el borde de la tarjeta)', () => {
  assert.doesNotMatch(appJs, /cell\.style\.(background|color|opacity)/);
  assert.doesNotMatch(appJs, /bar\.style\.background|barInner\.style\.background/);
  assert.match(appJs, /card\.style\.borderLeftColor/);
});

test('gráfico de 30 días: barras que se reparten el ancho, sin scroll horizontal y sin ancho fijo', () => {
  const esc = (sel) => sel.replace(/[.]/g, String.raw`\.`);
  const block = (sel) => (css.match(new RegExp(esc(sel) + String.raw`\s*\{([^}]*)\}`)) || [])[1] || '';
  const bars = block('.chart-bars-30');
  const wrapper = block('.chart-bars-30 .chart-bar-wrapper');
  assert.ok(bars && wrapper);
  assert.doesNotMatch(bars + wrapper, /overflow-x:\s*(scroll|auto)|min-width:\s*[1-9]\d*px|\bwidth:\s*\d+px/);
  assert.match(wrapper, /min-width:\s*0/);
  assert.match(css, /\.chart-bar\.chart-bar-na\s*\{[^}]*dotted/);
});

test('formulario: el selector de forma de registro ocupa el ancho y es táctil', () => {
  assert.match(css, /\.kind-select\s*\{[^}]*min-height:\s*44px/);
  assert.match(html, /<label for="kindSelect">¿Cómo querés registrarlo\?<\/label>/);
  assert.doesNotMatch(html, /booleano|cuantitativo/i);
});
