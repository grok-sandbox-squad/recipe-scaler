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
 *   formatUsVolume, convertAmount, scaleFactor
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
 *                             ('no-quantity' | 'zero-quantity' |
 *                             'not-an-ingredient' | 'non-scalable'), else null.
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
// A space plus exactly three digits ("1 000 g", "12 500 ml") is a thousands
// separator we do not guess at, so it fails too. "1 1/2" still matches, because
// the mixed-number form is tried first and consumes the whole fraction.
const QTY_END = `(?![\\d/\u2044]|[.,]\\d|\\.\\.|[eE][+-]?\\d|\\s\\d{3}(?!\\d)|\\s*[${UNI}]|\\s+\\d+\\s*[/\u2044])`;

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

// "5. cup": a stray dot between the number and a unit is a malformed amount.
const DOT_UNIT_RE = new RegExp(
  `^[.)]\\s*(?:${Object.values(UNITS).map((u) => u.re).join('|')})(?![a-z])`,
  'i',
);

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

/** Max absolute error (in tsp) when snapping to a clean cook cup. */
const COOK_ABS_TSP = 3; // 1 tbsp: keeps 250 ml ≈ 1 cup, still blocks 3.125 → 3 cups

/**
 * Common cook fractional parts for US volume display (D-new).
 * No eighths here: 3/8, 5/8, 7/8 are not used for cups or tsp leftovers.
 * Standalone tsp may still show 1/8 (a standard measuring spoon) via a
 * separate path; see formatFromTsp.
 */
const COOK_FRACTIONS = [
  [0, ''], [1 / 4, '1/4'], [1 / 3, '1/3'], [1 / 2, '1/2'],
  [2 / 3, '2/3'], [3 / 4, '3/4'], [1, ''],
];

/**
 * Round to the nearest cook fraction (whole + 1/4, 1/3, 1/2, 2/3, 3/4).
 * Ties at the midpoint between 3/4 and the next whole carry UP
 * (e.g. 0.875 → 1, 1.875 → 2), matching "1 7/8 tsp → 2 tsp".
 * @param {number} n
 * @returns {number}
 */
function roundCook(n) {
  if (!Number.isFinite(n) || n < 0) return n;
  const whole = Math.floor(n);
  let best = COOK_FRACTIONS[0];
  for (const f of COOK_FRACTIONS) {
    if (Math.abs(n - whole - f[0]) < Math.abs(n - whole - best[0])) best = f;
  }
  const v = whole + best[0];
  const next = whole + 1;
  // Carry up on a tie (or closer to next whole).
  if (Math.abs(n - next) <= Math.abs(n - v)) return next;
  return v;
}

function cookRelError(n) {
  return n === 0 ? 0 : Math.abs(roundCook(n) - n) / n;
}

