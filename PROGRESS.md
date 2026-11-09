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
| 1 | Repo, Pages from `main`, branch protection, tests workflow, this plan | Supreme Leader | PR open |
| 2 | Parser + scaler + formatter module (`src/scale.js`) with unit tests (`tests/*.test.js`, `node --test`) | Builder | todo |
| 3 | UI: `index.html` + CSS + JS wiring, live updates, US/metric toggle, marked unparsed lines, mobile layout, made-up demo recipes | Builder | todo |
| 4 | README (what it does, how to use, how to run tests) | Builder | todo |
| 5 | Review each PR: checkout branch, run tests, run the site locally (`python3 -m http.server`), try edge cases, approve or request changes | Reviewer | ongoing |
| 6 | Post-merge check of the live site | Reviewer | todo |
| 7 | Keep this log up to date, unblock, final report | Supreme Leader | ongoing |

## Working rules
- Nobody pushes to `main`. Every change is a PR; `main` requires 1 approving review and a passing `test` check, admins included.
- Supreme Leader never approves or merges. After Reviewer approves and checks pass, the PR author merges (squash).
- Commits use `354381310+grok-sandbox-squad@users.noreply.github.com` and are signed with the author's bot name.
- Demo data is made up. No tracking, no external scripts or fonts.

## Decisions
- **D1. Bootstrap commit.** The repo's very first commit (an empty README from repo creation) went straight to `main` because protection can't be applied to a branch that doesn't exist yet. Everything after it, including this plan, goes through PRs.
- **D2. No build step, no dependencies.** Plain HTML/CSS/ES modules, served as-is by Pages from `main` root. Tests use Node's built-in test runner (`node --test`), so CI needs nothing installed. Keeps the site static and the supply chain empty.
- **D3. Logic separate from UI.** All parsing/scaling/formatting lives in `src/scale.js` (pure functions) so tests cover the rules without a browser.
- **D4. Friendly fractions.** Round to the nearest of 1/8, 1/4, 1/3, 1/2, 2/3, 3/4 (and eighths) and show mixed numbers (e.g. `1 1/3`). Metric grams/ml shown as rounded whole numbers (or 1 decimal under 10).
- **D5. "Reads better" units.** US volume picks the largest of tsp, tbsp, cup where the amount is at least about 1 of that unit (e.g. 48 tsp is 1 cup, 6 tsp is 2 tbsp). US weight: oz up to 16, then lb. Metric: ml up to 1000 then l, g up to 1000 then kg. Count items (eggs) and words like "pinch" are never converted.
- **D6. Unparseable lines.** Kept exactly as typed and visibly marked "not scaled". Blank lines are kept as spacing. "pinch of salt" and "salt to taste" have no number, so they are shown unchanged and marked.
- **D7. Merging.** The PR author merges after approval, since Supreme Leader doesn't merge and Reviewer reviews.

## Log
- 2026-11-09: Supreme Leader created the public repo, enabled Pages from `main` /, protected `main` (1 approving review, dismiss stale reviews, required `test` check, admins included, no force pushes/deletions). Opened the plan + CI PR.

## Reviewer catches
_(filled in as reviews happen)_
