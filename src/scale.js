/**
 * Recipe Scaler core logic: parse ingredient lines, scale them, format
 * friendly kitchen fractions and convert units (US / metric).
 *
 * Pure ES module, no dependencies, no DOM. See PROGRESS.md D3-D6.
 *
 * Main entry points:
 *   scaleRecipe(text, { originalServings, targetServings, system })
 *   scaleLine(line, factor, { system })
 *
 * Helpers (also exported for tests / UI):
 *   parseQuantity, parseLine, formatFraction, formatMetric,
 *   convertAmount, scaleFactor
 *
 * @module scale
 */

/** @typedef {'us' | 'metric'} UnitSystem */

/**
 * Result for one input line.
 * @typedef {Object} LineResult
 * @property {string} input    The line exactly as typed.
 * @property {string} output   The text to show (equals `input` when not scaled).
 * @property {boolean} scaled  True when a quantity was found and scaled.
 * @property {boolean} flagged True when the line has content but could not be
 *                             scaled; the UI should mark it "not scaled".
 * @property {boolean} blank   True for empty / whitespace-only lines.
 * @property {string|null} reason Why a line was flagged
 *                             ('no-quantity' | 'not-an-ingredient' |
 *                             'non-scalable'), else null.
 */

const UNICODE_FRACTIONS = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6,
  '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const UNI = Object.keys(UNICODE_FRACTIONS).join('');
const SLASH = '[/\u2044]'; // ASCII slash or unicode fraction slash

// One quantity: "1 1/2", "1½", "1 ½", "1/2", ".5", "1.5", "3", "½".
const QTY_SRC =
  `(?:\\d+\\s+\\d+\\s*${SLASH}\\s*\\d+` +
  `|\\d+\\s*[${UNI}]` +
  `|\\d+\\s*${SLASH}\\s*\\d+` +
  `|\\d*\\.\\d+` +
  `|\\d+` +
  `|[${UNI}])`;

// A quantity must end cleanly: no trailing digit, slash, ".5", ",5" or "..",
// so malformed numbers like "1.5.2" or "1,5" never partly match.
const QTY_END = '(?![\\d/\u2044]|[.,]\\d|\\.\\.)';

/** Count words that are never scaled (the line is kept and flagged). */
const NON_SCALABLE_RE = /^\s*(?:pinch(?:es)?|dash(?:es)?|smidgens?)(?![a-z])/i;

/**
 * Known units. `kind` is 'volume' (base ml) or 'weight' (base g).
 * Anything else after a number (eggs, cloves, pinches, cans) is a count and
 * is scaled but never converted (D5).
 */
const UNITS = {
  tsp:    { kind: 'volume', base: 4.92892159375, re: 'teaspoons?|tsps?' },
  tbsp:   { kind: 'volume', base: 14.78676478125, re: 'tablespoons?|tbsps?|tbls?|tbs' },
  cup:    { kind: 'volume', base: 236.5882365, re: 'cups?' },
  floz:   { kind: 'volume', base: 29.5735295625, re: 'fl\\.?\\s*oz|fluid\\s+ounces?' },
  pint:   { kind: 'volume', base: 473.176473, re: 'pints?|pt' },
  quart:  { kind: 'volume', base: 946.352946, re: 'quarts?|qt' },
  gallon: { kind: 'volume', base: 3785.411784, re: 'gallons?|gal' },
  ml:     { kind: 'volume', base: 1, re: 'ml|milliliters?|millilitres?' },
  l:      { kind: 'volume', base: 1000, re: 'l|liters?|litres?' },
  g:      { kind: 'weight', base: 1, re: 'g|grams?|grammes?' },
  kg:     { kind: 'weight', base: 1000, re: 'kg|kilograms?|kilos?' },
  oz:     { kind: 'weight', base: 28.349523125, re: 'oz|ounces?' },
  lb:     { kind: 'weight', base: 453.59237, re: 'lbs?|pounds?' },
};

