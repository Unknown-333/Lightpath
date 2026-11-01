# Output-size stub (scratch)

`stub-server.mjs` is the zero-dependency stub MCP server behind the output-size experiment in [docs/research/agent-mcp-behavior.md](../../../docs/research/agent-mcp-behavior.md). It is not part of Lightpath and nothing imports it.

```sh
node stub-server.mjs 4k        # 1k | 4k | 10k | 25k | 50k tokens (chars / 4)
STUB_LOG=calls.jsonl node stub-server.mjs 10k
```

It serves one tool, `find_code_for_action`. The tool returns a trace in the shape `packages/mcp/src/format.ts` prints, with one fact line (`gift-card-redeem.ts`) in the middle and a marker on the last line.
