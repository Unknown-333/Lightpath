import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ResolveContext } from '@lightpath/core';
import {
  ClientMessage,
  CloseCode,
  type DaemonToClientMessage,
  IngestBatch,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '@lightpath/protocol';
import { type WebSocket, WebSocketServer } from 'ws';
import { authorize, newToken } from './auth.js';
import { Correlator } from './correlator.js';
import { removeDiscovery, writeDiscovery } from './discovery.js';
import { MemoryStore, type Store } from './store.js';

export interface DaemonOptions {
  /** Workspace roots; the first one holds `.lightpath/daemon.json`. */
  workspaceRoots: string[];
  devServers?: ResolveContext['devServers'];
  /** 0 picks a free port. */
  port?: number;
  token?: string;
  store?: Store;
  writeDiscoveryFile?: boolean;
  log?: (msg: string) => void;
}

export interface RunningDaemon {
  port: number;
  url: string;
  token: string;
  startedAt: number;
  store: Store;
  correlator: Correlator;
  close(): Promise<void>;
}

/** Starts the daemon on 127.0.0.1 (docs/ARCHITECTURE.md section 7). */
export async function startDaemon(options: DaemonOptions): Promise<RunningDaemon> {
  const token = options.token ?? newToken();
  const store = options.store ?? new MemoryStore();
  const log = options.log ?? (() => {});
  const startedAt = Date.now();
  const correlator = new Correlator(store, {
    workspaceRoots: options.workspaceRoots,
    ...(options.devServers ? { devServers: options.devServers } : {}),
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

/** Reads a request body as UTF-8, or returns undefined if it exceeds `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(undefined);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
