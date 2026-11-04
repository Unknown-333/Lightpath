# "Tomorrow" in an old inbox item means the wrong day

I wrote "Call the bank tomorrow" in my Inbox three days ago. Today I opened it and clicked Task. The task is due tomorrow from today, not the day after I wrote it, which is the day I meant.

To see it: sign in, have an inbox item "Call the bank tomorrow" that was added a few days ago, open it in the Inbox and click Task, then look at the new task's due date. To test it, move the item's capture date back a few days in the app's database.

The app runs with `node dev.mjs` (API on port 3611, web on http://localhost:8611, user dev@tududi.test, password DevPass123!).
