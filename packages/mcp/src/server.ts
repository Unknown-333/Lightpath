import { readFileSync } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  type ActionRequest,
  DaemonClient,
  DaemonDiscovery,
  DISCOVERY_FILE,
  PROTOCOL_VERSION,
  postAction,
  type Trace,
} from '@lightpath-dev/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { fitText } from './budget.js';
import { diffFunctions, hasFunctions } from './diff.js';
import { describeActionResult, describeSummaries, diffTraces } from './format.js';
import { redactFillValues } from './redact.js';
import { type ReadSource, sliceTrace } from './slices.js';
import { summarizeTrace } from './summary.js';
import { DESCRIPTIONS, INSTRUCTIONS } from './texts.js';

/** The design's run_action description (docs/design/agent-loop.md section 3, D-119): under 300 characters. */
export const RUN_ACTION_DESCRIPTION =
  "Click a button or link, or press Enter or Space, in the user's running app, and return the code that ran, " +
  'frontend and backend, with errors and failed requests. Can fill fields first. Use it to see which code ' +
  'handles a UI action, or to rerun a bug after a fix. Target: button "Checkout" or text.';

const targetSchema = z
  .string()
  .min(1)
  .max(500)
  .describe('role and name like button "Checkout", visible text, or css=<selector>');
const withinSchema = z
  .string()
  .min(1)
  .max(200)
  .describe('Text of the row or section that holds the target, e.g. "Coffee mug"');

export interface McpOptions {
  workspaceRoot: string;
}

/** This package's version, read from package.json next to dist/ so it can't drift. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const traceIdSchema = z
  .string()
  .regex(/^t_[a-z0-9]{12}$/)
  .describe('Trace id, like t_k3x9q0m2a7bz');

/**
 * Builds the MCP server (docs/ARCHITECTURE.md section 9.3). Every call reads the discovery file
 * and connects fresh, so the server works whether `lightpath dev` started before or after it.
 */
