# Lightpath

[Badge: npm]
[Badge: CI]
[Badge: MCP server]
[Badge: Node 22.12+]
[Badge: License: MIT]

**Show your coding agent the exact lines one click ran.**

Lightpath is an MCP server for React + Node apps. Your agent clicks a button in your running app and gets back the code that click ran, in the browser and on the server, line by line. It reads V8's own coverage, so it shows what ran, not a guess from file names.

[Animated GIF. Alt text: A user reports that Outstanding doesn't drop after "Mark as paid". The agent calls run_action, the trace shows getSummary returned early from a cache, and the agent adds the missing line]

<sub>A real kiro-cli run (claude-sonnet-5.5) on the example app `examples/invoices`, with one bug planted for the demo. Time is shortened; the run took 24 s. Transcript, frames and the scripts that made this GIF: [docs/media/demo-run](docs/media/demo-run).</sub>
