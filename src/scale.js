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
 *   formatUsVolume, convertAmount, scaleFactor, ALLOW_HALF_TBSP
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
 * When true, whole+1/2 tbsp may display as "N 1/2 tbsp".
 * Thirds and quarters of a tbsp still split to tsp when scaled.
 * Flip to false in one place to forbid half-tablespoons.
 * @type {boolean}
 */
export let ALLOW_HALF_TBSP = true;

/** Leftover tsp after a tbsp may only be these (no 1/3 or 2/3 in compounds). */
const COMPOUND_TSP_FRACTIONS = [
  [0, ''], [1 / 4, '1/4'], [1 / 2, '1/2'], [3 / 4, '3/4'], [1, ''],
];

/** Pinch cutoff: below this → "a pinch"; from here up to 1/8 tsp → "1/8 tsp". */
const PINCH_CUTOFF_TSP = 1 / 16;

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

/** Round leftover tsp to 0, 1/4, 1/2, 3/4, or 1 (carry). Ties carry up. */
function roundCompoundTsp(n) {
  if (!Number.isFinite(n) || n < 0) return n;
  const whole = Math.floor(n);
  let best = COMPOUND_TSP_FRACTIONS[0];
  for (const f of COMPOUND_TSP_FRACTIONS) {
    if (Math.abs(n - whole - f[0]) < Math.abs(n - whole - best[0])) best = f;
  }
  const v = whole + best[0];
  const next = whole + 1;
  if (Math.abs(n - next) <= Math.abs(n - v)) return next;
  return v;
}

