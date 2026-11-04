> Draft for the owner to rewrite in his own words; HN and some subreddits don't allow AI-written posts.

# Show HN draft

Rules read on 2026-11-04: [Show HN guidelines](https://news.ycombinator.com/showhn.html) and [HN guidelines](https://news.ycombinator.com/newsguidelines.html). In short: it must be something people can run, with no sign-up; title starts with "Show HN"; no uppercase or hype in the title; no generated or AI-edited text in posts or comments; don't ask anyone to upvote or comment.

## Title

Show HN: Lightpath – an MCP server that shows your agent which lines a click ran

## Text

Lightpath is an MCP server for React + Node apps. Your coding agent calls `run_action` with a button label. Lightpath clicks it in its own Chrome, and returns the lines that ran, in the browser and on the server, from V8's coverage. It also lists the lines inside each function that did not run. It runs on localhost only. Setup is `npx @lightpath-dev/cli init --agent claude-code` (or cursor, vscode, kiro), then `doctor`.

I tried it once on a planted bug in a small example app, with and without Lightpath (Kiro CLI, Claude Sonnet 5.5, at most 5 steps each). Both runs found the stale cache and made the same one-line fix at step 4. With Lightpath, the agent's one trace said `getSummary 14-28 ×1 not run: 16-27` before it opened the file. Without it, a text search found the cache by step 3, and that run used about half the tokens (estimated 2,289 vs 4,385). So on an easy bug it didn't help. That's one run each, not a benchmark, and all the raw transcripts are in the repo. Limits: Chrome or Edge only, Node backends, clicks and Enter/Space only, no WebSockets or Web Workers yet. Only Kiro has run it for real; the Claude Code, Cursor and VS Code setup is tested in CI. I'd like to hear where it misses on your app.

## Facts behind each claim

| Claim                                            | Source                                                               |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| one run each, both fixed it at step 4, same edit | `docs/LAUNCH_CASE_STUDY.md`, `docs/media/case-study/pass-*/run.json` |
| 2,289 vs 4,385 estimated tokens                  | the same `run.json` files, `tokens.tokensEst`                        |
| the trace line                                   | `docs/media/case-study/pass-B/run_action-output.txt`                 |
| limits                                           | README "Limits"                                                      |
| which agents are tested                          | README "Set up your agent"                                           |
