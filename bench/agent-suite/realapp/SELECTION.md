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

Filled in after the rule above was committed (commit 0d4c219, before any candidate was read). The walk stopped at the 5th kept candidate, 89 first-parent commits back from the pin (the 33rd candidate) (`git log --first-parent`, subjects starting with `fix`/`Fix`/`Fixed` or a pull-request merge with "fix" in the title). Every candidate up to that point is listed, newest first; the two held-out rows show only their position, and the full table is `SELECTION-full.md` in the held-out zip. The raw candidate list is in `lightpath-trials/goal/realapp-raw/candidates.txt`, outside the repo.

| #   | Commit     | Date       | Subject (shortened)                                               | Result   | Step and reason                                                                        |
| --- | ---------- | ---------- | ----------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------- |
| 1   | `99ef6952` | 2026-10-28 | api: add a task to today's plan when the task API gets today:true | drop     | a: only API and MCP clients send `today: true`; the UI never does                      |
| 2   | `19191f1f` | 2026-10-28 | projects: save priority names as numbers so Postgres accepts them | drop     | b/d: only fails on Postgres; on the default SQLite a name is stored and read back fine |
| 3   | `f63b57c3` | 2026-10-26 | everyone: keep empty banner from overlapping people cards         | drop     | d: overlap is layout only, no text or API change                                       |
| 4   | `aca0a062` | 2026-10-26 | calendar: place feed events by clock time on DST change days      | drop     | a: changes tests only                                                                  |
| 5   | `7a1d8c86` | 2026-10-26 | calendar-feeds: place events by wall clock on DST change days     | drop     | b: needs an outside iCal feed                                                          |
| 6   | `32f6a8bd` | 2026-10-22 | caldav: keep a task's due time in both directions                 | drop     | b: needs a CalDAV client or server                                                     |
| 7   | `23a48794` | 2026-10-22 | landing: translate 16 missing landing keys                        | drop     | a: translations only                                                                   |
| 8   | `dd8e4514` | 2026-10-22 | upcoming: keep the due time of recurring tasks                    | **take** | kept #1 -> visible **r01**                                                             |
| 9   | `995b108f` | 2026-10-22 | mcp: support none priority in task tools                          | drop     | a: MCP tools, not the UI                                                               |
| 10  | `8a072831` | 2026-10-22 | admin: give dashboard cards their own background in dark mode     | drop     | d: colour only                                                                         |
| 11  | `c68ec3fd` | 2026-10-20 | today: give Not planned task titles the row on phones             | drop     | d: layout only                                                                         |
| 12  | `1a18377e` | 2026-10-20 | layout: keep the page and offer a retry when a store fails        | drop     | d: needs a failing server to show                                                      |
| 13  | `c2059f73` | 2026-10-20 | sidebar: hide the empty notes panel when there are no notes       | drop     | d: the symptom is an empty tinted box, no text                                         |
| 14  | `a2a4b31a` | 2026-10-20 | inbox: keep a long note readable in the composer on phones        | drop     | d: layout only                                                                         |
| 15  | `dcfdca59` | 2026-10-19 | admin: refuse to resend the empty account emails by hand          | drop     | b: email                                                                               |
| 16  | (held out) | (held out) | (held out: commit and subject are in the zip)                     | **take** | kept #2 -> **held out**                                                                |
| 17  | `abfac61c` | 2026-10-18 | everyone: only list assigned tasks the viewer can read            | drop     | b: access-control (security) fix                                                       |
| 18  | `f4233eb9` | 2026-10-18 | inbox: keep the date, tags and people when an item is edited      | drop     | c: revert doesn't apply to the pin (later changes to the same lines)                   |
| 19  | `7a40d4e5` | 2026-10-17 | caldav: map PRIORITY, DTSTART and VALARM                          | drop     | b: needs a CalDAV client                                                               |
| 20  | `1dbb9be6` | 2026-10-17 | merge #1918: use the shared date picker for the goal target date  | drop     | b: consistency change; the old date input worked                                       |
| 21  | `4e5b6379` | 2026-10-17 | send the CSRF token from the reset and forgot password pages      | drop     | b: the reset page is reached from an emailed link                                      |
| 22  | `b6597917` | 2026-10-17 | today: save a status picked from a subtask row                    | **take** | kept #3 -> visible **r02**                                                             |
| 23  | `020ebff6` | 2026-10-14 | calendar: wrap the header so Today and next fit a phone in French | drop     | d: layout only                                                                         |
| 24  | `b9b89a12` | 2026-10-14 | caldav: read floating and unresolved TZID times                   | drop     | b: needs a CalDAV client                                                               |
| 25  | (held out) | (held out) | (held out: commit and subject are in the zip)                     | **take** | kept #4 -> **held out**                                                                |
| 26  | `54de28b3` | 2026-10-14 | merge #1897: open area and goal menus above the project panel     | drop     | d: stacking order only (the menu text is in the page, drawn under a panel)             |
| 27  | `d154e15f` | 2026-10-13 | advance recurring tasks completed over MCP                        | drop     | a: MCP only                                                                            |
| 28  | `968bb430` | 2026-10-13 | inbox: open the edit box with the cleaned title                   | drop     | c: revert doesn't apply to the pin                                                     |
| 29  | `10828c14` | 2026-10-12 | inbox: lay out inbox items on the task sheet                      | drop     | d: layout only                                                                         |
| 30  | `7ded0f44` | 2026-10-11 | ios: draw under the notch                                         | drop     | d: layout only                                                                         |
| 31  | `3ad9822e` | 2026-10-11 | capture: link a project page's task to that project by uid        | drop     | c: revert doesn't apply to the pin                                                     |
| 32  | `88b29a97` | 2026-10-11 | mcp: accept tags sent as a JSON array string                      | drop     | a: MCP only                                                                            |
| 33  | `c628ea21` | 2026-10-10 | focus: scrollable, searchable, open-projects-only menus           | **take** | kept #5 -> visible **r03**                                                             |

