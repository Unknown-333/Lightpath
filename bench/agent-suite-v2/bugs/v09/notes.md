# v09: the invoices are squeezed into a strip (CONTROL)

- **Seeded, the control** (SELECTION.md amendment 6, X4; owner's Phase D). A purely static layout mistake: one CSS value in `src/styles.css` swaps the page grid's columns. No code path, data or action is involved, so tracing what ran gives no help by construction. Its job is to show whether having Lightpath makes the agent worse on such a bug.
- Check (browser): at 1280x800 the side menu is under 300 px wide and the invoices area over 800 px, to its right.
- fix.patch: the grid restored. fix2.patch: none.
