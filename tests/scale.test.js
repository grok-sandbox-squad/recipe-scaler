import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity, formatFraction, formatMetric, formatUsVolume, convertAmount,
  scaleLine, scaleRecipe, scaleFactor, ALLOW_HALF_TBSP,
} from '../src/scale.js';

const out = (line, factor = 1, system = 'us') => scaleLine(line, factor, { system }).output;

test('parseQuantity: whole, decimal, fraction, mixed, unicode', () => {
  assert.equal(parseQuantity('3'), 3);
  assert.equal(parseQuantity('1.5'), 1.5);
  assert.equal(parseQuantity('.25'), 0.25);
  assert.equal(parseQuantity('1/2'), 0.5);
  assert.equal(parseQuantity('1 1/2'), 1.5);
  assert.equal(parseQuantity('½'), 0.5);
  assert.equal(parseQuantity('1½'), 1.5);
  assert.equal(parseQuantity('1 ¾'), 1.75);
  assert.equal(parseQuantity('1\u20442'), 0.5);
  assert.equal(parseQuantity('1/0'), null);
  assert.equal(parseQuantity('pinch'), null);
});

test('formatFraction: friendly kitchen fractions (D4)', () => {
  assert.equal(formatFraction(3), '3');
  assert.equal(formatFraction(1.5), '1 1/2');
  assert.equal(formatFraction(0.333), '1/3');
  assert.equal(formatFraction(1.34), '1 1/3');
  assert.equal(formatFraction(0.66), '2/3');
  assert.equal(formatFraction(0.125), '1/8');
  assert.equal(formatFraction(2.97), '3');
  assert.equal(formatFraction(0.01), '1/8');
  assert.equal(formatFraction(0), '0');
});

test('formatMetric: whole numbers, 1 decimal under 10 (D4)', () => {
  assert.equal(formatMetric(236.588), '237');
  assert.equal(formatMetric(4.93), '4.9');
  assert.equal(formatMetric(5), '5');
  assert.equal(formatMetric(1.25, true), '1.25');
});

test('48 tsp -> 1 cup', () => {
  // x1 echoes cook volumes; conversion shows up when scaled or via formatUsVolume.
  assert.equal(out('48 tsp sugar'), '48 tsp sugar');
  assert.equal(out('24 tsp sugar', 2), '1 cup sugar');
  assert.equal(formatUsVolume(48, 'tsp'), '1 cup');
  assert.ok(Math.abs(convertAmount(48, 'tsp').value - 1) < 1e-9);
});

test('6 tsp -> 2 tbsp; small amounts stay in tsp', () => {
  assert.equal(out('6 tsp vanilla'), '6 tsp vanilla'); // x1 echo
  assert.equal(out('3 tsp vanilla', 2), '2 tbsp vanilla');
  assert.equal(formatUsVolume(6, 'tsp'), '2 tbsp');
  assert.equal(out('1 tsp salt', 0.5), '1/2 tsp salt');
});

test('1 1/2 cups x2 -> 3 cups', () => {
  assert.equal(out('1 1/2 cups flour', 2), '3 cups flour');
});

test('cups keep reading as cups; 5 tbsp stays tbsp (1/3 cup would be too far off)', () => {
  assert.equal(out('1/2 cup milk'), '1/2 cup milk');
  assert.equal(out('2 tbsp butter', 2), '1/4 cup butter');
  assert.equal(out('5 tbsp butter'), '5 tbsp butter');
});

test('decimals scale and format as fractions', () => {
  assert.equal(out('0.5 cup water', 3), '1 1/2 cups water');
  assert.equal(out('1.5 tbsp oil', 2), '3 tbsp oil');
  assert.equal(out('2.5 kg potatoes', 2, 'metric'), '5 kg potatoes');
});

test('unicode fractions', () => {
  assert.equal(out('½ cup milk', 2), '1 cup milk');
  assert.equal(out('1½ cups oats', 2), '3 cups oats');
  assert.equal(out('¾ tsp cinnamon', 4), '1 tbsp cinnamon');
});

test('"3 eggs" scales as a count and is never converted', () => {
  assert.equal(out('3 eggs', 2), '6 eggs');
  assert.equal(out('3 eggs', 0.5), '1 1/2 eggs');
  assert.equal(out('3 eggs', 2, 'metric'), '6 eggs');
  assert.equal(out('2 large eggs', 2), '4 large eggs');
});

