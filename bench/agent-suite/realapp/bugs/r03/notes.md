# r03: Focus offers projects I've already finished

- Source: tududi commit `c628ea21` "fix(focus): scrollable, searchable, open-projects-only menus in the Focus popover" (PR [#1865](https://github.com/chrisvel/tududi/pull/1865)), 2026-10-10. `bug.patch` reverts its whole app-code part, as the selection rule says. That commit also added a search box to the menus and a scroll limit; reverting removes them too. The check tests only the finished-projects part, so a fix needs no search box to pass.
- Public: yes. The fix is a public commit and pull request, so the model may know it from training.
- Category: missing condition in a frontend filter.
- Layer: frontend (the projects come from the API with their status; the menu doesn't filter them).
- Check: browser. Creates a finished and an open project, opens Focus > project menu, and requires the open one listed and the finished one not.
- Prediction, written before any run: **no**. The report names the Focus menu, and text search for "Focus" finds the popover component, where the filter is.
