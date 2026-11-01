# Good first issues: drafts for the owner to post

Nine issues a newcomer can finish in one sitting, each with a way to check it's done. Nothing here is posted: creating labels and issues is public, so the owner runs the commands at the end (Tier 3).

Each draft names real files at `agent-loop` e1ed568 (2026-11-01). Re-read the named file before posting, in case a build changed it.

Labels already in the repo (read with `gh label list` on 2026-11-01): `good first issue`, `help wanted`, `documentation`, `bug`, `enhancement`, `question`. The commands below add `tested-app`, `setup`, `needs-repro` and `unsupported-stack`, which the [first-week plan](first-week.md) uses for triage.

| #   | Title                                                                          | Area            | Labels                                    |
| --- | ------------------------------------------------------------------------------ | --------------- | ----------------------------------------- |
| 1   | `lightpath init`: use package.json's `packageManager` when there's no lockfile | CLI             | good first issue, enhancement, setup      |
| 2   | `lightpath init`: say which dev command it wrote                               | CLI             | good first issue, enhancement, setup      |
| 3   | `lightpath init --agent`: suggest the right name for a typo                    | CLI             | good first issue, enhancement, setup      |
| 4   | Add a Koa backend to `pnpm e2e:api`                                            | Tests, examples | good first issue, help wanted             |
| 5   | Add a Hono (Node server) backend to `pnpm e2e:api`                             | Tests, examples | good first issue, help wanted             |
| 6   | Try Lightpath on an open-source Svelte + Vite app and report it                | Tested apps     | good first issue, help wanted, tested-app |
| 7   | Try Lightpath on an open-source Angular app with a Node API and report it      | Tested apps     | good first issue, help wanted, tested-app |
| 8   | Docs: set up Lightpath by hand in another MCP client                           | Docs            | good first issue, documentation           |
| 9   | Label "I tried Lightpath on my app" reports automatically                      | Repo health     | good first issue                          |

---

## 1. `lightpath init`: use package.json's `packageManager` when there's no lockfile

<!-- body 1 -->
**What happens now.** `lightpath init` writes your dev command into `lightpath.config.json`. It picks the package manager from the lockfile: `pnpm-lock.yaml` gives `pnpm run dev`, `yarn.lock` gives `yarn dev`, `bun.lock` gives `bun run dev`, and anything else gives `npm run dev`. A fresh project with no lockfile yet, but with `"packageManager": "pnpm@9.0.0"` in `package.json`, gets `npm run dev`.

**What to change.** In `devCommand()` in `packages/cli/src/init.ts`, when no lockfile is found, read the name before the `@` in `package.json`'s `packageManager` field (`pnpm`, `yarn` or `bun`) and use the same command the lockfile would give. Keep the lockfile first: it says what the project really uses.

**Tests.** Add cases to `packages/cli/test/init.test.ts` next to "npm with no lockfile; nothing with no dev script": `packageManager` set to `pnpm@…`, `yarn@…`, `bun@…`, and an unknown name (stays `npm run dev`). The existing case keeps passing unchanged.

**How to check it's done.** `pnpm build && pnpm --filter @lightpath-dev/cli test` passes, and `pnpm check` passes.
<!-- /body 1 -->

## 2. `lightpath init`: say which dev command it wrote

<!-- body 2 -->
**What happens now.** `lightpath init --agent <agent>` prints one line per file, like `created   lightpath.config.json`. It doesn't say which dev command it put in that file, so you have to open it to see whether `npm run dev` is right.

**What to change.** In `init()` in `packages/cli/src/init.ts`, when it adds `command`, print one more line after the `lightpath.config.json` line, in the same style as the existing `note` lines:

```text
note      dev command: npm run dev (from package.json "dev"; edit lightpath.config.json to change it)
```

Print nothing extra when the file already had a `command`.

**Tests.** Add a case to `packages/cli/test/init.test.ts` that checks the new line, and one that checks it's absent when `command` was already set. If an existing test compares the whole output, adding a line changes what it asserts: say so in the PR, and add a short entry in `decisions.md` (see CONTRIBUTING.md).

**How to check it's done.** `pnpm build && pnpm --filter @lightpath-dev/cli test` passes. In a folder with a `package.json` that has a `dev` script, `node <repo>/packages/cli/dist/bin.js init --agent cursor` prints the new line once, and a second run doesn't.
<!-- /body 2 -->

## 3. `lightpath init --agent`: suggest the right name for a typo

