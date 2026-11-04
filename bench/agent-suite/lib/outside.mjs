// The void check's "read outside the trial folder" rule (SCORING.md, D-108, amended by D-149).
import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const PATH_KEYS = /path|file|dir|cwd|target|source|pattern|glob/i;

/** Drive paths and `..` escapes a tool call names, each with where it came from. */
function candidatesOf(call) {
  const out = [];
  for (const loc of call.locations ?? []) if (loc?.path) out.push({ path: loc.path, from: 'location' });
  for (const [key, value] of Object.entries(call.input ?? {})) {
    if (key === 'command' || typeof value !== 'string' || !PATH_KEYS.test(key)) continue;
    if (/^[a-z]:[\\/]|^[\\/]|\.\.[\\/]|^\.\.$/i.test(value)) out.push({ path: value, from: 'field' });
  }
  if (typeof call.input?.command === 'string') {
    const cmd = call.input.command;
    // A drive path, not the "p://" inside "http://".
    for (const p of cmd.match(/(?<![a-z])[a-z]:[\\/][^\s"'`;|,)]*/gi) ?? [])
      out.push({ path: p, from: 'command' });
    for (const m of cmd.match(/(?:^|[\s"'])(\.\.(?:[\\/][^\s"'`;|,)]*)?)/g) ?? [])
      out.push({ path: m.trim().replace(/^["']/, ''), from: 'command' });
  }
  return out;
}

function insideTest(trialDir) {
  const root = trialDir.toLowerCase();
  return (full) => {
    const f = full.toLowerCase();
    return f === root || f.startsWith(`${root}\\`) || f.startsWith(`${root}/`);
  };
}

/**
 * D-149: `/c:/x` and `file:///c:/x` name the drive path `c:/x`. Anything else is returned as is.
 */
export function fromUrlForm(p) {
  const m = /^(?:file:\/\/)?\/([a-z]):([\\/].*)?$/i.exec(p);
  return m ? `${m[1]}:${m[2] ?? '/'}` : p;
}

/**
 * Paths a tool call names that resolve outside the trial folder (D-149). Returns `{ hits, ignored }`:
 * `hits` void the run; `ignored` are what the D-108 rule would also have flagged, with the reason
 * D-149 drops them, kept for review. `exists` is injectable for tests.
 */
export function outsidePaths(toolCalls, trialDir, { exists = existsSync } = {}) {
  const inside = insideTest(trialDir);
  const hits = [];
  const ignored = [];
  for (const call of toolCalls) {
    const base = typeof call.input?.cwd === 'string' ? call.input.cwd : trialDir;
    const tool = call.title ?? call.kind;
    for (const { path: raw, from } of candidatesOf(call)) {
      if (!(isAbsolute(raw) || raw.startsWith('..'))) continue;
      const oldOutside = !inside(resolve(base, raw));
      const p = fromUrlForm(raw);
      const full = resolve(base, p);
      if (inside(full)) {
        if (oldOutside) ignored.push({ tool, path: raw, reason: 'url-form path inside the trial' });
        continue;
      }
      if (from === 'command' && p.startsWith('..') && !exists(full)) {
        ignored.push({ tool, path: raw, reason: `'..' text in a command names nothing on disk (${full})` });
        continue;
      }
      hits.push({ tool, path: raw });
    }
  }
  return { hits, ignored };
}

/**
 * The D-108 rule, verbatim from run.mjs before D-149. Kept only so rescore-d149.mjs can prove
 * that re-parsing a saved transcript gives the stored `outsidePaths`. Not used to score.
 */
export function outsidePathsD108(toolCalls, trialDir) {
  const root = trialDir.toLowerCase();
  const isOutside = (p, base) => {
    const full = resolve(base, p).toLowerCase();
    return full !== root && !full.startsWith(`${root}\\`) && !full.startsWith(`${root}/`);
  };
  const hits = [];
  for (const call of toolCalls) {
    const base = typeof call.input?.cwd === 'string' ? call.input.cwd : trialDir;
    const candidates = [];
    for (const loc of call.locations ?? []) if (loc?.path) candidates.push(loc.path);
    for (const [key, value] of Object.entries(call.input ?? {})) {
      if (key === 'command' || typeof value !== 'string' || !PATH_KEYS.test(key)) continue;
      if (/^[a-z]:[\\/]|^[\\/]|\.\.[\\/]|^\.\.$/i.test(value)) candidates.push(value);
    }
    if (typeof call.input?.command === 'string') {
      const cmd = call.input.command;
      // A drive path, not the "p://" inside "http://".
      candidates.push(...(cmd.match(/(?<![a-z])[a-z]:[\\/][^\s"'`;|,)]*/gi) ?? []));
      candidates.push(
        ...(cmd.match(/(?:^|[\s"'])(\.\.(?:[\\/][^\s"'`;|,)]*)?)/g) ?? []).map((m) =>
          m.trim().replace(/^["']/, ''),
        ),
      );
    }
    for (const p of candidates) {
      if (isAbsolute(p) || p.startsWith('..')) {
        if (isOutside(p, base)) hits.push({ tool: call.title ?? call.kind, path: p });
      }
    }
  }
  return hits;
}
