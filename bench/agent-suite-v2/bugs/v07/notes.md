# v07: Today lists my day backwards

- **Seeded.** SELECTION.md amendment 6, X2 (owner's Phase D: inverted comparator). Kind: data-dependent (only with 2 or more timed blocks). One line in `frontend/components/DailyPlan/planUtils.ts`: the agenda's time-order comparator has its sides swapped.
- Not the README demo's bug: the demo inverts the priority comparator in `backend/modules/daily-plan/ranking.js`, which the pick rule skips whole.
- Check (browser + API): plans 14:00, 09:00 and an untimed task, starts the day, and requires Today's list in time order.
- fix.patch: the comparator restored. fix2.patch: none (one line; any fix that sorts by start time passes).
