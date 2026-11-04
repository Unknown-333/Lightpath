# How coding agents pick and use MCP tools, and the token budget N

Phase 1 research, work item it_8e29b34a. Written 2026-11-01. Owner's ask served: "How Claude Code, Cursor, VS Code and Kiro choose and use MCP tools: description wording, output limits, why agents ignore a tool. Find documented size or token limits; propose token budget N", and "What output size do agents actually handle?" answered by experiment.

## Result

| Output size (chars/4) | Chars   | Right answer (Kiro CLI, Sonnet 5.5) | What the model received                    |
| --------------------- | ------- | ----------------------------------- | ------------------------------------------ |
| 1k tokens             | 4,039   | 3 of 3                              | all of it                                  |
| 4k tokens             | 16,014  | 3 of 3                              | all of it                                  |
| 10k tokens            | 40,062  | 0 of 3                              | first 500 + last 500 chars and a file path |
| 25k tokens            | 100,046 | 0 of 3                              | same                                       |
| 50k tokens            | 200,050 | 0 of 3                              | same                                       |
- **Proposed N = 4,000 tokens, enforced as at most 16,000 characters** per Lightpath tool result. It is the largest size that passed 3 of 3, and it sits under every cap found: Kiro CLI cuts at 30,000 chars (measured, not documented by Kiro; a first result, 3 runs per size), Copilot CLI saves to a file past 30 KB (from docs: issue S15), Claude Code saves to a file past 50,000 chars or 25,000 tokens and warns past 10,000 tokens (from docs: S1). The owner accepted N on 2026-11-01 ([D-109](../../decisions.md)).
- Kiro CLI's cut is a wall, not a slope. Past 30,000 chars the model saw only the head and tail (1,757 to 1,759 chars in all), and the fact in the middle was gone. All 9 cut runs said they could not answer; none made up an answer.
- Every agent now hides long output in a file instead of sending it inline (Claude Code, Cursor, Kiro, Copilot CLI). An agent without a shell or file-read tool can't get it back. So Lightpath must cut its own output to fit, ranked, with a line naming the drill-down call.
- Tool search is now the default in Claude Code, Kiro (IDE 1.3+, CLI V3) and Cursor: at session start the model sees tool names and the server's `instructions`, not full descriptions. Lightpath sets no `instructions` today.

Numbers from Claude Code, Cursor and VS Code come from their docs and issue trackers only. None of them can run headless here. Only Kiro CLI was measured. Every claim about Claude Code, Cursor or VS Code in this doc is from docs.

## The experiment

### Method

- **Stub server**: [`bench/prototypes/agent-mcp/stub-server.mjs`](../../bench/prototypes/agent-mcp/stub-server.mjs), zero dependencies, MCP over stdio. One tool, `find_code_for_action`, with the same name, description and input schema as `packages/mcp/src/server.ts`. It returns text in the shape `describeTrace()` in `packages/mcp/src/format.ts` prints: a `Trace t_…: click button "Place order"` header, two `request:` lines, one `  <path> [node|browser] lines <ranges> (max N hits)` line per file, a `not shown:` line, and a last-line marker `ZK-<size>-END`.
- **The fact**: one line in the middle, `src/server/billing/gift-card-redeem.ts [node] lines 214-231, 240 (max 3 hits)`. It is line 29 of 56 at 1k and line 1,301 of 2,600 at 50k. The filler is seeded random, so every run of one size got the same bytes (sha256 prefixes in `trace-sizes.txt`).
- **Sizes**: 1k, 4k, 10k, 25k and 50k tokens, counted as characters / 4. No Claude tokenizer runs offline, and Anthropic's token-count API would send the text off this machine. A rough cross-check from Kiro's own context meter: 4k runs peaked at 1.33% of the 1M window and 1k runs at 1.1%, about 2,300 tokens for 11,975 more chars. So chars/4 likely overstates tokens for this text, which makes N safe.
- **Agent**: `kiro-cli` 2.37.0, `kiro-cli chat --no-interactive --output-format stream-json --agent lp-stub-<size> --model claude-sonnet-5.5`. `stream-json` ran the V3 engine at effort `high`. The pinned agent config lists only the stub server, `tools` and `allowedTools` set to `@lightpath`, and `includeMcpJson: false`, so the owner's global MCP servers were not loaded (checked: the run's tool catalog names only `lightpath`).
- **Question** (same every run): "In my shop app, which file and which lines handle redeeming a gift card when I click "Place order"? Use the Lightpath tool to find out. Answer with the file path and the line numbers that ran. Then, on its own line, quote the last line of the tool output exactly."
- **Scoring**: right only if the answer names `src/server/billing/gift-card-redeem.ts` and both `214-231` and `240`. The quoted last line shows whether the tail reached the model. The tool-result text in the event stream shows how much reached it.
- **Budget**: 1 setup try (it worked first time) and 15 runs, 3 per size. CPU load was read before and after each run; when it was over 20% the runner waited 60 s and read again.

