# Lightpath with VS Code (Copilot agent mode)

Lightpath gives VS Code's agent the exact lines one click ran, in the browser and on the Node server. This page covers setup, checking it, asking for it, and the limits.

This page is about the MCP server for VS Code's chat agent. The [Lightpath VS Code extension](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode) is separate: it lights up the lines that ran in your editor, and you don't need it for the agent.

Claims about how VS Code itself behaves are marked **(from docs)**, with links. They were read on 2026-11-01, some for [docs/research/agent-mcp-behavior.md](../research/agent-mcp-behavior.md). Lightpath's tests don't run VS Code's agent; CI checks the files `init` writes and that the server they name starts (`scripts/setup-check.mjs`).

## Set up

Run this in your project folder, the one with `package.json`:

```sh
npx @lightpath-dev/cli init --agent vscode
```

Then reload the VS Code window. Servers in the workspace's `.vscode/mcp.json` follow the folder's Workspace Trust **(from docs: [VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration))**.

## What it writes

| File                    | What goes in it                                                                                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.vscode/mcp.json`      | A `lightpath` entry under `servers`, with `"type": "stdio"`. Other servers in the file stay                                                                                                    |
| `lightpath.config.json` | `$schema`, and `command` from your `dev` script, run with the package manager your lockfile names (`pnpm run dev`, `yarn dev`, `bun run dev`, else `npm run dev`). Only missing keys are added |
| `AGENTS.md`             | A block between `<!-- lightpath:start -->` and `<!-- lightpath:end -->` that tells the agent when to call Lightpath. The rest of the file stays                                                |
| `CLAUDE.md`             | The same block, only if the file already exists                                                                                                                                                |

The `.vscode/mcp.json` entry on macOS and Linux:

```json
{
  "servers": {
    "lightpath": { "type": "stdio", "command": "npx", "args": ["-y", "@lightpath-dev/cli@<version>", "mcp"] }
  }
}
```

On Windows the command is `cmd` with `["/c", "npx", "-y", "@lightpath-dev/cli@<version>", "mcp"]`, because a client can't start the `npx` shim without a shell. `<version>` is the version of the CLI you ran.

Output from a fresh folder on Windows (`agent-loop` at e1ed568):

```text
created   .vscode/mcp.json
created   lightpath.config.json
created   AGENTS.md
Done. Restart VS Code so it loads the server, then run lightpath doctor.
```

Running it again prints `unchanged` for each file.

**Comments in `.vscode/mcp.json`.** VS Code allows comments in this file. Init doesn't parse comments, so it leaves such a file alone and prints the entry for you to paste under `servers`.

## Check it

```sh
npx @lightpath-dev/cli doctor
```

Beside the Node, browser and config checks, doctor checks what init wrote:

- `VS Code MCP config`: the file parses, the entry has `"type": "stdio"`, the command has the right form for this OS, the pinned version matches the CLI, and the command starts and lists Lightpath's tools within 20 s. It starts the command offline, so it never downloads anything. If the package isn't cached yet, it says `npx would download ... not checked offline` instead of failing. A file with comments fails this check with a note to check it by hand.
- `AGENTS.md block`: the block names only tools the server lists.
- `Auto-start`: which dev command `lightpath mcp` would run, and whether auto-start is on.

In VS Code, the Command Palette's **MCP: List Servers** shows each server and can start, stop or restart it and show its output. After you upgrade Lightpath, **MCP: Reset Cached Tools** makes VS Code read the new tool list **(from docs: [VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration))**.

## Ask VS Code's agent to use it

Start your app under Lightpath first, unless auto-start is on (see Limits):

```sh
npx @lightpath-dev/cli dev
```

Then, in agent mode, ask in plain words. For example:

> When I press Enter in the search box, nothing is found. Use Lightpath to do that and show me which code ran.

The agent calls `run_action` with the search box as the target, `action: "press"` and the text in `fill`, reads the trace, and can drill down with `get_trace`. After a fix, it calls `run_action` again and compares the two traces with `diff_traces`.

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

- **VS Code reads `AGENTS.md`.** Copilot also reads `.github/copilot-instructions.md` and `.github/instructions/*.instructions.md`; a nested `AGENTS.md` needs a setting **(from docs: [VS Code custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions))**. Init writes the block in the root `AGENTS.md` only.
- **128 tools per request.** VS Code stops with "Tool limit exceeded" past 128 tools, and hides groups of tools behind stubs when there are many **(from docs: [microsoft/vscode#290356](https://github.com/microsoft/vscode/issues/290356), [#294055](https://github.com/microsoft/vscode/issues/294055))**. Lightpath adds 5 or 6 tools (6 if `run_request` ships). If you run many servers, the agent may not see Lightpath's.
- **Long results.** VS Code has no documented size cap; an issue shows results of 50 KB and more cut **(from docs: [microsoft/vscode#311068](https://github.com/microsoft/vscode/issues/311068))**. Lightpath keeps every result under 16,000 characters.
- **The workspace file only.** Init writes `.vscode/mcp.json`. It doesn't write your user profile (`code --add-mcp` does that) or the portable `.mcp.json`.
- **A Windows `.vscode/mcp.json` doesn't run on macOS or Linux.** If you commit it, a teammate there runs init again. Doctor flags the wrong form for the OS.
- **Auto-start is opt-in.** In 0.1.0, `lightpath mcp` starts `lightpath dev` by itself only when `lightpath.config.json` has `command` and `autoStart: true` (D-122). VS Code starts a stdio server in the workspace folder by default **(from docs: [VS Code MCP configuration](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration))**, which is where Lightpath looks for that file. Without auto-start, start `lightpath dev` yourself.
- **Actions:** click, Enter and Space only, with fields filled first. No hover, drag, file upload, dialogs, popups or iframes.
- **What is traced:** Chromium browsers, and Node backends per HTTP request. Not traced yet: WebSocket messages (socket.io), Web Workers, Next.js server components. The full list is in the README's "Known limits".
- **Local only.** The daemon listens on 127.0.0.1 with a token. `run_request` sends only to `localhost`, `127.0.0.1` or `[::1]`. Nothing leaves your machine.
