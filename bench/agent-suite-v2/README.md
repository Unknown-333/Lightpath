# Suite v2: harder, runtime-dependent bugs

Spec: `SPEC.md` (with the owner's amendment 1). Pick rule and amendments: `SELECTION.md`. Every candidate: `CANDIDATES.md`. Scoring: `SCORING.md` (v1's, plus the v2 lines and the hallucinated-edit proposal).

- Apps: tududi at `eda9aa60b16ce657a08b47d1894f5c27bf098586` (2026-10-31, the newest commit that runs on SQLite), ports 3611/8611; Actual Budget at `502e61ef38bb1a4301239c2af10868dad439389f` (2026-11-04, browser mode), port 8613; `examples/invoices` from this repo, ports 3612/5612. Trials have no `.git`.
- 12 bugs: 9 visible (below), 3 held out (`HELDOUT.md`). 4 are real (1 held out).

| Bug | App      | Real or seeded                                                                                     | Kind                                       | What the user sees                                  | Fix public |
| --- | -------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- | ---------- |
| v01 | tududi   | real (`8d0dda4e`, [PR #1756](https://github.com/chrisvel/tududi/pull/1756), merged 2026-10-01)     | data-dependent branch                      | my comments are signed "Unknown"                    | yes        |
| v02 | actual   | real (`821bcc2a`, [PR #9402](https://github.com/actualbudget/actual/pull/9402), merged 2026-11-03) | data-dependent branch                      | my custom report lists a category I unchecked       | yes        |
| v03 | actual   | real (`8e6eb272`, [PR #9173](https://github.com/actualbudget/actual/pull/9173), merged 2026-10-30) | interaction order                          | editing a schedule undoes my skipped date           | yes        |
| v04 | tududi   | seeded                                                                                             | cross-layer misuse                         | "tomorrow" in an old inbox item means the wrong day | no         |
| v05 | tududi   | seeded                                                                                             | stale cache (also X1: cached early return) | "One item per line" doesn't stay on                 | no         |
| v06 | invoices | seeded                                                                                             | interaction order                          | paying from the Open tab hides other invoices       | no         |
| v07 | tududi   | seeded                                                                                             | X2: inverted comparator                    | Today lists my day backwards                        | no         |
| v08 | tududi   | seeded                                                                                             | X3: swallowed async error                  | Inbox says "Item updated" when nothing changed      | no         |
| v09 | invoices | seeded                                                                                             | X4: **control**, static layout             | the invoices are squeezed into a strip              | no         |

```sh
# Prove every bug: check fails on the bug, passes after fix.patch (and fix2.patch), 3 runs each (LP_ACTUAL_SRC = an Actual clone)
node bench/agent-suite-v2/prove.mjs --runs 3
# Difficulty check (only after the owner approves): one capped without-run per bug
node bench/agent-suite/run.mjs --suite v2 --bug v01 --condition without --run 1 --max-steps 6
```
