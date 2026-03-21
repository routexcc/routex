import { describe, it, expect } from 'vitest';
import { RouteSelector } from '../../src/router/RouteSelector.js';
import { RouteExhaustedError } from '../../src/errors.js';
import type {
  ChainId,
  RouteConfig,
  FeeEstimate,
  PaymentRequirement,
  ChainAdapter,
  FeeOracle,
  TokenBalance,
  PaymentPayload,
  AcceptedPayment,
  Signer,
} from '../../src/types.js';

function makeFee(
  chainId: ChainId,
  overrides?: Partial<FeeEstimate>,
): FeeEstimate {
  return {
    chainId,
    // BigInt: token amounts must never use floating point
    feeAmount: 1000n,
    feeUsd: 500000n,
    finalityMs: 2000,
    confidence: 'high',
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeAdapter(chainId: ChainId): ChainAdapter {
  return {
    chainId,
    async getBalance(_address: string, _token: string): Promise<TokenBalance> {
      return { chainId, token: 'USDC', balance: 10000000n, timestamp: Date.now() };
    },
    async estimateFee(_payment: AcceptedPayment): Promise<FeeEstimate> {
      return makeFee(chainId);
    },
    async buildPaymentPayload(payment: AcceptedPayment, _signer: Signer): Promise<PaymentPayload> {
      return {
        chainId,
        to: payment.payTo,
        amount: payment.amount,
        token: payment.token,
        data: '0xsigned',
      };
    },
    getFinality(): number {
      return 2000;
    },
  };
}

function makeFeeOracle(): FeeOracle {
  return {
    async getFee(_chainId: ChainId) { return undefined; },
    async getAllFees() { return new Map(); },
    start() { /* noop */ },
    stop() { /* noop */ },
  };
}

function makeConfig(overrides?: Partial<RouteConfig>): RouteConfig {
  const adapters = new Map<ChainId, ChainAdapter>([
    ['base', makeAdapter('base')],
    ['polygon', makeAdapter('polygon')],
  ]);

  return {
    adapters,
    feeOracle: makeFeeOracle(),
    strategy: 'cheapest',
    maxFeeAgeMs: 60000,
    ...overrides,
  };
}

function makeRequirement(chains?: ChainId[]): PaymentRequirement {
  const ids = chains ?? ['base', 'polygon'];
  return {
    acceptedChains: ids.map((chainId) => ({
      chainId,
      payTo: '0xRecipient',
      // BigInt: token amounts must never use floating point
      amount: 1000000n,
      token: 'USDC',
    })),
  };
}

describe('RouteSelector', () => {
  it('selects the cheapest route in happy path', async () => {
    const config = makeConfig({ strategy: 'cheapest' });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { feeUsd: 500000n })],
      ['polygon', makeFee('polygon', { feeUsd: 100000n })],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result[0].chainId).toBe('polygon');
  });

  it('throws RouteExhaustedError when all candidates are rejected', async () => {
    const config = makeConfig();
    const selector = new RouteSelector(config);

    // No fees available → all rejected
    const fees = new Map<ChainId, FeeEstimate>();
    const balances = new Map<ChainId, bigint>();

    await expect(
      selector.select(makeRequirement(), balances, fees),
    ).rejects.toThrow(RouteExhaustedError);
  });

  it('rejects chains with stale fees', async () => {
    const config = makeConfig({ maxFeeAgeMs: 5000 });
    const selector = new RouteSelector(config);

    // Fee is 10 seconds old, max is 5 seconds
    const staleFee = makeFee('base', { timestamp: Date.now() - 10000 });
    const freshFee = makeFee('polygon', { timestamp: Date.now() });

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', staleFee],
      ['polygon', freshFee],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    // Base should be rejected (stale), polygon selected
    expect(result[0].chainId).toBe('polygon');
  });

  it('rejects chains with insufficient balance', async () => {
    const config = makeConfig();
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['polygon', makeFee('polygon')],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: base has insufficient balance (less than amount + fee)
      ['base', 100n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result[0].chainId).toBe('polygon');
  });

  it('rejects excluded chains', async () => {
    const config = makeConfig({ excludeChains: ['base'] });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['polygon', makeFee('polygon')],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('polygon');
  });

  it('rejects chains exceeding maxFeeUsd', async () => {
    // BigInt: maxFeeUsd threshold
    const config = makeConfig({ maxFeeUsd: 200000n });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      // BigInt: feeUsd values
      ['base', makeFee('base', { feeUsd: 500000n })],
      ['polygon', makeFee('polygon', { feeUsd: 100000n })],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('polygon');
  });

  it('rejects chains exceeding maxFinalityMs', async () => {
    const config = makeConfig({ maxFinalityMs: 3000 });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { finalityMs: 5000 })],
      ['polygon', makeFee('polygon', { finalityMs: 2000 })],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('polygon');
  });

  it('includes rejection reasons in RouteExhaustedError', async () => {
    const config = makeConfig();
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>();
    const balances = new Map<ChainId, bigint>();

    try {
      await selector.select(makeRequirement(), balances, fees);
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RouteExhaustedError);
      const routeErr = err as RouteExhaustedError;
      expect(routeErr.rejections).toHaveLength(2);
      expect(routeErr.rejections[0].code).toBe('FEE_UNAVAILABLE');
    }
  });

  it('rejects chains without an adapter', async () => {
    // Only base adapter, but requirement includes stellar
    const adapters = new Map<ChainId, ChainAdapter>([
      ['base', makeAdapter('base')],
    ]);
    const config = makeConfig({ adapters });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['stellar', makeFee('stellar')],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: token amounts
      ['base', 10000000n],
      ['stellar', 10000000n],
    ]);

    const result = await selector.select(
      makeRequirement(['base', 'stellar']),
      balances,
      fees,
    );
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('base');
  });

  it('rejects chains with undefined balance', async () => {
    const config = makeConfig();
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['polygon', makeFee('polygon')],
    ]);

    // Only polygon has a balance, base is missing
    const balances = new Map<ChainId, bigint>([
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result).toHaveLength(1);
    expect(result[0].chainId).toBe('polygon');
  });

  it('uses balanced strategy', async () => {
    const config = makeConfig({ strategy: 'balanced' });
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base', { feeUsd: 200000n, finalityMs: 2000 })],
      ['polygon', makeFee('polygon', { feeUsd: 100000n, finalityMs: 5000 })],
    ]);

    const balances = new Map<ChainId, bigint>([
      ['base', 10000000n],
      ['polygon', 10000000n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result.length).toBeGreaterThan(0);
    // Both should be scored and returned
    expect(result).toHaveLength(2);
  });

  it('uses bigint for all balance and fee comparisons', async () => {
    const config = makeConfig();
    const selector = new RouteSelector(config);

    const fees = new Map<ChainId, FeeEstimate>([
      ['base', makeFee('base')],
      ['polygon', makeFee('polygon')],
    ]);

    const balances = new Map<ChainId, bigint>([
      // BigInt: very large amounts
      ['base', 999999999999999999n],
      ['polygon', 999999999999999999n],
    ]);

    const result = await selector.select(makeRequirement(), balances, fees);
    expect(result.length).toBeGreaterThan(0);
    // Verify all values are bigint
    for (const option of result) {
      expect(typeof option.balance).toBe('bigint');
      expect(typeof option.fee.feeAmount).toBe('bigint');
      expect(typeof option.fee.feeUsd).toBe('bigint');
      expect(typeof option.payment.amount).toBe('bigint');
    }
  });
});
