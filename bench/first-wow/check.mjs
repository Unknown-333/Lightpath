// The first-wow check: does the agent's answer name the right files for the action?
// Fixed before any run. A path counts if the answer contains it, or its tail from `src/` on
// (frontend) or the file name (backend), with either slash.

function variants(path) {
  const parts = path.split('/');
  const src = parts.indexOf('src');
  const tails = new Set([path]);
  if (src >= 0) {
    for (let i = src; i < parts.length - 1; i++) tails.add(parts.slice(i).join('/'));
  }
  return [...tails];
}

export function checkAnswer(answer, expected) {
  const text = String(answer ?? '')
    .replaceAll('\\', '/')
    .toLowerCase();
  const hit = (paths, tailsOf) =>
    paths.find((path) => tailsOf(path.toLowerCase()).some((tail) => text.includes(tail))) ?? null;
  const frontend = hit(expected.frontend, variants);
  const backend = hit(expected.backend, (path) => [path, path.split('/').pop()]);
  return { frontend, backend, pass: frontend !== null && backend !== null };
}
