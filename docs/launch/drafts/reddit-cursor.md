> Draft for the owner to rewrite in his own words; HN and some subreddits don't allow AI-written posts.

# r/cursor draft

## Rules

Reddit blocked both web fetch and firecrawl on 2026-11-04, so the live rules page could not be read. These come from the [archived rules page, snapshot 2026-07-27](http://web.archive.org/web/20260727133900/https://old.reddit.com/r/cursor/about/rules), as summarised in `docs/research/growth-study.md`. Reread [the live page](https://www.reddit.com/r/cursor/about/rules/) before posting.

- Self-promotion is at most 10% of your Reddit activity, as a text post with context.
- A flair is required.
- No AI-generated content. This draft is only a list of facts to write from.
- No clickbait titles.

## Title

An MCP server that tells Cursor's agent which lines a click ran (React + Node)

## Body

I made Lightpath, a free, open-source MCP server for React + Node apps. The agent calls `run_action` with a button label. Lightpath clicks it in its own Chrome and returns the lines that ran, browser and server, from V8's coverage. It also lists the lines inside each function that didn't run. It runs on localhost only.

Setup for Cursor, in your app's folder:

```
npx @lightpath-dev/cli init --agent cursor
npx @lightpath-dev/cli doctor
```

That writes `.cursor/mcp.json` and keeps any other servers in it.

What I can say so far: I tried one planted bug both ways, once each (Kiro CLI, Claude Sonnet 5.5, at most 5 steps). Both runs found the stale cache and made the same fix at step 4. The run without Lightpath used about half the tokens. On this easy bug, it didn't help. It's one run each, not a benchmark.

What I can't say yet: I haven't run it inside Cursor. The Cursor setup is tested in CI on Linux, macOS and Windows, but how Cursor's agent picks the tool comes from Cursor's docs. If you try it in Cursor, I'd like to know whether the agent calls it on its own.

Limits: Chrome or Edge only, Node backends, clicks plus Enter/Space only, no WebSockets yet.

Case study and transcripts: https://github.com/Unknown-333/Lightpath/blob/main/docs/LAUNCH_CASE_STUDY.md
