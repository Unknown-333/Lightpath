// r03: the Focus popover's project menu lists the open project and not the finished one.
export default async function check(kit) {
  const done = await kit.api('POST', '/api/project', { name: 'Garden shed', status: 'done' });
  const open = await kit.api('POST', '/api/project', { name: 'Kitchen remodel' });
  kit.expect(
    done.status === 201 && open.status === 201,
    `creating projects returned HTTP ${done.status}, ${open.status}`,
  );
  kit.expect(done.body.status === 'done', `the finished project was saved with status ${done.body.status}`);
  const page = await kit.page();
  await page.getByTitle('Focus on').click();
  await page.getByRole('button', { name: 'Any project' }).click();
  await kit.sleep(500);
  const menu = page.locator('[aria-label="Focus on"]');
  // biome-ignore lint/performance/useDomNodeTextContent: innerText is the text a user sees
  const text = (await menu.innerText()).replace(/\s+/g, ' ');
  kit.expect(
    text.includes('Kitchen remodel'),
    `the project menu doesn't list the open project: "${text.slice(0, 300)}"`,
  );
  kit.expect(!text.includes('Garden shed'), 'the project menu lists the finished project "Garden shed"');
  return 'the project menu lists "Kitchen remodel" and not the finished "Garden shed"';
}
