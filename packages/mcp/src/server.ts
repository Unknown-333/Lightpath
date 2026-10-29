import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DaemonClient, DaemonDiscovery, DISCOVERY_FILE, type Trace } from '@lightpath-dev/protocol';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { describeSummaries, describeTrace, diffTraces } from './format.js';

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
  const info = DaemonDiscovery.parse(JSON.parse(raw));
  return DaemonClient.connect(info.port, info.token);
}
