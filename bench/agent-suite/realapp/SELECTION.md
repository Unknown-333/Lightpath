# How the real-app bugs were picked

This rule was written and saved before any candidate commit was looked at (D-110). The only thing known about tududi's history when it was written was the subject of the pinned commit itself.

## App and commit

- App: [chrisvel/tududi](https://github.com/chrisvel/tududi), React 18 + webpack 5 frontend, Express 4 + Sequelize + SQLite backend.
- Pinned commit: `99ef6952fcbdef463f2a59e3f3c8f13e9a1dd511` (2026-10-28, tag-free `main`), the commit Lightpath was already tested on (`docs/tested-apps.md`).

## The rule

1. **Source.** tududi's first-parent history on `main`, newest first, starting at the pinned commit and going back at most 300 commits.
2. **Candidate.** A commit whose subject marks it as a bug fix: it starts with `fix` (Conventional Commits `fix:` or `fix(scope):`), or with `Fix`/`Fixed`, or it is a merge of a pull request whose title does.
3. **Kept** if all of these hold, checked in this order and recorded for every candidate:
   - a. **User-reachable.** It changes app code under `backend/` or `frontend/` that runs when a user uses the UI. Dropped: changes only to tests, docs, CI, Docker, build config, dependency versions, translations, or migrations.
   - b. **A real user hits it in normal use.** The wrong behaviour shows up when someone uses the app as intended. Dropped: fixes that only an attacker would notice (security hardening), crashes only seen with outside services (email, Telegram, AI providers, push), and performance-only changes.
   - c. **Re-introducible.** Reverting the fix's app-code part (its test files stay as they are and are not part of the trial) applies cleanly to the pinned commit with `git apply -R`.
   - d. **Checkable.** A behavioural check can tell the bug from a fix on a fresh database, without outside services, in under 3 minutes: an API response, or text rendered in the page. The check must pass on any correct fix, not only the original one.
4. **Take the newest 5** that pass. If the 300 commits give fewer than 5, seed the rest by the rule in "If there are fewer than 5" below, and say so.
5. **Held out.** Fixed now, before seeing them: of the 5 in newest-first order, numbers 2 and 4 are held out. Numbers 1, 3 and 5 are visible as `r01`, `r02`, `r03`.
6. **Never** pick or drop a bug because of how easily text search would find it, how hard it seems, or whether Lightpath is likely to help. The prediction in each `notes.md` is written after the pick and doesn't change it.

## If there are fewer than 5

Seed the missing bugs one per kind, in this order, each in code a user reaches from the UI: a wrong field name between the frontend and an API route; a wrong condition in a backend route; a frontend state update that is lost. Each is written as a small change to the pinned commit, never to make search harder.

## The report text

Each `report.md` describes what a user does and sees: "I click X and Y happens." It names no file, function, route or error text. Where the original issue or pull request has a user's description, the report follows it in plain words.

## Candidates

Filled in after the rule above was committed to this file; every candidate the rule produced is listed with the step that took or dropped it.