test('"pinch of salt" is kept unchanged and flagged', () => {
  for (const line of ['pinch of salt', 'salt to taste', 'For the sauce:']) {
    const r = scaleLine(line, 3);
    assert.equal(r.output, line);
    assert.equal(r.scaled, false);
    assert.equal(r.flagged, true);
    assert.equal(r.reason, 'no-quantity');
  }
});

test('numbered steps and temperatures are not scaled', () => {
  for (const line of ['1. Preheat the oven', '2) Mix', '350°F oven']) {
    const r = scaleLine(line, 2);
    assert.equal(r.output, line);
    assert.equal(r.flagged, true);
  }
});

test('blank lines are preserved and not flagged', () => {
  const r = scaleRecipe('2 cups flour\n\n   \n1 egg', { originalServings: 2, targetServings: 4 });
  assert.equal(r.text, '4 cups flour\n\n   \n2 eggs');
  assert.equal(r.lines[1].blank, true);
  assert.equal(r.lines[1].flagged, false);
  assert.equal(r.lines[2].blank, true);
});

test('metric output', () => {
  assert.equal(out('1 cup milk', 1, 'metric'), '237 ml milk');
  assert.equal(out('1 tsp salt', 1, 'metric'), '4.9 ml salt');
  assert.equal(out('8 oz cheese', 1, 'metric'), '227 g cheese');
  assert.equal(out('2 lb chicken', 1, 'metric'), '907 g chicken');
  assert.equal(out('3 lb flour', 1, 'metric'), '1.36 kg flour');
  assert.equal(out('500 ml stock', 2, 'metric'), '1 l stock');
  assert.equal(out('0.5 kg rice', 1, 'metric'), '500 g rice');
});

test('US weight: oz up to 16, then lb; metric input converts to US', () => {
  assert.equal(out('8 oz cheese', 2), '1 lb cheese');
  assert.equal(out('10 oz pasta', 2), '1 1/4 lb pasta');
  assert.equal(out('6 oz spinach'), '6 oz spinach');
  assert.equal(out('250 ml water'), '1 cup + 1 tbsp water');
  assert.equal(out('500 g flour'), '1 1/8 lb flour');
});

test('ranges, bullets and unit spellings', () => {
  assert.equal(out('2-3 cloves garlic', 2), '4-6 cloves garlic');
  assert.equal(out('1 to 2 tablespoons honey', 2), '2 to 4 tbsp honey'); // shared tbsp unit
  assert.equal(out('- 2 Tbsp. olive oil', 1), '- 2 Tbsp. olive oil'); // x1 echoes spelling
  assert.equal(out('1 teaspoon baking soda', 3), '1 tbsp baking soda');
  assert.equal(out('1 lemon', 1), '1 lemon');
});

test('scaleRecipe: factor, line results, invalid servings', () => {
  const r = scaleRecipe('1 cup sugar\npinch of salt', { originalServings: 4, targetServings: 2 });
  assert.equal(r.factor, 0.5);
  assert.equal(r.text, '1/2 cup sugar\npinch of salt');
  assert.equal(r.lines[0].scaled, true);
  assert.equal(r.lines[1].flagged, true);
  assert.throws(() => scaleFactor(0, 4), RangeError);
  assert.throws(() => scaleRecipe('1 egg', { originalServings: 2, targetServings: -1 }), RangeError);
});

test('malformed numbers are kept unchanged and flagged', () => {
  for (const [line, factor] of [
    ['1.5.2 g', 1], ['1.2.3 cups flour', 2], ['12.34.56 tsp sugar', 1],
    ['1..5 cup', 1], ['1,5 g', 2], ['1/2/3 cup', 2], ['1/0 cup', 2],
  ]) {
    const r = scaleLine(line, factor);
    assert.equal(r.output, line, line);
    assert.equal(r.scaled, false, line);
    assert.equal(r.flagged, true, line);
    assert.equal(r.reason, 'no-quantity', line);
  }
  const r = scaleRecipe('1.5.2 g butter\n2 cups milk', { originalServings: 1, targetServings: 2 });
  assert.equal(r.text, '1.5.2 g butter\n4 cups milk');
});

test('scaleLine / scaleRecipe reject a bad factor with RangeError', () => {
  for (const f of [0, -1, NaN, Infinity, -Infinity, '2', undefined]) {
    assert.throws(() => scaleLine('1 cup sugar', f), RangeError, String(f));
    assert.throws(() => scaleLine('', f), RangeError, String(f));
  }
  assert.throws(() => scaleRecipe('1 cup sugar', { originalServings: 2, targetServings: Infinity }), RangeError);
  assert.throws(() => scaleRecipe('1 cup sugar', { originalServings: NaN, targetServings: 2 }), RangeError);
});

