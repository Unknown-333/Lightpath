# Seeded-bug suite: does an agent fix bugs better with Lightpath?

Ten bugs seeded into `examples/shop`, a harness that runs a coding agent on each one, and fixed scoring rules (`SCORING.md`). Seven bugs are here in `bugs/`; three are held out (`HELDOUT.md`). The decision behind it is D-108 in `decisions.md`.

## The bugs

| Bug | What the user sees                                 | Category                                        | Layer                 | Prediction: does knowing what ran help? |
| --- | -------------------------------------------------- | ----------------------------------------------- | --------------------- | --------------------------------------- |
| b01 | WELCOME10 barely changes the price                 | duplicate function; the obvious one doesn't run | backend               | yes                                     |
| b02 | Checkout says the cart is empty                    | wrong field between `src/api.ts` and the server | across                | yes                                     |
| b03 | Checkout does nothing when an order fails          | swallowed error                                 | frontend, backend 409 | yes                                     |
| b04 | Adding the same item again doesn't update the cart | React state mutated in place                    | frontend              | no                                      |
| b05 | Checkout reloads the page                          | event wiring (form submit)                      | frontend              | unsure                                  |
| b06 | Can't buy the last items in stock                  | wrong condition (off by one)                    | backend               | no                                      |
| b07 | Cart subtotal always $0.00                         | wrong field lookup                              | frontend              | no                                      |

Each `bugs/<id>/` has `bug.patch` (applied to a copy of `examples/shop`), `report.md` (the agent's prompt, written like a user's bug report), `check.mjs` (the hidden check), `fix.patch` (a reference fix on top of the bug) and `notes.md` (category, why the patch is realistic, and the prediction, written before any run).

## Commands

Run `pnpm install` and `pnpm build` first. Trials go to `%TEMP%\lp-agent-trials` (`$TMPDIR/lp-agent-trials`), or to `LP_TRIALS_ROOT` if set. The shop ports 3001 and 5173 must be free.

```sh
# Prove every bug: check fails on the bug, passes after fix.patch, shop typechecks after the fix
node bench/agent-suite/prove.mjs

# One trial: condition without | with | browser, run number 1..3
node bench/agent-suite/run.mjs --bug b01 --condition without --run 1

# Build the trial folder and agent config only, no agent
node bench/agent-suite/run.mjs --bug b01 --condition with --run 1 --dry-run

# Check that the shell deny rules hold (asks a cheap model to run blocked commands)
node bench/agent-suite/probe-safety.mjs
```

A second suite on a real app (tududi, 3 visible and 2 held-out bugs from its own history) is in `realapp/` and runs with `--suite realapp` (D-110). `node bench/agent-suite/tokens.mjs --results <file.jsonl>` recomputes the token estimate (D-111) from saved transcripts.

Each trial appends one JSON line to `results.jsonl` in the trials folder (or `--results <file>`), and keeps the transcript, prompt, tool calls, diff and check log in `_runs/<bug>-<condition>-<n>/`.

## What one trial does

1. Copies the shop to `<trials>/<bug>-<condition>-<n>` as a standalone app: the `tsconfig` options from the repo root inlined, `typescript` and `@types/node` added at the repo's versions, and dependencies copied from a cached install. Applies `bug.patch`, then `git init` with one commit, so history can't show the bug.
2. Writes the pinned agent config to `.kiro/agents/bench.json` in the trial folder (git-excluded). It has no prompt override, the built-in tools `read`, `write`, `shell`, `grep`, `glob`, `includeMcpJson: false` (the owner's global MCP servers never load), and shell deny rules: stopping processes by name and deleting paths outside the folder. `with` adds the Lightpath MCP server from tarballs packed from this checkout plus a stub of the instructions `lightpath init` will write; `browser` adds `chrome-devtools-mcp@1.12.0 --isolated --headless`.
3. Runs `kiro-cli chat --no-interactive --trust-all-tools --trust-workspace --require-mcp-startup --agent bench --model claude-sonnet-5.5 --effort medium --output-format stream-json` with `report.md` plus one safety line as the prompt, for at most 15 minutes, then kills its process tree.
4. Kills anything left that names the trial folder or listens on a shop port and started during the run, runs the hidden check against the trial's shop, runs the typecheck, and writes the result.

## Limits

- kiro-cli 2.37 reports credits, not tokens, in `stream-json`. Each run records `tokensEst`, an estimate (characters / 4 of the transcript, D-111), next to credits.
- The deny rules match each part of a command as text. A delete inside a nested shell (`cmd /c rd ...`) isn't matched; such commands are flagged in `shellFlags` after the run. `probe-safety.mjs` checks the rules with real commands.
- The "reads outside the folder" check looks at paths in tool inputs and shell commands. It's conservative; every hit is listed for review.
- The trials run on the machine they're started on, with trusted tools. Run them where that's acceptable.
