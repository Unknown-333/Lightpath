# Spec: harder bug suite v2 (written by the lead, 2026-11-04)

This is the written spec the owner asked for. A separate session writes the bugs from it. That session must not be the one that builds the Step 1 features (item 10, the source lines in traces, and item 6, the one-call fix check), and must not look at any with-Lightpath result while designing.

## Why this suite exists

The 2026-11-03 benchmark gave no fix-rate win, because the agent without Lightpath already fixed nearly everything (shop 21 of 21, tududi 15 of 15). Text search found every bug. This suite tests whether Lightpath helps where reading the code is genuinely hard. It must stay fair: realistic bugs a user could hit, not bugs built to be unfindable without Lightpath.

## Size

- 8 to 10 bugs in total, of which 2 or 3 are held out.
- Held-out bugs go in a zip outside the repo. Only its SHA-256 is committed. The lead never opens it. The owner may review it.

## What the bugs are

Every bug is a runtime-dependent kind. Cover each of these at least once:

1. Stale cache: a cached value isn't cleared after the data changes.
2. Stale state: UI state (React state, a store, a memo) keeps an old value after an action.
3. Data-dependent branch: the wrong branch runs only for some data (an empty list, a boundary value, a null, a time zone, a currency).
4. Interaction order: the bug shows only when actions happen in a certain order (edit then filter, undo then save, two quick clicks).
5. Cross-layer misuse: a value computed in one layer is misused in another (the server sends cents and the client shows dollars, an id sent as a string compared as a number, a flag inverted between API and UI).

Apps:

- At least half of the bugs are in a larger real app. Use apps Lightpath has already run on (`docs/tested-apps.md`): Actual Budget and tududi are the first choices. Small examples (`examples/invoices`) may hold at most 2 bugs. Do not use `examples/shop`: it is the old suite.
- 3 to 5 bugs are real: taken from real issues and their fixes in those apps, with the fix reverted in the trial copy. Prefer issues whose fix was merged as recently as possible, so the model is less likely to have seen it. The model's training cutoff isn't published, so record each real bug's fix date and link, and report them next to the results. The rest are seeded: planted on purpose, of a realistic kind.
- Mark every bug as real or seeded in the suite files.

## How each bug is written

- The task text reads like a user's report: "I click X and Y happens", or "after I do A then B, the total is wrong". No file, function, variable or error-message names. No hint about where the code is.
- Each bug comes with:
  - the patch that plants it (seeded) or reverts the real fix (real), on a pinned app commit;
  - a reference fix;
  - a hidden check that fails before the fix and passes after it. The check tests behaviour (what the user sees, or the API answer), not the exact lines of the fix, so another correct fix also passes. Show the check failing on the planted copy and passing with the reference fix, and where you can, passing with a second, different correct fix;
  - the steps a user takes to see it.
- Trial copies have no `.git` folder.
- The check must be stable: run it 3 times on each side and record all results. A flaky check is dropped and logged.

## Fairness

- Write down how you pick bugs before you look at candidates, and log every candidate you rejected and why.
- Don't choose bugs because grep can't find them. Choose them because they are a realistic kind from the list above.
- Difficulty check (allowed by the owner): run the WITHOUT-Lightpath agent once per bug. Record that you did, and every result. Only with the owner's credit approval. The rule for using those results is fixed now, before any run: a bug the without agent fixes correctly in 3 steps or fewer is too easy and gets replaced. Every replacement is logged. Nothing else is changed because of those runs.
- Never run, read or look at any WITH-Lightpath result while designing.

## Scoring

- Same scoring as `bench/agent-suite/SCORING.md`, copied to the v2 suite.
- First fix the known void-check flaw: it flagged paths like `/c:/...` that are inside the trial, and `require('../utils')` text inside an edit command, as reads outside the trial. Write the D-entry first (it changes scoring after results exist). Then re-score the 2026-11-03 and 2026-11-01 results from their saved data, without re-running anything, and report the old and new numbers side by side.
- Once the bugs and the scoring are written, the owner has reviewed the bug list, and the difficulty check is done, commit them and do not edit them again.

## Order

1. Void-check fix, D-entry, re-score report.
2. Picking method written down. Candidates found and logged.
3. Bugs written, checks proven, held-out zip made.
4. Stop and report `question`: the bug list for the owner's review (visible bugs in the PR body; held-out bugs in a file next to the zip that the owner opens). Wait.
5. After the owner approves the list and the credits: the difficulty check. Replace too-easy bugs by the rule above.
6. Freeze: commit, record the hashes. Report `done`.

## Not in this item

- No with-Lightpath runs. No arm 2 or arm 3 runs. No Lightpath feature code.
- No changes to the old suite's bugs or results, except the re-scoring report.
