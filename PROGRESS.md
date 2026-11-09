# Recipe Scaler: progress log

Squad: **Supreme Leader** (lead), **Builder** (code), **Reviewer** (GitHub App `grok-squad-reviewer`).

## Goal
A small public static web app on GitHub Pages where someone pastes an ingredient list, sets original and target servings, and sees every quantity rescaled live, shown as friendly kitchen fractions, with US/metric unit display.

## Scope
In: free-text ingredient parsing (whole, decimal, fraction, mixed number, unicode fractions like ½), live scaling, friendly fractions, unit conversion that "reads better", US/metric toggle, unparseable lines kept and marked, phone-friendly layout, made-up demo recipes, tests in GitHub Actions, README.
Out: backend, accounts, analytics/tracking, paid services, saving recipes, real personal data.

## Done means
- Live at https://grok-sandbox-squad.github.io/recipe-scaler/
- Every change reached `main` through a PR approved by `grok-squad-reviewer`.
- Automated tests for parsing and scaling run in GitHub Actions on every PR (`tests` workflow, job `test`, required check).
- README explains the app and how to run tests.
- This file shows plan, decisions, who did what, and what Reviewer caught.

## Task list
| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Repo, Pages from `main`, branch protection, tests workflow, this plan | Supreme Leader | done (#1, #2) |
| 2 | Parser + scaler + formatter module (`src/scale.js`) with unit tests (`tests/*.test.js`, `node --test`) | Builder | done (#3) |
| 3 | UI: `index.html` + CSS + JS wiring, live updates, US/metric toggle, marked unparsed lines, mobile layout, made-up demo recipes | Builder | done (#4) |
| 4 | README (what it does, how to use, how to run tests) | Builder | done (#4) |
| 8 | Cook-friendly amounts (D-new): fix 1/3 cup halved and related rounding | Builder | done (#6) |
| 5 | Review each PR: checkout branch, run tests, run the site locally (`python3 -m http.server`), try edge cases, approve or request changes | Reviewer | done (#1-#4, #6) |
| 6 | Post-merge check of the live site | Reviewer | done (after #4, #6) |
| 7 | Keep this log up to date, unblock, final report | Supreme Leader | ongoing |

## Working rules
- Nobody pushes to `main`. Every change is a PR; `main` requires 1 approving review and a passing `test` check, admins included.
- Supreme Leader never approves or merges. Builder never merges its own PRs. After Reviewer approves and `test` passes: Builder merges Supreme Leader's PRs, Reviewer (grok-squad-reviewer) squash-merges Builder's PRs.
- Commits use `354381310+grok-sandbox-squad@users.noreply.github.com` and are signed with the author's bot name.
- Demo data is made up. No tracking, no external scripts or fonts.

## Decisions
- **D1. Bootstrap commit.** The repo's very first commit (an empty README from repo creation) went straight to `main` because protection can't be applied to a branch that doesn't exist yet. Everything after it, including this plan, goes through PRs.
- **D2. No build step, no dependencies.** Plain HTML/CSS/ES modules, served as-is by Pages from `main` root. Tests use Node's built-in test runner (`node --test`), so CI needs nothing installed. Keeps the site static and the supply chain empty.
- **D3. Logic separate from UI.** All parsing/scaling/formatting lives in `src/scale.js` (pure functions) so tests cover the rules without a browser.
- **D4. Friendly fractions.** Round to the nearest of 1/8, 1/4, 1/3, 1/2, 2/3, 3/4 (and eighths) and show mixed numbers (e.g. `1 1/3`). Metric grams/ml shown as rounded whole numbers (or 1 decimal under 10).
- **D5. "Reads better" units.** US volume picks the largest of tsp, tbsp, cup where the amount is at least about 1 of that unit (e.g. 48 tsp is 1 cup, 6 tsp is 2 tbsp). US weight: oz up to 16, then lb. Metric: ml up to 1000 then l, g up to 1000 then kg. Count items (eggs) and words like "pinch" are never converted.
- **D6. Unparseable lines.** Kept exactly as typed and visibly marked "not scaled". Blank lines are kept as spacing. "pinch of salt" and "salt to taste" have no number, so they are shown unchanged and marked.
- **D7. Merging (revised).** First plan was "Builder merges everything". Builder flagged it won't merge its own PRs, and Supreme Leader never merges. So Builder merges Supreme Leader's PRs and Reviewer squash-merges Builder's PRs after approving and testing them. Every merge still needs the approval and the green `test` check, so nobody can skip review.
- **D8. CI hardening.** Workflow runs with read-only `contents` permission and third-party actions pinned to commit SHAs (Reviewer's suggestion on PR #1).
- **D9. Empty test suite.** `node --test` passes with zero tests, so Reviewer rejects any PR that adds logic without real tests.
- **D10. Plurals.** Only a single lowercase count noun is re-pluralized, and only when the count crosses 1 (`3 eggs` to `1 egg`). Anything fancier is left as typed rather than guessed.
- **D11. Thousands separators.** `1,000 g` and `1 000 g` are flagged "not scaled" instead of guessed, because `1,5` means 1.5 in many locales.
- **D12. Non-scalable amounts.** pinch, dash, smidgen, and lines with zero or malformed amounts are kept as typed and flagged with a reason. Bad scale factors (0, negative, NaN, Infinity) throw RangeError, and the UI shows a message.
- **D13. Units kept readable.** Amounts of 1/4 cup and up stay in cups, and there are no ingredient-specific cups-to-grams conversions, since density varies by ingredient (Builder's call, which Reviewer accepted).
- **D-new. Cook-friendly amounts.** Show the simplest measure a cook would use, as long as it's within 5% of the true amount. Decided by Supreme Leader across several review rounds on PR #6:
  - x1 echoes what was typed. The exception is banned eighths (e.g. 5/8 cup → 10 tbsp).
  - Clean fractions are 1/4, 1/3, 1/2, 2/3 and 3/4 (plus 1/8 tsp). Half tbsp are allowed; thirds and quarters of a tbsp split into tbsp + tsp (never 2/3 tbsp).
  - 5% snap: the simplest candidate within 5% wins, so a single unit beats a combo. Exact wins only within the same tier. Ties round down.
  - 1/16 to 1/8 tsp shows "1/8 tsp"; below that, "a pinch".
  - Ranges share one unit when both ends fit within 5% (10% for range ends). tsp is allowed for ranges up to 4 tsp. Equal ends collapse; a 0 lower end becomes "up to X", and a tiny one becomes "a pinch to X".
  - At 1 cup or more: whole cups + a clean fraction + tbsp under 4 (never "1 cup + 14 tbsp").

## Log
- 2026-11-09: Supreme Leader created the public repo, enabled Pages from `main` /, protected `main` (1 approving review, dismiss stale reviews, required `test` check, admins included, no force pushes/deletions). Opened the plan + CI PR.
- 2026-11-09: PR #1 (plan + CI) approved by Reviewer, merged by Builder (ac258ba). Builder started PR A (logic + tests). Supreme Leader opened CI-hardening PR.
- PR #2 (CI hardening) approved by Reviewer, merged by Builder (18889f2).
- PR #3 (scaling logic + tests, Builder): changes requested twice, then approved and merged by Reviewer (e835f11).
- PR #4 (UI, demo recipes, README, UI tests, Builder): approved and merged by Reviewer (97a38cf). Pages deployed, and Reviewer checked the live site.
- Supreme Leader verified: 34/34 tests pass on main locally, PRs #1-#4 each have a grok-squad-reviewer approval, protection still has admins included and 1 required review, and the live URL returns 200.
- PR #6 (cook-friendly amounts, Builder): several rounds of changes requested, then approved and squash-merged by Reviewer as e642341 (57/57 tests). Implements D-new. The run-1 bug is fixed: 1/3 cup halved now shows "2 tbsp + 2 tsp" instead of "2 2/3 tbsp". Reviewer verified it live in Chromium and Firefox (also 1 tbsp ×1/2 → "1 1/2 tsp", 1 tsp ×2.95 → "1 tbsp", 4 tsp ×1/3 → "1 1/3 tsp", "1-2 tsp" ×2 → "2-4 tsp", and x1 echo). Supreme Leader verified 7 cases live in Chromium, Firefox and WebKit.

## Who did what
- **Supreme Leader:** repo, Pages, branch protection, CI workflow and hardening, plan, decisions (including D-new), this log, coordination; ruled on every #6 rounding question; verified 7 live cases in Chromium, Firefox and WebKit after merge.
- **Builder:** `src/scale.js` and tests (#3), UI, demo recipes, README, UI tests (#4); cook-friendly amounts rewrite and 57 tests (#6); merged #1 and #2.
- **Reviewer:** reviewed every PR (code review and Node probes for #1-#3, plus local and live checks in headless Chromium for the #4 UI; multi-round review and live Chromium/Firefox checks for #6), ran fuzz and perf checks, merged #3, #4 and #6, and checked the live site.

## Reviewer catches
- PR #1: workflow lacked `permissions: contents: read`; actions not pinned to SHAs (fixed in follow-up PR). Also flagged that an empty suite passes CI (rule D9).
- PR #2: verified both pinned SHAs are the official actions/checkout and actions/setup-node v4.4.0 commits. Nit: the working rules said "merges" while D7 said "squash-merges" (fixed in #5).
- PR #3 round 1 (blocking): malformed decimals garbled (`1.5.2 g` became `1 1/2.2 g`); factors 0/NaN/Infinity/negative produced `NaN tsp` / `-48 tsp`. Nits: `2 egg` plural, `1 pinch` became `1/8 pinch`, and output must be escaped in the UI.
- PR #3 round 2 (blocking): `0 cups` gave `NaN tsp` (divide by zero); `1 000 g` x0.5 became `1/2 000 g`. Nits: `1 eggs`, capitalized nouns, wrong flag reason for `5. cup`.
- PR #3 round 3: approved after a 200k-line fuzz run (0 crashes, 0 NaN) and a 10k-line perf check (~30 ms). Follow-up nits: naive plurals (`2 leaves` x0.5 gives `1 leave`), reversed ranges like `3-2 cups` still get scaled, `1 00 g` x0.5 gives `1/2 00 g`, `1 cup (240 ml)` x2 keeps a stale `(240 ml)`, and factors of 1e21 or more print in e-notation.
- PR #4: approved. Verified: no CSP errors, user text renders as plain text (no XSS), no sideways overflow at 390px or 320px, and the live site checked at 97a38cf (app.js matches main, only github.io requests, both demos work). Nits: "Copied" not announced to screen readers, tiny factor shows "Scaled ×0", servings stays two columns on narrow phones, vague reason for `1 000 g`.
- PR #6: several rounds. Early blockers (range "0" ends, equal ends not collapsing, cup + 14 tbsp, near-1-tbsp showing "2 3/4 tsp", "1 1/2 tsp" showing as "1/2 tbsp") were fixed before merge. Final head 8d46e62: (i)/(ii)/R1/(iii), x1 echo, monotonicity and the near-1-tbsp / no-half-tbsp-below-3-tsp rules all hold; 0 of 400 combos had a usable single unit unused; UI clean in Chromium and Firefox at 390 and 320, axe 0. Live checks listed in the log. Not verified by Reviewer: WebKit/Safari, a real phone.

## Known limitations / next
- Naive plural rule (`2 leaves` x0.5 gives `1 leave`).
- Reversed ranges (`3-2 cups`) are scaled instead of flagged; `1 00 g` is mangled.
- Parenthetical amounts (`1 cup (240 ml)`) aren't rescaled.
- Very large factors print in e-notation, so servings should be capped.
- UI nits from #4 above.
- Still unverified: a real phone, real Safari, a real screen reader. Headless Chromium, Firefox and WebKit were checked after #6; not a physical device.

## Known edge cases (logged, not fixed)
From `/workspace/sl-checks/recipe/x1-drift-over-5pct.txt` and the wider sweep after #6:
- 63 x1 rewrites of odd eighths of tsp or tbsp drift over 5% (e.g. 7/8 tsp → 3/4 tsp, −14%).
- The abbreviations `c`, `T` and `t` aren't recognized and are treated as counts.
- Gram ranges like `2–4 g` collapse in US mode.
- En dashes become hyphens.
- Descending ranges like `1–5/8 cup` produce `16-10 tbsp`.
