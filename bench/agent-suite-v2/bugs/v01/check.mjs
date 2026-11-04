// v01 hidden check: the dev user has no profile name. A comment they post on a task shows a
// name for its author on the task's page, not "Unknown".
export default async function check(kit) {
  const task = await kit.api('POST', '/api/task', { name: 'Fix the garden gate' });
  kit.expect(task.status === 201, `could not create the task: HTTP ${task.status}`);
  const comment = 'Booked the carpenter for Friday';
  const posted = await kit.api('POST', `/api/task/${task.body.uid}/comments`, { body: comment });
  kit.expect(posted.status === 201, `could not post the comment: HTTP ${posted.status}`);
  const page = await kit.page();
  await page.goto(`${kit.webUrl}/task/${task.body.uid}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const body = page.getByText(comment).first();
  await body.waitFor();
  await body.scrollIntoViewIfNeeded();
  const row = body.locator('xpath=ancestor::*[self::li or self::article or self::div][3]');
  const text = (await row.innerText()).trim();
  kit.expect(!/\bUnknown\b/.test(text), `the comment's author shows as "Unknown": ${JSON.stringify(text)}`);
  const author = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && l.length > 1 && !/just now|ago|reply|delete/i.test(l) && l !== comment)[0];
  kit.expect(author, `no author name next to the comment: ${JSON.stringify(text)}`);
  return `author shown as ${JSON.stringify(author)}`;
}
