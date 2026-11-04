# Suite v2: harder, runtime-dependent bugs

Spec: `SPEC.md` (with the owner's amendment 1). Pick rule and amendments: `SELECTION.md`. Every candidate: `CANDIDATES.md`. Scoring: `SCORING.md` (v1's, plus the v2 lines and the hallucinated-edit proposal).

- Apps: tududi at `eda9aa60b16ce657a08b47d1894f5c27bf098586` (2026-10-31, the newest commit that runs on SQLite), ports 3611/8611; `examples/invoices` from this repo, ports 3612/5612. Trials have no `.git`.
- 10 bugs: 7 visible (below), 3 held out (`HELDOUT.md`). 2 are real (spec wants 3-5; SELECTION.md amendment 7).

| Bug | App      | Real or seeded                                                                                 | Kind                                       | What the user sees                                  | Fix public |
| --- | -------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------- | ---------- |
| v01 | tududi   | real (`8d0dda4e`, [PR #1756](https://github.com/chrisvel/tududi/pull/1756), merged 2026-10-01) | data-dependent branch                      | my comments are signed "Unknown"                    | yes        |
| v04 | tududi   | seeded                                                                                         | cross-layer misuse                         | "tomorrow" in an old inbox item means the wrong day | no         |
| v05 | tududi   | seeded                                                                                         | stale cache (also X1: cached early return) | "One item per line" doesn't stay on                 | no         |
| v06 | invoices | seeded                                                                                         | interaction order                          | paying from the Open tab hides other invoices       | no         |
| v07 | tududi   | seeded                                                                                         | X2: inverted comparator                    | Today lists my day backwards                        | no         |
| v08 | tududi   | seeded                                                                                         | X3: swallowed async error                  | Inbox says "Item updated" when nothing changed      | no         |
| v09 | invoices | seeded                                                                                         | X4: **control**, static layout             | the invoices are squeezed into a strip              | no         |

```sh
# Prove every bug: check fails on the bug, passes after fix.patch (and fix2.patch), 2 runs each
node bench/agent-suite-v2/prove.mjs --runs 2
# Difficulty check (only after the owner approves): one capped without-run per bug
node bench/agent-suite/run.mjs --suite v2 --bug v01 --condition without --run 1 --max-steps 6
```
