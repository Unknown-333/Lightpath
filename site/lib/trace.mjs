// The "What your agent gets" trace: cut from the real run_action answer in
// docs/media/tududi-run/transcript.jsonl at build time, so the page can't drift from the run.
import { readFileSync } from 'node:fs';

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The text of the first completed run_action result that holds a trace. */
export function readTrace(transcriptPath) {
  for (const line of readFileSync(transcriptPath, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const u = JSON.parse(line).data?.update;
    if (u?.sessionUpdate !== 'tool_call_update' || u.status !== 'completed') continue;
    const text = (u.content ?? []).map((c) => c.content?.text ?? '').join('\n');
    if (text.startsWith('Trace t_')) return text;
  }
  throw new Error(`no run_action trace in ${transcriptPath}`);
}

// Which lines to show, in order: whole blocks by their header, with a cap on function lines.
// The answer's header (everything before its first blank line) is always shown whole.
const PICK = [
  { header: /^GET \/api\/daily-plan\/candidates/, take: 0 },
  { header: /^ {2}backend\/modules\/daily-plan\/ranking\.js$/, take: 16 },
  { header: /^ {2}backend\/modules\/daily-plan\/service\.js$/, take: 2, cut: true },
];

const FN = /^( {4})(.+?) (\d+(?:-\d+)?) ×(\d+)(?: not run: (.+))?$/;

/** Dot density step for a call count: 1, 2-4, 5-9, 10-39, 40 or more. */
export const density = (n) => (n >= 40 ? 5 : n >= 10 ? 4 : n >= 5 ? 3 : n >= 2 ? 2 : 1);

export function traceHtml(text) {
  const lines = text.split('\n');
  const out = [];
  const headEnd = lines.indexOf('');
  if (headEnd < 1) throw new Error('trace has no header block');
  lines.slice(0, headEnd).forEach((text, k) => {
    out.push({ kind: k === 0 ? 'head' : 'plain', text });
  });
  out.push({ kind: 'blank', text: ' ' });
  let shown = headEnd + 1;
  for (const rule of PICK) {
    const at = lines.findIndex((l) => rule.header.test(l));
    if (at < 0) throw new Error(`trace has no line matching ${rule.header}`);
    out.push({ kind: at === 0 ? 'head' : lines[at].startsWith('  ') ? 'file' : 'plain', text: lines[at] });
    for (let k = at + 1; k <= at + rule.take; k++) {
      const m = FN.exec(lines[k]);
      if (!m) throw new Error(`not a function line: ${lines[k]}`);
      out.push({ kind: 'fn', name: m[2], range: m[3], n: Number(m[4]), notRun: m[5] });
    }
    if (rule.cut) out.push({ kind: 'cut', text: '    …' });
    shown += 1 + rule.take;
  }
  const items = out.map((l) => {
    if (l.kind !== 'fn') {
      const cls = l.kind;
      return `<li class="t-${cls}"><code>${esc(l.text)}</code></li>`;
    }
    const nr = l.notRun ? ` <span class="t-nr">not run: ${esc(l.notRun)}</span>` : '';
    const times = l.n === 1 ? 'once' : `${l.n} times`;
    return `<li class="t-fn" data-tip="ran ${times}"><span class="t-bar d${density(l.n)}" aria-hidden="true"></span><code>    <span class="t-name">${esc(l.name)}</span> ${l.range} <span class="t-count">×${l.n}</span>${nr}</code><span class="visually-hidden">, ran ${times}</span></li>`;
  });
  return {
    html: `<ol class="trace-lines" tabindex="0" aria-label="Trace lines. Use the arrow keys to step through them.">${items.join('\n')}</ol>`,
    lines: shown,
    total: lines.length,
  };
}
