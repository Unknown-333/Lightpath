#!/usr/bin/env node
// Scratch stub MCP server for the output-size experiment in docs/research/agent-mcp-behavior.md.
// Not part of Lightpath. Zero dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0.
//
// Usage: node stub-server.mjs <size>   where <size> is 1k | 4k | 10k | 25k | 50k (tokens, chars/4)
// Env:   STUB_LOG=<file>               appends one JSON line per tool call (bytes returned, time)
//
// The tool returns a trace in the shape packages/mcp/src/format.ts describeTrace() prints:
// a header, request lines, one "  <path> [collector] lines <ranges>" line per file, a "not shown"
// line. One fact (the gift-card file and its lines) sits in the middle; the last line is a marker
// so the agent's quote of it shows whether the output reached the model whole.

import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const SIZES = { '1k': 1000, '4k': 4000, '10k': 10000, '25k': 25000, '50k': 50000 };
const size = process.argv[2] ?? '1k';
if (!(size in SIZES)) {
  process.stderr.write(`unknown size ${size}\n`);
  process.exit(2);
}
const TARGET_CHARS = SIZES[size] * 4; // token count is estimated as chars / 4

export const FACT = '  src/server/billing/gift-card-redeem.ts [node] lines 214-231, 240 (max 3 hits)';
export const END = (s) => `  end of trace output, marker ZK-${s}-END`;

// Deterministic PRNG so every run of one size returns the same bytes.
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export function buildTrace(s) {
  const target = SIZES[s] * 4;
  const r = rng(0x5eed + target);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const dirs = [
    'src/client/components',
    'src/client/pages',
    'src/client/hooks',
    'src/client/state',
    'src/server/routes',
    'src/server/services',
    'src/server/db',
    'src/lib',
    'src/shared',
  ];
  const nouns = [
    'cart',
    'catalog',
    'inventory',
    'shipping',
    'tax',
    'review',
    'wishlist',
    'search',
    'session',
    'auth',
    'analytics',
    'theme',
    'i18n',
    'logger',
    'address',
    'currency',
    'banner',
    'menu',
  ];
  const kinds = ['store', 'view', 'utils', 'handler', 'validator', 'mapper', 'cache', 'client'];
  const ranges = () => {
    const parts = [];
    let line = 1 + Math.floor(r() * 30);
    const n = 1 + Math.floor(r() * 4);
    for (let i = 0; i < n; i++) {
      const len = Math.floor(r() * 12);
      parts.push(len === 0 ? `${line}` : `${line}-${line + len}`);
      line += len + 2 + Math.floor(r() * 25);
    }
    return parts.join(', ');
  };
  const fileLine = (i) => {
    const ext = pick(['.ts', '.tsx', '.ts']);
    const collector = ext === '.tsx' || r() < 0.4 ? 'browser' : 'node';
    const hits = r() < 0.5 ? ` (max ${2 + Math.floor(r() * 9)} hits)` : '';
    return `  ${pick(dirs)}/${pick(nouns)}-${pick(kinds)}-${i}${ext} [${collector}] lines ${ranges()}${hits}`;
  };
  const head = [
    'Trace t_k3x9q0m2a7bz: click button "Place order"',
    '  request: POST /api/checkout → 200 (node, 41 ms)',
    '  request: GET /api/cart → 200 (node, 6 ms)',
  ];
  const tail = ['  not shown: 3 node_modules files, 1 background file', END(s)];
  const fixed = [...head, FACT, ...tail].join('\n').length + 1;
  const filler = [];
  let len = fixed;
  for (let i = 1; len < target; i++) {
    const l = fileLine(i);
    filler.push(l);
    len += l.length + 1;
  }
  const mid = Math.floor(filler.length / 2);
  const lines = [...head, ...filler.slice(0, mid), FACT, ...filler.slice(mid), ...tail];
  return { text: lines.join('\n'), factLine: head.length + mid + 1, totalLines: lines.length };
}

const TOOL = {
  name: 'find_code_for_action',
  description:
    'Find the code that runs when the user does something in the app, e.g. "Checkout" or "Add to cart". ' +
    'Uses real runtime data from the most recent matching action, not static analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', minLength: 1, description: 'Words from the button or link label' },
    },
    required: ['action'],
  },
};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function main() {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = msg;
    if (id === undefined) return; // notifications need no reply
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'lightpath', version: '0.0.0-stub' },
        },
      });
    } else if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
    } else if (method === 'tools/call') {
      const t = buildTrace(size);
      if (process.env.STUB_LOG) {
        appendFileSync(
          process.env.STUB_LOG,
          `${JSON.stringify({
            at: new Date().toISOString(),
            size,
            args: params?.arguments,
            chars: t.text.length,
            estTokens: Math.round(t.text.length / 4),
            lines: t.totalLines,
            factLine: t.factLine,
          })}\n`,
        );
      }
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: t.text }] } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  });
}

if (!process.env.STUB_NO_MAIN) main();
void TARGET_CHARS;
