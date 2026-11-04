# The run behind the README GIF

`docs/media/tududi-demo.gif` is drawn from one real kiro-cli run on a local copy of [tududi](https://github.com/chrisvel/tududi), saved here in full (D-138). Nothing in it was typed in by hand or filmed from the screen.

tududi is an open-source, self-hosted task manager (React 18 + webpack in the browser, Express 4 + Sequelize/SQLite on the server). It is MIT-licensed, © Tududi Developers; the licence allows showing and modifying it. The copy was tududi at commit `99ef6952`, the same one the real-app benchmark uses (D-110), without its `.git` folder. tududi's code is not in this repo; only the patch that planted the bug is.

| What                  | Value                                                                                                                      |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Date                  | 2026-11-04, 04:07 UTC                                                                                                      |
| Agent                 | kiro-cli 2.37.0, model `claude-sonnet-5.5`, effort `medium`                                                                |
| App                   | tududi `99ef6952` with one planted bug (`bug.patch`), ports 3412 (API) and 8412 (web)                                      |
| Lightpath             | this repo's build at commit `a34077c` (0.1.0), set up with `lightpath init --agent kiro` (`init.out`)                      |
| Steps (tool calls)    | 6: Tool Load, `run_action` ×3, Read File, Replace in File                                                                  |
| Credits               | 0.678 (kiro-cli's own figure)                                                                                              |
| Tokens, estimated     | 6,652 (transcript characters / 4, D-111; a lower bound)                                                                    |
| Agent time            | 31.5 s                                                                                                                     |
| CPU load, start / end | 8.5% / 4.3%                                                                                                                |
| Result                | the agent swapped the priority comparison back (`agent-fix.diff`). It said it had not confirmed the fix in the running app |

All of these come from `run.json`.

## The bug

`bug.patch` swaps `a` and `b` in one priority comparison in `orderCandidates` (`backend/modules/daily-plan/ranking.js`). The "Plan your day" list then puts low-priority tasks first. A user would report it as the prompt does: "I click Plan your day and my high-priority task comes last." tududi doesn't have this bug; it was made up for the demo, not taken from tududi's history. The prompt names no file or function, only what the user sees.

## What the run did

1. `run_action` with `button "Plan your day"`: failed, `not_found`. It is a link, and the answer listed `link "Plan your day"` first among the closest targets.
2. `run_action` with `link "Plan your day"`: the trace. `GET /api/daily-plan/candidates` ran `ranking.js` and `service.js` on the server, among 9 server files.
3. It read `ranking.js` and swapped the comparison back.
4. `run_action` with `link "Plan your day"` again, to check: failed, `not_found`, because the page was already on the plan. The agent said so, and said it had not checked the fix.

The server runs under plain `node`, so it doesn't reload on a file change. To get the "after" picture, `record-tududi.mjs --after` started the same copy again, added the same five tasks and clicked "Plan your day" by script (`after.json`, `after.jpg`). That is the recording script, not the agent, and the GIF says so.

## The files

| File                      | What it is                                                                                                        |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `transcript.jsonl`        | kiro-cli's `--output-format stream-json` output, line by line                                                     |
| `timing.json`             | when each transcript line arrived (ms since 1970), same order                                                     |
| `frames/`                 | the screencast of Lightpath's own browser (headless Chrome) during the run, through Playwright's DevTools session |
| `frames.json`             | when each frame arrived                                                                                           |
| `run.json`                | prompt, flags, version, model, credits, steps, tokens, CPU load, the tasks added before the run                   |
| `bug.patch`               | the planted bug (same as `scripts/demo-gif/bug.patch`)                                                            |
| `agent-fix.diff`          | what the agent changed                                                                                            |
| `after.json`, `after.jpg` | the list after the fix, from the scripted click                                                                   |
| `init.out`                | what `lightpath init --agent kiro` printed in the copy                                                            |
| `gif-text.json`           | every line of text the GIF shows, as `render-gif.mjs` cut it from the transcript                                  |

## What the GIF leaves out or shortens

- Time: the run took 31.5 s; the GIF is 19.7 s, with a fixed length per scene.
- The two failed `run_action` calls and the Tool Load step. The caption's "6 tool calls" counts them.
- The trace: the GIF shows the request, 3 of the 16 functions listed for `ranking.js` (the first two and the one the agent edited, highlighted), the widest function of the next server file, and the first two browser files after the response. It gives counts for the rest. The highlight marks the function that holds the edited line; the trace itself shows that function ran, not where its bug is. The full answer is in `transcript.jsonl`.
- The agent's words: the first sentence of its note after the trace, of its "cause" paragraph and of its answer.

## Redo it

Needs Node 22.12+, Chrome, pnpm, git, and kiro-cli signed in. A run costs Kiro credits (this one: 0.678). The first run clones tududi and runs `npm ci` (a few minutes).

```sh
corepack pnpm install
corepack pnpm build
LP_KIRO_CLI=<path to kiro-cli> LP_TRIALS_ROOT=<folder outside any git repo> node scripts/demo-gif/record-tududi.mjs --out <new folder>
LP_TRIALS_ROOT=<same folder> node scripts/demo-gif/record-tududi.mjs --out <that folder> --after
node scripts/demo-gif/render-gif.mjs --run <that folder> --gif docs/media/tududi-demo.gif
```

`--no-agent` checks the setup without kiro-cli. To redraw the GIF from this run: `node scripts/demo-gif/render-gif.mjs --run docs/media/tududi-run`.

A new run is a new sample: the agent may take other steps.
