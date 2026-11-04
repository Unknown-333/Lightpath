# Lightpath brand art

The social preview image (`out/og.png`) and an animated loop of it, drawn in code as a two-ink risograph print. Nothing here is a screenshot or AI-made art. Every pixel comes from the sprite data and drawing code in `src/`.

## Rebuild

```sh
FFMPEG=<full path to ffmpeg> pnpm brand:build     # everything, then the checks
pnpm brand:build --no-video                       # skip MP4/WebM (no ffmpeg needed)
```

The build writes every file below and then runs `src/check.mjs`. It fails if any image has a colour outside the palette, a wrong size, or a file over its size limit. The numbers go to `out/check.json`.

ffmpeg is only needed for MP4 and WebM. The one used here is the gyan.dev "release essentials" build 9.0.2 for Windows. Its SHA-256 matched the hash gyan.dev publishes (`60f46726...fa2047ba`). PNG and GIF files are written by our own small encoders in `src/png.mjs` and `src/gif.mjs`.

## Outputs

| File                   | What                                                  | Size       | Colours                                  |
| ---------------------- | ----------------------------------------------------- | ---------- | ---------------------------------------- |
| `out/og.png`           | social preview, 1200x630                              | 14.1 KB    | 9, all in the palette                    |
| `out/loop.gif`         | loop for a README, 960x504, 100 frames, 10 fps, 10 s  | 59.8 KB    | 9-entry table, no local tables           |
| `out/loop.mp4`         | loop for a site, H.264, 1440x756, 10 fps, 10 s        | 172.0 KB   | see "Video" below                        |
| `out/loop.webm`        | loop for a site, VP9 lossless, 1440x756, 10 fps, 10 s | 121.9 KB   | see "Video" below                        |
| `out/poster.png`       | poster frame for the videos (frame 72), 1440x756      | 10.4 KB    | 9, all in the palette                    |
| `review/concept-*.png` | the three concept stills, 1200x630                    | 12-14 KB   | A 9, B 7, C 7, all in the palette        |
| `review/review-*.png`  | review sheets (see "Review")                          | 109-131 KB | not palette-exact: they show downscaling |

## Palette

Paper plus two inks, each at full strength or as a tint. Where the inks overlap they overprint, and the overprint colour is the per-channel multiply of the two printed colours. The check recomputes every overprint and fails if one does not match. That gives 3 x 3 = 9 fixed colours, written once in `src/palette.mjs`.

| Indigo \ Pink | none            | pink tint | pink      |
| ------------- | --------------- | --------- | --------- |
| none          | `#fcf5ec` paper | `#ffb3d2` | `#ff4f9f` |
| indigo tint   | `#a19dd9`       | `#a16eb3` | `#a13187` |
| indigo        | `#2b2684`       | `#2b1b6d` | `#2b0c52` |

Pink marks lit things only: tiles that ran, the clicked button, the lantern, the server lights, and the dot of the "i" in the wordmark.

## How it is drawn

- Each concept is drawn on a coarse cell grid (5 px cells for A and B, 2 px for C) into two ink layers, indigo and pink. Each cell holds an ink level of 0, 1 or 2.
- Printing scales each layer by a whole number with nearest neighbour. The pink layer is shifted 2 px right and 2 px down, which is the riso misregistration. Then every pixel takes the palette colour for its indigo and pink levels. There is no blending, anti-aliasing, gradient, glow or soft shadow. Shadows are hard one-cell offsets.
- Grain is single-pixel dots from a fixed seeded hash. It only falls in areas marked as large flat fills (the window panels in A). It never falls on pink ink, the headline or the path. A dot moves a pixel one ink step (ink void or speck).
- The headline font pixel is 10 px on the 1200x630 canvas: capitals are 70 px tall and the glyph box with descenders is 90 px, which is about a 100 px font size.
- Text uses "Lightpath Pixel", a bitmap font drawn for this repo (`src/font.mjs`). It is a glyph grid set pixel by pixel, so it has no anti-aliasing. No outside font is used.
- The walker is an original character: a marshmallow-white blob with a pink lantern on a pole (`src/sprites.mjs`). The pointer is a plain arrow cursor.
- No code or trace text appears. "browser" and "server" are labels. The install command is not on the image.

## The three concepts

