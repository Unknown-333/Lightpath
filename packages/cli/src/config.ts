import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

export const CONFIG_FILE = 'lightpath.config.json';

const origin = z.string().refine(
  (s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },
  { message: 'must be an http(s) origin, like http://localhost:3001' },
);

/**
 * `lightpath.config.json` (docs/ARCHITECTURE.md section 9.2). Every key is optional and a flag on
 * the command line wins over it. Unknown keys are errors, so a typo doesn't pass silently.
 */
export const LightpathConfig = z.strictObject({
  $schema: z.string().optional(),
  command: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe('Dev command to run when none is given after --. A string runs in a shell.'),
  url: origin.optional().describe('App URL; detected from the command output when omitted'),
  webRoot: z.string().min(1).optional().describe('Folder the dev server serves from, relative to this file'),
  backend: z.array(origin).optional().describe('Remote backend origins to tag with the trace header'),
  roots: z.array(z.string().min(1)).min(1).optional().describe('Workspace roots, relative to this file'),
  ignore: z
    .array(z.string())
    .optional()
    .describe('Globs for workspace files to leave out of traces, like "src/generated/**"'),
  settleMs: z.number().int().min(50).max(10_000).optional().describe('Quiet time that ends a click (ms)'),
  maxSettleMs: z.number().int().min(500).max(60_000).optional().describe('Longest a click can last (ms)'),
  browser: z.boolean().optional().describe('false: trace backend requests only'),
  headless: z.boolean().optional().describe('Run the browser without a window'),
});
export type LightpathConfig = z.infer<typeof LightpathConfig>;

export interface LoadedConfig {
  path: string;
  config: LightpathConfig;
}

export class ConfigError extends Error {}

/**
 * Reads `lightpath.config.json` from `dir` (or `file` when given). Returns undefined when there is
 * none; throws ConfigError with every problem when it doesn't parse or validate. Relative paths in
 * `webRoot` and `roots` become absolute against the file's folder.
 */
export async function loadConfig(dir: string, file?: string): Promise<LoadedConfig | undefined> {
  const path = resolve(dir, file ?? CONFIG_FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' && file === undefined) return undefined;
    throw new ConfigError(`can't read ${path}: ${(err as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch (err) {
    throw new ConfigError(`${path} isn't valid JSON: ${(err as Error).message}`);
  }
  const parsed = LightpathConfig.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const where = i.path.length ? i.path.join('.') : '(top level)';
      return `  ${where}: ${i.message}`;
    });
    throw new ConfigError(`${path} has problems:\n${problems.join('\n')}`);
  }
  const base = dirname(path);
  const config = { ...parsed.data };
  if (config.webRoot) config.webRoot = resolve(base, config.webRoot);
  if (config.roots) config.roots = config.roots.map((r) => resolve(base, r));
  if (config.backend) config.backend = config.backend.map((b) => new URL(b).origin);
  if (config.url) config.url = new URL(config.url).href;
  return { path, config };
}

/** JSON Schema for editors, from the same definition. A test keeps lightpath.config.schema.json equal to it. */
export function configJsonSchema(): unknown {
  return z.toJSONSchema(LightpathConfig, { target: 'draft-7' });
}