### Per-run data

| Run    | Right | Chars received | Tool calls | Credits | Turn (s) | Wall (s) | CPU start / end (%)          |
| ------ | ----- | -------------- | ---------- | ------- | -------- | -------- | ---------------------------- |
| 1k-r1  | yes   | 4,039          | 1          | 0.1205  | 7.8      | 13.6     | 11.8 / 23.1                  |
| 1k-r2  | yes   | 4,039          | 1          | 0.0803  | 7.9      | 13.3     | 43.7, after wait 16.9 / 13.4 |
| 1k-r3  | yes   | 4,039          | 1          | 0.0832  | 6.9      | 12.3     | 10.2 / 10.3                  |
| 4k-r1  | yes   | 16,014         | 1          | 0.1680  | 7.0      | 12.3     | 11.3 / 15.1                  |
| 4k-r2  | yes   | 16,014         | 1          | 0.0905  | 7.9      | 13.4     | 20.9, after wait 10.6 / 9.4  |
| 4k-r3  | yes   | 16,014         | 1          | 0.1778  | 7.6      | 12.1     | 32.0, after wait 7.1 / 8.9   |
| 10k-r1 | no    | 1,757          | 1          | 0.1760  | 11.1     | 15.9     | 10.4 / 14.1                  |
| 10k-r2 | no    | 1,757 + 1,757  | 2          | 0.2453  | 15.5     | 20.8     | 5.5 / 13.3                   |
| 10k-r3 | no    | 1,757 + 1,757  | 2          | 0.2335  | 16.8     | 22.5     | 5.7 / 14.0                   |
| 25k-r1 | no    | 1,758 + 1,758  | 2          | 0.2508  | 14.6     | 20.3     | 12.4 / 6.9                   |
| 25k-r2 | no    | 1,758 + 1,758  | 2          | 0.2460  | 15.4     | 21.0     | 12.9 / 12.1                  |
| 25k-r3 | no    | 1,758 + 1,758  | 2          | 0.2225  | 30.4     | 35.4     | 13.4 / 21.4                  |
| 50k-r1 | no    | 1,759 + 1,759  | 2          | 0.2470  | 14.7     | 20.2     | 10.7 / 36.5                  |
| 50k-r2 | no    | 1,759 + 1,759  | 2          | 0.2368  | 13.5     | 19.2     | 10.9 / 22.5                  |
| 50k-r3 | no    | 1,759 × 3      | 3          | 0.2811  | 16.5     | 22.3     | 28.5, after wait 16.5 / 22.7 |

Per size (from `summary.txt`): mean credits 0.095 (1k), 0.145 (4k), 0.218 (10k), 0.240 (25k), 0.255 (50k). Mean turn time 7.5 s at 1k and 4k, 14.5 to 20.1 s above. Runs with CPU over 20% at start or end: 1k-r1, 1k-r2, 4k-r2, 4k-r3, 25k-r3, 50k-r1, 50k-r2, 50k-r3. Load can change time, not right or wrong.

