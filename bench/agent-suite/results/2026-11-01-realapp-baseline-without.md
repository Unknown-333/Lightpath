# Real-app baseline (tududi), condition `without`, 2026-11-01

The agent without Lightpath fixed **15 of 15** valid trials: 3 visible bugs, 5 runs each. Mean 9.87 steps, 0.980 credits, about 7,743 tokens (estimated) and 45.2 s per run. One run was void (a harness crash after the agent stopped) and was rerun once. Like the shop, tududi's visible bugs are at the ceiling for the baseline, so Lightpath can't beat it on correct-fix rate here; it costs about 2 to 6 times the shop per run (table below).

**Read these numbers with two limits in mind.**

- tududi has only **3 visible bugs** (r01 to r03). The other 2 are held out and were not run here.
- **All 5 tududi fixes are public**, so the model may have seen them in training. The visible ones:
  - r01: commit [dd8e451](https://github.com/chrisvel/tududi/commit/dd8e4514d4f51835e920c1f92572a009fdf916a8), pull request [#1938](https://github.com/chrisvel/tududi/pull/1938), issue [#1932](https://github.com/chrisvel/tududi/issues/1932)
  - r02: commit [b659791](https://github.com/chrisvel/tududi/commit/b659791727c7962fb3a3e1f39515fed4e6ec6b7f), pull request [#1915](https://github.com/chrisvel/tududi/pull/1915), issue [#1914](https://github.com/chrisvel/tududi/issues/1914)
  - r03: commit [c628ea2](https://github.com/chrisvel/tududi/commit/c628ea21581c9a6204a452ef4ddc1c6915b056ec), pull request [#1865](https://github.com/chrisvel/tududi/pull/1865)
  - The 2 held-out fixes are public too (`../realapp/HELDOUT.md`; links in the held-out zip).

The trial copies have no `.git` folder, so the agent could not read the fix from `git log`. It could still know it from training.

## Setup

- kiro-cli 2.37.0 (V3 engine), model `claude-sonnet-5.5`, effort `medium`, 15-minute limit, rules from `../SCORING.md`. Every JSON line has the kiro-cli version, model ID, engine and effort.
- Suite: the lines say `suiteCommit` 27d2873 (the `agent-loop` head). `git diff 153b290 27d2873 -- bench/agent-suite` touches only `results/` (the trial run's two files), so this is the suite exactly as frozen in 153b290 (D-110 to D-112). No bug, check, scoring rule or harness file was changed.
- tududi `99ef6952`, API port 3402, web port 8402, trial copies with no `.git`. Template: the one built for the trial run (`_cache/tududi-99ef6952-1d293592`), reused unchanged.
- Data: `2026-11-01-realapp-baseline-without.jsonl`, 16 lines: 15 valid trials plus the void run. Transcripts, tool calls, diffs and check logs stay outside the repo at each line's `transcript` path.
- Ran 06:16 to 07:06 UTC, one trial at a time, in round-robin order (r01, r02, r03, then run 2, ...). Another worker ran browser tests on the shop ports at the same time.
- The trial run `r01-without-1` from the suite PR (`2026-11-01-realapp-trial.jsonl`) is not part of this baseline. These trials used a new trials folder, so its files were left as they were.

## Per bug (valid runs)

| Bug | Correct | Steps mean (min-max) | Steps SD | Credits mean (min-max) | Credits SD | Tokens est. mean (min-max) | Wall time mean (min-max) | Wall SD | Void |
| --- | ------- | -------------------- | -------- | ---------------------- | ---------- | -------------------------- | ------------------------ | ------- | ---- |
| r01 | 5 of 5  | 12.20 (11-15)        | 1.64     | 1.139 (1.025-1.380)    | 0.141      | 7,970 (5,291-12,698)       | 72.5 s (59.3-80.1)       | 8.6     | 0    |
| r02 | 5 of 5  | 11.40 (9-14)         | 2.07     | 1.287 (0.973-1.479)    | 0.189      | 11,628 (9,687-12,851)      | 38.1 s (31.4-45.3)       | 5.0     | 0    |
| r03 | 5 of 5  | 6.00 (5-7)           | 0.71     | 0.515 (0.476-0.592)    | 0.047      | 3,631 (3,135-4,565)        | 24.8 s (23.5-26.3)       | 1.1     | 1    |

## Totals

|                                                           |                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Correct                                                   | 15 of 15 valid runs                                                           |
| Void                                                      | 1 (r03-without-5, harness), rerun once as r03-without-6, which was valid      |
| Steps                                                     | 148 in total; mean 9.87, min 5, max 15, SD 3.20                               |
| Credits, valid runs                                       | 14.702 in total; mean 0.980, min 0.476, max 1.479, SD 0.369                   |
| Credits, all 16 runs (spent)                              | 15.296 (the void run cost 0.594)                                              |
| Tokens (estimated, D-111)                                 | 116,142 in total; mean 7,743, min 3,135, max 12,851, SD 3,766                 |
| Wall time                                                 | 677.3 s in total; mean 45.2 s, min 23.5 s, max 80.1 s, SD 21.5                |
| Blocked tool calls, flagged shell commands, outside reads | 0, 0, 0 in the 15 valid runs (the void run's line has no shell or path audit) |

No trial passed 1.5 credits (the stop was 3). This item: **15.296 credits** of its 22. Goal test-run total before this item: 12.299. After it: **27.595** of 100.

## Credits per run and running total

| #   | Trial         | Correct | Steps | Credits | Running total | Wall   | CPU start / end       | Busy | Tokens (est.) |
| --- | ------------- | ------- | ----- | ------- | ------------- | ------ | --------------------- | ---- | ------------- |
| 1   | r01-without-1 | yes     | 12    | 1.129   | 1.129         | 80.1 s | 20.8 -> 24.5% / 24.4% | yes  | 7,423         |
| 2   | r02-without-1 | yes     | 11    | 1.367   | 2.496         | 38.3 s | 16.1% / 19.4%         | no   | 12,851        |
| 3   | r03-without-1 | yes     | 7     | 0.517   | 3.014         | 25.0 s | 44.9 -> 8.9% / 35.5%  | no   | 3,225         |
| 4   | r01-without-2 | yes     | 11    | 1.052   | 4.066         | 78.5 s | 23 -> 45.1% / 39.1%   | yes  | 7,324         |
| 5   | r02-without-2 | yes     | 10    | 1.287   | 5.353         | 36.3 s | 48.8 -> 50% / 43.8%   | yes  | 11,824        |
| 6   | r03-without-2 | yes     | 6     | 0.592   | 5.944         | 26.3 s | 41.1 -> 32.9% / 47.1% | yes  | 4,565         |
| 7   | r01-without-3 | yes     | 12    | 1.106   | 7.050         | 68.5 s | 38.8 -> 52.3% / 47.4% | yes  | 5,291         |
| 8   | r02-without-3 | yes     | 13    | 1.327   | 8.377         | 39.5 s | 39.2 -> 36.4% / 32.2% | yes  | 12,228        |
| 9   | r03-without-3 | yes     | 6     | 0.476   | 8.853         | 25.3 s | 41.7 -> 40.9% / 34.9% | yes  | 4,019         |
| 10  | r01-without-4 | yes     | 15    | 1.380   | 10.234        | 76.0 s | 29.4 -> 46.7% / 44.2% | yes  | 12,698        |
| 11  | r02-without-4 | yes     | 9     | 0.973   | 11.207        | 31.4 s | 40.8 -> 26.3% / 32%   | yes  | 9,687         |
| 12  | r03-without-4 | yes     | 5     | 0.478   | 11.685        | 23.5 s | 40.7 -> 55.2% / 56.7% | yes  | 3,135         |
| 13  | r01-without-5 | yes     | 11    | 1.025   | 12.710        | 59.3 s | 20.9 -> 20.8% / 31.7% | yes  | 7,113         |
| 14  | r02-without-5 | yes     | 14    | 1.479   | 14.189        | 45.3 s | 32.7 -> 28.5% / 45%   | yes  | 11,549        |
| 15  | r03-without-5 | void    | 7     | 0.594   | 14.783        | 53.0 s | 35.2 -> ? / ?         | ?    | 3,525         |
| 16  | r03-without-6 | yes     | 6     | 0.513   | 15.296        | 24.0 s | 55.1 -> 40.3% / 49.9% | yes  | 3,210         |

"A -> B" means the load was over 20% at the start, the harness waited 60 s and read B. Busy = still over 20% after the wait. 13 of the 15 valid runs started in busy periods, because another worker's browser tests ran at the same time. Busy periods can slow wall time; steps, credits and tokens don't depend on the machine's load.

## The void run

`r03-without-5`: the agent finished normally (exit 0, 7 steps, 0.594 credits). Then `run.mjs` crashed while cleaning up the check: it could not delete the check's SQLite file (`EPERM` in `rmSync`, `realapp/lib/app.mjs` `runCheck`), so it exited 1 before scoring or writing the JSON line. That is a harness failure, so by `SCORING.md` the run is void and was rerun once (`r03-without-6`, valid, correct). After the crash both app ports were free and no process of the trial was left. Its JSON line was rebuilt from the run's saved transcript with the harness's own parsers and is marked `void: true`, `rebuiltBy`, `rerunBy`; the rerun's line has `rerunOf`. The other 15 trials had no such error. The harness was not changed.

## Both suites side by side (condition `without`)

| Suite                                | Runs (valid) | Fix rate | Steps mean | Credits mean | Tokens est. mean | Wall time mean | Fix public                |
| ------------------------------------ | ------------ | -------- | ---------- | ------------ | ---------------- | -------------- | ------------------------- |
| Shop (7 bugs, 3 runs each)           | 21           | 21 of 21 | 5.00       | 0.317        | 1,371            | 16.7 s         | no (seeded for the suite) |
| tududi (3 visible bugs, 5 runs each) | 15           | 15 of 15 | 9.87       | 0.980        | 7,743            | 45.2 s         | yes, all 5                |

Shop numbers are from `2026-11-01-baseline-without.jsonl` (its `.md` has the same values). tududi per run is about 2.0 times the shop's steps, 3.1 times its credits, 5.6 times its estimated tokens and 2.7 times its wall time. Shop runs mostly started in quiet periods; most tududi runs did not, so the time ratio is the least firm.

## What the agent did (from the transcripts)

No agent started tududi, opened the page or clicked anything. Every fix came from text search and reading files.

- r01 (daily task shows at midnight in Upcoming): searched for "recurring|recurrence", then for the virtual-occurrence functions, read `recurringTaskService.js` and `tasks/routes.js` (runs 1, 4 and 5 also read a timezone, serializer or grouping helper), and changed `recurringTaskService.js` (runs 1, 2, 3, 5) and `routes.js` (runs 1, 3, 4, 5). Every run then ran tududi's own jest tests for tasks. The most steps and the longest wall time of the three.
- r02 (subtask's "Set in progress" lost on reload): searched for the label "Set in progress", read `TaskStatusControl.tsx`, followed the subtask rows through several searches, and changed `frontend/components/Task/TaskRow/index.tsx` in all 5 runs. No test run; the most tokens of the three.
- r03 (Focus project menu lists finished projects): searched for the menu text "Any project", read `FocusPopover.tsx` and the project status values, and filtered out finished projects in `FocusPopover.tsx`. 5 to 7 steps.

The predictions in each `notes.md` were yes (r01), unsure (r02) and no (r03). The baseline fixed all three in every valid run. r01, the "yes" bug, took the most steps (mean 12.2).

## Notes

- Tokens are an estimate (D-111): characters / 4 of the prompt, tool results, agent messages, thoughts and tool inputs in each transcript, each counted once (`tokens.mjs`). It leaves out the system prompt, tool specs and the context re-sent on every request, so it is a lower bound. Credits are kiro-cli's own figure.
- Each diff also lists a new `.tsbuildinfo`; it comes from `tsc` runs (the harness's typecheck or the agent's tests), not from a code change.
- Raw driver logs, per-trial stdout and the stats script that printed every number above are outside the repo, in `C:\Users\user\lightpath-trials\goal\realapp-baseline-raw\` (`stats.txt`).
