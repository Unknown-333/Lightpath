# Browser-control prototypes

Throwaway scripts behind [docs/research/browser-control.md](../../../docs/research/browser-control.md). They use the built packages as they are; nothing in `packages/` changes.

Run `pnpm build` first. Every script starts its own daemon, the example shop (under the Node agent) and a `BrowserCollector`, and stops them at the end. They write raw output to `--out <dir>` (default `./browser-raw`).

| Script                                            | What it does                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `run.mjs <method> [--headed] [--n 20]`            | Add to cart (Coffee mug) then Checkout, N times, with one control method from `methods.mjs`. One JSON line per action.                                                                     |
| `compare.mjs`                                     | Compares every run with the human-style press (`pw-mouse-hold`): label, files, lines, boundary, request, response line, time to trace.                                                     |
| `inputs.mjs`                                      | Nearby inputs on `probe/`: pointerdown code, no request, a link, a form with Enter, a missing target, two quick presses.                                                                   |
| `targets.mjs`                                     | How an agent can name a target: text, role and name, CSS, accessibility-snapshot ref.                                                                                                      |
| `attach-mcp.mjs <devtools\|playwright> <scratch>` | Attaches Chrome DevTools MCP or Playwright MCP to Lightpath's Chrome through a CDP port opened for the prototype only. The MCP servers are installed in a scratch folder, not in the repo. |

The shop's ports are fixed in `examples/shop` (3001 and 5173). To run beside another copy, change them locally and don't commit that.