export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer({ name: 'lightpath', version: VERSION }, { instructions: INSTRUCTIONS });

  const withClient = async <T>(fn: (c: DaemonClient) => Promise<T>): Promise<T> => {
    const client = await connect(options.workspaceRoot);
    try {
      return await fn(client);
    } finally {
      client.close();
    }
  };

  server.registerTool(
    'run_action',
    {
      description: RUN_ACTION_DESCRIPTION,
      inputSchema: {
        target: targetSchema,
        within: withinSchema.optional(),
        action: z.enum(['click', 'press']).optional().describe('Default click'),
        key: z.enum(['Enter', 'Space']).optional().describe('With press; default Enter'),
        timeoutMs: z.number().int().min(500).max(30_000).optional().describe('Settle cap, default 5000'),
        fill: z
          .array(
            // Same forms as target and within; their descriptions aren't repeated, to keep tools/list small.
            z.object({
              target: z.string().min(1).max(500),
              within: z.string().min(1).max(200).optional(),
              value: z.string().max(10_000),
            }),
          )
          .max(20)
          .optional()
          .describe('Fields to fill first, in order. Values are never shown back'),
      },
    },
    async (input) => {
      const request: ActionRequest = { protocolVersion: PROTOCOL_VERSION, ...input };
      const values = (input.fill ?? []).map((f) => f.value);
      try {
        const info = await findDaemon(options.workspaceRoot);
        // The daemon answers after the settle cap, the backend wait (1.5 s) and the press wait (2 s).
        const result = await postAction(info.port, info.token, request, (input.timeoutMs ?? 5000) + 30_000);
        return { ...text(describeActionResult(input, result)), ...(result.ok ? {} : { isError: true }) };
      } catch (err) {
        return { ...text(redactFillValues((err as Error).message, values)), isError: true };
      }
    },
  );

  server.registerTool(
    'find_code_for_action',
    {
      description: DESCRIPTIONS.find_code_for_action,
      inputSchema: { action: z.string().min(1).describe('Words from the button or link label') },
    },
    async ({ action }) => {
      const trace = await withClient(async (c) => {
        const [match] = await c.listTraces({ label: action, limit: 1 });
        return match ? c.getTrace(match.id) : null;
      });
      return text(
        trace
          ? summarizeTrace(trace)
          : `No recorded action matches "${action}". Do it with run_action, or ask the user to click it in the app opened by \`lightpath dev\`, then try again.`,
      );
    },
  );

  server.registerTool(
    'get_trace',
    {
      description: DESCRIPTIONS.get_trace,
      inputSchema: {
        traceId: traceIdSchema,
        file: z.string().min(1).optional().describe('A path in the trace, or a unique part of one'),
        function: z.string().min(1).optional().describe('A function name'),
        page: z.number().int().min(1).max(10_000).optional(),
      },
    },
    async ({ traceId, file, function: fn, page }) => {
      const found = await withClient(async (c) => ({
        trace: await c.getTrace(traceId),
        roots: c.workspaceRoots,
      }));
      if (!found.trace) return text(`No trace ${traceId}; it may have been evicted.`);
      if (file === undefined && fn === undefined) return text(summarizeTrace(found.trace));
      return text(await sliceTrace(found.trace, { file, function: fn, page }, workspaceReader(found.roots)));
    },
  );

  server.registerTool(
    'list_traces',
    {
      description: DESCRIPTIONS.list_traces,
      inputSchema: {
        label: z.string().optional().describe('Only actions whose label contains this text, e.g. "Checkout"'),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ label, limit }) =>
      text(
        fitText(
          describeSummaries(
            await withClient((c) => c.listTraces({ limit: limit ?? 20, ...(label ? { label } : {}) })),
          ),
        ),
      ),
  );

  server.registerTool(
    'diff_traces',
    {
      description: DESCRIPTIONS.diff_traces,
      inputSchema: { a: traceIdSchema, b: traceIdSchema },
    },
    async ({ a, b }) => {
      const [ta, tb] = await withClient((c) => Promise.all([c.getTrace(a), c.getTrace(b)]));
      if (!ta || !tb) return text(`Trace not found: ${[!ta && a, !tb && b].filter(Boolean).join(', ')}`);
      // Traces from a daemon before build 2 have no function list: compare lines.
      return text(
        hasFunctions(ta) && hasFunctions(tb)
          ? diffFunctions(ta, tb)
          : fitText(diffTraces(ta as Trace, tb as Trace)),
      );
    },
  );

  return server;
}

/** Runs the MCP server over stdio. stdout belongs to the protocol, so nothing else may print to it. */
export async function runMcpServer(options: McpOptions): Promise<void> {
  await createMcpServer(options).connect(new StdioServerTransport());
}

/**
 * Reads trace files for slices (D-117): only a workspace-relative path whose real path is inside
 * one of the daemon's workspace roots. The daemon never reads files for clients (ARCHITECTURE 7.2).
 */
export function workspaceReader(roots: readonly string[]): ReadSource {
  return async (path) => {
    if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) return undefined;
    for (const root of roots) {
      try {
        const realRoot = await realpath(root);
        const real = await realpath(join(root, path));
        const rel = relative(realRoot, real);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
        const [text, info] = await Promise.all([readFile(real, 'utf8'), stat(real)]);
        return { text, mtimeMs: info.mtimeMs };
      } catch {
        // Not in this root.
      }
    }
    return undefined;
  };
}

async function connect(workspaceRoot: string): Promise<DaemonClient> {
  const info = await findDaemon(workspaceRoot);
  return DaemonClient.connect(info.port, info.token);
}

async function findDaemon(workspaceRoot: string): Promise<DaemonDiscovery> {
  // The nearest folder at or above the root with a discovery file: editors don't always start
  // MCP servers in the project folder itself.
  let raw: string | undefined;
  for (let dir = resolve(workspaceRoot); ; ) {
    raw = await readFile(join(dir, DISCOVERY_FILE), 'utf8').catch(() => undefined);
    const parent = dirname(dir);
    if (raw !== undefined || parent === dir) break;
    dir = parent;
  }
  if (raw === undefined) {
    throw new Error(
      `Lightpath isn't running in ${workspaceRoot}. Start it with: lightpath dev -- <your dev command>`,
    );
  }
  return DaemonDiscovery.parse(JSON.parse(raw));
}
