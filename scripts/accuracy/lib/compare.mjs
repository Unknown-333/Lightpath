// Compares one Lightpath trace (and the action's answer text) with a scenario's marks (README.md).

const fnName = (f) => f.name || '(anonymous)';

/** The trace's count for a line, or 0 when the trace doesn't show it as run. */
export function countOf(trace, path, line) {
  return trace.files.find((f) => f.path === path)?.lines.find((l) => l.line === line)?.count ?? 0;
}

/** Not-run parts the trace names on a line: `{ text, startColumn, endColumn }`. */
function spansOn(trace, path, line) {
  const out = [];
  for (const f of trace.functions ?? []) {
    if (f.path !== path) continue;
    for (const s of f.notRunSpans ?? []) if (s.line === line) out.push(s);
  }
  return out;
}

/**
 * Checks a trace against one scenario. Returns a list of mismatches:
 * `{ scenario, path, line, kind, expected, got, text }`.
 * `options.cheapMaps`: the variant's maps have no columns (README section 2).
 * `options.sourceOf(path)`: the file's lines, to read a named span's real text.
 */
export function compareScenario(trace, scenario, all, options = {}) {
  const out = [];
  const add = (path, line, kind, expected, got, text = '') =>
    out.push({ scenario: scenario.id, path, line, kind, expected: String(expected), got: String(got), text });

  for (const [path, file] of scenario.files) {
    for (const m of file.marks) {
      if (m.expect === '?') continue;
      const got = countOf(trace, path, m.line);
      if (m.expect === '+') {
        if (got < 1) add(path, m.line, 'line', 'ran', 'not shown as run', m.text);
      } else if (m.expect === 0) {
        if (got > 0) add(path, m.line, 'line', 0, got, m.text);
        else {
          // An enclosing function the trace lists must name this line as not run.
          const around = (trace.functions ?? []).filter(
            (f) => f.path === path && f.startLine <= m.line && m.line <= f.endLine,
          );
          // Shown as unknown (a call threw before it, D-150) is not shown as run: that is allowed.
          const unknown = around.some((f) => (f.unknown ?? []).some((u) => u.lines.includes(m.line)));
          if (around.length > 0 && !unknown && !around.some((f) => (f.notRun ?? []).includes(m.line)))
            add(path, m.line, 'not-run-unmarked', 'listed as not run', 'not listed', m.text);
        }
      } else if (got !== m.expect) {
        // Unknown (D-150) is no claim: it loses a count but never says ran or not run.
        const unknown = (trace.functions ?? []).some(
          (f) => f.path === path && (f.unknown ?? []).some((u) => u.lines.includes(m.line)),
        );
        add(
          path,
          m.line,
          got === 0 && unknown ? 'unknown' : 'line',
          m.expect,
          got === 0 && unknown ? 'unknown' : got,
          m.text,
        );
      }

      if (typeof m.expect === 'number' && m.expect > 0) {
        const spans = spansOn(trace, path, m.line);
        const named = spans.map((s) => spanText(s, path, m.line, options));
        if (m.span) {
          const right = named.some((t) => t.includes(m.span));
          const wrong = named.filter((t) => !t.includes(m.span));
          if (!right && !(options.cheapMaps && spans.length === 0))
            add(
              path,
              m.line,
              'span',
              `not run: ${m.span}`,
              named.length ? named.join(' | ') : 'none',
              m.text,
            );
          else if (wrong.length > 0 && options.cheapMaps)
            add(path, m.line, 'span', `not run: ${m.span}`, wrong.join(' | '), m.text);
        } else if (spans.length > 0) {
          add(path, m.line, 'span', 'no not-run part', named.join(' | '), m.text);
        }
      }
    }

    // Functions: exactly the @fn list, calls added up over phases.
    const inBlocks = (line) => file.ranges.some(([a, b]) => a <= line && line <= b);
    // Within one phase each hit is its own function; the same function in two phases adds up
    // (the n-th hit with a key in one phase is the n-th hit with that key in another).
    const byKey = new Map();
    const seen = new Map();
    for (const f of trace.functions ?? []) {
      if (f.path !== path || !inBlocks(f.startLine)) continue;
      const base = `${fnName(f)}|${f.startLine}|${f.endLine}`;
      const nth = seen.get(`${f.phase}|${base}`) ?? 0;
      seen.set(`${f.phase}|${base}`, nth + 1);
      const key = `${base}|${nth}`;
      const prev = byKey.get(key);
      byKey.set(key, { name: fnName(f), count: (prev?.count ?? 0) + f.count });
    }
    const got = [...byKey.values()].map((f) => `${f.name} ×${f.count}`).sort();
    const want = file.fns.map((f) => `${f.name} ×${f.count}`).sort();
    if (got.join(', ') !== want.join(', '))
      add(path, 0, 'functions', want.join(', ') || 'none', got.join(', ') || 'none');
  }

  // Isolation: lines of other scenarios' blocks must not show as run in this trace.
  for (const other of all.values()) {
    if (other.id === scenario.id) continue;
    for (const [path, file] of other.files) {
      for (const m of file.marks) {
        if (m.expect === '?') continue;
        if (scenario.files.get(path)?.marks.some((x) => x.line === m.line)) continue;
        const got = countOf(trace, path, m.line);
        if (got > 0) add(path, m.line, 'isolation', `not run (line of ${other.id})`, got, m.text);
      }
    }
  }
  return out;
}

/** The text of a named not-run part, read from the file at its columns when possible. */
function spanText(span, path, line, options) {
  const src = options.sourceOf?.(path)?.[line - 1];
  if (src !== undefined) {
    const text = src.slice(span.startColumn, span.endColumn).trim();
    if (text) return text;
  }
  return span.text ?? '';
}

/** A `limit (<code>):` line in the answer (README section 4), or undefined. */
export function limitLine(answer, code) {
  return answer.split('\n').find((l) => l.startsWith(`limit (${code}):`));
}
