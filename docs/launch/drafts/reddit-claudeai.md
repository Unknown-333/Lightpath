> Draft for the owner to rewrite in his own words; HN and some subreddits don't allow AI-written posts.

# r/ClaudeAI draft

## Rules

Reddit blocked both web fetch and firecrawl on 2026-11-04, so the live rules page could not be read. These come from the [archived rules page, snapshot 2026-08-23](http://web.archive.org/web/20260823233716/https://old.reddit.com/r/ClaudeAI/about/rules/), as summarised in `docs/research/growth-study.md`. Reread [the live page](https://www.reddit.com/r/ClaudeAI/about/rules/) before posting.

- Promotion is allowed if you built it with or for Claude, say clearly how Claude helped, say it is free to try, keep promo language low, and use no referral links.
- Posting needs over 50 karma.
- Vote manipulation is a permanent ban.

The owner must fill in how Claude helped build Lightpath; this draft can't know that.

## Title

I built an MCP server that shows Claude which lines a click ran in your app (free, open source)

## Body

Lightpath is a free, MIT-licensed MCP server for React + Node apps. Claude calls `run_action` with a button label, Lightpath clicks it in its own Chrome, and returns the lines that ran in the browser and on the server, from V8's coverage. It also marks the lines inside each function that didn't run. Everything stays on localhost.

Setup in your app's folder:

```
npx @lightpath-dev/cli init --agent claude-code
npx @lightpath-dev/cli doctor
```

How Claude helped: [owner: fill in].

I tried one planted bug both ways, once each, with Claude Sonnet 5.5 in Kiro CLI, at most 5 steps. The bug: "I click Mark as paid and Outstanding doesn't drop." With Lightpath, the trace said `getSummary 14-28 ×1 not run: 16-27`, so the totals came from a cache. Without Lightpath, Claude found the same cache with a text search. Both made the same fix at step 4. The run without Lightpath used about half the tokens (estimated 2,289 vs 4,385). So for this easy bug, it didn't help. It's one run each, not a benchmark; the transcripts are in the repo.

Honest limits: Chrome or Edge only, Node backends, and clicks plus Enter/Space only. I've only run it for real with Kiro. With Claude Code, the setup is tested in CI, but how Claude Code picks the tool is from its docs.

Case study and transcripts: https://github.com/Unknown-333/Lightpath/blob/main/docs/LAUNCH_CASE_STUDY.md
