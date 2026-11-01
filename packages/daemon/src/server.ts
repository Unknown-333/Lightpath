import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolveContext } from '@lightpath-dev/core';
import {
  ActionRequest,
  type ActionRunner,
  ClientMessage,
  CloseCode,
  type DaemonToClientMessage,
  IngestBatch,
  MAX_ACTION_BYTES,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '@lightpath-dev/protocol';
import { type WebSocket, WebSocketServer } from 'ws';
import { BACKEND_WAIT_MS, runAction } from './actions.js';
import { authorize, newToken } from './auth.js';
import { Correlator } from './correlator.js';
import { removeDiscovery, writeDiscovery } from './discovery.js';
import { MemoryStore, type Store } from './store.js';

export interface DaemonOptions {
  /** Workspace roots; the first one holds `.lightpath/daemon.json`. */
  workspaceRoots: string[];
  devServers?: ResolveContext['devServers'];
  /** Globs for workspace files to leave out of traces (`ignore` in lightpath.config.json). */
  ignore?: string[];
  /** 0 picks a free port. */
  port?: number;
  token?: string;
  store?: Store;
  writeDiscoveryFile?: boolean;
  log?: (msg: string) => void;
  /** Longest wait after an action's `traceEnd` for its backend lines (default 1,500 ms). */
  backendWaitMs?: number;
}

export interface RunningDaemon {
  port: number;
  url: string;
  token: string;
  startedAt: number;
  store: Store;
  correlator: Correlator;
  /**
   * Registers what runs `POST /v1/action` (the browser collector, once its page is open), or
   * removes it. Without one, every action answers `no_browser` (D-115).
   */
  setActionRunner(runner: ActionRunner | undefined): void;
  close(): Promise<void>;
}

/** Starts the daemon on 127.0.0.1 (docs/ARCHITECTURE.md section 7). */
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const token = options.token ?? newToken();
  const store = options.store ?? new MemoryStore();
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  const backendWaitMs = options.backendWaitMs ?? BACKEND_WAIT_MS;
  let actionRunner: ActionRunner | undefined;
  const correlator = new Correlator(store, {
    workspaceRoots: options.workspaceRoots,
    ...(options.devServers ? { devServers: options.devServers } : {}),
    ...(options.ignore?.length ? { ignore: options.ignore } : {}),
  });

  const server = http.createServer((req, res) => {
    void route(req, res).catch((err: unknown) => {
      log(`request error: ${(err as Error).stack ?? err}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/v1/health') {
      return json(res, 200, { ok: true, protocolVersion: PROTOCOL_VERSION });
    }
    if (req.method === 'POST' && path === '/v1/ingest') {
      const auth = authorize(req, token);
      if (auth !== 'ok') return json(res, auth === 'forbidden' ? 403 : 401, { error: auth });
      const body = await readBody(req, MAX_MESSAGE_BYTES);
      if (body === undefined) return json(res, 413, { error: 'body too large' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'invalid JSON' });
      }
      const batch = IngestBatch.safeParse(parsed);
      if (!batch.success) return json(res, 400, { error: batch.error.issues.slice(0, 5) });
      if (batch.data.protocolVersion !== PROTOCOL_VERSION)
        return json(res, 426, { error: 'protocol version mismatch' });
      for (const message of batch.data.messages) correlator.ingest(batch.data.agentId, message);
      res.writeHead(204, { 'x-lightpath-started-at': String(startedAt) }).end();
      return;
    }
    if (req.method === 'POST' && path === '/v1/action') {
      // Same rules as /v1/ingest (D-115). The body holds `fill` values, which are secrets: it is
      // never logged, and a schema error reply names fields, never values.
      const auth = authorize(req, token);
      if (auth !== 'ok') return json(res, auth === 'forbidden' ? 403 : 401, { error: auth });
      // Drain an oversized body instead of dropping the connection, so the caller sees the 413.
      const body = await readBody(req, MAX_ACTION_BYTES, true);
      if (body === undefined) return json(res, 413, { error: 'body too large' });
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return json(res, 400, { error: 'invalid JSON' });
      }
      const request = ActionRequest.safeParse(parsed);
      if (!request.success) {
        const issues = request.error.issues.slice(0, 5).map((i) => ({ path: i.path, message: i.message }));
        return json(res, 400, { error: issues });
      }
      if (request.data.protocolVersion !== PROTOCOL_VERSION)
        return json(res, 426, { error: 'protocol version mismatch' });
      return json(res, 200, await runAction(actionRunner, store, request.data, backendWaitMs));
    }
    json(res, 404, { error: 'not found' });
  }

  // ── Client feed ───────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  server.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const auth = authorize(req, token);
    if (path !== '/v1/client' || auth !== 'ok') {
      socket.end(
        `HTTP/1.1 ${auth === 'forbidden' ? '403 Forbidden' : path !== '/v1/client' ? '404 Not Found' : '401 Unauthorized'}\r\n\r\n`,
      );
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => onClient(ws));
  });

  function onClient(ws: WebSocket): void {
    const send = (m: DaemonToClientMessage) => ws.send(JSON.stringify(m));
    send({ type: 'welcome', protocolVersion: PROTOCOL_VERSION, workspaceRoots: options.workspaceRoots });
    const unsubscribe = store.subscribe((trace) => send({ type: 'trace', trace }));
    ws.on('close', unsubscribe);
    ws.on('message', (data) => {
      let parsed: ReturnType<typeof ClientMessage.safeParse>;
      try {
        parsed = ClientMessage.safeParse(JSON.parse(String(data)));
      } catch {
        ws.close(CloseCode.BadMessage, 'invalid JSON');
        return;
      }
      if (!parsed.success) {
        ws.close(CloseCode.BadMessage, 'invalid message');
        return;
      }
      const msg = parsed.data;
      if (msg.type === 'listTraces') {
        send({
          type: 'traces',
          requestId: msg.requestId,
          traces: store.list({ limit: msg.limit, label: msg.label }),
        });
      } else {
        send({ type: 'traceResult', requestId: msg.requestId, trace: store.get(msg.traceId) ?? null });
      }
    });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const root = options.workspaceRoots[0];
  if (options.writeDiscoveryFile !== false && root) {
    await writeDiscovery(root, {
      port,
      token,
      pid: process.pid,
      protocolVersion: PROTOCOL_VERSION,
      startedAt,
    });
  }
  log(`daemon listening on 127.0.0.1:${port}`);

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    token,
    startedAt,
    store,
    correlator,
    setActionRunner(runner) {
      actionRunner = runner;
    },
    async close() {
      for (const client of wss.clients) client.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (options.writeDiscoveryFile !== false && root) await removeDiscovery(root);
    },
  };
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

/**
 * Reads a request body as UTF-8, or returns undefined if it exceeds `limit` bytes. Past the limit
 * it drops the connection, or with `drain` reads the rest without keeping it.
 */
function readBody(req: IncomingMessage, limit: number, drain = false): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        chunks.length = 0;
        if (drain) return;
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(size > limit ? undefined : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
