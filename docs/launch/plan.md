# Launch plan: date, order and reasons

Proposed for the owner to decide. Nothing here is posted or scheduled by us: the owner posts every item himself (Tier 3).

## The date

**Launch day L = day 7 after 0.1.0 is on npm, moved to the first Sunday that meets the gates below, at 16:00 UTC (21:45 Nepal time).**

**Proposed date: Sunday 2026-11-15, 16:00 UTC**, if 0.1.0 is on npm by Sunday 2026-11-08. Backup: Monday 2026-11-16, same hour.

If 0.1.0 reaches npm later, the next Sunday at day 7 or more is 2026-11-22, the start of US Thanksgiving week (Thanksgiving is Thursday 2026-11-26). growth-study.md avoided that week; we have no measured data on holiday weeks, so that is a judgement. The slot after it is **Sunday 2026-12-06**.

| 0.1.0 on npm by | Launch (L)                                                       | Day N                        |
| --------------- | ---------------------------------------------------------------- | ---------------------------- |
| Sun 2026-11-08  | Sun 2026-11-15                                                   | 7                            |
| Sat 2026-11-14  | Sun 2026-12-06                                                   | 22 (skips Thanksgiving week) |
| Sun 2026-11-29  | Sun 2026-12-06                                                   | 7                            |
| later           | first Sunday at day 7 or more, avoiding 2026-12-20 to 2027-01-03 | ≥ 7                          |

### Why 16:00 UTC on a Sunday

From growth-study.md (47,012 Show HN posts, 2025-11-01 to 2026-10-24, `hn-timing.txt`):

- Posts made at 16:00-16:59 UTC reached 50 points 3.93% of the time, against 2.91% for all hours. It was the best of the busy hours.
- By weekday, Sunday was highest (3.39% reached 50 points) and Wednesday lowest (2.66%). Monday was 3.10%.
- All three agent-tool posts in that study with over 100 points went up between 15:45 and 16:25 UTC.

The differences are small, and HN points didn't predict stars in that study. So the hour and day are cheap choices that help a little, not the reason the launch works.

### Why day 7, not day 1

1. **The Registry needs the published package.** The Official MCP Registry checks `mcpName` in the package on npm. It goes up on L-2 so clients can find Lightpath on launch day ([awesome-mcp.md](awesome-mcp.md)).
2. **The first install from npm must work.** A broken first run on launch day is the most costly failure. The counter-example in growth-study.md (MCP Node.js Debugger: 139 HN points, 301 stars, archived) asked for an app restart with a flag before any result. A week lets us run `init` and `doctor` from the npm package on a clean machine for each agent, and fix anything with a patch release.
3. **The facts sheet needs its numbers.** [facts.md](facts.md) has rows marked pending: the with-Lightpath benchmark runs, and time to first wow on 0.1.0. The owner's rule is to launch whatever they show, but the posts can't cite numbers that don't exist yet.
4. **The owner writes the posts by hand.** HN asks for posts written without LLM text (growth-study.md), and r/programming, r/cursor, r/webdev and r/mcp have the same rule. That takes time.

Why not later: the owner's goal is to ship 0.1.0 now, and no data in growth-study.md says a longer wait earns more stars.

### Gates (all true on L-2, or move to the next slot)

| Gate                                                                                                               | Who                             |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| 0.1.0 is on npm                                                                                                    | Owner publishes                 |
| `npx @lightpath-dev/cli@0.1.0 init --agent <agent>` and `doctor` pass from npm on a clean machine, all four agents | Lead, then owner checks         |
| README top section and the GIF are on `main`                                                                       | Lead (later item); owner merges |
| No row the posts will use is still "pending" in facts.md                                                           | Lead                            |
| Time to first wow measured on 0.1.0 from npm (`bench/first-wow`)                                                   | Lead                            |
| The owner has 3 free hours from 16:00 UTC on L, and time on L+1 to L+3                                             | Owner                           |

## The order

For L = Sunday 2026-11-15. Every item is posted by the owner. Subreddit rules were read from archived copies 2 to 4 months old (growth-study.md); reread each live rules page before posting.

| Day            | Date (if L = 11-15) | Where                                     | What                                                                      | Why                                                                                                                  |
| -------------- | ------------------- | ----------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| L-2            | Fri 11-13           | MCP Registry; mcpservers.org form         | Publish `server.json`; submit the form ([awesome-mcp.md](awesome-mcp.md)) | Clients and directories can find it on launch day. No audience needed                                                |
| L, 16:00 UTC   | Sun 11-15           | Show HN                                   | Owner-written post linking the GitHub repo                                | Best hour in the data. Link GitHub, not a website: Browser MCP's 616-point post went to a website and gave few stars |
| L, after HN    | Sun 11-15           | X                                         | A short thread with the GIF, linking the GitHub repo                      | The growers' jumps came from outside HN. Link the repo, not the HN post, so nobody reads it as a vote request        |
| L+1            | Mon 11-16           | r/mcp                                     | Disclosed "I built this" post with the showcase tag                       | Its rules allow it with disclosure and the tag                                                                       |
| L+2            | Tue 11-17           | r/ClaudeAI                                | Post that says it's free and how it works with Claude Code                | Its promotion rule asks for this. Posting needs over 50 karma                                                        |
| L+3            | Wed 11-18           | r/cursor                                  | Text post with context                                                    | Self-promotion is capped at 10% of your Reddit activity; spread out from the others                                  |
| First Saturday | Sat 11-21           | r/webdev                                  | Showoff Saturday, project flair                                           | The only day it's allowed                                                                                            |
| L+7            | Sun 11-22           | punkpeye/awesome-mcp-servers; TensorBlock | One-line PRs ([awesome-mcp.md](awesome-mcp.md))                           | The README is final by then, so the listing matches it                                                               |
| L+7 to L+10    | 11-22 to 11-25      | r/javascript; r/node                      | A post with code showing how the trace works                              | r/javascript wants code. r/node's rules couldn't be read; read them first                                            |
| After L+10     | Mon 11-30 or later  | r/programming                             | A technical write-up: V8 coverage and source maps to a per-click trace    | Only technical write-ups are allowed. After Thanksgiving week. The write-up isn't in this kit                        |

