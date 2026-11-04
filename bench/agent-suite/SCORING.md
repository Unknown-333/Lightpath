# Scoring rules for the seeded-bug suite

Written and committed before any Lightpath feature and before any baseline run (D-108). After this commit, bugs and scoring are not edited to help results. If a bug or a rule turns out to be flawed, the flaw goes in `decisions.md` with the numbers before and after the change, and both sets of numbers are reported.

## What one run is

One trial is a (bug, condition, run number). `run.mjs` copies the shop to a fresh folder outside the repo, applies the bug, makes one git commit, and runs the pinned agent on the bug's `report.md` with a 15-minute limit. The conditions are:

| Condition | What the agent has                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| `without` | kiro-cli's built-in tools only (the baseline)                                                                    |
| `with`    | the same, plus the Lightpath MCP server (packed from the branch under test) and the Lightpath agent instructions |
| `browser` | the same as `without`, plus Chrome DevTools MCP, so Lightpath can be compared fairly with plain browser access   |

Every condition gets the same model, effort, prompt, tools, deny rules and time limit. The `without` baseline is never changed to make it worse.

## A correct fix

A run is **correct** when all three hold after the agent stops:

1. The bug's hidden check (`bugs/<id>/check.mjs`) passes. The check tests behaviour (API responses, rendered text), so any correct fix passes, not only the reference fix.
2. The shop still typechecks (`npm run typecheck` in the trial folder, which is `tsc -p .`).
3. The check was not touched. It lives in the suite, outside the trial folder; `run.mjs` hashes the bug folder before and after the run and requires the hashes to match.

Anything else is **not correct**, including a run where the agent says it fixed the bug but the check fails, and a run where the agent stops to ask a question.

## Metrics per run

| Metric            | Source                                                                                                                                                                                                                                                     |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| correct           | yes or no, as above                                                                                                                                                                                                                                        |
| steps             | number of tool calls in the transcript                                                                                                                                                                                                                     |
| tokens in and out | kiro-cli 2.37 does not report tokens in `stream-json`. We record **credits** instead (the `turn_completion` usage kiro-cli reports), plus the largest context-window use in percent. Results say "credits", never "tokens", until kiro-cli exposes tokens. |
| wall time         | from starting kiro-cli to its exit, in seconds                                                                                                                                                                                                             |

Each run's JSON line also keeps the transcript path, the agent's diff, the check's message, the CPU load at the start and end, blocked tool calls, and any flagged shell commands.

## How runs are reported

- 3 runs per bug per condition.
- Report every run, then per bug and condition the mean and the spread (minimum to maximum, and standard deviation for steps, credits and time). Correct-fix rate is reported as correct runs out of valid runs.
- Never report only the best run.
- The 3 held-out bugs (`HELDOUT.md`) run once, at the end, with the same rules.

## Void runs

A run is **void** when:

- the harness failed (kiro-cli didn't start or exited with an error, a process the harness didn't start held a shop port, or a setup step failed),
- the agent hit the 15-minute limit, or
- the transcript shows the agent reading files outside its trial folder (a tool call that names a path outside it, or a shell command with an absolute path outside it or a `..` that leaves it). The check is conservative; each hit is listed in the run's `outsidePaths` for review.

  Amended by D-147 (2026-11-04, after results existed; both numbers are in `results/2026-11-04-rescore-d147.md`): a path in URL form (`/c:/x`, `file:///c:/x`) is read as the drive path it names, and a `..` path inside a shell command's text counts only if the place it resolves to exists on disk when the run is scored, so a module path written into a file (`require('../utils')`) is not a read. Each hit these two rules drop is kept in the run's `ignoredOutsidePaths` for review. The code is `lib/outside.mjs`.

A void run is rerun once. The number of void runs is reported per condition. A rerun that is void again is reported as void and counted as not correct.

## Fixed now, before results

- Model `claude-sonnet-5.5`, effort `medium`, kiro-cli 2.37.0 (recorded per run).
- The prompt is `report.md` plus one line: "Work only inside this folder, and don't stop processes you didn't start."
- Bugs, reports, checks, reference fixes and these rules as of this commit.