Kept: 5 of 33 candidates, so no bug had to be seeded. By rule 5, kept #2 and #4 are held out (`HELDOUT.md`, in the zip only).

### One reading of the rule, settled before any run

Rule 3c says the fix's test files "stay as they are and are not part of the trial". The pinned commit contains each fix's tests, and they name the issue and the expected behaviour, which a real repository with the bug wouldn't have. So the fix's test changes are reverted with its code: each `bug.patch` is the whole commit reverted (all its files are under `backend/` or `frontend/`). The clean-revert test (3c) was first run on the app code only; it was re-run on whole commits and still applies for all 5, except r01: a later commit (`7a1d8c86`) added 28 lines to the test file r01's fix created, so r01's `bug.patch` deletes that test file whole. This was decided after the candidates were listed and before any run, and it applies to all 5 the same way.

## Public or not (owner's rule, 2026-11-01)

The model may know a fix from training if it is public. All five come from tududi's public history, so every fix is public: **yes** for all 5. The visible ones:

| Bug | Fix commit | Date       | Pull request                                          | Issue                                                   | Public |
| --- | ---------- | ---------- | ----------------------------------------------------- | ------------------------------------------------------- | ------ |
| r01 | `dd8e4514` | 2026-10-22 | [#1938](https://github.com/chrisvel/tududi/pull/1938) | [#1932](https://github.com/chrisvel/tududi/issues/1932) | yes    |
| r02 | `b6597917` | 2026-10-17 | [#1915](https://github.com/chrisvel/tududi/pull/1915) | [#1914](https://github.com/chrisvel/tududi/issues/1914) | yes    |
| r03 | `c628ea21` | 2026-10-10 | [#1865](https://github.com/chrisvel/tududi/pull/1865) | none named in the commit                                | yes    |

Commit links: `https://github.com/chrisvel/tududi/commit/<sha>`. Each issue and pull request was checked with the GitHub API on 2026-11-01 (number, type, state, dates): all are closed, and each issue is a `[BUG]` report opened by a user 0 to 4 days before its fix merged. Issue #1914 reports the subtask status on the Today page; r02's report uses All Tasks, where the same row component loses the status (proven by the check). The held-out two are public too (count in `HELDOUT.md`, details in the zip). The trial copies have no `.git` folder, so the agent can't read the fix from `git log`; it could still know it from training.
