# Held-out real-app bugs

Two of the five tududi bugs are not in the repo, so nobody tunes Lightpath, its tool descriptions or its agent instructions against them. They sit in `heldout-realapp.zip` outside the repo, in the same layout as `bugs/` (`bug.patch`, `report.md`, `check.mjs`, `fix.patch`, `notes.md` per bug), with predictions written before any run, plus their proof output and `SELECTION-full.md` (the selection table with their two rows filled in, and their public links).

|            |                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| File       | `heldout-realapp.zip` (kept by the lead, outside the repo)                                                                          |
| SHA-256    | `fb0d6b0f2e6d7754a18221617f7fb791eed5a2572bf651ae078a57b201aed7d3`                                                                  |
| Size       | 16,549 bytes                                                                                                                        |
| Bugs       | 2 (numbers 2 and 4 of the 5 the selection rule kept, `SELECTION.md`)                                                                |
| Fix public | 2 of 2 yes (a public commit, pull request and user issue each), so the model may know them from training                            |
| Proven     | each check fails on its bugged app and passes after its `fix.patch`; `tsc --noEmit` passes after each fix (`prove.mjs`, 2026-11-01) |

Categories:

1. Frontend state reset to the wrong value after a save (frontend only).
2. Wrong text encoding at an upload boundary (backend, reached from an upload in the UI).

## Rules

The shop's held-out rules (`../HELDOUT.md`) apply unchanged: they run once, at the end, 3 runs per condition, scored by `SCORING.md`; check the zip's SHA-256 first and don't run on a mismatch; their content isn't pasted anywhere before that run. To run them, extract the zip outside the repo and pass `--suite realapp --bugs-dir <folder>/bugs` to `run.mjs` (and `--bugs-dir` to `realapp/prove.mjs`).
