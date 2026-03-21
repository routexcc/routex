import { describe, it, expect, vi, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  TelemetryReporter,
  calculateSavings,
  extractTelemetryEvent,
} from '../src/telemetry.js';
import type {
  TelemetryEvent,
  TelemetryReporterHandle,
} from '../src/telemetry.js';
import type {
  ChainId,
  FeeEstimate,
  PaymentPayload,
  RouteOption,
  RouteResult,
} from '@routexcc/core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

function makeFee(chainId: ChainId, feeUsd = 500000n): FeeEstimate {
  return {
    chainId,
    feeAmount: 1000n,
    feeUsd,
    finalityMs: 2000,
    confidence: 'high',
    timestamp: Date.now(),
  };
}

function makeRouteResult(opts?: {
  chainId?: ChainId;
  amount?: bigint;
  feeUsd?: bigint;
  extraOptions?: RouteOption[];
}): RouteResult {
  const chainId = opts?.chainId ?? 'base';
  const amount = opts?.amount ?? 1000000n;
  const feeUsd = opts?.feeUsd ?? 500000n;

  const payload: PaymentPayload = {
    chainId,
    to: '0xRecipient',
    amount,
    token: 'USDC',
    data: '0xSigned',
  };

  const selectedOption: RouteOption = {
    chainId,
    payment: { chainId, payTo: '0xRecipient', amount, token: 'USDC' },
    fee: makeFee(chainId, feeUsd),
    balance: 100000000n,
    score: 1.0,
  };

  const evaluatedOptions: RouteOption[] = [selectedOption, ...(opts?.extraOptions ?? [])];

  return {
    chainId,
    payload,
    fee: makeFee(chainId, feeUsd),
    evaluatedOptions,
  };
}

interface ReceivedPost {
  headers: Record<string, string | string[] | undefined>;
  body: string;
  parsed: { events: TelemetryEvent[] };
}

