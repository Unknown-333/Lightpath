# Suite v2 difficulty check, 2026-11-04

One WITHOUT-Lightpath kiro-cli run per bug, `run.mjs --suite v2 --max-steps 6` (the harness stops kiro-cli when a 7th tool call starts; "steps" in the raw lines then reads 7 or 8). Not fixed within 6 steps = not fixed. No retries, no void runs. Raw lines: `2026-11-04-difficulty-without.jsonl` (visible bugs; held-out lines are in the held-out zip folder).

| Bug | Fixed in 6 steps | Steps   | Stopped at cap | Check after run | Credits       | Tokens est. |
| --- | ---------------- | ------- | -------------- | --------------- | ------------- | ----------- |
| h01 | no               | 6 (cap) | yes            | fail            | ~0.492 (est.) | 3560        |
| h02 | no               | 6 (cap) | yes            | fail            | ~0.848 (est.) | 6140        |
| h03 | yes              | 5       | no             | pass            | 0.377         | 2790        |
| v01 | no               | 6 (cap) | yes            | fail            | ~0.436 (est.) | 3157        |
| v02 | no               | 6 (cap) | yes            | fail            | ~0.705 (est.) | 5106        |
| v03 | no               | 6 (cap) | yes            | fail            | ~0.708 (est.) | 5129        |
| v04 | no               | 6 (cap) | yes            | pass            | ~0.931 (est.) | 6738        |
| v05 | yes              | 3       | no             | pass            | 0.366         | 3086        |
| v06 | yes              | 4       | no             | pass            | 0.340         | 2287        |
| v07 | yes              | 6       | no             | pass            | 0.698         | 4803        |
| v08 | no               | 6 (cap) | yes            | fail            | ~0.701 (est.) | 5078        |
| v09 | yes              | 5       | no             | pass            | 0.400         | 2829        |

Total credits: 7.00 (2.182 reported by kiro-cli, ~4.82 estimated for the 7 runs stopped at the cap, from their tokens at the reported runs' 1.381e-4 credits per estimated token). Void runs: 0. Model claude-sonnet-5.5, kiro-cli kiro-cli 2.37.0.

- Fixed in 6 steps: 5 of 12 (v05, v06, v07, v09, h03). Not fixed: 7 (v01, v02, v03, v04, v08, h01, h02). v04's check passed only because the agent's 7th and 8th calls ran before the stop; by the rule it is not fixed.
- Too easy by SPEC.md (fixed correctly in 3 steps or fewer): **v05** only. Not replaced here (the decision allowed no further runs); it is listed for the lead.
- The 4 real bugs (v01, v02, v03, h01) all went unfixed within 6 steps.

## Draft decision rule for Step 4 (for the lead's review)

Per bug, 3 WITHOUT and 3 WITH runs (same cap, same model). A bug is solved in a condition when at least 2 of its 3 runs are fixed.
- **Win** for Lightpath: solved WITH and not WITHOUT, or both solved and WITH's mean steps are at least 2 lower.
- **Loss**: solved WITHOUT and not WITH, or both solved and WITH's mean steps are at least 2 higher.
- **No difference**: anything else.
- Headline: wins minus losses over the 11 non-control bugs; the control (v09) must not be a loss. Credits and tokens are reported next to it, never folded into it.
- Bugs the baseline already solves in this check (v05, v06, v07, v09, h03) stay in and count only through steps, since a fix-rate win is impossible on them; v05 (too easy) is reported but left out of the headline unless the lead replaces it first.