### What Kiro CLI did past the cap

The model got this instead of the result (10k run, paraphrased): the output of `mcp_lightpath_find_code_for_action` (40,062 chars) went past the 30,000-char limit; here are the first 500 and last 500 chars; retry with narrower arguments, or read the full output saved under `~/.kiro/sessions/…/tool-outputs/…txt` with targeted shell commands. The event metadata calls this `outputTransformation: offloaded`.

The pinned agent had no shell or file-read tool, so the file was out of reach. In the 9 cut runs the model called the tool 1 to 3 times (18 calls), then explained it could not see the middle. 8 of 9 retried, with `Place order` again or `Place order gift card` (`stub-calls.jsonl`). The tool has no way to narrow its output, so each retry got the same bytes. Cut runs cost 2.3 to 2.7 times the mean credits of 1k runs.

This 30,000-char cap is not in Kiro's docs. I searched the MCP usage, Tool Search and settings pages (S17, S19).

### Limits of this experiment

- One model, one agent, one question. The prompt told the agent to use Lightpath, so this does not test whether an agent picks Lightpath on its own. The seeded-bug suite should measure that.
- An agent with a shell might recover the fact from the saved file. Not measured: it was outside the 15-run budget. Even if it works, it costs extra calls.
- 4k is the largest passing size measured. Sizes between 16,014 and 30,000 chars were not run. Kiro would pass them whole, but whether the model finds a middle fact there was not tested.

## Desk research

All sources were read 2026-11-01. Vendor docs describe the vendor's own product; S5's token saving is a vendor claim.

### How each agent picks a tool

Claude Code, Cursor and VS Code columns: from docs. Kiro: from docs and the runs above.

|                           | Claude Code                                                                                    | Cursor                                                                        | VS Code (Copilot agent mode)                                                       | Kiro (IDE and CLI)                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| What the model sees first | Tool names and server `instructions`; full definitions load through tool search (default) (S1) | Tool names; descriptions are synced to files the agent reads when needed (S5) | Full tools up to a threshold; past it, groups hide behind `activate_*` stubs (S13) | IDE 1.3+ and CLI V3: a deferred catalog, then `tool_load`, then `tool_call` (S17); seen in every run here |
| Description cut           | 4,096 chars upfront, 16,384 via tool search; server instructions 4,096 (S1)                    | Shortened with a `[truncated]` marker in tool discovery (S6)                  | Not found                                                                          | Not found                                                                                                 |
| Tool count limit          | None fixed; the context window (S1)                                                            | ~40 per third-party posts (S23); not in Cursor's docs                         | 128 per request, hard error "Tool limit exceeded (132/128)" (S12, S13)             | None found; V2 tool search starts at 5% of context or 50,000 tokens (S17)                                 |
| Tools dropped             | Invalid input schema, or full name over 128 chars (S1)                                         | Only the first page of a paginated `tools/list` (S9)                          | Not found                                                                          | Workspace custom agents not getting MCP tools (S22, kiro-cli bug report)                                  |

Anthropic's guidance (S2) applies to all four: a few tools aimed at real tasks instead of one per endpoint; names and descriptions written as you would explain them to a new hire; inputs named without ambiguity; high-signal output with readable names instead of IDs; pagination, filtering or truncation with sensible defaults; and when output is cut, a message telling the agent how to get the rest.

### Output limits for one tool result

Claude Code, Cursor and VS Code rows: from docs. Kiro CLI row: measured.

