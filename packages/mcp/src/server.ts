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
import { AUTO_START_WAIT_MS, AutoStarter, type AutoStartOptions, DEV_LOG } from './autostart.js';
import { fitText } from './budget.js';
import { diffFunctions, hasFunctions } from './diff.js';
import {
  describeActionResult,
  describeRequestResult,
  describeSummaries,
  diffTraces,
  redirectNote,
} from './format.js';
import { redact, redactFillValues } from './redact.js';
import {
  hasBackend,
  loopbackLocation,
  newRequestTraceId,
  pathOnly,
  REQUEST_METHODS,
  REQUEST_TRACE_WAIT_MS,
  type Resolver,
  type RunRequestInput,
  resolveTarget as resolveRequestTarget,
  sendRequest,
} from './request.js';
import { type ReadSource, sliceTrace } from './slices.js';
import { summarizeTrace } from './summary.js';
import { DESCRIPTIONS, INSTRUCTIONS } from './texts.js';

/** The design's run_action description (docs/design/agent-loop.md section 3, D-119): under 300 characters. */
export const RUN_ACTION_DESCRIPTION =
  "Click a button or link, or press Enter or Space, in the user's running app, and return the code that ran, " +
  'frontend and backend. Can fill fields first. Use it to see which code handles a UI action, or to ' +
  'rerun a bug after a fix.';

const targetSchema = z.string().min(1).max(500).describe('button "Checkout", text, or css=<selector>');
const withinSchema = z.string().min(1).max(200).describe('Text of its row or section');

export interface McpOptions {
  workspaceRoot: string;
  /** Resolves `localhost` for run_request's loopback check (tests pass a fake). */
  resolver?: Resolver;
  /** How long run_request waits for the backend trace after the response (default 1,500 ms). */
  requestTraceWaitMs?: number;
  /** Starting Lightpath when it isn't running (D-122): set by `lightpath mcp` from the config. */
  autoStart?: AutoStartOptions;
  /** How long to wait for an auto-started daemon and its browser (default 60 s). */
  autoStartWaitMs?: number;
}

/**
 * The app URL that run_request resolves a path against: `url` in `lightpath.config.json`, in the
 * folder that holds the daemon's discovery file, or else in the workspace root.
 */
async function appUrl(dirs: readonly string[]): Promise<string | undefined> {
  for (const dir of dirs) {
    try {
      const raw = await readFile(join(dir, 'lightpath.config.json'), 'utf8');
      const url = (JSON.parse(raw.replace(/^\uFEFF/, '')) as { url?: unknown }).url;
      if (typeof url === 'string') return url;
    } catch {
      // No config here, or not JSON.
    }
  }
  return undefined;
}

/** run_request (design section 4A, D-125): one request on loopback, then its backend trace. */
async function runRequest(options: McpOptions, found: Live, input: RunRequestInput): Promise<string> {
  const method = input.method ?? 'GET';
  const target = await resolveRequestTarget(
    input.url,
    await appUrl([found.root, options.workspaceRoot]),
    options.resolver,
  );
  if (!target.ok) return `run_request did not send anything: ${target.code}. ${target.message}`;
  const path = pathOnly(target.url.pathname);
  const traceId = newRequestTraceId();
  const client = await DaemonClient.connect(found.info.port, found.info.token);
  try {
    // Listen before sending: the backend delta can arrive before the response does.
    let latest: Trace | undefined;
    let wake: () => void = () => {};
    const off = client.onTrace((t) => {
      if (t.id !== traceId) return;
      latest = t;
      if (hasBackend(t)) wake();
    });
    try {
      const sent = await sendRequest(target, input, traceId);
      if (!sent.ok) {
        return `run_request got no response: no_response. ${method} ${target.url.origin}${path} failed (${sent.message}). Is your server running under lightpath dev?`;
      }
      if (!hasBackend(latest)) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, options.requestTraceWaitMs ?? REQUEST_TRACE_WAIT_MS);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
      const trace = hasBackend(latest) ? latest : await client.getTrace(traceId);
      if (!trace || !hasBackend(trace)) {
        const note = redirectNote(sent.status, loopbackLocation(sent.location, target.url));
        return (
          `run_request got ${method} ${path} → ${sent.status} (${sent.bytes.toLocaleString('en-US')} bytes, ${Math.round(sent.durationMs)} ms), but no trace: no_trace. ` +
          "No backend lines arrived: the server isn't running under lightpath dev, or Lightpath skips this process." +
          (note ? `\n${note}` : '')
        );
      }
      return describeRequestResult(
        method,
        path,
        { ...sent, redirect: loopbackLocation(sent.location, target.url) },
        trace,
      );
    } finally {
      off();
    }
  } finally {
    client.close();
  }
}

/** This package's version, read from package.json next to dist/ so it can't drift. */
const VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
).version;

/**
 * Every tool result goes out through here: redaction rules 2 to 5 (D-123), then the 16,000-character
 * cap again, since a `[redacted]` can be longer than what it hides.
 */
const text = (t: string) => ({ content: [{ type: 'text' as const, text: fitText(redact(t)) }] });
/** Source slices only: the user's own files are never redacted (design section 9). */
const sourceText = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const traceIdSchema = z.string().regex(/^t_[a-z0-9]{12}$/);

/**
 * Builds the MCP server (docs/ARCHITECTURE.md section 9.3). Every call reads the discovery file
 * and connects fresh, so the server works whether `lightpath dev` started before or after it.
 */
