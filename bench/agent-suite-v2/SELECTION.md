# How the suite v2 bugs are picked

Written and committed before any candidate was looked at: no tududi commit after the v1 pin, no issue, and no line of tududi or `examples/invoices` code had been read for this suite when this rule was saved. What was known: `SPEC.md`, the v1 suites and their selection (`../agent-suite/realapp/SELECTION.md`), and the file names in `examples/invoices`. No with-Lightpath result was read while designing (the D-147 re-score read only the stored pass/void counts).

## Size and where the bugs go

- 9 bugs: 4 real and 5 seeded. 7 are in tududi (4 real, 3 seeded) and 2 in `examples/invoices` (seeded). That is more than half in a larger real app, and at most 2 in invoices. None in `examples/shop`.
- If the walk below keeps only 3 real bugs, a 4th tududi seeded bug takes the 4th slot (still 9, 7 in tududi). If it keeps fewer than 3, the work stops and asks.

## Apps

- **tududi**, the newest commit on `main` when it is cloned for this suite (the SHA is recorded in `README.md`), so the real fixes can be as recent as possible. The v1 real-app harness already runs tududi on this machine; v2 uses a copy of it with its own pin and ports.
- **examples/invoices** at this repo's `main`, for the 2 small-app bugs.
- **Actual Budget is not used.** Reason: setup cost. It needs a second harness (a yarn build of the sync server, two processes, a budget file per check) that doesn't exist yet. Limit this leaves: Actual runs its budget engine in a Web Worker, which Lightpath doesn't trace (`docs/tested-apps.md`), so the suite doesn't test that gap.

## Real bugs (tududi)

