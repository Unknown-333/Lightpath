# v01: my comments are signed "Unknown"

- **Real.** List slot R1. tududi commit `8d0dda4e` "fix(comments): show a name for comment authors without a profile name", merged 2026-10-01 (PR [#1756](https://github.com/chrisvel/tududi/pull/1756), issue [#1754](https://github.com/chrisvel/tududi/issues/1754), opened by a user 2026-10-01). `bug.patch` reverts the whole commit (its integration test included).
- Public: yes.
- Kind: **data-dependent branch.** Only an author with no profile name (email-only sign-up) gets a null name, which the page shows as "Unknown". The dev user has no profile name.
- Overlap: the same backend file as v1's held-out h02 (a different function).
- Check (browser): posts a comment on a task and requires the author shown next to it to be a name, not "Unknown". A backend fix (name fallback) and a frontend fix (show the email when the name is missing) both pass.
- fix2.patch: none written; the check is built so a frontend fallback also passes.