const UNIT_SRC = Object.entries(UNITS)
  .map(([key, u]) => `(?<${key}>${u.re})`)
  .join('|');

const LINE_RE = new RegExp(
  `^(?<prefix>\\s*(?:[-*•]\\s+)?)` +
  `(?<q1>${QTY_SRC})${QTY_END}` +
  `(?:(?<sep>\\s*(?:-|–|—|\\bto\\b)\\s*)(?<q2>${QTY_SRC})${QTY_END})?` +
  `(?:\\s*(?:${UNIT_SRC})(?![a-z])\\.?)?`,
  'iu',
);

/** Friendly fractional parts (D4): eighths plus thirds. */
const FRACTIONS = [
  [0, ''], [1 / 8, '1/8'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'],
  [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'],
  [7 / 8, '7/8'], [1, ''],
];

/** Max relative rounding error accepted before falling back to a smaller unit. */
const UNIT_TOLERANCE = 0.06;

/**
 * Parse a quantity string ("1 1/2", "1½", "½", "0.5", "3", "3/4").
 * @param {string} str
 * @returns {number|null} The value, or null if it is not a valid quantity.
 */
export function parseQuantity(str) {
  if (typeof str !== 'string') return null;
  const s = str.trim();
  if (!new RegExp(`^${QTY_SRC}$`, 'u').test(s)) return null;
  let m;
  if ((m = s.match(new RegExp(`^(\\d+)\\s+(\\d+)\\s*${SLASH}\\s*(\\d+)$`)))) {
    const den = Number(m[3]);
    return den === 0 ? null : Number(m[1]) + Number(m[2]) / den;
  }
  if ((m = s.match(new RegExp(`^(\\d+)\\s*([${UNI}])$`, 'u')))) {
    return Number(m[1]) + UNICODE_FRACTIONS[m[2]];
  }
  if ((m = s.match(new RegExp(`^(\\d+)\\s*${SLASH}\\s*(\\d+)$`)))) {
    const den = Number(m[2]);
    return den === 0 ? null : Number(m[1]) / den;
  }
  if (s in UNICODE_FRACTIONS) return UNICODE_FRACTIONS[s];
  return Number(s);
}

/**
 * Round to the nearest friendly kitchen amount (whole + eighths/thirds).
 * @param {number} n
 * @returns {number}
 */
function friendlyValue(n) {
  const whole = Math.floor(n);
  let best = FRACTIONS[0];
  for (const f of FRACTIONS) {
    if (Math.abs(n - whole - f[0]) < Math.abs(n - whole - best[0])) best = f;
  }
  const v = whole + best[0];
  return v === 0 && n > 0 ? 1 / 8 : v;
}

/**
 * Format a number as a friendly kitchen fraction (D4): 1.5 -> "1 1/2",
 * 0.33 -> "1/3", 3 -> "3". Positive amounts never show as "0"; the smallest
 * shown amount is "1/8".
 * @param {number} n
 * @returns {string}
 */
export function formatFraction(n) {
  if (!Number.isFinite(n) || n < 0) return String(n);
  const v = friendlyValue(n);
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const f = FRACTIONS.find(([x]) => Math.abs(x - frac) < 1e-9);
  const fracText = f ? f[1] : '';
  if (whole === 0) return fracText || '0';
  return fracText ? `${whole} ${fracText}` : String(whole);
}

/**
 * Format a metric amount (D4): whole numbers, or 1 decimal under 10.
 * Litres / kilograms use up to 2 decimals.
 * @param {number} n
 * @param {boolean} [large=false] True for l / kg.
 * @returns {string}
 */
export function formatMetric(n, large = false) {
  const digits = large ? 2 : n < 10 ? 1 : 0;
  let v = Number(n.toFixed(digits));
  if (v === 0 && n > 0) v = large ? 0.01 : 0.1;
  return String(v);
}

function relError(n) {
  return n === 0 ? 0 : Math.abs(friendlyValue(n) - n) / n;
}

/**
 * Pick the unit that "reads better" (D5) for an amount and system.
 * @param {number} baseAmount Amount in ml (volume) or g (weight).
 * @param {'volume'|'weight'} kind
 * @param {UnitSystem} system
 * @returns {{ unit: string, value: number }}
 */
function pickUnit(baseAmount, kind, system) {
  if (system === 'metric') {
    const [small, big] = kind === 'volume' ? ['ml', 'l'] : ['g', 'kg'];
    if (Number(baseAmount.toFixed(0)) >= 1000) return { unit: big, value: baseAmount / 1000 };
    return { unit: small, value: baseAmount };
  }
  // US: largest unit with at least ~1 of it (cups from 1/4 cup), as long as
  // the friendly fraction stays within UNIT_TOLERANCE of the real amount.
  const ladder = kind === 'volume'
    ? [['cup', 1 / 4], ['tbsp', 1], ['tsp', 0]]
    : [['lb', 1], ['oz', 0]];
  for (const [unit, min] of ladder) {
    const value = baseAmount / UNITS[unit].base;
    if (min === 0) return { unit, value };
    if (value >= min * (1 - UNIT_TOLERANCE) && relError(value) <= UNIT_TOLERANCE) {
      return { unit, value };
    }
  }
  /* c8 ignore next */
  throw new Error('unreachable');
}

/**
 * Convert an amount to the unit that reads best in the given system (D5).
 * @param {number} amount
 * @param {string} unit A key of the unit table (tsp, tbsp, cup, floz, pint,
 *                      quart, gallon, ml, l, g, kg, oz, lb).
 * @param {UnitSystem} [system='us']
 * @returns {{ value: number, unit: string }}
 */
export function convertAmount(amount, unit, system = 'us') {
  const u = UNITS[unit];
  if (!u) throw new RangeError(`Unknown unit: ${unit}`);
  return pickUnit(amount * u.base, u.kind, system === 'metric' ? 'metric' : 'us');
}

function formatValue(value, unit) {
  if (unit === 'ml' || unit === 'g') return formatMetric(value);
  if (unit === 'l' || unit === 'kg') return formatMetric(value, true);
  return formatFraction(value);
}

function unitLabel(unit, value) {
  if (unit === 'cup') return friendlyValue(value) > 1 ? 'cups' : 'cup';
  return unit;
}

/**
 * Parse one line into its parts, without scaling.
 * @param {string} line
 * @returns {null | {
 *   prefix: string, quantities: number[], separator: string|null,
 *   unit: string|null, rest: string
 * }} null when the line has no leading quantity.
 */
export function parseLine(line) {
  const m = LINE_RE.exec(line);
  if (!m) return null;
  const g = m.groups;
  const q1 = parseQuantity(g.q1);
  const q2 = g.q2 !== undefined ? parseQuantity(g.q2) : null;
  if (q1 === null || (g.q2 !== undefined && q2 === null)) return null;
  const unit = Object.keys(UNITS).find((k) => g[k] !== undefined) ?? null;
  const rest = line.slice(m[0].length);
  return {
    prefix: g.prefix,
    quantities: q2 === null ? [q1] : [q1, q2],
    separator: g.sep ?? null,
    unit,
    rest,
  };
}

/**
 * Scale (and convert) one line.
 * @param {string} line
 * @param {number} factor Multiplier, e.g. target / original servings.
 *                        Must be a positive finite number.
 * @param {{ system?: UnitSystem }} [options]
 * @returns {LineResult}
 * @throws {RangeError} If `factor` is not a positive finite number.
 */
export function scaleLine(line, factor, { system = 'us' } = {}) {
  assertFactor(factor);
  const base = { input: line, output: line, scaled: false, flagged: false, blank: false, reason: null };
  if (line.trim() === '') return { ...base, blank: true };
  const p = parseLine(line);
  if (!p) return { ...base, flagged: true, reason: 'no-quantity' };
  // "1. Preheat oven", "2) Mix", "350°F": a number, but not an amount.
  if (!p.unit && /^(?:[.)]\s|°|%)/u.test(p.rest)) {
    return { ...base, flagged: true, reason: 'not-an-ingredient' };
  }
  // "1 pinch salt", "2 dashes bitters": too small to scale meaningfully.
  if (!p.unit && NON_SCALABLE_RE.test(p.rest)) {
    return { ...base, flagged: true, reason: 'non-scalable' };
  }

  const scaled = p.quantities.map((q) => q * factor);
  let texts;
  let unitText = '';
  if (p.unit) {
    const sys = system === 'metric' ? 'metric' : 'us';
    const first = convertAmount(scaled[0], p.unit, sys);
    const ratio = first.value / scaled[0];
    const values = scaled.map((v) => v * ratio);
    texts = values.map((v) => formatValue(v, first.unit));
    unitText = ' ' + unitLabel(first.unit, values[values.length - 1]);
  } else {
    texts = scaled.map(formatFraction);
  }
  const rest = !p.unit && scaled.length === 1
    ? adjustPlural(p.rest, p.quantities[0], scaled[0])
    : p.rest;

  let qtyText = texts[0];
  if (texts.length === 2) {
    const word = /to/i.test(p.separator);
    const padded = word || texts.some((t) => /[ /]/.test(t));
    qtyText = word ? `${texts[0]} to ${texts[1]}` : padded ? `${texts[0]} - ${texts[1]}` : `${texts[0]}-${texts[1]}`;
  }
  return { ...base, output: p.prefix + qtyText + unitText + rest, scaled: true };
}

function assertFactor(factor) {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
    throw new RangeError('Scale factor must be a positive finite number');
  }
}

