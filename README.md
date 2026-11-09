# Recipe Scaler

Paste an ingredient list, set the original and target servings, and see every amount rescaled as you type. Amounts are shown as friendly kitchen fractions (`1 1/2 cups`, not `1.5 cups`), units are switched to whatever reads better (48 tsp becomes 1 cup), and you can show the result in US or metric units. Small US volumes that would land on a fractional tablespoon are split the way a cook measures them (`1/3 cup` halved is `2 tbsp + 2 tsp`, not `2 2/3 tbsp`). Tsp amounts use only common cook fractions (1/4, 1/3, 1/2, 2/3, 3/4), plus standalone `1/8 tsp`; cup eighths split (`5/8 cup` → `1/2 cup + 2 tbsp`). Amounts below 1/8 tsp show as `a pinch`.

**Live site:** https://grok-sandbox-squad.github.io/recipe-scaler/

It is a static site with no build step and no dependencies. Everything runs in your browser: nothing is sent anywhere, saved, or tracked.

## How to use it

1. Type or paste ingredients into the box, one per line (for example `1 1/2 cups flour`, `2 eggs`, `½ tsp salt`). Or pick one of the made-up demo recipes.
2. Enter the original servings and the servings you want.
3. Choose **US** or **Metric** units.
4. The scaled recipe updates live on the right (below on a phone). Use **Copy** to copy it as plain text.

Lines without an amount the app can read (like `Salt to taste`), malformed numbers (like `1.5.2 g`), zero amounts, and amounts that should not be scaled (`1 pinch`, `a dash`, `a smidgen`) are shown exactly as typed and marked with a **not scaled** label plus a short reason. Blank lines are kept as spacing. If a servings value is missing, zero or negative, the app shows a message instead of a result.

### What it understands

- Whole numbers, decimals, fractions and mixed numbers: `3`, `1.5`, `1/2`, `1 1/2`, and unicode fractions like `½` or `1½`.
- Ranges: `1-2 tsp`, `2 to 3 cups`.
- Units: tsp, tbsp, cup, fl oz, pint, quart, gallon, ml, l, g, kg, oz, lb (and common spellings). Anything else after a number (eggs, cloves, cans) is scaled as a count and never converted.

## Run it locally

The page uses ES modules, so serve it over HTTP instead of opening the file directly:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/.

## Run the tests

Tests use Node's built-in test runner (Node 20 or newer, no install needed):

```sh
node --test
```

The same command runs in GitHub Actions on every pull request (`tests` workflow, `test` job).

## Project layout

| File | What it is |
|------|------------|
| `index.html`, `app.css`, `app.js` | The page, its styles, and the UI wiring |
| `src/scale.js` | Parsing, scaling, fraction formatting and unit conversion (no DOM) |
| `src/demo-recipes.js` | The made-up demo recipes |
| `src/reasons.js` | Plain-language labels for why a line was not scaled |
| `tests/` | Unit tests for the logic and static safety checks for the UI |
| `PROGRESS.md` | Plan, decisions and progress log |

## Known limitations

- One ingredient per line; the amount has to come first (`flour, 2 cups` is not scaled).
- Words like "a", "one" or "half" are not read as numbers.
- Plurals are only adjusted for a simple one-word noun right after a count: singular at 1 or less (`1/2 egg`), plural above 1 (`2 eggs`), capitals kept (`2 Eggs`). Multi-word nouns are not changed (`2 green onions` halved shows `1 green onions`).
- Thousands separators are not read: `1,000 g` and `1 000 g` are shown unchanged and marked "not scaled". Write `1000 g` instead.
- Zero amounts (`0 cups sugar`) are left unchanged and marked "not scaled".
- Counts still round to friendly fractions (eighths and thirds). US volumes use cook fractions only (1/4, 1/3, 1/2, 2/3, 3/4): fractional tablespoons become tbsp + tsp, cup eighths become cup + tbsp, and standalone tsp may show `1/8 tsp`. US volumes below 1/8 tsp show as `a pinch`.
- Metric conversion is by volume or weight only; it never converts between the two (no cups of flour to grams).
- Oven temperatures and numbered steps are left unchanged and marked "not scaled".
- Pinch, dash and smidgen are never scaled.
- Text after the amount is kept exactly as typed, including anything that looks like HTML. The page shows it as plain text and never runs it.
