import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BatchClient } from '../src/batch-client.js';
import type { BatchIntent, BatchClientHandle } from '../src/batch-client.js';
import type {
  RouteResult,
  FeeEstimate,
  PaymentPayload,
  RouteOption,
  ChainId,
} from '@routexcc/core';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFee(chainId: ChainId): FeeEstimate {
  return {
    chainId,
    feeAmount: 1000n,
    feeUsd: 500000n,
    finalityMs: 2000,
    confidence: 'high',
    timestamp: Date.now(),
  };
}

function makeRouteResult(chainId: ChainId = 'base'): RouteResult {
  const payload: PaymentPayload = {
    chainId,
    to: '0xServerAddress',
    amount: 1000000n,
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: '0xSigned',
  };
  const option: RouteOption = {
    chainId,
    payment: { chainId, payTo: '0xServerAddress', amount: 1000000n, token: 'USDC' },
    fee: makeFee(chainId),
    balance: 100000000n,
    score: 1.0,
  };
  return { chainId, payload, fee: makeFee(chainId), evaluatedOptions: [option] };
}

const mockSigData = {
  from: '0xAgentWallet',
  nonce: '0',
  deadline: '1711123200',
  v: 27,
  r: '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  s: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
};

function makeIntent(): BatchIntent {
  return {
    from: '0xAgentWallet',
    to: '0xServerAddress',
    amount: '1000000',
    token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    nonce: '0',
    deadline: '1711123200',
    chainId: 8453,
    v: 27,
    r: '0xabcdef',
    s: '0x123456',
  };
}

interface ReceivedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

async function createMockSettlement(
  handler?: (req: ReceivedRequest) => { status: number; body: Record<string, unknown> },
): Promise<{
  server: Server;
  port: number;
  endpoint: string;
  received: ReceivedRequest[];
  close: () => Promise<void>;
}> {
  const received: ReceivedRequest[] = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const r: ReceivedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers as Record<string, string | string[] | undefined>,
        body,
      };
      received.push(r);

      if (handler) {
        const result = handler(r);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result.body));
      } else {
        // Default: accept
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted', from: '0xagent', nonce: '0', chainId: 8453 }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    received,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('BatchClient.submitIntent', () => {
  let srv: Awaited<ReturnType<typeof createMockSettlement>> | undefined;
  let client: BatchClientHandle | undefined;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = undefined; }
  });

  it('sends POST with correct headers and body', async () => {
    srv = await createMockSettlement();
    client = BatchClient({ apiKey: 'rtx_test_key', endpoint: srv.endpoint });

    const intent = makeIntent();
    const result = await client.submitIntent(intent);

    expect(result.status).toBe('accepted');
    expect(srv.received).toHaveLength(1);

    const req = srv.received[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('/v1/batch/submit');
    expect(req.headers['authorization']).toBe('Bearer rtx_test_key');
    expect(req.headers['content-type']).toBe('application/json');

    const body = JSON.parse(req.body) as BatchIntent;
    expect(body.from).toBe('0xAgentWallet');
    expect(body.to).toBe('0xServerAddress');
    expect(body.amount).toBe('1000000');
    expect(body.chainId).toBe(8453);
    expect(body.nonce).toBe('0');
  });

  it('returns accepted with server response fields', async () => {
    srv = await createMockSettlement(() => ({
      status: 202,
      body: { status: 'accepted', from: '0xabc', nonce: '5', chainId: 137 },
    }));
    client = BatchClient({ apiKey: 'rtx_test', endpoint: srv.endpoint });

    const result = await client.submitIntent(makeIntent());

    expect(result.status).toBe('accepted');
    expect(result.from).toBe('0xabc');
    expect(result.nonce).toBe('5');
    expect(result.chainId).toBe(137);
  });

  it('returns error on 400 (invalid intent)', async () => {
    srv = await createMockSettlement(() => ({
      status: 400,
      body: { error: 'nonce 0 already consumed' },
    }));
    client = BatchClient({ apiKey: 'rtx_test', endpoint: srv.endpoint });

    const result = await client.submitIntent(makeIntent());

    expect(result.status).toBe('error');
    expect(result.error).toBe('nonce 0 already consumed');
  });

  it('returns error on 401 (bad key)', async () => {
    srv = await createMockSettlement(() => ({
      status: 401,
      body: { error: 'invalid or revoked key' },
    }));
    client = BatchClient({ apiKey: 'rtx_bad', endpoint: srv.endpoint });

    const result = await client.submitIntent(makeIntent());

    expect(result.status).toBe('error');
    expect(result.error).toContain('invalid');
  });

  it('returns error on 429 (rate limit)', async () => {
    srv = await createMockSettlement(() => ({
      status: 429,
      body: { error: 'rate limit exceeded' },
    }));
    client = BatchClient({ apiKey: 'rtx_test', endpoint: srv.endpoint });

    const result = await client.submitIntent(makeIntent());

    expect(result.status).toBe('error');
    expect(result.error).toContain('rate limit');
  });

  it('returns error on network failure (does not throw)', async () => {
    client = BatchClient({ apiKey: 'rtx_test', endpoint: 'http://127.0.0.1:1' });

    const result = await client.submitIntent(makeIntent());

    expect(result.status).toBe('error');
    expect(result.error).toBeDefined();
  });
});

