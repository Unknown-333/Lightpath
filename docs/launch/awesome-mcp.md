# awesome-mcp entries: ready for the owner to submit

One entry per list, in that list's format, following its rules. Nothing here is submitted: every list below is a public post, so the owner submits each one by hand (Tier 3). Order and timing are in [plan.md](plan.md).

Which lists, and why, come from [docs/research/growth-study.md](../research/growth-study.md) ("awesome-mcp lists and registries"). Each list's rules and format were read again on 2026-11-01 between 06:05 and 06:40 UTC, through the GitHub API and web fetch. Copies of what was read are kept outside the repo in `lightpath-trials/goal/launch1-raw/`.

Every entry says only what 0.1.0 does and the repo can back:

| Words in the entries          | Source in the repo                                                                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the agent clicks a button     | `run_action`; `pnpm e2e` has it click Add to cart and Checkout with no press from the script (`scripts/e2e-shop.mjs`)                                                                |
| exact lines, browser and Node | README "What a click looks like" and "How it works"; `pnpm e2e` checks the files and lines                                                                                           |
| from V8 coverage              | [docs/adr/0001-v8-coverage-deltas.md](../adr/0001-v8-coverage-deltas.md)                                                                                                             |
| local only, no account        | README "Why"; the daemon listens on 127.0.0.1 (`packages/daemon/src/server.ts`) and refuses a wrong token or any `Origin` (`packages/daemon/test/server.test.ts`, `actions.test.ts`) |
| macOS, Windows, Linux         | CI runs `pnpm check` and the agent setup job on all three (`.github/workflows/ci.yml`)                                                                                               |

**Before submitting any of these:** 0.1.0 is on npm, the README top section is final, and the six tools in the entries match `tools/list` of the published version. If `run_request` didn't ship in 0.1.0, drop it from the TensorBlock entry.

## 1. punkpeye/awesome-mcp-servers

97,143 stars on 2026-11-01. The biggest list. About 4,600 entries, so a listing gives little reach by itself (growth-study.md).

**Its rules** (its `CONTRIBUTING.md`): a public GitHub repo you install and run yourself; fork, add one line in the right category of `README.md`, keep each category alphabetical, follow the existing format, open a PR with a clear title and description. Its legend marks the language (📇 TypeScript), the scope (🏠 local service) and the OS (🍎 🪟 🐧).

**Section:** 💻 Developer Tools (`#developer-tools`). Alphabetical by the link text, so it goes after `Umair/stalemap` and before `vamsiy78/ballmac-ui` as of 2026-11-01. The list isn't perfectly sorted, so check the neighbours again before the PR.

**The line:**

```markdown
- [Unknown-333/Lightpath](https://github.com/Unknown-333/Lightpath) 📇 🏠 🍎 🪟 🐧 - Lets coding agents click a button in a running web app and get the exact source lines it ran, in the browser and on the Node server, from V8 coverage. Local only, no account.
```

**PR title:** `Add Unknown-333/Lightpath`

**PR description:** the owner writes it. Suggested facts: what it does (the line above), that it is the owner's own project, MIT, and the `npx @lightpath-dev/cli init --agent <agent>` command.

Notes:

- Most lines in this list also carry a Glama score badge. The rules don't ask for one. Glama syncs with this list and has its own listing and claim steps, which may need an account; the badge is left out until the owner decides.
- Its `CONTRIBUTING.md` offers a fast track for PRs opened by automated agents. The owner submits by hand, so the PR doesn't use it.

## 2. Official MCP Registry

[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io/). MCP clients and other directories read it. It takes no PRs: you publish a `server.json` with the `mcp-publisher` CLI ([quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx)).

**Its rules:**

- The registry holds metadata only; the package must already be on npm.
- For an npm package, `package.json` must have `mcpName`, equal to the `name` in `server.json` ([package types](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/package-types.mdx)). The registry checks the published package, so **`mcpName` has to be in `packages/cli/package.json` before 0.1.0 is published** (Proposed decision 3 in [plan.md](plan.md)).
- With GitHub sign-in, the name must start with `io.github.<your GitHub user>/`.
- `description` is at most 100 characters.
- Fixed start-up arguments go in `packageArguments` as `positional` values ([server.json format](https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/server-json/generic-server-json.md)). Lightpath needs `mcp`.

