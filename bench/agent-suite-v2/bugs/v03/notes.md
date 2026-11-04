# v03: editing a schedule undoes my skipped date

- **Real.** List slot R4, Actual Budget (SELECTION.md amendment 8). Commit `8e6eb272` "Preserve skipped schedule dates when editing schedules", merged 2026-10-30 (PR [#9173](https://github.com/actualbudget/actual/pull/9173), issue [#9167](https://github.com/actualbudget/actual/issues/9167)). `bug.patch` reverts the whole commit (its tests and release note included).
- Public: yes.
- Kind: **interaction order.** Skip, then edit: the save compares the account condition under two different field names, decides the account changed, and resets the next date. An edit without a skip before it looks right.
- Check (browser): demo budget, skips an upcoming schedule, edits its amount, saves; requires the next date to stay where the skip moved it.
- fix2.patch: none.
