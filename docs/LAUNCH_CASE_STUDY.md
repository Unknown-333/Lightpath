# Case study: one planted bug, with and without Lightpath

**This is one run per pass on a small example app with a planted bug. It is not a benchmark.** One run says what happened once. It says nothing about how often. For measured results over many runs, see [bench/](../bench/).

Run on 2026-11-04 on Windows, by the launch-kit worker (work item it_eb7c75d9). Raw files: [docs/media/case-study/](media/case-study/).

## Result

Both passes found the cause and made the same one-line fix. The hidden check passes after each edit. Without Lightpath, the agent got there with fewer tokens and in less time.

|                             | Pass A: without Lightpath                                       | Pass B: with Lightpath                                 |
| --------------------------- | --------------------------------------------------------------- | ------------------------------------------------------ |
| Steps (tool calls)          | 5, then stopped by the 5-step cap at its 6th call (a file read) | 5, finished on its own                                 |
| Step that made the edit     | 4                                                               | 4                                                      |
| Tokens, estimated (chars/4) | 2,289                                                           | 4,385                                                  |
| Credits                     | not reported (see below)                                        | 0.559                                                  |
| Wall time                   | 22.6 s                                                          | 35.5 s                                                 |
| Files read                  | 1 (`server/services/ledger.ts`), plus 3 text searches           | 1 (`server/services/ledger.ts`), plus 1 text search    |
| Lightpath calls             | 0                                                               | 1 `run_action` (with `includeCode`), after 1 tool load |
| Found the root cause        | yes                                                             | yes                                                    |
| Hidden check after its edit | pass                                                            | pass                                                   |
| The edit                    | `summaryCache = null;` added to `markPaid`                      | the same line, same place                              |

What each pass did, in order (from `run.json` in each pass folder):

| Step | Pass A                                      | Pass B                                       |
| ---- | ------------------------------------------- | -------------------------------------------- |
| 1    | search `Outstanding\|Mark as paid`          | load the Lightpath tools                     |
| 2    | read `ledger.ts`                            | `run_action` on "Mark as paid", Kestrel Labs |
| 3    | search `summaryCache\|markPaid\|getSummary` | read `ledger.ts`                             |
| 4    | edit `ledger.ts`                            | edit `ledger.ts`                             |
| 5    | search for other writes to `.status`        | search for other writes to `.status`         |
| 6    | (a file read: stopped here by the cap)      | (none: it answered)                          |

Pass A wrote "The cache is never invalidated. I'll invalidate it in markPaid." before its edit. Pass B wrote "The summary is served from a cache that markPaid never invalidates" after the trace and before it read the file. The trace showed `getSummary 14-28 ×1 not run: 16-27`: the function ran but skipped its summing lines.

Pass B's one `run_action` answer was 10,241 characters, because the agent asked for `includeCode`. Nothing told it to; the parameter's own description is the only mention. Without `includeCode`, the same trace is 1,568 characters (D1 below).

### What this shows, and what it doesn't

- The bug is easy to find by reading. `ledger.ts` is short, and the cache sits next to `markPaid`. A text search found it in 3 steps.
- Lightpath gave the agent runtime evidence: the click's request, and the lines of `getSummary` that didn't run. Here that evidence wasn't needed to fix the bug.
- Lightpath cost more here: about twice the estimated tokens, mostly the `includeCode` answer.
- Pass B's agent said it hadn't checked the fix in the running app, and it didn't. Neither pass re-ran the click.
- The bug was planted by us, in an app we wrote. The agent could not have seen this exact bug in training, but the pattern (a cache not cleared) is common.

## Setup

