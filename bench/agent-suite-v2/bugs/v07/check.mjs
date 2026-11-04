// v07 hidden check: with two timed blocks on today's plan (09:00 and 14:00) and one without a
// time, Today lists the 09:00 block first, then the 14:00 block, then the untimed task.
export default async function check(kit) {
  const day = new Date().toISOString().slice(0, 10);
  const make = async (name) => {
    const r = await kit.api('POST', '/api/task', { name, due_date: day });
    kit.expect(r.status === 201, `could not create task ${name}: HTTP ${r.status}`);
    return r.body.uid;
  };
  const late = await make('Team review');
  const early = await make('Write the report');
  const loose = await make('Water the plants');
  const plan = await kit.api('PUT', `/api/daily-plan/${day}`, {
    items: [
      { task_uid: late, start_minute: 14 * 60, duration_minutes: 60 },
      { task_uid: early, start_minute: 9 * 60, duration_minutes: 60 },
      { task_uid: loose, start_minute: null },
    ],
  });
  kit.expect(plan.status === 200, `could not save today's plan: HTTP ${plan.status}`);
  const started = await kit.api('POST', `/api/daily-plan/${day}/start`);
  kit.expect(started.status === 200, `could not start the day: HTTP ${started.status}`);

  const page = await kit.page();
  await page.goto(`${kit.webUrl}/today`);
  const agenda = page.getByTestId('today-planned');
  await agenda.getByText('Water the plants').first().waitFor();
  await kit.sleep(800);
  // The agenda after the "Up next" card.
  const card = await page
    .getByTestId('now-card')
    .innerText()
    .catch(() => '');
  const text = (await agenda.innerText()).replace(card, '');
  const pos = (name) => text.indexOf(name);
  const order = ['Write the report', 'Team review', 'Water the plants'];
  const at = order.map(pos);
  kit.expect(
    at.every((p) => p >= 0),
    `not every planned task is listed on Today: ${JSON.stringify(at)}`,
  );
  kit.expect(
    at[0] < at[1] && at[1] < at[2],
    `Today lists the plan as ${order
      .map((n, i) => [n, at[i]])
      .sort((a, b) => a[1] - b[1])
      .map((x) => x[0])
      .join(' > ')}; expected 09:00 "Write the report", then 14:00 "Team review", then "Water the plants"`,
  );
  return 'Today lists 09:00, 14:00, then the untimed task';
}
