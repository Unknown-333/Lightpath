// r02: "Set in progress" clicked on a subtask row in All Tasks is saved (read back from the API).
const IN_PROGRESS = new Set([1, 'in_progress']);

export default async function check(kit) {
  const created = await kit.api('POST', '/api/task', {
    name: 'Plan trip',
    subtasks: [{ name: 'Book hotel' }],
  });
  kit.expect(created.status === 201, `creating the task returned HTTP ${created.status}`);
  const parentUid = created.body.uid;
  const page = await kit.page();
  await page.goto(`${kit.webUrl}/tasks`);
  await page.getByTitle('Show subtasks').first().click();
  const sub = page.locator('div', { hasText: /^Book hotel\s*Not started$/ }).last();
  await sub.waitFor();
  await sub.hover();
  await sub.locator('[title="Set in progress"]').last().click({ force: true });
  let status = null;
  for (let i = 0; i < 20; i++) {
    await kit.sleep(250);
    const subs = await kit.api('GET', `/api/task/${parentUid}/subtasks`);
    status = (Array.isArray(subs.body) ? subs.body : []).find((t) => t.name === 'Book hotel')?.status ?? null;
    if (IN_PROGRESS.has(status)) break;
  }
  kit.expect(
    IN_PROGRESS.has(status),
    `after the click the saved subtask status is ${JSON.stringify(status)}, not in progress`,
  );
  await page.reload();
  return `subtask saved as ${JSON.stringify(status)} (in progress)`;
}
