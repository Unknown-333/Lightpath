# Why the agent skipped Lightpath in the r01 smoke run, and called it in b01

Source: the two smoke runs in `2026-11-01-with.md` (`r01-with-1` on tududi, `b01-with-1` on the shop). These are smoke runs, not results. No new run was made for this note. Quotes are from each run's `transcript.jsonl` (kiro-cli 2.37.0, `claude-sonnet-5.5`), printed in order with the worker's `events.mjs` (`benchprep-raw/r01-events.txt`, `b01-events.txt`).

## What the agent saw

- **MCP tools are deferred.** kiro-cli lists the Lightpath tools by id only, and the agent must load them with `tool_load` before it can call them. The session's context breakdown shows `"mcp":{"tokens":0}` in both runs. The tool descriptions reach the model only in the `tool_load` result.
- **AGENTS.md was in context.** The breakdown lists `"name":"AGENTS.md" ... "tokens":194,"matched":true` in both runs. Its first rule was: "Asked which code handles a button, page or request, or why an action fails? Call the Lightpath MCP tool `run_action` with the target, like `button "Checkout"`, before searching files."
- **Server instructions: not visible.** Nothing in the transcript shows whether kiro-cli passed the server's `instructions` to the model. The breakdown has no entry for them, so this note doesn't count on them.
- **Descriptions loaded.** Both runs loaded run_action first. r01 got the older text (packed at `cf7e9d3`): "Click a button or link, or press Enter or Space, in the user's running app, and return the code that ran, frontend and backend, with errors and failed requests. Can fill fields first. Use it to see which code handles a UI action, or to rerun a bug after a fix. Target: button "Checkout" or text."

## What each agent did

|                              | r01-with-1 (tududi)                                                                                                                                                                                                         | b01-with-1 (shop)                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Report says                  | "I make a task that repeats every day and give it a due time of 3:30 PM. When I click Upcoming, the next days show that task at midnight". To see it: "sign in, add a task ... set it to repeat daily, then click Upcoming" | "add one Desk lamp ($39.00) to the cart, type WELCOME10 in the coupon box and press Checkout"     |
| First call                   | `tool_load` `["lightpath::run_action","lightpath::find_code_for_action"]`                                                                                                                                                   | `tool_load` `["lightpath::run_action"]`                                                           |
| Thought before the next call | none                                                                                                                                                                                                                        | "Let me try running the action rather than grepping, since that's what the instructions suggest." |
| Next call                    | Grep Search `recurring\|recurrence`                                                                                                                                                                                         | run_action `{"target":"button \"Checkout\""}`                                                     |
| Lightpath calls              | 0                                                                                                                                                                                                                           | 1                                                                                                 |
| End                          | "I haven't reproduced your Review Inbox example in the running app, so the fix is untested end to end."                                                                                                                     | "I haven't run the checkout again to confirm it."                                                 |

In r01, the first grep found `backend/modules/tasks/recurringTaskService.js`. The agent read it and `routes.js`, followed the serializer, and fixed the bug with text search alone. It took 13 steps; the 5 `without` runs of r01 took 12.2 on average.

## Why our texts didn't point it at Lightpath

1. **The trigger doesn't match a bug report.** Our rule fires on "which code handles a button, page or request" and "why an action fails". The r01 report is neither. The action works; it shows a wrong value. A user's "I do X and see Y" is the common case, and no text names it.
2. **b01 matched by chance.** The example in the description and in the AGENTS.md rule is `button "Checkout"`. That is the shop's own button, and b01's report says "press Checkout". The agent copied the example as is. The texts helped where the user's words happened to equal our example.
3. **Nothing says a flow can be replayed.** The texts describe one click ("Click a button or link ... Can fill fields first"). r01 needs sign-in, a new repeating task, then a click on Upcoming. No text says the page, sign-in and data stay between calls, so a run of calls can reproduce a flow. The agent had no reason to think run_action could set up the task.
4. **Text search was cheap, and the texts never said to reproduce first.** The report's words ("repeats", "Upcoming") led straight to the right file. With only "before searching files" tied to the narrow trigger, the agent did what the `without` agent does.
5. **The fix loop needs a "before" trace.** "After a fix, call run_action again" can't start without a first call. Both agents skipped the rerun, and both said so.

## What to change (general texts only)

- Make the bug report the first trigger: when the user reports a bug they see in the app, reproduce it with run_action before searching files.
- Say that each call is one step, and that the page, sign-in and data stay between calls. Sign in with `fill`, do the setup steps, then do the step that shows the bug.
- Use a neutral example (`button "Save"`), not the shop's Checkout, so no suite gets help from the example's wording.
- Keep the limits: each description under 300 characters, instructions under 1,000, `tools/list` at most 4,000 (D-119, D-129).
