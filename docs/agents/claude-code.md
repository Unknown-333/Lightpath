# Lightpath with Claude Code

Lightpath gives Claude Code the exact lines one click ran, in the browser and on the Node server. This page covers setup, checking it, asking for it, and the limits.

Claims about how Claude Code itself behaves are marked **(from docs)**. They come from Anthropic's pages, read on 2026-11-01 for [docs/research/agent-mcp-behavior.md](../research/agent-mcp-behavior.md). Lightpath's tests don't run Claude Code; CI checks the files `init` writes and that the server they name starts (`scripts/setup-check.mjs`).

## Set up

Run this in your project folder, the one with `package.json`:

```sh
npx @lightpath-dev/cli init --agent claude-code
```

Then restart Claude Code. Claude Code asks you to approve servers from a project's `.mcp.json` before it uses them in an interactive session **(from docs: [Claude Code MCP](https://code.claude.com/docs/en/mcp))**.

## What it writes

| File                    | What goes in it                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.mcp.json`             | A `lightpath` entry under `mcpServers`. Other servers in the file stay                                                                                                                         |
| `lightpath.config.json` | `$schema`, and `command` from your `dev` script, run with the package manager your lockfile names (`pnpm run dev`, `yarn dev`, `bun run dev`, else `npm run dev`). Only missing keys are added |
| `AGENTS.md`             | A block between `<!-- lightpath:start -->` and `<!-- lightpath:end -->` that tells the agent when to call Lightpath. The rest of the file stays                                                |
| `CLAUDE.md`             | The same block, only if the file already exists                                                                                                                                                |

The `.mcp.json` entry on macOS and Linux:

```json
{
  "mcpServers": {
    "lightpath": { "command": "npx", "args": ["-y", "@lightpath-dev/cli@<version>", "mcp"] }
  }
}
```

On Windows the command is `cmd` with `["/c", "npx", "-y", "@lightpath-dev/cli@<version>", "mcp"]`, because a client can't start the `npx` shim without a shell. `<version>` is the version of the CLI you ran, so `lightpath mcp` and `lightpath dev` match.

Output from a fresh folder on Windows (`agent-loop` at e1ed568):

```text
created   .mcp.json
created   lightpath.config.json
created   AGENTS.md
Done. Restart Claude Code so it loads the server, then run lightpath doctor.
```

Running it again prints `unchanged` for each file. A `.mcp.json` that isn't plain JSON is left alone, and init prints the entry to paste by hand.

## Check it

```sh
npx @lightpath-dev/cli doctor
```

Beside the Node, browser and config checks, doctor checks what init wrote:

- `Claude Code MCP config`: the file parses, the command has the right form for this OS, the pinned version matches the CLI, and the command starts and lists Lightpath's tools within 20 s. It starts the command offline, so it never downloads anything. If the package isn't cached yet, it says `npx would download ... not checked offline` instead of failing.
- `AGENTS.md block` and `CLAUDE.md block`: the block names only tools the server lists.
- `Auto-start`: which dev command `lightpath mcp` would run, and whether auto-start is on.

In Claude Code, `claude mcp list` shows each server's status. A `.mcp.json` server you haven't approved yet shows `Pending approval`; run `claude` in the folder to approve it. The `/mcp` panel shows each connected server's tool count **(from docs: [Claude Code MCP](https://code.claude.com/docs/en/mcp), read 2026-11-01)**.

## Ask Claude Code to use it

Start your app under Lightpath first, unless auto-start is on (see Limits):

```sh
npx @lightpath-dev/cli dev
```

Then ask in plain words. For example:

> Which code handles Checkout? Use Lightpath to click it and show me the frontend and backend code that ran.

The agent calls `run_action` with a target like `button "Checkout"`, reads the trace, and can drill down with `get_trace`. After a fix, it calls `run_action` again and compares the two traces with `diff_traces`.

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

## Limits

- **`CLAUDE.md` hides `AGENTS.md`.** Claude Code reads `AGENTS.md` only when no `CLAUDE.md` exists at or above the working folder **(from docs: [Claude Code memory](https://code.claude.com/docs/en/memory))**. That is why init also writes the block into an existing `CLAUDE.md`. If you create `CLAUDE.md` later, run init again.
- **The model may see only tool names at first.** With tool search on, Claude Code shows the model tool names and the server's instructions, and loads full descriptions when needed **(from docs: [Claude Code MCP](https://code.claude.com/docs/en/mcp))**. The `AGENTS.md` block is there so the agent knows when to call Lightpath. Whether agents call it on their own is measured only in Lightpath's benchmark (pending).
- **A Windows `.mcp.json` doesn't run on macOS or Linux.** If you commit it, a teammate there runs init again. Doctor flags the wrong form for the OS.
- **Auto-start is opt-in.** In 0.1.0, `lightpath mcp` starts `lightpath dev` by itself only when `lightpath.config.json` has `command` and `autoStart: true` (D-122). Each result that auto-started says which command it ran. Without it, start `lightpath dev` yourself.
- **Actions:** click, Enter and Space only, with fields filled first. No hover, drag, file upload, dialogs, popups or iframes.
- **What is traced:** Chromium browsers, and Node backends per HTTP request. Not traced yet: WebSocket messages (socket.io), Web Workers, Next.js server components. The full list is in the README's "Known limits".
- **Local only.** The daemon listens on 127.0.0.1 with a token. `run_request` sends only to `localhost`, `127.0.0.1` or `[::1]`. Nothing leaves your machine.
