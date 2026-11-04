# Recording the demo with Recordly

This is how the demo video and GIF are made, step by step, so anyone can make them again. The run is scripted; the recorder is not. A person presses Record and Stop in [Recordly](https://github.com/webadderall/Recordly) and does the editing there by hand. Recordly project files hold absolute paths to the raw recording, so this file, not a project file, is the record of how a take was made.

What the video shows is real: one kiro-cli agent run on a local copy of [tududi](https://github.com/chrisvel/tududi) (MIT, © Tududi Developers), with one bug planted in the copy for the demo. Nothing in it is typed in by hand, mocked up or made by AI.

## The story (12 to 15 s, loops)

1. Bug report: "Plan your day lists my low-priority tasks first."
2. The agent calls `run_action` on "Plan your day". The trace shows `GET /api/daily-plan/candidates` and `orderCandidates` in `backend/modules/daily-plan/ranking.js`. Lines that ran are pink; lines that didn't are grey.
3. The agent finds the reversed priority comparison and edits it.
4. The agent runs it again and the list reorders, with "Send Q4 report to finance" first. If it calls `diff_traces`, the terminal shows that too.

There is no VS Code heat view. The bug is a line that ran, with the wrong order, so in `orderCandidates` every line is lit. Heat on that function would show no ran-versus-not-run difference at the bug. The terminal already shows the difference where it exists (for example `priorityRank`, lines 39-40 not run). The extension's heat colour is also fixed in code: amber, `rgba(255, 184, 0, …)` in `extensions/vscode/src/decorations.ts`, with no setting. A pink scale would need a code change.

The agent is a real model run, so a take can go differently: it may skip the check, or take other steps. Keep the take that tells the story best, and don't cut a step that changes what happened.

## What `pnpm demo:take` does

`scripts/demo-take/take.mjs`, in order:

1. Makes a fresh copy of tududi at commit `99ef6952` (the real-app benchmark's, D-110), without its `.git` folder, under `~/lightpath-demo-takes/trials/`. It applies `scripts/demo-take/bug.patch` (the same bytes as PR #56's `scripts/demo-gif/bug.patch`): one priority comparison in `orderCandidates` has `a` and `b` swapped. Then it runs `lightpath init --agent kiro` in the copy.
2. Starts the Lightpath daemon and tududi with the Node agent, as `lightpath dev` does (API on port 3412, web on 8412). The API restarts by itself when a backend `.js` file's content changes, so the agent's fix takes effect. The session secret stays the same across restarts, so the user stays signed in. Lightpath's browser opens on screen, signs in, adds five tasks through tududi's own API and opens Today.
3. Opens Windows Terminal (`scripts/demo-take/view.mjs`). Both windows are moved with the Win32 API, with no mouse or keyboard input. The terminal goes at 0,0, 860 x 1080 px, and the browser at 860,0, 1060 x 1080 px. Together they cover 1920 x 1080 px at the top-left of the main display. Both stay on top during the take.
4. Shows 3-2-1, then the bug report (the exact prompt), then runs kiro-cli 2.37.0 with `claude-sonnet-5.5` at effort `medium`. The terminal prints kiro-cli's output as it arrives.
5. When kiro-cli exits, it holds the end state for 3 s. Then it resets the loop: the browser opens Today again and the terminal shows its first screen again. It holds that for 3 s, then stops everything it started and the windows close.

The terminal is a readable view of kiro-cli's `--output-format stream-json` output, not kiro-cli's own screen. Every line comes from that output. The view changes how it looks in these ways:

- Colour: line ranges that ran are pink and "not run" ranges are grey. Each function line gets a bar drawn from its own numbers: one cell per line, at most 20 cells, pink if it ran and grey if it didn't.
- Folding: in a trace, the view shows one server file of the first request in full. It picks, from the files whose path has a word of the request's URL path, the one with the most functions listed. So for `GET /api/daily-plan/candidates` it picks a `daily-plan` file. The rule uses the trace only, never what the agent edits later. Browser phases, other files and any request lines past the first two become one "(folded)" line with their counts. A long "not run" list is cut with "…". The full text is in `transcript.jsonl`.
- File reads: a Read File result shows only its line count.

The script also changes three small things in the page. None of them changes tududi's code or data:

- A pink dot shows where the agent clicks. Agent clicks are browser input sent through Chrome's DevTools protocol, so the OS cursor doesn't move. The dot is added with `evaluate`, so it has no script URL and traces leave it out.
- `Math.random` in the page uses a fixed seed. tududi's Today page shows a random quote, so without this the loop's last frame showed a different quote from the first (dry run 4). With it, the first and last frames match to the pixel (dry runs 5 and 6: 0 pixels differ).
- YouTube requests are blocked. tududi's first-run page embeds a video, and blocking it keeps the demo on this machine.

Each take writes a folder `~/lightpath-demo-takes/take-<time>/` with these files:

| File | What it is |
| --- | --- |
| `run.json` | kiro-cli version, model, effort, prompt, credits, steps, estimated tokens, CPU load, window frames, API restarts, the list order when kiro-cli exited |
| `transcript.jsonl`, `timing.json` | kiro-cli's stream-json output and when each line arrived |
| `agent-fix.diff` | what the agent changed in the copy |
| `end.png` | the page when kiro-cli exited |
| `app.log`, `kiro-cli.stderr.log`, `init.out` | logs |

Raw recordings and take folders stay out of git. Only the chosen take's prompt and transcript are committed, next to the exports.

## Before recording (once per session)

These are the owner's steps. The script changes no system setting.

1. Use the main display at 2560 x 1440 and 100% scaling. The window positions are in pixels and were measured at that size. At another scaling, the windows won't line up with the 1920 x 1080 region.
2. Turn on Do not disturb (Settings > System > Notifications), so no notification lands in the take.
3. Close other apps. The take windows stay on top inside the region, but a pop-up from another app can still show.
4. In a PowerShell window, from the repo root, run these once:

   ```powershell
   corepack pnpm install
   $env:LP_KIRO_CLI = 'C:\Users\user\lightpath-trials\tools\kiro-cli-2.37.0\LocalApp\Kiro-Cli\kiro-cli.exe'
   corepack pnpm demo:take --dry
   ```

   The dry run does everything except the model call. The script does the agent's steps itself: it clicks, undoes the bug, opens Today and clicks again. A pink "DRY RUN" line is on screen. It costs no credits and is never recorded. Check that both windows fill the top-left 1920 x 1080 and that the second list starts with "Send Q4 report to finance". `docs/media/demo-run/layout/` has screenshots of dry run 6.
5. The script adds a Windows Terminal profile, "Lightpath demo" (Cascadia Mono 16 pt, indigo `#1E1B4B`), as a fragment file. It does not edit your Windows Terminal `settings.json`. To remove the profile, delete the folder `%LOCALAPPDATA%\Microsoft\Windows Terminal\Fragments\Lightpath demo`.
6. Move the mouse pointer to the bottom-right corner of the screen, outside the 1920 x 1080 region. Don't touch the mouse or keyboard while a take runs.

## A take

A real take costs Kiro credits: the proof run cost 0.912.

1. In Recordly's recording bar, pick **Screen** and choose the main display. Turn off the microphone, system audio and webcam. Turn on **Hide HUD from recording**. Set the countdown delay to **No delay**, because the script has its own 3-2-1.
2. Press **Record**.
3. In the PowerShell window, run `corepack pnpm demo:take`.
4. Wait until both windows close and the shell prints `done: <folder>. Stop the recording now.` (about 1.5 to 2 minutes, most of it setup). Then press **Stop**.
5. Note the take folder name next to the recording.

Do 3 takes and keep the best. Raw recordings stay out of git.

## In Recordly's editor

These labels are from Recordly 1.4.0's own interface text, read from its installed files on 2026-11-04. They were not checked by clicking. If a label differs in your copy, use the control that does the same thing.

1. **Crop** (Crop section, **Open Crop Editor**): drag the sides to the take region: left and top edges of the screen, right edge at the browser's right edge (x 1920, 75% of the width), bottom edge at the windows' bottom (y 1080, 75% of the height). That is 16:9. If there is an aspect setting, set it to 16:9.
2. **Trim** (**Add Trim (T)**): cut everything before the first bug-report screen (the shell, the setup, the 3-2-1). After kiro-cli exits, keep the 3 s end state. Cut the moment the browser reloads Today, and cut everything after the loop screen. The loop screen is the same as the first screen, so the loop is clean.
3. **Speed** (**Add Speed (S)**, then **Playback Speed**): speed up only the waiting parts. Those are the agent thinking before its first call, the `run_action` waits (each takes about 5 s to settle), and the second run. Use **4x** or another value from the list (0.25x to 30x). Keep the bug report, the trace appearing, the edit and the reordered list at 1x.
4. **Annotation** (**Add Annotation (A)**): over each sped-up span, add a text annotation with the same span and the speed it plays at, for example "4x speed". Use one corner and the same size every time, large enough to read at 1280 x 720.
5. **Cursor**: turn off **Show Cursor** and set **Click Effects** to **Off**. The OS pointer never moves in a take (step 6 above), and the agent's clicks are the pink dot in the page. Recordly's cursor smoothing and click highlight work only on the OS pointer, so they have nothing to act on here.
6. **Zoom**: manual only. In Settings, turn off **Auto-apply fresh recording zooms** (on by default in 1.4.0), and delete any zoom regions it already added. Don't use **Suggest Zooms from Cursor**. Add a zoom (**Add Zoom (Z)**, mode **Manual**) only where text is too small at 1280 x 720, for example the trace's `ranking.js` lines and the reordered list.
7. **Background**: **Color**, solid deep indigo `#1E1B4B` or marshmallow white `#FFF7F2`. Set modest **Padding**, some **Roundness** and a low **Shadow**. No image, wallpaper, gradient or blur. No webcam and no audio.
8. **Export**, MP4: **MP4**, quality **Original** (or the highest offered), 1280 x 720.
9. **Export**, GIF: **GIF**, **Loop** on, **FPS** 10 to 15, output size close to 1280 x 720 or smaller. If the GIF is over 8 MB or looks rough, keep only the MP4. The GIF is then made from it with ffmpeg and gifski.
10. Save the exports to `~/lightpath-demo-takes/export/` and send the paths, with the chosen take's folder name.

After that, the scripted part goes on outside Recordly: the WebM from the MP4 (ffmpeg), the GIF from the MP4 if needed (ffmpeg + gifski), a poster PNG from the frame where the trace appears, and frame checks.

## What the script was tested on

| Run | What it showed |
| --- | --- |
| Dry runs 1, 2 | `node --watch` restarted the API again and again with no file changed, and requests failed with 504. Replaced by a restart on a real content change. |
| Dry run 3 | Window placement bug: in PowerShell `$h` and `$H` are one name, so the window handle overwrote the height. Fixed. |
| Dry run 4 | Layout right; the loop's last frame had another tududi quote. Fixed with the seeded `Math.random`. |
| Proof run 1 (real, 0.912 credits) | The agent ran `run_action`, read `ranking.js`, swapped the comparison back and clicked again. The API restart signed it out, so it couldn't check. Fixed with a fixed session secret per take. |
| Dry runs 5, 6 | The whole loop by script: the restart keeps the session, the list shows "Send Q4 report to finance" first after the fix, and the first and last frames match (0 pixels differ). |

Machine: Windows 11, display 2560 x 1440 at 100%, Windows Terminal 1.24, Recordly 1.4.0, Node 22, kiro-cli 2.37.0.
