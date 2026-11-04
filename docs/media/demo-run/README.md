# The run behind the README GIF

`docs/media/agent-demo.gif` is drawn from one real kiro-cli run, saved here in full (D-136). Nothing in it was typed in by hand or filmed from the screen.

| What                  | Value                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Date                  | 2026-11-04, 02:27 UTC                                                                               |
| Agent                 | kiro-cli 2.37.0, model `claude-sonnet-5.5`, effort `medium`                                         |
| App                   | a copy of `examples/invoices` with one planted bug (`bug.diff`)                                     |
| Lightpath             | this repo's build at commit `ead78b1`, set up with `lightpath init --agent kiro` (`init.out`)       |
| Steps (tool calls)    | 6: Tool Load, `run_action`, Read File ×2, Replace in File, Grep Search                              |
| Credits               | 0.536 (kiro-cli's own figure)                                                                       |
| Tokens, estimated     | 2,869 (transcript characters / 4, D-111; a lower bound)                                             |
| Agent time            | 24.0 s                                                                                              |
| CPU load, start / end | 16.0% / 19.5%                                                                                       |
| Result                | the agent put back the missing line (`agent-fix.diff`). It said it did not check the fix in the app |

All of these come from `run.json`.

## The files

| File               | What it is                                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `transcript.jsonl` | kiro-cli's `--output-format stream-json` output, line by line                                                     |
| `timing.json`      | when each transcript line arrived (ms since 1970), same order                                                     |
| `frames/`          | the screencast of Lightpath's own browser (headless Chrome) during the run, through Playwright's DevTools session |
| `frames.json`      | when each frame arrived                                                                                           |
| `run.json`         | prompt, flags, version, model, credits, steps, tokens, CPU load                                                   |
| `bug.diff`         | the planted bug: one line removed from `server/services/ledger.ts`                                                |
| `agent-fix.diff`   | what the agent changed                                                                                            |
| `init.out`         | what `lightpath init --agent kiro` printed in the copy                                                            |

## What the GIF leaves out or shortens

- Time: the run took 24 s; the GIF is 18.9 s. Each step gets a fixed share. The browser frame shown with a step is the last one the screencast sent before that step's moment in the run.
- The trace: the GIF shows the request, 2 of the 5 browser files by name (then "+ 3 more browser files"), and every server file and function. It stops at "after the response". The full answer is in `transcript.jsonl`.
- The agent's last message: the GIF keeps the first sentence of its "Fix" and "Not verified" paragraphs and two of "Cause".
- The agent loaded `run_action` and `diff_traces` with Kiro's Tool Load step; the GIF doesn't show that step.

## Redo it

Needs Node 22.12+, Chrome, pnpm, and kiro-cli signed in. A run costs Kiro credits (this one: 0.536).

```sh
corepack pnpm install
corepack pnpm build
LP_KIRO_CLI=<path to kiro-cli> node examples/invoices/demo/record-run.mjs --out <new folder>
node examples/invoices/demo/render-gif.mjs --run <that folder> --gif docs/media/agent-demo.gif
```

To redraw the GIF from this run without a new one: `node examples/invoices/demo/render-gif.mjs --run docs/media/demo-run`.

A new run is a new sample: the agent may take other steps.