describe('BatchClient.submit (from RouteResult)', () => {
  let srv: Awaited<ReturnType<typeof createMockSettlement>> | undefined;

  afterEach(async () => {
    if (srv) { await srv.close(); srv = undefined; }
  });

  it('extracts fields from RouteResult and submits', async () => {
    srv = await createMockSettlement();
    const client = BatchClient({ apiKey: 'rtx_prod', endpoint: srv.endpoint });

    const result = makeRouteResult('base');
    const submitResult = await client.submit(result, mockSigData);

    expect(submitResult.status).toBe('accepted');
    expect(srv.received).toHaveLength(1);

    const body = JSON.parse(srv.received[0]!.body) as BatchIntent;
    expect(body.from).toBe('0xAgentWallet');
    expect(body.to).toBe('0xServerAddress');
    expect(body.amount).toBe('1000000');
    expect(body.token).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(body.chainId).toBe(8453);
    expect(body.nonce).toBe('0');
    expect(body.deadline).toBe('1711123200');
    expect(body.v).toBe(27);
  });

  it('maps polygon chainId correctly', async () => {
    srv = await createMockSettlement();
    const client = BatchClient({ apiKey: 'rtx_test', endpoint: srv.endpoint });

    const result = makeRouteResult('polygon');
    result.payload.token = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
    const submitResult = await client.submit(result, mockSigData);

    expect(submitResult.status).toBe('accepted');
    const body = JSON.parse(srv.received[0]!.body) as BatchIntent;
    expect(body.chainId).toBe(137);
  });

  it('rejects unsupported chains (solana, stellar)', async () => {
    const client = BatchClient({ apiKey: 'rtx_test', endpoint: 'http://unused' });

    const solanaResult = await client.submit(makeRouteResult('solana'), mockSigData);
    expect(solanaResult.status).toBe('error');
    expect(solanaResult.error).toContain('does not support batch');

    const stellarResult = await client.submit(makeRouteResult('stellar'), mockSigData);
    expect(stellarResult.status).toBe('error');
    expect(stellarResult.error).toContain('does not support batch');
  });
});

describe('BatchClient security', () => {
  it('does not include private keys or signer info in request', async () => {
    const srv = await createMockSettlement();
    const client = BatchClient({ apiKey: 'rtx_test', endpoint: srv.endpoint });

    await client.submitIntent(makeIntent());

    const body = srv.received[0]!.body.toLowerCase();
    for (const banned of ['privatekey', 'private_key', 'secret', 'mnemonic', 'password']) {
      expect(body).not.toContain(banned);
    }

    await srv.close();
  });

  it('sends apiKey only in Authorization header, not in body', async () => {
    const srv = await createMockSettlement();
    const client = BatchClient({ apiKey: 'rtx_secret_key_123', endpoint: srv.endpoint });

    await client.submitIntent(makeIntent());

    // Key should be in header
    expect(srv.received[0]!.headers['authorization']).toBe('Bearer rtx_secret_key_123');
    // Key should NOT be in body
    expect(srv.received[0]!.body).not.toContain('rtx_secret_key_123');

    await srv.close();
  });
});
