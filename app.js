// Recipe Scaler UI. Wires the form to src/scale.js and renders the result.
// SECURITY: ingredient text is user input, so output is built only with
// DOM nodes and textContent. Never use HTML-string APIs here.
import { scaleRecipe } from './src/scale.js';
import { DEMO_RECIPES, findDemo } from './src/demo-recipes.js';
import { reasonLabel } from './src/reasons.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('controls'),
  demo: $('demo'),
  original: $('original'),
  target: $('target'),
  recipe: $('recipe'),
  output: $('output'),
  summary: $('summary'),
  error: $('servings-error'),
  copy: $('copy'),
};

let lastText = '';

function selectedSystem() {
  const checked = els.form.querySelector('input[name="system"]:checked');
  return checked && checked.value === 'metric' ? 'metric' : 'us';
}

function formatFactor(f) {
  return String(Math.round(f * 100) / 100);
}

function showError(message) {
  els.error.textContent = message;
  els.error.hidden = false;
  els.original.setAttribute('aria-invalid', String(!(Number(els.original.value) > 0)));
  els.target.setAttribute('aria-invalid', String(!(Number(els.target.value) > 0)));
}

function clearError() {
  els.error.textContent = '';
  els.error.hidden = true;
  els.original.removeAttribute('aria-invalid');
  els.target.removeAttribute('aria-invalid');
}

function renderLine(line) {
  const li = document.createElement('li');
  if (line.blank) {
    li.className = 'line blank';
    li.setAttribute('aria-hidden', 'true');
    return li;
  }
  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = line.output;
  li.append(text);
  if (line.flagged) {
    li.className = 'line flagged';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = 'not scaled';
    li.append(' ', badge);
    const why = document.createElement('span');
    why.className = 'reason';
    why.textContent = `(${reasonLabel(line.reason)})`;
    li.append(' ', why);
  } else {
    li.className = line.scaled ? 'line scaled' : 'line';
  }
  return li;
}

function update() {
  let result;
  try {
    result = scaleRecipe(els.recipe.value, {
      originalServings: els.original.value === '' ? NaN : Number(els.original.value),
      targetServings: els.target.value === '' ? NaN : Number(els.target.value),
      system: selectedSystem(),
    });
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    showError('Servings must be numbers greater than 0. Check the original and target servings.');
    els.output.replaceChildren();
    els.summary.textContent = '';
    lastText = '';
    els.copy.disabled = true;
    return;
  }
  clearError();
  els.output.replaceChildren(...result.lines.map(renderLine));
  lastText = result.text;
  els.copy.disabled = els.recipe.value.trim() === '';

  const content = result.lines.filter((l) => !l.blank);
  const flagged = content.filter((l) => l.flagged).length;
  if (content.length === 0) {
    els.summary.textContent = 'Paste or type ingredients to see them scaled.';
  } else {
    const parts = [`Scaled ×${formatFactor(result.factor)}`, `${content.length - flagged} of ${content.length} lines scaled`];
    if (flagged) parts.push(`${flagged} not scaled`);
    els.summary.textContent = parts.join(' · ');
  }
}

function loadDemo(id) {
  const demo = findDemo(id);
  if (!demo) return;
  els.recipe.value = demo.text;
  els.original.value = String(demo.servings);
  els.target.value = String(demo.servings * 2);
  update();
}

async function copyOutput() {
  if (!lastText) return;
  const label = els.copy.textContent;
  try {
    await navigator.clipboard.writeText(lastText);
    els.copy.textContent = 'Copied';
  } catch {
    els.copy.textContent = 'Copy failed';
  }
  setTimeout(() => { els.copy.textContent = label; }, 1500);
}

for (const demo of DEMO_RECIPES) {
  const opt = document.createElement('option');
  opt.value = demo.id;
  opt.textContent = demo.title;
  els.demo.append(opt);
}

els.form.addEventListener('input', (e) => {
  if (e.target === els.demo) return;
  update();
});
els.form.addEventListener('change', (e) => {
  if (e.target === els.demo) loadDemo(els.demo.value);
  else update();
});
els.form.addEventListener('submit', (e) => e.preventDefault());
els.copy.addEventListener('click', copyOutput);

// Start with the first demo so the page shows something useful.
els.demo.value = DEMO_RECIPES[0].id;
loadDemo(DEMO_RECIPES[0].id);