async function createTelemetryServer(): Promise<{
  server: Server;
  port: number;
  endpoint: string;
  receivedPosts: ReceivedPost[];
  close: () => Promise<void>;
}> {
  const receivedPosts: ReceivedPost[] = [];

  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/v1/telemetry') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        receivedPosts.push({
          headers: req.headers as Record<string, string | string[] | undefined>,
          body,
          parsed: JSON.parse(body) as { events: TelemetryEvent[] },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const port = (server.address() as AddressInfo).port;

  return {
    server,
    port,
    endpoint: `http://127.0.0.1:${port}`,
    receivedPosts,
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

describe('calculateSavings', () => {
  it('returns 0n with a single evaluated option', () => {
    const result = makeRouteResult();
    expect(calculateSavings(result)).toBe(0n);
  });

  it('calculates savings as difference between selected and next-best fee', () => {
    const nextBest: RouteOption = {
      chainId: 'polygon',
      payment: { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      fee: makeFee('polygon', 800000n),
      balance: 100000000n,
      score: 0.8,
    };

    const result = makeRouteResult({ feeUsd: 300000n, extraOptions: [nextBest] });
    // savings = 800000 - 300000 = 500000
    expect(calculateSavings(result)).toBe(500000n);
  });

  it('returns 0n if selected is more expensive than alternatives', () => {
    const cheaperAlt: RouteOption = {
      chainId: 'stellar',
      payment: { chainId: 'stellar', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      fee: makeFee('stellar', 100000n),
      balance: 100000000n,
      score: 0.5, // Lower score despite lower fee (maybe slower)
    };

    const result = makeRouteResult({ feeUsd: 500000n, extraOptions: [cheaperAlt] });
    // selected is more expensive, savings = 0
    expect(calculateSavings(result)).toBe(0n);
  });

  it('handles multiple options and picks correct next-best', () => {
    const opt2: RouteOption = {
      chainId: 'polygon',
      payment: { chainId: 'polygon', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      fee: makeFee('polygon', 700000n),
      balance: 100000000n,
      score: 0.9,
    };
    const opt3: RouteOption = {
      chainId: 'stellar',
      payment: { chainId: 'stellar', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
      fee: makeFee('stellar', 900000n),
      balance: 100000000n,
      score: 0.7,
    };

    const result = makeRouteResult({ feeUsd: 200000n, extraOptions: [opt2, opt3] });
    // sorted by score: selected(1.0), opt2(0.9), opt3(0.7)
    // next-best is opt2 with 700000
    // savings = 700000 - 200000 = 500000
    expect(calculateSavings(result)).toBe(500000n);
  });
});

describe('extractTelemetryEvent', () => {
  it('extracts only allowlisted fields', () => {
    const result = makeRouteResult({
      chainId: 'solana',
      amount: 5000000n,
      feeUsd: 150000n,
    });

    const event = extractTelemetryEvent(result);

    expect(event.chainId).toBe('solana');
    expect(event.amount).toBe('5000000');
    expect(event.feeUsd).toBe('150000');
    expect(event.savingsUsd).toBe('0');
    expect(typeof event.timestamp).toBe('number');
    expect(event.timestamp).toBeGreaterThan(0);
  });

  it('contains exactly 5 fields — no more, no less', () => {
    const result = makeRouteResult();
    const event = extractTelemetryEvent(result);
    const keys = Object.keys(event);

    expect(keys).toHaveLength(5);
    expect(keys.sort()).toEqual(['amount', 'chainId', 'feeUsd', 'savingsUsd', 'timestamp']);
  });

  it('does NOT contain private keys, addresses, or signer info', () => {
    const result = makeRouteResult();
    const event = extractTelemetryEvent(result);
    const serialized = JSON.stringify(event).toLowerCase();

    for (const banned of [
      'privatekey', 'private_key',
      'secret', 'mnemonic', 'password',
      'signer', 'wallet',
      '0xrecipient', 'payto',
      'data', '0xsigned',
    ]) {
      expect(serialized).not.toContain(banned);
    }
  });

  it('serializes BigInt values as strings (no precision loss)', () => {
    const largeAmount = 9007199254740993n; // > Number.MAX_SAFE_INTEGER
    const result = makeRouteResult({ amount: largeAmount });
    const event = extractTelemetryEvent(result);

    expect(event.amount).toBe('9007199254740993');
    // Verify round-trip
    expect(BigInt(event.amount)).toBe(largeAmount);
  });
});

describe('TelemetryReporter', () => {
  let telemetryServer: Awaited<ReturnType<typeof createTelemetryServer>> | undefined;
  let reporter: TelemetryReporterHandle | undefined;

  afterEach(async () => {
    if (reporter) {
      await reporter.stop();
      reporter = undefined;
    }
    if (telemetryServer) {
      await telemetryServer.close();
      telemetryServer = undefined;
    }
  });

  it('sends POST with correct headers', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_analytics_key',
      endpoint: telemetryServer.endpoint,
      bufferSize: 1, // Flush immediately
    });

    reporter.report(makeRouteResult());
    await wait(200);

    expect(telemetryServer.receivedPosts.length).toBe(1);
    const post = telemetryServer.receivedPosts[0]!;
    expect(post.headers['content-type']).toBe('application/json');
    expect(post.headers['authorization']).toBe('Bearer rtx_analytics_key');
  });

  it('sends events with correct body structure', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 1,
    });

    reporter.report(makeRouteResult({ chainId: 'base', amount: 1000000n, feeUsd: 500000n }));
    await wait(200);

    expect(telemetryServer.receivedPosts.length).toBe(1);
    const body = telemetryServer.receivedPosts[0]!.parsed;
    expect(body.events).toHaveLength(1);

    const event = body.events[0]!;
    expect(event.chainId).toBe('base');
    expect(event.amount).toBe('1000000');
    expect(event.feeUsd).toBe('500000');
    expect(event.savingsUsd).toBe('0');
    expect(typeof event.timestamp).toBe('number');
  });

  it('buffers events and flushes when buffer is full', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 3,
      flushIntervalMs: 60000, // Long interval — don't auto-flush
    });

    reporter.report(makeRouteResult());
    reporter.report(makeRouteResult());
    await wait(200);
    // Buffer not full (2 < 3), nothing sent
    expect(telemetryServer.receivedPosts.length).toBe(0);

    reporter.report(makeRouteResult());
    await wait(200);
    // Buffer full (3 >= 3), should flush
    expect(telemetryServer.receivedPosts.length).toBe(1);
    expect(telemetryServer.receivedPosts[0]!.parsed.events).toHaveLength(3);
  });

  it('flush() sends buffered events immediately', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    reporter.report(makeRouteResult());
    reporter.report(makeRouteResult());

    await reporter.flush();

    expect(telemetryServer.receivedPosts.length).toBe(1);
    expect(telemetryServer.receivedPosts[0]!.parsed.events).toHaveLength(2);
  });

  it('periodic flush sends events at configured interval', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 100,
      flushIntervalMs: 300,
    });

    reporter.report(makeRouteResult());
    await wait(500);

    expect(telemetryServer.receivedPosts.length).toBe(1);
  });

  it('stop() flushes remaining events', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 100,
      flushIntervalMs: 60000,
    });

    reporter.report(makeRouteResult());
    reporter.report(makeRouteResult());

    await reporter.stop();

    expect(telemetryServer.receivedPosts.length).toBe(1);
    expect(telemetryServer.receivedPosts[0]!.parsed.events).toHaveLength(2);
  });

  it('does not throw when endpoint is unreachable', async () => {
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: 'http://127.0.0.1:1', // nothing listening
      bufferSize: 1,
    });

    // Should not throw
    reporter.report(makeRouteResult());
    await wait(200);

    // Also flush should not throw
    await expect(reporter.flush()).resolves.toBeUndefined();
  });

  it('does not throw on non-200 response', async () => {
    const badServer = createServer((_req, res) => {
      res.writeHead(500);
      res.end('Internal Server Error');
    });
    await new Promise<void>((resolve) => {
      badServer.listen(0, '127.0.0.1', resolve);
    });
    const port = (badServer.address() as AddressInfo).port;

    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: `http://127.0.0.1:${port}`,
      bufferSize: 1,
    });

    reporter.report(makeRouteResult());
    await wait(200);

    // No throw — fire and forget
    badServer.close();
  });

  it('does not report after stop()', async () => {
    telemetryServer = await createTelemetryServer();
    reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: telemetryServer.endpoint,
      bufferSize: 1,
    });

    await reporter.stop();

    reporter.report(makeRouteResult());
    await wait(200);

    // Nothing sent after stop
    expect(telemetryServer.receivedPosts.length).toBe(0);
  });
});

