# Contributing to Lightpath

## Setup

You need Node.js 24 (22.12+ works), Python 3.12+, and Chrome or Edge.

```sh
corepack enable          # or prefix every pnpm command with `corepack`
pnpm install
pnpm build
```

## Commands

| Command                               | What it runs                                                       |
| ------------------------------------- | ------------------------------------------------------------------ |
| `pnpm build`                          | `tsc -b` for every package, in dependency order                    |
| `pnpm typecheck`                      | Build plus type-checking of tests, the extension, and the example  |
| `pnpm lint` / `pnpm format`           | Biome                                                              |
| `pnpm test`                           | Vitest in every package                                            |
| `pnpm test:py`                        | Python agent tests                                                 |
| `pnpm check`                          | All of the above; this is what CI runs                             |
| `LIGHTPATH_BROWSER_TESTS=1 pnpm test` | Also runs tests that launch a real browser                         |
| `pnpm e2e`                            | The golden test: the example shop under Lightpath with real clicks |
| `pnpm shop`                           | The example shop without Lightpath                                 |

Set `LIGHTPATH_DEBUG=1` to see what the agents are doing.

The VS Code extension: open this folder in VS Code and press F5 ("Lightpath extension (example shop)").

## Rules that keep Lightpath trustworthy

1. **A wrong highlighted line is worse than a missing one.** Changes to `packages/core` need a test, and mapping changes need a fixture built from real V8 output (see `packages/core/test/helpers/capture.ts`).
2. **The Node agent runs inside other people's apps.** It has no npm dependencies, never throws into the app, never keeps the process alive, and only talks to localhost.
3. **Measure, then write it down.** If you learn how V8, Chrome, or Python actually behaves, add it to the relevant ADR or `docs/ARCHITECTURE.md` and mark it **(measured)**.
4. **Protocol changes** go in `packages/protocol` and `docs/PROTOCOL.md` in the same commit.
5. **Big decisions** get an ADR in `docs/adr/`.

## Layout

```
packages/      TypeScript packages (published under @lightpath/*)
extensions/    VS Code extension
agents/python  Python agent (PyPI: lightpath-agent)
examples/shop  Demo app and end-to-end test target
scripts/       End-to-end test
docs/          Architecture, protocol, decisions, roadmap
```