/** Format a value already snapped to a cook fraction (or whole). */
function formatCookFrac(n) {
  const v = roundCook(n);
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const f = COOK_FRACTIONS.find(([x]) => Math.abs(x - frac) < 1e-9);
  const fracText = f ? f[1] : '';
  if (whole === 0) return fracText || '0';
  return fracText ? `${whole} ${fracText}` : String(whole);
}

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
  // Volume uses cook fractions only (D-new); weight still allows eighths.
  const ladder = kind === 'volume'
    ? [['cup', 1 / 4], ['tbsp', 1], ['tsp', 0]]
    : [['lb', 1], ['oz', 0]];
  const errFn = kind === 'volume' ? cookRelError : relError;
  for (const [unit, min] of ladder) {
    const value = baseAmount / UNITS[unit].base;
    if (min === 0) return { unit, value };
    if (value >= min * (1 - UNIT_TOLERANCE) && errFn(value) <= UNIT_TOLERANCE) {
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
 * Format a US volume the way a cook writes it (D-new).
 *
 * Rules:
 * - Prefer a clean cook cup (1/4, 1/3, 1/2, 2/3, 3/4) when one fits.
 * - Ugly cup eighths split: e.g. 5/8 cup → "1/2 cup + 2 tbsp".
 * - Never show a fractional tablespoon. Split into whole tbsp + tsp
 *   (1 tbsp = 3 tsp), e.g. 2 2/3 tbsp → "2 tbsp + 2 tsp".
 * - Tsp amounts (lone or leftover) use only whole + 1/4, 1/3, 1/2, 2/3, 3/4.
 *   Standalone tsp may also show "1/8 tsp" (standard spoon). Leftover tsp
 *   after a tbsp never shows 1/8; leftovers under 1/8 tsp are dropped.
 * - Between 1/16 and 1/8 tsp (and anything smaller): "a pinch".
 * - Near-whole tsp carries up (1 7/8 → 2 tsp; 2 7/8 → 1 tbsp).
 * - Never "0 tbsp + …", "+ 0 tsp", "3 tbsp + 3 tsp", or "16 tbsp".
 *
 * Returns the full quantity+unit string (units included).
 *
 * @param {number} value Amount in `unit`.
 * @param {'cup'|'tbsp'|'tsp'} unit
 * @returns {string}
 */
export function formatUsVolume(value, unit) {
  if (!Number.isFinite(value) || value < 0) return `${value} ${unit}`;
  const perTsp = unit === 'cup' ? 48 : unit === 'tbsp' ? 3 : unit === 'tsp' ? 1 : null;
  if (perTsp === null) return `${formatFraction(value)} ${unit}`;
  return formatFromTsp(value * perTsp);
}

/**
 * Core US-volume formatter, working in teaspoons.
 * @param {number} totalTsp
 * @returns {string}
 */
function formatFromTsp(totalTsp) {
  if (!Number.isFinite(totalTsp) || totalTsp < 0) return String(totalTsp);
  if (totalTsp === 0) return '0 tsp';
  // Below 1/16 tsp: a pinch. In [1/16, 1/8): also a pinch (do not round up to 1/8).
  if (totalTsp < 1 / 8) return 'a pinch';

  // Clean cook cup? Require both relative and absolute tolerance so
  // 3.125 cups does not silently become 3 cups (2 tbsp lost).
  const cups = totalTsp / 48;
  if (cups >= (1 / 4) * (1 - UNIT_TOLERANCE) && cookRelError(cups) <= UNIT_TOLERANCE) {
    const c = roundCook(cups);
    const absTspErr = Math.abs(c - cups) * 48;
    if (c > 0 && absTspErr <= COOK_ABS_TSP) {
      return `${formatCookFrac(c)} ${c > 1 ? 'cups' : 'cup'}`;
    }
  }

  // Ugly cup-sized amounts: split into cook cup + whole tbsp (5/8 → 1/2 cup + 2 tbsp).
  // Whole tablespoon counts under 6 stay as "N tbsp" (5 tbsp reads better than
  // "1/4 cup + 1 tbsp"); 6+ tbsp that aren't a clean cook cup use the split.
  // Cup + tbsp splits for ugly cup eighths / large tbsp counts (≥ 6 tbsp).
  // Smaller non-whole amounts prefer the more accurate tbsp + tsp path.
  if (cups >= (1 / 4) * (1 - UNIT_TOLERANCE)) {
    const split = splitCupPlusTbsp(cups);
    if (split && /cup/.test(split)) {
      const wholeTbsp = totalTsp / 3;
      const isWhole = Math.abs(wholeTbsp - Math.round(wholeTbsp)) < 1e-9;
      const n = Math.round(wholeTbsp);
      if ((isWhole && n >= 6) || (!isWhole && wholeTbsp >= 6)) return split;
    }
  }

  // tbsp + optional tsp leftover
  const tbspExact = totalTsp / 3;
  if (tbspExact >= 1 * (1 - UNIT_TOLERANCE)) {
    let w = Math.floor(tbspExact + 1e-9);
    let tspRem = totalTsp - w * 3;
    // Carry near-whole leftover tsp up into the next tbsp.
    let remRounded = roundCook(Math.max(tspRem, 0));
    if (remRounded >= 3 - 1e-9) {
      w += 1;
      tspRem = 0;
      remRounded = 0;
    }
    // Re-check clean cup / cup+tbsp after carry.
    const after = formatFromTspAfterTbsp(w, tspRem, remRounded);
    if (after) return after;
  }

  return formatStandaloneTsp(totalTsp);
}

/**
 * @param {number} w whole tbsp
 * @param {number} tspRem raw leftover tsp
 * @param {number} remRounded cook-rounded leftover
 * @returns {string|null}
 */
function formatFromTspAfterTbsp(w, tspRem, remRounded) {
  // Drop tiny leftovers: never "+ 0 tsp", never "+ 1/8 tsp" after a tbsp.
  // Threshold: leftover under 1/8 tsp is dropped (1/8 is standalone-only).
  const dropLeftover = tspRem < 1 / 8 || remRounded < 1e-9;
  if (dropLeftover) {
    if (w <= 0) return formatStandaloneTsp(Math.max(tspRem, 0));
    const cupOnly = w / 16;
    if (cupOnly >= (1 / 4) * (1 - UNIT_TOLERANCE) && cookRelError(cupOnly) <= UNIT_TOLERANCE) {
      const c = roundCook(cupOnly);
      if (Math.abs(c - cupOnly) * 48 <= COOK_ABS_TSP) {
        return `${formatCookFrac(c)} ${c > 1 ? 'cups' : 'cup'}`;
      }
    }
    // Same rule as formatFromTsp: only split whole-tbsp amounts at 6+ tbsp.
    if (cupOnly >= (1 / 4) * (1 - UNIT_TOLERANCE) && w >= 6) {
      const split = splitCupPlusTbsp(cupOnly);
      if (split && /cup/.test(split)) return split;
    }
    return `${w} tbsp`;
  }
  if (w <= 0) return formatStandaloneTsp(w * 3 + tspRem);
  // Re-check whether w tbsp + rem is a clean cup (e.g. 3 tbsp + 3 tsp).
  const totalCups = (w * 3 + remRounded) / 48;
  if (totalCups >= (1 / 4) * (1 - UNIT_TOLERANCE) && cookRelError(totalCups) <= UNIT_TOLERANCE) {
    const c = roundCook(totalCups);
    if (Math.abs(c - totalCups) * 48 <= COOK_ABS_TSP) {
      return `${formatCookFrac(c)} ${c > 1 ? 'cups' : 'cup'}`;
    }
  }
  return `${w} tbsp + ${formatCookFrac(remRounded)} tsp`;
}

/**
 * Prefer the cook-friendlier cup split: larger cup part first, then smaller
 * remainder error, then fewer leftover tbsp (so 1/2 cup + 2 tbsp beats
 * 1/3 cup + 4 tbsp for 0.6 cup).
 * @param {{c:number,tbsp:number,err:number}} a
 * @param {{c:number,tbsp:number,err:number}} b
 */
function preferSplit(a, b) {
  // Exact remainder wins (3/8 cup → 1/4 cup + 2 tbsp, not 1/3 cup + 1 tbsp).
  const aExact = a.err < 1e-12;
  const bExact = b.err < 1e-12;
  if (aExact !== bExact) return aExact;
  // Prefer a short tbsp leftover (≤ 3) so 0.6 cup → 1/2 cup + 2 tbsp,
  // not 1/3 cup + 4 tbsp.
  const aNice = a.tbsp <= 3;
  const bNice = b.tbsp <= 3;
  if (aNice !== bNice) return aNice;
  if (a.c !== b.c) return a.c > b.c;
  if (a.err !== b.err) return a.err < b.err;
  return a.tbsp < b.tbsp;
}

/**
 * Split an amount in cups into "C cup + T tbsp" using cook cup fractions.
 * @param {number} cups
 * @returns {string|null}
 */
function splitCupPlusTbsp(cups) {
  let best = null;
  const maxWhole = Math.floor(cups + 1e-9);
  for (let w = maxWhole; w >= 0; w--) {
    for (const [f] of COOK_FRACTIONS) {
      if (f === 1) continue;
      const c = w + f;
      if (c > cups + 1e-9) continue;
      if (c > 0 && c < (1 / 4) * (1 - UNIT_TOLERANCE)) continue;
      const tbspRem = (cups - c) * 16;
      if (tbspRem < 1e-6) {
        if (c <= 0) continue;
        const err = Math.abs(cups - c);
        const cand = { c, tbsp: 0, err };
        if (!best || preferSplit(cand, best)) best = cand;
        continue;
      }
      const tWhole = Math.round(tbspRem);
      if (tWhole <= 0) continue;
      // Allow up to half a tablespoon of remainder error so 0.6 cup
      // (9.6 tbsp) can become "1/2 cup + 2 tbsp" rather than "10 tbsp".
      if (Math.abs(tbspRem - tWhole) >= 0.5) continue; // strict: 0.5 tbsp off is too far
      const err = Math.abs(tbspRem - tWhole) / 16;
      const cand = { c, tbsp: tWhole, err };
      if (!best || preferSplit(cand, best)) best = cand;
    }
  }
  if (!best || best.c <= 0) return null; // bare tbsp is handled by the tbsp path
  if (best.tbsp === 0) {
    return `${formatCookFrac(best.c)} ${best.c > 1 ? 'cups' : 'cup'}`;
  }
  return `${formatCookFrac(best.c)} ${best.c > 1 ? 'cups' : 'cup'} + ${best.tbsp} tbsp`;
}

/**
 * Standalone tsp: cook fractions, plus 1/8 tsp only when the amount is at
 * least 1/8 (never round a pinch-band amount up to 1/8).
 * @param {number} tsp
 * @returns {string}
 */
function formatStandaloneTsp(tsp) {
  if (tsp <= 0) return '0 tsp';
  if (tsp < 1 / 8) return 'a pinch';

  // Candidates: cook fractions and 1/8. Prefer carry-up on ties.
  const whole = Math.floor(tsp);
  const candidates = [];
  for (const [f] of COOK_FRACTIONS) {
    if (f === 1) continue;
    candidates.push(whole + f);
  }
  candidates.push(whole + 1); // next whole
  candidates.push(whole + 1 / 8);
  if (whole > 0) candidates.push(whole); // exact whole already in COOK via f=0... f=0 gives whole
  candidates.push(whole); // ensure

  let best = candidates[0];
  for (const c of candidates) {
    if (c <= 0) continue;
    if (Math.abs(tsp - c) < Math.abs(tsp - best) - 1e-15) best = c;
    else if (Math.abs(Math.abs(tsp - c) - Math.abs(tsp - best)) < 1e-15 && c > best) best = c;
  }
  // Carry 3 tsp up to 1 tbsp when we landed on ~3.
  if (best >= 3 - 1e-9) {
    const tbsp = best / 3;
    if (Math.abs(tbsp - Math.round(tbsp)) < 1e-9) {
      return formatFromTsp(best); // re-enter for "1 tbsp" / cup promotion
    }
  }
  if (Math.abs(best - 1 / 8) < 1e-9) return '1/8 tsp';
  if (best < 1 / 8) return 'a pinch';
  return `${formatCookFrac(best)} tsp`;
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
  if (!p.quantities.every(Number.isFinite)) return { ...base, flagged: true, reason: 'no-quantity' };
  // "0 cups": nothing to scale; keep as typed rather than invent an amount.
  if (p.quantities.some((q) => q === 0)) return { ...base, flagged: true, reason: 'zero-quantity' };
  if (!p.unit && DOT_UNIT_RE.test(p.rest)) return { ...base, flagged: true, reason: 'no-quantity' };
  // "1. Preheat oven", "2) Mix", "350°F": a number, but not an amount.
  if (!p.unit && /^(?:[.)]\s|°|%)/u.test(p.rest)) {
    return { ...base, flagged: true, reason: 'not-an-ingredient' };
  }
  // "1 pinch salt", "2 dashes bitters": too small to scale meaningfully.
  if (!p.unit && NON_SCALABLE_RE.test(p.rest)) {
    return { ...base, flagged: true, reason: 'non-scalable' };
  }

  const scaled = p.quantities.map((q) => q * factor);
  if (!scaled.every(Number.isFinite)) return { ...base, flagged: true, reason: 'no-quantity' };
  let texts;
  let unitText = '';
  if (p.unit) {
    const sys = system === 'metric' ? 'metric' : 'us';
    const first = convertAmount(scaled[0], p.unit, sys);
    const ratio = UNITS[p.unit].base / UNITS[first.unit].base;
    const values = scaled.map((v) => v * ratio);
    // US cup/tbsp/tsp: cook-friendly formatting includes the unit (and may
    // split fractional tbsp into "N tbsp + M tsp"), so do not append another.
    const cookVolume = sys === 'us' && (first.unit === 'cup' || first.unit === 'tbsp' || first.unit === 'tsp');
    if (cookVolume) {
      texts = values.map((v) => formatUsVolume(v, first.unit));
      unitText = '';
    } else {
      texts = values.map((v) => formatValue(v, first.unit));
      unitText = ' ' + unitLabel(first.unit, values[values.length - 1]);
    }
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
  const output = p.prefix + qtyText + unitText + rest;
  // Last-resort guard: never show NaN / Infinity, keep the line as typed.
  if (/NaN|Infinity/.test(qtyText)) return { ...base, flagged: true, reason: 'no-quantity' };
  return { ...base, output, scaled: true };
}

function assertFactor(factor) {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) {
    throw new RangeError('Scale factor must be a positive finite number');
  }
}

// Only a lone, simple noun ("1 egg", "2 Lemons, juiced") is touched: it is
// singularized when the scaled amount is 1 or less, and pluralized only when
// the amount crosses from 1 or less to more than 1. The first letter's case is
// kept. Anything else is left as typed.
const SIMPLE_NOUN_RE = /^(\s+)([A-Za-z][a-z]{2,})(\s*(?:,.*)?)$/u;

function adjustPlural(rest, before, after) {
  const m = SIMPLE_NOUN_RE.exec(rest);
  if (!m) return rest;
  const [, space, word, tail] = m;
  const wasPlural = friendlyValue(before) > 1;
  const isPlural = friendlyValue(after) > 1;
  if (isPlural) {
    if (wasPlural || /(?:s|x|z|ch|sh|y|o)$/.test(word)) return rest;
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
