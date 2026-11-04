# The Inbox says "Item updated" when nothing changed

In the Inbox I opened an item, cleared its text by mistake and pressed Enter. The app said "Item updated", but the item still has its old text. I expected it to tell me the text can't be empty.

To see it: sign in, add an inbox item, click it to edit, delete all its text, and press Enter.

The app runs with `node dev.mjs` (API on port 3611, web on http://localhost:8611, user dev@tududi.test, password DevPass123!).