function formatCompoundTspFrac(n) {
  const v = roundCompoundTsp(n);
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const f = COMPOUND_TSP_FRACTIONS.find(([x]) => Math.abs(x - frac) < 1e-9);
  const fracText = f ? f[1] : '';
  if (whole === 0) return fracText || '0';
  return fracText ? `${whole} ${fracText}` : String(whole);
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
  // Unit choice matches main (eighths allowed here); D-new rewrites eighth-cups
  // and fractional tbsp at format time.
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
 * Format a US volume the way a cook writes it (D-new + 5% snap).
 *
 * Build cook-friendly candidates, then pick the SIMPLEST within 5% relative
 * error of the true amount (relative to the candidate). Exact match wins.
 * Simplicity: single-unit < two-part combo; among singles, cup > tbsp > tsp;
 * then nearest (absolute tsp error); on an equal-distance tie, round DOWN
 * (prefer the smaller candidate — over-seasoning is worse).
 * Never tsp-only OUTPUT for ≥1 tbsp (singles). Larger-unit candidates (tbsp, cups)
 * are always offered so amounts just under a boundary can snap up within 5%.
 * Standalone 1/3, 2/3 and whole+1/3|+2/3 tsp allowed; never 1/3 or 2/3 tbsp;
 * no thirds in tbsp+tsp combos. Ranges may share tsp when both ends ≤ 4 tsp.
 * Below 1/16 tsp → pinch; 1/16..1/8 → 1/8 tsp (explicit exception, may exceed 5%).
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

/** Relative error is measured against the candidate (display) value. */
const SNAP_REL = 0.05;

/**
 * @typedef {{ tsp: number, text: string, parts: 1|2, unitRank: number }} SnapCand
 * unitRank: 0=cup, 1=tbsp, 2=tsp (lower = preferred among equal simplicity)
 */

/**
 * Format a US volume from a teaspoon total via 5% snap candidates.
 * @param {number} totalTsp
 * @returns {string}
 */
function formatFromTsp(totalTsp) {
  if (!Number.isFinite(totalTsp) || totalTsp < 0) return String(totalTsp);
  if (totalTsp <= 0) return 'a pinch';
  // Explicit small-amount band (may exceed 5% — SL exception).
  if (totalTsp < PINCH_CUTOFF_TSP) return 'a pinch';
  if (totalTsp <= 1 / 8 + 1e-9) return '1/8 tsp';
  // Absurdly large (guard / attack inputs): avoid candidate explosion.
  if (totalTsp > 1e7) {
    const cups = Math.round(totalTsp / 48);
    return `${cups} cups`;
  }

  const best = pickSnapCandidate(totalTsp);
  return best ? best.text : 'a pinch';
}

/**
 * Pick best snap candidate for a true teaspoon amount.
 * @param {number} trueTsp
 * @returns {SnapCand|null}
 */
function pickSnapCandidate(trueTsp) {
  if (!Number.isFinite(trueTsp) || trueTsp <= 0) return null;
  if (trueTsp < PINCH_CUTOFF_TSP) return { tsp: 1 / 32, text: 'a pinch', parts: 1, unitRank: 2 };
  if (trueTsp <= 1 / 8 + 1e-9) return { tsp: 1 / 8, text: '1/8 tsp', parts: 1, unitRank: 2 };

  const cands = buildSnapCandidates(trueTsp);
  if (!cands.length) return null;

  const absErr = (c) => Math.abs(c.tsp - trueTsp);
  // Accept if within 5% of the candidate OR of the true amount (either direction),
  // so 0.95→1 cup (cand-rel) and near-misses like 14.2 tsp→4.5 tbsp (true-rel) both qualify.
  const withinTol = (c) => {
    const a = absErr(c);
    if (c.tsp > 1e-12 && a / c.tsp <= SNAP_REL + 1e-12) return true;
    if (trueTsp > 1e-12 && a / trueTsp <= SNAP_REL + 1e-12) return true;
    return false;
  };

  // Exact is already in `within` (rel 0). Do NOT prefer the exact-only pool —
  // a single unit within 5% beats any combo, exact or not (SL final).
  // "Exact wins" only among equally simple candidates (same parts + unitRank),
  // which falls out of sorting by absErr after parts/unitRank.
  const within = cands.filter(withinTol);
  const fallback = !within.length;

  // Within 5%: single before combo, then cup>tbsp>tsp, then nearest, then round DOWN.
  // Outside 5%: nearest combo (else nearest anything) by absolute error first.
  let pool;
  if (!fallback) {
    pool = within;
    pool.sort((a, b) => {
      if (a.parts !== b.parts) return a.parts - b.parts;
      if (a.unitRank !== b.unitRank) return a.unitRank - b.unitRank;
      const ae = absErr(a);
      const be = absErr(b);
      if (Math.abs(ae - be) > 1e-12) return ae - be;
      return a.tsp - b.tsp; // equal-distance tie → round DOWN
    });
  } else {
    // Outside 5%: under 1 tbsp stay on tsp grid (nearest); otherwise nearest combo.
    if (trueTsp < 3 - 1e-9) {
      pool = cands.filter((c) => c.parts === 1 && c.unitRank === 2);
      if (!pool.length) pool = cands.slice();
    } else {
      const combos = cands.filter((c) => c.parts === 2);
      pool = combos.length ? combos.slice() : cands.slice();
    }
    pool.sort((a, b) => {
      const ae = absErr(a);
      const be = absErr(b);
      if (Math.abs(ae - be) > 1e-12) return ae - be;
      if (a.parts !== b.parts) return a.parts - b.parts;
      if (a.unitRank !== b.unitRank) return a.unitRank - b.unitRank;
      return a.tsp - b.tsp; // equal-distance tie → round DOWN
    });
  }
  return pool[0];
}

/**
 * Build cook-friendly display candidates around trueTsp.
 * @param {number} trueTsp
 * @returns {SnapCand[]}
 */
function buildSnapCandidates(trueTsp) {
  /** @type {SnapCand[]} */
  const cands = [];
  const seen = new Set();
  const add = (tsp, text, parts, unitRank) => {
    if (!(tsp > 0) || !Number.isFinite(tsp)) return;
    // Keep candidates in a generous window so huge inputs cannot explode.
    if (tsp > trueTsp * 4 + 48 && tsp > trueTsp + 96) return;
    if (tsp < trueTsp * 0.25 - 48 && tsp < trueTsp - 96) return;
    const key = `${parts}|${unitRank}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    cands.push({ tsp, text, parts, unitRank });
  };

  // Non-finite / absurdly large → just emit a whole-cup approx and stop.
  if (!Number.isFinite(trueTsp) || trueTsp > 1e9) {
    const cups = Math.max(1, Math.round(trueTsp / 48));
    add(cups * 48, `${cups} cups`, 1, 0);
    return cands;
  }

  // --- single tsp (only when amount < 1 tbsp): 1/8, quarters, 1/3 & 2/3,
  //     and whole+1/3 or whole+2/3 (1 1/3, 1 2/3, 2 1/3, 2 2/3). Thirds stay
  //     out of tbsp+tsp combos.
  if (trueTsp < 3 - 1e-9) {
    add(1 / 8, '1/8 tsp', 1, 2);
    add(1 / 3, '1/3 tsp', 1, 2);
    add(2 / 3, '2/3 tsp', 1, 2);
    for (const w of [1, 2]) {
      add(w + 1 / 3, `${w} 1/3 tsp`, 1, 2);
      add(w + 2 / 3, `${w} 2/3 tsp`, 1, 2);
    }
    for (let q = 1; q <= 11; q++) {
      const v = q * 0.25; // 0.25 .. 2.75
      if (v >= 3 - 1e-9) break;
      add(v, `${formatQuarterTsp(v)} tsp`, 1, 2);
    }
  }

  // --- single tbsp: whole or half, under 1 cup ---
  // Always offer (even when trueTsp is just under 1 tbsp) so a within-5%
  // larger-unit candidate can win; the 5% filter drops far ones.
  const tbspStep = ALLOW_HALF_TBSP ? 0.5 : 1;
  for (let tb = tbspStep; tb < 16 - 1e-9; tb += tbspStep) {
    add(tb * 3, formatTbspLabel(tb), 1, 1);
  }

  // --- single cups: whole + clean cook fraction, near the true amount ---
  const approxCups = trueTsp / 48;
  const minCupWhole = Math.max(0, Math.floor(approxCups) - 2);
  const maxCupWhole = Math.min(Math.floor(approxCups) + 3, Math.ceil(approxCups) + 2);
  // Always cover at least 0..2 so small→cup candidates still appear when relevant
  const cupLo = Math.min(minCupWhole, 0);
  const cupHi = Math.max(maxCupWhole, 2);
  for (let w = cupLo; w <= cupHi; w++) {
    if (w >= 1) add(w * 48, `${w} ${w > 1 ? 'cups' : 'cup'}`, 1, 0);
    for (const [f] of COOK_FRACTIONS) {
      if (f === 0 || f === 1) continue;
      const c = w + f;
      if (c < 1 / 4 - 1e-9) continue;
      add(c * 48, `${formatCookFracExact(c)} ${c > 1 ? 'cups' : 'cup'}`, 1, 0);
    }
  }

  // --- combo: tbsp + tsp near the true amount, only below 1 cup ---
  // Offer whenever the amount is in the tbsp+tsp neighbourhood (incl. just
  // under 1 tbsp), so eligibility is not gated on the unit boundary.
  if (trueTsp >= 2.5 - 1e-9 && trueTsp < 48 - 1e-9) {
    const approxTbsp = trueTsp / 3;
    const w0 = Math.max(1, Math.floor(approxTbsp) - 2);
    const w1 = Math.min(15, Math.ceil(approxTbsp) + 2); // under 1 cup
    for (let w = w0; w <= w1; w++) {
      for (let q = 1; q <= 11; q++) {
        const rem = q * 0.25;
        if (rem >= 3 - 1e-9) continue;
        add(w * 3 + rem, `${w} tbsp + ${formatQuarterTsp(rem)} tsp`, 2, 1);
      }
    }
  }

  // --- combo: cups + whole/half tbsp under 4 (R4), near true amount ---
  for (let w = cupLo; w <= cupHi; w++) {
    const cupBases = [];
    if (w >= 1) cupBases.push(w);
    for (const [f] of COOK_FRACTIONS) {
      if (f === 0 || f === 1) continue;
      const c = w + f;
      if (c >= 1 - 1e-9) cupBases.push(c);
    }
    for (const c of cupBases) {
      for (let tb = tbspStep; tb < 4 - 1e-9; tb += tbspStep) {
        add(
          c * 48 + tb * 3,
          `${formatCookFracExact(c)} ${c > 1 ? 'cups' : 'cup'} + ${formatTbspLabel(tb)}`,
          2,
          0,
        );
      }
    }
  }

  return cands;
}

/** Format tsp amount on the quarter grid (and 1/8). No 1/3 or 2/3. */
function formatQuarterTsp(v) {
  if (Math.abs(v - 1 / 8) < 1e-9) return '1/8';
  const whole = Math.floor(v + 1e-9);
  const frac = v - whole;
  const quarters = [[0, ''], [0.25, '1/4'], [0.5, '1/2'], [0.75, '3/4']];
  let best = quarters[0];
  for (const q of quarters) {
    if (Math.abs(frac - q[0]) < Math.abs(frac - best[0])) best = q;
  }
  if (Math.abs(best[0] - 1) < 1e-9 || Math.abs(frac - 1) < 1e-9) {
    return String(whole + 1);
  }
  if (whole === 0) return best[1] || '0';
  return best[1] ? `${whole} ${best[1]}` : String(whole);
}

function formatTbspLabel(t) {
  if (ALLOW_HALF_TBSP && Math.abs(t % 1 - 0.5) < 1e-9) {
    const w = Math.floor(t);
    return w === 0 ? '1/2 tbsp' : `${w} 1/2 tbsp`;
  }
  return `${Math.round(t)} tbsp`;
}

/** Format a cup amount already on the cook grid (no re-round). */
function formatCookFracExact(n) {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  const f = COOK_FRACTIONS.find(([x]) => Math.abs(x - frac) < 1e-9);
  const fracText = f ? f[1] : '';
  if (whole === 0) return fracText || '0';
  return fracText ? `${whole} ${fracText}` : String(whole);
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
  // Raw matched unit spelling (e.g. "Tbsp.", "cups") for x1 echo.
  const rawUnit = unit ? (g[unit] ?? null) : null;
  return {
    prefix: g.prefix,
    quantities: q2 === null ? [q1] : [q1, q2],
    rawQuantities: q2 === null ? [g.q1] : [g.q1, g.q2],
    separator: g.sep ?? null,
    unit,
    rawUnit,
    matched: m[0],
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
  // "0 cups": nothing to scale — but "0-1 tsp" is an "up to" range (R3).
  const lowerZeroRange = p.quantities.length === 2 && p.quantities[0] === 0 && p.quantities[1] > 0;
  if (p.quantities.some((q) => q === 0) && !lowerZeroRange) {
    return { ...base, flagged: true, reason: 'zero-quantity' };
  }
  if (!p.unit && DOT_UNIT_RE.test(p.rest)) return { ...base, flagged: true, reason: 'no-quantity' };
  // "1. Preheat oven", "2) Mix", "350°F": a number, but not an amount.
  if (!p.unit && /^(?:[.)]\s|°|%)/u.test(p.rest)) {
    return { ...base, flagged: true, reason: 'not-an-ingredient' };
  }
  // "1 pinch salt", "2 dashes bitters": too small to scale meaningfully.
  if (!p.unit && NON_SCALABLE_RE.test(p.rest)) {
    return { ...base, flagged: true, reason: 'non-scalable' };
  }

  // x1 echo for US cook volumes (cup/tbsp/tsp) only: keep the typed
  // amount+unit unless it contains a forbidden eighth (3/8, 5/8, 7/8, or
  // 1/8 of a non-tsp unit). Half-tbsp and even "1 1/3 tbsp" ARE echoed at
  // x1 (thirds only split when scaled). Counts/weights/metric still process.
  const cookUnit = p.unit === 'cup' || p.unit === 'tbsp' || p.unit === 'tsp';
  if (
    Math.abs(factor - 1) < 1e-15
    && system !== 'metric'
    && cookUnit
    && !hasForbiddenEighth(p)
  ) {
    // Includes ranges with a 0 lower end (echo "0-1 tsp" unchanged at ×1).
    return { ...base, output: line, scaled: true };
  }

  const scaled = p.quantities.map((q) => q * factor);
  if (!scaled.every(Number.isFinite)) return { ...base, flagged: true, reason: 'no-quantity' };
  let texts;
  let unitText = '';
  const sys = system === 'metric' ? 'metric' : 'us';

  if (p.unit && sys === 'us' && (p.unit === 'cup' || p.unit === 'tbsp' || p.unit === 'tsp')
      && scaled.length === 2) {
    // Range of US volumes: try shared unit ladder, then per-end format.
    const joined = formatUsVolumeRange(scaled[0], scaled[1], p.unit, p.separator, {
      inputLowerZero: p.quantities[0] === 0,
    });
    const rest = p.rest;
    const output = p.prefix + joined + rest;
    if (/NaN|Infinity/.test(joined)) return { ...base, flagged: true, reason: 'no-quantity' };
    return { ...base, output: fixPinchOf(output), scaled: true };
  }

  if (p.unit) {
    const first = convertAmount(scaled[0], p.unit, sys);
    const ratio = UNITS[p.unit].base / UNITS[first.unit].base;
    const values = scaled.map((v) => v * ratio);
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
    qtyText = joinRangeTexts(texts[0], texts[1], p.separator);
  }
  let output = p.prefix + qtyText + unitText + rest;
  output = fixPinchOf(output);
  if (/NaN|Infinity/.test(qtyText)) return { ...base, flagged: true, reason: 'no-quantity' };
  return { ...base, output, scaled: true };
}

/** "a pinch salt" → "a pinch of salt"; leave "a pinch of …" / "a pinch to …" alone. */
function fixPinchOf(text) {
  return text.replace(/\ba pinch (?!of\b|to\b)(?=[A-Za-z])/gi, 'a pinch of ');
}

/**
 * Join two formatted range ends (R2/R3). Collapse equal ends; never show "0".
 * Same simple unit → "X-Y unit"; compounds → " to ".
 */
function joinRangeTexts(a, b, separator) {
  const userTo = separator && /to/i.test(separator);
  if (a === 'a pinch' && b === 'a pinch') return 'a pinch';
  // R2: equal ends collapse (compare without unit pluralization noise).
  if (normalizeRangeEnd(a) === normalizeRangeEnd(b)) return a.startsWith('a pinch') ? 'a pinch' : a;

  const simple = /^(.+) (tsp|tbsp|cups?)$/;
  const ma = simple.exec(a);
  const mb = simple.exec(b);
  if (
    ma && mb
    && !a.includes('+') && !b.includes('+')
    && ma[2].replace(/s$/, '') === mb[2].replace(/s$/, '')
  ) {
    const unit = ma[2];
    const u = Number(parseQuantity(mb[1])) > 1 && unit === 'cup' ? 'cups' : unit;
    if (!/\b(tsp|tbsp|cups?)\b/i.test(ma[1]) && !/\b(tsp|tbsp|cups?)\b/i.test(mb[1])) {
      // Guard: never emit a "0" lower end.
      if (ma[1] === '0' || parseQuantity(ma[1]) === 0) {
        return userTo ? `up to ${mb[1]} ${u}` : `up to ${mb[1]} ${u}`;
      }
      if (ma[1] === mb[1]) return `${ma[1]} ${u}`; // R2 equal qtys
      if (userTo) return `${ma[1]} to ${mb[1]} ${u}`;
      return `${ma[1]}-${mb[1]} ${u}`;
    }
  }
  if (!/ /.test(a) && !/ /.test(b)) {
    if (a === '0' || parseQuantity(a) === 0) return `up to ${b}`;
    if (a === b) return a;
    if (userTo) return `${a} to ${b}`;
    return `${a}-${b}`;
  }
  if (a === 'a pinch' || a.startsWith('a pinch')) return `a pinch to ${b}`;
  return `${a} to ${b}`;
}

function normalizeRangeEnd(s) {
  return s.replace(/\bcups\b/g, 'cup').replace(/\s+/g, ' ').trim();
}

/** True when a raw qty string uses 3/8, 5/8, 7/8, or 1/8 of a non-tsp unit. */
function hasForbiddenEighth(p) {
  if (!p.unit) return false;
  const eighths = /(?:^|\s)(?:[357]\/8|⅜|⅝|⅞)(?:\s|$)/u;
  const eighthTspOnly = /(?:^|\s)(?:1\/8|⅛)(?:\s|$)/u;
  for (const raw of p.rawQuantities) {
    if (eighths.test(raw)) return true;
    if (eighthTspOnly.test(raw) && p.unit !== 'tsp') return true;
  }
  return false;
}

/**
 * R1: Format a US volume range.
 * Try the input (upper-end) unit first, then tbsp. Never use tsp when either
 * end is ≥ 1 tbsp. If no shared clean unit, format each end and join with " to ".
 * R2: equal ends collapse. R3: never show "0".
 * @param {number} a amount in `fromUnit` (may be 0 as a lower bound)
 * @param {number} b
 * @param {string} fromUnit
 * @param {string|null} separator
 * @param {{ inputLowerZero?: boolean }} [opts]
 */
/** Count of range outputs that used the 10% shared-unit widening (diagnostics). */
export let RANGE_WIDEN_10_COUNT = 0;

function formatUsVolumeRange(a, b, fromUnit, separator, opts = {}) {
  const toTsp = (v, u) => v * (u === 'cup' ? 48 : u === 'tbsp' ? 3 : 1);
  const aTspRaw = Math.max(0, toTsp(a, fromUnit));
  const bTspRaw = Math.max(0, toTsp(b, fromUnit));
  const userTo = separator && /to/i.test(separator);

  // R3: input lower bound was 0 → "up to X" (×1 echo handled in scaleLine)
  if (opts.inputLowerZero || a <= 0) {
    return `up to ${formatFromTsp(bTspRaw)}`;
  }

  // Pinch band short-circuit on raw ends
  if (aTspRaw < PINCH_CUTOFF_TSP && bTspRaw < PINCH_CUTOFF_TSP) return 'a pinch';
  if (aTspRaw < PINCH_CUTOFF_TSP) return `a pinch to ${formatFromTsp(bTspRaw)}`;

  /** @type {string[]} */
  // Ladder: input/upper unit first, then tbsp, then tsp.
  // Range-only exception: tsp may be shared when BOTH ends are ≤ 4 tsp
  // (deliberate carve-out from "never tsp for ≥1 tbsp"). When fromUnit is
  // tbsp/cup and that unit fits both ends, it wins (tried first); tsp is
  // only reached when a larger shared unit does not fit — i.e. when the
  // alternative would be a split/combo.
  const ladder = [];
  if (fromUnit === 'cup' || fromUnit === 'tbsp' || fromUnit === 'tsp') ladder.push(fromUnit);
  if (!ladder.includes('tbsp')) ladder.push('tbsp');
  const bothAtMost4Tsp = aTspRaw <= 4 + 1e-9 && bTspRaw <= 4 + 1e-9;
  if (bothAtMost4Tsp && !ladder.includes('tsp')) ladder.push('tsp');

  // R1 first pass: shared single unit within 5% for BOTH raw ends.
  const shared5 = trySharedRangeUnit(aTspRaw, bTspRaw, ladder, SNAP_REL, userTo);
  if (shared5) return shared5;

  // Preview per-end snaps to decide whether 10% widening helps.
  const ca = pickSnapCandidate(aTspRaw);
  const cb = pickSnapCandidate(bTspRaw);
  const ta = ca ? ca.text : formatFromTsp(aTspRaw);
  const tb = cb ? cb.text : formatFromTsp(bTspRaw);
  const fallbackJoin = (ta === 'a pinch' || ta.startsWith('a pinch'))
    ? (tb === 'a pinch' || tb.startsWith('a pinch') ? 'a pinch' : `a pinch to ${tb}`)
    : joinRangeTexts(ta, tb, ' to ');
  const fallbackIsSharedSingle = /^[\d /]+(-| to )[\d /]+ (tsp|tbsp|cups?)$/.test(fallbackJoin)
    || /^[\d /]+ (tsp|tbsp|cups?)$/.test(fallbackJoin);
  const bothCombos = ta.includes('+') && tb.includes('+');

  // Widen to 10% when fallback would not be a clean shared single-unit range
  // (covers combos-at-both-ends and mixed combo/single splits).
  if (!fallbackIsSharedSingle || bothCombos) {
    const shared10 = trySharedRangeUnit(aTspRaw, bTspRaw, ladder, 0.10, userTo);
    if (shared10) {
      RANGE_WIDEN_10_COUNT += 1;
      return shared10;
    }
  }

  return fallbackJoin;
}

/**
 * Try to express both range ends in one shared single unit within `tol`.
 * Ladder order = caller's (upper/input unit first, then tbsp, then tsp if allowed).
 * @returns {string|null}
 */
function trySharedRangeUnit(aTsp, bTsp, ladder, tol, userTo) {
  for (const unit of ladder) {
    if (unit === 'tsp' && (aTsp > 4 + 1e-9 || bTsp > 4 + 1e-9)) continue;
    // cups only when both ends are at least ~1/4 cup territory (avoid tiny→cup)
    if (unit === 'cup' && aTsp < 12 * (1 - tol) - 1e-9) continue;
    const lo = bestGridInUnit(aTsp, unit, tol);
    const hi = bestGridInUnit(bTsp, unit, tol);
    if (!lo || !hi) continue;
    const unitLabel_ = unit === 'cup' ? (hi.v > 1 ? 'cups' : 'cup') : unit;
    if (lo.text === hi.text) return `${lo.text} ${unitLabel_}`;
    const sep = userTo ? ' to ' : '-';
    return `${lo.text}${sep}${hi.text} ${unitLabel_}`;
  }
  return null;
}

/**
 * Nearest cook-grid value in `unit` within relative tolerance of trueTsp.
 * Ties round DOWN. Returns { v, text } or null.
 */
function bestGridInUnit(trueTsp, unit, tol) {
  const per = unit === 'cup' ? 48 : unit === 'tbsp' ? 3 : 1;
  /** @type {number[]} */
  let vals = [];
  if (unit === 'cup') {
    for (let w = 0; w <= 40; w++) {
      for (const [f] of COOK_FRACTIONS) {
        if (f === 1) continue;
        const c = w + f;
        if (c >= 1 / 4 - 1e-9) vals.push(c);
      }
      if (w >= 1) vals.push(w);
    }
  } else if (unit === 'tbsp') {
    const step = ALLOW_HALF_TBSP ? 0.5 : 1;
    for (let t = step; t <= 40 + 1e-9; t += step) vals.push(t);
  } else {
    // Range shared tsp may go up to 4 tsp (R1 exception); singles still
    // refuse tsp-only outputs at ≥1 tbsp via pickSnapCandidate.
    vals.push(1 / 8, 1 / 3, 2 / 3);
    for (const w of [1, 2, 3]) {
      vals.push(w + 1 / 3, w + 2 / 3);
    }
    for (let q = 1; q <= 16; q++) vals.push(q * 0.25); // 0.25 .. 4
  }
  let best = null;
  for (const v of vals) {
    if (!(v > 0)) continue;
    if (unit === 'tsp' && v > 4 + 1e-9) continue;
    const tsp = v * per;
    const abs = Math.abs(tsp - trueTsp);
    const relC = abs / tsp;
    const relT = trueTsp > 1e-12 ? abs / trueTsp : Infinity;
    if (relC > tol + 1e-12 && relT > tol + 1e-12) continue;
    if (
      !best
      || abs < best.abs - 1e-12
      || (Math.abs(abs - best.abs) < 1e-12 && v < best.v - 1e-12)
    ) {
      best = { v, abs, tsp };
    }
  }
  if (!best) return null;
  return { v: best.v, text: formatCleanRangeQty(best.v, unit) };
}

/** Clean range end: cook cup frac, whole/half tbsp, or quarter/1/8 tsp. No 1/3 or 2/3 tsp/tbsp. */
function isCleanRangeEnd(value, unit) {
  if (!Number.isFinite(value) || value <= 0) return false;
  if (unit === 'cup') {
    const c = roundCook(value);
    return Math.abs(c - value) < 1e-6;
  }
  if (unit === 'tbsp') {
    const whole = Math.floor(value + 1e-9);
    const frac = value - whole;
    if (Math.abs(frac) < 1e-6) return true;
    if (ALLOW_HALF_TBSP && Math.abs(frac - 0.5) < 1e-6) return true;
    return false;
  }
  // tsp: 1/8, quarters, 1/3 / 2/3, whole+thirds — up to 4 (range shared exception)
  if (Math.abs(value - 1 / 8) < 1e-6) return true;
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (Math.abs(frac - 1 / 3) < 1e-6 || Math.abs(frac - 2 / 3) < 1e-6) {
    return value <= 4 + 1e-9;
  }
  if (Math.abs(frac) < 1e-6 && value > 0 && value <= 4 + 1e-9) return true;
  const q = Math.round(value * 4) / 4;
  return Math.abs(q - value) < 1e-6 && q > 0 && q <= 4 + 1e-9;
}

function formatCleanRangeQty(value, unit) {
  if (unit === 'cup') return formatCookFracExact(roundCook(value));
  if (unit === 'tbsp') {
    const whole = Math.floor(value + 1e-9);
    const frac = value - whole;
    if (ALLOW_HALF_TBSP && Math.abs(frac - 0.5) < 1e-6) {
      return whole === 0 ? '1/2' : `${whole} 1/2`;
    }
    return String(Math.round(value));
  }
  if (Math.abs(value - 1 / 8) < 1e-6) return '1/8';
  if (value >= PINCH_CUTOFF_TSP && value < 1 / 8) return '1/8';
  const whole = Math.floor(value + 1e-9);
  const frac = value - whole;
  if (Math.abs(frac - 1 / 3) < 1e-6) return whole === 0 ? '1/3' : `${whole} 1/3`;
  if (Math.abs(frac - 2 / 3) < 1e-6) return whole === 0 ? '2/3' : `${whole} 2/3`;
  const q = Math.round(value * 4) / 4;
  if (q <= 0) return '1/8';
  return formatQuarterTsp(q);
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
