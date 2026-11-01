# README 10-second test

The owner's metric: "someone seeing the README top section for 10 seconds can say what it does. Test it on 3-5 people or fresh agents and record the answers." This folder runs that test on fresh agents.

## Rubric and pass line (written before any run)

An answer earns one point for each of these. The regexes are in `score.mjs` and were committed before the first run.

| Point    | The answer says                                                   | Example words that count                                  |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| `ran`    | it shows the code that actually ran (runtime, not static reading) | "code that ran", "executed lines", "traces the code"      |
| `action` | for a click or action in the app                                  | "click", "action", "interaction", "button"                |
| `stack`  | frontend and backend                                              | "frontend and backend", "full-stack", "client and server" |
| `agents` | it is for coding agents                                           | "agent", "LLM", "AI assistant"                            |

**Pass: at least 3 of the 4 points, and `ran` must be one of them.** An answer that gets the audience right but not what the tool does doesn't pass. Whether the answer names developers is recorded but not scored.

The scoring is a fixed regex check, so the reported numbers don't depend on our reading. Every answer is recorded word for word next to its score, so anyone can re-judge it.

## Input

- The README's top section only: everything above the first `##` heading of `README.md` at main `e70966c` (the PR #16 merge). Badges become `[Badge: <alt>]`. The demo GIF becomes its alt text, since the agent can't watch it.
- Three variants, which differ only in the bold pitch line. The exact text of each is in `variants/`.
  - `current`: the README as it is: "Click anything in your running app and see the exact code it ran, frontend and backend, line by line."
  - `A`: candidate A from `docs/research/growth-study.md`: "Show your coding agent the code that actually ran."
  - `B`: candidate B: "Your agent clicks a button and sees every line it ran, frontend and backend." Lightpath 0.0.2 can't do this yet (a human clicks). B is tested so the owner can compare it now; it could only ship after `run_action` exists.
- Candidate C wasn't tested: the seed allows at most 2 alternatives, and A and B are the most different from each other and from the current line.

## Method

- 5 fresh agents per variant. Each is a new `kiro-cli chat --no-interactive` session in a new empty temp folder, with `--model claude-sonnet-5.5 --effort medium` and an agent config with no tools, no MCP servers, `includeMcpJson: false` and no resources.
- Prompt: the variant text, a `---` line, then: "You saw this for 10 seconds. In one sentence: what does this tool do, and who is it for?"
- Each run appends a JSON line to `results/results.jsonl` with the answer, its score, credits, steps, the kiro-cli version and the model ID.
- Limits: a fresh agent reads the whole text with no time limit, so "10 seconds" is simulated only by the prompt. A person skims, and may miss the second paragraph. Agents are not people; the owner's metric allows either.

```sh
node bench/readme-test/run.mjs --write-variants          # rebuild variants/ from README.md at e70966c
node bench/readme-test/run.mjs --variant current --runs 5
```

The runner stops before a run if the item's runs could pass 5 credits, and after any run that cost over 2.

## Results

See `results/2026-11-01.md`.