test('pinch, dash and smidgen are never scaled', () => {
  for (const line of ['1 pinch salt', '2 pinches nutmeg', '1 dash hot sauce', '2 dashes bitters', '1 smidgen pepper', '- 1 Pinch of salt']) {
    for (const factor of [0.01, 3]) {
      const r = scaleLine(line, factor);
      assert.equal(r.output, line, line);
      assert.equal(r.flagged, true, line);
      assert.equal(r.reason, 'non-scalable', line);
    }
  }
});

test('simple count nouns gain or lose an "s" only when crossing 1', () => {
  assert.equal(out('1 egg', 2), '2 eggs');
  assert.equal(out('2 eggs', 0.5), '1 egg');
  assert.equal(out('1 egg, beaten', 3), '3 eggs, beaten');
  assert.equal(out('4 cloves', 0.25), '1 clove');
  assert.equal(out('3 eggs', 0.25), '3/4 egg');
  // Not crossing 1: left as typed.
  assert.equal(out('2 eggs', 2), '4 eggs');
  assert.equal(out('3 eggs', 0.5), '1 1/2 eggs');
  // Not a lone simple noun, or an unsafe ending: left as typed.
  assert.equal(out('1 large egg', 2), '2 large egg');
  assert.equal(out('1 tomato', 2), '2 tomato');
  assert.equal(out('1 glass', 2), '2 glass');
  assert.equal(out('2 potatoes', 0.5), '1 potatoes');
  // Units are never touched by this rule.
  assert.equal(out('1 cup sugar', 2), '2 cups sugar');
});

test('zero amounts are kept unchanged and flagged (never NaN)', () => {
  for (const [line, factor] of [['0 cups', 1], ['0 cups flour', 1], ['0.0 cup', 1], ['0.0 tbsp oil', 2], ['0 eggs', 3], ['0 g', 1]]) {
    for (const system of ['us', 'metric']) {
      const r = scaleLine(line, factor, { system });
      assert.equal(r.output, line, line);
      assert.equal(r.scaled, false, line);
      assert.equal(r.flagged, true, line);
      assert.equal(r.reason, 'zero-quantity', line);
    }
  }
  // R3: a lower end of 0 on a cook-volume range formats as "up to X" (never show "0")
  assert.equal(out('0-1 cup', 2), 'up to 2 cups');
  assert.equal(out('0-1 tsp salt'), 'up to 1 tsp salt');
  assert.equal(out('0 to 1/2 tsp', 0.5), 'up to 1/4 tsp');
});

test('space thousands separators are kept unchanged and flagged', () => {
  for (const [line, factor] of [['1 000 g', 0.5], ['1 000 g', 1.5], ['1 000g', 1], ['12 500 ml', 2], ['- 2 000 g flour', 2]]) {
    const r = scaleLine(line, factor);
    assert.equal(r.output, line, line);
    assert.equal(r.flagged, true, line);
    assert.equal(r.reason, 'no-quantity', line);
  }
  // Mixed numbers still work.
  assert.equal(out('1 1/2 cups flour', 2), '3 cups flour');
  assert.equal(out('2 3/4 cup sugar', 1), '2 3/4 cup sugar'); // x1 echoes spelling
  assert.equal(out('1 ½ cups milk', 2), '3 cups milk');
});

test('"5. cup" is a malformed amount (no-quantity)', () => {
  const r = scaleLine('5. cup', 2);
  assert.equal(r.output, '5. cup');
  assert.equal(r.reason, 'no-quantity');
  assert.equal(scaleLine('1. Preheat the oven', 2).reason, 'not-an-ingredient');
});

test('plurals: singular at 1 or less, capitalization kept', () => {
  assert.equal(out('1 eggs', 1), '1 egg');
  assert.equal(out('2 Eggs', 0.5), '1 Egg');
  assert.equal(out('1 Egg', 2), '2 Eggs');
  assert.equal(out('1 egg', 1), '1 egg');
  assert.equal(out('2 eggs', 1), '2 eggs');
  assert.equal(out('1 EGG', 2), '2 EGG');
});

