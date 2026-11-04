// Reads the hand-written expected results out of fixture files (README.md section 1).
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const MARK = /(?:\/\/|\/\*|\{\/\*)!\s+(\d+|\+|\?)(?:\s+span:(.+?))?\s*(?:\*\/\}?)?\s*$/;

/**
 * @typedef {{ line: number, expect: number | '+' | '?', span?: string, text: string }} Mark
 * @typedef {{ id: string, files: Map<string, { marks: Mark[], fns: { name: string, count: number }[], ranges: [number, number][] }>, click?: string, limit?: string }} Scenario
 */

/** Parses fixture files (absolute paths) under `root`; returns scenarios by id. */
export function readScenarios(root, files) {
  /** @type {Map<string, Scenario>} */
  const scenarios = new Map();
  for (const abs of files) {
    const path = relative(root, abs).replace(/\\/g, '/');
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
    let current;
    let start = 0;
    const close = (end) => {
      if (current) current.ranges.push([start, end]);
    };
    for (const [i, text] of lines.entries()) {
      const n = i + 1;
      const head = /^\s*\/\/ @scenario (\S+)/.exec(text);
      if (head) {
        close(n - 1);
        const id = head[1];
        let s = scenarios.get(id);
        if (!s) {
          s = { id, files: new Map() };
          scenarios.set(id, s);
        }
        let f = s.files.get(path);
        if (!f) {
          f = { marks: [], fns: [], ranges: [] };
          s.files.set(path, f);
        }
        current = f;
        current.scenario = s;
        start = n;
        continue;
      }
      if (!current) continue;
      if (/^\s*\/\/ @end\b/.test(text)) {
        close(n - 1);
        current = undefined;
        continue;
      }
      const fn = /^\s*\/\/ @fn (.+) (\d+)\s*$/.exec(text);
      if (fn) {
        current.fns.push({ name: fn[1], count: Number(fn[2]) });
        continue;
      }
      const click = /^\s*\/\/ @click (.+?)\s*$/.exec(text);
      if (click) {
        current.scenario.click = click[1];
        continue;
      }
      const limit = /^\s*\/\/ @limit (\S+)/.exec(text);
      if (limit) {
        current.scenario.limit = limit[1];
        continue;
      }
      const trimmed = text.trim();
      if (trimmed === '' || trimmed.startsWith('//')) continue;
      const m = MARK.exec(text);
      if (!m) throw new Error(`${path}:${n}: code line inside scenario block has no //! mark`);
      const raw = m[1];
      current.marks.push({
        line: n,
        expect: raw === '+' || raw === '?' ? raw : Number(raw),
        ...(m[2] ? { span: m[2].trim() } : {}),
        text: trimmed,
      });
    }
    close(lines.length);
  }
  for (const s of scenarios.values()) for (const f of s.files.values()) delete f.scenario;
  return scenarios;
}
