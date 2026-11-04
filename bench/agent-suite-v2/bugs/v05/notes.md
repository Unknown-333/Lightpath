# v05: "One item per line" doesn't stay on

- **Seeded.** List slot S3. Kind: **stale cache.** The capture settings are cached in memory; the update writes the new value to storage but leaves the cached copy as it was, so the page keeps the old settings until a reload. Two lines in `frontend/utils/captureSettings.ts`.
- Check (browser + API): ticks "One item per line" under Profile Settings > Shortcuts, goes to the Inbox through the sidebar (no reload), adds two lines, and requires two inbox items.
- fix.patch: the update refreshes the cached copy. fix2.patch: reads storage on each read and keeps the copy only while it matches.
