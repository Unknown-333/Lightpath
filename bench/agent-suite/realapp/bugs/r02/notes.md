# r02: a subtask's status doesn't stick

- Source: tududi commit `b6597917` "fix(today): save a status picked from a subtask row" (PR [#1915](https://github.com/chrisvel/tududi/pull/1915), issue [#1914](https://github.com/chrisvel/tududi/issues/1914)), 2026-10-17. `bug.patch` reverts its app-code part (one prop on the nested subtask rows); its test is not in the trial.
- Public: yes. The fix is a public commit and pull request, and the issue is public, so the model may know it from training.
- Category: event wiring; the click goes to a handler that only updates local state and never saves.
- Layer: frontend (no request is sent, which is the bug).
- Check: browser plus API. Clicks "Set in progress" on the subtask row in All Tasks and requires the subtask's saved status to be in progress.
- Prediction, written before any run: **unsure**. A trace shows that the click ran the local handler and sent no request, which points at the missing save; but the code path is a few components deep and the same component is used elsewhere with the save switched on, which text search can also find.
