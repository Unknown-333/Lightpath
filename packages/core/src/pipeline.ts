import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { DropReason, ScriptCoverage } from '@lightpath-dev/protocol';
import { flattenRanges, type Segment } from './flatten.js';
import { LineIndex } from './line-index.js';
import { type LineCounts, rangesToLines } from './lines.js';
import { type ResolveContext, resolveFile, webpackModulePath } from './resolve.js';
import { mapToOriginal, originalLocation } from './sourcemap.js';
import { applyUnknown, findThrowRegions, rangeStarts, type ThrowRegion } from './throws.js';

export interface ScriptInput {
  coverage: ScriptCoverage;
  /** Generated source text exactly as V8 executed it. */
  source: string;
  /** Parsed source map, if the script has one. */
  sourceMap?: SourceMapInput;
  /** URL the source map was loaded from, used to resolve relative `sources`. */
  sourceMapUrl?: string;
}

/** Workspace-relative path → line → the line it threw on or after (D-151). */
export type UnknownLines = Map<string, Map<number, number>>;

export interface ScriptResult {
  /** Workspace-relative path → line counts (including zero counts). */
  files: Map<string, LineCounts>;
  dropped: Map<DropReason, number>;
  /** Lines with no count because a call threw before them in a try whose catch ran (D-151). */
  unknown: UnknownLines;
}

/**
 * Runs the full core pipeline for one script delta (docs/ARCHITECTURE.md section 4):
 * flattenRanges → rangesToLines | mapToOriginal → resolveFile.
 */
export function mapScript(input: ScriptInput, ctx: ResolveContext): ScriptResult {
  const result: ScriptResult = { files: new Map(), dropped: new Map(), unknown: new Map() };
  const drop = (reason: DropReason) => result.dropped.set(reason, (result.dropped.get(reason) ?? 0) + 1);

  // Drop scripts we would discard anyway before doing any work.
  const scriptTarget = resolveFile(input.coverage.url, ctx);
  if (scriptTarget.kind === 'dropped' && scriptTarget.reason !== 'outside-workspace') {
    drop(scriptTarget.reason);
    return result;
  }

  const index = new LineIndex(input.source);
  const known = flattenRanges(input.coverage.functions);
  const regions = findThrowRegions(known, input.source, index.mask);
  const starts = regions.length > 0 ? flattenRanges(rangeStarts(input.coverage.functions)) : [];
  const segments = regions.length > 0 ? applyUnknown(known, regions, starts) : known;

  if (!input.sourceMap) {
    if (scriptTarget.kind === 'dropped') drop(scriptTarget.reason);
    // A webpack module's code is loader output (swc, Babel, ts-loader), not the file on disk, so
    // without a map its offsets would light the wrong lines (D-087).
    else if (webpackModulePath(input.coverage.url) !== undefined) drop('no-source-map');
    else {
      const path = scriptTarget.path;
      result.files.set(path, rangesToLines(segments, index));
      for (const r of regions) {
        const lost = lostLines(
          rangesToLines(known, index),
          rangesToLines(applyUnknown(known, [r], starts), index),
        );
        addUnknown(result.unknown, path, lost, index.lineOf(r.first) + 1);
      }
    }
    return result;
  }

  const mapUrl = input.sourceMapUrl ?? input.coverage.url;
  const resolved = (original: Map<string, LineCounts>) => {
    const files = new Map<string, LineCounts>();
    for (const [source, lines] of original) {
      const target = resolveFile(source, ctx);
      if (target.kind === 'dropped') continue;
      const existing = files.get(target.path);
      files.set(target.path, existing ? mergeLineCounts(existing, lines) : lines);
    }
    return files;
  };
  const original = mapToOriginal(segments, index, input.sourceMap, mapUrl);
  for (const [source, lines] of original) {
    const target = resolveFile(source, ctx);
    if (target.kind === 'dropped') {
      drop(target.reason);
      continue;
    }
    const existing = result.files.get(target.path);
    result.files.set(target.path, existing ? mergeLineCounts(existing, lines) : lines);
  }
  if (regions.length > 0) {
    const all = resolved(mapToOriginal(known, index, input.sourceMap, mapUrl));
    for (const r of regions) {
      const line0 = index.lineOf(r.first);
      const at = originalLocation(input.sourceMap, mapUrl, line0 + 1, r.first - index.lineStart(line0));
      const atPath = at ? resolveFile(at.source, ctx) : undefined;
      if (!at || atPath?.kind !== 'workspace') continue;
      const one = resolved(mapToOriginal(applyUnknown(known, [r], starts), index, input.sourceMap, mapUrl));
      const lost = lostLines(all.get(atPath.path) ?? new Map(), one.get(atPath.path) ?? new Map());
      addUnknown(result.unknown, atPath.path, lost, at.line);
    }
  }
  return result;
}

export type { Segment, ThrowRegion };

/** Lines that had a count in `before` and have none in `after`. */
function lostLines(before: LineCounts, after: LineCounts): number[] {
  return [...before.keys()].filter((l) => !after.has(l));
}

function addUnknown(into: UnknownLines, path: string, lines: readonly number[], threwAfter: number): void {
  if (lines.length === 0) return;
  let m = into.get(path);
  if (!m) {
    m = new Map();
    into.set(path, m);
  }
  for (const l of lines) if (!m.has(l)) m.set(l, threwAfter);
}

/** Merges two line maps, keeping the maximum count per line. */
export function mergeLineCounts(a: LineCounts, b: LineCounts): LineCounts {
  const out = new Map(a);
  for (const [line, count] of b) {
    const prev = out.get(line);
    if (prev === undefined || count > prev) out.set(line, count);
  }
  return out;
}