|                    |                                                                                                                                                                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lightpath          | 0.1.2 candidate: commit `645429001b7d7fe2f998b56267c53e856834bdf0` (PR #70, branch `test/accuracy-audit`), not published                                                                                                             |
| Packages installed | tarballs from `pnpm pack` of that commit: cli 0.1.2, mcp 0.1.2, daemon 0.1.2, core 0.1.2, protocol 0.1.2, browser 0.1.1, node-agent 0.1.0 (the versions in that commit's `package.json` files)                                       |
| Agent              | kiro-cli 2.37.0, model `claude-sonnet-5.5`, effort `medium`                                                                                                                                                                          |
| Node               | v24.13.0                                                                                                                                                                                                                             |
| App                | a copy of `examples/invoices` outside the repo, with its own `npm install`                                                                                                                                                           |
| Bug                | the line `summaryCache = null; // the totals changed` removed from `markPaid()` in `server/services/ledger.ts`, as in `examples/invoices/demo/record-run.mjs`. Planted file: [planted-ledger.ts](media/case-study/planted-ledger.ts) |
| Pass A             | no MCP server at all; Lightpath not installed in its copy                                                                                                                                                                            |
| Pass B             | `npx -y @lightpath-dev/cli@0.1.2 init --agent kiro` in its copy (npx used the installed tarball), then the agent file the benchmark's `with` condition uses: the server entry init wrote, and `AGENTS.md` as a resource              |
| Both               | the benchmark's agent file otherwise (`bench/agent-suite/lib/agent.mjs`): the same 5 built-in tools, the same shell deny rules, no global MCP servers                                                                                |
| App running?       | not at the start of either pass. In Pass B, Lightpath started it on the first `run_action`                                                                                                                                           |
| Step cap           | the harness counted tool calls and stopped kiro-cli at the 6th, so at most 5 ran                                                                                                                                                     |
| CPU load           | busy in both (other work was running): Pass A 35.1% at start, 52.6% at end; Pass B 38.5% and 65.4%. Times above are affected; steps and the fix are not                                                                              |

The prompt, the same in both passes, with the benchmark's safety line added:

> I click "Mark as paid" on the Kestrel Labs invoice. The row turns Paid, but Outstanding at the top stays at $42,485.50. Please fix it.
>
> Work only inside this folder, and don't stop processes you didn't start.

The hidden check calls the app's own route handlers: list the invoices, pay INV-2041 (Kestrel Labs), list again. It passes when Outstanding drops in the pay response and in the next list. With the bug planted it fails in every copy (Outstanding stays at 4,248,550 cents). On the unplanted app it passes (4,248,550 → 3,008,550). After each pass's edit it passes (4,248,550 → 3,008,550). See [setup.json](media/case-study/setup.json) and each `run.json`.

### Credits

kiro-cli reports credits only at the end of a turn. The cap stopped Pass A before that, and its session files have no credit record, so Pass A's credits are unknown. By its token estimate (about half of Pass B's), it likely cost less than Pass B's 0.559. That is an estimate, not a measurement. Test-run total for this item: 0.559 credits measured, plus Pass A's unknown amount.

## D1: setup and trace check

Before the agent runs, one script ran the README flow on a third copy of the app with the bug planted: init, doctor, then one `run_action` over MCP, started the way the Kiro config says (`cmd /c npx -y @lightpath-dev/cli@0.1.2 mcp`).

| Check                                     | Result                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `init --agent kiro`                       | wrote `.kiro/settings/mcp.json`, `lightpath.config.json`, `AGENTS.md` (1.9 s)           |
| `doctor`                                  | exit 0; every line passed; the server starts and lists 6 tools (4.5 s)                  |
| `run_action` "Mark as paid", Kestrel Labs | 1,568 characters, under 16,000 (4.8 s, including starting the app and browser)          |
| `getSummary`                              | `14-28 ×1 not run: 16-27`: correct, the cached copy was returned                        |
| `markPaid`                                | `38-46 ×1`, no not-run lines: correct, every line ran                                   |
| `payInvoice` (route)                      | `9-20 ×1 not run: 13-19`: correct, lines 13-19 are the `catch` block, and nothing threw |
| After closing the MCP client              | the app's port was free again                                                           |

No wrong line was found in this trace. Version 0.1.1 marked the same route `not run: 14-19`, leaving out the `catch` line itself (see the README's earlier 0.1.1 transcript). The 0.1.2 candidate includes it. Full answer: [d1/run_action.txt](media/case-study/d1/run_action.txt).

## Raw files

| File                                                                                                                     | What it is                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| [lk.mjs](media/case-study/lk.mjs)                                                                                        | the harness: makes the copies, runs D1, runs each pass with the step cap, runs the hidden check |
| [setup.json](media/case-study/setup.json)                                                                                | commit, tarballs, hidden-check results with the bug planted                                     |
| [d1/d1.json](media/case-study/d1/d1.json), [d1/run_action.txt](media/case-study/d1/run_action.txt)                       | D1 timings, doctor output, the checked lines, the full answer                                   |
| [pass-A/transcript.jsonl](media/case-study/pass-A/transcript.jsonl), [pass-A/run.json](media/case-study/pass-A/run.json) | Pass A: kiro-cli's stream-json output, and the counts above                                     |
| [pass-B/transcript.jsonl](media/case-study/pass-B/transcript.jsonl), [pass-B/run.json](media/case-study/pass-B/run.json) | Pass B: the same                                                                                |
| [pass-B/run_action-output.txt](media/case-study/pass-B/run_action-output.txt)                                            | Pass B's whole `run_action` answer                                                              |
| `pass-*/ledger-after.ts`                                                                                                 | `ledger.ts` after each pass's edit                                                              |

To run it again: build and pack that commit into `<raw>/tgz`, set `LP_KIRO_CLI`, then `node lk.mjs setup`, `node lk.mjs d1`, `node lk.mjs pass A`, `node lk.mjs pass B`. The paths at the top of `lk.mjs` are this machine's.