test('guard: odd inputs never produce NaN or Infinity', () => {
  const lines = [
    '0 cups', '0.0 cup', '0 g', '0-0 tbsp', '0 to 2 cups', '1/0 cup', '0/5 cup', '1 0/0 cup',
    '1e5 cup', '1e400 g', '9'.repeat(400) + ' g', '.5 cup', '. cup', '½ ½ cup', '1 1/2/3 cup',
    '1 000 g', '1,000 g', '1.5.2 g', '5. cup', '- 0 eggs', '3-0 cups', '0.0000001 tsp',
    '1 cup', '1 tsp', '1 lb', '1 l', '1 gallon', 'NaN cups', 'Infinity g',
  ];
  for (const factor of [1e-12, 0.001, 0.5, 1, 3, 1e6, 1e300, Number.MAX_VALUE]) {
    for (const system of ['us', 'metric']) {
      for (const line of lines) {
        const r = scaleLine(line, factor, { system });
        const msg = `${line} x${factor} ${system} -> ${r.output}`;
        if (/NaN|Infinity/.test(line)) assert.equal(r.output, line, msg);
        else assert.doesNotMatch(r.output, /NaN|Infinity/, msg);
        assert.ok(!(r.scaled && r.flagged), msg);
      }
    }
  }
});


test('D-new: fractional tbsp splits into tbsp + tsp; clean cups preferred', () => {
  assert.equal(out('1/3 cup flour', 0.5), '2 tbsp + 2 tsp flour');
  assert.equal(out('1/3 cup flour', 0.25), '1 tbsp + 1 tsp flour');
  assert.equal(out('2/3 cup milk', 0.5), '1/3 cup milk');
  assert.equal(out('3/4 cup sugar', 1 / 3), '1/4 cup sugar');
  assert.equal(out('5 tbsp butter'), '5 tbsp butter'); // x1 echo
  assert.equal(out('4 tbsp butter', 2), '1/2 cup butter');
  assert.equal(formatUsVolume(8, 'tbsp'), '1/2 cup');
  assert.equal(formatUsVolume(16, 'tbsp'), '1 cup');
  assert.equal(out('1.5 tbsp oil', 2), '3 tbsp oil');
});

test('D-new: tsp uses only cook fractions; 1/8 tsp standalone only', () => {
  assert.equal(out('1 tbsp oil', 1 / 8), '1/3 tsp oil');
  assert.equal(out('1 tsp salt', 5 / 8), '2/3 tsp salt');
  assert.equal(out('1 tsp salt', 7 / 8), '1 tsp salt');
  assert.equal(out('1 tbsp oil', 0.2), '2/3 tsp oil');
  assert.equal(out('1 tbsp oil', 0.3), '1 tsp oil');
  assert.equal(out('1 tbsp oil', 5 / 8), '2 tsp oil');
  // Compound leftovers snap to 1/4, 1/2, 3/4 (not 1/3).
  assert.equal(out('1 cup flour', 0.07), '1 tbsp + 1/4 tsp flour');
  assert.equal(out('1/4 tsp salt', 0.5), '1/8 tsp salt');
  assert.equal(out('1 tsp salt', 0.05), 'a pinch of salt');
});

test('D-new rounding rule + Reviewer: half tbsp, x1 echo, whole tbsp', () => {
  assert.ok(ALLOW_HALF_TBSP, 'ALLOW_HALF_TBSP defaults true');
  // Required rounding-rule cases (via format or non-1 scale where x1 would echo)
  assert.equal(out('6 tbsp oil'), '6 tbsp oil');
  assert.equal(out('5/8 cup sugar'), '10 tbsp sugar'); // forbidden eighth → format
  assert.equal(out('3 tbsp oil'), '3 tbsp oil');
  assert.equal(formatUsVolume(12, 'tbsp'), '3/4 cup');
  assert.equal(out('6 tbsp oil', 2), '3/4 cup oil');
  // Half tbsp when ALLOW_HALF_TBSP (tests reference the constant)
  if (ALLOW_HALF_TBSP) {
    assert.equal(out('1 tbsp oil', 1.5), '1 1/2 tbsp oil');
    assert.equal(out('3 tbsp oil', 2.5), '7 1/2 tbsp oil');
    assert.equal(out('1 1/2 tbsp oil'), '1 1/2 tbsp oil'); // x1 echo
    assert.equal(out('2 1/2 tbsp oil'), '2 1/2 tbsp oil');
  }
  // Thirds of a tbsp still SPLIT when scaled (never 2/3 tbsp)
  assert.equal(out('1 tbsp oil', 2 / 3), '2 tsp oil');
  assert.doesNotMatch(out('1 tbsp oil', 2 / 3), /2\/3 tbsp/);
  // x1 echoes even ugly thirds
  assert.equal(out('1 1/3 tbsp oil'), '1 1/3 tbsp oil');
  assert.equal(out('11 tbsp butter'), '11 tbsp butter');
  assert.equal(out('4 tsp salt'), '4 tsp salt');
  // Step 2 / splits
  assert.equal(out('3/8 cup milk'), '6 tbsp milk');
  assert.equal(out('7/8 cup flour'), '14 tbsp flour');
  assert.equal(out('10 tsp salt'), '10 tsp salt'); // x1
  assert.equal(out('5 tsp salt', 2), '3 tbsp + 1 tsp salt');
  assert.equal(out('1 1/8 cup flour'), '1 cup + 2 tbsp flour'); // 1/8 cup forbidden
  assert.equal(out('1 1/4 cups flour', 1.25), '1 1/2 cups + 1 tbsp flour');
  assert.equal(out('2 tbsp oil', 0.95), '1 tbsp + 2 3/4 tsp oil'); // no %-snap (R final)
  assert.equal(out('2/3 cup flour', 2 / 3), '7 tbsp flour');
});

