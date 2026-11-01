// The texts of docs/design/agent-loop.md section 3 (D-119), copied exactly. Tests check the limits:
// instructions under 1,000 characters, each description under 300, tools/list at most 4,000.

/** The server's `instructions`: what Lightpath records, when to call it, the fix loop, the cap. */
export const INSTRUCTIONS =
  "Lightpath records which source lines actually ran, in the browser and on the Node server, for each action in the user's running app. It uses real runtime coverage, not static analysis. Use it when asked which code handles a button, page or request, why an action fails, or whether a fix changed what runs. run_action clicks or presses a key in the app and returns that action's trace in one call; find_code_for_action returns the latest trace for a label without acting. Every result is capped at about 4,000 tokens: follow its 'not shown' line to drill down with get_trace. To check a fix, call run_action before and after it, then diff_traces with both trace ids.";

export const DESCRIPTIONS = {
  find_code_for_action:
    'Find the files, functions and lines that ran, frontend and backend, the last time an action was done in the app. Use it before searching files when asked which code handles a button or feature. Input: words from the button or link label. To do the action yourself, use run_action.',
  get_trace:
    "Show the executed code of one recorded action, one file or function at a time, with lines that did not run marked, paged. Use it after a 'not shown' line, or to read which branches of a function ran. Input: trace id, plus file path or function name.",
  list_traces:
    'List recent recorded actions (clicks, key presses, requests), newest first, with trace ids, file and error counts. Use it to find trace ids for get_trace or diff_traces.',
  diff_traces:
    'Compare two traces of the same action, before and after a code change, at function level: functions and branches that ran in only one, changed call counts, and errors that appeared or went away. Use it to verify a fix.',
} as const;