<!-- body 3 -->
**What happens now.** `lightpath init --agent claude` stops with `lightpath init: --agent must be one of claude-code, cursor, vscode, kiro (got "claude")`. That is correct, but a hint would save a re-read.

**What to change.** In `packages/cli/src/main.ts`, where that message is printed, add `Did you mean claude-code?` when one agent name starts with what was typed or matches it ignoring case and dashes (`claude` → `claude-code`, `VSCode` → `vscode`, `vs-code` → `vscode`). No new dependency: a few lines of string checks are enough.

**Tests.** Put the matching in a small exported function in `packages/cli/src/init.ts` (for example `agentHint(name)`, returning the suggested name or nothing), and test it in `packages/cli/test/init.test.ts`: `claude`, `VSCode`, `vs-code`, and a name with no match.

**How to check it's done.** `pnpm build && pnpm --filter @lightpath-dev/cli test` passes.
<!-- /body 3 -->

## 4. Add a Koa backend to `pnpm e2e:api`

<!-- body 4 -->
**Why.** `pnpm e2e:api` proves that Lightpath traces the right backend lines for the same checkout API on Express (the shop), Fastify and NestJS. Koa is a common Node framework that isn't covered.

**What to do.**

1. Add `examples/backends/koa/server.ts`, modeled on `examples/backends/fastify/server.ts` (21 lines). It serves the same checkout from `examples/backends/shared/checkout.ts`.
2. Add `koa` (and `@types/koa` if needed) to `examples/backends/package.json`, pinned to an exact version like the others. This package is private, so it isn't a dependency of anything published.
3. In `scripts/e2e-api.mjs`, add a `koa` entry next to the `fastify` one: the command, the files the trace must show, and one line that must run and one that must not (the `lit` and `dark` lists).

**How to check it's done.** `pnpm e2e:api` passes and its output includes the `koa` case. `pnpm check` passes. If Koa's lines don't show up in the trace, that's a finding: open an issue with what you saw instead of changing the checks.
<!-- /body 4 -->

## 5. Add a Hono (Node server) backend to `pnpm e2e:api`

<!-- body 5 -->
**Why.** Hono is popular for small APIs. On Node it runs through `@hono/node-server`. Nobody has checked that Lightpath traces it.

**What to do.** The same steps as the Koa issue: `examples/backends/hono/server.ts` modeled on `examples/backends/fastify/server.ts`, `hono` and `@hono/node-server` pinned in `examples/backends/package.json`, and a `hono` entry in `scripts/e2e-api.mjs` with its `lit` and `dark` lines.

**How to check it's done.** `pnpm e2e:api` passes with the `hono` case, and `pnpm check` passes. If the trace has no Hono lines, open an issue with the output; that's a useful result too.
<!-- /body 5 -->

## 6. Try Lightpath on an open-source Svelte + Vite app and report it

<!-- body 6 -->
**Why.** Lightpath has been run on React and Vue apps (`docs/tested-apps.md`), but not on Svelte. Vite apps need no setup in theory; nobody has checked Svelte.

**What to do.**

