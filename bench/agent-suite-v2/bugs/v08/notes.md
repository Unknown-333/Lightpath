# v08: the Inbox says "Item updated" when nothing changed

- **Seeded.** SELECTION.md amendment 6, X3 (owner's Phase D: swallowed error in an async backend handler). Kind: data-dependent (only for text that fails validation). `backend/modules/inbox/service.js` update: the validation error is caught and logged, the rest of the update goes on, and the handler answers 200, so the page shows its success message.
- Check (browser + API): clears an item's text, presses Enter, and requires no "Item updated" message and the old text kept. A backend fix (let the error through) and a frontend fix (refuse to send empty text) both pass.
- fix.patch: the try/catch removed. fix2.patch: none written.
