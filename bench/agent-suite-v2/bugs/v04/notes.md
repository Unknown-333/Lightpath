# v04: "tomorrow" in an old inbox item means the wrong day

- **Seeded.** List slot S2. Kind: **cross-layer misuse.** The frontend sends the item's capture date to the text-analysis API under a field name the API doesn't read, so the API resolves "tomorrow" against today. One line in `frontend/utils/inboxService.ts`.
- Steps: an inbox item "Call the bank tomorrow" captured 3 days ago; open it, click Task; the task is due tomorrow (from today) instead of the day after capture.
- Check (browser + API + database): makes the item, moves its `created_at` back 3 days in the check's own database, converts it in the browser, and requires the task's due date to be capture day + 1.
- fix.patch: the frontend sends the field the API reads. fix2.patch: the API also accepts the other name (backend only).
