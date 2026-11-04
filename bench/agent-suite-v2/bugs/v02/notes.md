# v02: my custom report lists a category I unchecked

- **Real.** List slot R3, Actual Budget (SELECTION.md amendment 8). Commit `821bcc2a` "fix: custom reports showing excluded empty category rows", merged 2026-11-03 (PR [#9402](https://github.com/actualbudget/actual/pull/9402), issue [#3664](https://github.com/actualbudget/actual/issues/3664)). `bug.patch` reverts the whole commit (its tests and release note included).
- Public: yes.
- Kind: **data-dependent branch.** With "Show empty rows" on, the report adds every category with no data, including the unchecked ones; with it off, or for checked categories, it's right.
- Check (browser): demo budget, new custom report, data table, untick Food, Show empty rows; requires Food absent and the empty Savings row present.
- fix2.patch: none.
