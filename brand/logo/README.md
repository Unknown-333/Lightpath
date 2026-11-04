# Lightpath logo

A draft for the owner's review. Nothing here is used in the README, the site, npm or GitHub yet.

Every file is drawn in code from the shapes in `src/`. The SVG files are outlines only: no fonts, strokes, filters, gradients or bitmaps. The PNG and ICO files are drawn from the same shapes by a small rasterizer in `src/raster.mjs`. Nothing is drawn by hand or by an image model.

The review sheet is `review/logo-sheet.png`. The per-concept sheets are `review/concept-*.png`.

## Rebuild

```sh
pnpm brand:logo
```

This runs `node brand/logo/build.mjs`. It needs only Node: no network, no browser, no packages. It deletes and rewrites `svg/`, `png/`, `riso/` and `review/`, plus `tokens.json` and `tokens.css`, then runs the checks in `src/check.mjs`. It fails if an SVG has text, an image, a filter, a gradient, a stroke or a colour that is not a token, if a clean file has more than two colours, or if a file is over its size limit. Two builds in a row give byte-identical files (44 files, 0 differences on 2026-11-04).

## The recommended logo: concept 1, path mark

A pink dot (the click) runs down a line that turns right once and ends in an indigo square (the end node). The pink stops where the code stopped running.

| File                                                | What                                         |
| --------------------------------------------------- | -------------------------------------------- |
| `svg/lightpath-mark-*.svg`                          | mark only, 16-unit box                       |
| `svg/lightpath-wordmark-*.svg`                      | wordmark only                                |
| `svg/lightpath-lockup-horizontal-*.svg`             | mark left, wordmark right                    |
| `svg/lightpath-lockup-stacked-*.svg`                | mark above, wordmark below                   |
| `svg/favicon.svg`                                   | favicon, turns white in dark mode            |
| `svg/app-icon.svg`                                  | square app icon                              |
| `png/favicon-16.png`, `-32`, `-48`                  | favicons on a marshmallow tile               |
| `png/favicon.ico`                                   | the three favicons in one file (PNG entries) |
| `png/apple-touch-icon.png`                          | 180 x 180                                    |
| `png/app-icon-512.png`, `-1024`                     | square app icon                              |
| `png/avatar-400.png`                                | 400 x 400 for GitHub and npm                 |
| `png/lightpath-mark-colour-64.png`, `-256`, `-1024` | mark on a transparent background             |
| `riso/*.svg`, `riso/*-preview.png`                  | riso-textured version, website art only      |
| `tokens.json`, `tokens.css`                         | the colour tokens                            |

Colourways (`*` above): `colour` (indigo and pink), `indigo` (one colour), `black`, `white` (for dark backgrounds) and `reversed` (white and pink, for dark backgrounds). The wordmark has no pink, so it has no `reversed` file, and `colour` is the same as `indigo`.

All file sizes are in `review/check.json`. The largest clean SVG is 5.8 KB, the ICO is 1.1 KB and the avatar is 2.9 KB.

## Colours