Every day from L to L+7, the [first-week plan](first-week.md) sets the reply times and triage.

## Proposed decisions

For the lead and the owner. `decisions.md` isn't edited by this item.

1. **Launch date: day 7 after 0.1.0 is on npm, on a Sunday at 16:00 UTC; proposed Sunday 2026-11-15.**
   - Why: the timing data and the four reasons above.
   - Alternatives: day 1 (no time for the Registry entry or an install test from npm); Sunday 2026-12-06, growth-study.md's earlier pick (tied to benchmark results first; the owner now launches whatever they show); a Tuesday (common advice, but 2.92% in the data, below Sunday and Monday).
   - Evidence: growth-study.md, "Launch order and timing".
   - Revert: pick another slot from the table; nothing is scheduled.
2. **Launch order: Registry at L-2, Show HN at L, X the same evening, subreddits by their own rules over 10 days, awesome-list PRs at L+7.**
   - Why: as in the order table. HN alone didn't make the growers.
   - Alternatives: all on day L (several subreddits limit self-promotion, and spreading out leaves time to answer).
   - Evidence: growth-study.md, "Rules we must follow" and "Proposed order".
   - Revert: reorder the table.
3. **Add `"mcpName": "io.github.Unknown-333/lightpath"` to `packages/cli/package.json` in the 0.1.0 release PR.**
   - Why: the Registry verifies an npm package by this field in the published package. Without it, listing needs another npm release.
   - Alternatives: skip the Registry (it is the one listing clients read); add it in 0.1.1.
   - Evidence: the Registry's quickstart and package-types pages (links in awesome-mcp.md).
   - Revert: remove the field; it has no runtime effect.
   - Tier: package metadata, not a dependency or config schema. It touches `packages/`, so the release item adds it, not this one.
4. **Four new issue labels: `tested-app`, `setup`, `needs-repro`, `unsupported-stack`.**
   - Why: the first-week triage sorts by them; the existing labels have no place for setup failures or "worked on my app" reports.
   - Alternatives: use only GitHub's default labels.
   - Evidence: `gh label list`, 2026-11-01 (10 labels, all GitHub defaults plus `accessibility`).
   - Revert: `gh label delete <name>`.
   - The owner creates them (commands in good-first-issues.md).
5. **Add `SECURITY.md` and turn on GitHub's private vulnerability reporting before launch.**
   - Why: the repo has neither, and the first-week plan needs a private place for security reports. Lightpath runs inside people's apps.
   - Alternatives: an email address in the README (public, spam).
   - Evidence: no `SECURITY.md` or `.github/SECURITY.md` at `agent-loop` e1ed568.
   - Revert: delete the file; turn the setting off.
   - Turning on the setting is a repository setting change: the owner does it. Writing `SECURITY.md` is a small separate item.
6. **No Glama badge in the awesome-list line for now.**
   - Why: punkpeye's rules don't ask for it, and claiming a Glama listing may need an account.
   - Revert: add the badge if the owner claims the listing.
7. **Reply-time targets and a week-1 log, as in first-week.md.**
   - Why: stranger issues and PRs are an owner success measure; a fast first reply is what we control; the log is the data for the after-launch report.
   - Alternatives: no targets (nothing to check against).
   - Revert: change the numbers in first-week.md.

## The launch kit, file by file

| Part                  | File                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Facts for the posts   | [facts.md](facts.md)                                                                                                             |
| awesome-mcp entries   | [awesome-mcp.md](awesome-mcp.md)                                                                                                 |
| A docs page per agent | [claude-code](../agents/claude-code.md), [cursor](../agents/cursor.md), [vscode](../agents/vscode.md), [kiro](../agents/kiro.md) |
| Issue templates       | `.github/ISSUE_TEMPLATE/`: bug report, feature request, "I tried Lightpath on my app" (already in the repo; unchanged here)      |
| CONTRIBUTING          | [CONTRIBUTING.md](../../CONTRIBUTING.md)                                                                                         |
| Good first issues     | [good-first-issues.md](good-first-issues.md), with the label and issue commands                                                  |
| First-week plan       | [first-week.md](first-week.md)                                                                                                   |
| Date and order        | this file                                                                                                                        |
| README top and GIF    | a later item                                                                                                                     |

## Open items

- The owner's Reddit karma and history decide whether r/ClaudeAI (over 50 karma) and r/cursor (10% rule) are open to him.
- r/node's rules and r/reactjs's details are unread (growth-study.md).
- The r/programming write-up and the X thread text aren't written; the owner writes posts, and the write-up would be a later item if wanted.
