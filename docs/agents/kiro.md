# Lightpath with Kiro

Lightpath gives Kiro the exact lines one click ran, in the browser and on the Node server. This page covers setup, checking it, asking for it, and the limits.

Kiro is the one agent Lightpath's own runs use: Kiro CLI 2.37.0 with `claude-sonnet-5.5`. Facts from those runs are marked **(measured)** and name their result file. Other claims about Kiro are marked **(from docs)**, with links, read on 2026-11-01 for [docs/research/agent-mcp-behavior.md](../research/agent-mcp-behavior.md). CI checks the files `init` writes and that the server they name starts (`scripts/setup-check.mjs`).

## Set up

Run this in your project folder, the one with `package.json`:

```sh
npx @lightpath-dev/cli init --agent kiro
```

Then restart Kiro. Kiro reads the workspace file `.kiro/settings/mcp.json`; an agent's own config beats the workspace file, which beats the user file `~/.kiro/settings/mcp.json` **(from docs: [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration.md))**.

## What it writes

| File                      | What goes in it                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.kiro/settings/mcp.json` | A `lightpath` entry under `mcpServers`. Other servers and keys in the file stay                                                                                                                |
| `lightpath.config.json`   | `$schema`, and `command` from your `dev` script, run with the package manager your lockfile names (`pnpm run dev`, `yarn dev`, `bun run dev`, else `npm run dev`). Only missing keys are added |
| `AGENTS.md`               | A block between `<!-- lightpath:start -->` and `<!-- lightpath:end -->` that tells the agent when to call Lightpath. The rest of the file stays                                                |
| `CLAUDE.md`               | The same block, only if the file already exists                                                                                                                                                |

The `.kiro/settings/mcp.json` entry on macOS and Linux:

```json
{
  "mcpServers": {
    "lightpath": { "command": "npx", "args": ["-y", "@lightpath-dev/cli@<version>", "mcp"] }
  }
}
```

On Windows the command is `cmd` with `["/c", "npx", "-y", "@lightpath-dev/cli@<version>", "mcp"]`, because a client can't start the `npx` shim without a shell. `<version>` is the version of the CLI you ran.

Output from a fresh folder on Windows (`agent-loop` at e1ed568):

```text
created   .kiro/settings/mcp.json
created   lightpath.config.json
created   AGENTS.md
note      Kiro custom agents see AGENTS.md only with "resources": ["file://AGENTS.md"] in the agent file.
Done. Restart Kiro so it loads the server, then run lightpath doctor.
```

Running it again prints `unchanged` for each file. A `.kiro/settings/mcp.json` that isn't plain JSON is left alone, and init prints the entry to paste by hand.

## Check it

```sh
npx @lightpath-dev/cli doctor
```

Beside the Node, browser and config checks, doctor checks what init wrote:

- `Kiro MCP config`: the file parses, the command has the right form for this OS, the pinned version matches the CLI, and the command starts and lists Lightpath's tools within 20 s. It starts the command offline, so it never downloads anything. If the package isn't cached yet, it says `npx would download ... not checked offline` instead of failing.
- `AGENTS.md block`: the block names only tools the server lists.
- `Auto-start`: which dev command `lightpath mcp` would run, and whether auto-start is on.

## Ask Kiro to use it

Start your app under Lightpath first, unless auto-start is on (see Limits):

```sh
npx @lightpath-dev/cli dev
```

Then ask in plain words. For example:

> Which code runs, frontend and backend, when I click "Add to cart" on the coffee mug? Use Lightpath to click it.

The agent calls `run_action` with `button "Add to cart"` and `within: "Coffee mug"` (the shop has two such buttons), reads the trace, and can drill down with `get_trace`. After a fix, it calls `run_action` again and compares the two traces with `diff_traces`.

In Kiro CLI without a chat window (`kiro-cli chat --no-interactive`), the workspace's MCP servers load without a prompt only with `--trust-workspace`. Without it, a run had no Lightpath tools at all **(measured: run 2 in [bench/first-wow/results/2026-11-01.md](../../bench/first-wow/results/2026-11-01.md))**.

## The tools

As defined for 0.1.0 in [docs/design/agent-loop.md](../design/agent-loop.md) section 2. Run `doctor` to see the tools your version lists.

| Tool                   | What it does                                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_action`           | Clicks a button or link, or presses Enter or Space, in your running app, and returns that action's trace, frontend and backend. Can fill fields first; their values never come back |
| `run_request`          | Sends one HTTP request to your app on localhost and returns the backend lines it ran. No browser. Planned for 0.1.0 (D-125)                                                         |
| `find_code_for_action` | The latest recorded trace whose label matches, without acting                                                                                                                       |
| `get_trace`            | One trace, or one file or function of it, with lines that didn't run marked                                                                                                         |
| `list_traces`          | Recent actions with their trace ids                                                                                                                                                 |
| `diff_traces`          | Two traces of the same action compared, before and after a fix                                                                                                                      |

