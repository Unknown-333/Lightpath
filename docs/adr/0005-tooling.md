# ADR 0005: Monorepo tooling

- Status: accepted
- Date: 2026-10-28

## Decision

| Concern                 | Choice                                                 | Why                                                                                                        | Rejected                                                        |
| ----------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Package manager         | pnpm workspaces (via corepack)                         | Strict dependency isolation catches missing deps; fast installs                                            | npm workspaces (hoisting hides missing deps), Yarn              |
| Language                | TypeScript, ES modules, `strict`                       | One language across agent, daemon, CLI, extension                                                          |                                                                 |
| Type checker            | `tsc -b` with project references                       | Incremental builds across packages; only `tsc` is used, so the TS 7 compiler rewrite doesn't break plugins | tsdown, tsup (an extra bundler isn't needed for Node libraries) |
| Library output          | `tsc` emits ES2023 JS plus `.d.ts` to `dist/`          | Node runs it directly; no bundling for libraries                                                           |                                                                 |
| VS Code extension build | esbuild bundle to one CommonJS file                    | Extensions load faster from one file, and `vsce` packaging is simpler                                      | Webpack                                                         |
| Lint and format         | Biome                                                  | One fast tool for both                                                                                     | ESLint + Prettier                                               |
| Tests                   | Vitest                                                 | Works with TypeScript and ESM without config                                                               | Jest, `node:test` (weaker watch mode and mocking)               |
| Python agent            | Standard library only, `pyproject.toml` with hatchling | Nothing to install inside the user's environment                                                           |                                                                 |

## Version pins (October 28, 2026)

TypeScript 7.0.2 (fallback 6.0.3 if a tool needs the JavaScript API), Vite 8.3.5, React 19.3.1, Playwright 1.64.1, ws 8.22.0, Vitest 5.0.5, Biome 2.6.3, esbuild 0.28.2, zod 4.6.7, `@modelcontextprotocol/sdk` 1.32.2, `@jridgewell/trace-mapping` 0.3.31, Node 24 LTS for development, Node 22+ supported at runtime.

## Naming

`lightpath` on npm and PyPI is taken by unrelated projects. Packages publish under the `@lightpath-dev` npm scope (unclaimed on October 28, 2026), with `@lightpath-dev/cli` providing the `lightpath` command. The Python agent publishes as `lightpath-agent`. Claim the scope and the PyPI name before announcing.
