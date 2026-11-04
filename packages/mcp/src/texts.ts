// The texts of docs/design/agent-loop.md section 3 (D-119), with build 5's run_request clause and
// shorter descriptions so six tools fit in tools/list (D-129). Tests check the limits:
// instructions under 1,000 characters, each description under 300, tools/list at most 4,000.

/** The server's `instructions`: what Lightpath records, when to call it, the fix loop, the cap. */
export const INSTRUCTIONS =
  "Lightpath records which source lines actually ran, in the browser and on the Node server, for each action in the user's running app. It uses real runtime coverage, not static analysis. Use it first when the user reports a bug they see in the app: reproduce it with run_action before searching files, one step per call (the page, sign-in and data stay between calls). Also use it when asked which code handles a button, page or request, or whether a fix changed what runs. run_action clicks or presses a key in the app and returns that action's trace in one call; run_request does the same for one HTTP request, with no browser; find_code_for_action returns the latest trace for a label without acting. Every result is capped at about 4,000 tokens: follow its 'not shown' line to drill down with get_trace. To check a fix, call run_action again with compareTo \"last\": it adds what changed.";

export const DESCRIPTIONS = {
  find_code_for_action:
    'Find the files, functions and lines that ran, frontend and backend, the last time an action was done in the app. Use it before searching files when asked which code handles a button or feature.',
  get_trace:
    "Show the executed code of one recorded action, one file or function at a time, with lines that did not run marked, paged. Use it after a 'not shown' line, or to read which branches ran.",
  list_traces:
    'List recent recorded actions, newest first, with trace ids and file counts. Use it to find ids for get_trace or diff_traces.',
  diff_traces:
    'Compare two traces of the same action, before and after a code change, at function level: functions and branches that ran in only one, and changed call counts. Use it to verify a fix.',
  run_request:
    "Send one HTTP request to the user's running app on localhost and return the backend files, functions and lines it ran, with its status. No browser needed: use it for APIs and backend-only apps, or to rerun a request after a fix.",
} as const;
