# Lightpath for VS Code

Click anything in your running app and watch the code that ran light up in your editor, brighter the more times it ran.

## Use it

1. In your project, run `npx @lightpath-dev/cli dev -- npm run dev` (or your own dev command).
2. Open the same folder in VS Code. The extension finds Lightpath through `.lightpath/daemon.json`.
3. Click something in the browser window Lightpath opened. The lines that ran glow in the editor.

## What you get

- **Heat**: every line that ran for the last action is highlighted, in 8 levels by hit count. Lines that ran more than once show `× N`.
- **Actions view**: recent clicks and requests, each with the files it touched.
- **Replay**: steps through an action's files in the order they ran, browser first, then each backend.
- Highlights fade after 10 seconds (`lightpath.fadeSeconds`). Pin them with **Lightpath: Keep Highlights**.

Nothing leaves your machine. The extension talks only to the Lightpath daemon on `127.0.0.1`, using the token in `.lightpath/daemon.json`.

## Develop

From the repo root, press F5 with the "Lightpath extension (example shop)" launch configuration. It bundles the extension with esbuild and opens the example shop in a development window.

`pnpm test:vscode` (from the repo root) runs the example shop under Lightpath, starts a separate VS Code with the extension, clicks Checkout, and checks the lit lines, Clear, and Replay.

`pnpm --filter lightpath-vscode demo` records the demo in `docs/media/demo.gif`: the shop on the left, VS Code on the right, filmed through DevTools screencasts so nothing else on your screen is recorded. It needs ffmpeg on `PATH` (or `FFMPEG=<path>`) and writes `demo.mp4` and `demo.gif` to `extensions/vscode/.demo`.