1. Pick an open-source Svelte app on Vite with a Node backend (Express, Fastify or similar) over HTTP. Say in the issue which one you picked before you start, so two people don't take the same app.
2. Start it with `npx @lightpath-dev/cli dev -- <its dev command>` and click 3 or 4 things that call the backend.
3. Fill in the [I tried Lightpath on my app](https://github.com/Unknown-333/Lightpath/issues/new?template=app_report.yml) form, or open a PR that adds a row to `docs/tested-apps.md` with the app's commit, your OS, Node and browser versions, and what each click showed.

**How to check it's done.** The row or report names the app's commit and what at least 3 clicks showed, including anything wrong or missing. "It didn't work, here's what I saw" counts as done.
<!-- /body 6 -->

## 7. Try Lightpath on an open-source Angular app with a Node API and report it

<!-- body 7 -->
**Why.** No Angular app is in `docs/tested-apps.md`. Nobody has tried the Angular CLI's dev server, so its source maps may need something.

**What to do.** The same steps as the Svelte issue, with an open-source Angular app whose API runs on Node over HTTP. Name the app in the issue first.

**How to check it's done.** The row or report names the app's commit and what at least 3 clicks showed. If frontend files are missing, include the output of `npx @lightpath-dev/cli doctor` and the first lines Lightpath printed.
<!-- /body 7 -->

## 8. Docs: set up Lightpath by hand in another MCP client

<!-- body 8 -->
**Why.** `lightpath init` sets up Claude Code, Cursor, VS Code and Kiro (`docs/agents/`). Other MCP clients, such as Windsurf, Zed or OpenAI Codex CLI, can run the same server by hand.

**What to do.** Pick one client and add `docs/agents/<client>.md`, in the shape of `docs/agents/cursor.md`:

- the config file and the entry that starts `npx -y @lightpath-dev/cli@<version> mcp` (on Windows `cmd /c npx …`);
- how to see in that client that the server started;
- limits that matter, such as how it reads `AGENTS.md`.

Every claim about the client's own behaviour gets a link to its docs, the date you read it, and the words "from docs". Say which of these you checked yourself.

**How to check it's done.** You ran the client with that config and the agent listed Lightpath's tools, or the page says plainly that you didn't. Links open. No claim is left without a source.
<!-- /body 8 -->

## 9. Label "I tried Lightpath on my app" reports automatically

<!-- body 9 -->
**Why.** Reports from the "I tried Lightpath on my app" form become rows in `docs/tested-apps.md`. They carry no label, so they're easy to miss among bugs.

**What to do.** In `.github/ISSUE_TEMPLATE/app_report.yml`, add `labels: [tested-app]` under `description`, the way `bug_report.yml` has `labels: [bug]`. The `tested-app` label already exists.

**How to check it's done.** On your fork, create a `tested-app` label, then open a new issue from the form: the label is already set, and the form still loads.
<!-- /body 9 -->

---

## Commands for the owner

Run these in PowerShell from the repo root, on `main` after the launch kit is merged, so the bodies come from this file. Each command posts publicly. Check the issue numbers that come back.

Labels first (the four new ones; the rest already exist):

```powershell
gh label create "tested-app" --repo Unknown-333/Lightpath --color "0e8a16" --description "A report of Lightpath on a real app"
gh label create "setup" --repo Unknown-333/Lightpath --color "fbca04" --description "lightpath init, doctor, or agent config"
gh label create "needs-repro" --repo Unknown-333/Lightpath --color "d4c5f9" --description "Needs steps or an app we can run"
gh label create "unsupported-stack" --repo Unknown-333/Lightpath --color "c5def5" --description "A framework or runtime Lightpath doesn't trace yet"
```

Then the issues. The first two lines read each body from between its `<!-- body N -->` markers in this file:

```powershell
$doc = Get-Content docs/launch/good-first-issues.md -Raw -Encoding UTF8
function Body($n) { [regex]::Match($doc, "(?s)<!-- body $n -->\r?\n(.*?)\r?\n<!-- /body $n -->").Groups[1].Value }

Body 1 | gh issue create --repo Unknown-333/Lightpath --title "lightpath init: use package.json's packageManager when there's no lockfile" --label "good first issue" --label "enhancement" --label "setup" --body-file -
Body 2 | gh issue create --repo Unknown-333/Lightpath --title "lightpath init: say which dev command it wrote" --label "good first issue" --label "enhancement" --label "setup" --body-file -
Body 3 | gh issue create --repo Unknown-333/Lightpath --title "lightpath init --agent: suggest the right name for a typo" --label "good first issue" --label "enhancement" --label "setup" --body-file -
Body 4 | gh issue create --repo Unknown-333/Lightpath --title "Add a Koa backend to pnpm e2e:api" --label "good first issue" --label "help wanted" --body-file -
Body 5 | gh issue create --repo Unknown-333/Lightpath --title "Add a Hono (Node server) backend to pnpm e2e:api" --label "good first issue" --label "help wanted" --body-file -
Body 6 | gh issue create --repo Unknown-333/Lightpath --title "Try Lightpath on an open-source Svelte + Vite app and report it" --label "good first issue" --label "help wanted" --label "tested-app" --body-file -
Body 7 | gh issue create --repo Unknown-333/Lightpath --title "Try Lightpath on an open-source Angular app with a Node API and report it" --label "good first issue" --label "help wanted" --label "tested-app" --body-file -
Body 8 | gh issue create --repo Unknown-333/Lightpath --title "Docs: set up Lightpath by hand in another MCP client" --label "good first issue" --label "documentation" --body-file -
Body 9 | gh issue create --repo Unknown-333/Lightpath --title "Label 'I tried Lightpath on my app' reports automatically" --label "good first issue" --body-file -
```

To check the bodies before posting, run the first two lines and then `1..9 | % { "--- $_"; Body $_ }`. Nothing is sent until a `gh issue create` line runs.