|                     | Documented or measured cap                                                                                                                                                                                      | Past the cap                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code         | Warning at 10,000 tokens; `MAX_MCP_OUTPUT_TOKENS` default 25,000; 50,000 chars for text whatever the token count; a tool can raise its own cap with `_meta["anthropic/maxResultSizeChars"]`, up to 500,000 (S1) | Saved to a file under `~/.claude/projects/`; the model gets the path. Error results over ~11,000 chars keep the first and last 5,000 (S1)                                            |
| Cursor              | No number documented                                                                                                                                                                                            | Saved to a workspace file with a pointer; the agent tails or reads it (S5, S6). Inline cut only if the file write fails (S6). A January 2026 regression caused compaction loops (S7) |
| VS Code             | No number documented; an issue shows results of 50 KB+ cut (S14)                                                                                                                                                | Cut with `isTruncated` and a resource URI the agent could not read (S14, closed 2026-10-26). Copilot CLI saves past 30 KB to a file (S15)                                            |
| Kiro CLI 2.37.0, V3 | **30,000 chars: measured, not documented by Kiro** (first result, 3 runs per size)                                                                                                                              | Model gets 500 head + 500 tail chars and a file path; full text in the session's `tool-outputs/` folder                                                                              |

Other result types (S1, S4, S10, S20): MCP lets a result carry `structuredContent` that matches an `outputSchema`, and the spec says such a tool SHOULD also send the same JSON as text. Claude Code shows images inline and saves the original. Cursor and VS Code support MCP Apps (interactive UI). VS Code can browse resources. Plain text is the one format every client sends to the model, so Lightpath should keep text as the main result.

### Where each agent reads project instructions

All rows: from docs.

| Agent             | Files                                                                                                                        | Note                                                                                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code       | `CLAUDE.md` or `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`, `~/.claude/CLAUDE.md`                           | Reads `AGENTS.md` only when no `CLAUDE.md` or `CLAUDE.local.md` exists at or above the working directory (default setting). An `@AGENTS.md` line in `CLAUDE.md` imports it (S3) |
| Cursor            | `.cursor/rules/*.mdc` (frontmatter `description`, `globs`, `alwaysApply`), `AGENTS.md` in root and subfolders                | A plain `.md` in `.cursor/rules` is ignored (S8)                                                                                                                                |
| VS Code (Copilot) | `.github/copilot-instructions.md`, `AGENTS.md`, `.github/instructions/*.instructions.md`; `CLAUDE.md` for the Claude harness | Nested `AGENTS.md` needs a setting in the Local harness (S11)                                                                                                                   |
| Kiro              | `.kiro/steering/*.md`, `~/.kiro/steering/`, `AGENTS.md` (root, global, subfolders)                                           | `AGENTS.md` is always included. Custom agents don't load steering unless it is listed in `resources` (S18)                                                                      |

`AGENTS.md` reaches all four, with one gap: Claude Code skips it when the repo already has a `CLAUDE.md`.

### MCP config file and format per agent

All rows: from docs.

| Agent             | Project file                      | User file                                                     | Shape                                                                                               | Command line                                                                                                                                                         |
| ----------------- | --------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code       | `.mcp.json` at the repo root      | `~/.claude.json` (Windows `%USERPROFILE%\.claude.json`)       | `{"mcpServers": {"lightpath": {"command": "npx", "args": [...]}}}`; no `type` means stdio           | `claude mcp add lightpath -- npx -y @lightpath-dev/cli mcp` (`--scope project` writes `.mcp.json`). Project servers wait for approval in an interactive session (S1) |
| Cursor            | `.cursor/mcp.json`                | `~/.cursor/mcp.json`                                          | `mcpServers`, same shape; both files merged, project wins; restart Cursor (S4)                      | none documented                                                                                                                                                      |
| VS Code           | `.vscode/mcp.json`                | profile `mcp.json` (open with "MCP: Open User Configuration") | `{"servers": {"lightpath": {"type": "stdio", "command": "npx", "args": [...]}}}` (S10)              | `code --add-mcp '{"name":"lightpath","type":"stdio","command":"npx","args":[...]}'` writes the user profile (S10)                                                    |
| VS Code, portable | `.mcp.json` at the workspace root | `~/.copilot/mcp-config.json`                                  | `mcpServers` (S10)                                                                                  |                                                                                                                                                                      |
| Kiro              | `.kiro/settings/mcp.json`         | `~/.kiro/settings/mcp.json`                                   | `mcpServers`, plus `autoApprove` and `disabledTools`; agent config beats workspace beats user (S16) | `kiro-cli mcp add --name lightpath --scope workspace --command npx --args ...` (S16)                                                                                 |

