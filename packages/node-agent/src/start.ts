import { execFileSync } from 'node:child_process';
import dc from 'node:diagnostics_channel';
import { pathToFileURL } from 'node:url';
import type { IngestMessage } from '@lightpath-dev/protocol';
import { Agent, type ServerRequestLike, type ServerResponseLike } from './agent.js';
import { readConfig } from './config.js';
import { InspectorSession } from './inspector.js';
import { Transport } from './transport.js';

export interface RunningAgent {
  agent: Agent;
  transport: Transport;
  stop(): Promise<void>;
}

interface ServerMessage {
  request: ServerRequestLike;
  response: ServerResponseLike;
}

/**
 * Starts the agent if this process was launched by `lightpath dev`. Never throws: any failure
 * is logged once to stderr (only with LIGHTPATH_DEBUG=1) and the user's app runs unaffected.
 */
export function startAgent(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  ownUrl: string = import.meta.url,
): RunningAgent | undefined {
  const debug = env.LIGHTPATH_DEBUG === '1';
  const log = (msg: string) => {
    if (debug) process.stderr.write(`[lightpath ${process.pid}] ${msg}\n`);
  };

  const result = readConfig(env, argv);
  if (!result.ok) {
    log(result.reason);
    return undefined;
  }
  const { config } = result;

  try {
    // With LIGHTPATH_DEBUG=1, every coverage read is timed; bench/ parses these lines.
    const session = new InspectorSession(
      debug ? (ms, functions) => log(`take ${ms.toFixed(2)} ms, ${functions} functions in delta`) : undefined,
    );
    session.start();
    const transport = new Transport(config.url, config.token, `node-${process.pid}`, log);
    const agent = new Agent(session, config, (m) => transport.send(m), ownUrl);

    const guard =
      <T>(fn: (msg: T) => void) =>
      (msg: unknown) => {
        try {
          fn(msg as T);
        } catch (err) {
          log(`boundary error: ${(err as Error).stack ?? err}`);
        }
      };
    const onStart = guard<ServerMessage>((m) => agent.onRequestStart(m.request));
    const onFinish = guard<ServerMessage>((m) => agent.onResponseFinish(m.request, m.response));
    // Both fire on the request's own tick: start before the handler, finish after the response (measured).
    dc.subscribe('http.server.request.start', onStart);
    dc.subscribe('http.server.response.finish', onFinish);

    transport.send({
      type: 'hello',
      protocolVersion: 1,
      kind: 'node',
      pid: process.pid,
      processTitle: argv.slice(1).join(' ') || process.title,
      cwd: process.cwd(),
      runtime: { name: 'node', version: process.versions.node },
    });

    const onBeforeExit = () => void transport.flush();
    process.once('beforeExit', onBeforeExit);
    // An uncaught error ends the process before an async send could finish, so this one message
    // goes out synchronously (D-121). The monitor only watches: whether the process exits is
    // unchanged.
    const onUncaught = guard<Error>((err) => {
      const traceId = agent.soleTraceId();
      if (!traceId) {
        log(`uncaught error not attached to a trace (not exactly one tagged request in flight)`);
        return;
      }
      sendProblemSync(config.url, config.token, `node-${process.pid}`, {
        type: 'problem',
        traceId,
        at: Date.now(),
        kind: 'uncaught',
        message: errorText(err).slice(0, 1000),
        ...locationOf(err, ownUrl),
      });
    });
    process.on('uncaughtExceptionMonitor', onUncaught);
    log(`agent started, reporting to ${config.url}`);

    return {
      agent,
      transport,
      async stop() {
        dc.unsubscribe('http.server.request.start', onStart);
        dc.unsubscribe('http.server.response.finish', onFinish);
        process.off('beforeExit', onBeforeExit);
        process.off('uncaughtExceptionMonitor', onUncaught);
        await transport.flush();
        session.stop();
      },
    };
  } catch (err) {
    log(`agent failed to start: ${(err as Error).stack ?? err}`);
    return undefined;
  }
}

/** `TypeError: message`, from an Error or anything else that was thrown. */
function errorText(err: unknown): string {
  if (err instanceof Error)
    return err.message.startsWith(err.name) ? err.message : `${err.name}: ${err.message}`;
  return String(err);
}

/** The first stack frame outside Node's internals and the agent itself, as a file URL. */
function locationOf(
  err: unknown,
  ownUrl: string,
): { location?: { url: string; line: number; column: number } } {
  const own = ownUrl.slice(0, ownUrl.lastIndexOf('/') + 1);
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  for (const m of stack.matchAll(
    /\(?((?:file:\/\/\/?|\/|[A-Za-z]:\\)[^():]*(?::\\[^():]*)?[^():]*):(\d+):(\d+)\)?/g,
  )) {
    const [, where, line, column] = m;
    if (!where) continue;
    const url = where.startsWith('file:') ? where : pathToFileURL(where).href;
    if (url.startsWith(own) || url.includes('/node_modules/')) continue;
    return { location: { url, line: Number(line), column: Math.max(0, Number(column) - 1) } };
  }
  return {};
}

/**
 * POSTs one message from a child `node` and waits for it, so it arrives even though this process
 * is about to exit. NODE_OPTIONS is cleared so the child doesn't load the agent; 2 s at most.
 */
function sendProblemSync(url: string, token: string, agentId: string, message: IngestMessage): void {
  const body = JSON.stringify({ protocolVersion: 1, agentId, messages: [message] });
  const script =
    "let b='';process.stdin.on('data',(c)=>{b+=c}).on('end',()=>{" +
    "fetch(process.env.LP_URL+'/v1/ingest',{method:'POST',headers:{'content-type':'application/json'," +
    "authorization:'Bearer '+process.env.LP_TOKEN},body:b}).catch(()=>{}).finally(()=>process.exit(0))})";
  try {
    execFileSync(process.execPath, ['-e', script], {
      input: body,
      env: { ...process.env, NODE_OPTIONS: '', LP_URL: url, LP_TOKEN: token },
      timeout: 2000,
      stdio: ['pipe', 'ignore', 'ignore'],
      windowsHide: true,
    });
  } catch {
    // The daemon is gone or slow; the app's own crash matters more.
  }
}
