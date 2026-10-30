# @lightpath-dev/daemon

The local daemon of [Lightpath](https://github.com/Unknown-333/Lightpath#readme). It receives coverage from the browser and backend agents, builds one trace per action, and serves traces to the editor and MCP clients. It listens on `127.0.0.1` only and requires a token.

You don't need this package directly; [`@lightpath-dev/cli`](https://www.npmjs.com/package/@lightpath-dev/cli) starts it.