The paths are the same on Windows, macOS and Linux, relative to the project or the home folder. The one exception is the VS Code profile file. Its location on disk differs per OS and is not given on the pages read, so `lightpath init` should use `code --add-mcp` or the workspace file instead of guessing.

On Windows, the owner's own `~/.kiro/settings/mcp.json` starts `npx` as `cmd /c npx`. Whether each client can start a bare `npx` on Windows was not checked. `lightpath doctor` should test that on Windows CI.

### Why agents ignore a tool

1. **The model never saw the tool.** Tool search hides full descriptions (Claude Code, Kiro V3, Cursor). The model chooses from the name and the server `instructions`. Past 128 tools VS Code errors or hides groups behind stubs (S12, S13). Cursor drops later pages of `tools/list` (S9).
2. **The tool was dropped.** Claude Code skips tools with an invalid schema or a full name over 128 chars (S1). Kiro had a bug where workspace custom agents got no MCP tools (S22). Claude Code holds `.mcp.json` servers until the user approves them (S1).
3. **The description was cut.** Past 4,096 chars in Claude Code (S1); shortened in Cursor's discovery (S6).
4. **The output was useless.** Past the cap the agent gets a preview and a file path. In this experiment that ended in "I can't tell" 9 of 9 times.
5. **Nothing told the agent when to use it.** Instructions files only work if the agent reads them. Claude Code skips `AGENTS.md` when `CLAUDE.md` exists (S3), and Kiro custom agents skip steering (S18). Anthropic adds that agents treat these files as context, not rules (S3).

## Recommendations

### Token budget N and drill-down

- **N = 4,000 tokens (chars/4) for the default output of every Lightpath tool, enforced as a hard cap of 16,000 characters.** Count characters, because the two hard walls found (Kiro 30,000 chars, Claude Code 50,000 chars) are in characters. 16,000 leaves room under the lowest wall for the header, a wrapping message, and a tokenizer that counts more tokens than chars/4.
- When a trace is bigger, Lightpath cuts it itself, never the client. Workspace files first, `background` files last, then by hit count. Keep every `request:` line. End with one line saying what was left out and the exact call that shows it, for example: `not shown: 412 more files (31,800 chars). Call get_trace with traceId t_… and file "billing" to see them.` This follows S2's advice to steer the agent when output is cut.
- **Drill-down** returns one trace narrowed by a file path or substring, under the same 16,000-char cap, paged with an explicit next-page line. When the executed-code slices from Phase 2 exist, they belong here, not in the default output.
- The "shop trace fits N" check should assert `text.length <= 16000` on the real shop trace in `pnpm e2e`. This doc does not measure the shop.

### Tool names and description wording

- Keep the four names: `find_code_for_action`, `get_trace`, `list_traces`, `diff_traces`. They are verb_noun, short, and namespaced by the client (`mcp__lightpath__…`, `@lightpath/…`). The model picked `find_code_for_action` from its description in 15 of 15 runs, though the prompt named Lightpath.
- Put the trigger words in the first sentence, and keep each description under 300 chars, far below the 4,096 cut. Suggested `find_code_for_action`: "Find the source files and lines that actually ran, frontend and backend, when the user did an action in the app (a click, form submit or request). Use it before searching files when asked which code handles a button or feature, or why an action fails. Input: words from the button or link label."
- Add a server `instructions` string (MCP `InitializeResult.instructions`), under 1,000 chars. With tool search on, this text and the tool names may be all the model sees before it decides. Suggested: "Lightpath records which code ran for each user action in a running app, from real runtime coverage, not static analysis. Use these tools when asked which code handles a UI action, why an action misbehaves, or whether a fix changed what runs. Output is capped at about 4,000 tokens; follow the 'not shown' line to drill down."