test('D-new: pinch band — below 1/16 pinch; 1/16..1/8 → 1/8 tsp', () => {
  assert.equal(formatUsVolume(1 / 16 - 1e-6, 'tsp'), 'a pinch');
  assert.equal(formatUsVolume(1 / 16, 'tsp'), '1/8 tsp');
  assert.equal(formatUsVolume(0.07, 'tsp'), '1/8 tsp');
  assert.equal(formatUsVolume(0.1, 'tsp'), '1/8 tsp');
  assert.equal(formatUsVolume(0.124, 'tsp'), '1/8 tsp');
  assert.equal(formatUsVolume(1 / 8, 'tsp'), '1/8 tsp');
  assert.equal(out('1/8 tsp cayenne', 0.95), '1/8 tsp cayenne');
  assert.equal(out('1 tsp salt', 0.05), 'a pinch of salt');
});

test('D-new: ranges — R1 shared unit (upper then tbsp, never tsp ≥1 tbsp)', () => {
  assert.equal(out('1-2 tbsp honey'), '1-2 tbsp honey');
  assert.equal(out('1/4 to 1/2 cup milk'), '1/4 to 1/2 cup milk');
  // R1: 1/3-1/2 cup ×1/2 → mixed ends join with " to " (NOT 8-12 tsp)
  assert.equal(out('1/3-1/2 cup sugar', 0.5), '2 tbsp + 2 tsp to 1/4 cup sugar');
  // tbsp step succeeds for both clean ends
  assert.equal(out('1/4-1/2 cup milk', 0.5), '2-4 tbsp milk');
  // both ends pinch → collapse (R2)
  assert.equal(out('1/8-1/4 tsp nutmeg', 0.1), 'a pinch of nutmeg');
  // mixed pinch / 1/8
  assert.equal(out('1/8-1/4 tsp nutmeg', 0.25), 'a pinch to 1/8 tsp nutmeg');
  // R1: never tsp when an end is ≥1 tbsp — 1/3-2/3 cup ×1/2 is 8-16 tsp raw,
  // but 8 tsp = 2 tbsp + 2 tsp and 16 tsp = 1/3 cup → join with " to "
  assert.equal(out('1/3-2/3 cup sugar', 0.5), '2 tbsp + 2 tsp to 1/3 cup sugar');
  // Fallback with mismatched compound ends:
  assert.match(out('2/3-1 cup milk', 0.3), / to /);
  assert.doesNotMatch(out('2/3-1 cup milk', 0.3), /2\/3 tbsp/);
  // R2 equal ends collapse
  assert.equal(out('1/8-1/4 tsp', 0.5), '1/8 tsp');
  // R3: 1/4-1/2 tsp ×1/2 stays 1/8-1/4 (earlier "0" was rounding, not real 0)
  assert.equal(out('1/4-1/2 tsp salt', 0.5), '1/8-1/4 tsp salt');
  assert.equal(out('1/4 to 1/2 tsp salt', 0.5), '1/8 to 1/4 tsp salt');
});

