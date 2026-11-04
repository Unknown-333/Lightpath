> Draft for the owner to rewrite in his own words; HN and some subreddits don't allow AI-written posts.

# X thread draft

No tracking links: use the plain GitHub URL.

## 1 (hook)

Your coding agent reads your code. It doesn't see which lines a click actually ran.

Lightpath is an MCP server that shows it: the agent clicks a button in your React + Node app and gets back the lines that ran, browser and server.

## 2

What comes back is short. On a planted bug ("I click Mark as paid and Outstanding doesn't drop"):

```
getSummary 14-28 ×1 not run: 16-27
markPaid 38-46 ×1
```

`getSummary` ran but skipped the lines that sum the totals. A stale cache.

## 3

I ran the same bug once without Lightpath, too. Same model, at most 5 steps each.

Both found the cache and made the same fix at step 4. Without Lightpath, it used about half the tokens.

On an easy bug like this, a text search is enough. One run each, not a benchmark.

## 4

Where it should matter: when reading the code doesn't tell you which branch ran.

Limits today: Chrome or Edge, Node backends, clicks and Enter/Space. Only Kiro has run it for real; Claude Code, Cursor and VS Code setup is tested in CI.

## 5 (call to action)

Two commands in your app's folder:

`npx @lightpath-dev/cli init --agent claude-code`
`npx @lightpath-dev/cli doctor`

The case study with both raw transcripts: github.com/Unknown-333/Lightpath/blob/main/docs/LAUNCH_CASE_STUDY.md

Tell me where it misses on your app.
