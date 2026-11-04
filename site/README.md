# Lightpath landing page

One static page, built from files in this repo. No framework, no analytics, no requests to any other server.

```sh
corepack pnpm install
corepack pnpm site:build    # writes site/dist
corepack pnpm site:check    # builds, then checks (needs Google Chrome)
node site/tools/serve.mjs   # serves site/dist at http://127.0.0.1:4321/Lightpath/
```

## What is generated

`build.mjs` fills `src/index.html` and writes `dist/`:

| Part                                            | Comes from                                                                            |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Hero art and its loop                           | concept A in `brand/src/concepts.mjs`, drawn as SVG by `lib/art.mjs`                  |
| Headline (pixel type)                           | the brand font in `brand/src/font.mjs`; the real text is in the `h1` for every reader |
| Logo in the top bar and footer                  | the official lockup in `brand/logo` (same outlines as its SVG files), always clean    |
| Favicons and apple-touch-icon                   | copied from `brand/logo/svg` and `brand/logo/png` (run `pnpm brand:logo` to change)   |
| "How it works" drawings                         | `lib/art.mjs`, with the brand's `Print` raster and sprites                            |
| The trace in "What your agent gets back"        | the real `run_action` answer in `docs/media/tududi-run/transcript.jsonl`              |
| Demo GIF, social image                          | `docs/media/tududi-demo.gif`, `brand/out/og.png`                                      |
| `sitemap.xml`, `robots.txt`, canonical, OG tags | `SITE_URL` in `build.mjs`                                                             |

The site's address is one constant, `SITE_URL` in `build.mjs`. Asset paths are relative, so the page works under `/Lightpath/` now and at a domain root later. Only the 404 page uses the path from `SITE_URL`, because GitHub Pages serves it at any URL.

## Print effects

The page is a two-ink risograph print: marshmallow paper, deep indigo, bubblegum pink, and only the nine colours in `brand/src/palette.mjs` (the check fails on any other). Pink marks lit things.

- Paper grain (`src/paper.svg`, an `feTurbulence` tile) on the page surface, halftone dots for tints, and a 0.4-cell shift of the pink layer live under `html.fx` and touch art and surfaces only. Text and code are always flat ink.
- Effects start off when the system asks for reduced motion, reduced transparency or more contrast. The "Print effects" switch in the top bar overrides that and is remembered in `localStorage` on that device.
- The hero loop runs only under `prefers-reduced-motion: no-preference`. Otherwise it is one still, fully lit frame.

## What `site:check` checks

HTML validity (html-validate), anchors and links (links into this repo must point at files that exist), the palette, no third-party resources or analytics code, title and meta description, Open Graph and Twitter tags, JSON-LD (no ratings or reviews), sitemap and robots, copy rules from `docs/launch/facts.md` ("Don't claim"), then the page in Chrome under `/Lightpath/`: axe with effects on and off, any 404, any request to another origin, and the weight before media (budget 300 KB).

## Deploying (owner, once, after merging)

`.github/workflows/pages.yml` builds and checks the site on pull requests that touch it and on every push to `main`. On `main` it also deploys `site/dist` to GitHub Pages. That step fails until Pages is switched on:

1. Repo **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Re-run the latest "Site" workflow on `main` (Actions → Site → Re-run all jobs), or push to `main`.
4. The site is then at https://unknown-333.github.io/Lightpath/.

For a custom domain later: change `SITE_URL` in `build.mjs`, add the domain under Settings → Pages, and add a `CNAME` file to `dist` in `build.mjs`.

## Fonts

IBM Plex Sans and IBM Plex Mono, Latin subset, 400 and 600, from the `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` 5.3.0 packages. SIL Open Font License 1.1; the licence files are in `src/fonts/`.