test('D-new: R3/R4 — no 0 ends; cups + rem <4 tbsp', () => {
  assert.doesNotMatch(out('0-1 tsp salt', 1), /\b0\b/);
  assert.equal(out('0-1 tsp salt', 1), 'up to 1 tsp salt');
  assert.equal(out('2 cups flour', 0.95), '1 3/4 cups + 2 1/2 tbsp flour');
  assert.equal(out('4 cups flour', 0.95), '3 3/4 cups + 1 tbsp flour');
  assert.equal(out('1 2/3 cups flour', 1.25), '2 cups + 1 1/2 tbsp flour');
  assert.equal(out('11 tbsp butter', 2.5), '1 2/3 cups + 1 tbsp butter');
  // Never cup + ≥4 tbsp
  assert.doesNotMatch(out('2 cups flour', 0.95), /\+ [4-9] tbsp|\+ 1[0-9] tbsp/);
  assert.doesNotMatch(out('2-3 cups flour', 0.95), /\+ [4-9] tbsp|\+ 1[0-9] tbsp/);
});

test('D-new: round-trip — displayed US volume within 1.5 tsp or 6% of exact', () => {
  function toTsp(qty) {
    if (qty === 'a pinch' || qty.startsWith('a pinch')) return 1 / 32;
    let total = 0;
    for (const part of qty.split(/\s*\+\s*/)) {
      const m = part.trim().match(/^(.+?)\s+(cups?|tbsp|tsp)$/);
      assert.ok(m, `parseable: "${part}" in "${qty}"`);
      const n = parseQuantity(m[1]);
      assert.ok(n !== null, m[1]);
      const u = m[2].startsWith('cup') ? 'cup' : m[2];
      total += n * (u === 'cup' ? 48 : u === 'tbsp' ? 3 : 1);
    }
    return total;
  }
  const amounts = [
    '1/8 tsp', '1/4 tsp', '1/3 tsp', '1/2 tsp', '2/3 tsp', '3/4 tsp', '1 tsp', '1.5 tsp', '2 tsp', '3 tsp',
    '1 tbsp', '1.5 tbsp', '2 tbsp', '3 tbsp', '5 tbsp', '6 tbsp', '7 tbsp', '8 tbsp', '10 tbsp', '14 tbsp', '16 tbsp',
    '1/8 cup', '1/4 cup', '1/3 cup', '3/8 cup', '1/2 cup', '5/8 cup', '2/3 cup', '3/4 cup', '7/8 cup',
    '1 cup', '1 1/4 cups', '1 1/2 cups', '2 cups',
  ];
  const scales = [
    1 / 16, 1 / 8, 0.07, 0.1, 0.2, 0.3, 1 / 7, 0.25, 1 / 3, 0.375, 0.4, 0.5,
    5 / 8, 2 / 3, 0.75, 7 / 8, 1.25, 1.5, 2, 3, 4, 5, // skip exact 1 (x1 echo)
  ];
  for (const amt of amounts) {
    const unit = amt.includes('cup') ? 'cup' : amt.includes('tbsp') ? 'tbsp' : 'tsp';
    const amount = parseQuantity(amt.slice(0, amt.lastIndexOf(' ')));
    for (const factor of scales) {
      const r = scaleLine(`${amt} x`, factor);
      if (!r.scaled) continue;
      let displayed = r.output.replace(/\s+x$/, '');
      if (displayed.startsWith('a pinch')) continue;
      const exactTsp = amount * factor * (unit === 'cup' ? 48 : unit === 'tbsp' ? 3 : 1);
      const gotTsp = toTsp(displayed);
      const absErr = Math.abs(gotTsp - exactTsp);
      const relErr = exactTsp === 0 ? 0 : absErr / exactTsp;
      assert.ok(
        absErr <= 1.5 || relErr <= 0.06,
        `${amt} ×${factor}: exact ${exactTsp} tsp, displayed "${displayed}" = ${gotTsp} tsp (abs ${absErr}, rel ${relErr})`,
      );
    }
  }
});

