# Real-app suite, one trial run, 2026-11-01

The owner asked for one trial run on the real app before any other, to see its cost. The agent without Lightpath fixed **r01** in its one run: correct, 14 steps, **1.274 credits**, about 9,164 tokens (estimated, D-111), 82 s. That is 4.0 times the shop baseline's mean credits per run and 6.7 times its estimated tokens.

- Setup: kiro-cli 2.37.0 (V3 engine), model `claude-sonnet-5.5`, effort `medium`, 15-minute limit, `SCORING.md`, with `--trust-workspace --require-mcp-startup` (D-112). Suite commit `153b290` (the frozen suite, D-110). tududi `99ef6952`, API 3402, web 8402, trial copy with no `.git`.
- Data: `2026-11-01-realapp-trial.jsonl`, one line. The transcript, tool calls, diff and check log stay outside the repo at the `transcript` path in the line.
- Ran 05:37 to 05:40 UTC, including a template rebuild before the agent started. CPU 16.9% at the start, 8.9% at the end; not busy. Other workers were running.

## Both suites side by side (condition `without`)

| Suite                 | Runs | Correct  | Steps mean (min-max) | Credits mean (min-max) | Tokens est. mean (min-max) | Wall time mean (min-max) | Fix public                                                                                                                 |
| --------------------- | ---- | -------- | -------------------- | ---------------------- | -------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Shop (7 bugs, 3 each) | 21   | 21 of 21 | 5.00 (3-10)          | 0.317 (0.213-0.564)    | 1,371 (673-2,138)          | 16.7 s (12.7-22.5)       | no (seeded for the suite)                                                                                                  |
| tududi r01 (trial)    | 1    | 1 of 1   | 14                   | 1.274                  | 9,164                      | 82.1 s                   | yes ([#1938](https://github.com/chrisvel/tududi/pull/1938), issue [#1932](https://github.com/chrisvel/tududi/issues/1932)) |

One run is not a baseline; the real-app numbers have no spread yet.

## What the agent did

It searched for "recurring|occurrence|virtual", found and read the recurrence service and the tasks routes, searched for the due-date response helpers, edited the recurrence service twice and the routes file once, and ran tududi's own jest tests for recurring tasks. It never started the app or opened the page. The check passed (Upcoming shows the series on 7 days, all at 15:30) and `tsc --noEmit` passed. No blocked calls, flagged shell commands or reads outside the folder.

The diff lists a new `.tsbuildinfo`: that file comes from tsc runs (the agent's tests or the harness's own typecheck), not from a code change.

## Credits

| Item                                        | Credits      |
| ------------------------------------------- | ------------ |
| Tool-list probes for D-112 (2 runs)         | 0.201        |
| This trial run                              | 1.274        |
| This item in total                          | 1.475        |
| Goal total before this item                 | 10.009       |
| Goal total after this item (this item only) | 11.484 of 65 |

The run cost under the 2-credit stop. At this cost, a full real-app round (3 visible bugs, 3 runs, one condition) would be about 9 runs, about 11.5 credits, if r01 is typical; it may not be.
