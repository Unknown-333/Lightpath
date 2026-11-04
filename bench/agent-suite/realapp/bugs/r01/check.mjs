// r01: a daily task due at 15:30 keeps 15:30 on every day Upcoming shows (user timezone UTC).
export default async function check(kit) {
  const today = new Date().toISOString().slice(0, 10);
  const created = await kit.api('POST', '/api/task', {
    name: 'Review Inbox',
    due_date: today,
    due_time: '15:30',
    recurrence_type: 'daily',
    recurrence_interval: 1,
  });
  kit.expect(created.status === 201, `creating the task returned HTTP ${created.status}`);
  kit.expect(created.body.due_time === '15:30', `the task was saved with due_time ${created.body.due_time}`);
  const listed = await kit.api('GET', '/api/tasks?type=upcoming&groupBy=day&maxDays=7');
  kit.expect(listed.status === 200, `Upcoming returned HTTP ${listed.status}`);
  const rows = Object.values(listed.body.groupedTasks ?? {})
    .flat()
    .filter((t) => t.original_name === 'Review Inbox' || t.name === 'Review Inbox');
  kit.expect(rows.length >= 3, `Upcoming shows the series on ${rows.length} days, expected at least 3`);
  const wrong = rows.filter((t) => t.due_time !== '15:30').map((t) => `${t.due_date} ${t.due_time}`);
  kit.expect(
    wrong.length === 0,
    `Upcoming shows ${wrong.length} of ${rows.length} days at the wrong time: ${wrong.join(', ')}`,
  );
  return `Upcoming shows the series on ${rows.length} days, all at 15:30`;
}
