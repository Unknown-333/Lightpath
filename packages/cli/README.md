# @lightpath-dev/cli

[![npm](https://img.shields.io/npm/v/@lightpath-dev/cli?label=npm&color=cb3837)](https://www.npmjs.com/package/@lightpath-dev/cli)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/lightpath-dev.lightpath-vscode?label=VS%20Code&color=007acc)](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode)
[![CI](https://github.com/Unknown-333/Lightpath/actions/workflows/ci.yml/badge.svg)](https://github.com/Unknown-333/Lightpath/actions/workflows/ci.yml)

**Click anything in your running app and see the exact code it ran, frontend and backend, line by line.**

No code changes, no test suite, no tracing setup.

![Clicking Add to cart and Checkout in the example shop lights up Cart.tsx and the order route in VS Code](https://raw.githubusercontent.com/Unknown-333/Lightpath/main/docs/media/demo.gif)

## Quick start

Requires Node.js 22.12+ and Chrome or Edge.

```sh
npx @lightpath-dev/cli dev -- npm run dev
```

Lightpath starts your dev command, finds your app's URL, and opens the app in a browser. Click something, and the code path prints in your terminal:

```
◆ button: Checkout 335 ms
  → POST /api/orders 201
  ├─ src/api.ts :25-32, 35-36
  ├─ src/App.tsx :6-8, 10, 12, 24-41, 43 ×6
  ├─ src/Cart.tsx :11-14, 16-19, 21-28, 30-33, 35-44, 46-48, 50 ×4
  ├─ src/money.ts :3-5 ×9
  ├─ server/db.ts :26-28, 30-38 ×3
  ├─ server/routes/orders.ts :11-14, 19-21, 25, 29, 31-33, 38-40
  ├─ server/services/payment.ts :6-7, 10-12
  └─ server/services/pricing.ts :12-19, 21-22, 26-33
```

To see the lines light up in your editor, add the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode):

```sh
code --install-extension lightpath-dev.lightpath-vscode
```

To let your coding agent ask "which code handles Checkout?", add the MCP server. For Claude Code:

```sh
claude mcp add lightpath -- npx -y @lightpath-dev/cli mcp
```

Setup for Cursor, VS Code and Kiro is in [the main README](https://github.com/Unknown-333/Lightpath#ask-your-coding-agent).

## Commands

| Command            | What it does                                             |
| ------------------ | -------------------------------------------------------- |
| `lightpath dev`    | Runs your dev command with Lightpath and opens your app  |
| `lightpath mcp`    | MCP server over stdio, so coding agents can ask what ran |
| `lightpath doctor` | Checks Node, the browser, the agent and your config file |

Everything stays on your machine: the daemon listens on `127.0.0.1` only and needs a token.

## More

- [Config file](https://github.com/Unknown-333/Lightpath#config-file): save your flags and hide generated code.
- [How it works](https://github.com/Unknown-333/Lightpath#how-it-works) and [performance](https://github.com/Unknown-333/Lightpath#performance).
- [Known limits](https://github.com/Unknown-333/Lightpath#known-limits) and [real apps it was tested on](https://github.com/Unknown-333/Lightpath#tested-on-real-apps).
- [Issues](https://github.com/Unknown-333/Lightpath/issues) and the [changelog](https://github.com/Unknown-333/Lightpath/blob/main/CHANGELOG.md).

MIT licensed.
