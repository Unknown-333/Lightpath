# Growth study: how 7 developer tools got their stars, and what Lightpath can copy

Phase 1 research for the owner's ask: "Study 5 to 8 developer tools that grew fast in the last two years: what their README, demo and launch had in common, and what a first-time visitor sees in the first 10 seconds. Cite them, and say which lessons transfer to Lightpath."

All external pages were read on 2026-11-01 unless a date says otherwise. Raw output for every number is in `C:\Users\user\lightpath-trials\goal\growth-raw\` (file names given in each section). A project's claim about itself is marked **(own claim)**. Claims about Claude Code, Cursor or VS Code behaviour are marked **(from docs)**: we did not run those agents for this study.

## Result first

1. **Hacker News points did not predict stars.** The four fastest-growing MCP servers had launch-week HN posts with 4 to 19 points. The two agent-debugging tools with big Show HN posts (139 and 616 points) have 301 and 7,262 stars today. See [the table](#star-evidence).
2. **The big jumps came from somewhere that already had an audience.** Google's Chrome blog, Microsoft's Playwright team, a creator with a large following (Aiden Bai), and a viral product that named its dependency (Manus and Browser Use). This is an inference from timing; we could not read X/Twitter to confirm each post.
3. **Every fast grower's first screen says who it is for in under 10 words, and most say "agent".** "Chrome DevTools for coding agents", "Copy any UI element for your agent", "Up-to-date Docs for AI Agents", "The IDE for Your Coding Agent".
4. **The quick start is one command or one JSON block with `npx`.** No grower asks for code changes before the first result.
5. **Demos are short.** Measured GIFs: 9.0 s, 9.3 s, 20.4 s. The one long video (Serena, 61.5 s) sits under a "Demonstration" heading, not at the top.
6. **New rules matter more than timing.** Hacker News now asks for posts written by hand, without LLM text (dang, edited 2026-03-28). r/programming, r/cursor, r/webdev and r/mcp also ban LLM-written or "slop" posts. Every launch text in our kit must be rewritten by the owner in his own words before posting.
7. **Timing matters a little.** Over 47,012 Show HN posts in the last year, posts made at 16:00-16:59 UTC reached 50 points 3.93% of the time, against 2.91% overall. Weekday made less difference (2.66% to 3.39%).

## Method

- **Star counts.** The GitHub stargazer API with timestamps returned HTTP 404 for every repo we asked (`stargazer-api-404.txt`), so we read the star counter on archived copies of each repo page in the Wayback Machine (`wayback-stars.mjs`, output in `wayback-stars.txt`). Each count has its snapshot link. "Now" counts come from the GitHub REST API at 2026-11-01 04:18 UTC (`repos-now.tsv`). A repo created after 2024-11-01 had 0 stars on that date.
- **READMEs.** Read through the GitHub API at the HEAD commit on 2026-11-01 (`readme-tops.txt`, `readme-shas.tsv`) and at the last commit before each launch week (`readme-at-launch.txt`).
- **Demo length.** GIF frame delays and MP4 `mvhd` duration, measured from the downloaded files (`gif-length.mjs`, `gif-lengths.txt`).
- **Launches.** HN Algolia API (`hn-search.txt`, `hn-showhn-search.txt`, `hn-items.tsv`). Web search for blogs and news. X/Twitter and Reddit could not be read directly from this machine (Reddit returned a block page, `rules/_log.txt`). Firecrawl refused without a paid key from this network, before and after the owner's key change (`firecrawl-attempts.txt`).
- **Subreddit rules.** Latest Wayback copy of each `old.reddit.com/r/<sub>/about/rules` page (`wayback-rules.mjs`, `rules-clean.txt`).
- **Show HN timing.** Every Show HN post from 2025-11-01 to 2026-10-24, one API query per day, grouped by UTC hour and weekday (`hn-timing.mjs`, `hn-timing.txt`).

Choice of tools: the owner asked for tools that grew fast between November 2024 and November 2026, with at least 2 made for coding agents. Five of the seven are MCP servers or agent tools. Two of them (Chrome DevTools MCP, React Grab) are direct neighbours of Lightpath. We added one tool that launched the same way and did not grow (MCP Node.js Debugger), and one with a huge HN post and modest growth (Browser MCP).

## Star evidence

| Tool                                                                                      | Created    | Stars ~2024-11-01 | Launch-week                                           | ~1 month after | ~2025-11-01    | 2026-11-01    |
| ----------------------------------------------------------------------------------------- | ---------- | ----------------- | ----------------------------------------------------- | -------------- | -------------- | ------------- |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)              | 2025-09-11 | 0                 | 976 (09-24) → 8,050 (09-30)                           | 12,484 (10-24) | 13,554         | 54,572        |
| [Playwright MCP](https://github.com/microsoft/playwright-mcp)                             | 2025-03-21 | 0                 | 80 (03-23) → 5,904 (03-31)                            | 9,158 (04-28)  | 22,681         | 38,919        |
| [Context7](https://github.com/upstash/context7)                                           | 2025-03-26 | 0                 | 20 (04-02), 67 (04-09)                                | 4,211 (04-27)  | 35,855         | 64,030        |
| [Serena](https://github.com/oraios/serena)                                                | 2025-03-23 | 0                 | 22 (04-02) → 552 (04-16)                              | 831 (05-11)    | 15,202         | 30,962        |
| [React Scan](https://github.com/aidenybai/react-scan)                                     | 2024-09-02 | 156 (11-14)       | 1,260 (11-17) → 4,789 (11-26)                         | 10,635 (12-17) | 19,655 (11-09) | 21,880        |
| [React Grab](https://github.com/aidenybai/react-grab)                                     | 2025-10-17 | 0                 | 131 (10-24) → 1,192 (10-30)                           | 1,355 (11-13)  | 1,265 (11-03)  | 7,693         |
| [Browser Use](https://github.com/browser-use/browser-use)                                 | 2024-10-31 | not measured      | 33,119 on Launch HN day (2025-02-25) → 35,049 (03-04) | 49,592 (03-27) | 72,069         | 119,695       |
| _Did not grow:_ [MCP Node.js Debugger](https://github.com/workbackai/mcp-nodejs-debugger) | 2025-03-18 | 0                 | 63 (03-22)                                            | 219 (04-26)    | 278 (09-11)    | 301, archived |
| _Big HN, modest stars:_ [Browser MCP](https://github.com/BrowserMCP/mcp)                  | 2025-03-28 | 0                 | 107 (04-07) → 941 (04-16)                             | 1,247 (05-01)  | not measured   | 7,262         |

Snapshot links for every cell are in `wayback-stars.txt`. Examples: [Chrome DevTools MCP 2025-09-30](http://web.archive.org/web/20250930233801/https://github.com/ChromeDevTools/chrome-devtools-mcp), [Context7 2025-04-27](http://web.archive.org/web/20250427100651/https://github.com/upstash/context7), [React Scan 2024-11-26](http://web.archive.org/web/20241126102811/https://github.com/aidenybai/react-scan), [MCP Node.js Debugger 2025-04-26](http://web.archive.org/web/20250426150803/https://github.com/hyperdrive-eng/mcp-nodejs-debugger).

Limits of this data: snapshot dates are uneven, so "launch week" and "1 month" are the nearest snapshots, not exact days. Browser Use's README at launch has a stars badge for `gregpr07/browser-use`, so the repo was probably moved there from a personal account; we did not measure its count before December 2024. The 2025-11-03 React Grab count is lower than 2025-11-13 only because the snapshots differ by 10 days.

## The tools, one by one

Each entry has: the first screen (what a visitor sees before scrolling, at the commit named), the demo, and the launch.

### 1. Chrome DevTools MCP (Google)

- **First screen, launch week** ([README at 1ed7e45, 2025-09-23](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/1ed7e45fef695a6b5c1da0463b42b7eaa134cd20/README.md)): a title, one npm badge, then a two-line pitch: your coding agent can control and inspect a live Chrome. Three bold feature bullets (performance traces, network and console debugging, reliable automation). A "Disclaimers" block, then requirements, then a 7-line JSON config with `npx chrome-devtools-mcp@latest`. No image.
- **First screen now** ([README at 8d009e8, 2026-10-30](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/8d009e854f8aa55b1ec31628e836d4d4731b8ec8/README.md)): renamed "Chrome DevTools for agents", a row of doc links, and a "Usage statistics" section saying Google collects usage data by default, with an opt-out flag. That is a fact Lightpath can state fairly: Lightpath sends nothing off the machine.
- **Demo:** an embedded video in the [launch blog post](https://developer.chrome.com/blog/chrome-devtools-mcp) (2025-09-23). We did not measure its length. The post frames the problem as agents "programming with a blindfold on" and gives five copy-paste prompts, such as asking why images on localhost don't load.
- **Launch:** Chrome for Developers blog, 2025-09-23. The HN link that day got [19 points](https://news.ycombinator.com/item?id=45349829). Stars went from 976 to 8,050 in 6 days with no HN front page, so the traffic came from Google's own channels and from people sharing the blog (inference). A later HN post about a follow-up feature got [604 points on 2026-03-15](https://news.ycombinator.com/item?id=47390817).

### 2. Playwright MCP (Microsoft)

- **First screen, launch week** ([README at 8f3214a, 2025-03-25](https://github.com/microsoft/playwright-mcp/blob/8f3214a06ac6867dbd7299971a5bfa6426db995b/README.md)): one sentence: an MCP server that lets LLMs use web pages through accessibility snapshots, with no screenshots. Three bold bullets that each name a difference from screenshot tools. A use-case list. A JSON config with `npx @playwright/mcp@latest`, then a one-line VS Code CLI install. No image, no badges.
- **First screen now** ([be26c08, 2026-10-31](https://github.com/microsoft/playwright-mcp/blob/be26c080edfae7c761db1e757c4aff9f6453b4d7/README.md)): the top now tells coding-agent users that the team's CLI plus skills uses fewer tokens than the MCP server **(own claim)**, then one-click "Install in VS Code" badges **(from docs)**.
- **Demo:** none in the README.
- **Launch:** the repo was public on 2025-03-21. A Playwright team member's HN post on 2025-03-24 got [6 points](https://news.ycombinator.com/item?id=43465931). Stars went from 80 (03-23) to 3,692 (03-27) and 5,904 (03-31). A secondary source dates the release to 2025-03-22 and says X posts drove interest ([aiwiki, read 2026-11-01](https://aiwiki.ai/wiki/playwright_mcp); [Medium, 2025-04-28](https://medium.com/@bluudit/playwright-mcp-comprehensive-guide-to-ai-powered-browser-automation-in-2025-712c9fd6cffa)). We could not read the X posts.

### 3. Context7 (Upstash)

- **First screen, launch month** ([README at 30ab52a, 2025-04-11](https://github.com/upstash/context7/blob/30ab52ae794b698947c0a05296eb6b7127e08cac/README.md)): title "Up-to-date Docs For Any Cursor Prompt", then a "❌ Without Context7" list of three pains (old examples, made-up APIs, old versions) and a "✅ With Context7" section with three example prompts that end in `use context7`. Then a 3-step list: ask, add `use context7`, get working code. No image.
- **First screen now** ([7836c58, 2026-10-30](https://github.com/upstash/context7/blob/7836c583918374fbecffacf866afb7594b919466/README.md)): a cover image, "Add to Claude / ChatGPT / Cursor / VS Code" buttons, 16 language badges, the same Without/With block, and `npx ctx7 setup` as a one-command install. Setup now does an OAuth sign-in and creates an API key **(own claim)**; Lightpath needs no account.
- **Demo:** none in the README; the hook is the example prompt.
- **Launch:** a [Show HN on 2025-03-28 got 4 points](https://news.ycombinator.com/item?id=43507993). Upstash blogged an [intro on 2025-03-31](https://upstash.com/blog/context7-llmtxt-cursor) and the [MCP version on 2025-04-11](https://upstash.com/blog/context7-mcp). Stars stayed small (141 on 04-18) and then reached 4,211 by 04-27. We could not find the post that caused that jump.

### 4. Serena (Oraios)

- **First screen, mid-2025** ([README at 0401123, 2025-06-14](https://github.com/oraios/serena/blob/04011230081cfb54cd3b652d709273b8de837d9f/README.md)): a large logo, three emoji bullets (coding agent toolkit, IDE-like semantic tools, free and open source), then a 61.5-second demo video of Serena adding a feature to itself.
- **First screen now** ([ede329a, 2026-10-28](https://github.com/oraios/serena/blob/ede329aaf0c824bea75455a2926f01420d7aa620/README.md)): logo, the line "The IDE for Your Coding Agent", two badges, three bullets, a YouTube thumbnail, and a section quoting what AI agents said after an evaluation the authors designed **(own claim)**. Quoting agents as reviewers is close to a testimonial; under our hard lines Lightpath should show measured numbers instead.
- **Demo:** 61.5 s MP4 (measured).
- **Launch:** no HN launch found. Growth was slow for three months (22 → 947 from April to end of May 2025), then 3,365 by 2025-07-03 and 15,202 by 2025-11-02. We could not pin the cause; Serena issues show it was used with Claude Code by then (for example [issue #802](https://github.com/oraios/serena/issues/802)).

### 5. React Scan (Aiden Bai)

- **First screen at launch** ([README at a1af92e, 2024-11-19](https://github.com/aidenybai/react-scan/blob/a1af92e0ecad351ee561e61fe9b2724f7c2dbc05/README.md)): one line, "detects performance issues in your React app". One short paragraph on why older tools were hard. A "Try it out" link, then a **9.27-second GIF** (760×480, 139 frames, measured) of components flashing as they re-render. Then "Get started in 5 seconds" with one script tag.
- **First screen now** ([0fb3186, 2026-08-16](https://github.com/aidenybai/react-scan/blob/0fb31862b697ef3ed2d8ed6990878a35a4ca8a75/README.md)): a note pointing to the author's newer agent tool, the pitch, three bullets (no code changes, highlights exactly what to fix, toolbar), `npx -y react-scan@latest init` as the quick start, and a 9.01-second GIF.
- **Launch:** the author's [Show HN on 2024-11-14 got 2 points](https://news.ycombinator.com/item?id=42137571). Stars went 156 (11-14) → 1,260 (11-17) → 4,789 (11-26) → 10,635 (12-17). A November 2024 newsletter credits the author's own announcement ([roundup, 2024-11-30](https://agustinusnathaniel.substack.com/p/roundup-november-2024)). The author's site says an earlier project went viral through a Fireship video **(own claim)** ([aidenybai.com](https://aidenybai.com/)). The growth came from an audience the author already had.

### 6. React Grab (Aiden Bai)

React Grab is a Lightpath neighbour: it copies a clicked element's component and source file location for the agent.

- **First screen at launch** ([README at d28f28c, 2025-10-24](https://github.com/aidenybai/react-grab/blob/d28f28c1a432e45536b137e0b8e9c0ce2f14fd44/README.md)): three small badges, an "Install using Cursor" link that hands the agent a setup prompt **(from docs)**, then the pitch: grab any element and give it to Cursor or Claude Code. One line on the gap (agents can't see your page), three bullets, a demo GIF (now 404, so not measured), and one script tag.
- **First screen now** ([ea4bbec, 2026-08-22](https://github.com/aidenybai/react-grab/blob/ea4bbec9e80f4802e8ae19ad18431edb9ddbb670/README.md)): "Copy any UI element for your agent." Then a claim that agents are 2× faster with it, linked to a benchmarks page **(own claim)**. Then `npx grab@latest init`, a 3-step "How it works", and a sample of the copied text with a file path and line.
- **Launch:** [Show HN 2025-10-24, 3 points](https://news.ycombinator.com/item?id=45696195); a [blog post on 2025-11-24, 2 points](https://news.ycombinator.com/item?id=46035872). Stars 131 → 1,192 in the first week, then slower (3,833 by 2025-12-23).

### 7. Browser Use

- **First screen on Launch HN day** ([README at 3f97b12, 2025-02-25](https://github.com/browser-use/browser-use/blob/3f97b120edfc4cfd8d2c2c69341acc8a5dc159c7/README.md)): logo, the headline "Enable AI to control your browser", seven badges (stars, Discord, docs, cloud, two founders on X), one-line pitch, then `pip install browser-use` and a short Python example.
- **First screen now** ([b49a68e, 2026-10-30](https://github.com/browser-use/browser-use/blob/b49a68e4060acb226da8f784194fef301c53a6d7/README.md)): many image badges, a hero picture, a pitch that mixes open source and paid cloud, and a **20.4-second GIF** (measured) of the agent booking a driving test.
- **Launch:** [Launch HN (YC W25), Tue 2025-02-25 15:45 UTC, 259 points](https://news.ycombinator.com/item?id=43173378). By then it already had 33,119 stars; the week after added about 1,900. The bigger jump followed Manus: TechCrunch reported on 2025-03-12 that an X post about Manus using Browser Use got over 2.4 million views ([TechCrunch](https://techcrunch.com/2025/03/12/browser-use-one-of-the-tools-powering-manus-is-also-going-viral)). Stars reached 49,592 by 03-27. The company reported 50,000 stars at its seed round **(own claim)** ([browser-use.com](https://browser-use.com/posts/seed-round)).

### Counter-example: MCP Node.js Debugger (did not grow)

This is the closest match to Lightpath in the study: an MCP server that lets Cursor or Claude Code debug a running Node.js app.

- **First screen at launch** ([README at 9af16c5, 2025-03-20](https://github.com/workbackai/mcp-nodejs-debugger/blob/9af16c51700db0ea814ea41ba0f97557c5e5eb72/README.md)): one sentence on what it does, then two demo videos (23.7 s for Cursor, 20.6 s for Claude Code, measured), then a quick start in three steps: add JSON to Cursor's config, start your server with `node --inspect`, ask Cursor to debug.
- **Launch:** [Show HN, Sat 2025-03-22 15:57 UTC, 139 points, 72 comments](https://news.ycombinator.com/item?id=43446659). Stars: 63 on launch day, 219 a month later, 301 today, and the repo is archived.
- **What differed from the growers** (our reading, not measured): the setup asks the user to restart their app with a debug flag before anything happens; the first screen shows no result, only a video to press play on; the pitch names a mechanism (debugger) more than an outcome; and it had no outside audience after HN. It launched in the same weeks as Playwright MCP and Context7, so timing was not the problem.

### Counter-example: Browser MCP (big HN post, modest stars)

[Show HN on Mon 2025-04-07 16:25 UTC got 616 points](https://news.ycombinator.com/item?id=43613194). The link went to the product site, not GitHub. Stars went from 107 to 941 in 9 days and 1,247 by 05-01. One of the biggest MCP Show HN posts we found produced fewer stars in its first month than Chrome DevTools MCP got on its first day.

## What they had in common

| Pattern                                              | Who did it                                                                                                  | Evidence                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ |
| Pitch in under 10 words naming the agent as the user | Chrome DevTools, React Grab, Context7, Serena (now)                                                         | README first lines above |
| Problem stated as what the agent can't do            | Chrome blog ("blindfold"), Context7 (❌ Without), React Grab ("agents cannot access elements on your page") | Launch READMEs and blog  |
| One command or one `npx` JSON block to start         | All 7                                                                                                       | Quick start sections     |
| `init` command that edits the project for you        | React Scan, React Grab, Context7 (`setup`)                                                                  | Current READMEs          |
| Short loop GIF high on the page                      | React Scan 9.0-9.3 s, Browser Use 20.4 s                                                                    | `gif-lengths.txt`        |
| Copy-paste prompts                                   | Chrome blog (5 prompts), Context7 (`use context7`)                                                          | Blog and README          |
| Before/after or a number                             | Context7 (Without/With), React Grab (2×, own claim), Serena (agent quotes, own claim)                       | Current READMEs          |
| Few badges at launch                                 | Playwright 0, Chrome 1, React Grab 3                                                                        | Launch READMEs           |
| Disclaimers on the first page                        | Chrome DevTools (data exposure, usage stats)                                                                | README                   |
| An audience outside HN at launch                     | Google, Microsoft, Upstash, Aiden Bai, Manus                                                                | Launch sections above    |

What did not matter much: HN points (see the counter-examples), badges, and long feature lists.

## Which lessons transfer to Lightpath

Lightpath does not have Google's blog or a creator's following. The parts that transfer are the ones under the owner's control: the first screen, the setup, the demo, and posting to the right places in the right way.

### Pitch line candidates

Current README line: "Click anything in your running app and see the exact code it ran, frontend and backend, line by line." It is about a human clicking. The growers name the agent.

| #   | Candidate                                                                        | Modeled on                                                           |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A   | **Show your coding agent the code that actually ran.**                           | Chrome DevTools ("for coding agents"), React Grab ("for your agent") |
| B   | **Your agent clicks a button and sees every line it ran, frontend and backend.** | Chrome blog's problem statement                                      |
| C   | **Runtime traces for coding agents: which code ran when this was clicked.**      | Context7's "Up-to-date docs for AI agents" shape                     |

Each needs the owner's 10-second comprehension test (an owner success metric) before it ships.

### Storyboard for the 15-second GIF

Built from React Scan (9 s loop, result visible in the first second) and Chrome blog's prompt style. The owner asked for "an agent finding a real bug using a trace".

| Time    | Screen                                                                                    | Text overlay                  |
| ------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| 0-2 s   | Agent chat, prompt already typed: "Checkout charges the wrong total. Find out why."       | none                          |
| 2-5 s   | Agent calls one Lightpath tool; the browser clicks Checkout by itself                     | `lightpath: trace "Checkout"` |
| 5-9 s   | Compact trace: `Cart.tsx` → `POST /api/orders` → `orders.ts:42`, an untaken branch marked | the line that ran             |
| 9-12 s  | Agent names the bug at `orders.ts:42` and edits it                                        | the fix diff                  |
| 12-15 s | Agent reruns the click; trace diff shows the new path; test passes                        | "verified"                    |

Rules: no sound needed, readable at 600 px wide, loops cleanly, under about 5 MB (React Scan's is 5.0 MB). Only show a bug from the seeded-bug suite, so the GIF has a source in the repo.

### 3-line quick start

All growers start with one command. Lightpath's Phase 2 target (d) is one setup command per agent, so the shape is:

```sh
npx @lightpath-dev/cli init --agent claude-code   # writes MCP config + AGENTS.md note
npx @lightpath-dev/cli dev -- npm run dev         # runs your app with tracing
# then ask your agent: "Use Lightpath to find which code handles Checkout."
```

The third line is a prompt, as in Context7 and the Chrome blog. `init --agent` does not exist yet; this shape depends on Phase 2.

### Other transfers

- **Before/after, measured.** Context7's Without/With block suits Lightpath's product-proof benchmark. Put the with/without fix rate under the pitch only once the benchmark exists, with a link to the method.
- **Local-only is a fair difference.** Chrome DevTools MCP collects usage statistics by default and has an opt-out flag; Lightpath sends nothing. Chrome DevTools MCP is better at performance traces, network inspection and browser automation, and the README comparison should say so.
- **No account.** Context7 now needs an OAuth sign-in for setup **(own claim)**. HN's guidelines ask for no sign-up barriers. Lightpath has none; keep it that way.
- **Avoid the debugger's trap.** The counter-example asked for an app restart with a flag before the first result. Lightpath already starts the dev server itself; keep that in the first 2 minutes ("time to first wow").
- **One-click install buttons.** Playwright MCP and Context7 use "Install in VS Code" / "Add to Cursor" links **(from docs)**. Cheap to add for the agents Lightpath supports.

## Rules we must follow when the owner posts

Nothing here is posted by us. The owner posts every item himself (Tier 3).

### Hacker News

Sources: [Show HN guidelines](https://news.ycombinator.com/showhn.html), [HN guidelines](https://news.ycombinator.com/newsguidelines.html), [dang's Show HN tips](https://news.ycombinator.com/item?id=22336638) (edited 2026-03-28).

- Show HN is for things people can try now; no landing pages or sign-up walls.
- Write the text by hand. HN asks for no generated or AI-edited text, and dang added that this is a current dividing line. **Our Show HN draft can only be a fact sheet; the owner must write the post himself.**
- Give the backstory and what is different; drop marketing words.
- Use a personal username, not the project name.
- Don't ask anyone to upvote or comment, and stop friends from posting booster comments.
- Don't delete and repost. A repost is only for a major new version.
- Titles: no caps or exclamation marks; start with "Show HN:".

### Subreddits

| Subreddit     | Self-promotion rule (paraphrased)                                                                                                                                                                                                     | Source                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| r/webdev      | Projects only on **Showoff Saturday**, with the right flair; no commercial promotion; follow the 9:1 guideline; LLM-generated posts removed as low effort                                                                             | [rules, snapshot 2026-07-16](http://web.archive.org/web/20260716085342/https://old.reddit.com/r/webdev/about/rules)      |
| r/reactjs     | Rule titles read: "Needs code", "Portfolio Sunday", "Original works", "AI", "Commercial activity". Rule 5 says to take part before promoting. **Couldn't read** the detail of each guideline                                          | [rules, snapshot 2026-07-16](http://web.archive.org/web/20260716085242/https://old.reddit.com/r/reactjs/about/rules)     |
| r/javascript  | Own content OK if it is not most of your posts; demos should include code; no ads for paid products                                                                                                                                   | [rules, snapshot 2026-08-11](http://web.archive.org/web/20260811085734/https://old.reddit.com/r/javascript/about/rules)  |
| r/node        | **Couldn't read**: Reddit blocked us and Wayback had no copy                                                                                                                                                                          | —                                                                                                                        |
| r/programming | No "I made this" posts. A technical write-up of how it was built is allowed if it is the focus. LLM content is off-topic unless deeply technical. No LLM-written text, including translation                                          | [rules, snapshot 2026-08-11](http://web.archive.org/web/20260811153143/https://old.reddit.com/r/programming/about/rules) |
| r/ClaudeAI    | Promotion encouraged if: built by you with or for Claude, clear description of how Claude helped, free to try and say so, little promo language, no referral links. Posting needs over 50 karma. Vote manipulation is a permanent ban | [rules, snapshot 2026-08-23](http://web.archive.org/web/20260823233716/https://old.reddit.com/r/ClaudeAI/about/rules/)   |
| r/cursor      | Self-promotion at most 10% of your Reddit activity, with context in a text post; flair required; no AI-generated content; titles not clickbait                                                                                        | [rules, snapshot 2026-07-27](http://web.archive.org/web/20260727133900/https://old.reddit.com/r/cursor/about/rules)      |
| r/mcp         | Share only after it is launched (no waitlists); disclose that it is yours; use the **showcase** tag; no AI-generated "slop"; astroturfing is a permanent ban                                                                          | [rules, snapshot 2026-07-16](http://web.archive.org/web/20260716085047/https://old.reddit.com/r/mcp/about/rules)         |

The snapshots are 2 to 4 months old. The owner should reread each live rules page before posting. Two practical limits: r/ClaudeAI needs karma over 50, and r/cursor's 10% rule depends on the owner's Reddit history.

### awesome-mcp lists and registries

| List                                                                                  | Stars (2026-11-01) | How it takes entries                                                                                                                                                                       | Source                               |
| ------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers)       | 97,143             | Fork, add one line in the right category, alphabetical, open a PR. Needs a public GitHub repo. About 4,631 entries already, so a listing alone gives little reach                          | CONTRIBUTING.md, `awesome-lists.txt` |
| [Official MCP Registry](https://registry.modelcontextprotocol.io/)                    | 7,423 (repo)       | Publish with the `mcp-publisher` CLI per the [quickstart](https://github.com/modelcontextprotocol/registry/blob/main/docs/modelcontextprotocol-io/quickstart.mdx); no PRs to its seed file | registry CONTRIBUTING.md             |
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers)       | 91,722             | No longer lists third-party servers; points to the Registry; takes issues, not PRs                                                                                                         | CONTRIBUTING.md                      |
| [wong2/awesome-mcp-servers](https://github.com/wong2/awesome-mcp-servers)             | 4,396              | No PRs; submit on the [mcpservers.org form](https://mcpservers.org/submit)                                                                                                                 | README                               |
| [TensorBlock/awesome-mcp-servers](https://github.com/TensorBlock/awesome-mcp-servers) | 1,008              | PR to a `docs/*.md` category or an issue form                                                                                                                                              | README                               |
| [appcypher/awesome-mcp-servers](https://github.com/appcypher/awesome-mcp-servers)     | 5,814              | Archived; skip                                                                                                                                                                             | GitHub API                           |

Note: punkpeye's CONTRIBUTING.md offers a fast track for PRs opened by automated agents. The owner submits by hand, so this does not apply to us.

## Launch order and timing

### What the timing data says

From `hn-timing.txt` (47,012 Show HN posts, 2025-11-01 to 2026-10-24):

| UTC hour                           | Posts  | Reached 50 pts | Reached 100 pts |
| ---------------------------------- | ------ | -------------- | --------------- |
| 07:00 (worst)                      | 1,304  | 1.38%          | 0.54%           |
| 15:00                              | 3,776  | 3.15%          | 1.77%           |
| **16:00 (best of the busy hours)** | 3,408  | **3.93%**      | **2.35%**       |
| 17:00                              | 2,869  | 3.69%          | 2.09%           |
| All hours                          | 47,012 | 2.91%          | 1.63%           |

By weekday, the rate of reaching 50 points ran from 2.66% (Wednesday) to 3.39% (Sunday). Monday was 3.10%. The 00:00 UTC hour had a similar rate (3.96%) but a third of the posts. All three agent-tool posts in this study that got over 100 points went up between 15:45 and 16:25 UTC.

16:00 UTC is 21:45 in Nepal. The owner needs to be awake to answer comments for about 3 hours after posting, which HN expects.

We found no measured data for subreddit timing. The plan below follows each subreddit's day rules instead of a guessed hour.

### Proposed order

| Day                       | Where                                     | What                                                                           | Why                                                                                                        |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| L-2                       | MCP Registry, mcpservers.org form         | Publish the server entry                                                       | Agents and clients can find it on launch day; no audience needed                                           |
| L (Sun or Mon), 16:00 UTC | Show HN                                   | Owner-written post linking the GitHub repo                                     | Best hour in our data; link to GitHub, since Browser MCP's 616 points went to a website and gave few stars |
| L, after the HN post      | X thread                                  | 5-6 posts with the GIF                                                         | Growers' spikes came from outside HN                                                                       |
| L+1                       | r/mcp (showcase tag)                      | Disclosed "I built this" post                                                  | Rules allow it with disclosure                                                                             |
| L+2                       | r/ClaudeAI                                | Post on how it was built with Claude Code, free to try                         | Rule 7 asks for exactly this                                                                               |
| L+3                       | r/cursor                                  | Text post with context                                                         | 10% rule; spread out from other posts                                                                      |
| First Saturday after L    | r/webdev                                  | Showoff Saturday, project flair                                                | Only day it's allowed                                                                                      |
| L+7 to L+10               | r/javascript, r/node                      | Post with code and how the trace works                                         | r/javascript wants code; r/node rules unread, so check them first                                          |
| L+10 or later             | r/programming                             | Technical write-up: turning V8 coverage and source maps into a per-click trace | Only technical write-ups allowed                                                                           |
| L+7                       | punkpeye/awesome-mcp-servers, TensorBlock | One-line PRs                                                                   | Accurate listing with a final README                                                                       |

## Proposed decisions

These are proposals for the lead. `decisions.md` is not edited by this item.

1. **Pitch line: candidate A**, "Show your coding agent the code that actually ran."
   - Why: the fastest growers name the agent in under 10 words; A is the shortest and doesn't need "MCP" or "trace" to make sense.
   - Alternatives: B (more concrete, longer), C (closest to Context7's shape), keep the current human-first line.
   - Evidence: the "What they had in common" table.
   - Revert: change one line in README.md.
   - Gate: the owner's 10-second test on 3-5 people or fresh agents picks the winner among A, B, C.
2. **GIF storyboard: the 15-second, 5-shot plan above**, using a seeded bug from the suite.
   - Why: short loops with the result in view early (React Scan 9 s) are the pattern; the counter-example's videos needed a press of play.
   - Alternative: a 60-90 second video only (that is in the launch kit anyway, but below the fold).
   - Revert: swap the image.
3. **Quick start: `init --agent`, `dev`, then a prompt line.**
   - Why: one-command setup is universal among growers; the prompt line copies Context7 and the Chrome blog.
   - Depends on Phase 2 target (d). Until then, keep the current `npx ... dev` line.
4. **Launch order: Registry first, then Show HN at 16:00 UTC on a Sunday or Monday, X the same hour, subreddits spread over 10 days by their rules, awesome lists after a week.**
   - Why: timing data above; subreddit rules; HN alone did not make the growers.
   - Alternative: Tuesday 15:00 UTC (common advice, but our data shows Tuesday at 2.92%, below Sunday and Monday).
5. **Date range: the first Sunday or Monday after three things are true:** the product-proof benchmark has results, the README GIF exists, and `init` works for all four agents in CI.
   - If ready in time: **Sun 2026-12-06 or Mon 2026-12-07.** This avoids US Thanksgiving week (Thanksgiving is 2026-11-26) and the late-December holidays.
   - If not: **Sun 2027-01-10 or Mon 2027-01-11**, after the holidays.
   - Why: a launch without the headline claim is the risk the owner named ("a few stars and then criticism"). The date follows readiness.
6. **All launch texts are owner-written.** Our drafts become fact sheets (claims with their repo sources), not ready-to-paste posts.
   - Why: HN, r/programming, r/cursor, r/webdev and r/mcp all ban or remove LLM-written posts.
   - Revert: none needed; this is a rule, not a design choice.

## Open items and limits

- X/Twitter launch posts could not be read; the "outside audience" finding is inferred from star jumps and news coverage, not from post data.
- r/node rules and r/reactjs guideline detail are unread.
- Star counts are from archived pages on uneven dates.
- Seven tools is a small sample, and five come from one narrow area (agent tools in 2025).
