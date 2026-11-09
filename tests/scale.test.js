import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseQuantity, formatFraction, formatMetric, convertAmount,
  scaleLine, scaleRecipe, scaleFactor,
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
  assert.equal(out('48 tsp sugar'), '1 cup sugar');
  assert.deepEqual(convertAmount(48, 'tsp'), { unit: 'cup', value: convertAmount(48, 'tsp').value });
  assert.ok(Math.abs(convertAmount(48, 'tsp').value - 1) < 1e-9);
});

test('6 tsp -> 2 tbsp; small amounts stay in tsp', () => {
  assert.equal(out('6 tsp vanilla'), '2 tbsp vanilla');
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
  assert.equal(out('250 ml water'), '1 cup water');
  assert.equal(out('500 g flour'), '1 1/8 lb flour');
});

test('ranges, bullets and unit spellings', () => {
  assert.equal(out('2-3 cloves garlic', 2), '4-6 cloves garlic');
  assert.equal(out('1 to 2 tablespoons honey', 2), '2 to 4 tbsp honey');
  assert.equal(out('- 2 Tbsp. olive oil', 1), '- 2 tbsp olive oil');
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
  for (const [line, factor] of [['0 cups', 1], ['0 cups flour', 1], ['0.0 cup', 1], ['0.0 tbsp oil', 2], ['0 eggs', 3], ['0-1 cup', 2], ['0 g', 1]]) {
    for (const system of ['us', 'metric']) {
      const r = scaleLine(line, factor, { system });
      assert.equal(r.output, line, line);
      assert.equal(r.scaled, false, line);
      assert.equal(r.flagged, true, line);
      assert.equal(r.reason, 'zero-quantity', line);
    }
  }
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
  assert.equal(out('2 3/4 cup sugar', 1), '2 3/4 cups sugar');
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
