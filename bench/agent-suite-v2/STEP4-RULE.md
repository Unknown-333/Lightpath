# Suite v2, Step 4: pre-registered decision rule

Written and pushed before any Step 4 run. It is the draft rule from `results/2026-11-04-difficulty.md`, changed only where the lead's decision says (round 13).

## Fixed setup

- 12 bugs: v01 to v09 and the 3 held-out bugs h01 to h03 (held-out bugs only through the harness, from the held-out zip, with `--bugs-dir`).
- Per bug: 3 `without` and 3 `with` runs, 72 runs in all. Order per bug: without 1, with 1, without 2, with 2, without 3, with 3.
- Step cap **12**: `run.mjs --suite v2 --max-steps 12`. The harness stops kiro-cli when a 13th tool call starts. Not fixed within 12 steps = not correct; such a run is not void and is not rerun.
- Model `claude-sonnet-5.5`, effort `medium`, kiro-cli 2.37.0, same prompt, tools and deny rules in both conditions (SCORING.md).
- Lightpath (the `with` condition) = the workspace build of main at `9e86616ea7cc` (Lightpath 0.1.2), packed by `run.mjs` (D-130). Each run records the commit.
- Hard spend cap: 120 test credits. Runs stopped at the step cap report no credits; their credits are estimated from their tokens at the reported runs' credits per estimated token, as in the difficulty check. If the next run could pass the cap, the runs stop and this is reported.

## Harness change before any run (backend wait)

`lightpath dev` can open the page before the app's API listens (item it_eaec2cc9). The page's first data request then fails and the page shows no data. The no-agent dry run showed it on invoices: `run_action` answered `not_found` for `button "Mark as paid"` within `INV-2042`.

So in the `with` condition, after `lightpath dev` says "watching", `run.mjs` waits for the app's API (tududi `/api/version`, invoices `/api/invoices`). If the API was not answering when the page opened, it re-saves the page's HTML file unchanged (tududi `public/index.html`, invoices `index.html`), so the dev server reloads the page, and waits 8 s. The run records this in `backendWait`. The `without` condition starts no app, so it has nothing to wait for. The file's content does not change, so the agent's diff is unchanged.

Dry run after the change (no agent, no credits): tududi and invoices `run_action` returned a trace. Actual (v02, v03) still answered `not_found` for `button "Try the demo"`, also 30 s later. **Open before any run:** this is checked and fixed or explained here before Step 4 starts.

## Void runs (defined before running)

As SCORING.md: the harness failed (kiro-cli didn't start or exited with an error, a process the harness didn't start held an app port, a setup step failed), the 15-minute limit, or a read outside the trial folder (D-147). For `with`, a setup failure also covers `lightpath init` or `lightpath dev` failing, or the backend wait timing out (120 s). A void run is rerun once; a rerun that is void again counts as not correct. Every void run is reported.

## Scoring

A bug is **solved** in a condition when at least 2 of its 3 runs are correct.

- **Win** for Lightpath: solved `with` and not `without`, or both solved and `with`'s mean steps are at least 2 lower.
- **Loss**: solved `without` and not `with`, or both solved and `with`'s mean steps are at least 2 higher.
- **No difference**: anything else.
- **Headline**: wins minus losses over the 10 non-control bugs other than v05. v09 (the control, static layout) must not be a loss. v05 (too easy in the difficulty check) is reported but left out of the headline.
- Credits and tokens are reported next to the headline, never folded into it.
- Also reported: how often `with` runs called Lightpath tools, per tool.

## Limits stated with the result

12 bugs, one model, one agent (kiro-cli), Windows only, 3 runs per bug per condition. The 4 real bugs' fixes are public, so the model may have seen them.
