# r01: repeating tasks show the wrong time in Upcoming

- Source: tududi commit `dd8e4514` "fix(upcoming): keep the due time of recurring tasks" (PR [#1938](https://github.com/chrisvel/tududi/pull/1938), issue [#1932](https://github.com/chrisvel/tududi/issues/1932)), 2026-10-22. `bug.patch` reverts its app-code part (backend recurrence service, the All Tasks list merge and its helper); its tests are not in the trial.
- Public: yes. The fix is a public commit and pull request, and the issue is public, so the model may know it from training.
- Category: wrong value built in a backend service (a timed instant replaced by a date-only string for the computed repeats).
- Layer: backend, reached from the Upcoming page; the original fix also touched the frontend.
- Check: API. Creates a daily task due today at 15:30 and requires every Upcoming row of the series (at least 3) to say 15:30.
- Prediction, written before any run: **yes**, knowing what ran helps. The report names no code, and the Upcoming read goes through a long route into the recurrence service; a trace of the Upcoming request points at the function that builds the repeats, which text search for "upcoming" or "due_time" reaches only among many hits.
