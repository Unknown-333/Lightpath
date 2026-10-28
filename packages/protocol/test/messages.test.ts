import { describe, expect, it } from 'vitest';
import {
  ClientMessage,
  IngestBatch,
  IngestMessage,
  LinesIngest,
  PROTOCOL_VERSION,
  TraceId,
} from '../src/index.js';

const delta = {
  type: 'delta',
  traceId: 't_abc123def456',
  phase: 'action',
  startedAt: 1_730_000_000_000,
  endedAt: 1_730_000_000_040,
  request: { method: 'POST', path: '/api/orders', status: 201 },
  coverage: [
    {
      scriptId: '42',
      url: 'file:///C:/repo/server/routes/orders.ts',
      functions: [
        {
          functionName: 'createOrder',
          isBlockCoverage: true,
          ranges: [
            { startOffset: 299, endOffset: 490, count: 1 },
            { startOffset: 454, endOffset: 489, count: 0 },
          ],
        },
      ],
    },
  ],
};

describe('IngestMessage', () => {
  it('accepts a delta with real V8 coverage shape', () => {
    expect(IngestMessage.parse(delta)).toEqual(delta);
  });

  it('rejects unknown message types', () => {
    expect(IngestMessage.safeParse({ type: 'nope' }).success).toBe(false);
  });

  it('rejects negative offsets', () => {
    const bad = structuredClone(delta);
    const range = bad.coverage[0]?.functions[0]?.ranges[0];
    if (range) range.startOffset = -1;
    expect(IngestMessage.safeParse(bad).success).toBe(false);
  });
});

describe('IngestBatch', () => {
  it('requires at least one message and a protocol version', () => {
    expect(
      IngestBatch.safeParse({ protocolVersion: PROTOCOL_VERSION, agentId: 'a', messages: [] }).success,
    ).toBe(false);
    expect(
      IngestBatch.parse({ protocolVersion: PROTOCOL_VERSION, agentId: 'a', messages: [delta] }).messages,
    ).toHaveLength(1);
  });
});

describe('TraceId', () => {
  it.each([
    ['t_abc123def456', true],
    ['t_ABC123DEF456', false],
    ['abc123def456', false],
    ['t_short', false],
  ])('%s valid=%s', (id, valid) => {
    expect(TraceId.safeParse(id).success).toBe(valid);
  });
});

describe('LinesIngest', () => {
  it('accepts the Python agent payload from docs/PROTOCOL.md', () => {
    const payload = {
      type: 'lines',
      traceId: 't_abc123def456',
      pid: 4120,
      startedAt: 1_730_140_000_000,
      endedAt: 1_730_140_000_042,
      request: { method: 'POST', path: '/api/orders', status: 201 },
      files: [{ path: 'C:/repo/api/orders.py', lines: [12, 13, 15, 40] }],
    };
    expect(LinesIngest.parse(payload)).toEqual(payload);
  });
});

describe('ClientMessage', () => {
  it('accepts listTraces without optional fields', () => {
    expect(ClientMessage.parse({ type: 'listTraces', requestId: 'r1' })).toEqual({
      type: 'listTraces',
      requestId: 'r1',
    });
  });
});