test('D-new: sweep — no volume eighths except standalone 1/8 tsp', () => {
  const amounts = [
    '1/8 tsp', '1/4 tsp', '1 tsp', '1.5 tsp', '1 tbsp', '1.5 tbsp', '2 tbsp', '3 tbsp', '5 tbsp', '6 tbsp', '7 tbsp', '10 tbsp',
    '1/8 cup', '1/4 cup', '1/3 cup', '3/8 cup', '1/2 cup', '5/8 cup', '2/3 cup', '3/4 cup', '7/8 cup', '1 cup', '1 1/2 cups',
  ];
  const scales = [1 / 8, 5 / 8, 7 / 8, 0.07, 0.2, 0.3, 1 / 7, 0.25, 1 / 3, 0.5, 2 / 3, 1.5, 2, 3];
  for (const amt of amounts) {
    for (const factor of scales) {
      const r = scaleLine(`${amt} x`, factor);
      if (!r.scaled) continue;
      const displayed = r.output.replace(/\s+x$/, '');
      const msg = `${amt} ×${factor} → ${displayed}`;
      // Skip x1 echo of eighth-cup inputs that still contain /8 in the typed form — those use factor≠1 above
      assert.doesNotMatch(displayed, /5\/6|\/16|\+ 0 tsp|(?:^|\s)0 tbsp|(?:^|\s)16 tbsp/, msg);
      for (const part of displayed.split(/\s*\+\s*/)) {
        const p = part.trim();
        if (/\/8/.test(p)) assert.equal(p, '1/8 tsp', msg);
      }
      assert.doesNotMatch(displayed, /\+ 1\/8 tsp|2\/3 tbsp/, msg);
    }
  }
});

test('D-new: sweep — x1 identity for every simple valid cook-volume input', () => {
  const stable = [
    '1 tsp', '1/4 tsp', '1/3 tsp', '1/2 tsp', '2/3 tsp', '3/4 tsp', '1/8 tsp', '2 tsp', '4 tsp', '10 tsp',
    '1 tbsp', '2 tbsp', '3 tbsp', '4 tbsp', '5 tbsp', '6 tbsp', '7 tbsp', '8 tbsp', '9 tbsp', '10 tbsp',
    '11 tbsp', '12 tbsp', '13 tbsp', '14 tbsp', '15 tbsp', '16 tbsp',
    '1 1/2 tbsp', '2 1/2 tbsp', '1 1/3 tbsp',
    '1/4 cup', '1/3 cup', '1/2 cup', '2/3 cup', '3/4 cup', '1 cup', '2 cups',
    '1 1/2 cups', '1 1/4 cups', '1 1/3 cups',
    '1-2 tbsp honey', '1/4 to 1/2 cup milk',
  ];
  for (const line of stable) {
    assert.equal(out(line), line, line);
  }
  // Forbidden eighth-cups still rewrite at x1
  assert.equal(out('3/8 cup'), '6 tbsp');
  assert.equal(out('5/8 cup'), '10 tbsp');
  assert.equal(out('7/8 cup'), '14 tbsp');
});

test('D-new: sweep — formatted whole N tbsp (non-echo) cups only for 4/8/12', () => {
  // Drive through formatUsVolume so x1 echo does not apply.
  const expected = {
    1: '1 tbsp', 2: '2 tbsp', 3: '3 tbsp', 4: '1/4 cup', 5: '5 tbsp',
    6: '6 tbsp', 7: '7 tbsp', 8: '1/2 cup', 9: '9 tbsp',
    10: '10 tbsp', 11: '11 tbsp', 12: '3/4 cup', 13: '13 tbsp',
    14: '14 tbsp', 15: '15 tbsp', 16: '1 cup',
  };
  for (let n = 1; n <= 16; n++) {
    assert.equal(formatUsVolume(n, 'tbsp'), expected[n], `${n} tbsp`);
  }
});

test('D-new: metric/weight/attacks unchanged where required', () => {
  assert.equal(out('1 cup milk', 1, 'metric'), '237 ml milk');
  assert.equal(out('8 oz cheese', 2), '1 lb cheese');
  assert.equal(out('250 ml water'), '1 cup + 1 tbsp water');
  assert.equal(out('⅓ cup flour', 0.5), '2 tbsp + 2 tsp flour');
  for (const f of [0, -1, NaN, Infinity]) {
    assert.throws(() => scaleLine('1/3 cup flour', f), RangeError);
  }
  assert.doesNotMatch(out('1 tbsp oil', 2 / 3), /2\/3 tbsp/);
  assert.equal(out('1 1/2 cups flour', 1 / 3), '1/2 cup flour');
});

