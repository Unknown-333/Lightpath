# Contributing to Lightpath

Thanks for helping. Small PRs with a test are the easiest to review. Issues labelled [good first issue](https://github.com/Unknown-333/Lightpath/labels/good%20first%20issue) are a good place to start.

## Setup

You need Node.js 22.12 or later (CI runs 22 and 24), and Chrome or Edge. Python 3.12+ is needed only for `pnpm test:py`.

```sh
git clone https://github.com/Unknown-333/Lightpath.git
cd Lightpath
corepack enable          # or prefix every pnpm command with `corepack`
pnpm install --frozen-lockfile
pnpm build
```

Run the CLI you just built with `pnpm lightpath <command>`, for example `pnpm lightpath doctor`.

## Commands

| Command                               | What it runs                                                                               |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `pnpm build`                          | `tsc -b` for every package, in dependency order                                            |
| `pnpm typecheck`                      | Build plus type-checking of tests, the extension, and the examples                         |
| `pnpm lint` / `pnpm format`           | Biome                                                                                      |
| `pnpm test`                           | Vitest in every package                                                                    |
| `pnpm test:py`                        | Python agent tests                                                                         |
| `pnpm check`                          | All of the above. CI runs it on Linux, macOS and Windows, Node 22 and 24                   |
| `LIGHTPATH_BROWSER_TESTS=1 pnpm test` | Also runs tests that launch a real browser                                                 |
| `pnpm e2e`                            | The example shop under Lightpath; `run_action` clicks Add to cart and Checkout through MCP |
| `pnpm e2e:api`                        | The backend examples (Express, Fastify, NestJS) through the real CLI, no browser           |
| `pnpm test:vscode`                    | The VS Code extension against the example shop (needs a display; CI uses `xvfb-run`)       |
| `node scripts/setup-check.mjs`        | `lightpath init` and `doctor` for each agent in a fresh project. Run after `pnpm build`    |
| `pnpm shop`                           | The example shop without Lightpath                                                         |

Set `LIGHTPATH_DEBUG=1` to see what the agents are doing.

The VS Code extension: open this folder in VS Code and press F5 ("Lightpath extension (example shop)").

Before you open a PR, run `pnpm check`. If you touched the browser, the daemon or the CLI, run `pnpm e2e` too.

## Rules that keep Lightpath trustworthy

1. **A wrong highlighted line is worse than a missing one.** Changes to `packages/core` need a test, and mapping changes need a fixture built from real V8 output (see `packages/core/test/helpers/capture.ts`).
2. **The Node agent runs inside other people's apps.** It has no npm dependencies, never throws into the app, never keeps the process alive, and only talks to localhost.
3. **Local only.** The daemon listens on 127.0.0.1 with a token, and Lightpath sends nothing off the machine. Tool output must never hold request or response bodies or headers, and must hide secret-looking values (D-123). A change that sends data off the machine, or loosens these rules, needs the maintainer's yes before any code.
4. **Measure, then write it down.** If you learn how V8, Chrome, or Python actually behaves, add it to the relevant ADR or `docs/ARCHITECTURE.md` and mark it **(measured)**.
5. **Protocol changes** go in `packages/protocol` and `docs/PROTOCOL.md` in the same commit.
6. **Never weaken or delete a test to make it pass.** If a test is wrong, say why in a decision entry and change it in the same PR.
7. **Keep [flow.md](flow.md) true.** If a change adds an entry point or changes which function calls which, update it.

## Decision entries and ADRs

Log every change that picks between real options in [decisions.md](decisions.md): a new dependency, a new file format, a behavior users will notice, a workaround for a platform quirk, or a test strategy. Use the next free `D-` number (look at the last entry) and the shape at the top of that file. Put the entry in the same commit as the change.

Write the entry **before** the code for these:

- the wire protocol (`docs/PROTOCOL.md`) or the config schema (`lightpath.config.json`);
- a new runtime dependency in a published package;
- a change to what an existing test asserts.

A big or hard-to-undo design choice also gets an ADR in [docs/adr/](docs/adr): copy the shape of the latest one and use the next number.

## The benchmark suites are frozen

`bench/agent-suite` holds seeded bugs that measure whether Lightpath helps an agent fix them (D-108, D-110). Don't change a bug, its check or the scoring to help a result. If one is flawed, open an issue; the fix gets a decision entry and the results report the old and new numbers.

## Tell us about an app you tried

The most useful report is "I ran Lightpath on this app, clicked this, and saw that". Use the [I tried Lightpath on my app](https://github.com/Unknown-333/Lightpath/issues/new?template=app_report.yml) form. Each report becomes a row in [docs/tested-apps.md](docs/tested-apps.md). Remove secrets from anything you paste.

To add the row yourself, open a PR that adds it, with the app's commit, your OS, Node and browser versions, and what you clicked. If Lightpath needed a fix for that app, put the fix in its own PR with a test and a decision entry, the way D-085 to D-091 did for stepful and tududi.

## Layout

```
packages/      TypeScript packages (published under @lightpath-dev/*)
extensions/    VS Code extension
agents/python  Python agent (PyPI: lightpath-agent, preview)
examples/      The shop (demo and e2e target) and backend examples
scripts/       End-to-end tests and the agent setup check
bench/         Performance benchmarks and the agent bug suites
docs/          Architecture, protocol, ADRs, design, research, agent setup pages
```
