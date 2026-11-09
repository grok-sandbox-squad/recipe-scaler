// Static checks for the UI files (no DOM needed) and the demo recipes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scaleRecipe } from '../src/scale.js';
import { DEMO_RECIPES, findDemo } from '../src/demo-recipes.js';
import { REASON_LABELS, reasonLabel } from '../src/reasons.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const UI_FILES = ['index.html', 'app.js', 'app.css', 'src/demo-recipes.js', 'src/reasons.js'];

test('UI code never uses HTML-string sinks', () => {
  for (const file of ['app.js', 'src/demo-recipes.js', 'src/reasons.js', 'index.html']) {
    const src = read(file);
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) {
      assert.ok(!src.includes(sink), `${file} must not use ${sink}`);
    }
  }
});

test('UI loads no external scripts, styles, fonts or other resources', () => {
  const html = read('index.html');
  // Every src= / link href= must be relative (no scheme, no //, no leading /).
  const refs = [...html.matchAll(/<(script|link|img|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)];
  assert.ok(refs.length >= 2, 'expected app.css and app.js references');
  for (const [, tag, url] of refs) {
    if (url === 'data:,') continue; // empty favicon, avoids a /favicon.ico request
    assert.match(url, /^(?![a-z][a-z0-9+.-]*:|\/)/i, `<${tag}> must use a relative path, got ${url}`);
  }
  for (const file of ['app.js', 'app.css', 'src/demo-recipes.js', 'src/reasons.js']) {
    const src = read(file);
    assert.ok(!/https?:\/\//i.test(src), `${file} must not contain http(s) URLs`);
    assert.ok(!/@import|@font-face|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(src), `${file} must not load remote resources`);
  }
});

test('app.js imports only relative modules', () => {
  const js = read('app.js');
  const imports = [...js.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['./src/demo-recipes.js', './src/reasons.js', './src/scale.js']);
});

test('index.html has labels for every input and the expected controls', () => {
  const html = read('index.html');
  for (const id of ['recipe', 'original', 'target', 'demo']) {
    assert.match(html, new RegExp(`<label for="${id}"`), `missing label for #${id}`);
    assert.match(html, new RegExp(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /name="system" value="us"/);
  assert.match(html, /name="system" value="metric"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /not scaled/);
});

test('UI files exist and are non-empty', () => {
  for (const f of UI_FILES) assert.ok(read(f).length > 100, `${f} looks empty`);
});

test('demo recipes are clearly made up and scale cleanly', () => {
  assert.ok(DEMO_RECIPES.length >= 1 && DEMO_RECIPES.length <= 2);
  for (const demo of DEMO_RECIPES) {
    assert.match(demo.title, /made-up demo/i);
    assert.equal(findDemo(demo.id), demo);
    for (const system of ['us', 'metric']) {
      const r = scaleRecipe(demo.text, { originalServings: demo.servings, targetServings: demo.servings * 2, system });
      const content = r.lines.filter((l) => !l.blank);
      assert.ok(content.filter((l) => l.scaled).length >= 5, `${demo.id} should have several scalable lines`);
      assert.ok(r.lines.some((l) => l.blank), `${demo.id} should show a kept blank line`);
      assert.ok(content.some((l) => l.flagged), `${demo.id} should show a "not scaled" line`);
      for (const l of r.lines) {
        assert.ok(!/NaN|undefined|Infinity/.test(l.output), `bad output: ${l.output}`);
      }
    }
  }
  assert.equal(findDemo('nope'), undefined);
});

test('the UI error path relies on RangeError for bad servings', () => {
  for (const [o, t] of [[0, 4], [4, 0], [NaN, 4], [-2, 4], [4, Infinity]]) {
    assert.throws(() => scaleRecipe('1 cup flour', { originalServings: o, targetServings: t }), RangeError);
  }
});

test('every reason code scale.js can return has a UI label', () => {
  const src = read('src/scale.js');
  const codes = new Set([...src.matchAll(/reason:\s*'([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(codes.size >= 4, `expected several reason codes, found ${[...codes]}`);
  for (const code of codes) {
    assert.ok(Object.hasOwn(REASON_LABELS, code), `missing label for reason '${code}'`);
    assert.ok(REASON_LABELS[code].length > 0);
  }
  // Codes seen at run time on known flagged lines are covered too.
  const samples = ['salt to taste', '0 cups sugar', '1 000 g flour', '1.5.2 g', '5. cup', '350°F', '1 pinch of salt'];
  for (const line of samples) {
    const r = scaleRecipe(line, { originalServings: 1, targetServings: 2 }).lines[0];
    assert.ok(r.flagged, `${line} should be flagged`);
    assert.ok(Object.hasOwn(REASON_LABELS, r.reason), `no label for '${r.reason}' (${line})`);
  }
  assert.equal(reasonLabel('zero-quantity'), 'amount is zero');
  assert.equal(reasonLabel('some-new-code'), 'could not scale');
  assert.equal(reasonLabel(null), 'could not scale');
});
