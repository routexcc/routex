import { describe, it, expect } from 'vitest';
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
    // BigInt: token amounts must never use floating point
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
    // BigInt: token amounts must never use floating point
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

describe('CloudFeeOracle', () => {
  it('delegates getFee to fallback oracle', async () => {
    const fallback = makeFallbackOracle();
    const oracle = CloudFeeOracle({ apiKey: 'test-key', fallback });

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.chainId).toBe('base');
  });

  it('delegates getAllFees to fallback oracle', async () => {
    const fallback = makeFallbackOracle();
    const oracle = CloudFeeOracle({ apiKey: 'test-key', fallback });

    const fees = await oracle.getAllFees();
    expect(fees.size).toBe(2);
    expect(fees.has('base')).toBe(true);
    expect(fees.has('polygon')).toBe(true);
  });

  it('delegates start/stop to fallback oracle', () => {
    const fallback = makeFallbackOracle();
    const oracle = CloudFeeOracle({ apiKey: 'test-key', fallback });

    // Should not throw
    oracle.start();
    oracle.stop();
  });

  it('returns the fallback oracle instance', () => {
    const fallback = makeFallbackOracle();
    const oracle = CloudFeeOracle({ apiKey: 'test-key', fallback });

    // In v1, cloud oracle IS the fallback
    expect(oracle).toBe(fallback);
  });
});

describe('TelemetryReporter', () => {
  it('creates a reporter with a report method', () => {
    const reporter = TelemetryReporter({ apiKey: 'test-key' });
    expect(reporter).toBeDefined();
    expect(typeof reporter.report).toBe('function');
  });

  it('report is a no-op that does not throw', () => {
    const reporter = TelemetryReporter({ apiKey: 'test-key' });
    const result = makeRouteResult();

    // Should not throw
    expect(() => reporter.report(result)).not.toThrow();
  });
});

describe('BatchClient', () => {
  it('creates a client with a submit method', () => {
    const client = BatchClient({ apiKey: 'test-key' });
    expect(client).toBeDefined();
    expect(typeof client.submit).toBe('function');
  });

  it('submit is a no-op that resolves', async () => {
    const client = BatchClient({ apiKey: 'test-key' });
    const result = makeRouteResult();

    // Should resolve without throwing
    await expect(client.submit(result)).resolves.toBeUndefined();
  });
});
