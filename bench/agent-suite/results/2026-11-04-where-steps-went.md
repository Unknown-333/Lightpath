# Where the extra steps went: the 2026-11-03 benchmark, run by run

The full benchmark ([2026-11-03-full-benchmark.md](2026-11-03-full-benchmark.md)) found no fix-rate win and more steps, tokens and credits with Lightpath in every set. This audit reads the transcripts of all 53 valid `with` runs and the 55 valid `without` runs of the same bugs to find out where those steps went. It runs nothing: no agent, browser or app, and no credits.

## Headline

- **Every `with` run spent one step loading the tool.** All 53 `with` runs made a `tool_load` call for Lightpath (kiro-cli's Tool Search). 22 of them never called Lightpath after loading it. That one step is 1.00 of the shop's +2.10 extra steps per run. The loaded tool text was 37,221 tokens over the 53 runs, more than all Lightpath results together (26,534).
- **On tududi, Lightpath never traced a bug.** In 24 `with` runs, there were 0 traces of any action after sign-in. 12 runs called Lightpath, and 8 of them got only misses. All 7 tududi run_action misses were on the Login page: in 4 the agent assumed it was signed in, and in 3 it asked for button "Sign in" when the page says "Login". The 4 runs that did sign in got a Login trace of 14,906 to 15,360 characters (15,108 tokens for the four), then stopped calling Lightpath.
- **On the shop, the agent used the trace and did not search again.** 14 of 20 visible runs got a trace that named the file they changed. After it, they ran 2 searches in total, and both found trace-named files again. They did not re-read any file. The trace replaced searches (1.95 down to 0.65 per run), but the Lightpath calls cost more steps than the searches they replaced. Of the 48 run_action calls, 24 came after the first edit, in 12 runs (checking the fix). 13 calls repeated the same click right after a good trace. diff_traces was called 0 times.
- **The shop bugs are too easy for text search to leave room.** Without Lightpath, search reached the changed file in 1 or 2 steps (median) on 12 of 15 bugs. 23 `with` runs called Lightpath on those bugs. They spent 75 Lightpath steps and 7.138 more credits than the `without` means for their bugs.
- **Runs that never called Lightpath cost about what `without` did, plus the load.** The 22 runs were +1.30 steps per run (1.00 of it the load), +492 tokens and +0.132 credits against their bug's `without` mean, and 21 of 22 were correct.
- **tududi h01 failed for one visible reason: the edit went into the wrong function.** All 6 runs (`with` and `without`) that edited the after-save line `setInputText(remaining.join('\n'))` passed. All 4 that edited a different reset path failed. The failed `with` runs were not hurt by a trace: one never called Lightpath, one missed at "Sign in", and one only got the Login trace. None traced the save click.

## Data and method

- Inputs: the four `2026-11-03-*-with.jsonl` files and, for `without`, `2026-11-01-baseline-without.jsonl`, `2026-11-01-realapp-baseline-without.jsonl`, `2026-11-03-shop-heldout-without.jsonl` and `2026-11-03-realapp-heldout-without.jsonl`. A run is valid when its line has `void: false` (`SCORING.md`). That gives 53 `with` runs (20 + 9 + 15 + 9) and 55 `without` runs (21 + 9 + 15 + 10).
- Each line's `transcript` path was read in full. A step is one tool call, the same as `lib/agent.mjs` `parseTranscript`. Tokens use the D-111 method (characters / 4), the same as `estimateTokens`. The script checks both against every result line. It found 0 step mismatches and 0 token mismatches.
- Kinds of step: `tool_load` (the Kiro step that loads Lightpath tools), Lightpath calls (each tool by name), search (Grep Search, File Search, List Directory), read (Read File), edit (Replace in File), shell (Run Command, split into search, read, edit, test/build and other by the command text), and other.
- Rerun: `node bench/agent-suite/analysis/where-steps-went.mjs <outDir>`. It writes `summary.txt` (every number below), `runs.json` (each step of each run), `misses.txt` and `h01.txt`. The saved output is in `C:\Users\user\lightpath-trials\goal\stepsaudit-raw\`.
- Untouched: the bugs, the scoring and every result file (D-108).

## 1. Steps by kind

Mean per valid run. "Load" is the `tool_load` step and "LP" is the Lightpath calls.

| Set             | Cond    | Runs | Steps | Load  | LP    | Search | Read  | Edit  | Shell |
| --------------- | ------- | ---- | ----- | ----- | ----- | ------ | ----- | ----- | ----- |
| shop visible    | without | 21   | 5.00  | 0     | 0     | 1.95   | 1.67  | 1.33  | 0.05  |
| shop visible    | with    | 20   | 7.10  | 1.00  | 2.40  | 0.65   | 1.75  | 1.30  | 0.00  |
| shop visible    | delta   |      | +2.10 | +1.00 | +2.40 | -1.30  | +0.08 | -0.03 | -0.05 |
| shop held-out   | without | 9    | 5.67  | 0     | 0     | 2.56   | 1.78  | 1.00  | 0.33  |
| shop held-out   | with    | 9    | 6.56  | 1.00  | 0.56  | 2.44   | 1.44  | 1.11  | 0.00  |
| shop held-out   | delta   |      | +0.89 | +1.00 | +0.56 | -0.11  | -0.33 | +0.11 | -0.33 |
| tududi visible  | without | 15   | 9.87  | 0     | 0     | 5.13   | 2.60  | 1.60  | 0.53  |
| tududi visible  | with    | 15   | 13.47 | 1.00  | 0.60  | 6.80   | 2.73  | 1.73  | 0.60  |
| tududi visible  | delta   |      | +3.60 | +1.00 | +0.60 | +1.67  | +0.13 | +0.13 | +0.07 |
| tududi held-out | without | 10   | 12.50 | 0     | 0     | 6.30   | 2.40  | 2.20  | 1.60  |
| tududi held-out | with    | 9    | 13.44 | 1.00  | 0.44  | 7.11   | 2.00  | 1.11  | 1.78  |
| tududi held-out | delta   |      | +0.94 | +1.00 | +0.44 | +0.81  | -0.40 | -1.09 | +0.18 |

Which kinds grew with Lightpath:

- **The load step grew in every set**, by exactly 1.00. On the held-out sets, the load alone is more than the whole increase (+0.89 shop, +0.94 tududi).
- **Lightpath calls grew on the shop's visible set** (+2.40). They came in two halves: 24 calls before the first edit and 24 after it (12 of 20 runs checked their fix that way). Search fell by 1.30 per run against `without`, so the calls before the edit roughly replaced the searches. The load plus the calls after the edit are the extra steps.
- **Search grew on tududi** (+1.67 visible, +0.81 held-out). Almost all of it is r02 (7.00 to 10.80). The r02 `with` runs that never called Lightpath were the longest: 21.00 steps, against 14.33 for the r02 runs that called it and 11.40 `without`. So that growth doesn't come from Lightpath calls. The transcripts don't show why those runs searched more.
- Reads, edits and shell steps barely moved.

Lightpath calls by tool (`with`, totals): shop visible run_action 48. Shop held-out run_action 3 and find_code_for_action 2. tududi visible run_action 7 and find_code_for_action 2. tududi held-out run_action 4. No run called get_trace, list_traces, run_request or diff_traces.

Credits follow steps. Per step, credits were 0.067 → 0.072 (shop visible), 0.066 → 0.070 (shop held-out), 0.098 → 0.095 (tududi visible) and 0.089 → 0.097 (tududi held-out), `without` → `with`. So most of the extra credits come from the extra steps, not from dearer steps.

### Per bug

Mean per valid run, `without` → `with`. Every `with` run also has the 1.00 load step.

| Set             | Bug | Runs w/o, w | Steps         | LP calls | Search       | Read        |
| --------------- | --- | ----------- | ------------- | -------- | ------------ | ----------- |
| shop visible    | b01 | 3, 3        | 3.67 → 4.33   | 0.33     | 1.33 → 1.00  | 1.33 → 1.00 |
| shop visible    | b02 | 3, 3        | 5.33 → 7.33   | 3.00     | 1.33 → 0.00  | 3.00 → 2.33 |
| shop visible    | b03 | 3, 3        | 9.33 → 11.67  | 3.33     | 4.00 → 2.00  | 3.00 → 3.67 |
| shop visible    | b04 | 3, 3        | 3.67 → 6.67   | 3.33     | 1.00 → 0.00  | 1.67 → 1.33 |
| shop visible    | b05 | 3, 3        | 6.00 → 8.67   | 4.33     | 2.00 → 0.00  | 1.67 → 1.00 |
| shop visible    | b06 | 3, 2        | 3.33 → 4.50   | 0.00     | 1.33 → 1.50  | 1.00 → 1.00 |
| shop visible    | b07 | 3, 3        | 3.67 → 5.67   | 1.67     | 2.67 → 0.33  | 0.00 → 1.67 |
| shop held-out   | h01 | 3, 3        | 9.33 → 8.67   | 0.67     | 4.00 → 4.00  | 3.33 → 2.00 |
| shop held-out   | h02 | 3, 3        | 4.67 → 7.67   | 1.00     | 1.67 → 2.00  | 2.00 → 2.33 |
| shop held-out   | h03 | 3, 3        | 3.00 → 3.33   | 0.00     | 2.00 → 1.33  | 0.00 → 0.00 |
| tududi visible  | r01 | 5, 5        | 12.20 → 15.60 | 1.20     | 5.00 → 6.00  | 3.60 → 3.80 |
| tududi visible  | r02 | 5, 5        | 11.40 → 17.00 | 0.60     | 7.00 → 10.80 | 3.20 → 3.40 |
| tududi visible  | r03 | 5, 5        | 6.00 → 7.80   | 0.00     | 3.40 → 3.60  | 1.00 → 1.00 |
| tududi held-out | h01 | 5, 5        | 14.60 → 17.00 | 0.80     | 9.20 → 10.20 | 3.00 → 3.00 |
| tududi held-out | h02 | 5, 4        | 10.40 → 9.00  | 0.00     | 3.40 → 3.25  | 1.80 → 0.75 |

Edits and shell steps per bug are in `summary.txt` ("Q1 per bug").

## 2. After the first useful trace

An "ok trace" is a Lightpath result that starts with `Trace t_`. A "useful trace" is an ok trace that names a file the run went on to change. A "re-find" search is a search after that trace that targets a trace-named file or its folder, or whose result lists a trace-named file. The first read of a trace-named file is counted on its own. The trace gives line numbers but no code text, so the agent has to read the file once before it can edit it.

| Set             | `with` runs | Called LP | Got an ok trace | Got a useful trace | Steps after it | Searches after | Re-find searches | First reads of trace files | Re-reads | Other reads | LP calls after |
| --------------- | ----------- | --------- | --------------- | ------------------ | -------------- | -------------- | ---------------- | -------------------------- | -------- | ----------- | -------------- |
| shop visible    | 20          | 15        | 15              | 14                 | 78             | 2              | 2                | 25                         | 0        | 1           | 30             |
| shop held-out   | 9           | 4         | 2               | 1                  | 8              | 3              | 1                | 1                          | 0        | 2           | 0              |
| tududi visible  | 15          | 8         | 2               | 0                  | -              | -              | -                | -                          | -        | -           | -              |
| tududi held-out | 9           | 4         | 2               | 0                  | -              | -              | -                | -                          | -        | -           | -              |
- **Shop: the agent trusted the trace.** Re-finding cost 3 steps over 15 runs: `#4 Grep Search "productId|interface Product" in src/**` (b07-with-1), `#4 List Directory src` (b03-with-2) and `#6 Grep Search "stock" in {server,src}/**` (h02-with-1). After the useful trace, most steps were the first read of the named file, the edit and more Lightpath calls.
- **Even so, the trace didn't shorten the path to the edit.** Runs with a useful trace took 4.87 steps before their first edit (1.00 load, 1.60 Lightpath, 0.47 search, 1.80 read). The `without` runs of the same 6 bugs took 3.89 (2.11 search, 1.78 read). So searches before the edit fell from 2.11 to 0.47, but the load and the Lightpath calls added 2.60.
- **tududi: no run got a trace of the bug.** All 4 ok traces were the Login click (`Trace ...: button: login-submit`), and none named a file the run changed. Two shop traces (b01-with-2 and h02-with-2, both Checkout) also didn't name the changed file.

## 3. run_action and find_code_for_action outcomes

| Set             | Tool                 | Calls | ok  | not_found | Nothing recorded | Other errors |
| --------------- | -------------------- | ----- | --- | --------- | ---------------- | ------------ |
| shop visible    | run_action           | 48    | 48  | 0         | -                | 0            |
| shop held-out   | run_action           | 3     | 2   | 1         | -                | 0            |
| shop held-out   | find_code_for_action | 2     | 0   | -         | 2                | 0            |
| tududi visible  | run_action           | 7     | 2   | 5         | -                | 0            |
| tududi visible  | find_code_for_action | 2     | 0   | -         | 2                | 0            |
| tududi held-out | run_action           | 4     | 2   | 2         | -                | 0            |
| all             | run_action           | 62    | 54  | 8         | -                | 0            |

Retries were rare. 12 calls missed (8 run_action, 4 find_code_for_action), and only 2 were followed by another Lightpath call (both then worked). The step right after a miss was a Grep Search 8 times, a List Directory 2 times and run_action 2 times. In 10 runs, every Lightpath call missed.

Each miss, with what the page really showed (from the error's "Closest targets on the page" list):

| Cause                                                             | Misses | Runs                                                     | The agent passed                                                                   | The page showed                                                                   |
| ----------------------------------------------------------------- | ------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Page not ready: still on the Login page, agent assumed signed in  | 4      | r01-with-2, r01-with-5, r02-with-2, r02-with-3           | `text=Upcoming` (2), `button "Set in progress"`, the same `within "Book hotel"`    | `heading "Login"`, `button "Login"`, `textbox "Email"`, `textbox "Password"`, ... |
| Text mismatch: the report says "sign in", the button says "Login" | 3      | r01-with-3, h01-with-1, h01-with-4                       | `button "Sign in"` with `fill` `css=input[type=email]`, `css=input[type=password]` | `button "Login"` first in the list                                                |
| Nothing recorded: find_code_for_action before any action          | 4      | r01-with-4, r02-with-1, shop h01-with-2, shop h01-with-3 | `Upcoming`, `Set in progress`, `products`, `shop page load`                        | (no list) "No recorded action matches ... Do it with run_action ..."              |
| Text mismatch: no element with that name                          | 1      | shop h02-with-2                                          | `button "Buy" within "Desk lamp"`                                                  | `button "Add to cart"`, `button "Sold out"`, `button "Checkout"`, ...             |
- No miss came from the selector form, page timing on a ready page, or a missing `within`. Every `within` call on the shop returned a trace except the "Buy" one: `button "Add to cart" within "Desk lamp"` (23 visible, 1 held-out), `within "Coffee mug"` (2), and `button "Add" within "Desk lamp"` (5, matched to "Add to cart").
- **7 of 8 run_action misses were on tududi's Login page.** The error listed `button "Login"`, `textbox "Email"` and `textbox "Password"` every time. Only 1 of those 7 runs (r01-with-2) tried again, and its sign-in worked.
- **The 4 runs that signed in made 0 more run_action calls.** Each tududi prompt lists several setup steps after sign-in. h01's says: "sign in, add a project "Website", open it, click Add, type "Draft brief" after the project name and click Add."
- **Two find_code_for_action misses were page-load bugs.** Shop held-out h01's report says "To see it: open the shop page." There is nothing to click, and run_action only clicks or presses Enter or Space.
- **13 run_action calls repeated the same arguments right after an ok trace** (b03-with-2 made 5 of them). Some bugs need this, for example b04 ("press Add to cart on the Desk lamp twice").

## 4. Calls on bugs that search finds in 1-2 steps

The script counts, for each run, the step at which it first reads, edits or sees in a search result a file it changed. For `with` runs, Lightpath steps are left out of this count. A bug counts as "search-easy" when its `without` runs reached the file in a median of 2 steps or fewer. 12 of the 15 bugs pass that bar: all except shop b02 (4), shop held-out h01 (7) and tududi r02 (4).

- **23 `with` runs called Lightpath on a search-easy bug.** They spent 75 Lightpath steps (load plus calls) and 40,078 Lightpath tokens. Against the `without` mean for their bug, they cost 7.138 more credits and 67.91 more steps.
- **With a stricter bar** (search found the file in its first step), 7 bugs pass. 7 runs called Lightpath on them (b04 ×3, b07 ×3, b01-with-2). They spent 23 Lightpath steps and 6,691 Lightpath tokens, and cost 1.254 more credits and 16.31 more steps than the `without` means.
- These counts are an upper bound on waste. Some of those Lightpath steps also checked the fix, and this benchmark can't show what that check is worth: `without` fixed 21 of 21 shop bugs with no check.

Same bug, `with` runs that called Lightpath against `with` runs that didn't (only bugs that have both):

| Set             | Bug | Called: runs, steps, credits | Not called: runs, steps, credits |
| --------------- | --- | ---------------------------- | -------------------------------- |
| shop visible    | b01 | 1, 5.00, 0.369               | 2, 4.00, 0.359                   |
| shop visible    | b03 | 2, 12.50, 0.707              | 1, 10.00, 0.580                  |
| shop held-out   | h01 | 2, 8.00, 0.492               | 1, 10.00, 0.602                  |
| shop held-out   | h02 | 2, 9.00, 0.595               | 1, 5.00, 0.375                   |
| tududi visible  | r02 | 3, 14.33, 1.495              | 2, 21.00, 2.146                  |
| tududi held-out | h01 | 4, 17.50, 1.814              | 1, 15.00, 1.315                  |

## 5. Tokens: Lightpath text against the rest

D-111 estimate (characters / 4). "LP calls" counts Lightpath results and inputs. "Load" counts the `tool_load` result, which holds the tool's description and input schema. "Rest" counts the prompt, all other tool text, and the agent's messages and thoughts.

| Set             | Runs | LP calls tok/run | Load tok/run | Rest tok/run | Total tok/run | LP share | Load share | `without` total tok/run |
| --------------- | ---- | ---------------- | ------------ | ------------ | ------------- | -------- | ---------- | ----------------------- |
| shop visible    | 20   | 491.89           | 627.90       | 1,191.42     | 2,311.21      | 21.3%    | 27.2%      | 1,370.50                |
| shop held-out   | 9    | 62.00            | 721.28       | 1,183.58     | 1,966.86      | 3.2%     | 36.7%      | 1,423.94                |
| tududi visible  | 15   | 545.85           | 726.92       | 7,861.95     | 9,134.72      | 6.0%     | 8.0%       | 7,742.52                |
| tududi held-out | 9    | 883.33           | 807.53       | 7,789.58     | 9,480.44      | 9.3%     | 8.5%       | 8,715.67                |
| all `with`      | 53   | 500.63           | 702.28       | 4,198.42     | 5,401.33      | 9.3%     | 13.0%      | 4,452.55                |
- **The load costs more text than the results.** Over 53 runs, `tool_load` text was 37,221 tokens and Lightpath results were 26,534. 15,530 of the load tokens were in runs that never called Lightpath. One load is 611.75 tokens for run_action alone, 768.00 for 2 tools, 991.71 for 3 and 1,255.25 for 4.
- **Four Login traces were most of tududi's Lightpath text.** They came to 60,431 characters, or 15,108 tokens: 14,906 to 15,360 characters each, close to the 16,000-character cap (D-109). Each one had 13 request lines and 21 files shown, with "not shown: 72 files, 295 functions" or close to it. 32.4% of their text was 4 backend files that repeat under 3 or more requests: `backend/app.js`, `backend/middleware/queryLogger.js`, `backend/middleware/rateLimiter.js` and `backend/services/permissionsService.js`. None of the four named a file the run changed.
- On the shop, Lightpath results were small (the largest was 1,824 characters, b05's Checkout trace). The shop's extra tokens come from the load (611.75 per run) and from making more calls.
- The token estimate leaves out the system prompt and the tool specs sent with each request (D-111), so the true cost of the MCP server's instructions isn't in these numbers. Credits per step (section 1) suggest that cost is small.

## 6. The 22 `with` runs that never called Lightpath

All 22 still made the `tool_load` step.

| Set             | Bug | No-call runs | Correct | Steps (less load) | Tokens est. | Credits | `without` runs | Correct | Steps | Tokens est. | Credits |
| --------------- | --- | ------------ | ------- | ----------------- | ----------- | ------- | -------------- | ------- | ----- | ----------- | ------- |
| shop visible    | b01 | 2            | 2/2     | 4.00 (3.00)       | 1,886.00    | 0.359   | 3              | 3/3     | 3.67  | 1,263.33    | 0.285   |
| shop visible    | b03 | 1            | 1/1     | 10.00 (9.00)      | 2,984.00    | 0.580   | 3              | 3/3     | 9.33  | 2,098.67    | 0.518   |
| shop visible    | b06 | 2            | 2/2     | 4.50 (3.50)       | 1,467.00    | 0.313   | 3              | 3/3     | 3.33  | 763.67      | 0.237   |
| shop held-out   | h01 | 1            | 1/1     | 10.00 (9.00)      | 2,138.00    | 0.602   | 3              | 3/3     | 9.33  | 2,277.00    | 0.503   |
| shop held-out   | h02 | 1            | 1/1     | 5.00 (4.00)       | 2,150.00    | 0.375   | 3              | 3/3     | 4.67  | 1,420.67    | 0.288   |
| shop held-out   | h03 | 3            | 3/3     | 3.33 (2.33)       | 1,134.67    | 0.250   | 3              | 3/3     | 3.00  | 575.00      | 0.224   |
| tududi visible  | r02 | 2            | 2/2     | 21.00 (20.00)     | 14,270.00   | 2.146   | 5              | 5/5     | 11.40 | 11,627.80   | 1.287   |
| tududi visible  | r03 | 5            | 5/5     | 7.80 (6.80)       | 4,086.00    | 0.634   | 5              | 5/5     | 6.00  | 3,630.80    | 0.515   |
| tududi held-out | h01 | 1            | 0/1     | 15.00 (14.00)     | 9,791.00    | 1.315   | 5              | 4/5     | 14.60 | 10,843.20   | 1.387   |
| tududi held-out | h02 | 4            | 4/4     | 9.00 (8.00)       | 6,215.25    | 0.855   | 5              | 5/5     | 10.40 | 6,588.80    | 0.845   |

Pooled, each no-call run against the `without` mean of its own bug: +1.30 steps (+0.30 without the load step), +491.85 tokens and +0.132 credits. The load text in these runs averaged 705.89 tokens, more than the whole token gap, so the rest of each run was slightly shorter than `without`. 21 of 22 were correct. Credits per step were 0.083 here and 0.082 for the `without` runs of the same bugs. In short, a run that loads Lightpath and then doesn't use it pays one step and the load text, and nothing else measurable. r02 is the exception, and section 1 covers it.

## 7. tududi held-out h01: what went wrong in the failed `with` runs

h01: "The project disappears from the Add box after I save." The hidden check saves a task from a project page and reads the Add box. The fixed app shows `"+Website "`; the failed runs left `""`.

| Run           | Cond    | Correct | Steps | Lightpath                                      | Edited the `remaining.join` line | Furthest read in QuickCaptureInput.tsx |
| ------------- | ------- | ------- | ----- | ---------------------------------------------- | -------------------------------- | -------------------------------------- |
| h01-with-1    | with    | no      | 11    | run_action `button "Sign in"`: not_found       | no                               | line 500                               |
| h01-with-2    | with    | no      | 21    | run_action Login: ok (15,360-char Login trace) | no                               | line 1719                              |
| h01-with-3    | with    | yes     | 19    | run_action Login: ok (Login trace)             | yes                              | line 2120                              |
| h01-with-4    | with    | yes     | 19    | run_action `button "Sign in"`: not_found       | yes                              | line 2150                              |
| h01-with-5    | with    | no      | 15    | none                                           | no                               | line 495                               |
| h01-without-1 | without | no      | 10    | -                                              | no                               | line 500                               |
| h01-without-2 | without | yes     | 15    | -                                              | yes                              | line 2120                              |
| h01-without-3 | without | yes     | 14    | -                                              | yes                              | line 2120                              |
| h01-without-4 | without | yes     | 19    | -                                              | yes                              | line 2120                              |
| h01-without-5 | without | yes     | 15    | -                                              | yes                              | line 2150                              |

What the transcripts show:

- There are two places that reset the box text. One is `clearComposerText` near line 500, which does `setInputText('')`. The other is in the save handler near lines 2120-2150, which does `setInputText(remaining.join('\n'))`. The 6 runs that changed the save-handler line all passed. The 4 that changed only `clearComposerText`, or another `setInputText('')` after line 1500, all failed. h01-with-1, h01-with-5 and h01-without-1 made almost the same edit to `clearComposerText` (`setInputText(prefillText || '')` or a ref of it). h01-with-2 used a shell script on the first `setInputText('')` after line 1500, then added `prefillText` to a dependency list.
- None of the failed runs read the save handler. Their furthest read started at line 1719 and covered 60 lines (h01-with-2). Every passing run read from line 2120 or 2150.
- No `with` run traced the save click. Lightpath gave no information about the bug in any of the three failed `with` runs: one never called it, one missed on "Sign in", and one got only the Login trace and used search, read and edit for the rest of its 21 steps.

What isn't known:

- Why `with` failed 3 times and `without` once. The failed runs went wrong the same way in both conditions, and 5 runs per side can't separate chance from cause. The transcripts don't show that the Lightpath setup made the wrong edit more likely.
- Whether a trace of the save click would have named the line near 2150. No run produced that trace, so this data can't tell.

## Ranked fix list (proposals only)

Ranked by how much of the measured loss each fix addresses, with the owner's aim first: help the agent fix more bugs, at lower cost, with a first call that works. "Would have saved" is counted from these runs. It is not a forecast, and each fix needs a re-run to show any effect.

| #   | Release      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Would have saved, by this count                                                                                                                                               | Size                                                                                         | Number it should move                                                                                             |
| --- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | 0.1.1        | **Sign-in-aware miss.** When run_action misses on a page that has a password box, the error should say so first ("This page is a sign-in form. Sign in first:") and give a ready call built from the page: `target: button "Login"`, `fill: textbox "Email", textbox "Password"`. Today the error lists those targets, but agents tried again after 1 of these 7 misses.                                                                                                         | 7 miss steps (4 assumed signed in, 3 "Sign in" vs "Login"). It is the first step toward any tududi trace: 0 of 24 runs traced the bug's action.                               | small                                                                                        | tududi run_action ok rate (2 of 7 visible, 2 of 4 held-out), then runs with a trace of the bug's action (0 of 24) |
| 2   | 0.1.1        | **Make the load cheaper and know when it happens.** Shorten run_action's input schema text. The schema is most of the 611.75-token load: see the `tool_load` result in any `with` transcript, for example b04-with-1. Document that kiro-cli's Tool Search adds a `tool_load` step (Kiro's [2.1 changelog](https://kiro.dev/changelog/cli/2-1/) describes `toolSearch.enabled`, read 2026-11-04). Whether to turn it off is the user's or the harness's choice, not Lightpath's. | 37,221 load tokens in 53 runs (15,530 of them in runs that never called Lightpath). 53 steps only if Tool Search is off, and then the schema goes with every request instead. | small                                                                                        | tokens per run in every set; steps per run only with Tool Search off                                              |
| 3   | 0.1.1        | **Fold big multi-request traces.** When one action fires many requests, show the request list plus each request's own files. Shared middleware that repeats under every request goes into one line.                                                                                                                                                                                                                                                                              | 15,108 tokens in 4 Login traces. 32.4% of that text (19,566 characters) was 4 backend files repeated under 3 or more requests.                                                | medium                                                                                       | tududi tokens and credits per run                                                                                 |
| 4   | 0.1.1        | **`times` on run_action** for repeating the same click ("press it twice").                                                                                                                                                                                                                                                                                                                                                                                                       | 13 repeat calls (shop visible)                                                                                                                                                | small. The MCP input is Tier 1; a daemon endpoint change would need a D-entry first (Tier 2) | shop steps per run                                                                                                |
| 5   | 0.1.1        | **find_code_for_action with nothing recorded** should answer with the run_action call to make. AGENTS.md should list it only for reading a click the user made.                                                                                                                                                                                                                                                                                                                  | 4 calls, 0 useful. It was loaded in 16 runs.                                                                                                                                  | small                                                                                        | steps per run; first-call success                                                                                 |
| 6   | 0.1.1        | **Check a fix in one call.** run_action gets a `compareTo: <traceId>` that returns the diff with the new trace. The AGENTS.md "After a fix" line points to it.                                                                                                                                                                                                                                                                                                                   | 0 steps against today. Agents made 24 after-edit calls in 12 runs and never called diff_traces, so they got no diff. This would add the diff at no extra step.                | small to medium                                                                              | diff_traces use (0 of 53 runs)                                                                                    |
| 7   | 0.2.0        | **Start the traced browser signed in.** `lightpath dev` keeps a local session the user creates once, so the agent's first click lands on the app. This changes the config schema (Tier 2, D-entry first) and touches local secrets: credentials and session stay on the machine, never in output.                                                                                                                                                                                | Same 7 misses as #1, and the 4 runs that stopped after sign-in                                                                                                                | medium                                                                                       | tududi runs with a trace of the bug's action                                                                      |
| 8   | 0.2.0        | **Several steps in one call** (`steps: [...]`): sign in, add, open, click, with one trace per step or only the last.                                                                                                                                                                                                                                                                                                                                                             | The 4 signed-in runs that made 0 more calls. Each tududi prompt lists several setup steps after sign-in.                                                                      | large (MCP input, daemon, tests)                                                             | tududi runs with a trace of the bug's action; tududi steps                                                        |
| 9   | 0.2.0        | **Trace a page load** (a `load` or `reload` action) for bugs that show up with no click.                                                                                                                                                                                                                                                                                                                                                                                         | 2 find_code_for_action calls on shop held-out h01 ("open the shop page")                                                                                                      | medium                                                                                       | shop held-out h01 with Lightpath                                                                                  |
| 10  | 0.2.0        | **Short code text for the lines that ran** next to the line numbers, so a read isn't needed before the edit.                                                                                                                                                                                                                                                                                                                                                                     | At most 25 + 1 first reads of trace-named files, in the 14 + 1 runs with a useful trace. It costs tokens, so it needs a budget check against D-109.                           | medium                                                                                       | steps before the first edit (4.87 with a useful trace, 3.89 without)                                              |
| 11  | measure only | **When-to-call text** ("if a quick search finds it, fix it; use run_action when search doesn't, or to check a fix").                                                                                                                                                                                                                                                                                                                                                             | 75 Lightpath steps and 7.138 credits over `without` in 23 runs (strict bar: 23 steps, 1.254 credits, 7 runs).                                                                 | small text change, but it needs a re-run                                                     | steps and credits on easy bugs. Risk: fewer calls where a trace would help.                                       |

What this list can't fix: on these two suites, text search already finds the file in 1-2 steps for 12 of 15 bugs, so a trace has few steps left to save. Showing a win needs bugs where search fails, which is the harder benchmark already proposed. It needs its own credit cap.

## Proposed decisions

This item owns no `decisions.md`, so these are proposals for whoever owns the next D-entries.

1. **Count the `tool_load` step as Lightpath cost in every report.**
   - What: report the load step and its text apart from the Lightpath calls, as this doc does.
   - Why: it is 1.00 step and 702.28 tokens in every `with` run, called or not.
   - Alternatives: leave it inside "steps" as now (it hides where the cost is), or turn Tool Search off in the harness (that changes the benchmark after results exist, so Tier 2).
   - Evidence: section 1 and section 5.
   - Revert: drop the column.
2. **Rank 0.1.1 work by the fix list above, #1 to #6.**
   - What: all six are small or medium and don't touch the config schema or the protocol, except a daemon change for #4 or #6 if one is needed (Tier 2, D-entry first).
   - Why: #1 and #3 are the only items that touch tududi, where Lightpath delivered no trace of any bug.
   - Alternatives: #11 (call less) cuts cost now but makes it less likely a trace is ever seen. Only do it with a re-run.
   - Evidence: sections 2, 3 and 5.
   - Revert: per fix.
3. **Before any re-run, add a check that a trace of the bug's own action was recorded.**
   - What: log, per run, whether any ok trace came after the setup steps (on tududi, anything other than `login-submit`).
   - Why: on tududi this was 0 of 24 runs, and the fix rate can't show Lightpath's effect while it stays 0.
   - Alternatives: read transcripts after each run, as this audit did.
   - Evidence: section 3.
   - Revert: remove the field. This adds a measurement and changes no scoring (D-108).

## Limits

- Read-only. Every number comes from the transcripts and result lines named above. Nothing was rerun.
- One agent (Kiro CLI 2.37.0), one model (`claude-sonnet-5.5`) and one effort setting. The `tool_load` step comes from Kiro's Tool Search. Other agents load MCP tools differently, and that wasn't checked.
- "Useful trace", "re-find search" and "search-easy" are rules written in the script, not judgements of each run. The script prints each rule next to its numbers. Path matching is case-insensitive and relative to the trial folder.
- Credits are kiro-cli's per-run figure. kiro-cli doesn't split credits per call, so no credit figure here belongs to one call.
- tududi has only 3 visible bugs and 2 held-out ones, and all 5 tududi fixes are public (see the full benchmark), so the model may have seen them. Runs per bug: 5 on tududi, 3 on the shop.
