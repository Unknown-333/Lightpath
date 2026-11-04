// The words on the review sheets: verdicts, the draw-from-memory judgement and the search summary.
// These are our judgements from looking at the renders, not user tests.
export const RECOMMENDED = 'path';

export const NOTES = {
  path: {
    why: 'Why this one: it is the idea in three parts. The pink dot is the click, the line is the code path, and the pink stops where the code stopped running. In one colour it still reads, because the start is round and the end is square. Of the five, it is the one that holds up at 16 px, keeps its meaning in black, and is not a menu icon, a plain letter or a dot grid. All its straight edges fall on whole pixels at 16, 32 and 48 px, so the favicon is crisp without a separate drawing. Honest weak spots: the line is thin at 16 px, and the search found two near shapes (the Lucide "workflow" icon and the Render logo, listed below). The wordmark is IBM Plex Sans SemiBold (OFL), the website font, outlined, with one change: the "l" turns right at the foot like the path, so it cannot read as "I" or "1".',
    memory: 'Yes: three parts, no fine detail, one turn.',
    squint: 'Blurred, it is still a dot on top and a block at the bottom right, joined by a bend.',
    verdict:
      'Recommended. It keeps its meaning in one colour: a round start (the click), a path, a square end. All straight edges sit on whole pixels at 16, 32 and 48 px, so no separate small drawing was needed. Weak spot: at 16 px the line is 2 px, the thinnest of the five.',
  },
  letter: {
    memory: 'Yes, easily.',
    squint: 'Blurred, still an L.',
    verdict:
      'Runner-up. The boldest at 16 px. But in one colour it is only a capital L, plain L marks are common, and it says nothing about a click or a path.',
  },
  pixel: {
    memory: 'Partly: people would remember "grid with a stepped line", not which cells.',
    squint: 'Blurred, the dots vanish and only a pink Z is left.',
    verdict:
      'Not chosen. Clear at 64 px and up, but at 16 px the 1 px dots become grey noise. Grids of dots with some lit are a common logo family (see the search notes).',
  },
  lines: {
    memory: 'Yes, but they would draw a menu icon.',
    squint: 'Blurred, four bars: a menu or text-align icon.',
    verdict:
      'Dropped, as the brief asked. At every size it reads as a hamburger menu or a text-align icon, in colour and in black.',
  },
  branch: {
    memory: 'Mostly: a dot and a fork; the arm lengths would be lost.',
    squint: 'Blurred, a dot and a C shape.',
    verdict:
      'Not chosen. It shows "ran / did not run" best, but reads as a git-branch icon or a plug, and pink covers more area than indigo, so pink stops being an accent.',
  },
};

// From the similarity search (full list with links in README.md, "Similar logos").
export const SEARCH_SUMMARY =
  'Similar logos (checked 2026-11-04: 39 GitHub org avatars of developer, observability and MCP tools, the two other companies called Lightpath, and the Lucide icon set). Closest to the path mark: the Lucide "workflow" icon (a box, an L-shaped turn, a box) and the "corner-down-right" arrow; the Render logo (a block and a circle joined by a curve). Concept 3 is in the same family as the Tailscale dot grid. The Lightpath fibre company uses a black title-case "Lightpath" wordmark with no symbol. We found no logo that copies the path mark, but this was a small search, so we do not call it unique.';