### Snippet for each agent's instructions file

`lightpath init` writes one marked block. It goes into `AGENTS.md` (created if missing), which covers Cursor, VS Code, Kiro, and Claude Code when no `CLAUDE.md` exists. When a `CLAUDE.md` exists, the same block goes there too. Generate the tool names from the server's tool list so the block can't drift.

```markdown
<!-- lightpath:start -->
## Lightpath: what code actually ran

This app runs under `lightpath dev`, which records the source files and lines that ran, frontend and backend, for each click or request.

- Asked which code handles a button, page or request, or why an action fails? Call the Lightpath MCP tool `find_code_for_action` with words from the button label before searching files.
- Output is capped. To see more of one trace, follow its "not shown" line.
- After a fix, have the action run again and compare the two traces with `diff_traces`.
- If Lightpath says it isn't running, ask the user to start `lightpath dev -- <dev command>`.
<!-- lightpath:end -->
```

Kiro reads `AGENTS.md` at the workspace root, so no extra `.kiro/steering` file is needed. A Kiro custom agent needs `"resources": ["file://AGENTS.md"]` to see it (S18). Cursor needs no `.mdc` file, since it reads `AGENTS.md` (S8).

## Proposed decisions

These are proposals. `decisions.md` is not edited here.

1. **Token budget N = 4,000 tokens, cap 16,000 chars per tool result.**
   - Why: the largest size that passed 3 of 3; under Kiro's 30,000-char wall, Copilot CLI's 30 KB and Claude Code's 10,000-token warning.
   - Alternatives: 7,000 tokens / 28,000 chars, just under Kiro's wall (sizes between 16,014 and 30,000 chars not measured); 25,000 tokens, Claude Code's default (fails Kiro, 0 of 9).
   - Evidence: the per-run table, `agent-mcp-raw/results.json`.
   - Revert: change one constant.
2. **Lightpath cuts and ranks its own output, ending with a "not shown … call X" line.**
   - Why: every client hides long output in a file; with no shell, recovery failed 9 of 9.
   - Alternative: set `_meta["anthropic/maxResultSizeChars"]`. It helps Claude Code only.
   - Revert: drop the ranking and print everything.
3. **Drill-down by file path or substring, same cap, paged.**
   - Why: S2's guidance; failed runs retried with the same words because the tool had no way to narrow.
   - Alternative: a `response_format: concise|detailed` switch (S2). Detailed would still hit the walls.
   - Revert: remove the parameter or tool.
4. **Add MCP server `instructions` (under 1,000 chars) and rewrite tool descriptions to put trigger words first (under 300 chars).**
   - Why: tool search shows names and instructions first (S1, S5, S17).
   - Alternative: leave descriptions as they are; they worked when the prompt named Lightpath.
   - Revert: delete the string.
5. **`lightpath init` writes the per-agent MCP config from the table above, plus the marked block in `AGENTS.md`, and in `CLAUDE.md` when that file exists.**
   - Why: `AGENTS.md` reaches all four agents except Claude Code when `CLAUDE.md` exists (S3, S8, S11, S18).
   - Alternative: one native file per agent (`.cursor/rules/*.mdc`, `.github/copilot-instructions.md`, `.kiro/steering/`). That means more files and more drift.
   - Revert: the block sits between markers, so it can be removed cleanly.
6. **Keep plain text as the main result. Add `structuredContent` later only if an agent needs it.**
   - Why: every client sends text to the model; the spec asks for a text copy anyway (S20).
   - Revert: n/a.

## Raw output