export function createMcpServer(options: McpOptions): McpServer {
  const server = new McpServer({ name: 'lightpath', version: VERSION }, { instructions: INSTRUCTIONS });

  const starter = new AutoStarter(resolve(options.workspaceRoot), options.autoStart);
  /** The auto-start line, printed at the start of the next tool result (D-122). */
  let note: string | undefined;
  const ensure = async (): Promise<Live> => {
    const live = await liveDaemon(options.workspaceRoot);
    if (live) return live;
    if (!starter.enabled) throw new Error(redact(starter.notRunning()));
    note = starter.start();
    const deadline = Date.now() + (options.autoStartWaitMs ?? AUTO_START_WAIT_MS);
    while (Date.now() < deadline) {
      await sleep(250);
      const up = await liveDaemon(options.workspaceRoot);
      if (up) return { ...up, started: true };
      if (starter.pid === undefined) break;
    }
    throw new Error(redact(`${note}, but it didn't start within 60 s, or it exited. See ${DEV_LOG}.`));
  };
  /** Every tool result: the auto-start line first, when this call started Lightpath. */
  const reply = (t: string) => {
    const n = note;
    note = undefined;
    return text(n ? `${n}\n${t}` : t);
  };
  /** A source slice: the start line, redacted like any other, then the user's lines as they are. */
  const sourceReply = (t: string) => {
    const n = note;
    note = undefined;
    return sourceText(n ? `${redact(n)}\n${t}` : t);
  };

  const withClient = async <T>(fn: (c: DaemonClient) => Promise<T>): Promise<T> => {
    const { info } = await ensure();
    const client = await DaemonClient.connect(info.port, info.token);
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
            // Same forms as target and within. Bounds and descriptions aren't repeated here, to keep
            // tools/list under 4,000 characters (D-129); the daemon checks them (400).
            z.object({ target: z.string(), within: z.string().optional(), value: z.string() }),
          )
          .max(20)
          .optional()
          .describe('Filled first, in order; values never shown'),
      },
    },
    async (input) => {
      const request: ActionRequest = { protocolVersion: PROTOCOL_VERSION, ...input };
      const values = (input.fill ?? []).map((f) => f.value);
      try {
        const { info, started } = await ensure();
        // The daemon answers after the settle cap, the backend wait (1.5 s) and the press wait (2 s).
        const send = () => postAction(info.port, info.token, request, (input.timeoutMs ?? 5000) + 30_000);
        let result = await send();
        // A daemon this server just started opens its browser a little later (design section 11).
        const deadline = Date.now() + (options.autoStartWaitMs ?? AUTO_START_WAIT_MS);
        while (started && !result.ok && result.error.code === 'no_browser' && Date.now() < deadline) {
          await sleep(500);
          result = await send();
        }
        return { ...reply(describeActionResult(input, result)), ...(result.ok ? {} : { isError: true }) };
      } catch (err) {
        return { ...reply(redactFillValues((err as Error).message, values)), isError: true };
      }
    },
  );

  server.registerTool(
    'run_request',
    {
      description: DESCRIPTIONS.run_request,
      inputSchema: {
        method: z.enum(REQUEST_METHODS).optional().describe('Default GET'),
        url: z.string().min(1).max(2000).describe('Path or loopback URL'),
        body: z.string().max(100_000).optional().describe('Never shown back'),
        contentType: z.string().min(1).optional(),
        timeoutMs: z.number().int().min(500).max(30_000).optional(),
      },
    },
    async (input) => {
      let live: Live;
      try {
        live = await ensure();
      } catch (err) {
        return reply(`${(err as Error).message} Nothing was sent.`);
      }
      return reply(await runRequest(options, live, input));
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
      return reply(
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
        file: z.string().min(1).optional(),
        function: z.string().min(1).optional(),
        page: z.number().int().min(1).optional(),
      },
    },
    async ({ traceId, file, function: fn, page }) => {
      const found = await withClient(async (c) => ({
        trace: await c.getTrace(traceId),
        roots: c.workspaceRoots,
      }));
      if (!found.trace) return reply(`No trace ${traceId}; it may have been evicted.`);
      if (file === undefined && fn === undefined) return reply(summarizeTrace(found.trace));
      return sourceReply(
        await sliceTrace(found.trace, { file, function: fn, page }, workspaceReader(found.roots)),
      );
    },
  );

  server.registerTool(
    'list_traces',
    {
      description: DESCRIPTIONS.list_traces,
      inputSchema: {
        label: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ label, limit }) =>
      reply(
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
      if (!ta || !tb) return reply(`Trace not found: ${[!ta && a, !tb && b].filter(Boolean).join(', ')}`);
      // Traces from a daemon before build 2 have no function list: compare lines.
      return reply(
        hasFunctions(ta) && hasFunctions(tb)
          ? diffFunctions(ta, tb)
          : fitText(diffTraces(ta as Trace, tb as Trace)),
      );
    },
  );

  return server;
}

/** Runs the MCP server over stdio. stdout belongs to the protocol, so nothing else may print to it. */
/** A daemon that answers `GET /v1/health`, with the folder its discovery file is in. */
interface Live {
  info: DaemonDiscovery;
  root: string;
  started?: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The discovery file's daemon, if it is up: a stale file (a hard-killed daemon) counts as none. */
async function liveDaemon(workspaceRoot: string): Promise<Live | undefined> {
  let found: Live;
  try {
    found = await findDaemonWithRoot(workspaceRoot);
  } catch {
    return undefined;
  }
  try {
    const res = await fetch(`http://127.0.0.1:${found.info.port}/v1/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? found : undefined;
  } catch {
    return undefined;
  }
}

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

async function findDaemonWithRoot(workspaceRoot: string): Promise<{ info: DaemonDiscovery; root: string }> {
  // The nearest folder at or above the root with a discovery file: editors don't always start
  // MCP servers in the project folder itself.
  let raw: string | undefined;
  let dir = resolve(workspaceRoot);
  for (;;) {
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
  return { info: DaemonDiscovery.parse(JSON.parse(raw)), root: dir };
}
