import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LocalFeeOracle } from '../../src/oracle/LocalFeeOracle.js';
import type { ChainId, ChainAdapter, FeeEstimate, AcceptedPayment, TokenBalance, PaymentPayload, Signer } from '../../src/types.js';

function makeAdapter(
  chainId: ChainId,
  overrides?: { feeUsd?: bigint; shouldFail?: boolean },
): ChainAdapter {
  return {
    chainId,
    async getBalance(_address: string, _token: string): Promise<TokenBalance> {
      return { chainId, token: 'USDC', balance: 10000000n, timestamp: Date.now() };
    },
    async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
      if (overrides?.shouldFail) {
        throw new Error('RPC failed');
      }
      return {
        chainId,
        // BigInt: token amounts must never use floating point
        feeAmount: 1000n,
        feeUsd: overrides?.feeUsd ?? 500000n,
        finalityMs: 2000,
        confidence: 'high',
        timestamp: Date.now(),
      };
    },
    async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
      return { chainId, to: payment.payTo, amount: payment.amount, token: payment.token, data: '0x' };
    },
    getFinality() { return 2000; },
  };
}

describe('LocalFeeOracle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns undefined for unknown chains', async () => {
    const oracle = new LocalFeeOracle({
      adapters: new Map(),
      maxFeeAgeMs: 60000,
    });

    const fee = await oracle.getFee('base');
    expect(fee).toBeUndefined();
  });

  it('caches fee estimates after polling', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);

    const oracle = new LocalFeeOracle({ adapters, maxFeeAgeMs: 60000 });
    oracle.start();

    // Let the initial poll complete
    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.chainId).toBe('base');
    // BigInt: verify feeUsd is bigint
    expect(typeof fee!.feeUsd).toBe('bigint');

    oracle.stop();
  });

  it('degrades confidence for stale estimates', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);

    const oracle = new LocalFeeOracle({ adapters, maxFeeAgeMs: 5000 });
    oracle.start();

    // Initial poll
    await vi.advanceTimersByTimeAsync(0);

    // Advance past stale threshold
    vi.advanceTimersByTime(10000);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    // INV-6: stale fees have low confidence
    expect(fee!.confidence).toBe('low');

    oracle.stop();
  });

  it('falls back to fallback adapter when primary fails', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', { shouldFail: true })],
    ]);
    const fallbackAdapters = new Map<ChainId, ChainAdapter>([
      // BigInt: distinct feeUsd from fallback
      ['base', makeAdapter('base', { feeUsd: 300000n })],
    ]);

    const oracle = new LocalFeeOracle({
      adapters,
      fallbackAdapters,
      maxFeeAgeMs: 60000,
    });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    oracle.stop();
  });

  it('degrades confidence when primary and fallback diverge by >50%', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      // BigInt: primary feeUsd = 100000n
      ['base', makeAdapter('base', { feeUsd: 100000n })],
    ]);
    const fallbackAdapters = new Map<ChainId, ChainAdapter>([
      // BigInt: fallback feeUsd = 500000n (400% divergence)
      ['base', makeAdapter('base', { feeUsd: 500000n })],
    ]);

    const oracle = new LocalFeeOracle({
      adapters,
      fallbackAdapters,
      maxFeeAgeMs: 60000,
    });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.confidence).toBe('low');

    oracle.stop();
  });

  it('keeps confidence when divergence is within threshold', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      // BigInt: primary feeUsd = 100000n
      ['base', makeAdapter('base', { feeUsd: 100000n })],
    ]);
    const fallbackAdapters = new Map<ChainId, ChainAdapter>([
      // BigInt: fallback feeUsd = 110000n (10% divergence)
      ['base', makeAdapter('base', { feeUsd: 110000n })],
    ]);

    const oracle = new LocalFeeOracle({
      adapters,
      fallbackAdapters,
      maxFeeAgeMs: 60000,
      maxDivergencePercent: 50,
    });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.confidence).toBe('high');

    oracle.stop();
  });

  it('returns undefined when primary and fallback both fail', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', { shouldFail: true })],
    ]);
    const fallbackAdapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base', { shouldFail: true })],
    ]);

    const oracle = new LocalFeeOracle({
      adapters,
      fallbackAdapters,
      maxFeeAgeMs: 60000,
    });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeUndefined();

    oracle.stop();
  });

  it('handles zero-fee divergence calculation safely', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      // BigInt: primary zero fee
      ['base', makeAdapter('base', { feeUsd: 0n })],
    ]);
    const fallbackAdapters = new Map<ChainId, ChainAdapter>([
      // BigInt: fallback zero fee
      ['base', makeAdapter('base', { feeUsd: 0n })],
    ]);

    const oracle = new LocalFeeOracle({
      adapters,
      fallbackAdapters,
      maxFeeAgeMs: 60000,
    });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fee = await oracle.getFee('base');
    expect(fee).toBeDefined();
    expect(fee!.feeUsd).toBe(0n);
    expect(fee!.confidence).toBe('high');

    oracle.stop();
  });

  it('getAllFees returns all cached estimates', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
      ['polygon', makeAdapter('polygon')],
    ]);

    const oracle = new LocalFeeOracle({ adapters, maxFeeAgeMs: 60000 });
    oracle.start();

    await vi.advanceTimersByTimeAsync(0);

    const fees = await oracle.getAllFees();
    expect(fees.size).toBe(2);
    expect(fees.has('base')).toBe(true);
    expect(fees.has('polygon')).toBe(true);

    oracle.stop();
  });

  it('stop clears all timers', async () => {
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);

    const oracle = new LocalFeeOracle({ adapters, maxFeeAgeMs: 60000 });
    oracle.start();
    oracle.start();
    oracle.stop();

    // Calling start/stop twice should be safe
    oracle.start();
    oracle.stop();
  });
});