The hex values come from `brand/src/palette.mjs` (the riso palette, PR #57). The logo uses one indigo and one pink.

| Token            | Hex       | Use                                       |
| ---------------- | --------- | ----------------------------------------- |
| `lp-indigo`      | `#2b2684` | the path, the end node, the wordmark      |
| `lp-pink`        | `#ff4f9f` | the lit part only (the click and its run) |
| `lp-marshmallow` | `#fcf5ec` | the paper behind the logo, not logo ink   |
| `lp-black`       | `#000000` | one-colour black version                  |
| `lp-white`       | `#ffffff` | white version on dark backgrounds         |

Contrast, from `review/check.json` (WCAG formula): indigo on marshmallow 11.33, indigo on white 12.26, white on indigo 12.26, pink on indigo 4.01, pink on white 3.06, pink on marshmallow 2.83. Logos are exempt from the WCAG contrast rules, and the mark still reads by shape where pink is weak. Never set text in pink on marshmallow. Indigo on Chrome's dark tab (`#35363a`) is 1.02, nearly invisible, which is why the favicons switch colour or sit on a tile.

## Construction

- Grid: 16 units, 1 unit = 1 px at 16 px. Line width 2 units. The dot is 4 units across, the end square is 4 x 4, the bend has an outer radius of 3 and an inner radius of 1. The mark sits inside 1 to 15 on both axes, so one unit of margin is built in.
- Every straight edge is on a whole unit, so at 16, 32 and 48 px the edges fall on whole pixels. At 16 px, 16 of the favicon's opaque pixels are a blend of two colours: the dot's curve and the bend (the tile's rounded corners are partly transparent and not counted). No separate small-size drawing was needed for this mark. (Concept 3 does have one: its grid moves by half a unit at 16 and 48 px.)
- Pink sits on top of indigo. Where they meet, the indigo runs 0.1 unit under the pink, so anti-aliasing never shows a pale seam.
- Wordmark: lowercase "lightpath" in IBM Plex Sans SemiBold, tracking -12/1000 em, outlined by our own TrueType reader (`src/ttf.mjs`). One change from the font: the "l" is redrawn so its foot turns right, like the path. A plain Plex "l" is a bare bar that can read as a capital "I"; with the foot it cannot. A first try with a longer foot (2.4 stems) read as a capital "L", so the foot is 1.75 stems long. IBM Plex Mono was also tried and dropped: wider, and less clean next to the mark.
- Lockups: horizontal, the mark box is 1.25 x the "l" height, centred on it, with a gap of 30% of the mark box. Stacked, the mark box is 2.4 x the "l" height, with a gap of 22%.
- Checked in Chrome 156 (headless) as well as in our rasterizer: the SVGs render the same, and `favicon.svg` turns white in dark mode and stays indigo in light mode.

## Font licence

IBM Plex Sans SemiBold, from [IBM/plex](https://github.com/IBM/plex) at commit `71f558992315a12ca1f06a2215d57962a1992162` (`packages/plex-sans/fonts/complete/ttf/`). SIL Open Font License 1.1, Reserved Font Name "Plex"; the licence is in `fonts/OFL.txt`. The font file is in `fonts/` only so the build can outline the wordmark. The OFL allows using the font in artwork such as a logo; the SVGs contain outlines, not the font. We do not ship a modified font or use the name "Plex". SHA-256 of the TTF: `a20caf8286023a6a7a85e40b1d2a4ae9fc3e3b1f9eda8f4c542dd4986af67bb1`. The site's self-hosted Plex files are the same family.

## Usage

Clear space: keep at least the width of the end square (a quarter of the mark box) empty on every side.

Minimum sizes: the mark at 16 px (use the favicon files, which are drawn for it); the horizontal lockup at 20 px tall (about 96 px wide); the stacked lockup at 64 px tall. Below those, use the mark alone.

Do:

- Use the full-colour logo on marshmallow or white.
- Use `white` or `reversed` on indigo or other dark backgrounds.
- Use `indigo` or `black` where only one ink is possible.
- Use the SVG files. Use the PNGs only where SVG is not allowed.

Don't:

- Recolour the mark, swap pink and indigo, or add a third colour.
- Make the line pink past the bend. Pink means "ran".
- Add a gradient, glow, shadow, outline, 3D or texture to the official logo. The riso version is for website art only.
- Stretch, rotate, mirror or re-space the lockups.
- Set the wordmark in a live font. Use the outlined files, which have the redrawn "l".
- Put the full-colour logo on a busy photo or a mid-tone background.

## The five concepts

All five are on 16-unit grids in `src/concepts.mjs`. Each has a sheet at 256, 64, 32 and 16 px, a x8 view of 16 px, a squint copy (blurred, made only for the test) and browser tabs, in five colourways.

| #   | Concept      | Verdict                                                                                                         |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| 1   | Path mark    | Recommended. Keeps its meaning in one colour; crisp at 16 px. Thinnest line of the five at 16 px.               |
| 2   | Lettermark L | Runner-up. Boldest at 16 px, but in one colour it is only a capital L, and L marks are common.                  |
| 3   | Pixel path   | Not chosen. Good at 64 px and up; at 16 px the 1 px dots turn to noise. Same family as Tailscale's dot grid.    |
| 4   | Lit lines    | Dropped, as the brief asked: it reads as a menu or text-align icon at every size.                               |
| 5   | Branch (own) | Not chosen. Says "ran / did not run" best, but reads as a git-branch icon or a plug, and pink outweighs indigo. |

A first draft of concept 1 ran right and then down; at 64 px and up it looked like a water tap, so the line now runs down and turns right.

Draw from memory (our judgement, not a user test): concept 1 is "a dot on top, a line down, a turn to the right, a square at the end". We think a person could redraw it from that: three parts, one turn, no fine detail. The other four sentences are on their sheets.

## Similar logos

Checked on 2026-11-04 by the worker on this item. Sources: GitHub organisation avatars (fetched from `github.com/<org>.png`), the two companies' own sites, and the [Lucide](https://github.com/lucide-icons/lucide) icon source. This was a small search, so we do not call the logo unique.

Close, worth the owner's eye:

| Logo                                                                     | What it is                                               | How close to concept 1                                                                                  |
| ------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [Lucide "workflow" icon](https://lucide.dev/icons/workflow)              | a box, an L-shaped turn, a box (open icon set, ISC)      | Closest. Same idea of a turn between two nodes. Ours has a round start, two colours and heavier parts.  |
| [Lucide "corner-down-right"](https://lucide.dev/icons/corner-down-right) | an L-shaped arrow (also Material's "subdirectory arrow") | Same turn, but ends in an arrowhead and has no start dot.                                               |
| [Render](https://github.com/render-oss)                                  | a block and a circle joined by a curve                   | Same "dot, bend, block" parts, but filled and curved, with the circle at the top right.                 |
| [Lightpath (fibre network)](https://lightpathfiber.com/)                 | black title-case "Lightpath" wordmark, no symbol         | Same name. Its wordmark is a geometric sans with a capital L; ours is lowercase Plex with a footed "l". |

Close to the concepts we did not pick: [Tailscale](https://github.com/tailscale) (a 3 x 3 dot grid, some lit) to concept 3; [Tracetest](https://github.com/tracetest) (pixel blocks) a little to concept 3; [Lucide "git-branch"](https://lucide.dev/icons/git-branch) to concept 5.

Checked and not close: [LightPath Technologies](https://www.lightpath.com/) (optics; "LightPath" wordmark with arcs, black and orange), [Model Context Protocol](https://github.com/modelcontextprotocol), Smithery, Lightrun, Lightstep, Highlight, Honeycomb, Sentry, Datadog, OpenTelemetry, Jaeger, Zipkin, Replay, Codecov, Coveralls, Grafana, Chrome DevTools, Google Chrome, PostHog, Railway, Linear, Lightdash, Axiom, SigNoz, Uptrace, Pydantic, LogRocket, Microsoft, Vercel, Supabase, Browserbase, Browser MCP, Checkly, Kubeshop, Coroot, HyperDX and Langfuse (GitHub org avatars).

## Riso version (website art only)

`riso/` holds the mark and the horizontal lockup printed as two inks on marshmallow: the pink layer is shifted 0.18 units right and down (misregistration), pink over indigo prints the palette's overprint colour `#2b0c52`, and small paper-coloured ink voids come from a fixed seeded hash, only on ink. It is plain SVG geometry with clip paths and masks: no filters, blur or bitmaps. The clean logo stays the official one.

## Skills

No design skill was installed or read for this item.
