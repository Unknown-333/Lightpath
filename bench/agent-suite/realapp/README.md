# Real-app suite: tududi

A second seeded-bug suite, on a real open-source app, scored by the same rules as the shop (`../SCORING.md`). The shop's fix rate is at the ceiling (21 of 21 without Lightpath), so this suite asks the same question on a codebase where text search has far more to wade through. The decision is D-110 in `decisions.md`.

- App: [chrisvel/tududi](https://github.com/chrisvel/tududi) at `99ef6952fcbdef463f2a59e3f3c8f13e9a1dd511` (2026-10-28): React 18 + webpack 5 frontend, Express 4 + Sequelize + SQLite backend, about 40 MB of source without `node_modules`.
- Bugs: 5 real bugs from tududi's own history, re-introduced by reverting their fix commits. 3 are here in `bugs/` (`r01`..`r03`), 2 are held out (`HELDOUT.md`). How they were picked, every candidate, and whether each fix is public: `SELECTION.md`.

## The bugs

| Bug | What the user sees                                   | Category                                | Layer                   | Check         | Fix public | Prediction: does knowing what ran help? |
| --- | ---------------------------------------------------- | --------------------------------------- | ----------------------- | ------------- | ---------- | --------------------------------------- |
| r01 | A daily task due 15:30 shows at midnight in Upcoming | wrong value built in a backend service  | backend (from Upcoming) | API           | yes        | yes                                     |
| r02 | A subtask's "Set in progress" is lost on reload      | event wiring: click handler never saves | frontend                | browser + API | yes        | unsure                                  |
| r03 | Focus's project menu lists finished projects         | missing condition in a frontend filter  | frontend                | browser       | yes        | no                                      |

Each `bugs/<id>/` has the same files as the shop: `bug.patch`, `report.md` (the agent's prompt, "I click X and Y happens", no file, function or error names), `check.mjs` (hidden), `fix.patch` (the upstream fix, applied on top of the bug) and `notes.md` (source, public or not, category, prediction).

## Commands

```sh
# Prove every bug: check fails on the bug, passes after fix.patch, tsc --noEmit passes after the fix
node bench/agent-suite/realapp/prove.mjs

# One trial (same harness and options as the shop, plus --suite realapp)
node bench/agent-suite/run.mjs --suite realapp --bug r01 --condition without --run 1
```

`LP_TRIALS_ROOT` sets where trials go (default `%TEMP%\lp-agent-trials`); it must not be inside a git repository. `LP_TUDUDI_SRC` points at an existing tududi clone; without it the harness clones tududi into the cache once.

## App-specific setup (the same in every condition)

| What                   | Value                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template               | `git archive` of the pinned commit plus `npm ci` (Node 24.13.0 here), built once and cached under `<trials>/_cache/`                                                                                                                                                                                             |
| Trial copy             | the template copied whole (including `node_modules`, about 1 GB, 21 s with robocopy), then `bug.patch`. **No `.git` folder** (owner's rule, 2026-11-01). A clean source copy of the same state is kept in `<trials>/_pristine/<trial>` and the agent's diff is computed against it                               |
| Start                  | `node dev.mjs`, added to the app root. It does what `npm start` does through bash (`scripts/start-all-dev.sh`, `backend/cmd/start-dev.sh`): prepare the database, run migrations, create the dev user, then start the API and `webpack serve`. tududi's own scripts need bash, which a Windows user may not have |
| Source maps            | `webpack serve --devtool eval-source-map` (webpack's default dev `devtool` has no maps; `docs/tested-apps.md`)                                                                                                                                                                                                   |
| Ports                  | API **3402**, web **8402** (`PORT`, `FRONTEND_PORT`, `BACKEND_URL`, `FRONTEND_URL` and `TUDUDI_ALLOWED_ORIGINS` set by `dev.mjs`). Not the shop's 3001/5173 or tududi's defaults 3002/8080                                                                                                                       |
| Dev user               | `dev@tududi.test` / `DevPass123!` (named in each `report.md`, as a teammate would tell you)                                                                                                                                                                                                                      |
| Database for the check | a fresh SQLite file per check, outside the trial (`<trials>/_db/`), deleted afterwards                                                                                                                                                                                                                           |
| "Still builds"         | `tsc --noEmit`, the typecheck step of tududi's own `npm run frontend:build`. The backend is JavaScript; the check starts it, so a backend that doesn't load fails the check                                                                                                                                      |
| Time limit             | 15 minutes, the same as the shop                                                                                                                                                                                                                                                                                 |
| Checks                 | Node `fetch` for the API (logs in, sends the CSRF token) and the repo's `playwright-core` for the browser, headless, service workers blocked                                                                                                                                                                     |

Scoring, runs per bug, void rules and reporting are `../SCORING.md`, unchanged. The cleanup rule is the shop's, on the app ports: kill only what names the trial folder, or holds an app port and started after the trial began.

## Limits

- The fixes are public (commits, pull requests and user issues on GitHub), so the model may know them from training. `SELECTION.md` lists each; results report it next to each bug.
- `bug.patch` reverts the whole fix commit, tests included. For r03 that also removes a search box the same commit added; the check tests only the finished-projects part.
- Copying `node_modules` per trial keeps trials apart (an agent's `npm install` can't change another trial), at about 1 GB per trial folder.