1. **Source.** tududi's first-parent history on `main`, newest first, from the new pin back at most 300 commits.
2. **Candidate.** A commit whose subject marks it as a bug fix (starts with `fix`, `fix(...)`, `Fix`, `Fixed`, or a pull-request merge whose title does), or one whose subject reads `<area>: <what now works>` and that closes a `[BUG]` issue. Every candidate is listed in `CANDIDATES.md`, kept or dropped, with the step that dropped it.
3. **Excluded at once:** the 5 fixes the v1 suite uses (r01-r03, and v1's kept candidates #16 and #25, found by position in v1's walk, without opening v1's held-out zip).
4. **Kept** if all of these hold, checked in this order:
   - a. **User-reachable.** The fix changes app code under `backend/` or `frontend/` that runs when a user uses the UI. Dropped: changes only to tests, docs, CI, Docker, build config, dependencies, translations or migrations; MCP-only or API-client-only paths.
   - b. **A real user hits it in normal use.** Dropped: security hardening, outside services (email, Telegram, CalDAV, AI providers, push, iCal feeds), Postgres-only, performance-only, layout or colour only.
   - c. **Runtime-dependent.** The same feature works in the common case, and the bug shows only with some data, after some earlier action, in some order of actions, or because a value is misread between the frontend and the backend. The bug gets the one kind from `SPEC.md` (stale cache, stale state, data-dependent branch, interaction order, cross-layer misuse) that names what the fix corrects; if two fit, the first in that list. Dropped if none fits, or if the feature is wrong for every user every time.
   - d. **Re-introducible.** Reverting the whole fix commit applies to the pin with `git apply -R`. A test file of the fix that doesn't revert cleanly is deleted from the trial whole (as v1 did for r01). Any other file in the pin that names the issue or pull request number of the fix is listed, and the mention removed in `bug.patch`.
   - e. **Checkable.** A behavioural check tells the bug from a fix on a fresh database it fills itself, without outside services, in under 3 minutes: an API answer, or what the page shows. It must pass on any correct fix.
5. **Take the newest 4** that pass. Their fix date, pull request and issue are recorded.
6. **Never** keep or drop a candidate because of how easily text search would find it, how hard it seems, or whether Lightpath would help.

## Seeded bugs

1. **Kinds.** First the kinds the real bugs don't cover, in `SPEC.md` order. Then, for any slots left, the kinds in `SPEC.md` order from the first, skipping a kind that already has 2 bugs.
2. **App.** In that order, the first 3 seeded bugs go in tududi and the next 2 in invoices. If a kind has no place of its kind in its app (step 3 finds none), it swaps with the next seeded slot, and the swap is logged.
3. **Place.** For the kind, list every place in the app's user-reachable code where that kind of mistake can happen: for stale cache, every cache or memo the app keeps; for stale state, every piece of UI state an action should update; for a data-dependent branch, every branch on a value a user controls (empty, zero, boundary, null, date, time zone, currency); for interaction order, every pair of actions on the same data; for cross-layer misuse, every value whose unit, type or meaning crosses the API. Order the list by the app's main navigation (tududi: sidebar order from top; invoices: the page from top to bottom), and take the first place where a mistake of 1 to 5 lines gives a symptom a user sees in normal use and a check can tell. A file a real v2 bug or a v1 bug changes is skipped.
4. **The mistake** is the usual one for its kind: an invalidation left out, an old value kept, a boundary flipped, a unit or type mixed up, a step done in the wrong order. It adds no comment, renames nothing and moves no code; it reads as if it had been written that way.
5. Every place looked at and passed over is logged in `CANDIDATES.md` with the reason.

## Order and held out

- The list order is fixed: real R1-R4 (newest fix first), then seeded S1-S5 (in the order step 1 gives).
- **Held out: R2, S1 and S4** (3 of 9). With the app rule that is 1 real tududi bug, 1 seeded tududi bug and 1 invoices bug. The other 6 are visible.
- Held-out bugs go into a zip outside the repo; only its SHA-256 is committed. A file next to the zip lists them for the owner.

## Each bug

- `report.md`: what a user does and sees ("I click X and Y happens"), with no file, function, variable, route or error text, and no hint of where the code is. A real bug's report follows its issue's user description in plain words.
- `bug.patch` on the pin, `fix.patch` (the reference fix: the upstream fix for a real bug), `fix2.patch` where a second, different correct fix exists, `check.mjs` (hidden), `notes.md` (real or seeded, kind, source and dates, the user's steps, public or not).
- The check runs 3 times on the bug and 3 times on each fix; every result is recorded. A check that gives two answers on the same side is flaky: the bug is dropped and replaced by the same rule, and logged.
- Trial copies have no `.git` folder.

## Difficulty check (after the owner approves the list and the credits)

- One WITHOUT-Lightpath `kiro-cli` run per bug, with the v1 harness settings (`../agent-suite/SCORING.md`). Every result is recorded.
- Fixed now: a bug the agent fixes correctly in 3 steps or fewer is too easy and is replaced: a real bug by the next real candidate the walk keeps, a seeded bug by the next place on its kind's list. The replacement takes the same slot (and held-out status) and gets its own difficulty run. At most 2 replacements per slot; after that the slot is reported and the work asks.
- Nothing else is changed because of these runs.

## Amendments, made after candidates were seen (logged, not hidden)

These change the rule above after the walk had started. Each is a forced change, not a choice of bugs; the candidates it moved are named.

1. **Pin: the newest commit that runs on SQLite, not the newest commit.** tududi `main` was `bf46177e` (2026-11-03) when cloned. Two commits earlier, `e77dc529` ("drop SQLite support, PostgreSQL only for v2.0.0", 2026-11-02) made tududi need a PostgreSQL server, which this machine doesn't have and step e forbids ("without outside services"). Found when the app first failed to start, after the walk had kept 4 candidates. The pin is now `eda9aa60` (2026-10-31), the newest commit before it. Effect: candidates #1 to #4 are newer than the pin and drop out, among them `f34e4ced` (kept #1 under the old pin). The walk now starts at #5; every later decision stood as it was.
2. **Step d also means "the bugged app still builds".** `9b86d2a1` (kept #1 after amendment 1) reverts cleanly, but a later commit (`TodayPage.tsx`) uses the helper the fix added, so the reverted app doesn't compile, and a compile error would point the agent at the code. Found by `prove.mjs`, which now also requires the bugged app to typecheck. It is dropped at step d and the walk went on to the next keep (#101, `4f1ad075`). The held-out positions (R2) moved with the list: R2 is now `#92`.
3. **S1 moved file.** The first S1 place (the Inbox's own refresh, in `InboxItems.tsx`) is in a file the new R3 (`2f25cc97`) changes, so by step 3 of the seeded rule it is skipped; S1 took the next place on its list. No other seeded place changed.

4. **Two more keeps dropped when their checks were built.** `5f9d2a09` (backup restore keeps old feature settings on screen): at the pin a restore on SQLite empties the saved features on the server itself (the JSON-column fix came after the pin, in `bf46177e`), so no check can tell the bug from its fix; dropped at step e. `4f1ad075` (blank page when saved sidebar settings lack a views order): at the pin every new account saves the views order, so a user can't reach the gap in normal use; dropped at step b. Both found by running the checks, not by reading results of any agent.
5. **The walk kept only 2 real bugs.** After amendments 1, 2 and 4 the 300-commit walk from the pin ends with 2 keeps (`#92`, `#99`). The rule says: fewer than 3, stop and ask. The work stopped here; the question is in the pull request. Until it is answered, the 2 keeps are not assigned to slots, and the seeded slots S5 and S6 that depend on the real bugs' kinds are not final.

6. **The owner's spec amendment 1 (Phase D), rule written before any place for it was looked at.** Four bugs are required. Each is checked against the bugs already picked first; one that covers it exactly counts and nothing is added.
   - **X1, stale cache early return.** Covered if a picked bug returns a cached value early and the cache isn't refreshed after the data changes.
   - **X2, inverted comparator.** List every sort comparator in tududi's user-reachable frontend and backend code, ordered by the main navigation (the page that shows the sorted list). Skip `backend/modules/daily-plan/ranking.js` whole, because the public README demo (`scripts/demo-gif/bug.patch`) inverts a comparator there, and the files in the seeded skip list. Take the first comparator where swapping its two sides (or flipping ascending to descending) gives a wrong order a user sees in normal use, with no other change.
   - **X3, swallowed error in an async backend handler.** List tududi's async route handlers and the services they await, ordered by the main navigation of the page that calls them. Take the first where an error that ordinary data can cause (a validation or not-found error) can be swallowed by a mistake of 1 to 5 lines (a `catch` that answers success, or a promise that isn't awaited), so the user is told it worked when it didn't.
   - **X4, control (static).** In `examples/invoices`, from the top of the page down, the first element where a one-line static mistake (a CSS value, a class name, or a markup attribute) gives a visible layout defect that doesn't depend on data or actions. It is marked as the control. Tracing what ran gives no help with it by construction.
   - The public demo bugs are not reused, and a place whose bug would show the same symptom as a public demo bug is passed over and logged.
   - These are added after the list above as X1-X4 and are visible. The held-out positions (R2, S1, S4) don't change. Total stays at most 12.

7. **2 real bugs accepted (owner's credit-freeze directive, 2026-11-04).** The walk was not extended. The suite has 2 real bugs, below the spec's 3. R1 (`#92`) is visible v01, R2 (`#99`) is held out. Slots R3 and R4 are left empty, and the seeded list S1-S5 stays as picked before (S5 stays interaction order). X1 is covered by v05 (a cached copy returned early and not refreshed after a write). Final list: 10 bugs, 3 held out (R2, S1, S4).

Picked bugs that this suite does not use are kept, with their patches, in `lightpath-trials/goal/suite2-raw/dropped/`, outside the repo.
