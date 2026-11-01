# A subtask's status doesn't stick

On All Tasks I open a task's subtasks and click the "Set in progress" button on one of the subtasks. It looks in progress, but when I reload the page the subtask is back to not started.

To see it: sign in, add a task "Plan trip" with a subtask "Book hotel", go to All Tasks, click "Show subtasks" on "Plan trip", click "Set in progress" on "Book hotel", then reload.

The app runs with `node dev.mjs` (API on port 3402, web on http://localhost:8402, user dev@tududi.test, password DevPass123!).