**`packages/cli/package.json` addition** (with the 0.1.0 release PR, not here):

```json
"mcpName": "io.github.Unknown-333/lightpath"
```

**`server.json`** (95-character description):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.Unknown-333/lightpath",
  "description": "Shows your coding agent the exact lines one click ran in your web app, browser and Node server.",
  "repository": {
    "url": "https://github.com/Unknown-333/Lightpath",
    "source": "github"
  },
  "version": "0.1.0",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@lightpath-dev/cli",
      "version": "0.1.0",
      "transport": { "type": "stdio" },
      "packageArguments": [{ "type": "positional", "value": "mcp" }]
    }
  ]
}
```

**Owner's commands** (after 0.1.0 is on npm; `login` opens a GitHub device sign-in):

```sh
mcp-publisher login github
mcp-publisher validate
mcp-publisher publish
```

Run `mcp-publisher init` first if you'd rather generate the file and compare. If the namespace it generates differs in case from `Unknown-333`, use what it generates in both files.

## 3. mcpservers.org (wong2/awesome-mcp-servers)

wong2/awesome-mcp-servers has 4,396 stars (2026-11-01). It takes no PRs; entries come from the [mcpservers.org submit form](https://mcpservers.org/submit). Its list format is `- **[Name](url)** - Description`.

**Form fields and answers:**

| Field                                   | Answer                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Server Name                             | Lightpath                                                                                                           |
| Category                                | The form's developer-tools category (its list wasn't readable; see below)                                           |
| Short Description                       | Your coding agent clicks a button in your running web app and sees the exact lines it ran, browser and Node server. |
| Repository, Website or Documentation    | https://github.com/Unknown-333/Lightpath                                                                            |
| Official MCP Registry Name (optional)   | `io.github.Unknown-333/lightpath`, once the registry entry is published                                             |
| This server supports remote connections | Leave unticked: it runs locally over stdio                                                                          |

The form's category list couldn't be read with a plain page fetch (it needs the page's script), so pick the nearest developer category when submitting. The short description is 115 characters; the form's limit, if any, wasn't readable either.

## 4. TensorBlock/awesome-mcp-servers

1,008 stars (2026-11-01). A community list plus a hosted index.

**Its rules** (its README): add the server to the best `docs/*.md` category by PR, or use its "Add MCP server" issue form. The form asks for: server name, project URL, best category, what an agent can do with it, install instructions, transport, auth, known clients, license, and a check that it isn't listed already. After merge, a bot comment gives a profile link and a badge; adding the badge to our README is optional.

**Category:** `docs/developer-productivity--utilities.md` ("🛠 Developer Productivity & Utilities", which holds other debugging tools). Not "Code Analysis & Quality": that one is for static analysis, and Lightpath records what ran.

**The line**, in the format recent entries use:

```markdown
- [Lightpath](https://github.com/Unknown-333/Lightpath): Your coding agent clicks a button in your running web app and gets the exact source lines it ran, in the browser and on the Node server, from V8 runtime coverage. Install: `npx -y @lightpath-dev/cli init --agent <claude-code|cursor|vscode|kiro>` in the project folder, then `npx @lightpath-dev/cli dev`. Transport: stdio. Auth: none; local only (127.0.0.1). Tools: `run_action`, `run_request`, `find_code_for_action`, `get_trace`, `list_traces`, `diff_traces`. License: MIT. [Docs](https://github.com/Unknown-333/Lightpath/tree/main/docs/agents).
```

**For the issue form instead:** use the same words, split into its fields. Known supported clients: Claude Code, Cursor, VS Code, Kiro (setup tested in CI with no agent installed; agent behaviour from each one's docs, except Kiro).

## Not on this list

- **modelcontextprotocol/servers** no longer lists third-party servers and points to the Registry (growth-study.md).
- **appcypher/awesome-mcp-servers** is archived.
