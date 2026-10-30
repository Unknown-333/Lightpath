# @lightpath-dev/cli

Click anything in your running app and see which frontend and backend lines ran.

```sh
npx @lightpath-dev/cli dev -- npm run dev
```

Lightpath starts your dev command, opens your app in Chrome or Edge, and prints the code each click ran. Requires Node.js 22.12 or newer.

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `lightpath dev`    | Runs your dev command with Lightpath and opens your app   |
| `lightpath mcp`    | MCP server over stdio, so coding agents can ask what ran  |
| `lightpath doctor` | Checks Node, the browser, the agent, and your config file |

Config file, MCP setup, and how it works: [the Lightpath README](https://github.com/Unknown-333/Lightpath#readme).