// Only a lone, simple, lowercase noun ("1 egg", "2 lemons, juiced") is
// touched, and only when the amount crosses 1. Anything else is left as typed.
const SIMPLE_NOUN_RE = /^(\s+)([a-z]{3,})(\s*(?:,.*)?)$/u;

function adjustPlural(rest, before, after) {
  const m = SIMPLE_NOUN_RE.exec(rest);
  if (!m) return rest;
  const [, space, word, tail] = m;
  const wasPlural = friendlyValue(before) > 1;
  const isPlural = friendlyValue(after) > 1;
  if (wasPlural === isPlural) return rest;
  if (isPlural) {
    if (/(?:s|x|z|ch|sh|y|o)$/.test(word)) return rest;
    return space + word + 's' + tail;
  }
  if (!/[^s]s$/.test(word) || /(?:oes|ches|shes|xes|ies|us|is)$/.test(word)) return rest;
  return space + word.slice(0, -1) + tail;
}

/**
 * Scale factor from servings.
 * @param {number} originalServings Must be > 0.
 * @param {number} targetServings Must be > 0.
 * @returns {number}
 * @throws {RangeError} If either value is not a positive finite number.
 */
export function scaleFactor(originalServings, targetServings) {
  const a = Number(originalServings);
  const b = Number(targetServings);
  if (!(Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0)) {
    throw new RangeError('Servings must be positive numbers');
  }
  return b / a;
}

/**
 * Scale a whole recipe (one ingredient per line).
 * @param {string} text Recipe text; lines split on \n or \r\n.
 * @param {{ originalServings: number, targetServings: number, system?: UnitSystem }} options
 * @returns {{ factor: number, lines: LineResult[], text: string }}
 *   `text` is all outputs joined with "\n".
 * @throws {RangeError} If servings are invalid.
 */
export function scaleRecipe(text, { originalServings, targetServings, system = 'us' }) {
  const factor = scaleFactor(originalServings, targetServings);
  const lines = String(text ?? '').split(/\r?\n/).map((l) => scaleLine(l, factor, { system }));
  return { factor, lines, text: lines.map((l) => l.output).join('\n') };
}
