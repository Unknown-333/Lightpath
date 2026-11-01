import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
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
import { describeActionResult, describeSummaries, describeTrace, diffTraces } from './format.js';
import { redactFillValues } from './redact.js';

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
  const server = new McpServer({ name: 'lightpath', version: VERSION });

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
            z.object({
              target: targetSchema,
              within: withinSchema.optional(),
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
    'list_traces',
    {
      description: 'List recent user actions (clicks and requests) recorded by Lightpath, newest first.',
      inputSchema: {
        label: z.string().optional().describe('Only actions whose label contains this text, e.g. "Checkout"'),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ label, limit }) =>
      text(
        describeSummaries(
          await withClient((c) => c.listTraces({ limit: limit ?? 20, ...(label ? { label } : {}) })),
        ),
      ),
  );

  server.registerTool(
    'get_trace',
    {
      description: 'Show every source file and line that ran for one recorded action, frontend and backend.',
      inputSchema: { traceId: traceIdSchema },
    },
    async ({ traceId }) => {
      const trace = await withClient((c) => c.getTrace(traceId));
      return text(trace ? describeTrace(trace) : `No trace ${traceId}; it may have been evicted.`);
    },
  );

  server.registerTool(
    'find_code_for_action',
    {
      description:
        'Find the code that runs when the user does something in the app, e.g. "Checkout" or "Add to cart". ' +
        'Uses real runtime data from the most recent matching action, not static analysis.',
      inputSchema: { action: z.string().min(1).describe('Words from the button or link label') },
    },
    async ({ action }) => {
      const trace = await withClient(async (c) => {
        const [match] = await c.listTraces({ label: action, limit: 1 });
        return match ? c.getTrace(match.id) : null;
      });
      return text(
        trace
          ? describeTrace(trace)
          : `No recorded action matches "${action}". Ask the user to click it in the app opened by \`lightpath dev\`, then try again.`,
      );
    },
  );

  server.registerTool(
    'diff_traces',
    {
      description: 'Compare two recorded actions and list the lines that ran in only one of them.',
      inputSchema: { a: traceIdSchema, b: traceIdSchema },
    },
    async ({ a, b }) => {
      const [ta, tb] = await withClient((c) => Promise.all([c.getTrace(a), c.getTrace(b)]));
      if (!ta || !tb) return text(`Trace not found: ${[!ta && a, !tb && b].filter(Boolean).join(', ')}`);
      return text(diffTraces(ta as Trace, tb as Trace));
    },
  );

  return server;
}

/** Runs the MCP server over stdio. stdout belongs to the protocol, so nothing else may print to it. */
export async function runMcpServer(options: McpOptions): Promise<void> {
  await createMcpServer(options).connect(new StdioServerTransport());
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
