# Releasing Lightpath

A checklist for the owner. Agents prepare a release; only the owner publishes. Keep every token in a password manager: never in chat, a file, or the repo.

Commands are PowerShell on Windows. If `pnpm` isn't on `PATH`, run `corepack enable` once, or start each shell with `$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"`.

Steps 1 to 7 are how 0.0.1 went out. For 0.0.2, follow [Releasing 0.0.2](#releasing-002) at the end.

## What 0.0.1 publishes

| Registry            | Name                                                                            | Account                                         |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------- |
| npm                 | 7 packages under `@lightpath-dev/`                                              | `unknown-333`, owner of the `lightpath-dev` org |
| VS Code Marketplace | `lightpath-dev.lightpath-vscode`                                                | publisher `lightpath-dev` (D-066)               |
| PyPI                | `lightpath-agent` 0.0.1: already published on 2026-10-28 (D-065), nothing to do |                                                 |

## 1. Start from a clean clone of main

The release PR is merged and every CI check on `main` is green. Then:

```powershell
git clone https://github.com/Unknown-333/Lightpath.git lightpath-publish
cd lightpath-publish
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

A fresh clone, not your working checkout: `pnpm publish` refuses to run unless the tree is clean, the branch is `main`, and it is up to date with `origin`. Untracked scratch files such as `day1.tmp` count as a dirty tree.

## 2. Test what users will install

Pack the 7 packages and install them into a copy of the example shop outside the repo, in a folder whose path has a space:

```powershell
$tgz = "$env:TEMP\lightpath-0.0.1\tgz"
$shop = "$env:TEMP\lightpath-0.0.1\fresh install\my shop"
New-Item -ItemType Directory -Force $tgz, $shop | Out-Null
foreach ($p in 'protocol', 'core', 'node-agent', 'browser', 'daemon', 'mcp', 'cli') {
  Push-Location "packages\$p"; pnpm pack --pack-destination $tgz; Pop-Location
}
tar -xOf "$tgz\lightpath-dev-cli-0.0.1.tgz" package/package.json | Select-String workspace   # must print nothing
```

Copy the shop without `node_modules`, `dist` and `.lightpath`, and make it self-contained: its tsconfig files extend `../../tsconfig.base.json`, which exists only in the repo. Change the copy, never `examples/shop`.

```powershell
Copy-Item examples\shop\* $shop -Recurse -Exclude node_modules, dist, .lightpath
Copy-Item tsconfig.base.json $shop
foreach ($f in 'tsconfig.json', 'tsconfig.server.json') {
  $file = Join-Path $shop $f
  (Get-Content $file -Raw).Replace('"../../tsconfig.base.json"', '"./tsconfig.base.json"') | Set-Content $file -NoNewline
}
cd $shop
npm install
npm install -D (Get-ChildItem $tgz\*.tgz).FullName
```

Then check, in `my shop`:

| Step                                                          | Expected                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npx lightpath --version`                                     | `lightpath/0.0.1 ...`                                                                       |
| `npx lightpath doctor`                                        | five ✓                                                                                      |
| `npx lightpath dev -- node dev.mjs`                           | Chrome opens on the shop. If the product list is empty, reload the page once (see below)    |
| Add to cart, then Checkout                                    | the terminal's Checkout trace lists `src/Cart.tsx` and `server/routes/orders.ts` with lines |
| Reload the page, Add to cart, Checkout                        | the same files and lines again, no `no-source` (D-101)                                      |
| `npx lightpath doctor` in `my shop\src`, in a second terminal | `running on port ..., pid ... (started in ...\my shop)` (D-102)                             |

Stop `lightpath dev` with Ctrl+C.

## 3. Test the VS Code package

```powershell
pnpm --filter lightpath-vscode exec vsce package
$env:LIGHTPATH_VSCODE_VSIX = "$PWD\extensions\vscode\lightpath-vscode-0.0.1.vsix"
pnpm test:vscode
Remove-Item Env:LIGHTPATH_VSCODE_VSIX
```

Expected: `extension 0.0.1 from ...\Temp\lightpath-vscode-...\extensions\lightpath-dev.lightpath-vscode-0.0.1`, then `VS CODE TEST PASSED`. With the variable set, the test installs the `.vsix` into a throwaway profile and tests that copy (D-103). Without it, it tests the source folder. The `.vsix` holds 6 files, about 100 KB. Don't commit it (`*.vsix` is ignored).

## 4. Publish to npm

```powershell
npm login                      # as unknown-333, in the browser
npm whoami                     # must print unknown-333
npm org ls lightpath-dev       # unknown-333 must be listed as owner
pnpm -r --filter "./packages/*" publish --dry-run   # shows the 7 tarballs, sends nothing
```

Then publish in this order. Each package depends only on packages above it, so the CLI goes last and `npx @lightpath-dev/cli` never meets a missing dependency:

```powershell
pnpm --filter @lightpath-dev/protocol publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/node-agent publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/core publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/browser publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/daemon publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/mcp publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/cli publish --publish-wait-timeout 600000
```

- Use `pnpm publish`, not `npm publish`. pnpm replaces each `workspace:*` dependency with `0.0.1`; plain `npm publish` in a package folder ships `workspace:*` as written, and nobody can install the package.
- `--publish-wait-timeout` waits until npm serves the new version (npm scans each upload first), so the next package finds its dependency.
- With two-factor authentication pnpm asks for the one-time code, or pass `--otp <code>`.
- `publishConfig.access` is `public` in every package (D-099), so the scoped packages are public on the first publish.
- npm accepts each version once, even after an unpublish. If a publish fails halfway, fix the cause and continue with the packages not yet published; never publish a version twice.

Check:

```powershell
npm view @lightpath-dev/cli@0.0.1 dependencies   # every @lightpath-dev/* entry is 0.0.1
cd $env:TEMP; npx -y @lightpath-dev/cli@0.0.1 --version
```

## 5. Publish to the VS Code Marketplace

```powershell
pnpm --filter lightpath-vscode exec vsce login lightpath-dev
pnpm --filter lightpath-vscode exec vsce publish --packagePath lightpath-vscode-0.0.1.vsix
```

`vsce login` asks for a personal access token from Azure DevOps (scope Marketplace: Manage) and keeps it in your system's credential store. `--packagePath` publishes the exact `.vsix` that step 3 tested. The listing appears at [marketplace.visualstudio.com](https://marketplace.visualstudio.com/items?itemName=lightpath-dev.lightpath-vscode) after the Marketplace's own checks, usually within minutes.

## 6. PyPI

`lightpath-agent` 0.0.1 was uploaded on 2026-10-28 at 19:21 UTC, after the last change to `agents/python` (d922587). PyPI accepts each file name once, so 0.0.1 has nothing to upload: `twine upload` would answer `400 File already exists`. For the next Python release:

```powershell
cd agents\python
# set the new version in pyproject.toml and in src\lightpath_agent\__init__.py (__version__)
Remove-Item -Recurse -Force dist   # dist\* still holds the 0.0.1 files
python -m build
python -m twine check dist/*
python -m twine upload dist/*      # user __token__, with a token scoped to the lightpath-agent project
```

## 7. After publishing

```powershell
git tag -a v0.0.1 -m "Lightpath 0.0.1"
git push origin v0.0.1
```

Then change the `0.0.1` heading in `CHANGELOG.md` from "not published yet" to the publish date, in a small PR.

## What the 0.0.1 checks found

- A first `lightpath dev` in a fresh install reloads the page once (Vite optimizes its dependencies), and every reload lost the frontend files. Fixed before release (D-101); step 2 reloads on purpose to keep it fixed.
- `lightpath doctor` in a subfolder disagreed with `lightpath mcp` about whether the daemon runs. Fixed (D-102).
- The example shop's `dev.mjs` starts Vite and the API at the same time. When the browser opens before the API listens, the product list stays empty until a reload. The same race makes the first `pnpm e2e` or `pnpm test:vscode` after a build time out now and then on the product list; a second run passes.
- `pnpm test:vscode` tests the source folder unless `LIGHTPATH_VSCODE_VSIX` names a `.vsix` (D-103).


## Releasing 0.0.2

0.0.2 publishes 2 npm packages: `@lightpath-dev/browser` (the D-105 fix) and `@lightpath-dev/cli` (its npm page README, and it needs browser 0.0.2). Everything else stays at 0.0.1 (D-107):

| Stays at 0.0.1                                                   | Why                                                                                                                                                   |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@lightpath-dev/protocol`, `core`, `node-agent`, `daemon`, `mcp` | No file they ship changed since `v0.0.1`                                                                                                              |
| VS Code extension `lightpath-dev.lightpath-vscode`               | Not republished: nothing in `extensions/vscode` changed since `v0.0.1`, and it bundles only `core` and `protocol` (D-100), which didn't change either |
| `lightpath-agent` (PyPI)                                         | Nothing in `agents/python` changed                                                                                                                    |

The release PR is merged and every CI check on `main` is green. Then, in a new PowerShell window:

```powershell
$env:PATH = "$env:LOCALAPPDATA\corepack-shims;$env:PATH"
cd $HOME\Desktop\lightpath-publish
git switch main
git pull
git status                     # must say "nothing to commit, working tree clean"
pnpm install --frozen-lockfile
pnpm check
pnpm build
npm whoami                     # must print unknown-333; if not, run npm login first
pnpm -r --filter @lightpath-dev/browser --filter @lightpath-dev/cli publish --dry-run   # shows the 2 tarballs, sends nothing
```

The dry run must list `@lightpath-dev/browser@0.0.2` and `@lightpath-dev/cli@0.0.2` and nothing else. Then publish browser first, then cli. The cli's `package.json` names browser `0.0.2`, so npm must serve browser 0.0.2 before anyone installs cli 0.0.2:

```powershell
pnpm --filter @lightpath-dev/browser publish --publish-wait-timeout 600000
pnpm --filter @lightpath-dev/cli publish --publish-wait-timeout 600000
```

What 0.0.1 taught: each publish asks for the security key. If you tick "don't ask again for 5 minutes", the wait after a publish (`--publish-wait-timeout`, while npm scans the upload) can use up those 5 minutes, so the cli publish may ask for the key again. Have the key ready for both.

Check:

```powershell
npm view @lightpath-dev/cli@0.0.2 dependencies   # @lightpath-dev/browser 0.0.2; daemon, mcp, node-agent, protocol 0.0.1
cd $env:TEMP; npx -y @lightpath-dev/cli@0.0.2 --version   # lightpath/0.0.2 ...
```

Then tag the release:

```powershell
cd $HOME\Desktop\lightpath-publish
git tag -a v0.0.2 -m "Lightpath 0.0.2"
git push origin v0.0.2
```

Then change the `0.0.2` heading in `CHANGELOG.md` from "not published yet" to the publish date, in a small PR.

What the 0.0.2 checks found: the 2 packed tarballs, installed with the 0.0.1 packages from npm into a copy of the shop (step 2's copy and tsconfig fix), print `lightpath/0.0.2`, pass `lightpath doctor`, and both Checkout traces, before and after a reload, list `src/Cart.tsx` and `server/routes/orders.ts` with lines.
