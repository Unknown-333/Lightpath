# Held-out bugs

Three more seeded bugs exist but are not in the repo, so nobody tunes Lightpath, its tool descriptions or its agent instructions against them. They sit in `heldout.zip` outside the repo, in the same layout as `bugs/` (`bug.patch`, `report.md`, `check.mjs`, `fix.patch`, `notes.md` per bug), with predictions written before any run.

|         |                                                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| File    | `heldout.zip` (kept by the lead, outside the repo)                                                                                 |
| SHA-256 | `df9b1d95b622775cdbfe8d1d446a86039f8ae265aa13b68a3d05243df0936ece`                                                                 |
| Size    | 6,104 bytes                                                                                                                        |
| Bugs    | 3                                                                                                                                  |
| Proven  | each check fails on its bugged shop and passes after its `fix.patch`; the shop typechecks after each fix (`prove.mjs`, 2026-11-01) |

Categories:

1. Wrong endpoint between `src/api.ts` and the server (across the boundary).
2. Shared state: an update changes a copy instead of the stored object (backend only).
3. Wrong branch or condition (backend only).

## Rules

- They run **once, at the end**: after the build-measure loop is finished and frozen, 3 runs per condition, scored by `SCORING.md`.
- Before they run, check the zip's SHA-256 against the value above. A mismatch means the set changed; report it and don't run.
- Their content isn't pasted into any report, PR, commit message or work report before that run.
- To run them: extract the zip to a folder outside the repo and pass `--bugs-dir <folder>/bugs` to `run.mjs` (and `prove.mjs`).