Every result is at most 16,000 characters (about 4,000 tokens, [D-109](../../decisions.md)). A cut result ends with a line naming the call that shows the rest.

## What was measured in Kiro

| What                                              | Result                                                                                                                                                                                             | Source                                                                                      |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Result size the model gets whole                  | 16,014 characters: 3 of 3 right. 40,062 and more: 0 of 9, because Kiro CLI passed only the first and last 500 characters                                                                           | [agent-mcp-behavior.md](../research/agent-mcp-behavior.md), 15 runs                         |
| The agent picks the Lightpath tool                | 15 of 15 runs, but the prompt named Lightpath                                                                                                                                                      | same                                                                                        |
| From `npx` to the agent's answer, Lightpath 0.0.2 | 34.1 s, but the answer was "please click", because 0.0.2 had no `run_action`                                                                                                                       | [bench/first-wow/results/2026-11-01.md](../../bench/first-wow/results/2026-11-01.md), run 3 |
| Loading the tools costs one step                  | All 53 benchmark runs with Lightpath made one `tool_load` call first; 22 then never called Lightpath. The loaded text was 37,221 tokens over the 53 runs, more than all Lightpath results (26,534) | [steps audit](../../bench/agent-suite/results/2026-11-04-where-steps-went.md) (PR #59)      |

## Limits

- **Custom agents need `AGENTS.md` listed.** Kiro always includes a root `AGENTS.md`, but a custom agent doesn't load it unless its agent file has `"resources": ["file://AGENTS.md"]` **(from docs: [Kiro steering](https://kiro.dev/docs/steering.md))**. Init prints that note; it doesn't edit agent files.
- **The model may see only tool names at first.** Kiro IDE 1.3+ and CLI V3 show a catalog of tool names and load a tool before calling it **(from docs: [Kiro tool search](https://kiro.dev/docs/mcp/tool-search.md))**. The `AGENTS.md` block is there so the agent knows when to call Lightpath. Whether agents call it without being told is measured only in Lightpath's benchmark (pending).
- **Kiro CLI loads Lightpath's tools in one `tool_load` step.** With Tool Search on, the model first sees only tool names and calls `tool_load` to get a tool's description and input schema. That is one extra step in every run that uses Lightpath, and the loaded text goes into the conversation **(measured: all 53 `with` runs in the [steps audit](../../bench/agent-suite/results/2026-11-04-where-steps-went.md))**. In 0.1.0 the text was 2,409 characters for `run_action` alone; 0.1.1 shortens its schema (D-140). Kiro's CLI 2.1 changelog describes the `toolSearch.enabled` setting **(from docs: [Kiro CLI 2.1 changelog](https://kiro.dev/changelog/cli/2-1/), as cited in the audit)**. Turning it off is your choice: then every request carries the full schemas instead.
- **Kiro CLI cuts results at 30,000 characters.** Measured, not documented by Kiro; a first result, 3 runs per size. Lightpath stays under 16,000.
- **Auto-approve is your call.** Kiro's MCP config takes `autoApprove` for tool names **(from docs: [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration.md))**. Init doesn't set it. If you turn on auto-start too, a tool call can start the `command` in `lightpath.config.json`; every such result names the command it ran.
- **A Windows `.kiro/settings/mcp.json` doesn't run on macOS or Linux.** If you commit it, a teammate there runs init again. Doctor flags the wrong form for the OS.
- **Auto-start is opt-in.** In 0.1.0, `lightpath mcp` starts `lightpath dev` by itself only when `lightpath.config.json` has `command` and `autoStart: true` (D-122). Without it, start `lightpath dev` yourself.
- **Actions:** click, Enter and Space only, with fields filled first. No hover, drag, file upload, dialogs, popups or iframes.
- **What is traced:** Chromium browsers, and Node backends per HTTP request. Not traced yet: WebSocket messages (socket.io), Web Workers, Next.js server components. The full list is in the README's "Known limits".
- **Local only.** The daemon listens on 127.0.0.1 with a token. `run_request` sends only to `localhost`, `127.0.0.1` or `[::1]`. Nothing leaves your machine.
