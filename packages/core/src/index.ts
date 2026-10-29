export { countAt, flattenRanges, type Segment } from './flatten.js';
export { HEAT_BUCKETS, heatBucket, newTraceId } from './ids.js';
export { compileIgnore } from './ignore.js';
export { LineIndex } from './line-index.js';
export { coveredLines, type LineCounts, rangesToLines } from './lines.js';
export { PERIODIC_WINDOWS, PeriodicFunctions } from './noise.js';
export { mapScript, mergeLineCounts, type ScriptInput, type ScriptResult } from './pipeline.js';
export {
  normalizePath,
  type ResolveContext,
  type Resolved,
  resolveFile,
  webpackModulePath,
} from './resolve.js';
export { decodeDataUrlSourceMap, mapToOriginal, type OriginalCounts } from './sourcemap.js';
