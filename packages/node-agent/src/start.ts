import dc from 'node:diagnostics_channel';
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
    log(`agent started, reporting to ${config.url}`);

    return {
      agent,
      transport,
      async stop() {
        dc.unsubscribe('http.server.request.start', onStart);
        dc.unsubscribe('http.server.response.finish', onFinish);
        process.off('beforeExit', onBeforeExit);
        await transport.flush();
        session.stop();
      },
    };
  } catch (err) {
    log(`agent failed to start: ${(err as Error).stack ?? err}`);
    return undefined;
  }
}
