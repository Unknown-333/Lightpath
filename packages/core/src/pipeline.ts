import type { SourceMapInput } from '@jridgewell/trace-mapping';
import type { DropReason, ScriptCoverage } from '@lightpath-dev/protocol';
import { flattenRanges } from './flatten.js';
import { LineIndex } from './line-index.js';
import { type LineCounts, rangesToLines } from './lines.js';
import { type ResolveContext, resolveFile, webpackModulePath } from './resolve.js';
import { mapToOriginal } from './sourcemap.js';

export interface ScriptInput {
  coverage: ScriptCoverage;
  /** Generated source text exactly as V8 executed it. */
  source: string;
  /** Parsed source map, if the script has one. */
  sourceMap?: SourceMapInput;
  /** URL the source map was loaded from, used to resolve relative `sources`. */
  sourceMapUrl?: string;
}

export interface ScriptResult {
  /** Workspace-relative path → line counts (including zero counts). */
  files: Map<string, LineCounts>;
  dropped: Map<DropReason, number>;
}

/**
 * Runs the full core pipeline for one script delta (docs/ARCHITECTURE.md section 4):
 * flattenRanges → rangesToLines | mapToOriginal → resolveFile.
 */
export function mapScript(input: ScriptInput, ctx: ResolveContext): ScriptResult {
  const result: ScriptResult = { files: new Map(), dropped: new Map() };
  const drop = (reason: DropReason) => result.dropped.set(reason, (result.dropped.get(reason) ?? 0) + 1);

  // Drop scripts we would discard anyway before doing any work.
  const scriptTarget = resolveFile(input.coverage.url, ctx);
  if (scriptTarget.kind === 'dropped' && scriptTarget.reason !== 'outside-workspace') {
    drop(scriptTarget.reason);
    return result;
  }

  const segments = flattenRanges(input.coverage.functions);
  const index = new LineIndex(input.source);

  if (!input.sourceMap) {
    if (scriptTarget.kind === 'dropped') drop(scriptTarget.reason);
    // A webpack module's code is loader output (swc, Babel, ts-loader), not the file on disk, so
    // without a map its offsets would light the wrong lines (D-087).
    else if (webpackModulePath(input.coverage.url) !== undefined) drop('no-source-map');
    else result.files.set(scriptTarget.path, rangesToLines(segments, index));
    return result;
  }

  const original = mapToOriginal(segments, index, input.sourceMap, input.sourceMapUrl ?? input.coverage.url);
  for (const [source, lines] of original) {
    const target = resolveFile(source, ctx);
    if (target.kind === 'dropped') {
      drop(target.reason);
      continue;
    }
    const existing = result.files.get(target.path);
    result.files.set(target.path, existing ? mergeLineCounts(existing, lines) : lines);
  }
  return result;
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