test('D-new: x0.95 and x3/4 sweeps — R1–R4 invariants', () => {
  const amounts = [
    '1/8 tsp', '1/4 tsp', '1/3 tsp', '1/2 tsp', '2/3 tsp', '3/4 tsp', '1 tsp', '2 tsp', '3 tsp',
    '1 tbsp', '1 1/2 tbsp', '2 tbsp', '3 tbsp', '5 tbsp', '6 tbsp', '7 tbsp', '8 tbsp', '11 tbsp',
    '1/4 cup', '1/3 cup', '1/2 cup', '2/3 cup', '3/4 cup', '1 cup', '1 1/4 cups', '1 1/2 cups', '1 2/3 cups', '2 cups', '3 cups', '4 cups',
  ];
  const ranges = [
    '1/4-1/2 tsp', '1/2-1 tsp', '1/8-1/4 tsp', '1-2 tsp',
    '1-2 tbsp', '1-1 1/2 tbsp', '2-4 tbsp',
    '1/4-1/2 cup', '1/3-1/2 cup', '1/3-2/3 cup', '1/2-1 cup', '2-3 cups',
    '0-1 tsp', '0-1/2 cup',
  ];
  const factors = [0.95, 0.75];
  for (const factor of factors) {
    for (const amt of amounts) {
      const r = scaleLine(`${amt} x`, factor);
      if (!r.scaled) continue;
      const displayed = r.output.replace(/\s+x$/, '');
      const msg = `${amt} ×${factor} → ${displayed}`;
      assert.doesNotMatch(displayed, /(?:^|[\s-])0(?:\s|-(?!\d)|$)/, `no 0 end: ${msg}`);
      assert.doesNotMatch(displayed, /(\d+(?:\s+\d+\/\d+|\s*[½⅓⅔¼¾])?)-\1\b/, `no X-X: ${msg}`);
      assert.doesNotMatch(displayed, /\+\s*(?:[4-9]|[1-9]\d+)\s*tbsp/, `no cup+≥4 tbsp: ${msg}`);
      for (const part of displayed.split(/\s*\+\s*/)) {
        const p = part.trim();
        if (/\/8/.test(p)) assert.equal(p, '1/8 tsp', `eighths: ${msg}`);
      }
      assert.doesNotMatch(displayed, /2\/3 tbsp/, msg);
    }
    for (const amt of ranges) {
      const r = scaleLine(`${amt} x`, factor);
      if (!r.scaled) continue;
      const displayed = r.output.replace(/\s+x$/, '');
      const msg = `${amt} ×${factor} → ${displayed}`;
      assert.doesNotMatch(displayed, /(?:^|[\s-])0(?:\s|-|$)/, `no 0 end: ${msg}`);
      assert.doesNotMatch(displayed, /^(\S+)-\1\s/, `no X-X: ${msg}`);
      assert.doesNotMatch(displayed, /\+\s*(?:[4-9]|[1-9]\d+)\s*tbsp/, `no cup+≥4 tbsp: ${msg}`);
      // R1: no tsp-only range when an end is ≥1 tbsp
      if (/^\d+(\.\d+)?-\d+(\.\d+)? tsp$/.test(displayed) || /^\d+\s+\d+\/\d+-\d/.test(displayed) && displayed.endsWith(' tsp')) {
        // parse ends in tsp — both must be < 3 tsp worth if shown as tsp range... already enforced by formatter
        const m = displayed.match(/^(.+?)-(.+?) tsp$/);
        if (m) {
          const lo = parseQuantity(m[1]);
          const hi = parseQuantity(m[2]);
          if (lo !== null && hi !== null) {
            assert.ok(lo < 3 && hi < 3, `no tsp end ≥1 tbsp: ${msg}`);
          }
        }
      }
      for (const part of displayed.split(/\s*\+\s*|\s+to\s+/)) {
        const p = part.trim().replace(/^up to /, '');
        if (/\/8/.test(p) && !p.startsWith('a pinch')) {
          // allow "1/8 tsp" only as a whole end
          if (/tsp/.test(p) || !/tbsp|cup/.test(p)) {
            assert.ok(/^(?:1\/8 tsp|1\/8)$/.test(p) || p === '1/8 tsp' || !/\/8/.test(p.replace(/1\/8 tsp/, '')), `eighths: ${msg} part=${p}`);
          }
        }
        if (/\/8/.test(p)) {
          assert.ok(/1\/8/.test(p) && !/[357]\/8/.test(p), `only 1/8: ${msg} part=${p}`);
          assert.doesNotMatch(p, /(?:cup|tbsp).*1\/8|1\/8.*(?:cup|tbsp)/, msg);
        }
      }
      assert.doesNotMatch(displayed, /2\/3 tbsp/, msg);
    }
  }
});