describe('TelemetryReporter edge cases', () => {
  it('uses default endpoint when none provided', async () => {
    const reporter = TelemetryReporter({ apiKey: 'rtx_test' });
    // Just verifying it doesn't throw with defaults
    reporter.report(makeRouteResult());
    await reporter.stop();
  });

  it('flush() with empty buffer is a no-op', async () => {
    const reporter = TelemetryReporter({
      apiKey: 'rtx_test',
      endpoint: 'http://127.0.0.1:1',
    });
    // Nothing reported — flush should be no-op
    await expect(reporter.flush()).resolves.toBeUndefined();
    await reporter.stop();
  });
});

describe('TelemetryEvent type safety', () => {
  it('TelemetryEvent has no `any` typed fields', () => {
    const result = makeRouteResult();
    const event = extractTelemetryEvent(result);

    // All fields must be explicitly typed
    expect(typeof event.chainId).toBe('string');
    expect(typeof event.amount).toBe('string');
    expect(typeof event.feeUsd).toBe('string');
    expect(typeof event.savingsUsd).toBe('string');
    expect(typeof event.timestamp).toBe('number');
  });

  it('no spread operators used in event construction', async () => {
    // Read the source file and verify no spread operators on TelemetryEvent
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(
      new URL('../src/telemetry.ts', import.meta.url),
      'utf-8',
    );

    // Find the extractTelemetryEvent function body
    const fnMatch = source.match(/function extractTelemetryEvent[\s\S]*?\{([\s\S]*?)\n\}/);
    expect(fnMatch).toBeTruthy();
    const fnBody = fnMatch![1]!;

    // No spread operator in the return object
    expect(fnBody).not.toContain('...');
  });

  it('cloud SDK source does not reference private key types', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const srcDir = new URL('../src/', import.meta.url).pathname;
    const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'));

    for (const file of files) {
      const content = readFileSync(join(srcDir, file), 'utf-8');
      const lower = content.toLowerCase();
      for (const banned of ['privatekey', 'private_key', 'secretkey', 'secret_key', 'mnemonic']) {
        expect(lower).not.toContain(banned);
      }
    }
  });
});
