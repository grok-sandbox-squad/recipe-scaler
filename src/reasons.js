/**
 * Plain-language labels for the `reason` codes that src/scale.js puts on
 * flagged lines. tests/ui.test.js checks that every code has a label.
 * @module reasons
 */

/** @type {Readonly<Record<string, string>>} */
export const REASON_LABELS = Object.freeze({
  'no-quantity': 'no amount found',
  'zero-quantity': 'amount is zero',
  'not-an-ingredient': 'looks like a step or temperature',
  'non-scalable': 'pinch, dash or smidgen',
});

/**
 * Label for a reason code, with a generic fallback for unknown codes.
 * @param {string|null} reason
 * @returns {string}
 */
export function reasonLabel(reason) {
  return Object.hasOwn(REASON_LABELS, reason ?? '') ? REASON_LABELS[reason] : 'could not scale';
}