`C:\Users\user\lightpath-trials\goal\agent-mcp-raw\` holds:

- `stub-server.mjs`, the copy the runs used. It differs from the PR copy only in formatting; the trace sha256 values match.
- `run.ps1`, the runner.
- `analyze.mjs`, the scorer.
- `run/.kiro/agents/lp-stub-*.json`, the pinned agents.
- `runs/<id>/` with `stdout.jsonl`, `stderr.txt`, `meta.json` and `question.txt` for each run.
- `stub-calls.jsonl`, one line per tool call from the stub.
- `results.json`, `summary.txt` and `trace-sizes.txt`.
- `sources.md`, sources S1 to S23 with what each gave.

## Sources

Read 2026-11-01; content paraphrased.

- S1 [Claude Code: Connect to tools via MCP](https://code.claude.com/docs/en/mcp)
- S2 [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- S3 [Claude Code: Memory and CLAUDE.md](https://code.claude.com/docs/en/memory)
- S4 [Cursor: MCP integrations](https://cursor.com/help/customization/mcp)
- S5 [Cursor blog: Dynamic context discovery](https://cursor.com/blog/dynamic-context-discovery) (2026-01-06)
- S6 [Cursor forum: Cursor truncates MCP tool responses, staff reply](https://forum.cursor.com/t/cursor-truncates-mcp-tool-responses/168384/5) (2026-08-14)
- S7 [Cursor forum: context compacted loop with large responses](https://forum.cursor.com/t/regression-agent-context-compacted-loop-with-large-responses/148156) (2026-01-07)
- S8 [Cursor: Rules](https://cursor.com/docs/context/rules)
- S9 [Cursor forum: only the first page of tools/list registers](https://forum.cursor.com/t/mcp-cursor-only-registers-the-first-page-of-a-paginated-tools-list-doesnt-follow-nextcursor-14-tool-server-shows-8/165213/7)
- S10 [VS Code: MCP configuration reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)
- S11 [VS Code: Custom instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions)
- S12 [microsoft/vscode#290356: hard 128-tool limit](https://github.com/microsoft/vscode/issues/290356) (2026-01-26)
- S13 [microsoft/vscode#294055: tool virtualization threshold](https://github.com/microsoft/vscode/issues/294055) (2026-02-10)
- S14 [microsoft/vscode#311068: large MCP results truncated](https://github.com/microsoft/vscode/issues/311068) (2026-04-17)
- S15 [github/copilot-cli#1732: MCP responses cut to 10 KB before the 30 KB file save](https://github.com/github/copilot-cli/issues/1732) (2026-02-28)
- S16 [Kiro: MCP configuration](https://kiro.dev/docs/mcp/configuration.md)
- S17 [Kiro: Tool Search](https://kiro.dev/docs/mcp/tool-search.md)
- S18 [Kiro: Steering](https://kiro.dev/docs/steering.md)
- S19 [Kiro: MCP tools](https://kiro.dev/docs/mcp/usage.md) and [Kiro: Settings](https://kiro.dev/docs/reference/settings.md)
- S20 [MCP spec 2025-06-18: Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- S21 [aws-samples: Kiro agent JSON schema reference](https://github.com/aws-samples/sample-kiro-harness-hive/blob/main/skills/agent-harness/references/agent-schema.md)
- S22 [kirodotdev/Kiro#5873: MCP tools not injected for workspace agents](https://github.com/kirodotdev/Kiro/issues/5873) (from a search snippet; not opened)
- S23 Third-party posts claiming Cursor's ~40-tool limit: [picassoia](https://blog.picassoia.com/mcp-tool-limit-in-cursor-claude-and-vs-code-how-many-tools-fit), [markaicode](https://markaicode.com/integrate/cursor-with-mcp-server/) (search snippets; not confirmed in Cursor's docs)

Firecrawl could not be used. Its keyless endpoint refused this machine's IP and asked for an API key, and signing up is Tier 3. Pages were read with web fetch and web search instead.
