// v04 hidden check: an inbox item captured three days ago says "tomorrow". Turned into a task
// today, its due date is the day after it was captured, not tomorrow.
export default async function check(kit) {
  const item = await kit.api('POST', '/api/inbox', { content: 'Call the bank tomorrow' });
  kit.expect(item.status === 201, `could not create the inbox item: HTTP ${item.status}`);
  const captured = new Date(Date.now() - 3 * 86_400_000);
  captured.setUTCHours(12, 0, 0, 0);
  const stamp = `${captured.toISOString().replace('T', ' ').replace('Z', '')} +00:00`;
  await kit.sql('UPDATE inbox_items SET created_at = ? WHERE uid = ?', [stamp, item.body.uid]);
  const stored = await kit.api('GET', `/api/inbox/${item.body.uid}`);
  kit.expect(
    String(stored.body?.created_at ?? '').startsWith(captured.toISOString().slice(0, 10)),
    `could not set the capture date: ${JSON.stringify(stored.body?.created_at)}`,
  );
  const expected = new Date(captured.getTime() + 86_400_000).toISOString().slice(0, 10);

  const page = await kit.page();
  await page.goto(`${kit.webUrl}/inbox`);
  await page.getByTestId('quick-capture-input').waitFor();
  await kit.sleep(1000);
  const entry = page.getByText('Call the bank tomorrow').first();
  if (!(await entry.isVisible()))
    await page
      .getByText(/recently captured/i)
      .first()
      .click();
  await entry.click();
  await page.getByRole('button', { name: 'Task', exact: true }).last().click();
  let task = null;
  for (let i = 0; i < 40 && !task; i++) {
    await kit.sleep(250);
    const res = await kit.api('GET', '/api/tasks?status=active');
    const list = res.body?.tasks ?? res.body ?? [];
    task = Array.isArray(list) ? list.find((t) => /call the bank/i.test(t.name ?? '')) : null;
  }
  kit.expect(task, 'no task was made from the inbox item');
  const due = String(task.due_date ?? '').slice(0, 10);
  kit.expect(
    due === expected,
    `the task is due ${due || 'never'}; the item was captured ${captured.toISOString().slice(0, 10)} and said "tomorrow", so it should be due ${expected}`,
  );
  return `due ${due}`;
}