| Concept         | Idea                                                                                                                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A, pixel path   | A click on a button lights a row of tiles across a "browser" window and a "server" window to a server rack. Side branches that did not run stay dark indigo. A small walker carries the light. |
| B, typographic  | "See the exact" in big type, then one full-width pink "lit line" carrying "lines one click ran.", with quiet tint lines around it and the wordmark on an indigo footer.                        |
| C, flat cartoon | An arcade button, a string of lit pink bulbs to a smiling server, and two unlit bulbs on drops that did not run.                                                                               |

## Review

`review/review-a.png`, `review-b.png` and `review-c.png` each show one concept on white and on dark, at 1200 px, at 500 px, as a 2:1 crop (1200x600) with rounded corners at 500 px, and at 200 px with and without grain. Downscaling is an area average, close to what browsers do.

Grain check at 200 px (`review/grain-200.json`): the same image with and without grain, shrunk to 200 px, differ by a mean of 0.56 (A), 0.97 (B) and 0.65 (C) on a 0-255 scale. In A, 90 of 21,000 pixels move by more than 8. At 4% density the grain does not turn muddy, so it stays. A first pass at 6% looked noisy at full size and was thinned to 4%.

What the review showed:

- Headline: readable at 500 px in all three. At 200 px it is still readable in A and C (two lines) and in B.
- Wordmark: readable at 500 px. At 200 px only B's wordmark is readable, because B gives it a whole footer. This is A's main weakness, and it is kept on purpose: a larger wordmark would push the art off the canvas or shrink the headline below the 72 px bar.
- At a glance: only A says "browser to server" and "ran or did not run" without reading. B reads as a slogan. C reads as party lights.
- 2:1 crop: nothing important is lost in A or C. B loses its top tint line, which does not matter.

## Winner: A, pixel path

- It shows what Lightpath does: one click, the code it ran in the browser and on the server, lit, with the branches that did not run still dark.
- It has a clear shape at 200 px: one pink line across two dark windows.
- It animates naturally (the tiles light one by one), which B and C do less well.
- B has the best type and the biggest wordmark, but it says nothing about browser and server. C is friendly, but the bulbs read as decoration.

## What was fixed after the first pass

The first-pass stills are kept in `review/first-pass/`. These fixes applied to all three concepts unless named:

1. Text shadows moved from one glyph pixel (10-15 px) to one cell (5 px or 2 px). The large offset doubled the letters and looked blurry.
2. Grain thinned from 6% to 4%.
3. A: the clicked button got a paper label bar. The dark plum bar read as a hole.
4. B: the tint lines ran into the first headline line. The clear area now covers the whole line and its shadow.
5. C: the side string of unlit bulbs read as a shopping cart. It is now two straight drops. The big pointer was moved off the button.

The theme changed to risograph during this work, before any dark pixel-art version was rendered, so there is no dark "before" set.

## The loop

`src/animate.mjs`, 100 frames at 10 fps, 10 s, stepped:

| Frames | What happens                                                    |
| ------ | --------------------------------------------------------------- |
| 0-9    | the pointer moves to the button                                 |
| 10-11  | click: the button presses and lights, with a pink click burst   |
| 12-62  | the walker walks the path and lights it one tile every 2 frames |
| 63-66  | the four server lights come on                                  |
| 67-79  | hold, all lit (frame 72 is the poster)                          |
| 80-92  | the walker runs back and the tiles go dark behind it            |
| 92-99  | the pointer moves back; frame 99 leads into frame 0             |

Checks on the loop:

- GIF: ffmpeg decoded all 100 frames, and every pixel matched the source frames.
- Video: MP4 is H.264 High, 4:2:0, CRF 4. WebM is VP9 lossless, 4:2:0. Both are tagged BT.709 limited range. At 6x every cell edge and the 2 px misregistration fall on even pixels, and the video grain dots are 2x2 pixels. So 4:2:0 chroma never mixes two colours. The build decodes frame 72 of each file and compares it with the source. Max channel error is 7 (MP4) and 4 (WebM). Mean error is 2.38 for both, which comes from the RGB to YUV rounding. 0 pixels are nearer to a different palette colour. `review/video-2x-mp4.png` and `review/video-2x-webm.png` show a decoded crop at 2x.
- Same palette: the loop only uses the 9 colours. The MP4 and WebM are within the error above.

## Where the art goes

Nowhere yet. The README demo GIF and the site are the owner's call. Nothing here is uploaded or linked from the main README.
