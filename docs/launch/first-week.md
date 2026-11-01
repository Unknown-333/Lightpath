# First week after launch: how we answer

A plan for the 7 days after the Show HN post (day L in [plan.md](plan.md)). The goal: every stranger who tries Lightpath and writes to us gets a fast, useful, honest answer. Issues and PRs from strangers are one of the owner's success measures, and a quick first reply is the part we control.

Every reply on HN, Reddit, X or GitHub is posted by the owner, in his own words. The templates below are starting points to rewrite, not text to paste: HN and several subreddits remove LLM-written posts and comments (growth-study.md, "Rules we must follow").

## Reply times

| Where                                  | First reply within                          | Who                             |
| -------------------------------------- | ------------------------------------------- | ------------------------------- |
| HN thread, first 3 hours after posting | 15 minutes                                  | Owner, at the keyboard          |
| HN thread, rest of day L and L+1       | 2 hours while awake                         | Owner                           |
| GitHub issue: setup failure or crash   | 4 hours while awake, 12 hours at most       | Owner; lead prepares a draft    |
| GitHub issue: other                    | 24 hours                                    | Owner; lead prepares a draft    |
| GitHub PR from a stranger              | First comment in 24 hours; review in 3 days | Owner; lead runs CI and reviews |
| Reddit and X replies                   | 12 hours                                    | Owner                           |

"First reply" means a real answer or a clear next step, not "thanks, looking". These targets are ours, not measured from other projects. HN's guidance asks the poster to be there to answer, which is why the first 3 hours are blocked out (growth-study.md: 16:00 UTC is 21:45 in Nepal, so the owner's evening is the launch window).

## Each morning and evening (day L to L+7)

1. Open new issues, PRs and discussions: `gh issue list --repo Unknown-333/Lightpath --state open --search "sort:created-desc"` and `gh pr list --repo Unknown-333/Lightpath`.
2. Label each issue (labels from [good-first-issues.md](good-first-issues.md)): `bug`, `setup`, `unsupported-stack`, `enhancement`, `question`, `tested-app`, `needs-repro`.
3. Reply, using the templates below as a base.
4. A bug that blocks setup for more than one person goes first. Fix it on a branch with a test and a decision entry, and ship a patch release if it's in a published package (the owner publishes, as for every release, `docs/RELEASE.md`).
5. Write down what came in, in `docs/launch/week1-log.md` (created on day L): date, link, kind, time to first reply, outcome. This is the data for the owner's after-launch measures. Count only what happened.

## Triage

| What came in                                      | Label               | First step                                                                                                                                              |
| ------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`, `doctor` or the agent can't see the tools | `setup`             | Ask for `npx @lightpath-dev/cli doctor` output, OS, Node version and agent. Try to reproduce in a fresh folder the same day                             |
| A click shows the wrong lines, or no lines        | `bug`               | Reproduce in `examples/shop` first. If it doesn't reproduce there, ask for the stack and a public repo                                                  |
| A framework or runtime we don't trace             | `unsupported-stack` | Say plainly whether it's on the roadmap (Next.js, then WebSocket, then Python after 0.1.0). Ask for a public app to test                                |
| "It worked on my app" or "it partly worked"       | `tested-app`        | Thank them, ask for the app and stack if missing, add a row to `docs/tested-apps.md` with credit                                                        |
| An idea for a feature                             | `enhancement`       | Ask what they were trying to do. Link the roadmap. No promises of dates                                                                                 |
| No steps, private app, can't reproduce            | `needs-repro`       | Ask for the smallest app or steps that show it. Close after 14 days with no reply, with a note that it can be reopened                                  |
| A security problem                                | none in public      | Ask them to send details through GitHub's private vulnerability reporting instead of the issue (Proposed decision 5 in plan.md). Fix before saying more |
| A benchmark question or a doubt about a claim     | `question`          | Answer with the result file and its limits. If the claim was wrong, fix the README the same day and say so                                              |

## Reply templates

Rewrite each in your own words before posting. Fill in the parts in angle brackets.

### Setup failure

> Thanks for trying it, and sorry it didn't start. Could you run `npx @lightpath-dev/cli doctor` in the project folder and paste the output here, with your OS, Node version and which agent you use? Doctor checks the agent config `init` wrote and starts the server offline, so its output usually shows where it broke. Please remove anything private from the paste.

When the cause is known:

> This is <cause>. A fix is in <PR link>. Until it's released, <workaround>. I'll post here when the release is on npm.

### Unsupported framework or runtime

> Lightpath doesn't trace <stack> yet. Today it covers Chromium browsers and Node backends per HTTP request; the full list is in the README's "Known limits". <Next.js / WebSocket / Python> is next on the roadmap after 0.1.0, in that order. If you can point me at a public app that uses <stack>, I'll run Lightpath on it and post what it shows here.

### Feature request

> Thanks. What were you trying to do when you wanted this? Lightpath adds a feature only when it helps people find the code that ran, so the use case matters more than the shape. I've labelled it `enhancement`; <the roadmap has it / it isn't planned yet, but this issue stays open for others to add their case>.

### Bug in a real app

> Thanks for the detail. I'll try to reproduce it in the example shop first. If it doesn't show there, could you share the app (or a small copy of the part that breaks), the stack with versions, and what you clicked? If it's a real bug in Lightpath, the fix will come with a test and a note in `decisions.md`, and the app goes in `docs/tested-apps.md` if you're happy to have it listed.

### "Does Lightpath really help agents fix bugs?"

> Here's what we measured: <facts.md row and its result file>. <If the with-Lightpath runs didn't beat the baseline: say so, with the numbers.> What it does do, and what the tests check, is give the agent the exact lines one click ran, browser and server. The method and every run are in <bench/agent-suite/results/…>.

### A PR from a stranger

> Thanks for this! CI is running. <One specific comment on the change.> CONTRIBUTING.md asks for a test and, for a behaviour change, a short entry in `decisions.md`; I can help with the entry if you'd like.

## What we don't do

- Ask anyone to star, upvote or share, in replies or anywhere else.
- Ask friends or teammates to comment on the HN thread or the subreddit posts.
- Argue with criticism. Answer the facts, fix what's wrong, and thank them.
- Delete and repost the HN post.
- Promise dates for features.
- Post outside the launch plan's places, or message people who didn't ask.

## End of week

On L+7, the lead writes a one-page summary from `docs/launch/week1-log.md` for the owner: issues and PRs from strangers (counts, kinds), median time to first reply, the setup failures and what fixed them, and the stars and where they came from (GitHub's traffic page, read by the owner). Then the owner decides what goes into the next release.
