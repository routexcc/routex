import { describe, it, expect, afterEach } from 'vitest';
import { CloudFeeOracle, TelemetryReporter, BatchClient } from '../src/index.js';
import type {
  ChainId,
  FeeEstimate,
  FeeOracle,
  RouteResult,
  PaymentPayload,
  RouteOption,
} from '@routexcc/core';

// ─── Test Helpers ────────────────────────────────────────────────────────────

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

function makeFallbackOracle(): FeeOracle {
  const fees = new Map<ChainId, FeeEstimate>([
    ['base', makeFee('base')],
    ['polygon', makeFee('polygon')],
  ]);

  return {
    async getFee(chainId: ChainId) { return fees.get(chainId); },
    async getAllFees() { return fees; },
    start() { /* noop */ },
    stop() { /* noop */ },
  };
}

function makeRouteResult(): RouteResult {
  const payload: PaymentPayload = {
    chainId: 'base',
    to: '0xRecipient',
    amount: 1000000n,
    token: 'USDC',
    data: '0xSigned',
  };
  const option: RouteOption = {
    chainId: 'base',
    payment: { chainId: 'base', payTo: '0xRecipient', amount: 1000000n, token: 'USDC' },
    fee: makeFee('base'),
    balance: 100000000n,
    score: 1.0,
  };
  return {
    chainId: 'base',
    payload,
    fee: makeFee('base'),
    evaluatedOptions: [option],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('CloudFeeOracle (no server — pure fallback)', () => {
  let oracle: FeeOracle;

  afterEach(() => {
    if (oracle) oracle.stop();
  });

  it('delegates getFee to fallback when cloud unreachable', async () => {
    const fallback = makeFallbackOracle();
    oracle = CloudFeeOracle({
      apiKey: 'test-key',
      fallback,
      endpoint: 'http://127.0.0.1:1', // nothing listening
      fallbackTimeoutMs: 100,
    });

    // Without start(), cache is empty → delegates to fallback
    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.chainId).toBe('base');
  });

  it('delegates getAllFees to fallback when cloud unreachable', async () => {
    const fallback = makeFallbackOracle();
    oracle = CloudFeeOracle({
      apiKey: 'test-key',
      fallback,
      endpoint: 'http://127.0.0.1:1',
      fallbackTimeoutMs: 100,
    });

    const fees = await oracle.getAllFees();
    expect(fees.size).toBe(2);
    expect(fees.has('base')).toBe(true);
    expect(fees.has('polygon')).toBe(true);
  });

  it('start/stop do not throw', () => {
    const fallback = makeFallbackOracle();
    oracle = CloudFeeOracle({
      apiKey: 'test-key',
      fallback,
      endpoint: 'http://127.0.0.1:1',
    });

    expect(() => oracle.start()).not.toThrow();
    expect(() => oracle.stop()).not.toThrow();
  });
});

describe('TelemetryReporter (via index re-export)', () => {
  it('creates a reporter with report and flush methods', () => {
    const reporter = TelemetryReporter({
      apiKey: 'test-key',
      endpoint: 'http://127.0.0.1:1',
    });
    expect(reporter).toBeDefined();
    expect(typeof reporter.report).toBe('function');
    expect(typeof reporter.flush).toBe('function');
    expect(typeof reporter.stop).toBe('function');
    void reporter.stop();
  });

  it('report does not throw even with unreachable endpoint', async () => {
    const reporter = TelemetryReporter({
      apiKey: 'test-key',
      endpoint: 'http://127.0.0.1:1',
      bufferSize: 1,
    });
    const result = makeRouteResult();

    expect(() => reporter.report(result)).not.toThrow();
    await reporter.stop();
  });
});

describe('BatchClient', () => {
  it('creates a client with submit and submitIntent methods', () => {
    const client = BatchClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
    expect(typeof client.submit).toBe('function');
    expect(typeof client.submitIntent).toBe('function');
  });

  it('submit returns error for unsupported chains (does not throw)', async () => {
    const client = BatchClient({ apiKey: 'test-key', endpoint: 'http://127.0.0.1:1' });
    const result = makeRouteResult(); // chainId: 'base'

    // Solana is not supported for batching
    const solanaResult = { ...result, chainId: 'solana' as const };
    const submitResult = await client.submit(solanaResult, {
      from: '0xAgent', nonce: '0', deadline: '999999999', v: 27, r: '0x00', s: '0x00',
    });
    expect(submitResult.status).toBe('error');
  });
});
